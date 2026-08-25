"""
Desenfoque (Gaussian blur) de regiones en fotos de publicaciones MeLi.

Usado para ocultar "McKenna Group" / NIT / datos de empresa en etiquetas
ya publicadas. Regiones en fracción 0–1 del ancho/alto de la imagen.
"""
from __future__ import annotations

import base64
import logging
from io import BytesIO
from typing import Any

import requests as _req

log = logging.getLogger(__name__)

_DEFAULT_RADIO = 28
_DEFAULT_PIE_PCT = 0.15
_MAX_RADIO = 80
_MIN_RADIO = 4


def region_pie(pie_pct: float = _DEFAULT_PIE_PCT) -> dict[str, float]:
    """Franja inferior a ancho completo (fracción 0–1)."""
    pct = float(pie_pct)
    if pct <= 0 or pct > 0.6:
        pct = _DEFAULT_PIE_PCT
    return {"x": 0.0, "y": max(0.0, 1.0 - pct), "w": 1.0, "h": pct}


def _clamp_region(r: dict[str, Any]) -> dict[str, float] | None:
    try:
        x = float(r.get("x", 0))
        y = float(r.get("y", 0))
        w = float(r.get("w", 0))
        h = float(r.get("h", 0))
    except (TypeError, ValueError):
        return None
    x = max(0.0, min(1.0, x))
    y = max(0.0, min(1.0, y))
    w = max(0.0, min(1.0 - x, w))
    h = max(0.0, min(1.0 - y, h))
    if w < 0.005 or h < 0.005:
        return None
    return {"x": x, "y": y, "w": w, "h": h}


def normalizar_regiones(
    regiones: list[dict] | None,
    *,
    modo: str = "regiones",
    pie_pct: float = _DEFAULT_PIE_PCT,
) -> list[dict[str, float]]:
    """Arma lista de regiones válidas según modo pie|regiones."""
    modo_n = (modo or "regiones").strip().lower()
    out: list[dict[str, float]] = []
    if modo_n == "pie":
        out.append(region_pie(pie_pct))
    for r in regiones or []:
        if not isinstance(r, dict):
            continue
        c = _clamp_region(r)
        if c:
            out.append(c)
    if not out and modo_n == "pie":
        out.append(region_pie(pie_pct))
    return out


def aplicar_desenfoque(
    file_bytes: bytes,
    regiones: list[dict],
    *,
    radio: int = _DEFAULT_RADIO,
    out_format: str = "JPEG",
) -> tuple[bytes, dict]:
    """
    Aplica GaussianBlur a cada región (fracción 0–1).
    Devuelve (bytes, meta).
    """
    from PIL import Image, ImageFilter

    if not file_bytes:
        raise ValueError("Imagen vacía")

    r = int(radio)
    if r < _MIN_RADIO:
        r = _MIN_RADIO
    if r > _MAX_RADIO:
        r = _MAX_RADIO

    regs = []
    for reg in regiones or []:
        c = _clamp_region(reg) if isinstance(reg, dict) else None
        if c:
            regs.append(c)
    if not regs:
        raise ValueError("Se necesita al menos una región de desenfoque")

    with Image.open(BytesIO(file_bytes)) as im:
        im.load()
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            base = im.convert("RGBA")
            fondo = Image.new("RGBA", base.size, (255, 255, 255, 255))
            rgb = Image.alpha_composite(fondo, base).convert("RGB")
        else:
            rgb = im.convert("RGB")

        w, h = rgb.size
        for reg in regs:
            x0 = int(round(reg["x"] * w))
            y0 = int(round(reg["y"] * h))
            x1 = int(round((reg["x"] + reg["w"]) * w))
            y1 = int(round((reg["y"] + reg["h"]) * h))
            x0, y0 = max(0, x0), max(0, y0)
            x1, y1 = min(w, x1), min(h, y1)
            if x1 - x0 < 2 or y1 - y0 < 2:
                continue
            crop = rgb.crop((x0, y0, x1, y1))
            # Radio grande: dos pasadas suaves mejoran el texto denso
            blurred = crop.filter(ImageFilter.GaussianBlur(radius=r))
            if r >= 16:
                blurred = blurred.filter(ImageFilter.GaussianBlur(radius=max(_MIN_RADIO, r // 2)))
            rgb.paste(blurred, (x0, y0))

        buf = BytesIO()
        fmt = (out_format or "JPEG").upper()
        if fmt in ("JPG", "JPEG"):
            rgb.save(buf, format="JPEG", quality=92, optimize=True)
            fmt = "JPEG"
        else:
            rgb.save(buf, format="PNG", optimize=True)
            fmt = "PNG"
        out = buf.getvalue()

    return out, {
        "width": w,
        "height": h,
        "radio": r,
        "regiones": regs,
        "format": fmt,
        "size_bytes": len(out),
    }


def descargar_imagen_url(url: str, *, timeout: int = 30) -> bytes:
    """GET de URL MeLi/CDN. Lanza ValueError si falla."""
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        raise ValueError("URL de imagen inválida")
    try:
        r = _req.get(u, timeout=timeout, headers={"User-Agent": "McKennaAgent/1.0"})
    except Exception as e:
        raise ValueError(f"No se pudo descargar la imagen: {e}") from e
    if r.status_code != 200:
        raise ValueError(f"Descarga HTTP {r.status_code}")
    if not r.content or len(r.content) < 100:
        raise ValueError("Respuesta de imagen vacía o demasiado corta")
    return r.content


def preview_base64(file_bytes: bytes, meta: dict | None = None) -> dict:
    """Empaqueta bytes de imagen como data-URL JPEG/PNG."""
    fmt = ((meta or {}).get("format") or "JPEG").upper()
    mime = "image/png" if fmt == "PNG" else "image/jpeg"
    b64 = base64.b64encode(file_bytes).decode("ascii")
    return {
        "ok": True,
        "preview_base64": f"data:{mime};base64,{b64}",
        "meta": meta or {},
    }


def resolver_picture_ids(
    pics: list[dict],
    picture_ids: str | list[str] | None,
) -> list[str]:
    """
    picture_ids: lista, \"principal\", \"todas\" o None (= principal).
    """
    if not pics:
        return []
    if picture_ids is None or picture_ids == "" or picture_ids == "principal":
        return [pics[0]["id"]]
    if picture_ids == "todas":
        return [p["id"] for p in pics if p.get("id")]
    if isinstance(picture_ids, list):
        wanted = {str(x).strip() for x in picture_ids if str(x).strip()}
        return [p["id"] for p in pics if p.get("id") in wanted]
    # string suelto = un id
    pid = str(picture_ids).strip()
    return [p["id"] for p in pics if p.get("id") == pid]


def reemplazar_foto_meli_desenfocada(
    meli_item_id: str,
    picture_id: str,
    *,
    modo: str = "pie",
    pie_pct: float = _DEFAULT_PIE_PCT,
    regiones: list[dict] | None = None,
    radio: int = _DEFAULT_RADIO,
    sku: str = "",
) -> dict:
    """
    Descarga picture → blur → normaliza 1000×1000 → CDN → sustituye id en el listing
    (misma posición). Si MeLi bloquea pictures, ok=True con adjuntada=False.
    """
    from app.services.publicaciones import (
        _meli_get_pictures,
        _meli_set_pictures,
        normalizar_imagen_catalogo,
        subir_foto_cdn_meli,
    )

    del sku  # reservado por callers del panel
    mid = (meli_item_id or "").strip()
    pid = (picture_id or "").strip()
    if not mid:
        return {"ok": False, "error": "Sin meli_item_id"}
    if not pid:
        return {"ok": False, "error": "Sin picture_id"}

    pics, err = _meli_get_pictures(mid)
    if err:
        return {"ok": False, "error": err, "meli_item_id": mid, "picture_id": pid}
    target = next((p for p in pics if p.get("id") == pid), None)
    if not target:
        return {
            "ok": False,
            "error": "Esa foto no está en la publicación de Mercado Libre",
            "meli_item_id": mid,
            "picture_id": pid,
        }
    url = (target.get("url") or "").strip()
    if not url:
        return {"ok": False, "error": "La foto no tiene URL descargable", "picture_id": pid}

    try:
        raw = descargar_imagen_url(url)
    except ValueError as e:
        return {"ok": False, "error": str(e), "picture_id": pid}

    regs = normalizar_regiones(regiones, modo=modo, pie_pct=pie_pct)
    if not regs:
        return {"ok": False, "error": "Sin regiones de desenfoque"}

    try:
        blurred, blur_meta = aplicar_desenfoque(raw, regs, radio=radio, out_format="JPEG")
        blurred, norm_meta = normalizar_imagen_catalogo(blurred, out_format="JPEG")
    except Exception as e:
        return {"ok": False, "error": f"Error aplicando desenfoque: {e}", "picture_id": pid}

    cdn = subir_foto_cdn_meli(blurred, "image/jpeg")
    if not cdn.get("ok"):
        return {
            "ok": False,
            "error": cdn.get("error") or "Fallo subiendo al CDN MeLi",
            "picture_id": pid,
        }

    new_id = cdn["picture_id"]
    new_url = cdn.get("url") or ""

    # Sustituir en la misma posición
    new_ids: list[str] = []
    for p in pics:
        if p.get("id") == pid:
            new_ids.append(new_id)
        else:
            new_ids.append(p["id"])

    result = _meli_set_pictures(mid, new_ids)
    if not result.get("ok"):
        return {
            "ok": True,
            "adjuntada": False,
            "meli_item_id": mid,
            "picture_id_origen": pid,
            "picture_id": new_id,
            "url": new_url,
            "error_adjuntar": result.get("error", ""),
            "blur_meta": blur_meta,
            "norm_meta": norm_meta,
            "nota": (
                "Imagen desenfocada subida al CDN, pero el listing no permite "
                "renovar fotos (p. ej. under_review)."
            ),
        }

    updated, _ = _meli_get_pictures(mid)
    return {
        "ok": True,
        "adjuntada": True,
        "meli_item_id": mid,
        "picture_id_origen": pid,
        "picture_id": new_id,
        "url": new_url,
        "pictures": updated,
        "blur_meta": blur_meta,
        "norm_meta": norm_meta,
    }


def aplicar_desenfoque_lote(
    items: list[dict],
    *,
    modo: str = "pie",
    pie_pct: float = _DEFAULT_PIE_PCT,
    regiones: list[dict] | None = None,
    radio: int = _DEFAULT_RADIO,
) -> dict:
    """
    Procesa varias publicaciones en serie.
    Cada item: {sku?, meli_item_id, picture_ids?: \"principal\"|\"todas\"|list}.
    """
    from app.services.publicaciones import _meli_get_pictures

    resultados: list[dict] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        sku = (item.get("sku") or "").strip()
        mid = (item.get("meli_item_id") or "").strip()
        if not mid:
            resultados.append({"ok": False, "sku": sku, "error": "Sin meli_item_id"})
            continue
        pics, err = _meli_get_pictures(mid)
        if err:
            resultados.append({"ok": False, "sku": sku, "meli_item_id": mid, "error": err})
            continue
        pids = resolver_picture_ids(pics, item.get("picture_ids"))
        if not pids:
            resultados.append({
                "ok": False,
                "sku": sku,
                "meli_item_id": mid,
                "error": "Sin fotos para desenfocar",
            })
            continue
        for pid in pids:
            r = reemplazar_foto_meli_desenfocada(
                mid,
                pid,
                modo=modo,
                pie_pct=pie_pct,
                regiones=regiones,
                radio=radio,
                sku=sku,
            )
            r["sku"] = sku
            resultados.append(r)

    ok_n = sum(1 for r in resultados if r.get("ok"))
    return {
        "ok": ok_n > 0 and ok_n == len(resultados),
        "procesados": len(resultados),
        "ok_count": ok_n,
        "error_count": len(resultados) - ok_n,
        "resultados": resultados,
    }


def preview_desde_fuente(
    *,
    url: str = "",
    meli_item_id: str = "",
    picture_id: str = "",
    file_bytes: bytes | None = None,
    modo: str = "pie",
    pie_pct: float = _DEFAULT_PIE_PCT,
    regiones: list[dict] | None = None,
    radio: int = _DEFAULT_RADIO,
) -> dict:
    """Genera preview base64 sin escribir en MeLi."""
    from app.services.publicaciones import _meli_get_pictures

    raw = file_bytes
    if raw is None:
        u = (url or "").strip()
        if not u and meli_item_id and picture_id:
            pics, err = _meli_get_pictures(meli_item_id.strip())
            if err:
                return {"ok": False, "error": err}
            target = next((p for p in pics if p.get("id") == picture_id.strip()), None)
            if not target:
                return {"ok": False, "error": "Foto no encontrada en el listing"}
            u = (target.get("url") or "").strip()
        if not u:
            return {"ok": False, "error": "Indica url, picture_id+meli_item_id o archivo"}
        try:
            raw = descargar_imagen_url(u)
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    regs = normalizar_regiones(regiones, modo=modo, pie_pct=pie_pct)
    if not regs:
        return {"ok": False, "error": "Sin regiones de desenfoque"}
    try:
        out, meta = aplicar_desenfoque(raw, regs, radio=radio, out_format="JPEG")
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return preview_base64(out, meta)
