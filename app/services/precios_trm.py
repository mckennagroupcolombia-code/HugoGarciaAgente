"""
Precios indexados a la TRM oficial (BanRep).

Cada SKU guarda un ancla: el precio que tenía y la TRM del día en que se fijó.
Cuando la TRM se aleja del ancla más que el umbral, se propone mover el precio
por la variación × el traslado:

    variación = TRM hoy / TRM ancla − 1          (4.000 → 4.200 = +5 %)
    ajuste    = variación × traslado             (+5 % × 60 % = +3 %)
    nuevo     = precio ancla × (1 + ajuste)      redondeado a `redondeo`

Sube y baja. Nada se escribe en MeLi/Alegra sin que alguien apruebe la
propuesta en /app → Rentabilidad → Precios TRM: el cron diario
(scripts/precios_trm_cron.py) solo calcula y avisa.

Reglas del ancla:
- Primera vez que se ve un SKU: ancla = precio actual con la TRM de referencia
  inicial de la config (o la de hoy si no hay).
- Si el precio publicado en MeLi ya no es el del ancla (alguien lo cambió a
  mano en Ganancia o en MeLi), ese precio nuevo pasa a ser el ancla con la TRM
  de hoy: un cambio manual reinicia la cuenta.
- Al aplicar un ajuste, el ancla pasa a (precio nuevo, TRM usada).

Catálogo = precios publicados en MeLi (referencia maestra, ver
precios_canales.py), leídos de la caché de cobros. Aplicar escribe MeLi y
Alegra; la web se regenera una sola vez al final del lote.

Sin LLM. Datos: app/data/precios_trm.db (no versionado) y
app/data/precios_trm_config.json.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_DATA = Path(__file__).resolve().parents[1] / "data"
_DB_PATH = _DATA / "precios_trm.db"
_CONFIG_PATH = _DATA / "precios_trm_config.json"
_TZ = ZoneInfo("America/Bogota")

CONFIG_DEFAULT = {
    "traslado_pct": 60.0,        # qué parte de la variación de la TRM pasa al precio
    "umbral_pct": 2.0,           # variación mínima de la TRM para proponer
    "redondeo": 100,             # múltiplo al que se redondea el precio nuevo
    "trm_base_inicial": None,    # TRM de referencia para SKUs sin ancla (None = la de hoy)
    "conservar_900": True,       # precio que termina en 900 sigue terminando en 900
}

# Una variación así en la TRM no es mercado: es un dato malo de la fuente.
# Mejor no proponer nada que proponerle al catálogo entero un cambio absurdo.
VARIACION_MAXIMA_CREIBLE = 0.25

_TOLERANCIA_PRECIO = 1.0
_lock_aplicar = threading.Lock()


def _ahora() -> str:
    return datetime.now(_TZ).isoformat(timespec="seconds")


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(_DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS trm_anclas (
            sku TEXT PRIMARY KEY,
            nombre TEXT,
            precio_base REAL NOT NULL,
            trm_base REAL NOT NULL,
            origen TEXT,
            actualizado_en TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trm_ajustes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lote TEXT NOT NULL,
            sku TEXT NOT NULL,
            nombre TEXT,
            meli_id TEXT,
            meli_estado TEXT,
            precio_anterior REAL NOT NULL,
            precio_nuevo REAL NOT NULL,
            trm_base REAL NOT NULL,
            trm_actual REAL NOT NULL,
            variacion_trm_pct REAL NOT NULL,
            ajuste_pct REAL NOT NULL,
            estado TEXT NOT NULL DEFAULT 'propuesto',
            detalle TEXT,
            creado_en TEXT NOT NULL,
            resuelto_en TEXT,
            resuelto_por TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_trm_ajustes_estado ON trm_ajustes(estado);
        """
    )
    return con


# ─── Configuración ────────────────────────────────────────────────────────────

def obtener_config() -> dict:
    cfg = dict(CONFIG_DEFAULT)
    try:
        raw = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            cfg.update({k: raw[k] for k in CONFIG_DEFAULT if k in raw})
    except FileNotFoundError:
        pass
    except Exception as e:
        log.warning("precios_trm: config ilegible, se usan los valores por defecto: %s", e)
    return cfg


def guardar_config(cambios: dict) -> dict:
    cfg = obtener_config()
    if "traslado_pct" in cambios:
        v = float(cambios["traslado_pct"])
        if not 0 <= v <= 150:
            raise ValueError("El traslado debe estar entre 0 % y 150 %")
        cfg["traslado_pct"] = v
    if "umbral_pct" in cambios:
        v = float(cambios["umbral_pct"])
        if not 0 <= v <= 20:
            raise ValueError("El umbral debe estar entre 0 % y 20 %")
        cfg["umbral_pct"] = v
    if "redondeo" in cambios:
        v = int(cambios["redondeo"])
        if v not in (1, 10, 50, 100, 500, 1000):
            raise ValueError("El redondeo debe ser 1, 10, 50, 100, 500 o 1000")
        cfg["redondeo"] = v
    if "conservar_900" in cambios:
        cfg["conservar_900"] = bool(cambios["conservar_900"])
    if "trm_base_inicial" in cambios:
        v = cambios["trm_base_inicial"]
        if v in (None, ""):
            cfg["trm_base_inicial"] = None
        else:
            v = float(v)
            if not 1000 <= v <= 10000:
                raise ValueError("La TRM de referencia debe estar entre 1.000 y 10.000")
            cfg["trm_base_inicial"] = v
    _CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return cfg


# ─── Cálculo ──────────────────────────────────────────────────────────────────

def calcular_ajuste(
    precio_base: float,
    trm_base: float,
    trm_actual: float,
    *,
    traslado_pct: float,
    umbral_pct: float,
    redondeo: int,
    conservar_900: bool = False,
) -> dict | None:
    """Propuesta para un SKU, o None si la TRM no se movió lo suficiente."""
    if precio_base <= 0 or trm_base <= 0 or trm_actual <= 0:
        return None
    variacion = trm_actual / trm_base - 1
    if abs(variacion) * 100 < umbral_pct:
        return None
    ajuste = variacion * traslado_pct / 100
    bruto = precio_base * (1 + ajuste)
    if conservar_900 and int(precio_base) % 1000 == 900:
        # 11.900 × 1,03 = 12.257 → 11.900 o 12.900, el más cercano.
        nuevo = max(900, int(round((bruto + 100) / 1000)) * 1000 - 100)
    else:
        paso = max(1, int(redondeo))
        nuevo = int(round(bruto / paso)) * paso
    if nuevo <= 0 or abs(nuevo - precio_base) < _TOLERANCIA_PRECIO:
        return None
    return {
        "precio_nuevo": float(nuevo),
        "variacion_trm_pct": round(variacion * 100, 3),
        "ajuste_pct": round(ajuste * 100, 3),
    }


def _trm_hoy() -> dict:
    from app.services.trm import obtener_trm

    data = obtener_trm(None)
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data


def _catalogo() -> tuple[dict[str, dict], str | None]:
    from app.services.precios_canales import mapa_precios_meli_por_sku

    mapa, actualizado_en = mapa_precios_meli_por_sku()
    try:
        from app.services.precios_canales import _COBROS_MELI_CACHE_PATH

        raw = json.loads(_COBROS_MELI_CACHE_PATH.read_text(encoding="utf-8"))
        nombres = {
            (c.get("sku") or "").strip().upper(): (c.get("nombre") or "").strip()
            for c in raw.get("items") or []
            if isinstance(c, dict)
        }
    except Exception:
        nombres = {}
    for key, info in mapa.items():
        info["nombre"] = nombres.get(key) or info["sku"]
    return mapa, actualizado_en


def proponer() -> dict:
    """Recalcula la propuesta del día. Reemplaza la anterior que nadie resolvió."""
    cfg = obtener_config()
    trm = _trm_hoy()
    trm_actual = float(trm["valor"])
    trm_inicial = float(cfg["trm_base_inicial"] or trm_actual)
    catalogo, cache_en = _catalogo()
    if not catalogo:
        return {"ok": False, "error": "No hay precios de MeLi en caché; abre Ganancia para recargarlos."}

    ahora = _ahora()
    lote = datetime.now(_TZ).strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    propuestas: list[dict] = []
    anclas_nuevas = 0
    reancladas = 0

    with _conn() as con:
        anclas = {r["sku"]: r for r in con.execute("SELECT * FROM trm_anclas")}
        for key, info in catalogo.items():
            precio = float(info["precio_meli"])
            if precio <= 0:
                continue
            ancla = anclas.get(key)
            if ancla is None:
                con.execute(
                    "INSERT INTO trm_anclas VALUES (?,?,?,?,?,?)",
                    (key, info["nombre"], precio, trm_inicial, "inicial", ahora),
                )
                anclas_nuevas += 1
                precio_base, trm_base = precio, trm_inicial
            elif abs(float(ancla["precio_base"]) - precio) > _TOLERANCIA_PRECIO:
                con.execute(
                    "UPDATE trm_anclas SET precio_base=?, trm_base=?, origen='cambio_manual', "
                    "nombre=?, actualizado_en=? WHERE sku=?",
                    (precio, trm_actual, info["nombre"], ahora, key),
                )
                reancladas += 1
                continue
            else:
                precio_base, trm_base = float(ancla["precio_base"]), float(ancla["trm_base"])

            if abs(trm_actual / trm_base - 1) > VARIACION_MAXIMA_CREIBLE:
                raise RuntimeError(
                    f"La TRM de hoy ({trm_actual:,.2f}) está a más de "
                    f"{VARIACION_MAXIMA_CREIBLE:.0%} de la base ({trm_base:,.2f}) en {info['sku']}; "
                    "no se propone nada hasta revisar el dato."
                )
            calc = calcular_ajuste(
                precio_base, trm_base, trm_actual,
                traslado_pct=float(cfg["traslado_pct"]),
                umbral_pct=float(cfg["umbral_pct"]),
                redondeo=int(cfg["redondeo"]),
                conservar_900=bool(cfg["conservar_900"]),
            )
            if calc:
                propuestas.append({
                    "sku": info["sku"],
                    "nombre": info["nombre"],
                    "meli_id": info.get("meli_id"),
                    "meli_estado": info.get("meli_estado"),
                    "precio_anterior": precio_base,
                    "trm_base": trm_base,
                    **calc,
                })

        con.execute(
            "UPDATE trm_ajustes SET estado='reemplazado', resuelto_en=? WHERE estado='propuesto'",
            (ahora,),
        )
        for p in propuestas:
            con.execute(
                "INSERT INTO trm_ajustes (lote, sku, nombre, meli_id, meli_estado, precio_anterior, "
                "precio_nuevo, trm_base, trm_actual, variacion_trm_pct, ajuste_pct, creado_en) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (lote, p["sku"], p["nombre"], p["meli_id"], p["meli_estado"], p["precio_anterior"],
                 p["precio_nuevo"], p["trm_base"], trm_actual, p["variacion_trm_pct"],
                 p["ajuste_pct"], ahora),
            )

    return {
        "ok": True,
        "lote": lote,
        "trm_actual": trm_actual,
        "trm_vigencia": trm.get("vigencia_desde") or trm.get("fecha"),
        "catalogo": len(catalogo),
        "cache_meli_en": cache_en,
        "propuestas": len(propuestas),
        "anclas_nuevas": anclas_nuevas,
        "reancladas": reancladas,
        "suben": sum(1 for p in propuestas if p["precio_nuevo"] > p["precio_anterior"]),
        "bajan": sum(1 for p in propuestas if p["precio_nuevo"] < p["precio_anterior"]),
    }


# ─── Consulta ─────────────────────────────────────────────────────────────────

def estado() -> dict:
    cfg = obtener_config()
    try:
        trm = _trm_hoy()
        trm_info = {"valor": float(trm["valor"]), "vigencia": trm.get("vigencia_desde") or trm.get("fecha")}
    except Exception as e:
        trm_info = {"error": str(e)}
    with _conn() as con:
        # Un reinicio de Flask a mitad de lote deja filas en 'aplicando' para
        # siempre; después de 30 min se dan por interrumpidas (no se sabe si
        # MeLi alcanzó a cambiar, por eso error y no de vuelta a propuesto).
        limite = (datetime.now(_TZ) - timedelta(minutes=30)).isoformat(timespec="seconds")
        con.execute(
            "UPDATE trm_ajustes SET estado='error', detalle='Aplicación interrumpida; revisa el precio en MeLi' "
            "WHERE estado='aplicando' AND resuelto_en < ?",
            (limite,),
        )
        pendientes = [dict(r) for r in con.execute(
            "SELECT * FROM trm_ajustes WHERE estado IN ('propuesto','aplicando') "
            "ORDER BY ABS(ajuste_pct) DESC, nombre"
        )]
        historial = [dict(r) for r in con.execute(
            "SELECT * FROM trm_ajustes WHERE estado NOT IN ('propuesto','aplicando','reemplazado') "
            "ORDER BY COALESCE(resuelto_en, creado_en) DESC, id DESC LIMIT 100"
        )]
        n_anclas, trm_prom = con.execute(
            "SELECT COUNT(*), AVG(trm_base) FROM trm_anclas"
        ).fetchone()
    return {
        "config": cfg,
        "trm": trm_info,
        "pendientes": pendientes,
        "historial": historial,
        "anclas": {"total": n_anclas, "trm_base_promedio": round(trm_prom, 2) if trm_prom else None},
        "activo": _cron_activo(),
    }


def _cron_activo() -> bool:
    return (os.getenv("PRECIOS_TRM_ACTIVO", "1") or "1").strip() != "0"


# ─── Resolver propuestas ──────────────────────────────────────────────────────

def descartar(ids: list[int], usuario: str) -> int:
    if not ids:
        return 0
    marcas = ",".join("?" * len(ids))
    with _conn() as con:
        cur = con.execute(
            f"UPDATE trm_ajustes SET estado='descartado', resuelto_en=?, resuelto_por=? "
            f"WHERE estado='propuesto' AND id IN ({marcas})",
            (_ahora(), usuario, *ids),
        )
        return cur.rowcount


def _aplicar_en_canales(sku: str, precio: float, meli_id: str | None) -> tuple[bool, str]:
    from app.services.alegra import actualizar_precio_alegra_producto
    from app.services.meli import actualizar_precio_meli_por_sku

    meli = actualizar_precio_meli_por_sku(sku, precio, meli_id=meli_id or None)
    if not meli.get("ok"):
        return False, f"MeLi: {meli.get('msg') or 'falló'}"
    try:
        from app.services.rentabilidad import parchear_precio_en_cobros_cache
        parchear_precio_en_cobros_cache(sku, precio)
    except Exception:
        pass
    alegra = actualizar_precio_alegra_producto(sku, precio)
    if not alegra.get("ok"):
        # MeLi ya quedó con el precio nuevo; el cron reconciliar_precios_meli
        # iguala Alegra en su próxima corrida. Se deja dicho, no se revierte.
        return True, f"MeLi OK · Alegra falló ({alegra.get('msg') or 'sin detalle'}); lo corrige el cron de reconciliación"
    return True, "MeLi y Alegra actualizados"


def aplicar(ids: list[int], usuario: str) -> dict:
    """Marca las propuestas como 'aplicando' y las escribe en segundo plano."""
    if not ids:
        return {"ok": False, "error": "No hay propuestas seleccionadas"}
    marcas = ",".join("?" * len(ids))
    with _conn() as con:
        filas = [dict(r) for r in con.execute(
            f"SELECT * FROM trm_ajustes WHERE estado='propuesto' AND id IN ({marcas})", ids
        )]
        con.execute(
            f"UPDATE trm_ajustes SET estado='aplicando', resuelto_por=?, resuelto_en=? "
            f"WHERE estado='propuesto' AND id IN ({marcas})",
            (usuario, _ahora(), *ids),
        )
    if not filas:
        return {"ok": False, "error": "Esas propuestas ya no están pendientes"}

    from app.observability import spawn_thread

    spawn_thread(lambda: _aplicar_lote(filas), "precios_trm_aplicar")
    return {"ok": True, "en_proceso": len(filas)}


def _aplicar_lote(filas: list[dict]) -> None:
    with _lock_aplicar:
        catalogo, _ = _catalogo()
        web: list[dict] = []
        for f in filas:
            key = f["sku"].upper()
            actual = (catalogo.get(key) or {}).get("precio_meli")
            if actual is not None and abs(float(actual) - float(f["precio_anterior"])) > _TOLERANCIA_PRECIO:
                estado, ok, msg = "desactualizado", False, (
                    f"El precio en MeLi cambió a ${float(actual):,.0f} después de la propuesta; no se tocó"
                )
            else:
                try:
                    ok, msg = _aplicar_en_canales(f["sku"], float(f["precio_nuevo"]), f.get("meli_id"))
                except Exception as e:
                    log.exception("precios_trm: error aplicando %s", f["sku"])
                    ok, msg = False, str(e)
                estado = "aplicado" if ok else "error"
            ahora = _ahora()
            with _conn() as con:
                con.execute(
                    "UPDATE trm_ajustes SET estado=?, detalle=?, resuelto_en=? WHERE id=?",
                    (estado, msg, ahora, f["id"]),
                )
                if ok:
                    con.execute(
                        "INSERT INTO trm_anclas VALUES (?,?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET "
                        "precio_base=excluded.precio_base, trm_base=excluded.trm_base, "
                        "origen=excluded.origen, nombre=excluded.nombre, actualizado_en=excluded.actualizado_en",
                        (key, f["nombre"], float(f["precio_nuevo"]), float(f["trm_actual"]), "ajuste_trm", ahora),
                    )
            if ok:
                web.append({"sku": f["sku"], "precio": float(f["precio_nuevo"])})

        if web:
            try:
                from app.tools.sincronizar_productos_pagina_web import sincronizar_productos_pagina_web
                sincronizar_productos_pagina_web(web)
            except Exception:
                log.exception("precios_trm: no se pudo regenerar el catálogo web")
