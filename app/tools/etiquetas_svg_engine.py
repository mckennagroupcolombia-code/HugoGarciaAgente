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


def sincronizar_plantillas_svg_titulo_desde_disco() -> dict[str, Any]:
    """Relaciona archivos titulados «plantilla» en disco → etiquetas_svg_plantillas.json."""
    from app.tools.etiquetas_ai_engine import (
        _archivos_titulo_plantilla,
        _dims_desde_stem_plantilla,
        _es_titulo_plantilla,
    )

    plantillas = _load_plantillas()
    agregados = 0
    for path in _archivos_titulo_plantilla():
        if path.suffix.lower() != ".svg" or not _es_titulo_plantilla(path.name):
            continue
        w_mm, h_mm = _dims_desde_stem_plantilla(path.stem)
        if w_mm and h_mm:
            key = f"{int(w_mm)} x {int(h_mm)} mm"
        else:
            key = path.stem.strip()
        spec = {
            "archivo": path.name,
            "ancho_mm": w_mm or 76,
            "alto_mm": h_mm or 66,
        }
        if plantillas.get(key) != spec:
            plantillas[key] = spec
            agregados += 1
    if agregados:
        _PLANTILLAS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_PLANTILLAS_PATH, "w", encoding="utf-8") as f:
            json.dump(plantillas, f, ensure_ascii=False, indent=2)
    return {"plantillas": plantillas, "agregados": agregados, "total": len(plantillas)}


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
        if datos.get("mostrar_cas") is False:
            return ""
        if not cas:
            return "# CAS: —"
        return f"# CAS: {cas}" if not cas.startswith("#") else cas
    if campo == "concentracion_formula":
        partes: list[str] = []
        if datos.get("mostrar_concentracion", True) is not False:
            partes.append(f"Concentración: {conc}")
        if formula and datos.get("mostrar_formula_molecular", True) is not False:
            partes.append(f"Fórmula molecular: {formula}")
        return "".join(partes)
    if campo == "concentracion":
        if datos.get("mostrar_concentracion", True) is False:
            return ""
        return f"Concentración: {conc}"
    if campo == "formula":
        if datos.get("mostrar_formula_molecular", True) is False:
            return ""
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


def _normalizar_fuentes_svg_web(svg: str) -> str:
    """Mapea familias de plantilla .ai/Inkscape a Montserrat (panel y preview web)."""
    patrones = (
        (r"font-family:\s*['\"]?Montserrat\s+Medium['\"]?", "font-family:Montserrat"),
        (r"font-family:\s*['\"]?Montserrat\s+SemiBold['\"]?", "font-family:Montserrat"),
        (r"font-family:\s*['\"]?Montserrat\s+Bold['\"]?", "font-family:Montserrat"),
        (r"font-family:\s*['\"]?Geomanist[^;'\"]*['\"]?", "font-family:Montserrat"),
        (r'font-family="Geomanist[^"]*"', 'font-family="Montserrat"'),
        (r"font-family='Geomanist[^']*'", "font-family='Montserrat'"),
        (r"font-family:\s*['\"]?Arial[^;'\"]*['\"]?", "font-family:Montserrat"),
        (r"font-family:\s*['\"]?Helvetica[^;'\"]*['\"]?", "font-family:Montserrat"),
    )
    for patron, reemplazo in patrones:
        svg = re.sub(patron, reemplazo, svg, flags=re.I)
    return svg


def _aplicar_reemplazos_texto(svg: str, pares: list[tuple[str, str]], *, fiel: bool = False) -> str:
    out = svg
    for muestra, valor in sorted(pares, key=lambda x: -len(x[0])):
        if muestra:
            out, _ = _reemplazar_texto_en_svg(out, muestra, valor, fiel=fiel)
    return out


_RE_TSPAN_INNER = re.compile(r"<tspan(\s[^>]*)>([^<]*)</tspan>", re.DOTALL)


def _normalizar_texto_svg(texto: str) -> str:
    return re.sub(r"\s+", " ", (texto or "").strip())


_RE_TITULO_SECCION_ETIQUETA = re.compile(
    r"^\s{0,4}(?:informaci[oó]n t[eé]cnica|nota legal|est[aá]ndar de calidad|cumplimiento normativo|[A-ZÁÉÍÓÚÑ][^:]{2,58}:)\s*$",
    re.I,
)


def _normalizar_linea_ortografia_puntuacion(linea: str) -> str:
    """Limpia espacios y puntuación de una línea de descripción B1."""
    s = re.sub(r"[ \t]+", " ", (linea or "").strip())
    if not s:
        return s
    if _RE_TITULO_SECCION_ETIQUETA.match(s) or (s.endswith(":") and len(s) < 72):
        return s
    s = re.sub(r"\s+([,;:.!?…])(?=\s|$|[^\d])", r"\1", s)
    s = re.sub(r"([,;:])(?=[^\s)\]0-9])", r"\1 ", s)
    s = re.sub(r"([.!?])(?=[A-ZÁÉÍÓÚÑa-záéíóúñ])", r"\1 ", s)
    s = re.sub(r"\s*·\s*", " · ", s)
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\s+\)", ")", s)
    s = re.sub(r"(\d)\s*%", r"\1 %", s)
    s = re.sub(r" {2,}", " ", s)
    return s.strip()


def _normalizar_ortografia_puntuacion_etiqueta(texto: str) -> str:
    """Normaliza ortografía tipográfica del bloque B1 (espacios, puntuación, párrafos)."""
    raw = (texto or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not raw:
        return ""
    bloques = re.split(r"\n\s*\n", raw)
    out_bloques: list[str] = []
    for bloque in bloques:
        filas = [_normalizar_linea_ortografia_puntuacion(ln) for ln in bloque.split("\n")]
        filas = [ln for ln in filas if ln is not None]
        while filas and not filas[0].strip():
            filas.pop(0)
        while filas and not filas[-1].strip():
            filas.pop()
        if filas:
            out_bloques.append("\n".join(filas))
    return "\n\n".join(out_bloques)


def _es_linea_titulo_seccion_descripcion(linea: str) -> bool:
    s = (linea or "").strip()
    if not s:
        return False
    if s.startswith("•"):
        return True
    if _RE_TITULO_SECCION_ETIQUETA.match(s):
        return True
    if s.endswith(":") and len(s) < 72:
        return True
    return False


def _debe_justificar_linea_descripcion(linea: str) -> bool:
    s = (linea or "").strip()
    if not s or _es_linea_titulo_seccion_descripcion(s):
        return False
    if s.endswith("…") or len(s.split()) < 2:
        return False
    return True


def _ancho_palabra_aprox(palabra: str, fs: float) -> float:
    """Ancho visual conservador (Montserrat ~0.56 em/carácter a 5px)."""
    return len(palabra) * fs * 0.56


def _tspans_linea_descripcion(
    linea: str,
    *,
    max_width: float,
    fs: float,
    lh: float,
    es_primera_del_bloque: bool,
    justificar: bool,
) -> list[str]:
    contenido = (linea or "").strip()
    if not contenido:
        dy = lh * 0.45
        if es_primera_del_bloque:
            return [f'<tspan x="0" y="0"> </tspan>']
        return [f'<tspan x="0" dy="{dy:.4f}"> </tspan>']

    palabras = contenido.split()
    if not justificar or len(palabras) < 2 or max_width <= 0:
        esc = _escape_xml_text(contenido)
        if es_primera_del_bloque:
            return [f'<tspan x="0" y="0">{esc}</tspan>']
        return [f'<tspan x="0" dy="{lh:.4f}">{esc}</tspan>']

    anchos = [_ancho_palabra_aprox(w, fs) for w in palabras]
    espacio_min = fs * 0.18
    huecos = len(palabras) - 1
    suma = sum(anchos)
    if suma >= max_width:
        gap = espacio_min
    else:
        gap = (max_width - suma) / huecos

    out: list[str] = []
    x = 0.0
    for i, (palabra, ancho) in enumerate(zip(palabras, anchos)):
        esc = _escape_xml_text(palabra)
        if i == 0:
            if es_primera_del_bloque:
                out.append(f'<tspan x="0" y="0">{esc}</tspan>')
            else:
                out.append(f'<tspan x="0" dy="{lh:.4f}">{esc}</tspan>')
        else:
            out.append(f'<tspan x="{x:.4f}">{esc}</tspan>')
        x += ancho + gap
    return out


_MARGEN_DER_B1_ANTES_SEP = 2.5


def _unificar_cuerpo_parrafo_b1(texto_parrafo: str) -> str:
    """Un párrafo B1: une saltos simples en un solo flujo de texto."""
    filas = [ln.strip() for ln in (texto_parrafo or "").split("\n") if ln.strip()]
    return re.sub(r"\s+", " ", " ".join(filas)).strip()


def _tiene_x_por_caracter(attrs: str) -> bool:
    return bool(re.search(r'\sx="[^"]*\s[^"]+"', attrs))


def _limpiar_posicion_tspan(attrs: str) -> str:
    """Quita posicionamiento por carácter de Illustrator que rompe al cambiar el texto."""
    attrs = re.sub(r'\s+x="[^"]*"', "", attrs)
    attrs = re.sub(r'\s+dx="[^"]*"', "", attrs)
    return attrs


def _ancho_visual_tspan(attrs: str) -> float | None:
    """Ancho visual aproximado del tspan según coords x de Illustrator."""
    m = re.search(r'\sx="([^"]*)"', attrs)
    if not m:
        return None
    vals: list[float] = []
    for part in m.group(1).split():
        try:
            vals.append(float(part))
        except ValueError:
            continue
    if len(vals) >= 2:
        return vals[-1] + 4.0
    return None


def _attrs_tspan_ajustado(attrs: str, *, conservar_ancho: bool) -> str:
    ancho = _ancho_visual_tspan(attrs) if conservar_ancho else None
    attrs_out = _limpiar_posicion_tspan(attrs)
    if ancho and ancho > 8:
        attrs_out += f' textLength="{ancho:.2f}" lengthAdjust="spacingAndGlyphs"'
        if 'x="' not in attrs_out:
            attrs_out += ' x="0"'
    return attrs_out


def _reemplazar_texto_en_svg(
    svg: str, muestra: str, valor: str, *, fiel: bool = False, conservar_ancho: bool = False
) -> tuple[str, int]:
    """Reemplaza texto en <tspan>. Modo fiel: conserva kerning Illustrator (x por carácter)."""
    if not muestra:
        return svg, 0
    esc = _escape_xml_text(valor)
    muestra_norm = _normalizar_texto_svg(muestra)
    count = 0

    def _repl(m: re.Match[str]) -> str:
        nonlocal count
        attrs, inner = m.group(1), m.group(2)
        if _normalizar_texto_svg(inner) != muestra_norm:
            return m.group(0)
        if fiel:
            if _normalizar_texto_svg(inner) == _normalizar_texto_svg(valor):
                return m.group(0)
            if _tiene_x_por_caracter(attrs) and len(valor) != len(inner):
                return m.group(0)
            count += 1
            return f"<tspan{attrs}>{esc}</tspan>"
        count += 1
        return f"<tspan{_attrs_tspan_ajustado(attrs, conservar_ancho=conservar_ancho)}>{esc}</tspan>"

    out = _RE_TSPAN_INNER.sub(_repl, svg)
    if count == 0 and muestra in svg and not fiel:
        out = svg.replace(muestra, esc, 1)
        count = 1
    return out, count


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
    raw = (datos.get("codigo_barras") or "").strip()
    sku = (datos.get("sku") or "").strip()
    if not raw or raw.upper() == sku.upper():
        return ""
    digitos = re.sub(r"\D", "", raw)
    if len(digitos) >= 8:
        return digitos[:48]
    return ""


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


def _trim_image_rgba(img):
    from PIL import Image

    if img.mode != "RGBA":
        img = img.convert("RGBA")
    bbox = img.getbbox()
    if not bbox:
        return img
    return img.crop(bbox)


def _bbox_tinta_rgb(img) -> tuple[int, int, int, int] | None:
    """Bbox de píxeles no blancos (barras + dígitos del PNG embebido en el .ai)."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    y0, y1, x0, x1 = h, 0, w, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r < 245 or g < 245 or b < 245:
                found = True
                y0 = min(y0, y)
                y1 = max(y1, y)
                x0 = min(x0, x)
                x1 = max(x1, x)
    if not found:
        return None
    return x0, y0, x1, y1


def _barcode_png_como_plantilla(plantilla_b64: str, valor: str) -> str:
    """Genera barcode en el mismo slot (tamaño y bbox) que el PNG del .ai."""
    import base64
    import io
    import os
    import shutil
    import tempfile

    from PIL import Image, ImageDraw, ImageFont
    from reportlab.graphics import renderSVG
    from reportlab.graphics.barcode import createBarcodeDrawing

    orig = Image.open(io.BytesIO(base64.b64decode(plantilla_b64)))
    w, h = orig.size
    bbox = _bbox_tinta_rgb(orig)
    if not bbox:
        return _barcode_png_base64(valor, canvas=(w, h))

    x0, y0, x1, y1 = bbox
    ink_w, ink_h = x1 - x0 + 1, y1 - y0 + 1
    target_w = max(120, ink_w - 4)
    bars_h = max(14, int(ink_h * 0.52))
    digit_h = max(10, int(ink_h * 0.11))
    n_mod = max(20, len(valor) * 11 + 35)
    bar_width = min(0.42, max(0.18, target_w / (n_mod * 2.75)))

    canvas = Image.new("RGB", (w, h), (255, 255, 255))

    d = createBarcodeDrawing(
        "Code128",
        value=valor,
        barHeight=bars_h,
        barWidth=bar_width,
        humanReadable=0,
    )
    tmp = tempfile.mkdtemp(prefix="mckg_bc_tpl_")
    try:
        svg_path = os.path.join(tmp, "bc.svg")
        png_path = os.path.join(tmp, "bc.png")
        renderSVG.drawToFile(d, svg_path)
        _inkscape_export(svg_path, png_path, "png", width_px=target_w)
        bar_img = _trim_image_rgba(Image.open(png_path))
        scale = min(1.0, target_w / max(bar_img.width, 1), bars_h / max(bar_img.height, 1))
        if scale < 1.0:
            bar_img = bar_img.resize(
                (max(1, int(bar_img.width * scale)), max(1, int(bar_img.height * scale)))
            )
        paste_x = x0 + (ink_w - bar_img.width) // 2
        paste_y = y0 + max(0, (bars_h - bar_img.height) // 2)
        if bar_img.mode == "RGBA":
            canvas.paste(bar_img.convert("RGB"), (paste_x, paste_y), bar_img)
        else:
            canvas.paste(bar_img, (paste_x, paste_y))
        draw = ImageDraw.Draw(canvas)
        fs = max(8, digit_h)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", fs)
        except Exception:
            font = ImageFont.load_default()
        bb = draw.textbbox((0, 0), valor, font=font)
        tw = bb[2] - bb[0]
        ty = min(y1 - fs, y0 + bars_h + 2)
        draw.text((x0 + (ink_w - tw) // 2, ty), valor, fill=(0, 0, 0), font=font)
        out = os.path.join(tmp, "out.png")
        canvas.save(out, format="PNG")
        return base64.b64encode(open(out, "rb").read()).decode("ascii")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _barcode_png_base64(valor: str, canvas: tuple[int, int] | None = None) -> str:
    from PIL import Image, ImageDraw, ImageFont
    from reportlab.graphics import renderSVG
    from reportlab.graphics.barcode import createBarcodeDrawing

    usar_canvas = canvas is not None and canvas[0] > 0 and canvas[1] > 0
    d = createBarcodeDrawing(
        "Code128",
        value=valor,
        barHeight=14 if usar_canvas else 12,
        barWidth=0.32 if usar_canvas else 0.28,
        humanReadable=0 if usar_canvas else 1,
    )
    tmp = tempfile.mkdtemp(prefix="mckg_bc_")
    try:
        svg_path = os.path.join(tmp, "bc.svg")
        png_path = os.path.join(tmp, "bc.png")
        renderSVG.drawToFile(d, svg_path)
        export_w = int(canvas[0]) if usar_canvas else 320
        _inkscape_export(svg_path, png_path, "png", width_px=export_w)
        if not usar_canvas:
            return base64.b64encode(open(png_path, "rb").read()).decode("ascii")

        from PIL import Image

        w_canvas, h_canvas = canvas
        bar_img = _trim_image_rgba(Image.open(png_path))
        canvas_img = Image.new("RGBA", (w_canvas, h_canvas), (0, 0, 0, 0))
        # Slot Illustrator 800×480: tinta del .ai entre ~17% y ~87% del alto.
        y_top = int(h_canvas * 80 / 480)
        y_bot = int(h_canvas * 418 / 480)
        avail_h = max(24, y_bot - y_top)
        max_w = int(w_canvas * 0.88)
        max_h = int(avail_h * 0.62)
        scale = min(max_w / max(bar_img.width, 1), max_h / max(bar_img.height, 1))
        new_size = (max(1, int(bar_img.width * scale)), max(1, int(bar_img.height * scale)))
        bar_img = bar_img.resize(new_size)
        x0 = (w_canvas - new_size[0]) // 2
        y0 = y_top
        canvas_img.paste(bar_img, (x0, y0), bar_img)
        draw = ImageDraw.Draw(canvas_img)
        font_size = max(9, int(h_canvas * 0.034))
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), valor, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        digit_y = min(y0 + new_size[1] + 3, y_bot - th)
        draw.text(((w_canvas - tw) // 2, digit_y), valor, fill=(0, 0, 0), font=font)
        out = os.path.join(tmp, "bc_canvas.png")
        canvas_img.save(out, format="PNG")
        return base64.b64encode(open(out, "rb").read()).decode("ascii")
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


def _compactar_texto(texto: str, max_chars: int) -> str:
    t = re.sub(r"\s+", " ", (texto or "").strip())
    if len(t) <= max_chars:
        return t
    cut = t[: max(1, max_chars - 1)]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" .,;:") + "…"


def _compactar_texto_multilinea(texto: str, max_chars: int) -> str:
    """Compacta sin perder saltos de línea (secciones de descripción alternativa)."""
    raw = (texto or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    lineas = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw.split("\n")]
    out = "\n".join(ln for ln in lineas if ln is not None)
    out = re.sub(r"\n{3,}", "\n\n", out)
    if len(out) <= max_chars:
        return out
    cut = out[: max(1, max_chars - 1)]
    if "\n" in cut:
        cut = cut.rsplit("\n", 1)[0]
    elif " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" .,;:\n") + "…"


def normalizar_datos_layout(datos: dict) -> dict:
    """Recorta campos largos para evitar desbordes al reemplazar texto fijo."""
    d = dict(datos or {})
    d["nombre_producto"] = _compactar_texto(str(d.get("nombre_producto") or ""), 64)
    d["ingrediente"] = _compactar_texto(str(d.get("ingrediente") or ""), 64)
    d["subtitulo"] = _compactar_texto(str(d.get("subtitulo") or ""), 92)
    d["descripcion_etiqueta"] = _compactar_texto_multilinea(str(d.get("descripcion_etiqueta") or ""), 3200)
    d["aplicaciones"] = _compactar_texto(str(d.get("aplicaciones") or ""), 160)
    d["notas_tecnicas"] = _compactar_texto(str(d.get("notas_tecnicas") or ""), 92)
    d["texto_cuchara"] = _compactar_texto(str(d.get("texto_cuchara") or ""), 70)
    d["concentracion"] = _compactar_texto(str(d.get("concentracion") or ""), 24)
    d["formula_molecular"] = _compactar_texto(str(d.get("formula_molecular") or ""), 32)

    blob = " ".join(
        str(d.get(k) or "")
        for k in ("nombre_producto", "sku", "archivo_ai", "ingrediente")
    ).lower()
    if ("aceite" in blob or "esencial" in blob) and _texto_es_copia_generica_polvo_layout(
        f"{d.get('subtitulo', '')} {d.get('descripcion_etiqueta', '')}"
    ):
        if "polvo" in str(d.get("subtitulo") or "").lower():
            d["subtitulo"] = ""
        if "polvo fino" in str(d.get("descripcion_etiqueta") or "").lower():
            d["descripcion_etiqueta"] = ""
    return d


def _texto_es_copia_generica_polvo_layout(texto: str) -> bool:
    low = (texto or "").lower()
    return "polvo fino" in low or "insumo alimentario 100% puro en polvo" in low


def _parse_matrix(matrix: str) -> tuple[float, float, float, float]:
    nums = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+", matrix or "")]
    if len(nums) >= 6:
        return nums[0], nums[3], nums[4], nums[5]
    return 1.0, 1.0, 0.0, 0.0


def _overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    return (x2 - x1) * (y2 - y1)


def _preflight_layout_svg(svg: str) -> dict[str, Any]:
    """Detecta solapes y cajas fuera del área visible."""
    errors: list[str] = []
    warnings: list[str] = []
    boxes: list[dict[str, Any]] = []
    try:
        root = ET.fromstring(svg)
    except Exception as e:
        return {"ok": False, "errors": [f"SVG inválido: {e}"], "warnings": [], "collisions": []}

    vb = root.attrib.get("viewBox", "")
    vb_vals = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+", vb)]
    bounds = tuple(vb_vals[:4]) if len(vb_vals) >= 4 else None
    ns = {"svg": _SVG_NS}

    for el in root.findall(".//svg:text", ns):
        txt = "".join(el.itertext()).strip()
        if not txt:
            continue
        tr = el.attrib.get("transform", "")
        sx, sy, tx, ty = _parse_matrix(tr)
        fs_raw = re.sub(r"[^\d.]", "", el.attrib.get("font-size", "10")) or "10"
        if not fs_raw:
            style = el.attrib.get("style", "")
            m_fs = re.search(r"font-size:\s*([\d.]+)px", style)
            fs_raw = m_fs.group(1) if m_fs else "10"
        fs = float(fs_raw)
        eid = el.attrib.get("id") or ""
        lines = max(1, txt.count("\n") + sum(1 for c in txt if c == "•"))
        if eid == "text18" or txt.strip().startswith("RSN "):
            width = fs * 1.4
            height = max(8.0, len(txt) * fs * 0.52)
        elif eid == "mckenna-lote-recuadro":
            width = 30.0
            height = lines * fs * 1.35
        elif eid == "text78" or "devolución" in txt.lower():
            width = min(120.0, max(4.0, len(txt) * fs * 0.42))
            height = max(3.0, lines * fs * 1.18)
        else:
            width = max(4.0, len(txt) * fs * 0.50 * max(0.7, abs(sx)))
            height = max(3.0, lines * fs * 1.18 * max(0.7, abs(sy)))
        boxes.append({
            "kind": "text",
            "id": eid,
            "bbox": (tx, ty - height, width, height),
        })

    for el in root.findall(".//svg:image", ns):
        tr = el.attrib.get("transform", "")
        sx, sy, tx, ty = _parse_matrix(tr)
        x = float(el.attrib.get("x", "0"))
        y = float(el.attrib.get("y", "0"))
        w = float(el.attrib.get("width", "0"))
        h = float(el.attrib.get("height", "0"))
        bx = tx + x * sx
        by = ty + y * sy
        bw = abs(w * sx) if sx else w
        bh = abs(h * sy) if sy else h
        if bw > 0 and bh > 0:
            boxes.append({"kind": "image", "id": el.attrib.get("id") or "", "bbox": (bx, by, bw, bh)})

    for el in root.findall(".//svg:rect", ns):
        x = float(el.attrib.get("x", "0"))
        y = float(el.attrib.get("y", "0"))
        w = float(el.attrib.get("width", "0"))
        h = float(el.attrib.get("height", "0"))
        if w > 0 and h > 0:
            boxes.append({"kind": "rect", "id": el.attrib.get("id") or "", "bbox": (x, y, w, h)})

    collisions: list[dict[str, Any]] = []
    protected_tokens = ("barras", "barcode", "legal", "lote", "venc")
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a = boxes[i]
            b = boxes[j]
            area = _overlap(a["bbox"], b["bbox"])
            if area < 9.0:
                continue
            aid = (a.get("id") or "").lower()
            bid = (b.get("id") or "").lower()
            protected = any(t in aid for t in protected_tokens) or any(t in bid for t in protected_tokens)
            if protected and (a["kind"] == "text" or b["kind"] == "text"):
                pair = {aid, bid}
                if pair == {"text78", "mckenna-lote-recuadro"}:
                    continue
                if pair == {"text18", "mckenna-lote-recuadro"}:
                    continue
                collisions.append({"a": aid or a["kind"], "b": bid or b["kind"], "area": round(area, 2)})

    if bounds:
        vx, vy, vw, vh = bounds
        for b in boxes:
            x, y, w, h = b["bbox"]
            if x < vx - 1 or y < vy - 1 or x + w > vx + vw + 1 or y + h > vy + vh + 1:
                if b["kind"] == "text":
                    warnings.append("Texto potencialmente fuera del área imprimible")
                    break

    if collisions:
        errors.append(f"Solapamiento detectado en {len(collisions)} zona(s) crítica(s)")

    if not boxes:
        warnings.append("No se detectaron cajas para validar layout")

    return {"ok": not errors, "errors": errors, "warnings": warnings, "collisions": collisions}


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
    datos = normalizar_datos_layout(datos)
    if datos.get("forzar_plantilla_svg") not in (True, 1, "1", "true"):
        try:
            from app.tools.etiquetas_ai_engine import buscar_plantilla_ai, renderizar_desde_ai

            ai_path = buscar_plantilla_ai(datos)
            if ai_path:
                modo = (datos.get("modo_etiqueta") or datos.get("version") or "alternativa").strip().lower()
                return renderizar_desde_ai(datos, ai_path, modo=modo)
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
    preflight = _preflight_layout_svg(svg)
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
        "preflight": preflight,
    }
    return svg, meta


def _inkscape_export(
    svg_path: str,
    out_path: str,
    export_type: str,
    width_px: int | None = None,
    export_area: list[float] | None = None,
    *,
    fondo_blanco: bool = True,
) -> None:
    cmd = [
        "inkscape",
        svg_path,
        f"--export-type={export_type}",
        f"--export-filename={out_path}",
    ]
    if width_px:
        cmd.extend(["-w", str(width_px)])
    if fondo_blanco and export_type == "png":
        cmd.extend(["--export-background=#ffffff", "--export-background-opacity=1"])
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
        raise ValueError("Layout inválido: " + "; ".join(pf.get("errors") or ["solapamiento"]))
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
