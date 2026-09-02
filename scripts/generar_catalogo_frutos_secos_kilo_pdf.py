#!/usr/bin/env python3
"""
Catálogo PDF — frutos secos & semillas por kilo (McKenna Group).

Portada e interior con isotipo corporativo. Precios de lista (MeLi/Siigo)
y web (−10 %). Incluye líneas nuevas de factura Global Trading FEA18545.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
ISO_PATH = ROOT / "PAGINA_WEB" / "site" / "static" / "img" / "isotipo.png"
if not ISO_PATH.is_file():
    ISO_PATH = ROOT / "DISENO CORPORATIVO " / "isotipo_final.png"
OUT_PDF = ROOT / "Catalogo_Frutos_Secos_Kilo_2026-09.pdf"
FONT_DIR = Path("/usr/share/fonts/truetype/montserrat/")

PW, PH = A4
MARGIN = 18.0
CW = PW - 2 * MARGIN
COL_GAP = 10.0
COL_W = (CW - COL_GAP) / 2
CARD_H = 72.0
CARD_PAD = 8.0
HEADER_H = 30.0

ACCENT = colors.HexColor("#016d82")
ACCENT_DARK = colors.HexColor("#022D33")
BLACK = colors.black
GRAY = colors.HexColor("#555555")
GRAY_LIGHT = colors.HexColor("#999999")
WHITE = colors.white
GREEN = colors.HexColor("#2e7d32")
GREEN_NEW = colors.HexColor("#0c6069")
BG_CARD = colors.HexColor("#f5f8f9")
BORDER = colors.HexColor("#dde8ea")


def _reg_font(name: str, file: str) -> None:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / file)))


for _n, _f in [
    ("Mont-Regular", "Montserrat-Regular.ttf"),
    ("Mont-Light", "Montserrat-Light.ttf"),
    ("Mont-Bold", "Montserrat-Bold.ttf"),
    ("Mont-SemiBold", "Montserrat-SemiBold.ttf"),
    ("Mont-Medium", "Montserrat-Medium.ttf"),
    ("Mont-ExtraBold", "Montserrat-ExtraBold.ttf"),
]:
    _reg_font(_n, _f)


def cop(n: int | float) -> str:
    return f"${n:,.0f}".replace(",", ".")


PRODUCTOS = [
    {
        "nombre": "Sal rosada del Himalaya grano fino",
        "unidad": "kg",
        "lista": 15900,
        "web": 14310,
        "ref": "C-SALROSHIMFINKg",
        "seccion": "Sal y condimentos",
        "nuevo": True,
    },
    {
        "nombre": "Sal rosada del Himalaya grano grueso",
        "unidad": "kg",
        "lista": 15900,
        "web": 14310,
        "ref": "C-SALROSHIMGRUKg",
        "seccion": "Sal y condimentos",
        "nuevo": True,
    },
    {
        "nombre": "Maní natural tostado",
        "unidad": "kg",
        "lista": 17000,
        "web": 15300,
        "ref": "C-MANNATTOS500g",
        "seccion": "Frutos secos",
        "nuevo": False,
    },
    {
        "nombre": "Dátiles Sayed",
        "unidad": "kg",
        "lista": 31000,
        "web": 27900,
        "ref": "C-DATSAYKg",
        "seccion": "Frutas deshidratadas",
        "nuevo": True,
    },
    {
        "nombre": "Semilla de chía boliviana",
        "unidad": "kg",
        "lista": 33200,
        "web": 29880,
        "ref": "C-SEMCHIKg",
        "seccion": "Semillas",
        "nuevo": True,
    },
    {
        "nombre": "Ajonjolí negro",
        "unidad": "kg",
        "lista": 45200,
        "web": 40680,
        "ref": "C-AJONEGKg",
        "seccion": "Semillas",
        "nuevo": True,
    },
    {
        "nombre": "Arándano americano deshidratado",
        "unidad": "kg",
        "lista": 46000,
        "web": 41400,
        "ref": "C-ARADESKg",
        "seccion": "Frutas deshidratadas",
        "nuevo": False,
    },
    {
        "nombre": "Semilla de calabaza",
        "unidad": "kg",
        "lista": 53800,
        "web": 48400,
        "ref": "C-SEMCAL500g",
        "seccion": "Semillas",
        "nuevo": False,
    },
    {
        "nombre": "Aceite de coco",
        "unidad": "L",
        "lista": 57200,
        "web": 51480,
        "ref": "C-ACECOCLt",
        "seccion": "Aceites",
        "nuevo": True,
        "nota": "500 mL: lista $28.600 · web $25.740",
    },
    {
        "nombre": "Almendra natural NPX 30/32",
        "unidad": "kg",
        "lista": 61000,
        "web": 54900,
        "ref": "C-ALMNATKg",
        "seccion": "Frutos secos",
        "nuevo": False,
    },
    {
        "nombre": "Bayas de goji",
        "unidad": "kg",
        "lista": 70100,
        "web": 63090,
        "ref": "C-BAYGOJKg",
        "seccion": "Frutas deshidratadas",
        "nuevo": True,
    },
    {
        "nombre": "Coco deshidratado hilos",
        "unidad": "kg",
        "lista": 72000,
        "web": 64800,
        "ref": "C-COCDESHIL500g",
        "seccion": "Frutos secos",
        "nuevo": False,
    },
    {
        "nombre": "Pistachos tostados",
        "unidad": "kg",
        "lista": 99800,
        "web": 89800,
        "ref": "C-PISTOS500g",
        "seccion": "Frutos secos",
        "nuevo": False,
    },
    {
        "nombre": "Nuez del Brasil partida",
        "unidad": "kg",
        "lista": 100200,
        "web": 90200,
        "ref": "C-NUEBRA500g",
        "seccion": "Frutos secos",
        "nuevo": False,
    },
]

SECCION_ORDEN = [
    "Frutos secos",
    "Semillas",
    "Frutas deshidratadas",
    "Sal y condimentos",
    "Aceites",
]


def _iso_size(h: float = 20.0) -> tuple[float, float]:
    orig = Image.open(ISO_PATH)
    w = h * (orig.width / orig.height)
    return w, h


def draw_cover(c: canvas.Canvas) -> None:
    c.setFillColor(WHITE)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)

    # Banda superior
    c.setFillColor(ACCENT_DARK)
    c.rect(0, PH - 95, PW, 95, fill=1, stroke=0)

    iso_h = 58.0
    iso_w, _ = _iso_size(iso_h)
    iso_x = (PW - iso_w) / 2
    iso_y = PH - 78
    c.drawImage(ImageReader(str(ISO_PATH)), iso_x, iso_y, iso_w, iso_h, mask="auto")

    c.setFont("Mont-Light", 8.5)
    c.setFillColor(colors.HexColor("#c0f0f5"))
    c.drawCentredString(PW / 2, PH - 88, "McKenna Group S.A.S.")

    # Título principal
    c.setFont("Mont-ExtraBold", 24)
    c.setFillColor(ACCENT_DARK)
    c.drawCentredString(PW / 2, PH / 2 + 95, "Frutos secos & semillas")

    c.setFont("Mont-Bold", 16)
    c.setFillColor(ACCENT)
    c.drawCentredString(PW / 2, PH / 2 + 68, "Listado de precios por kilo")

    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.4)
    line_w = CW * 0.42
    c.line((PW - line_w) / 2, PH / 2 + 52, (PW + line_w) / 2, PH / 2 + 52)

    # Caja informativa
    box_w = CW * 0.72
    box_h = 88
    box_x = (PW - box_w) / 2
    box_y = PH / 2 - 10
    c.setFillColor(BG_CARD)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.roundRect(box_x, box_y - box_h, box_w, box_h, 6, fill=1, stroke=1)

    pad = 14
    ty = box_y - pad - 10
    c.setFont("Mont-SemiBold", 9)
    c.setFillColor(ACCENT)
    c.drawString(box_x + pad, ty, "Precios de venta al detal")
    ty -= 18
    c.setFont("Mont-Regular", 10)
    c.setFillColor(GRAY)
    c.drawString(box_x + pad, ty, "Lista = Mercado Libre / Siigo  ·  Web = 10 % menos en mckennagroup.co")
    ty -= 16
    c.setFont("Mont-Regular", 9.5)
    c.drawString(box_x + pad, ty, "Incluye referencias nuevas — factura Global Trading FEA18545 (ago 2026)")
    ty -= 16
    c.setFont("Mont-Light", 8)
    c.setFillColor(GRAY_LIGHT)
    c.drawRightString(box_x + box_w - pad, box_y - box_h + 8, datetime.now().strftime("%B %Y").capitalize())

    c.setFont("Mont-Regular", 8.5)
    c.setFillColor(ACCENT)
    c.drawCentredString(PW / 2, MARGIN + 28, "Bogotá, Colombia  ·  www.mckennagroup.co  ·  WhatsApp ventas")

    c.showPage()


def draw_header(c: canvas.Canvas, section_name: str) -> float:
    iso_h = 20.0
    iso_w, _ = _iso_size(iso_h)
    iso_y = PH - MARGIN - iso_h
    iso_x = MARGIN + CW - iso_w
    c.drawImage(ImageReader(str(ISO_PATH)), iso_x, iso_y, iso_w, iso_h, mask="auto")

    c.setFont("Mont-Bold", 9.5)
    c.setFillColor(ACCENT)
    c.drawString(MARGIN, iso_y + 4, section_name)

    line_y = iso_y - 5
    c.setStrokeColor(ACCENT)
    c.setLineWidth(0.9)
    c.line(MARGIN, line_y, MARGIN + CW, line_y)
    return line_y - 8


def draw_card(c: canvas.Canvas, x: float, y: float, w: float, prod: dict) -> None:
    bottom = y - CARD_H
    c.setFillColor(WHITE)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.roundRect(x, bottom, w, CARD_H, 4, fill=1, stroke=1)

    tx = x + CARD_PAD
    ty = y - CARD_PAD

    # Badge nuevo
    name = prod["nombre"]
    if prod.get("nuevo"):
        badge = "NUEVO"
        c.setFont("Mont-Bold", 5.5)
        bw = c.stringWidth(badge, "Mont-Bold", 5.5) + 8
        bx = x + w - CARD_PAD - bw
        by = ty - 8
        c.setFillColor(GREEN_NEW)
        c.roundRect(bx, by, bw, 9, 2, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.drawString(bx + 4, by + 2.2, badge)
        ty -= 2

    c.setFont("Mont-Bold", 8)
    c.setFillColor(BLACK)
    max_w = w - 2 * CARD_PAD - (18 if prod.get("nuevo") else 0)
    words = name.split()
    line, lines = "", []
    for word in words:
        test = (line + " " + word).strip()
        if c.stringWidth(test, "Mont-Bold", 8) <= max_w:
            line = test
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    lines = lines[:2]
    for ln in lines:
        ty -= 10
        c.drawString(tx, ty, ln)

    unidad = prod["unidad"]
    c.setFont("Mont-Light", 6.5)
    c.setFillColor(GRAY_LIGHT)
    ty -= 11
    c.drawString(tx, ty, f"Venta por {unidad}  ·  Ref: {prod['ref']}")

    # Precio lista tachado estilo MeLi
    lista_txt = f"Lista: {cop(prod['lista'])} COP/{unidad}"
    c.setFont("Mont-Regular", 6.5)
    c.setFillColor(colors.HexColor("#bbbbbb"))
    ty -= 12
    c.drawString(tx, ty, lista_txt)
    tw = c.stringWidth(lista_txt, "Mont-Regular", 6.5)
    c.setStrokeColor(colors.HexColor("#bbbbbb"))
    c.setLineWidth(0.4)
    c.line(tx, ty + 2.5, tx + tw, ty + 2.5)

    # Precio web
    web_txt = f"{cop(prod['web'])} COP/{unidad}"
    c.setFont("Mont-Bold", 11)
    c.setFillColor(ACCENT)
    ty -= 14
    c.drawString(tx, ty, web_txt)

    ahorro = prod["lista"] - prod["web"]
    if ahorro > 0:
        c.setFont("Mont-Light", 6)
        c.setFillColor(GREEN)
        c.drawString(tx + c.stringWidth(web_txt, "Mont-Bold", 11) + 6, ty + 1, f"Ahorro web {cop(ahorro)}")

    nota = prod.get("nota")
    if nota:
        c.setFont("Mont-Light", 5.8)
        c.setFillColor(GRAY_LIGHT)
        c.drawString(tx, bottom + 5, nota)


def draw_interior(c: canvas.Canvas) -> None:
    by_section: dict[str, list[dict]] = {s: [] for s in SECCION_ORDEN}
    for p in PRODUCTOS:
        by_section.setdefault(p["seccion"], []).append(p)

    col_x = [MARGIN, MARGIN + COL_W + COL_GAP]
    content_bot = MARGIN + 14

    def new_page(section_name: str) -> tuple[float, list[float], int]:
        c.showPage()
        c.setFillColor(WHITE)
        c.rect(0, 0, PW, PH, fill=1, stroke=0)
        top = draw_header(c, section_name)
        return top, [top, top], 0

    first = SECCION_ORDEN[0]
    content_top, col_y, col_idx = new_page(first)
    current_section = first
    section_title_h = 17

    for sec_name in SECCION_ORDEN:
        prods = by_section.get(sec_name) or []
        if not prods:
            continue

        need = section_title_h + CARD_H
        if col_y[col_idx] - need < content_bot:
            col_idx += 1
            if col_idx > 1:
                content_top, col_y, col_idx = new_page(sec_name)
                current_section = sec_name

        cx = col_x[col_idx]
        c.setFont("Mont-Bold", 8.5)
        c.setFillColor(ACCENT)
        c.drawString(cx, col_y[col_idx] - 12, f"{sec_name}  ({len(prods)})")
        c.setStrokeColor(ACCENT)
        c.setLineWidth(0.5)
        c.line(cx, col_y[col_idx] - 14, cx + COL_W, col_y[col_idx] - 14)
        col_y[col_idx] -= section_title_h
        current_section = sec_name

        for prod in prods:
            if col_y[col_idx] - CARD_H < content_bot:
                col_idx += 1
                if col_idx > 1:
                    content_top, col_y, col_idx = new_page(current_section)

            draw_card(c, col_x[col_idx], col_y[col_idx], COL_W, prod)
            col_y[col_idx] -= CARD_H


def draw_closing(c: canvas.Canvas) -> None:
    c.showPage()
    c.setFillColor(WHITE)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)

    iso_h = 42
    iso_w, _ = _iso_size(iso_h)
    c.drawImage(
        ImageReader(str(ISO_PATH)),
        (PW - iso_w) / 2,
        PH / 2 + 10,
        iso_w,
        iso_h,
        mask="auto",
    )

    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.0)
    c.line(MARGIN + 40, PH / 2, PW - MARGIN - 40, PH / 2)

    c.setFont("Mont-Light", 14)
    c.setFillColor(GRAY)
    c.drawCentredString(PW / 2, PH / 2 - 28, "Gracias por preferirnos")

    c.setFont("Mont-Regular", 9)
    c.setFillColor(ACCENT)
    c.drawCentredString(PW / 2, PH / 2 - 48, "www.mckennagroup.co")

    c.setFont("Mont-Light", 7.5)
    c.setFillColor(GRAY_LIGHT)
    c.drawCentredString(
        PW / 2,
        MARGIN + 10,
        "Precios sujetos a cambio sin previo aviso. IVA según régimen del producto.",
    )
    c.showPage()


def generar_pdf(destino: Path | None = None) -> Path:
    if not ISO_PATH.is_file():
        raise FileNotFoundError(f"No se encontró el isotipo: {ISO_PATH}")
    out = destino or OUT_PDF
    cv = canvas.Canvas(str(out), pagesize=A4)
    cv.setTitle("Catálogo Frutos Secos por Kilo — McKenna Group")
    cv.setAuthor("McKenna Group S.A.S.")
    draw_cover(cv)
    draw_interior(cv)
    draw_closing(cv)
    cv.save()
    return out


def main() -> None:
    path = generar_pdf()
    kb = path.stat().st_size // 1024
    print(f"PDF generado: {path} ({kb} KB, {len(PRODUCTOS)} productos)")


if __name__ == "__main__":
    main()
