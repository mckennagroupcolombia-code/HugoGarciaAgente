"""
Insumos — foto de referencia, equivalencias de SKU y contador de unidades.

Los productos de inventario (materias primas por gramo o mililitro, envases, tapas,
cajas, bolsas…) son lo que se compra: la solicitud de pago los registra por SKU y en
su unidad mínima, y los combos de venta (`C-…`) los consumen por su receta. Este
módulo le da al operador tres cosas que no tenía (25-sep-2026):

1. **Foto de referencia** por SKU, para reconocer el producto real y no comprar ni
   recibir contra el código equivocado (el catálogo tiene nombres parecidos:
   «PASTILLERO 180mL BLANCO» y «PASTILLERO BLANCO 180mL» eran dos SKU).
2. **Equivalencias**: un SKU que no se puede borrar (Alegra no deja cambiar la receta
   de un combo con ventas) pero que ya no se debe comprar. Las compras se registran
   al SKU canónico, el buscador oculta el otro y el contador suma los dos.
3. **Contador (kardex por lotes)**: las existencias arrancan con los lotes que se van
   registrando. Cada compra con SKU suma sus unidades; cada venta de un combo descuenta
   las piezas de su receta; y el conteo físico periódico —antes de comprar otro lote—
   corrige el desfase y pasa a ser el nuevo punto de partida:
     con conteo         existencia = conteo + compras − consumo posteriores al conteo
     sin conteo         existencia = compras − consumo desde la PRIMERA compra registrada
                        (lo vendido antes salió del inventario viejo, que nunca entró aquí)
     sin compra ni conteo  no hay existencia: el insumo se usa pero su inventario aún no
                        entró al sistema («sin lote»); no se inventa un saldo.
   Alegra no lleva existencias de insumos (`negativeSale`, sin cantidades): esto es lo
   único que las cuenta. Decisión de Armando, 25-sep-2026.

Fuentes, todas locales (no llama a Alegra ni a MeLi):
  catálogo y recetas   app/data/alegra_catalogo.db (copia local de Alegra)
  entradas             contabilidad.db → asientos confirmados de solicitudes de pago y
                       compras con renglones por SKU
  ventas               facturacion_ventas_cache.db (MeLi + web, con el SKU del combo) y
                       ventas_directas.db (WhatsApp facturado, sin las de origen MeLi)
Base propia: app/data/insumos.db (gitignored). Fotos: fotos_insumos/ (gitignored).
Sin LLM.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "app" / "data"
DB_PATH = str(DATA / "insumos.db")
FOTOS_DIR = REPO / "fotos_insumos"
EQUIV_PATH = DATA / "insumos_equivalentes.json"
VENTAS_CACHE_DB = DATA / "facturacion_ventas_cache.db"
VENTAS_DIRECTAS_DB = DATA / "ventas_directas.db"

_LADO_MAX_FOTO = 1000          # px: suficiente para reconocer una tapa, ~100 KB en JPEG
_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_CACHE_S = 60

_SCHEMA = """
CREATE TABLE IF NOT EXISTS fotos (
    sku TEXT PRIMARY KEY,
    archivo TEXT NOT NULL,
    nombre_original TEXT,
    subida_por TEXT,
    subida_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conteos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL,
    cantidad REAL NOT NULL,
    fecha TEXT NOT NULL,
    por TEXT,
    nota TEXT,
    creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_conteos_sku ON conteos (sku, fecha);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.executescript(_SCHEMA)
    return c


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def fecha_corte() -> str:
    return (os.getenv("CONTABILIDAD_FECHA_CORTE") or "2026-09-01").strip()[:10]


def _nombre(usuario: dict | None) -> str:
    u = usuario or {}
    return str(u.get("nombre") or u.get("username") or "")


def invalidar_cache() -> None:
    _CACHE["ts"] = 0.0


# ─── Equivalencias ────────────────────────────────────────────────────────────

def equivalencias() -> dict[str, dict]:
    """{sku_viejo: {"usar": sku_canonico, "motivo": ...}} — claves en mayúsculas."""
    try:
        d = json.loads(EQUIV_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out = {}
    for k, v in (d.get("equivalencias") or {}).items():
        if isinstance(v, dict) and v.get("usar"):
            out[str(k).strip().upper()] = {**v, "sku": str(k).strip()}
    return out


def canonico(sku: str) -> str:
    """El SKU al que se compra y se cuenta. Sigue la cadena (A→B→C) sin ciclos."""
    eq = equivalencias()
    actual, vistos = str(sku or "").strip(), set()
    while actual.upper() in eq and actual.upper() not in vistos:
        vistos.add(actual.upper())
        actual = str(eq[actual.upper()]["usar"]).strip()
    return actual


def equivalente_de(sku: str) -> dict | None:
    """Si `sku` ya no se usa, a cuál se reemplazó y por qué."""
    return equivalencias().get(str(sku or "").strip().upper())


# ─── Catálogo ─────────────────────────────────────────────────────────────────

def _catalogo() -> tuple[dict[str, dict], dict[str, list[tuple[str, float]]]]:
    """(productos por referencia, recetas kit → [(componente, cantidad)]) de la copia local."""
    from app.services import alegra_catalogo_db as cat

    cat.cdb._ensure()
    items: dict[str, dict] = {}
    recetas: dict[str, list[tuple[str, float]]] = defaultdict(list)
    with cat.cdb._conn() as con:
        for r in con.execute(
            "SELECT reference, name, type, status, unit, unit_cost FROM alegra_items"
        ):
            items[str(r["reference"])] = dict(r)
        for r in con.execute(
            "SELECT kit_reference, component_reference, quantity FROM alegra_kit_components"
        ):
            recetas[str(r["kit_reference"])].append(
                (str(r["component_reference"]), float(r["quantity"] or 0))
            )
    return items, recetas


def _es_insumo(it: dict | None) -> bool:
    if not it:
        return False
    ref = str(it.get("reference") or "")
    return (it.get("type") or "") != "kit" and not ref.upper().startswith("C-")


def producto(sku: str) -> dict | None:
    items, _ = _catalogo()
    s = str(sku or "").strip()
    it = items.get(s) or next((v for k, v in items.items() if k.upper() == s.upper()), None)
    return it if _es_insumo(it) else None


# ─── Fotos ────────────────────────────────────────────────────────────────────

def _archivo_foto(sku: str) -> str:
    seguro = "".join(ch for ch in sku if ch.isalnum() or ch in "._-") or "sku"
    return f"{seguro}.jpg"


def guardar_foto(sku: str, contenido: bytes, nombre: str = "", usuario: dict | None = None) -> dict:
    """Guarda (o reemplaza) la foto de referencia del SKU canónico, reducida a JPEG."""
    from PIL import Image, ImageOps

    it = producto(sku)
    if not it:
        raise ValueError(f"{sku} no es un producto de inventario del catálogo de Alegra")
    sku_c = canonico(it["reference"])
    if not contenido:
        raise ValueError("La foto llegó vacía")
    try:
        img = Image.open(io.BytesIO(contenido))
        img = ImageOps.exif_transpose(img)     # la del celular llega girada
        img = img.convert("RGB")
    except Exception as e:
        raise ValueError(f"No se pudo leer la imagen: {e}") from None
    img.thumbnail((_LADO_MAX_FOTO, _LADO_MAX_FOTO))
    FOTOS_DIR.mkdir(parents=True, exist_ok=True)
    archivo = _archivo_foto(sku_c)
    tmp = FOTOS_DIR / (archivo + ".tmp")
    img.save(tmp, "JPEG", quality=82, optimize=True)
    os.replace(tmp, FOTOS_DIR / archivo)
    with _conn() as c:
        c.execute(
            "INSERT INTO fotos (sku, archivo, nombre_original, subida_por, subida_en) VALUES (?,?,?,?,?)"
            " ON CONFLICT(sku) DO UPDATE SET archivo=excluded.archivo, nombre_original=excluded.nombre_original,"
            " subida_por=excluded.subida_por, subida_en=excluded.subida_en",
            (sku_c, archivo, nombre, _nombre(usuario), _ahora()),
        )
    invalidar_cache()
    return info_foto(sku_c) or {}


def info_foto(sku: str) -> dict | None:
    sku_c = canonico(sku)
    with _conn() as c:
        r = c.execute("SELECT * FROM fotos WHERE sku=? COLLATE NOCASE", (sku_c,)).fetchone()
    if not r or not (FOTOS_DIR / r["archivo"]).is_file():
        return None
    return dict(r)


def ruta_foto(sku: str) -> Path | None:
    f = info_foto(sku)
    return (FOTOS_DIR / f["archivo"]) if f else None


def _fotos_por_sku() -> dict[str, dict]:
    with _conn() as c:
        return {
            str(r["sku"]).upper(): dict(r)
            for r in c.execute("SELECT * FROM fotos")
            if (FOTOS_DIR / r["archivo"]).is_file()
        }


# ─── Conteos físicos ──────────────────────────────────────────────────────────

def registrar_conteo(sku: str, cantidad: Any, usuario: dict | None = None, *,
                     nota: str = "", fecha: str | None = None) -> dict:
    """Punto de partida del contador: lo que había físicamente en bodega en `fecha`."""
    it = producto(sku)
    if not it:
        raise ValueError(f"{sku} no es un producto de inventario del catálogo de Alegra")
    try:
        cant = float(str(cantidad).replace(",", "."))
    except (TypeError, ValueError):
        raise ValueError("La cantidad contada debe ser un número") from None
    if cant < 0:
        raise ValueError("La cantidad contada no puede ser negativa")
    f = (fecha or _ahora())[:19]
    sku_c = canonico(it["reference"])
    with _conn() as c:
        c.execute(
            "INSERT INTO conteos (sku, cantidad, fecha, por, nota, creado_en) VALUES (?,?,?,?,?,?)",
            (sku_c, cant, f, _nombre(usuario), (nota or "").strip(), _ahora()),
        )
    invalidar_cache()
    return {"sku": sku_c, "cantidad": cant, "fecha": f, "por": _nombre(usuario)}


def _ultimo_conteo() -> dict[str, dict]:
    with _conn() as c:
        filas = c.execute("SELECT * FROM conteos ORDER BY fecha, id").fetchall()
    out: dict[str, dict] = {}
    for r in filas:
        out[str(r["sku"]).upper()] = dict(r)
    return out


# ─── Entradas: compras contabilizadas ─────────────────────────────────────────

def _entradas(desde: str) -> dict[str, list[dict]]:
    """Unidades compradas por SKU canónico desde `desde`, de los asientos vivos.

    Una solicitud de pago aprobada deja su asiento con `solicitud_id`; se leen sus
    renglones. Una compra registrada a mano con renglones por SKU (la de Duque, por
    ejemplo) los lleva en `plantilla_datos.items`. Un asiento anulado no cuenta.
    """
    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard as pw

    out: dict[str, list[dict]] = defaultdict(list)
    with cc._conn() as con:
        movs = con.execute(
            "SELECT m.id, m.fecha, m.plantilla_datos_json, t.nombre AS tercero"
            " FROM cc_movimientos m LEFT JOIN cc_terceros t ON t.id = m.tercero_id"
            " WHERE m.estado != 'anulado' AND m.fecha >= ?"
            " AND (m.tipo_origen IN ('solicitud_pago', 'compra_proveedor'))",
            (desde,),
        ).fetchall()
    for m in movs:
        try:
            pd = json.loads(m["plantilla_datos_json"] or "{}")
        except ValueError:
            pd = {}
        items, ref = [], ""
        if pd.get("solicitud_id"):
            s = pw.obtener(int(pd["solicitud_id"]))
            if s and s.get("estado") not in ("rechazada", "anulada"):
                items, ref = s.get("items") or [], f"solicitud #{s['id']}"
        elif isinstance(pd.get("items"), list):
            items, ref = pd["items"], f"asiento #{m['id']}"
        for i in items:
            sku = str(i.get("sku") or "").strip()
            if not sku:
                continue
            out[canonico(sku).upper()].append({
                "fecha": str(m["fecha"])[:10], "cantidad": float(i.get("cantidad") or 0),
                "proveedor": m["tercero"] or "", "ref": ref, "asiento": m["id"],
                "precio": float(i.get("precio") or 0),
            })
    return out


# ─── Consumo: ventas de combos × receta ───────────────────────────────────────

def _ventas(desde: str) -> list[tuple[str, str, float]]:
    """[(fecha, sku_de_venta, unidades)] de MeLi, web y WhatsApp desde `desde`."""
    out: list[tuple[str, str, float]] = []
    if VENTAS_CACHE_DB.is_file():
        c = sqlite3.connect(str(VENTAS_CACHE_DB))
        try:
            for fecha, payload in c.execute(
                "SELECT fecha, payload FROM ventas_cache WHERE es_cancelada=0 AND fecha >= ?", (desde,)
            ):
                try:
                    p = json.loads(payload or "{}")
                    vo = p.get("venta_original")
                    vo = json.loads(vo) if isinstance(vo, str) else (vo or {})
                except ValueError:
                    continue
                for it in vo.get("items") or []:
                    out.append((str(fecha)[:10], str(it.get("sku") or "").strip(),
                                float(it.get("cantidad") or 0)))
        finally:
            c.close()
    if VENTAS_DIRECTAS_DB.is_file():
        c = sqlite3.connect(str(VENTAS_DIRECTAS_DB))
        try:
            # Las de origen MeLi ya están en la caché de facturación: contarlas dos veces
            # duplicaría el consumo.
            for fecha, lineas in c.execute(
                "SELECT COALESCE(facturado, creado), lineas FROM ventas_directas"
                " WHERE estado='facturada' AND COALESCE(origen,'') != 'meli'"
            ):
                f = _fecha_texto(fecha)
                if f < desde:
                    continue
                try:
                    ls = json.loads(lineas or "[]")
                except ValueError:
                    continue
                for it in ls:
                    out.append((f, str(it.get("sku") or it.get("codigo") or "").strip(),
                                float(it.get("cantidad") or 0)))
        finally:
            c.close()
    return out


def _fecha_texto(v: Any) -> str:
    if isinstance(v, (int, float)) and v > 0:
        return datetime.fromtimestamp(float(v)).strftime("%Y-%m-%d")
    return str(v or "")[:10]


def _alias_venta() -> dict[str, str]:
    try:
        d = json.loads((DATA / "alegra_sku_alias_venta.json").read_text(encoding="utf-8"))
        return {str(k).upper(): str(v) for k, v in (d.get("alias") or {}).items()}
    except (OSError, ValueError):
        return {}


def _consumo(desde: str, items: dict, recetas: dict) -> tuple[dict[str, list[tuple[str, float, str]]], dict[str, float]]:
    """({insumo: [(fecha, unidades, combo)]}, {sku_sin_resolver: unidades})."""
    por_ref = {k.upper(): k for k in items}
    alias = _alias_venta()
    consumo: dict[str, list[tuple[str, float, str]]] = defaultdict(list)
    sin_resolver: dict[str, float] = defaultdict(float)
    for fecha, sku, unidades in _ventas(desde):
        if not sku or unidades <= 0 or sku.upper() in ("ENVÍO", "ENVIO"):
            continue
        ref = por_ref.get(sku.upper()) or por_ref.get(alias.get(sku.upper(), "").upper())
        if not ref:
            sin_resolver[sku] += unidades
            continue
        it = items[ref]
        if (it.get("type") or "") == "kit" or ref.upper().startswith("C-"):
            receta = recetas.get(ref) or []
            if not receta:
                sin_resolver[sku] += unidades
            for comp, q in receta:
                consumo[canonico(comp).upper()].append((fecha, unidades * q, ref))
        else:
            # Producto que se vende suelto (un beaker, un gotero): se consume a sí mismo.
            consumo[canonico(ref).upper()].append((fecha, unidades, ref))
    return consumo, dict(sin_resolver)


# ─── Resumen ──────────────────────────────────────────────────────────────────

def _calcular() -> dict:
    items, recetas = _catalogo()
    desde = fecha_corte()
    eq = equivalencias()
    entradas = _entradas(desde)
    consumo, sin_resolver = _consumo(desde, items, recetas)
    conteos = _ultimo_conteo()
    fotos = _fotos_por_sku()

    en_combos: dict[str, set[str]] = defaultdict(set)
    for kit, comps in recetas.items():
        if (items.get(kit) or {}).get("status", "active") != "active":
            continue
        for comp, _q in comps:
            en_combos[canonico(comp).upper()].add(kit)

    filas = []
    for ref, it in items.items():
        if not _es_insumo(it) or (it.get("status") or "active") != "active":
            continue
        clave = ref.upper()
        if clave in eq:
            continue       # su uso y sus compras se suman en el SKU canónico
        ent = entradas.get(clave, [])
        con = consumo.get(clave, [])
        conteo = conteos.get(clave)
        comprado = round(sum(e["cantidad"] for e in ent), 3)
        consumido = round(sum(c[1] for c in con), 3)
        existencia, desde_existencia, base = None, "", ""
        if conteo:
            # El conteo es lo que había al contar: cuenta lo que entró y salió DESPUÉS.
            f0 = str(conteo["fecha"])[:10]
            existencia = round(
                float(conteo["cantidad"])
                + sum(e["cantidad"] for e in ent if e["fecha"] > f0)
                - sum(c[1] for c in con if c[0] > f0), 3)
            desde_existencia, base = f0, "conteo"
        elif ent:
            # Primer lote registrado: desde ese día se descuenta. Lo vendido antes salió
            # del inventario viejo, que nunca se registró aquí.
            f0 = min(e["fecha"] for e in ent)
            existencia = round(sum(e["cantidad"] for e in ent)
                               - sum(c[1] for c in con if c[0] >= f0), 3)
            desde_existencia, base = f0, "lotes"
        combos = sorted(en_combos.get(clave, set()))
        consumido_desde = round(sum(c[1] for c in con if desde_existencia and c[0] >= desde_existencia), 3) \
            if base == "lotes" else round(sum(c[1] for c in con if desde_existencia and c[0] > desde_existencia), 3)
        if not combos and not ent and not con:
            estado = "sin_uso"
        elif existencia is None:
            estado = "sin_lote"
        elif existencia < 0:
            estado = "revisar"
        else:
            estado = "ok"
        ultima = max(ent, key=lambda e: e["fecha"]) if ent else None
        filas.append({
            "sku": ref, "nombre": it.get("name") or "", "unidad": it.get("unit") or "",
            "combos": combos, "n_combos": len(combos),
            "comprado": comprado, "consumido": consumido,
            "neto_desde_corte": round(comprado - consumido, 3),
            "existencia": existencia,
            "existencia_base": base,              # "conteo" | "lotes" | ""
            "existencia_desde": desde_existencia,
            "consumido_desde_base": consumido_desde,
            "conteo": ({"cantidad": conteo["cantidad"], "fecha": conteo["fecha"], "por": conteo["por"]}
                       if conteo else None),
            "ultima_compra": ({k: ultima[k] for k in ("fecha", "cantidad", "proveedor", "precio", "ref")}
                              if ultima else None),
            "foto": bool(fotos.get(clave)),
            "foto_v": (fotos.get(clave) or {}).get("subida_en", ""),
            "equivalentes": sorted(v["sku"] for k, v in eq.items() if canonico(v["sku"]).upper() == clave),
            "estado": estado,
        })
    filas.sort(key=lambda f: ({"revisar": 0, "ok": 1, "sin_lote": 2, "sin_uso": 3}[f["estado"]],
                              -f["consumido"], f["sku"]))
    return {
        "desde": desde,
        "filas": filas,
        "ventas_sin_resolver": dict(sorted(sin_resolver.items(), key=lambda x: -x[1])[:40]),
        "calculado_en": _ahora(),
    }


def resumen(q: str = "", *, skus: list[str] | None = None, estado: str = "", refrescar: bool = False) -> dict:
    ahora = time.time()
    if refrescar or not _CACHE["data"] or ahora - _CACHE["ts"] > _CACHE_S:
        _CACHE["data"], _CACHE["ts"] = _calcular(), ahora
    data = _CACHE["data"]
    filas = data["filas"]
    if skus:
        quiero = {canonico(s).upper() for s in skus if s}
        filas = [f for f in filas if f["sku"].upper() in quiero]
    if q:
        tokens = [t for t in q.lower().split() if t]
        filas = [f for f in filas if all(t in f"{f['sku']} {f['nombre']}".lower() for t in tokens)]
    if estado:
        filas = [f for f in filas if f["estado"] == estado]
    cuenta = defaultdict(int)
    for f in data["filas"]:
        cuenta[f["estado"]] += 1
    return {**data, "filas": filas, "totales": dict(cuenta)}


def resumen_por_sku(skus: list[str]) -> dict[str, dict]:
    """Para el buscador de productos del wizard: {SKU: fila} (claves en mayúsculas)."""
    return {f["sku"].upper(): f for f in resumen(skus=skus)["filas"]}
