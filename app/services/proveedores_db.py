"""
Red de proveedores de McKenna: quién vende qué materia prima, a qué precio y
desde dónde. Base del panel /app → Logística Internacional → Proveedores y de
la sección pública "Cotizar" de mckennagroup.co.

Persistencia: SQLite en app/data/proveedores.db (no versionado, ver .gitignore).
Se alimenta SIN LLM desde fuentes que ya existen en el repo:

  - app/data/facturas_compra_historial.json  (facturas de compra procesadas
    desde Gmail/XML DIAN: proveedor + ítems con precio neto real)
  - Siigo /v1/purchases                        (facturas de compra registradas
    en el ERP; precio histórico por ítem)
  - contabilidad.db → compras_exterior         (compras de socios / exterior con
    costo unitario en COP ya convertido)
  - Gmail: adjuntos de catálogos / listas de precios de proveedores (se
    detectan y parsean heurísticamente XLSX/CSV/PDF; el operador revisa y
    confirma cada línea antes de guardarla)

Lo público (PAGINA_WEB/site/data/oferta_proveedores.json) NUNCA incluye el
nombre del proveedor: el cliente ve la materia prima, la línea, el país de
origen y las presentaciones; McKenna es el puente.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import unicodedata
from datetime import datetime
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_DB_PATH = _REPO / "app" / "data" / "proveedores.db"
_HISTORIAL_FACTURAS = _REPO / "app" / "data" / "facturas_compra_historial.json"
_PROVEEDORES_ESPECIALES = _REPO / "app" / "data" / "proveedores_especiales.json"
OFERTA_WEB_PATH = _REPO / "PAGINA_WEB" / "site" / "data" / "oferta_proveedores.json"

_lock = threading.RLock()

# País de origen por defecto para proveedores según lo que McKenna conoce de
# ellos. Se puede corregir desde el panel; esto solo evita arrancar en blanco.
PAISES_COORDENADAS: dict[str, dict] = {
    "China": {"lat": 35.0, "lon": 105.0, "puerto_entrada": "Buenaventura"},
    "India": {"lat": 21.0, "lon": 78.0, "puerto_entrada": "Cartagena"},
    "Pakistán": {"lat": 30.4, "lon": 69.3, "puerto_entrada": "Cartagena"},
    "Bolivia": {"lat": -16.3, "lon": -63.6, "puerto_entrada": "Terrestre / Aéreo Bogotá"},
    "Argentina": {"lat": -38.4, "lon": -63.6, "puerto_entrada": "Cartagena"},
    "Brasil": {"lat": -14.2, "lon": -51.9, "puerto_entrada": "Cartagena"},
    "Perú": {"lat": -9.2, "lon": -75.0, "puerto_entrada": "Buenaventura"},
    "Chile": {"lat": -35.7, "lon": -71.5, "puerto_entrada": "Buenaventura"},
    "México": {"lat": 23.6, "lon": -102.5, "puerto_entrada": "Cartagena"},
    "Estados Unidos": {"lat": 39.0, "lon": -98.0, "puerto_entrada": "Cartagena"},
    "Alemania": {"lat": 51.0, "lon": 10.0, "puerto_entrada": "Cartagena"},
    "España": {"lat": 40.0, "lon": -3.7, "puerto_entrada": "Cartagena"},
    "Francia": {"lat": 46.2, "lon": 2.2, "puerto_entrada": "Cartagena"},
    "Italia": {"lat": 41.9, "lon": 12.6, "puerto_entrada": "Cartagena"},
    "Países Bajos": {"lat": 52.1, "lon": 5.3, "puerto_entrada": "Cartagena"},
    "Reino Unido": {"lat": 55.4, "lon": -3.4, "puerto_entrada": "Cartagena"},
    "Turquía": {"lat": 38.9, "lon": 35.2, "puerto_entrada": "Cartagena"},
    "Egipto": {"lat": 26.8, "lon": 30.8, "puerto_entrada": "Cartagena"},
    "Marruecos": {"lat": 31.8, "lon": -7.1, "puerto_entrada": "Cartagena"},
    "Sudáfrica": {"lat": -30.6, "lon": 22.9, "puerto_entrada": "Cartagena"},
    "Malasia": {"lat": 4.2, "lon": 101.9, "puerto_entrada": "Buenaventura"},
    "Indonesia": {"lat": -0.8, "lon": 113.9, "puerto_entrada": "Buenaventura"},
    "Tailandia": {"lat": 15.9, "lon": 100.9, "puerto_entrada": "Buenaventura"},
    "Vietnam": {"lat": 14.1, "lon": 108.3, "puerto_entrada": "Buenaventura"},
    "Japón": {"lat": 36.2, "lon": 138.3, "puerto_entrada": "Buenaventura"},
    "Corea del Sur": {"lat": 35.9, "lon": 127.8, "puerto_entrada": "Buenaventura"},
    "Australia": {"lat": -25.3, "lon": 133.8, "puerto_entrada": "Buenaventura"},
    "Nueva Zelanda": {"lat": -40.9, "lon": 174.9, "puerto_entrada": "Buenaventura"},
    "Colombia": {"lat": 4.6, "lon": -74.1, "puerto_entrada": "Nacional"},
}

LINEAS_VALIDAS = (
    "aceites-ceras-grasas",
    "agro",
    "alimentario",
    "cosmetica",
    "industria",
    "laboratorio",
)

TIPOS_PROVEEDOR = ("importador", "fabricante", "distribuidor", "nacional", "otro")


# ─────────────────────────── utilidades ───────────────────────────


def normalizar(texto: str) -> str:
    """minúsculas, sin tildes, sin símbolos, espacios colapsados."""
    if not texto:
        return ""
    t = unicodedata.normalize("NFKD", str(texto))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    t = re.sub(r"[^a-z0-9%\s\-\./]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


_UNIDADES = r"(kg|kgs|kilo|kilos|g|gr|gramos|mg|ml|lt|l|litro|litros|un|und|unidad|unidades|oz|lb|cc|m|mts|metros|cm|pulg|p)"
_RE_CANTIDAD = re.compile(r"\b\d+([\.,]\d+)?\s*" + _UNIDADES + r"\b")
_RE_PAREN = re.compile(r"\((ref|cod|codigo)[^)]*\)")
_RE_X = re.compile(r"\bx\s*\d+\b")


def clave_producto(nombre: str) -> str:
    """Nombre base sin presentación: 'ACIDO AZELAICO 10g' → 'acido azelaico'.

    Es la llave para agrupar un mismo producto vendido por varios proveedores.
    """
    t = normalizar(nombre)
    t = _RE_PAREN.sub(" ", t)
    t = _RE_CANTIDAD.sub(" ", t)
    t = _RE_X.sub(" ", t)
    t = re.sub(r"\b(por|de|del|la|el|en|y|x|con)\b\s*$", " ", t)
    t = re.sub(r"[\-\./]+$", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:120]


def _hoy() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ─────────────────────────── schema ───────────────────────────


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(_DB_PATH), timeout=15, check_same_thread=False)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA journal_mode=WAL")
    except sqlite3.DatabaseError:
        pass
    return con


_SCHEMA = """
CREATE TABLE IF NOT EXISTS proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    nombre_norm TEXT NOT NULL UNIQUE,
    nit TEXT NOT NULL DEFAULT '',
    pais TEXT NOT NULL DEFAULT '',
    ciudad TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    telefono TEXT NOT NULL DEFAULT '',
    sitio_web TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'importador',
    incoterm TEXT NOT NULL DEFAULT '',
    moneda TEXT NOT NULL DEFAULT 'COP',
    condiciones_pago TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '',
    activo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS proveedor_productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    nombre_norm TEXT NOT NULL,
    clave TEXT NOT NULL,
    cas TEXT NOT NULL DEFAULT '',
    presentacion TEXT NOT NULL DEFAULT '',
    unidad TEXT NOT NULL DEFAULT '',
    sku_siigo TEXT NOT NULL DEFAULT '',
    linea TEXT NOT NULL DEFAULT '',
    origen_pais TEXT NOT NULL DEFAULT '',
    publicar_web INTEGER NOT NULL DEFAULT 0,
    fuente TEXT NOT NULL DEFAULT 'manual',
    referencia TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(proveedor_id, nombre_norm)
);
CREATE INDEX IF NOT EXISTS idx_pp_clave ON proveedor_productos(clave);
CREATE TABLE IF NOT EXISTS precios_historicos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES proveedor_productos(id) ON DELETE SET NULL,
    nombre TEXT NOT NULL,
    clave TEXT NOT NULL,
    fecha TEXT NOT NULL,
    precio_unitario REAL NOT NULL,
    moneda TEXT NOT NULL DEFAULT 'COP',
    cantidad REAL NOT NULL DEFAULT 0,
    unidad TEXT NOT NULL DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    fuente TEXT NOT NULL DEFAULT 'manual',
    documento TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(fuente, documento, nombre, fecha)
);
CREATE INDEX IF NOT EXISTS idx_ph_clave ON precios_historicos(clave);
CREATE TABLE IF NOT EXISTS catalogos_correo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    msg_id TEXT NOT NULL UNIQUE,
    proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
    remitente TEXT NOT NULL DEFAULT '',
    remitente_email TEXT NOT NULL DEFAULT '',
    asunto TEXT NOT NULL DEFAULT '',
    fecha TEXT NOT NULL DEFAULT '',
    adjuntos_json TEXT NOT NULL DEFAULT '[]',
    estado TEXT NOT NULL DEFAULT 'detectado',
    n_lineas INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS solicitudes_cotizacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    nombre TEXT NOT NULL DEFAULT '',
    empresa TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    telefono TEXT NOT NULL DEFAULT '',
    ciudad TEXT NOT NULL DEFAULT '',
    producto TEXT NOT NULL DEFAULT '',
    clave TEXT NOT NULL DEFAULT '',
    presentacion TEXT NOT NULL DEFAULT '',
    cantidad TEXT NOT NULL DEFAULT '',
    mensaje TEXT NOT NULL DEFAULT '',
    origen TEXT NOT NULL DEFAULT 'web',
    estado TEXT NOT NULL DEFAULT 'nueva',
    respuesta TEXT NOT NULL DEFAULT '',
    respondido_at TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT ''
);
"""


def init_db() -> None:
    with _lock:
        con = _conn()
        try:
            con.executescript(_SCHEMA)
            con.commit()
        finally:
            con.close()


init_db()


def _row(r: sqlite3.Row | None) -> dict | None:
    return dict(r) if r is not None else None


# ─────────────────────────── proveedores ───────────────────────────


def obtener_o_crear_proveedor(nombre: str, *, nit: str = "", pais: str = "",
                              email: str = "", tipo: str = "", con: sqlite3.Connection | None = None) -> int:
    nombre = (nombre or "").strip()
    if not nombre:
        nombre = f"NIT {nit}".strip() if nit else "Proveedor sin nombre"
    norm = normalizar(nombre)
    propio = con is not None
    con = con or _conn()
    try:
        r = con.execute("SELECT id, nit, pais, email FROM proveedores WHERE nombre_norm=?", (norm,)).fetchone()
        if r is None and nit:
            r = con.execute("SELECT id, nit, pais, email FROM proveedores WHERE nit=? AND nit<>''", (nit,)).fetchone()
        if r is not None:
            cambios = []
            vals: list = []
            if nit and not r["nit"]:
                cambios.append("nit=?"); vals.append(nit)
            if pais and not r["pais"]:
                cambios.append("pais=?"); vals.append(pais)
            if email and not r["email"]:
                cambios.append("email=?"); vals.append(email)
            if cambios:
                vals.append(r["id"])
                con.execute(f"UPDATE proveedores SET {', '.join(cambios)}, updated_at=? WHERE id=?",
                            (*vals[:-1], _ahora(), vals[-1]))
            return int(r["id"])
        cur = con.execute(
            "INSERT INTO proveedores (nombre, nombre_norm, nit, pais, email, tipo) VALUES (?,?,?,?,?,?)",
            (nombre, norm, nit or "", pais or "", email or "", tipo or ("nacional" if nit else "importador")),
        )
        return int(cur.lastrowid)
    finally:
        if not propio:
            con.commit()
            con.close()


def listar_proveedores(q: str = "", incluir_inactivos: bool = False) -> list[dict]:
    con = _conn()
    try:
        sql = """
        SELECT p.*,
               (SELECT COUNT(*) FROM proveedor_productos pp WHERE pp.proveedor_id=p.id) AS n_productos,
               (SELECT COUNT(*) FROM precios_historicos ph WHERE ph.proveedor_id=p.id) AS n_precios,
               (SELECT MAX(fecha) FROM precios_historicos ph WHERE ph.proveedor_id=p.id) AS ultima_compra,
               (SELECT COUNT(*) FROM catalogos_correo cc WHERE cc.proveedor_id=p.id) AS n_catalogos
        FROM proveedores p
        """
        where = []
        params: list = []
        if not incluir_inactivos:
            where.append("p.activo=1")
        if q:
            where.append("(p.nombre_norm LIKE ? OR p.nit LIKE ? OR p.pais LIKE ?)")
            like = f"%{normalizar(q)}%"
            params += [like, f"%{q}%", f"%{q}%"]
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY n_precios DESC, p.nombre COLLATE NOCASE"
        return [dict(r) for r in con.execute(sql, params).fetchall()]
    finally:
        con.close()


def obtener_proveedor(pid: int) -> dict | None:
    con = _conn()
    try:
        p = _row(con.execute("SELECT * FROM proveedores WHERE id=?", (pid,)).fetchone())
        if not p:
            return None
        p["productos"] = [dict(r) for r in con.execute(
            """SELECT pp.*,
                      (SELECT precio_unitario FROM precios_historicos ph
                        WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave
                        ORDER BY fecha DESC LIMIT 1) AS ultimo_precio,
                      (SELECT moneda FROM precios_historicos ph
                        WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave
                        ORDER BY fecha DESC LIMIT 1) AS ultima_moneda,
                      (SELECT fecha FROM precios_historicos ph
                        WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave
                        ORDER BY fecha DESC LIMIT 1) AS ultima_fecha
               FROM proveedor_productos pp WHERE pp.proveedor_id=? ORDER BY pp.nombre COLLATE NOCASE""",
            (pid,)).fetchall()]
        p["precios"] = [dict(r) for r in con.execute(
            "SELECT * FROM precios_historicos WHERE proveedor_id=? ORDER BY fecha DESC, id DESC LIMIT 300",
            (pid,)).fetchall()]
        p["catalogos"] = [dict(r) for r in con.execute(
            "SELECT id, msg_id, remitente, remitente_email, asunto, fecha, adjuntos_json, estado, n_lineas "
            "FROM catalogos_correo WHERE proveedor_id=? ORDER BY fecha DESC", (pid,)).fetchall()]
        for c in p["catalogos"]:
            try:
                c["adjuntos"] = json.loads(c.pop("adjuntos_json") or "[]")
            except Exception:
                c["adjuntos"] = []
        return p
    finally:
        con.close()


_CAMPOS_PROVEEDOR = ("nombre", "nit", "pais", "ciudad", "email", "telefono", "sitio_web",
                     "tipo", "incoterm", "moneda", "condiciones_pago", "notas", "activo")


def guardar_proveedor(datos: dict, pid: int | None = None) -> dict:
    datos = datos or {}
    with _lock:
        con = _conn()
        try:
            if pid is None:
                pid = obtener_o_crear_proveedor(datos.get("nombre", ""), nit=datos.get("nit", ""),
                                               pais=datos.get("pais", ""), email=datos.get("email", ""),
                                               tipo=datos.get("tipo", ""), con=con)
            sets = []
            vals: list = []
            for k in _CAMPOS_PROVEEDOR:
                if k in datos and datos[k] is not None:
                    v = datos[k]
                    if k == "activo":
                        v = 1 if v else 0
                    elif k == "tipo" and v not in TIPOS_PROVEEDOR:
                        v = "otro"
                    else:
                        v = str(v).strip()
                    sets.append(f"{k}=?"); vals.append(v)
                    if k == "nombre":
                        sets.append("nombre_norm=?"); vals.append(normalizar(v))
            if sets:
                vals += [_ahora(), pid]
                con.execute(f"UPDATE proveedores SET {', '.join(sets)}, updated_at=? WHERE id=?", vals)
            con.commit()
        finally:
            con.close()
    return obtener_proveedor(int(pid)) or {}


# ─────────────────────────── productos ───────────────────────────


def _upsert_producto(con: sqlite3.Connection, proveedor_id: int, nombre: str, *, presentacion: str = "",
                     unidad: str = "", sku_siigo: str = "", fuente: str = "manual", referencia: str = "",
                     cas: str = "", linea: str = "", origen_pais: str = "") -> int:
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("nombre de producto vacío")
    norm = normalizar(nombre)
    clave = clave_producto(nombre) or norm
    r = con.execute("SELECT id, sku_siigo, presentacion, unidad, cas, linea, origen_pais FROM proveedor_productos "
                    "WHERE proveedor_id=? AND nombre_norm=?", (proveedor_id, norm)).fetchone()
    if r is not None:
        sets, vals = [], []
        for k, v in (("sku_siigo", sku_siigo), ("presentacion", presentacion), ("unidad", unidad),
                     ("cas", cas), ("linea", linea), ("origen_pais", origen_pais)):
            if v and not r[k]:
                sets.append(f"{k}=?"); vals.append(v)
        if sets:
            vals += [_ahora(), r["id"]]
            con.execute(f"UPDATE proveedor_productos SET {', '.join(sets)}, updated_at=? WHERE id=?", vals)
        return int(r["id"])
    # Hereda línea / origen de otro registro con la misma clave si ya se clasificó
    if not linea or not origen_pais:
        h = con.execute("SELECT linea, origen_pais FROM proveedor_productos WHERE clave=? AND (linea<>'' OR origen_pais<>'') "
                        "ORDER BY updated_at DESC LIMIT 1", (clave,)).fetchone()
        if h is not None:
            linea = linea or h["linea"]
            origen_pais = origen_pais or h["origen_pais"]
    if not origen_pais:
        pr = con.execute("SELECT pais FROM proveedores WHERE id=?", (proveedor_id,)).fetchone()
        if pr is not None and pr["pais"]:
            origen_pais = pr["pais"]
    cur = con.execute(
        """INSERT INTO proveedor_productos
           (proveedor_id, nombre, nombre_norm, clave, cas, presentacion, unidad, sku_siigo, linea, origen_pais, fuente, referencia)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (proveedor_id, nombre, norm, clave, cas, presentacion, unidad, sku_siigo, linea, origen_pais, fuente, referencia),
    )
    return int(cur.lastrowid)


def _registrar_precio(con: sqlite3.Connection, proveedor_id: int, producto_id: int | None, nombre: str, fecha: str,
                      precio: float, *, moneda: str = "COP", cantidad: float = 0, unidad: str = "",
                      total: float = 0, fuente: str = "manual", documento: str = "") -> bool:
    if precio is None or precio <= 0:
        return False
    clave = clave_producto(nombre) or normalizar(nombre)
    fecha = (fecha or _hoy())[:10]
    cur = con.execute(
        """INSERT OR IGNORE INTO precios_historicos
           (proveedor_id, producto_id, nombre, clave, fecha, precio_unitario, moneda, cantidad, unidad, total, fuente, documento)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (proveedor_id, producto_id, nombre.strip(), clave, fecha, float(precio), moneda or "COP",
         float(cantidad or 0), unidad or "", float(total or 0), fuente, documento or ""),
    )
    return cur.rowcount > 0


def agregar_producto_manual(proveedor_id: int, datos: dict) -> dict:
    datos = datos or {}
    with _lock:
        con = _conn()
        try:
            pid = _upsert_producto(con, proveedor_id, datos.get("nombre", ""),
                                   presentacion=str(datos.get("presentacion") or ""),
                                   unidad=str(datos.get("unidad") or ""),
                                   sku_siigo=str(datos.get("sku_siigo") or ""),
                                   cas=str(datos.get("cas") or ""),
                                   linea=str(datos.get("linea") or ""),
                                   origen_pais=str(datos.get("origen_pais") or ""),
                                   fuente=str(datos.get("fuente") or "manual"),
                                   referencia=str(datos.get("referencia") or ""))
            precio = datos.get("precio")
            if precio:
                _registrar_precio(con, proveedor_id, pid, datos["nombre"], datos.get("fecha") or _hoy(),
                                  float(precio), moneda=str(datos.get("moneda") or "COP"),
                                  unidad=str(datos.get("unidad") or ""), fuente="manual",
                                  documento=str(datos.get("referencia") or "manual"))
            if datos.get("publicar_web"):
                con.execute("UPDATE proveedor_productos SET publicar_web=1 WHERE id=?", (pid,))
            con.commit()
            return dict(con.execute("SELECT * FROM proveedor_productos WHERE id=?", (pid,)).fetchone())
        finally:
            con.close()


_CAMPOS_PRODUCTO = ("nombre", "cas", "presentacion", "unidad", "sku_siigo", "linea", "origen_pais",
                    "publicar_web", "notas")


def actualizar_producto(producto_id: int, datos: dict, aplicar_a_clave: bool = False) -> dict | None:
    """Edita un producto. Con `aplicar_a_clave`, línea/origen/publicar_web se
    propagan a todos los proveedores que venden el mismo producto (misma clave)."""
    datos = datos or {}
    with _lock:
        con = _conn()
        try:
            r = con.execute("SELECT * FROM proveedor_productos WHERE id=?", (producto_id,)).fetchone()
            if r is None:
                return None
            sets, vals = [], []
            for k in _CAMPOS_PRODUCTO:
                if k in datos and datos[k] is not None:
                    v = datos[k]
                    if k == "publicar_web":
                        v = 1 if v else 0
                    elif k == "linea" and v and v not in LINEAS_VALIDAS:
                        continue
                    else:
                        v = str(v).strip()
                    sets.append(f"{k}=?"); vals.append(v)
                    if k == "nombre":
                        sets.append("nombre_norm=?"); vals.append(normalizar(v))
                        sets.append("clave=?"); vals.append(clave_producto(v) or normalizar(v))
            if sets:
                con.execute(f"UPDATE proveedor_productos SET {', '.join(sets)}, updated_at=? WHERE id=?",
                            (*vals, _ahora(), producto_id))
            if aplicar_a_clave:
                comp, cv = [], []
                for k in ("linea", "origen_pais", "publicar_web", "cas"):
                    if k in datos and datos[k] is not None:
                        v = datos[k]
                        if k == "publicar_web":
                            v = 1 if v else 0
                        elif k == "linea" and v and v not in LINEAS_VALIDAS:
                            continue
                        else:
                            v = str(v).strip()
                        comp.append(f"{k}=?"); cv.append(v)
                if comp:
                    con.execute(f"UPDATE proveedor_productos SET {', '.join(comp)}, updated_at=? WHERE clave=?",
                                (*cv, _ahora(), r["clave"]))
            con.commit()
            return dict(con.execute("SELECT * FROM proveedor_productos WHERE id=?", (producto_id,)).fetchone())
        finally:
            con.close()


def eliminar_producto(producto_id: int) -> bool:
    with _lock:
        con = _conn()
        try:
            cur = con.execute("DELETE FROM proveedor_productos WHERE id=?", (producto_id,))
            con.commit()
            return cur.rowcount > 0
        finally:
            con.close()


def buscar_productos(q: str = "", solo_publicables: bool = False, linea: str = "", limite: int = 400) -> list[dict]:
    """Vista '¿quién vende X?': una fila por producto (clave) con todos sus
    proveedores y el mejor/último precio de cada uno."""
    con = _conn()
    try:
        where, params = [], []
        if q:
            tokens = [t for t in normalizar(q).split() if t]
            for t in tokens:
                where.append("(pp.nombre_norm LIKE ? OR pp.cas LIKE ?)")
                params += [f"%{t}%", f"%{t}%"]
        if solo_publicables:
            where.append("pp.publicar_web=1")
        if linea:
            where.append("pp.linea=?"); params.append(linea)
        sql = """
        SELECT pp.*, p.nombre AS proveedor_nombre, p.pais AS proveedor_pais, p.tipo AS proveedor_tipo,
               (SELECT precio_unitario FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave ORDER BY fecha DESC, id DESC LIMIT 1) AS ultimo_precio,
               (SELECT moneda FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave ORDER BY fecha DESC, id DESC LIMIT 1) AS ultima_moneda,
               (SELECT fecha FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave ORDER BY fecha DESC, id DESC LIMIT 1) AS ultima_fecha,
               (SELECT MIN(precio_unitario) FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave) AS precio_min,
               (SELECT COUNT(*) FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave) AS n_compras
        FROM proveedor_productos pp JOIN proveedores p ON p.id=pp.proveedor_id
        """
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY pp.clave, pp.nombre COLLATE NOCASE"
        rows = [dict(r) for r in con.execute(sql, params).fetchall()]
    finally:
        con.close()

    grupos: dict[str, dict] = {}
    for r in rows:
        g = grupos.get(r["clave"])
        if g is None:
            g = grupos[r["clave"]] = {
                "clave": r["clave"],
                "nombre": r["nombre"],
                "cas": r["cas"],
                "linea": r["linea"],
                "origen_paises": [],
                "publicar_web": bool(r["publicar_web"]),
                "presentaciones": [],
                "skus_siigo": [],
                "proveedores": [],
                "mejor_precio": None,
                "mejor_proveedor": "",
            }
        if len(r["nombre"]) < len(g["nombre"]):
            g["nombre"] = r["nombre"]
        if r["cas"] and not g["cas"]:
            g["cas"] = r["cas"]
        if r["linea"] and not g["linea"]:
            g["linea"] = r["linea"]
        if r["origen_pais"] and r["origen_pais"] not in g["origen_paises"]:
            g["origen_paises"].append(r["origen_pais"])
        if r["presentacion"] and r["presentacion"] not in g["presentaciones"]:
            g["presentaciones"].append(r["presentacion"])
        if r["sku_siigo"] and r["sku_siigo"] not in g["skus_siigo"]:
            g["skus_siigo"].append(r["sku_siigo"])
        g["publicar_web"] = g["publicar_web"] or bool(r["publicar_web"])
        prov = next((x for x in g["proveedores"] if x["proveedor_id"] == r["proveedor_id"]), None)
        if prov is None:
            prov = {
                "proveedor_id": r["proveedor_id"],
                "proveedor": r["proveedor_nombre"],
                "pais": r["proveedor_pais"],
                "tipo": r["proveedor_tipo"],
                "producto_id": r["id"],
                "nombre_en_proveedor": r["nombre"],
                "ultimo_precio": r["ultimo_precio"],
                "moneda": r["ultima_moneda"] or "",
                "ultima_fecha": r["ultima_fecha"] or "",
                "precio_min": r["precio_min"],
                "n_compras": r["n_compras"] or 0,
                "fuente": r["fuente"],
            }
            g["proveedores"].append(prov)
        if r["ultimo_precio"] and (r["ultima_moneda"] or "COP") == "COP":
            if g["mejor_precio"] is None or r["ultimo_precio"] < g["mejor_precio"]:
                g["mejor_precio"] = r["ultimo_precio"]
                g["mejor_proveedor"] = r["proveedor_nombre"]
    out = sorted(grupos.values(), key=lambda g: (-len(g["proveedores"]), g["nombre"].lower()))
    return out[:limite]


def historial_precios(clave: str) -> list[dict]:
    con = _conn()
    try:
        return [dict(r) for r in con.execute(
            """SELECT ph.*, p.nombre AS proveedor FROM precios_historicos ph
               JOIN proveedores p ON p.id=ph.proveedor_id WHERE ph.clave=? ORDER BY ph.fecha, ph.id""",
            (clave,)).fetchall()]
    finally:
        con.close()


def resumen() -> dict:
    con = _conn()
    try:
        c = con.execute
        return {
            "proveedores": c("SELECT COUNT(*) FROM proveedores WHERE activo=1").fetchone()[0],
            "productos": c("SELECT COUNT(DISTINCT clave) FROM proveedor_productos").fetchone()[0],
            "lineas_producto": c("SELECT COUNT(*) FROM proveedor_productos").fetchone()[0],
            "precios": c("SELECT COUNT(*) FROM precios_historicos").fetchone()[0],
            "publicables": c("SELECT COUNT(DISTINCT clave) FROM proveedor_productos WHERE publicar_web=1").fetchone()[0],
            "catalogos": c("SELECT COUNT(*) FROM catalogos_correo").fetchone()[0],
            "catalogos_pendientes": c("SELECT COUNT(*) FROM catalogos_correo WHERE estado='detectado'").fetchone()[0],
            "cotizaciones_nuevas": c("SELECT COUNT(*) FROM solicitudes_cotizacion WHERE estado='nueva'").fetchone()[0],
            "paises": [r[0] for r in c("SELECT DISTINCT origen_pais FROM proveedor_productos WHERE origen_pais<>'' ORDER BY 1").fetchall()],
            "oferta_web_publicada": OFERTA_WEB_PATH.exists(),
        }
    finally:
        con.close()


# ─────────────────────────── importadores (sin LLM) ───────────────────────────


def _nombres_por_nit() -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        data = json.loads(_PROVEEDORES_ESPECIALES.read_text(encoding="utf-8"))
        for p in data.get("proveedores", []):
            if p.get("nit") and p.get("nombre"):
                out[str(p["nit"]).strip()] = p["nombre"]
    except Exception:
        pass
    try:
        data = json.loads(_HISTORIAL_FACTURAS.read_text(encoding="utf-8"))
        for h in data.get("historial", []):
            if h.get("nit") and h.get("proveedor"):
                out.setdefault(str(h["nit"]).strip(), h["proveedor"])
    except Exception:
        pass
    return out


_PROVEEDORES_NO_MATERIA = ("inter rapidisimo", "camara de comercio", "d1 s a s", "mckenna group")


def importar_historial_facturas() -> dict:
    """facturas_compra_historial.json → proveedores + productos + precio neto real por ítem."""
    try:
        data = json.loads(_HISTORIAL_FACTURAS.read_text(encoding="utf-8"))
    except Exception as e:
        return {"ok": False, "error": f"No se pudo leer historial: {e}"}
    n_prov = n_prod = n_precio = 0
    with _lock:
        con = _conn()
        try:
            for h in data.get("historial", []):
                if h.get("accion") not in ("inventario",):
                    continue
                items = h.get("items_resumen") or []
                if not items:
                    continue
                nombre = h.get("proveedor") or ""
                if any(x in normalizar(nombre) for x in _PROVEEDORES_NO_MATERIA):
                    continue
                pid = obtener_o_crear_proveedor(nombre, nit=str(h.get("nit") or ""), pais="Colombia",
                                                tipo="nacional", con=con)
                n_prov += 1
                fecha = (h.get("fecha_factura") or h.get("timestamp") or _hoy())[:10]
                doc = h.get("numero_factura") or h.get("id") or ""
                for it in items:
                    nom = it.get("nombre") or ""
                    if not nom:
                        continue
                    prod_id = _upsert_producto(con, pid, nom, unidad=str(it.get("unidad_min") or ""),
                                               sku_siigo=str(it.get("codigo") or ""), fuente="factura_compra",
                                               referencia=doc)
                    n_prod += 1
                    precio = it.get("precio_proveedor") or it.get("precio_neto") or 0
                    if _registrar_precio(con, pid, prod_id, nom, fecha, float(precio or 0),
                                         cantidad=float(it.get("cantidad_min") or 0),
                                         unidad=str(it.get("unidad_min") or ""),
                                         fuente="factura_compra", documento=doc):
                        n_precio += 1
            con.commit()
        finally:
            con.close()
    return {"ok": True, "fuente": "facturas_compra_historial", "facturas_proveedor": n_prov,
            "lineas": n_prod, "precios_nuevos": n_precio}


def importar_compras_exterior() -> dict:
    """contabilidad.db → compras_exterior (compras de socios/exterior con costo unitario COP)."""
    try:
        from app.services.contabilidad_db import _DB_PATH as _CONTAB_DB  # type: ignore
    except Exception:
        _CONTAB_DB = str(_REPO / "app" / "data" / "contabilidad.db")
    if not os.path.exists(_CONTAB_DB):
        return {"ok": False, "error": "contabilidad.db no existe"}
    src = sqlite3.connect(_CONTAB_DB)
    src.row_factory = sqlite3.Row
    try:
        rows = src.execute("SELECT id, proveedor, fecha_compra, created_at, moneda, trm, lineas_json, "
                           "COALESCE(comprado_por,'') AS comprado_por FROM compras_exterior").fetchall()
    except sqlite3.OperationalError:
        rows = src.execute("SELECT id, proveedor, fecha_compra, created_at, moneda, trm, lineas_json, '' AS comprado_por "
                           "FROM compras_exterior").fetchall()
    finally:
        src.close()
    n_prod = n_precio = 0
    with _lock:
        con = _conn()
        try:
            for r in rows:
                try:
                    lineas = json.loads(r["lineas_json"] or "[]")
                except Exception:
                    lineas = []
                if not lineas:
                    continue
                prov_nombre = (r["proveedor"] or "").strip()
                if not prov_nombre or normalizar(prov_nombre) in ("test", "prueba"):
                    prov_nombre = "Compra exterior (socio)" if r["comprado_por"] == "socio" else "Compra exterior"
                pid = obtener_o_crear_proveedor(prov_nombre, tipo="importador", con=con)
                fecha = (r["fecha_compra"] or r["created_at"] or _hoy())[:10]
                doc = f"compra_exterior#{r['id']}"
                for ln in lineas:
                    nom = ln.get("nombre_ocr") or ln.get("nombre") or ""
                    if not nom:
                        continue
                    prod_id = _upsert_producto(con, pid, nom, unidad=str(ln.get("unidad") or ""),
                                               sku_siigo=str(ln.get("codigo") or ""),
                                               fuente="compra_exterior", referencia=doc)
                    n_prod += 1
                    costo = ln.get("costo_unitario") or 0
                    if _registrar_precio(con, pid, prod_id, nom, fecha, float(costo or 0), moneda="COP",
                                         cantidad=float(ln.get("unidades_totales") or ln.get("cantidad") or 0),
                                         unidad=str(ln.get("unidad") or ""), total=float(ln.get("subtotal") or 0),
                                         fuente="compra_exterior", documento=doc):
                        n_precio += 1
            con.commit()
        finally:
            con.close()
    return {"ok": True, "fuente": "compras_exterior", "compras": len(rows), "lineas": n_prod, "precios_nuevos": n_precio}


def importar_siigo_compras(fecha_desde: str = "2024-01-01") -> dict:
    """Siigo /v1/purchases → precio histórico por ítem. Sin LLM; solo API del ERP."""
    try:
        from app.services.siigo import obtener_facturas_compra_siigo
        facturas = obtener_facturas_compra_siigo(fecha_desde) or []
    except Exception as e:
        return {"ok": False, "error": f"Siigo: {e}"}
    nombres = _nombres_por_nit()
    n_fact = n_prod = n_precio = 0
    with _lock:
        con = _conn()
        try:
            for f in facturas:
                items = f.get("items") or []
                if not items:
                    continue
                sup = f.get("supplier") or {}
                nit = str(sup.get("identification") or "").strip()
                nombre = sup.get("name") or sup.get("commercial_name") or nombres.get(nit) or (f"NIT {nit}" if nit else "")
                if isinstance(nombre, list):
                    nombre = " ".join(str(x) for x in nombre)
                if not nombre:
                    continue
                if any(x in normalizar(nombre) for x in _PROVEEDORES_NO_MATERIA):
                    continue
                pid = obtener_o_crear_proveedor(nombre, nit=nit, pais="Colombia", tipo="nacional", con=con)
                n_fact += 1
                fecha = str(f.get("date") or f.get("created") or _hoy())[:10]
                doc = str(f.get("number") or f.get("name") or f.get("id") or "")
                for it in items:
                    nom = it.get("description") or it.get("name") or ""
                    if not nom:
                        continue
                    prod_id = _upsert_producto(con, pid, nom, sku_siigo=str(it.get("code") or ""),
                                               fuente="siigo", referencia=doc)
                    n_prod += 1
                    precio = it.get("price") or 0
                    if _registrar_precio(con, pid, prod_id, nom, fecha, float(precio or 0),
                                         cantidad=float(it.get("quantity") or 0),
                                         total=float(it.get("total") or 0), fuente="siigo", documento=doc):
                        n_precio += 1
            con.commit()
        finally:
            con.close()
    return {"ok": True, "fuente": "siigo", "facturas": n_fact, "lineas": n_prod, "precios_nuevos": n_precio}


def importar_todo(incluir_siigo: bool = False, fecha_desde_siigo: str = "2024-01-01") -> dict:
    out = {"historial": importar_historial_facturas(), "compras_exterior": importar_compras_exterior()}
    if incluir_siigo:
        out["siigo"] = importar_siigo_compras(fecha_desde_siigo)
    out["resumen"] = resumen()
    return out


# ─────────────────────────── catálogos por correo ───────────────────────────


_CATALOGO_QUERY = (
    "has:attachment newer_than:{dias}d "
    "(catálogo OR catalogo OR \"lista de precios\" OR \"price list\" OR portafolio OR "
    "\"product list\" OR cotización OR cotizacion OR quotation OR oferta) "
    "-subject:invoice -subject:undeliverable -subject:\"factura electrónica\" -subject:\"factura electronica\""
)
_EXT_UTILES = (".pdf", ".xlsx", ".xls", ".csv")


def escanear_catalogos_gmail(dias: int = 730, max_correos: int = 200) -> dict:
    """Detecta correos con adjuntos tipo catálogo/lista de precios y los registra
    (metadatos, sin descargar) para que el operador decida cuáles extraer."""
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    try:
        svc = get_gmail_service()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    query = _CATALOGO_QUERY.format(dias=int(dias))
    ids: list[str] = []
    token = None
    try:
        while len(ids) < max_correos:
            res = svc.users().messages().list(userId="me", q=query, maxResults=min(100, max_correos - len(ids)),
                                              pageToken=token).execute()
            ids += [m["id"] for m in res.get("messages", [])]
            token = res.get("nextPageToken")
            if not token:
                break
    except Exception as e:
        return {"ok": False, "error": f"Gmail list: {e}"}

    proveedores = {p["nombre_norm"]: p for p in listar_proveedores(incluir_inactivos=True)}
    emails_prov = {p["email"].lower(): p for p in proveedores.values() if p.get("email")}
    nuevos = 0
    with _lock:
        con = _conn()
        try:
            existentes = {r[0] for r in con.execute("SELECT msg_id FROM catalogos_correo").fetchall()}
            for mid in ids:
                if mid in existentes:
                    continue
                try:
                    msg = svc.users().messages().get(userId="me", id=mid, format="full").execute()
                except Exception:
                    continue
                hdrs = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
                de = hdrs.get("from", "")
                m = re.search(r"<([^>]+)>", de)
                email = (m.group(1) if m else de).strip().lower()
                remitente = re.sub(r"<[^>]+>", "", de).strip().strip('"') or email
                if "mckenna" in email:
                    continue
                adjuntos = []
                for part in _iter_parts(msg.get("payload", {})):
                    fn = part.get("filename") or ""
                    if fn and fn.lower().endswith(_EXT_UTILES):
                        body = part.get("body", {})
                        adjuntos.append({"filename": fn, "att_id": body.get("attachmentId", ""),
                                         "size": body.get("size", 0), "mime": part.get("mimeType", "")})
                if not adjuntos:
                    continue
                fecha = ""
                try:
                    fecha = datetime.fromtimestamp(int(msg.get("internalDate", "0")) / 1000).strftime("%Y-%m-%d")
                except Exception:
                    pass
                prov = emails_prov.get(email)
                if prov is None:
                    dominio = email.split("@")[-1].split(".")[0] if "@" in email else ""
                    if dominio and len(dominio) > 3:
                        prov = next((p for k, p in proveedores.items() if dominio in k), None)
                con.execute(
                    """INSERT OR IGNORE INTO catalogos_correo
                       (msg_id, proveedor_id, remitente, remitente_email, asunto, fecha, adjuntos_json, estado)
                       VALUES (?,?,?,?,?,?,?,'detectado')""",
                    (mid, prov["id"] if prov else None, remitente[:200], email[:200],
                     (hdrs.get("subject") or "")[:300], fecha, json.dumps(adjuntos, ensure_ascii=False)),
                )
                nuevos += 1
            con.commit()
        finally:
            con.close()
    return {"ok": True, "correos_revisados": len(ids), "catalogos_nuevos": nuevos}


def _iter_parts(payload: dict):
    stack = [payload]
    while stack:
        p = stack.pop()
        yield p
        stack.extend(p.get("parts") or [])


def listar_catalogos(estado: str = "") -> list[dict]:
    con = _conn()
    try:
        sql = """SELECT cc.*, p.nombre AS proveedor_nombre FROM catalogos_correo cc
                 LEFT JOIN proveedores p ON p.id=cc.proveedor_id"""
        params: list = []
        if estado:
            sql += " WHERE cc.estado=?"; params.append(estado)
        sql += " ORDER BY cc.fecha DESC, cc.id DESC"
        out = []
        for r in con.execute(sql, params).fetchall():
            d = dict(r)
            try:
                d["adjuntos"] = json.loads(d.pop("adjuntos_json") or "[]")
            except Exception:
                d["adjuntos"] = []
            out.append(d)
        return out
    finally:
        con.close()


def actualizar_catalogo(cat_id: int, datos: dict) -> dict | None:
    datos = datos or {}
    with _lock:
        con = _conn()
        try:
            sets, vals = [], []
            if "estado" in datos and datos["estado"] in ("detectado", "importado", "omitido"):
                sets.append("estado=?"); vals.append(datos["estado"])
            if "proveedor_id" in datos:
                sets.append("proveedor_id=?"); vals.append(datos["proveedor_id"] or None)
            if sets:
                vals.append(cat_id)
                con.execute(f"UPDATE catalogos_correo SET {', '.join(sets)} WHERE id=?", vals)
                con.commit()
            r = con.execute("SELECT * FROM catalogos_correo WHERE id=?", (cat_id,)).fetchone()
            return _row(r)
        finally:
            con.close()


_RE_PRECIO = re.compile(r"(?:\$|usd|cop|eur|€)?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:/\s*(kg|g|l|ml|un))?", re.I)
_RE_CAS = re.compile(r"\b(\d{2,7}-\d{2}-\d)\b")
_PROSA_FINAL = {"de", "y", "el", "la", "con", "que", "en", "para", "los", "las", "del", "o", "a", "se", "su",
                "por", "un", "una", "al", "e", "es", "son", "sus", "como", "más", "mas"}
_PROSA_INICIO = {"somos", "nuestra", "nuestro", "nuestras", "nuestros", "contamos", "ofrecemos", "brindamos",
                 "con", "para", "desde", "hace", "gracias", "cordial", "atentamente", "estimado", "estimada",
                 "buenos", "buenas", "adjunto", "adjunta", "quedo", "quedamos", "cualquier", "favor", "por"}
_PROSA_MEDIO = {"que", "para", "son", "está", "están", "esta", "nuestros", "nuestras", "nuestro", "nuestra",
                "somos", "usted", "ustedes", "clientes", "compromiso", "experiencia", "calidad de"}
_PALABRAS_RUIDO = ("total", "subtotal", "iva", "página", "pagina", "page", "tel", "www", "http", "@",
                   "nit", "dirección", "direccion", "gracias", "cordial", "atentamente", "factura")


def _parsear_precio_texto(s: str) -> float | None:
    s = s.strip()
    if not s:
        return None
    m = re.search(r"(\d[\d\.,]*)", s)
    if not m:
        return None
    raw = m.group(1)
    # 1.234.567,89  |  1,234,567.89  |  1234.5
    if raw.count(",") and raw.count("."):
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif raw.count(",") == 1 and len(raw.split(",")[1]) <= 2:
        raw = raw.replace(",", ".")
    else:
        raw = raw.replace(",", "").replace(".", "") if raw.count(".") > 1 else raw.replace(",", "")
    try:
        v = float(raw)
        return v if v > 0 else None
    except ValueError:
        return None


def _candidatos_desde_filas(filas: list[list]) -> list[dict]:
    """Heurística para tablas (XLSX/CSV): la columna con más texto largo es el
    nombre; la columna numérica más frecuente a la derecha es el precio."""
    filas = [[("" if c is None else str(c)).strip() for c in f] for f in filas if f and any(c not in (None, "") for c in f)]
    if not filas:
        return []
    ancho = max(len(f) for f in filas)
    filas = [f + [""] * (ancho - len(f)) for f in filas]
    score_txt = [0] * ancho
    score_num = [0] * ancho
    for f in filas:
        for i, c in enumerate(f):
            if len(c) >= 6 and re.search(r"[a-záéíóúñ]{3}", c, re.I):
                score_txt[i] += 1
            if c and _parsear_precio_texto(c) and len(re.sub(r"[\d\.,\s\$]", "", c)) <= 4:
                score_num[i] += 1
    col_nombre = max(range(ancho), key=lambda i: score_txt[i])
    col_precio = None
    candidatos_precio = [i for i in range(ancho) if i != col_nombre and score_num[i] >= max(2, len(filas) * 0.25)]
    if candidatos_precio:
        col_precio = max(candidatos_precio, key=lambda i: (score_num[i], i))
    col_cas = None
    for i in range(ancho):
        if i != col_nombre and sum(1 for f in filas if _RE_CAS.fullmatch(f[i] or "")) >= 2:
            col_cas = i
            break
    out = []
    for f in filas:
        nombre = f[col_nombre]
        if len(nombre) < 4 or any(w in nombre.lower() for w in _PALABRAS_RUIDO):
            continue
        precio = _parsear_precio_texto(f[col_precio]) if col_precio is not None else None
        cas = f[col_cas] if col_cas is not None and _RE_CAS.fullmatch(f[col_cas] or "") else ""
        if not cas:
            m = _RE_CAS.search(" ".join(f))
            cas = m.group(1) if m else ""
        out.append({"nombre": nombre[:200], "precio": precio, "cas": cas, "fila": " | ".join(c for c in f if c)[:300]})
    return out


def _candidatos_desde_texto(texto: str) -> list[dict]:
    out = []
    for raw in texto.splitlines():
        ln = raw.strip()
        if len(ln) < 5 or len(ln) > 160:
            continue
        low = ln.lower()
        if any(w in low for w in _PALABRAS_RUIDO):
            continue
        if not re.search(r"[a-záéíóúñ]{4}", low):
            continue
        letras = sum(ch.isalpha() for ch in ln)
        if letras < 5 or letras / max(1, len(ln)) < 0.35:
            continue
        palabras = low.split()
        if len(palabras) > 9 or ln.endswith((".", ":", ",", ";")):
            continue  # prosa de folleto, no nombre de producto
        if palabras[-1] in _PROSA_FINAL or palabras[0] in _PROSA_INICIO:
            continue
        if any(f" {w} " in f" {low} " for w in _PROSA_MEDIO):
            continue
        cas_m = _RE_CAS.search(ln)
        precio = None
        # precio: último número "grande" de la línea (≥ 3 dígitos o con decimales)
        nums = re.findall(r"(?:\$|usd|cop)?\s*\d[\d\.,]*", ln, re.I)
        for n in reversed(nums):
            v = _parsear_precio_texto(n)
            if v and (v >= 100 or "." in n or "," in n):
                precio = v
                break
        nombre = _RE_CAS.sub("", ln)
        if precio is not None:
            nombre = re.sub(r"(?:\$|usd|cop)?\s*\d[\d\.,]*\s*(?:/\s*\w+)?\s*$", "", nombre, flags=re.I)
        nombre = re.sub(r"\s{2,}", " ", nombre).strip(" -:•·|")
        if len(nombre) < 4:
            continue
        out.append({"nombre": nombre[:200], "precio": precio, "cas": cas_m.group(1) if cas_m else "", "fila": ln[:300]})
    return out


def extraer_lineas_catalogo(cat_id: int, max_lineas: int = 800) -> dict:
    """Descarga los adjuntos del correo y devuelve líneas candidatas (sin guardar).
    XLSX/CSV → tabla; PDF → texto (PyMuPDF). Sin LLM."""
    import base64
    import csv
    import io

    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    con = _conn()
    try:
        r = con.execute("SELECT * FROM catalogos_correo WHERE id=?", (cat_id,)).fetchone()
    finally:
        con.close()
    if r is None:
        return {"ok": False, "error": "Catálogo no encontrado"}
    try:
        adjuntos = json.loads(r["adjuntos_json"] or "[]")
    except Exception:
        adjuntos = []
    try:
        svc = get_gmail_service()
    except Exception as e:
        return {"ok": False, "error": str(e)}

    candidatos: list[dict] = []
    detalle = []
    for adj in adjuntos:
        fn = adj.get("filename", "")
        att_id = adj.get("att_id")
        if not att_id:
            continue
        try:
            att = svc.users().messages().attachments().get(userId="me", messageId=r["msg_id"], id=att_id).execute()
            data = base64.urlsafe_b64decode(att["data"].encode("utf-8"))
        except Exception as e:
            detalle.append({"archivo": fn, "error": str(e)})
            continue
        low = fn.lower()
        lineas: list[dict] = []
        try:
            if low.endswith(".xlsx"):
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
                for ws in wb.worksheets:
                    filas = [list(row) for row in ws.iter_rows(values_only=True)]
                    lineas += _candidatos_desde_filas(filas)
            elif low.endswith(".csv"):
                txt = data.decode("utf-8", errors="ignore")
                dialect = csv.Sniffer().sniff(txt[:2000]) if txt else csv.excel
                lineas += _candidatos_desde_filas(list(csv.reader(io.StringIO(txt), dialect)))
            elif low.endswith(".pdf"):
                import fitz  # PyMuPDF
                doc = fitz.open(stream=data, filetype="pdf")
                texto = "\n".join(page.get_text("text") for page in doc)
                lineas += _candidatos_desde_texto(texto)
            elif low.endswith(".xls"):
                detalle.append({"archivo": fn, "error": "Formato .xls antiguo: convertir a .xlsx"})
                continue
        except Exception as e:
            detalle.append({"archivo": fn, "error": f"No se pudo leer: {e}"})
            continue
        for ln in lineas:
            ln["archivo"] = fn
        detalle.append({"archivo": fn, "lineas": len(lineas)})
        candidatos += lineas
    # dedupe por nombre normalizado
    vistos = set()
    unicos = []
    for c in candidatos:
        k = normalizar(c["nombre"])
        if k in vistos:
            continue
        vistos.add(k)
        unicos.append(c)
    return {"ok": True, "catalogo": _row(r) | {"adjuntos": adjuntos}, "lineas": unicos[:max_lineas],
            "detalle": detalle, "truncado": len(unicos) > max_lineas}


def importar_lineas_catalogo(cat_id: int, proveedor_id: int, lineas: list[dict], *, moneda: str = "COP",
                             publicar_web: bool = False, linea: str = "", origen_pais: str = "") -> dict:
    """Guarda las líneas que el operador confirmó desde un catálogo."""
    n_prod = n_precio = 0
    with _lock:
        con = _conn()
        try:
            cat = con.execute("SELECT * FROM catalogos_correo WHERE id=?", (cat_id,)).fetchone()
            fecha = (cat["fecha"] if cat is not None and cat["fecha"] else _hoy())[:10]
            doc = f"catalogo#{cat_id}" if cat is not None else "catalogo"
            for ln in lineas or []:
                nom = (ln.get("nombre") or "").strip()
                if not nom:
                    continue
                prod_id = _upsert_producto(con, proveedor_id, nom, cas=str(ln.get("cas") or ""),
                                           presentacion=str(ln.get("presentacion") or ""),
                                           unidad=str(ln.get("unidad") or ""),
                                           linea=str(ln.get("linea") or linea or ""),
                                           origen_pais=str(ln.get("origen_pais") or origen_pais or ""),
                                           fuente="catalogo", referencia=doc)
                n_prod += 1
                if publicar_web or ln.get("publicar_web"):
                    con.execute("UPDATE proveedor_productos SET publicar_web=1 WHERE id=?", (prod_id,))
                precio = ln.get("precio")
                if precio:
                    if _registrar_precio(con, proveedor_id, prod_id, nom, fecha, float(precio),
                                         moneda=str(ln.get("moneda") or moneda), unidad=str(ln.get("unidad") or ""),
                                         fuente="catalogo", documento=doc):
                        n_precio += 1
            if cat is not None:
                con.execute("UPDATE catalogos_correo SET estado='importado', proveedor_id=?, n_lineas=n_lineas+? WHERE id=?",
                            (proveedor_id, n_prod, cat_id))
            con.commit()
        finally:
            con.close()
    return {"ok": True, "lineas": n_prod, "precios_nuevos": n_precio}


# ─────────────────────────── sitio web (scraping ligero, sin LLM) ───────────────────────────


def extraer_productos_desde_url(url: str, max_lineas: int = 500) -> dict:
    """Lista candidatos de producto desde una página de proveedor (títulos, ítems
    de lista, celdas). Es heurístico: el operador confirma antes de guardar."""
    import requests
    from bs4 import BeautifulSoup

    url = (url or "").strip()
    if not re.match(r"^https?://", url):
        return {"ok": False, "error": "URL inválida"}
    try:
        res = requests.get(url, timeout=25, headers={"User-Agent": "Mozilla/5.0 (McKenna catalog reader)"})
        res.raise_for_status()
    except Exception as e:
        return {"ok": False, "error": f"No se pudo descargar: {e}"}
    soup = BeautifulSoup(res.text, "lxml")
    for t in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        t.decompose()
    textos: list[str] = []
    for sel in ("h1", "h2", "h3", "h4", "li", "td", ".product-title", ".product-name", ".woocommerce-loop-product__title",
                "[class*=product] a", "[class*=producto] a"):
        for el in soup.select(sel):
            t = el.get_text(" ", strip=True)
            if t:
                textos.append(t)
    cands = _candidatos_desde_texto("\n".join(textos))
    vistos, unicos = set(), []
    for c in cands:
        k = normalizar(c["nombre"])
        if k in vistos or len(k) < 4:
            continue
        vistos.add(k)
        unicos.append(c)
    return {"ok": True, "url": url, "lineas": unicos[:max_lineas], "truncado": len(unicos) > max_lineas}


# ─────────────────────────── subcategorías (segundo nivel para la web) ───────────────────────────
# (linea, id, etiqueta, icono phosphor, palabras clave en el nombre normalizado). Se evalúan en
# orden dentro de la línea del producto; la primera que coincide gana. Sin coincidencia → "otros".
SUBCATEGORIAS: tuple[tuple[str, str, str, str, tuple[str, ...]], ...] = (
    # ── Alimentario ──
    ("alimentario", "frutos-secos", "Frutos secos y semillas", "acorn",
     ("almendra", "nuez", "nueces", "maranon", "marañon", "pistacho", "avellana", "macadamia", "mani", "cacahuate", "pecan",
      "ajonjoli", "sesamo", "chia", "linaza", "lino", "girasol", "calabaza", "amaranto", "quinua", "quinoa", "semilla",
      "castaña", "pepa", "pipa", "mix", "mezcla de frutos", "anacardo")),
    ("alimentario", "frutas-deshidratadas", "Frutas deshidratadas y conservas", "orange-slice",
     ("arandano", "cranberry", "datil", "albaricoque", "ciruela", "pasas", "uva", "higo", "mango", "papaya", "piña", "pina",
      "cereza", "durazno", "melocoton", "coco", "aceituna", "alcaparra", "conserva", "deshidratad", "banano", "fresa", "kiwi",
      "goji", "mora", "maracuya", "fruta", "fruto", "jengibre confitado", "pulpa", "enlatado", "mermelada")),
    ("alimentario", "cereales-harinas", "Cereales, harinas y granos", "grains",
     ("avena", "arroz", "harina", "cereal", "grano", "trigo", "centeno", "cebada", "mijo", "sorgo", "granola", "lenteja",
      "garbanzo", "arveja", "guisante", "fecula", "almidon", "maiz", "soya", "soja", "salvado", "germen", "hojuela")),
    ("alimentario", "especias", "Especias, sales y condimentos", "pepper",
     ("anis", "canela", "cardamomo", "curcuma", "jengibre", "pimienta", "comino", "laurel", "clavo", "nuez moscada", "paprika",
      "pimenton", "oregano", "tomillo", "romero", "especia", "hierba", "aji", "ajo", "cebolla", "perejil", "albahaca", "sal ",
      "himalaya", "glutamato", "condimento", "sazonador", "adobo", "mostaza", "vainilla en", "cilantro", "eneldo", "azafran")),
    ("alimentario", "chocolate-confiteria", "Chocolate y confitería", "cookie",
     ("chocolate", "chocodisco", "cocoa", "cacao", "cobertura", "grageas", "corazones", "recubierto", "confit", "caramelo", "sprinkles",
      "chispas", "gomitas", "malvavisco", "turron", "galleta", "wafer")),
    ("alimentario", "edulcorantes", "Edulcorantes y azúcares", "drop-half",
     ("azucar", "sucralosa", "stevia", "alulosa", "eritritol", "acesulfame", "aspartame", "sacarina", "glucosa", "jarabe",
      "dextrosa", "fructosa", "fructuosa", "sacarosa", "panela", "miel", "maltodextrina", "maltitol", "sorbitol", "xilitol",
      "isomalt", "lactosa", "dextrina", "endulzante", "edulcorante", "tagatosa", "trehalosa")),
    ("alimentario", "proteinas-aminoacidos", "Proteínas y aminoácidos", "barbell",
     ("proteina", "whey", "suero", "caseina", "caseinato", "albumina", "colageno", "gelatina", "aminoacido", "bcaa",
      "arginina", "carnitina", "creatina", "glutamina", "prolina", "taurina", "leucina", "lisina", "glicina", "soypro",
      "aislado", "concentrado", "peptona", "pea protein", "arveja proteina")),
    ("alimentario", "vitaminas-minerales", "Vitaminas, minerales y suplementos", "pill",
     ("vitamina", "cianocobalamina", "biotina", "folico", "niacina", "riboflavina", "tiamina", "ascorbico", "citrato",
      "gluconato", "magnesio", "calcio", "zinc", "hierro", "selenio", "cromo", "potasio", "omega", "melatonina", "probiotico",
      "prebiotico", "inulina", "fibra", "fos", "fructooligo", "coenzima", "ginseng", "espirulina", "moringa", "colina",
      "carbonato de", "cloruro de magnesio", "lactato de calcio", "sulfato de zinc", "oxido de magnesio", "yodo",
      "psyllium", "inositol", "msm", "sulfonil metano", "pro-b", "gluten", "cremor tartaro", "cafeina", "extracto",
      "matcha", "te verde", "sweet")),
    ("alimentario", "gomas-espesantes", "Gomas, espesantes y estabilizantes", "drop",
     ("goma", "xantana", "xanthan", "guar", "arabiga", "pectina", "carragenina", "agar", "alginato", "cmc", "carboximetil",
      "celulosa", "lecitina", "emulsificante", "emulsionante", "estabilizante", "gelificante", "konjac", "tara", "garrofin",
      "algarrobo", "gellan", "hidrocoloide", "monogliceridos", "mono y di")),
    ("alimentario", "conservantes-acidulantes", "Conservantes, acidulantes y fosfatos", "shield-check",
     ("benzoato", "sorbato", "propionato", "nitrito", "nitrato", "eritorbato", "ascorbato", "natamicina", "nisina", "acido",
      "acidulante", "conservante", "metabisulfito", "bicarbonato", "fosfato", "pirofosfato", "tripolifosfato", "hexameta",
      "antioxidante", "bht", "tbhq", "acetato de sodio", "lactato de sodio", "diacetato", "sulfito")),
    ("alimentario", "saborizantes-colorantes", "Saborizantes, aromas y colorantes", "palette",
     ("sabor", "saborizante", "vainillina", "vainilla", "colorante", "color ", "caramelo liquido", "aroma", "esencia",
      "extracto de", "tartrazina", "carmin", "curcumina", "annato", "achiote", "clorofila", "betacaroteno", "dioxido de titanio")),
    ("alimentario", "conservas-preparados", "Conservas, encurtidos y alimentos preparados", "jar",
     ("atun", "brevas", "champiñon", "champinon", "jalapeño", "jalapeno", "pepinillo", "salchicha", "sardina", "tomate seco",
      "habas", "manzana en cubos", "fruta cristalizada", "limonada", "pasta", "encurtido", "almibar", "salsa", "enlatado")),
    ("alimentario", "lacteos-huevo", "Lácteos y huevo", "egg",
     ("leche", "queso", "mantequilla", "crema", "huevo", "yogur", "nata", "lactosuero")),
    ("alimentario", "enzimas-fermentos", "Enzimas, fermentos y cultivos", "flask",
     ("enzima", "levadura", "transglutaminasa", "cuajo", "fermento", "amilasa", "proteasa", "lactasa", "cultivo", "pectinasa")),
    # ── Cosmética ──
    ("cosmetica", "acidos", "Ácidos y exfoliantes", "test-tube",
     ("acido glicolico", "acido salicilico", "acido lactico", "acido azelaico", "acido mandelico", "acido kojico", "acido malico",
      "acido citrico", "acido ascorbico", "acido tranexamico", "acido ferulico", "acido lactobionico", "acido", "aha", "bha ")),
    ("cosmetica", "activos", "Activos y principios cosméticos", "sparkle",
     ("niacinamida", "retinol", "pantenol", "alantoina", "hialuronico", "arbutina", "resveratrol", "coenzima", "peptido",
      "ceramida", "cafeina", "papaina", "colageno", "elastina", "keratina", "queratina", "biotina", "escualano", "vitamina",
      "tocoferol", "dihidroxiacetona", "mentol", "bakuchiol", "argireline", "matrixyl", "adenosina", "centella", "bisabolol",
      "urea", "glutation", "acetil", "zinc pca", "activo", "piritionato", "alcanfor", "benjui", "salicilato de metilo",
      "gusano de seda", "mentol", "cafeina")),
    ("cosmetica", "humectantes-emolientes", "Humectantes y emolientes", "drop",
     ("glicerina", "propilenglicol", "dipropilenglicol", "butilenglicol", "sorbitol", "vaselina", "miristato", "palmitato",
      "isopropil", "dimeticona", "silicona", "ciclometicona", "caprilico", "triglicerido", "emoliente", "humectante",
      "lanolina", "pentilenglicol", "hexilenglicol", "pca", "betaina")),
    ("cosmetica", "emulsionantes-ceras", "Emulsionantes y ceras cosméticas", "circles-three",
     ("btms", "lanette", "cetilico", "cetoestearilico", "estearilico", "estearico", "monoestearato", "span", "tween",
      "polisorbato", "emulsionante", "emulsificante", "glicerilo", "olivem", "montanov", "cera emulsionante", "ceteareth",
      "steareth", "polawax", "emulgin", "eumulgin", "cutina", "lecitina", "arlacel", "emulan", "comperlan", "eutanol",
      "sorbitan", "lactilato", "aperlante", "nacarante", "enturbiante", "acrisol")),
    ("cosmetica", "tensoactivos", "Tensoactivos y limpiadores", "waves",
     ("tensoactivo", "tenso", "cocoamida", "cocamidopropil", "sci", "lauril", "laureth", "sulfonato", "sles", "sls",
      "texapon", "glucosido", "decyl", "sarcosinato", "isetionato", "sulfosuccinato", "genapol", "espumante", "jabon")),
    ("cosmetica", "conservantes", "Conservantes y antioxidantes", "shield-check",
     ("fenoxietanol", "parabeno", "sharomix", "optiphen", "germall", "bht", "bha", "edta", "conservante", "benzoato",
      "sorbato", "sodium benzoate", "caprylyl", "etilhexilglicerina", "geogard", "cosgard", "euxyl", "dmdm", "kathon",
      "acido dehidroacetico", "antioxidante")),
    ("cosmetica", "espesantes", "Espesantes y formadores de película", "stack",
     ("carbomero", "carbopol", "hidroxietilcelulosa", "hec", "cmc", "pvp", "polivinil", "xantana", "xanthan", "gelificante",
      "acrilato", "aristoflex", "sepimax", "sepigel", "ultrez", "goma", "alginato", "carragenina", "espesante",
      "natrosol", "cellosize", "hidroxietil", "carboximetil", "veegum", "veegun", "tixotrol")),
    ("cosmetica", "minerales-pigmentos", "Minerales, pigmentos y arcillas", "paint-brush",
     ("arcilla", "caolin", "bentonita", "talco", "mica", "pigmento", "oxido de zinc", "dioxido de titanio", "oxido de hierro",
      "colorante", "glitter", "perlado", "ultramarino", "carbon vegetal", "magnesio estearato", "silica")),
    ("cosmetica", "fragancias", "Fragancias y aromas", "flower-lotus",
     ("fragancia", "aroma", "perfume", "esencia aromatica", "escencia", "essence", "acorde", "almizcle", "musk", "vainillina")),
    ("cosmetica", "extractos", "Extractos botánicos y aguas florales", "leaf",
     ("extracto", "aloe", "agua floral", "hidrolato", "agua de rosas", "matcha", "manzanilla", "calendula", "te verde", "flores secas", "lavanda",
      "romero extracto", "ginkgo", "botanico", "propoleo", "miel", "avena coloidal", "bambu", "camu", "cafe")),
    # ── Aceites, ceras y grasas ──
    ("aceites-ceras-grasas", "aceites-esenciales", "Aceites esenciales", "flower",
     ("aceite esencial", "esencial", "acete esencial", "limoneno", "eucalipto", "lavanda", "ylang", "arbol de te", "menta",
      "romero", "tomillo", "clavo", "jazmin", "naranja", "mandarina", "limon", "hierba buena", "albahaca", "cedro", "pino",
      "trementina", "citronela", "canela", "sandalo", "patchouli", "bergamota", "geranio", "manzanilla", "incienso")),
    ("aceites-ceras-grasas", "ceras", "Ceras", "hexagon",
     ("cera", "carnauba", "abejas", "candelilla", "parafina", "microcristalina", "ozoquerita", "cera de soya", "cera de arroz")),
    ("aceites-ceras-grasas", "mantecas-grasas", "Mantecas y grasas", "cube",
     ("manteca", "karite", "shea", "cacao", "mango", "sebo", "cebo", "grasa", "laurica", "lanolina", "hidrogenado", "hidrog",
      "cupuacu", "murumuru", "babasu", "cupuazu")),
    ("aceites-ceras-grasas", "minerales-siliconas", "Aceites minerales y siliconas", "circle-dashed",
     ("mineral", "silicona", "vaselina", "petrolato", "dimeticona")),
    ("aceites-ceras-grasas", "aceites-vegetales", "Aceites vegetales y portadores", "drop",
     ("aceite", "argan", "jojoba", "ricino", "almendra", "coco", "girasol", "linaza", "neem", "semilla de uva", "oliva",
      "palmiste", "mct", "escualano", "rosa mosqueta", "aguacate", "chia", "sesamo", "ajonjoli", "calendula", "onagra",
      "borraja", "canola", "soya", "maiz", "palma", "cañamo", "moringa", "nuez")),
    # ── Industria ──
    ("industria", "solventes", "Solventes", "beaker",
     ("alcohol etilico", "etanol", "isopropilico", "isopropanol", "acetona", "tolueno", "xileno", "hexano", "metanol",
      "butanol", "thinner", "varsol", "trementina", "glicol", "limoneno", "acetato de etilo", "acetato de butilo", "solvente",
      "disolvente", "mek", "metil etil", "cloruro de metileno", "diclorometano", "alcohol", "percloroetileno",
      "tricloroetileno", "isoforona", "isopar", "dowanol", "proxitol", "formamida", "fenol", "freon")),
    ("industria", "acidos-bases", "Ácidos y bases", "thermometer-hot",
     ("acido", "soda", "caustica", "hidroxido", "potasa", "amoniaco", "amonio hidroxido", "cal ", "cal viva", "cal hidratada",
      "carbonato de sodio", "base")),
    ("industria", "oxidos-oxidantes", "Óxidos, peróxidos y oxidantes", "fire",
     ("oxido", "peroxido", "percarbonato", "hipoclorito", "cloro", "dioxido", "permanganato", "dicromato", "clorito",
      "perborato", "oxidante", "agua oxigenada")),
    ("industria", "sales-minerales", "Sales y minerales industriales", "diamond",
     ("sulfato", "cloruro", "nitrato", "carbonato", "silicato", "fosfato", "sal industrial", "zeolita", "bentonita", "alumbre",
      "formiato", "acetato", "fluoruro", "bifloruro", "bifluoruro", "molibdato", "bisulfito", "tiosulfato", "sulfito",
      "bromuro", "yoduro", "borax", "bicarbonato", "metabisulfito", "nitrito", "sal ", "azufre", "bicromato", "mercurio",
      "diatomita", "tierras filtrantes")),
    ("industria", "tensoactivos-limpieza", "Tensoactivos y limpieza", "sparkle",
     ("tensoactivo", "desengrasante", "detergente", "jabon", "nonil", "etoxilado", "antiespumante", "secuestrante", "lauril",
      "sulfonato", "cuaternario", "benzalconio", "limpiador", "desinfectante", "amonio cuaternario", "laureth", "sles",
      "texapon", "betaina", "cocoamida", "abrillantador", "suavizante", "edta", "creolina", "desinfectante", "benzalconio",
      "triclosan", "irgasan", "nivelador", "surfactante", "dowfax", "praepagen")),
    ("industria", "conservantes-biocidas", "Conservantes y biocidas", "shield-check",
     ("glutaraldehido", "formol", "formaldehido", "biocida", "isotiazolinona", "kathon", "bronopol", "benzoato", "sorbato",
      "fungicida", "bactericida", "conservante", "triclosan", "clorhexidina", "yodo")),
    ("industria", "resinas-polimeros", "Resinas, polímeros y pigmentos", "paint-bucket",
     ("resina", "polimero", "latex", "pigmento", "tinte", "colorante", "poliuretano", "epoxi", "epoxica", "acrilico",
      "pvc", "polietileno", "poliester", "silicona", "adhesivo", "pegante", "cola ", "gelcoat", "fibra de vidrio", "estireno",
      "dispersion", "primal", "poligen", "polimer", "removedor", "colofonia", "negro de humo", "duraplus", "bacoxin",
      "slendor", "snowflake", "macccx")),
    ("industria", "aminas-plastificantes", "Aminas, plastificantes y anhídridos", "circuitry",
     ("etanolamina", "amina", "ftalato", "plastificante", "anhidrido", "isocianato", "poliol")),
    ("industria", "reactivos", "Reactivos y especialidades", "atom",
     ("azul metileno", "indicador", "reactivo", "catalizador", "urea", "glicerina", "propilenglicol", "aditivo", "anticorrosivo",
      "inhibidor", "lubricante", "refrigerante", "freon", "gas", "carbon activado", "sharomix", "dpg")),
    # ── Laboratorio ──
    ("laboratorio", "vidrieria", "Vidriería y material de laboratorio", "flask",
     ("beaker", "vaso", "probeta", "pipeta", "erlenmeyer", "matraz", "bureta", "embudo", "espatula", "gotero", "agitador",
      "tubo de ensayo", "frasco", "ambar", "vidrio", "revolvedor", "cuchara", "mortero", "gradilla", "caja petri", "vial")),
    ("laboratorio", "equipos", "Equipos e instrumentos", "gauge",
     ("balanza", "gramera", "equipo", "maquina", "encapsuladora", "tableteadora", "viscosimetro", "phmetro", "ph metro",
      "termometro", "filtracion", "mezclador", "homogeneizador", "estufa", "centrifuga", "microscopio", "refractometro",
      "plancha", "calentador", "bomba", "selladora")),
    ("laboratorio", "capsulas-excipientes", "Cápsulas y excipientes farmacéuticos", "pill",
     ("capsula", "excipiente", "celulosa microcristalina", "estearato de magnesio", "estearato de calcio", "aerosil", "silica",
      "silicio", "talco", "lactosa", "povidona", "croscarmelosa", "glicolato", "manitol", "hpmc", "gelatina", "pullulan",
      "liner", "desecante", "pirosil", "licomer")),
    ("laboratorio", "activos-farma", "Principios activos farmacéuticos", "first-aid",
     ("acetaminofen", "ibuprofeno", "paracetamol", "fenilefrina", "loratadina", "api", "usp activo", "diclofenaco", "naproxeno",
      "cetirizina", "omeprazol", "metformina", "amoxicilina", "dexametasona", "clotrimazol", "ketoconazol", "aspirina",
      "benzocaina", "bisacodilo", "guayacolato", "meloxicam", "nitazoxanida", "pamoato", "piroxicam", "sildenafil",
      "simeticona", "tadalafil", "principios activos")),
    ("laboratorio", "estandares-reactivos", "Estándares y reactivos analíticos", "atom",
     ("estandar", "reactivo", "patron", "buffer", "indicador", "referencia", "solucion valorada", "titulante")),
    ("laboratorio", "kits", "Kits y sets", "package", ("kit", "set ", "combo")),
    # ── Agro ──
    ("agro", "fertilizantes", "Fertilizantes y nutrición vegetal", "plant",
     ("fertiliz", "abono", "npk", "urea", "nitrato", "fosfato", "sulfato", "molibdato", "quelato", "foliar", "hidroponia",
      "humus", "algas", "aminoacido")),
    ("agro", "control-biologico", "Control biológico y sanidad vegetal", "bug",
     ("potasico", "jabon", "neem", "trichoderma", "bacillus", "beauveria", "extracto", "insecticida", "fungicida",
      "acaricida", "repelente", "feromona", "azufre", "cobre")),
    ("agro", "sustratos", "Enmiendas y sustratos", "shovel",
     ("sustrato", "turba", "perlita", "vermiculita", "carbon", "cal ", "yeso", "zeolita", "fibra de coco", "biochar")),
)

_SUB_OTROS = {
    "alimentario": ("otros", "Otros ingredientes alimentarios", "grains"),
    "cosmetica": ("otros", "Otros insumos cosméticos", "sparkle"),
    "aceites-ceras-grasas": ("otros", "Otros aceites y grasas", "drop"),
    "industria": ("otros", "Otros químicos industriales", "factory"),
    "laboratorio": ("otros", "Otros de laboratorio", "flask"),
    "agro": ("otros", "Otros insumos agro", "plant"),
    "": ("otros", "Otras materias primas", "cube"),
}
_SUB_INDICE = {(lid, sid): (etq, ico) for lid, sid, etq, ico, _ in SUBCATEGORIAS}


def subcategoria_de(nombre: str, linea: str) -> dict:
    """Segundo nivel de clasificación para la web: {id, label, icono, orden}."""
    n = " " + normalizar(nombre) + " "
    orden = 0
    for lid, sid, etq, ico, kws in SUBCATEGORIAS:
        if lid != linea:
            continue
        orden += 1
        for kw in kws:
            k = kw if kw.endswith(" ") else kw
            if k in n:
                return {"id": sid, "label": etq, "icono": ico, "orden": orden}
    sid, etq, ico = _SUB_OTROS.get(linea, _SUB_OTROS[""])
    return {"id": sid, "label": etq, "icono": ico, "orden": 99}


# ─────────────────────────── comparador de proveedores ───────────────────────────


def clave_canon(nombre: str) -> str:
    """Llave para cruzar el mismo producto entre proveedores: nombre público
    normalizado (sin marca, presentación ni códigos)."""
    return normalizar(nombre_publico(nombre))


def comparar_proveedores(ids: list[int] | None = None, q: str = "", minimo: int = 2, limite: int = 400) -> dict:
    """Matriz producto × proveedor. Filas = productos (clave canónica) presentes en
    ≥ `minimo` de los proveedores considerados; celdas = último precio por proveedor."""
    con = _conn()
    try:
        params: list = []
        sql = """SELECT pp.id, pp.proveedor_id, pp.nombre, pp.linea, pp.cas, p.nombre AS proveedor, p.pais,
                        (SELECT precio_unitario FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave ORDER BY fecha DESC, id DESC LIMIT 1) AS ultimo_precio,
                        (SELECT moneda FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave ORDER BY fecha DESC, id DESC LIMIT 1) AS moneda,
                        (SELECT fecha FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave ORDER BY fecha DESC, id DESC LIMIT 1) AS fecha,
                        (SELECT COUNT(*) FROM precios_historicos ph WHERE ph.proveedor_id=pp.proveedor_id AND ph.clave=pp.clave) AS n_compras
                 FROM proveedor_productos pp JOIN proveedores p ON p.id=pp.proveedor_id WHERE p.activo=1"""
        if ids:
            sql += f" AND pp.proveedor_id IN ({','.join('?' * len(ids))})"; params += [int(i) for i in ids]
        rows = [dict(r) for r in con.execute(sql, params).fetchall()]
    finally:
        con.close()
    qn = normalizar(q) if q else ""
    provs: dict[int, dict] = {}
    filas: dict[str, dict] = {}
    for r in rows:
        if not es_materia_prima(r["nombre"]):
            continue
        canon = clave_canon(r["nombre"])
        if not canon or (qn and qn not in canon and qn not in normalizar(r["nombre"])):
            continue
        pv = provs.setdefault(r["proveedor_id"], {"id": r["proveedor_id"], "nombre": r["proveedor"], "pais": r["pais"], "n_productos": 0})
        pv["n_productos"] += 1
        f = filas.setdefault(canon, {"clave": canon, "nombre": nombre_publico(r["nombre"]), "linea": r["linea"], "cas": r["cas"], "celdas": {}})
        f["linea"] = f["linea"] or r["linea"]
        f["cas"] = f["cas"] or r["cas"]
        celda = f["celdas"].get(r["proveedor_id"])
        if celda is None or (r["ultimo_precio"] and not celda.get("ultimo_precio")):
            f["celdas"][r["proveedor_id"]] = {"producto_id": r["id"], "nombre": r["nombre"], "ultimo_precio": r["ultimo_precio"],
                                              "moneda": r["moneda"] or "", "fecha": r["fecha"] or "", "n_compras": r["n_compras"] or 0}
    out = []
    for f in filas.values():
        f["n_proveedores"] = len(f["celdas"])
        if f["n_proveedores"] < max(1, minimo):
            continue
        precios = {pid: c["ultimo_precio"] for pid, c in f["celdas"].items() if c["ultimo_precio"] and (c["moneda"] or "COP") == "COP"}
        f["mejor_pid"] = min(precios, key=precios.get) if precios else None
        f["celdas"] = {str(k): v for k, v in f["celdas"].items()}
        out.append(f)
    out.sort(key=lambda f: (-f["n_proveedores"], f["nombre"].lower()))
    return {"proveedores": sorted(provs.values(), key=lambda p: -p["n_productos"]), "filas": out[:limite], "total_filas": len(out)}


def matriz_coincidencias(top: int = 14) -> dict:
    """Cuántos productos comparten cada par de proveedores (por clave canónica)."""
    con = _conn()
    try:
        rows = con.execute("""SELECT pp.proveedor_id, pp.nombre, p.nombre AS proveedor FROM proveedor_productos pp
                              JOIN proveedores p ON p.id=pp.proveedor_id WHERE p.activo=1""").fetchall()
    finally:
        con.close()
    sets: dict[int, set] = {}
    nombres: dict[int, str] = {}
    for r in rows:
        if not es_materia_prima(r["nombre"]):
            continue
        c = clave_canon(r["nombre"])
        if c:
            sets.setdefault(r["proveedor_id"], set()).add(c)
            nombres[r["proveedor_id"]] = r["proveedor"]
    ids = sorted(sets, key=lambda i: -len(sets[i]))[:top]
    pares = []
    matriz: dict[str, dict[str, int]] = {}
    for i, a in enumerate(ids):
        matriz[str(a)] = {}
        for b in ids:
            n = len(sets[a] & sets[b]) if a != b else len(sets[a])
            matriz[str(a)][str(b)] = n
            if b in ids[i + 1:] and n:
                pares.append({"a": a, "b": b, "a_nombre": nombres[a], "b_nombre": nombres[b], "n": n})
    pares.sort(key=lambda x: -x["n"])
    return {"proveedores": [{"id": i, "nombre": nombres[i], "n_productos": len(sets[i])} for i in ids], "pares": pares[:40], "matriz": matriz}


# ─────────────────────────── clasificación heurística (sin LLM) ───────────────────────────

# (palabra clave en el nombre normalizado → país de origen habitual). Referencia
# inicial; el operador la puede corregir por producto desde el panel.
_REGLAS_ORIGEN: tuple[tuple[str, str], ...] = (
    ("argan", "Marruecos"), ("jojoba", "Argentina"), ("ricino", "India"), ("neem", "India"), ("karite", "Ghana"),
    ("carnauba", "Brasil"), ("lanolina", "Nueva Zelanda"), ("sebo", "Argentina"), ("girasol", "Argentina"),
    ("linaza", "Argentina"), ("uva", "Chile"), ("arandano", "Chile"), ("alginato", "Chile"), ("nuez", "Bolivia"),
    ("almendra", "Estados Unidos"), ("coco", "Indonesia"), ("carbon activado", "Indonesia"), ("glicerina", "Malasia"),
    ("tween", "Malasia"), ("polisorbato", "Malasia"), ("cocoamida", "Malasia"), ("betaina", "Malasia"),
    ("tensoactivo", "Malasia"), ("cetilico", "Malasia"), ("estearico", "Malasia"), ("palmitico", "Malasia"),
    ("btms", "Alemania"), ("lanette", "Alemania"), ("retinol", "Alemania"), ("pantenol", "Alemania"),
    ("dihidroxiacetona", "Alemania"), ("sharomix", "Alemania"), ("glutaraldehido", "Alemania"), ("bha", "Alemania"),
    ("alantoina", "China"), ("niacinamida", "China"), ("hialuronico", "China"), ("kojico", "Japón"),
    ("glicolico", "China"), ("lactico", "Países Bajos"), ("salicilico", "China"), ("azelaico", "India"),
    ("mandelico", "India"), ("malico", "China"), ("citrico", "China"), ("ascorbico", "China"), ("benzoico", "China"),
    ("fumarico", "China"), ("tartarico", "Italia"), ("cafeina", "China"), ("papaina", "India"), ("matcha", "Japón"),
    ("aloe", "México"), ("lavanda", "Francia"), ("mentol", "India"), ("cianocobalamina", "China"), ("vitamina", "China"),
    ("titanio", "China"), ("zinc", "Perú"), ("taurina", "China"), ("soypro", "Estados Unidos"), ("texapon", "Alemania"), ("pro-b", "Estados Unidos"), ("caolin", "Estados Unidos"), ("arcilla", "Francia"),
    ("elastina", "Brasil"), ("colageno", "Brasil"), ("agua rosas", "Turquía"), ("rosa", "Turquía"),
    ("aceite esencial", "India"), ("esencia", "India"), ("eucalipto", "China"), ("limon", "Argentina"),
    ("naranja", "Brasil"), ("mandarina", "Brasil"), ("ylang", "Indonesia"), ("cedro", "Estados Unidos"),
    ("arbol de te", "Australia"), ("romero", "España"), ("tomillo", "España"), ("clavo", "Indonesia"),
    ("jazmin", "Egipto"), ("albahaca", "India"), ("menta", "India"), ("mineral", "Estados Unidos"),
    ("vaselina", "Estados Unidos"), ("parafina", "China"), ("albumina", "Estados Unidos"), ("bcaa", "China"),
    ("arginina", "China"), ("carnitina", "China"), ("creatina", "China"), ("glutamina", "China"),
    ("aminoacido", "China"), ("proteina", "Estados Unidos"), ("suero", "Estados Unidos"), ("lecitina", "Estados Unidos"),
    ("dextrosa", "Estados Unidos"), ("fructosa", "Estados Unidos"), ("sucralosa", "China"), ("alulosa", "Corea del Sur"),
    ("stevia", "China"), ("inulina", "Países Bajos"), ("goma guar", "Pakistán"), ("guar", "Pakistán"),
    ("xantana", "China"), ("arabiga", "Egipto"), ("gelatina", "Brasil"), ("capsula", "India"),
    ("bicarbonato", "Turquía"), ("carbonato", "China"), ("citrato", "China"), ("cloruro", "Países Bajos"),
    ("lactato", "Países Bajos"), ("glutamato", "Indonesia"), ("sabor", "México"), ("benzoato", "Países Bajos"),
    ("sorbato", "China"), ("propilenglicol", "Estados Unidos"), ("azul metileno", "India"), ("urea", "China"),
    ("sorbitol", "Francia"), ("edta", "China"), ("fenoxietanol", "Alemania"), ("carbomer", "China"),
    ("carbopol", "Estados Unidos"), ("hidroxido", "China"), ("sulfato", "China"), ("peroxido", "Alemania"),
    ("alcohol", "Colombia"), ("agua", "Colombia"), ("cera abeja", "Colombia"), ("cacao", "Colombia"),
    ("ajonjoli", "India"), ("avena", "Chile"), ("goji", "China"), ("semilla", "China"), ("agar", "Chile"),
    ("celulosa", "Alemania"), ("maltodextrina", "China"), ("sesamo", "India"), ("chia", "Bolivia"), ("quinua", "Bolivia"),
    ("quinoa", "Bolivia"), ("cacahuete", "Bolivia"), ("mani", "Bolivia"), ("pistacho", "Estados Unidos"),
    ("nuez", "Bolivia"), ("datil", "Egipto"), ("canela", "Indonesia"), ("cardamomo", "India"), ("curcuma", "India"),
    ("jengibre", "China"), ("pimienta", "Vietnam"), ("colorante", "India"), ("lauril", "Malasia"),
    ("fragancia", "España"), ("aroma", "España"), ("eritritol", "China"), ("estearato", "Malasia"),
    ("vainillina", "China"), ("cebo", "Argentina"), ("farma", "China"), ("ambar", "China"), ("cristal", "China"),
    ("himalaya", "Pakistán"), ("sal ", "Pakistán"), ("oxido de hierro", "China"), ("hipoclorito", "Colombia"),
    ("metabisulfito", "China"), ("molibdato", "China"), ("leche", "Nueva Zelanda"), ("flores", "Francia"),
    ("grasa", "Malasia"), ("laurica", "Malasia"), ("potasa", "Estados Unidos"), ("harina", "Colombia"),
    ("kernel", "Argentina"), ("agitador", "China"), ("beaker", "China"), ("vaso", "China"), ("espatula", "China"), ("gotero", "China"),
    ("envase", "China"), ("frasco", "China"), ("balanza", "China"), ("gramera", "China"),
)
_REGLAS_LINEA: tuple[tuple[str, str], ...] = (
    # farma (APIs y excipientes) → laboratorio
    ("benzocaina", "laboratorio"), ("bisacodilo", "laboratorio"), ("cetirizina", "laboratorio"), ("diclofenaco", "laboratorio"),
    ("fenilefrina", "laboratorio"), ("guayacolato", "laboratorio"), ("meloxicam", "laboratorio"), ("nitazoxanida", "laboratorio"),
    ("pamoato", "laboratorio"), ("piroxicam", "laboratorio"), ("sildenafil", "laboratorio"), ("simeticona", "laboratorio"),
    ("tadalafil", "laboratorio"), ("principios activos", "laboratorio"), ("croscarmelosa", "laboratorio"),
    ("celulosa microcristalina", "laboratorio"), ("estearato de magnesio", "laboratorio"), ("estearato de calcio", "laboratorio"),
    ("dioxido de silicio", "laboratorio"), ("pirosil", "laboratorio"), ("licomer", "laboratorio"), ("capsula", "laboratorio"),
    # cosmética: emulsionantes / espesantes / activos de marca
    ("arlacel", "cosmetica"), ("eumulgin", "cosmetica"), ("emulan", "cosmetica"), ("comperlan", "cosmetica"), ("eutanol", "cosmetica"),
    ("sorbitan", "cosmetica"), ("lactilato", "cosmetica"), ("aperlante", "cosmetica"), ("nacarante", "cosmetica"),
    ("enturbiante", "cosmetica"), ("natrosol", "cosmetica"), ("cellosize", "cosmetica"), ("hidroxietil", "cosmetica"),
    ("carboximetil", "cosmetica"), ("veegum", "cosmetica"), ("veegun", "cosmetica"), ("tixotrol", "cosmetica"),
    ("piritionato", "cosmetica"), ("alcanfor", "cosmetica"), ("benjui", "cosmetica"), ("salicilato de metilo", "cosmetica"),
    ("flores secas", "cosmetica"), ("gusano de seda", "cosmetica"), ("escencia", "cosmetica"), ("acrisol", "cosmetica"),
    # industria: solventes, aminas, plastificantes, resinas, sales, limpieza
    ("cloruro de metileno", "industria"), ("percloroetileno", "industria"), ("tricloroetileno", "industria"), ("isoforona", "industria"),
    ("isopar", "industria"), ("dowanol", "industria"), ("proxitol", "industria"), ("formamida", "industria"), ("fenol", "industria"),
    ("etanolamina", "industria"), ("ftalato", "industria"), ("plastificante", "industria"), ("anhidrido", "industria"),
    ("colofonia", "industria"), ("negro de humo", "industria"), ("pintura", "industria"), ("poliuretano", "industria"),
    ("dispersion", "industria"), ("primal", "industria"), ("poligen", "industria"), ("polimer", "industria"), ("removedor", "industria"),
    ("alumbre", "industria"), ("borax", "industria"), ("bicromato", "industria"), ("bifloruro", "industria"), ("bifluoruro", "industria"),
    ("cloruro de amonio", "industria"), ("fluoruro", "industria"), ("formiato", "industria"), ("azufre", "industria"),
    ("mercurio", "industria"), ("creolina", "industria"), ("desinfectante", "industria"), ("benzalconio", "industria"),
    ("triclosan", "industria"), ("irgasan", "industria"), ("suavizante", "industria"), ("nivelador", "industria"),
    ("surfactante", "industria"), ("dowfax", "industria"), ("praepagen", "industria"), ("diatomita", "industria"),
    ("tierras filtrantes", "industria"), ("freon", "industria"), ("duraplus", "industria"), ("bacoxin", "industria"),
    ("slendor", "industria"), ("snowflake", "industria"), ("macccx", "industria"),
    # alimentario: conservas, snacks y suplementos
    ("atun", "alimentario"), ("brevas", "alimentario"), ("champiñon", "alimentario"), ("champinon", "alimentario"),
    ("chocodisco", "alimentario"), ("cremor", "alimentario"), ("cristalizada", "alimentario"), ("gluten", "alimentario"),
    ("habas", "alimentario"), ("jalapeño", "alimentario"), ("jalapeno", "alimentario"), ("limonada", "alimentario"),
    ("manzana", "alimentario"), ("pasta", "alimentario"), ("pepinillo", "alimentario"), ("salchicha", "alimentario"),
    ("sardina", "alimentario"), ("tomate", "alimentario"), ("psyllium", "alimentario"), ("inositol", "alimentario"),
    ("msm", "alimentario"), ("sulfonil metano", "alimentario"), ("pro-b", "alimentario"), ("sweet", "alimentario"),
    ("aceite", "aceites-ceras-grasas"), ("esencia", "aceites-ceras-grasas"), ("cera", "aceites-ceras-grasas"),
    ("manteca", "aceites-ceras-grasas"), ("lanolina", "aceites-ceras-grasas"), ("sebo", "aceites-ceras-grasas"),
    ("parafina", "aceites-ceras-grasas"), ("vaselina", "aceites-ceras-grasas"),
    ("beaker", "laboratorio"), ("vaso", "laboratorio"), ("espatula", "laboratorio"), ("gotero", "laboratorio"),
    ("agitador", "laboratorio"), ("probeta", "laboratorio"), ("pipeta", "laboratorio"), ("balanza", "laboratorio"),
    ("gramera", "laboratorio"), ("kit", "laboratorio"), ("envase", "laboratorio"), ("frasco", "laboratorio"),
    ("fertiliz", "agro"), ("abono", "agro"), ("humus", "agro"), ("foliar", "agro"), ("potasico", "agro"),
    ("aminoacido", "alimentario"), ("proteina", "alimentario"), ("suero", "alimentario"), ("goma", "alimentario"),
    ("gelatina", "alimentario"), ("capsula", "alimentario"), ("sabor", "alimentario"), ("dextrosa", "alimentario"),
    ("fructosa", "alimentario"), ("sucralosa", "alimentario"), ("stevia", "alimentario"), ("alulosa", "alimentario"),
    ("inulina", "alimentario"), ("citrato", "alimentario"), ("carbonato", "alimentario"), ("bicarbonato", "alimentario"),
    ("cloruro", "alimentario"), ("lactato", "alimentario"), ("lecitina", "alimentario"), ("glutamato", "alimentario"),
    ("colageno", "alimentario"), ("creatina", "alimentario"), ("glutamina", "alimentario"), ("bcaa", "alimentario"),
    ("albumina", "alimentario"), ("almidon", "alimentario"), ("vitamina", "alimentario"),
    ("ajonjoli", "alimentario"), ("avena", "alimentario"), ("goji", "alimentario"), ("semilla", "alimentario"),
    ("agar", "alimentario"), ("maltodextrina", "alimentario"), ("sesamo", "alimentario"), ("chia", "alimentario"),
    ("quinua", "alimentario"), ("quinoa", "alimentario"), ("mani", "alimentario"), ("pistacho", "alimentario"),
    ("nuez", "alimentario"), ("almendra", "alimentario"), ("arandano", "alimentario"), ("coco", "alimentario"),
    ("datil", "alimentario"), ("canela", "alimentario"), ("cardamomo", "alimentario"), ("curcuma", "alimentario"),
    ("jengibre", "alimentario"), ("pimienta", "alimentario"), ("colorante", "alimentario"), ("celulosa", "cosmetica"),
    ("himalaya", "alimentario"), ("sal ", "alimentario"), ("oxido de hierro", "cosmetica"), ("hipoclorito", "industria"),
    ("metabisulfito", "industria"), ("molibdato", "agro"), ("hidroponia", "agro"), ("leche", "alimentario"),
    ("flores", "cosmetica"), ("grasa", "aceites-ceras-grasas"), ("laurica", "aceites-ceras-grasas"),
    ("potasa", "industria"), ("harina", "alimentario"), ("kernel", "alimentario"), ("gusano", "cosmetica"),
    ("azul", "industria"), ("fragancia", "cosmetica"), ("aroma", "cosmetica"), ("estearato", "cosmetica"), ("eritritol", "alimentario"),
    ("vainillina", "alimentario"), ("cebo", "aceites-ceras-grasas"), ("farma", "laboratorio"), ("ambar", "laboratorio"),
    ("cristal", "laboratorio"), ("lauril", "cosmetica"), ("acetato", "industria"), ("acetico", "industria"), ("nitrato", "industria"),
    ("fosfato", "industria"), ("silicato", "industria"), ("amoniaco", "industria"), ("glicol", "industria"),
    ("benzoato", "industria"), ("sorbato", "industria"), ("glutaraldehido", "industria"), ("azul metileno", "industria"),
    ("propilenglicol", "industria"), ("hidroxido", "industria"), ("sulfato", "industria"), ("peroxido", "industria"),
    ("carbon activado", "industria"), ("alcohol", "industria"), ("soda", "industria"), ("solvente", "industria"),
    ("aceituna", "alimentario"), ("alcaparra", "alimentario"), ("anis", "alimentario"), ("amaranto", "alimentario"),
    ("arroz", "alimentario"), ("albaricoque", "alimentario"), ("avellana", "alimentario"), ("azucar", "alimentario"),
    ("cacahuate", "alimentario"), ("cereza", "alimentario"), ("ciruela", "alimentario"), ("chocolate", "alimentario"),
    ("cocoa", "alimentario"), ("coco", "alimentario"), ("cranberry", "alimentario"), ("datil", "alimentario"),
    ("durazno", "alimentario"), ("fruta", "alimentario"), ("fruto", "alimentario"), ("garbanzo", "alimentario"),
    ("granola", "alimentario"), ("higo", "alimentario"), ("lenteja", "alimentario"), ("macadamia", "alimentario"),
    ("mango", "alimentario"), ("maracuya", "alimentario"), ("marañon", "alimentario"), ("maranon", "alimentario"),
    ("melocoton", "alimentario"), ("mora", "alimentario"), ("oregano", "alimentario"), ("papaya", "alimentario"),
    ("pasas", "alimentario"), ("pecan", "alimentario"), ("pimenton", "alimentario"), ("piña", "alimentario"),
    ("pina", "alimentario"), ("uvas", "alimentario"), ("uva pasa", "alimentario"), ("aji", "alimentario"),
    ("comino", "alimentario"), ("laurel", "alimentario"), ("clavo", "alimentario"), ("nuez moscada", "alimentario"),
    ("paprika", "alimentario"), ("tomillo", "alimentario"), ("romero seco", "alimentario"), ("especia", "alimentario"),
    ("hierbas", "alimentario"), ("cereal", "alimentario"), ("harina", "alimentario"), ("grano", "alimentario"),
    ("lino", "alimentario"), ("mijo", "alimentario"), ("sorgo", "alimentario"), ("trigo", "alimentario"),
    ("centeno", "alimentario"), ("cebada", "alimentario"), ("soya", "alimentario"), ("soja", "alimentario"),
    ("guisante", "alimentario"), ("arveja", "alimentario"), ("acesulfame", "alimentario"), ("aspartame", "alimentario"),
    ("sacarina", "alimentario"), ("glucosa", "alimentario"), ("jarabe", "alimentario"), ("pectina", "alimentario"),
    ("carragenina", "alimentario"), ("agar", "alimentario"), ("caseinato", "alimentario"), ("caseina", "alimentario"),
    ("fosfato", "alimentario"), ("pirofosfato", "alimentario"), ("tripolifosfato", "alimentario"), ("nitrito", "alimentario"),
    ("eritorbato", "alimentario"), ("ascorbato", "alimentario"), ("sorbato", "alimentario"), ("propionato", "alimentario"),
    ("natamicina", "alimentario"), ("nisina", "alimentario"), ("levadura", "alimentario"), ("enzima", "alimentario"),
    ("transglutaminasa", "alimentario"), ("fibra", "alimentario"), ("dextrina", "alimentario"), ("lactosa", "alimentario"),
    ("sacarosa", "alimentario"), ("azucar", "alimentario"), ("panela", "alimentario"), ("miel", "alimentario"),
    ("cafe", "alimentario"), ("te verde", "alimentario"), ("cacao", "alimentario"), ("mantequilla", "alimentario"),
    ("queso", "alimentario"), ("crema", "alimentario"), ("leche", "alimentario"), ("huevo", "alimentario"),
    ("omega", "alimentario"), ("probiotico", "alimentario"), ("prebiotico", "alimentario"), ("melatonina", "alimentario"),
    ("cafeina anhidra", "alimentario"), ("magnesio", "alimentario"), ("calcio", "alimentario"), ("potasio", "alimentario"),
    ("zinc", "alimentario"), ("hierro", "alimentario"), ("selenio", "alimentario"), ("cromo", "alimentario"),
    ("acetaminofen", "laboratorio"), ("ibuprofeno", "laboratorio"), ("paracetamol", "laboratorio"), ("estandar", "laboratorio"),
    ("reactivo", "laboratorio"), ("indicador", "laboratorio"), ("buffer", "laboratorio"), ("equipo", "laboratorio"),
    ("maquina", "laboratorio"), ("filtr", "laboratorio"), ("silica", "laboratorio"), ("aerosil", "laboratorio"),
    ("emoliente", "cosmetica"), ("emulsionante", "cosmetica"), ("emulsificante", "cosmetica"), ("humectante", "cosmetica"),
    ("espesante", "cosmetica"), ("conservante", "cosmetica"), ("fenoxi", "cosmetica"), ("parabeno", "cosmetica"),
    ("silicona", "cosmetica"), ("dimeticona", "cosmetica"), ("ciclometicona", "cosmetica"), ("pvp", "cosmetica"),
    ("polivinil", "cosmetica"), ("carbomero", "cosmetica"), ("hidroxietilcelulosa", "cosmetica"), ("cmc", "cosmetica"),
    ("carboximetil", "cosmetica"), ("metilcelulosa", "cosmetica"), ("alcohol cetoestearilico", "cosmetica"),
    ("alcohol estearilico", "cosmetica"), ("miristato", "cosmetica"), ("palmitato", "cosmetica"), ("oleato", "cosmetica"),
    ("cocoato", "cosmetica"), ("lauril", "cosmetica"), ("laureth", "cosmetica"), ("sulfonato", "cosmetica"),
    ("cocamidopropil", "cosmetica"), ("span", "cosmetica"), ("monoestearato", "cosmetica"), ("glicolato", "cosmetica"),
    ("propilenglicol", "cosmetica"), ("dipropilenglicol", "cosmetica"), ("butilenglicol", "cosmetica"),
    ("alcohol bencilico", "cosmetica"), ("alcohol isopropilico", "industria"), ("alcohol etilico", "industria"),
    ("colageno", "cosmetica"), ("keratina", "cosmetica"), ("queratina", "cosmetica"), ("biotina", "cosmetica"),
    ("acido hialuronico", "cosmetica"), ("alfa arbutina", "cosmetica"), ("arbutina", "cosmetica"), ("resveratrol", "cosmetica"),
    ("coenzima", "cosmetica"), ("peptido", "cosmetica"), ("ceramida", "cosmetica"), ("escualano", "cosmetica"),
    ("manteca", "aceites-ceras-grasas"), ("trementina", "industria"), ("thinner", "industria"), ("varsol", "industria"),
    ("acetona", "industria"), ("tolueno", "industria"), ("xileno", "industria"), ("hexano", "industria"),
    ("metanol", "industria"), ("butanol", "industria"), ("glicol", "industria"), ("formol", "industria"),
    ("formaldehido", "industria"), ("amonio", "industria"), ("cloruro de", "industria"), ("sulfato", "industria"),
    ("nitrato", "industria"), ("carbonato de sodio", "industria"), ("soda caustica", "industria"), ("caustica", "industria"),
    ("hidroxido", "industria"), ("peroxido", "industria"), ("percarbonato", "industria"), ("hipoclorito", "industria"),
    ("acido sulfurico", "industria"), ("acido clorhidrico", "industria"), ("acido nitrico", "industria"),
    ("acido fosforico", "industria"), ("acido acetico", "industria"), ("acido oxalico", "industria"),
    ("acido borico", "industria"), ("acido formico", "industria"), ("acido muriatico", "industria"),
    ("bicarbonato", "alimentario"), ("silicato", "industria"), ("zeolita", "industria"), ("bentonita", "industria"),
    ("talco", "cosmetica"), ("mica", "cosmetica"), ("pigmento", "cosmetica"), ("colorante", "alimentario"),
    ("tinte", "industria"), ("resina", "industria"), ("polimero", "industria"), ("latex", "industria"),
    ("desengrasante", "industria"), ("detergente", "industria"), ("jabon", "industria"), ("limoneno", "industria"),
    ("nonil", "industria"), ("etoxilado", "industria"), ("antiespumante", "industria"), ("secuestrante", "industria"),
    ("acido", "cosmetica"), ("niacinamida", "cosmetica"), ("retinol", "cosmetica"), ("pantenol", "cosmetica"),
    ("alantoina", "cosmetica"), ("hialuronico", "cosmetica"), ("glicerina", "cosmetica"), ("tween", "cosmetica"),
    ("polisorbato", "cosmetica"), ("betaina", "cosmetica"), ("tensoactivo", "cosmetica"), ("cocoamida", "cosmetica"),
    ("btms", "cosmetica"), ("lanette", "cosmetica"), ("cetilico", "cosmetica"), ("estearico", "cosmetica"),
    ("arcilla", "cosmetica"), ("caolin", "cosmetica"), ("zinc", "cosmetica"), ("alginato", "alimentario"), ("aloe", "cosmetica"), ("taurina", "alimentario"), ("soypro", "alimentario"), ("texapon", "cosmetica"), ("pro-b", "alimentario"), ("transparente", "cosmetica"), ("verde", "cosmetica"), ("titanio", "cosmetica"),
    ("extracto", "cosmetica"), ("mentol", "cosmetica"), ("cafeina", "cosmetica"), ("papaina", "cosmetica"),
    ("elastina", "cosmetica"), ("urea", "cosmetica"), ("sorbitol", "cosmetica"), ("edta", "cosmetica"),
    ("fenoxietanol", "cosmetica"), ("carbomer", "cosmetica"), ("carbopol", "cosmetica"), ("agua", "cosmetica"),
)


def clasificar_nombre(nombre: str) -> dict:
    """Sugiere {linea, origen_pais} para un nombre de producto (heurístico, sin LLM)."""
    n = normalizar(nombre)
    linea = next((v for k, v in _REGLAS_LINEA if k in n), "")
    origen = next((v for k, v in _REGLAS_ORIGEN if k in n), "")
    return {"linea": linea, "origen_pais": origen}


_RE_CODIGO_TOKEN = re.compile(r"\b\d+-\d+\b|\b[A-Z]{1,3}\d{2,}[A-Z0-9\-]*\b|\b\d{3,}[A-Z]{2,}\b")


_MARCAS = ("dr joe lab", "dr. joe lab", "now foods", "now", "ocean spray", "ocean pacific", "elmar", "pacifico", "pacífico",
           "el lobo", "onedove", "zatural", "vivosun", "kernek", "gp ", "nature's", "natures", "amazon", "sky organics",
           "cliganic", "handcraft", "plant therapy", "majestic pure", "viva naturals", "nutricost", "bulk supplements",
           "bulksupplements", "microingredients", "micro ingredients", "anthony's", "anthonys", "horbaach", "sports research",
           "kirkland", "member's mark", "great value", "wira", "nutrifresh", "vital proteins", "orgain", "premium", "organic",
           "orgánico", "organico", "certificado", "certified", "puro", "pure", "grado alimenticio", "food grade",
           "grado cosmético", "grado cosmetico", "usp grade", "terapéutico", "terapeutico", "importado", "importada",
           "americano", "americana")
_DESCRIPTORES_CORTE = (" para ", " ideal ", " con ", " sin ", " - ", " – ", " | ", " apto ", " uso ", " libre de ", " rico en ",
                       " alta ", " bajo ", " bulto", " saco", " caja", " tambor", " garrafa", " cuñete", " cuñete", " frasco", " bolsa",
                       " unidades", " unidad", " x ", " por ", " grande", " pequeño", " mediano", " tamaño", " pack", " kit ")


def nombre_publico(nombre: str) -> str:
    """Nombre genérico para la web: sin la parte en inglés tras '/', sin códigos de
    proveedor (WEIFANG, 30-100, REF …), sin marcas, sin presentación ni coletillas
    comerciales ("para cara", "bulto 25 kg", "Dr Joe Lab"), en formato título.
    La presentación se muestra aparte y solo en productos de la tienda."""
    base = (nombre or "").split("/")[0]
    base = base.split(",")[0]
    low = " " + normalizar(base) + " "
    for d in _DESCRIPTORES_CORTE:
        i = low.find(d)
        if i > 4:  # deja al menos una palabra antes del corte
            low = low[:i] + " "
    base = low.strip()
    for m in sorted(_MARCAS, key=len, reverse=True):
        base = re.sub(r"\b" + re.escape(m.strip()) + r"\b", " ", base)
    base = re.sub(r"\([^)]*\)", " ", base)
    base = re.sub(r"\((ref|cod|codigo)[^)]*\)", " ", base, flags=re.I)
    base = _RE_CODIGO_TOKEN.sub(" ", base)
    base = _RE_CANTIDAD.sub(" ", base)
    base = _RE_X.sub(" ", base)
    base = re.sub(r"\b(weifang|shandong|jiangsu|anhui|hebei|zhejiang|chino|china|importado|nacional|caja|galon|galón|"
                  r"litros?|kilos?|grf|und|unidad|x)\b", " ", base, flags=re.I)
    base = re.sub(r"\b\d+\s*%", " ", base)
    base = re.sub(r"\b\d+([\.,]\d+)?\b", " ", base)  # números sueltos (cantidades ya sin unidad)
    base = re.sub(r"\s{2,}", " ", base).strip(" -:·,%.")
    base = base[:60].rsplit(" ", 1)[0] if len(base) > 60 else base
    # tokens con dígitos (grx20l, k30), unidades sueltas y muletillas
    base = " ".join(t for t in base.split() if not re.search(r"\d", t) and t not in ("kg", "kgs", "gr", "g", "ml", "l", "lt", "und", "ind", "un", "cc"))
    base = re.sub(r"\b(y|e|o)\s+(natural|puro|pura|organico|organica|premium)\b", " ", base)
    base = re.sub(r"\s{2,}", " ", base).strip()
    # sin conectores colgando al final ("Aceite de Pino y", "Avena en")
    for _ in range(3):
        base = re.sub(r"\s+(de|del|la|el|los|las|y|e|o|u|en|con|para|por|a|al|sin)$", "", base).strip()
    # restaurar tildes/mayúsculas originales palabra por palabra
    orig = {normalizar(t): t for t in re.split(r"[\s/,()]+", nombre or "") if t}
    base = " ".join(orig.get(t, t) for t in base.split()).strip(" -–·:,.")
    return _titulo(base) if len(base) >= 3 else _titulo(nombre)


_NO_MATERIA_PRIMA = ("bolsa", "banda", "cinta", "etiqueta", "caja ", "cajas", "courrier", "courier", "agencia", "flete",
                     "servicio", "transporte", "envio", "envío", "sticker", "rollo", "papel", "guante", "tapabocas",
                     "flanche", "codo", "tubo", "tuberia", "valvula", "manguera", "tornillo", "motor", "reductor",
                     "impresora", "toner", "cartucho", "computador", "monitor", "silla", "mesa", "estante", "bulto de",
                     "arriendo", "honorarios", "suscripcion", "licencia", "starlink", "internet", "seguro", "dhl", "fedex", "ups ",
                     "express colombia", "nivel 1", "oada", "farma azul", "farma cristal", "farma ambar", "explora", "nuestras", "nuestros", "soluciones", "formato", "vinculacion", "vinculación", "politica", "política", "pila ", "pastillero", "pera ", "linner", "liner", "tapa ", "tapas",
                     " — ", "blister", "carton", "cartón", "estuche", "frasco", "envase", "gotero", "atomizador",
                     "spray", "dosificador", "pet ", "pvc", "polietileno", "sodimac", "tapon", "tapón", "union ", "unión", "codo ",
                     "adaptador", "reduccion", "niple", "racor", "abrazadera")


def es_materia_prima(nombre: str) -> bool:
    raw = (nombre or "")
    if "—" in raw or " - " in raw and re.search(r"\d{6,}", raw):
        return False  # "Proveedor — número de factura": línea de gasto, no producto
    n = normalizar(raw)
    if len(n) <= 4 or n in ("azul", "verde", "rojo", "transparente", "blanco", "negro"):
        return False
    return not any(k in n for k in _NO_MATERIA_PRIMA)


def autoclasificar_productos(solo_faltantes: bool = True, proveedor_id: int | None = None) -> dict:
    """Aplica clasificar_nombre() a los productos sin línea/origen (o a todos)."""
    n = 0
    with _lock:
        con = _conn()
        try:
            sql = ("SELECT pp.id, pp.proveedor_id, pp.nombre, pp.linea, pp.origen_pais, p.pais AS proveedor_pais, p.tipo AS proveedor_tipo "
                   "FROM proveedor_productos pp JOIN proveedores p ON p.id=pp.proveedor_id")
            params: list = []
            if proveedor_id:
                sql += " WHERE pp.proveedor_id=?"; params.append(proveedor_id)
            filas = con.execute(sql, params).fetchall()
            # línea dominante por proveedor (fallback cuando ninguna regla aplica)
            dominante: dict[int, str] = {}
            conteo: dict[int, dict[str, int]] = {}
            for r in filas:
                lid = clasificar_nombre(r["nombre"])["linea"] or r["linea"]
                if lid:
                    conteo.setdefault(r["proveedor_id"], {}).setdefault(lid, 0)
                    conteo[r["proveedor_id"]][lid] += 1
            for pid_, c in conteo.items():
                dominante[pid_] = max(c, key=c.get)
            for r in filas:
                sug = clasificar_nombre(r["nombre"])
                if not sug["linea"] and not r["linea"]:
                    sug["linea"] = dominante.get(r["proveedor_id"], "")
                sets, vals = [], []
                # El origen heredado de un distribuidor nacional ("Colombia") no es el origen
                # de fabricación: se considera faltante para poder sugerir el real.
                origen_faltante = (not r["origen_pais"]) or (r["proveedor_tipo"] == "nacional" and r["origen_pais"] == r["proveedor_pais"])
                if sug["linea"] and (not solo_faltantes or not r["linea"]):
                    sets.append("linea=?"); vals.append(sug["linea"])
                if sug["origen_pais"] and (not solo_faltantes or origen_faltante):
                    sets.append("origen_pais=?"); vals.append(sug["origen_pais"])
                if sets:
                    con.execute(f"UPDATE proveedor_productos SET {', '.join(sets)}, updated_at=? WHERE id=?",
                                (*vals, _ahora(), r["id"]))
                    n += 1
            con.commit()
        finally:
            con.close()
    return {"ok": True, "actualizados": n}


def marcar_publicar_masivo(proveedor_ids: list[int], valor: int = 1) -> dict:
    if not proveedor_ids:
        return {"ok": False, "error": "proveedor_ids vacío"}
    with _lock:
        con = _conn()
        try:
            q = ",".join("?" * len(proveedor_ids))
            cur = con.execute(f"UPDATE proveedor_productos SET publicar_web=?, updated_at=? WHERE proveedor_id IN ({q})",
                              (valor, _ahora(), *proveedor_ids))
            con.commit()
            return {"ok": True, "productos": cur.rowcount}
        finally:
            con.close()


# ─────────────────────────── publicación web (sin proveedores) ───────────────────────────


def publicar_oferta_web() -> dict:
    """Escribe PAGINA_WEB/site/data/oferta_proveedores.json con los productos
    marcados `publicar_web`. Sin nombres de proveedor: solo producto, línea,
    CAS, presentaciones y país de origen (para el mapa)."""
    from app.tools._json_store import atomic_write_json

    con = _conn()
    try:
        rows = [dict(r) for r in con.execute(
            """SELECT pp.clave, pp.nombre, pp.cas, pp.presentacion, pp.unidad, pp.linea, pp.origen_pais, pp.sku_siigo,
                      p.pais AS proveedor_pais, p.tipo AS proveedor_tipo
               FROM proveedor_productos pp JOIN proveedores p ON p.id=pp.proveedor_id
               WHERE pp.publicar_web=1 AND p.activo=1 ORDER BY pp.nombre COLLATE NOCASE""").fetchall()]
    finally:
        con.close()
    productos: dict[str, dict] = {}
    for r in rows:
        if not es_materia_prima(r["nombre"]) or not es_materia_prima(nombre_publico(r["nombre"])):
            continue
        g = productos.get(r["clave"])
        if g is None:
            g = productos[r["clave"]] = {
                "clave": r["clave"], "nombre": r["nombre"], "cas": r["cas"] or "", "linea": r["linea"] or "",
                "origen_paises": [], "presentaciones": [], "n_fuentes": 0, "skus": [],
            }
        if len(r["nombre"]) < len(g["nombre"]):
            g["nombre"] = r["nombre"]
        g["n_fuentes"] += 1
        if r["cas"] and not g["cas"]:
            g["cas"] = r["cas"]
        if r["linea"] and not g["linea"]:
            g["linea"] = r["linea"]
        pais = r["origen_pais"]
        if pais == "Colombia" and (r.get("proveedor_tipo") == "nacional") and r["proveedor_pais"] == "Colombia":
            pais = ""  # país del distribuidor, no de fabricación: no se declara
        if pais and pais not in g["origen_paises"]:
            g["origen_paises"].append(pais)
        if r["presentacion"] and r["presentacion"] not in g["presentaciones"]:
            g["presentaciones"].append(r["presentacion"])
        if r["sku_siigo"] and r["sku_siigo"] not in g["skus"]:
            g["skus"].append(r["sku_siigo"])
    fusion: dict[str, dict] = {}
    for g in productos.values():
        g["nombre"] = nombre_publico(g["nombre"])
        k = normalizar(g["nombre"])
        f = fusion.get(k)
        if f is None:
            fusion[k] = g
            continue
        f["n_fuentes"] += g["n_fuentes"]
        for campo in ("origen_paises", "presentaciones", "skus"):
            for v in g[campo]:
                if v not in f[campo]:
                    f[campo].append(v)
        f["cas"] = f["cas"] or g["cas"]
        f["linea"] = f["linea"] or g["linea"]
    lista = sorted(fusion.values(), key=lambda g: g["nombre"].lower())
    for g in lista:
        sc = subcategoria_de(g["nombre"], g["linea"])
        g["subcategoria"] = sc["id"]
        g["subcategoria_label"] = sc["label"]
    paises: dict[str, dict] = {}
    for g in lista:
        for pais in g["origen_paises"]:
            if pais == "Colombia":
                continue
            info = PAISES_COORDENADAS.get(pais)
            if not info:
                continue
            e = paises.setdefault(pais, {"pais": pais, "lat": info["lat"], "lon": info["lon"],
                                         "puerto_entrada": info.get("puerto_entrada", ""), "n_productos": 0, "muestra": []})
            e["n_productos"] += 1
            if len(e["muestra"]) < 4:
                e["muestra"].append(g["nombre"])
    data = {
        "actualizado": _ahora(),
        "n_productos": len(lista),
        "productos": lista,
        "paises": sorted(paises.values(), key=lambda p: -p["n_productos"]),
    }
    atomic_write_json(OFERTA_WEB_PATH, data)
    return {"ok": True, "n_productos": len(lista), "n_paises": len(paises), "ruta": str(OFERTA_WEB_PATH)}


_SIGLAS = {"USP", "BP", "EP", "NF", "PVC", "EAN", "MCT", "HPLC", "ACS", "BHT", "BHA", "EDTA", "SCI", "SLS", "SLES",
           "DPG", "PEG", "PG", "PP", "PE", "HDPE", "PET", "IPA", "COA", "TDS", "SDS", "GMP", "ISO", "PH", "UV", "SPF", "INCI"}
_MINUSCULAS = {"de", "del", "la", "el", "los", "las", "y", "e", "o", "u", "en", "con", "para", "por", "a", "al"}


_ACENTOS = {"acido": "ácido", "citrico": "cítrico", "lactico": "láctico", "malico": "málico", "salicilico": "salicílico",
            "glicolico": "glicólico", "fosforico": "fosfórico", "acetico": "acético", "benzoico": "benzoico",
            "sorbico": "sórbico", "estearico": "esteárico", "etilico": "etílico", "cetilico": "cetílico",
            "bencilico": "bencílico", "isopropilico": "isopropílico", "sodico": "sódico", "potasico": "potásico",
            "calcico": "cálcico", "magnesico": "magnésico", "oxido": "óxido", "hidroxido": "hidróxido",
            "sulfurico": "sulfúrico", "clorhidrico": "clorhídrico", "nitrico": "nítrico", "borico": "bórico",
            "formico": "fórmico", "oleico": "oleico", "laurico": "láurico", "palmitico": "palmítico",
            "propionico": "propiónico", "ascorbico": "ascórbico", "folico": "fólico", "pantotenico": "pantoténico",
            "tartarico": "tartárico", "fumarico": "fumárico", "succinico": "succínico", "hialuronico": "hialurónico",
            "kojico": "kójico", "azelaico": "azelaico", "mandelico": "mandélico", "glutamico": "glutámico",
            "aspartico": "aspártico", "linoleico": "linoleico", "cetoestearilico": "cetoestearílico",
            "estearilico": "estearílico", "polivinilico": "polivinílico", "acetaminofen": "acetaminofén",
            "alantoina": "alantoína", "cafeina": "cafeína", "papaina": "papaína", "alumina": "alúmina",
            "amonio": "amonio", "caustica": "cáustica", "limon": "limón", "jazmin": "jazmín", "arbol": "árbol",
            "te": "té", "ajonjoli": "ajonjolí", "mani": "maní", "marañon": "marañón", "maranon": "marañón",
            "pimenton": "pimentón", "melocoton": "melocotón", "datil": "dátil", "datiles": "dátiles",
            "arandano": "arándano", "arandanos": "arándanos", "almidon": "almidón", "albumina": "albúmina",
            "proteina": "proteína", "colageno": "colágeno", "vitamina": "vitamina", "acesulfame": "acesulfame",
            "carbon": "carbón", "capsulas": "cápsulas", "capsula": "cápsula", "titanio": "titanio", "boro": "boro",
            "peroxido": "peróxido", "trementina": "trementina", "camelia": "camelia", "cumarina": "cumarina",
            "fenoxietanol": "fenoxietanol", "esteres": "ésteres", "ester": "éster", "eter": "éter",
            "aminoacido": "aminoácido", "aminoacidos": "aminoácidos", "quimico": "químico", "cosmetico": "cosmético",
            "tecnico": "técnico", "farmaceutico": "farmacéutico", "organico": "orgánico", "acetona": "acetona",
            "menta": "menta", "eucalipto": "eucalipto", "curcuma": "cúrcuma", "cardamomo": "cardamomo",
            "sesamo": "sésamo", "quinua": "quinua", "chia": "chía", "hidrog": "hidrogenado", "anhidro": "anhidro",
            "anhidra": "anhidra", "pirofosfato": "pirofosfato", "dioxido": "dióxido", "cloruro": "cloruro"}


def _titulo(nombre: str) -> str:
    """'ACIDO AZELAICO 10g' → 'Ácido Azelaico 10g' (unidades, siglas y tildes de vocabulario químico)."""
    out = []
    for i, w in enumerate(nombre.split()):
        low = w.lower()
        if re.fullmatch(r"\d+[a-zA-Z%]*", w):
            out.append(w)
        elif w.upper() in _SIGLAS:
            out.append(w.upper())
        elif low in _MINUSCULAS and i > 0:
            out.append(low)
        else:
            base = _ACENTOS.get(normalizar(low), low)
            out.append(base[:1].upper() + base[1:])
    return " ".join(out)


# ─────────────────────────── solicitudes de cotización (web) ───────────────────────────


def crear_solicitud_cotizacion(datos: dict) -> dict:
    datos = datos or {}
    campos = ("nombre", "empresa", "email", "telefono", "ciudad", "producto", "presentacion", "cantidad", "mensaje", "ip")
    vals = {k: str(datos.get(k) or "").strip()[:500] for k in campos}
    vals["clave"] = clave_producto(vals["producto"])
    vals["origen"] = str(datos.get("origen") or "web")[:30]
    with _lock:
        con = _conn()
        try:
            cur = con.execute(
                """INSERT INTO solicitudes_cotizacion
                   (nombre, empresa, email, telefono, ciudad, producto, clave, presentacion, cantidad, mensaje, origen, ip)
                   VALUES (:nombre,:empresa,:email,:telefono,:ciudad,:producto,:clave,:presentacion,:cantidad,:mensaje,:origen,:ip)""",
                vals)
            con.commit()
            sid = int(cur.lastrowid)
            return dict(con.execute("SELECT * FROM solicitudes_cotizacion WHERE id=?", (sid,)).fetchone())
        finally:
            con.close()


def listar_solicitudes_cotizacion(estado: str = "", limite: int = 200) -> list[dict]:
    con = _conn()
    try:
        sql = "SELECT * FROM solicitudes_cotizacion"
        params: list = []
        if estado:
            sql += " WHERE estado=?"; params.append(estado)
        sql += " ORDER BY id DESC LIMIT ?"; params.append(int(limite))
        out = [dict(r) for r in con.execute(sql, params).fetchall()]
    finally:
        con.close()
    if out:
        claves = {s["clave"] for s in out if s["clave"]}
        con = _conn()
        try:
            for s in out:
                if not s["clave"]:
                    s["proveedores_posibles"] = []
                    continue
                s["proveedores_posibles"] = [dict(r) for r in con.execute(
                    """SELECT DISTINCT p.id, p.nombre, p.pais,
                              (SELECT precio_unitario FROM precios_historicos ph WHERE ph.proveedor_id=p.id AND ph.clave=pp.clave ORDER BY fecha DESC LIMIT 1) AS ultimo_precio
                       FROM proveedor_productos pp JOIN proveedores p ON p.id=pp.proveedor_id
                       WHERE pp.clave=? OR pp.clave LIKE ? LIMIT 8""",
                    (s["clave"], f"%{s['clave']}%")).fetchall()]
        finally:
            con.close()
    return out


def actualizar_solicitud_cotizacion(sid: int, datos: dict) -> dict | None:
    datos = datos or {}
    with _lock:
        con = _conn()
        try:
            sets, vals = [], []
            if datos.get("estado") in ("nueva", "en_proceso", "enviada", "cerrada"):
                sets.append("estado=?"); vals.append(datos["estado"])
            if "respuesta" in datos:
                sets.append("respuesta=?"); vals.append(str(datos["respuesta"] or "")[:4000])
                sets.append("respondido_at=?"); vals.append(_ahora())
            if sets:
                vals.append(sid)
                con.execute(f"UPDATE solicitudes_cotizacion SET {', '.join(sets)} WHERE id=?", vals)
                con.commit()
            return _row(con.execute("SELECT * FROM solicitudes_cotizacion WHERE id=?", (sid,)).fetchone())
        finally:
            con.close()


def cargar_oferta_web() -> dict:
    """Lectura pública (website.py) del JSON publicado; vacío si no existe."""
    try:
        return json.loads(OFERTA_WEB_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"actualizado": None, "n_productos": 0, "productos": [], "paises": []}
