"""
Cruce de códigos Mercado Libre ↔ Siigo para el panel de operaciones.

Fuente de verdad del vínculo:
- Código Siigo = `products.code` (mismo string que el SKU de catálogo / Sheets col B).
- Código MeLi = `item.id` (MCO…) + SKU de publicación (`seller_custom_field` / `SELLER_SKU`).
- Override manual: `publicaciones_overrides.json` ({sku_siigo → meli_item_id}).
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import requests

_REPO = Path(__file__).resolve().parents[2]
_CACHE_PATH = _REPO / "app" / "data" / "relacion_codigos_cache.json"
_CACHE_TTL_S = 30 * 60
_CACHE_JSON_WEB = _REPO / "PAGINA_WEB" / "site" / "data" / "cache.json"


def _sku_desde_item_meli(body: dict) -> str:
    sku = (body.get("seller_custom_field") or "").strip()
    if sku:
        return sku
    for a in body.get("attributes") or []:
        if a.get("id") == "SELLER_SKU":
            return (a.get("value_name") or "").strip()
    return ""


def _norm(s: str) -> str:
    return (s or "").strip()


def _norm_key(s: str) -> str:
    return _norm(s).upper()


def _load_cache() -> dict:
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(data: dict) -> None:
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as e:
        print(f"⚠️ [relacion-codigos] No se pudo guardar caché: {e}")


def _get_siigo_skus() -> dict[str, str]:
    from app.tools.verificacion_sync_skus import _get_siigo_skus as _siigo

    return _siigo()


def _get_meli_items() -> list[dict]:
    """Lista publicaciones activas: meli_id, sku_meli, titulo, permalink, status."""
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token de Mercado Libre no disponible.")
    headers = {"Authorization": f"Bearer {token}"}
    me = requests.get(
        "https://api.mercadolibre.com/users/me", headers=headers, timeout=25
    ).json()
    seller_id = me.get("id")
    if not seller_id:
        raise RuntimeError("No se pudo obtener el seller_id de MeLi.")

    item_ids: list[str] = []
    offset = 0
    while True:
        r = requests.get(
            f"https://api.mercadolibre.com/users/{seller_id}/items/search"
            f"?status=active&limit=100&offset={offset}",
            headers=headers,
            timeout=30,
        ).json()
        ids = r.get("results") or []
        if not ids:
            break
        item_ids.extend(ids)
        offset += len(ids)
        if offset >= (r.get("paging") or {}).get("total", 0):
            break

    out: list[dict] = []
    for i in range(0, len(item_ids), 20):
        batch = ",".join(item_ids[i : i + 20])
        items = requests.get(
            f"https://api.mercadolibre.com/items?ids={batch}",
            headers=headers,
            timeout=40,
        ).json()
        for it in items:
            if it.get("code") != 200:
                continue
            body = it.get("body") or {}
            mid = _norm(str(body.get("id") or ""))
            if not mid:
                continue
            out.append(
                {
                    "meli_id": mid,
                    "sku_meli": _sku_desde_item_meli(body),
                    "titulo": _norm(body.get("title") or ""),
                    "permalink": _norm(body.get("permalink") or ""),
                    "status": _norm(body.get("status") or ""),
                }
            )
    return out


def _meli_ids_desde_overrides_y_cache() -> dict[str, str]:
    """meli_id normalizado → sku Siigo (preferencia: override, luego cache web)."""
    from app.services.publicaciones import _load_overrides, normalizar_meli_item_id

    meli_to_sku: dict[str, str] = {}

    # cache.json (combos web): ref = código Siigo
    try:
        raw = json.loads(_CACHE_JSON_WEB.read_text(encoding="utf-8"))
        for p in raw.get("combos") or []:
            sku = _norm(p.get("ref") or p.get("rep_sku") or p.get("sku") or "")
            mid = normalizar_meli_item_id(_norm(p.get("meli_id") or ""))
            if sku and mid and mid not in meli_to_sku:
                meli_to_sku[mid] = sku
    except Exception:
        pass

    overrides = _load_overrides()
    for sku, ov in overrides.items():
        if not isinstance(ov, dict):
            continue
        mid = normalizar_meli_item_id(_norm(ov.get("meli_item_id") or ""))
        if sku and mid:
            meli_to_sku[mid] = _norm(sku)

    return meli_to_sku


def _estado_fila(
    *,
    sku_meli: str,
    codigo_siigo: str,
    en_siigo: bool,
    sku_coincide: bool,
) -> str:
    if not sku_meli and not codigo_siigo:
        return "sin_codigo"
    if en_siigo and sku_coincide:
        return "vinculado"
    if en_siigo and codigo_siigo and not sku_coincide:
        return "sku_divergente"
    if en_siigo:
        return "vinculado"
    if sku_meli or codigo_siigo:
        return "sin_siigo"
    return "sin_codigo"


def listar_relacion_codigos_meli_siigo(
    buscar: str = "",
    filtro: str = "todos",
    refresh: bool = False,
) -> dict[str, Any]:
    """
    Lista el cruce MeLi ↔ Siigo.

    filtro: todos | vinculados | sin_siigo | divergentes | sin_codigo
    """
    q = _norm(buscar).lower()
    filtro_n = _norm(filtro).lower() or "todos"
    now = time.time()
    cache = _load_cache()

    if (
        not refresh
        and cache.get("version") == 1
        and (now - float(cache.get("ts") or 0)) < _CACHE_TTL_S
        and isinstance(cache.get("items"), list)
    ):
        items = list(cache["items"])
        fuente = "cache"
        actualizado_en = cache.get("actualizado_en")
        error = cache.get("error")
    else:
        error = None
        try:
            siigo = _get_siigo_skus()
        except Exception as e:
            siigo = {}
            error = f"Siigo: {e}"

        siigo_by_key = {_norm_key(k): (k, v) for k, v in siigo.items()}

        try:
            meli_items = _get_meli_items()
        except Exception as e:
            meli_items = []
            error = (error + " | " if error else "") + f"MeLi: {e}"

        meli_to_sku_map = _meli_ids_desde_overrides_y_cache()
        from app.services.publicaciones import normalizar_meli_item_id

        items = []
        for m in meli_items:
            mid = normalizar_meli_item_id(m["meli_id"])
            sku_meli = _norm(m.get("sku_meli") or "")
            codigo_desde_map = _norm(meli_to_sku_map.get(mid) or "")

            # Preferir SKU MeLi si existe en Siigo; si no, el mapeo override/cache.
            codigo_siigo = ""
            nombre_siigo = ""
            en_siigo = False
            if sku_meli:
                hit = siigo_by_key.get(_norm_key(sku_meli))
                if hit:
                    codigo_siigo, nombre_siigo = hit
                    en_siigo = True
            if not en_siigo and codigo_desde_map:
                hit = siigo_by_key.get(_norm_key(codigo_desde_map))
                if hit:
                    codigo_siigo, nombre_siigo = hit
                    en_siigo = True
                else:
                    codigo_siigo = codigo_desde_map

            if not codigo_siigo and sku_meli:
                codigo_siigo = sku_meli  # candidato aunque no esté en Siigo

            sku_coincide = bool(
                sku_meli
                and codigo_siigo
                and _norm_key(sku_meli) == _norm_key(codigo_siigo)
            )
            estado = _estado_fila(
                sku_meli=sku_meli,
                codigo_siigo=codigo_siigo,
                en_siigo=en_siigo,
                sku_coincide=sku_coincide,
            )
            items.append(
                {
                    "meli_id": mid,
                    "titulo": m.get("titulo") or "",
                    "sku_meli": sku_meli,
                    "codigo_siigo": codigo_siigo if en_siigo or codigo_desde_map else (
                        sku_meli if sku_meli else ""
                    ),
                    "nombre_siigo": nombre_siigo,
                    "en_siigo": en_siigo,
                    "sku_coincide": sku_coincide,
                    "estado": estado,
                    "permalink": m.get("permalink") or "",
                    "tiene_override": mid in meli_to_sku_map
                    and _norm_key(meli_to_sku_map.get(mid, ""))
                    != _norm_key(sku_meli),
                }
            )

        # Siigo con override/cache a un MeLi que no salió en activos (pausados, etc.)
        meli_ids_vistos = {it["meli_id"] for it in items}
        for mid, sku in meli_to_sku_map.items():
            mid_n = normalizar_meli_item_id(mid)
            if mid_n in meli_ids_vistos:
                continue
            hit = siigo_by_key.get(_norm_key(sku))
            en_siigo = bool(hit)
            nombre_siigo = hit[1] if hit else ""
            codigo_siigo = hit[0] if hit else sku
            items.append(
                {
                    "meli_id": mid_n,
                    "titulo": nombre_siigo or sku,
                    "sku_meli": "",
                    "codigo_siigo": codigo_siigo,
                    "nombre_siigo": nombre_siigo,
                    "en_siigo": en_siigo,
                    "sku_coincide": False,
                    "estado": "vinculado" if en_siigo else "sin_siigo",
                    "permalink": "",
                    "tiene_override": True,
                }
            )

        items.sort(key=lambda x: (x["estado"] != "sin_siigo", x["codigo_siigo"] or x["sku_meli"] or x["meli_id"]))
        actualizado_en = time.strftime("%Y-%m-%dT%H:%M:%S")
        fuente = "live"
        _save_cache(
            {
                "version": 1,
                "ts": now,
                "actualizado_en": actualizado_en,
                "items": items,
                "error": error,
                "totales_siigo": len(siigo),
            }
        )

    def _match_q(it: dict) -> bool:
        if not q:
            return True
        blob = " ".join(
            [
                it.get("meli_id") or "",
                it.get("titulo") or "",
                it.get("sku_meli") or "",
                it.get("codigo_siigo") or "",
                it.get("nombre_siigo") or "",
            ]
        ).lower()
        return q in blob

    filtrados = [it for it in items if _match_q(it)]
    if filtro_n == "vinculados":
        filtrados = [it for it in filtrados if it.get("estado") == "vinculado"]
    elif filtro_n == "sin_siigo":
        filtrados = [it for it in filtrados if it.get("estado") == "sin_siigo"]
    elif filtro_n in ("divergentes", "sku_divergente"):
        filtrados = [it for it in filtrados if it.get("estado") == "sku_divergente"]
    elif filtro_n == "sin_codigo":
        filtrados = [it for it in filtrados if it.get("estado") == "sin_codigo"]

    totales = {
        "total": len(items),
        "vinculados": sum(1 for it in items if it.get("estado") == "vinculado"),
        "sin_siigo": sum(1 for it in items if it.get("estado") == "sin_siigo"),
        "divergentes": sum(1 for it in items if it.get("estado") == "sku_divergente"),
        "sin_codigo": sum(1 for it in items if it.get("estado") == "sin_codigo"),
        "filtrados": len(filtrados),
    }

    return {
        "items": filtrados,
        "totales": totales,
        "actualizado_en": actualizado_en,
        "fuente": fuente,
        "filtro": filtro_n,
        "error": error,
        "cache_ttl_s": _CACHE_TTL_S,
    }


def vincular_meli_con_siigo(codigo_siigo: str, meli_id: str) -> dict:
    """
    Guarda override sku_siigo → meli_item_id (misma persistencia que Publicaciones).
    Verifica que el código exista en Siigo cuando sea posible.
    """
    from app.services.publicaciones import actualizar_publicacion, normalizar_meli_item_id
    from app.services.siigo import buscar_producto_siigo_por_sku

    sku = _norm(codigo_siigo)
    mid = normalizar_meli_item_id(_norm(meli_id))
    if not sku or not mid:
        raise ValueError("Se requieren 'codigo_siigo' y 'meli_id'.")

    prod = None
    try:
        prod = buscar_producto_siigo_por_sku(sku)
    except Exception:
        prod = None

    res = actualizar_publicacion(sku, {"meli_item_id": mid})
    try:
        if _CACHE_PATH.exists():
            _CACHE_PATH.unlink()
    except Exception:
        pass

    return {
        "ok": True,
        "codigo_siigo": sku,
        "meli_id": mid,
        "en_siigo": bool(prod),
        "nombre_siigo": (prod or {}).get("nombre") or "",
        "override": res.get("override"),
    }
