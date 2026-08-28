#!/usr/bin/env python3
"""Convierte la referencia de diseño aprobada
(nueva-etiqueta/propuesta_etiqueta_creatina_v6_fiel_foto.svg) en una
plantilla del sistema clásico (app/data/plantillas_visuales.json), para que
se edite con el mismo editor (VisualCanvasEditor) que todo lo demás — mismo
orden y contenido de secciones que ese SVG, elemento por elemento.

Los íconos (campo + pie de página) se guardan como SVG embebido (no
rasterizado) con el color en hex explícito — así "Colores" del editor
(reemplazarHexEnSvgDataUrl) los detecta y recolorea igual que cualquier
texto/línea/rect de la plantilla.

Uso:
    source venv/bin/activate
    python3 scripts/migrar_etiqueta_nueva_a_plantilla_visual.py "CREATINA MONOHIDRATO 500g"
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

from app.tools.plantillas_visuales import _fuente_raster  # noqa: E402 — mismas fuentes/medidor que exportar_raster()

_MEDIDOR_TEXTO = None


def ancho_texto_real(texto: str, weight: str, tamano_px: float) -> float:
    """Ancho real del texto con la misma fuente/medidor que usa
    exportar_raster() (PIL) — mucho más preciso que estimarlo por conteo de
    caracteres, que sistemáticamente sub/sobre-estimaba según el string."""
    global _MEDIDOR_TEXTO
    if _MEDIDOR_TEXTO is None:
        from PIL import Image, ImageDraw

        _MEDIDOR_TEXTO = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    escala = 8  # medir a resolución más alta y escalar de vuelta: subpíxel más fiel
    fnt = _fuente_raster(weight, max(4, round(tamano_px * escala)))
    return _MEDIDOR_TEXTO.textlength(texto, font=fnt) / escala
RUTA_REFERENCIA = os.path.join(RAIZ, "nueva-etiqueta", "propuesta_etiqueta_creatina_v6_fiel_foto.svg")
RUTA_LOGO = os.path.join(RAIZ, "nueva-etiqueta", "logo_mckenna_navy.png")
PLANTILLAS_JSON = os.path.join(RAIZ, "app", "data", "plantillas_visuales.json")

NS = "{http://www.w3.org/2000/svg}"
XLINK = "{http://www.w3.org/1999/xlink}"


def nuevo_id() -> str:
    return f"{uuid.uuid4().hex[:8]}-{uuid.uuid4().hex[:3]}"


def svg_embebido(svg_fragmento: str, w: float, h: float, estilos_css: str = "") -> str:
    """Envuelve un fragmento SVG como data URI SVG (no rasteriza). Si el
    fragmento usa clases CSS (class="stroke-blue"), hay que pasarle el <style>
    original — si no, esas clases no resuelven a ningún color al renderizar
    fuera de contexto."""
    defs = f"<defs><style>{estilos_css}</style></defs>" if estilos_css else ""
    doc = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}">{defs}{svg_fragmento}</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(doc.encode("utf-8")).decode("ascii")


def normalizar_hex(color: str | None) -> str | None:
    """Expande el atajo CSS de 3 dígitos (#fff) a 6 (#ffffff). reportlab
    (exportar_pdf) no soporta la forma corta — HexColor("#fff") no falla,
    pero la interpreta mal y pinta la página entera de azul."""
    if not color:
        return color
    c = color.strip()
    if len(c) == 4 and c[0] == "#" and all(ch in "0123456789abcdefABCDEF" for ch in c[1:]):
        return "#" + "".join(ch * 2 for ch in c[1:])
    return color


def parse_css_declaraciones(texto: str) -> dict[str, str]:
    """'font-size:22px;font-weight:700;fill:white;' -> {"font-size": "22px", ...}"""
    out: dict[str, str] = {}
    for decl in texto.split(";"):
        if ":" not in decl:
            continue
        k, v = decl.split(":", 1)
        out[k.strip()] = v.strip()
    return out


def parse_css_clases(bloque_style: str) -> dict[str, dict[str, str]]:
    """'.cls { prop:val; } .cls2 {...}' -> {"cls": {"prop": "val", ...}, ...}"""
    clases: dict[str, dict[str, str]] = {}
    for m in re.finditer(r"\.([\w-]+)\s*\{([^}]*)\}", bloque_style):
        clases[m.group(1)] = parse_css_declaraciones(m.group(2))
    return clases


def px_desde_css(valor: str | None, default: float = 16) -> float:
    if not valor:
        return default
    m = re.match(r"[\-\d.]+", valor.strip())
    return float(m.group()) if m else default


class ConversorEtiquetaNueva:
    def __init__(self, ancho_mm: float, alto_mm: float, canvas_w: float = 1000, canvas_h: float = 660, dpi: int = 96):
        self.dpi = dpi
        self.canvas_w = canvas_w
        self.sx = (ancho_mm / canvas_w) * (dpi / 25.4)
        self.sy = (alto_mm / canvas_h) * (dpi / 25.4)
        self.ancho_px = round(ancho_mm * dpi / 25.4)
        self.alto_px = round(alto_mm * dpi / 25.4)
        self.elementos: list[dict] = []
        self.z = 0

    def px_x(self, v: float) -> float:
        return v * self.sx

    def px_y(self, v: float) -> float:
        return v * self.sy

    def _z(self) -> int:
        self.z += 1
        return self.z

    def agregar_rect(self, x, y, w, h, fill="none", stroke=None, stroke_w=0, radius=0, rotation=0):
        self.elementos.append({
            "id": nuevo_id(), "type": "rect", "zIndex": self._z(),
            "x": self.px_x(x), "y": self.px_y(y),
            "width": self.px_x(w), "height": self.px_y(h),
            "rotation": rotation,
            "fill": normalizar_hex(fill), "stroke": normalizar_hex(stroke) or "transparent",
            "strokeWidth": self.px_y(stroke_w), "borderRadius": self.px_y(radius),
            "visible": True,
        })

    def agregar_linea(self, x1, y1, x2, y2, stroke, stroke_w):
        self.elementos.append({
            "id": nuevo_id(), "type": "line", "zIndex": self._z(),
            "x": self.px_x(x1), "y": self.px_y(y1),
            "x2": self.px_x(x2), "y2": self.px_y(y2),
            "width": self.px_x(x2 - x1), "height": self.px_y(y2 - y1),
            "rotation": 0, "stroke": normalizar_hex(stroke), "strokeWidth": self.px_y(stroke_w),
            "visible": True,
        })

    def agregar_texto(self, x, y, font_size, texto, color="#000", weight="400",
                       align="left", family='"Montserrat", Arial, sans-serif',
                       limite_derecho_canvas=None):
        fs = self.px_y(font_size)
        # Factor generoso (ancho real de Montserrat en negrita/normal a este
        # tamaño) para que el editor nunca necesite envolver una línea que en
        # el SVG original ya estaba pensada para caber en una sola línea.
        ancho_caja = max(fs * 1.5, ancho_texto_real(texto, str(weight), fs) * 1.06 + fs * 1.4)

        def _x_caja(ancho: float) -> float:
            if align == "center":
                return self.px_x(x) - ancho / 2
            if align == "right":
                return self.px_x(x) - ancho
            return self.px_x(x)

        x_caja = _x_caja(ancho_caja)
        # Si a este tamaño la caja se sale del lienzo — o de un límite local
        # explícito, p. ej. el borde de su propia columna en una tabla — se
        # reduce la tipografía en proporción en vez de que quede recortada.
        borde = self.px_x(limite_derecho_canvas if limite_derecho_canvas is not None else self.canvas_w)
        margen = fs * 0.35
        sobrante = max(0.0, -(x_caja - margen)) + max(0.0, (x_caja + ancho_caja + margen) - borde)
        if sobrante > 0 and ancho_caja > 0:
            factor = max(0.35, 1 - sobrante / ancho_caja)
            fs *= factor
            ancho_caja *= factor
            x_caja = _x_caja(ancho_caja)
        self.elementos.append({
            "id": nuevo_id(), "type": "text", "zIndex": self._z(),
            "x": x_caja, "y": self.px_y(y) - fs * 0.82,
            "width": ancho_caja, "height": fs * 1.35,
            "rotation": 0, "content": texto, "color": normalizar_hex(color),
            "fontFamily": family, "fontSize": fs, "fontWeight": weight,
            "align": align, "lineHeight": 1.2, "textRole": None,
            "locked": False, "visible": True,
        })

    def agregar_imagen(self, x, y, w, h, src, rotation=0):
        self.elementos.append({
            "id": nuevo_id(), "type": "image", "zIndex": self._z(),
            "x": self.px_x(x), "y": self.px_y(y),
            "width": self.px_x(w), "height": self.px_y(h),
            "rotation": rotation, "src": src, "objectFit": "contain",
            "visible": True,
        })


def convertir(sku: str = "CREATINA MONOHIDRATO 500g", ancho_mm: float = 76, alto_mm: float = 66) -> dict:
    """Reconstruye la plantilla clásica leyendo DIRECTO la referencia de
    diseño v4 simplificada — mismo orden y contenido de secciones que ese
    SVG, elemento por elemento."""
    svg = open(RUTA_REFERENCIA, encoding="utf-8").read()
    root = ET.fromstring(svg)

    fmt_svg = root.get("viewBox", "0 0 1536 1024").split()
    canvas_w, canvas_h = float(fmt_svg[2]), float(fmt_svg[3])
    conv = ConversorEtiquetaNueva(ancho_mm, alto_mm, canvas_w=canvas_w, canvas_h=canvas_h)

    style_el = root.find(f"{NS}defs/{NS}style")
    estilos_css = style_el.text or "" if style_el is not None else ""
    clases = parse_css_clases(estilos_css)

    def num(v: str | None, default: float = 0.0) -> float:
        return float(v) if v is not None else default

    def resolver_estilo(attrib: dict) -> dict[str, str]:
        estilo: dict[str, str] = {}
        for c in (attrib.get("class") or "").split():
            estilo.update(clases.get(c, {}))
        if attrib.get("style"):
            estilo.update(parse_css_declaraciones(attrib["style"]))
        for k in ("fill", "font-size", "font-weight", "font-family", "stroke", "stroke-width"):
            if k in attrib:
                estilo[k] = attrib[k]
        return estilo

    # --- íconos (símbolo -> SVG embebido con el <style> de clases incluido,
    # para que class="stroke-blue" etc. resuelvan igual que en el original) ---
    iconos: dict[str, str] = {}
    for sym in root.findall(f"{NS}defs/{NS}symbol"):
        sid = sym.get("id")
        vb = sym.get("viewBox", "0 0 64 64").split()
        vw, vh = float(vb[2]), float(vb[3])
        interior = "".join(ET.tostring(hijo, encoding="unicode") for hijo in sym)
        iconos[sid] = svg_embebido(interior, vw, vh, estilos_css)

    def procesar_texto(el, ox: float, oy: float) -> None:
        attrib = el.attrib
        estilo = resolver_estilo(attrib)
        if attrib.get("text-anchor") == "middle":
            align = "center"
        elif attrib.get("text-anchor") == "end":
            align = "right"
        else:
            align = "left"
        x, y = ox + num(attrib.get("x")), oy + num(attrib.get("y"))
        fs = px_desde_css(estilo.get("font-size"), 16)
        weight = estilo.get("font-weight", "400")
        fill = estilo.get("fill", "#000")
        family = estilo.get("font-family", "Montserrat, Arial, sans-serif")

        def limite_para(px: float, py: float) -> float | None:
            # Columnas angostas a este tamaño físico: el texto debe respetar
            # el borde de su propia celda, no solo el borde exterior del
            # lienzo entero.
            if 44 <= px <= 312 and 727 <= py <= 889:
                return 312  # CONTENIDO NETO
            if 140 <= px <= 895 and 320 <= py <= 700:
                return 888  # rejilla de íconos (antes del divisor x=895)
            if 960 <= px <= 1310 and 220 <= py <= 300:
                return 1310  # tabla de specs (antes de la celda de valor x=1320)
            return None

        tspans = el.findall(f"{NS}tspan")
        if tspans:
            # Dos usos distintos de <tspan> en las referencias: (a) un
            # renglón envuelto a mano por el autor — trae su propio x y un dy
            # != 0 respecto al renglón anterior; (b) seguir en la MISMA línea
            # solo para cambiar de fuente a mitad de texto (p. ej. "≥" en una
            # fuente que sí tiene ese glifo) — sin x propio, dy=0 o ausente.
            # El modelo clásico no soporta fuentes mixtas en un elemento, así
            # que estos últimos se concatenan al texto de la línea actual.
            lineas: list[tuple[float, float, str]] = []
            y_cursor = y
            linea_x = x
            linea_texto = ""
            for tsp in tspans:
                dy = num(tsp.get("dy"))
                es_nueva_linea = tsp.get("x") is not None or dy != 0
                if es_nueva_linea and linea_texto:
                    lineas.append((linea_x, y_cursor, linea_texto))
                    linea_texto = ""
                if es_nueva_linea:
                    y_cursor += dy
                    linea_x = ox + num(tsp.get("x")) if tsp.get("x") is not None else x
                linea_texto += tsp.text or ""
            if linea_texto:
                lineas.append((linea_x, y_cursor, linea_texto))
            for tx, ty, texto_linea in lineas:
                texto = texto_linea.strip()
                if texto:
                    conv.agregar_texto(
                        tx, ty, fs, texto, color=fill, weight=weight, align=align, family=family,
                        limite_derecho_canvas=limite_para(tx, ty),
                    )
        else:
            texto = (el.text or "").strip()
            if texto:
                conv.agregar_texto(
                    x, y, fs, texto, color=fill, weight=weight, align=align, family=family,
                    limite_derecho_canvas=limite_para(x, y),
                )

    def recorrer(contenedor, ox: float = 0.0, oy: float = 0.0, fill_heredado: str | None = None) -> None:
        for el in contenedor:
            tag = el.tag.replace(NS, "")
            a = el.attrib

            if tag == "g":
                m = re.match(r"translate\(([\-\d.]+)[,\s]+([\-\d.]+)\)", a.get("transform", ""))
                sub_ox, sub_oy = (ox + float(m.group(1)), oy + float(m.group(2))) if m else (ox, oy)
                recorrer(el, sub_ox, sub_oy, a.get("fill") or fill_heredado)
                continue

            if tag == "rect":
                conv.agregar_rect(
                    ox + num(a.get("x")), oy + num(a.get("y")), num(a.get("width")), num(a.get("height")),
                    fill=a.get("fill") or fill_heredado or "none", stroke=a.get("stroke"),
                    stroke_w=num(a.get("stroke-width")), radius=num(a.get("rx")),
                )
            elif tag == "line":
                estilo = resolver_estilo(a)
                stroke = estilo.get("stroke") or a.get("stroke", "#000")
                stroke_w = px_desde_css(estilo.get("stroke-width"), num(a.get("stroke-width"), 1))
                conv.agregar_linea(
                    ox + num(a.get("x1")), oy + num(a.get("y1")),
                    ox + num(a.get("x2")), oy + num(a.get("y2")),
                    stroke, stroke_w,
                )
            elif tag == "text":
                procesar_texto(el, ox, oy)
            elif tag == "image":
                # Logo oficial (marino #003C8F) en vez del que traía la referencia.
                logo_b64 = "data:image/png;base64," + base64.b64encode(open(RUTA_LOGO, "rb").read()).decode("ascii")
                conv.agregar_imagen(
                    ox + num(a.get("x")), oy + num(a.get("y")), num(a.get("width")), num(a.get("height")),
                    logo_b64,
                )
            elif tag == "use":
                href = a.get("href") or a.get(f"{XLINK}href")
                sid = href.lstrip("#")
                conv.agregar_imagen(
                    ox + num(a.get("x")), oy + num(a.get("y")), num(a.get("width")), num(a.get("height")),
                    iconos[sid],
                )
            elif tag == "path":
                # Única aparición: fondo del pie de página (esquinas inferiores
                # redondeadas, relleno en gradiente en el original). Se
                # aproxima como rect recto de color plano — mismo bounding box.
                conv.agregar_rect(12, 905, 1524 - 12, 1013 - 905, fill="#003C8F")
            elif tag == "circle":
                # Círculo "NO GHS" u otros círculos sueltos -> rect con
                # borderRadius = radio (círculo perfecto, editable como cualquier rect).
                cx, cy, r = ox + num(a.get("cx")), oy + num(a.get("cy")), num(a.get("r"))
                conv.agregar_rect(
                    cx - r, cy - r, r * 2, r * 2,
                    fill=a.get("fill") or fill_heredado or "none", stroke=a.get("stroke"),
                    stroke_w=num(a.get("stroke-width"), 1), radius=r,
                )
            elif tag in ("defs", "linearGradient", "filter", "style"):
                continue

    recorrer(root)

    ahora = datetime.now(timezone.utc).isoformat()
    return {
        "id": nuevo_id(),
        "nombre": sku,
        "categoria": "etiquetas",
        "carpeta": "",
        "formato": {
            "id": f"etiquetas-{sku}",
            "nombre": sku.split()[-1],
            "tipo_etiqueta": sku.split()[-1],
            "ancho_mm": ancho_mm, "alto_mm": alto_mm,
            "ancho_px": conv.ancho_px, "alto_px": conv.alto_px, "dpi": conv.dpi,
        },
        "fondo": "#ffffff",
        "elementos": conv.elementos,
        "origen_ai": None,
        "created_at": ahora,
        "updated_at": ahora,
    }


def main():
    sku = sys.argv[1] if len(sys.argv) > 1 else "CREATINA MONOHIDRATO 500g"
    plantilla = convertir(sku)

    d = json.load(open(PLANTILLAS_JSON, encoding="utf-8"))
    d["plantillas"] = [p for p in d["plantillas"] if p.get("nombre") != sku]
    d["plantillas"].append(plantilla)
    json.dump(d, open(PLANTILLAS_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"Migrada: {sku!r} -> id={plantilla['id']} ({len(plantilla['elementos'])} elementos)")


if __name__ == "__main__":
    main()
