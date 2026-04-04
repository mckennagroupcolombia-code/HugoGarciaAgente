#!/usr/bin/env python3
"""
Genera el Catálogo McKenna Group 2026
Fuente de datos: Google Sheets (siempre actualizado)
Fotos: primera imagen de cada publicación activa en MeLi
Diseño: Montserrat · fondo blanco · acento #016d82 · márgenes 18pt
"""

import re
import os
import io
import tempfile
import requests
import gspread
from collections import defaultdict
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image

# ── Rutas ─────────────────────────────────────────────────────────────────────
FONT_DIR   = "/usr/share/fonts/truetype/montserrat/"
LOGO_PATH  = "/home/mckg/mi-agente/DISENO CORPORATIVO /LOGO MCKENNA.jpg"
ISO_PATH   = "/home/mckg/mi-agente/DISENO CORPORATIVO /ISOTIPO MCKENNA.png"
OUT_PDF    = "/home/mckg/mi-agente/Catalogo_McKenna_Group_2026.pdf"
CREDS_PATH = os.getenv("GOOGLE_SERVICE_ACCOUNT_PATH", "/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json")
SHEET_ID   = "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"

# ── Colores ────────────────────────────────────────────────────────────────────
ACCENT     = colors.HexColor("#016d82")
BLACK      = colors.black
GRAY       = colors.HexColor("#555555")
GRAY_LIGHT = colors.HexColor("#999999")
WHITE      = colors.white
GREEN      = colors.HexColor("#2e7d32")
SEPARATOR  = colors.HexColor("#e0e0e0")

# ── Página ────────────────────────────────────────────────────────────────────
PW, PH     = A4                 # 595.27 × 841.89 pt
MARGIN     = 18.0
CW         = PW - 2 * MARGIN
COL_GAP    = 10.0
COL_W      = (CW - COL_GAP) / 2

# ── Foto en tarjeta ────────────────────────────────────────────────────────────
PHOTO_SIZE    = 58   # px cuadrado máximo para la foto
PHOTO_ZONE_W  = PHOTO_SIZE + 10  # zona izq: 5pt pad cada lado

# ── Fuentes ───────────────────────────────────────────────────────────────────
def reg(name, file):
    pdfmetrics.registerFont(TTFont(name, FONT_DIR + file))

reg("Mont-Regular",  "Montserrat-Regular.ttf")
reg("Mont-Light",    "Montserrat-Light.ttf")
reg("Mont-Bold",     "Montserrat-Bold.ttf")
reg("Mont-SemiBold", "Montserrat-SemiBold.ttf")
reg("Mont-Medium",   "Montserrat-Medium.ttf")
reg("Mont-ExtraBold","Montserrat-ExtraBold.ttf")

# ── Categorización por prefijo de SKU ─────────────────────────────────────────
# Mapeo: prefijo_sku (lowercase) → nombre de categoría
CATEGORY_MAP = [
    (["acd", "ktacd"],                 "ÁCIDOS"),
    (["oilesn"],                        "ACEITES ESENCIALES"),
    (["oil", "oilarg", "oilgrs",
      "oilbmb", "oilsml", "oilvrgn",
      "sbcrd", "vsl"],                  "ACEITES"),
    (["crcrn", "crabjrf", "lnln",
      "mntcc", "mntk", "mntklb",
      "mntccrfkg", "mntkkg", "mntk250g",
      "mntl100g", "mtnkrtkg", "prfn"],  "CERAS Y MANTECAS"),
    (["alcctl", "btms", "btncc",
      "crlnt", "ccmd", "tsscc",
      "tsci", "pls20", "polisb",
      "polsorb", "cocamid"],            "EMULSIONANTES Y SURFACTANTES"),
    (["alnt", "frbsgl", "glc",
      "hyal", "niac", "dprp",
      "srb500", "urcsm"],               "HUMECTANTES"),
    (["arc"],                           "ARCILLAS"),
    (["bcarna", "ctrca", "ctmg",
      "ctrmg", "clrmg", "ctrzn",
      "salmg", "salkmg", "clrcalb",
      "ctk", "srlch"],                  "SALES MINERALES"),
    (["oltk", "lctca", "gmxtn",
      "gmxnt", "brxlben", "slfcul"],    "MINERALES"),
    (["dpnt", "vtmb", "vtmc",
      "vtma", "vtmd", "vtme"],          "VITAMINAS"),
    (["bcaa", "clgnhd", "crtnmnh",
      "els", "gltssnbr", "prtasl",
      "gelat", "albhv", "larg",
      "lglt", "lisl", "lprl",
      "ltrp", "trn250"],                "SUPLEMENTARIOS"),
    (["cfn", "extalvr", "extgsn",
      "extmlt", "extemtc", "mltdxtr",
      "mltdxlb", "algna", "cmcph",
      "cmclb", "coloid", "extmat",
      "gmsn", "actnalb", "agag",
      "almyc", "cpsvcglt", "dxdtlb",
      "dxtkg", "estmglb", "gltmns",
      "gmgr", "inl", "lctsyl",
      "ppn", "agdst", "h2ors",
      "agdst"],                         "EXCIPIENTES"),
    (["shrmx", "shrx", "phemx",
      "dmdm", "benz", "propgl",
      "potsorb", "sodbnz", "bnznalb",
      "mtbslfn", "srbk", "srbtkg"],     "CONSERVANTES"),
    (["alls", "erttlb", "frct",
      "stvia", "xylitol", "crmtrt",
      "scr250"],                        "EDULCORANTES"),
    (["dha", "as-96", "retinol",
      "rtn5p", "niacin", "kojic",
      "alfarb", "dmso", "oxdzn",
      "mntl100", "vltgn"],              "PRINCIPIOS ACTIVOS"),
    (["kt", "kit"],                     "KITS"),
    (["agtmgn", "bkr", "gtrvdr",
      "gtrvdramb", "gtr", "ppmt",
      "termm", "piseta", "filtro",
      "embudo", "cchmzcpls", "glslcarn",
      "rvv", "tds/eh"],                 "EQUIPOS Y MATERIALES LAB"),
    (["almlijmkt", "brcesc", "extelc",
      "frspdrmttx", "as-15", "pnttrscbl",
      "ktext", "repuesto", "dscvdr",
      "flnpvc", "owofan"],              "HERRAMIENTAS Y EQUIPOS"),
    (["azm", "glt2p", "crbact"],        "AGRÍCOLA"),
    (["as-44", "as-86", "as-38",
      "collar", "mascot"],              "MASCOTAS"),
]

def categorize(sku: str) -> str:
    sku_low = sku.strip().lower()
    for prefixes, cat in CATEGORY_MAP:
        for pfx in prefixes:
            if sku_low.startswith(pfx) or sku_low == pfx:
                return cat
    return "OTROS"

# ── Fotos desde MeLi ──────────────────────────────────────────────────────────
def fetch_meli_photos(token: str, meli_id_to_sku: dict) -> dict:
    """
    Dado un dict {meli_item_id: sku}, descarga la primera foto de cada ítem de MeLi.
    Retorna dict {sku: local_path}.
    """
    print(f"Obteniendo fotos de {len(meli_id_to_sku)} publicaciones en MeLi...")
    if not meli_id_to_sku:
        return {}

    headers = {"Authorization": f"Bearer {token}"}
    item_ids = list(meli_id_to_sku.keys())

    # Batch fetch primera foto (20 ítems por llamada)
    id_url_map = {}
    for i in range(0, len(item_ids), 20):
        batch = item_ids[i:i+20]
        res = requests.get(
            "https://api.mercadolibre.com/items",
            params={"ids": ",".join(batch), "attributes": "id,pictures"},
            headers=headers, timeout=15
        )
        if res.status_code != 200:
            continue
        for entry in res.json():
            if entry.get("code") != 200:
                continue
            body = entry.get("body", {})
            item_id = body.get("id", "")
            pics = body.get("pictures", [])
            if not pics:
                continue
            url = pics[0].get("secure_url") or pics[0].get("url", "")
            if url:
                id_url_map[item_id] = url

    print(f"  {len(id_url_map)} fotos encontradas en MeLi")

    # Descargar al directorio temporal, indexar por SKU
    tmp_dir = tempfile.mkdtemp(prefix="mckenna_fotos_")
    local_map = {}
    for item_id, url in id_url_map.items():
        sku = meli_id_to_sku.get(item_id, "")
        if not sku:
            continue
        try:
            r = requests.get(url, timeout=15)
            if r.status_code == 200:
                safe_sku = re.sub(r'[^A-Za-z0-9_\-]', '_', sku)
                local_path = os.path.join(tmp_dir, f"{safe_sku}.jpg")
                with open(local_path, "wb") as f:
                    f.write(r.content)
                local_map[sku] = local_path
        except Exception as e:
            print(f"  ⚠️ Error descargando foto {sku}: {e}")

    print(f"  {len(local_map)} fotos descargadas en {tmp_dir}")
    return local_map


# ── Leer productos desde Google Sheets ────────────────────────────────────────
def leer_productos_sheets(photo_map: dict = None):
    """
    Lee productos desde Google Sheets.
    Retorna (sections, meli_id_to_sku) donde meli_id_to_sku = {MCOxxx: sku}.
    """
    print("Conectando con Google Sheets...")
    gc = gspread.service_account(filename=CREDS_PATH)
    wb = gc.open_by_key(SHEET_ID)
    ws = wb.sheet1
    rows = ws.get_all_values()
    print(f"  {len(rows)-1} filas encontradas")
    photo_map = photo_map or {}

    # Índices de columnas según header
    header = [h.strip().upper() for h in rows[0]]
    idx_meli   = 0  # columna A: ID de MeLi (MCO...)
    idx_sku    = next((i for i, h in enumerate(header) if "SKU" in h), 1)
    idx_nombre = next((i for i, h in enumerate(header) if "NOMBRE" in h), 3)
    idx_precio = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)

    seen_skus     = set()
    sections      = defaultdict(list)
    meli_id_to_sku = {}

    for row in rows[1:]:
        if len(row) <= max(idx_sku, idx_nombre, idx_precio):
            continue
        meli_id    = str(row[idx_meli]).strip().upper() if row[idx_meli] else ""
        sku        = row[idx_sku].strip()
        nombre     = row[idx_nombre].strip()
        precio_raw = row[idx_precio].strip()

        if not sku or not nombre or not precio_raw:
            continue
        if sku in seen_skus:
            continue
        seen_skus.add(sku)

        # Registrar mapa MeLi ID → SKU (si hay ID válido de MeLi)
        if meli_id.startswith("MCO") and sku:
            meli_id_to_sku[meli_id] = sku

        # Limpiar precio
        try:
            precio_meli = float(precio_raw.replace(",", ""))
        except ValueError:
            continue

        precio_desc = precio_meli * 0.90
        ahorro      = precio_meli * 0.10

        def fmt(n):
            return f"${n:,.0f}".replace(",", ".")

        cat = categorize(sku)
        sections[cat].append({
            "name":   nombre,
            "ref":    sku,
            "meli":   fmt(precio_meli),
            "precio": fmt(precio_desc),
            "ahorro": f"Ahorras {fmt(ahorro)} (10%)",
            "photo":  photo_map.get(sku),
        })

    # Ordenar secciones según el orden canónico del catálogo
    orden_secciones = [cat for _, cat in CATEGORY_MAP] + ["OTROS"]
    # Deduplicar orden
    seen_ord = set()
    orden_final = []
    for c in orden_secciones:
        if c not in seen_ord:
            seen_ord.add(c)
            orden_final.append(c)

    result = []
    for cat in orden_final:
        if cat in sections and sections[cat]:
            prods = sorted(sections[cat], key=lambda p: p["name"].lower())
            result.append({"name": cat, "products": prods})
    # Agregar secciones no mapeadas (por si acaso)
    for cat, prods in sections.items():
        if cat not in seen_ord:
            result.append({"name": cat, "products": sorted(prods, key=lambda p: p["name"].lower())})

    total = sum(len(s["products"]) for s in result)
    print(f"  Secciones: {len(result)}  |  Productos únicos: {total}")
    for s in result:
        print(f"    {s['name']}: {len(s['products'])} productos")
    print(f"  IDs MeLi encontrados en Sheets: {len(meli_id_to_sku)}")
    return result, meli_id_to_sku

# ── Portada ───────────────────────────────────────────────────────────────────
def draw_cover(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)

    logo_reader = ImageReader(LOGO_PATH)
    orig = Image.open(LOGO_PATH)
    logo_aspect = orig.width / orig.height  # 856/340 ≈ 2.52

    logo_w = CW * 0.56
    logo_h = logo_w / logo_aspect
    logo_x = (PW - logo_w) / 2
    logo_y = PH / 2 + 50

    c.drawImage(logo_reader, logo_x, logo_y, logo_w, logo_h)

    ref_x = logo_x
    ref_w = logo_w

    # Línea bajo el logo
    line1_y = logo_y - 9
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.8)
    c.line(ref_x, line1_y, ref_x + ref_w, line1_y)

    # Título
    title   = "CATÁLOGO DE PRODUCTOS"
    title_y = line1_y - 30
    c.setFont("Mont-Bold", 19)
    c.setFillColor(ACCENT)
    c.drawCentredString(ref_x + ref_w / 2, title_y, title)

    # Caja de info
    box_pad    = 11
    box_h      = 78
    box_y      = title_y - 16
    box_bottom = box_y - box_h

    c.setStrokeColor(ACCENT)
    c.setFillColor(WHITE)
    c.setLineWidth(1.3)
    c.rect(ref_x, box_bottom, ref_w, box_h, fill=1, stroke=1)

    # "Insumos & Materias Primas"
    c.setFont("Mont-SemiBold", 8.5)
    c.setFillColor(ACCENT)
    c.drawString(ref_x + box_pad, box_bottom + box_h - box_pad - 8, "Insumos & Materias Primas")

    # Texto principal
    c.setFont("Mont-Regular", 11.5)
    c.setFillColor(GRAY)
    c.drawString(ref_x + box_pad,
                 box_bottom + box_h - box_pad - 28,
                 "Los mismos precios de MercadoLibre con 10% de descuento")

    c.setFont("Mont-Medium", 11.5)
    c.drawString(ref_x + box_pad,
                 box_bottom + box_h - box_pad - 46,
                 "al comprar en   www.mckennagroup.co")

    # Fecha
    c.setFont("Mont-Light", 8)
    c.setFillColor(GRAY_LIGHT)
    c.drawRightString(ref_x + ref_w - box_pad, box_bottom + 6, "Abril 2026")

    c.showPage()

# ── Cabecero de página interior ───────────────────────────────────────────────
HEADER_H = 30  # altura reservada para cabecero + línea

def draw_header(c, section_name):
    """Dibuja cabecero. Retorna Y disponible para contenido."""
    iso_h = 20
    iso_reader = ImageReader(ISO_PATH)
    orig = Image.open(ISO_PATH)
    iso_w = iso_h * (orig.width / orig.height)

    iso_y = PH - MARGIN - iso_h
    iso_x = MARGIN + CW - iso_w
    c.drawImage(iso_reader, iso_x, iso_y, iso_w, iso_h, mask="auto")

    c.setFont("Mont-Bold", 9.5)
    c.setFillColor(ACCENT)
    c.drawString(MARGIN, iso_y + 4, section_name)

    line_y = iso_y - 5
    c.setStrokeColor(ACCENT)
    c.setLineWidth(0.9)
    c.line(MARGIN, line_y, MARGIN + CW, line_y)

    return line_y - 6  # Y disponible para contenido

# ── Tarjeta de producto ────────────────────────────────────────────────────────
CARD_H   = 82   # aumentado para acomodar foto
CARD_PAD = 6

def draw_card(c, x, y, w, prod):
    """Dibuja tarjeta desde (x, y) hacia abajo. y es la esquina superior."""
    # Línea inferior separadora
    c.setStrokeColor(SEPARATOR)
    c.setLineWidth(0.4)
    c.line(x, y - CARD_H, x + w, y - CARD_H)

    # ── Foto (zona izquierda) ──────────────────────────────────────────────────
    photo_path = prod.get("photo")
    if photo_path and os.path.exists(photo_path):
        try:
            img = Image.open(photo_path)
            iw, ih = img.size
            aspect = iw / ih
            if aspect >= 1:
                pw = float(PHOTO_SIZE)
                ph = pw / aspect
            else:
                ph = float(PHOTO_SIZE)
                pw = ph * aspect

            # Fondo suave para la foto
            zone_x = x + CARD_PAD - 2
            zone_y = y - (CARD_H - PHOTO_SIZE) / 2 - PHOTO_SIZE
            c.setFillColor(colors.HexColor("#f5f8f9"))
            c.setStrokeColor(colors.HexColor("#dde8ea"))
            c.setLineWidth(0.5)
            c.roundRect(zone_x, zone_y, PHOTO_SIZE + 4, PHOTO_SIZE + 4, 3, fill=1, stroke=1)

            # Foto centrada en la zona
            px = x + CARD_PAD + (PHOTO_SIZE - pw) / 2
            py = y - (CARD_H + ph) / 2
            c.drawImage(ImageReader(photo_path), px, py, pw, ph, preserveAspectRatio=True, mask="auto")
        except Exception:
            photo_path = None  # si falla, texto ocupa todo el ancho

    # ── Texto (zona derecha o todo el ancho si no hay foto) ───────────────────
    text_x = x + CARD_PAD + PHOTO_ZONE_W if photo_path and os.path.exists(photo_path or "") else x + CARD_PAD
    text_w = w - (text_x - x) - CARD_PAD

    name = prod.get("name", "")
    c.setFont("Mont-Bold", 7.5)
    c.setFillColor(BLACK)

    max_chars = int(text_w / 4.1)
    words = name.split()
    lines, cur = [], ""
    for word in words:
        test = (cur + " " + word).strip()
        if len(test) <= max_chars:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    lines = lines[:2]
    if len(lines) == 2 and len(name.split()) > len(" ".join(lines).split()):
        lines[1] = lines[1][:max_chars - 3].rstrip() + "..."

    ty = y - CARD_PAD
    for ln in lines:
        ty -= 9
        c.drawString(text_x, ty, ln)
    ty -= 4

    # Referencia
    c.setFont("Mont-Light", 6.2)
    c.setFillColor(GRAY_LIGHT)
    ty -= 9
    c.drawString(text_x, ty, f"Ref: {prod.get('ref', '')}")
    ty -= 4

    # Precio MeLi (gris, tachado)
    meli_txt = f"MeLi: {prod.get('meli', '')}"
    c.setFont("Mont-Regular", 6.2)
    c.setFillColor(colors.HexColor("#bbbbbb"))
    ty -= 9
    c.drawString(text_x, ty, meli_txt)
    tw = c.stringWidth(meli_txt, "Mont-Regular", 6.2)
    c.setStrokeColor(colors.HexColor("#bbbbbb"))
    c.setLineWidth(0.5)
    c.line(text_x, ty + 3, text_x + tw, ty + 3)
    ty -= 4

    # Precio descuento (grande, acento)
    precio = prod.get("precio", "")
    precio_txt = f"{precio} COP"
    c.setFont("Mont-Bold", 10.5)
    c.setFillColor(ACCENT)
    ty -= 10
    c.drawString(text_x, ty, precio_txt)

    # Ahorro (verde, a la derecha del precio)
    ahorro = prod.get("ahorro", "")
    if ahorro:
        pw_txt = c.stringWidth(precio_txt, "Mont-Bold", 10.5)
        c.setFont("Mont-Light", 6)
        c.setFillColor(GREEN)
        c.drawString(text_x + pw_txt + 5, ty + 1, ahorro)

# ── Páginas interiores ────────────────────────────────────────────────────────
SECTION_TITLE_H = 19  # título de sección + línea

def draw_interior_pages(c, sections):
    col_x = [MARGIN, MARGIN + COL_W + COL_GAP]
    CONTENT_BOT = MARGIN

    def avail_height(content_top):
        return content_top - CONTENT_BOT

    def new_page(section_name):
        c.showPage()
        c.setFillColor(WHITE)
        c.rect(0, 0, PW, PH, fill=1, stroke=0)
        ct = draw_header(c, section_name)
        return ct, [ct, ct], 0

    def draw_section_title(c, cx, cy, title, count):
        c.setFont("Mont-Bold", 9)
        c.setFillColor(ACCENT)
        c.drawString(cx, cy - 13, f"{title}  ({count})")
        c.setStrokeColor(ACCENT)
        c.setLineWidth(0.5)
        c.line(cx, cy - 15, cx + COL_W, cy - 15)
        return cy - SECTION_TITLE_H

    # Estado inicial
    first_sec = sections[0]["name"] if sections else "CATÁLOGO"
    content_top, col_y, col_idx = new_page(first_sec)
    current_section = first_sec

    for sec in sections:
        sname  = sec["name"]
        prods  = sec["products"]
        if not prods:
            continue

        # ¿Cabe título + 1 tarjeta en columna actual?
        need = SECTION_TITLE_H + CARD_H
        if col_y[col_idx] - need < CONTENT_BOT:
            col_idx += 1
            if col_idx > 1:
                content_top, col_y, col_idx = new_page(sname)
                current_section = sname

        if col_idx <= 1 and col_y[col_idx] - need < CONTENT_BOT:
            content_top, col_y, col_idx = new_page(sname)
            current_section = sname

        # Dibujar título de sección
        cx = col_x[col_idx]
        col_y[col_idx] = draw_section_title(c, cx, col_y[col_idx], sname, len(prods))

        for prod in prods:
            # ¿Cabe tarjeta?
            if col_y[col_idx] - CARD_H < CONTENT_BOT:
                col_idx += 1
                if col_idx > 1:
                    content_top, col_y, col_idx = new_page(current_section)
                    current_section = sname

            draw_card(c, col_x[col_idx], col_y[col_idx], COL_W, prod)
            col_y[col_idx] -= CARD_H

# ── Cierre ────────────────────────────────────────────────────────────────────
def draw_closing(c):
    c.showPage()
    c.setFillColor(WHITE)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)

    logo_reader = ImageReader(LOGO_PATH)
    orig = Image.open(LOGO_PATH)
    logo_aspect = orig.width / orig.height
    logo_w = CW * 0.50
    logo_h = logo_w / logo_aspect
    logo_x = (PW - logo_w) / 2
    logo_y = PH / 2 + 20

    c.drawImage(logo_reader, logo_x, logo_y, logo_w, logo_h)

    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.2)
    c.line(logo_x, logo_y - 9, logo_x + logo_w, logo_y - 9)

    c.setFont("Mont-Light", 16)
    c.setFillColor(GRAY)
    c.drawCentredString(PW / 2, logo_y - 38, "Gracias por preferirnos")

    c.setFont("Mont-Regular", 9)
    c.setFillColor(ACCENT)
    c.drawCentredString(PW / 2, logo_y - 58, "www.mckennagroup.co")

    c.showPage()

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    from dotenv import load_dotenv
    load_dotenv()
    from app.utils import refrescar_token_meli, enviar_whatsapp_archivo

    # 1. Leer Sheets → obtener productos + mapa MeLi ID → SKU
    sections, meli_id_to_sku = leer_productos_sheets()

    # 2. Descargar fotos de MeLi usando los IDs de la hoja
    token = refrescar_token_meli()
    photo_map = fetch_meli_photos(token, meli_id_to_sku) if token and meli_id_to_sku else {}
    print(f"  Fotos listas: {len(photo_map)} / {len(meli_id_to_sku)} productos con ID MeLi")

    # 3. Inyectar fotos en los productos de cada sección
    for sec in sections:
        for prod in sec["products"]:
            sku = prod.get("ref", "")
            if sku in photo_map:
                prod["photo"] = photo_map[sku]

    # 4. Generar PDF
    print(f"\nGenerando {OUT_PDF} ...")
    cv = canvas.Canvas(OUT_PDF, pagesize=A4)
    cv.setTitle("Catálogo McKenna Group 2026")
    cv.setAuthor("McKenna Group S.A.S.")

    draw_cover(cv)
    draw_interior_pages(cv, sections)
    draw_closing(cv)

    cv.save()
    print("¡PDF generado!")

    # 5. Enviar al grupo de WhatsApp
    print("Enviando al grupo de WhatsApp...")
    enviado = enviar_whatsapp_archivo(
        file_path=OUT_PDF,
        texto_mensaje="📦 *Catálogo McKenna Group — Abril 2026*\nPrecios actualizados con fotos de nuestras publicaciones en MeLi. 10% descuento comprando en www.mckennagroup.co",
        file_name="Catalogo_McKenna_Group_2026.pdf"
    )
    if enviado:
        print("✅ Catálogo enviado al grupo.")
    else:
        print("⚠️ PDF listo pero no se pudo enviar por WhatsApp.")

if __name__ == "__main__":
    main()
