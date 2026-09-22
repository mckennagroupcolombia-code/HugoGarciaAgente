"""Historial persistente de ventas para el panel Facturación → Ventas.

`facturacion_ventas_unificado.listar_ventas_meli_unificado()` reconstruye cada
fila consultando MeLi en vivo: hasta 3 llamadas HTTP por venta. Eso obliga a un
tope bajo de filas (150) y a un caché en memoria de 60s que además se pierde en
cada reinicio, así que el operador nunca ve un histórico largo.

Acá se persiste cada fila ya reconstruida. El panel puede entonces listar miles
de ventas al instante desde SQLite, y refrescar contra MeLi solo la venta puntual
que el operador quiera corroborar (`refrescar_venta`), en vez de recargar todo.

El estado guardado es una FOTO del momento en que se resolvió: `actualizado_en`
dice de cuándo es. Una venta en tránsito hace tres días puede estar entregada
hoy — por eso el panel muestra la antigüedad del dato y ofrece el refresco
individual, en vez de fingir que el histórico está siempre al día.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta
from typing import Any

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "facturacion_ventas_cache.db")
_LOCK = threading.Lock()


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    with _LOCK, _conn() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS ventas_cache (
                order_id        TEXT PRIMARY KEY,
                pack_id         TEXT,
                fecha           TEXT,
                es_meli         INTEGER DEFAULT 1,
                es_cancelada    INTEGER DEFAULT 0,
                estado          TEXT,
                total           REAL,
                cliente_nombre  TEXT,
                cliente_ident   TEXT,
                factura_numero  TEXT,
                parcial         INTEGER DEFAULT 0,
                payload         TEXT NOT NULL,
                actualizado_en  TEXT NOT NULL
            )
            """
        )
        con.execute("CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas_cache(fecha DESC)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas_cache(estado)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_ventas_pack ON ventas_cache(pack_id)")
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS listados_snapshot (
                clave       TEXT PRIMARY KEY,
                generado_ts REAL NOT NULL,
                payload     TEXT NOT NULL
            )
            """
        )


def guardar_listado(clave: str, resultado: dict, generado_ts: float) -> None:
    """Último listado completo de una vista (días/segmento/límite), para que el
    panel tenga algo que mostrar tras un reinicio mientras se recalcula."""
    init_db()
    with _LOCK, _conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO listados_snapshot (clave, generado_ts, payload) VALUES (?, ?, ?)",
            (clave, generado_ts, json.dumps(resultado, ensure_ascii=False, default=str)),
        )


def leer_listado(clave: str) -> tuple[float, dict] | None:
    init_db()
    with _conn() as con:
        row = con.execute(
            "SELECT generado_ts, payload FROM listados_snapshot WHERE clave = ?", (clave,),
        ).fetchone()
    if not row:
        return None
    try:
        return float(row["generado_ts"]), json.loads(row["payload"])
    except (TypeError, ValueError):
        return None


def _fila_a_columnas(fila: dict) -> tuple:
    facturas = fila.get("facturas") or []
    cliente = fila.get("cliente") or {}
    return (
        str(fila.get("order_id") or ""),
        str(fila.get("pack_id") or ""),
        fila.get("fecha"),
        1 if fila.get("es_meli") else 0,
        1 if fila.get("es_cancelada") else 0,
        fila.get("estado_facturacion"),
        fila.get("total"),
        cliente.get("nombre"),
        cliente.get("identificacion"),
        ", ".join(str(f.get("numero")) for f in facturas if f.get("numero")) or None,
        1 if fila.get("facturacion_parcial") else 0,
        json.dumps(fila, ensure_ascii=False, default=str),
        datetime.now().isoformat(timespec="seconds"),
    )


def guardar_ventas(filas: list[dict]) -> int:
    """Upsert de las filas ya reconstruidas. Se llama después de cada listado en
    vivo, así el histórico se va llenando solo con el uso normal del panel."""
    if not filas:
        return 0
    init_db()
    datos = [_fila_a_columnas(f) for f in filas if f.get("order_id")]
    if not datos:
        return 0
    # Una fila del panel representa la VENTA completa (pack): las demás órdenes
    # del mismo carrito ya no tienen fila propia. Si quedaron guardadas de
    # cuando se listaba orden por orden, se retiran para no duplicar la venta
    # en el histórico.
    a_borrar: list[tuple] = []
    for f in filas:
        anchor = str(f.get("order_id") or "")
        for oid in f.get("ordenes_ids") or []:
            if str(oid) != anchor:
                a_borrar.append((str(oid),))
    with _LOCK, _conn() as con:
        con.executemany(
            """
            INSERT INTO ventas_cache (order_id, pack_id, fecha, es_meli, es_cancelada, estado, total,
                                      cliente_nombre, cliente_ident, factura_numero, parcial, payload, actualizado_en)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(order_id) DO UPDATE SET
                pack_id=excluded.pack_id, fecha=excluded.fecha, es_meli=excluded.es_meli,
                es_cancelada=excluded.es_cancelada, estado=excluded.estado, total=excluded.total,
                cliente_nombre=excluded.cliente_nombre, cliente_ident=excluded.cliente_ident,
                factura_numero=excluded.factura_numero, parcial=excluded.parcial,
                payload=excluded.payload, actualizado_en=excluded.actualizado_en
            """,
            datos,
        )
        if a_borrar:
            con.executemany("DELETE FROM ventas_cache WHERE order_id = ?", a_borrar)
    return len(datos)


def listar_historial(
    *, segmento: str = "concretadas", estado: str | None = None, q: str | None = None,
    limite: int = 500, offset: int = 0,
) -> dict[str, Any]:
    """Histórico desde SQLite, sin tocar MeLi ni Alegra. Sin tope de 150: acá
    listar 2.000 filas cuesta milisegundos porque ya están reconstruidas."""
    init_db()
    where, params = ["1=1"], []
    if segmento == "concretadas":
        where.append("es_cancelada = 0")
    elif segmento == "canceladas":
        where.append("es_cancelada = 1")
    if estado:
        where.append("estado = ?")
        params.append(estado)
    if q:
        where.append(
            "(order_id LIKE ? OR pack_id LIKE ? OR cliente_nombre LIKE ? OR cliente_ident LIKE ? OR factura_numero LIKE ?)"
        )
        params.extend([f"%{q}%"] * 5)
    limite = max(1, min(int(limite or 500), 5000))
    clausula = " AND ".join(where)
    with _LOCK, _conn() as con:
        total = con.execute(f"SELECT COUNT(*) FROM ventas_cache WHERE {clausula}", params).fetchone()[0]
        filas = con.execute(
            f"SELECT payload, actualizado_en FROM ventas_cache WHERE {clausula} "
            f"ORDER BY fecha DESC LIMIT ? OFFSET ?",
            [*params, limite, max(0, int(offset or 0))],
        ).fetchall()
    ventas = []
    for r in filas:
        try:
            v = json.loads(r["payload"])
        except (json.JSONDecodeError, TypeError):
            continue
        v["cache_actualizado_en"] = r["actualizado_en"]
        v["desde_cache"] = True
        ventas.append(v)
    return {"ventas": ventas, "total": len(ventas), "total_en_rango": total, "origen": "cache"}


def obtener_venta(order_id: str) -> dict | None:
    init_db()
    with _LOCK, _conn() as con:
        r = con.execute(
            "SELECT payload, actualizado_en FROM ventas_cache WHERE order_id = ?", (str(order_id),)
        ).fetchone()
    if not r:
        return None
    try:
        v = json.loads(r["payload"])
    except (json.JSONDecodeError, TypeError):
        return None
    v["cache_actualizado_en"] = r["actualizado_en"]
    return v


def estadisticas() -> dict:
    init_db()
    with _LOCK, _conn() as con:
        total = con.execute("SELECT COUNT(*) FROM ventas_cache").fetchone()[0]
        por_estado = {
            r["estado"] or "—": r["n"]
            for r in con.execute("SELECT estado, COUNT(*) n FROM ventas_cache GROUP BY estado")
        }
        rango = con.execute("SELECT MIN(fecha) mn, MAX(fecha) mx FROM ventas_cache").fetchone()
    return {
        "total": total,
        "por_estado": por_estado,
        "desde": rango["mn"] if rango else None,
        "hasta": rango["mx"] if rango else None,
    }


# ── Revisiones por venta ──────────────────────────────────────────────────
# "Revisado" era un paso completado dentro del ticket GLOBAL del día: para
# marcar una sola venta había que crear primero ese ticket. Ahora la decisión
# del operador vive acá, pegada a la venta, y no hace falta ningún ticket.

def _init_revisiones(con: sqlite3.Connection) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS revisiones_venta (
            order_id        TEXT PRIMARY KEY,
            pack_id         TEXT,
            notas           TEXT,
            usuario_id      INTEGER,
            usuario_nombre  TEXT,
            creado_en       TEXT NOT NULL
        )
        """
    )
    cols = {r[1] for r in con.execute("PRAGMA table_info(revisiones_venta)")}
    if "tipo" not in cols:
        con.execute("ALTER TABLE revisiones_venta ADD COLUMN tipo TEXT")


def marcar_revisado(order_id: str, *, pack_id: str = "", notas: str = "",
                    usuario_id: int | None = None, usuario_nombre: str = "", tipo: str | None = None) -> None:
    init_db()
    with _LOCK, _conn() as con:
        _init_revisiones(con)
        con.execute(
            "INSERT OR REPLACE INTO revisiones_venta (order_id, pack_id, notas, usuario_id, usuario_nombre, creado_en, tipo) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(order_id), str(pack_id or ""), (notas or "").strip() or None, usuario_id,
             usuario_nombre or None, datetime.now().isoformat(timespec="seconds"), tipo),
        )


def revisiones_map() -> dict[str, dict]:
    """order_id -> {"notas","usuario_nombre","completado_en"}; también indexado por pack_id."""
    init_db()
    out: dict[str, dict] = {}
    with _LOCK, _conn() as con:
        _init_revisiones(con)
        for r in con.execute("SELECT * FROM revisiones_venta"):
            d = {"notas": r["notas"], "usuario_nombre": r["usuario_nombre"], "completado_en": r["creado_en"],
                 "tipo": r["tipo"]}
            out[r["order_id"]] = d
            if r["pack_id"]:
                out.setdefault(r["pack_id"], d)
    return out


# Estados cuya foto envejece: una venta en tránsito se entrega, una sin
# facturar se factura. Las ya resueltas (facturada_completa, cancelada_resuelta)
# no cambian solas y no vale la pena volver a consultarlas.
ESTADOS_QUE_ENVEJECEN = (
    "sin_facturar",
    "facturada_parcial",
    "facturada_pendiente_subir_meli",
    "cancelada_pendiente_nc",
    "en_transito",
    "en_margen_entrega",
    "cancelada_en_margen",
)
_ACCIONABLES = ("sin_facturar", "facturada_parcial", "facturada_pendiente_subir_meli", "cancelada_pendiente_nc")


def filas_para_revalidar(*, max_filas: int = 60, edad_minima_min: int = 20) -> list[str]:
    """order_id de las filas cuya foto puede estar vieja, primero las que hoy
    piden acción (son las que generan alertas falsas si ya se resolvieron),
    luego las en tránsito / en margen. Incluye también las marcadas como
    posible duplicado o con más de una factura aunque su estado sea
    'facturada_completa' (así aparecen los dobles Alegra↔Alegra)."""
    init_db()
    limite_ts = (datetime.now() - timedelta(minutes=edad_minima_min)).isoformat(timespec="seconds")
    marcas = ",".join("?" * len(ESTADOS_QUE_ENVEJECEN))
    acc = ",".join("?" * len(_ACCIONABLES))
    with _LOCK, _conn() as con:
        rows = con.execute(
            f"""
            SELECT order_id FROM ventas_cache
            WHERE es_meli = 1 AND actualizado_en < ?
              AND (estado IN ({marcas}) OR payload LIKE '%"posible_duplicado": true%'
                   OR factura_numero LIKE '%,%')
            ORDER BY CASE WHEN estado IN ({acc}) OR payload LIKE '%"posible_duplicado": true%'
                               OR factura_numero LIKE '%,%' THEN 0 ELSE 1 END,
                     actualizado_en ASC
            LIMIT ?
            """,
            [limite_ts, *ESTADOS_QUE_ENVEJECEN, *_ACCIONABLES, max(1, int(max_filas))],
        ).fetchall()
    return [r["order_id"] for r in rows]
