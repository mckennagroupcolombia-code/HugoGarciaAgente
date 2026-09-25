# -*- coding: utf-8 -*-
"""Recepción de mercancía — lo que llega a bodega, registrado en el panel.

Hasta sep-2026 la llegada de mercancía se avisaba en grupos de WhatsApp con fotos y
cantidades sueltas: nada quedaba registrado ni se cruzaba con lo pedido. Aquí cada
llegada es una recepción:

    abierta → (se cuentan los productos y se toman fotos) → cerrada
                                                          ├─ verificada        (todo cuadra)
                                                          └─ con_diferencias   (faltó / sobró / dañado)

Lo esperado se precarga desde la **solicitud de pago de la compra** (pagos_wizard,
categoría compra_proveedor: renglones con SKU, cantidad y unidad) cuando existe; si no,
se registra a mano. **No escribe inventario ni contabilidad**: registrar el lote de
materia prima (FT/COA) sigue siendo de `lotes_materia_prima` — el panel solo lleva ahí.

Al abrir y al cerrar avisa en el canal interno «Inventario» (que, si está enlazado a su
grupo de WhatsApp con ida y vuelta, también llega allá). Cada acción cuenta como
actividad (`registrar_evento_panel`). Sin LLM.

Base propia: app/data/recepciones.db (gitignored), fotos en app/data/recepcion_uploads/.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time
from typing import Any

_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DB_PATH = os.path.join(_DIR, "recepciones.db")
UPLOADS_DIR = os.path.join(_DIR, "recepcion_uploads")
CANAL_CLAVE = "inventario"

ESTADOS = ("abierta", "verificada", "con_diferencias", "anulada")
_lock = threading.Lock()
_listo: dict[str, bool] = {}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS recepciones (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor              TEXT NOT NULL DEFAULT '',
    referencia             TEXT DEFAULT '',
    origen                 TEXT NOT NULL DEFAULT 'manual',
    solicitud_pago_id      INTEGER,
    estado                 TEXT NOT NULL DEFAULT 'abierta',
    notas                  TEXT DEFAULT '',
    recibido_por           INTEGER,
    recibido_por_nombre    TEXT DEFAULT '',
    cerrado_por            INTEGER,
    creada_en              REAL NOT NULL,
    cerrada_en             REAL
);
CREATE TABLE IF NOT EXISTS recepcion_items (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    recepcion_id       INTEGER NOT NULL,
    sku                TEXT DEFAULT '',
    descripcion        TEXT NOT NULL,
    unidad             TEXT DEFAULT '',
    cantidad_esperada  REAL,
    cantidad_recibida  REAL,
    estado_item        TEXT NOT NULL DEFAULT 'pendiente',
    observacion        TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_recepcion_items ON recepcion_items(recepcion_id);
CREATE TABLE IF NOT EXISTS recepcion_fotos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    recepcion_id  INTEGER NOT NULL,
    archivo       TEXT NOT NULL,
    nombre        TEXT DEFAULT '',
    usuario_id    INTEGER,
    subida_en     REAL NOT NULL
);
"""

# estado_item: pendiente · ok · faltante · sobrante · danado


def _conn() -> sqlite3.Connection:
    ruta = DB_PATH
    os.makedirs(os.path.dirname(os.path.abspath(ruta)), exist_ok=True)
    c = sqlite3.connect(ruta, timeout=15)
    c.row_factory = sqlite3.Row
    if not _listo.get(ruta):
        with _lock:
            if not _listo.get(ruta):
                c.executescript(_SCHEMA)
                c.commit()
                _listo[ruta] = True
    return c


def _actividad(usuario: dict | None, tipo: str, detalle: dict) -> None:
    if not usuario:
        return
    try:
        from app.services.panel_presencia import registrar_evento_panel

        registrar_evento_panel(int(usuario["id"]), tipo, panel="recepcion-mercancia", detalle=detalle)
    except Exception:
        pass


def _avisar_canal(texto: str, ref: dict) -> None:
    try:
        from app.services import canales_internos as CI

        cid = CI.asegurar_canal(CANAL_CLAVE, "Inventario", "Llegadas de mercancía, conteos y novedades de bodega")
        CI.enviar_mensaje(cid, None, texto, tipo="sistema", ref=ref)
    except Exception as e:
        print(f"[recepcion] aviso al canal: {e}")


def _nombre(usuario: dict | None) -> str:
    return str((usuario or {}).get("nombre") or (usuario or {}).get("username") or "")


# ── Lo esperado ──────────────────────────────────────────────────────────────

def compras_por_recibir(limite: int = 30) -> list[dict]:
    """Solicitudes de pago de compras (con renglones) que aún no tienen recepción."""
    try:
        from app.services import pagos_wizard
    except Exception:
        return []
    with _conn() as c:
        ya = {int(r[0]) for r in c.execute(
            "SELECT solicitud_pago_id FROM recepciones WHERE solicitud_pago_id IS NOT NULL AND estado!='anulada'")}
    out = []
    for s in pagos_wizard.listar(limit=200):
        if s.get("categoria") != "compra_proveedor" or s.get("es_plantilla") or s.get("estado") == "rechazada":
            continue
        if int(s["id"]) in ya:
            continue
        out.append({
            "id": s["id"],
            "concepto": s.get("concepto") or "",
            "fecha": s.get("fecha") or "",
            "estado": s.get("estado") or "",
            "factura_numero": s.get("factura_numero") or "",
            "monto": s.get("monto") or 0,
        })
        if len(out) >= limite:
            break
    return out


def _items_de_solicitud(sid: int) -> tuple[str, str, list[dict]]:
    from app.services import pagos_wizard

    s = pagos_wizard.obtener(int(sid))
    if not s:
        raise LookupError("Solicitud de pago no encontrada")
    proveedor = str((s.get("tercero") or {}).get("nombre") or s.get("concepto") or "").split(" — ")[0]
    ref = s.get("factura_numero") or s.get("referencia") or f"solicitud #{sid}"
    items = [
        {
            "sku": str(it.get("sku") or ""),
            "descripcion": str(it.get("nombre") or it.get("sku") or "Producto"),
            "unidad": str(it.get("unidad") or ""),
            "cantidad_esperada": float(it.get("cantidad") or 0) or None,
        }
        for it in (s.get("items") or [])
    ]
    return proveedor, ref, items


# ── Recepciones ──────────────────────────────────────────────────────────────

def crear(usuario: dict | None, *, proveedor: str = "", referencia: str = "", notas: str = "",
          solicitud_pago_id: int | None = None, items: list[dict] | None = None) -> dict:
    origen = "manual"
    if solicitud_pago_id:
        prov_s, ref_s, items_s = _items_de_solicitud(int(solicitud_pago_id))
        proveedor = proveedor or prov_s
        referencia = referencia or ref_s
        items = items_s + list(items or [])
        origen = "solicitud_pago"
    proveedor = (proveedor or "").strip()[:160]
    if not proveedor:
        raise ValueError("Falta el proveedor (o elegir la compra)")
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO recepciones (proveedor, referencia, origen, solicitud_pago_id, notas, recibido_por, "
            "recibido_por_nombre, creada_en) VALUES (?,?,?,?,?,?,?,?)",
            (proveedor, (referencia or "").strip()[:120], origen, solicitud_pago_id, (notas or "").strip()[:2000],
             (usuario or {}).get("id"), _nombre(usuario), time.time()),
        )
        rid = int(cur.lastrowid)
        for it in items or []:
            _insertar_item(c, rid, it)
    _actividad(usuario, "recepcion_abierta", {"recepcion_id": rid})
    _avisar_canal(
        f"📦 Llegó mercancía de {proveedor}" + (f" ({referencia})" if referencia else "")
        + f". Recibe: {_nombre(usuario) or 'sin nombre'}. Recepción #{rid} abierta para contar.",
        {"recepcion_id": rid},
    )
    return obtener(rid)  # type: ignore[return-value]


def _insertar_item(c: sqlite3.Connection, rid: int, it: dict) -> int:
    desc = str(it.get("descripcion") or it.get("nombre") or it.get("sku") or "").strip()[:200]
    if not desc:
        raise ValueError("Cada producto necesita una descripción o SKU")
    cur = c.execute(
        "INSERT INTO recepcion_items (recepcion_id, sku, descripcion, unidad, cantidad_esperada, cantidad_recibida) "
        "VALUES (?,?,?,?,?,?)",
        (rid, str(it.get("sku") or "").strip()[:60], desc, str(it.get("unidad") or "").strip()[:12],
         _num(it.get("cantidad_esperada")), _num(it.get("cantidad_recibida"))),
    )
    return int(cur.lastrowid)


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _abierta(c: sqlite3.Connection, rid: int) -> sqlite3.Row:
    r = c.execute("SELECT * FROM recepciones WHERE id=?", (rid,)).fetchone()
    if not r:
        raise LookupError("Recepción no encontrada")
    if r["estado"] != "abierta":
        raise ValueError("La recepción ya está cerrada")
    return r


def agregar_item(rid: int, usuario: dict | None, item: dict) -> dict:
    with _conn() as c:
        _abierta(c, rid)
        _insertar_item(c, rid, item)
    _actividad(usuario, "recepcion_item", {"recepcion_id": rid})
    return obtener(rid)  # type: ignore[return-value]


def contar_item(rid: int, item_id: int, usuario: dict | None, *, cantidad_recibida: Any = None,
                estado_item: str | None = None, observacion: str | None = None) -> dict:
    """Anota lo contado. El estado se deduce de esperado vs. recibido salvo que se marque «dañado»."""
    with _conn() as c:
        _abierta(c, rid)
        it = c.execute("SELECT * FROM recepcion_items WHERE id=? AND recepcion_id=?", (item_id, rid)).fetchone()
        if not it:
            raise LookupError("Producto no encontrado en esta recepción")
        rec = _num(cantidad_recibida) if cantidad_recibida is not None else it["cantidad_recibida"]
        est = estado_item
        if est not in ("danado",):
            esp = it["cantidad_esperada"]
            if rec is None:
                est = "pendiente"
            elif esp is None or abs(rec - esp) < 1e-9:
                est = "ok"
            else:
                est = "faltante" if rec < esp else "sobrante"
        c.execute(
            "UPDATE recepcion_items SET cantidad_recibida=?, estado_item=?, observacion=COALESCE(?, observacion) WHERE id=?",
            (rec, est, (observacion or "").strip()[:500] if observacion is not None else None, item_id),
        )
    _actividad(usuario, "recepcion_conteo", {"recepcion_id": rid, "item_id": item_id})
    return obtener(rid)  # type: ignore[return-value]


def agregar_foto(rid: int, usuario: dict | None, archivo: str, nombre: str = "") -> dict:
    with _conn() as c:
        if not c.execute("SELECT 1 FROM recepciones WHERE id=?", (rid,)).fetchone():
            raise LookupError("Recepción no encontrada")
        c.execute("INSERT INTO recepcion_fotos (recepcion_id, archivo, nombre, usuario_id, subida_en) VALUES (?,?,?,?,?)",
                  (rid, archivo, nombre[:160], (usuario or {}).get("id"), time.time()))
    _actividad(usuario, "recepcion_foto", {"recepcion_id": rid})
    return obtener(rid)  # type: ignore[return-value]


def cerrar(rid: int, usuario: dict | None, notas: str = "") -> dict:
    with _conn() as c:
        r = _abierta(c, rid)
        items = c.execute("SELECT * FROM recepcion_items WHERE recepcion_id=?", (rid,)).fetchall()
        if not items:
            raise ValueError("Registra al menos un producto antes de cerrar")
        sin_contar = [i for i in items if i["cantidad_recibida"] is None and i["estado_item"] != "danado"]
        if sin_contar:
            raise ValueError(f"Faltan por contar {len(sin_contar)} producto(s)")
        difs = [i for i in items if i["estado_item"] in ("faltante", "sobrante", "danado")]
        estado = "con_diferencias" if difs else "verificada"
        c.execute(
            "UPDATE recepciones SET estado=?, cerrado_por=?, cerrada_en=?, "
            "notas=CASE WHEN ?='' THEN notas ELSE TRIM(notas || char(10) || ?) END WHERE id=?",
            (estado, (usuario or {}).get("id"), time.time(), notas.strip(), notas.strip(), rid),
        )
        proveedor = r["proveedor"]
    _actividad(usuario, "recepcion_cerrada", {"recepcion_id": rid, "estado": estado})
    if difs:
        lineas = []
        for i in difs[:8]:
            if i["estado_item"] == "danado":
                lineas.append(f"• {i['descripcion']}: dañado")
            else:
                lineas.append(f"• {i['descripcion']}: esperado {_fmt(i['cantidad_esperada'])}, llegó {_fmt(i['cantidad_recibida'])} {i['unidad'] or ''}".rstrip())
        texto = f"⚠️ Recepción #{rid} de {proveedor} cerrada CON DIFERENCIAS por {_nombre(usuario) or 'alguien'}:\n" + "\n".join(lineas)
    else:
        texto = f"✅ Recepción #{rid} de {proveedor} verificada por {_nombre(usuario) or 'alguien'}: todo llegó completo."
    _avisar_canal(texto, {"recepcion_id": rid})
    return obtener(rid)  # type: ignore[return-value]


def _fmt(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{v:,.0f}".replace(",", ".") if float(v).is_integer() else f"{v:,.2f}"


def anular(rid: int, usuario: dict | None, motivo: str = "") -> dict:
    with _conn() as c:
        _abierta(c, rid)
        c.execute("UPDATE recepciones SET estado='anulada', cerrado_por=?, cerrada_en=?, notas=TRIM(notas || char(10) || ?) WHERE id=?",
                  ((usuario or {}).get("id"), time.time(), f"Anulada: {motivo}".strip(), rid))
    _actividad(usuario, "recepcion_anulada", {"recepcion_id": rid})
    return obtener(rid)  # type: ignore[return-value]


def obtener(rid: int) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM recepciones WHERE id=?", (rid,)).fetchone()
        if not r:
            return None
        items = [dict(i) for i in c.execute("SELECT * FROM recepcion_items WHERE recepcion_id=? ORDER BY id", (rid,))]
        fotos = [dict(f) for f in c.execute("SELECT * FROM recepcion_fotos WHERE recepcion_id=? ORDER BY id", (rid,))]
    d = dict(r)
    d["items"] = items
    d["fotos"] = fotos
    d["resumen"] = {
        "total": len(items),
        "contados": sum(1 for i in items if i["cantidad_recibida"] is not None or i["estado_item"] == "danado"),
        "diferencias": sum(1 for i in items if i["estado_item"] in ("faltante", "sobrante", "danado")),
    }
    return d


def listar(estado: str | None = None, limite: int = 60) -> list[dict]:
    with _conn() as c:
        q = "SELECT * FROM recepciones" + (" WHERE estado=?" if estado else "") + " ORDER BY id DESC LIMIT ?"
        filas = c.execute(q, (estado, limite) if estado else (limite,)).fetchall()
        out = []
        for r in filas:
            n = c.execute(
                "SELECT COUNT(*), SUM(CASE WHEN estado_item IN ('faltante','sobrante','danado') THEN 1 ELSE 0 END), "
                "SUM(CASE WHEN cantidad_recibida IS NOT NULL OR estado_item='danado' THEN 1 ELSE 0 END) "
                "FROM recepcion_items WHERE recepcion_id=?", (r["id"],)).fetchone()
            nf = c.execute("SELECT COUNT(*) FROM recepcion_fotos WHERE recepcion_id=?", (r["id"],)).fetchone()[0]
            d = dict(r)
            d["resumen"] = {"total": int(n[0] or 0), "diferencias": int(n[1] or 0), "contados": int(n[2] or 0), "fotos": int(nf)}
            out.append(d)
    return out
