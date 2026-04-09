"""
Skill para generar el Catálogo McKenna Group 2026.
Fuente de datos: Google Sheets.
Fotos: primera imagen de cada publicación activa en MeLi.
"""

import re
import os
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

from app.utils import refrescar_token_meli, enviar_whatsapp_archivo

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
PW, PH     = A4
MARGIN     = 18.0
CW         = PW - 2 * MARGIN
COL_GAP    = 10.0
COL_W      = (CW - COL_GAP) / 2

# ── Foto en tarjeta ────────────────────────────────────────────────────────────
PHOTO_SIZE    = 58
PHOTO_ZONE_W  = PHOTO_SIZE + 10

# ── Fuentes ───────────────────────────────────────────────────────────────────
def _registrar_fuentes():
    try:
        pdfmetrics.registerFont(TTFont("Mont-Regular",  FONT_DIR + "Montserrat-Regular.ttf"))
        pdfmetrics.registerFont(TTFont("Mont-Light",    FONT_DIR + "Montserrat-Light.ttf"))
        pdfmetrics.registerFont(TTFont("Mont-Bold",     FONT_DIR + "Montserrat-Bold.ttf"))
        pdfmetrics.registerFont(TTFont("Mont-SemiBold", FONT_DIR + "Montserrat-SemiBold.ttf"))
        pdfmetrics.registerFont(TTFont("Mont-Medium",   FONT_DIR + "Montserrat-Medium.ttf"))
        pdfmetrics.registerFont(TTFont("Mont-ExtraBold",FONT_DIR + "Montserrat-ExtraBold.ttf"))
    except Exception as e:
        print(f"⚠️ Aviso: No se pudieron registrar fuentes Montserrat ({e}). Usando fuentes default de ReportLab si falla.")

# ── Categorización ─────────────────────────────────────────
CATEGORY_MAP = [
    (["acd", "ktacd"],                 "ÁCIDOS"),
    (["oilesn"],                        "ACEITES ESENCIALES"),
    (["oil", "oilarg", "oilgrs", "oilbmb", "oilsml", "oilvrgn", "sbcrd", "vsl"], "ACEITES"),
    (["crcrn", "crabjrf", "lnln", "mntcc", "mntk", "mntklb", "mntccrfkg", "mntkkg", "mntk250g", "mntl100g", "mtnkrtkg", "prfn"],  "CERAS Y MANTECAS"),
    (["alcctl", "btms", "btncc", "crlnt", "ccmd", "tsscc", "tsci", "pls20", "polisb", "polsorb", "cocamid"], "EMULSIONANTES Y SURFACTANTES"),
    (["alnt", "frbsgl", "glc", "hyal", "niac", "dprp", "srb500", "urcsm"], "HUMECTANTES"),
    (["arc"],                           "ARCILLAS"),
    (["bcarna", "ctrca", "ctmg", "ctrmg", "clrmg", "ctrzn", "salmg", "salkmg", "clrcalb", "ctk", "srlch"], "SALES MINERALES"),
    (["oltk", "lctca", "gmxtn", "gmxnt", "brxlben", "slfcul"], "MINERALES"),
    (["dpnt", "vtmb", "vtmc", "vtma", "vtmd", "vtme"], "VITAMINAS"),
    (["bcaa", "clgnhd", "crtnmnh", "els", "gltssnbr", "prtasl", "gelat", "albhv", "larg", "lglt", "lisl", "lprl", "ltrp", "trn250"], "SUPLEMENTARIOS"),
    (["cfn", "extalvr", "extgsn", "extmlt", "extemtc", "mltdxtr", "mltdxlb", "algna", "cmcph", "cmclb", "coloid", "extmat", "gmsn", "actnalb", "agag", "almyc", "cpsvcglt", "dxdtlb", "dxtkg", "estmglb", "gltmns", "gmgr", "inl", "lctsyl", "ppn", "agdst", "h2ors", "agdst"], "EXCIPIENTES"),
    (["shrmx", "shrx", "phemx", "dmdm", "benz", "propgl", "potsorb", "sodbnz", "bnznalb", "mtbslfn", "srbk", "srbtkg"], "CONSERVANTES"),
    (["alls", "erttlb", "frct", "stvia", "xylitol", "crmtrt", "scr250"], "EDULCORANTES"),
    (["dha", "as-96", "retinol", "rtn5p", "niacin", "kojic", "alfarb", "dmso", "oxdzn", "mntl100", "vltgn"], "PRINCIPIOS ACTIVOS"),
    (["kt", "kit"],                     "KITS"),
    (["agtmgn", "bkr", "gtrvdr", "gtrvdramb", "gtr", "ppmt", "termm", "piseta", "filtro", "embudo", "cchmzcpls", "glslcarn", "rvv", "tds/eh"], "EQUIPOS Y MATERIALES LAB"),
    (["almlijmkt", "brcesc", "extelc", "frspdrmttx", "as-15", "pnttrscbl", "ktext", "repuesto", "dscvdr", "flnpvc", "owofan"], "HERRAMIENTAS Y EQUIPOS"),
    (["azm", "glt2p", "crbact"],        "AGRÍCOLA"),
    (["as-44", "as-86", "as-38", "collar", "mascot"], "MASCOTAS"),
]

def _categorize(sku: str) -> str:
    sku_low = sku.strip().lower()
    for prefixes, cat in CATEGORY_MAP:
        for pfx in prefixes:
            if sku_low.startswith(pfx) or sku_low == pfx:
                return cat
    return "OTROS"

def _fetch_meli_photos(token: str, meli_id_to_sku: dict) -> dict:
    if not meli_id_to_sku:
        return {}

    headers = {"Authorization": f"Bearer {token}"}
    item_ids = list(meli_id_to_sku.keys())
    id_url_map = {}
    
    for i in range(0, len(item_ids), 20):
        batch = item_ids[i:i+20]
        res = requests.get(
            "https://api.mercadolibre.com/items",
            params={"ids": ",".join(batch), "attributes": "id,pictures"},
            headers=headers, timeout=15
        )
        if res.status_code != 200: continue
        for entry in res.json():
            if entry.get("code") != 200: continue
            body = entry.get("body", {})
            item_id = body.get("id", "")
            pics = body.get("pictures", [])
            if not pics: continue
            url = pics[0].get("secure_url") or pics[0].get("url", "")
            if url: id_url_map[item_id] = url

    tmp_dir = tempfile.mkdtemp(prefix="mckenna_fotos_")
    local_map = {}
    for item_id, url in id_url_map.items():
        sku = meli_id_to_sku.get(item_id, "")
        if not sku: continue
        try:
            r = requests.get(url, timeout=15)
            if r.status_code == 200:
                safe_sku = re.sub(r'[^A-Za-z0-9_\-]', '_', sku)
                local_path = os.path.join(tmp_dir, f"{safe_sku}.jpg")
                with open(local_path, "wb") as f: f.write(r.content)
                local_map[sku] = local_path
        except Exception:
            pass
    return local_map

def _leer_productos_sheets(photo_map: dict = None):
    gc = gspread.service_account(filename=CREDS_PATH)
    wb = gc.open_by_key(SHEET_ID)
    ws = wb.sheet1
    rows = ws.get_all_values()
    photo_map = photo_map or {}

    header = [h.strip().upper() for h in rows[0]]
    idx_meli   = 0
    idx_sku    = next((i for i, h in enumerate(header) if "SKU" in h), 1)
    idx_nombre = next((i for i, h in enumerate(header) if "NOMBRE" in h), 3)
    idx_precio = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)

    seen_skus = set()
    sections = defaultdict(list)
    meli_id_to_sku = {}

    for row in rows[1:]:
        if len(row) <= max(idx_sku, idx_nombre, idx_precio): continue
        meli_id = str(row[idx_meli]).strip().upper() if row[idx_meli] else ""
        sku = row[idx_sku].strip()
        nombre = row[idx_nombre].strip()
        precio_raw = row[idx_precio].strip()

        if not sku or not nombre or not precio_raw: continue
        if sku in seen_skus: continue
        seen_skus.add(sku)

        if meli_id.startswith("MCO") and sku:
            meli_id_to_sku[meli_id] = sku

        try:
            precio_meli = float(precio_raw.replace(",", ""))
        except ValueError:
            continue

        precio_desc = precio_meli * 0.90
        ahorro = precio_meli * 0.10

        def fmt(n): return f"${n:,.0f}".replace(",", ".")

        cat = _categorize(sku)
        sections[cat].append({
            "name": nombre,
            "ref": sku,
            "meli": fmt(precio_meli),
            "precio": fmt(precio_desc),
            "ahorro": f"Ahorras {fmt(ahorro)} (10%)",
            "photo": photo_map.get(sku),
        })

    orden_secciones = [cat for _, cat in CATEGORY_MAP] + ["OTROS"]
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
            
    for cat, prods in sections.items():
        if cat not in seen_ord:
            result.append({"name": cat, "products": sorted(prods, key=lambda p: p["name"].lower())})

    return result, meli_id_to_sku

def _draw_cover(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)

    try:
        logo_reader = ImageReader(LOGO_PATH)
        orig = Image.open(LOGO_PATH)
        logo_aspect = orig.width / orig.height
        logo_w = CW * 0.56
        logo_h = logo_w / logo_aspect
        logo_x = (PW - logo_w) / 2
        logo_y = PH / 2 + 50
        c.drawImage(logo_reader, logo_x, logo_y, logo_w, logo_h)
        ref_x, ref_w = logo_x, logo_w
    except:
        ref_x, ref_w = MARGIN, CW
        logo_y = PH / 2 + 100

    line1_y = logo_y - 9
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.8)
    c.line(ref_x, line1_y, ref_x + ref_w, line1_y)

    title_y = line1_y - 30
    c.setFont("Mont-Bold", 19)
    c.setFillColor(ACCENT)
    c.drawCentredString(ref_x + ref_w / 2, title_y, "CATÁLOGO DE PRODUCTOS")

    box_pad, box_h = 11, 78
    box_y = title_y - 16
    box_bottom = box_y - box_h

    c.setStrokeColor(ACCENT)
    c.setFillColor(WHITE)
    c.setLineWidth(1.3)
    c.rect(ref_x, box_bottom, ref_w, box_h, fill=1, stroke=1)

    c.setFont("Mont-SemiBold", 8.5)
    c.setFillColor(ACCENT)
    c.drawString(ref_x + box_pad, box_bottom + box_h - box_pad - 8, "Insumos & Materias Primas")

    c.setFont("Mont-Regular", 11.5)
    c.setFillColor(GRAY)
    c.drawString(ref_x + box_pad, box_bottom + box_h - box_pad - 28, "Los mismos precios de MercadoLibre con 10% de descuento")

    c.setFont("Mont-Medium", 11.5)
    c.drawString(ref_x + box_pad, box_bottom + box_h - box_pad - 46, "al comprar en   www.mckennagroup.co")

    c.setFont("Mont-Light", 8)
    c.setFillColor(GRAY_LIGHT)
    c.drawRightString(ref_x + ref_w - box_pad, box_bottom + 6, "Abril 2026")

    c.showPage()

def _draw_header(c, section_name):
    iso_h = 20
    try:
        iso_reader = ImageReader(ISO_PATH)
        orig = Image.open(ISO_PATH)
        iso_w = iso_h * (orig.width / orig.height)
        iso_y = PH - MARGIN - iso_h
        iso_x = MARGIN + CW - iso_w
        c.drawImage(iso_reader, iso_x, iso_y, iso_w, iso_h, mask="auto")
    except:
        iso_y = PH - MARGIN - iso_h

    c.setFont("Mont-Bold", 9.5)
    c.setFillColor(ACCENT)
    c.drawString(MARGIN, iso_y + 4, section_name)

    line_y = iso_y - 5
    c.setStrokeColor(ACCENT)
    c.setLineWidth(0.9)
    c.line(MARGIN, line_y, MARGIN + CW, line_y)
    return line_y - 6

CARD_H = 82
CARD_PAD = 6

def _draw_card(c, x, y, w, prod):
    c.setStrokeColor(SEPARATOR)
    c.setLineWidth(0.4)
    c.line(x, y - CARD_H, x + w, y - CARD_H)

    photo_path = prod.get("photo")
    if photo_path and os.path.exists(photo_path):
        try:
            img = Image.open(photo_path)
            iw, ih = img.size
            aspect = iw / ih
            if aspect >= 1:
                pw, ph = float(PHOTO_SIZE), float(PHOTO_SIZE) / aspect
            else:
                ph, pw = float(PHOTO_SIZE), float(PHOTO_SIZE) * aspect

            zone_x, zone_y = x + CARD_PAD - 2, y - (CARD_H - PHOTO_SIZE) / 2 - PHOTO_SIZE
            c.setFillColor(colors.HexColor("#f5f8f9"))
            c.setStrokeColor(colors.HexColor("#dde8ea"))
            c.setLineWidth(0.5)
            c.roundRect(zone_x, zone_y, PHOTO_SIZE + 4, PHOTO_SIZE + 4, 3, fill=1, stroke=1)

            px, py = x + CARD_PAD + (PHOTO_SIZE - pw) / 2, y - (CARD_H + ph) / 2
            c.drawImage(ImageReader(photo_path), px, py, pw, ph, preserveAspectRatio=True, mask="auto")
        except Exception:
            photo_path = None

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
        if len(test) <= max_chars: cur = test
        else:
            if cur: lines.append(cur)
            cur = word
    if cur: lines.append(cur)
    lines = lines[:2]
    if len(lines) == 2 and len(name.split()) > len(" ".join(lines).split()):
        lines[1] = lines[1][:max_chars - 3].rstrip() + "..."

    ty = y - CARD_PAD
    for ln in lines:
        ty -= 9
        c.drawString(text_x, ty, ln)
    ty -= 4

    c.setFont("Mont-Light", 6.2)
    c.setFillColor(GRAY_LIGHT)
    ty -= 9
    c.drawString(text_x, ty, f"Ref: {prod.get('ref', '')}")
    ty -= 4

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

    precio_txt = f"{prod.get('precio', '')} COP"
    c.setFont("Mont-Bold", 10.5)
    c.setFillColor(ACCENT)
    ty -= 10
    c.drawString(text_x, ty, precio_txt)

    ahorro = prod.get("ahorro", "")
    if ahorro:
        pw_txt = c.stringWidth(precio_txt, "Mont-Bold", 10.5)
        c.setFont("Mont-Light", 6)
        c.setFillColor(GREEN)
        c.drawString(text_x + pw_txt + 5, ty + 1, ahorro)

SECTION_TITLE_H = 19
def _draw_interior_pages(c, sections):
    col_x = [MARGIN, MARGIN + COL_W + COL_GAP]
    CONTENT_BOT = MARGIN

    def new_page(section_name):
        c.showPage()
        c.setFillColor(WHITE)
        c.rect(0, 0, PW, PH, fill=1, stroke=0)
        ct = _draw_header(c, section_name)
        return ct, [ct, ct], 0

    def draw_section_title(c, cx, cy, title, count):
        c.setFont("Mont-Bold", 9)
        c.setFillColor(ACCENT)
        c.drawString(cx, cy - 13, f"{title}  ({count})")
        c.setStrokeColor(ACCENT)
        c.setLineWidth(0.5)
        c.line(cx, cy - 15, cx + COL_W, cy - 15)
        return cy - SECTION_TITLE_H

    first_sec = sections[0]["name"] if sections else "CATÁLOGO"
    content_top, col_y, col_idx = new_page(first_sec)
    current_section = first_sec

    for sec in sections:
        sname, prods = sec["name"], sec["products"]
        if not prods: continue

        need = SECTION_TITLE_H + CARD_H
        if col_y[col_idx] - need < CONTENT_BOT:
            col_idx += 1
            if col_idx > 1:
                content_top, col_y, col_idx = new_page(sname)
                current_section = sname

        if col_idx <= 1 and col_y[col_idx] - need < CONTENT_BOT:
            content_top, col_y, col_idx = new_page(sname)
            current_section = sname

        cx = col_x[col_idx]
        col_y[col_idx] = draw_section_title(c, cx, col_y[col_idx], sname, len(prods))

        for prod in prods:
            if col_y[col_idx] - CARD_H < CONTENT_BOT:
                col_idx += 1
                if col_idx > 1:
                    content_top, col_y, col_idx = new_page(current_section)
                    current_section = sname
            _draw_card(c, col_x[col_idx], col_y[col_idx], COL_W, prod)
            col_y[col_idx] -= CARD_H

def _draw_closing(c):
    c.showPage()
    c.setFillColor(WHITE)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)
    try:
        logo_reader = ImageReader(LOGO_PATH)
        orig = Image.open(LOGO_PATH)
        logo_w = CW * 0.50
        logo_h = logo_w / (orig.width / orig.height)
        logo_x = (PW - logo_w) / 2
        logo_y = PH / 2 + 20
        c.drawImage(logo_reader, logo_x, logo_y, logo_w, logo_h)
    except:
        logo_x, logo_w, logo_y = MARGIN, CW, PH / 2

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

def generar_catalogo_pdf(enviar_a_whatsapp: bool = False, telefono_whatsapp: str = "") -> str:
    """
    Genera el Catálogo PDF McKenna Group tomando datos de Google Sheets y 
    fotos desde publicaciones activas de MercadoLibre.
    Opcionalmente lo envía por WhatsApp.
    
    :param enviar_a_whatsapp: True si se desea enviar al grupo de WhatsApp por defecto (o al telefono dado).
    :param telefono_whatsapp: Número de teléfono (con código de país) si se desea enviar a alguien específico.
    """
    try:
        _registrar_fuentes()
    except Exception as e:
        return f"❌ Error registrando fuentes: {e}"

    salida = ["📄 Iniciando generación de Catálogo PDF..."]
    
    try:
        sections, meli_id_to_sku = _leer_productos_sheets()
        salida.append(f"✅ Productos cargados desde Sheets: {sum(len(s['products']) for s in sections)}")
    except Exception as e:
        return f"❌ Error leyendo Google Sheets: {e}"

    try:
        token = refrescar_token_meli()
        photo_map = _fetch_meli_photos(token, meli_id_to_sku) if token and meli_id_to_sku else {}
        salida.append(f"📸 Fotos descargadas de MeLi: {len(photo_map)}")
    except Exception as e:
        salida.append(f"⚠️ Error obteniendo fotos de MeLi: {e}")
        photo_map = {}

    for sec in sections:
        for prod in sec["products"]:
            sku = prod.get("ref", "")
            if sku in photo_map:
                prod["photo"] = photo_map[sku]

    try:
        cv = canvas.Canvas(OUT_PDF, pagesize=A4)
        cv.setTitle("Catálogo McKenna Group")
        cv.setAuthor("McKenna Group S.A.S.")
        _draw_cover(cv)
        _draw_interior_pages(cv, sections)
        _draw_closing(cv)
        cv.save()
        salida.append(f"✅ Catálogo PDF generado exitosamente en {OUT_PDF}")
    except Exception as e:
        return f"❌ Error generando el archivo PDF: {e}"

    if enviar_a_whatsapp or telefono_whatsapp:
        try:
            texto = "📦 *Catálogo McKenna Group*\nPrecios actualizados con 10% de descuento."
            # El modulo utilitario enviar_whatsapp_archivo puede aceptar un 'to' o usar el grupo por defecto.
            # Suponemos que si se manda sin destinatario envia al grupo.
            kw = {"file_path": OUT_PDF, "texto_mensaje": texto, "file_name": "Catalogo_McKenna.pdf"}
            if telefono_whatsapp:
                kw["to_number"] = telefono_whatsapp # si la funcion lo soporta (si no, enviará al default)
                
            enviado = enviar_whatsapp_archivo(**kw)
            if enviado:
                salida.append("💬 Catálogo enviado por WhatsApp.")
            else:
                salida.append("⚠️ PDF listo pero falló el envío por WhatsApp.")
        except Exception as e:
            salida.append(f"⚠️ Error intentando enviar por WhatsApp: {e}")

    return "\n".join(salida)
