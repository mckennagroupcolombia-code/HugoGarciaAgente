"""
Búsqueda en los chats de WhatsApp y ficha de los cobros del banco sin factura.

Dos usos del panel Agente WhatsApp → Buscar (25-sep-2026):

1. `buscar()` — texto libre sobre todo el historial (`wa_chats.db`): palabras, un número de
   teléfono o un valor («320.000», «320000» y «320,000» se buscan juntos). Agrupa por
   conversación y devuelve fragmentos alrededor de la coincidencia.

2. `cobros_sin_factura()` — los cobros por Llave / QR / Nequi del extracto de la empresa que
   no están vinculados a nada, cada uno con lo que el chat dice del cliente: en qué
   conversación se confirmó ese valor, cédula o NIT y correo que escribió el cliente, y las
   líneas donde se cotizó. Nació al conciliar septiembre: de 33 cobros, 11 casaban con una
   factura de Alegra y 22 no tenían factura en ningún sistema (Alegra, Siigo —suspendido
   desde el 4-sep—, pedidos web). Para facturarlos hacen falta los datos del cliente, y
   están en el chat.

Solo lee (wa_chats.db, contabilidad.db, ventas_directas.db). Sin LLM, sin llamar a Alegra.
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
WA_DB = REPO / "app" / "data" / "wa_chats.db"
VENTAS_DIRECTAS_DB = REPO / "app" / "data" / "ventas_directas.db"

_COBRO_BANCO = ("PAGO LLAVE%", "PAGO QR%", "TRANSFERENCIA DESDE NEQUI%", "PAGO NEQUI%")


def _wa() -> sqlite3.Connection:
    c = sqlite3.connect(str(WA_DB), timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(ch for ch in s if not unicodedata.combining(ch)).lower()


def _variantes_valor(v: int) -> list[str]:
    """Cómo se escribe un valor en un chat: 320.000 · 320,000 · 320000."""
    return sorted({f"{v:,}".replace(",", "."), f"{v:,}", str(v)}, key=len, reverse=True)


def _ts(fecha: str, dias: int = 0) -> float:
    d = date.fromisoformat(str(fecha)[:10]) + timedelta(days=dias)
    return datetime.combine(d, datetime.min.time()).timestamp()


def _fragmento(texto: str, aguja: str, ancho: int = 90) -> str:
    t = str(texto or "").replace("\n", " ")
    i = _norm(t).find(_norm(aguja)) if aguja else -1
    if i < 0:
        return t[: ancho * 2]
    ini = max(0, i - ancho)
    return ("…" if ini else "") + t[ini: i + len(aguja) + ancho] + ("…" if i + len(aguja) + ancho < len(t) else "")


def _contacto(jid: str) -> dict:
    try:
        from app.services.wa_jid import info_contacto_jid, jid_canonico

        info = info_contacto_jid(jid)
        return {"jid": jid_canonico(jid), "display": info.get("display") or jid, "telefono": info.get("telefono")}
    except Exception:
        return {"jid": jid, "display": jid, "telefono": None}


def buscar(q: str, *, desde: str = "", hasta: str = "", incluir_grupos: bool = False,
           limite: int = 60) -> dict[str, Any]:
    """Conversaciones que mencionan `q`, con sus fragmentos. Más reciente primero."""
    q = (q or "").strip()
    if len(q) < 2:
        return {"q": q, "resultados": []}
    digitos = re.sub(r"\D", "", q)
    es_valor = bool(re.fullmatch(r"[\d.,$\s]+", q)) and len(digitos) >= 3
    condiciones, params = [], []
    if es_valor:
        v = int(digitos)
        condiciones.append("(" + " OR ".join("texto LIKE ?" for _ in _variantes_valor(v)) + ")")
        params += [f"%{x}%" for x in _variantes_valor(v)]
        if len(digitos) >= 7:   # también puede ser un teléfono
            condiciones[-1] = condiciones[-1][:-1] + " OR jid LIKE ?)"
            params.append(f"%{digitos[-10:]}%")
    else:
        for tok in [t for t in re.split(r"\s+", q) if t]:
            condiciones.append("texto LIKE ?")
            params.append(f"%{tok}%")
    if desde:
        condiciones.append("ts >= ?")
        params.append(_ts(desde))
    if hasta:
        condiciones.append("ts < ?")
        params.append(_ts(hasta, 1))
    if not incluir_grupos:
        condiciones.append("jid NOT LIKE '%@g.us'")
    sql = ("SELECT jid, ts, direccion, enviado_por, texto FROM mensajes WHERE eliminado=0 AND "
           + " AND ".join(condiciones) + " ORDER BY ts DESC LIMIT 800")
    with _wa() as c:
        filas = c.execute(sql, params).fetchall()
    aguja = (_variantes_valor(int(digitos))[0] if es_valor else q.split()[0])
    grupos: dict[str, dict] = {}
    for r in filas:
        ct = _contacto(r["jid"])
        g = grupos.setdefault(ct["jid"], {**ct, "coincidencias": 0, "ultimo_ts": r["ts"], "fragmentos": []})
        g["coincidencias"] += 1
        if len(g["fragmentos"]) < 4:
            g["fragmentos"].append({
                "ts": r["ts"], "direccion": r["direccion"], "por": r["enviado_por"] or "",
                "texto": _fragmento(r["texto"], aguja),
            })
    res = sorted(grupos.values(), key=lambda g: -float(g["ultimo_ts"] or 0))[:limite]
    return {"q": q, "es_valor": es_valor, "resultados": res, "total_mensajes": len(filas)}


# ─── Cobros del banco sin factura ─────────────────────────────────────────────

_RE_DOC = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d{3}){2,3}|\d{6,11})(?![\d.])")
_RE_CORREO = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_RE_PRECIO = re.compile(r"\$?\s?\d{1,3}(?:[.,]\d{3})+")


def _numeros_internos() -> set[str]:
    """Teléfonos de McKenna (asesores, supervisor): sus chats no son clientes."""
    out = set()
    try:
        import json

        d = json.loads((REPO / "app" / "data" / "grupos_whatsapp_oficiales.json").read_text(encoding="utf-8"))
        for v in (d.values() if isinstance(d, dict) else []):
            if isinstance(v, str):
                out.add(re.sub(r"\D", "", v)[-10:])
    except Exception:
        pass
    import os

    for n in (os.getenv("WA_V2_ALERTA_DESTINO") or "573182432463").split(","):
        if re.sub(r"\D", "", n):
            out.add(re.sub(r"\D", "", n)[-10:])
    return out


def _ficha_chat(c: sqlite3.Connection, jid: str, t0: float, t1: float) -> dict:
    msgs = c.execute(
        "SELECT ts, direccion, enviado_por, texto FROM mensajes WHERE jid=? AND eliminado=0 AND ts BETWEEN ? AND ? ORDER BY ts",
        (jid, t0, t1),
    ).fetchall()
    tel = re.sub(r"\D", "", jid.split("@")[0])[-10:]
    entrada = " ".join(m["texto"] or "" for m in msgs if m["direccion"] == "entrada")
    docs = []
    for d in _RE_DOC.findall(entrada):
        n = re.sub(r"\D", "", d)
        if n == tel or (n.startswith("3") and len(n) == 10) or len(n) > 11:
            continue            # celulares y cuentas no son documentos
        if n not in docs:
            docs.append(n)
    todo = "\n".join(m["texto"] or "" for m in msgs)
    cotizado = [(m["texto"] or "").replace("\n", " ")[:220] for m in msgs
                if m["direccion"] == "salida" and _RE_PRECIO.search(m["texto"] or "")][-6:]
    return {
        **_contacto(jid),
        "mensajes": len(msgs),
        "documentos": docs[:4],
        "correos": sorted(set(_RE_CORREO.findall(todo)))[:3],
        "cotizado": cotizado,
        "conversacion": [
            {"ts": m["ts"], "direccion": m["direccion"], "por": m["enviado_por"] or "",
             "texto": (m["texto"] or "").replace("\n", " ")[:300]}
            for m in msgs[-25:]
        ],
    }


def cobros_sin_factura(desde: str = "", hasta: str = "") -> dict[str, Any]:
    """Cobros por Llave/QR/Nequi sin vincular, con los datos del cliente que da el chat."""
    import app.services.contabilidad_core as cc

    desde = desde or (cc.fecha_corte() if hasattr(cc, "fecha_corte") else "2026-09-01")
    hasta = hasta or date.today().isoformat()
    with cc._conn() as con:
        lineas = [dict(r) for r in con.execute(
            "SELECT e.id, e.fecha, e.descripcion, e.monto FROM extracto_movimientos e"
            " JOIN extractos_bancarios x ON x.id = e.extracto_id AND COALESCE(x.tercero_id, 0) = 0"
            " WHERE e.tipo='credito' AND e.fecha BETWEEN ? AND ? AND ("
            + " OR ".join("e.descripcion LIKE ?" for _ in _COBRO_BANCO) + ")"
            " AND NOT EXISTS (SELECT 1 FROM extracto_vinculos v WHERE v.extracto_mov_id = e.id)"
            " ORDER BY e.fecha, e.id",
            (desde, hasta, *_COBRO_BANCO),
        )]
        terceros = {re.sub(r"\D", "", str(t["identificacion"] or "")): dict(t) for t in con.execute(
            "SELECT id, nombre, identificacion, tipo FROM cc_terceros WHERE identificacion <> ''")}
    internos = _numeros_internos()
    fichas = []
    with _wa() as c:
        for l in lineas:
            v = int(round(float(l["monto"])))
            t0, t1 = _ts(l["fecha"], -20), _ts(l["fecha"], 4)
            jids: dict[str, int] = {}
            for x in _variantes_valor(v):
                for r in c.execute(
                    "SELECT jid, COUNT(*) n FROM mensajes WHERE eliminado=0 AND texto LIKE ? AND ts BETWEEN ? AND ?"
                    " AND jid NOT LIKE '%@g.us' GROUP BY jid",
                    (f"%{x}%", _ts(l["fecha"], -12), _ts(l["fecha"], 3)),
                ):
                    if re.sub(r"\D", "", r["jid"].split("@")[0])[-10:] in internos:
                        continue
                    jids[r["jid"]] = jids.get(r["jid"], 0) + int(r["n"])
            chats = [_ficha_chat(c, j, t0, t1) for j in sorted(jids, key=lambda j: -jids[j])[:3]]
            for ch in chats:
                ch["en_libro"] = [terceros[d] for d in ch["documentos"] if d in terceros]
            fichas.append({
                "linea": {**l, "banco_nombre": re.sub(r"^(PAGO LLAVE|PAGO QR|TRANSFERENCIA DESDE NEQUI|PAGO NEQUI)\s*", "",
                                                      l["descripcion"]).strip()},
                "chats": chats,
                "estado": "sin_rastro" if not chats else ("ambiguo" if len(chats) > 1 else "identificado"),
            })
    return {
        "desde": desde, "hasta": hasta,
        "cobros": fichas,
        "total": round(sum(f["linea"]["monto"] for f in fichas), 2),
        "identificados": sum(1 for f in fichas if f["estado"] == "identificado"),
    }
