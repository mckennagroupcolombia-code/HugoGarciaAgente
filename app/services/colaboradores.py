"""Colaboradores: diagramas de flujo que Armando construye con un colaborador externo.

El primer caso es Sebastián: entre los dos arman, arrastrando cajas y uniendo
flechas desde el celular, el flujo de la relación comercial para un proyecto
conjunto, hasta llegar a una versión acordada por ambos.

**Quién entra.** El anfitrión (Armando, `COLABORADORES_ANFITRION_ID`, 8 por
defecto) y los usuarios con el permiso `colaborador_externo`. Nadie más —ni
otros administradores—: es un espacio entre dos personas.

**Cómo se evita pisar el trabajo del otro.** Cada guardado lleva la `version`
sobre la que se editó; si en el servidor ya hay una más nueva, se rechaza con
`conflicto` y el panel recarga la del otro en vez de sobrescribirla. Cada
versión queda en `colab_diagrama_versiones`: se puede ver quién cambió qué y
volver a cualquiera.

**Un solo estilo: el edificio (26-sep-2026).** El proyecto se ve y se edita como un edificio
en pixel art: pisos y habitaciones configurables, cada caja colocada en una habitación y
construida a medida que se llena, y las «flechas» de antes como entregas que un avatar lleva
de una caja a otra. Se retiraron el tablero de flechas y la exportación a Archify.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "colaboradores.db")
# Fotos y facturas que se cargan en las cajas. Fuera de git (binarios de runtime).
_MEDIA_DIR = Path(__file__).resolve().parents[2] / "colaboradores_media"

# Quién hace cada paso: son los carriles del diagrama. Cada uno es una figura
# jurídica aparte —la empresa no es Armando—, así que no se mezclan (21-sep-2026).
CARRILES = {
    "mckenna": "McKenna Group SAS",
    "armando": "Armando García",
    "sebastian": "Sebastián García",
    "conjunto": "Conjunto",
}
# Valores de la primera versión, que no distinguía persona de empresa.
_CARRILES_VIEJOS = {"colaborador": "sebastian"}
# Qué es cada caja: una PLANTILLA que precarga campos (toda caja admite los mismos campos libres).
TIPOS = {
    "accion": ("frontend", "acción o actividad"),
    "decision": ("security", "decisión o acuerdo por definir"),
    "entregable": ("database", "entregable o resultado"),
    "dinero": ("messagebus", "pago, precio o dinero"),
    "externo": ("cloud", "cliente, proveedor o tercero"),
    "consenso": ("security", "consenso: propuestas y votos"),
    "producto": ("database", "producto: foto, SKU, receta y precio"),
    "competencia": ("cloud", "competencia: su publicación y su precio"),
    "proveedor": ("cloud", "proveedor: entrega, costos y fiabilidad"),
    "libre": ("frontend", "caja libre: sus propios campos"),
}
# Íconos pixel que puede llevar una caja (los sprites de colaboradores/pixel.tsx).
ICONOS = ("moneda", "bolsa", "reloj", "datos", "doc", "foto", "alerta", "urna", "pulgar", "trofeo", "cofre",
          "bloques", "codigo", "ventana", "estrella", "gema", "bandera", "camion", "jugador", "control")
MAX_NODOS = 300
# Por dónde sale/entra una flecha en la caja. Son los cuatro lados.
LADOS = ("l", "r", "t", "b")
# Cómo se ve la flecha. La paleta es cerrada: un color libre desde el cliente
# es texto que termina dentro de un atributo SVG.
COLORES_FLECHA = ("#111827", "#0f766e", "#1d4ed8", "#b45309", "#b91c1c", "#7c3aed", "#15803d", "#94a3b8")
TRAZOS = ("solida", "guiones", "puntos")
FORMAS = ("curva", "recta", "escalon")
# La flecha nace RECTA (decisión 25-sep-2026): un tablero de proyecto se lee
# mejor con líneas rectas. Las que ya existían conservan su forma guardada.
FORMA_DEFECTO = "recta"
GROSOR_MIN, GROSOR_MAX = 1, 8

# ─── Contenido real de cada caja (tablero de proyecto, no solo diagrama) ──────
# Todos los campos son OPCIONALES: una caja sin ellos es la de siempre.
MONEDAS = ("COP", "USD", "EUR")
# Las preguntas del paso: «quién» es el carril y «qué» el título; aquí cómo, dónde, cuándo y por qué
# (contexto para que alguien de fuera entienda cada tarea, 26-sep-2026).
VARIABLES = ("como", "donde", "cuando", "porque")
MAX_DATOS = 8            # pares campo: valor ("medida: 40 cm", "margen: 38%")
MAX_CONSECUENCIAS = 6    # "si pasa esto → consecuencia → posible medida"
MAX_PROPUESTAS = 6       # ideas puestas a votación en un nodo de consenso
MODOS_RESUELTO = ("acuerdo", "turno", "skill")
MAX_COMPONENTES = 12     # piezas de la receta de un producto (aro, hebilla, bolsa…)
MAX_ADJUNTOS = 12        # fotos y facturas por caja
MEDIA_TIPOS = ("imagen", "pdf")
MAX_MEDIA_BYTES = 15 * 1024 * 1024
_LADO_MAX_FOTO = 1400    # px: una factura tiene que leerse; ~150 KB en JPEG


class Conflicto(Exception):
    """Se editó sobre una versión vieja: otro guardó antes."""

    def __init__(self, actual: dict):
        super().__init__("El diagrama cambió mientras lo editabas")
        self.actual = actual


def anfitrion_id() -> int:
    try:
        return int(os.getenv("COLABORADORES_ANFITRION_ID") or 8)
    except ValueError:
        return 8


def es_colaborador_externo(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return False
    except Exception:
        if int((usuario.get("rol") or {}).get("nivel") or 0) >= 3:
            return False
    return bool((usuario.get("permisos_secciones") or {}).get("colaborador_externo"))


def es_anfitrion(usuario: dict | None) -> bool:
    """Quién arma proyectos propios e invita gente (3-oct-2026): Armando y cualquiera de la casa con el
    permiso `colaboradores` (Cynthia, por ejemplo). Un colaborador externo no invita."""
    if not usuario or es_colaborador_externo(usuario):
        return False
    return int(usuario.get("id") or 0) == anfitrion_id() or bool((usuario.get("permisos_secciones") or {}).get("colaboradores"))


def es_miembro(usuario: dict | None) -> bool:
    """Quién entra al espacio de Colaboradores: anfitriones y colaboradores externos. Qué proyectos ve
    cada uno lo decide `colab_miembros` (puede_ver), no esto."""
    if not usuario:
        return False
    return es_anfitrion(usuario) or es_colaborador_externo(usuario)


def colaboradores_ids() -> list[int]:
    """Los usuarios activos con el permiso `colaborador_externo`."""
    try:
        from app.services import tickets_db as tdb

        with tdb._conn() as db:
            filas = db.execute("SELECT id, permisos_secciones FROM usuarios WHERE activo=1").fetchall()
    except Exception:
        return []
    out = []
    for f in filas:
        try:
            if (json.loads(f["permisos_secciones"] or "{}") or {}).get("colaborador_externo"):
                out.append(int(f["id"]))
        except Exception:
            continue
    return sorted(out)


def puede_ver(did: int, usuario: dict) -> bool:
    """Solo los MIEMBROS de un proyecto lo ven (3-oct-2026). Antes el anfitrión veía todos y cada
    colaborador los de su pareja; con varios anfitriones (Armando, Cynthia…) y proyectos personales, la
    llave es la membresía: ni otro anfitrión ni otro colaborador entra cambiando el id."""
    _ensure()
    with _conn() as con:
        return con.execute("SELECT 1 FROM colab_miembros WHERE diagrama_id=? AND usuario_id=?",
                           (int(did), int(usuario.get("id") or 0))).fetchone() is not None


def miembros_ids(did: int) -> list[int]:
    """Los miembros del proyecto, el dueño primero."""
    _ensure()
    with _conn() as con:
        return [int(r["usuario_id"]) for r in con.execute(
            "SELECT usuario_id FROM colab_miembros WHERE diagrama_id=? ORDER BY rol='dueno' DESC, agregado_en, usuario_id",
            (int(did),))]


def miembros(did: int) -> list[dict]:
    _ensure()
    with _conn() as con:
        filas = con.execute("SELECT usuario_id, rol, agregado_en FROM colab_miembros WHERE diagrama_id=?"
                            " ORDER BY rol='dueno' DESC, agregado_en, usuario_id", (int(did),)).fetchall()
    return [{"id": int(f["usuario_id"]), "nombre": _nombre(f["usuario_id"]), "rol": f["rol"], "desde": f["agregado_en"]}
            for f in filas]


def es_dueno(did: int, uid: int) -> bool:
    _ensure()
    with _conn() as con:
        return con.execute("SELECT 1 FROM colab_miembros WHERE diagrama_id=? AND usuario_id=? AND rol='dueno'",
                           (int(did), int(uid))).fetchone() is not None


def _usuario_de(uid: int) -> dict | None:
    try:
        from app.services import tickets_db as tdb

        with tdb._conn() as db:
            r = db.execute("SELECT id, nombre, foto, activo, permisos_secciones, rol_id FROM usuarios WHERE id=?",
                           (int(uid),)).fetchone()
            if not r:
                return None
            nivel = db.execute("SELECT nivel FROM roles WHERE id=?", (r["rol_id"],)).fetchone()
        d = dict(r)
        d["permisos_secciones"] = json.loads(d.get("permisos_secciones") or "{}") or {}
        d["rol"] = {"nivel": int(nivel["nivel"]) if nivel else 0}
        return d
    except Exception:
        return None


def invitables(usuario: dict) -> list[dict]:
    """A quién puede invitar un anfitrión: las personas activas (menos él y el bot). Solo nombre y foto."""
    if not es_anfitrion(usuario):
        return []
    try:
        from app.services import tickets_db as tdb

        with tdb._conn() as db:
            filas = db.execute("SELECT id, nombre, foto, username, permisos_secciones FROM usuarios WHERE activo=1"
                               " ORDER BY nombre").fetchall()
    except Exception:
        return []
    out = []
    for f in filas:
        if int(f["id"]) == int(usuario["id"]) or (f["username"] or "").startswith("hugo"):
            continue
        p = json.loads(f["permisos_secciones"] or "{}") or {}
        out.append({"id": int(f["id"]), "nombre": f["nombre"], "foto": f["foto"] or "",
                    "externo": bool(p.get("colaborador_externo"))})
    return out


def _dar_acceso_al_panel(uid: int) -> bool:
    """Quien entra a un proyecto necesita el panel: se le prende SOLO el permiso `colaboradores`
    (lo que ve adentro lo sigue decidiendo la membresía). Devuelve True si hubo que darlo."""
    from app.services import tickets_db as tdb

    with tdb._conn() as db:
        r = db.execute("SELECT permisos_secciones FROM usuarios WHERE id=? AND activo=1", (int(uid),)).fetchone()
        if not r:
            raise ValueError("Esa persona no existe o está inactiva")
        p = json.loads(r["permisos_secciones"] or "{}") or {}
        if p.get("colaboradores"):
            return False
        p["colaboradores"] = True
        db.execute("UPDATE usuarios SET permisos_secciones=? WHERE id=?", (json.dumps(p), int(uid)))
        db.commit()
    return True


def agregar_miembro(did: int, por: dict, uid: int) -> dict:
    """El dueño invita a alguien al proyecto (un personal pasa a compartido)."""
    _ensure()
    if not es_dueno(did, int(por["id"])) or not es_anfitrion(por):
        raise PermissionError("Solo quien creó el proyecto invita gente")
    if int(uid) == int(por["id"]):
        raise ValueError("Ya estás en el proyecto")
    if not _usuario_de(uid) or not _usuario_de(uid).get("activo"):
        raise ValueError("Esa persona no existe o está inactiva")
    acceso = _dar_acceso_al_panel(int(uid))
    with _conn() as con:
        con.execute("INSERT OR IGNORE INTO colab_miembros (diagrama_id, usuario_id, rol, agregado_por) VALUES (?,?, 'miembro', ?)",
                    (int(did), int(uid), int(por["id"])))
        con.execute("UPDATE colab_diagramas SET actualizado_por=?, actualizado_en=datetime('now') WHERE id=?",
                    (int(por["id"]), int(did)))
    return {"miembros": miembros(did), "acceso_dado": acceso}


def quitar_miembro(did: int, por: dict, uid: int) -> dict:
    """El dueño saca a alguien, o cada quien se sale. El dueño no se sale (archiva el proyecto)."""
    _ensure()
    yo = int(por["id"])
    if es_dueno(did, int(uid)):
        raise ValueError("Quien creó el proyecto no puede salirse; puede archivarlo")
    if int(uid) != yo and not es_dueno(did, yo):
        raise PermissionError("Solo quien creó el proyecto saca a otras personas")
    with _conn() as con:
        con.execute("DELETE FROM colab_miembros WHERE diagrama_id=? AND usuario_id=?", (int(did), int(uid)))
    return {"miembros": miembros(did)}


def _conn():
    con = sqlite3.connect(_DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def _ensure() -> None:
    os.makedirs(os.path.dirname(os.path.abspath(_DB_PATH)), exist_ok=True)
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS colab_diagramas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                descripcion TEXT NOT NULL DEFAULT '',
                doc_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
                version INTEGER NOT NULL DEFAULT 1,
                creado_por INTEGER,
                actualizado_por INTEGER,
                creado_en TEXT NOT NULL DEFAULT (datetime('now')),
                actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
                archivado INTEGER NOT NULL DEFAULT 0,
                colaborador_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS colab_diagrama_versiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diagrama_id INTEGER NOT NULL,
                version INTEGER NOT NULL,
                doc_json TEXT NOT NULL,
                usuario_id INTEGER,
                resumen TEXT NOT NULL DEFAULT '',
                creado_en TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (diagrama_id, version)
            );
        """)
        cols = {r["name"] for r in con.execute("PRAGMA table_info(colab_diagramas)")}
        if "colaborador_id" not in cols:
            con.execute("ALTER TABLE colab_diagramas ADD COLUMN colaborador_id INTEGER")
        # A quién le toca decidir el próximo empate de un nodo de consenso (se
        # alterna en cada desempate). Se llena cuando llegue el nodo de consenso.
        if "turno_actual" not in cols:
            con.execute("ALTER TABLE colab_diagramas ADD COLUMN turno_actual INTEGER")
        # Los diagramas de antes de la columna son del único colaborador que había.
        sueltos = con.execute("SELECT COUNT(*) n FROM colab_diagramas WHERE colaborador_id IS NULL").fetchone()["n"]
        if sueltos:
            ids = colaboradores_ids()
            if len(ids) == 1:
                con.execute("UPDATE colab_diagramas SET colaborador_id=? WHERE colaborador_id IS NULL", (ids[0],))
        # Miembros (3-oct-2026): un proyecto ya no es «del anfitrión con su colaborador» sino de quien
        # lo creó (dueño) y de quienes invite. Los de antes: el anfitrión de dueño y su colaborador.
        con.execute("""CREATE TABLE IF NOT EXISTS colab_miembros (
                           diagrama_id INTEGER NOT NULL,
                           usuario_id INTEGER NOT NULL,
                           rol TEXT NOT NULL DEFAULT 'miembro',
                           agregado_por INTEGER,
                           agregado_en TEXT NOT NULL DEFAULT (datetime('now')),
                           PRIMARY KEY (diagrama_id, usuario_id))""")
        for d in con.execute("SELECT id, colaborador_id FROM colab_diagramas WHERE id NOT IN"
                             " (SELECT diagrama_id FROM colab_miembros)").fetchall():
            con.execute("INSERT OR IGNORE INTO colab_miembros (diagrama_id, usuario_id, rol) VALUES (?,?, 'dueno')",
                        (d["id"], anfitrion_id()))
            if d["colaborador_id"]:
                con.execute("INSERT OR IGNORE INTO colab_miembros (diagrama_id, usuario_id, rol) VALUES (?,?, 'miembro')",
                            (d["id"], int(d["colaborador_id"])))


def _nombre(uid) -> str:
    if not uid:
        return ""
    try:
        from app.services import tickets_db as tdb

        with tdb._conn() as db:
            r = db.execute("SELECT nombre FROM usuarios WHERE id=?", (int(uid),)).fetchone()
        return (r["nombre"] if r else "") or ""
    except Exception:
        return ""


def _participantes_ids(colaborador_id) -> list[int]:
    """La pareja del diagrama: el anfitrión y su colaborador (para votos y turno)."""
    a = anfitrion_id()
    return [a, int(colaborador_id)] if colaborador_id else [a]


# ─── La obra: cada paso es un piso que se construye al llenarlo (26-sep-2026) ───
# Vista «Edificio» de Colaboradores: un proyecto es un edificio y cada caja un piso.
# Un piso sube de etapa a medida que la caja tiene sus piezas. ⚠️ La MISMA regla vive en
# desktop/src/components/colaboradores/obra.ts (el editor la calcula en vivo mientras se
# escribe); si cambia una, cambia la otra — tests/test_colaboradores.py fija los casos.
ETAPAS_OBRA = ("terreno", "cimientos", "estructura", "fachada", "terminado")


def piezas_obra(n: dict) -> tuple[list[str], list[str], int]:
    """(piezas que tiene, piezas que faltan, cuántas hacen falta para terminar el piso)."""
    tipo = n.get("tipo")
    v = n.get("variables") or {}
    evidencia = bool(n.get("imagen") or n.get("adjuntos"))
    if tipo == "consenso":
        pares = [("asunto", bool(n.get("asunto"))), ("propuestas", len(n.get("propuestas") or []) >= 2),
                 ("votos", bool(n.get("votos"))), ("decisión", bool(n.get("resuelto")))]
        meta = 4
    elif tipo == "producto":
        pares = [("SKU", bool(n.get("sku"))), ("foto", evidencia), ("receta", bool(n.get("componentes"))),
                 ("precio", bool(n.get("precio")))]
        meta = 4
    elif tipo == "competencia":
        pares = [("publicación", bool(n.get("url"))), ("precio", bool(n.get("precio"))),
                 ("foto", evidencia or bool(n.get("plataforma")))]
        meta = 3
    elif tipo == "proveedor":
        pares = [("entrega", n.get("entrega_dias") is not None), ("insumos", bool(n.get("componentes"))),
                 ("fiabilidad", bool(n.get("fiabilidad")))]
        meta = 3
    else:
        pares = [("cómo", bool(v.get("como"))), ("dónde", bool(v.get("donde"))), ("cuándo", bool(v.get("cuando"))),
                 ("por qué", bool(v.get("porque"))),
                 ("tiempo", n.get("tiempo_min") is not None), ("dinero", bool(n.get("costo") or n.get("precio"))),
                 ("fotos", evidencia), ("detalle", bool(n.get("datos") or n.get("consecuencias")))]
        meta = 5
    return [k for k, ok in pares if ok], [k for k, ok in pares if not ok], meta


def etapa_obra(n: dict) -> int:
    """0 terreno · 1 cimientos · 2 estructura · 3 fachada · 4 terminado."""
    tiene, _, meta = piezas_obra(n)
    if not tiene:
        return 0
    frac = min(1.0, len(tiene) / meta)
    etapa = 4 if frac >= 1 else 1 if frac < 0.4 else 2 if frac < 0.7 else 3
    if n.get("tipo") == "consenso" and not n.get("resuelto"):
        etapa = min(etapa, 3)                       # sin decisión, el piso no se termina
    return etapa


def resumen_obra(doc: dict) -> dict:
    nodos = doc.get("nodes") or []
    etapas = [etapa_obra(n) for n in nodos if isinstance(n, dict)]
    return {"pisos": len(etapas), "terminados": sum(1 for e in etapas if e == 4),
            "avance": round(sum(etapas) / (4 * len(etapas)), 3) if etapas else 0.0}


def _a_dict(r, *, con_doc: bool = True) -> dict:
    d = dict(r)
    doc = json.loads(d.pop("doc_json") or "{}")
    if con_doc:
        d["doc"] = doc
        # Quiénes pueden votar, con nombre: la caja de consenso los muestra.
        d["participantes"] = {str(uid): _nombre(uid) for uid in miembros_ids(d["id"])}
        # La operación con sus valores por defecto (avatares de hoy) y el dharma de cada persona.
        d["operacion"] = operacion_de(doc, d.get("colaborador_id"))
        d["dharma"] = dharma(doc, d.get("colaborador_id"))
    d["nodos"] = len(doc.get("nodes") or [])
    d["flechas"] = len(doc.get("edges") or [])
    d["obra"] = resumen_obra(doc)
    d["actualizado_por_nombre"] = _nombre(d.get("actualizado_por"))
    d["miembros"] = miembros(d["id"])
    return d


def _texto(v, n: int) -> str:
    return str(v or "").strip()[:n]


def _num(v):
    """Un número >= 0, o None si no viene. Topado para que no entre basura."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f < 0:                      # NaN o negativo
        return None
    return round(min(f, 1e12), 2)


def _dinero(v):
    """{monto, moneda} o None. La moneda sale de una lista cerrada."""
    if not isinstance(v, dict):
        return None
    monto = _num(v.get("monto"))
    if monto is None:
        return None
    moneda = v.get("moneda") if v.get("moneda") in MONEDAS else MONEDAS[0]
    return {"monto": monto, "moneda": moneda}


def _url(v) -> str:
    """Solo http(s). El enlace se pinta como <a href>: un `javascript:` sería XSS."""
    u = str(v or "").strip()[:500]
    if not u or any(c.isspace() for c in u):
        return ""
    return u if u.lower().startswith(("http://", "https://")) else ""


def _extras_nodo(n: dict) -> dict:
    """Los campos ricos de una caja: solo se guarda lo que trae valor."""
    extra: dict = {}
    # ── Producto y competencia: datos reales, no pasos genéricos ──
    sku = _texto(n.get("sku"), 40)
    if sku:
        extra["sku"] = sku
    emp = n.get("empaque")
    if isinstance(emp, dict):
        nombre, costo = _texto(emp.get("nombre"), 120), _dinero(emp.get("costo"))
        if nombre or costo:
            extra["empaque"] = {"nombre": nombre, **({"costo": costo} if costo else {})}
    # ── Proveedor (vista Operación): días de entrega y fiabilidad 1–5; sus insumos van en componentes ──
    entrega = _num(n.get("entrega_dias"))
    if entrega is not None:
        extra["entrega_dias"] = max(0, min(365, entrega))
    try:
        fia = int(n.get("fiabilidad"))
        if 1 <= fia <= 5:
            extra["fiabilidad"] = fia
    except (TypeError, ValueError):
        pass
    # ── Dónde está y quién la lleva: la habitación del edificio, su ícono y su responsable (avatar) ──
    for campo, largo in (("habitacion", 40), ("avatar", 40)):
        val = _texto(n.get(campo), largo)
        if val:
            extra[campo] = val
    if n.get("icono") in ICONOS:
        extra["icono"] = n["icono"]
    skill = _texto(n.get("skill"), 40)            # consenso: la habilidad que desempata
    if skill:
        extra["skill"] = skill
    comps = []
    for c in (n.get("componentes") or [])[:MAX_COMPONENTES * 4]:
        if len(comps) >= MAX_COMPONENTES:        # el tope cuenta piezas válidas, no filas vacías
            break
        nombre = _texto((c or {}).get("nombre"), 120)
        if not nombre:
            continue
        fila = {"nombre": nombre}
        cantidad = _texto((c or {}).get("cantidad"), 40)      # "2 aros", "30 cm": texto con su unidad
        if cantidad:
            fila["cantidad"] = cantidad
        costo = _dinero((c or {}).get("costo"))               # lo que cuesta esa pieza en UNA unidad
        if costo:
            fila["costo"] = costo
        sku_hijo = _texto((c or {}).get("sku"), 40)             # el SKU hijo: la pieza dentro del combo
        if sku_hijo:
            fila["sku"] = sku_hijo
        prov = _texto((c or {}).get("proveedor"), 64)          # id de la caja del proveedor que la vende
        if prov:
            fila["proveedor"] = prov
        comps.append(fila)
    if comps:
        extra["componentes"] = comps
    url = _url(n.get("url"))
    if url:
        extra["url"] = url
    plataforma = _texto(n.get("plataforma"), 60)
    if plataforma:
        extra["plataforma"] = plataforma
    img = _texto(n.get("imagen"), 80)
    if img:
        extra["imagen"] = img
    variables = {k: _texto((n.get("variables") or {}).get(k), 200) for k in VARIABLES}
    variables = {k: v for k, v in variables.items() if v}
    if variables:
        extra["variables"] = variables
    tiempo = _num(n.get("tiempo_min"))
    if tiempo is not None:
        extra["tiempo_min"] = tiempo
    for campo in ("costo", "precio"):
        d = _dinero(n.get(campo))
        if d:
            extra[campo] = d
    datos = []
    for d in (n.get("datos") or [])[:MAX_DATOS]:
        campo, valor = _texto((d or {}).get("campo"), 40), _texto((d or {}).get("valor"), 120)
        if campo or valor:
            datos.append({"campo": campo, "valor": valor})
    if datos:
        extra["datos"] = datos
    cons = []
    for c in (n.get("consecuencias") or [])[:MAX_CONSECUENCIAS]:
        fila = {k: _texto((c or {}).get(k), 160) for k in ("si", "entonces", "medida")}
        if any(fila.values()):
            cons.append(fila)
    if cons:
        extra["consecuencias"] = cons
    adj = []
    for a in (n.get("adjuntos") or [])[:MAX_ADJUNTOS]:
        mid = _texto((a or {}).get("id"), 80)
        if not mid:
            continue
        adj.append({"id": mid, "nombre": _texto((a or {}).get("nombre"), 120),
                    "tipo": (a or {}).get("tipo") if (a or {}).get("tipo") in MEDIA_TIPOS else "imagen"})
    if adj:
        extra["adjuntos"] = adj
    enlace = _texto(n.get("enlaceApp"), 120)
    if enlace:
        extra["enlaceApp"] = enlace
    # ── Consenso: propuestas puestas a votación, votos y decisión ──
    asunto = _texto(n.get("asunto"), 300)
    if asunto:
        extra["asunto"] = asunto
    propuestas, pids = [], set()
    for p in (n.get("propuestas") or [])[:MAX_PROPUESTAS]:
        texto = _texto((p or {}).get("texto"), 500)
        if not texto:
            continue
        pid = _texto((p or {}).get("id"), 40) or f"p{len(propuestas)}"
        if pid in pids:
            continue
        pids.add(pid)
        fila = {"id": pid, "texto": texto}
        try:
            autor = int((p or {}).get("autor"))
            if autor:
                fila["autor"] = autor
        except (TypeError, ValueError):
            pass
        propuestas.append(fila)
    if propuestas:
        extra["propuestas"] = propuestas
    votos = {}
    for k, v in (n.get("votos") or {}).items():
        try:
            uid = int(k)
        except (TypeError, ValueError):
            continue
        pid = _texto(v, 40)
        if uid and pid in pids:                  # solo un voto por una propuesta que exista
            votos[str(uid)] = pid
    if votos:
        extra["votos"] = votos
    res = n.get("resuelto")
    if isinstance(res, dict):
        pid = _texto(res.get("propuesta"), 40)
        if pid in pids:
            r2 = {"propuesta": pid, "modo": res.get("modo") if res.get("modo") in MODOS_RESUELTO else "acuerdo"}
            try:
                por = int(res.get("por"))
                if por:
                    r2["por"] = por
            except (TypeError, ValueError):
                pass
            extra["resuelto"] = r2
    return extra


def validar_doc(doc) -> dict:
    """Normaliza el documento y rechaza lo que no es un diagrama."""
    if not isinstance(doc, dict):
        raise ValueError("El diagrama debe ser un objeto con nodes y edges")
    nodos_in, flechas_in = doc.get("nodes") or [], doc.get("edges") or []
    if not isinstance(nodos_in, list) or not isinstance(flechas_in, list):
        raise ValueError("nodes y edges deben ser listas")
    if len(nodos_in) > MAX_NODOS:
        raise ValueError(f"Máximo {MAX_NODOS} cajas por diagrama")
    nodos, ids = [], set()
    for n in nodos_in:
        nid = str((n or {}).get("id") or "").strip()[:64]
        if not nid or nid in ids:
            raise ValueError("Cada caja necesita un id único")
        ids.add(nid)
        nodos.append({
            "id": nid,
            "label": str(n.get("label") or "").strip()[:120] or "Sin título",
            "sublabel": str(n.get("sublabel") or "").strip()[:200],
            "tipo": n.get("tipo") if n.get("tipo") in TIPOS else "accion",
            "carril": (lambda c: c if c in CARRILES else "conjunto")(_CARRILES_VIEJOS.get(n.get("carril"), n.get("carril"))),
            "x": round(float(n.get("x") or 0), 1),
            "y": round(float(n.get("y") or 0), 1),
            **_extras_nodo(n),
        })
    flechas, eids = [], set()
    for e in flechas_in:
        eid = str((e or {}).get("id") or "").strip()[:80]
        a, b = str(e.get("from") or ""), str(e.get("to") or "")
        if not eid or eid in eids or a not in ids or b not in ids or a == b:
            continue          # una flecha suelta (su caja se borró) no se guarda
        eids.add(eid)
        grosor = e.get("grosor")
        try:
            grosor = max(GROSOR_MIN, min(GROSOR_MAX, int(round(float(grosor)))))
        except (TypeError, ValueError):
            grosor = 2
        flechas.append({
            "id": eid, "from": a, "to": b,
            "label": str(e.get("label") or "").strip()[:80],
            # Por dónde toca cada caja (lo que el usuario mueve con el dedo).
            "fromLado": e.get("fromLado") if e.get("fromLado") in LADOS else "r",
            "toLado": e.get("toLado") if e.get("toLado") in LADOS else "l",
            "color": e.get("color") if e.get("color") in COLORES_FLECHA else COLORES_FLECHA[0],
            "grosor": grosor,
            "trazo": e.get("trazo") if e.get("trazo") in TRAZOS else "solida",
            "forma": e.get("forma") if e.get("forma") in FORMAS else FORMA_DEFECTO,
            # La flecha ahora es una ENTREGA: el avatar que lleva la caja de un lugar a otro.
            **({"portador": _texto(e.get("portador"), 40)} if _texto(e.get("portador"), 40) else {}),
        })
    out = {"nodes": nodos, "edges": flechas}
    if isinstance(doc.get("operacion"), dict):
        out["operacion"] = validar_operacion(doc["operacion"], ids)
    return out


def listar(usuario: dict, incluir_archivados: bool = False) -> list[dict]:
    _ensure()
    conds, params = ["id IN (SELECT diagrama_id FROM colab_miembros WHERE usuario_id=?)"], [int(usuario.get("id") or 0)]
    if not incluir_archivados:
        conds.append("archivado=0")
    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    with _conn() as con:
        filas = con.execute("SELECT * FROM colab_diagramas" + where + " ORDER BY actualizado_en DESC", params)
        return [_a_dict(r, con_doc=False) for r in filas]


def obtener(did: int, usuario: dict | None = None) -> dict | None:
    _ensure()
    if usuario is not None and not puede_ver(did, usuario):
        return None
    with _conn() as con:
        r = con.execute("SELECT * FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
    return _a_dict(r) if r else None


def crear(titulo: str, usuario_id: int, descripcion: str = "", doc: dict | None = None,
          colaborador_id: int | None = None) -> dict:
    _ensure()
    titulo = (titulo or "").strip()[:120]
    if not titulo:
        raise ValueError("El diagrama necesita un título")
    limpio = validar_doc(doc or {"nodes": [], "edges": []})
    # Quién está (3-oct-2026): el que lo crea es el dueño. Un proyecto de un anfitrión nace PERSONAL
    # salvo que traiga `colaborador_id` (y se comparte después invitando); el que crea un colaborador
    # externo nace compartido con el anfitrión, como siempre.
    ids = colaboradores_ids()
    invitado = None
    if int(usuario_id) in ids:
        pareja, invitado = int(usuario_id), anfitrion_id()
    elif colaborador_id and int(colaborador_id) in ids:
        pareja = invitado = int(colaborador_id)
    else:
        pareja = None
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO colab_diagramas (titulo, descripcion, doc_json, creado_por, actualizado_por, colaborador_id)"
            " VALUES (?,?,?,?,?,?)",
            (titulo, (descripcion or "").strip()[:500], json.dumps(limpio, ensure_ascii=False), usuario_id, usuario_id,
             pareja),
        )
        did = cur.lastrowid
        con.execute("INSERT INTO colab_diagrama_versiones (diagrama_id, version, doc_json, usuario_id, resumen)"
                    " VALUES (?,?,?,?,?)", (did, 1, json.dumps(limpio, ensure_ascii=False), usuario_id, "Creado"))
        con.execute("INSERT INTO colab_miembros (diagrama_id, usuario_id, rol, agregado_por) VALUES (?,?, 'dueno', ?)",
                    (did, int(usuario_id), int(usuario_id)))
        if invitado and int(invitado) != int(usuario_id):
            con.execute("INSERT OR IGNORE INTO colab_miembros (diagrama_id, usuario_id, rol, agregado_por) VALUES (?,?, 'miembro', ?)",
                        (did, int(invitado), int(usuario_id)))
    return obtener(did)


def guardar(did: int, doc: dict, version_base: int, usuario_id: int, *, titulo: str | None = None,
            descripcion: str | None = None, resumen: str = "") -> dict:
    """Guarda una nueva versión SOLO si nadie guardó encima de la que se editó."""
    _ensure()
    doc = {k: v for k, v in (doc or {}).items() if k != "operacion"} if isinstance(doc, dict) else doc
    with _conn() as con:
        r = con.execute("SELECT * FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
        if not r:
            raise ValueError("Diagrama no encontrado")
        if int(r["version"]) != int(version_base):
            raise Conflicto(_a_dict(r))
        # La operación (fases, inventario, ventas, reglas) SOLO la cambian las acciones del servidor
        # (accion_operacion): un guardado del tablero —o restaurar una versión— la conserva tal cual.
        previa = json.loads(r["doc_json"] or "{}").get("operacion")
        limpio = validar_doc({**doc, **({"operacion": previa} if previa else {})})
        nueva = int(r["version"]) + 1
        # UPDATE condicionado a la versión: si dos guardan en el mismo instante,
        # solo uno pasa (rowcount 0 para el otro).
        cur = con.execute(
            "UPDATE colab_diagramas SET doc_json=?, version=?, actualizado_por=?, actualizado_en=datetime('now'),"
            " titulo=COALESCE(?, titulo), descripcion=COALESCE(?, descripcion) WHERE id=? AND version=?",
            (json.dumps(limpio, ensure_ascii=False), nueva, usuario_id,
             (titulo or "").strip()[:120] or None, None if descripcion is None else descripcion.strip()[:500],
             int(did), int(version_base)),
        )
        if cur.rowcount == 0:
            raise Conflicto(_a_dict(con.execute("SELECT * FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()))
        con.execute("INSERT INTO colab_diagrama_versiones (diagrama_id, version, doc_json, usuario_id, resumen)"
                    " VALUES (?,?,?,?,?)", (int(did), nueva, json.dumps(limpio, ensure_ascii=False), usuario_id,
                                           (resumen or "").strip()[:200]))
    return obtener(did)


def versiones(did: int, limite: int = 100) -> list[dict]:
    _ensure()
    with _conn() as con:
        filas = con.execute(
            "SELECT id, version, usuario_id, resumen, creado_en, doc_json FROM colab_diagrama_versiones"
            " WHERE diagrama_id=? ORDER BY version DESC LIMIT ?", (int(did), int(limite))).fetchall()
    out = []
    for f in filas:
        doc = json.loads(f["doc_json"] or "{}")
        out.append({"version": f["version"], "usuario_id": f["usuario_id"], "usuario": _nombre(f["usuario_id"]),
                    "resumen": f["resumen"], "creado_en": f["creado_en"],
                    "nodos": len(doc.get("nodes") or []), "flechas": len(doc.get("edges") or [])})
    return out


def restaurar(did: int, version: int, version_base: int, usuario_id: int) -> dict:
    """Vuelve a una versión anterior creando una versión NUEVA (no se borra historia)."""
    _ensure()
    with _conn() as con:
        f = con.execute("SELECT doc_json FROM colab_diagrama_versiones WHERE diagrama_id=? AND version=?",
                        (int(did), int(version))).fetchone()
    if not f:
        raise ValueError("Esa versión no existe")
    return guardar(did, json.loads(f["doc_json"]), version_base, usuario_id, resumen=f"Restaurada la versión {version}")


# ─── La operación: el diorama de la cadena de valor (26-sep-2026) ─────────────
# Vista «Operación» de Colaboradores: un juego de gestión sobre el proyecto. Pisos fijos —
# subsuelo (proveedores) · P1 compras y ensamblaje · P2 el hub de McKenna (bóveda e inventario) ·
# P3 orquestación y ventas · techo (cliente final)— y un bucle de misiones por producto:
# comprar insumos → craftear y vender a McKenna (venta interna) → publicar → ¡venta! → reparto.
# Todo vive en doc["operacion"] y SOLO lo cambia accion_operacion (el guardado del tablero lo
# conserva). ⚠️ Es una SIMULACIÓN del proyecto: no escribe en Alegra, ni en el inventario, ni en
# el Libro Mayor.
FASES_ITEM = ("sourcing", "ensamblado", "en_mckenna", "publicado")
COLORES_AVATAR = ("#b45309", "#1d4ed8", "#0f766e", "#7c3aed", "#b91c1c", "#15803d", "#374151")
# Colores de piso (PICO-8): el color es de la fachada y de la placa.
COLORES_PISO = ("#5F574F", "#FFA300", "#1D2B53", "#7E2553", "#29ADFF", "#FFEC27", "#008751", "#AB5236", "#83769C", "#FF77A8")
MAX_AVATARES = 8
MAX_VENTAS = 500
MAX_BITACORA = 200
MAX_PISOS = 12
MAX_HABITACIONES = 8
MAX_CAMPOS_ENTE = 10
MAX_REGLAS = 10

# El edificio con el que arranca todo proyecto (de abajo arriba). Se renombra, se reordena y se
# amplía en «Construir»: ninguno de estos nombres es obligatorio.
EDIFICIO_POR_DEFECTO = [
    ("mercado", "Mercado externo", "#5F574F", [("proveedores", "Proveedores")]),
    ("compras", "Compras y logística", "#FFA300", [("bodega", "Bodega de insumos"), ("taller", "Taller de ensamblaje")]),
    ("hub", "Hub · McKenna Group S.A.S.", "#1D2B53", [("boveda", "Bóveda e inventario"), ("sala", "Sala común")]),
    ("mesa", "Mesa de guerra", "#7E2553", [("decisiones", "Sala de decisiones")]),
    ("orquestacion", "Orquestación y ventas", "#29ADFF", [("estudio", "Estudio de diseño"), ("sistemas", "Sala de sistemas")]),
    ("cliente", "Cliente final", "#FFEC27", [("tienda", "Tienda")]),
]


def edificio_por_defecto() -> dict:
    return {"pisos": [{"id": pid, "nombre": nom, "color": col,
                       "habitaciones": [{"id": hid, "nombre": hnom} for hid, hnom in habs]}
                      for pid, nom, col, habs in EDIFICIO_POR_DEFECTO]}


def _pct(v, tope: float = 100.0) -> float:
    try:
        return max(0.0, min(tope, round(float(v), 2)))
    except (TypeError, ValueError):
        return 0.0


def avatares_por_defecto(colaborador_id=None) -> list[dict]:
    """Los dos jugadores de hoy. Un tercero se agrega en «Reglas» sin tocar código."""
    return [
        {"id": "sebastian", "nombre": "Sebastián García", "rol": "Compras y ensamblaje",
         "skills": ["negociación", "compra", "ensamblaje"], "piso": "compras", "color": "#b45309",
         "carril": "sebastian", "usuario_id": int(colaborador_id) if colaborador_id else None},
        {"id": "armando", "nombre": "Armando García", "rol": "Orquestación y ventas",
         "skills": ["orquestación", "e-commerce", "diseño", "sistemas"], "piso": "orquestacion",
         "color": "#1d4ed8", "carril": "armando", "usuario_id": anfitrion_id()},
    ]


def _validar_edificio(ed) -> dict:
    pisos, ids = [], set()
    for p in ((ed or {}).get("pisos") or [])[:MAX_PISOS]:
        pid = _texto((p or {}).get("id"), 40)
        nombre = _texto((p or {}).get("nombre"), 60)
        if not pid or not nombre or pid in ids:
            continue
        ids.add(pid)
        habs = []
        for h in (p.get("habitaciones") or [])[:MAX_HABITACIONES]:
            hid, hnom = _texto((h or {}).get("id"), 40), _texto((h or {}).get("nombre"), 60)
            if hid and hnom and hid not in ids:
                ids.add(hid)
                habs.append({"id": hid, "nombre": hnom})
        if not habs:                               # un piso sin habitaciones no tiene dónde poner cajas
            hid = f"{pid}-h1"
            if hid not in ids:
                ids.add(hid)
                habs.append({"id": hid, "nombre": "Espacio"})
        pisos.append({"id": pid, "nombre": nombre,
                      "color": p.get("color") if p.get("color") in COLORES_PISO else COLORES_PISO[len(pisos) % len(COLORES_PISO)],
                      "habitaciones": habs})
    return {"pisos": pisos} if pisos else edificio_por_defecto()


def _validar_reparto(rep: dict) -> dict:
    """Partidas con nombre (las pone el usuario): base costo o venta, %, y para quién.
    Lo que no reparten las partidas queda en la bóveda, que también se nombra."""
    if "reglas" not in rep:
        # Formato anterior (ensamblaje_pct / servicios_pct): se traduce a partidas con nombre.
        rep = {"reglas": [
            {"id": "insumos", "nombre": "Insumos", "base": "costo", "pct": 100, "para": "sebastian"},
            {"id": "ensamblaje", "nombre": "Ensamblaje", "base": "costo", "pct": rep.get("ensamblaje_pct") or 0, "para": "sebastian"},
            {"id": "servicios", "nombre": "Servicios", "base": "venta", "pct": rep.get("servicios_pct") or 0, "para": "armando"},
        ]}
    reglas, ids = [], set()
    for rg in (rep.get("reglas") or [])[:MAX_REGLAS]:
        rid, nombre = _texto((rg or {}).get("id"), 40), _texto((rg or {}).get("nombre"), 40)
        if not rid or not nombre or rid in ids:
            continue
        ids.add(rid)
        reglas.append({"id": rid, "nombre": nombre, "base": rg.get("base") if rg.get("base") in ("costo", "venta") else "venta",
                       "pct": _pct(rg.get("pct"), 1000.0), "para": _texto(rg.get("para"), 40) or "boveda"})
    return {"reglas": reglas, "boveda": _texto(rep.get("boveda"), 40) or "Bóveda"}


def _validar_ente(ente_in: dict) -> dict:
    """El ente: su nombre y campos que se nombran libremente («margen» era un nombre fijo que no servía)."""
    campos = [{"nombre": _texto((c or {}).get("nombre"), 40), "valor": _texto((c or {}).get("valor"), 80)}
              for c in (ente_in.get("campos") or [])[:MAX_CAMPOS_ENTE]]
    if "campos" not in ente_in:                    # formato anterior: se conservan los valores como campos
        if ente_in.get("margen_pct") not in (None, ""):
            campos.append({"nombre": "Margen objetivo", "valor": f"{ente_in['margen_pct']} %"})
        for k, etq in (("costos_fijos", "Costos fijos / mes"), ("capital", "Capital")):
            d = _dinero(ente_in.get(k))
            if d:
                campos.append({"nombre": etq, "valor": f"{d['monto']:,.0f} {d['moneda']}".replace(",", ".")})
    return {"nombre": _texto(ente_in.get("nombre"), 80) or "McKenna Group S.A.S.",
            "campos": [c for c in campos if c["nombre"] or c["valor"]]}


def validar_operacion(op: dict, ids_nodos: set | None = None) -> dict:
    ids_nodos = ids_nodos or set()
    avatares, vistos = [], set()
    for a in (op.get("avatares") or [])[:MAX_AVATARES]:
        aid = _texto((a or {}).get("id"), 40)
        nombre = _texto((a or {}).get("nombre"), 80)
        if not aid or not nombre or aid in vistos:
            continue
        vistos.add(aid)
        try:
            uid = int((a or {}).get("usuario_id")) or None
        except (TypeError, ValueError):
            uid = None
        avatares.append({
            "id": aid, "nombre": nombre, "rol": _texto(a.get("rol"), 80),
            "skills": [x for x in (_texto(k, 30) for k in (a.get("skills") or [])[:10]) if x],
            "piso": _texto(a.get("piso"), 40) or "hub",   # id de un piso del edificio
            "color": a.get("color") if a.get("color") in COLORES_AVATAR else COLORES_AVATAR[len(avatares) % len(COLORES_AVATAR)],
            "carril": a.get("carril") if a.get("carril") in CARRILES else None,
            "usuario_id": uid,
        })
    items = {}
    for nid, it in (op.get("items") or {}).items():
        if ids_nodos and nid not in ids_nodos:
            continue                                   # la caja se borró: su estado se va con ella
        try:
            unidades = max(0, min(1_000_000, int((it or {}).get("unidades") or 0)))
        except (TypeError, ValueError):
            unidades = 0
        items[str(nid)[:64]] = {"fase": it.get("fase") if it.get("fase") in FASES_ITEM else "sourcing", "unidades": unidades}
    resultados = {str(k)[:64]: v for k, v in (op.get("resultados") or {}).items() if v in ("bien", "mal")}
    return {
        "edificio": _validar_edificio(op.get("edificio")),
        "ente": _validar_ente(op.get("ente") or {}),
        "avatares": avatares,
        "reparto": _validar_reparto(op.get("reparto") or {}),
        "items": items,
        "ventas": [v for v in (op.get("ventas") or []) if isinstance(v, dict)][-MAX_VENTAS:],
        "resultados": resultados,
        "bitacora": [b for b in (op.get("bitacora") or []) if isinstance(b, dict)][-MAX_BITACORA:],
    }


def operacion_de(doc: dict, colaborador_id=None) -> dict:
    """La operación del proyecto, con los valores por defecto si nunca se configuró."""
    op = validar_operacion(doc.get("operacion") or {}, {n.get("id") for n in doc.get("nodes") or []})
    if not op["avatares"]:
        op["avatares"] = avatares_por_defecto(colaborador_id)
    return op


def costo_unitario(nodo: dict) -> tuple[float, str, list[str]]:
    """Lo que cuesta armar UNA unidad (receta + empaque) en la moneda del precio, y lo que no se pudo sumar."""
    moneda = (nodo.get("precio") or {}).get("moneda") or "COP"
    total, fuera = 0.0, []
    piezas = [(c.get("nombre"), c.get("costo")) for c in (nodo.get("componentes") or [])]
    emp = nodo.get("empaque") or {}
    if emp.get("costo"):
        piezas.append((emp.get("nombre") or "empaque", emp.get("costo")))
    for nombre, costo in piezas:
        if not costo:
            continue
        if costo.get("moneda") != moneda:
            fuera.append(f"{nombre} ({costo.get('moneda')})")
            continue
        total += float(costo.get("monto") or 0)
    return round(total, 2), moneda, fuera


def reparto_venta(nodo: dict, op: dict, cantidad: int, precio_unit: float) -> dict:
    """Cómo se divide lo que entra por una venta, según las partidas. Lo que sobra va a la
    bóveda; si las partidas suman más que la venta, la bóveda queda negativa (pérdida)."""
    costo_u, moneda, fuera = costo_unitario(nodo)
    total = round(precio_unit * cantidad, 2)
    costo = round(costo_u * cantidad, 2)
    partes = []
    for rg in op["reparto"]["reglas"]:
        base = costo if rg["base"] == "costo" else total
        partes.append({"id": rg["id"], "nombre": rg["nombre"], "para": rg["para"],
                       "monto": round(base * rg["pct"] / 100, 2)})
    boveda = round(total - sum(p["monto"] for p in partes if p["para"] != "boveda"), 2)
    return {"moneda": moneda, "total": total, "costo": costo, "partes": partes,
            "boveda_nombre": op["reparto"]["boveda"], "boveda": boveda, "sin_sumar": fuera}


def accion_operacion(did: int, usuario_id: int, accion: str, datos: dict | None = None) -> dict:
    """Una jugada de la operación, con autoridad del servidor y dentro de una transacción.

    reglas · comprar · craftear · publicar · vender · resultado (el «dharma» de una decisión).
    Queda en la bitácora quién la hizo. No se exige que cada jugada la haga el avatar de su piso:
    se registra quién la hizo (con una sola persona usando la app, bloquearlo impediría jugar).
    """
    _ensure()
    datos = datos or {}
    uid = int(usuario_id)
    with _conn() as con:
        r = con.execute("SELECT * FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
        if not r:
            raise ValueError("Diagrama no encontrado")
        doc = json.loads(r["doc_json"] or "{}")
        op = operacion_de(doc, r["colaborador_id"])
        nodos = {n.get("id"): n for n in doc.get("nodes") or []}
        quien = _nombre(uid)

        def item(nid: str) -> tuple[dict, dict]:
            n = nodos.get(nid)
            if not n or n.get("tipo") != "producto":
                raise ValueError("Ese producto no existe en el tablero")
            return n, op["items"].setdefault(nid, {"fase": "sourcing", "unidades": 0})

        def anotar(texto: str, **extra):
            op["bitacora"].append({"fecha": datetime.now().strftime("%Y-%m-%d %H:%M"), "por": uid,
                                   "quien": quien, "texto": texto[:300], **extra})

        if accion == "edificio":
            ed = _validar_edificio(datos.get("edificio"))
            op["edificio"] = ed
            anotar(f"reorganizó el edificio: {len(ed['pisos'])} pisos")
        elif accion == "reglas":
            nueva = validar_operacion({**op, **{k: datos[k] for k in ("ente", "avatares", "reparto") if k in datos}},
                                      set(nodos))
            if not nueva["avatares"]:
                raise ValueError("Tiene que quedar al menos un avatar")
            op = nueva
            anotar("cambió las reglas del juego")
        elif accion == "comprar":
            n, it = item(str(datos.get("nodo") or ""))
            if it["fase"] == "sourcing":
                it["fase"] = "ensamblado"
            anotar(f"compró los insumos de «{n.get('label')}»", nodo=n["id"])
        elif accion == "craftear":
            n, it = item(str(datos.get("nodo") or ""))
            if it["fase"] == "sourcing":
                raise ValueError("Primero hay que comprar los insumos")
            try:
                cant = int(datos.get("cantidad") or 1)
            except (TypeError, ValueError):
                cant = 1
            if not 1 <= cant <= 10_000:
                raise ValueError("La cantidad va de 1 a 10.000")
            it["unidades"] += cant
            if it["fase"] == "ensamblado":
                it["fase"] = "en_mckenna"
            costo_u, moneda, _ = costo_unitario(n)
            anotar(f"ensambló {cant} × «{n.get('label')}» y se los vendió a {op['ente']['nombre']}",
                   nodo=n["id"], cantidad=cant, valor={"monto": round(costo_u * cant, 2), "moneda": moneda})
        elif accion == "publicar":
            n, it = item(str(datos.get("nodo") or ""))
            if it["fase"] in ("sourcing", "ensamblado"):
                raise ValueError("Todavía no hay unidades en McKenna para publicar")
            it["fase"] = "publicado"
            anotar(f"publicó «{n.get('label')}»", nodo=n["id"])
        elif accion == "vender":
            n, it = item(str(datos.get("nodo") or ""))
            if it["fase"] != "publicado":
                raise ValueError("El producto tiene que estar publicado para venderse")
            try:
                cant = int(datos.get("cantidad") or 1)
            except (TypeError, ValueError):
                cant = 1
            if cant < 1 or cant > it["unidades"]:
                raise ValueError(f"En la bóveda hay {it['unidades']} unidades")
            precio = _dinero(datos.get("precio")) or n.get("precio")
            if not precio:
                raise ValueError("El producto no tiene precio: ponlo en su caja o escríbelo al vender")
            rep = reparto_venta(n, op, cant, float(precio["monto"]))
            if precio.get("moneda") != rep["moneda"]:
                raise ValueError("El precio de la venta tiene que ir en la moneda del producto")
            it["unidades"] -= cant
            venta = {"id": uuid.uuid4().hex[:10], "nodo": n["id"], "cantidad": cant, "precio_unit": precio,
                     "fecha": datetime.now().strftime("%Y-%m-%d %H:%M"), "por": uid, "reparto": rep}
            op["ventas"].append(venta)
            anotar(f"¡vendió {cant} × «{n.get('label')}»!", nodo=n["id"], venta=venta["id"])
        elif accion == "resultado":
            nid = str(datos.get("nodo") or "")
            n = nodos.get(nid)
            if not n or n.get("tipo") != "consenso" or not n.get("resuelto"):
                raise ValueError("Solo se califica una decisión ya tomada")
            valor = datos.get("valor")
            if valor in ("bien", "mal"):
                op["resultados"][nid] = valor
                anotar(f"calificó la decisión «{n.get('label')}»: salió {valor}", nodo=nid)
            else:
                op["resultados"].pop(nid, None)
        else:
            raise ValueError("Jugada no reconocida")

        doc["operacion"] = op
        limpio = validar_doc(doc)
        nueva = int(r["version"]) + 1
        con.execute("UPDATE colab_diagramas SET doc_json=?, version=?, actualizado_por=?,"
                    " actualizado_en=datetime('now') WHERE id=?",
                    (json.dumps(limpio, ensure_ascii=False), nueva, uid, int(did)))
        con.execute("INSERT INTO colab_diagrama_versiones (diagrama_id, version, doc_json, usuario_id, resumen)"
                    " VALUES (?,?,?,?,?)", (int(did), nueva, json.dumps(limpio, ensure_ascii=False), uid,
                                           f"operación: {accion}"))
    return obtener(did)


def dharma(doc: dict, colaborador_id=None) -> dict:
    """Puntos por decisión calificada: +1 si salió bien, −1 si salió mal, a quien la decidió
    (el autor de la propuesta ganadora; en un desempate, quien tenía el turno o la habilidad)."""
    op = operacion_de(doc, colaborador_id)
    puntos: dict[str, int] = {}
    for n in doc.get("nodes") or []:
        res = n.get("resuelto") or {}
        valor = op["resultados"].get(n.get("id"))
        if n.get("tipo") != "consenso" or not res or not valor:
            continue
        decidio = res.get("por") if res.get("modo") in ("turno", "skill") else next(
            (p.get("autor") for p in n.get("propuestas") or [] if p.get("id") == res.get("propuesta")), None)
        if decidio:
            puntos[str(decidio)] = puntos.get(str(decidio), 0) + (1 if valor == "bien" else -1)
    return puntos


def accion_consenso(did: int, usuario_id: int, nodo_id: str, accion: str,
                    texto: str = "", propuesta: str = "") -> dict:
    """Vota, propone o cierra un nodo de consenso — con autoridad del servidor.

    El voto y la autoría de la propuesta son del usuario AUTENTICADO (no de lo
    que diga el cliente), y el desempate usa el `turno_actual` GLOBAL del
    diagrama, que se alterna entre la pareja en cada empate resuelto por turno.
    Todo dentro de una transacción: leer-modificar-guardar sin pisarse.
    """
    _ensure()
    uid = int(usuario_id)
    with _conn() as con:
        r = con.execute("SELECT * FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
        if not r:
            raise ValueError("Diagrama no encontrado")
        doc = json.loads(r["doc_json"] or "{}")
        nodo = next((x for x in (doc.get("nodes") or []) if x.get("id") == nodo_id), None)
        if not nodo:
            raise ValueError("Esa caja no existe")
        props = list(nodo.get("propuestas") or [])
        votos = dict(nodo.get("votos") or {})
        pares = _participantes_ids(r["colaborador_id"])

        if accion == "proponer":
            pid = f"p{uid}"                       # una propuesta por persona
            props = [p for p in props if p.get("id") != pid]
            t = (texto or "").strip()[:500]
            if t:
                props.append({"id": pid, "autor": uid, "texto": t})
            else:                                 # se retiró: fuera sus votos
                votos = {k: v for k, v in votos.items() if v != pid}
            nodo["resuelto"] = None               # cambió una propuesta: se reabre
        elif accion == "votar":
            if not any(p.get("id") == propuesta for p in props):
                raise ValueError("Esa propuesta ya no existe")
            votos[str(uid)] = propuesta
        elif accion == "quitar_voto":
            votos.pop(str(uid), None)
        elif accion == "reabrir":
            nodo["resuelto"] = None
        elif accion == "cerrar":
            if not props:
                raise ValueError("Todavía no hay propuestas para decidir")
            from collections import Counter
            cuenta = Counter(votos.values())
            top = max(cuenta.values()) if cuenta else 0
            lideres = [pid for pid, c in cuenta.items() if c == top and top > 0]
            if len(lideres) == 1:
                nodo["resuelto"] = {"propuesta": lideres[0], "modo": "acuerdo"}
            else:
                # Empate: si la decisión pide una habilidad y solo UNA de las personas la tiene
                # (avatares de la operación), decide ella. Si no, el turno global alterno.
                nodo["resuelto"] = None
                skill = (nodo.get("skill") or "").strip().lower()
                if skill:
                    op = operacion_de(doc, r["colaborador_id"])
                    expertos = {a["usuario_id"] for a in op["avatares"] if a.get("usuario_id") in pares
                                and any(skill == k.lower() for k in a["skills"])}
                    if len(expertos) == 1:
                        experto = expertos.pop()
                        elegido = votos.get(str(experto))
                        if elegido:
                            nodo["resuelto"] = {"propuesta": elegido, "modo": "skill", "por": experto}
                if not nodo.get("resuelto"):
                    turno = int(r["turno_actual"] or pares[0])
                    elegido = votos.get(str(turno))
                    if not elegido:
                        raise ValueError("Hay empate: falta el voto de quien tiene el turno para desempatar")
                    nodo["resuelto"] = {"propuesta": elegido, "modo": "turno", "por": turno}
                    # El turno pasa al otro para el próximo empate.
                    siguiente = next((p for p in pares if p != turno), turno)
                    con.execute("UPDATE colab_diagramas SET turno_actual=? WHERE id=?", (siguiente, int(did)))
        else:
            raise ValueError("Acción no reconocida")

        nodo["propuestas"] = props
        nodo["votos"] = votos
        limpio = validar_doc(doc)
        nueva = int(r["version"]) + 1
        con.execute("UPDATE colab_diagramas SET doc_json=?, version=?, actualizado_por=?,"
                    " actualizado_en=datetime('now') WHERE id=?",
                    (json.dumps(limpio, ensure_ascii=False), nueva, uid, int(did)))
        con.execute("INSERT INTO colab_diagrama_versiones (diagrama_id, version, doc_json, usuario_id, resumen)"
                    " VALUES (?,?,?,?,?)", (int(did), nueva, json.dumps(limpio, ensure_ascii=False), uid,
                                           f"consenso: {accion}"))
    return obtener(did)


def archivar(did: int, archivado: bool = True) -> dict:
    _ensure()
    with _conn() as con:
        con.execute("UPDATE colab_diagramas SET archivado=? WHERE id=?", (1 if archivado else 0, int(did)))
    return obtener(did)


# ─── Adjuntos (fotos y facturas de las cajas) ─────────────────────────────────

def guardar_media(did: int, contenido: bytes, nombre: str = "") -> dict:
    """Guarda un adjunto de un diagrama. Imagen → JPEG reducido; PDF → tal cual.

    El id lleva el diagrama adentro (`<did>-<uuid>.<ext>`), así la ruta de
    lectura sabe a qué pareja pertenece sin otra tabla: quien no ve el diagrama
    tampoco ve sus fotos.
    """
    if not contenido:
        raise ValueError("El archivo llegó vacío")
    if len(contenido) > MAX_MEDIA_BYTES:
        raise ValueError("El archivo supera los 15 MB")
    _MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    es_pdf = contenido[:5] == b"%PDF-" or (nombre or "").lower().endswith(".pdf")
    token = uuid.uuid4().hex[:12]
    if es_pdf:
        mid = f"{int(did)}-{token}.pdf"
        (_MEDIA_DIR / mid).write_bytes(contenido)
        return {"id": mid, "tipo": "pdf", "nombre": _texto(nombre, 120)}
    from PIL import Image, ImageOps

    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(contenido))).convert("RGB")
    except Exception as e:
        raise ValueError(f"No se pudo leer la imagen: {e}") from None
    img.thumbnail((_LADO_MAX_FOTO, _LADO_MAX_FOTO))
    mid = f"{int(did)}-{token}.jpg"
    tmp = _MEDIA_DIR / (mid + ".tmp")
    img.save(tmp, "JPEG", quality=82, optimize=True)
    os.replace(tmp, _MEDIA_DIR / mid)
    return {"id": mid, "tipo": "imagen", "nombre": _texto(nombre, 120)}


def media_de_diagrama(mid: str, did: int) -> Path | None:
    """La ruta del adjunto SOLO si su id pertenece a ese diagrama."""
    mid = os.path.basename(str(mid or ""))                 # nada de ../ ni rutas
    if not mid or not mid.startswith(f"{int(did)}-"):
        return None
    p = _MEDIA_DIR / mid
    return p if p.is_file() else None
