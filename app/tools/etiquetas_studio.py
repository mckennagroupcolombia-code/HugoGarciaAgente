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
# Carpeta visible en Imprimir · archivos PNG (resto queda en Studio / galería).
_CARPETA_PNG_IMPRIMIR = "ETIQUETAS STUDIO"
_PNG_INDEX_PATH = _REPO / "app" / "data" / "etiquetas_recursos_png.json"
_TIPOS_ETIQUETAS_PATH = _REPO / "app" / "data" / "etiquetas_tipos.json"

# Mismos defaults que /api/etiquetas/tipos (fallback si no hay JSON).
_TIPOS_ETIQUETA_DEFAULT: list[tuple[str, float, float]] = [
    ("30 mL", 102.0, 38.0),
    ("5 mL", 66.0, 22.0),
    ("125 g", 70.0, 70.0),
    ("250 g", 76.0, 66.0),
    ("500 g", 76.0, 66.0),
    ("1 Lt", 108.0, 76.0),
    ("100 g", 69.0, 51.0),
    ("Lactato", 38.0, 140.0),
    ("Circular", 55.0, 55.0),
    ("Circular 50", 50.0, 50.0),
    ("Circle 50", 50.0, 50.0),
    ("CIRCLE", 53.9, 53.9),
    ("Circular 70", 70.0, 70.0),
    ("5 g", 50.0, 42.0),
    ("54mm", 54.0, 58.0),
]


def _carpeta_recursos_png() -> Path:
    """Misma carpeta que usa /api/etiquetas/recursos-png en routes.py."""
    base = Path.home() / "Documentos" / _PDF_ETIQUETAS_SUBDIR / _PNG_RECURSOS_SUBDIR
    base.mkdir(parents=True, exist_ok=True)
    return base


def _load_png_index_entries() -> list[dict]:
    if not _PNG_INDEX_PATH.exists():
        return []
    try:
        with open(_PNG_INDEX_PATH, encoding="utf-8") as f:
            data = json.load(f)
        items = data.get("recursos") if isinstance(data, dict) else []
        return [it for it in items if isinstance(it, dict)] if isinstance(items, list) else []
    except Exception:
        return []


def _tipos_etiqueta_mm() -> list[tuple[str, float, float]]:
    out: list[tuple[str, float, float]] = []
    seen: set[str] = set()
    if _TIPOS_ETIQUETAS_PATH.exists():
        try:
            with open(_TIPOS_ETIQUETAS_PATH, encoding="utf-8") as f:
                data = json.load(f)
            items = data.get("tipos") if isinstance(data, dict) else data
            if isinstance(items, list):
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    nombre = (it.get("nombre") or "").strip()
                    try:
                        aw = float(it.get("ancho_mm") or 0)
                        ah = float(it.get("alto_mm") or 0)
                    except (TypeError, ValueError):
                        continue
                    if nombre and aw > 0 and ah > 0 and nombre not in seen:
                        seen.add(nombre)
                        out.append((nombre, aw, ah))
        except Exception:
            pass
    for nombre, aw, ah in _TIPOS_ETIQUETA_DEFAULT:
        if nombre not in seen:
            seen.add(nombre)
            out.append((nombre, aw, ah))
    return out


def _norm_clave_formato(s: str) -> str:
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


def _inferir_formato_por_nombre(nombre: str, tipos: list[tuple[str, float, float]]) -> dict | None:
    """Asocia PNG→tipo por el tamaño en el nombre (p. ej. …_250g_…), no por el producto."""
    import re as _re_fmt

    stem = Path(nombre).stem
    # 1) Contenido neto explícito: 250g, 100_g, 30ml, 1kg…
    for m in _re_fmt.finditer(
        r"(?<![a-z0-9])(\d+(?:[.,]\d+)?)\s*[_\-]?\s*(g|ml|mL|lt|l|kg|mm)\b",
        stem.replace("_", " "),
        flags=_re_fmt.IGNORECASE,
    ):
        neto = m.group(1).replace(",", ".")
        if neto.endswith(".0"):
            neto = neto[:-2]
        unidad = m.group(2).lower()
        if unidad == "l":
            unidad = "lt"
        candidatos = {
            _norm_clave_formato(f"{neto}{unidad}"),
            _norm_clave_formato(f"{neto} {unidad}"),
        }
        if unidad == "lt":
            candidatos.add(_norm_clave_formato(f"{neto} Lt"))
            candidatos.add(_norm_clave_formato(f"{neto}Lt"))
        if unidad == "ml":
            candidatos.add(_norm_clave_formato(f"{neto} mL"))
            candidatos.add(_norm_clave_formato(f"{neto}mL"))
        for nombre_t, aw, ah in tipos:
            if _norm_clave_formato(nombre_t) in candidatos:
                return {"tipo_etiqueta": nombre_t, "ancho_mm": aw, "alto_mm": ah}

    # 2) Tipos con dígitos como segmento completo (_250_g_, _54mm_), no substrings de producto.
    segmentos = {_norm_clave_formato(s) for s in _re_fmt.split(r"[_\s\-]+", stem) if s}
    ordenados = sorted(tipos, key=lambda t: len(_norm_clave_formato(t[0])), reverse=True)
    for nombre_t, aw, ah in ordenados:
        clave_t = _norm_clave_formato(nombre_t)
        if not clave_t or not any(ch.isdigit() for ch in clave_t):
            continue
        if clave_t in segmentos or clave_t in _norm_clave_formato(stem):
            # Evita que "5g" matchee dentro de "125g": exige borde de dígito/unidad.
            if clave_t in segmentos or _re_fmt.search(
                rf"(?<![a-z0-9]){_re_fmt.escape(clave_t)}(?![a-z0-9])",
                _norm_clave_formato(stem),
            ):
                return {"tipo_etiqueta": nombre_t, "ancho_mm": aw, "alto_mm": ah}
    return None


def _inferir_formato_por_pixeles(
    ruta: Path,
    tipos: list[tuple[str, float, float]],
) -> dict | None:
    """Empareja tamaño en px con formato mm × DPI × escala de exportación (1–4×)."""
    try:
        from PIL import Image as _PILImg
        with _PILImg.open(ruta) as im:
            w_px, h_px = im.size
    except Exception:
        return None
    if w_px <= 0 or h_px <= 0:
        return None

    mejor: tuple[float, str, float, float] | None = None
    for nombre_t, aw, ah in tipos:
        for dpi in (96.0, 300.0, 150.0):
            for esc in (1, 2, 3, 4):
                for (mm_w, mm_h) in ((aw, ah), (ah, aw)):
                    ew = (mm_w / 25.4) * dpi * esc
                    eh = (mm_h / 25.4) * dpi * esc
                    if ew <= 0 or eh <= 0:
                        continue
                    err = abs(ew - w_px) / ew + abs(eh - h_px) / eh
                    if err > 0.06:
                        continue
                    if mejor is None or err < mejor[0]:
                        # Conservar orientación del tipo catalogado (aw×ah), no la rotada.
                        mejor = (err, nombre_t, aw, ah)
    if not mejor:
        return None
    _, nombre_t, aw, ah = mejor
    return {"tipo_etiqueta": nombre_t, "ancho_mm": aw, "alto_mm": ah}


def _lookup_meta_png_index(rel: str, ruta_abs: Path, index: list[dict]) -> dict:
    """Busca metadatos de formato en el índice PNG (por ruta o basename)."""
    rel_n = rel.replace("\\", "/")
    base_n = Path(rel_n).name
    ruta_real = str(ruta_abs.resolve()) if ruta_abs.exists() else ""
    for it in index:
        ruta_it = str(Path(it.get("ruta_completa") or "").resolve()) if it.get("ruta_completa") else ""
        if ruta_real and ruta_it and ruta_it == ruta_real:
            return it
        nombre_it = (it.get("nombre") or "").replace("\\", "/")
        if nombre_it == rel_n or nombre_it == base_n or Path(nombre_it).name == base_n:
            return it
        ruta_rel = (it.get("ruta") or "").replace("\\", "/")
        if ruta_rel.endswith("/" + rel_n) or ruta_rel.endswith("/" + base_n) or ruta_rel == rel_n:
            return it
    return {}


def enriquecer_recurso_png(
    rel: str,
    *,
    index: list[dict] | None = None,
    tipos: list[tuple[str, float, float]] | None = None,
) -> dict[str, Any]:
    """Devuelve {nombre, tipo_etiqueta, ancho_mm, alto_mm, dpi} para un PNG relativo."""
    base = _carpeta_recursos_png()
    rel_n = (rel or "").replace("\\", "/").lstrip("/")
    ruta = base / rel_n
    idx = index if index is not None else _load_png_index_entries()
    tipos_l = tipos if tipos is not None else _tipos_etiqueta_mm()
    entry = _lookup_meta_png_index(rel_n, ruta, idx)

    tipo = (entry.get("tipo_etiqueta") or "").strip() or None
    try:
        ancho = float(entry["ancho_mm"]) if entry.get("ancho_mm") not in (None, "") else None
        alto = float(entry["alto_mm"]) if entry.get("alto_mm") not in (None, "") else None
    except (TypeError, ValueError):
        ancho, alto = None, None
    try:
        dpi = float(entry["dpi"]) if entry.get("dpi") not in (None, "") else None
    except (TypeError, ValueError):
        dpi = None

    if not (tipo and ancho and alto):
        inferido = _inferir_formato_por_nombre(rel_n, tipos_l)
        if not inferido and ruta.is_file():
            inferido = _inferir_formato_por_pixeles(ruta, tipos_l)
        if inferido:
            tipo = tipo or inferido.get("tipo_etiqueta")
            ancho = ancho or inferido.get("ancho_mm")
            alto = alto or inferido.get("alto_mm")

    out: dict[str, Any] = {"nombre": rel_n}
    if tipo:
        out["tipo_etiqueta"] = tipo
    if ancho and alto:
        out["ancho_mm"] = round(float(ancho), 2)
        out["alto_mm"] = round(float(alto), 2)
    if dpi:
        out["dpi"] = round(float(dpi), 2)
    return out


def listar_recursos_png_sueltos(
    q: str = "",
    *,
    carpeta: str | None = _CARPETA_PNG_IMPRIMIR,
) -> list[dict[str, Any]]:
    """PNG/JPG de la biblioteca con formato asociado (mm / tipo).

    Por defecto solo la subcarpeta ETIQUETAS STUDIO (impresión).
    Pasar carpeta=None para listar todo el árbol (galería / Studio).
    """
    base = _carpeta_recursos_png()
    pref = (carpeta or "").strip().strip("/\\")
    raiz = base / pref if pref else base
    if pref and not raiz.is_dir():
        return []
    nombres = sorted(
        p.relative_to(base).as_posix()
        for p in raiz.rglob("*")
        if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg")
    )
    ql = (q or "").strip().lower()
    if ql:
        nombres = [n for n in nombres if ql in n.lower()]

    index = _load_png_index_entries()
    tipos = _tipos_etiqueta_mm()
    return [enriquecer_recurso_png(n, index=index, tipos=tipos) for n in nombres]


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


# Título en arco (p. ej. MANTECA KARITÉ) no puede llegar al filo: ~3,5 mm
# simétricos. No sumar extra arriba: eso mete tinta en el gap y la Epson
# salta etiquetas (avanza 2 en blanco e imprime 1).
MARGEN_SEGURO_CIRCULAR_MM = 3.5
# Troqueles: Circular 50 (50 mm), CIRCLE 2.12" (53.9 mm), Circular 55, Circular 70.
# CIRCLE 2.12" es el diámetro del rollo; no recortarlo a 50 mm.
_TROQUELES_CIRCULARES_MM = (50.0, 55.0, 70.0)
_CIRCLE_212_MM = 53.9
# Personalizado ~53 mm (sin nombre CIRCLE) ≈ 50 mm de troquel + gap.
_PITCH_CIRCULAR_50_MAX_MM = 53.5


def es_tipo_etiqueta_circular(
    tipo: str | None,
    ancho_mm: float | int | None = None,
    alto_mm: float | int | None = None,
) -> bool:
    """Troquel redondo: Circular / Circular 50 / Circle 50 / Circular 70, o cuadrado 50–56 mm."""
    t = (tipo or "").strip().lower()
    if "circular" in t or "circle" in t:
        return True
    try:
        w = float(ancho_mm or 0)
        h = float(alto_mm or 0)
    except (TypeError, ValueError):
        return False
    if w <= 0 or h <= 0 or abs(w - h) > 1.0:
        return False
    return 48.0 <= w <= 57.0


def mm_troquel_circular(
    tipo: str | None,
    ancho_mm: float | int | None = None,
    alto_mm: float | int | None = None,
) -> tuple[float, float] | None:
    """Diámetro físico del rollo (50 / 53.9 CIRCLE 2.12\" / 55 / 70). None si no es circular."""
    if not es_tipo_etiqueta_circular(tipo, ancho_mm, alto_mm):
        return None
    t = (tipo or "").strip().lower()
    try:
        d = (float(ancho_mm or 0) + float(alto_mm or 0)) / 2.0
    except (TypeError, ValueError):
        d = 0.0
    if "70" in t:
        return 70.0, 70.0
    if "50" in t:
        return 50.0, 50.0
    # CIRCLE / circle = rollo 2.12 in (53.9 mm). No es Circular 50 ni Circular 55.
    if t == "circle":
        lado = round(d, 1) if 52.0 <= d <= 55.0 else _CIRCLE_212_MM
        return lado, lado
    if t == "circular":
        if d > 0:
            if d <= 52.5:
                return 50.0, 50.0
            if d <= 62.5:
                return 55.0, 55.0
            return 70.0, 70.0
        return 55.0, 55.0
    if d > 0:
        if d <= _PITCH_CIRCULAR_50_MAX_MM:
            return 50.0, 50.0
        if d <= 62.5:
            return 55.0, 55.0
        return 70.0, 70.0
    return 50.0, 50.0


def dims_pagina_impresion_mm(
    tipo: str | None,
    ancho_mm: float | int | None,
    alto_mm: float | int | None,
) -> tuple[float, float] | None:
    """mm a mandar a CUPS/PDF: circular se ajusta al troquel; el resto se respeta."""
    snap = mm_troquel_circular(tipo, ancho_mm, alto_mm)
    if snap:
        return snap
    try:
        w = float(ancho_mm or 0)
        h = float(alto_mm or 0)
    except (TypeError, ValueError):
        return None
    if w > 0 and h > 0:
        return w, h
    return None


def page_size_cups_mm(ancho: float, alto: float) -> str:
    """Custom.50x50mm — el PPD rechaza Custom.50.0x50.0mm y cae a ~6\" (3 etiquetas)."""

    def _fmt(v: float) -> str:
        r = round(float(v), 2)
        if abs(r - round(r)) < 0.001:
            return str(int(round(r)))
        return f"{r:.2f}".rstrip("0").rstrip(".")

    return f"Custom.{_fmt(ancho)}x{_fmt(alto)}mm"


def caja_imagen_pdf_etiqueta(
    page_w: float,
    page_h: float,
    tipo: str | None = None,
    ancho_mm: float | int | None = None,
    alto_mm: float | int | None = None,
    margen_mm: float | None = None,
) -> tuple[float, float, float, float]:
    """Caja (x, y, w, h) en puntos PDF. En circular deja margen simétrico para el troquel."""
    if not es_tipo_etiqueta_circular(tipo, ancho_mm, alto_mm):
        return 0.0, 0.0, page_w, page_h
    from reportlab.lib.units import mm as rl_mm

    m = float(margen_mm if margen_mm is not None else MARGEN_SEGURO_CIRCULAR_MM) * float(rl_mm)
    w = max(1.0, page_w - 2.0 * m)
    h = max(1.0, page_h - 2.0 * m)
    return m, m, w, h
