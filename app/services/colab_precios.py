"""Simulador de precios de un proyecto de Colaboradores (4-oct-2026).

Por qué existe. En la relación comercial Armando ↔ Sebastián el precio se discutía por WhatsApp con
cuentas sueltas («58.500 menos IVA menos MeLi menos lo que le pago…») y cada uno veía solo su mitad:
McKenna no veía el costo de fabricación de Sebastián y Sebastián no veía lo que se come la
plataforma ni el IVA. El 4-oct-2026 el collar L se le compraba a $35.425 y McKenna perdía $1.115
por unidad; al bajarlo a $29.310 quedó por debajo del costo de fabricación que el propio Sebastián
había calculado ($30.500, tarjeta «Costo de fabricación calculado»). Las dos cosas se ven de un
vistazo si la cascada completa está en un solo lugar.

Unidad: el **producto** (una fila de `colab_precios`). Guarda solo las ENTRADAS —precio de la
publicación, comisión de la plataforma, envío, IVA, lo que McKenna le paga al colaborador y el
desglose del costo del colaborador—; los márgenes se calculan en el navegador (mover un deslizador
no es guardar). Guardar es una **propuesta**: queda en el historial (`colab_precios_cambios`,
quién cambió qué de cuánto a cuánto) y reinicia los «de acuerdo»; con todos los miembros de
acuerdo, el precio queda acordado.

⚠️ Simulación: no toca Alegra, ni el inventario, ni las publicaciones. Sin LLM.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from app.services import colaboradores as col

MAX_PRODUCTOS = 40
MAX_COSTOS = 12
MAX_CAMBIOS = 60
IVA_MODOS = ("incluido", "encima")

# Campos numéricos editables → (nombre para el historial, tope). Los % van de 0 a 100.
NUMEROS = {
    "precio_publicacion": ("precio de la publicación", 1e9),
    "comision_pct": ("comisión de la plataforma %", 100),
    "envio": ("envío", 1e9),
    "iva_pct": ("IVA %", 100),
    "otros_mckenna": ("otros costos de McKenna", 1e9),
    "precio_compra": ("precio de compra", 1e9),
    "merma_pct": ("merma %", 100),
    "meta_mckenna": ("mínimo para McKenna", 1e9),
    "meta_colaborador": ("mínimo para el colaborador", 1e9),
}
TEXTOS = {"nombre": ("nombre", 160), "sku": ("SKU", 60), "plataforma": ("plataforma", 60), "nota": ("nota", 600)}
# Cambiar cualquiera de estos cambia lo que se acordó: los «de acuerdo» se reinician.
REINICIAN_ACUERDO = set(NUMEROS) | {"iva_modo", "costos"}


def _ensure() -> None:
    col._ensure()
    with col._conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS colab_precios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diagrama_id INTEGER NOT NULL,
                nombre TEXT NOT NULL,
                sku TEXT NOT NULL DEFAULT '',
                plataforma TEXT NOT NULL DEFAULT '',
                nota TEXT NOT NULL DEFAULT '',
                precio_publicacion REAL NOT NULL DEFAULT 0,
                comision_pct REAL NOT NULL DEFAULT 0,
                envio REAL NOT NULL DEFAULT 0,
                iva_pct REAL NOT NULL DEFAULT 19,
                iva_modo TEXT NOT NULL DEFAULT 'incluido',
                otros_mckenna REAL NOT NULL DEFAULT 0,
                precio_compra REAL NOT NULL DEFAULT 0,
                costos_json TEXT NOT NULL DEFAULT '[]',
                merma_pct REAL NOT NULL DEFAULT 0,
                meta_mckenna REAL NOT NULL DEFAULT 0,
                meta_colaborador REAL NOT NULL DEFAULT 0,
                proveedor_id INTEGER,
                acuerdos_json TEXT NOT NULL DEFAULT '{}',
                orden REAL NOT NULL DEFAULT 0,
                creado_por INTEGER,
                creado_en TEXT NOT NULL DEFAULT (datetime('now')),
                actualizado_por INTEGER,
                actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
                borrado INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS ix_colab_precios_d ON colab_precios (diagrama_id, borrado);
            CREATE TABLE IF NOT EXISTS colab_precios_cambios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diagrama_id INTEGER NOT NULL,
                precio_id INTEGER NOT NULL,
                usuario_id INTEGER NOT NULL,
                campo TEXT NOT NULL,
                antes TEXT NOT NULL DEFAULT '',
                despues TEXT NOT NULL DEFAULT '',
                en TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS ix_colab_precios_cambios_d ON colab_precios_cambios (diagrama_id, en);
        """)


# ─── Saneo ───────────────────────────────────────────────────────────────────

def _numero(v, tope: float) -> float | None:
    n = col._num(v)
    return None if n is None else round(min(float(n), tope), 2)


def _costos(v) -> list[dict]:
    """Desglose del costo del colaborador: [{nombre, monto}], máx 12, sin renglones vacíos."""
    out = []
    for c in (v if isinstance(v, list) else []):
        if not isinstance(c, dict):
            continue
        nombre = col._texto(c.get("nombre"), 80)
        monto = _numero(c.get("monto"), 1e9)
        if not nombre and not monto:
            continue
        out.append({"nombre": nombre or "Sin nombre", "monto": monto or 0.0})
        if len(out) >= MAX_COSTOS:
            break
    return out


def _proveedor(did: int, v) -> int | None:
    try:
        uid = int(v)
    except (TypeError, ValueError):
        return None
    return uid if uid in col.miembros_ids(did) else None


def _proveedor_defecto(did: int) -> int | None:
    """Quien le vende a McKenna: el colaborador del proyecto (o, si no hay, el primer miembro que no es la casa)."""
    with col._conn() as con:
        r = con.execute("SELECT colaborador_id FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
    if r and r["colaborador_id"] and int(r["colaborador_id"]) in col.miembros_ids(did):
        return int(r["colaborador_id"])
    resto = [u for u in col.miembros_ids(did) if u != col.anfitrion_id()]
    return resto[0] if resto else None


def _a_dict(r) -> dict:
    d = dict(r)
    d["costos"] = json.loads(d.pop("costos_json") or "[]")
    d["acuerdos"] = json.loads(d.pop("acuerdos_json") or "{}")
    d.pop("borrado", None)
    return d


def _txt_valor(campo: str, v) -> str:
    if campo == "costos":
        return ", ".join(f"{c['nombre']} {c['monto']:,.0f}".replace(",", ".") for c in v) or "—"
    if isinstance(v, float):
        return f"{v:,.2f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")
    return str(v if v not in (None, "") else "—")


# ─── Lectura ─────────────────────────────────────────────────────────────────

def listar(did: int) -> dict:
    _ensure()
    with col._conn() as con:
        filas = con.execute("SELECT * FROM colab_precios WHERE diagrama_id=? AND borrado=0 ORDER BY orden, id",
                            (int(did),)).fetchall()
        cambios = con.execute("SELECT * FROM colab_precios_cambios WHERE diagrama_id=? ORDER BY id DESC LIMIT ?",
                              (int(did), MAX_CAMBIOS)).fetchall()
    return {"productos": [_a_dict(f) for f in filas], "cambios": [dict(c) for c in cambios],
            "proveedor_defecto": _proveedor_defecto(did)}


def _fila(con, did: int, pid: int):
    r = con.execute("SELECT * FROM colab_precios WHERE id=? AND diagrama_id=? AND borrado=0",
                    (int(pid), int(did))).fetchone()
    if not r:
        raise ValueError("Producto no encontrado")
    return r


# ─── Escritura ───────────────────────────────────────────────────────────────

def _sets(did: int, datos: dict) -> dict:
    """Los campos válidos que trae `datos`, ya saneados y con el nombre de su columna."""
    sets: dict = {}
    for k, (_, tope) in NUMEROS.items():
        if k in datos:
            n = _numero(datos[k], tope)
            sets[k] = 0.0 if n is None else n
    for k, (_, tope) in TEXTOS.items():
        if k in datos:
            sets[k] = col._texto(datos[k], tope)
    if "iva_modo" in datos and datos["iva_modo"] in IVA_MODOS:
        sets["iva_modo"] = datos["iva_modo"]
    if "costos" in datos:
        sets["costos_json"] = json.dumps(_costos(datos["costos"]), ensure_ascii=False)
    if "proveedor_id" in datos:
        sets["proveedor_id"] = _proveedor(did, datos["proveedor_id"])
    if "orden" in datos:
        o = col._num(datos["orden"])
        if o is not None:
            sets["orden"] = o
    return sets


def crear(did: int, uid: int, datos: dict) -> dict:
    _ensure()
    nombre = col._texto(datos.get("nombre"), 160)
    if not nombre:
        raise ValueError("El producto necesita un nombre")
    sets = _sets(did, datos)
    sets["nombre"] = nombre
    sets.setdefault("proveedor_id", _proveedor_defecto(did))
    with col._conn() as con:
        n = con.execute("SELECT COUNT(*) n FROM colab_precios WHERE diagrama_id=? AND borrado=0",
                        (int(did),)).fetchone()["n"]
        if n >= MAX_PRODUCTOS:
            raise ValueError(f"El simulador ya tiene {MAX_PRODUCTOS} productos")
        sets.setdefault("orden", float(n + 1))
        cols = ["diagrama_id", "creado_por", "actualizado_por", *sets]
        cur = con.execute(f"INSERT INTO colab_precios ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                          (int(did), int(uid), int(uid), *sets.values()))
        pid = cur.lastrowid
        con.execute("INSERT INTO colab_precios_cambios (diagrama_id, precio_id, usuario_id, campo, despues)"
                    " VALUES (?,?,?,?,?)", (int(did), pid, int(uid), "producto", f"agregó «{nombre}»"))
        r = con.execute("SELECT * FROM colab_precios WHERE id=?", (pid,)).fetchone()
    return _a_dict(r)


def editar(did: int, pid: int, uid: int, cambios: dict) -> dict:
    """Aplica SOLO lo que llega y deja en el historial cada campo que de verdad cambió."""
    _ensure()
    with col._conn() as con:
        r = _fila(con, did, pid)
        sets = _sets(did, cambios)
        if "nombre" in sets and not sets["nombre"]:
            del sets["nombre"]
        actual = _a_dict(r)
        diferentes: dict = {}
        for k, v in sets.items():
            if k == "costos_json":
                nuevo = json.loads(v)
                if nuevo != actual["costos"]:
                    diferentes[k] = v
                    con.execute("INSERT INTO colab_precios_cambios (diagrama_id, precio_id, usuario_id, campo, antes, despues)"
                                " VALUES (?,?,?,?,?,?)", (int(did), int(pid), int(uid), "costos",
                                                          _txt_valor("costos", actual["costos"]), _txt_valor("costos", nuevo)))
            elif v != r[k]:
                diferentes[k] = v
                if k in NUMEROS or k in TEXTOS or k == "iva_modo":
                    nombre = (NUMEROS.get(k) or TEXTOS.get(k) or ("IVA",))[0]
                    con.execute("INSERT INTO colab_precios_cambios (diagrama_id, precio_id, usuario_id, campo, antes, despues)"
                                " VALUES (?,?,?,?,?,?)", (int(did), int(pid), int(uid), nombre,
                                                          _txt_valor(k, r[k]), _txt_valor(k, v)))
        if not diferentes:
            return actual
        if any(k in REINICIAN_ACUERDO or k == "costos_json" for k in diferentes) and r["acuerdos_json"] not in ("", "{}"):
            diferentes["acuerdos_json"] = "{}"
        diferentes["actualizado_por"] = int(uid)
        con.execute("UPDATE colab_precios SET " + ", ".join(f"{k}=?" for k in diferentes)
                    + ", actualizado_en=datetime('now') WHERE id=?", (*diferentes.values(), int(pid)))
        r = con.execute("SELECT * FROM colab_precios WHERE id=?", (int(pid),)).fetchone()
    return _a_dict(r)


def borrar(did: int, pid: int, uid: int) -> None:
    _ensure()
    with col._conn() as con:
        r = _fila(con, did, pid)
        con.execute("UPDATE colab_precios SET borrado=1, actualizado_por=?, actualizado_en=datetime('now') WHERE id=?",
                    (int(uid), int(pid)))
        con.execute("INSERT INTO colab_precios_cambios (diagrama_id, precio_id, usuario_id, campo, antes)"
                    " VALUES (?,?,?,?,?)", (int(did), int(pid), int(uid), "producto", f"quitó «{r['nombre']}»"))


def acordar(did: int, pid: int, uid: int, de_acuerdo: bool) -> dict:
    """Cada miembro marca SU acuerdo con los números guardados (el servidor decide quién es)."""
    _ensure()
    with col._conn() as con:
        r = _fila(con, did, pid)
        acuerdos = json.loads(r["acuerdos_json"] or "{}")
        clave = str(int(uid))
        if de_acuerdo:
            acuerdos[clave] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        else:
            acuerdos.pop(clave, None)
        miembros = {str(u) for u in col.miembros_ids(did)}
        acuerdos = {k: v for k, v in acuerdos.items() if k in miembros}
        con.execute("UPDATE colab_precios SET acuerdos_json=? WHERE id=?", (json.dumps(acuerdos), int(pid)))
        con.execute("INSERT INTO colab_precios_cambios (diagrama_id, precio_id, usuario_id, campo, despues)"
                    " VALUES (?,?,?,?,?)", (int(did), int(pid), int(uid), "acuerdo",
                                            "de acuerdo" if de_acuerdo else "ya no está de acuerdo"))
        r = con.execute("SELECT * FROM colab_precios WHERE id=?", (int(pid),)).fetchone()
    return _a_dict(r)
