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

import json
import os
import sqlite3
import subprocess
from pathlib import Path

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "colaboradores.db")
_EXPORT_DIR = Path(__file__).resolve().parents[1] / "data" / "colaboradores_archify"
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
}
MAX_NODOS = 300
# Por dónde sale/entra una flecha en la caja. Son los cuatro lados.
LADOS = ("l", "r", "t", "b")
# Cómo se ve la flecha. La paleta es cerrada: un color libre desde el cliente
# es texto que termina dentro de un atributo SVG.
COLORES_FLECHA = ("#111827", "#0f766e", "#1d4ed8", "#b45309", "#b91c1c", "#7c3aed", "#15803d", "#94a3b8")
TRAZOS = ("solida", "guiones", "puntos")
FORMAS = ("curva", "recta", "escalon")
GROSOR_MIN, GROSOR_MAX = 1, 8


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


def _a_dict(r, *, con_doc: bool = True) -> dict:
    d = dict(r)
    doc = json.loads(d.pop("doc_json") or "{}")
    if con_doc:
        d["doc"] = doc
    d["nodos"] = len(doc.get("nodes") or [])
    d["flechas"] = len(doc.get("edges") or [])
    d["actualizado_por_nombre"] = _nombre(d.get("actualizado_por"))
    return d


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
            "forma": e.get("forma") if e.get("forma") in FORMAS else "curva",
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


def archivar(did: int, archivado: bool = True) -> dict:
    _ensure()
    with _conn() as con:
        con.execute("UPDATE colab_diagramas SET archivado=? WHERE id=?", (1 if archivado else 0, int(did)))
    return obtener(did)


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
        if n.get("sublabel"):
            nodo["sublabel"] = n["sublabel"]
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
