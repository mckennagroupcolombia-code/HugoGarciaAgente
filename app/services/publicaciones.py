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

_MELI_SITE_PREFIX = "MCO"

_APP_DIR = Path(__file__).parent.parent          # app/
_REPO_DIR = _APP_DIR.parent                      # /home/mckg/mi-agente
_OVERRIDES_PATH = _APP_DIR / "data" / "publicaciones_overrides.json"
_CACHE_PATH = _REPO_DIR / "PAGINA_WEB" / "site" / "data" / "cache.json"
_SIIGO_FOTOS_FILE = _REPO_DIR / "PAGINA_WEB" / "site" / "data" / "siigo_fotos.json"
_IMAGENES_DIR = _REPO_DIR / "IMAGENES_PRODUCTOS_CATALOGO"
_IMG_EXTS_OK = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


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


def _meli_id_efectivo_sku(
    sku: str,
    overrides: Optional[dict] = None,
    cache: Optional[dict] = None,
) -> str:
    """ID MeLi efectivo: override manual tiene prioridad; si no, meli_id del cache.json."""
    ov = (overrides if overrides is not None else _load_overrides()).get(sku, {})
    if ov.get("meli_item_id"):
        return normalizar_meli_item_id(str(ov["meli_item_id"]))
    if cache is None:
        cache = _load_cache()
    raw = next(
        (p for p in _products_flat(cache) if (p.get("ref") or p.get("rep_sku", "")) == sku),
        None,
    )
    return normalizar_meli_item_id((raw or {}).get("meli_id") or "")


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


# ── API pública ─────────────────────────────────────────────────────────────

def listar_publicaciones(buscar: str = "", categoria: str = "") -> dict:
    cache = _load_cache()
    overrides = _load_overrides()
    products = _products_flat(cache)

    items = []
    for p in products:
        ep = _enrich(p, overrides)
        nombre = ep.get("name", "")
        sku_val = ep.get("ref") or ep.get("rep_sku", "")
        if buscar and buscar.lower() not in nombre.lower() and buscar.lower() not in sku_val.lower():
            continue
        if categoria and ep.get("cat", "") != categoria:
            continue
        items.append({
            "sku": sku_val,
            "nombre": nombre,
            "categoria": ep.get("cat", ""),
            "cat_color": ep.get("cat_color", ""),
            "slug": ep.get("slug", ""),
            "precio_lista": ep.get("lista_num", 0),
            "precio_web": ep.get("precio_num", 0),
            "foto_efectiva": ep.get("foto_efectiva", ""),
            "meli_id": ep.get("meli_id_efectivo", ""),
            "estado_meli_config": ep.get("estado_meli_config", ""),
            "tiene_override": bool(ep.get("_ov")),
            "sync_web": _status_web(ep),
            "sync_meli": _status_meli(ep),
        })

    categorias = sorted({i["categoria"] for i in items if i["categoria"]})
    return {"items": items, "total": len(items), "categorias": categorias}


def obtener_publicacion(sku: str, live_meli: bool = False) -> Optional[dict]:
    cache = _load_cache()
    overrides = _load_overrides()
    raw = next(
        (p for p in _products_flat(cache) if (p.get("ref") or p.get("rep_sku", "")) == sku),
        None,
    )
    if raw is None:
        return None

    ep = _enrich(raw, overrides)
    ov = ep.get("_ov", {})

    meli_live = None
    if live_meli and ep.get("meli_id_efectivo"):
        meli_live = _meli_fetch_item(ep["meli_id_efectivo"])

    return {
        "sku": ep.get("ref") or ep.get("rep_sku", ""),
        "nombre": ep.get("name", ""),
        "categoria": ep.get("cat", ""),
        "cat_color": ep.get("cat_color", ""),
        "slug": ep.get("slug", ""),
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
        "meli_live": meli_live,
        "en_vitrina": ep.get("solo_vitrina", False),
        "buyable": ep.get("buyable", True),
        "is_combo": ep.get("is_combo", False),
        "oculto_web": ov.get("oculto_web", False),
        "tiene_override": bool(ov),
        "override_updated_at": ov.get("updated_at"),
        "sync_web": _status_web(ep),
        "sync_meli": _status_meli(ep),
    }


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
    """Escribe los overrides dentro de cache.json (desc, foto, meli_id)."""
    cache = _load_cache()
    overrides = _load_overrides()
    if not overrides:
        return {"ok": True, "actualizados": 0, "mensaje": "Sin cambios pendientes"}

    count = 0

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
        count += 1

    for section in cache.get("sections", []):
        for p in section.get("products", []):
            _apply(p)
    for p in cache.get("combos", []):
        _apply(p)

    _save_cache(cache)
    return {"ok": True, "actualizados": count, "mensaje": f"{count} producto(s) actualizados en caché"}


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
    return [
        {
            "filename": name,
            "path": f"/imagenes-productos-catalogo/{name}",
            "url": f"https://mckennagroup.co/imagenes-productos-catalogo/{name}",
            "principal": i == 0,
            "size_bytes": found[name].stat().st_size if found.get(name) else 0,
        }
        for i, name in enumerate(ordered_names)
    ]


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
    Actualiza overrides (imagenes_web) y siigo_fotos.json.
    """
    ext = Path(original_filename).suffix.lower()
    if ext not in _IMG_EXTS_OK:
        ext = ".jpg"

    safe_name = _next_web_filename(sku, ext)
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
        "es_principal": orden.index(safe_name) == 0 if safe_name in orden else False,
    }


def subir_imagen_meli(meli_item_id: str, file_bytes: bytes, content_type: str) -> dict:
    """
    Sube imagen al CDN de MeLi y la añade al frente de la publicación.
    Devuelve {"ok": True, "picture_id": ..., "url": ..., "pictures": [...]}
    """
    token = _meli_token()
    if not token:
        return {"ok": False, "error": "Sin token MeLi. Verifica credenciales_meli.json"}
    if not meli_item_id:
        return {"ok": False, "error": "Se requiere ID de publicación MeLi"}

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

    pic = up.json()
    picture_id = pic.get("id", "")
    picture_url = pic.get("secure_url") or pic.get("url", "")
    if not picture_id:
        return {"ok": False, "error": f"MeLi no devolvió picture_id. Resp: {up.text[:200]}"}

    existing_pics, _ = _meli_get_pictures(meli_item_id)
    existing_ids = [p["id"] for p in existing_pics if p["id"] != picture_id]
    new_ids = [picture_id] + existing_ids
    result = _meli_set_pictures(meli_item_id, new_ids)
    if not result["ok"]:
        return {
            **result,
            "picture_id": picture_id,
            "url": picture_url,
            "nota": "Imagen subida al CDN pero fallo al actualizar listing",
        }

    updated_pics, _ = _meli_get_pictures(meli_item_id)
    return {"ok": True, "picture_id": picture_id, "url": picture_url, "pictures": updated_pics}


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
