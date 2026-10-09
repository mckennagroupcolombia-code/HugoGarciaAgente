"""
Revisión global de pesos, medidas y empaques de los combos de venta (oct-2026).

Por qué existe: el sistema no guardaba en ningún lado el peso ni las medidas reales de lo
que se despacha. Lo único era lo declarado en cada publicación de MeLi, y el 2-oct-2026 una
auditoría encontró 54 publicaciones con errores claros (2.900 g de relleno en frascos de
100 g, 500 g en goteros de 30 mL, pesos menores que el contenido). MeLi cobra el flete por
ese peso. La revisión crea la fuente de verdad: una persona pesa cada producto y mide cada
tipo de empaque; un administrador compara contra MeLi y aplica.

Cómo se reparte el trabajo (decisión de Armando, 2-oct-2026):
  1. Pesar: cada combo activo de Alegra (C-…), uno por uno, listo para despachar. De paso
     se confirma qué empaque lleva según la receta y si va en caja (absorbe el TKT-2026-1638
     de cajas faltantes en goteros y kits).
  2. Medir: una vez por TIPO de empaque, no por producto. El tipo sale de la receta: envase
     rígido (botero, frasco, pastillero) mide lo mismo con cualquier contenido; una bolsa
     cambia de grosor con lo que lleva, así que se separa por presentación. Un combo cuya
     receta no tiene envase se mide solo. Cada producto puede corregir sus medidas.
  3. Aprobar y aplicar: el administrador ve lo verificado contra lo que hay en MeLi y aplica
     en lote. Nada se escribe en MeLi sin ese paso, y antes de escribir se relee la
     publicación.

Fuentes: recetas y catálogo de la copia local de Alegra (`insumos._catalogo`); casilla de
cada componente con la regla del mapa del producto (`mapa_producto._casilla`); publicaciones
de MeLi en vivo (solo al crear, al refrescar y al aplicar). Base propia:
app/data/revision_empaque.db (gitignored). Sin LLM.

También es la pieza «Envío» de cada presentación en Diseño de producto → Árbol del producto
(9-oct-2026): el mismo wizard para un solo combo, sobre la misma base. Lo que se pesa en el
árbol cuenta en la solicitud y al revés. Ver «Por producto» al final.

Lo que MeLi pide (verificado el 9-oct-2026 contra `/categories/{id}/attributes` en las 138
categorías de la cuenta): SELLER_PACKAGE_WEIGHT en g y SELLER_PACKAGE_LENGTH / _WIDTH /
_HEIGHT en cm — «paquete del seller», el paquete de envío tal como se despacha, no el
producto suelto. Los PACKAGE_* sin SELLER son los de fábrica y MeLi no deja escribirlos.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

REPO = Path(__file__).resolve().parents[2]
DB_PATH = str(REPO / "app" / "data" / "revision_empaque.db")
SUBTIPO = "revision_empaque"

# Cajas de despacho que se compran (catálogo de Alegra). «otra» deja escribir cuál.
CAJAS = ("BOX11X4X4", "BOX12X8X4", "BOX17X11X4", "CAJCAR5mL")
# Bolsas de seguridad: van en casi todo despacho, no distinguen un empaque de otro.
_PREFIJOS_SEGURIDAD = ("BOLSEG", "SOBSEG")

_PESO_MAX_G = 50_000
_CAMPOS_ITEM = "id,title,status,thumbnail,seller_custom_field,attributes,shipping"
_LADO_MAX_CM = 200
_MELI = "https://api.mercadolibre.com"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS revisiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    titulo TEXT NOT NULL,
    creada_en TEXT NOT NULL,
    creada_por TEXT,
    creada_por_id INTEGER,
    asignado_id INTEGER,
    entregada_en TEXT,
    meli_refrescado_en TEXT
);
CREATE TABLE IF NOT EXISTS grupos (
    revision_id INTEGER NOT NULL,
    clave TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rigido INTEGER NOT NULL DEFAULT 0,
    largo_cm REAL, ancho_cm REAL, alto_cm REAL,
    nota TEXT,
    medido_por TEXT, medido_en TEXT,
    PRIMARY KEY (revision_id, clave)
);
CREATE TABLE IF NOT EXISTS productos (
    revision_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    nombre TEXT NOT NULL,
    presentacion TEXT,
    grupo_clave TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0,
    empaque_receta TEXT NOT NULL DEFAULT '[]',
    meli TEXT NOT NULL DEFAULT '[]',
    peso_g REAL,
    empaque_ok TEXT,
    caja TEXT,
    caja_otra TEXT,
    largo_cm REAL, ancho_cm REAL, alto_cm REAL,
    nota TEXT,
    omitido INTEGER NOT NULL DEFAULT 0,
    motivo_omitido TEXT,
    verificado_por TEXT, verificado_en TEXT,
    aplicado_por TEXT, aplicado_en TEXT, aplicado_resultado TEXT,
    PRIMARY KEY (revision_id, sku)
);
CREATE INDEX IF NOT EXISTS ix_productos_grupo ON productos (revision_id, grupo_clave);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.executescript(_SCHEMA)
    return c


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _nombre(usuario: dict | None) -> str:
    u = usuario or {}
    return str(u.get("nombre") or u.get("username") or "")


def _uid(usuario: dict | None) -> int | None:
    try:
        return int((usuario or {}).get("id"))
    except (TypeError, ValueError):
        return None


# ── Catálogo: combos activos, su empaque y su presentación ────────────────────────────


def _casilla(ref: str, nombre: str) -> str:
    """Casilla del componente con la regla del mapa del producto; las cajas aparte."""
    from app.services import mapa_producto as mp

    if ref.startswith("BOX") or mp._norm(nombre).startswith("CAJA"):
        return "caja"
    if ref.startswith("C-"):
        return "kit"
    return mp._casilla(nombre, False)


def _unidad_contenido(ref: str) -> str:
    return "mL" if re.search(r"(ml|cc|l)$", ref, re.I) else "g"


def presentacion(sku: str, componentes: list[tuple[str, float, str]]) -> str:
    """Contenido neto. Primero la receta (la materia prima va en g o mL con su cantidad
    exacta); el sufijo del SKU engaña cuando el nombre lleva números («BTMS50125g»)."""
    total = {"g": 0.0, "mL": 0.0}
    for ref, cant, casilla in componentes:
        if casilla == "otro" and cant > 1:
            total[_unidad_contenido(ref)] += cant
    unidad = "mL" if total["mL"] > total["g"] else "g"
    q = total[unidad]
    if q > 0:
        if unidad == "g" and q >= 1000:
            return f"{q / 1000:g} kg"
        return f"{q:g} {unidad}"
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(g|ml|kg|l|un)$", sku, re.I)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return "kg" if sku.upper().endswith("KG") else ""


def clave_grupo(sku: str, componentes: list[tuple[str, float, str]], pres: str) -> tuple[str, bool]:
    """(clave del tipo de empaque, es rígido). Envase rígido + bolsas + caja; una bolsa sin
    envase ni caja se separa por presentación; sin nada de eso, el producto va solo."""
    envases = sorted({r for r, _, c in componentes if c == "envase"})
    bolsas = sorted({r for r, _, c in componentes
                     if c == "bolsa" and not r.startswith(_PREFIJOS_SEGURIDAD)})
    cajas = sorted({r for r, _, c in componentes if c == "caja"})
    piezas = envases + bolsas + cajas
    if not piezas:
        return f"solo:{sku}", False
    clave = " + ".join(piezas)
    rigido = bool(envases or cajas)
    if not rigido:
        clave += f" · {pres or '?'}"
    return clave, rigido


def _combos_activos() -> list[dict]:
    from app.services import insumos

    items, recetas = insumos._catalogo()
    out = []
    for ref, comp in recetas.items():
        it = items.get(ref) or {}
        if not ref.startswith("C-") or it.get("status") != "active":
            continue
        componentes = []
        for c, cant in comp:
            nombre_c = (items.get(c) or {}).get("name") or c
            componentes.append((c, float(cant or 0), _casilla(c, nombre_c)))
        pres = presentacion(ref, componentes)
        clave, rigido = clave_grupo(ref, componentes, pres)
        empaque = [
            {"sku": c, "nombre": (items.get(c) or {}).get("name") or c, "cantidad": cant, "casilla": cas}
            for c, cant, cas in componentes
            if cas not in ("otro", "operacion")
        ]
        out.append({"sku": ref, "nombre": it.get("name") or ref, "presentacion": pres,
                    "grupo_clave": clave, "rigido": rigido, "empaque": empaque})
    return sorted(out, key=lambda p: (p["grupo_clave"], p["nombre"]))


def _nombre_grupo(clave: str, empaque: list[dict]) -> str:
    if clave.startswith("solo:"):
        return "Sin envase en la receta: se mide este producto"
    nombres = {e["sku"]: e["nombre"] for e in empaque}
    base, _, pres = clave.partition(" · ")
    partes = [nombres.get(r, r) for r in base.split(" + ")]
    return " + ".join(partes) + (f" · {pres}" if pres else "")


# ── MeLi: publicaciones por SKU (solo lectura salvo `aplicar_meli`) ────────────────────


def _token() -> str:
    from app.utils import refrescar_token_meli

    tok = refrescar_token_meli()
    if not tok:
        raise RuntimeError("Token de Mercado Libre no disponible")
    return tok


def _num(valor: Any) -> float | None:
    m = re.search(r"\d+(?:[.,]\d+)?", str(valor or ""))
    return float(m.group().replace(",", ".")) if m else None


def _peso_en_g(valor: Any) -> float | None:
    n = _num(valor)
    if n is None:
        return None
    return n * 1000 if re.search(r"\bkg\b", str(valor), re.I) else n


def _ref_publicacion(body: dict) -> dict:
    a = {t.get("id"): t.get("value_name") for t in body.get("attributes") or []}
    return {
        "id": body.get("id"),
        "status": body.get("status"),
        "titulo": body.get("title") or "",
        "thumbnail": (body.get("thumbnail") or "").replace("http://", "https://"),
        "peso_g": _peso_en_g(a.get("SELLER_PACKAGE_WEIGHT")),
        "largo_cm": _num(a.get("SELLER_PACKAGE_LENGTH")),
        "ancho_cm": _num(a.get("SELLER_PACKAGE_WIDTH")),
        "alto_cm": _num(a.get("SELLER_PACKAGE_HEIGHT")),
        # En Full (fulfillment) MeLi mide el paquete en su bodega y puede reemplazar lo nuestro.
        "logistica": (body.get("shipping") or {}).get("logistic_type") or "",
        "_sku": (a.get("SELLER_SKU") or body.get("seller_custom_field") or "").strip().upper(),
    }


def _publicaciones_por_sku(token: str) -> dict[str, list[dict]]:
    """Activas y pausadas de la cuenta, por SKU en mayúsculas. Las cerradas no se tocan."""
    from app.services.meli import _obtener_seller_id_meli

    seller = _obtener_seller_id_meli(token)
    if not seller:
        raise RuntimeError("No se pudo leer el vendedor de MeLi")
    h = {"Authorization": f"Bearer {token}"}
    ids: list[str] = []
    for estado in ("active", "paused"):
        off = 0
        while True:
            r = _con_reintento(requests.get, f"{_MELI}/users/{seller}/items/search", headers=h, timeout=30,
                             params={"status": estado, "limit": 100, "offset": off})
            r.raise_for_status()
            j = r.json()
            ids += j.get("results") or []
            off += 100
            if off >= int((j.get("paging") or {}).get("total") or 0) or off >= 1000:
                break
    por_sku: dict[str, list[dict]] = defaultdict(list)
    for i in range(0, len(ids), 20):
        r = _con_reintento(requests.get, f"{_MELI}/items", headers=h, timeout=30, params={
            "ids": ",".join(ids[i:i + 20]),
            "attributes": _CAMPOS_ITEM})
        r.raise_for_status()
        for x in r.json() or []:
            ref = _ref_publicacion(x.get("body") or {})
            if ref["_sku"]:
                por_sku[ref.pop("_sku")].append(ref)
    return por_sku


# ── Crear la revisión ──────────────────────────────────────────────────────────────────


def crear_revision(creador: dict, asignado_id: int, ticket_id: int | None = None,
                   titulo: str = "Revisión global de pesos, medidas y empaques") -> int:
    combos = _combos_activos()
    if not combos:
        raise ValueError("No hay combos activos en la copia local del catálogo de Alegra")
    por_sku = _publicaciones_por_sku(_token())
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO revisiones (ticket_id, titulo, creada_en, creada_por, creada_por_id, "
            "asignado_id, meli_refrescado_en) VALUES (?,?,?,?,?,?,?)",
            (ticket_id, titulo, _ahora(), _nombre(creador), _uid(creador), asignado_id, _ahora()),
        )
        rid = int(cur.lastrowid)
        vistos: set[str] = set()
        for orden, p in enumerate(combos):
            if p["grupo_clave"] not in vistos:
                vistos.add(p["grupo_clave"])
                c.execute("INSERT INTO grupos (revision_id, clave, nombre, rigido) VALUES (?,?,?,?)",
                          (rid, p["grupo_clave"], _nombre_grupo(p["grupo_clave"], p["empaque"]),
                           int(p["rigido"])))
            c.execute(
                "INSERT INTO productos (revision_id, sku, nombre, presentacion, grupo_clave, orden, "
                "empaque_receta, meli) VALUES (?,?,?,?,?,?,?,?)",
                (rid, p["sku"], p["nombre"], p["presentacion"], p["grupo_clave"], orden,
                 json.dumps(p["empaque"], ensure_ascii=False),
                 json.dumps(por_sku.get(p["sku"].upper(), []), ensure_ascii=False)),
            )
    return rid


def crear_con_solicitud(creador_id: int, asignado_id: int) -> dict:
    """La solicitud (subtipo `revision_empaque`) y su revisión. El panel abre el wizard
    desde la tarjeta de la solicitud."""
    from app.services import tickets_db

    creador = tickets_db.get_usuario_by_id(creador_id) or {"id": creador_id}
    ticket, _ = tickets_db.crear_ticket({
        "titulo": "Revisión global: peso, medidas y empaque de cada producto",
        "categoria": "inventario",
        "prioridad": "media",
        "tipo": "solicitud",
        "subtipo": SUBTIPO,
        "asignado_a": asignado_id,
        "descripcion": (
            "Abre «Continuar revisión» en esta solicitud. Son tres pasos:\n"
            "1) Pesar cada producto listo para despachar (con su envase y el empaque de envío) "
            "y confirmar qué empaque y qué caja lleva.\n"
            "2) Medir una vez cada tipo de empaque (largo × ancho × alto en cm).\n"
            "3) Entregar: Armando revisa contra MeLi y aplica.\n"
            "Incluye la revisión de cajas del TKT-2026-1638."
        ),
    }, usuario_id=creador_id)
    rid = crear_revision(creador, asignado_id, ticket_id=ticket["id"])
    return {"ticket": ticket, "revision_id": rid}


# ── Leer el estado ─────────────────────────────────────────────────────────────────────


def _revision(c: sqlite3.Connection, rid: int) -> dict:
    r = c.execute("SELECT * FROM revisiones WHERE id=?", (rid,)).fetchone()
    if not r:
        raise LookupError("Revisión no encontrada")
    return dict(r)


def revision_de_ticket(ticket_id: int) -> int | None:
    with _conn() as c:
        r = c.execute("SELECT id FROM revisiones WHERE ticket_id=? ORDER BY id DESC LIMIT 1",
                      (ticket_id,)).fetchone()
    return int(r["id"]) if r else None


def puede_ver(rev: dict, usuario: dict | None) -> bool:
    from app.services.tickets_db import es_admin_efectivo

    if es_admin_efectivo(usuario):
        return True
    return _uid(usuario) in (rev.get("asignado_id"), rev.get("creada_por_id"))


def puede_aprobar(rev: dict, usuario: dict | None) -> bool:
    from app.services.tickets_db import es_admin_efectivo

    return bool(es_admin_efectivo(usuario) or _uid(usuario) == rev.get("creada_por_id"))


def _medidas_finales(p: dict, g: dict | None) -> tuple[float, float, float] | None:
    propias = (p.get("largo_cm"), p.get("ancho_cm"), p.get("alto_cm"))
    if all(propias):
        return propias  # type: ignore[return-value]
    if g and all((g.get("largo_cm"), g.get("ancho_cm"), g.get("alto_cm"))):
        return (g["largo_cm"], g["ancho_cm"], g["alto_cm"])
    return None


def _medidas_meli(pubs: list[dict]) -> tuple | None:
    vistas = [(p.get("largo_cm"), p.get("ancho_cm"), p.get("alto_cm")) for p in pubs]
    vistas = [m for m in vistas if all(m)]
    return Counter(vistas).most_common(1)[0][0] if vistas else None


def _difiere(a: float | None, b: float | None, tolerancia: float) -> bool:
    if a is None or b is None:
        return a != b
    return abs(a - b) > tolerancia


def _enriquecer(p: dict, g: dict | None) -> dict:
    """La fila de un producto con lo que se deduce: medidas finales (las propias o las de su
    tipo de empaque), lo que dice MeLi, si está listo y si difiere de MeLi."""
    p["empaque_receta"] = json.loads(p["empaque_receta"] or "[]")
    p["meli"] = json.loads(p["meli"] or "[]")
    p["empaque_ok"] = json.loads(p["empaque_ok"]) if p.get("empaque_ok") else None
    p["aplicado_resultado"] = json.loads(p["aplicado_resultado"]) if p.get("aplicado_resultado") else None
    fin = _medidas_finales(p, g)
    p["medidas_finales"] = list(fin) if fin else None
    p["peso_meli"] = next((m["peso_g"] for m in p["meli"] if m.get("peso_g")), None)
    p["medidas_meli"] = list(_medidas_meli(p["meli"]) or []) or None
    p["listo"] = bool(p["peso_g"] and fin and not p["omitido"])
    p["diferencia"] = bool(p["listo"] and p["meli"] and (
        _difiere(p["peso_g"], p["peso_meli"], max(10.0, (p["peso_g"] or 0) * 0.05))
        or not p["medidas_meli"]
        or any(_difiere(float(math.ceil(a)), b, 0.5) for a, b in zip(fin, p["medidas_meli"]))
    ))
    return p


def _resumir_grupo(g: dict, miembros: list[dict]) -> dict:
    sugeridas = Counter(tuple(p["medidas_meli"]) for p in miembros if p["medidas_meli"])
    g["productos"] = len(miembros)
    g["ejemplos"] = [p["nombre"] for p in miembros[:3]]
    g["skus"] = [p["sku"] for p in miembros]
    g["sugerido_meli"] = list(sugeridas.most_common(1)[0][0]) if sugeridas else None
    g["medido"] = bool(g["largo_cm"] and g["ancho_cm"] and g["alto_cm"])
    g["solo"] = g["clave"].startswith("solo:")
    return g


def estado(rid: int, usuario: dict | None) -> dict:
    with _conn() as c:
        rev = _revision(c, rid)
        if not puede_ver(rev, usuario):
            raise PermissionError("Esta revisión es de otra persona")
        grupos = {g["clave"]: dict(g) for g in c.execute(
            "SELECT * FROM grupos WHERE revision_id=?", (rid,))}
        filas = [dict(p) for p in c.execute(
            "SELECT * FROM productos WHERE revision_id=? ORDER BY orden", (rid,))]

    miembros: dict[str, list[dict]] = defaultdict(list)
    productos = []
    listos = aplicados = pesados = omitidos = 0
    for p in filas:
        _enriquecer(p, grupos.get(p["grupo_clave"]))
        pesados += bool(p["peso_g"] and not p["omitido"])
        omitidos += bool(p["omitido"])
        listos += p["listo"]
        aplicados += bool(p["aplicado_en"])
        miembros[p["grupo_clave"]].append(p)
        productos.append(p)

    lista_grupos = [_resumir_grupo(g, miembros.get(clave, [])) for clave, g in grupos.items()]
    lista_grupos.sort(key=lambda g: (g["medido"], g["solo"], -g["productos"], g["nombre"]))

    return {
        "revision": rev,
        "productos": productos,
        "grupos": lista_grupos,
        "cajas": list(CAJAS),
        "puede_aprobar": puede_aprobar(rev, usuario),
        "progreso": {
            "total": len(productos),
            "pesados": pesados,
            "omitidos": omitidos,
            "grupos_total": len(lista_grupos),
            "grupos_medidos": sum(g["medido"] for g in lista_grupos),
            "listos": listos,
            "con_diferencia": sum(p["diferencia"] for p in productos),
            "aplicados": aplicados,
        },
    }


# ── Guardar lo que la persona verifica ─────────────────────────────────────────────────


def _decimal(valor: Any, campo: str, maximo: float) -> float | None:
    if valor in (None, ""):
        return None
    try:
        n = float(str(valor).replace(",", "."))
    except (TypeError, ValueError):
        raise ValueError(f"{campo}: escribe un número") from None
    if n <= 0 or n > maximo:
        raise ValueError(f"{campo}: debe estar entre 0 y {maximo:g}")
    return n


def _medidas(d: dict, obligatorias: bool) -> tuple[float | None, float | None, float | None]:
    m = (_decimal(d.get("largo_cm"), "Largo", _LADO_MAX_CM),
         _decimal(d.get("ancho_cm"), "Ancho", _LADO_MAX_CM),
         _decimal(d.get("alto_cm"), "Alto", _LADO_MAX_CM))
    if any(m) and not all(m):
        raise ValueError("Escribe las tres medidas: largo, ancho y alto")
    if obligatorias and not all(m):
        raise ValueError("Escribe las tres medidas: largo, ancho y alto")
    return m


def _abierta_para(c: sqlite3.Connection, rid: int, usuario: dict | None, arbol: bool = False) -> dict:
    """`arbol=True`: llega desde la pieza «Envío» del Árbol del producto, cuya ruta ya exigió
    el permiso del árbol; quien diseña el producto también puede pesarlo y medirlo (aplicar
    en MeLi sigue siendo solo de `puede_aprobar`)."""
    rev = _revision(c, rid)
    if not arbol and not puede_ver(rev, usuario):
        raise PermissionError("Esta revisión es de otra persona")
    return rev


def guardar_producto(rid: int, sku: str, d: dict, usuario: dict | None, arbol: bool = False) -> dict:
    with _conn() as c:
        _abierta_para(c, rid, usuario, arbol)
        fila = c.execute("SELECT empaque_receta FROM productos WHERE revision_id=? AND sku=?",
                         (rid, sku)).fetchone()
        if not fila:
            raise LookupError(f"{sku} no está en esta revisión")
        if d.get("omitido"):
            motivo = (d.get("motivo_omitido") or "").strip()
            if not motivo:
                raise ValueError("Escribe por qué no se pudo pesar (p. ej. «no hay en bodega»)")
            c.execute(
                "UPDATE productos SET omitido=1, motivo_omitido=?, verificado_por=?, verificado_en=? "
                "WHERE revision_id=? AND sku=?", (motivo, _nombre(usuario), _ahora(), rid, sku))
            return {"ok": True, "sku": sku, "omitido": True}

        peso = _decimal(d.get("peso_g"), "Peso", _PESO_MAX_G)
        if not peso:
            raise ValueError("Escribe el peso en gramos")
        receta = {e["sku"] for e in json.loads(fila["empaque_receta"] or "[]")}
        empaque_ok = [s for s in (d.get("empaque_ok") or []) if s in receta]
        caja = (d.get("caja") or "").strip()
        if caja and caja not in CAJAS and caja not in ("ninguna", "otra"):
            raise ValueError("Caja desconocida")
        caja_otra = (d.get("caja_otra") or "").strip() if caja == "otra" else ""
        if caja == "otra" and not caja_otra:
            raise ValueError("Escribe qué caja es")
        largo, ancho, alto = _medidas(d, obligatorias=False)
        c.execute(
            "UPDATE productos SET peso_g=?, empaque_ok=?, caja=?, caja_otra=?, largo_cm=?, ancho_cm=?, "
            "alto_cm=?, nota=?, omitido=0, motivo_omitido=NULL, verificado_por=?, verificado_en=? "
            "WHERE revision_id=? AND sku=?",
            (peso, json.dumps(empaque_ok), caja or None, caja_otra or None, largo, ancho, alto,
             (d.get("nota") or "").strip() or None, _nombre(usuario), _ahora(), rid, sku),
        )
    return {"ok": True, "sku": sku, "peso_g": peso}


def guardar_grupo(rid: int, clave: str, d: dict, usuario: dict | None, arbol: bool = False) -> dict:
    largo, ancho, alto = _medidas(d, obligatorias=True)
    with _conn() as c:
        _abierta_para(c, rid, usuario, arbol)
        cur = c.execute(
            "UPDATE grupos SET largo_cm=?, ancho_cm=?, alto_cm=?, nota=?, medido_por=?, medido_en=? "
            "WHERE revision_id=? AND clave=?",
            (largo, ancho, alto, (d.get("nota") or "").strip() or None, _nombre(usuario), _ahora(),
             rid, clave))
        if not cur.rowcount:
            raise LookupError("Ese tipo de empaque no está en esta revisión")
    return {"ok": True, "clave": clave, "medidas": [largo, ancho, alto]}


def entregar(rid: int, usuario: dict | None) -> dict:
    """La persona terminó: comentario con el resumen y se entrega la solicitud. Como toda
    solicitud delegada, queda «esperando aprobación» hasta que la finaliza quien la pidió
    (`tickets_db._requiere_finalizar_el_solicitante`); la aprobación en MeLi sigue en la
    misma tarjeta. Entregar otra vez solo deja el comentario con el resumen nuevo."""
    from app.services import tickets_db

    est = estado(rid, usuario)
    rev, pr = est["revision"], est["progreso"]
    texto = (f"Revisión entregada: {pr['pesados']} de {pr['total']} productos pesados"
             f" ({pr['omitidos']} sin pesar), {pr['grupos_medidos']} de {pr['grupos_total']}"
             f" tipos de empaque medidos. {pr['listos']} listos para aplicar en MeLi.")
    with _conn() as c:
        c.execute("UPDATE revisiones SET entregada_en=? WHERE id=?", (_ahora(), rid))
    aviso = ""
    if rev.get("ticket_id"):
        tid = int(rev["ticket_id"])
        tickets_db.agregar_comentario(tid, int(_uid(usuario) or 0), texto)
        ticket = tickets_db.get_ticket(tid, usuario or {}) or {}
        if ticket.get("estado") in ("pendiente", "en_proceso"):
            ok, err = tickets_db.cambiar_estado(tid, "resuelto", usuario or {}, texto)
            if not ok:
                aviso = f" La solicitud no cambió de estado: {err}"
    return {"ok": True, "mensaje": texto + aviso}


# ── Administrador: refrescar MeLi y aplicar ────────────────────────────────────────────


def refrescar_meli(rid: int, usuario: dict | None) -> dict:
    with _conn() as c:
        rev = _revision(c, rid)
    if not puede_aprobar(rev, usuario):
        raise PermissionError("Solo quien aprueba puede refrescar MeLi")
    por_sku = _publicaciones_por_sku(_token())
    with _conn() as c:
        for p in c.execute("SELECT sku FROM productos WHERE revision_id=?", (rid,)).fetchall():
            c.execute("UPDATE productos SET meli=? WHERE revision_id=? AND sku=?",
                      (json.dumps(por_sku.get(p["sku"].upper(), []), ensure_ascii=False), rid, p["sku"]))
        c.execute("UPDATE revisiones SET meli_refrescado_en=? WHERE id=?", (_ahora(), rid))
    return {"ok": True}


# Lo que MeLi pide del paquete de envío, con la única unidad que acepta cada atributo.
ATRIBUTOS_MELI = (
    {"id": "SELLER_PACKAGE_WEIGHT", "nombre": "Peso", "unidad": "g"},
    {"id": "SELLER_PACKAGE_LENGTH", "nombre": "Largo", "unidad": "cm"},
    {"id": "SELLER_PACKAGE_WIDTH", "nombre": "Ancho", "unidad": "cm"},
    {"id": "SELLER_PACKAGE_HEIGHT", "nombre": "Alto", "unidad": "cm"},
)


def atributos_meli(peso_g: float, medidas: tuple[float, float, float]) -> list[dict]:
    """Peso redondeado al gramo; medidas hacia arriba al centímetro (MeLi cobra por el
    paquete: quedarse corto sale más caro que pasarse un poco). Enteros, en la única unidad
    que acepta cada atributo, con `value_struct` como los crea el publicador de compliance."""
    largo, ancho, alto = (int(math.ceil(x)) for x in medidas)
    numeros = (int(round(peso_g)), largo, ancho, alto)
    return [
        {"id": a["id"], "value_name": f"{n} {a['unidad']}", "value_struct": {"number": n, "unit": a["unidad"]}}
        for a, n in zip(ATRIBUTOS_MELI, numeros)
    ]


def _con_reintento(fn, *args, **kwargs) -> requests.Response:
    """Una llamada a MeLi con un reintento si se corta la conexión (pasa a menudo: «Connection
    reset by peer»). Un corte en una publicación no debe tumbar el lote entero."""
    try:
        return fn(*args, **kwargs)
    except (requests.ConnectionError, requests.Timeout):
        time.sleep(2)
        return fn(*args, **kwargs)


def aplicar_meli(rid: int, skus: list[str], usuario: dict | None) -> dict:
    """Escribe peso y medidas en cada publicación activa o pausada del SKU. Relee cada
    publicación antes (no se escribe a ciegas sobre una cerrada o de otro SKU)."""
    if len(skus) > 15:
        raise ValueError("Máximo 15 productos por llamada")
    est = estado(rid, usuario)
    if not est["puede_aprobar"]:
        raise PermissionError("Solo el administrador o quien creó la revisión aplica en MeLi")
    por_sku = {p["sku"]: p for p in est["productos"]}
    token = _token()
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    resultados = []
    for sku in skus:
        p = por_sku.get(sku)
        if not p or not p["listo"]:
            resultados.append({"sku": sku, "ok": False, "error": "Falta peso o medidas"})
            continue
        attrs = atributos_meli(p["peso_g"], tuple(p["medidas_finales"]))
        pubs = []
        for ref in p["meli"]:
            try:
                r = _con_reintento(requests.get, f"{_MELI}/items/{ref['id']}", headers=h, timeout=25,
                                   params={"attributes": "id,status,seller_custom_field,attributes"})
            except requests.RequestException as exc:
                pubs.append({"id": ref["id"], "ok": False, "error": f"Sin conexión con MeLi: {type(exc).__name__}"})
                continue
            if not r.ok:
                pubs.append({"id": ref["id"], "ok": False, "error": f"No se pudo leer ({r.status_code})"})
                continue
            vivo = _ref_publicacion(r.json())
            if vivo["status"] not in ("active", "paused"):
                pubs.append({"id": ref["id"], "ok": False, "error": f"Está {vivo['status']}"})
                continue
            if vivo["_sku"] != sku.upper():
                pubs.append({"id": ref["id"], "ok": False, "error": f"Ahora tiene el SKU {vivo['_sku']}"})
                continue
            try:
                # Reintentar es seguro: escribe los mismos valores.
                w = _con_reintento(requests.put, f"{_MELI}/items/{ref['id']}", headers=h,
                                   json={"attributes": attrs}, timeout=25)
            except requests.RequestException as exc:
                pubs.append({"id": ref["id"], "ok": False, "error": f"Sin conexión con MeLi: {type(exc).__name__}"})
                continue
            pubs.append({"id": ref["id"], "ok": w.ok,
                         **({} if w.ok else {"error": (w.text or "")[:200]})})
        ok = bool(pubs) and all(x["ok"] for x in pubs)
        resultado = {"publicaciones": pubs, "atributos": attrs}
        with _conn() as c:
            if ok:
                nuevo = [dict(m, peso_g=round(p["peso_g"]),
                              largo_cm=float(math.ceil(p["medidas_finales"][0])),
                              ancho_cm=float(math.ceil(p["medidas_finales"][1])),
                              alto_cm=float(math.ceil(p["medidas_finales"][2]))) for m in p["meli"]]
                c.execute("UPDATE productos SET aplicado_por=?, aplicado_en=?, aplicado_resultado=?, meli=? "
                          "WHERE revision_id=? AND sku=?",
                          (_nombre(usuario), _ahora(), json.dumps(resultado), json.dumps(nuevo, ensure_ascii=False),
                           rid, sku))
            else:
                c.execute("UPDATE productos SET aplicado_resultado=? WHERE revision_id=? AND sku=?",
                          (json.dumps(resultado), rid, sku))
        resultados.append({"sku": sku, "ok": ok, "publicaciones": pubs,
                           **({} if pubs else {"error": "Sin publicaciones en MeLi"})})
    return {"resultados": resultados}


# ── Por producto: la pieza «Envío» del Árbol del producto ──────────────────────────────
#
# El mismo trabajo para un solo combo, desde Diseño de producto, sobre la misma base: lo que
# se pesa aquí cuenta en la solicitud y al revés. De cada SKU manda la fila de la revisión
# más nueva donde ya se verificó (si en ninguna, la de la más nueva que lo tiene): lo que el
# árbol muestra es lo que el wizard edita. Un combo creado después de la revisión se agrega
# a la última con `incluir_sku`. Las rutas /api/revision-empaque/sku/* exigen el permiso del
# árbol y pasan `arbol=True`; aplicar en MeLi sigue siendo solo de `puede_aprobar`.


def _fila_de_sku(c: sqlite3.Connection, sku: str) -> sqlite3.Row | None:
    return c.execute(
        "SELECT * FROM productos WHERE UPPER(sku)=? ORDER BY verificado_en IS NULL, revision_id DESC LIMIT 1",
        (sku.strip().upper(),)).fetchone()


def _ultima_revision(c: sqlite3.Connection) -> int | None:
    r = c.execute("SELECT MAX(id) FROM revisiones").fetchone()
    return int(r[0]) if r and r[0] else None


def _fila_o_error(sku: str) -> sqlite3.Row:
    with _conn() as c:
        fila = _fila_de_sku(c, sku)
    if not fila:
        raise LookupError(f"{sku} no está en la revisión de empaques: agrégalo primero")
    return fila


def _fmt_g(g: float) -> str:
    return f"{g / 1000:g} kg".replace(".", ",") if g >= 1000 else f"{round(g)} g"


def _fmt_cm(m: list[float]) -> str:
    return " × ".join(f"{x:g}".replace(".", ",") for x in m) + " cm"


def pieza_envio(p: dict | None) -> dict:
    """La pieza «Envío» del árbol a partir de un producto ya enriquecido (`_enriquecer`)."""
    if not p or not (p.get("peso_g") or p.get("omitido")):
        return {"estado": "falta", "detalle": "Sin pesar ni medir el paquete."}
    base = {"peso_g": p.get("peso_g"), "medidas": p.get("medidas_finales")}
    if p.get("omitido"):
        return {"estado": "aviso", "detalle": f"No se pudo pesar: {p.get('motivo_omitido') or 'sin motivo'}.", **base}
    peso = _fmt_g(p["peso_g"])
    if not p.get("medidas_finales"):
        return {"estado": "aviso", "detalle": f"{peso} · falta medir el paquete.", **base}
    texto = f"{peso} · {_fmt_cm(p['medidas_finales'])}"
    if p.get("diferencia"):
        return {"estado": "aviso", "detalle": f"{texto} · MeLi tiene otro dato: falta aplicarlo.", **base}
    sufijo = " · aplicado en MeLi" if p.get("aplicado_en") else " · igual en MeLi" if p.get("meli") else ""
    return {"estado": "ok", "detalle": texto + sufijo, **base}


def resumen_por_sku() -> dict[str, dict]:
    """SKU en mayúsculas → pieza «Envío». Solo la base local: el árbol no llama a MeLi."""
    with _conn() as c:
        grupos = {(g["revision_id"], g["clave"]): dict(g) for g in c.execute("SELECT * FROM grupos")}
        filas = [dict(f) for f in c.execute(
            "SELECT * FROM productos ORDER BY verificado_en IS NULL, revision_id DESC")]
    out: dict[str, dict] = {}
    for f in filas:
        k = f["sku"].upper()
        if k not in out:
            out[k] = pieza_envio(_enriquecer(f, grupos.get((f["revision_id"], f["grupo_clave"]))))
    return out


def _folio(ticket_id: int | None) -> str:
    if not ticket_id:
        return ""
    try:
        from app.services import tickets_db

        t = tickets_db._conn()
        try:
            r = t.execute("SELECT numero FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        finally:
            t.close()
        return str(r["numero"]) if r else ""
    except Exception:
        return ""


def producto_arbol(sku: str, usuario: dict | None) -> dict:
    """Todo lo del wizard de un combo: su fila, su tipo de empaque (con los otros productos
    que lo comparten), lo que MeLi pide y lo que se le enviaría."""
    with _conn() as c:
        fila = _fila_de_sku(c, sku)
        if not fila:
            return {"en_revision": False, "sku": sku, "hay_revision": bool(_ultima_revision(c)),
                    "meli_pide": list(ATRIBUTOS_MELI)}
        rev = _revision(c, fila["revision_id"])
        g_fila = c.execute("SELECT * FROM grupos WHERE revision_id=? AND clave=?",
                           (fila["revision_id"], fila["grupo_clave"])).fetchone()
        g = dict(g_fila) if g_fila else None
        miembros = [_enriquecer(dict(m), g) for m in c.execute(
            "SELECT * FROM productos WHERE revision_id=? AND grupo_clave=? ORDER BY orden",
            (fila["revision_id"], fila["grupo_clave"]))]
    p = next(m for m in miembros if m["sku"] == fila["sku"])
    return {
        "en_revision": True,
        "sku": p["sku"],
        "revision": {"id": rev["id"], "titulo": rev["titulo"], "folio": _folio(rev.get("ticket_id")),
                     "creada_por": rev.get("creada_por"), "meli_refrescado_en": rev.get("meli_refrescado_en")},
        "producto": p,
        "grupo": _resumir_grupo(g, miembros) if g else None,
        "pieza": pieza_envio(p),
        "cajas": list(CAJAS),
        "puede_aprobar": puede_aprobar(rev, usuario),
        "meli_pide": list(ATRIBUTOS_MELI),
        "a_enviar": atributos_meli(p["peso_g"], tuple(p["medidas_finales"])) if p["listo"] else None,
    }


def _publicaciones_de_sku(token: str, sku: str) -> list[dict]:
    """Las publicaciones activas y pausadas de un SKU, con la misma regla que
    `_publicaciones_por_sku` (SELLER_SKU en mayúsculas), sin recorrer toda la cuenta."""
    from app.services.meli import _obtener_seller_id_meli

    seller = _obtener_seller_id_meli(token)
    if not seller:
        raise RuntimeError("No se pudo leer el vendedor de MeLi")
    h = {"Authorization": f"Bearer {token}"}
    ids: list[str] = []
    for variante in dict.fromkeys((sku, sku.upper())):
        for estado_pub in ("active", "paused"):
            r = _con_reintento(requests.get, f"{_MELI}/users/{seller}/items/search", headers=h, timeout=30,
                             params={"seller_sku": variante, "status": estado_pub, "limit": 50})
            r.raise_for_status()
            ids += [i for i in r.json().get("results") or [] if i not in ids]
    out = []
    for i in range(0, len(ids), 20):
        r = _con_reintento(requests.get, f"{_MELI}/items", headers=h, timeout=30,
                         params={"ids": ",".join(ids[i:i + 20]), "attributes": _CAMPOS_ITEM})
        r.raise_for_status()
        for x in r.json() or []:
            ref = _ref_publicacion(x.get("body") or {})
            if ref.pop("_sku") == sku.upper():
                out.append(ref)
    return out


def incluir_sku(sku: str, usuario: dict | None) -> dict:
    """Agrega a la última revisión un combo que no estaba (creado después de ella)."""
    with _conn() as c:
        if _fila_de_sku(c, sku):
            return {"ok": True, "ya_estaba": True}
        rid = _ultima_revision(c)
    if not rid:
        raise LookupError("Todavía no hay ninguna revisión de empaques")
    combo = next((x for x in _combos_activos() if x["sku"].upper() == sku.strip().upper()), None)
    if not combo:
        raise LookupError(f"{sku} no es un combo activo con receta en la copia de Alegra")
    pubs = _publicaciones_de_sku(_token(), combo["sku"])
    with _conn() as c:
        if _fila_de_sku(c, sku):
            return {"ok": True, "ya_estaba": True}
        c.execute("INSERT OR IGNORE INTO grupos (revision_id, clave, nombre, rigido) VALUES (?,?,?,?)",
                  (rid, combo["grupo_clave"], _nombre_grupo(combo["grupo_clave"], combo["empaque"]),
                   int(combo["rigido"])))
        orden = (c.execute("SELECT MAX(orden) FROM productos WHERE revision_id=?", (rid,)).fetchone()[0] or 0) + 1
        c.execute(
            "INSERT INTO productos (revision_id, sku, nombre, presentacion, grupo_clave, orden, "
            "empaque_receta, meli) VALUES (?,?,?,?,?,?,?,?)",
            (rid, combo["sku"], combo["nombre"], combo["presentacion"], combo["grupo_clave"], orden,
             json.dumps(combo["empaque"], ensure_ascii=False), json.dumps(pubs, ensure_ascii=False)))
    return {"ok": True, "revision_id": rid}


def guardar_producto_arbol(sku: str, d: dict, usuario: dict | None) -> dict:
    f = _fila_o_error(sku)
    return guardar_producto(f["revision_id"], f["sku"], d, usuario, arbol=True)


def guardar_grupo_arbol(sku: str, d: dict, usuario: dict | None) -> dict:
    """Mide el tipo de empaque de este combo: vale para todos los que lo comparten."""
    f = _fila_o_error(sku)
    return guardar_grupo(f["revision_id"], f["grupo_clave"], d, usuario, arbol=True)


def guardar_medidas_propias_arbol(sku: str, d: dict, usuario: dict | None) -> dict:
    """Solo las medidas propias de este combo (cuando no mide como su tipo de empaque). Sin
    medidas vuelve a usar las del tipo. No toca el peso ni el empaque confirmado."""
    f = _fila_o_error(sku)
    largo, ancho, alto = _medidas(d, obligatorias=False)
    with _conn() as c:
        _abierta_para(c, f["revision_id"], usuario, arbol=True)
        c.execute("UPDATE productos SET largo_cm=?, ancho_cm=?, alto_cm=? WHERE revision_id=? AND sku=?",
                  (largo, ancho, alto, f["revision_id"], f["sku"]))
    return {"ok": True, "sku": f["sku"], "medidas": [largo, ancho, alto] if largo else None}


def releer_meli_arbol(sku: str, usuario: dict | None) -> dict:
    """Vuelve a leer de MeLi las publicaciones de este combo (solo lectura)."""
    f = _fila_o_error(sku)
    pubs = _publicaciones_de_sku(_token(), f["sku"])
    with _conn() as c:
        c.execute("UPDATE productos SET meli=? WHERE revision_id=? AND sku=?",
                  (json.dumps(pubs, ensure_ascii=False), f["revision_id"], f["sku"]))
    return {"ok": True, "publicaciones": len(pubs)}


def aplicar_meli_arbol(sku: str, usuario: dict | None) -> dict:
    f = _fila_o_error(sku)
    with _conn() as c:
        rev = _revision(c, f["revision_id"])
    if not puede_aprobar(rev, usuario):
        raise PermissionError("Aplicar en MeLi lo hace quien creó la revisión o un administrador")
    return aplicar_meli(f["revision_id"], [f["sku"]], usuario)
