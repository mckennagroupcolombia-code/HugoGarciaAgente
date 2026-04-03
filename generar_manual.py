"""
generar_manual.py — Manual de Usuario del Agente Hugo García
McKenna Group S.A.S.

Genera el PDF del manual y lo envía por correo a cynthua0418@gmail.com.
Uso:
    python3 generar_manual.py           # solo genera PDF
    python3 generar_manual.py --enviar  # genera y envía por correo
"""

import os, sys, re, json, smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text       import MIMEText
from email.mime.base       import MIMEBase
from email                 import encoders

from reportlab.lib.pagesizes  import A4
from reportlab.lib.units      import cm, mm
from reportlab.lib            import colors
from reportlab.lib.styles     import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums      import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus       import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether, ListFlowable, ListItem
)
from reportlab.platypus.flowables import HRFlowable
from reportlab.pdfgen          import canvas as pdf_canvas

# ══════════════════════════════════════════════
# PALETA McKENNA
# ══════════════════════════════════════════════
C_NAVY    = colors.HexColor('#0f172a')
C_BLUE    = colors.HexColor('#1e3a8a')
C_BLUE2   = colors.HexColor('#1d4ed8')
C_BLUE3   = colors.HexColor('#3b82f6')
C_BLUE4   = colors.HexColor('#93c5fd')
C_GREEN   = colors.HexColor('#16a34a')
C_AMBER   = colors.HexColor('#d97706')
C_RED     = colors.HexColor('#dc2626')
C_PURPLE  = colors.HexColor('#7c3aed')
C_TEAL    = colors.HexColor('#0d9488')
C_GRAY    = colors.HexColor('#64748b')
C_LGRAY   = colors.HexColor('#f1f5f9')
C_MGRAY   = colors.HexColor('#e2e8f0')
C_WHITE   = colors.white
C_BLACK   = colors.HexColor('#0f172a')

OUT_PDF   = os.path.join(os.path.dirname(__file__), 'Manual_Hugo_Garcia_McKenna.pdf')
PAGE_W, PAGE_H = A4
MARGEN    = 2.2 * cm

fecha_gen = datetime.now().strftime('%d de %B de %Y')
fecha_short = datetime.now().strftime('%d/%m/%Y')


# ══════════════════════════════════════════════
# HEADER / FOOTER EN CADA PÁGINA
# ══════════════════════════════════════════════

class PaginaDecoracion:
    def __init__(self, titulo_doc: str):
        self.titulo_doc = titulo_doc

    def __call__(self, canv: pdf_canvas.Canvas, doc):
        canv.saveState()
        # Barra superior azul
        canv.setFillColor(C_NAVY)
        canv.rect(0, PAGE_H - 1.1*cm, PAGE_W, 1.1*cm, fill=1, stroke=0)
        canv.setFillColor(C_WHITE)
        canv.setFont('Helvetica-Bold', 7)
        canv.drawString(MARGEN, PAGE_H - 0.72*cm, 'MCKENNA GROUP S.A.S.')
        canv.setFont('Helvetica', 7)
        canv.drawRightString(PAGE_W - MARGEN, PAGE_H - 0.72*cm,
                             f'Manual de Usuario · Hugo García · {self.titulo_doc}')

        # Barra inferior
        canv.setFillColor(C_BLUE)
        canv.rect(0, 0, PAGE_W, 0.9*cm, fill=1, stroke=0)
        canv.setFillColor(C_WHITE)
        canv.setFont('Helvetica', 7)
        canv.drawString(MARGEN, 0.28*cm, f'Confidencial · {fecha_short}')
        canv.setFont('Helvetica-Bold', 7)
        canv.drawCentredString(PAGE_W / 2, 0.28*cm, 'mckennagroup.co')
        canv.drawRightString(PAGE_W - MARGEN, 0.28*cm, f'Página {doc.page}')

        canv.restoreState()


# ══════════════════════════════════════════════
# ESTILOS
# ══════════════════════════════════════════════

def estilos():
    base = getSampleStyleSheet()

    s = {}
    s['portada_empresa'] = ParagraphStyle('portada_empresa',
        fontName='Helvetica', fontSize=9, textColor=C_BLUE4,
        spaceAfter=4, alignment=TA_CENTER)

    s['portada_titulo'] = ParagraphStyle('portada_titulo',
        fontName='Helvetica-Bold', fontSize=32, textColor=C_WHITE,
        leading=38, spaceAfter=6, alignment=TA_CENTER)

    s['portada_subtitulo'] = ParagraphStyle('portada_subtitulo',
        fontName='Helvetica', fontSize=15, textColor=C_BLUE4,
        leading=20, spaceAfter=10, alignment=TA_CENTER)

    s['portada_desc'] = ParagraphStyle('portada_desc',
        fontName='Helvetica', fontSize=10, textColor=colors.HexColor('#bfdbfe'),
        leading=16, alignment=TA_CENTER)

    s['kpi_num'] = ParagraphStyle('kpi_num',
        fontName='Helvetica-Bold', fontSize=22, textColor=C_WHITE,
        alignment=TA_CENTER, spaceAfter=1)

    s['kpi_lbl'] = ParagraphStyle('kpi_lbl',
        fontName='Helvetica', fontSize=7, textColor=C_BLUE4,
        alignment=TA_CENTER, spaceBefore=1)

    s['section_tag'] = ParagraphStyle('section_tag',
        fontName='Helvetica-Bold', fontSize=8, textColor=C_BLUE2,
        spaceBefore=14, spaceAfter=2)

    s['section_title'] = ParagraphStyle('section_title',
        fontName='Helvetica-Bold', fontSize=18, textColor=C_NAVY,
        leading=22, spaceAfter=6, spaceBefore=2)

    s['subsection'] = ParagraphStyle('subsection',
        fontName='Helvetica-Bold', fontSize=12, textColor=C_BLUE,
        leading=16, spaceAfter=4, spaceBefore=8)

    s['body'] = ParagraphStyle('body',
        fontName='Helvetica', fontSize=9.5, textColor=colors.HexColor('#374151'),
        leading=15, spaceAfter=6, alignment=TA_JUSTIFY)

    s['body_small'] = ParagraphStyle('body_small',
        fontName='Helvetica', fontSize=8.5, textColor=C_GRAY,
        leading=13, spaceAfter=4)

    s['code'] = ParagraphStyle('code',
        fontName='Courier', fontSize=8.5, textColor=C_NAVY,
        backColor=C_LGRAY, leading=13,
        leftIndent=6, rightIndent=6,
        borderPad=4, spaceAfter=4)

    s['bullet'] = ParagraphStyle('bullet',
        fontName='Helvetica', fontSize=9.5, textColor=colors.HexColor('#374151'),
        leading=15, spaceAfter=3, leftIndent=14, firstLineIndent=-10)

    s['table_header'] = ParagraphStyle('table_header',
        fontName='Helvetica-Bold', fontSize=8, textColor=C_WHITE, alignment=TA_CENTER)

    s['table_cell'] = ParagraphStyle('table_cell',
        fontName='Helvetica', fontSize=8.5, textColor=C_NAVY, leading=12)

    s['table_cell_c'] = ParagraphStyle('table_cell_c',
        fontName='Helvetica', fontSize=8.5, textColor=C_NAVY, alignment=TA_CENTER, leading=12)

    s['badge'] = ParagraphStyle('badge',
        fontName='Helvetica-Bold', fontSize=7, textColor=C_WHITE, alignment=TA_CENTER)

    s['toc_item'] = ParagraphStyle('toc_item',
        fontName='Helvetica', fontSize=10, textColor=C_NAVY,
        leading=18, leftIndent=0, spaceAfter=2)

    s['toc_sub'] = ParagraphStyle('toc_sub',
        fontName='Helvetica', fontSize=9, textColor=C_GRAY,
        leading=15, leftIndent=18, spaceAfter=1)

    s['alert_title'] = ParagraphStyle('alert_title',
        fontName='Helvetica-Bold', fontSize=9.5, textColor=C_NAVY,
        leading=14, spaceAfter=2)

    s['alert_body'] = ParagraphStyle('alert_body',
        fontName='Helvetica', fontSize=9, textColor=colors.HexColor('#374151'),
        leading=14)

    return s


# ══════════════════════════════════════════════
# HELPERS DE BLOQUES
# ══════════════════════════════════════════════

def hr(color=C_MGRAY, thickness=0.5, space=8):
    return HRFlowable(width='100%', thickness=thickness, color=color,
                      spaceAfter=space, spaceBefore=space)

def sp(h=0.3):
    return Spacer(1, h * cm)

def section_header(tag: str, titulo: str, s: dict, color=C_BLUE2):
    s['section_tag'].textColor = color
    return [
        Paragraph(tag.upper(), s['section_tag']),
        Paragraph(titulo, s['section_title']),
        hr(color, thickness=1.2, space=6),
    ]

def subsection(titulo: str, s: dict, color=C_BLUE):
    st = ParagraphStyle('__sub', fontName='Helvetica-Bold', fontSize=11,
                        textColor=color, leading=16, spaceAfter=4, spaceBefore=10)
    return Paragraph(titulo, st)

def body(texto: str, s: dict):
    return Paragraph(texto, s['body'])

def nota(emoji: str, texto: str, s: dict, bg=None, border=None):
    """Caja de nota/alerta con fondo coloreado."""
    bg    = bg     or C_LGRAY
    brd   = border or C_MGRAY
    inner = Table(
        [[Paragraph(f'<b>{emoji}</b>', s['alert_title']),
          Paragraph(texto, s['alert_body'])]],
        colWidths=[0.9*cm, None]
    )
    inner.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (0,0), 0),
        ('RIGHTPADDING', (0,0), (0,0), 4),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
    ]))
    outer = Table([[inner]], colWidths=[PAGE_W - 2*MARGEN])
    outer.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), bg),
        ('BOX', (0,0), (-1,-1), 0.5, brd),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [bg]),
    ]))
    return outer

def tabla_comandos(filas: list, s: dict, col_widths=None):
    """Tabla de comandos con header azul y filas alternadas."""
    header = filas[0]
    data   = [
        [Paragraph(str(c), s['table_header']) for c in header]
    ] + [
        [Paragraph(str(c), s['table_cell'] if i < len(r)-1 else s['table_cell'])
         for i, c in enumerate(r)]
        for r in filas[1:]
    ]
    col_w = col_widths or [None]
    t = Table(data, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,0),   C_NAVY),
        ('TEXTCOLOR',     (0,0), (-1,0),   C_WHITE),
        ('ROWBACKGROUNDS',(0,1), (-1,-1),  [C_WHITE, C_LGRAY]),
        ('FONTNAME',      (0,0), (-1,0),   'Helvetica-Bold'),
        ('FONTSIZE',      (0,0), (-1,0),   8),
        ('FONTNAME',      (0,1), (-1,-1),  'Helvetica'),
        ('FONTSIZE',      (0,1), (-1,-1),  8.5),
        ('GRID',          (0,0), (-1,-1),  0.4, C_MGRAY),
        ('VALIGN',        (0,0), (-1,-1),  'MIDDLE'),
        ('LEFTPADDING',   (0,0), (-1,-1),  8),
        ('RIGHTPADDING',  (0,0), (-1,-1),  8),
        ('TOPPADDING',    (0,0), (-1,-1),  5),
        ('BOTTOMPADDING', (0,0), (-1,-1),  5),
    ]))
    return t

def modulo_card(emoji: str, codigo: str, titulo: str, desc: str, s: dict, color=C_BLUE2):
    """Tarjeta de módulo funcional."""
    badge_t = Table([[Paragraph(codigo, s['badge'])]],
                     colWidths=[1.4*cm])
    badge_t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), color),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
    ]))
    title_st = ParagraphStyle('__ct', fontName='Helvetica-Bold', fontSize=10,
                              textColor=C_NAVY, leading=14, spaceAfter=3)
    desc_st  = ParagraphStyle('__cd', fontName='Helvetica', fontSize=9,
                              textColor=colors.HexColor('#374151'), leading=13)
    content = Table(
        [[badge_t, Paragraph(f'{emoji}  {titulo}', title_st)],
         ['',      Paragraph(desc, desc_st)]],
        colWidths=[1.6*cm, PAGE_W - 2*MARGEN - 1.8*cm]
    )
    content.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('SPAN',   (0,1), (0,1)),
        ('TOPPADDING',    (0,0), (-1,-1), 2),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ('LEFTPADDING',   (0,0), (-1,-1), 0),
        ('RIGHTPADDING',  (0,0), (-1,-1), 0),
    ]))
    outer = Table([[content]], colWidths=[PAGE_W - 2*MARGEN])
    outer.setStyle(TableStyle([
        ('BOX',           (0,0), (-1,-1), 0.6, C_MGRAY),
        ('BACKGROUND',    (0,0), (-1,-1), C_WHITE),
        ('TOPPADDING',    (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING',   (0,0), (-1,-1), 10),
        ('RIGHTPADDING',  (0,0), (-1,-1), 10),
        ('ROWBACKGROUNDS',(0,0), (-1,-1), [C_WHITE]),
    ]))
    return outer


# ══════════════════════════════════════════════
# PORTADA
# ══════════════════════════════════════════════

def portada(s: dict) -> list:
    elems = []

    # Espacio superior
    elems.append(sp(3.5))

    # Línea decorativa superior
    elems.append(HRFlowable(width='100%', thickness=3, color=C_BLUE2, spaceAfter=20))

    # Empresa
    elems.append(Paragraph('McKenna Group S.A.S. · Bogotá, Colombia', s['portada_empresa']))
    elems.append(sp(0.4))

    # Título principal — sobre fondo oscuro (usando tabla)
    t = Table(
        [[Paragraph('Manual de Usuario', s['portada_titulo'])],
         [Paragraph('Agente de Automatización Empresarial', s['portada_subtitulo'])],
         [Paragraph('Hugo García', ParagraphStyle('__hg', fontName='Helvetica-Bold',
                    fontSize=42, textColor=colors.HexColor('#fbbf24'),
                    leading=48, alignment=TA_CENTER))]],
        colWidths=[PAGE_W - 2*MARGEN]
    )
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,-1), C_NAVY),
        ('TOPPADDING',    (0,0), (-1,-1), 22),
        ('BOTTOMPADDING', (0,0), (-1,-1), 22),
        ('LEFTPADDING',   (0,0), (-1,-1), 20),
        ('RIGHTPADDING',  (0,0), (-1,-1), 20),
    ]))
    elems.append(t)
    elems.append(sp(0.5))

    # Descripción
    elems.append(Paragraph(
        'Guía completa de operación, comandos, arquitectura técnica y flujos de trabajo<br/>'
        f'del sistema de automatización empresarial de McKenna Group · v2.1 · {fecha_gen}',
        s['portada_desc']
    ))
    elems.append(sp(1.2))

    # KPIs de portada
    kpi_data = [
        [Paragraph('97%', s['kpi_num']),
         Paragraph('24/7', s['kpi_num']),
         Paragraph('30', s['kpi_num']),
         Paragraph('10+', s['kpi_num'])],
        [Paragraph('Automatización', s['kpi_lbl']),
         Paragraph('Disponibilidad', s['kpi_lbl']),
         Paragraph('Herramientas IA', s['kpi_lbl']),
         Paragraph('Módulos activos', s['kpi_lbl'])],
    ]
    kpi_t = Table(kpi_data, colWidths=[(PAGE_W - 2*MARGEN)/4]*4)
    kpi_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,-1), C_BLUE),
        ('TOPPADDING',    (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('GRID',          (0,0), (-1,-1), 0.4, C_BLUE2),
    ]))
    elems.append(kpi_t)
    elems.append(sp(1.5))

    # Línea decorativa inferior
    elems.append(HRFlowable(width='100%', thickness=3, color=C_BLUE2))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# TABLA DE CONTENIDOS
# ══════════════════════════════════════════════

def tabla_contenidos(s: dict) -> list:
    elems = []
    elems += section_header('Índice', 'Tabla de Contenidos', s, C_BLUE)
    elems.append(sp(0.3))

    toc = [
        ('01', 'Introducción y Visión General', [
            'Qué es Hugo García', 'Canales de comunicación', 'Requisitos para operar']),
        ('02', 'Arquitectura del Sistema', [
            '3 procesos independientes', 'Integraciones externas', 'Stack tecnológico']),
        ('03', 'Módulos Funcionales', [
            'MOD-01 a MOD-10 descritos']),
        ('04', 'Guía de Comandos — Grupo de Contabilidad', [
            'Confirmación de pagos', 'Preventa MercadoLibre', 'Control IA/Humano',
            'Respuestas directas', 'Aprobación de facturas']),
        ('05', 'Flujo de Atención al Cliente WhatsApp', [
            'Primer contacto', 'Consulta de productos', 'Cotización paso a paso',
            'Envío de comprobante', 'Facturación y despacho']),
        ('06', 'Preventa MercadoLibre', [
            'Cómo funciona la IA', 'Fichas técnicas en Google Sheets',
            'Respuesta manual del operador', 'Aprendizaje continuo']),
        ('07', 'Sincronización de Inventario', [
            'Principio de stock', 'MeLi ↔ WooCommerce', 'Comandos de sync']),
        ('08', 'Facturación SIIGO y Documentos Fiscales', [
            'Ciclo completo de facturación', 'Facturas de compra desde Gmail']),
        ('09', 'Panel Web y Menú CLI', [
            'Panel en navegador', 'Menú interactivo CLI']),
        ('10', 'Monitor de Alertas Automáticas', [
            'Alertas programadas', 'Reportes automáticos', 'Backup nocturno']),
        ('11', 'Glosario Técnico y Preguntas Frecuentes', [
            'Términos clave', 'FAQ operadores', 'Solución de problemas']),
    ]

    for num, titulo, subs in toc:
        row_data = [
            [Paragraph(num, ParagraphStyle('__n', fontName='Helvetica-Bold',
                        fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
             Paragraph(titulo, ParagraphStyle('__tt', fontName='Helvetica-Bold',
                        fontSize=10, textColor=C_NAVY))]
        ]
        row_t = Table(row_data, colWidths=[0.8*cm, PAGE_W - 2*MARGEN - 1.0*cm])
        row_t.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (0,0),  C_BLUE2),
            ('VALIGN',        (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING',    (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('LEFTPADDING',   (0,0), (0,0),  4),
            ('RIGHTPADDING',  (0,0), (0,0),  4),
            ('LEFTPADDING',   (1,0), (1,0),  8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('LINEBELOW',     (0,0), (-1,-1), 0.3, C_MGRAY),
        ]))
        elems.append(row_t)

        for sub in subs:
            elems.append(Paragraph(
                f'&#8226;&#160;&#160;{sub}',
                ParagraphStyle('__s', fontName='Helvetica', fontSize=8.5,
                               textColor=C_GRAY, leading=14, leftIndent=18)
            ))
        elems.append(sp(0.15))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 01 — INTRODUCCIÓN
# ══════════════════════════════════════════════

def sec01_introduccion(s: dict) -> list:
    elems = []
    elems += section_header('Sección 01', 'Introducción y Visión General', s, C_BLUE2)

    elems.append(body(
        '<b>Hugo García</b> es el agente de automatización empresarial de McKenna Group S.A.S., '
        'una empresa colombiana especializada en materias primas farmacéuticas y cosméticas con sede en Bogotá. '
        'El agente opera como un asistente ejecutivo digital disponible 24 horas al día, 7 días a la semana, '
        'gestionando de forma autónoma los principales procesos comerciales y operativos de la empresa: '
        'atención a clientes por WhatsApp, respuestas a compradores en MercadoLibre, sincronización de inventario, '
        'facturación electrónica en SIIGO ERP, confirmación de pagos y generación de reportes.', s))

    elems.append(sp(0.3))

    elems.append(nota('🎯',
        '<b>Objetivo principal:</b> Eliminar el trabajo repetitivo del equipo humano en tareas que pueden automatizarse, '
        'permitiendo que el personal de ventas y contabilidad se concentre en actividades de mayor valor: '
        'relaciones con clientes estratégicos, negociaciones especiales y crecimiento del negocio.',
        s, bg=colors.HexColor('#eff6ff'), border=colors.HexColor('#bfdbfe')))

    elems.append(sp(0.4))
    elems.append(subsection('1.1 Canales de Comunicación', s))
    elems.append(body(
        'El agente está conectado simultáneamente a los siguientes canales, procesando mensajes en tiempo real:', s))

    canales = [
        ['Canal', 'Puerto / Servicio', 'Responsabilidad'],
        ['WhatsApp Business', 'Evolution API · Node.js :3000', 'Atención clientes, confirmación de pagos, comandos operadores'],
        ['MercadoLibre', 'Webhook API · Flask :8080', 'Preventa (preguntas de compradores) y gestión de órdenes pagadas'],
        ['WooCommerce', 'Webhook HMAC · Flask :8081', 'Sincronización de stock cuando un cliente compra en la tienda web'],
        ['SIIGO ERP', 'API REST HTTPS', 'Facturación electrónica, creación de facturas de venta y de compra'],
        ['Google Sheets', 'gspread API', 'Consulta de catálogo, fichas técnicas, precios y stock'],
        ['Gmail', 'OAuth 2.0 · IMAP', 'Recepción de facturas electrónicas de proveedores (XML DIAN)'],
        ['Google Drive', 'Drive API v3', 'Backups nocturnos automáticos de datos críticos'],
    ]
    elems.append(tabla_comandos(canales, s,
        col_widths=[3.5*cm, 4.8*cm, PAGE_W - 2*MARGEN - 8.5*cm]))

    elems.append(sp(0.4))
    elems.append(subsection('1.2 Roles y Acceso', s))
    roles = [
        ['Rol', 'Canal de acceso', 'Capacidades'],
        ['Cliente final', 'WhatsApp', 'Consultar productos, solicitar cotización, enviar comprobante de pago'],
        ['Operador (grupo contabilidad)', 'WhatsApp – grupo contabilidad', 'Confirmar/rechazar pagos, responder preventa MeLi, pausar IA, aprobar facturas'],
        ['Administrador', 'CLI / endpoints /sync/*', 'Sincronizaciones manuales, ajustes de stock, reportes, backups'],
        ['Sistema (IA)', 'Interno · automático', 'Todo lo anterior de forma autónoma según reglas configuradas'],
    ]
    elems.append(tabla_comandos(roles, s,
        col_widths=[3.8*cm, 5.0*cm, PAGE_W - 2*MARGEN - 9.0*cm]))

    elems.append(sp(0.4))
    elems.append(nota('⚠️',
        '<b>Importante:</b> El agente opera con el número de WhatsApp Business de McKenna Group. '
        'Los operadores del grupo de contabilidad tienen acceso a comandos especiales que el agente escucha '
        'exclusivamente en ese grupo. Los mensajes de clientes se procesan en conversaciones individuales.',
        s, bg=colors.HexColor('#fffbeb'), border=colors.HexColor('#fde68a')))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 02 — ARQUITECTURA
# ══════════════════════════════════════════════

def sec02_arquitectura(s: dict) -> list:
    elems = []
    elems += section_header('Sección 02', 'Arquitectura del Sistema', s, C_PURPLE)

    elems.append(body(
        'El sistema está compuesto por <b>tres procesos independientes</b> que se ejecutan simultáneamente '
        'en el servidor Linux (Ubuntu). Esta arquitectura garantiza que si uno de los servicios presenta '
        'algún problema, los demás continúan funcionando sin interrupción.', s))

    elems.append(sp(0.3))

    # Diagrama de procesos
    proc = [
        ['Proceso', 'Puerto', 'Tecnología', 'Función principal'],
        ['agente_pro.py', ':8081', 'Python Flask', 'Núcleo central: WhatsApp, IA Claude, panel web, endpoints de sync'],
        ['webhook_meli.py', ':8080', 'Python Flask', 'Receptor exclusivo de notificaciones MercadoLibre (preguntas + órdenes)'],
        ['server.js', ':3000', 'Node.js', 'Bridge WhatsApp: recibe mensajes de Evolution API y los enruta al proceso correcto'],
    ]
    elems.append(tabla_comandos(proc, s,
        col_widths=[3.5*cm, 1.8*cm, 3.0*cm, PAGE_W - 2*MARGEN - 8.5*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('2.1 Flujo de un Mensaje WhatsApp', s))
    elems.append(body(
        'Cuando un cliente escribe por WhatsApp, el recorrido del mensaje es el siguiente:', s))

    flujo_wa = [
        ['Paso', 'Componente', 'Acción'],
        ['1', 'WhatsApp Business', 'Cliente envía mensaje al número de McKenna Group'],
        ['2', 'Evolution API', 'Recibe el mensaje y lo convierte a formato JSON'],
        ['3', 'server.js :3000', 'Filtra mensajes del grupo de contabilidad vs. clientes individuales'],
        ['4', 'agente_pro.py :8081 → /whatsapp', 'Recibe el JSON, detecta tipo de mensaje (texto, imagen, comando)'],
        ['5', 'IA Claude claude-sonnet-4-6', 'Procesa el mensaje con contexto + herramientas disponibles'],
        ['6', 'Herramientas (Google Sheets, SIIGO, etc.)', 'El agente consulta o actualiza datos en tiempo real'],
        ['7', 'Evolution API', 'El agente envía la respuesta de vuelta al cliente por WhatsApp'],
    ]
    elems.append(tabla_comandos(flujo_wa, s,
        col_widths=[1.2*cm, 5.0*cm, PAGE_W - 2*MARGEN - 6.4*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('2.2 Modelo de IA', s))
    elems.append(body(
        'El cerebro del agente es <b>Claude claude-sonnet-4-6</b> de Anthropic, el modelo de IA más avanzado '
        'disponible con razonamiento extendido. Dispone de <b>30 herramientas registradas</b> que puede '
        'invocar autónomamente para responder consultas: consultar el catálogo en Google Sheets, '
        'buscar productos en SIIGO, actualizar stock en MeLi y WooCommerce, crear facturas, '
        'consultar tarifas de envío, acceder a la memoria vectorial de casos aprendidos, entre otras.', s))

    elems.append(sp(0.2))
    elems.append(nota('💡',
        '<b>Aprendizaje continuo:</b> Cada vez que un operador responde manualmente una pregunta de preventa '
        'en MercadoLibre, la respuesta se guarda en una base de datos vectorial (ChromaDB). '
        'En el futuro, cuando llegue una pregunta similar, el agente usará ese caso como ejemplo '
        'para responder automáticamente. Esto mejora la precisión con el tiempo sin programación adicional.',
        s, bg=colors.HexColor('#f0fdf4'), border=colors.HexColor('#d1fae5')))

    elems.append(sp(0.3))
    elems.append(subsection('2.3 Infraestructura y Seguridad', s))

    seg = [
        ['Capa de seguridad', 'Implementación', 'Protege contra'],
        ['HTTPS público', 'Cloudflare Tunnel (sin puertos abiertos)', 'Exposición de IP, ataques de red'],
        ['Autenticación API', 'Bearer Token en /sync/* y /chat', 'Acceso no autorizado a endpoints admin'],
        ['Webhooks WooCommerce', 'HMAC-SHA256 firmado', 'Webhooks falsos / inyección de datos'],
        ['OAuth MercadoLibre', 'Refresh token automático cada 6h', 'Token vencido = sin procesar órdenes'],
        ['Rate Limiting', 'flask-limiter: 300 req/min global', 'Abuso, DDoS, scraping'],
        ['Credenciales', 'Variables .env excluidas de git', 'Filtración de API keys en código'],
        ['Backup nocturno', 'tar.gz cifrado en Google Drive a las 2 AM', 'Pérdida de datos por falla de disco'],
    ]
    elems.append(tabla_comandos(seg, s,
        col_widths=[4.0*cm, 5.5*cm, PAGE_W - 2*MARGEN - 9.7*cm]))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 03 — MÓDULOS FUNCIONALES
# ══════════════════════════════════════════════

def sec03_modulos(s: dict) -> list:
    elems = []
    elems += section_header('Sección 03', 'Módulos Funcionales', s, C_GREEN)

    modulos = [
        ('💬', 'MOD-01', 'Asistente WhatsApp con IA', C_GREEN,
         'Procesamiento de todos los mensajes de clientes por WhatsApp. '
         'El agente analiza el contexto completo (historial, perfil del cliente, modo IA/humano) '
         'y responde usando el catálogo oficial de SIIGO. Gestiona cotizaciones, consultas técnicas, '
         'disponibilidad de productos y coordina pagos. Tono ejecutivo colombiano ("veci").'),
        ('🛒', 'MOD-02', 'Preventa MercadoLibre Automática', C_PURPLE,
         'Responde automáticamente preguntas de compradores en MeLi en menos de 30 segundos. '
         'Consulta la ficha técnica del producto en Google Sheets (columna I) y genera '
         'la respuesta con IA. Si no hay ficha técnica o falla la IA, delega al operador '
         'con una alerta en el grupo de WhatsApp.'),
        ('💰', 'MOD-03', 'Gestión de Pagos y Comprobantes', C_AMBER,
         'Cuando un cliente envía una imagen, la clasifica como comprobante y alerta al grupo '
         'de contabilidad con los últimos 3 dígitos del número para identificación rápida. '
         'Comandos: ok 463 (confirma) / no 463 (rechaza). Monitor alerta si hay pagos sin '
         'confirmar más de 30 minutos.'),
        ('📦', 'MOD-04', 'Sincronización Bidireccional de Stock', C_BLUE2,
         'Cada venta en MeLi actualiza automáticamente el stock en WooCommerce y viceversa. '
         'Principio: cada plataforma es fuente de verdad de su propio stock cuando vende. '
         'Las sincronizaciones masivas se lanzan desde el CLI o los endpoints autenticados.'),
        ('🧾', 'MOD-05', 'Sincronización Inteligente MeLi ↔ SIIGO', C_RED,
         'Cruza órdenes MeLi con facturas SIIGO usando el Pack ID como llave. '
         'Descarga el PDF de la factura SIIGO y lo adjunta automáticamente a la orden en MeLi '
         'como documento fiscal (cumplimiento DIAN). También importa facturas de compra '
         'de proveedores desde Gmail (XML UBL 2.1 DIAN).'),
        ('📄', 'MOD-06', 'Catálogo PDF Corporativo', C_GREEN,
         'Genera el catálogo de productos en PDF con diseño McKenna Group: lee el inventario '
         'de Google Sheets, descarga fotos reales de MeLi por item_id, genera tarjetas de producto '
         'con foto, SKU, precio tachado y precio con descuento. Envía el PDF al grupo de WhatsApp.'),
        ('📊', 'MOD-07', 'Monitor de Alertas 24/7', C_PURPLE,
         'Daemon que verifica continuamente el estado del sistema. Reinicia servicios caídos, '
         'alerta pagos pendientes, audita preguntas MeLi sin responder, refresca token OAuth, '
         'envía resumen diario a las 7 PM, reporte financiero semanal los lunes, '
         'e informe mensual el día 1 de cada mes.'),
        ('🤝', 'MOD-08', 'Seguimiento Post-Venta', C_TEAL,
         '24 horas después de cada venta confirmada, envía automáticamente un mensaje de seguimiento '
         'al cliente por WhatsApp preguntando por su experiencia. Registra historial de compras '
         'por cliente en SQLite, distingue clientes nuevos vs. recurrentes y personaliza el saludo.'),
        ('🚚', 'MOD-09', 'Despachos e Interrapidísimo', C_TEAL,
         'Genera guías de despacho internas con numeración automática. Consulta tarifas de '
         'Interrapidísimo por ciudad y peso/volumen. El producto más despachado aparece '
         'como "Producto Estrella" en el reporte financiero semanal.'),
        ('💾', 'MOD-10', 'Backup Nocturno en Google Drive', C_AMBER,
         'Cada noche a las 2 AM comprime bases de datos SQLite, archivos JSON de estado, '
         'embeddings ChromaDB y datos de training en un .tar.gz. Lo sube a Google Drive '
         'y guarda copia local. Limpia backups de más de 7 días. Notifica al grupo WhatsApp.'),
    ]

    for emoji, cod, titulo, color, desc in modulos:
        elems.append(modulo_card(emoji, cod, titulo, desc, s, color))
        elems.append(sp(0.2))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 04 — COMANDOS DEL GRUPO
# ══════════════════════════════════════════════

def sec04_comandos(s: dict) -> list:
    elems = []
    elems += section_header('Sección 04', 'Guía de Comandos — Grupo de Contabilidad', s, C_AMBER)

    elems.append(body(
        'El grupo de contabilidad en WhatsApp es el <b>panel de control operativo</b> del agente. '
        'Los mensajes enviados en este grupo son interceptados por el servidor antes de llegar a la IA, '
        'permitiendo que el equipo ejecute comandos directos sobre el sistema. '
        'Todos los comandos son <b>insensibles a mayúsculas/minúsculas</b>.', s))

    elems.append(sp(0.3))
    elems.append(nota('⚠️',
        'Los comandos del grupo de contabilidad SOLO funcionan en el grupo de contabilidad registrado. '
        'Si se envían desde una conversación individual, el agente los tratará como mensajes normales de cliente.',
        s, bg=colors.HexColor('#fff1f2'), border=colors.HexColor('#fecaca')))

    elems.append(sp(0.3))
    elems.append(subsection('4.1 Confirmación de Pagos', s))

    cmds_pago = [
        ['Comando', 'Ejemplo', 'Acción'],
        ['ok <últimos 3 dígitos>', 'ok 463', 'Confirma el pago pendiente del cliente cuyo número termina en 463. El cliente recibe: "Veci, confirmamos su pago ✅"'],
        ['no <últimos 3 dígitos>', 'no 463', 'Rechaza el pago. El cliente recibe aviso de que hay un problema con la transacción.'],
        ['ok confirmado', 'ok confirmado', 'Confirma si hay exactamente 1 pago pendiente. Si hay más de uno, el sistema pide especificar los dígitos.'],
        ['ok confirmado <número>', 'ok confirmado 573001234567@c.us', 'Confirma el pago del número completo especificado (formato legado).'],
    ]
    elems.append(tabla_comandos(cmds_pago, s,
        col_widths=[4.0*cm, 3.5*cm, PAGE_W - 2*MARGEN - 7.7*cm]))

    elems.append(sp(0.15))
    elems.append(nota('💡',
        '<b>¿Cómo identificar el código?</b> Cuando un cliente envía una imagen (comprobante de pago), '
        'el agente envía al grupo un mensaje como: "🔔 ALERTA DE PAGO — Cliente ...4567 — ✅ Para CONFIRMAR: ok 567". '
        'Use siempre los últimos 3 dígitos que aparecen en esa alerta.',
        s, bg=colors.HexColor('#fffbeb'), border=colors.HexColor('#fde68a')))

    elems.append(sp(0.3))
    elems.append(subsection('4.2 Respuestas Preventa MercadoLibre', s))
    elems.append(body(
        'Cuando el agente no puede responder automáticamente una pregunta de MeLi '
        '(sin ficha técnica o IA no disponible), envía una alerta al grupo con el ID de la pregunta. '
        'El operador responde usando estos comandos:', s))

    cmds_prev = [
        ['Comando', 'Ejemplo', 'Acción'],
        ['resp <3 últimos dígitos del ID>: <respuesta>', 'resp 497: Hola, sí viene en polvo en presentación de 500g.', 'Responde la pregunta MeLi pendiente. El ID se muestra en la alerta del grupo. La respuesta queda guardada como caso de entrenamiento.'],
        ['resp preventa <ID completo>: <respuesta>', 'resp preventa 13553987497: respuesta aquí', 'Formato completo con el ID entero (para mayor precisión).'],
    ]
    elems.append(tabla_comandos(cmds_prev, s,
        col_widths=[6.0*cm, 4.5*cm, PAGE_W - 2*MARGEN - 10.7*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('4.3 Control IA / Modo Humano', s))
    elems.append(body(
        'Cuando un cliente requiere atención personalizada que la IA no puede brindar '
        '(negociaciones especiales, reclamos, devoluciones), el operador puede pausar '
        'la IA para ese número y atender manualmente:', s))

    cmds_modo = [
        ['Comando', 'Ejemplo', 'Acción'],
        ['pausar <número>', 'pausar 573001234567@c.us', 'Desactiva la IA para ese número. El cliente recibe: "En este momento te va a atender Jennifer García del área de ventas 🙏". Los mensajes del cliente se reenvían al grupo.'],
        ['activar <número>', 'activar 573001234567@c.us', 'Reactiva la IA para ese número. El cliente recibe saludo de bienvenida de vuelta.'],
    ]
    elems.append(tabla_comandos(cmds_modo, s,
        col_widths=[4.0*cm, 5.0*cm, PAGE_W - 2*MARGEN - 9.2*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('4.4 Respuestas Directas y Aprobaciones', s))

    cmds_extra = [
        ['Comando', 'Ejemplo', 'Acción'],
        ['resp <número>: <mensaje>', 'resp 573001234567@c.us: Hola, su pedido ya fue despachado.', 'Envía un mensaje directo a un cliente desde el grupo sin que la IA intervenga.'],
        ['hugo dale ok <order_id>', 'hugo dale ok 1234567890', 'Aprueba y envía una respuesta de posventa que está pendiente de revisión humana.'],
        ['ok', 'ok', 'Aprueba la siguiente factura de compra de proveedor en cola (importada desde Gmail).'],
    ]
    elems.append(tabla_comandos(cmds_extra, s,
        col_widths=[4.5*cm, 5.0*cm, PAGE_W - 2*MARGEN - 9.7*cm]))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 05 — FLUJO CLIENTE WHATSAPP
# ══════════════════════════════════════════════

def sec05_flujo_wa(s: dict) -> list:
    elems = []
    elems += section_header('Sección 05', 'Flujo de Atención al Cliente por WhatsApp', s, C_GREEN)

    elems.append(body(
        'Desde el punto de vista del cliente, la conversación con Hugo García es fluida y natural. '
        'A continuación se describe cada etapa del proceso de atención completo, desde el primer contacto '
        'hasta la facturación y confirmación de despacho.', s))

    pasos = [
        ('01', C_BLUE2, 'Primer Contacto / Saludo',
         'Si el cliente saluda con "Hola", "Buenas tardes" u otro saludo sin hacer una pregunta específica, '
         'Hugo García responde EXACTAMENTE: "Hola Soy hugo Garcia de mckenna Group S.A.S, cuenteme en que '
         'le puedo servir veci!" — sin títulos largos ni información adicional no solicitada.'),
        ('02', C_GREEN, 'Consulta de Producto',
         'El agente usa la herramienta buscar_producto_completo para consultar Google Sheets con el nombre '
         'del producto. Informa si está disponible o no, pero NO dice la cantidad exacta en stock. '
         'Solo si el cliente pregunta por una cantidad específica, confirma si esa cantidad está disponible.'),
        ('03', C_PURPLE, 'Solicitud de Cotización',
         'Si el cliente solicita una cotización, Hugo García recopila los datos paso a paso:\n'
         '(a) Nombre completo / razón social + NIT o cédula\n'
         '(b) Correo electrónico\n'
         '(c) Dirección de envío\n'
         '(d) Productos solicitados con cantidad\n'
         'Luego genera una cotización preliminar local e informa al cliente que debe pagar y enviar el comprobante.'),
        ('04', C_AMBER, 'Envío del Comprobante de Pago',
         'El cliente envía una imagen (comprobante). El agente la guarda en comprobantes/ con timestamp, '
         'alerta al grupo de contabilidad y responde al cliente: "Veci, recibí su comprobante. '
         'En un momento nuestro equipo de contabilidad lo verifica y le confirmamos."'),
        ('05', C_RED, 'Confirmación y Facturación',
         'Cuando el operador confirma con "ok 463", el agente procede a: crear la factura electrónica '
         'en SIIGO ERP, descargar el PDF, subirlo al expediente de MeLi si fue una venta de MeLi, '
         'y enviar al cliente la confirmación con los datos de despacho.'),
        ('06', C_TEAL, 'Seguimiento Post-Venta',
         '24 horas después, el agente envía automáticamente un mensaje de seguimiento al cliente '
         'preguntando por su experiencia y satisfacción con el producto recibido. '
         'Este paso ocurre sin intervención humana.'),
    ]

    for num, color, titulo, desc in pasos:
        paso_t = Table(
            [[Paragraph(f'Paso {num}', ParagraphStyle('__pn', fontName='Helvetica-Bold',
                        fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
              Paragraph(titulo, ParagraphStyle('__pt', fontName='Helvetica-Bold',
                        fontSize=11, textColor=C_NAVY)),
              ]],
            colWidths=[2.0*cm, PAGE_W - 2*MARGEN - 2.2*cm]
        )
        paso_t.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (0,0),  color),
            ('VALIGN',        (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING',    (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING',   (1,0), (1,0),  10),
        ]))
        elems.append(paso_t)
        desc_t = Table(
            [[Paragraph(desc, ParagraphStyle('__dd', fontName='Helvetica', fontSize=9,
                        textColor=colors.HexColor('#374151'), leading=14))]],
            colWidths=[PAGE_W - 2*MARGEN]
        )
        desc_t.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (-1,-1), C_LGRAY),
            ('TOPPADDING',    (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('LEFTPADDING',   (0,0), (-1,-1), 14),
            ('RIGHTPADDING',  (0,0), (-1,-1), 14),
            ('LINEBELOW',     (0,0), (-1,-1), 0.3, C_MGRAY),
        ]))
        elems.append(desc_t)
        elems.append(sp(0.1))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 06 — PREVENTA MELI
# ══════════════════════════════════════════════

def sec06_preventa(s: dict) -> list:
    elems = []
    elems += section_header('Sección 06', 'Preventa MercadoLibre', s, C_PURPLE)

    elems.append(body(
        'La preventa de MercadoLibre es el módulo más crítico en términos de velocidad de respuesta. '
        'Los compradores de MeLi esperan respuestas en minutos; el agente logra responder en menos de 30 segundos '
        'cuando tiene la información necesaria.', s))

    elems.append(sp(0.3))
    elems.append(subsection('6.1 Árbol de Decisión', s))

    arbol = [
        ['Condición', 'Acción del agente', 'Tiempo'],
        ['Producto tiene ficha técnica en Google Sheets (col I) Y Gemini/Claude responde OK',
         'Genera y publica respuesta automática en MeLi', '< 30 segundos'],
        ['Producto tiene ficha técnica PERO la IA falla (timeout, error 503)',
         'Envía alerta al grupo de contabilidad con la pregunta para respuesta manual', 'Inmediato'],
        ['Producto NO tiene ficha técnica en Google Sheets',
         'Envía alerta al grupo con la pregunta y nombre del producto sin ficha', 'Inmediato'],
        ['Respuesta manual del operador (resp 497: ...)',
         'Publica la respuesta en MeLi, guarda como caso de entrenamiento en ChromaDB', 'Al recibir el comando'],
    ]
    elems.append(tabla_comandos(arbol, s,
        col_widths=[5.5*cm, 5.5*cm, PAGE_W - 2*MARGEN - 11.2*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('6.2 Fichas Técnicas en Google Sheets', s))
    elems.append(body(
        'El sistema busca la ficha técnica del producto en la <b>columna I</b> de la hoja '
        '"BASE DE DATOS MCKENNA GROUP S.A.S" en Google Sheets. Si esa celda está vacía, '
        'el agente no puede responder automáticamente.', s))

    elems.append(nota('📋',
        '<b>Acción recomendada:</b> Cada lunes a las 9 AM, el monitor envía automáticamente al grupo '
        'de contabilidad una lista de los productos que NO tienen ficha técnica (columna I vacía). '
        'Completar estas fichas aumenta directamente el porcentaje de respuestas automáticas y '
        'reduce la carga del equipo de ventas.',
        s, bg=colors.HexColor('#f0fdf4'), border=colors.HexColor('#d1fae5')))

    elems.append(sp(0.3))
    elems.append(subsection('6.3 Aprendizaje Continuo (ChromaDB)', s))
    elems.append(body(
        'Cada respuesta manual procesada con el comando <b>resp &lt;id&gt;: &lt;respuesta&gt;</b> '
        'se guarda automáticamente como un caso de entrenamiento en dos lugares:\n'
        '• <b>app/training/casos_preventa.json</b>: archivo JSON con el historial de Q&amp;A\n'
        '• <b>memoria_vectorial/</b>: base de datos ChromaDB con embeddings vectoriales\n\n'
        'Cuando llega una nueva pregunta similar, el agente recupera los casos más parecidos '
        'y los usa como ejemplos (few-shot learning) para generar una respuesta más precisa. '
        'El sistema mejora automáticamente a medida que el equipo responde preguntas.', s))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 07 — SINCRONIZACIÓN DE STOCK
# ══════════════════════════════════════════════

def sec07_sync(s: dict) -> list:
    elems = []
    elems += section_header('Sección 07', 'Sincronización de Inventario', s, C_BLUE2)

    elems.append(body(
        'El inventario se mantiene sincronizado automáticamente entre MercadoLibre y WooCommerce. '
        'El principio fundamental es: <b>cada plataforma es fuente de verdad de su propio stock cuando vende</b>. '
        'No existe un "master de stock" externo que pueda generar conflictos.', s))

    elems.append(sp(0.3))

    principio = [
        ['Evento', 'Proceso automático', 'Resultado'],
        ['Venta en MercadoLibre', 'MeLi autodecrementar su stock → agente lee stock post-venta MeLi → actualiza WooCommerce al mismo valor', 'WC queda igual a MeLi'],
        ['Venta en WooCommerce', 'WC autodecrementar su stock → webhook HMAC llega al agente → agente actualiza MeLi al mismo valor', 'MeLi queda igual a WC'],
        ['Sincronización manual', 'Operador ejecuta sync desde CLI o endpoint /sync/completo', 'Ambas plataformas se igualan usando Google Sheets como referencia'],
    ]
    elems.append(tabla_comandos(principio, s,
        col_widths=[3.5*cm, 7.0*cm, PAGE_W - 2*MARGEN - 10.7*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('7.1 Endpoints de Sincronización Manual', s))
    elems.append(body(
        'Los siguientes endpoints requieren el header <b>Authorization: Bearer &lt;CHAT_API_TOKEN&gt;</b>:', s))

    endpoints = [
        ['Endpoint', 'Método', 'Función'],
        ['/sync/hoy', 'POST', 'Sincroniza facturas MeLi-SIIGO del último día'],
        ['/sync/10dias', 'POST', 'Sincroniza facturas de los últimos 10 días'],
        ['/sync/completo', 'POST', 'Sync completo de stock + reporte por WhatsApp'],
        ['/sync/inteligente', 'POST', 'Cruza órdenes MeLi pendientes con facturas SIIGO'],
        ['/sync/pack', 'POST', 'Sync de un Pack ID específico (body: {"pack_id": "xxx"})'],
        ['/sync/fecha', 'POST', 'Sync por fecha específica (body: {"fecha": "YYYY-MM-DD"})'],
        ['/sync/stock', 'POST', 'Genera reporte de stock y lo envía por WhatsApp'],
        ['/sync/gmail', 'POST', 'Importa facturas de compra de proveedores desde Gmail'],
    ]
    elems.append(tabla_comandos(endpoints, s,
        col_widths=[3.5*cm, 2.0*cm, PAGE_W - 2*MARGEN - 5.7*cm]))

    elems.append(sp(0.2))
    elems.append(nota('⚠️',
        '<b>Nota sobre SIIGO:</b> SIIGO ERP se usa exclusivamente para facturación. '
        'El stock de SIIGO NO se sincroniza con MeLi ni WooCommerce. '
        'La fuente de stock son las dos plataformas de venta (MeLi y WC) entre sí.',
        s, bg=colors.HexColor('#fff1f2'), border=colors.HexColor('#fecaca')))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 08 — FACTURACIÓN SIIGO
# ══════════════════════════════════════════════

def sec08_siigo(s: dict) -> list:
    elems = []
    elems += section_header('Sección 08', 'Facturación SIIGO y Documentos Fiscales', s, C_RED)

    elems.append(body(
        'El agente gestiona el ciclo completo de facturación electrónica conforme a la normativa DIAN. '
        'Existen dos flujos: facturas de <b>venta</b> (hacia clientes) y facturas de <b>compra</b> '
        '(de proveedores, recibidas por Gmail).', s))

    elems.append(sp(0.3))
    elems.append(subsection('8.1 Facturación de Venta (Ciclo Completo)', s))

    ciclo = [
        ['Paso', 'Descripción'],
        ['1. Cotización preliminar', 'El agente crea un archivo JSON local en cotizaciones_preliminares/ con los datos del cliente y productos. No usa SIIGO aún.'],
        ['2. Pago confirmado', 'Operador confirma con "ok 463". El agente ejecuta crear_factura_completa_siigo().'],
        ['3. Factura en SIIGO', 'Se crea la factura electrónica oficial en SIIGO ERP con los datos de la cotización. SIIGO envía a la DIAN.'],
        ['4. PDF descargado', 'El agente descarga el PDF de la factura de SIIGO y lo guarda en facturas_descargadas/.'],
        ['5. Upload a MeLi', 'Si la venta fue por MercadoLibre, el PDF se adjunta automáticamente al expediente de la orden en MeLi como documento fiscal.'],
        ['6. Notificación', 'Se envía al grupo de WhatsApp el resumen de la factura con el PDF adjunto y los datos de despacho.'],
    ]
    elems.append(tabla_comandos(ciclo, s,
        col_widths=[4.2*cm, PAGE_W - 2*MARGEN - 4.4*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('8.2 Facturas de Compra de Proveedores (Gmail + XML DIAN)', s))
    elems.append(body(
        'El módulo importar_productos_siigo.py automatiza la importación de facturas electrónicas '
        'de proveedores que llegan por correo a Gmail. El proceso es:', s))

    gmail_flow = [
        ['Paso', 'Descripción'],
        ['1. Gmail OAuth', 'El agente se autentifica en Gmail y busca correos con archivos .zip adjuntos de proveedores.'],
        ['2. Extracción ZIP', 'Descomprime el archivo y extrae el XML DIAN (formato UBL 2.1 estándar colombiano).'],
        ['3. Parseo XML', 'Lee los campos: código de producto, descripción, cantidad, unidad (LTR, KGM, GLL, etc.), precio.'],
        ['4. Conversión de unidades', 'Convierte automáticamente: LTR→mL (×1000), KGM→g (×1000), GLL→mL (×3785), etc.'],
        ['5. Generación de código SKU', 'Genera código McKenna automáticamente: 3 iniciales del proveedor + 3 palabras clave del nombre + unidad. Ej: ACERICmL.'],
        ['6. Verificación SIIGO', 'Consulta la API de SIIGO para evitar duplicados por código de producto.'],
        ['7. Excel de importación', 'Genera el archivo Excel con la plantilla de importación masiva de SIIGO.'],
        ['8. Aprobación humana', 'Envía el Excel al grupo de WhatsApp para revisión. El operador escribe "ok" para proceder.'],
    ]
    elems.append(tabla_comandos(gmail_flow, s,
        col_widths=[3.5*cm, PAGE_W - 2*MARGEN - 3.7*cm]))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 09 — PANEL WEB Y CLI
# ══════════════════════════════════════════════

def sec09_panel_cli(s: dict) -> list:
    elems = []
    elems += section_header('Sección 09', 'Panel Web y Menú CLI', s, C_TEAL)

    elems.append(subsection('9.1 Panel Web de Control', s))
    elems.append(body(
        'Disponible en <b>http://&lt;servidor&gt;:8081/panel</b> (o vía Cloudflare Tunnel públicamente). '
        'El panel se actualiza automáticamente cada 60 segundos para servicios y 30 segundos para métricas.', s))

    panel_secs = [
        ['Sección del panel', 'Información mostrada'],
        ['KPIs del día', 'Mensajes WA atendidos, preguntas MeLi respondidas, pagos confirmados, órdenes sincronizadas'],
        ['Estado de servicios', 'Badges ACTIVO/CAÍDO para agente-pro :8081, webhook-meli :8080, whatsapp :3000'],
        ['Cola de preventa MeLi', 'Lista de preguntas pendientes con botón "Responder" que ejecuta resp directamente'],
        ['Integraciones', 'Estado de cada integración (MeLi, SIIGO, WC, Google Sheets, Gmail, Drive, WA, Cloudflare)'],
        ['Tasa de automatización', 'Porcentaje de preguntas MeLi respondidas automáticamente vs. total'],
        ['Log de actividad', 'Últimas acciones ejecutadas por el agente en tiempo real'],
    ]
    elems.append(tabla_comandos(panel_secs, s,
        col_widths=[4.5*cm, PAGE_W - 2*MARGEN - 4.7*cm]))

    elems.append(sp(0.3))
    elems.append(subsection('9.2 Menú CLI Interactivo', s))
    elems.append(body(
        'El menú CLI se inicia automáticamente cuando se ejecuta el servidor. '
        'Es accesible desde la terminal del servidor donde corre el agente. '
        'Permite ejecutar operaciones manuales sin necesidad de acceder a la API:', s))

    cli_menu = [
        ['Opción', 'Función'],
        ['1 — Chat directo', 'Conversación directa con Hugo García desde la terminal (útil para pruebas y depuración)'],
        ['2 — Sync inteligente', 'Ejecuta sincronización inteligente MeLi→SIIGO (órdenes pendientes vs. facturas)'],
        ['3 — Sync facturas hoy', 'Sincroniza y sube a MeLi las facturas SIIGO del día actual'],
        ['4 — Sync facturas 10 días', 'Sincroniza facturas de los últimos 10 días'],
        ['5 — Sync completo + stock', 'Sync total y envía reporte de stock al grupo de WhatsApp'],
        ['6 — Verificar SKUs', 'Auditoría de discrepancias de SKUs entre MeLi, SIIGO y WooCommerce'],
        ['7 — Sync por Pack ID', 'Sincroniza un Pack ID específico de MeLi'],
        ['8 — Forzar aprendizaje IA', 'Forza la extracción de Q&A de MeLi para entrenamiento'],
        ['9 — Sync por fecha', 'Ingresa una fecha YYYY-MM-DD y sincroniza esas facturas'],
        ['10 — Facturas compra Gmail', 'Importa facturas de proveedores desde Gmail (XML DIAN)'],
        ['11 — Generar catálogo PDF', 'Genera el catálogo de productos con fotos y lo envía por WhatsApp'],
        ['12 — Actualizar precios WC', 'Actualiza precios en WooCommerce desde Google Sheets'],
        ['13 — Salir', 'Cierra el menú CLI (el servidor Flask sigue corriendo)'],
        ['14 — Importar productos SIIGO', 'Procesa facturas de compra y genera Excel de importación masiva para SIIGO'],
    ]
    elems.append(tabla_comandos(cli_menu, s,
        col_widths=[4.8*cm, PAGE_W - 2*MARGEN - 5.0*cm]))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 10 — MONITOR DE ALERTAS
# ══════════════════════════════════════════════

def sec10_monitor(s: dict) -> list:
    elems = []
    elems += section_header('Sección 10', 'Monitor de Alertas Automáticas', s, C_PURPLE)

    elems.append(body(
        'El monitor es un daemon (proceso en segundo plano) que corre continuamente dentro del servidor. '
        'Verifica el estado del sistema cada minuto y ejecuta tareas programadas automáticamente. '
        'Todos los reportes y alertas se envían al grupo de contabilidad en WhatsApp.', s))

    elems.append(sp(0.3))
    elems.append(subsection('10.1 Alertas y Tareas Programadas', s))

    alertas = [
        ['Frecuencia', 'Tarea', 'Destino'],
        ['Cada 5 minutos', 'Verifica que agente-pro :8081, webhook-meli :8080 y whatsapp :3000 respondan. Si alguno falla, intenta reiniciarlo con systemctl y alerta al grupo.', 'Grupo WA'],
        ['Cada 15 minutos', 'Revisa comprobantes de pago sin confirmar hace más de 30 minutos y alerta al grupo.', 'Grupo WA'],
        ['Cada 30 minutos', 'Cuenta preguntas de MeLi sin responder. Si hay más de 3, alerta al grupo con la última pregunta.', 'Grupo WA'],
        ['Cada 6 horas', 'Verifica vencimiento del token OAuth de MercadoLibre. Si vence en menos de 60 min, lo refresca automáticamente.', 'Log interno'],
        ['08:00 AM diario', 'Ejecuta sincronización de stock diario entre plataformas y envía reporte al grupo.', 'Grupo WA'],
        ['07:00 PM diario', 'Envía resumen del día: servicios activos, mensajes WA, preguntas MeLi, pagos, órdenes.', 'Grupo WA'],
        ['02:00 AM diario', 'Backup nocturno: comprime datos críticos en .tar.gz y sube a Google Drive.', 'Grupo WA + Drive'],
        ['Lunes 07:00 AM', 'Reporte financiero semanal HTML por correo: total facturado SIIGO, producto estrella, clientes nuevos vs. recurrentes.', 'cynthua0418@gmail.com'],
        ['Lunes 09:00 AM', 'Lista de productos sin ficha técnica (columna I vacía en Sheets) para que el equipo las complete.', 'Grupo WA'],
        ['Día 1 de cada mes 08:00 AM', 'Informe forense mensual completo del agente: métricas, estado, recomendaciones, optimizaciones.', 'cynthua0418@gmail.com'],
    ]
    elems.append(tabla_comandos(alertas, s,
        col_widths=[3.8*cm, 9.0*cm, PAGE_W - 2*MARGEN - 13.0*cm]))

    elems.append(sp(0.3))
    elems.append(nota('💡',
        '<b>Diagnóstico de errores:</b> Si el agente responde con un mensaje de error técnico, '
        'el error completo se registra en <b>log_errores_ia.txt</b> en la raíz del proyecto. '
        'Para verlo en tiempo real: <b>tail -f /home/mckg/mi-agente/log_errores_ia.txt</b>',
        s, bg=colors.HexColor('#eff6ff'), border=colors.HexColor('#bfdbfe')))

    elems.append(PageBreak())
    return elems


# ══════════════════════════════════════════════
# SEC 11 — GLOSARIO Y FAQ
# ══════════════════════════════════════════════

def sec11_glosario_faq(s: dict) -> list:
    elems = []
    elems += section_header('Sección 11', 'Glosario Técnico y Preguntas Frecuentes', s, C_GRAY)

    elems.append(subsection('11.1 Glosario de Términos', s))

    glosario = [
        ['Término', 'Definición'],
        ['Evolution API', 'Servidor Node.js que conecta WhatsApp Business a sistemas externos mediante una API REST'],
        ['Pack ID', 'Identificador único de un paquete de órdenes en MercadoLibre. Sirve para adjuntar facturas fiscales'],
        ['Ficha técnica', 'Texto en la columna I de Google Sheets con descripción técnica detallada del producto para respuestas de preventa'],
        ['ChromaDB', 'Base de datos vectorial que almacena embeddings de preguntas y respuestas para búsqueda semántica'],
        ['Few-shot learning', 'Técnica de IA donde se le muestran al modelo ejemplos de respuestas correctas para que aprenda el patrón'],
        ['HMAC-SHA256', 'Algoritmo de firma criptográfica para verificar que un webhook viene de la fuente legítima (WooCommerce)'],
        ['Bearer Token', 'Cadena de texto secreto que se incluye en el header de peticiones HTTP para autenticar acceso a la API'],
        ['OAuth 2.0', 'Protocolo estándar de autorización usado por MercadoLibre y Gmail para tokens de acceso'],
        ['UBL 2.1', 'Formato XML estándar colombiano (DIAN) para facturas electrónicas de proveedores'],
        ['Daemon', 'Proceso que corre en segundo plano continuamente sin interfaz de usuario (ej: el monitor de alertas)'],
        ['SKU', 'Stock Keeping Unit — código único que identifica un producto en todas las plataformas'],
        ['Cloudflare Tunnel', 'Servicio que expone el servidor local al internet de forma segura sin abrir puertos ni exponer la IP'],
    ]
    elems.append(tabla_comandos(glosario, s,
        col_widths=[3.8*cm, PAGE_W - 2*MARGEN - 4.0*cm]))

    elems.append(sp(0.4))
    elems.append(subsection('11.2 Preguntas Frecuentes (FAQ)', s))

    faqs = [
        ('¿Por qué el agente respondió "Veci, tuve un problema técnico momentáneo"?',
         'Ocurrió un error inesperado. Ver log_errores_ia.txt para el detalle. '
         'Causas comunes: credencial de Google Sheets vencida, servicio SIIGO no disponible, '
         'o error de red con la API de Claude. El cliente puede repetir el mensaje; '
         'el historial de conversación se preserva entre intentos.'),
        ('¿El agente puede responder preguntas que no sean de productos?',
         'Sí, con limitaciones. El agente puede responder preguntas generales sobre McKenna Group, '
         'procesos de pago, tiempos de envío (usando tarifas de Interrapidísimo), '
         'y datos básicos de facturación. Para información muy específica que no está '
         'en sus herramientas, escalará al grupo de contabilidad.'),
        ('¿Cómo sé si una ficha técnica está bien configurada?',
         'El agente la leerá automáticamente de la columna I de Google Sheets. '
         'Si el agente responde la pregunta de MeLi automáticamente, la ficha funciona. '
         'Si envía alerta al grupo, la ficha está vacía o el producto no está en el Sheet.'),
        ('¿Qué pasa si el token de MercadoLibre vence?',
         'El monitor verifica el token cada 6 horas. Si queda menos de 60 minutos para vencer, '
         'lo refresca automáticamente con el refresh_token guardado en credenciales_meli.json. '
         'Si el refresh también falla, el agente alerta al grupo y las sincronizaciones pausan hasta renovar.'),
        ('¿Cómo agrego un nuevo producto al catálogo?',
         'Agregar el producto en Google Sheets en la pestaña "BASE DE DATOS MCKENNA GROUP S.A.S" '
         'con: col A (ID de publicación MeLi), col D (nombre oficial SIIGO), col I (ficha técnica), '
         'y las columnas de precio y stock. El agente lo verá inmediatamente en la próxima consulta.'),
        ('¿Puedo hacer que el agente NO responda a un cliente específico?',
         'Sí. En el grupo de contabilidad escribe: <b>pausar 573XXXXXXXXX@c.us</b>. '
         'El agente avisará al cliente que lo atenderá Jennifer García. Para reactivar: '
         '<b>activar 573XXXXXXXXX@c.us</b>'),
        ('¿Dónde se guardan los comprobantes de pago?',
         'En la carpeta comprobantes/ del proyecto, con nombre {número}_{timestamp}.jpeg. '
         'Se guardan indefinidamente como registro. Limpiar periódicamente los más antiguos '
         'para no acumular espacio en disco.'),
    ]

    for preg, resp in faqs:
        q_t = Table(
            [[Paragraph(f'❓  {preg}', ParagraphStyle('__q', fontName='Helvetica-Bold',
                        fontSize=9.5, textColor=C_NAVY, leading=14))]],
            colWidths=[PAGE_W - 2*MARGEN]
        )
        q_t.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (-1,-1), colors.HexColor('#eff6ff')),
            ('TOPPADDING',    (0,0), (-1,-1), 7),
            ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LEFTPADDING',   (0,0), (-1,-1), 10),
            ('RIGHTPADDING',  (0,0), (-1,-1), 10),
        ]))
        a_t = Table(
            [[Paragraph(resp, ParagraphStyle('__a', fontName='Helvetica', fontSize=9,
                        textColor=colors.HexColor('#374151'), leading=14))]],
            colWidths=[PAGE_W - 2*MARGEN]
        )
        a_t.setStyle(TableStyle([
            ('BACKGROUND',    (0,0), (-1,-1), C_WHITE),
            ('TOPPADDING',    (0,0), (-1,-1), 7),
            ('BOTTOMPADDING', (0,0), (-1,-1), 9),
            ('LEFTPADDING',   (0,0), (-1,-1), 20),
            ('RIGHTPADDING',  (0,0), (-1,-1), 10),
            ('LINEBELOW',     (0,0), (-1,-1), 0.3, C_MGRAY),
        ]))
        elems.append(q_t)
        elems.append(a_t)
        elems.append(sp(0.08))

    elems.append(sp(0.6))
    elems.append(hr(C_BLUE2, thickness=2))
    elems.append(sp(0.3))

    # Cierre
    cierre_t = Table(
        [[Paragraph(
            'McKenna Group S.A.S. · Bogotá, Colombia · mckennagroup.co\n'
            f'Manual de Usuario Hugo García v2.1 · Generado el {fecha_gen}\n'
            'Este documento es confidencial y de uso interno.',
            ParagraphStyle('__c', fontName='Helvetica', fontSize=8.5,
                           textColor=C_GRAY, alignment=TA_CENTER, leading=14)
        )]],
        colWidths=[PAGE_W - 2*MARGEN]
    )
    cierre_t.setStyle(TableStyle([
        ('TOPPADDING',    (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('BACKGROUND',    (0,0), (-1,-1), C_LGRAY),
    ]))
    elems.append(cierre_t)

    return elems


# ══════════════════════════════════════════════
# GENERADOR PRINCIPAL
# ══════════════════════════════════════════════

def generar_pdf() -> str:
    doc = SimpleDocTemplate(
        OUT_PDF,
        pagesize=A4,
        leftMargin=MARGEN,
        rightMargin=MARGEN,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
        title='Manual de Usuario — Hugo García — McKenna Group',
        author='McKenna Group S.A.S.',
        subject='Manual de operación del agente de automatización Hugo García',
    )

    s   = estilos()
    dec = PaginaDecoracion('v2.1')

    elems = []
    elems += portada(s)
    elems += tabla_contenidos(s)
    elems += sec01_introduccion(s)
    elems += sec02_arquitectura(s)
    elems += sec03_modulos(s)
    elems += sec04_comandos(s)
    elems += sec05_flujo_wa(s)
    elems += sec06_preventa(s)
    elems += sec07_sync(s)
    elems += sec08_siigo(s)
    elems += sec09_panel_cli(s)
    elems += sec10_monitor(s)
    elems += sec11_glosario_faq(s)

    doc.build(elems, onFirstPage=dec, onLaterPages=dec)
    print(f'✅ PDF generado: {OUT_PDF}  ({os.path.getsize(OUT_PDF)//1024} KB)')
    return OUT_PDF


# ══════════════════════════════════════════════
# ENVÍO POR CORREO
# ══════════════════════════════════════════════

def enviar_por_correo(pdf_path: str):
    env = {
        line.split('=', 1)[0].strip(): line.split('=', 1)[1].strip()
        for line in open(os.path.join(os.path.dirname(__file__), '.env')).read().splitlines()
        if '=' in line and not line.startswith('#')
    }
    remitente = env.get('EMAIL_SENDER', 'mckenna.group.colombia@gmail.com')
    password  = env.get('EMAIL_PASSWORD', '')
    dest      = 'cynthua0418@gmail.com'
    hoy       = datetime.now().strftime('%d/%m/%Y')

    msg = MIMEMultipart()
    msg['From']    = remitente
    msg['To']      = dest
    msg['Subject'] = f'Manual de Usuario · Agente Hugo García v2.1 · McKenna Group · {hoy}'

    cuerpo = f"""Hola,

Adjunto encontrarás el Manual de Usuario completo del Agente Hugo García de McKenna Group S.A.S.

El manual incluye:
  • Guía de comandos del grupo de contabilidad
  • Flujos de atención al cliente por WhatsApp
  • Preventa MercadoLibre y aprendizaje automático
  • Sincronización de inventario MeLi ↔ WooCommerce
  • Facturación electrónica SIIGO y documentos DIAN
  • Panel web de control y menú CLI
  • Monitor de alertas y tareas programadas
  • Glosario técnico y preguntas frecuentes

Versión: v2.1 · Generado el {hoy}

---
McKenna Group S.A.S. · Bogotá, Colombia
Sistema de Automatización Hugo García
"""
    msg.attach(MIMEText(cuerpo, 'plain', 'utf-8'))

    with open(pdf_path, 'rb') as f:
        part = MIMEBase('application', 'pdf')
        part.set_payload(f.read())
    encoders.encode_base64(part)
    nombre_archivo = os.path.basename(pdf_path)
    part.add_header('Content-Disposition', f'attachment; filename="{nombre_archivo}"')
    msg.attach(part)

    server = smtplib.SMTP('smtp.gmail.com', 587)
    server.starttls()
    server.login(remitente, password)
    server.send_message(msg)
    server.quit()
    print(f'✅ Manual enviado por correo a {dest}')


# ══════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════

if __name__ == '__main__':
    pdf = generar_pdf()
    if '--enviar' in sys.argv or True:   # siempre enviar en esta ejecución
        enviar_por_correo(pdf)
