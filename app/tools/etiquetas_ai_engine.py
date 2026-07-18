"""
Etiquetas McKenna desde archivos Illustrator (.ai = PDF) por producto.
Convierte con Inkscape y aplica solo reemplazos de texto + overlays dinámicos.
"""
from __future__ import annotations

import hashlib
import math
import re
import subprocess
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_AI_DIR = _REPO / "Etiquetas Modelo SVG"
_PDF_DIR = _AI_DIR / "PDF"
_CACHE_DIR = _REPO / "app" / "data" / "etiquetas_ai_cache"

_RE_MARCO_BARRAS = re.compile(
    r"<path[^>]+d=\"[^\"]*(?:135\.95|132\.267|133\.486|142\.008|144\.47|135\.951)[^\"]*\"[^>]*/>",
    re.IGNORECASE,
)
_RE_GRUPO_PLANTILLA = re.compile(
    r'<g\s+[^>]*transform="matrix\(1\.3333[^"]*\)"',
    re.IGNORECASE,
)
_RE_TAG_G_OPEN = re.compile(r"<g\b", re.IGNORECASE)
_RE_PESO_TSPAN = re.compile(
    r"^\d[\d.,]*\s*(?:g|kg|Kg|KG|mL|ml|ML|lt|Lt|LT|l|L)(?:/g)?$",
    re.IGNORECASE,
)
_RE_TEXT_BLOCK = re.compile(r"(<text\b)([^>]*)(>)(.*?)(</text>)", re.S | re.I)
_RE_TSPAN_TEXT = re.compile(r">([^<>]{2,220})</tspan>", re.DOTALL)


def _parse_matrix_translate(matrix_raw: str) -> tuple[float, float, float, float]:
    nums = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+", matrix_raw or "")]
    if len(nums) >= 6:
        return nums[0], nums[3], nums[4], nums[5]
    if len(nums) >= 4:
        return nums[0], nums[1], nums[2], nums[3]
    return 1.0, 1.0, 0.0, 0.0


def _textos_con_posicion(svg: str) -> list[tuple[float, float, str]]:
    filas: list[tuple[float, float, str]] = []
    for m in re.finditer(r'<text\b[^>]*transform="matrix\(([^)]+)\)"', svg, re.IGNORECASE):
        sx, sy, tx, ty = _parse_matrix_translate(m.group(1))
        start = m.start()
        end = svg.find("</text>", start)
        if end < 0:
            continue
        inner = re.sub(r"<[^>]+>", " ", svg[start:end])
        inner = re.sub(r"\s+", " ", inner).strip()
        if inner:
            filas.append((tx, ty, inner))
    return filas


def _svg_tiene_legal_embebido(svg: str) -> bool:
    low = svg.lower()
    return "2674" in low or "reenvase de materia prima" in low or 'id="mckenna-bloque-legal"' in low


def _piso_visual_bloque(tx: float, ty: float, texto: str, font_size: float = 4.8) -> float:
    """Coordenada Y (SVG invertido) del borde inferior visual de un bloque de texto."""
    ancho_chars = 50 if tx <= 12 else 44
    lineas = max(1, math.ceil(len(texto) / ancho_chars))
    return ty - lineas * font_size * 1.2


def _ajustar_spec_overlays_ai(svg: str, spec: dict) -> tuple[dict, bool]:
    """Ajusta coords de lote/barras al layout real del .ai. Retorna (spec, skip_barras_nuevo)."""
    spec = dict(spec)
    skip_barras = False

    textos = _textos_con_posicion(svg)
    if textos:
        subtitulos = [t for t in textos if 3 <= t[0] <= 22 and 148 <= t[1] <= 170]
        desc_blocks = [t for t in textos if t[0] <= 22 and 28 < t[1] < 150 and len(t[2]) > 30]
        lote_cfg = dict(spec.get("lote") or {})
        lh = float(lote_cfg.get("line_height", 5.0))
        legal = spec.get("legal") or {}
        legal_y = float(legal.get("y", 7.5))
        legal_h = float(legal.get("h", 7.0))
        min_lote_y = legal_y + legal_h + 1.5

        if desc_blocks:
            piso = min(_piso_visual_bloque(t[0], t[1], t[2]) for t in desc_blocks)
            desc_top = max(t[1] for t in desc_blocks)
            lote_cfg["x"] = 3.6
            if piso - min_lote_y >= lh * 2.2:
                lote_cfg["y"] = piso - 3.0
            else:
                subs_arriba = [t for t in textos if t[0] <= 22 and t[1] > desc_top + lh]
                if subs_arriba:
                    borde_sup = min(t[1] for t in subs_arriba)
                    hueco = borde_sup - desc_top
                    if hueco >= lh * 2:
                        lote_cfg["y"] = desc_top + (hueco - lh * 2) / 2 + lh
                    else:
                        lote_cfg["y"] = desc_top + max(1.0, hueco * 0.35)
                else:
                    lote_cfg["y"] = max(min_lote_y, desc_top - lh * 2)
        elif subtitulos:
            lote_cfg["x"] = subtitulos[0][0]
            lote_cfg["y"] = subtitulos[0][1] - 8.0
        spec["lote"] = lote_cfg

    if _RE_BARCODE_EMBED.search(svg):
        skip_barras = True

    return spec, skip_barras


_RE_BARCODE_EMBED = re.compile(
    r'(<g[^>]*transform="matrix\(([0-9.]+),0,0,([0-9.]+),([0-9.]+),([0-9.]+)\)"[^>]*>\s*'
    r'<image[^>]*xlink:href=")(data:image/[^"]+)(")',
    re.IGNORECASE | re.DOTALL,
)


def _reemplazar_barcode_embebido(svg: str, b64: str) -> str:
    def _sub(m: re.Match) -> str:
        sx, sy, tx, ty = float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5))
        if sx < 8 or sy < 8:
            return m.group(0)
        return f'{m.group(1)}data:image/png;base64,{b64}{m.group(7)}'

    return _RE_BARCODE_EMBED.sub(_sub, svg, count=1)


def _dimensiones_barcode_embebido(svg: str) -> tuple[int, int] | None:
    import base64
    import io

    from PIL import Image

    m = re.search(
        r'id="g12"[^>]*>.*?xlink:href="data:image/[^;]+;base64,([^"]+)"',
        svg,
        re.S | re.I,
    )
    if not m:
        m = re.search(r'xlink:href="data:image/[^;]+;base64,([^"]+)"', svg, re.I)
    if not m:
        return None
    try:
        img = Image.open(io.BytesIO(base64.b64decode(m.group(1))))
        w, h = img.size
        if w >= 120 and h >= 80:
            return w, h
    except Exception:
        return None
    return None


def _transform_desarrollado_original(bloque: str) -> tuple[float, float]:
    m = re.search(r'transform="matrix\(1,0,0,-1,([\d.]+),([\d.]+)\)"', bloque, re.I)
    if m:
        return float(m.group(1)), float(m.group(2))
    return 154.3784, 44.7813


def _partir_lineas_desarrollado(lineas: list[str]) -> list[str]:
    out: list[str] = []
    for ln in lineas:
        if ln.startswith("Descarga ficha técnica en:"):
            out.append("Descarga ficha técnica en:")
        elif len(ln) > 28 and " " in ln and ln.startswith("www."):
            out.append(ln)
        else:
            out.append(ln)
    return out


def _limpiar_x_por_caracter_en_bloque(bloque: str) -> str:
    """Quita x por carácter en tspans sin cambiar transform ni interlineado."""

    def _sub(m: re.Match[str]) -> str:
        apertura = m.group(1) + m.group(2)
        if not re.search(r'\sx="[^"]*\s[^"]+"', apertura):
            return m.group(0)
        apertura = re.sub(r'\sx="[^"]*"', "", apertura)
        if 'x="' not in apertura:
            apertura = apertura.replace("<tspan", '<tspan x="0"', 1)
        return apertura + m.group(3)

    return re.sub(r"(<tspan)(\s[^>]*>)([^<]*</tspan>)", _sub, bloque)


def _normalizar_bloque_desarrollado_ai(svg: str) -> str:
    """Solo corrige tspans ilegibles (x por carácter); conserva posición Illustrator."""
    marker = "Desarrollado por:"
    pos = svg.find(marker)
    if pos < 0:
        return svg
    start = svg.rfind("<text", 0, pos)
    end = svg.find("</text>", pos)
    if start < 0 or end < 0:
        return svg
    end += len("</text>")
    bloque = svg[start:end]
    if not re.search(r'x="[^"]*\s[^"]+"', bloque):
        return svg
    nuevo = _limpiar_x_por_caracter_en_bloque(bloque)
    return svg[:start] + nuevo + svg[end:]


def _extraer_path_svg(svg: str, element_id: str) -> tuple[str, str]:
    m = re.search(rf'<path\b[^>]*\bid="{re.escape(element_id)}"[^>]*/>', svg, re.I | re.S)
    if not m:
        return svg, ""
    bloque = m.group(0)
    return svg[: m.start()] + svg[m.end() :], bloque


def _reinsertar_barcode_antes_lote_ai(svg: str) -> str:
    """CMYK → barcode (g12) → recuadro LOT; solo z-order dentro de la columna derecha."""
    svg, g12 = _extraer_elemento_svg(svg, "g12", "g")
    if not g12:
        return svg

    rec = _recuadro_lote_plantilla_ai(svg)
    if not rec:
        idx = svg.rfind("</svg>")
        return svg[:idx] + g12 + svg[idx:] if idx >= 0 else svg

    lot_id_m = re.search(r'\bid="([^"]+)"', rec[0].group(0))
    lot_id = lot_id_m.group(1) if lot_id_m else ""
    if not lot_id:
        return svg + g12
    svg, lot_blk = _extraer_path_svg(svg, lot_id)
    if not lot_blk:
        return svg + g12

    last_cmyk = 0
    for cm in re.finditer(r"<path\b[^>]*/>", svg, re.I | re.S):
        blob = cm.group(0)
        if re.search(
            r"fill:#(?:642682|d60c53|1e72b9|189dd9|3daa36|00a199|f9b333|5c268f|d9115a|"
            r"3972c2|46a0de|41b93d|3baa9a|f9a82b)",
            blob,
            re.I,
        ):
            last_cmyk = cm.end()
    if last_cmyk <= 0:
        return svg[: rec[0].start()] + g12 + lot_blk + svg[rec[0].start() :]
    return svg[:last_cmyk] + g12 + lot_blk + svg[last_cmyk:]


def _extraer_elemento_svg(svg: str, element_id: str, tag: str) -> tuple[str, str]:
    from app.tools.etiquetas_svg_engine import _pos_cierre_desde_apertura

    m = re.search(rf'<{tag}\b[^>]*\bid="{re.escape(element_id)}"', svg, re.I)
    if not m:
        return svg, ""
    start = m.start()
    if tag == "g":
        end = _pos_cierre_desde_apertura(svg, start)
        if end < 0:
            return svg, ""
        bloque = svg[start : end + 4]
        return svg[:start] + svg[end + 4 :], bloque
    end = svg.find("</text>", start)
    if end < 0:
        return svg, ""
    end += len("</text>")
    return svg[:start] + svg[end:], svg[start:end]


def _normalizar_texto_rsn_ai(svg: str) -> str:
    m = re.search(r'(<text\b[^>]*id="text18"[\s\S]*?</text>)', svg, re.I)
    if not m:
        return svg
    bloque = m.group(1)
    if not re.search(r'x="[^"]*\s[^"]+"', bloque):
        return svg
    nuevo = _limpiar_x_por_caracter_en_bloque(bloque)
    return svg[: m.start()] + nuevo + svg[m.end() :]


def _elevar_elementos_columna_derecha_svg(svg: str) -> str:
    """Fija z-order columna derecha: barcode → CMYK/lote → RSN → Desarrollado."""
    from app.tools.etiquetas_svg_engine import _pos_cierre_desde_apertura

    bloques: list[str] = []
    # g12 (barcode) → barras CMYK → RSN → Desarrollado (texto siempre encima).
    for eid, tag in (("g12", "g"), ("g116", "g"), ("text18", "text")):
        svg, blk = _extraer_elemento_svg(svg, eid, tag)
        if blk:
            bloques.append(blk)

    marker = "Desarrollado por:"
    pos = svg.find(marker)
    if pos >= 0:
        start = svg.rfind("<text", 0, pos)
        end = svg.find("</text>", pos)
        if start >= 0 and end >= 0:
            end += len("</text>")
            bloques.append(svg[start:end])
            svg = svg[:start] + svg[end:]

    if not bloques:
        return svg

    layer_m = re.search(r'<g\b[^>]*inkscape:groupmode="layer"[^>]*>', svg, re.I)
    if not layer_m:
        idx = svg.rfind("</svg>")
        return svg[:idx] + "".join(bloques) + svg[idx:] if idx >= 0 else svg

    close_pos = _pos_cierre_desde_apertura(svg, layer_m.start())
    if close_pos < 0:
        return svg
    return svg[:close_pos] + "".join(bloques) + svg[close_pos:]


def _recuadro_lote_plantilla_ai(svg: str) -> tuple[re.Match[str], float, float, float] | None:
    """Localiza el recuadro naranja LOT/EXP de la plantilla (sin mover otros elementos)."""
    pat = re.compile(
        r'<path\b([^>]*)\bd="m\s*([\d.]+),([\d.]+)\s+h\s*(-?[\d.]+)\s+v\s*([\d.]+)\s+h\s*[\d.]+\s+z"([^>]*)>',
        re.I,
    )
    candidatos: list[tuple[float, float, re.Match[str], float, float]] = []
    for m in pat.finditer(svg):
        blob = m.group(1) + m.group(6)
        if not re.search(r"stroke:#f(?:9b233|68712|39200)", blob, re.I):
            continue
        x0, y0 = float(m.group(2)), float(m.group(3))
        dw, dh = float(m.group(4)), float(m.group(5))
        w, h = abs(dw), abs(dh)
        if w < 18 or h < 6 or h > 22:
            continue
        x_lo = x0 - w if dw < 0 else x0
        if x_lo < 100:
            continue
        y_lo, y_hi = (y0, y0 + h) if dh > 0 else (y0 - h, y0)
        cx = x_lo + w / 2
        candidatos.append((y_lo, cx, m, y_lo, y_hi))
    if not candidatos:
        return None
    candidatos.sort(key=lambda c: c[0])
    _, cx, m, y_lo, y_hi = candidatos[0]
    return m, cx, y_lo, y_hi


def _inyectar_lote_exp_recuadro_ai(svg: str, datos: dict) -> str:
    """LOT/EXP dentro del recuadro naranja que ya trae el .ai (coords derivadas del path)."""
    from app.tools.etiquetas_svg_engine import _escape_xml_text, _lineas_lote_vencimiento

    if datos.get("mostrar_lote_vencimiento") is False or "mckenna-lote-recuadro" in svg:
        return svg
    lineas = _lineas_lote_vencimiento(datos)
    if not lineas:
        return svg

    rec = _recuadro_lote_plantilla_ai(svg)
    if not rec:
        return svg
    m_path, cx, y_lo, y_hi = rec
    altura = y_hi - y_lo
    fs = max(2.0, min(3.4, altura * 0.21))
    dy = fs * 1.05
    lineas_n = 1 + (1 if len(lineas) > 1 and lineas[1] else 0)
    bloque_h = fs + (lineas_n - 1) * dy
    ay = y_lo + bloque_h + max(0.4, altura * 0.08)
    ay = min(ay, y_hi - fs * 0.25)

    tspans = [
        f'<tspan x="0" y="0" text-anchor="middle" sodipodi:role="line">{_escape_xml_text(lineas[0])}</tspan>',
    ]
    if len(lineas) > 1 and lineas[1]:
        tspans.append(
            f'<tspan x="0" dy="{dy:.2f}" text-anchor="middle" sodipodi:role="line">'
            f"{_escape_xml_text(lineas[1])}</tspan>"
        )
    bloque = (
        f'<text xml:space="preserve" id="mckenna-lote-recuadro" '
        f'transform="matrix(1,0,0,-1,{cx:.4f},{ay:.4f})" '
        f'style="font-size:{fs}px;font-family:{_FUENTE_ETIQUETA};text-anchor:middle;fill:#1d1d1b;stroke:none">'
        + "".join(tspans)
        + "</text>"
    )
    return svg[: m_path.end()] + bloque + svg[m_path.end() :]


def _perfil_layout_etiqueta_ai(svg: str) -> str:
    """Detecta perfil de plantilla .ai para no aplicar coords de 5 mL en 30 mL."""
    if 'd="m 181.858,1.897 h -32.342 v 10.822 h 32.342 z"' in svg:
        return "aceite_5ml"
    if 'd="m 278.679,6.288 h -49.313 v 16.5 h 49.313 z"' in svg:
        return "aceite_30ml"
    m = re.search(r'viewBox="0 0 ([0-9.]+)', svg)
    if m:
        ancho = float(m.group(1))
        if ancho > 200:
            return "aceite_30ml"
        if ancho < 120:
            return "aceite_5ml"
    return "otro"


def _ajustar_pie_y_columna_ai(svg: str) -> str:
    """Baja el pie legal naranja (text78) para no chocar con la descripción."""
    svg = re.sub(
        r'(<text\b[^>]*transform="matrix\(1,0,0,-1,[^,]+,)([0-9.]+)(\)"[^>]*id="text78")',
        r"\g<1>3.1500\3",
        svg,
        count=1,
    )
    return svg


def _ajustar_columna_derecha_ai(svg: str) -> str:
    """Reposiciona columna derecha solo en plantillas aceite 5 mL (coords calibradas)."""
    if _perfil_layout_etiqueta_ai(svg) != "aceite_5ml":
        return svg
    # Lote path124 y≈1.9–12.7 · barcode y≈16.2–24 · CMYK y≈25.2 · URL y≈36+
    svg = re.sub(
        r'(id="g12"\s+)transform="matrix\([^"]+\)"',
        r'\1transform="matrix(28.0,0,0,7.8,153.0,16.2)"',
        svg,
        count=1,
    )
    svg = re.sub(
        r'(transform="matrix\(0,1,1,0,)([0-9.]+)(,)([0-9.]+)(\)"[^>]*id="text18")',
        lambda m: f"{m.group(1)}191.50{m.group(3)}{m.group(4)}{m.group(5)}",
        svg,
        count=1,
    )
    svg = re.sub(
        r'(d="m [0-9.]+,)(30\.365)( h -[0-9.]+ v [0-9.]+ h)',
        r"\g<1>26.000\3",
        svg,
    )
    return svg


def _bonus_nombre_ai(nombre: str, nom_ai: str, datos: dict) -> int:
    bonus = 0
    blob = f"{datos.get('subtitulo', '')} {datos.get('nombre_producto', '')}".lower()
    ai_low = nom_ai.lower()
    if "refinad" in blob and "refinad" in ai_low:
        bonus += 25
    if "amarill" in blob and "amarill" in ai_low:
        bonus += 20
    if "blanc" in blob and "blanc" in ai_low:
        bonus += 20
    if "natural" in blob and "natural" in ai_low:
        bonus += 20
    if "refinad" in blob and "natural" in ai_low:
        bonus -= 15
    if "carnaub" in blob and "carnaub" in ai_low:
        bonus += 30
    return bonus



def _norm_texto(s: str) -> str:
    raw = unicodedata.normalize("NFD", (s or "").strip())
    sin_tilde = "".join(c for c in raw if unicodedata.category(c) != "Mn")
    sin_tilde = re.sub(r"\bDE\b", " ", sin_tilde, flags=re.IGNORECASE)
    return re.sub(r"[^A-Z0-9]+", " ", sin_tilde.upper()).strip()


def _norm_formato(neto: str, unidad: str, tipo_etiqueta: str = "") -> set[str]:
    out: set[str] = set()
    nu = f"{(neto or '').strip()}{(unidad or '').strip()}".lower().replace(" ", "")
    if nu:
        out.add(nu)
        out.add(re.sub(r"(\d+)([a-z]+)", r"\1 \2", nu))
    tipo = (tipo_etiqueta or "").strip().lower().replace(" ", "")
    if tipo:
        out.add(tipo)
    if nu in {"1000g", "1kg"} or tipo in {"1kg", "kg"}:
        out.update({"kg", "1kg"})
    if nu in {"1000ml", "1l", "1lt"} or tipo in {"lt", "1l"}:
        out.update({"lt", "1l", "gl"})
    return {x.replace(" ", "") for x in out if x}


def _parse_ai_stem(stem: str) -> tuple[str, str]:
    m = re.match(
        r"^(.*?)\s+(\d+\s*(?:g|mL|ML|ml|G)|Kg|KG|kg|Lt|LT|lt|gL|GL)\s*$",
        stem,
        re.IGNORECASE,
    )
    if m:
        return _norm_texto(m.group(1)), m.group(2).lower().replace(" ", "")
    m2 = re.match(r"^(.*?)\s+(Kg|KG|kg|Lt|LT|lt|gL|GL)\s*$", stem, re.IGNORECASE)
    if m2:
        return _norm_texto(m2.group(1)), m2.group(2).lower()
    return _norm_texto(stem), ""


@lru_cache(maxsize=1)
def _indice_ai() -> list[tuple[str, str, Path]]:
    filas: list[tuple[str, str, Path]] = []
    if not _AI_DIR.is_dir():
        return filas
    for path in sorted(_AI_DIR.glob("*.ai")):
        nombre, fmt = _parse_ai_stem(path.stem)
        filas.append((nombre, fmt, path))
    return filas


@lru_cache(maxsize=1)
def _indice_pdf() -> list[tuple[str, str, Path]]:
    filas: list[tuple[str, str, Path]] = []
    if not _PDF_DIR.is_dir():
        return filas
    for path in sorted(_PDF_DIR.glob("*.pdf")):
        nombre, fmt = _parse_ai_stem(path.stem)
        filas.append((nombre, fmt, path))
    return filas


def _archivo_plantilla_id(path: Path) -> str:
    try:
        return str(path.relative_to(_AI_DIR)).replace("\\", "/")
    except ValueError:
        return path.name


_RE_TITULO_PLANTILLA = re.compile(r"plantilla", re.I)


def _es_titulo_plantilla(nombre: str) -> bool:
    """True si el nombre del archivo contiene «plantilla» (p. ej. PLANTILLA 76*66.svg)."""
    return bool(_RE_TITULO_PLANTILLA.search(Path(nombre).stem))


def _dims_desde_stem_plantilla(stem: str) -> tuple[float | None, float | None]:
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*[*x×X]\s*(\d+(?:[.,]\d+)?)", stem or "")
    if not m:
        return None, None
    return float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))


@lru_cache(maxsize=1)
def _archivos_titulo_plantilla() -> list[Path]:
    paths: list[Path] = []
    if _AI_DIR.is_dir():
        for path in sorted(_AI_DIR.iterdir()):
            if (
                path.is_file()
                and path.suffix.lower() in {".svg", ".ai"}
                and _es_titulo_plantilla(path.name)
            ):
                paths.append(path)
    if _PDF_DIR.is_dir():
        for path in sorted(_PDF_DIR.glob("*.pdf")):
            if _es_titulo_plantilla(path.name):
                paths.append(path)
    return paths


def resolver_ruta_plantilla(archivo: str) -> Path:
    """Resuelve .svg/.ai en raíz o .pdf en PDF/ (acepta «PDF/foo.pdf» o solo nombre)."""
    explicito = (archivo or "").strip()
    if not explicito:
        raise FileNotFoundError("Archivo de plantilla vacío")
    nombre = Path(explicito).name
    candidatos = [
        _AI_DIR / explicito,
        _PDF_DIR / explicito,
        _PDF_DIR / nombre,
        _AI_DIR / nombre,
    ]
    low = explicito.lower()
    if not low.endswith(".svg"):
        candidatos.append(_AI_DIR / f"{explicito}.svg")
        candidatos.append(_AI_DIR / f"{nombre}.svg")
    if not low.endswith(".ai"):
        candidatos.append(_AI_DIR / f"{explicito}.ai")
        candidatos.append(_AI_DIR / f"{nombre}.ai")
    if not low.endswith(".pdf"):
        candidatos.append(_PDF_DIR / f"{explicito}.pdf")
        candidatos.append(_PDF_DIR / f"{nombre}.pdf")
    vistos: set[Path] = set()
    for p in candidatos:
        if p in vistos:
            continue
        vistos.add(p)
        if p.is_file():
            return p
    raise FileNotFoundError(f"Plantilla no encontrada: {explicito}")


def _puntuar_nombre(nombre: str, nom_ai: str) -> int:
    if not nombre or not nom_ai:
        return 0
    if nombre == nom_ai:
        return 100
    if nombre in nom_ai or nom_ai in nombre:
        return 70
    palabras = [w for w in nombre.split() if len(w) > 2]
    if palabras and all(w in nom_ai for w in palabras):
        return 45
    comunes = set(nombre.split()) & set(nom_ai.split())
    if len(comunes) >= 2:
        return 35
    if len(comunes) == 1 and len(nombre.split()) <= 2:
        return 20
    return 0


def inferir_presentacion_desde_sku(sku: str) -> dict[str, str]:
    """Extrae neto/unidad del código Siigo (ej. C-CITMAG250g → 250 g)."""
    raw = (sku or "").strip()
    if not raw:
        return {}
    m = re.search(
        r"(\d+(?:[.,]\d+)?)\s*(KG|G|ML|LT|L)\b",
        raw,
        re.IGNORECASE,
    )
    if not m:
        m = re.search(r"(\d+)(KG|G|ML|LT|L)$", raw, re.IGNORECASE)
    if not m:
        return {}
    neto = m.group(1).replace(",", ".")
    unidad = m.group(2).lower()
    if unidad == "l":
        unidad = "lt"
    if unidad == "kg" and float(neto) == 1:
        return {"contenido_neto": "1", "unidad": "Kg", "tipo_etiqueta": "1 Kg"}
    if unidad in {"lt", "gl"}:
        return {"contenido_neto": neto, "unidad": "L", "tipo_etiqueta": "50 mL"}
    if unidad == "ml":
        return {"contenido_neto": neto, "unidad": "mL", "tipo_etiqueta": f"{neto} mL"}
    return {
        "contenido_neto": neto,
        "unidad": "g",
        "tipo_etiqueta": f"{neto} g" if unidad == "g" else f"{neto} {unidad}",
    }


def _candidatos_ai(
    datos: dict,
    *,
    q: str = "",
    limite: int = 20,
    min_score: int = 15,
) -> list[dict[str, Any]]:
    nombre = _norm_texto(
        datos.get("nombre_producto") or datos.get("ingrediente") or datos.get("sku") or ""
    )
    formatos = _norm_formato(
        str(datos.get("contenido_neto") or ""),
        str(datos.get("unidad") or ""),
        str(datos.get("tipo_etiqueta") or ""),
    )
    qn = _norm_texto(q)
    out: list[dict[str, Any]] = []
    for nom_ai, fmt_ai, path in _indice_ai():
        if qn and qn not in nom_ai and qn not in path.stem.upper():
            continue
        if formatos and fmt_ai and fmt_ai not in formatos:
            continue
        score = _puntuar_nombre(nombre, nom_ai)
        score += _bonus_nombre_ai(nombre, path.stem, datos)
        if fmt_ai and formatos:
            score += 10
        if qn and qn in nom_ai:
            score += 15
        if score < min_score and not qn:
            continue
        out.append({
            "archivo": path.name,
            "nombre": nom_ai,
            "formato": fmt_ai,
            "score": score,
            "disponible": True,
        })
    out.sort(key=lambda x: (-x["score"], x["archivo"]))
    return out[:limite]


def resolver_plantilla_ai(datos: dict, *, q: str = "", limite: int = 20) -> dict[str, Any]:
    payload = dict(datos)
    inferido = inferir_presentacion_desde_sku(str(datos.get("sku") or ""))
    for k, v in inferido.items():
        if v and not str(payload.get(k) or "").strip():
            payload[k] = v

    candidatos = _candidatos_ai(payload, q=q, limite=limite)
    archivo = (payload.get("archivo_ai") or payload.get("plantilla_ai") or "").strip()
    if archivo and not archivo.lower().endswith(".ai"):
        archivo = f"{archivo}.ai"

    elegido = archivo or (candidatos[0]["archivo"] if candidatos else "")
    path = buscar_plantilla_ai({**payload, "archivo_ai": elegido}) if elegido else None
    score = 0
    if path:
        for c in candidatos:
            if c["archivo"] == path.name:
                score = c["score"]
                break
        if not score and archivo:
            score = 100

    return {
        "archivo_ai": path.name if path else (elegido or None),
        "score": score,
        "auto": bool(path and not datos.get("archivo_ai") and not datos.get("plantilla_ai")),
        "inferido": inferido or None,
        "candidatos": candidatos,
        "total_ai": len(_indice_ai()),
    }


def buscar_plantilla_ai(datos: dict) -> Path | None:
    explicito = (datos.get("archivo_ai") or datos.get("plantilla_ai") or "").strip()
    if explicito:
        p = _AI_DIR / explicito
        if p.is_file():
            return p
        p2 = _AI_DIR / f"{explicito}.ai"
        if p2.is_file():
            return p2

    nombre = _norm_texto(
        datos.get("nombre_producto") or datos.get("ingrediente") or datos.get("sku") or ""
    )
    if not nombre:
        return None
    formatos = _norm_formato(
        str(datos.get("contenido_neto") or ""),
        str(datos.get("unidad") or ""),
        str(datos.get("tipo_etiqueta") or ""),
    )
    mejor: tuple[int, Path] | None = None
    for nom_ai, fmt_ai, path in _indice_ai():
        if formatos and fmt_ai and fmt_ai not in formatos:
            continue
        score = _puntuar_nombre(nombre, nom_ai)
        if score <= 0:
            continue
        score += _bonus_nombre_ai(nombre, path.stem, datos)
        if fmt_ai and formatos:
            score += 10
        if mejor is None or score > mejor[0]:
            mejor = (score, path)
    if mejor and mejor[0] >= 20:
        return mejor[1]
    return None


def listar_plantillas_ai(limite: int = 500, *, q: str = "") -> list[dict[str, Any]]:
    ql = (q or "").strip().lower()
    out = []
    for nom, fmt, path in _indice_ai():
        if ql and ql not in path.name.lower() and ql not in nom.lower() and ql not in fmt.lower():
            continue
        try:
            nbytes = path.stat().st_size
        except OSError:
            nbytes = 0
        out.append({
            "archivo": path.name,
            "nombre": nom,
            "formato": fmt,
            "ruta": str(path),
            "bytes": nbytes,
            "disponible": path.is_file(),
        })
        if len(out) >= limite:
            break
    return out


def listar_plantillas_pdf(limite: int = 500, *, q: str = "") -> list[dict[str, Any]]:
    ql = (q or "").strip().lower()
    out: list[dict[str, Any]] = []
    for nom, fmt, path in _indice_pdf():
        if ql and ql not in path.name.lower() and ql not in nom.lower() and ql not in fmt.lower():
            continue
        try:
            nbytes = path.stat().st_size
        except OSError:
            nbytes = 0
        out.append({
            "archivo": _archivo_plantilla_id(path),
            "nombre": nom,
            "formato": fmt,
            "ruta": str(path),
            "bytes": nbytes,
            "disponible": path.is_file(),
        })
        if len(out) >= limite:
            break
    return out


def carpeta_plantillas_ai() -> str:
    return str(_AI_DIR)


def carpeta_plantillas_pdf() -> str:
    return str(_PDF_DIR)


def _clave_relacion_plantilla(stem: str) -> str:
    """Clave común para emparejar .ai y .pdf con nombres casi iguales."""
    s = (stem or "").strip()
    s = re.sub(r"\s*A4\s*$", "", s, flags=re.I)
    s = re.sub(r"\s+AI\s+\d{4}.*$", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip()
    return _norm_texto(s)


@lru_cache(maxsize=1)
def _filas_relacion_ai_pdf() -> list[dict[str, Any]]:
    """Empareja archivos .ai (raíz) con PDF/ por nombre normalizado."""
    filas: dict[str, dict[str, Any]] = {}

    def _fila(k: str, *, nom: str, fmt: str) -> dict[str, Any]:
        if k not in filas:
            filas[k] = {"clave": k, "nombre": nom, "formato": fmt, "ai": None, "pdf": None}
        else:
            if nom and not filas[k].get("nombre"):
                filas[k]["nombre"] = nom
            if fmt and not filas[k].get("formato"):
                filas[k]["formato"] = fmt
        return filas[k]

    for nom, fmt, path in _indice_ai():
        k = _clave_relacion_plantilla(path.stem)
        row = _fila(k, nom=nom, fmt=fmt)
        row["ai"] = path

    for nom, fmt, path in _indice_pdf():
        k = _clave_relacion_plantilla(path.stem)
        row = filas.get(k)
        if row is None or row.get("pdf") is not None:
            mejor_k: str | None = None
            mejor_score = 0
            for ck, cr in filas.items():
                cnom = str(cr.get("nombre") or ck)
                score = _puntuar_nombre(nom, cnom)
                if nom and ck == _clave_relacion_plantilla(nom):
                    score = max(score, 70)
                if score > mejor_score:
                    mejor_score = score
                    mejor_k = ck
            if mejor_k and mejor_score >= 35 and filas[mejor_k].get("pdf") is None:
                k = mejor_k
            elif row is None or row.get("pdf") is not None:
                k = f"{k}|{path.name}"
        row = _fila(k, nom=nom, fmt=fmt)
        row["pdf"] = path

    out = list(filas.values())
    out.sort(key=lambda r: (str(r.get("nombre") or r.get("clave") or "").lower()))
    return out


def _listar_solo_titulo_plantilla(limite: int = 10_000, *, q: str = "") -> list[dict[str, Any]]:
    """Solo archivos de Etiquetas Modelo SVG cuyo nombre contiene «plantilla»."""
    ql = (q or "").strip().lower()
    out: list[dict[str, Any]] = []
    for path in _archivos_titulo_plantilla():
        stem = path.stem.strip()
        ext = path.suffix.lower()
        w_mm, h_mm = _dims_desde_stem_plantilla(stem)
        fmt = f"{int(w_mm)} x {int(h_mm)} mm" if w_mm and h_mm else ""
        if ext == ".pdf":
            archivo = _archivo_plantilla_id(path)
        else:
            archivo = path.name
        if ql and ql not in stem.lower() and ql not in archivo.lower() and ql not in fmt.lower():
            continue
        try:
            nbytes = path.stat().st_size
        except OSError:
            nbytes = 0
        out.append({
            "archivo": archivo,
            "archivo_ai": path.name if ext == ".ai" else None,
            "archivo_pdf": _archivo_plantilla_id(path) if ext == ".pdf" else None,
            "archivo_svg": path.name if ext == ".svg" else None,
            "nombre": stem,
            "formato": fmt,
            "ancho_mm": w_mm,
            "alto_mm": h_mm,
            "ruta": str(path),
            "bytes": nbytes,
            "disponible": True,
            "tiene_ai": ext == ".ai",
            "tiene_pdf": ext == ".pdf",
            "tiene_svg": ext == ".svg",
            "es_plantilla_base": True,
        })
        if len(out) >= limite:
            break
    return out


def listar_plantillas_modelo_relacionadas(
    limite: int = 10_000,
    *,
    q: str = "",
    vinculos_ai: dict[str, dict[str, str]] | None = None,
    solo_titulo_plantilla: bool = False,
) -> list[dict[str, Any]]:
    """Lista unificada .ai + PDF de Etiquetas Modelo SVG con archivo de escaneo preferido."""
    if solo_titulo_plantilla:
        return _listar_solo_titulo_plantilla(limite=limite, q=q)
    ql = (q or "").strip().lower()
    vinculos = vinculos_ai or {}
    out: list[dict[str, Any]] = []
    for rel in _filas_relacion_ai_pdf():
        ai_path: Path | None = rel.get("ai")
        pdf_path: Path | None = rel.get("pdf")
        archivo_ai = ai_path.name if ai_path else None
        archivo_pdf = _archivo_plantilla_id(pdf_path) if pdf_path else None
        # En modo relacionado priorizamos .ai (SVG original) y usamos PDF como respaldo.
        archivo_escaneo = archivo_ai or archivo_pdf
        if not archivo_escaneo:
            continue
        nom = str(rel.get("nombre") or "")
        fmt = str(rel.get("formato") or "")
        if ql and ql not in (archivo_escaneo or "").lower() and ql not in nom.lower() and ql not in fmt.lower():
            if archivo_ai and ql in archivo_ai.lower():
                pass
            elif archivo_pdf and ql in archivo_pdf.lower():
                pass
            else:
                continue
        sku_info = vinculos.get(archivo_ai or "") or {}
        try:
            nbytes = (pdf_path or ai_path).stat().st_size  # type: ignore[union-attr]
        except OSError:
            nbytes = 0
        out.append({
            "archivo": archivo_escaneo,
            "archivo_ai": archivo_ai,
            "archivo_pdf": archivo_pdf,
            "nombre": nom,
            "formato": fmt,
            "ruta": str(pdf_path or ai_path),
            "bytes": nbytes,
            "disponible": True,
            "tiene_ai": bool(ai_path),
            "tiene_pdf": bool(pdf_path),
            "sku_vinculado": sku_info.get("sku"),
            "producto_vinculado": sku_info.get("nombre"),
        })
        if len(out) >= limite:
            break
    return out


def carpeta_plantillas_modelo() -> str:
    return str(_AI_DIR)


def _cache_path(ai_path: Path) -> Path:
    st = ai_path.stat()
    key = f"{ai_path}:{st.st_mtime_ns}:{st.st_size}"
    h = hashlib.sha256(key.encode()).hexdigest()[:14]
    safe = re.sub(r"[^\w.\-]+", "_", ai_path.stem)[:48]
    return _CACHE_DIR / f"{safe}_{h}.svg"


def _plantilla_a_svg(path: Path) -> str:
    if path.suffix.lower() == ".svg":
        return path.read_text(encoding="utf-8")
    return _ai_a_svg(path)


def _ai_a_svg(ai_path: Path) -> str:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = _cache_path(ai_path)
    if cache.is_file() and cache.stat().st_mtime >= ai_path.stat().st_mtime:
        return cache.read_text(encoding="utf-8")
    tmp_out = cache.with_suffix(".tmp.svg")
    proc = subprocess.run(
        [
            "inkscape",
            str(ai_path),
            "--export-type=svg",
            f"--export-filename={tmp_out}",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0 or not tmp_out.is_file():
        err = (proc.stderr or proc.stdout or "Inkscape no pudo abrir el .ai").strip()
        raise RuntimeError(err[:500])
    svg = tmp_out.read_text(encoding="utf-8")
    tmp_out.replace(cache)
    return svg


_MARCAS_NO_TITULO = ("MCKENNA", "GROUP", "NO GHS", "®", "S.A.S")
_RE_RSN = re.compile(r"^RSN\s+\d", re.I)
_RE_NIT = re.compile(r"^NIT\.?\s*\d", re.I)
_RE_ADVERTENCIA = re.compile(
    r"diluya|irritaci[oó]n|devoluci[oó]n|no se acepta|est[eé] en perfectas|condiciones antes",
    re.I,
)
_TEXTO_POLVO_GENERICO = (
    "polvo fino",
    "materia prima alimentaria para formulación",
    "insumo alimentario 100% puro en polvo",
)


def _tspans_detalle(svg: str) -> list[dict[str, Any]]:
    filas: list[dict[str, Any]] = []
    for m in re.finditer(
        r'<text\b[^>]*transform="matrix\(([^)]+)\)"[^>]*>(.*?)</text>',
        svg,
        re.S | re.I,
    ):
        _sx, _sy, tx, ty = _parse_matrix_translate(m.group(1))
        for tm in re.finditer(r">([^<>]*)</tspan>", m.group(2)):
            t = re.sub(r"\s+", " ", tm.group(1)).strip()
            if t:
                filas.append({"x": tx, "y": ty, "text": t})
    return filas


def _es_linea_protegida_ai(texto: str, y: float = 0.0) -> bool:
    t = (texto or "").strip()
    if not t:
        return True
    if y < 12:
        return True
    if _RE_RSN.match(t) or _RE_NIT.match(t):
        return True
    if _RE_ADVERTENCIA.search(t):
        return True
    low = t.lower()
    if "desarrollado por" in low or "mckennagroup" in low:
        return True
    if t.startswith("Descarga ficha") or t.startswith("www."):
        return True
    if "BOGOTÁ" in t.upper() or "BOGOTA" in t.upper():
        return True
    return False


def _es_titulo_producto_ai(texto: str) -> bool:
    t = (texto or "").strip()
    if not (3 <= len(t) <= 48):
        return False
    if t != t.upper():
        return False
    if _RE_RSN.match(t) or _RE_NIT.match(t):
        return False
    if re.search(r"\d{5,}", t):
        return False
    if any(m in t.upper() for m in _MARCAS_NO_TITULO):
        return False
    if t.startswith(("•", "#", "LOT", "EXP", "GHS")):
        return False
    if "MATERIA PRIMA" in t or "CALIDAD:" in t:
        return False
    if any(x in t for x in ("BOGOTÁ", "BOGOTA", "COLOMBIA", "DESARROLLADO", "DESCARGA", "WWW.", "FICHA")):
        return False
    if "GROUP" in t or "S.A.S" in t:
        return False
    return bool(re.search(r"[A-ZÁÉÍÓÚÑ]{2,}", t))


def _es_texto_bloque_desarrollado(texto: str) -> bool:
    t = (texto or "").upper()
    return any(
        x in t
        for x in (
            "BOGOTÁ", "BOGOTA", "COLOMBIA", "DESARROLLADO", "MCKENNA",
            "WWW.", "MCKENNAGROUP", "FICHA TÉCNICA", "FICHA TECNICA", "DESCARGA",
        )
    )


def _titulo_compacto_para_ai(datos: dict, titulo_muestra: str) -> str:
    """Título corto que cabe en la caja del .ai; si no cabe, conservar el original."""
    raw = (datos.get("nombre_producto") or "").strip().upper()
    neto = f"{datos.get('contenido_neto', '')} {datos.get('unidad', '')}".strip().upper()
    if neto:
        raw = re.sub(rf"\s*{re.escape(neto)}\s*$", "", raw, flags=re.I).strip()
    if not raw or raw == titulo_muestra.upper():
        return ""
    max_len = max(len(titulo_muestra), int(len(titulo_muestra) * 1.32))
    if len(raw) > max_len:
        return ""
    return raw


def _es_subtitulo_corto_ai(texto: str) -> bool:
    t = (texto or "").strip()
    if not (4 <= len(t) <= 72):
        return False
    if t.endswith(":") and len(t) > 48:
        return False
    if t.lower().startswith("aceite esencial extraído"):
        return False
    if "mediante el proceso" in t.lower() or "melaleuca" in t.lower():
        return False
    return True


def _es_metadata_campo_ai(texto: str) -> bool:
    t = (texto or "").strip()
    if t.startswith("# CAS") or t.startswith("Concentración:") or t.startswith("Fórmula molecular:"):
        return True
    if _RE_PESO_TSPAN.match(t):
        return True
    if t.lower().startswith(("incluye cuchara", "incluye copa")):
        return True
    return t in {"GHS", "NO GHS", "MgO", "•"}


_RE_FRAG_ADVERTENCIA = re.compile(
    r"al[eé]rgica|digestivos|perfectas condiciones|lugar fresco|humedad|abrirlo|alejado de la luz",
    re.I,
)


def _seleccionar_lineas_descripcion(tspans: list[dict[str, Any]], titulo: str, subtitulo: str) -> list[str]:
    candidatos: list[dict[str, Any]] = []
    for row in tspans:
        t, y = row["text"], row["y"]
        if t in (titulo, subtitulo) or _es_linea_protegida_ai(t, y):
            continue
        if _es_metadata_campo_ai(t) or _es_titulo_producto_ai(t):
            continue
        if _RE_FRAG_ADVERTENCIA.search(t):
            continue
        if "mckenna" in t.lower() and len(t) < 28:
            continue
        if len(t) < 4 and t != "•":
            continue
        candidatos.append(row)

    anchor_y = _anchor_y_encabezado(tspans, titulo, subtitulo)
    if anchor_y is not None:
        candidatos = [r for r in candidatos if r["y"] < anchor_y - 1.5]

    if not candidatos:
        return []

    bandas: dict[int, list[str]] = {}
    banda_y: dict[int, float] = {}
    for row in candidatos:
        banda = int(round(row["y"] / 4.0) * 4)
        bandas.setdefault(banda, []).append(row["text"])
        banda_y[banda] = max(banda_y.get(banda, 0.0), float(row["y"]))

    ordenadas = sorted(
        ((banda_y.get(b, float(b)), sum(len(ln) for ln in bloque), bloque) for b, bloque in bandas.items()),
        reverse=True,
    )

    lineas: list[str] = []
    tope_y: float | None = None
    for y, total, bloque in ordenadas:
        if total < 24 and not lineas:
            continue
        if tope_y is None:
            tope_y = y
            lineas = list(bloque)
            continue
        if tope_y - y <= 10:
            lineas.extend(bloque)
            continue
        break
    return lineas


def _texto_es_copia_generica_polvo(texto: str) -> bool:
    low = (texto or "").lower()
    return any(m in low for m in _TEXTO_POLVO_GENERICO)


def _plantilla_sugiere_aceite(svg: str) -> bool:
    return "aceite" in svg.lower()


def _anchor_y_encabezado(tspans: list[dict[str, Any]], titulo: str, subtitulo: str) -> float | None:
    for row in tspans:
        if subtitulo and row["text"] == subtitulo:
            return float(row["y"])
    for row in tspans:
        if titulo and row["text"] == titulo:
            return float(row["y"])
    return None


def _subtitulos_compatibles(muestra: str, nuevo: str) -> bool:
    m, n = muestra.lower(), nuevo.lower()
    if ("aceite" in m or "esencial" in m) and "polvo" in n:
        return False
    if "polvo" in m and "aceite" in n and "esencial" in n:
        return False
    return True


def _distribuir_en_lineas(texto: str, presupuestos: list[int]) -> list[str]:
    texto = (texto or "").strip().replace("\r\n", "\n").replace("\r", "\n")
    parrafos = [re.sub(r"[ \t]+", " ", p.strip()) for p in re.split(r"\n+", texto) if p.strip()]
    palabras: list[str] = []
    for i, para in enumerate(parrafos):
        palabras.extend(para.split())
        if i < len(parrafos) - 1:
            palabras.append("|")  # preferir corte de línea entre párrafos/secciones
    if not palabras or not presupuestos:
        return []
    out: list[str] = []
    wi = 0
    for budget in presupuestos:
        if wi >= len(palabras):
            out.append("")
            continue
        chunk: list[str] = []
        chars = 0
        limite = budget
        while wi < len(palabras):
            w = palabras[wi]
            if w == "|":
                wi += 1
                if chunk:
                    break
                continue
            add = len(w) + (1 if chunk else 0)
            if chunk and chars + add > limite:
                break
            chunk.append(w)
            chars += add
            wi += 1
        out.append(" ".join(chunk))
    if wi < len(palabras):
        resto = " ".join(w for w in palabras[wi:] if w != "|")
        for i in range(len(out) - 1, -1, -1):
            if not out[i]:
                continue
            lim = presupuestos[i]
            combined = f"{out[i]} {resto}".strip()
            out[i] = combined if len(combined) <= lim else (
                combined[: max(1, lim - 1)].rsplit(" ", 1)[0].rstrip(" .,;:") + "…"
            )
            break
    return out


def _detectar_separador_x_ai(svg: str) -> float | None:
    m = re.search(
        r'transform="translate\(([0-9.]+)[^"]*\)"[^>]*>\s*<path[^>]*d="M 0,0 V ',
        svg,
        re.S,
    )
    if m:
        return float(m.group(1))
    return None


def _guia_izquierda_b1_ai(svg: str, tx_detectado: float) -> float:
    """Alinea B1 a la misma guía izquierda que subtítulo/título de la plantilla."""
    for pat in (
        r'id="text128"[^>]*transform="matrix\([^,]+,[^,]+,[^,]+,[^,]+,([0-9.]+)',
        r'id="mckenna-subtitulo"[^>]*transform="matrix\([^,]+,[^,]+,[^,]+,[^,]+,([0-9.]+)',
        r'id="text148"[^>]*transform="matrix\([^,]+,[^,]+,[^,]+,[^,]+,([0-9.]+)',
        r'transform="matrix\([^,]+,[^,]+,[^,]+,[^,]+,([0-9.]+),155',
    ):
        m = re.search(pat, svg)
        if m:
            return float(m.group(1))
    return tx_detectado if tx_detectado > 0 else 3.5


def _ancho_util_b1_ai(svg: str, tx: float) -> float | None:
    """Ancho útil de B1: desde guía izquierda hasta la línea vertical (~66 %)."""
    sep_x = _detectar_separador_x_ai(svg)
    if sep_x is None:
        return None
    from app.tools.etiquetas_svg_engine import _MARGEN_DER_B1_ANTES_SEP

    return max(80.0, sep_x - tx - _MARGEN_DER_B1_ANTES_SEP)


def _calcular_piso_descripcion_ai(svg: str) -> float:
    """Límite inferior (coord. SVG) del área de descripción, encima del pie/cuchara."""
    ci = svg.find("Incluye cuchara")
    if ci > 0:
        start = svg.rfind("<text", 0, ci)
        m = re.search(
            r"matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,([0-9.]+)\)",
            svg[start:ci],
        )
        if m:
            return float(m.group(1)) + 7.5
    return 11.0


def _meta_bloque_descripcion_ai(
    svg: str, primera_linea: str, *, texto_len: int = 0
) -> dict[str, Any] | None:
    if not primera_linea or primera_linea not in svg:
        return None
    idx = svg.find(primera_linea)
    start = svg.rfind("<text", 0, idx)
    end = svg.find("</text>", idx)
    if start < 0 or end < 0:
        return None
    bloque = svg[start : end + len("</text>")]

    m_tr = re.search(r'transform="matrix\(([^)]+)\)"', bloque)
    if not m_tr:
        return None
    nums = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+", m_tr.group(1))]
    if len(nums) < 6:
        return None
    tx, ty = nums[4], nums[5]
    tx = _guia_izquierda_b1_ai(svg, tx)

    fs_m = re.search(r"font-size:([0-9.]+)px", bloque)
    fs = float(fs_m.group(1)) if fs_m else 5.0
    ff_m = re.search(r"font-family:([^;'\"]+)", bloque)
    fill_m = re.search(r"fill:([^;'\"]+)", bloque)
    ff = (ff_m.group(1).strip() if ff_m else _FUENTE_ETIQUETA)
    fill = (fill_m.group(1).strip() if fill_m else "#000000")

    ys = sorted({float(y) for y in re.findall(r'\sy="([0-9.]+)"', bloque) if float(y) > 0})
    lh = (ys[1] - ys[0]) if len(ys) >= 2 else max(fs * 1.16, 5.5)
    lineas_plantilla = bloque.count("<tspan")

    max_x_local = 0.0
    for xm in re.finditer(r'\sx="([^"]*)"', bloque):
        vals = [float(v) for v in xm.group(1).split() if v]
        if vals:
            max_x_local = max(max_x_local, max(vals))

    sep_x = _detectar_separador_x_ai(svg)
    ancho_util = _ancho_util_b1_ai(svg, tx)
    if ancho_util:
        max_width = ancho_util
    elif sep_x:
        max_width = max(90.0, sep_x - tx - 2.5)
    else:
        max_width = max(90.0, max_x_local + 2.0)

    # Textos largos: tipografía más compacta para aprovechar el espacio vertical libre
    if texto_len > 750:
        fs = max(4.55, fs - 0.45)
        lh = max(4.75, lh - 0.85)
    elif texto_len > 500:
        fs = max(4.75, fs - 0.25)
        lh = max(5.0, lh - 0.45)

    piso_y = _calcular_piso_descripcion_ai(svg)
    budget_y = max(90.0, ty - piso_y)
    max_lineas = max(lineas_plantilla, int(budget_y / lh) - 1)

    por_ancho = max(30, int(max_width / max(fs * 0.56, 2.4)))
    max_chars = max(32, min(por_ancho, 50))

    return {
        "tx": tx,
        "ty": ty,
        "font_size": fs,
        "line_height": lh,
        "font_family": ff,
        "fill": fill,
        "max_lines": max_lineas,
        "max_chars": max_chars,
        "max_width": max_width,
        "max_width_full": max_width,
        "sep_x": sep_x,
        "piso_y": piso_y,
    }


_RE_BULLET_SECCION_AI = re.compile(r"^\s{0,8}([A-ZÁÉÍÓÚÑ][^:\n]{3,72}):\s*(.*)$", re.S)
_RE_INICIO_REGULATORIO_AI = re.compile(
    r"informaci[oó]n t[eé]cnica|nota legal|est[aá]ndar de calidad|cumplimiento normativo|resoluci[oó]n\s+2674",
    re.I,
)


def _recortar_priorizando_regulatorio(lineas: list[str], max_lineas: int) -> list[str]:
    """Si no cabe todo, conserva la cola regulatoria (USP, Res. 2674, nota legal)."""
    if len(lineas) <= max_lineas:
        return lineas

    reg_idx = next(
        (
            i
            for i, ln in enumerate(lineas)
            if ln.strip() and _RE_INICIO_REGULATORIO_AI.search(ln)
        ),
        None,
    )
    if reg_idx is None:
        out = lineas[: max_lineas - 1]
        if out and len(" ".join(lineas)) > len(" ".join(out)):
            out.append("…")
        return out

    cola = [ln for ln in lineas[reg_idx:] if ln is not None]
    while cola and not cola[0].strip():
        cola.pop(0)
    presupuesto_cabeza = max_lineas - len(cola)
    if presupuesto_cabeza < 5:
        return cola[:max_lineas]

    cabeza = lineas[:reg_idx]
    while cabeza and not cabeza[-1].strip():
        cabeza.pop()
    cabeza = cabeza[:presupuesto_cabeza]
    if len(cabeza) < reg_idx:
        cabeza.append("…")
    return cabeza + cola[: max_lineas - len(cabeza)]


def _partir_cuerpo_unico_b1(raw: str, max_chars: int, max_lineas: int) -> list[str]:
    """Flujo continuo: solo \\n\\n separa párrafos; el resto es un solo cuerpo."""
    from app.tools.etiquetas_svg_engine import _partir_lineas_texto, _unificar_cuerpo_parrafo_b1

    out: list[str] = []
    parrafos = [p for p in re.split(r"\n\s*\n", (raw or "").strip()) if p.strip()]
    for pi, parrafo in enumerate(parrafos):
        if pi > 0 and len(out) < max_lineas:
            out.append("")
        filas = [ln.strip() for ln in parrafo.split("\n") if ln.strip()]
        segmentos: list[str] = []
        hay_secciones = False
        for fila in filas:
            m = _RE_BULLET_SECCION_AI.match(fila)
            if m:
                hay_secciones = True
                titulo = f"{m.group(1).strip()}:"
                cuerpo = re.sub(r"\s+", " ", (m.group(2) or "").strip())
                segmentos.append(titulo)
                if cuerpo:
                    segmentos.append(cuerpo)
            else:
                segmentos.append(fila)
        if not hay_secciones:
            unificado = _unificar_cuerpo_parrafo_b1(parrafo)
            if unificado:
                restantes = max_lineas - len(out)
                if restantes <= 0:
                    break
                out.extend(_partir_lineas_texto(unificado, max_chars, restantes))
            if len(out) >= max_lineas:
                break
            continue
        for si, seg in enumerate(segmentos):
            unificado = _unificar_cuerpo_parrafo_b1(seg)
            if not unificado:
                continue
            restantes = max_lineas - len(out)
            if restantes <= 0:
                break
            out.extend(_partir_lineas_texto(unificado, max_chars, restantes))
            if si < len(segmentos) - 1:
                prox = segmentos[si + 1].strip()
                if _RE_INICIO_REGULATORIO_AI.search(prox) and len(out) < max_lineas:
                    out.append("")
        if len(out) >= max_lineas:
            break
    return out


def _formatear_cuerpo_unico_b1_alternativa(
    raw: str, max_chars: int, max_lineas: int
) -> list[str]:
    """B1 alternativa: un solo cuerpo por párrafo, guía izquierda + ancho hasta separador."""
    m = _RE_INICIO_REGULATORIO_AI.search(raw)
    if m and m.start() > 80:
        cabeza = raw[: m.start()].strip()
        cola = raw[m.start() :].strip()
        n_cola = max(6, max_lineas // 2)
        cola_fmt = _partir_cuerpo_unico_b1(cola, max_chars, n_cola)
        cola_fmt = [ln for ln in cola_fmt if ln is not None]
        n_cabeza = max(4, max_lineas - len(cola_fmt) - 1)
        cabeza_fmt = _partir_cuerpo_unico_b1(cabeza, max_chars, n_cabeza)
        while cabeza_fmt and not cabeza_fmt[-1].strip():
            cabeza_fmt.pop()
        unido: list[str] = list(cabeza_fmt)
        if unido and cola_fmt:
            unido.append("")
        unido.extend(cola_fmt)
        return _recortar_priorizando_regulatorio(unido, max_lineas)
    return _recortar_priorizando_regulatorio(
        _partir_cuerpo_unico_b1(raw, max_chars, max_lineas), max_lineas
    )


def _formatear_descripcion_etiqueta_ai(
    texto: str,
    max_chars: int,
    max_lineas: int,
    *,
    compacto: bool = False,
    alternativa: bool = True,
) -> list[str]:
    from app.tools.etiquetas_svg_engine import (
        _normalizar_ortografia_puntuacion_etiqueta,
        _partir_lineas_texto,
    )

    bruto = (texto or "").replace("\r\n", "\n").replace("\r", "\n")
    raw = _normalizar_ortografia_puntuacion_etiqueta(bruto) if alternativa else bruto.strip()
    if not raw or max_lineas <= 0:
        return []

    if alternativa and not compacto:
        return _formatear_cuerpo_unico_b1_alternativa(raw, max_chars, max_lineas)

    if not compacto:
        tiene_reg = _RE_INICIO_REGULATORIO_AI.search(raw)
        if tiene_reg and tiene_reg.start() > 80:
            return _formatear_con_cola_regulatoria(raw, max_chars, max_lineas, alternativa=alternativa)

    parrafos = [p.strip() for p in re.split(r"\n\s*\n", raw) if p.strip()]
    out: list[str] = []
    gap_parrafos = 0 if compacto else 1
    limite_blando = max_lineas + (6 if compacto else 0)

    def _push(line: str) -> bool:
        line = re.sub(r"\s+", " ", (line or "").strip())
        if not line:
            return len(out) < limite_blando
        if len(out) >= limite_blando:
            return False
        if len(line) <= max_chars:
            out.append(line)
            return True
        restantes = limite_blando - len(out)
        for w in _partir_lineas_texto(line, max_chars, restantes):
            if len(out) >= limite_blando:
                return False
            out.append(w)
        return len(out) < limite_blando

    for pi, parrafo in enumerate(parrafos):
        if pi > 0 and gap_parrafos and len(out) < limite_blando:
            out.append("")
        for fila in [ln.strip() for ln in parrafo.split("\n") if ln.strip()]:
            m = _RE_BULLET_SECCION_AI.match(fila)
            if m:
                titulo = f"{m.group(1).strip()}:"
                cuerpo = (m.group(2) or "").strip()
                if not _push(titulo):
                    break
                if cuerpo and not _push(cuerpo):
                    break
                continue
            if (
                len(fila) < 52
                and not fila.endswith(".")
                and fila[0].isupper()
                and " " in fila
                and fila.count(":") == 0
            ):
                if not _push(fila):
                    break
                continue
            if not _push(fila):
                break
        if len(out) >= limite_blando:
            break

    while out and not out[-1].strip():
        out.pop()
    return _recortar_priorizando_regulatorio(out, max_lineas)


def _formatear_con_cola_regulatoria(
    raw: str, max_chars: int, max_lineas: int, *, alternativa: bool = True
) -> list[str]:
    m = _RE_INICIO_REGULATORIO_AI.search(raw)
    if not m:
        return _formatear_descripcion_etiqueta_ai(
            raw, max_chars, max_lineas, compacto=True, alternativa=alternativa
        )

    cabeza = raw[: m.start()].strip()
    cola = raw[m.start() :].strip()
    cola_fmt = _formatear_descripcion_etiqueta_ai(
        cola, max_chars, max(6, max_lineas // 2), compacto=True, alternativa=alternativa
    )
    cola_fmt = [ln for ln in cola_fmt if ln.strip()]
    n_cola = len(cola_fmt)
    n_cabeza = max(4, max_lineas - n_cola - 1)
    cabeza_fmt = _formatear_descripcion_etiqueta_ai(
        cabeza, max_chars, n_cabeza, compacto=True, alternativa=alternativa
    )
    while cabeza_fmt and not cabeza_fmt[-1].strip():
        cabeza_fmt.pop()
    unido: list[str] = list(cabeza_fmt)
    if unido and cola_fmt:
        unido.append("")
    unido.extend(cola_fmt)
    return _recortar_priorizando_regulatorio(unido, max_lineas)


def _construir_bloque_descripcion_ai(
    meta: dict[str, Any], lineas: list[str], *, alternativa: bool = True
) -> str:
    from app.tools.etiquetas_svg_engine import (
        _debe_justificar_linea_descripcion,
        _escape_xml_text,
        _tspans_linea_descripcion,
    )

    tx, ty = float(meta["tx"]), float(meta["ty"])
    fs = float(meta["font_size"])
    lh = float(meta["line_height"])
    ff = meta.get("font_family") or _FUENTE_ETIQUETA
    fill = meta.get("fill") or "#000000"
    max_width = float(meta.get("max_width") or 0.0)

    tspans: list[str] = []
    first = True
    for i, ln in enumerate(lineas):
        if not alternativa:
            contenido = _escape_xml_text(ln.strip()) if ln.strip() else " "
            if first:
                tspans.append(f'<tspan x="0" y="0">{contenido}</tspan>')
                first = False
                continue
            dy = lh * (0.45 if not ln.strip() else 1.0)
            tspans.append(f'<tspan x="0" dy="{dy:.4f}">{contenido}</tspan>')
            continue

        justificar = max_width > 0 and _debe_justificar_linea_descripcion(ln)
        al_b1 = str(meta.get("alineacion_b1") or "justify").lower()
        if al_b1 != "justify":
            justificar = False
        tspans.extend(
            _tspans_linea_descripcion(
                ln,
                max_width=max_width,
                fs=fs,
                lh=lh,
                es_primera_del_bloque=first,
                justificar=justificar,
            )
        )
        if first:
            first = False

    anchor_map = {"left": "start", "center": "middle", "right": "end", "justify": "start"}
    al_b1 = str(meta.get("alineacion_b1") or "justify").lower()
    text_anchor = anchor_map.get(al_b1, "start")

    return (
        f'<text data-mckenna-campo="b1" transform="matrix(1,0,0,-1,{tx:.4f},{ty:.4f})" '
        f'text-anchor="{text_anchor}" '
        f'style="font-variant:normal;font-weight:normal;font-size:{fs}px;'
        f"font-stretch:normal;font-family:{ff};fill:{fill};"
        f'stroke:none;stroke-width:0.4">'
        f'{"".join(tspans)}</text>'
    )


def _b1_ancho_pct_efectivo(datos: dict) -> float:
    diag = datos.get("diagramacion")
    if isinstance(diag, dict):
        b1 = diag.get("b1")
        if isinstance(b1, dict) and b1.get("ancho_pct") is not None:
            try:
                pct = float(b1["ancho_pct"])
                return max(50.0, min(100.0, pct))
            except (TypeError, ValueError):
                pass
    try:
        raw = datos.get("b1_ancho_pct")
        pct = 100.0 if raw is None else float(raw)
    except (TypeError, ValueError):
        pct = 100.0
    return max(50.0, min(100.0, pct))


def _marcar_texto_campo_ai(svg: str, muestra: str, campo: str) -> str:
    """Añade data-mckenna-campo al <text> que contiene la muestra."""
    if not muestra or not campo:
        return svg
    fragmentos = [muestra]
    if len(muestra) > 24:
        fragmentos.append(muestra[:24])
    search_from = 0
    for frag in fragmentos:
        while True:
            idx = svg.find(frag, search_from)
            if idx < 0:
                break
            start = svg.rfind("<text", 0, idx)
            if start < 0:
                search_from = idx + 1
                continue
            end_text = svg.find("</text>", idx)
            if end_text < 0 or end_text < idx:
                search_from = idx + 1
                continue
            end_tag = svg.find(">", start)
            if end_tag < 0:
                return svg
            tag = svg[start : end_tag + 1]
            if f'data-mckenna-campo="{campo}"' in tag:
                return svg
            new_tag = tag[:-1] + f' data-mckenna-campo="{campo}"' + ">"
            return svg[:start] + new_tag + svg[end_tag + 1 :]
    return svg


def _texto_plano_bloque_text(inner: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", inner or "")).strip()


def _y_desde_tag_text(attrs: str) -> float:
    m = re.search(r'transform="matrix\(([^)]+)\)"', attrs or "")
    if not m:
        return 0.0
    return float(_parse_matrix_translate(m.group(1))[3])


def _es_bloque_texto_protegido(texto: str, y: float = 0.0) -> bool:
    """Cromo fijo de plantilla (marca, GHS, pie desarrollado). No incluye bloques legales editables."""
    t = (texto or "").strip()
    if not t or len(t) < 2:
        return True
    if y < 12:
        return True
    if _RE_RSN.match(t) or _RE_NIT.match(t):
        return True
    low = t.lower()
    if "desarrollado por" in low or "mckennagroup" in low:
        return True
    if t.startswith("Descarga ficha") or t.startswith("www."):
        return True
    if "BOGOTÁ" in t.upper() or "BOGOTA" in t.upper():
        return True
    if _es_texto_bloque_desarrollado(t):
        return True
    if t in {"GHS", "NO GHS", "MCKENNA GROUP", "MgO", "®"}:
        return True
    if re.fullmatch(r"MCKENNA\s+GROUP", t, re.I) or re.fullmatch(r"®", t):
        return True
    return False


def _inferir_campo_bloque_texto(texto: str, y: float = 0.0) -> str | None:
    t = (texto or "").strip()
    if not t:
        return None
    if t.startswith("# CAS"):
        return "cas"
    if t.startswith("Concentración:"):
        return "concentracion"
    if t.startswith("Fórmula molecular:"):
        return "formula"
    if _RE_PESO_TSPAN.match(t):
        return "peso"
    if t.lower().startswith(("incluye cuchara", "incluye copa")):
        return "cuchara"
    if re.match(r"^LOT\.?", t, re.I) or re.match(r"^EXP\.?", t, re.I):
        return "lote"
    if _RE_FRAG_ADVERTENCIA.search(t):
        return "legal"
    if t.startswith("•") and re.search(
        r"al[eé]rgica|digestivo|abrirlo|humedad|condiciones|envase|comedog",
        t,
        re.I,
    ):
        return "legal"
    if t.startswith("Reenvase de materia prima"):
        return "legal"
    if _es_titulo_producto_ai(t):
        return "titulo"
    if _es_subtitulo_corto_ai(t) and (
        "Materia prima" in t or "%" in t or "grado" in t.lower() or "esencial" in t.lower()
    ):
        return "subtitulo"
    if t.startswith("•") or t.startswith("Origen:"):
        return "b1"
    if y > 12 and not _es_metadata_campo_ai(t) and len(t) >= 4:
        return "b1"
    return None


def _campo_unico_diagramacion(base: str, usados: set[str]) -> str:
    if base not in usados:
        usados.add(base)
        return base
    n = 2
    while f"{base}_{n}" in usados:
        n += 1
    cid = f"{base}_{n}"
    usados.add(cid)
    return cid


def _inferir_campo_cromo_plantilla(texto: str) -> str | None:
    """Cromo fijo de plantilla (marca, GHS, pie legal) — también eliminable en el Studio."""
    t = (texto or "").strip()
    if not t:
        return None
    if t in {"GHS", "NO GHS"}:
        return "ghs"
    if re.fullmatch(r"MCKENNA\s+GROUP", t, re.I):
        return "marca"
    if t in {"®", "(R)", "R"}:
        return "marca_reg"
    if "desarrollado por" in t.lower() or (
        "MCKENNA GROUP" in t.upper() and "NIT" in t.upper()
    ):
        return "pie_distribuidor"
    return None


def _marcar_textos_restantes_ai(svg: str, muestras: dict[str, Any] | None = None) -> str:
    """Marca cada <text> que aún no tiene data-mckenna-campo (incluye cromo de plantilla)."""
    muestras = muestras or {}
    titulo = str(muestras.get("titulo") or "")
    subtitulo = str(muestras.get("subtitulo") or "")
    usados = {m.group(1) for m in re.finditer(r'data-mckenna-campo="([^"]+)"', svg)}
    txt_seq = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal txt_seq
        open_a, attrs, close, inner, end = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        if "data-mckenna-campo=" in attrs:
            return m.group(0)
        texto = _texto_plano_bloque_text(inner)
        if not texto or len(texto) < 1:
            return m.group(0)
        if texto == titulo or texto == subtitulo:
            return m.group(0)
        y = _y_desde_tag_text(attrs)
        cromo = _inferir_campo_cromo_plantilla(texto)
        if cromo:
            campo = _campo_unico_diagramacion(cromo, usados)
        else:
            base = _inferir_campo_bloque_texto(texto, y)
            if base:
                campo = _campo_unico_diagramacion(base, usados)
            else:
                campo = f"txt_{txt_seq}"
                txt_seq += 1
                usados.add(campo)
        sep = "" if attrs.startswith((" ", "\n", "\t")) or not attrs else " "
        return f'{open_a}{attrs}{sep}data-mckenna-campo="{campo}"{close}{inner}{end}'

    return _RE_TEXT_BLOCK.sub(repl, svg)


def _muestras_texto_desde_svg(svg: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in _RE_TEXT_BLOCK.finditer(svg):
        attrs, inner = m.group(2), m.group(4)
        cm = re.search(r'data-mckenna-campo="([^"]+)"', attrs)
        if not cm:
            continue
        campo = cm.group(1)
        if campo in out:
            continue
        texto = _texto_plano_bloque_text(inner)
        if texto:
            out[campo] = texto
    return out


def _insertar_attr_grafico(tag: str, gid: str) -> str:
    if "data-mckenna-grafico=" in tag:
        return tag
    ins = f' data-mckenna-grafico="{gid}"'
    if tag.rstrip().endswith("/>"):
        return tag.rstrip()[:-2] + ins + " />"
    if tag.endswith(">"):
        return tag[:-1] + ins + ">"
    return tag + ins


def _es_trazo_punteado(tag: str) -> bool:
    """Detecta líneas/recuadros guía con trazo punteado que no deben diagramarse."""
    low = tag.lower()
    if "stroke-dasharray" in low:
        # Excluimos cualquier dasharray distinto de "none"/vacío.
        m = re.search(r"stroke-dasharray\s*:\s*([^;'\"]+)", low)
        if m:
            val = m.group(1).strip()
            if val and val not in ("none", "0", "0,0"):
                return True
        m2 = re.search(r'stroke-dasharray\s*=\s*"([^"]+)"', low)
        if m2:
            val = m2.group(1).strip()
            if val and val not in ("none", "0", "0,0"):
                return True
    return False


def _ocultar_trazos_punteados_svg(svg: str) -> str:
    """Elimina elementos con stroke-dasharray para no mostrarlos en el escáner."""
    def _keep_or_drop(m: re.Match[str]) -> str:
        tag = m.group(0)
        return "" if _es_trazo_punteado(tag) else tag

    out = re.sub(r"<path\b[^>]*(?:/>|>)", _keep_or_drop, svg, flags=re.I)
    out = re.sub(r"<line\s[^>]*/?>", _keep_or_drop, out, flags=re.I)
    out = re.sub(r"<rect\s[^>]*/?>", _keep_or_drop, out, flags=re.I)
    return out


_GRAFICOS_EXCLUIDOS: set[str] = set()


def _quitar_graficos_excluidos_svg(svg: str) -> str:
    """Elimina por completo los gráficos excluidos del lienzo/preview."""
    if not _GRAFICOS_EXCLUIDOS:
        return svg

    def _drop_if_excluded(m: re.Match[str]) -> str:
        tag = m.group(0)
        gid_m = re.search(r'data-mckenna-grafico="(g\d+)"', tag)
        if gid_m and gid_m.group(1) in _GRAFICOS_EXCLUIDOS:
            return ""
        return tag

    out = re.sub(r"<path\b[^>]*(?:/>|>)", _drop_if_excluded, svg, flags=re.I)
    out = re.sub(r"<line\s[^>]*/?>", _drop_if_excluded, out, flags=re.I)
    out = re.sub(r"<rect\s[^>]*/?>", _drop_if_excluded, out, flags=re.I)
    out = re.sub(
        r'<g\b[^>]*>\s*(?:<path\b[^>]*data-mckenna-grafico="(?:g3)"[^>]*(?:/>|>)\s*)</g>',
        "",
        out,
        flags=re.I,
    )
    return out


def _es_grafico_arrastrable(tag: str) -> bool:
    if "data-mckenna-grafico=" in tag or "data-mckenna-campo=" in tag:
        return False
    if _es_trazo_punteado(tag):
        return False
    if re.search(
        r'id=["\']([^"\']*(?:mckenna-b1-guia|barcode|codigo.?barras))',
        tag,
        re.I,
    ):
        return False
    low = tag.lower()
    if "<rect" in low:
        wm = re.search(r'width="([0-9.]+)"', tag)
        hm = re.search(r'height="([0-9.]+)"', tag)
        if wm and hm:
            w, h = float(wm.group(1)), float(hm.group(1))
            if w > 160 and h > 160:
                return False
    return True


def _es_path_linea_diagramacion(tag: str) -> bool:
    """Path SVG que representa una línea recta (divisores de plantilla .ai)."""
    if not _es_grafico_arrastrable(tag):
        return False
    low = tag.lower()
    if "stroke" not in low:
        return False
    if re.search(
        r'id=["\']([^"\']*(?:barcode|codigo.?barras|g12|mckenna-b1-guia))',
        tag,
        re.I,
    ):
        return False
    if re.search(r"fill:(?!none)[^;'\"]+", low) and "fill:none" not in low:
        fm = re.search(r'fill="([^"]+)"', tag, re.I)
        if not fm or fm.group(1).strip().lower() not in ("none", ""):
            return False
    dm = re.search(r'\bd="([^"]+)"', tag)
    if not dm:
        return False
    d = re.sub(r"\s+", " ", dm.group(1).strip())
    if re.search(r"[CcSsQqAaZz]", d):
        return False
    if re.match(r"^[Mm]\s*[-\d.]+\s*,?\s*[-\d.]+\s+[HhVv]\s*[-\d.]+$", d):
        return True
    if re.match(r"^[Mm]\s*[-\d.]+\s*,?\s*[-\d.]+\s+[Ll]\s*[-\d.]+\s*,?\s*[-\d.]+$", d):
        return True
    return False


def _marcar_lineas_diagramacion_ai(svg: str) -> str:
    """Marca líneas rectas (<line> o <path> con trazo) para diagramación de plantillas."""
    idx = 0

    def mark(m: re.Match[str]) -> str:
        nonlocal idx
        tag = m.group(0)
        low = tag.lower()
        if low.startswith("<path") and not _es_path_linea_diagramacion(tag):
            return tag
        if low.startswith("<line") and not _es_grafico_arrastrable(tag):
            return tag
        gid = f"g{idx}"
        idx += 1
        return _insertar_attr_grafico(tag, gid)

    out = re.sub(r"<line\s[^>]*/?>", mark, svg, flags=re.I)
    out = re.sub(r"<path\b[^>]*(?:/>|>)", mark, out, flags=re.I)
    return out


def _marcar_graficos_diagramacion_ai(svg: str) -> str:
    """Marca líneas y recuadros decorativos para arrastrar en el Studio."""
    idx = 0

    def mark(m: re.Match[str]) -> str:
        nonlocal idx
        tag = m.group(0)
        if not _es_grafico_arrastrable(tag):
            return tag
        gid = f"g{idx}"
        idx += 1
        return _insertar_attr_grafico(tag, gid)

    out = re.sub(r"<line\s[^>]*/?>", mark, svg, flags=re.I)
    out = re.sub(r"<rect\s[^>]*/?>", mark, out, flags=re.I)
    return out


def _offset_attr_tag(tag: str, attr: str, delta: float) -> str:
    m = re.search(rf'({attr})="([0-9.+-]+)"', tag)
    if not m:
        return tag
    v = float(m.group(2)) + delta
    return tag.replace(m.group(0), f'{m.group(1)}="{v:.4f}"', 1)


def _aplicar_offset_grafico_tag(tag: str, dx: float, dy: float) -> str:
    low = tag.lower()
    if low.startswith("<line"):
        out = tag
        for a in ("x1", "y1", "x2", "y2"):
            out = _offset_attr_tag(out, a, dx if a.startswith("x") else dy)
        return out
    if low.startswith("<rect"):
        out = _offset_attr_tag(tag, "x", dx)
        return _offset_attr_tag(out, "y", dy)
    if low.startswith("<path"):
        tr = f"translate({dx:.4f},{dy:.4f})"
        m = re.search(r'\btransform="([^"]+)"', tag)
        if m:
            nueva = f'transform="{tr} {m.group(1)}"'
            return tag.replace(m.group(0), nueva, 1)
        ins = f' transform="{tr}"'
        if tag.rstrip().endswith("/>"):
            return tag.rstrip()[:-2] + ins + " />"
        return tag.replace("<path", "<path" + ins, 1)
    return tag


def _aplicar_graficos_diagramacion_ai(svg: str, datos: dict) -> str:
    graficos = datos.get("diagramacion_graficos")
    if not isinstance(graficos, dict) or not graficos:
        return svg
    out = svg
    for gid, cfg in graficos.items():
        if gid in _GRAFICOS_EXCLUIDOS:
            continue
        if not isinstance(cfg, dict):
            continue
        try:
            dx = float(cfg.get("x") or 0)
            dy = float(cfg.get("y") or 0)
        except (TypeError, ValueError):
            continue
        if abs(dx) < 0.001 and abs(dy) < 0.001:
            continue
        marker = f'data-mckenna-grafico="{gid}"'
        pos = 0
        while True:
            idx = out.find(marker, pos)
            if idx < 0:
                break
            start = out.rfind("<", 0, idx)
            end = out.find(">", idx)
            if start < 0 or end < 0:
                break
            tag = out[start : end + 1]
            nuevo = _aplicar_offset_grafico_tag(tag, dx, dy)
            out = out[:start] + nuevo + out[end + 1 :]
            pos = start + len(nuevo)
    return out


def _marcar_campos_diagramacion_ai(svg: str, muestras: dict[str, Any], datos: dict) -> str:
    out = svg
    for campo, key in (
        ("titulo", "titulo"),
        ("subtitulo", "subtitulo"),
        ("cas", "cas_linea"),
        ("concentracion", "concentracion"),
        ("formula", "formula"),
        ("peso", "peso"),
        ("cuchara", "cuchara"),
    ):
        muestra = muestras.get(key)
        if muestra:
            out = _marcar_texto_campo_ai(out, muestra, campo)

    sub_datos = (datos.get("subtitulo") or "").strip()
    if sub_datos and f'data-mckenna-campo="subtitulo"' not in out:
        out = _marcar_texto_campo_ai(out, sub_datos[: min(32, len(sub_datos))], "subtitulo")

    if 'data-mckenna-campo="legal"' not in out and 'id="mckenna-bloque-legal"' in out:
        out = re.sub(
            r'(<g id="mckenna-bloque-legal">[\s\S]*?<text)(\s)',
            r'\1 data-mckenna-campo="legal"\2',
            out,
            count=1,
        )

    if 'data-mckenna-campo="lote"' not in out:
        m_lote = re.search(r"(LOT\.[^<]{0,40})", out)
        if m_lote:
            out = _marcar_texto_campo_ai(out, m_lote.group(1), "lote")
        elif 'id="mckenna-lote-vencimiento"' in out:
            out = re.sub(
                r'(<g id="mckenna-lote-vencimiento">[\s\S]*?<text)(\s)',
                r'\1 data-mckenna-campo="lote"\2',
                out,
                count=1,
            )

    if (
        'data-mckenna-campo="codigo_verificacion"' not in out
        and 'id="mckenna-codigo-verificacion"' in out
    ):
        out = re.sub(
            r'(<g id="mckenna-codigo-verificacion">[\s\S]*?<text)(\s)',
            r'\1 data-mckenna-campo="codigo_verificacion"\2',
            out,
            count=1,
        )

    return out


def _aplicar_xy_color_campo_tag(tag: str, cfg: dict[str, Any]) -> str:
    out = tag
    color = cfg.get("color")
    if isinstance(color, str) and re.match(r"^#[0-9A-Fa-f]{6}$", color.strip()):
        c = color.strip()
        if "fill:" in out:
            out = re.sub(r"fill:[^;'\"]+", f"fill:{c}", out)
        elif 'fill="' in out:
            out = re.sub(r'fill="[^"]*"', f'fill="{c}"', out)
        else:
            out = out.replace("<text", f'<text fill="{c}"', 1)

    al = cfg.get("alineacion")
    if isinstance(al, str):
        anchor_map = {"left": "start", "center": "middle", "right": "end", "justify": "start"}
        anchor = anchor_map.get(al.strip().lower())
        if anchor:
            if 'text-anchor="' in out:
                out = re.sub(r'text-anchor="[^"]*"', f'text-anchor="{anchor}"', out)
            elif "text-anchor:" in out:
                out = re.sub(r"text-anchor:[^;'\"]+", f"text-anchor:{anchor}", out)
            else:
                out = out.replace("<text", f'<text text-anchor="{anchor}"', 1)

    x = cfg.get("x")
    y = cfg.get("y")
    if x is not None or y is not None:
        m = re.search(r'transform="matrix\(([^)]+)\)"', out)
        if m:
            nums = [float(n) for n in re.findall(r"[-+]?\d*\.?\d+", m.group(1))]
            if len(nums) >= 6:
                if x is not None:
                    nums[4] = float(x)
                if y is not None:
                    nums[5] = float(y)
                nueva = (
                    f'transform="matrix({nums[0]},{nums[1]},{nums[2]},'
                    f"{nums[3]},{nums[4]},{nums[5]})\""
                )
                out = out[: m.start()] + nueva + out[m.end() :]
    return out


def _aplicar_escala_bloque_texto(bloque: str, escala: float) -> str:
    escala = max(0.6, min(1.8, float(escala)))

    def _fs_style(m: re.Match[str]) -> str:
        return f"font-size:{float(m.group(1)) * escala:.3f}px"

    def _fs_attr(m: re.Match[str]) -> str:
        return f'font-size="{float(m.group(1)) * escala:.3f}px"'

    def _dy(m: re.Match[str]) -> str:
        return f'dy="{float(m.group(1)) * escala:.3f}"'

    out = re.sub(r"font-size:([0-9.]+)px", _fs_style, bloque)
    out = re.sub(r'font-size="([0-9.]+)px"', _fs_attr, out)
    out = re.sub(r'dy="([0-9.]+)"', _dy, out)
    return out


def _normalizar_lineas_texto_cfg(texto: str, cfg: dict[str, Any]) -> list[str]:
    lineas = [ln.strip() for ln in (texto or "").split("\n")]
    lineas = [ln for ln in lineas if ln]
    if cfg.get("mayusculas"):
        lineas = [ln.upper() for ln in lineas]
    if cfg.get("listado"):
        lineas = [ln if ln.startswith("• ") else f"• {ln}" for ln in lineas]
    return lineas or [""]


def _partir_texto_por_ancho(linea: str, fs: float, ancho_max: float) -> list[str]:
    if not linea.strip() or ancho_max <= 0 or fs <= 0:
        return [linea]
    # Aproximación compatible con Montserrat: ancho medio por carácter.
    max_chars = max(6, int(ancho_max / max(1.0, fs * 0.52)))
    palabras = linea.split()
    if not palabras:
        return [linea]
    out: list[str] = []
    cur = palabras[0]
    for p in palabras[1:]:
        cand = f"{cur} {p}"
        if len(cand) <= max_chars:
            cur = cand
        else:
            out.append(cur)
            cur = p
    out.append(cur)
    return out or [linea]


def _envolver_lineas_caja_texto(lineas: list[str], fs: float, ancho_max: float) -> list[str]:
    out: list[str] = []
    for ln in lineas:
        out.extend(_partir_texto_por_ancho(ln, fs, ancho_max))
    return out or [""]


def _aplicar_estilo_tipografico_bloque_texto(bloque: str, cfg: dict[str, Any]) -> str:
    out = bloque
    interlineado = cfg.get("interlineado")
    if interlineado is not None:
        try:
            mult = max(0.6, min(2.2, float(interlineado)))
            out = re.sub(
                r'dy="([0-9.]+)"',
                lambda m: f'dy="{float(m.group(1)) * mult:.3f}"',
                out,
            )
        except (TypeError, ValueError):
            pass
    interletrado = cfg.get("interletrado")
    if interletrado is not None:
        try:
            ls = max(-1.5, min(8.0, float(interletrado)))
            if "letter-spacing:" in out:
                out = re.sub(r"letter-spacing:[^;'\"]+", f"letter-spacing:{ls:.3f}px", out)
            else:
                out = out.replace("stroke-width:0.4;", f"stroke-width:0.4;letter-spacing:{ls:.3f}px;", 1)
        except (TypeError, ValueError):
            pass
    if cfg.get("mayusculas") or cfg.get("listado"):
        lineas: list[str] = []
        for m in re.finditer(r"<tspan\b[^>]*>(.*?)</tspan>", out, re.S | re.I):
            txt = re.sub(r"<[^>]+>", "", m.group(1) or "").strip()
            if txt:
                lineas.append(txt)
        if lineas:
            lineas_cfg = _normalizar_lineas_texto_cfg("\n".join(lineas), cfg)
            tspans = re.findall(r"(<tspan\b[^>]*>)(.*?)(</tspan>)", out, re.S | re.I)
            if tspans:
                reemplazos: list[str] = []
                for i, (opn, _mid, cls) in enumerate(tspans):
                    txt = lineas_cfg[min(i, len(lineas_cfg) - 1)]
                    reemplazos.append(f"{opn}{txt}{cls}")
                out = re.sub(
                    r"<tspan\b[^>]*>.*?</tspan>",
                    lambda _m, it=iter(reemplazos): next(it),
                    out,
                    count=len(reemplazos),
                    flags=re.S | re.I,
                )
    return out


def _inyectar_campos_texto_extra_ai(svg: str, datos: dict) -> str:
    diag = datos.get("diagramacion")
    textos = datos.get("textos_campo")
    if not isinstance(diag, dict) or not isinstance(textos, dict):
        return svg
    extras: list[str] = []
    for campo, cfg in diag.items():
        if not (isinstance(campo, str) and campo.startswith("txt_") and isinstance(cfg, dict)):
            continue
        if cfg.get("visible") is False:
            continue
        texto = str(textos.get(campo) or "").strip()
        if not texto:
            continue
        x = float(cfg.get("x") or 20)
        y = float(cfg.get("y") or 40)
        color = str(cfg.get("color") or "#111111")
        escala = float(cfg.get("escala") or 1.0)
        fs = max(7.0, min(40.0, 9.0 * escala))
        anchor_map = {"left": "start", "center": "middle", "right": "end", "justify": "start"}
        anchor = anchor_map.get(str(cfg.get("alineacion") or "left"), "start")
        lineas = _normalizar_lineas_texto_cfg(texto, cfg)
        try:
            ancho_caja = float(cfg.get("ancho_caja") or 0.0)
        except (TypeError, ValueError):
            ancho_caja = 0.0
        try:
            alto_caja = float(cfg.get("alto_caja") or 0.0)
        except (TypeError, ValueError):
            alto_caja = 0.0
        if campo.startswith("txt_") and ancho_caja > 0:
            lineas = _envolver_lineas_caja_texto(lineas, fs, ancho_caja)
            if alto_caja > 0:
                lh = fs * max(0.6, min(2.2, float(cfg.get("interlineado") or 1.12)))
                max_lineas = max(1, int(alto_caja / max(1.0, lh)))
                lineas = lineas[:max_lineas]
        tspans: list[str] = []
        for i, ln in enumerate(lineas):
            if i == 0:
                tspans.append(f'<tspan x="0" y="0">{ln}</tspan>')
            else:
                dy = fs * 1.12
                tspans.append(f'<tspan x="0" dy="{dy:.3f}">{ln}</tspan>')
        bloque = (
            f'<text data-mckenna-campo="{campo}" transform="matrix(1,0,0,-1,{x:.4f},{y:.4f})" '
            f'text-anchor="{anchor}" '
            f'style="font-variant:normal;font-weight:normal;font-size:{fs:.3f}px;'
            f'font-stretch:normal;font-family:{_FUENTE_ETIQUETA};fill:{color};stroke:none;stroke-width:0.4;">'
            f'{"".join(tspans)}</text>'
        )
        bloque = _aplicar_estilo_tipografico_bloque_texto(bloque, cfg)
        extras.append(bloque)
    if not extras:
        return svg
    # Renderiza los textos extra en una capa superior (frente) pero con el mismo
    # transform base de la plantilla, para evitar que queden en "fondo" y para
    # conservar coordenadas/orientación consistentes con el arte AI/PDF.
    gm = _RE_GRUPO_PLANTILLA.search(svg)
    tr = ""
    if gm:
        mtr = re.search(r'transform="([^"]+)"', gm.group(0), re.I)
        if mtr:
            tr = mtr.group(1)
    bloque_textos = "".join(extras)
    if tr:
        bloque_textos = f'<g transform="{tr}">{bloque_textos}</g>'
    return svg.replace("</svg>", bloque_textos + "</svg>")


def _aplicar_diagramacion_ai(svg: str, datos: dict) -> str:
    diag = datos.get("diagramacion")
    if not isinstance(diag, dict) or not diag:
        return svg
    out = svg
    for campo, cfg in diag.items():
        if not isinstance(cfg, dict):
            continue
        marker = f'data-mckenna-campo="{campo}"'
        pos = 0
        while True:
            idx = out.find(marker, pos)
            if idx < 0:
                break
            start = out.rfind("<text", 0, idx)
            end = out.find("</text>", idx)
            if start < 0 or end < 0:
                pos = idx + len(marker)
                continue
            end += len("</text>")
            tag_end = out.find(">", start)
            if tag_end < 0:
                pos = idx + len(marker)
                continue
            if cfg.get("visible") is False:
                out = out[:start] + out[end:]
                if campo == "b1" or campo.startswith("b1_"):
                    out = _quitar_guia_b1_ai(out)
                pos = start
                continue
            tag = out[start : tag_end + 1]
            nuevo_tag = _aplicar_xy_color_campo_tag(tag, cfg)
            out = out[:start] + nuevo_tag + out[tag_end + 1 :]
            end = out.find("</text>", start) + len("</text>")
            if cfg.get("color"):
                c = str(cfg["color"])
                bloque = out[start:end]
                bloque = re.sub(r"fill:([^;'\"]+)", f"fill:{c}", bloque)
                bloque = re.sub(r'fill="[^"]*"', f'fill="{c}"', bloque)
                out = out[:start] + bloque + out[end:]
                end = start + len(bloque)
            escala = cfg.get("escala")
            if escala is not None:
                try:
                    bloque = out[start:end]
                    bloque = _aplicar_escala_bloque_texto(bloque, float(escala))
                    out = out[:start] + bloque + out[end:]
                    end = start + len(bloque)
                except (TypeError, ValueError):
                    pass
            bloque = out[start:end]
            bloque2 = _aplicar_estilo_tipografico_bloque_texto(bloque, cfg)
            if bloque2 != bloque:
                out = out[:start] + bloque2 + out[end:]
                end = start + len(bloque2)
            pos = end
    return _inyectar_campos_texto_extra_ai(out, datos)


def _quitar_guia_b1_ai(svg: str) -> str:
    return re.sub(
        r'<rect[^>]*\bid=["\']mckenna-b1-guia["\'][^>]*/>\s*',
        "",
        svg,
        flags=re.I,
    )


def _fragmento_guia_b1_ai(
    meta: dict[str, Any],
    lineas: list[str],
    *,
    ancho_pct: float = 100.0,
) -> str:
    tx = float(meta["tx"])
    ty = float(meta["ty"])
    lh = float(meta["line_height"])
    w = float(meta.get("max_width") or 90)
    w_full = float(meta.get("max_width_full") or w)
    piso = float(meta.get("piso_y") or 11.0)
    n = max(1, len([ln for ln in lineas if ln.strip() and ln.strip() != "•"]))
    h = max(lh * 1.15 * n, ty - piso)
    y_top = piso
    return (
        f'<rect id="mckenna-b1-guia" data-ancho-full="{w_full:.4f}" '
        f'data-ancho-pct="{ancho_pct:.1f}" '
        f'x="{tx:.4f}" y="{y_top:.4f}" width="{w:.4f}" height="{h:.4f}" '
        f'fill="none" stroke="none" opacity="0"/>'
    )

def _sustituir_bloque_descripcion_ai(
    svg: str,
    muestra: str,
    meta: dict[str, Any],
    lineas: list[str],
    *,
    alternativa: bool = True,
    ancho_pct: float = 100.0,
) -> tuple[str, int]:
    if not muestra or muestra not in svg:
        return svg, 0
    idx = svg.find(muestra)
    start = svg.rfind("<text", 0, idx)
    end = svg.find("</text>", idx)
    if start < 0 or end < 0:
        return svg, 0
    end += len("</text>")
    nuevo = _construir_bloque_descripcion_ai(meta, lineas, alternativa=alternativa)
    out = svg[:start] + nuevo + svg[end:]
    out = _quitar_guia_b1_ai(out)
    if alternativa:
        frag = _fragmento_guia_b1_ai(meta, lineas, ancho_pct=ancho_pct)
        out = out[: start + len(nuevo)] + frag + out[start + len(nuevo) :]
    return out, len([ln for ln in lineas if ln.strip()])


def _aplicar_descripcion_multiline_ai(
    svg: str,
    datos: dict,
    lineas: list[str],
    *,
    fiel: bool = True,
    alternativa: bool = True,
) -> tuple[str, int]:
    nuevo = (datos.get("descripcion_etiqueta") or "").strip()
    if not nuevo or not lineas:
        return svg, 0
    if _texto_es_copia_generica_polvo(nuevo) and _plantilla_sugiere_aceite(svg):
        return svg, 0
    if _plantilla_sugiere_aceite(svg) and len(lineas) >= 4:
        return svg, 0

    lineas_utiles = [ln for ln in lineas if ln.strip() and ln.strip() != "•"]
    if not lineas_utiles:
        return svg, 0

    meta = _meta_bloque_descripcion_ai(svg, lineas_utiles[0], texto_len=len(nuevo))
    if meta:
        ancho_pct = _b1_ancho_pct_efectivo(datos)
        max_w_full = float(meta["max_width"])
        meta["max_width_full"] = max_w_full
        meta["max_width"] = max_w_full * (ancho_pct / 100.0)
        diag = datos.get("diagramacion")
        if isinstance(diag, dict) and isinstance(diag.get("b1"), dict):
            al = diag["b1"].get("alineacion")
            if isinstance(al, str) and al.strip():
                meta["alineacion_b1"] = al.strip().lower()
        por_ancho = max(30, int(meta["max_width"] / max(meta["font_size"] * 0.56, 2.4)))
        meta["max_chars"] = max(32, min(por_ancho, 50))
        formateadas = _formatear_descripcion_etiqueta_ai(
            nuevo,
            int(meta["max_chars"]),
            int(meta["max_lines"]),
            alternativa=alternativa,
        )
        if formateadas:
            return _sustituir_bloque_descripcion_ai(
                svg,
                lineas_utiles[0],
                meta,
                formateadas,
                alternativa=alternativa,
                ancho_pct=ancho_pct,
            )

    # Fallback: reemplazo in-place línea a línea (plantillas sin bloque detectable)
    from app.tools.etiquetas_svg_engine import _reemplazar_texto_en_svg

    presupuestos = [len(ln) for ln in lineas_utiles]
    fragmentos = _distribuir_en_lineas(nuevo, presupuestos)
    out = svg
    count = 0
    for i, orig in enumerate(lineas_utiles):
        lim = len(orig)
        frag = (fragmentos[i] if i < len(fragmentos) else "")[:lim]
        if frag:
            out, n = _reemplazar_texto_en_svg(out, orig, frag, fiel=fiel, conservar_ancho=False)
            count += n
        elif not fiel:
            out, n = _reemplazar_texto_en_svg(out, orig, "", fiel=False, conservar_ancho=False)
            count += n
    return out, count


def _modo_etiqueta(datos: dict) -> str:
    v = (datos.get("modo_etiqueta") or datos.get("version") or "alternativa").strip().lower()
    return "original" if v == "original" else "alternativa"


def _reemplazar_subtitulo_alternativa(svg: str, muestra: str, nuevo: str) -> tuple[str, int]:
    from app.tools.etiquetas_svg_engine import _compactar_texto, _reemplazar_texto_en_svg

    if not muestra or not nuevo or muestra.strip() == nuevo.strip():
        return svg, 0
    lim = max(20, min(len(nuevo), int(len(muestra) * 1.12)))
    corto = _compactar_texto(nuevo, lim)
    return _reemplazar_texto_en_svg(svg, muestra, corto, fiel=False, conservar_ancho=True)


_RE_FORMULA_CHAR_AI = re.compile(
    r'<text\b[^>]*transform="matrix\(1,0,0,-1,([0-9.]+),16[0-6]\.[0-9]+\)"[^>]*>\s*'
    r'<tspan[^>]*>[^<]{1,2}</tspan>\s*</text>\s*',
    re.DOTALL,
)


def _quitar_formula_chars_ai(svg: str) -> str:
    """Quita nodos de un carácter de la fórmula molecular (C6H8O7, etc.)."""

    def _sub(m: re.Match[str]) -> str:
        try:
            x = float(m.group(1))
        except ValueError:
            return m.group(0)
        if 85.0 <= x <= 125.0:
            return ""
        return m.group(0)

    return _RE_FORMULA_CHAR_AI.sub(_sub, svg)


def _omitir_metadata_sensible_ai(svg: str, datos: dict, muestras: dict[str, Any]) -> str:
    from app.tools.etiquetas_svg_engine import _reemplazar_texto_en_svg

    out = svg
    if datos.get("mostrar_cas") is False:
        cas_m = muestras.get("cas_linea")
        if cas_m:
            out, _ = _reemplazar_texto_en_svg(out, cas_m, "", fiel=False)

    if datos.get("mostrar_formula_molecular") is False:
        if muestras.get("formula"):
            out, _ = _reemplazar_texto_en_svg(out, muestras["formula"], "", fiel=False, conservar_ancho=True)
        out = re.sub(r"<tspan[^>]*>Fórmula molecular:[^<]*</tspan>", "", out)
        out = _quitar_formula_chars_ai(out)
        out = re.sub(
            r'<text\b[^>]*transform="matrix\(1,0,0,-1,[0-9.]+,163\.8999\)"[^>]*>.*?</text>\s*',
            "",
            out,
            flags=re.DOTALL,
        )

    if datos.get("mostrar_concentracion") is False:
        conc_m = muestras.get("concentracion")
        if conc_m:
            out, _ = _reemplazar_texto_en_svg(out, conc_m, "", fiel=False)

    return out


def _inyectar_bloque_legal_ai(svg: str, datos: dict, spec: dict) -> str:
    if datos.get("mostrar_bloque_legal", True) is False:
        return svg
    if _svg_tiene_legal_embebido(svg):
        return svg
    from app.tools.etiquetas_svg_engine import _fragmento_legal

    frag = _fragmento_legal(spec, datos)
    if not frag:
        return svg
    idx = svg.rfind("</svg>")
    if idx == -1:
        return svg
    return svg[:idx] + frag + svg[idx:]


def _inyectar_codigo_verificacion_ai(svg: str, datos: dict, spec: dict) -> str:
    """Código corto de trazabilidad del lote vigente — sintético, igual que el
    bloque legal: nunca viene del .ai original, solo se inyecta si no está ya
    presente y hay un código para mostrar."""
    if (
        'data-mckenna-campo="codigo_verificacion"' in svg
        or 'id="mckenna-codigo-verificacion"' in svg
    ):
        return svg
    from app.tools.etiquetas_svg_engine import _fragmento_codigo_verificacion

    frag = _fragmento_codigo_verificacion(spec, datos)
    if not frag:
        return svg
    idx = svg.rfind("</svg>")
    if idx == -1:
        return svg
    return svg[:idx] + frag + svg[idx:]


_CORRECCIONES_TYPO_AI = (
    ("seste en perfectas", "esté en perfectas"),
    ("envase seste", "envase esté"),
)


def _corregir_typos_plantilla_ai(svg: str) -> str:
    out = svg
    for mal, bien in _CORRECCIONES_TYPO_AI:
        if mal in out:
            out = out.replace(mal, bien)
    return out


def _reemplazos_in_place_ai(datos: dict, muestras: dict[str, Any]) -> list[tuple[str, str]]:
    """Solo sustituye texto que ya existe en el .ai; no altera cajas ni posiciones."""
    from app.tools.etiquetas_svg_engine import _reemplazos_desde_datos, _valor_campo

    muestras_seguras = {
        k: v for k, v in muestras.items()
        if k not in ("descripcion_inicio", "_descripcion_lineas")
    }
    pares = _reemplazos_desde_datos(datos, {"muestras": muestras_seguras})
    out: list[tuple[str, str]] = []
    for muestra, valor in pares:
        if muestra.startswith("Desarrollado por:"):
            continue
        if _es_linea_protegida_ai(muestra) or _es_texto_bloque_desarrollado(muestra):
            continue
        titulo_muestra = muestras.get("titulo") or ""
        if muestra == titulo_muestra and any(m in muestra.upper() for m in _MARCAS_NO_TITULO):
            continue
        mlen = max(8, len(muestra))
        v = re.sub(r"\s+", " ", (valor or "").strip())
        limite = int(mlen * 1.55)
        if len(v) > limite:
            v = v[: max(1, limite - 1)].rsplit(" ", 1)[0].rstrip(" .,;:") + "…"
        out.append((muestra, v))

    tit_m = muestras.get("titulo")
    if tit_m and _es_titulo_producto_ai(tit_m):
        tit_nuevo = _titulo_compacto_para_ai(datos, tit_m)
        if tit_nuevo and tit_nuevo.upper() != tit_m.upper():
            out.append((tit_m, tit_nuevo))

    sub_m = muestras.get("subtitulo")
    if sub_m and _es_subtitulo_corto_ai(sub_m):
        sub_nuevo = _valor_campo(datos, "subtitulo")
        if (
            sub_nuevo
            and sub_nuevo.strip() != sub_m.strip()
            and _subtitulos_compatibles(sub_m, sub_nuevo)
            and not _texto_es_copia_generica_polvo(sub_nuevo)
        ):
            lim = max(len(sub_m), min(len(sub_nuevo), int(len(sub_m) * 1.4)))
            out.append((sub_m, sub_nuevo[:lim]))

    return out


def _aplicar_lote_exp_inplace(svg: str, datos: dict) -> str:
    """Actualiza LOT/EXP solo si la plantilla ya los trae en su sitio."""
    from app.tools.etiquetas_svg_engine import _lineas_lote_vencimiento

    if datos.get("mostrar_lote_vencimiento") is False:
        return svg
    lineas = _lineas_lote_vencimiento(datos)
    if not lineas:
        return svg
    out = svg
    placeholders = [
        "LOT.___________",
        "LOT. ___________",
        "LOT:___________",
        "EXP.___________",
        "EXP. ___________",
        "EXP:___________",
    ]
    if lineas[0] and any(p in out for p in placeholders[:3]):
        for p in placeholders[:3]:
            if p in out:
                out = out.replace(p, lineas[0], 1)
                break
    if len(lineas) > 1 and lineas[1] and any(p in out for p in placeholders[3:]):
        for p in placeholders[3:]:
            if p in out:
                out = out.replace(p, lineas[1], 1)
                break
    return out


def _detectar_muestras_ai(svg: str) -> dict[str, Any]:
    tspans = _tspans_detalle(svg)
    textos: list[str] = []
    for row in tspans:
        if row["text"] not in textos:
            textos.append(row["text"])

    muestras: dict[str, Any] = {}
    for t in textos:
        if t.startswith("# CAS:") or t.startswith("# CAS :"):
            muestras["cas_linea"] = t
        elif t.startswith("Concentración:"):
            muestras["concentracion"] = t
        elif t.startswith("Fórmula molecular:"):
            muestras["formula"] = t
        elif _RE_PESO_TSPAN.match(t):
            muestras["peso"] = t
        elif t.lower().startswith(("incluye cuchara", "incluye copa")):
            muestras["cuchara"] = t

    candidatos_titulo = [
        (row["y"], row["text"])
        for row in tspans
        if _es_titulo_producto_ai(row["text"])
    ]
    if candidatos_titulo:
        candidatos_titulo.sort(key=lambda x: -x[0])
        muestras["titulo"] = candidatos_titulo[0][1]

    titulo = muestras.get("titulo", "")
    for row in sorted(tspans, key=lambda r: -r["y"]):
        t = row["text"]
        if t == titulo:
            continue
        if _es_subtitulo_corto_ai(t) and (
            "Materia prima" in t
            or "%" in t
            or "esencial" in t.lower()
            or "grado" in t.lower()
        ):
            muestras["subtitulo"] = t
            break

    subtitulo = muestras.get("subtitulo", "")
    desc_lineas = _seleccionar_lineas_descripcion(tspans, titulo, subtitulo)
    if desc_lineas:
        muestras["_descripcion_lineas"] = desc_lineas

    return muestras


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


def _b64_barcode_embebido(svg: str) -> str | None:
    m = re.search(
        r'id="g12"[^>]*>[\s\S]*?xlink:href="data:image/[^;]+;base64,([^"]+)"',
        svg,
        re.I,
    )
    if not m:
        m = re.search(r'xlink:href="data:image/[^;]+;base64,([^"]+)"', svg, re.I)
    return m.group(1) if m else None


def renderizar_desde_ai(datos: dict, ai_path: Path | None = None, modo: str | None = None) -> tuple[str, dict[str, Any]]:
    """
    Convierte .ai → SVG y sustituye datos in-place.
    modo=original: solo reemplazos mínimos (texto/barcode/lote).
    modo=alternativa: subtítulo MeLi-safe, descripción sanitizada, omite farmacológico.
    """
    from app.tools.etiquetas_svg_engine import (
        _aplicar_reemplazos_texto,
        _barcode_png_como_plantilla,
        _codigo_barras_valor,
        _lineas_lote_vencimiento,
        _normalizar_fuentes_svg_web,
        _spec_para_tipo,
        normalizar_datos_layout,
    )
    datos = normalizar_datos_layout(datos)
    modo_eff = (modo or _modo_etiqueta(datos)).strip().lower()
    if modo_eff not in {"original", "alternativa"}:
        modo_eff = "alternativa"

    path = ai_path or buscar_plantilla_ai(datos)
    if not path or not path.is_file():
        raise FileNotFoundError("No hay plantilla .ai para este producto y formato")

    svg = _ai_a_svg(path)
    muestras = _detectar_muestras_ai(svg)
    plantilla_bc = _b64_barcode_embebido(svg)
    tipo = (datos.get("tipo_etiqueta") or "250 g").strip()
    spec = _spec_para_tipo(tipo) or {}

    pares = _reemplazos_in_place_ai(datos, muestras)
    svg = _aplicar_reemplazos_texto(svg, pares, fiel=True)

    cambios_alternativa = 0
    desc_reemplazos = 0
    desc_recibida_chars = len((datos.get("descripcion_etiqueta") or "").strip())
    legal_inyectado = False
    if modo_eff == "alternativa":
        sub_m = muestras.get("subtitulo")
        sub_nuevo = (datos.get("subtitulo") or "").strip()
        debe_cambiar_sub = bool(
            sub_m
            and (
                "farmacol" in sub_m.lower()
                or "ph. eur" in sub_m.lower()
                or (sub_nuevo and sub_m.strip() != sub_nuevo.strip())
            )
        )
        if debe_cambiar_sub:
            destino = sub_nuevo if sub_nuevo and not _texto_es_copia_generica_polvo(sub_nuevo) else (
                "Insumo alimentario 100% puro · Res. 2674/2013 Art. 37-3"
            )
            svg, n = _reemplazar_subtitulo_alternativa(svg, sub_m, destino)
            cambios_alternativa += n

        desc_lineas = muestras.get("_descripcion_lineas") or []
        if desc_lineas and (datos.get("descripcion_etiqueta") or "").strip():
            # B1: justificación + ortografía tipográfica solo en propuesta alternativa MeLi
            svg, n = _aplicar_descripcion_multiline_ai(
                svg, datos, desc_lineas, fiel=False, alternativa=True
            )
            desc_reemplazos = n
            cambios_alternativa += n

        svg = _omitir_metadata_sensible_ai(svg, datos, muestras)
        antes_legal = svg
        svg = _inyectar_bloque_legal_ai(svg, datos, spec)
        legal_inyectado = svg != antes_legal

    svg = _aplicar_lote_exp_inplace(svg, datos)
    svg = _inyectar_codigo_verificacion_ai(svg, datos, spec)

    barcode_reemplazado = False
    valor_cb = _codigo_barras_valor(datos)
    if valor_cb and plantilla_bc:
        try:
            b64 = _barcode_png_como_plantilla(plantilla_bc, valor_cb)
            nuevo = _reemplazar_barcode_embebido(svg, b64)
            if nuevo != svg:
                svg = nuevo
                barcode_reemplazado = True
        except Exception:
            pass

    lineas_lv = _lineas_lote_vencimiento(datos) if "LOT." in svg or "EXP." in svg else []
    meta = {
        "fuente": "ai",
        "modo": f"ai_{modo_eff}",
        "tipo_etiqueta": tipo,
        "archivo": path.name,
        "archivo_ai": path.name,
        "ancho_mm": spec.get("ancho_mm") or datos.get("ancho_mm"),
        "alto_mm": spec.get("alto_mm") or datos.get("alto_mm"),
        "reemplazos": len(pares),
        "cambios_alternativa": cambios_alternativa,
        "descripcion_recibida_chars": desc_recibida_chars,
        "descripcion_reemplazos": desc_reemplazos,
        "muestras_detectadas": list(muestras.keys()),
        "overlays_inyectados": legal_inyectado,
        "codigo_barras": valor_cb or None,
        "codigo_barras_reemplazado": barcode_reemplazado,
        "bloque_legal": _svg_tiene_legal_embebido(svg),
        "lote_vencimiento": lineas_lv if lineas_lv else None,
    }
    svg = _marcar_campos_diagramacion_ai(svg, muestras, datos)
    svg = _marcar_graficos_diagramacion_ai(svg)
    svg = _aplicar_diagramacion_ai(svg, datos)
    svg = _aplicar_graficos_diagramacion_ai(svg, datos)
    svg = _ajustar_svg_al_formato_impresion(svg, datos, meta)
    svg = _normalizar_fuentes_svg_web(svg)
    return svg, meta


def _ajustar_svg_al_formato_impresion(svg: str, datos: dict, meta: dict) -> str:
    """Recorta al arte de la etiqueta y lo centra en el marco mm del formato elegido."""
    tipo = (datos.get("tipo_etiqueta") or meta.get("tipo_etiqueta") or "250 g").strip()
    w_mm, h_mm = _dims_formato(tipo, datos.get("ancho_mm"), datos.get("alto_mm"))
    export_area = datos.get("export_area")
    if isinstance(export_area, list) and len(export_area) == 4:
        from app.tools.etiquetas_svg_engine import _ajustar_viewbox_export

        svg_work = _ajustar_viewbox_export(svg, {"export_area": export_area})
    else:
        svg_work, area_out = _recortar_svg_etiqueta_ai(svg)
        if area_out:
            meta["export_area"] = area_out
    meta["ancho_mm"] = w_mm
    meta["alto_mm"] = h_mm
    return _encajar_svg_en_marco_formato(svg_work, w_mm, h_mm)


_ESCALA_BASE_CAMPO: dict[str, float] = {
    "titulo": 12.0,
    "subtitulo": 6.8724,
    "b1": 4.5,
    "cas": 4.5,
    "concentracion": 4.5,
    "formula": 4.5,
    "peso": 11.0,
    "cuchara": 4.5,
    "legal": 2.0,
    "lote": 4.2,
}

_FORMATO_DIM_MM: dict[str, tuple[int, int]] = {
    "500 g": (76, 66),
    "250 g": (76, 66),
    "50g": (101, 32),
    "50 g": (101, 32),
    "30 mL": (101, 38),
    "50 mL": (101, 38),
    "1 Kg": (76, 66),
}

_REFERENCIA_AI_500G = "UREA 500g.ai"
_FUENTE_ETIQUETA = "Montserrat"


def _parse_matrix_transform(tag: str) -> tuple[float, float, float, float, float, float]:
    m = re.search(r'transform="matrix\(([^)]+)\)"', tag, re.I)
    if not m:
        return 1.0, 0.0, 0.0, 1.0, 0.0, 0.0
    nums = [float(n) for n in re.findall(r"[-+]?\d*\.?\d+", m.group(1))]
    if len(nums) >= 6:
        return nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]
    return 1.0, 0.0, 0.0, 1.0, 0.0, 0.0


def _inner_a_outer(
    xi: float,
    yi: float,
    a: float,
    b: float,
    c: float,
    d: float,
    e: float,
    f: float,
) -> tuple[float, float]:
    return a * xi + c * yi + e, b * xi + d * yi + f


def _detectar_export_area_ai(svg: str) -> list[float] | None:
    """Recorta al área de etiqueta (clipPath M 0,H H W V 0) en coords del SVG raíz."""
    m = re.search(r'd="M 0,([0-9.]+) H ([0-9.]+) V 0 H 0 Z"', svg)
    if not m:
        return None
    inner_h = float(m.group(1))
    inner_w = float(m.group(2))
    gm = _RE_GRUPO_PLANTILLA.search(svg)
    if not gm:
        return None
    a, b, c, d, e, f = _parse_matrix_transform(gm.group(0))
    xs: list[float] = []
    ys: list[float] = []
    for xi, yi in ((0.0, 0.0), (inner_w, 0.0), (0.0, inner_h), (inner_w, inner_h)):
        xo, yo = _inner_a_outer(xi, yi, a, b, c, d, e, f)
        xs.append(xo)
        ys.append(yo)
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    if x1 <= x0 or y1 <= y0:
        return None
    pad = 0.5
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]


def _recortar_svg_etiqueta_ai(svg: str) -> tuple[str, list[float] | None]:
    area = _detectar_export_area_ai(svg)
    if not area:
        return svg, None
    from app.tools.etiquetas_svg_engine import _ajustar_viewbox_export

    return _ajustar_viewbox_export(svg, {"export_area": area}), area


def _encajar_svg_en_marco_formato(svg: str, ancho_mm: float, alto_mm: float) -> str:
    """Centra el arte recortado dentro del marco del formato de impresión (mm)."""
    m = re.search(r'viewBox="([^"]+)"', svg)
    if not m:
        return svg
    parts = [float(x) for x in re.split(r"[\s,]+", m.group(1).strip()) if x]
    if len(parts) != 4:
        return svg
    x0, y0, aw, ah = parts
    if aw <= 0 or ah <= 0 or ancho_mm <= 0 or alto_mm <= 0:
        return svg
    scale = min(ancho_mm / aw, alto_mm / ah)
    ox = (ancho_mm - aw * scale) / 2.0
    oy = (alto_mm - ah * scale) / 2.0
    open_m = re.search(r"(<svg[^>]*>)", svg, re.I | re.S)
    if not open_m:
        return svg
    close_idx = svg.rfind("</svg>")
    if close_idx < 0:
        return svg
    inner = svg[open_m.end() : close_idx]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {ancho_mm:.4f} {alto_mm:.4f}" '
        f'width="{ancho_mm:.4f}mm" height="{alto_mm:.4f}mm" '
        f'preserveAspectRatio="xMidYMid meet">'
        f'<g transform="translate({ox:.4f},{oy:.4f}) scale({scale:.6f}) '
        f'translate({-x0:.4f},{-y0:.4f})">{inner}</g></svg>'
    )


def _dims_formato(
    tipo: str,
    ancho_mm: float | int | None = None,
    alto_mm: float | int | None = None,
) -> tuple[float, float]:
    if ancho_mm and alto_mm:
        try:
            w, h = float(ancho_mm), float(alto_mm)
            if w > 0 and h > 0:
                return w, h
        except (TypeError, ValueError):
            pass
    fb = _FORMATO_DIM_MM.get((tipo or "").strip(), (76, 66))
    return float(fb[0]), float(fb[1])


def _es_plantilla_pdf(archivo: str) -> bool:
    a = (archivo or "").strip().lower()
    return a.endswith(".pdf") or a.startswith("pdf/") or a.endswith(".svg")


def _svg_preview_diagramacion(
    svg: str,
    datos: dict,
    *,
    solo_lineas: bool = False,
    vista_completa: bool = False,
) -> str:
    """SVG marcado con diagramación aplicada para vista canvas."""
    if solo_lineas and vista_completa:
        out = svg if "data-mckenna-grafico=" in svg else _marcar_lineas_diagramacion_ai(svg)
        out = _ocultar_trazos_punteados_svg(out)
        out = _quitar_graficos_excluidos_svg(out)
        out = _aplicar_diagramacion_ai(out, datos)
        out = _aplicar_graficos_diagramacion_ai(out, datos)
        return out
    out = _marcar_lineas_diagramacion_ai(svg) if solo_lineas else _marcar_graficos_diagramacion_ai(svg)
    if solo_lineas:
        out = _ocultar_textos_svg_diagramacion(out)
        out = _quitar_graficos_excluidos_svg(out)
    out = _aplicar_diagramacion_ai(out, datos)
    out = _aplicar_graficos_diagramacion_ai(out, datos)
    if solo_lineas:
        out = _lienzo_solo_lineas_svg(out)
        out = _quitar_graficos_excluidos_svg(out)
    return out


def _norm_color_hex(val: str | None) -> str | None:
    if not val:
        return None
    v = val.strip()
    if re.match(r"^#[0-9A-Fa-f]{6}$", v):
        return v.upper()
    if re.match(r"^[0-9A-Fa-f]{6}$", v):
        return f"#{v.upper()}"
    return None


def _cfg_desde_bloque_text(svg: str, marker: str) -> dict[str, Any] | None:
    idx = svg.find(marker)
    if idx < 0:
        return None
    start = svg.rfind("<text", 0, idx)
    end = svg.find("</text>", idx)
    if start < 0 or end < 0:
        return None
    tag_end = svg.find(">", start)
    if tag_end < 0:
        return None
    tag = svg[start : tag_end + 1]
    bloque = svg[start : end + len("</text>")]
    campo_m = re.search(r'data-mckenna-campo="([^"]+)"', tag)
    campo = campo_m.group(1) if campo_m else ""

    cfg: dict[str, Any] = {}
    m = re.search(r'transform="matrix\(([^)]+)\)"', tag)
    if m:
        nums = [float(n) for n in re.findall(r"[-+]?\d*\.?\d+", m.group(1))]
        if len(nums) >= 6:
            cfg["x"] = round(nums[4], 4)
            cfg["y"] = round(nums[5], 4)

    sm = re.search(r"fill:([^;'\"]+)", tag) or re.search(r'fill="([^"]+)"', tag)
    if sm:
        c = _norm_color_hex(sm.group(1).strip())
        if c:
            cfg["color"] = c

    fs_m = re.search(r"font-size:([0-9.]+)px", bloque) or re.search(
        r'font-size="([0-9.]+)px"', bloque
    )
    if fs_m:
        fs = float(fs_m.group(1))
        base = _ESCALA_BASE_CAMPO.get(campo, fs)
        if base > 0:
            cfg["escala"] = round(max(0.6, min(1.8, fs / base)), 3)

    am = re.search(r'text-anchor="([^"]+)"', tag) or re.search(
        r"text-anchor:([^;'\"]+)", tag
    )
    if am:
        anchor_map = {"start": "left", "middle": "center", "end": "right"}
        cfg["alineacion"] = anchor_map.get(am.group(1).strip(), "left")

    return cfg or None


def _extraer_diagramacion_desde_svg(svg: str) -> dict[str, Any]:
    diagramacion: dict[str, Any] = {}
    for m in re.finditer(r'data-mckenna-campo="([^"]+)"', svg):
        campo = m.group(1)
        if campo in diagramacion:
            continue
        cfg = _cfg_desde_bloque_text(svg, m.group(0))
        if cfg:
            diagramacion[campo] = cfg

    b1 = diagramacion.get("b1")
    if isinstance(b1, dict):
        tx = float(b1.get("x") or 0)
        sep_x = _detectar_separador_x_ai(svg)
        if sep_x and tx:
            from app.tools.etiquetas_svg_engine import _MARGEN_DER_B1_ANTES_SEP

            util = sep_x - tx - _MARGEN_DER_B1_ANTES_SEP
            inner_w = 215.0
            b1["ancho_pct"] = round(max(50.0, min(100.0, util / inner_w * 100.0)), 1)

    return diagramacion


def _marcar_textos_diagramacion_ai(svg: str, muestras: dict[str, Any]) -> str:
    """Marca bloques de texto para diagramación completa (Studio por producto)."""
    out = _marcar_campos_diagramacion_ai(svg, muestras, {})
    desc_lineas = muestras.get("_descripcion_lineas") or []
    if desc_lineas and 'data-mckenna-campo="b1"' not in out:
        out = _marcar_texto_campo_ai(out, desc_lineas[0], "b1")
    if 'data-mckenna-campo="legal"' not in out:
        m_legal = re.search(r"(Reenvase de materia prima[^<]{0,80})", out, re.I)
        if m_legal:
            out = _marcar_texto_campo_ai(out, m_legal.group(1)[:40], "legal")
    return _marcar_textos_restantes_ai(out, muestras)


def _ocultar_textos_svg_diagramacion(svg: str) -> str:
    """Elimina bloques <text> del SVG (vista Plantillas solo líneas)."""
    return re.sub(r"<text\b[^>]*>.*?</text>", "", svg, flags=re.S | re.I)


def _tag_grafico_con_transform_padre(svg: str, idx: int) -> str:
    """Incluye el <g transform> padre del path/line marcado (PDF/Inkscape usan coords locales)."""
    tag_start = svg.rfind("<", 0, idx)
    if tag_start < 0:
        return ""
    tag_end = svg.find(">", idx)
    if tag_end < 0:
        return ""
    path_tag = svg[tag_start : tag_end + 1]

    ventana = svg[max(0, tag_start - 320) : tag_start]
    parent_m = re.search(
        r'<g\b[^>]*transform="([^"]+)"[^>]*>\s*$',
        ventana,
        re.I | re.S,
    )
    if not parent_m:
        return path_tag
    tr = parent_m.group(1).strip()
    if not tr:
        return path_tag
    return f'<g transform="{tr}">{path_tag}</g>'


def _lienzo_solo_lineas_svg(svg: str) -> str:
    """Vista escáner Plantillas: solo líneas marcadas sobre fondo blanco."""
    vm = re.search(r'viewBox="([^"]+)"', svg, re.I)
    viewbox = vm.group(1) if vm else "0 0 215 187"
    tags: list[str] = []
    pos = 0
    while True:
        idx = svg.find("data-mckenna-grafico=", pos)
        if idx < 0:
            break
        bloque = _tag_grafico_con_transform_padre(svg, idx)
        if bloque:
            tags.append(bloque)
        pos = idx + 1
    if not tags:
        return _ocultar_textos_svg_diagramacion(svg)
    bloque = "\n  ".join(tags)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" '
        f'width="100%" height="100%">'
        f'<rect width="100%" height="100%" fill="#ffffff"/>'
        f"\n  {bloque}\n</svg>"
    )


def _preparar_svg_diagramacion_plantilla(
    svg_raw: str,
    *,
    solo_lineas: bool,
    muestras: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Plantillas: solo líneas decorativas. Studio: textos + gráficos."""
    if solo_lineas:
        svg = _marcar_lineas_diagramacion_ai(svg_raw)
        return _ocultar_textos_svg_diagramacion(svg), {}
    eff = muestras if muestras is not None else _detectar_muestras_ai(svg_raw)
    svg = _marcar_textos_diagramacion_ai(svg_raw, eff)
    svg = _marcar_graficos_diagramacion_ai(svg)
    return svg, eff


def _extraer_graficos_offsets(svg: str) -> dict[str, Any]:
    return {
        gid: {"x": 0, "y": 0}
        for gid in re.findall(r'data-mckenna-grafico="(g\d+)"', svg)
        if gid not in _GRAFICOS_EXCLUIDOS
    }


def escanear_diagramacion_plantilla(
    *,
    archivo_ai: str | None = None,
    tipo_etiqueta: str = "500 g",
    ancho_mm: float | int | None = None,
    alto_mm: float | int | None = None,
    solo_lineas: bool = False,
    vista_completa: bool | None = None,
    textos_campo: dict | None = None,
) -> dict[str, Any]:
    """
    Lee posiciones de plantilla para diagramación por formato.
    solo_lineas=True (Plantillas): solo divisores/líneas editables.
    vista_completa=True (PDF): lienzo con todo el arte del modelo, no solo líneas.
    """
    tipo = (tipo_etiqueta or "500 g").strip()
    archivo = (archivo_ai or _REFERENCIA_AI_500G).strip()
    path = resolver_ruta_plantilla(archivo)
    archivo_id = _archivo_plantilla_id(path)
    vista_pdf = _es_plantilla_pdf(archivo_id) if vista_completa is None else bool(vista_completa)

    svg_raw = _plantilla_a_svg(path)
    if solo_lineas and vista_pdf:
        svg = _marcar_lineas_diagramacion_ai(svg_raw)
        muestras: dict[str, Any] = {}
    else:
        svg, muestras = _preparar_svg_diagramacion_plantilla(svg_raw, solo_lineas=solo_lineas)
    if solo_lineas:
        diagramacion: dict[str, Any] = {}
        muestras_pub: dict[str, str] = {}
    else:
        diagramacion = _extraer_diagramacion_desde_svg(svg)
        muestras_pub = {k: v for k, v in muestras.items() if not str(k).startswith("_")}
        for k, v in _muestras_texto_desde_svg(svg).items():
            muestras_pub.setdefault(k, v)
        desc_lineas = muestras.get("_descripcion_lineas") or []
        if desc_lineas:
            muestras_pub["descripcion"] = "\n".join(desc_lineas)
    diagramacion_graficos = _extraer_graficos_offsets(svg)
    w_mm, h_mm = _dims_formato(tipo, ancho_mm, alto_mm)

    svg_crop, export_area = _recortar_svg_etiqueta_ai(svg)
    datos_preview = {
        "diagramacion": diagramacion,
        "diagramacion_graficos": diagramacion_graficos,
        "textos_campo": textos_campo or {},
    }
    from app.tools.etiquetas_svg_engine import _normalizar_fuentes_svg_web

    svg_preview = _normalizar_fuentes_svg_web(
        _encajar_svg_en_marco_formato(
            _svg_preview_diagramacion(
                svg_crop,
                datos_preview,
                solo_lineas=solo_lineas,
                vista_completa=vista_pdf,
            ),
            w_mm,
            h_mm,
        )
    )

    return {
        "ok": True,
        "archivo_ai": archivo_id,
        "tipo_etiqueta": tipo,
        "ancho_mm": w_mm,
        "alto_mm": h_mm,
        "solo_lineas": solo_lineas,
        "vista_completa": vista_pdf,
        "diagramacion": diagramacion,
        "diagramacion_graficos": diagramacion_graficos,
        "muestras": muestras_pub,
        "campos_detectados": sorted(diagramacion.keys()),
        "graficos_detectados": sorted(diagramacion_graficos.keys()),
        "export_area": export_area,
        "svg": svg_preview,
    }


def preview_diagramacion_plantilla(
    *,
    archivo_ai: str,
    tipo_etiqueta: str = "500 g",
    diagramacion: dict | None = None,
    diagramacion_graficos: dict | None = None,
    muestras: dict | None = None,
    export_area: list[float] | None = None,
    ancho_mm: float | int | None = None,
    alto_mm: float | int | None = None,
    solo_lineas: bool = False,
    vista_completa: bool | None = None,
    textos_campo: dict | None = None,
) -> dict[str, Any]:
    """Regenera SVG recortado con diagramación guardada (vista canvas)."""
    archivo = (archivo_ai or _REFERENCIA_AI_500G).strip()
    path = resolver_ruta_plantilla(archivo)
    archivo_id = _archivo_plantilla_id(path)
    vista_pdf = _es_plantilla_pdf(archivo_id) if vista_completa is None else bool(vista_completa)

    tipo = (tipo_etiqueta or "500 g").strip()
    w_mm, h_mm = _dims_formato(tipo, ancho_mm, alto_mm)
    muestras_eff = muestras if isinstance(muestras, dict) else {}

    svg_raw = _plantilla_a_svg(path)
    if solo_lineas and vista_pdf:
        svg = _marcar_lineas_diagramacion_ai(svg_raw)
    else:
        svg, _ = _preparar_svg_diagramacion_plantilla(
            svg_raw,
            solo_lineas=solo_lineas,
            muestras=muestras_eff or None,
        )
    from app.tools.etiquetas_svg_engine import _ajustar_viewbox_export, _normalizar_fuentes_svg_web

    if isinstance(export_area, list) and len(export_area) == 4:
        svg_crop = _ajustar_viewbox_export(svg, {"export_area": export_area})
        area_out = export_area
    else:
        svg_crop, area_out = _recortar_svg_etiqueta_ai(svg)
    datos_preview = {
        "diagramacion": diagramacion or {},
        "diagramacion_graficos": diagramacion_graficos or {},
        "textos_campo": textos_campo or {},
    }
    svg_preview = _normalizar_fuentes_svg_web(
        _encajar_svg_en_marco_formato(
            _svg_preview_diagramacion(
                svg_crop,
                datos_preview,
                solo_lineas=solo_lineas,
                vista_completa=vista_pdf,
            ),
            w_mm,
            h_mm,
        )
    )

    return {
        "ok": True,
        "archivo_ai": archivo_id,
        "tipo_etiqueta": tipo,
        "ancho_mm": w_mm,
        "alto_mm": h_mm,
        "solo_lineas": solo_lineas,
        "vista_completa": vista_pdf,
        "export_area": area_out,
        "svg": svg_preview,
    }
