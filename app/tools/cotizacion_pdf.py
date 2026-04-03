"""
REC-02: Generación automática de Cotizaciones en PDF
Membrete corporativo McKenna Group S.A.S.
Envía al cliente por WhatsApp y al grupo.
"""

import os
import json
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

CARPETA = os.path.join("/home/mckg/mi-agente", "cotizaciones_pdf")
os.makedirs(CARPETA, exist_ok=True)

AZUL_OSCURO = colors.HexColor("#0f172a")
AZUL        = colors.HexColor("#1e3a8a")
AZUL_CLARO  = colors.HexColor("#dbeafe")
GRIS        = colors.HexColor("#64748b")
GRIS_CLARO  = colors.HexColor("#f8fafc")
VERDE       = colors.HexColor("#166534")
BLANCO      = colors.white


def generar_cotizacion_pdf(cotizacion: dict) -> str:
    """
    Genera PDF de cotización con membrete corporativo.

    cotizacion = {
        "numero": "COT-2026-001",
        "fecha": "2026-04-02",
        "cliente": {"nombre": "...", "nit": "...", "correo": "...", "direccion": "..."},
        "productos": [{"nombre": "...", "sku": "...", "cantidad": 1, "precio_unit": 5000, "subtotal": 5000}],
        "subtotal": 100000,
        "iva": 19000,
        "total": 119000,
        "notas": "..."
    }
    Retorna la ruta del PDF generado.
    """
    numero   = cotizacion.get("numero", f"COT-{datetime.now().strftime('%Y%m%d%H%M%S')}")
    filename = os.path.join(CARPETA, f"{numero}.pdf")

    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        topMargin=1.5*cm, bottomMargin=2*cm,
        leftMargin=2*cm, rightMargin=2*cm
    )

    styles = getSampleStyleSheet()
    estilos = {
        "titulo":   ParagraphStyle("titulo",   fontSize=22, fontName="Helvetica-Bold", textColor=BLANCO,      alignment=TA_LEFT,   leading=26),
        "subtitulo":ParagraphStyle("subtitulo",fontSize=10, fontName="Helvetica",      textColor=AZUL_CLARO,  alignment=TA_LEFT),
        "seccion":  ParagraphStyle("seccion",  fontSize=9,  fontName="Helvetica-Bold", textColor=AZUL,        spaceAfter=6, spaceBefore=14, textTransform="uppercase"),
        "normal":   ParagraphStyle("normal",   fontSize=9,  fontName="Helvetica",      textColor=AZUL_OSCURO, leading=14),
        "small":    ParagraphStyle("small",    fontSize=8,  fontName="Helvetica",      textColor=GRIS,        leading=11),
        "total":    ParagraphStyle("total",    fontSize=12, fontName="Helvetica-Bold", textColor=AZUL_OSCURO, alignment=TA_RIGHT),
        "footer":   ParagraphStyle("footer",   fontSize=7.5,fontName="Helvetica",      textColor=GRIS,        alignment=TA_CENTER),
        "numero":   ParagraphStyle("numero",   fontSize=10, fontName="Helvetica-Bold", textColor=AZUL_CLARO,  alignment=TA_RIGHT),
    }

    story = []
    ancho_util = letter[0] - 4*cm

    # ── HEADER con fondo azul
    header_data = [[
        Paragraph(f"<b>McKenna Group S.A.S.</b>", estilos["titulo"]),
        Paragraph(f"<b>COTIZACIÓN</b><br/>{numero}", estilos["numero"])
    ]]
    header_table = Table(header_data, colWidths=[ancho_util*0.6, ancho_util*0.4])
    header_table.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,-1), AZUL),
        ("TOPPADDING",    (0,0), (-1,-1), 18),
        ("BOTTOMPADDING", (0,0), (-1,-1), 18),
        ("LEFTPADDING",   (0,0), (0,-1),  18),
        ("RIGHTPADDING",  (-1,0),(-1,-1), 18),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
    ]))
    story.append(header_table)

    # Franja inferior del header
    sub_data = [[
        Paragraph("Materias Primas Farmacéuticas y Cosméticas · Bogotá, Colombia", estilos["subtitulo"]),
        Paragraph(f"Fecha: {cotizacion.get('fecha', datetime.now().strftime('%d/%m/%Y'))}", estilos["subtitulo"])
    ]]
    sub_table = Table(sub_data, colWidths=[ancho_util*0.65, ancho_util*0.35])
    sub_table.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,-1), AZUL_OSCURO),
        ("TOPPADDING",    (0,0), (-1,-1), 7),
        ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ("LEFTPADDING",   (0,0), (0,-1),  18),
        ("RIGHTPADDING",  (-1,0),(-1,-1), 18),
        ("ALIGN",         (1,0), (1,-1),  "RIGHT"),
    ]))
    story.append(sub_table)
    story.append(Spacer(1, 14))

    # ── DATOS CLIENTE
    cliente = cotizacion.get("cliente", {})
    story.append(Paragraph("Datos del Cliente", estilos["seccion"]))
    cliente_data = [
        ["Razón Social / Nombre:", cliente.get("nombre", "—"),  "NIT / Cédula:", cliente.get("nit", "—")],
        ["Correo electrónico:",    cliente.get("correo", "—"),  "Dirección:",    cliente.get("direccion", "—")],
    ]
    ct = Table(cliente_data, colWidths=[ancho_util*0.18, ancho_util*0.32, ancho_util*0.18, ancho_util*0.32])
    ct.setStyle(TableStyle([
        ("FONTNAME",      (0,0), (0,-1), "Helvetica-Bold"),
        ("FONTNAME",      (2,0), (2,-1), "Helvetica-Bold"),
        ("FONTSIZE",      (0,0), (-1,-1), 8.5),
        ("TEXTCOLOR",     (0,0), (0,-1), GRIS),
        ("TEXTCOLOR",     (2,0), (2,-1), GRIS),
        ("TEXTCOLOR",     (1,0), (1,-1), AZUL_OSCURO),
        ("TEXTCOLOR",     (3,0), (3,-1), AZUL_OSCURO),
        ("TOPPADDING",    (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("LINEBELOW",     (0,-1), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    story.append(ct)
    story.append(Spacer(1, 14))

    # ── TABLA DE PRODUCTOS
    story.append(Paragraph("Detalle de Productos", estilos["seccion"]))
    prod_headers = ["#", "Descripción", "SKU / Ref.", "Cantidad", "Precio Unit.", "Subtotal"]
    prod_rows = [prod_headers]
    productos = cotizacion.get("productos", [])
    for i, p in enumerate(productos, 1):
        prod_rows.append([
            str(i),
            p.get("nombre", ""),
            p.get("sku", "—"),
            str(p.get("cantidad", 0)),
            f"${p.get('precio_unit', 0):,.0f}",
            f"${p.get('subtotal', 0):,.0f}",
        ])

    col_ws = [ancho_util*0.05, ancho_util*0.38, ancho_util*0.13, ancho_util*0.09, ancho_util*0.15, ancho_util*0.15]
    pt = Table(prod_rows, colWidths=col_ws, repeatRows=1)
    pt.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,0), AZUL),
        ("TEXTCOLOR",     (0,0), (-1,0), BLANCO),
        ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",      (0,0), (-1,-1), 8.5),
        ("ALIGN",         (3,0), (-1,-1), "RIGHT"),
        ("ALIGN",         (0,0), (0,-1), "CENTER"),
        ("TOPPADDING",    (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("LEFTPADDING",   (0,0), (-1,-1), 8),
        ("RIGHTPADDING",  (0,0), (-1,-1), 8),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [BLANCO, GRIS_CLARO]),
        ("GRID",          (0,0), (-1,-1), 0.4, colors.HexColor("#e2e8f0")),
        ("FONTNAME",      (0,1), (-1,-1), "Helvetica"),
    ]))
    story.append(pt)
    story.append(Spacer(1, 14))

    # ── TOTALES (alineados a la derecha)
    sub  = cotizacion.get("subtotal", 0)
    iva  = cotizacion.get("iva", 0)
    tot  = cotizacion.get("total", 0)
    totales_data = [
        ["", "Subtotal:",   f"${sub:,.0f}"],
        ["", "IVA (19%):",  f"${iva:,.0f}"],
        ["", "TOTAL:",      f"${tot:,.0f}"],
    ]
    tot_t = Table(totales_data, colWidths=[ancho_util*0.60, ancho_util*0.20, ancho_util*0.20])
    tot_t.setStyle(TableStyle([
        ("FONTSIZE",      (0,0), (-1,-1), 9),
        ("FONTNAME",      (1,0), (1,-1), "Helvetica-Bold"),
        ("ALIGN",         (1,0), (-1,-1), "RIGHT"),
        ("TEXTCOLOR",     (1,0), (1,1), GRIS),
        ("BACKGROUND",    (1,2), (2,2), AZUL),
        ("TEXTCOLOR",     (1,2), (2,2), BLANCO),
        ("FONTNAME",      (1,2), (2,2), "Helvetica-Bold"),
        ("FONTSIZE",      (1,2), (2,2), 11),
        ("TOPPADDING",    (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("RIGHTPADDING",  (2,0), (2,-1), 10),
    ]))
    story.append(tot_t)
    story.append(Spacer(1, 18))

    # ── NOTA / INSTRUCCIONES
    notas = cotizacion.get("notas", "")
    info = (
        "Una vez realice el pago, envíe el comprobante por WhatsApp para proceder con la "
        "emisión de la Factura Electrónica oficial y el despacho del pedido."
    )
    notas_data = [[
        Paragraph(f"<b>Nota:</b> {notas + ' — ' if notas else ''}{info}", estilos["small"])
    ]]
    nt = Table(notas_data, colWidths=[ancho_util])
    nt.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,-1), AZUL_CLARO),
        ("BOX",           (0,0), (-1,-1), 0.5, AZUL),
        ("TOPPADDING",    (0,0), (-1,-1), 10),
        ("BOTTOMPADDING", (0,0), (-1,-1), 10),
        ("LEFTPADDING",   (0,0), (-1,-1), 12),
        ("RIGHTPADDING",  (0,0), (-1,-1), 12),
    ]))
    story.append(nt)

    # ── FOOTER
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "McKenna Group S.A.S. · NIT: 901.XXX.XXX-X · Bogotá, Colombia · mckenna.group.colombia@gmail.com\n"
        "Esta cotización tiene validez de 15 días calendario a partir de la fecha de emisión.",
        estilos["footer"]
    ))

    doc.build(story)
    print(f"📄 [COTIZACIÓN PDF] Generado: {filename}")
    return filename


def enviar_cotizacion(cotizacion: dict, numero_cliente: str) -> str:
    """
    Genera el PDF y lo envía por WhatsApp al cliente y al grupo.
    """
    from app.utils import enviar_whatsapp_archivo, enviar_whatsapp_reporte

    ruta = generar_cotizacion_pdf(cotizacion)
    numero_cot = cotizacion.get("numero", "COT")
    total      = cotizacion.get("total", 0)
    cliente    = cotizacion.get("cliente", {}).get("nombre", "Cliente")

    caption = (
        f"📋 *Cotización {numero_cot}*\n"
        f"👤 {cliente}\n"
        f"💵 Total: *${total:,.0f} COP*\n\n"
        f"📌 Válida por 15 días. Una vez realizado el pago, envíe el comprobante para "
        f"proceder con la factura electrónica y el despacho."
    )

    # Enviar al cliente
    enviar_whatsapp_archivo(ruta, caption, numero_destino=numero_cliente)
    # Enviar al grupo
    enviar_whatsapp_reporte(f"📋 Cotización {numero_cot} enviada a {cliente} · Total: ${total:,.0f} COP")

    return ruta
