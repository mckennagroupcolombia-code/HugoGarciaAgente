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
    entry = _load_studio_all().get(sku)
    if not isinstance(entry, dict):
        return None
    versiones = entry.get("_versiones")
    if isinstance(versiones, dict):
        org = versiones.get("original")
        if isinstance(org, dict):
            return org
        alt = versiones.get("alternativa")
        return alt if isinstance(alt, dict) else None
    return entry


def obtener_studio_sku_version(sku: str, version: str = "original") -> dict | None:
    sku = (sku or "").strip()
    if not sku:
        return None
    version = (version or "original").strip().lower()
    entry = _load_studio_all().get(sku)
    if not isinstance(entry, dict):
        return None
    versiones = entry.get("_versiones")
    if isinstance(versiones, dict):
        data = versiones.get(version)
        return data if isinstance(data, dict) else None
    return entry if version == "original" else None


def listar_versiones_studio_sku(sku: str) -> list[str]:
    sku = (sku or "").strip()
    if not sku:
        return []
    entry = _load_studio_all().get(sku)
    if not isinstance(entry, dict):
        return []
    versiones = entry.get("_versiones")
    if isinstance(versiones, dict):
        return [k for k, v in versiones.items() if isinstance(v, dict)]
    return ["original"]


def guardar_studio_sku(sku: str, datos: dict, version: str = "original") -> dict:
    sku = (sku or "").strip()
    if not sku:
        raise ValueError("SKU obligatorio")
    version = (version or "original").strip().lower()
    if version not in {"original", "alternativa"}:
        raise ValueError("version inválida (usa 'original' o 'alternativa')")
    all_data = _load_studio_all()
    prev = all_data.get(sku)
    now = datetime.now().isoformat(timespec="seconds")
    payload = dict(datos)
    payload["sku"] = sku
    payload["updated_at"] = now

    if isinstance(prev, dict) and isinstance(prev.get("_versiones"), dict):
        versiones = dict(prev["_versiones"])
    else:
        legacy = prev if isinstance(prev, dict) else {}
        versiones = {
            "original": dict(legacy) if legacy else {},
            "alternativa": dict(legacy) if legacy else {},
        }

    versiones[version] = payload
    all_data[sku] = {
        "_versiones": versiones,
        "updated_at": now,
    }
    _save_studio_all(all_data)
    return payload


def copiar_version_studio_sku(
    sku: str,
    origen: str = "original",
    destino: str = "alternativa",
    *,
    sobrescribir: bool = True,
) -> dict:
    sku = (sku or "").strip()
    if not sku:
        raise ValueError("SKU obligatorio")
    origen = (origen or "").strip().lower()
    destino = (destino or "").strip().lower()
    if origen not in {"original", "alternativa"} or destino not in {"original", "alternativa"}:
        raise ValueError("Versiones inválidas")
    if origen == destino:
        raise ValueError("origen y destino no pueden ser iguales")

    all_data = _load_studio_all()
    entry = all_data.get(sku)
    if not isinstance(entry, dict):
        raise ValueError("SKU sin datos de studio")
    versiones = entry.get("_versiones")
    if not isinstance(versiones, dict):
        legacy = dict(entry)
        versiones = {"original": dict(legacy), "alternativa": dict(legacy)}
    src = versiones.get(origen)
    if not isinstance(src, dict):
        raise ValueError(f"No existe versión '{origen}'")
    if not sobrescribir and isinstance(versiones.get(destino), dict):
        raise ValueError(f"La versión '{destino}' ya existe")
    now = datetime.now().isoformat(timespec="seconds")
    dst = dict(src)
    dst["sku"] = sku
    dst["updated_at"] = now
    versiones[destino] = dst
    all_data[sku] = {"_versiones": versiones, "updated_at": now}
    _save_studio_all(all_data)
    return dst


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
    req_w = float(datos.get("ancho_mm") or 0) if str(datos.get("ancho_mm") or "").strip() else 0.0
    req_h = float(datos.get("alto_mm") or 0) if str(datos.get("alto_mm") or "").strip() else 0.0
    got_w = float(meta.get("ancho_mm") or 0) if meta.get("ancho_mm") else 0.0
    got_h = float(meta.get("alto_mm") or 0) if meta.get("alto_mm") else 0.0
    if req_w and req_h and got_w and got_h and (abs(req_w - got_w) > 0.2 or abs(req_h - got_h) > 0.2):
        raise ValueError(
            f"Dimensiones bloqueadas: solicitadas {req_w}x{req_h} mm, plantilla {got_w}x{got_h} mm"
        )
    pf = (meta or {}).get("preflight") or {}
    if pf and not pf.get("ok", True):
        errs = "; ".join(pf.get("errors") or ["Layout inválido"])
        raise ValueError(f"Preflight layout falló: {errs}")
    tmp = tempfile.mkdtemp(prefix="mckg_etq_print_")
    svg_path = os.path.join(tmp, "etiqueta.svg")
    pdf_path = os.path.join(tmp, "etiqueta.pdf")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg)
    _inkscape_export(svg_path, pdf_path, "pdf", export_area=meta.get("export_area"))
    return pdf_path, meta


def mapa_sku_por_archivo_ai() -> dict[str, dict[str, str]]:
    """Archivo .ai en Etiquetas Modelo SVG → SKU/nombre Siigo (catálogo Studio)."""
    from app.services.siigo import listar_productos_combo_siigo
    from app.tools.etiquetas_ai_engine import resolver_plantilla_ai

    out: dict[str, dict[str, str]] = {}
    for c in listar_productos_combo_siigo():
        code = (c.get("code") or "").strip()
        name = (c.get("name") or "").strip()
        if not code:
            continue
        studio = obtener_studio_sku(code) or {}
        forzar_svg = studio.get("forzar_plantilla_svg") in (True, 1, "1", "true")
        if forzar_svg:
            continue
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
        archivo = (studio.get("archivo_ai") or resolver_plantilla_ai(datos_resolucion, limite=1).get("archivo_ai") or "").strip()
        if not archivo:
            continue
        prev = out.get(archivo)
        if not prev or len(code) < len(prev.get("sku") or ""):
            out[archivo] = {"sku": code, "nombre": name}
    return out


def mapa_sku_por_archivo_pdf() -> dict[str, dict[str, str]]:
    """PDF en Etiquetas Modelo SVG/PDF/ → SKU vinculado (vía .ai emparejado o nombre)."""
    from app.tools.etiquetas_ai_engine import (
        _archivo_plantilla_id,
        _clave_relacion_plantilla,
        _filas_relacion_ai_pdf,
        _indice_pdf,
    )

    ai_map = mapa_sku_por_archivo_ai()
    out: dict[str, dict[str, str]] = {}

    for rel in _filas_relacion_ai_pdf():
        ai_path = rel.get("ai")
        pdf_path = rel.get("pdf")
        if not pdf_path:
            continue
        pdf_id = _archivo_plantilla_id(pdf_path)
        info = ai_map.get(ai_path.name) if ai_path else None
        if info:
            out[pdf_id] = info
            out[pdf_path.name] = info
            continue
        for archivo_ai, sku_info in ai_map.items():
            if _clave_relacion_plantilla(Path(archivo_ai).stem) == rel.get("clave"):
                out[pdf_id] = sku_info
                out[pdf_path.name] = sku_info
                break

    pdf_por_clave: dict[str, str] = {}
    for _nom, _fmt, path in _indice_pdf():
        pdf_por_clave[_clave_relacion_plantilla(path.stem)] = _archivo_plantilla_id(path)

    for archivo_ai, info in ai_map.items():
        pdf_id = pdf_por_clave.get(_clave_relacion_plantilla(Path(archivo_ai).stem))
        if pdf_id and pdf_id not in out:
            out[pdf_id] = info
            out[Path(pdf_id).name] = info
    return out


_PNG_RECURSOS_SUBDIR = "Recursos PNG"
_PDF_ETIQUETAS_SUBDIR = "Etiquetas McKenna"


def _carpeta_recursos_png() -> Path:
    """Misma carpeta que usa /api/etiquetas/recursos-png en routes.py."""
    base = Path.home() / "Documentos" / _PDF_ETIQUETAS_SUBDIR / _PNG_RECURSOS_SUBDIR
    base.mkdir(parents=True, exist_ok=True)
    return base


def listar_recursos_png_sueltos(q: str = "") -> list[str]:
    """PNG/JPG generados en Studio (transición .ai → PNG): no se emparejan con
    SKU todavía, se listan tal cual existan en la biblioteca de imágenes
    (incluye subcarpetas, con la ruta relativa como nombre)."""
    carpeta = _carpeta_recursos_png()
    nombres = sorted(
        p.relative_to(carpeta).as_posix()
        for p in carpeta.rglob("*")
        if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg")
    )
    ql = (q or "").strip().lower()
    if ql:
        nombres = [n for n in nombres if ql in n.lower()]
    return nombres


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

        meli_id = _meli_id_efectivo_sku(code, overrides=overrides, cache=cache)
        if solo_con_meli and not meli_id:
            continue

        studio = obtener_studio_sku(code) or {}
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

        if ql:
            coincide = ql in code.lower() or ql in name.lower()
            if not coincide and archivo_ai:
                coincide = ql in archivo_ai.lower()
            if not coincide:
                tipo_eff = (studio.get("tipo_etiqueta") or inferido.get("tipo_etiqueta") or "")
                coincide = ql in str(tipo_eff).lower()
            if not coincide:
                for cand in res.get("candidatos") or []:
                    arch = (cand.get("archivo") or "").lower()
                    if ql in arch:
                        coincide = True
                        break
            if not coincide:
                continue

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
    if ql:
        sin_producto = [a for a in sin_producto if ql in a.lower()]

    # PNG generados en Studio: durante la transición se listan sueltos, sin
    # intentar emparejarlos con un SKU del catálogo.
    png_sueltos = listar_recursos_png_sueltos(ql)

    stats = {
        "total_productos": len(filas),
        "con_meli": sum(1 for f in filas if f.get("meli_id")),
        "con_ai": sum(1 for f in filas if f.get("archivo_ai") and f.get("fuente") == "ai"),
        "solo_svg": sum(1 for f in filas if f.get("fuente") == "svg"),
        "sin_match": sum(1 for f in filas if f.get("fuente") == "sin_match"),
        "studio_guardado": sum(1 for f in filas if f.get("studio_guardado")),
        "plantillas_ai_total": len(todas_ai),
        "plantillas_ai_sin_producto": len(sin_producto),
        "plantillas_png_total": len(png_sueltos),
    }

    return {
        "filas": filas[:limite],
        "total": len(filas),
        "stats": stats,
        "plantillas_sin_producto": sin_producto[:80],
        "plantillas_png_sin_producto": png_sueltos[:80],
    }


_DIAG_FORMATOS_PATH = _REPO / "app" / "data" / "etiquetas_diagramacion_formatos.json"


def _load_diagramacion_formatos() -> dict:
    if not _DIAG_FORMATOS_PATH.exists():
        return {}
    try:
        with open(_DIAG_FORMATOS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_diagramacion_formatos(data: dict) -> None:
    _DIAG_FORMATOS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_DIAG_FORMATOS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def obtener_diagramacion_formato(tipo_etiqueta: str) -> dict | None:
    tipo = (tipo_etiqueta or "").strip()
    if not tipo:
        return None
    entry = _load_diagramacion_formatos().get(tipo)
    return entry if isinstance(entry, dict) else None


def guardar_diagramacion_formato(tipo_etiqueta: str, datos: dict) -> dict:
    tipo = (tipo_etiqueta or "").strip()
    if not tipo:
        raise ValueError("tipo_etiqueta obligatorio")
    all_data = _load_diagramacion_formatos()
    payload = dict(datos)
    payload["tipo_etiqueta"] = tipo
    payload["updated_at"] = datetime.now().isoformat(timespec="seconds")
    all_data[tipo] = payload
    _save_diagramacion_formatos(all_data)
    return payload
