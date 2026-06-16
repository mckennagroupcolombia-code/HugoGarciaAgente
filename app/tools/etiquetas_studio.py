"""
Generación de etiquetas McKenna Studio: PDF imprimible y persistencia.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_STUDIO_PATH = _REPO / "app" / "data" / "etiquetas_studio.json"


def _load_studio_all() -> dict:
    if not _STUDIO_PATH.exists():
        return {}
    try:
        with open(_STUDIO_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_studio_all(data: dict) -> None:
    _STUDIO_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_STUDIO_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def obtener_studio_sku(sku: str) -> dict | None:
    sku = (sku or "").strip()
    if not sku:
        return None
    return _load_studio_all().get(sku)


def guardar_studio_sku(sku: str, datos: dict) -> dict:
    sku = (sku or "").strip()
    if not sku:
        raise ValueError("SKU obligatorio")
    all_data = _load_studio_all()
    entry = dict(datos)
    entry["sku"] = sku
    entry["updated_at"] = datetime.now().isoformat(timespec="seconds")
    all_data[sku] = entry
    _save_studio_all(all_data)
    return entry


def exportar_pdf_studio(datos: dict) -> dict[str, Any]:
    """Genera PDF desde plantilla SVG McKenna (Inkscape)."""
    from app.tools.etiquetas_svg_engine import exportar_pdf_desde_svg

    return exportar_pdf_desde_svg(datos)


def generar_pdf_temporal_para_impresion(datos: dict) -> tuple[str, dict]:
    """PDF temporal desde plantilla .ai/SVG para CUPS (no guarda en Documentos)."""
    import os
    import tempfile

    from app.tools.etiquetas_svg_engine import _inkscape_export, renderizar_svg

    svg, meta = renderizar_svg(datos)
    tmp = tempfile.mkdtemp(prefix="mckg_etq_print_")
    svg_path = os.path.join(tmp, "etiqueta.svg")
    pdf_path = os.path.join(tmp, "etiqueta.pdf")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg)
    _inkscape_export(svg_path, pdf_path, "pdf", export_area=meta.get("export_area"))
    return pdf_path, meta


def listar_catalogo_studio(
    *,
    q: str = "",
    solo_sin_ai: bool = False,
    solo_con_meli: bool = False,
    limite: int = 500,
) -> dict[str, Any]:
    """Catálogo SKU Siigo ↔ plantilla .ai ↔ publicación MeLi."""
    from app.services.publicaciones import (
        _load_cache,
        _load_overrides,
        _meli_id_efectivo_sku,
    )
    from app.services.siigo import listar_productos_combo_siigo
    from app.tools.etiquetas_ai_engine import listar_plantillas_ai, resolver_plantilla_ai

    studio_all = _load_studio_all()
    overrides = _load_overrides()
    cache = _load_cache()
    combos = listar_productos_combo_siigo()
    ql = (q or "").strip().lower()

    filas: list[dict[str, Any]] = []
    archivos_usados: set[str] = set()

    for c in combos:
        code = (c.get("code") or "").strip()
        name = (c.get("name") or "").strip()
        if not code:
            continue
        if ql and ql not in code.lower() and ql not in name.lower():
            continue

        meli_id = _meli_id_efectivo_sku(code, overrides=overrides, cache=cache)
        if solo_con_meli and not meli_id:
            continue

        studio = studio_all.get(code) or {}
        forzar_svg = studio.get("forzar_plantilla_svg") in (True, 1, "1", "true")
        datos_resolucion = {
            "sku": code,
            "nombre_producto": studio.get("nombre_producto") or name,
            "ingrediente": studio.get("ingrediente") or name,
            "contenido_neto": studio.get("contenido_neto") or "",
            "unidad": studio.get("unidad") or "",
            "tipo_etiqueta": studio.get("tipo_etiqueta") or "",
            "archivo_ai": studio.get("archivo_ai") or "",
            "forzar_plantilla_svg": forzar_svg,
        }
        res = resolver_plantilla_ai(datos_resolucion, limite=3)
        inferido = res.get("inferido") or {}
        archivo_ai = (studio.get("archivo_ai") or res.get("archivo_ai") or "").strip() or None
        if solo_sin_ai and archivo_ai and not forzar_svg:
            continue

        if archivo_ai and not forzar_svg:
            archivos_usados.add(archivo_ai)

        fuente = "svg" if forzar_svg else ("ai" if archivo_ai else "sin_match")
        filas.append({
            "sku": code,
            "nombre": name,
            "meli_id": meli_id or None,
            "meli_url": f"https://articulo.mercadolibre.com.co/{meli_id}" if meli_id else None,
            "archivo_ai": archivo_ai,
            "score": res.get("score") or 0,
            "fuente": fuente,
            "studio_guardado": bool(studio),
            "tipo_etiqueta": studio.get("tipo_etiqueta") or inferido.get("tipo_etiqueta"),
            "archivo_ai_manual": bool(studio.get("archivo_ai")),
            "estado_meli_config": (overrides.get(code, {}).get("estado_meli_config") or "").strip().lower() or None,
        })

    filas.sort(key=lambda x: (x.get("nombre") or "").lower())

    todas_ai = {p["archivo"] for p in listar_plantillas_ai(limite=10_000)}
    sin_producto = sorted(todas_ai - archivos_usados)

    stats = {
        "total_productos": len(filas),
        "con_meli": sum(1 for f in filas if f.get("meli_id")),
        "con_ai": sum(1 for f in filas if f.get("archivo_ai") and f.get("fuente") == "ai"),
        "solo_svg": sum(1 for f in filas if f.get("fuente") == "svg"),
        "sin_match": sum(1 for f in filas if f.get("fuente") == "sin_match"),
        "studio_guardado": sum(1 for f in filas if f.get("studio_guardado")),
        "plantillas_ai_total": len(todas_ai),
        "plantillas_ai_sin_producto": len(sin_producto),
    }

    return {
        "filas": filas[:limite],
        "total": len(filas),
        "stats": stats,
        "plantillas_sin_producto": sin_producto[:80],
    }
