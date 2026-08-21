"""
Gestión de publicaciones: sincronización entre SIIGO (cache), web y MeLi.
"""
import json
import os
import re
import requests as _req
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import quote

_MELI_SITE_PREFIX = "MCO"
_SITE_URL = "https://mckennagroup.co"

# Líneas comerciales (mismo contrato que PAGINA_WEB/site/website.py).
_LINEAS_OFICIALES: tuple[tuple[str, str, str], ...] = (
    ("aceites-ceras-grasas", "Aceites, ceras y grasas", "#FFA500"),
    ("agro", "Agro", "#359441"),
    ("alimentario", "Alimentario", "#1F91DC"),
    ("cosmetica", "Cosmética", "#990099"),
    ("industria", "Industria", "#5C6570"),
    ("laboratorio", "Laboratorio", "#10173C"),
)
_CAT_A_LINEA: dict[str, str] = {
    "Ácidos": "Cosmética",
    "Emulsionantes y Surfactantes": "Cosmética",
    "Humectantes": "Cosmética",
    "Arcillas": "Cosmética",
    "Vitaminas": "Cosmética",
    "Principios Activos": "Cosmética",
    "Aceites Esenciales": "Aceites, ceras y grasas",
    "Aceites": "Aceites, ceras y grasas",
    "Ceras y Mantecas": "Aceites, ceras y grasas",
    "Sales Minerales": "Alimentario",
    "Suplementarios": "Alimentario",
    "Excipientes": "Alimentario",
    "Edulcorantes": "Alimentario",
    "Saborizantes": "Alimentario",
    "Minerales": "Industria",
    "Conservantes": "Industria",
    "Antisépticos": "Industria",
    "Otros": "Industria",
    "Kits": "Laboratorio",
    "Equipos y Materiales": "Laboratorio",
    "Herramientas": "Laboratorio",
    "Agrícola": "Agro",
    "Mascotas": "Agro",
}

_APP_DIR = Path(__file__).parent.parent          # app/
_REPO_DIR = _APP_DIR.parent                      # /home/mckg/mi-agente
_OVERRIDES_PATH = _APP_DIR / "data" / "publicaciones_overrides.json"
_CACHE_PATH = _REPO_DIR / "PAGINA_WEB" / "site" / "data" / "cache.json"
_SIIGO_FOTOS_FILE = _REPO_DIR / "PAGINA_WEB" / "site" / "data" / "siigo_fotos.json"
_IMAGENES_DIR = _REPO_DIR / "IMAGENES_PRODUCTOS_CATALOGO"
_IMG_EXTS_OK = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
# Estándar catálogo / MeLi McKenna: cuadrado 1000×1000 con fondo blanco.
_CATALOGO_IMG_SIZE = 1000
_CATALOGO_FONDO = (255, 255, 255)


def _url_imagen_panel(filename: str) -> str:
    """URL same-origin del panel (proxied en Vite y bot.mckennagroup.co vía /api)."""
    return f"/api/publicaciones/imagen-archivo/{quote(filename, safe='')}"


def _meta_imagen_archivo(path: Path) -> dict:
    """width/height/cumple_estandar para un archivo del catálogo."""
    meta = {
        "width": 0,
        "height": 0,
        "cumple_estandar": False,
        "size_bytes": path.stat().st_size if path.is_file() else 0,
    }
    if not path.is_file():
        return meta
    try:
        from PIL import Image

        with Image.open(path) as im:
            w, h = im.size
            meta["width"] = int(w)
            meta["height"] = int(h)
            meta["cumple_estandar"] = w == _CATALOGO_IMG_SIZE and h == _CATALOGO_IMG_SIZE
    except Exception:
        pass
    return meta


def normalizar_imagen_catalogo(
    file_bytes: bytes,
    *,
    size: int = _CATALOGO_IMG_SIZE,
    out_format: str = "PNG",
) -> tuple[bytes, dict]:
    """
    Centra el producto en canvas blanco size×size (contain, sin recortar).
    Transparencia → blanco. Devuelve (bytes, meta).
    """
    from io import BytesIO
    from PIL import Image

    if size < 100:
        size = _CATALOGO_IMG_SIZE

    with Image.open(BytesIO(file_bytes)) as im:
        im.load()
        src_w, src_h = im.size
        # Aplanar alfa / modos raros sobre blanco
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            fondo = Image.new("RGBA", rgba.size, (*_CATALOGO_FONDO, 255))
            rgba = Image.alpha_composite(fondo, rgba)
            rgb = rgba.convert("RGB")
        else:
            rgb = im.convert("RGB")

        # Contain: caber completo dentro del cuadrado
        scale = min(size / max(rgb.width, 1), size / max(rgb.height, 1))
        new_w = max(1, int(round(rgb.width * scale)))
        new_h = max(1, int(round(rgb.height * scale)))
        if (new_w, new_h) != rgb.size:
            try:
                resample = Image.Resampling.LANCZOS
            except AttributeError:
                resample = Image.LANCZOS  # type: ignore[attr-defined]
            rgb = rgb.resize((new_w, new_h), resample)

        canvas = Image.new("RGB", (size, size), _CATALOGO_FONDO)
        canvas.paste(rgb, ((size - new_w) // 2, (size - new_h) // 2))

        buf = BytesIO()
        fmt = (out_format or "PNG").upper()
        if fmt in ("JPG", "JPEG"):
            canvas.save(buf, format="JPEG", quality=92, optimize=True)
            fmt = "JPEG"
        else:
            canvas.save(buf, format="PNG", optimize=True)
            fmt = "PNG"
        out = buf.getvalue()

    meta = {
        "width": size,
        "height": size,
        "cumple_estandar": True,
        "origen_width": int(src_w),
        "origen_height": int(src_h),
        "format": fmt,
        "bytes": len(out),
        "normalizada": True,
    }
    return out, meta


def normalizar_archivo_catalogo(filename: str, *, force: bool = False) -> dict:
    """Normaliza in-place un archivo de IMAGENES_PRODUCTOS_CATALOGO."""
    safe = Path(filename).name
    if not safe or safe != filename.replace("\\", "/").split("/")[-1]:
        return {"ok": False, "error": "Nombre de archivo inválido", "filename": filename}
    path = _IMAGENES_DIR / safe
    if not path.is_file():
        return {"ok": False, "error": "No encontrado", "filename": safe}
    if path.suffix.lower() not in _IMG_EXTS_OK:
        return {"ok": False, "error": "Extensión no soportada", "filename": safe}

    antes = _meta_imagen_archivo(path)
    if antes.get("cumple_estandar") and not force:
        return {
            "ok": True,
            "filename": safe,
            "skipped": True,
            "width": antes["width"],
            "height": antes["height"],
            "cumple_estandar": True,
        }

    raw = path.read_bytes()
    # Mantener PNG si ya era PNG/WEBP/GIF; JPEG si era jpg
    ext = path.suffix.lower()
    out_fmt = "JPEG" if ext in (".jpg", ".jpeg") else "PNG"
    try:
        out, meta = normalizar_imagen_catalogo(raw, out_format=out_fmt)
    except Exception as e:
        return {"ok": False, "error": str(e), "filename": safe}

    # Si pedimos PNG pero el archivo era .jpg, reescribimos mismo path con formato coincidente
    path.write_bytes(out)
    return {
        "ok": True,
        "filename": safe,
        "skipped": False,
        "width": meta["width"],
        "height": meta["height"],
        "origen_width": meta.get("origen_width"),
        "origen_height": meta.get("origen_height"),
        "cumple_estandar": True,
        "bytes": meta["bytes"],
    }


def normalizar_imagenes_catalogo(
    *,
    sku: str = "",
    filenames: list[str] | None = None,
    solo_no_cumplen: bool = True,
    limit: int = 500,
) -> dict:
    """Normaliza varias imágenes del catálogo (por SKU, lista o todas)."""
    targets: list[str] = []
    if filenames:
        targets = [Path(f).name for f in filenames if f]
    elif sku:
        targets = [img["filename"] for img in escanear_imagenes_web(sku)]
    elif _IMAGENES_DIR.exists():
        targets = sorted(
            f.name
            for f in _IMAGENES_DIR.iterdir()
            if f.is_file() and f.suffix.lower() in _IMG_EXTS_OK
        )

    resultados = []
    normalizadas = 0
    omitidas = 0
    errores = 0
    for name in targets[: max(1, min(int(limit or 500), 2000))]:
        path = _IMAGENES_DIR / name
        if solo_no_cumplen and path.is_file():
            meta = _meta_imagen_archivo(path)
            if meta.get("cumple_estandar"):
                omitidas += 1
                resultados.append({
                    "ok": True,
                    "filename": name,
                    "skipped": True,
                    "width": meta["width"],
                    "height": meta["height"],
                    "cumple_estandar": True,
                })
                continue
        r = normalizar_archivo_catalogo(name, force=not solo_no_cumplen)
        resultados.append(r)
        if r.get("ok") and r.get("skipped"):
            omitidas += 1
        elif r.get("ok"):
            normalizadas += 1
        else:
            errores += 1

    return {
        "ok": errores == 0,
        "estandar": f"{_CATALOGO_IMG_SIZE}x{_CATALOGO_IMG_SIZE}",
        "fondo": "blanco",
        "total": len(resultados),
        "normalizadas": normalizadas,
        "omitidas": omitidas,
        "errores": errores,
        "resultados": resultados,
    }


# ── persistencia overrides ─────────────────────────────────────────────────

def _load_overrides() -> dict:
    if _OVERRIDES_PATH.exists():
        try:
            with open(_OVERRIDES_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_overrides(data: dict) -> None:
    _OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_OVERRIDES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── cache.json ─────────────────────────────────────────────────────────────

def _load_cache() -> dict:
    if _CACHE_PATH.exists():
        try:
            with open(_CACHE_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"sections": [], "combos": []}


def _save_cache(data: dict) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _products_flat(cache: dict) -> list[dict]:
    out = []
    for section in cache.get("sections", []):
        for p in section.get("products", []):
            out.append(p)
    return out


# Campos de la familia que una presentación hija hereda si no tiene los suyos
# propios (comparten ficha técnica, categoría, etc. — solo cambia tamaño/precio/foto).
_CAMPOS_HEREDADOS_FAMILIA = ("cat", "cat_color", "desc", "ficha", "solo_vitrina")


def _find_raw_por_sku(cache: dict, sku: str) -> Optional[dict]:
    """
    Busca un producto por SKU en el cache: primero como entrada de familia
    (top-level, `_products_flat`), y si no aparece ahí, dentro del listado
    `combos` de presentaciones anidado en cada familia (ej. C-CREMON500g
    dentro de la familia "Creatina Monohidrato", cuya SKU líder es
    C-CREMON100g). Las familias con una sola presentación no anidan nada
    aparte, así que solo el nivel top-level tiene coincidencia en ese caso.
    """
    for p in _products_flat(cache):
        if (p.get("ref") or p.get("rep_sku", "")) == sku:
            return p
    for p in _products_flat(cache):
        for c in p.get("combos", []) or []:
            if (c.get("ref") or c.get("rep_sku", "")) == sku:
                raw = dict(c)
                for campo in _CAMPOS_HEREDADOS_FAMILIA:
                    raw.setdefault(campo, p.get(campo))
                raw["es_presentacion_de"] = p.get("ref") or p.get("rep_sku", "")
                return raw
    return None


# ── MeLi API helpers ──────────────────────────────────────────────────────

def _meli_token() -> Optional[str]:
    try:
        path = os.getenv("MELI_CREDS_PATH", "credenciales_meli.json")
        with open(path) as f:
            return json.load(f).get("access_token")
    except Exception:
        return None


def normalizar_meli_item_id(item_id: str) -> str:
    """Convierte IDs numéricos al formato API MeLi Colombia (MCO…)."""
    raw = (item_id or "").strip().upper().replace(" ", "").replace("-", "")
    if not raw:
        return ""
    if re.fullmatch(r"[A-Z]{3}\d+", raw):
        return raw
    if re.fullmatch(r"\d+", raw):
        return f"{_MELI_SITE_PREFIX}{raw}"
    return raw


def _meli_lookup_por_sku(sku: str) -> str:
    """Busca publicación MeLi por seller_sku (activa o pausada)."""
    token = _meli_token()
    if not token or not (sku or "").strip():
        return ""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        me = _req.get("https://api.mercadolibre.com/users/me", headers=headers, timeout=8)
        if me.status_code != 200:
            return ""
        seller_id = me.json().get("id")
    except Exception:
        return ""

    variants: list[str] = []
    for v in (sku, sku.upper(), sku.lower()):
        if v and v not in variants:
            variants.append(v)

    for variant in variants:
        for status in ("active", "paused"):
            try:
                r = _req.get(
                    f"https://api.mercadolibre.com/users/{seller_id}/items/search",
                    params={"seller_sku": variant, "status": status},
                    headers=headers,
                    timeout=10,
                )
                if r.status_code == 200:
                    ids = r.json().get("results") or []
                    if ids:
                        return normalizar_meli_item_id(str(ids[0]))
            except Exception:
                pass
    return ""


def _meli_id_efectivo_sku(
    sku: str,
    overrides: Optional[dict] = None,
    cache: Optional[dict] = None,
    *,
    live_lookup: bool = False,
) -> str:
    """ID MeLi efectivo: override manual → cache.json → (opcional) API MeLi por SKU."""
    ov = (overrides if overrides is not None else _load_overrides()).get(sku, {})
    if ov.get("meli_item_id"):
        return normalizar_meli_item_id(str(ov["meli_item_id"]))
    if cache is None:
        cache = _load_cache()
    raw = next(
        (p for p in _products_flat(cache) if (p.get("ref") or p.get("rep_sku", "")) == sku),
        None,
    )
    mid = normalizar_meli_item_id((raw or {}).get("meli_id") or "")
    if not mid and live_lookup:
        mid = _meli_lookup_por_sku(sku)
    return mid


def _meli_fetch_item(item_id: str) -> Optional[dict]:
    token = _meli_token()
    if not token or not item_id:
        return None
    try:
        r = _req.get(
            f"https://api.mercadolibre.com/items/{item_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


# ── enriquecimiento ────────────────────────────────────────────────────────

def _desc_from_ficha(p: dict) -> str:
    ficha = p.get("ficha") or {}
    d = ficha.get("descripcion", "")
    if not d:
        for s in ficha.get("secciones", []):
            items = s.get("items", [])
            if items:
                d = str(items[0])[:250]
                break
    return d or ""


def _enrich(product: dict, overrides: dict) -> dict:
    sku = product.get("ref") or product.get("rep_sku", "")
    ov = overrides.get(sku, {})
    p = dict(product)
    p["_ov"] = ov
    p["foto_efectiva"] = ov.get("foto_url") or p.get("photo", "")
    raw_desc = ov.get("descripcion") or p.get("desc", "") or _desc_from_ficha(p)
    p["descripcion_efectiva"] = raw_desc
    p["meli_id_efectivo"] = normalizar_meli_item_id(
        ov.get("meli_item_id") or p.get("meli_id", ""),
    )
    p["caracteristicas"] = ov.get("caracteristicas", [])
    p["estado_meli_config"] = (ov.get("estado_meli_config") or "").strip().lower()
    return p


def _status_web(ep: dict) -> dict:
    has_photo = bool(ep.get("foto_efectiva"))
    has_desc = bool(ep.get("descripcion_efectiva"))
    if has_photo and has_desc:
        status, msg = "ok", "Completo"
    elif has_photo:
        status, msg = "incomplete", "Sin descripción"
    elif has_desc:
        status, msg = "incomplete", "Sin foto"
    else:
        status, msg = "incomplete", "Sin foto ni descripción"
    return {
        "status": status,
        "mensaje": msg,
        "tiene_foto": has_photo,
        "tiene_descripcion": has_desc,
        "tiene_override": bool(ep.get("_ov")),
        "updated_at": ep.get("_ov", {}).get("updated_at"),
    }


def _status_meli(ep: dict) -> dict:
    estado = (ep.get("estado_meli_config") or "").strip().lower()
    if estado == "omitir":
        return {"status": "omitir", "mensaje": "Omitido en MeLi", "item_id": ""}
    if estado == "por_publicar":
        return {"status": "por_publicar", "mensaje": "Por publicar en MeLi", "item_id": ""}
    mid = ep.get("meli_id_efectivo", "")
    if not mid:
        return {"status": "no_listing", "mensaje": "Sin publicación MeLi", "item_id": ""}
    return {"status": "linked", "mensaje": "Vinculado", "item_id": mid}


def _linea_info(cat: str) -> dict:
    """Línea comercial a partir de la subcategoría de la ficha web."""
    raw = (cat or "").strip()
    nombre = raw if any(raw == n for _, n, _ in _LINEAS_OFICIALES) else _CAT_A_LINEA.get(raw, "Industria")
    for lid, n, color in _LINEAS_OFICIALES:
        if n == nombre or lid == raw:
            return {"id": lid, "nombre": n, "color": color}
    return {"id": "industria", "nombre": "Industria", "color": "#5C6570"}


def _url_producto_web(slug: str) -> str:
    s = (slug or "").strip().strip("/")
    return f"{_SITE_URL}/producto/{s}" if s else ""


def _url_catalogo_web(cat: str = "", linea_id: str = "") -> str:
    if linea_id:
        return f"{_SITE_URL}/catalogo?linea={linea_id}"
    if cat:
        from urllib.parse import quote as _q
        return f"{_SITE_URL}/catalogo?cat={_q(cat)}"
    return f"{_SITE_URL}/catalogo"


def _meli_permalink(item_id: str, permalink: str = "") -> str:
    pl = (permalink or "").strip()
    if pl:
        return pl
    mid = normalizar_meli_item_id(item_id)
    return f"https://articulo.mercadolibre.com.co/{mid}" if mid else ""


def _aparece_en_tienda_web(meli_id: str, oculto_web: bool) -> bool:
    """La tienda solo lista SKUs con MCO; oculto_web los deja en vitrina sin compra."""
    mid = normalizar_meli_item_id(meli_id)
    return bool(mid.startswith(_MELI_SITE_PREFIX)) and not oculto_web


def _resumen_meli_live(item: Optional[dict], item_id: str = "") -> dict:
    body = item or {}
    mid = normalizar_meli_item_id(str(body.get("id") or item_id or ""))
    pics = body.get("pictures") or []
    foto = ""
    if pics:
        foto = (pics[0].get("secure_url") or pics[0].get("url") or "").strip()
    status = str(body.get("status") or "").lower()
    return {
        "item_id": mid,
        "titulo": body.get("title") or "",
        "estado": status,
        "precio": body.get("price"),
        "stock": body.get("available_quantity"),
        "permalink": _meli_permalink(mid, body.get("permalink") or ""),
        "foto": foto,
        "condicion": body.get("condition") or "",
        "listing_type_id": body.get("listing_type_id") or "",
        "categoria_meli": body.get("category_id") or "",
    }


def _meli_fetch_items(item_ids: list[str]) -> dict[str, dict]:
    """Batch GET /items?ids=… → {MCO…: body}."""
    token = _meli_token()
    ids = []
    for raw in item_ids:
        mid = normalizar_meli_item_id(str(raw or ""))
        if mid and mid not in ids:
            ids.append(mid)
    if not token or not ids:
        return {}
    out: dict[str, dict] = {}
    headers = {"Authorization": f"Bearer {token}"}
    for i in range(0, len(ids), 20):
        batch = ids[i : i + 20]
        try:
            r = _req.get(
                "https://api.mercadolibre.com/items",
                params={"ids": ",".join(batch)},
                headers=headers,
                timeout=18,
            )
            if r.status_code != 200:
                continue
            for entry in r.json() or []:
                if entry.get("code") != 200:
                    continue
                body = entry.get("body") or {}
                mid = normalizar_meli_item_id(str(body.get("id") or ""))
                if mid:
                    out[mid] = body
        except Exception:
            pass
    return out


def _filas_presentacion_sitios(
    product: dict,
    overrides: dict,
    meli_live_by_id: Optional[dict] = None,
) -> list[dict]:
    """Una fila por presentación (o la ficha sola) con cómo se ve en web y en MeLi."""
    live_map = meli_live_by_id or {}
    combos = list(product.get("combos") or [])
    if not combos:
        combos = [product]
    filas = []
    for c in combos:
        sku = c.get("ref") or c.get("rep_sku") or ""
        ov = overrides.get(sku, {})
        mid = normalizar_meli_item_id(ov.get("meli_item_id") or c.get("meli_id") or "")
        live = _resumen_meli_live(live_map.get(mid), mid) if mid else _resumen_meli_live(None, "")
        oculto = bool(ov.get("oculto_web") or c.get("solo_vitrina"))
        filas.append({
            "sku": sku,
            "nombre": c.get("name") or "",
            "presentacion_label": c.get("presentacion_label") or "",
            "precio_web": c.get("precio_num", 0),
            "precio_lista": c.get("lista_num", 0),
            "foto_web": ov.get("foto_url") or c.get("photo") or "",
            "slug": c.get("slug") or "",
            "meli_id": mid,
            "oculto_web": oculto,
            "buyable": bool(c.get("buyable", True)) and not oculto,
            "aparece_en_web": _aparece_en_tienda_web(mid, oculto),
            "web": {
                "nombre": c.get("name") or "",
                "label": c.get("presentacion_label") or c.get("name") or sku,
                "precio": c.get("precio_num", 0),
                "visible": _aparece_en_tienda_web(mid, oculto),
                "vitrina": oculto,
                "url": _url_producto_web(product.get("slug") or product.get("family_slug") or c.get("slug") or ""),
            },
            "meli": live,
        })
    return filas


def _vista_sitios(
    ep: dict,
    filas: list[dict],
    *,
    meli_live: Optional[dict] = None,
) -> dict:
    """Cómo se muestra la ficha en la tienda web vs las publicaciones MeLi."""
    ov = ep.get("_ov") or {}
    cat = ep.get("cat") or ""
    linea = _linea_info(cat)
    slug = ep.get("slug") or ep.get("family_slug") or ""
    mid = ep.get("meli_id_efectivo") or ""
    oculto = bool(ov.get("oculto_web") or ep.get("solo_vitrina"))
    aparece = _aparece_en_tienda_web(mid, oculto) or any(f.get("aparece_en_web") for f in filas)
    live = _resumen_meli_live(meli_live, mid)
    n_pres = len(filas)
    return {
        "web": {
            "nombre": ep.get("name") or "",
            "categoria": cat,
            "linea": linea["nombre"],
            "linea_id": linea["id"],
            "linea_color": linea["color"],
            "slug": slug,
            "url": _url_producto_web(slug),
            "url_catalogo": _url_catalogo_web(cat, linea["id"]),
            "precio": ep.get("precio_num", 0),
            "precio_str": ep.get("precio") or "",
            "foto": ep.get("foto_efectiva") or ep.get("photo") or "",
            "descripcion": (ep.get("descripcion_efectiva") or "")[:280],
            "visible": aparece,
            "vitrina": oculto,
            "buyable": bool(ep.get("buyable", True)) and not oculto,
            "es_familia": n_pres > 1,
            "n_presentaciones": n_pres,
            "motivo_oculto": (
                "Marcado oculto en el panel (vitrina, sin compra)"
                if oculto
                else (
                    "La tienda no lo muestra: no hay publicación MeLi vinculada"
                    if not aparece
                    else ""
                )
            ),
        },
        "meli": live,
        "presentaciones": filas,
    }


def _canal_filtro_ok(item: dict, canal: str) -> bool:
    c = (canal or "").strip().lower()
    if not c or c in ("todos", "all"):
        return True
    web_ok = (item.get("sync_web") or {}).get("status") == "ok"
    meli_st = (item.get("sync_meli") or {}).get("status")
    meli_ok = meli_st == "linked"
    visible = bool(item.get("visible_web"))
    if c in ("ambos", "web_meli", "listos"):
        return web_ok and meli_ok
    if c in ("sin_meli", "solo_web"):
        return not meli_ok
    if c in ("falta_web", "web_incompleta"):
        return not web_ok
    if c in ("no_en_tienda", "sin_web", "ocultos", "oculto_web"):
        return not visible
    if c in ("incompletos", "incompleto"):
        return not (web_ok and meli_ok)
    return True


def _resumen_canales(items: list[dict]) -> dict:
    listos = 0
    falta_web = 0
    sin_meli = 0
    no_en_tienda = 0
    for it in items:
        web_ok = (it.get("sync_web") or {}).get("status") == "ok"
        meli_ok = (it.get("sync_meli") or {}).get("status") == "linked"
        if web_ok and meli_ok:
            listos += 1
        if not web_ok:
            falta_web += 1
        if not meli_ok:
            sin_meli += 1
        if not it.get("visible_web"):
            no_en_tienda += 1
    return {
        "total": len(items),
        "listos": listos,
        "falta_web": falta_web,
        "sin_meli": sin_meli,
        "no_en_tienda": no_en_tienda,
    }


# ── API pública ─────────────────────────────────────────────────────────────

def listar_publicaciones(buscar: str = "", categoria: str = "", canal: str = "") -> dict:
    cache = _load_cache()
    overrides = _load_overrides()
    products = _products_flat(cache)

    compliance_idx: dict[str, dict] = {}
    try:
        from app.tools.meli_compliance_monitor import indice_reemplazos, permalink_meli, resumen_reemplazo
        compliance_idx = indice_reemplazos().get("by_sku", {})
        _permalink_meli = permalink_meli
        _resumen_reemplazo = resumen_reemplazo
    except Exception:
        _permalink_meli = lambda iid, pl="": f"https://articulo.mercadolibre.com.co/{iid}" if iid else ""
        _resumen_reemplazo = lambda e: None

    items = []
    for p in products:
        ep = _enrich(p, overrides)
        nombre = ep.get("name", "")
        sku_val = ep.get("ref") or ep.get("rep_sku", "")
        presentaciones_raw = p.get("combos", []) or []
        if buscar:
            b = buscar.lower()
            matches_familia = b in nombre.lower() or b in sku_val.lower()
            matches_presentacion = any(
                b in (c.get("name", "") or "").lower() or b in (c.get("ref", "") or "").lower()
                for c in presentaciones_raw
            )
            if not matches_familia and not matches_presentacion:
                continue
        if categoria and ep.get("cat", "") != categoria:
            continue
        reemplazo = _resumen_reemplazo(compliance_idx.get(sku_val))
        meli_id = ep.get("meli_id_efectivo", "")
        meli_url = ""
        if reemplazo and reemplazo.get("url_meli"):
            meli_url = reemplazo["url_meli"]
        elif meli_id:
            meli_url = _permalink_meli(meli_id)
        presentaciones = [
            {
                "sku": c.get("ref") or c.get("rep_sku", ""),
                "nombre": c.get("name", ""),
                "presentacion_label": c.get("presentacion_label", ""),
                "precio_lista": c.get("lista_num", 0),
                "precio_web": c.get("precio_num", 0),
                "meli_id": c.get("meli_id", ""),
                "meli_url": _permalink_meli(c["meli_id"]) if c.get("meli_id") else "",
                "stock": c.get("stock"),
                "buyable": c.get("buyable", True),
            }
            for c in presentaciones_raw
        ]
        ov = ep.get("_ov") or {}
        oculto_web = bool(ov.get("oculto_web") or ep.get("solo_vitrina"))
        slug = ep.get("slug") or ep.get("family_slug") or ""
        linea = _linea_info(ep.get("cat", ""))
        visible_web = False if oculto_web else (
            _aparece_en_tienda_web(meli_id, False)
            or any(_aparece_en_tienda_web(p.get("meli_id") or "", False) for p in presentaciones)
        )
        item = {
            "sku": sku_val,
            "nombre": nombre,
            "categoria": ep.get("cat", ""),
            "cat_color": ep.get("cat_color", ""),
            "linea": linea["nombre"],
            "linea_id": linea["id"],
            "slug": slug,
            "url_web": _url_producto_web(slug),
            "url_catalogo": _url_catalogo_web(ep.get("cat", ""), linea["id"]),
            "precio_lista": ep.get("lista_num", 0),
            "precio_web": ep.get("precio_num", 0),
            "foto_efectiva": ep.get("foto_efectiva", ""),
            "meli_id": meli_id,
            "meli_url": meli_url,
            "meli_compliance_reemplazo": reemplazo,
            "estado_meli_config": ep.get("estado_meli_config", ""),
            "tiene_override": bool(ep.get("_ov")),
            "oculto_web": oculto_web,
            "visible_web": visible_web,
            "n_presentaciones": len(presentaciones) or 1,
            "sync_web": _status_web(ep),
            "sync_meli": _status_meli(ep),
            "presentaciones": presentaciones,
        }
        items.append(item)

    categorias = sorted({i["categoria"] for i in items if i["categoria"]})
    resumen = _resumen_canales(items)
    if canal:
        items = [i for i in items if _canal_filtro_ok(i, canal)]
    return {
        "items": items,
        "total": len(items),
        "categorias": categorias,
        "resumen": resumen,
    }


def obtener_publicacion(sku: str, live_meli: bool = False) -> Optional[dict]:
    cache = _load_cache()
    overrides = _load_overrides()
    raw = _find_raw_por_sku(cache, sku)
    if raw is None:
        return None

    ep = _enrich(raw, overrides)
    ov = ep.get("_ov", {})
    sku_val = ep.get("ref") or ep.get("rep_sku", "")
    if not ep.get("meli_id_efectivo"):
        ep["meli_id_efectivo"] = _meli_id_efectivo_sku(
            sku_val, overrides, cache, live_lookup=True,
        )

    meli_live = None

    reemplazo = None
    meli_url = ""
    try:
        from app.tools.meli_compliance_monitor import indice_reemplazos, permalink_meli, resumen_reemplazo
        reemplazo = resumen_reemplazo(indice_reemplazos().get("by_sku", {}).get(sku_val))
        if reemplazo and reemplazo.get("url_meli"):
            meli_url = reemplazo["url_meli"]
        elif ep.get("meli_id_efectivo"):
            meli_url = permalink_meli(ep["meli_id_efectivo"])
    except Exception:
        if ep.get("meli_id_efectivo"):
            meli_url = f"https://articulo.mercadolibre.com.co/{ep['meli_id_efectivo']}"

    familia = raw
    if ep.get("es_presentacion_de"):
        padre = next(
            (p for p in _products_flat(cache)
             if (p.get("ref") or p.get("rep_sku", "")) == ep["es_presentacion_de"]),
            None,
        )
        if padre:
            familia = padre
    meli_ids = []
    for c in (familia.get("combos") or [familia]):
        sku_c = c.get("ref") or c.get("rep_sku") or ""
        mid_c = normalizar_meli_item_id(
            (overrides.get(sku_c) or {}).get("meli_item_id") or c.get("meli_id") or "",
        )
        if mid_c:
            meli_ids.append(mid_c)
    if ep.get("meli_id_efectivo"):
        meli_ids.append(ep["meli_id_efectivo"])
    live_map: dict[str, dict] = {}
    if live_meli:
        live_map = _meli_fetch_items(meli_ids)
        mid_eff = ep.get("meli_id_efectivo") or ""
        if mid_eff:
            meli_live = live_map.get(mid_eff)
    filas = _filas_presentacion_sitios(familia, overrides, live_map)
    ep_web = dict(ep)
    ep_web["name"] = familia.get("name") or ep.get("name")
    ep_web["slug"] = familia.get("slug") or familia.get("family_slug") or ep.get("slug")
    ep_web["cat"] = familia.get("cat") or ep.get("cat")
    ep_web["precio_num"] = familia.get("precio_num", ep.get("precio_num", 0))
    ep_web["precio"] = familia.get("precio") or ep.get("precio") or ""
    vista = _vista_sitios(ep_web, filas, meli_live=meli_live)
    linea = _linea_info(ep.get("cat", ""))
    slug = ep.get("slug") or ep.get("family_slug") or familia.get("slug") or ""

    return {
        "sku": sku_val,
        "es_presentacion_de": ep.get("es_presentacion_de", ""),
        "nombre": ep.get("name", ""),
        "categoria": ep.get("cat", ""),
        "cat_color": ep.get("cat_color", ""),
        "linea": linea["nombre"],
        "linea_id": linea["id"],
        "slug": slug,
        "url_web": _url_producto_web(slug),
        "url_catalogo": _url_catalogo_web(ep.get("cat", ""), linea["id"]),
        "precio_lista": ep.get("lista_num", 0),
        "precio_web": ep.get("precio_num", 0),
        "precio_str": ep.get("precio", ""),
        "precio_meli_str": ep.get("precio_meli", ""),
        "foto_url_cache": ep.get("photo", ""),
        "foto_url_override": ov.get("foto_url", ""),
        "foto_efectiva": ep.get("foto_efectiva", ""),
        "desc_cache": ep.get("desc", ""),
        "desc_override": ov.get("descripcion", ""),
        "descripcion_efectiva": ep.get("descripcion_efectiva", ""),
        "ficha": ep.get("ficha", {}),
        "caracteristicas": ep.get("caracteristicas", []),
        "meli_item_id_cache": ep.get("meli_id", ""),
        "meli_item_id_override": ov.get("meli_item_id", ""),
        "meli_id_efectivo": ep.get("meli_id_efectivo", ""),
        "meli_url": meli_url or vista["meli"].get("permalink") or "",
        "meli_compliance_reemplazo": reemplazo,
        "meli_live": meli_live,
        "en_vitrina": ep.get("solo_vitrina", False) or bool(ov.get("oculto_web")),
        "buyable": ep.get("buyable", True) and not bool(ov.get("oculto_web")),
        "is_combo": ep.get("is_combo", False),
        "oculto_web": ov.get("oculto_web", False),
        "visible_web": vista["web"]["visible"],
        "tiene_override": bool(ov),
        "override_updated_at": ov.get("updated_at"),
        "sync_web": _status_web(ep),
        "sync_meli": _status_meli(ep),
        "vista_sitios": vista,
    }


def cambiar_estado_meli_sku(sku: str, nuevo_estado: str) -> dict:
    """Pausa o activa la publicación MeLi vinculada al SKU."""
    mid = _meli_id_efectivo_sku(sku, live_lookup=True)
    if not mid:
        return {"ok": False, "error": "Sin publicación MeLi vinculada", "sku": sku}
    from app.services.meli import cambiar_estado_publicacion_meli
    res = cambiar_estado_publicacion_meli(mid, nuevo_estado)
    res["sku"] = sku
    res["meli_id"] = mid
    if "error" not in res and not res.get("ok"):
        res["error"] = res.get("mensaje") or "No se pudo cambiar el estado"
    return res


def actualizar_publicacion(sku: str, campos: dict) -> dict:
    overrides = _load_overrides()
    ov = dict(overrides.get(sku, {}))
    allowed = {"descripcion", "foto_url", "meli_item_id", "caracteristicas", "oculto_web", "estado_meli_config"}
    for k, v in campos.items():
        if k not in allowed:
            continue
        if k == "estado_meli_config":
            estado = (str(v).strip().lower() if v is not None else "")
            if estado in ("omitir", "por_publicar"):
                ov[k] = estado
            else:
                ov.pop(k, None)
            continue
        if v is None or v == "" or v == []:
            ov.pop(k, None)
        elif k == "meli_item_id":
            ov[k] = normalizar_meli_item_id(str(v))
        else:
            ov[k] = v
    if ov:
        ov["updated_at"] = datetime.now().isoformat()
        overrides[sku] = ov
    elif sku in overrides:
        del overrides[sku]
    _save_overrides(overrides)
    return {"ok": True, "sku": sku, "override": ov}


def aplicar_overrides_a_cache() -> dict:
    """Escribe los overrides dentro de cache.json (desc, foto, meli_id, galería local)."""
    cache = _load_cache()
    overrides = _load_overrides()
    count = 0
    galerias = 0

    def _apply(p: dict) -> None:
        nonlocal count
        sku = p.get("ref") or p.get("rep_sku", "")
        ov = overrides.get(sku)
        if not ov:
            return
        if ov.get("foto_url"):
            p["photo"] = ov["foto_url"]
        if ov.get("descripcion"):
            p["desc"] = ov["descripcion"][:450]
        if ov.get("meli_item_id"):
            p["meli_id"] = ov["meli_item_id"]
        if ov.get("oculto_web"):
            p["solo_vitrina"] = True
            p["buyable"] = False
        # Orden explícito de fotos del panel → galería completa en caché
        imagenes = ov.get("imagenes_web") or []
        if isinstance(imagenes, list) and imagenes:
            paths = [f"/imagenes-productos-catalogo/{fn}" for fn in imagenes if fn]
            if paths:
                p["photos"] = paths
                p["photo"] = paths[0]
        count += 1

    def _sync_galeria_local(p: dict) -> None:
        nonlocal galerias
        sku = (p.get("ref") or p.get("rep_sku") or "").strip()
        if not sku:
            return
        imgs = escanear_imagenes_web(sku)
        if not imgs:
            return
        paths = [im["path"] for im in imgs]
        # Si ya hay override con orden, respetarlo (ya aplicado arriba)
        ov = overrides.get(sku) or {}
        if ov.get("imagenes_web"):
            return
        # Varias locales (o una local) deben ganar sobre una sola foto MeLi en caché
        if len(paths) >= 1:
            p["photos"] = paths
            p["photo"] = paths[0]
            galerias += 1

    for section in cache.get("sections", []):
        for p in section.get("products", []):
            _apply(p)
            _sync_galeria_local(p)
    for p in cache.get("combos", []):
        _apply(p)
        _sync_galeria_local(p)

    _save_cache(cache)
    msg = f"{count} override(s)"
    if galerias:
        msg += f", {galerias} galería(s) local(es)"
    return {"ok": True, "actualizados": count, "galerias": galerias, "mensaje": msg}


def refrescar_web() -> dict:
    """Llama /api/refresh en website.py (puerto 8083) para recargar catálogo."""
    admin_token = os.getenv("ADMIN_TOKEN", "")
    try:
        r = _req.post(
            "http://localhost:8083/api/refresh",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        if r.status_code == 200:
            return {"ok": True, "resultado": r.json()}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:300]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def sincronizar_meli_stock(sku: str, stock: int) -> dict:
    try:
        from app.services.meli import actualizar_stock_meli
        resultado = actualizar_stock_meli(sku, stock)
        return {"ok": True, "resultado": resultado}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Gestión de imágenes ────────────────────────────────────────────────────

def _load_siigo_fotos() -> dict:
    if _SIIGO_FOTOS_FILE.exists():
        try:
            with open(_SIIGO_FOTOS_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_siigo_fotos(data: dict) -> None:
    with open(_SIIGO_FOTOS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _next_web_filename(sku: str, ext: str) -> str:
    """
    Devuelve el siguiente nombre disponible: {sku}.ext, {sku}_2.ext, …
    Comprueba el slot por nombre base (sin extensión) para evitar que
    {sku}.jpg y {sku}.png coexistan en el mismo slot numérico.
    """
    _IMAGENES_DIR.mkdir(parents=True, exist_ok=True)
    existing_stems = {f.stem for f in _IMAGENES_DIR.iterdir() if f.is_file()}
    if sku not in existing_stems:
        return f"{sku}{ext}"
    for i in range(2, 50):
        if f"{sku}_{i}" not in existing_stems:
            return f"{sku}_{i}{ext}"
    import time
    return f"{sku}_{int(time.time())}{ext}"


def _web_imagenes_orden(sku: str) -> list[str]:
    """Devuelve el orden guardado en overrides (lista de filenames)."""
    return _load_overrides().get(sku, {}).get("imagenes_web", [])


def _set_web_imagenes_orden(sku: str, filenames: list[str]) -> None:
    """Persiste el orden de imágenes web en overrides y actualiza siigo_fotos."""
    overrides = _load_overrides()
    ov = dict(overrides.get(sku, {}))
    if filenames:
        ov["imagenes_web"] = filenames
        ov["updated_at"] = datetime.now().isoformat()
        overrides[sku] = ov
        # La primera imagen es siempre la principal del catálogo web
        fotos = _load_siigo_fotos()
        fotos[sku.upper()] = f"/imagenes-productos-catalogo/{filenames[0]}"
        _save_siigo_fotos(fotos)
    else:
        ov.pop("imagenes_web", None)
        if ov:
            overrides[sku] = ov
        elif sku in overrides:
            del overrides[sku]
        # Sin imágenes → eliminar de siigo_fotos
        fotos = _load_siigo_fotos()
        fotos.pop(sku.upper(), None)
        _save_siigo_fotos(fotos)
    _save_overrides(overrides)


def escanear_imagenes_web(sku: str) -> list[dict]:
    """
    Devuelve todas las imágenes web de un SKU con orden y flag 'principal'.
    Fuentes: overrides (orden explícito), siigo_fotos.json (imagen única legacy), filesystem.
    """
    orden = _web_imagenes_orden(sku)
    fotos_json = _load_siigo_fotos()
    siigo_path = fotos_json.get(sku.upper(), "")

    # Recorre el directorio buscando archivos que pertenezcan al SKU
    found: dict[str, Path] = {}
    if _IMAGENES_DIR.exists():
        for f in sorted(_IMAGENES_DIR.iterdir()):
            if f.suffix.lower() not in _IMG_EXTS_OK:
                continue
            stem = f.stem
            if stem == sku or stem.startswith(f"{sku}_"):
                found[f.name] = f

    # Incluir el archivo de siigo_fotos aunque no siga la convención de nombre
    if siigo_path:
        legacy_name = Path(siigo_path).name
        if legacy_name not in found:
            legacy_file = _IMAGENES_DIR / legacy_name
            if legacy_file.exists():
                found[legacy_name] = legacy_file

    if not found:
        return []

    # Ordenar: primero los que tienen orden explícito, luego el resto alfabético
    def sort_key(fname: str) -> tuple:
        try:
            return (0, orden.index(fname), fname)
        except ValueError:
            return (1, 0, fname)

    ordered_names = sorted(found.keys(), key=sort_key)
    # La imagen principal es la primera de la lista
    out = []
    for i, name in enumerate(ordered_names):
        meta = _meta_imagen_archivo(found[name])
        out.append({
            "filename": name,
            "path": f"/imagenes-productos-catalogo/{name}",
            "url": _url_imagen_panel(name),
            "url_publica": f"https://mckennagroup.co/imagenes-productos-catalogo/{quote(name, safe='')}",
            "principal": i == 0,
            "size_bytes": meta["size_bytes"],
            "width": meta["width"],
            "height": meta["height"],
            "cumple_estandar": meta["cumple_estandar"],
        })
    return out


def _sku_desde_filename(filename: str, skus_conocidos: set[str]) -> str:
    """Infieren SKU desde nombre de archivo ({sku}.ext o {sku}_N.ext)."""
    stem = Path(filename).stem
    if stem in skus_conocidos:
        return stem
    # Match más largo primero: C-UREA250g_2 → C-UREA250g
    candidatos = [s for s in skus_conocidos if stem.startswith(f"{s}_")]
    if candidatos:
        return max(candidatos, key=len)
    # Fallback: parte antes del último _dígitos
    m = re.match(r"^(.+)_(\d+)$", stem)
    if m:
        return m.group(1)
    return stem


def listar_galeria_imagenes(buscar: str = "", solo_con_imagen: bool = True) -> dict:
    """
    Galería de todas las imágenes web enlazadas a SKU (IMAGENES_PRODUCTOS_CATALOGO).
    Agrupa por SKU con nombre de catálogo cuando existe.
    """
    cache = _load_cache()
    productos = _products_flat(cache)
    sku_nombre: dict[str, str] = {}
    for p in productos:
        sku = (p.get("ref") or p.get("rep_sku") or "").strip()
        if sku:
            sku_nombre[sku] = (p.get("name") or p.get("nombre") or sku).strip()

    skus_conocidos = set(sku_nombre.keys())
    # SKUs solo en overrides / siigo_fotos
    overrides = _load_overrides()
    for sku in overrides:
        skus_conocidos.add(sku)
        if sku not in sku_nombre:
            sku_nombre[sku] = sku
    for sku_u, path in _load_siigo_fotos().items():
        # keys en siigo_fotos suelen ir en mayúsculas
        sku_match = next((s for s in skus_conocidos if s.upper() == sku_u.upper()), sku_u)
        skus_conocidos.add(sku_match)
        sku_nombre.setdefault(sku_match, sku_match)

    # filename → sku (incl. legados de siigo_fotos)
    file_to_sku: dict[str, str] = {}
    for sku_u, path in _load_siigo_fotos().items():
        fname = Path(str(path)).name
        if not fname:
            continue
        sku_match = next((s for s in skus_conocidos if s.upper() == sku_u.upper()), sku_u)
        file_to_sku[fname] = sku_match

    for sku, ov in overrides.items():
        for fname in ov.get("imagenes_web") or []:
            if fname:
                file_to_sku[str(fname)] = sku

    # Escaneo del directorio
    por_sku: dict[str, list[dict]] = {}
    if _IMAGENES_DIR.exists():
        for f in sorted(_IMAGENES_DIR.iterdir()):
            if not f.is_file() or f.suffix.lower() not in _IMG_EXTS_OK:
                continue
            sku = file_to_sku.get(f.name) or _sku_desde_filename(f.name, skus_conocidos)
            if not sku:
                continue
            skus_conocidos.add(sku)
            sku_nombre.setdefault(sku, sku)
            meta = _meta_imagen_archivo(f)
            img = {
                "filename": f.name,
                "path": f"/imagenes-productos-catalogo/{f.name}",
                "url": _url_imagen_panel(f.name),
                "url_publica": f"https://mckennagroup.co/imagenes-productos-catalogo/{quote(f.name, safe='')}",
                "size_bytes": meta["size_bytes"],
                "width": meta["width"],
                "height": meta["height"],
                "cumple_estandar": meta["cumple_estandar"],
            }
            por_sku.setdefault(sku, []).append(img)

    q = (buscar or "").strip().lower()
    items = []
    for sku in sorted(por_sku.keys(), key=lambda s: s.upper()):
        imagenes = por_sku[sku]
        # Marcar principal según orden de overrides / primera
        orden = _web_imagenes_orden(sku)
        if orden:
            rank = {n: i for i, n in enumerate(orden)}
            imagenes.sort(key=lambda im: (rank.get(im["filename"], 999), im["filename"]))
        for i, im in enumerate(imagenes):
            im["principal"] = i == 0
        nombre = sku_nombre.get(sku, sku)
        if q and q not in sku.lower() and q not in nombre.lower():
            continue
        items.append(
            {
                "sku": sku,
                "nombre": nombre,
                "total": len(imagenes),
                "principal": imagenes[0]["path"] if imagenes else "",
                "principal_url": imagenes[0]["url"] if imagenes else "",
                "imagenes": imagenes,
            }
        )

    if not solo_con_imagen:
        # Incluir SKUs del catálogo sin foto (opcional; por defecto no)
        con_foto = {it["sku"] for it in items}
        for sku, nombre in sorted(sku_nombre.items()):
            if sku in con_foto:
                continue
            if q and q not in sku.lower() and q not in nombre.lower():
                continue
            items.append(
                {
                    "sku": sku,
                    "nombre": nombre,
                    "total": 0,
                    "principal": "",
                    "principal_url": "",
                    "imagenes": [],
                }
            )
        items.sort(key=lambda it: it["sku"].upper())

    total_imagenes = sum(it["total"] for it in items)
    return {
        "items": items,
        "total_skus": len(items),
        "total_imagenes": total_imagenes,
        "buscar": buscar,
    }


# ── MeLi helpers (reutilizados internamente) ───────────────────────────────

def _meli_get_pictures(meli_item_id: str) -> tuple[list[dict], str]:
    """Devuelve (lista de pictures con id+url, mensaje_error)."""
    token = _meli_token()
    if not token:
        return [], "Sin token MeLi"
    try:
        r = _req.get(
            f"https://api.mercadolibre.com/items/{meli_item_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"attributes": "pictures"},
            timeout=10,
        )
        if r.status_code == 200:
            pics = [
                {
                    "id": p["id"],
                    "url": p.get("secure_url") or p.get("url", ""),
                    "principal": i == 0,
                }
                for i, p in enumerate(r.json().get("pictures", []))
                if p.get("id")
            ]
            return pics, ""
        return [], f"MeLi HTTP {r.status_code}"
    except Exception as e:
        return [], str(e)


def _meli_set_pictures(meli_item_id: str, picture_ids: list[str]) -> dict:
    """PUT /items/{id} con la lista de picture_ids en orden."""
    token = _meli_token()
    if not token:
        return {"ok": False, "error": "Sin token MeLi"}
    try:
        r = _req.put(
            f"https://api.mercadolibre.com/items/{meli_item_id}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"pictures": [{"id": pid} for pid in picture_ids]},
            timeout=15,
        )
        if r.status_code in (200, 201):
            return {"ok": True, "total_pictures": len(picture_ids)}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Funciones públicas de gestión de imágenes ──────────────────────────────

def subir_imagen_web(sku: str, file_bytes: bytes, original_filename: str) -> dict:
    """
    Guarda imagen en IMAGENES_PRODUCTOS_CATALOGO/ con nombre secuencial.
    Normaliza a 1000×1000 fondo blanco (estándar catálogo / MeLi).
    Actualiza overrides (imagenes_web) y siigo_fotos.json.
    """
    ext = Path(original_filename).suffix.lower()
    if ext not in _IMG_EXTS_OK:
        ext = ".png"

    # Salida preferida PNG (fondo blanco opaco); JPEG si el origen era jpg
    out_fmt = "JPEG" if ext in (".jpg", ".jpeg") else "PNG"
    out_ext = ".jpg" if out_fmt == "JPEG" else ".png"
    try:
        file_bytes, norm_meta = normalizar_imagen_catalogo(file_bytes, out_format=out_fmt)
    except Exception as e:
        return {"ok": False, "error": f"No se pudo normalizar la imagen a 1000×1000: {e}"}

    safe_name = _next_web_filename(sku, out_ext)
    _IMAGENES_DIR.mkdir(parents=True, exist_ok=True)

    # Escaneamos ANTES de escribir para que la nueva imagen no se incluya como existente
    existing_imgs = escanear_imagenes_web(sku)
    orden = [img["filename"] for img in existing_imgs]

    with open(_IMAGENES_DIR / safe_name, "wb") as fh:
        fh.write(file_bytes)

    if safe_name not in orden:
        orden.append(safe_name)
    _set_web_imagenes_orden(sku, orden)

    return {
        "ok": True,
        "filename": safe_name,
        "path": f"/imagenes-productos-catalogo/{safe_name}",
        "bytes": len(file_bytes),
        "width": norm_meta.get("width", _CATALOGO_IMG_SIZE),
        "height": norm_meta.get("height", _CATALOGO_IMG_SIZE),
        "cumple_estandar": True,
        "normalizada": True,
        "es_principal": orden.index(safe_name) == 0 if safe_name in orden else False,
    }


def _url_desde_respuesta_picture(pic: dict, picture_id: str = "") -> str:
    """Extrae secure_url/url de la respuesta MeLi o construye la URL CDN estándar."""
    url = (pic.get("secure_url") or pic.get("url") or "").strip()
    if url:
        return url
    for v in pic.get("variations") or []:
        if not isinstance(v, dict):
            continue
        url = (v.get("secure_url") or v.get("url") or "").strip()
        if url:
            return url
    pid = (picture_id or pic.get("id") or "").strip()
    if pid:
        # Formato actual del CDN MeLi (docs: D_NQ_NP_{id}-O.jpg)
        return f"https://http2.mlstatic.com/D_NQ_NP_{pid}-O.jpg"
    return ""


def subir_foto_cdn_meli(file_bytes: bytes, content_type: str = "image/jpeg") -> dict:
    """
    Sube una imagen al CDN de MeLi sin adjuntarla a un ítem.
    Útil para renovar fotos cuando el listing está under_review/forbidden (PUT pictures → 405).
    Nota: POST /pictures a menudo solo devuelve `id` (sin url); en ese caso se construye la URL CDN.
    """
    token = _meli_token()
    if not token:
        return {"ok": False, "error": "Sin token MeLi. Verifica credenciales_meli.json"}

    ct = content_type or "image/jpeg"
    ext = ".jpg" if "jpeg" in ct or "jpg" in ct else ".png" if "png" in ct else ".jpg"

    try:
        up = _req.post(
            "https://api.mercadolibre.com/pictures",
            params={"access_token": token},
            files={"file": (f"image{ext}", file_bytes, ct)},
            timeout=40,
        )
    except Exception as e:
        return {"ok": False, "error": f"Error de red subiendo imagen: {e}"}

    if up.status_code not in (200, 201):
        return {"ok": False, "error": f"MeLi upload HTTP {up.status_code}: {up.text[:300]}"}

    try:
        pic = up.json() if up.text else {}
    except Exception:
        pic = {}
    if not isinstance(pic, dict):
        pic = {}

    picture_id = (pic.get("id") or "").strip()
    if not picture_id:
        return {"ok": False, "error": f"MeLi no devolvió picture id. Resp: {up.text[:200]}"}

    picture_url = _url_desde_respuesta_picture(pic, picture_id)
    variations = pic.get("variations") or []

    # Si el upload no trajo variations/url, intentar GET /pictures/{id}
    if not variations or not (pic.get("secure_url") or pic.get("url")):
        try:
            det = _req.get(
                f"https://api.mercadolibre.com/pictures/{picture_id}",
                params={"access_token": token},
                timeout=20,
            )
            if det.status_code == 200:
                det_json = det.json() if det.text else {}
                if isinstance(det_json, dict):
                    picture_url = _url_desde_respuesta_picture(det_json, picture_id) or picture_url
                    variations = det_json.get("variations") or variations
        except Exception:
            pass

    return {
        "ok": True,
        "picture_id": picture_id,
        "url": picture_url,
        "variations": variations,
    }


def subir_imagen_meli(
    meli_item_id: str,
    file_bytes: bytes,
    content_type: str,
    sku: str = "",
    *,
    solo_cdn: bool = False,
) -> dict:
    """
    Sube imagen al CDN de MeLi y, si es posible, la añade al frente de la publicación.
    Si el ítem bloquea pictures (under_review → HTTP 405), igual devuelve la URL del CDN.
    """
    del sku  # reservado por compatibilidad con callers
    cdn = subir_foto_cdn_meli(file_bytes, content_type)
    if not cdn.get("ok"):
        return cdn

    picture_id = cdn["picture_id"]
    picture_url = cdn["url"]

    if solo_cdn or not meli_item_id:
        return {**cdn, "adjuntada": False}

    existing_pics, _ = _meli_get_pictures(meli_item_id)
    existing_ids = [p["id"] for p in existing_pics if p["id"] != picture_id]
    new_ids = [picture_id] + existing_ids
    result = _meli_set_pictures(meli_item_id, new_ids)
    if not result["ok"]:
        # 405 / not_modifiable: foto lista en CDN para usar en publicación nueva
        return {
            "ok": True,
            "adjuntada": False,
            "picture_id": picture_id,
            "url": picture_url,
            "error_adjuntar": result.get("error", ""),
            "nota": (
                "Imagen subida al CDN de MeLi, pero el listing no permite renovar fotos "
                "(p. ej. under_review). Úsala al crear una publicación nueva."
            ),
        }

    updated_pics, _ = _meli_get_pictures(meli_item_id)
    return {
        "ok": True,
        "adjuntada": True,
        "picture_id": picture_id,
        "url": picture_url,
        "pictures": updated_pics,
    }


def reordenar_imagenes_web(sku: str, filenames: list[str]) -> dict:
    """Guarda nuevo orden de imágenes web. El primero pasa a ser el principal."""
    _set_web_imagenes_orden(sku, filenames)
    return {"ok": True, "orden": filenames, "principal": filenames[0] if filenames else None}


def eliminar_imagen_web(sku: str, filename: str) -> dict:
    """Borra el archivo del disco y lo quita del orden."""
    safe_name = Path(filename).name  # strip any path component
    dest = _IMAGENES_DIR / safe_name
    borrado = False
    if dest.exists():
        dest.unlink()
        borrado = True
    orden = [f for f in _web_imagenes_orden(sku) if f != safe_name]
    _set_web_imagenes_orden(sku, orden)
    return {"ok": True, "borrado": borrado, "nuevo_orden": orden}


def reordenar_imagenes_meli(meli_item_id: str, picture_ids: list[str]) -> dict:
    """Reordena las fotos de una publicación MeLi. El primero es el principal."""
    return _meli_set_pictures(meli_item_id, picture_ids)


def eliminar_imagen_meli(meli_item_id: str, picture_id: str) -> dict:
    """Quita una foto de la publicación MeLi (no borra del CDN)."""
    current, err = _meli_get_pictures(meli_item_id)
    if err:
        return {"ok": False, "error": err}
    new_ids = [p["id"] for p in current if p["id"] != picture_id]
    result = _meli_set_pictures(meli_item_id, new_ids)
    return {**result, "eliminado": picture_id, "total_pictures": len(new_ids)}


def obtener_fotos_actuales(sku: str, meli_item_id: str = "") -> dict:
    """
    Devuelve arrays completos de imágenes web y MeLi con orden, IDs y flag principal.
    """
    web_imagenes = escanear_imagenes_web(sku)

    meli_imagenes: list[dict] = []
    meli_error = ""
    if meli_item_id:
        meli_imagenes, meli_error = _meli_get_pictures(meli_item_id)
        if not meli_imagenes and not meli_error:
            meli_error = ""

    return {
        "web": {
            "imagenes": web_imagenes,
            "total": len(web_imagenes),
            "principal": web_imagenes[0]["path"] if web_imagenes else "",
        },
        "meli": {
            "imagenes": meli_imagenes,
            "total": len(meli_imagenes),
            "error": meli_error,
        },
    }


def copiar_imagen_entre_sitios(
    sku: str,
    origen: str,
    destino: str,
    imagen_id: str = "",
    url: str = "",
    meli_item_id: str = "",
) -> dict:
    """
    Copia una foto de Web→MeLi o MeLi→Web (no mueve: deja el origen intacto).
    origen/destino: "web" | "meli"
    """
    origen = (origen or "").strip().lower()
    destino = (destino or "").strip().lower()
    if origen not in ("web", "meli") or destino not in ("web", "meli"):
        return {"ok": False, "error": "origen y destino deben ser 'web' o 'meli'"}
    if origen == destino:
        return {"ok": False, "error": "Origen y destino son el mismo sitio"}

    sku = (sku or "").strip()
    imagen_id = (imagen_id or "").strip()
    url = (url or "").strip()
    meli_item_id = (meli_item_id or "").strip()

    if origen == "web":
        safe = Path(imagen_id).name
        if not safe or safe != imagen_id.replace("\\", "/").split("/")[-1]:
            safe = Path(imagen_id).name
        path = _IMAGENES_DIR / safe
        if not path.is_file():
            return {"ok": False, "error": f"No se encontró la imagen web '{safe}'"}
        file_bytes = path.read_bytes()
        filename = safe
    else:
        pic_url = url
        if not pic_url and imagen_id:
            pic_url = f"https://http2.mlstatic.com/D_NQ_NP_{imagen_id}-O.jpg"
        if not pic_url:
            return {"ok": False, "error": "Falta URL o id de la foto MeLi"}
        try:
            r = _req.get(pic_url, timeout=35)
        except Exception as e:
            return {"ok": False, "error": f"No se pudo descargar la foto MeLi: {e}"}
        if r.status_code != 200 or not r.content:
            return {
                "ok": False,
                "error": f"Descarga MeLi HTTP {r.status_code}: {(r.text or '')[:160]}",
            }
        file_bytes = r.content
        filename = f"{imagen_id or 'meli'}.jpg"

    if destino == "web":
        res = subir_imagen_web(sku, file_bytes, filename)
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error") or "No se pudo guardar en web", "resultado": res}
        return {
            "ok": True,
            "origen": origen,
            "destino": "web",
            "mensaje": f"Foto copiada a la tienda web ({res.get('filename')})",
            "resultado": res,
        }

    if not meli_item_id:
        pub = obtener_publicacion(sku) or {}
        meli_item_id = str(pub.get("meli_id_efectivo") or "").strip()
    if not meli_item_id:
        return {"ok": False, "error": "Sin ID MeLi: vincula la publicación antes de copiar fotos"}

    ext = Path(filename).suffix.lower()
    content_type = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
    # Normalizar igual que el upload del panel
    try:
        out_fmt = "JPEG" if content_type == "image/jpeg" else "PNG"
        file_bytes, _meta = normalizar_imagen_catalogo(file_bytes, out_format=out_fmt)
        content_type = "image/jpeg" if out_fmt == "JPEG" else "image/png"
    except Exception:
        pass

    res = subir_imagen_meli(meli_item_id, file_bytes, content_type, sku=sku)
    if not res.get("ok"):
        return {"ok": False, "error": res.get("error") or "No se pudo subir a MeLi", "resultado": res}
    return {
        "ok": True,
        "origen": origen,
        "destino": "meli",
        "mensaje": (
            "Foto copiada a Mercado Libre"
            + ("" if res.get("adjuntada", True) else " (CDN; el listing no admite fotos nuevas)")
        ),
        "resultado": res,
    }
