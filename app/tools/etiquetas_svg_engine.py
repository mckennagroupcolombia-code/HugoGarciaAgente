"""
Motor de etiquetas McKenna: plantillas SVG reales + exportación Inkscape.
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

_REPO = Path(__file__).resolve().parents[2]
_SVG_DIR = _REPO / "Etiquetas Modelo SVG"
_PLANTILLAS_PATH = _REPO / "app" / "data" / "etiquetas_svg_plantillas.json"
_DOC_ETIQUETAS = Path.home() / "Documentos" / "Etiquetas McKenna"

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", _SVG_NS)
ET.register_namespace("xlink", _XLINK_NS)

# Marcos guía del área de barras (250g / 500g / 1Kg)
_RE_MARCO_BARRAS = re.compile(
    r"<path[^>]+d=\"[^\"]*(?:135\.95|132\.267|133\.486|142\.008|144\.47)[^\"]*\"[^>]*/>",
    re.IGNORECASE,
)
# Primer <g> con escala Inkscape (página principal de la etiqueta, no artefacto Page 2)
_RE_GRUPO_PLANTILLA = re.compile(
    r'<g\s+[^>]*transform="matrix\(1\.3333[^"]*\)"',
    re.IGNORECASE,
)


def _load_plantillas() -> dict:
    if not _PLANTILLAS_PATH.exists():
        return {}
    with open(_PLANTILLAS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def listar_plantillas_svg() -> list[dict[str, Any]]:
    out = []
    for nombre, spec in _load_plantillas().items():
        archivo = spec.get("archivo", "")
        path = _SVG_DIR / archivo if archivo else None
        out.append({
            "tipo_etiqueta": nombre,
            "archivo": archivo,
            "ancho_mm": spec.get("ancho_mm"),
            "alto_mm": spec.get("alto_mm"),
            "disponible": bool(path and path.is_file()),
        })
    return out


def _spec_para_tipo(tipo: str) -> dict | None:
    tipo = (tipo or "").strip()
    plantillas = _load_plantillas()
    if tipo in plantillas:
        return plantillas[tipo]
    # alias comunes
    aliases = {
        "500g": "500 g",
        "250g": "250 g",
        "50 g": "50g",
        "30mL": "30 mL",
        "50mL": "50 mL",
        "1Kg": "1 Kg",
        "1 kg": "1 Kg",
    }
    alt = aliases.get(tipo)
    if alt and alt in plantillas:
        return plantillas[alt]
    return None


def _valor_campo(datos: dict, campo: str) -> str:
    nombre = (datos.get("nombre_producto") or "").strip()
    neto = f"{datos.get('contenido_neto', '')} {datos.get('unidad', '')}".strip()
    cas = (datos.get("cas") or "").strip()
    conc = (datos.get("concentracion") or "99 %").strip()
    formula = (datos.get("formula_molecular") or "").strip()
    distribuidor = (datos.get("distribuidor") or "MCKENNA GROUP S.A.S").strip()
    nit = (datos.get("nit") or "901316016-3").strip()
    ciudad = (datos.get("ciudad") or "BOGOTÁ – COLOMBIA").strip()

    if campo == "titulo":
        return nombre.upper()
    if campo == "subtitulo":
        return (datos.get("subtitulo") or "").strip()
    if campo == "peso":
        return neto
    if campo == "cas_linea":
        if not cas:
            return "# CAS: —"
        return f"# CAS: {cas}" if not cas.startswith("#") else cas
    if campo == "concentracion_formula":
        base = f"Concentración: {conc}"
        if formula:
            base += f"Fórmula molecular: {formula}"
        return base
    if campo == "concentracion":
        return f"Concentración: {conc}"
    if campo == "formula":
        return f"Fórmula molecular: {formula}" if formula else ""
    if campo == "formula_resto":
        if not formula:
            return ""
        # 250g.svg parte la fórmula: primer nodo termina en «… molecular: C» y el segundo continúa.
        if formula.startswith("C") and len(formula) > 1:
            return formula[1:]
        return formula
    if campo == "cuchara":
        if not datos.get("incluye_cuchara"):
            return ""
        return (datos.get("texto_cuchara") or "Incluye cuchara medidora.").strip()
    if campo == "descripcion_inicio":
        return (datos.get("descripcion_etiqueta") or datos.get("aplicaciones") or "").strip()
    if campo == "desarrollado":
        return f"Desarrollado por: {distribuidor}NIT. {nit}{ciudad.replace(' — ', ' – ').replace(' - ', ' – ')}"
    return ""


def _reemplazos_desde_datos(datos: dict, spec: dict) -> list[tuple[str, str]]:
    muestras: dict = spec.get("muestras") or {}
    pares: list[tuple[str, str]] = []
    for campo, muestra in muestras.items():
        if campo in ("titulo", "subtitulo"):
            continue  # tipografía fluida (_fragmento_titulo / _fragmento_subtitulo)
        if not muestra:
            continue
        valor = _valor_campo(datos, campo)
        if campo == "formula_resto" and not valor:
            pares.append((muestra, ""))
            continue
        if campo == "cuchara" and not valor:
            pares.append((muestra, ""))
            continue
        if not valor:
            continue
        pares.append((muestra, valor))
    # pie legal opcional en bloque desarrollado (texto continuo en SVG)
    dev_muestra = "Desarrollado por: MCKENNA GROUP S.A.S"
    dev_nuevo = _valor_campo(datos, "desarrollado")
    if dev_nuevo and dev_muestra not in [m for m, _ in pares]:
        pares.append((dev_muestra, dev_nuevo[:115]))
    return pares


def _aplicar_reemplazos_texto(svg: str, pares: list[tuple[str, str]]) -> str:
    out = svg
    # Ordenar por longitud descendente para no romper subcadenas
    for muestra, valor in sorted(pares, key=lambda x: -len(x[0])):
        if muestra and muestra in out:
            out = out.replace(muestra, _escape_xml_text(valor))
    return out


def _ajustar_viewbox_export(svg: str, spec: dict) -> str:
    area = spec.get("export_area")
    if not area or len(area) != 4:
        return svg
    x0, y0, x1, y1 = (float(v) for v in area)
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return svg
    out = re.sub(
        r'viewBox="[^"]*"',
        f'viewBox="{x0:.4f} {y0:.4f} {w:.4f} {h:.4f}"',
        svg,
        count=1,
    )
    out = re.sub(r'width="[^"]*"', f'width="{w:.4f}"', out, count=1)
    out = re.sub(r'height="[^"]*"', f'height="{h:.4f}"', out, count=1)
    return out


def _marcador_grupo_inyeccion(spec: dict) -> str | None:
    titulo_cfg: dict = spec.get("titulo") or {}
    muestra = titulo_cfg.get("muestra") or (spec.get("muestras") or {}).get("titulo")
    m = (muestra or "").strip()
    return m or None


def _eliminar_bloque_texto_con_muestra(svg: str, muestra: str) -> str:
    if not muestra or muestra not in svg:
        return svg
    idx = svg.find(muestra)
    start = svg.rfind("<text", 0, idx)
    if start < 0:
        return svg
    end = svg.find("</text>", idx)
    if end < 0:
        return svg
    return svg[:start] + svg[end + len("</text>") :]


def _partir_lineas_texto(
    texto: str,
    max_chars: int,
    max_lineas: int,
    *,
    mayusculas: bool = False,
) -> list[str]:
    bruto = (texto or "").strip()
    if not bruto:
        return []
    if mayusculas:
        bruto = bruto.upper()
    palabras = bruto.split()
    if not palabras:
        return []
    lineas: list[str] = []
    cur = ""
    for w in palabras:
        test = f"{cur} {w}".strip()
        if len(test) <= max_chars:
            cur = test
        else:
            if cur:
                lineas.append(cur)
            cur = w
            if len(lineas) >= max_lineas:
                break
    if cur and len(lineas) < max_lineas:
        lineas.append(cur)
    objetivo = bruto
    if len(lineas) == max_lineas and len(objetivo) > len(" ".join(lineas)):
        ult = lineas[-1]
        if len(ult) >= max_chars - 1:
            lineas[-1] = ult[: max(1, max_chars - 1)] + "…"
    return lineas[:max_lineas]


def _ajustar_fuente_texto_fluido(texto: str, cfg: dict, *, mayusculas: bool = False) -> tuple[float, list[str]]:
    fs = float(cfg.get("font_size", 11))
    min_fs = float(cfg.get("min_font_size", 7))
    max_chars = int(cfg.get("max_width_chars", 22))
    max_lineas = int(cfg.get("max_lines", 2))
    objetivo = (texto or "").strip()
    if mayusculas:
        objetivo = objetivo.upper()
    while fs >= min_fs:
        lineas = _partir_lineas_texto(objetivo, max_chars, max_lineas, mayusculas=mayusculas)
        if lineas and " ".join(lineas) == objetivo:
            return fs, lineas
        fs -= 0.5
    return min_fs, _partir_lineas_texto(objetivo, max_chars, max_lineas, mayusculas=mayusculas)


def _ajustar_fuente_titulo(texto: str, cfg: dict) -> tuple[float, list[str]]:
    return _ajustar_fuente_texto_fluido(texto, cfg, mayusculas=True)


def _layout_titulo(spec: dict, datos: dict) -> tuple[float, list[str], dict] | None:
    cfg: dict = spec.get("titulo") or {}
    titulo = _valor_campo(datos, "titulo")
    if not titulo or not cfg:
        return None
    fs, lineas = _ajustar_fuente_titulo(titulo, cfg)
    if not lineas:
        return None
    return fs, lineas, cfg


def _fragmento_texto_fluido(
    cfg: dict,
    lineas: list[str],
    fs: float,
    *,
    elem_id: str,
    y_extra: float = 0.0,
) -> str | None:
    if not lineas or not cfg:
        return None
    x = float(cfg.get("x", 6.5))
    y = float(cfg.get("y", 172)) + y_extra
    lh = float(cfg.get("line_height", fs * 1.05))
    fill = cfg.get("fill", "#009fe3")
    fw = cfg.get("font_weight", "bold")
    ff = cfg.get("font_family", "Montserrat")
    if len(lineas) > 1:
        y += lh * (len(lineas) - 1) * 0.85
    tspans = [f'<tspan x="0" y="0">{_escape_xml_text(lineas[0])}</tspan>']
    for ln in lineas[1:]:
        tspans.append(f'<tspan x="0" dy="{lh:.2f}">{_escape_xml_text(ln)}</tspan>')
    return (
        f'<g id="{elem_id}">'
        f'<text transform="matrix(1 0 0 -1 {x:.3f} {y:.3f})" fill="{fill}" '
        f'font-family="{ff}" font-size="{fs:.2f}px" font-weight="{fw}">'
        f'{"".join(tspans)}</text></g>'
    )


def _fragmento_titulo(spec: dict, datos: dict, layout: tuple[float, list[str], dict] | None = None) -> str | None:
    pack = layout or _layout_titulo(spec, datos)
    if not pack:
        return None
    fs, lineas, cfg = pack
    return _fragmento_texto_fluido(cfg, lineas, fs, elem_id="mckenna-titulo")


def _fragmento_subtitulo(
    spec: dict,
    datos: dict,
    layout_titulo: tuple[float, list[str], dict] | None = None,
) -> str | None:
    cfg: dict = spec.get("subtitulo") or {}
    texto = _valor_campo(datos, "subtitulo")
    if not texto or not cfg:
        return None
    fs, lineas = _ajustar_fuente_texto_fluido(texto, cfg, mayusculas=False)
    if not lineas:
        return None
    y_extra = 0.0
    if layout_titulo:
        _, tit_lineas, tit_cfg = layout_titulo
        if len(tit_lineas) > 1:
            tit_lh = float(tit_cfg.get("line_height", fs * 1.05))
            y_extra = -(len(tit_lineas) - 1) * tit_lh * 0.85
    return _fragmento_texto_fluido(cfg, lineas, fs, elem_id="mckenna-subtitulo", y_extra=y_extra)


_LOTE_PREFIJO = "LOT."
_EXP_PREFIJO = "EXP."
_PLACEHOLDER_LOTE = "___________"


def _con_prefijo_lote(val: str) -> str:
    v = (val or "").strip()
    if not v:
        return _LOTE_PREFIJO + _PLACEHOLDER_LOTE
    vu = v.upper()
    if vu.startswith(_LOTE_PREFIJO):
        return v
    if vu.startswith("LOT"):
        return _LOTE_PREFIJO + v[3:].lstrip(". ")
    return f"{_LOTE_PREFIJO} {v}"


def _con_prefijo_exp(val: str) -> str:
    v = (val or "").strip()
    if not v:
        return _EXP_PREFIJO + _PLACEHOLDER_LOTE
    vu = v.upper()
    if vu.startswith(_EXP_PREFIJO):
        return v
    if vu.startswith("EXP"):
        return _EXP_PREFIJO + v[3:].lstrip(". ")
    return f"{_EXP_PREFIJO} {v}"


def _lineas_lote_vencimiento(datos: dict) -> list[str]:
    if datos.get("mostrar_lote_vencimiento") is False:
        return []
    usar_placeholder = datos.get("placeholders_lote_vencimiento", True)
    lote_raw = (datos.get("lote") or "").strip()
    exp_raw = (datos.get("vencimiento") or "").strip()
    lineas: list[str] = []
    if lote_raw or usar_placeholder:
        lineas.append(_con_prefijo_lote(lote_raw if lote_raw else ""))
    if exp_raw or usar_placeholder:
        lineas.append(_con_prefijo_exp(exp_raw if exp_raw else ""))
    return lineas


def _codigo_barras_valor(datos: dict) -> str:
    raw = (datos.get("codigo_barras") or datos.get("sku") or "").strip()
    limpio = re.sub(r"[^\x20-\x7E]", "", raw)
    return limpio[:48]


def _texto_legal_bloque(datos: dict) -> str:
    if not datos.get("mostrar_bloque_legal", True):
        return ""
    partes = []
    if datos.get("mostrar_res_2674", True):
        partes.extend([
            "REENVASE DE MATERIA PRIMA ALIMENTARIA",
            "Res. 2674/2013 Art. 37 num. 3",
            "NO ES MEDICAMENTO",
            "NO ES SUPLEMENTO DIETARIO TERMINADO",
        ])
    else:
        partes.extend(["NO ES MEDICAMENTO", "NO ES SUPLEMENTO TERMINADO"])
    notas = (datos.get("notas_tecnicas") or "").strip()
    if notas:
        partes.append(notas)
    return " · ".join(partes)


def _barcode_png_base64(valor: str) -> str:
    from reportlab.graphics import renderSVG
    from reportlab.graphics.barcode import createBarcodeDrawing

    d = createBarcodeDrawing(
        "Code128",
        value=valor,
        barHeight=12,
        barWidth=0.28,
        humanReadable=1,
    )
    tmp = tempfile.mkdtemp(prefix="mckg_bc_")
    try:
        svg_path = os.path.join(tmp, "bc.svg")
        png_path = os.path.join(tmp, "bc.png")
        renderSVG.drawToFile(d, svg_path)
        _inkscape_export(svg_path, png_path, "png", width_px=320)
        return base64.b64encode(open(png_path, "rb").read()).decode("ascii")
    finally:
        try:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)
        except Exception:
            pass


_RE_TAG_G_OPEN = re.compile(r"<g\b", re.IGNORECASE)


def _pos_cierre_desde_apertura(svg: str, apertura: int) -> int:
    depth = 1
    i = svg.find(">", apertura) + 1
    while i < len(svg) and depth > 0:
        g_open_m = _RE_TAG_G_OPEN.search(svg, i)
        g_close = svg.find("</g>", i)
        if g_close == -1:
            break
        if g_open_m and g_open_m.start() < g_close:
            depth += 1
            i = g_open_m.end()
            continue
        depth -= 1
        if depth == 0:
            return g_close
        i = g_close + 4
    return svg.rfind("</svg>")


def _pos_cierre_grupo_plantilla(svg: str, marcador: str | None = None) -> int:
    """Cierra el <g> matrix(1.3333…) que contiene el marcador (p. ej. título muestra)."""
    if marcador and marcador in svg:
        ultima_apertura = -1
        for m in _RE_GRUPO_PLANTILLA.finditer(svg):
            if m.start() < svg.find(marcador):
                ultima_apertura = m.start()
            else:
                break
        if ultima_apertura >= 0:
            return _pos_cierre_desde_apertura(svg, ultima_apertura)
    m = _RE_GRUPO_PLANTILLA.search(svg)
    if not m:
        return svg.rfind("</svg>")
    return _pos_cierre_desde_apertura(svg, m.start())


def _inyectar_en_grupo_plantilla(svg: str, fragmentos: list[str], marcador: str | None = None) -> str:
    if not fragmentos:
        return svg
    idx = _pos_cierre_grupo_plantilla(svg, marcador=marcador)
    bloque = "\n  " + "\n  ".join(fragmentos) + "\n  "
    return svg[:idx] + bloque + svg[idx:]


def _fragmento_barras(spec: dict, datos: dict) -> str | None:
    barras = spec.get("barras")
    if not barras:
        return None
    valor = _codigo_barras_valor(datos)
    if not valor:
        return None
    try:
        b64 = _barcode_png_base64(valor)
    except Exception:
        return None
    x = float(barras.get("x", 0))
    y = float(barras.get("y", 0))
    w = float(barras.get("w", 69))
    h = float(barras.get("h", 17))
    img = (
        f'<image id="mckenna-codigo-barras" x="{x:.3f}" y="{y:.3f}" '
        f'width="{w:.3f}" height="{h:.3f}" '
        f'preserveAspectRatio="xMidYMid meet" '
        f'xlink:href="data:image/png;base64,{b64}"/>'
    )
    return f'<g id="mckenna-barras">{img}</g>'


def _wrap_legal_lineas(texto: str, max_chars: int = 72) -> list[str]:
    palabras = texto.split()
    lineas: list[str] = []
    cur = ""
    for w in palabras:
        test = f"{cur} {w}".strip()
        if len(test) <= max_chars:
            cur = test
        else:
            if cur:
                lineas.append(cur)
            cur = w
    if cur:
        lineas.append(cur)
    return lineas[:3]


def _fragmento_legal(spec: dict, datos: dict) -> str | None:
    legal = spec.get("legal")
    texto = _texto_legal_bloque(datos)
    if not legal or not texto:
        return None
    x = float(legal.get("x", 4))
    y = float(legal.get("y", 179.5))
    w = float(legal.get("w", 205))
    h = float(legal.get("h", 7))
    fs = float(legal.get("font_size", 2.2))
    lineas = _wrap_legal_lineas(texto, max_chars=int(w / fs * 2.2))
    cx = x + w / 2
    h = max(h, fs * 1.2 * len(lineas) + 1.5)
    ty = y + fs * 0.95
    tspans = [
        f'<tspan x="0" y="0" text-anchor="middle">{_escape_xml_text(lineas[0])}</tspan>',
    ]
    for ln in lineas[1:]:
        tspans.append(
            f'<tspan x="0" dy="{fs * 1.12:.2f}" text-anchor="middle">{_escape_xml_text(ln)}</tspan>'
        )
    return (
        f'<g id="mckenna-bloque-legal">'
        f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="#1d1d1b" stroke="none"/>'
        f'<text transform="matrix(1 0 0 -1 {cx:.2f} {ty:.2f})" fill="#ffffff" '
        f'font-family="Montserrat" font-size="{fs:.2f}px" font-weight="600">'
        f'{"".join(tspans)}</text></g>'
    )


def _fragmento_lote_vencimiento(spec: dict, datos: dict) -> str | None:
    lote_cfg = spec.get("lote")
    lineas = _lineas_lote_vencimiento(datos)
    if not lote_cfg or not lineas:
        return None
    x = float(lote_cfg.get("x", 6.5))
    y = float(lote_cfg.get("y", 156))
    fs = float(lote_cfg.get("font_size", 4.2))
    lh = float(lote_cfg.get("line_height", fs * 1.25))
    tspans = [
        f'<tspan x="0" y="0">{_escape_xml_text(lineas[0])}</tspan>',
    ]
    for ln in lineas[1:]:
        tspans.append(f'<tspan x="0" dy="{lh:.2f}">{_escape_xml_text(ln)}</tspan>')
    return (
        f'<g id="mckenna-lote-vencimiento">'
        f'<text transform="matrix(1 0 0 -1 {x:.2f} {y:.2f})" fill="#1d1d1b" '
        f'font-family="Montserrat" font-size="{fs:.2f}px" font-weight="500">'
        f'{"".join(tspans)}</text></g>'
    )


def _escape_xml_text(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _ruta_plantilla(tipo: str) -> tuple[Path, dict]:
    spec = _spec_para_tipo(tipo)
    if not spec:
        raise ValueError(f"No hay plantilla SVG para formato «{tipo}»")
    archivo = (spec.get("archivo") or "").strip()
    path = _SVG_DIR / archivo
    if not path.is_file():
        raise FileNotFoundError(f"Plantilla SVG no encontrada: {path}")
    return path, spec


def renderizar_svg(datos: dict) -> tuple[str, dict]:
    if datos.get("forzar_plantilla_svg") not in (True, 1, "1", "true"):
        try:
            from app.tools.etiquetas_ai_engine import buscar_plantilla_ai, renderizar_desde_ai

            ai_path = buscar_plantilla_ai(datos)
            if ai_path:
                return renderizar_desde_ai(datos, ai_path)
        except FileNotFoundError:
            pass
        except RuntimeError:
            # Inkscape falló: intentar plantilla SVG genérica
            pass

    tipo = (datos.get("tipo_etiqueta") or "250 g").strip()
    path, spec = _ruta_plantilla(tipo)
    raw = path.read_text(encoding="utf-8")
    pares = _reemplazos_desde_datos(datos, spec)
    marcador = _marcador_grupo_inyeccion(spec)
    muestras = spec.get("muestras") or {}
    titulo_muestra = muestras.get("titulo") or ""
    subtitulo_muestra = muestras.get("subtitulo") or ""
    svg = _aplicar_reemplazos_texto(raw, pares)
    if titulo_muestra:
        svg = _eliminar_bloque_texto_con_muestra(svg, titulo_muestra)
    if subtitulo_muestra:
        svg = _eliminar_bloque_texto_con_muestra(svg, subtitulo_muestra)
    svg = _RE_MARCO_BARRAS.sub("", svg)
    layout_titulo = _layout_titulo(spec, datos)
    fragmentos: list[str] = []
    for frag in (
        _fragmento_titulo(spec, datos, layout=layout_titulo),
        _fragmento_subtitulo(spec, datos, layout_titulo=layout_titulo),
        _fragmento_lote_vencimiento(spec, datos),
        _fragmento_barras(spec, datos),
        _fragmento_legal(spec, datos),
    ):
        if frag:
            fragmentos.append(frag)
    if fragmentos:
        svg = _inyectar_en_grupo_plantilla(
            svg,
            [f'<g id="mckenna-overlays">{"".join(fragmentos)}</g>'],
            marcador=marcador,
        )
    svg = _ajustar_viewbox_export(svg, spec)
    lineas_lv = _lineas_lote_vencimiento(datos)
    meta = {
        "fuente": "svg",
        "tipo_etiqueta": tipo,
        "archivo": spec.get("archivo"),
        "ancho_mm": spec.get("ancho_mm") or datos.get("ancho_mm"),
        "alto_mm": spec.get("alto_mm") or datos.get("alto_mm"),
        "reemplazos": len(pares),
        "codigo_barras": _codigo_barras_valor(datos) or None,
        "bloque_legal": bool(_texto_legal_bloque(datos)),
        "lote_vencimiento": lineas_lv if lineas_lv else None,
        "export_area": spec.get("export_area"),
    }
    return svg, meta


def _inkscape_export(
    svg_path: str,
    out_path: str,
    export_type: str,
    width_px: int | None = None,
    export_area: list[float] | None = None,
) -> None:
    cmd = [
        "inkscape",
        svg_path,
        f"--export-type={export_type}",
        f"--export-filename={out_path}",
    ]
    if width_px:
        cmd.extend(["-w", str(width_px)])
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "inkscape falló").strip()
        raise RuntimeError(err[:500])
    if not os.path.isfile(out_path):
        raise RuntimeError("Inkscape no generó el archivo de salida")


def exportar_png_temporal(datos: dict, width_px: int = 720) -> tuple[str, dict]:
    svg, meta = renderizar_svg(datos)
    tmp = tempfile.mkdtemp(prefix="mckg_etq_")
    svg_path = os.path.join(tmp, "etiqueta.svg")
    png_path = os.path.join(tmp, "etiqueta.png")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg)
    _inkscape_export(svg_path, png_path, "png", width_px=width_px, export_area=meta.get("export_area"))
    return png_path, meta


def _nombre_pdf_seguro(nombre: str) -> str:
    base = re.sub(r"[^\w.\- áéíóúÁÉÍÓÚñÑ]", "_", (nombre or "etiqueta").strip(), flags=re.UNICODE)
    return (base or "etiqueta")[:120]


def exportar_pdf_desde_svg(datos: dict) -> dict[str, Any]:
    """Genera PDF desde plantilla SVG real vía Inkscape."""
    sku = (datos.get("sku") or "").strip()
    nombre = (datos.get("nombre_producto") or sku or "ETIQUETA").strip()
    if not nombre:
        raise ValueError("Nombre de producto obligatorio para exportar")

    svg, meta = renderizar_svg(datos)
    _DOC_ETIQUETAS.mkdir(parents=True, exist_ok=True)
    fname = f"{_nombre_pdf_seguro(nombre)}.pdf"
    dest = _DOC_ETIQUETAS / fname
    if dest.exists():
        stem = dest.stem
        n = 2
        while dest.exists():
            dest = _DOC_ETIQUETAS / f"{stem} ({n}).pdf"
            n += 1

    tmp = tempfile.mkdtemp(prefix="mckg_etq_pdf_")
    try:
        svg_path = os.path.join(tmp, "etiqueta.svg")
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        _inkscape_export(svg_path, str(dest), "pdf", export_area=meta.get("export_area"))
    finally:
        try:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)
        except Exception:
            pass

    rel = os.path.relpath(str(dest), str(Path.home() / "Documentos"))
    return {
        "ok": True,
        "pdf_ruta": rel,
        "pdf_nombre": dest.name,
        "pdf_completo": str(dest),
        "plantilla": meta.get("archivo"),
        "mensaje": f"PDF guardado en Documentos/Etiquetas McKenna/{dest.name}",
    }
