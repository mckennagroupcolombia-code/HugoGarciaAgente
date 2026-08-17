"""
Estadísticas de postventa MeLi: motivos de reclamo, tiempos de respuesta
y solicitudes más frecuentes.

Clasificación por palabras clave (sin LLM). Persistencia SQLite local;
el panel lee GET /api/postventa/estadisticas.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import statistics
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from app.observability import log_json

_CO = timezone(timedelta(hours=-5))
_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "..", "data", "postventa_stats.db")
_POSVENTA_STATE_PATH = os.path.join(_HERE, "..", "data", "mensajes_posventa_pendientes.json")

_DB_READY = False
_MELI_SYNC_CACHE: dict[str, Any] = {"ts": 0.0, "ok": False}
_MELI_SYNC_TTL_SEG = 30 * 60

SOLICITUD_TIPOS: list[tuple[str, str, tuple[str, ...]]] = [
    (
        "documentos",
        "Ficha / certificado",
        (
            "ficha técnica",
            "ficha tecnica",
            "ficha tec",
            "coa",
            "tds",
            "msds",
            "hoja de seguridad",
            "certificado de analisis",
            "certificado de análisis",
            "análisis de calidad",
            "analisis de calidad",
        ),
    ),
    (
        "factura",
        "Factura / RUT",
        (
            "factura",
            "facturación",
            "facturacion",
            "dian",
            "rut",
            "nit",
            "electrónica",
            "electronica",
        ),
    ),
    (
        "envio",
        "Envío / guía",
        (
            "guía",
            "guia",
            "envío",
            "envio",
            "tracking",
            "rastreo",
            "dónde está",
            "donde esta",
            "cuando llega",
            "cuándo llega",
            "transportadora",
            "coordinadora",
            "interrapidísimo",
            "interrapidisimo",
            "servientrega",
            "despacho",
        ),
    ),
    (
        "producto",
        "Daño / faltante",
        (
            "dañado",
            "danado",
            "roto",
            "faltante",
            "incompleto",
            "no llegó",
            "no llego",
            "vacío",
            "vacio",
            "otro producto",
            "no es lo que",
            "vencido",
            "abierto",
        ),
    ),
    (
        "cancelacion",
        "Cancelar / devolver",
        (
            "cancelar",
            "cancelación",
            "cancelacion",
            "devolver",
            "devolución",
            "devolucion",
            "reembolso",
            "plata de vuelta",
            "quiero anular",
        ),
    ),
    (
        "uso",
        "Uso / dosis",
        (
            "cómo se usa",
            "como se usa",
            "cómo usar",
            "como usar",
            "dosis",
            "concentración",
            "concentracion",
            "diluir",
            "se puede aplicar",
            "para qué sirve",
            "para que sirve",
        ),
    ),
]

SOLICITUD_LABELS = {tid: label for tid, label, _ in SOLICITUD_TIPOS}
SOLICITUD_LABELS["adjunto"] = "Solo adjunto"
SOLICITUD_LABELS["otro"] = "Otra consulta"

_SLA_BUCKETS = [
    ("<15 min", 0, 15, "excelente"),
    ("15–60 min", 15, 60, "bueno"),
    ("1–4 h", 60, 240, "aceptable"),
    ("4–24 h", 240, 1440, "lento"),
    (">24 h", 1440, None, "critico"),
]

_MOTIVO_PREFIX = (
    ("PNR", "no_recibido", "No recibido"),
    ("PDD", "defectuoso", "Defectuoso o distinto"),
    ("RET", "devolucion", "Devolución"),
    ("CANC", "cancelacion", "Cancelación"),
)

_MOTIVO_TIPO = {
    "returns": ("devolucion", "Devolución"),
    "cancellations": ("cancelacion", "Cancelación"),
    "mediations": ("mediacion", "Mediación / reclamo"),
    "ml_case": ("caso_meli", "Caso Mercado Libre"),
    "claims": ("reclamo", "Reclamo"),
}


def _now() -> datetime:
    return datetime.now(_CO)


def _now_iso() -> str:
    return _now().replace(microsecond=0).isoformat()


def _parse_ts(raw: Any) -> datetime | None:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_CO)
    return dt.astimezone(_CO)


def _norm(texto: str) -> str:
    t = (texto or "").strip().lower()
    t = t.replace("á", "a").replace("é", "e").replace("í", "i")
    t = t.replace("ó", "o").replace("ú", "u").replace("ü", "u")
    return t


def clasificar_solicitud(texto: str) -> tuple[str, str]:
    """Devuelve (id, etiqueta) según el mensaje del comprador. Sin LLM."""
    raw = (texto or "").strip()
    if not raw or raw.lstrip().startswith("[Solo adjunto"):
        return "adjunto", SOLICITUD_LABELS["adjunto"]
    t = _norm(raw)
    for tid, label, claves in SOLICITUD_TIPOS:
        for clave in claves:
            c = _norm(clave)
            if len(c) <= 4:
                if re.search(rf"(?<![a-z0-9]){re.escape(c)}(?![a-z0-9])", t):
                    return tid, label
            elif c in t:
                return tid, label
    return "otro", SOLICITUD_LABELS["otro"]


def clasificar_motivo_reclamo(
    reason_id: str | None,
    tipo: str | None,
    stage: str | None = None,
) -> tuple[str, str]:
    """Mapea reason_id / type de MeLi a un motivo estable para el panel."""
    rid = str(reason_id or "").strip().upper()
    for pref, mid, label in _MOTIVO_PREFIX:
        if rid.startswith(pref):
            return mid, label
    tipo_n = str(tipo or stage or "").strip().lower()
    if tipo_n in _MOTIVO_TIPO:
        return _MOTIVO_TIPO[tipo_n]
    if rid:
        return "otro", f"Motivo {rid}"
    if tipo_n:
        return "otro", tipo_n.replace("_", " ").title()
    return "otro", "Sin motivo"


def _extraer_reason_id(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return ""
    rid = payload.get("reason_id") or payload.get("reasonId")
    if isinstance(rid, dict):
        rid = rid.get("id") or rid.get("name") or ""
    reason = payload.get("reason")
    if not rid and isinstance(reason, dict):
        rid = reason.get("id") or reason.get("name") or ""
    if not rid and isinstance(reason, str):
        rid = reason
    return str(rid or "").strip()


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def _safe_migrate(fn) -> None:
    try:
        fn()
    except sqlite3.OperationalError:
        pass


def init_db() -> None:
    global _DB_READY
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS mensajes (
                msg_id TEXT PRIMARY KEY,
                pack_id TEXT,
                codigo TEXT,
                tipo_solicitud TEXT,
                texto TEXT,
                recibido_en TEXT NOT NULL,
                cerrado_en TEXT,
                via TEXT,
                minutos_respuesta REAL
            );
            CREATE INDEX IF NOT EXISTS idx_msg_recibido ON mensajes(recibido_en);
            CREATE INDEX IF NOT EXISTS idx_msg_tipo ON mensajes(tipo_solicitud);

            CREATE TABLE IF NOT EXISTS reclamos (
                claim_id TEXT PRIMARY KEY,
                tipo TEXT,
                motivo_id TEXT,
                motivo_label TEXT,
                reason_id TEXT,
                status TEXT,
                pack_id TEXT,
                order_id TEXT,
                creado_en TEXT,
                actualizado_en TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_reclamo_creado ON reclamos(creado_en);
            CREATE INDEX IF NOT EXISTS idx_reclamo_motivo ON reclamos(motivo_id);

            CREATE TABLE IF NOT EXISTS meta (
                clave TEXT PRIMARY KEY,
                valor TEXT
            );
            """
        )
    _DB_READY = True


def _ensure_db() -> None:
    if not _DB_READY:
        init_db()


def registrar_mensaje_recibido(entrada: dict[str, Any] | None) -> None:
    """Upsert al encolar un mensaje postventa. No pisa un cierre ya guardado."""
    if not isinstance(entrada, dict):
        return
    msg_id = str(entrada.get("msg_id") or "").strip()
    pack_id = str(entrada.get("pack_id") or "").strip()
    if not msg_id and not pack_id:
        return
    if not msg_id:
        msg_id = f"pack:{pack_id}"
    texto = str(entrada.get("texto") or "")
    tipo_id, _ = clasificar_solicitud(texto)
    recibido = str(entrada.get("timestamp") or "").strip() or _now_iso()
    codigo = str(entrada.get("codigo") or "").strip()
    _ensure_db()
    with _conn() as con:
        row = con.execute(
            "SELECT cerrado_en FROM mensajes WHERE msg_id = ?", (msg_id,)
        ).fetchone()
        if row and row["cerrado_en"]:
            return
        con.execute(
            """
            INSERT INTO mensajes (
                msg_id, pack_id, codigo, tipo_solicitud, texto, recibido_en
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(msg_id) DO UPDATE SET
                pack_id = COALESCE(excluded.pack_id, mensajes.pack_id),
                codigo = COALESCE(excluded.codigo, mensajes.codigo),
                tipo_solicitud = excluded.tipo_solicitud,
                texto = excluded.texto
            WHERE mensajes.cerrado_en IS NULL
            """,
            (msg_id, pack_id, codigo, tipo_id, texto[:800], recibido),
        )


def marcar_mensaje_cerrado(
    entrada: dict[str, Any] | None,
    *,
    via: str,
    cerrado_en: str | None = None,
) -> None:
    """Cierra el evento (respuesta, omisión o conversación cerrada en MeLi)."""
    if not isinstance(entrada, dict):
        entrada = {}
    msg_id = str(entrada.get("msg_id") or "").strip()
    pack_id = str(entrada.get("pack_id") or "").strip()
    if not msg_id and pack_id:
        msg_id = f"pack:{pack_id}"
    if not msg_id:
        return
    registrar_mensaje_recibido(entrada)
    cierre = cerrado_en or _now_iso()
    dt_cierre = _parse_ts(cierre) or _now()
    _ensure_db()
    with _conn() as con:
        row = con.execute(
            "SELECT recibido_en FROM mensajes WHERE msg_id = ?", (msg_id,)
        ).fetchone()
        minutos = None
        if row:
            dt_rec = _parse_ts(row["recibido_en"])
            if dt_rec:
                minutos = max(0.0, (dt_cierre - dt_rec).total_seconds() / 60.0)
        con.execute(
            """
            UPDATE mensajes
            SET cerrado_en = ?, via = ?, minutos_respuesta = ?
            WHERE msg_id = ? AND cerrado_en IS NULL
            """,
            (cierre, (via or "")[:32], minutos, msg_id),
        )


def registrar_reclamo(
    *,
    claim_id: str,
    payload: dict[str, Any] | None = None,
    topic: str | None = None,
    pack_id: str | None = None,
    order_id: str | None = None,
) -> None:
    cid = re.sub(r"\D", "", str(claim_id or ""))
    if not cid:
        return
    payload = payload if isinstance(payload, dict) else {}
    reason_id = _extraer_reason_id(payload)
    tipo = str(payload.get("type") or topic or "").strip().lower()
    stage = str(payload.get("stage") or "").strip().lower()
    motivo_id, motivo_label = clasificar_motivo_reclamo(reason_id, tipo, stage)
    status = str(payload.get("status") or "").strip().lower() or None
    creado = str(payload.get("date_created") or payload.get("dateCreated") or "").strip()
    actualizado = str(
        payload.get("last_updated") or payload.get("lastUpdated") or ""
    ).strip()
    if not creado:
        creado = _now_iso()
    pack = str(pack_id or payload.get("pack_id") or "").strip() or None
    order = str(order_id or payload.get("resource_id") or payload.get("order_id") or "").strip() or None
    _ensure_db()
    with _conn() as con:
        con.execute(
            """
            INSERT INTO reclamos (
                claim_id, tipo, motivo_id, motivo_label, reason_id,
                status, pack_id, order_id, creado_en, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(claim_id) DO UPDATE SET
                tipo = COALESCE(excluded.tipo, reclamos.tipo),
                motivo_id = excluded.motivo_id,
                motivo_label = excluded.motivo_label,
                reason_id = COALESCE(excluded.reason_id, reclamos.reason_id),
                status = COALESCE(excluded.status, reclamos.status),
                pack_id = COALESCE(excluded.pack_id, reclamos.pack_id),
                order_id = COALESCE(excluded.order_id, reclamos.order_id),
                actualizado_en = COALESCE(excluded.actualizado_en, reclamos.actualizado_en)
            """,
            (
                cid,
                tipo or None,
                motivo_id,
                motivo_label,
                reason_id or None,
                status,
                pack,
                order,
                creado,
                actualizado or None,
            ),
        )


def sembrar_pendientes_actuales() -> int:
    """Carga la cola JSON actual para que la espera en vivo entre a las métricas."""
    try:
        with open(_POSVENTA_STATE_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return 0
    except Exception:
        return 0
    pendientes = data.get("pendientes") if isinstance(data, dict) else None
    if not isinstance(pendientes, dict):
        return 0
    vistos: set[str] = set()
    n = 0
    for v in pendientes.values():
        if not isinstance(v, dict):
            continue
        pack_id = str(v.get("pack_id") or "").strip()
        msg_id = str(v.get("msg_id") or "").strip()
        clave = msg_id or pack_id
        if not clave or clave in vistos:
            continue
        vistos.add(clave)
        registrar_mensaje_recibido(v)
        n += 1
    return n


def _sembrar_reclamos_desde_tickets() -> None:
    """Una vez: tickets de nota crédito MeLi → reclamos, si la tabla está vacía."""
    _ensure_db()
    with _conn() as con:
        n = con.execute("SELECT COUNT(*) AS c FROM reclamos").fetchone()["c"]
        seeded = con.execute(
            "SELECT valor FROM meta WHERE clave = 'tickets_seeded'"
        ).fetchone()
        if n > 0 or seeded:
            return
    try:
        from app.services import tickets_db as tdb

        tdb.init_db()
        db = sqlite3.connect(tdb.DB_PATH)
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT titulo, descripcion, creado_en
            FROM tickets
            WHERE tipo IN ('accion','solicitud')
              AND (titulo LIKE '%MeLi reclamo%'
                   OR titulo LIKE '%Nota crédito (MeLi%'
                   OR descripcion LIKE '%Claim ID:%')
            ORDER BY id DESC
            LIMIT 400
            """
        ).fetchall()
        db.close()
    except Exception:
        return
    for row in rows:
        desc = str(row["descripcion"] or "")
        m = re.search(r"Claim ID:\s*([0-9]+)", desc)
        if not m:
            continue
        payload: dict[str, Any] = {}
        marker = "Detalles (preview):"
        idx = desc.find(marker)
        if idx >= 0:
            blob = desc[idx + len(marker) :].strip()
            try:
                parsed = json.loads(blob)
                if isinstance(parsed, dict):
                    preview = parsed.get("meli_payload_preview")
                    payload = preview if isinstance(preview, dict) else parsed
            except Exception:
                payload = {}
        registrar_reclamo(
            claim_id=m.group(1),
            payload=payload,
            pack_id=str(payload.get("pack_id") or ""),
            order_id=str(payload.get("order_id") or ""),
        )
    _ensure_db()
    with _conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO meta(clave, valor) VALUES ('tickets_seeded', ?)",
            (_now_iso(),),
        )


def _sync_reclamos_meli() -> None:
    """Best-effort: trae reclamos recientes de MeLi (cache 30 min). No bloquea el panel."""
    import time

    now = time.time()
    if now - float(_MELI_SYNC_CACHE.get("ts") or 0) < _MELI_SYNC_TTL_SEG:
        return
    _MELI_SYNC_CACHE["ts"] = now
    try:
        from app.utils import obtener_seller_id_meli, refrescar_token_meli

        token = refrescar_token_meli() or (os.environ.get("MELI_ACCESS_TOKEN") or "").strip()
        seller = obtener_seller_id_meli()
        if not token or not seller:
            return
        import requests

        url = "https://api.mercadolibre.com/post-purchase/v1/claims/search"
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"seller_id": seller, "limit": 50, "sort": "date_created:desc"},
            timeout=6,
        )
        if r.status_code != 200:
            log_json(
                "postventa_stats_meli_skip",
                status=r.status_code,
                body=(r.text or "")[:180],
            )
            return
        data = r.json()
        claims = []
        if isinstance(data, dict):
            claims = data.get("data") or data.get("claims") or data.get("results") or []
        elif isinstance(data, list):
            claims = data
        if not isinstance(claims, list):
            return
        for item in claims:
            if not isinstance(item, dict):
                continue
            cid = item.get("id") or item.get("claim_id")
            registrar_reclamo(
                claim_id=str(cid or ""),
                payload=item,
                pack_id=str(item.get("pack_id") or ""),
                order_id=str(item.get("resource_id") or item.get("order_id") or ""),
            )
        _MELI_SYNC_CACHE["ok"] = True
    except Exception as e:
        log_json("postventa_stats_meli_error", error=str(e)[:240])


def _pct(n: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(100.0 * n / total, 1)


def _resumen_tiempos(minutos: list[float]) -> dict[str, Any]:
    if not minutos:
        sla = [
            {
                "label": lab,
                "count": 0,
                "pct": 0.0,
                "grado": grado,
            }
            for lab, _a, _b, grado in _SLA_BUCKETS
        ]
        return {
            "n": 0,
            "mediana_min": None,
            "media_min": None,
            "p90_min": None,
            "sla_15_pct": None,
            "sla_24h_pct": None,
            "sla": sla,
        }
    orden = sorted(minutos)
    n = len(orden)
    p90_i = min(n - 1, max(0, int(round(0.9 * (n - 1)))))
    sla_rows = []
    for lab, lo, hi, grado in _SLA_BUCKETS:
        if hi is None:
            c = sum(1 for m in orden if m >= lo)
        else:
            c = sum(1 for m in orden if lo <= m < hi)
        sla_rows.append(
            {"label": lab, "count": c, "pct": _pct(c, n), "grado": grado}
        )
    return {
        "n": n,
        "mediana_min": round(statistics.median(orden), 1),
        "media_min": round(statistics.mean(orden), 1),
        "p90_min": round(orden[p90_i], 1),
        "sla_15_pct": _pct(sum(1 for m in orden if m < 15), n),
        "sla_24h_pct": _pct(sum(1 for m in orden if m < 1440), n),
        "sla": sla_rows,
    }


def _en_periodo(iso_ts: str | None, desde: datetime) -> bool:
    dt = _parse_ts(iso_ts)
    if dt is None:
        return False
    return dt >= desde


def calcular_estadisticas(dias: int = 30, *, sync_meli: bool = True) -> dict[str, Any]:
    """Agregados para el panel. `dias=0` = todo el historial local."""
    _ensure_db()
    try:
        sembrar_pendientes_actuales()
    except Exception:
        pass
    try:
        _sembrar_reclamos_desde_tickets()
    except Exception:
        pass
    if sync_meli:
        try:
            _sync_reclamos_meli()
        except Exception:
            pass

    dias = max(0, int(dias or 0))
    hasta = _now()
    desde = hasta - timedelta(days=dias) if dias else datetime(2000, 1, 1, tzinfo=_CO)

    with _conn() as con:
        mensajes = [dict(r) for r in con.execute("SELECT * FROM mensajes").fetchall()]
        reclamos = [dict(r) for r in con.execute("SELECT * FROM reclamos").fetchall()]

    msgs_periodo = [m for m in mensajes if _en_periodo(m.get("recibido_en"), desde)]
    abiertos = [m for m in msgs_periodo if not m.get("cerrado_en")]
    cerrados = [m for m in msgs_periodo if m.get("cerrado_en")]
    ahora = _now()
    esperas_abiertas: list[float] = []
    for m in abiertos:
        dt = _parse_ts(m.get("recibido_en"))
        if dt:
            esperas_abiertas.append(max(0.0, (ahora - dt).total_seconds() / 60.0))

    minutos_resp = [
        float(m["minutos_respuesta"])
        for m in cerrados
        if m.get("minutos_respuesta") is not None
        and str(m.get("via") or "") != "omitido"
    ]
    por_via: Counter[str] = Counter(str(m.get("via") or "desconocido") for m in cerrados)
    tipos: Counter[str] = Counter(
        str(m.get("tipo_solicitud") or "otro") for m in msgs_periodo
    )
    total_sol = sum(tipos.values())
    solicitudes = [
        {
            "id": tid,
            "label": SOLICITUD_LABELS.get(tid, tid),
            "count": c,
            "pct": _pct(c, total_sol),
        }
        for tid, c in tipos.most_common()
    ]

    recs_con_fecha = [r for r in reclamos if _parse_ts(r.get("creado_en"))]
    recs_sin_fecha = [r for r in reclamos if not _parse_ts(r.get("creado_en"))]
    recs_periodo = [r for r in recs_con_fecha if _en_periodo(r.get("creado_en"), desde)]
    if not recs_con_fecha:
        recs_periodo = recs_sin_fecha
        recortes_fecha = False
    else:
        recortes_fecha = True
    motivos: Counter[str] = Counter()
    labels_motivo: dict[str, str] = {}
    abiertos_r = 0
    for r in recs_periodo:
        mid = str(r.get("motivo_id") or "otro")
        motivos[mid] += 1
        labels_motivo[mid] = str(r.get("motivo_label") or mid)
        st = str(r.get("status") or "").lower()
        if st in ("opened", "open", "in_process", "pending", ""):
            abiertos_r += 1
    total_rec = sum(motivos.values())
    motivos_lista = [
        {
            "id": mid,
            "label": labels_motivo.get(mid, mid),
            "count": c,
            "pct": _pct(c, total_rec),
        }
        for mid, c in motivos.most_common()
    ]

    return {
        "periodo": {
            "dias": dias,
            "desde": desde.date().isoformat() if dias else None,
            "hasta": hasta.date().isoformat(),
            "zona": "America/Bogota",
        },
        "cola": {
            "pendientes": len(abiertos),
            "espera_mediana_min": (
                round(statistics.median(esperas_abiertas), 1)
                if esperas_abiertas
                else None
            ),
            "espera_max_min": (
                round(max(esperas_abiertas), 1) if esperas_abiertas else None
            ),
        },
        "tiempos": {
            **_resumen_tiempos(minutos_resp),
            "por_via": dict(por_via),
            "omitidos": por_via.get("omitido", 0),
            "respondidos": len(minutos_resp),
        },
        "solicitudes": solicitudes,
        "solicitudes_total": total_sol,
        "reclamos": {
            "total": total_rec,
            "abiertos": abiertos_r,
            "cerrados": max(0, total_rec - abiertos_r),
            "motivos": motivos_lista,
            "fuente_fechas_completa": recortes_fecha,
        },
        "nota": (
            "Los tiempos de respuesta se miden desde que el mensaje entra a la cola "
            "hasta que se responde, se omite o MeLi cierra la conversación. "
            "Los reclamos combinan webhooks, tickets de nota crédito y, si hay token, "
            "la búsqueda reciente en MeLi."
        ),
    }


def clasificar_entrada(entrada: dict[str, Any] | None) -> dict[str, Any]:
    """Campos extra para la lista de pendientes del panel."""
    texto = str((entrada or {}).get("texto") or "")
    tid, label = clasificar_solicitud(texto)
    espera = None
    dt = _parse_ts((entrada or {}).get("timestamp"))
    if dt:
        espera = round(max(0.0, (_now() - dt).total_seconds() / 60.0), 1)
    return {"tipo_solicitud": tid, "tipo_solicitud_label": label, "espera_min": espera}
