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

**Archify.** El documento se guarda con posiciones libres (x, y) porque así se
edita con el dedo. `a_archify()` lo traduce al esquema `workflow` de Archify
—carril = quién lo hace, columna = posición horizontal— y `exportar_archify()`
entrega el HTML de solo lectura con el mismo acabado que los diagramas del Mapa
del sistema, para la versión acordada.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import subprocess
import uuid
from pathlib import Path

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "colaboradores.db")
_EXPORT_DIR = Path(__file__).resolve().parents[1] / "data" / "colaboradores_archify"
# Fotos y facturas que se cargan en las cajas. Fuera de git (binarios de runtime).
_MEDIA_DIR = Path(__file__).resolve().parents[2] / "colaboradores_media"
ARCHIFY = Path.home() / ".claude" / "skills" / "archify" / "bin" / "archify.mjs"

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
# Qué es cada caja. El tipo de Archify decide el color; la leyenda, el significado.
TIPOS = {
    "accion": ("frontend", "acción o actividad"),
    "decision": ("security", "decisión o acuerdo por definir"),
    "entregable": ("database", "entregable o resultado"),
    "dinero": ("messagebus", "pago, precio o dinero"),
    "externo": ("cloud", "cliente, proveedor o tercero"),
    "consenso": ("security", "consenso: propuestas y votos"),
    "producto": ("database", "producto: foto, SKU, receta y precio"),
    "competencia": ("cloud", "competencia: su publicación y su precio"),
}
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
# Las cinco preguntas del paso; «quién» ya es el carril, «qué» es el título.
VARIABLES = ("como", "donde", "porque")
MAX_DATOS = 8            # pares campo: valor ("medida: 40 cm", "margen: 38%")
MAX_CONSECUENCIAS = 6    # "si pasa esto → consecuencia → posible medida"
MAX_PROPUESTAS = 6       # ideas puestas a votación en un nodo de consenso
MODOS_RESUELTO = ("acuerdo", "turno")
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


def es_miembro(usuario: dict | None) -> bool:
    if not usuario:
        return False
    return int(usuario.get("id") or 0) == anfitrion_id() or es_colaborador_externo(usuario)


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


def _pareja_de(usuario: dict) -> int | None:
    """Con qué colaborador es este diagrama. None = lo mira el anfitrión (ve todos)."""
    return int(usuario["id"]) if es_colaborador_externo(usuario) else None


def puede_ver(did: int, usuario: dict) -> bool:
    """Un colaborador solo entra a SUS diagramas con el anfitrión.

    Hoy hay uno solo, pero el día que haya dos, el diagrama de la relación
    comercial de uno no puede abrirlo el otro: el permiso `colaborador_externo`
    no es una llave de todo el espacio, es la llave de su pareja.
    """
    _ensure()
    mio = _pareja_de(usuario)
    if mio is None:
        return True
    with _conn() as con:
        r = con.execute("SELECT colaborador_id FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
    return bool(r) and int(r["colaborador_id"] or 0) == mio


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


def _a_dict(r, *, con_doc: bool = True) -> dict:
    d = dict(r)
    doc = json.loads(d.pop("doc_json") or "{}")
    if con_doc:
        d["doc"] = doc
        # Quiénes pueden votar, con nombre: la caja de consenso los muestra.
        d["participantes"] = {str(uid): _nombre(uid) for uid in _participantes_ids(d.get("colaborador_id"))}
    d["nodos"] = len(doc.get("nodes") or [])
    d["flechas"] = len(doc.get("edges") or [])
    d["actualizado_por_nombre"] = _nombre(d.get("actualizado_por"))
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
        })
    return {"nodes": nodos, "edges": flechas}


def listar(usuario: dict, incluir_archivados: bool = False) -> list[dict]:
    _ensure()
    conds, params = [], []
    if not incluir_archivados:
        conds.append("archivado=0")
    mio = _pareja_de(usuario)
    if mio is not None:
        conds.append("colaborador_id=?")
        params.append(mio)
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
    # Con quién es: si lo crea el colaborador, con él; si lo crea el anfitrión,
    # con el que diga (y si solo hay uno, con ese).
    ids = colaboradores_ids()
    if int(usuario_id) in ids:
        pareja = int(usuario_id)
    elif colaborador_id and int(colaborador_id) in ids:
        pareja = int(colaborador_id)
    elif len(ids) == 1:
        pareja = ids[0]
    else:
        raise ValueError("Elige con qué colaborador es este diagrama")
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
    return obtener(did)


def guardar(did: int, doc: dict, version_base: int, usuario_id: int, *, titulo: str | None = None,
            descripcion: str | None = None, resumen: str = "") -> dict:
    """Guarda una nueva versión SOLO si nadie guardó encima de la que se editó."""
    _ensure()
    limpio = validar_doc(doc)
    with _conn() as con:
        r = con.execute("SELECT * FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
        if not r:
            raise ValueError("Diagrama no encontrado")
        if int(r["version"]) != int(version_base):
            raise Conflicto(_a_dict(r))
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
                # Empate (o nadie ha votado): decide quien tiene el turno global.
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


# ─── Archify ────────────────────────────────────────────────────────────────

def a_archify(diagrama: dict) -> dict:
    """Traduce el diagrama (posiciones libres) al esquema `workflow` de Archify."""
    doc = diagrama.get("doc") or {}
    nodos = doc.get("nodes") or []
    # Columnas: las cajas se agrupan por su posición horizontal (≈ 1 columna por
    # cada 220 px del lienzo), en el orden en que están de izquierda a derecha.
    xs = sorted({int(round(float(n["x"]) / 220.0)) for n in nodos})
    col_de = {x: i for i, x in enumerate(xs)}
    usados = [c for c in CARRILES if any(n["carril"] == c for n in nodos)] or ["conjunto"]
    ocupado: dict[tuple, int] = {}
    arch_nodos = []
    for n in sorted(nodos, key=lambda n: (float(n["x"]), float(n["y"]))):
        col = col_de[int(round(float(n["x"]) / 220.0))]
        # Dos cajas del mismo carril en la misma columna: la segunda pasa a la siguiente.
        while (n["carril"], col) in ocupado:
            col += 1
        ocupado[(n["carril"], col)] = 1
        nodo = {"id": n["id"], "lane": n["carril"], "col": col, "type": TIPOS[n["tipo"]][0],
                "label": n["label"], "width": max(135, min(260, 18 + 7 * len(n["label"])))}
        # El export es de solo lectura y no dibuja fotos: el dato real (precio,
        # costo) se resume en el subtítulo para que igual quede en el acuerdo.
        extra = [x for x in (n.get("sku"), n.get("plataforma")) if x]
        for campo, etq in (("precio", "precio"), ("costo", "costo")):
            d = n.get(campo)
            if d:
                extra.append(f"{etq} {int(d['monto']):,}".replace(",", ".") + f" {d['moneda']}")
        sub = " · ".join(x for x in [n.get("sublabel"), *extra] if x)
        if sub:
            nodo["sublabel"] = sub[:200]
        arch_nodos.append(nodo)
    return {
        "schema_version": 2,
        "diagram_type": "workflow",
        "meta": {
            "title": diagrama.get("titulo") or "Diagrama",
            "output": f"colab-{diagrama.get('id')}-v{diagrama.get('version')}.html",
            "legend": {"entries": {TIPOS[t][0]: {"label": TIPOS[t][1]} for t in TIPOS
                                   if any(n["tipo"] == t for n in nodos)}},
        },
        "lanes": [{"id": c, "label": CARRILES[c]} for c in usados],
        "nodes": arch_nodos,
        "edges": [{"id": e["id"], "from": e["from"], "to": e["to"], "role": "main",
                   **({"label": e["label"]} if e.get("label") else {})} for e in (doc.get("edges") or [])],
    }


def exportar_archify(did: int) -> dict:
    """Genera el HTML de Archify (solo lectura) de la versión actual."""
    d = obtener(did)
    if not d:
        raise ValueError("Diagrama no encontrado")
    if not (d.get("doc") or {}).get("nodes"):
        raise ValueError("El diagrama está vacío")
    if not ARCHIFY.is_file():
        raise RuntimeError("Archify no está instalado en el servidor")
    _EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    fuente = _EXPORT_DIR / f"colab-{did}-v{d['version']}.workflow.json"
    html = _EXPORT_DIR / f"colab-{did}-v{d['version']}.html"
    fuente.write_text(json.dumps(a_archify(d), ensure_ascii=False, indent=2), encoding="utf-8")
    r = subprocess.run(["node", str(ARCHIFY), "deliver", "workflow", str(fuente), str(html)],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0 or not html.is_file():
        raise RuntimeError("Archify no pudo generar el diagrama: " + ((r.stdout + r.stderr).strip()[-600:]))
    return {"version": d["version"], "archivo": html.name}


def ruta_export(did: int, version: int) -> Path | None:
    p = _EXPORT_DIR / f"colab-{int(did)}-v{int(version)}.html"
    return p if p.is_file() else None
