"""
Genera la guía PDF del Panel de Operaciones McKenna Group.
Uso: python3 generar_guia_panel.py
Salida: guia_panel_operaciones.pdf
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch, cm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
import os

OUT = os.path.join(os.path.dirname(__file__), "guia_panel_operaciones.pdf")

BLUE = HexColor("#1d6be5")
DARK = HexColor("#0d1117")
GRAY = HexColor("#8b949e")
WHITE = HexColor("#ffffff")
GREEN = HexColor("#3fb950")
BG_PANEL = HexColor("#161b22")

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "MCKTitle",
    parent=styles["Title"],
    fontSize=26,
    textColor=BLUE,
    spaceAfter=6,
    alignment=TA_CENTER,
)

subtitle_style = ParagraphStyle(
    "MCKSubtitle",
    parent=styles["Normal"],
    fontSize=12,
    textColor=GRAY,
    alignment=TA_CENTER,
    spaceAfter=30,
)

h1 = ParagraphStyle(
    "MCKH1",
    parent=styles["Heading1"],
    fontSize=18,
    textColor=BLUE,
    spaceBefore=20,
    spaceAfter=10,
)

h2 = ParagraphStyle(
    "MCKH2",
    parent=styles["Heading2"],
    fontSize=14,
    textColor=HexColor("#e6edf3"),
    spaceBefore=14,
    spaceAfter=6,
    backColor=BG_PANEL,
    borderPadding=(4, 8, 4, 8),
)

body = ParagraphStyle(
    "MCKBody",
    parent=styles["Normal"],
    fontSize=10,
    textColor=HexColor("#c9d1d9"),
    leading=14,
    spaceAfter=6,
)

body_bold = ParagraphStyle(
    "MCKBodyBold",
    parent=body,
    fontName="Helvetica-Bold",
)

code_style = ParagraphStyle(
    "MCKCode",
    parent=styles["Code"],
    fontSize=9,
    textColor=GREEN,
    backColor=DARK,
    borderPadding=(6, 8, 6, 8),
    leading=12,
    spaceAfter=8,
)

bullet = ParagraphStyle(
    "MCKBullet",
    parent=body,
    leftIndent=20,
    bulletIndent=8,
    spaceBefore=2,
    spaceAfter=2,
)


def hr():
    return HRFlowable(width="100%", thickness=0.5, color=HexColor("#30363d"), spaceAfter=10, spaceBefore=10)


def table_block(headers, rows):
    data = [headers] + rows
    t = Table(data, hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), HexColor("#c9d1d9")),
        ("BACKGROUND", (0, 1), (-1, -1), HexColor("#0d1117")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#0d1117"), HexColor("#161b22")]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#30363d")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def build():
    doc = SimpleDocTemplate(
        OUT,
        pagesize=letter,
        leftMargin=1 * inch,
        rightMargin=1 * inch,
        topMargin=0.8 * inch,
        bottomMargin=0.8 * inch,
    )
    story = []

    # ── PORTADA ──────────────────────────────────────────────────────────
    story.append(Spacer(1, 2 * inch))
    story.append(Paragraph("McKenna Group S.A.S.", title_style))
    story.append(Paragraph("Panel de Operaciones — Guía de Uso", subtitle_style))
    story.append(Spacer(1, 0.5 * inch))
    story.append(Paragraph("Versión 2.0 — Abril 2026", ParagraphStyle("ver", parent=body, alignment=TA_CENTER)))
    story.append(Spacer(1, 0.3 * inch))
    story.append(Paragraph(
        "React 19 · TypeScript · Tailwind CSS · Zustand · React Query · Flask · Claude IA",
        ParagraphStyle("stack", parent=body, alignment=TA_CENTER, textColor=GRAY, fontSize=9),
    ))
    story.append(PageBreak())

    # ── ÍNDICE ───────────────────────────────────────────────────────────
    story.append(Paragraph("Contenido", h1))
    toc = [
        "1. Introducción",
        "2. Requisitos",
        "3. Acceso al Panel",
        "4. Paneles del Sistema",
        "   4.1 Dashboard",
        "   4.2 Chat IA",
        "   4.3 Preventa MeLi",
        "   4.4 Sincronización",
        "   4.5 Stock e Inventario",
        "   4.6 Ajustes",
        "5. Endpoints API",
        "6. Desarrollo y Build",
        "7. Solución de Problemas",
    ]
    for item in toc:
        story.append(Paragraph(item, body))
    story.append(hr())

    # ── 1. INTRODUCCIÓN ──────────────────────────────────────────────────
    story.append(Paragraph("1. Introducción", h1))
    story.append(Paragraph(
        "El Panel de Operaciones es la interfaz web principal para operar el agente Hugo García "
        "de McKenna Group. Reemplaza el menú CLI interactivo con una interfaz moderna accesible "
        "desde cualquier navegador en la red local.",
        body,
    ))
    story.append(Paragraph(
        "El panel se conecta al mismo backend Flask (puerto 8081) que maneja WhatsApp, "
        "MercadoLibre, Siigo y todas las integraciones existentes. No requiere instalación "
        "de software adicional — solo un navegador web.",
        body,
    ))
    story.append(hr())

    # ── 2. REQUISITOS ────────────────────────────────────────────────────
    story.append(Paragraph("2. Requisitos", h1))
    story.append(Paragraph("• Navegador moderno (Chrome, Firefox, Edge, Safari)", bullet))
    story.append(Paragraph("• Acceso a la red donde corre el servidor (localhost o IP local)", bullet))
    story.append(Paragraph("• Token de autenticación (CHAT_API_TOKEN del archivo .env)", bullet))
    story.append(Paragraph("• Servidor Flask corriendo en puerto 8081 (agente_pro.py)", bullet))
    story.append(hr())

    # ── 3. ACCESO ────────────────────────────────────────────────────────
    story.append(Paragraph("3. Acceso al Panel", h1))
    story.append(Paragraph("Abrir en el navegador:", body_bold))
    story.append(Paragraph("http://localhost:8081/app", code_style))
    story.append(Paragraph(
        "Si accede desde otra máquina en la red, reemplace localhost por la IP del servidor "
        "(ejemplo: http://192.168.1.100:8081/app).",
        body,
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Pantalla de Login:", body_bold))
    story.append(Paragraph(
        "Al abrir por primera vez, el panel solicita el token de acceso. Este es el mismo "
        "CHAT_API_TOKEN configurado en el archivo .env del proyecto. Ingréselo y presione "
        "\"Ingresar\". El token se guarda en el navegador y no necesita ingresarlo de nuevo.",
        body,
    ))
    story.append(hr())

    # ── 4. PANELES ───────────────────────────────────────────────────────
    story.append(Paragraph("4. Paneles del Sistema", h1))
    story.append(Paragraph(
        "La barra lateral izquierda muestra 6 secciones. En móvil, se accede con el botón "
        "de menú en la esquina superior izquierda.",
        body,
    ))
    story.append(PageBreak())

    # 4.1 Dashboard
    story.append(Paragraph("4.1 Dashboard", h2))
    story.append(Paragraph(
        "Vista principal con métricas del día actualizadas automáticamente cada 30 segundos.",
        body,
    ))
    story.append(Paragraph("Indicadores:", body_bold))
    story.append(table_block(
        ["Indicador", "Descripción"],
        [
            ["Mensajes WhatsApp", "Total de mensajes recibidos hoy"],
            ["Preguntas MeLi", "Preguntas de preventa recibidas hoy"],
            ["Órdenes MeLi", "Órdenes pagadas procesadas hoy"],
            ["Pendientes", "Preguntas preventa sin responder (alerta si > 0)"],
            ["Posventa", "Mensajes post-compra recibidos hoy"],
            ["Pagos confirmados", "Pagos verificados por el equipo hoy"],
        ],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Servicios conectados: muestra el estado de MercadoLibre, Google Sheets, Siigo ERP "
        "y el token MeLi con indicadores verde (activo) o rojo (desconectado).",
        body,
    ))

    # 4.2 Chat IA
    story.append(Paragraph("4.2 Chat IA", h2))
    story.append(Paragraph(
        "Conversación directa con Hugo García, el agente IA de McKenna Group. "
        "Funciona igual que el chat por WhatsApp pero desde el navegador.",
        body,
    ))
    story.append(Paragraph("• Escriba su mensaje y presione Enter o el botón Enviar", bullet))
    story.append(Paragraph("• El agente tiene acceso a todas sus herramientas: consultar productos, "
                           "sincronizar facturas, verificar stock, etc.", bullet))
    story.append(Paragraph("• El indicador de puntos animados muestra que el agente está procesando", bullet))
    story.append(Paragraph("• El historial se mantiene durante la sesión del navegador", bullet))

    # 4.3 Preventa
    story.append(Paragraph("4.3 Preventa MeLi", h2))
    story.append(Paragraph(
        "Lista en tiempo real de preguntas de MercadoLibre que no han sido respondidas. "
        "Se actualiza automáticamente cada 20 segundos.",
        body,
    ))
    story.append(Paragraph("Para cada pregunta se muestra:", body_bold))
    story.append(Paragraph("• Nombre del producto", bullet))
    story.append(Paragraph("• Texto de la pregunta del cliente", bullet))
    story.append(Paragraph("• ID corto (últimos 4 dígitos) y fecha/hora", bullet))
    story.append(Paragraph("• Campo de texto para escribir la respuesta", bullet))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Para responder: escriba la respuesta en el campo de texto y presione \"Responder\" o Enter. "
        "La respuesta se envía directamente a MercadoLibre y se guarda como caso de entrenamiento.",
        body,
    ))
    story.append(Paragraph(
        "El badge rojo en la barra lateral indica cuántas preguntas hay pendientes.",
        body,
    ))

    story.append(PageBreak())

    # 4.4 Sincronización
    story.append(Paragraph("4.4 Sincronización", h2))
    story.append(Paragraph(
        "Panel con 10 acciones de sincronización y operaciones. Cada acción muestra "
        "un botón \"Ejecutar\" con feedback visual del estado.",
        body,
    ))
    story.append(table_block(
        ["Acción", "Qué hace"],
        [
            ["Sync Hoy", "Sincroniza facturas MeLi ↔ Siigo del último día"],
            ["Sync 10 Días", "Sincroniza facturas de los últimos 10 días"],
            ["Sync Inteligente", "Cruce automático MeLi vs Siigo para detectar brechas"],
            ["Sync Completo", "Sincronización completa + reporte de stock"],
            ["Aprendizaje IA", "Analiza interacciones MeLi para mejorar respuestas automáticas"],
            ["Facturas Gmail", "Escanea emails para facturas de compra de proveedores"],
            ["Reporte Stock", "Genera reporte completo enviado por WhatsApp"],
            ["Sync por Pack", "Sincroniza un Pack ID específico (requiere ingresarlo)"],
            ["Sync por Fecha", "Sincroniza facturas de una fecha específica (AAAA-MM-DD)"],
            ["Consultar Producto", "Busca un producto en Google Sheets (requiere nombre)"],
        ],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Las acciones que requieren datos adicionales muestran un campo de texto. "
        "El resultado aparece debajo del botón: verde si fue exitoso, rojo si hubo error.",
        body,
    ))

    # 4.5 Stock
    story.append(Paragraph("4.5 Stock e Inventario", h2))
    story.append(Paragraph("Tres funciones principales:", body_bold))
    story.append(Paragraph("• <b>Buscar producto</b>: escriba el nombre y presione Buscar. "
                           "Muestra la información del producto desde Google Sheets.", bullet))
    story.append(Paragraph("• <b>Reporte de Stock</b>: genera un reporte completo que se "
                           "envía por WhatsApp al grupo configurado.", bullet))
    story.append(Paragraph("• <b>Verificar SKUs</b>: ejecuta sync completo + verificación "
                           "de consistencia entre plataformas.", bullet))

    # 4.6 Ajustes
    story.append(Paragraph("4.6 Ajustes", h2))
    story.append(Paragraph(
        "Muestra el token actual (parcialmente oculto), la versión del sistema y el estado. "
        "Botón \"Cerrar sesión\" para desconectarse (borra el token del navegador).",
        body,
    ))
    story.append(hr())

    # ── 5. ENDPOINTS ─────────────────────────────────────────────────────
    story.append(Paragraph("5. Endpoints API", h1))
    story.append(Paragraph(
        "Todos los endpoints del panel están bajo el prefijo /api/ en el puerto 8081. "
        "Requieren header Authorization: Bearer {CHAT_API_TOKEN}.",
        body,
    ))
    story.append(table_block(
        ["Endpoint", "Método", "Descripción"],
        [
            ["/api/status", "GET", "Estado del sistema y servicios"],
            ["/api/metricas", "GET", "Métricas diarias + token MeLi"],
            ["/api/preventa/pendientes", "GET", "Preguntas MeLi sin responder"],
            ["/api/preventa/casos", "GET", "Casos de entrenamiento aprendidos"],
            ["/api/responder-preventa", "POST", "Responder pregunta MeLi"],
            ["/api/sync/hoy", "POST", "Sync facturas último día"],
            ["/api/sync/10dias", "POST", "Sync facturas 10 días"],
            ["/api/sync/completo", "POST", "Sync completo + stock"],
            ["/api/sync/inteligente", "POST", "Cruce MeLi ↔ Siigo"],
            ["/api/sync/pack", "POST", "Sync por Pack ID"],
            ["/api/sync/fecha", "POST", "Sync por fecha"],
            ["/api/sync/stock", "POST", "Reporte stock"],
            ["/api/sync/aprendizaje", "POST", "Aprendizaje IA"],
            ["/api/sync/gmail", "POST", "Facturas de compra Gmail"],
            ["/api/consultar/producto", "GET", "Buscar producto en Sheets"],
            ["/chat", "POST", "Chat IA (Claude tool-use)"],
        ],
    ))
    story.append(hr())

    story.append(PageBreak())

    # ── 6. DESARROLLO ────────────────────────────────────────────────────
    story.append(Paragraph("6. Desarrollo y Build", h1))
    story.append(Paragraph("Estructura del proyecto frontend:", body_bold))
    story.append(Paragraph(
        "desktop/<br/>"
        "&nbsp;&nbsp;src/components/ — Chat, Dashboard, Preventa, Sync, Stock, Layout, Sidebar<br/>"
        "&nbsp;&nbsp;src/stores/ — Zustand: auth (token), app (panel activo)<br/>"
        "&nbsp;&nbsp;src/hooks/ — React Query: useMetricas, useStatus, usePreventa, useChat<br/>"
        "&nbsp;&nbsp;src/api/client.ts — Wrapper fetch con Bearer auth<br/>"
        "&nbsp;&nbsp;package.json — React 19, Vite, Tailwind, Zustand, React Query<br/>"
        "&nbsp;&nbsp;vite.config.ts — base: /app/, proxy /api → :8081<br/>"
        "&nbsp;&nbsp;dist/ — Build de producción (generado)",
        code_style,
    ))
    story.append(Spacer(1, 10))
    story.append(Paragraph("Comandos:", body_bold))
    story.append(Paragraph("cd desktop && npm install    # Instalar dependencias", code_style))
    story.append(Paragraph("cd desktop && npm run dev    # Desarrollo (hot reload en :5173)", code_style))
    story.append(Paragraph("cd desktop && npm run build  # Compilar producción", code_style))
    story.append(Paragraph("sudo systemctl restart agente-pro  # Reiniciar Flask", code_style))
    story.append(hr())

    # ── 7. PROBLEMAS ─────────────────────────────────────────────────────
    story.append(Paragraph("7. Solución de Problemas", h1))
    story.append(table_block(
        ["Problema", "Solución"],
        [
            [
                "404 Not Found en /app",
                "Verificar que desktop/dist/ existe. Si no: cd desktop && npm run build. "
                "Luego reiniciar Flask: sudo systemctl restart agente-pro",
            ],
            [
                "Token inválido al ingresar",
                "Verificar que el token coincide con CHAT_API_TOKEN en .env. "
                "Si se cambió el .env, reiniciar Flask.",
            ],
            [
                "Métricas no cargan / Error de conexión",
                "Verificar que Flask está corriendo: curl http://localhost:8081/api/status. "
                "Si no responde: sudo systemctl restart agente-pro",
            ],
            [
                "Preventa muestra 0 preguntas pero hay pendientes",
                "Verificar que el archivo app/data/preguntas_pendientes_preventa.json existe "
                "y tiene preguntas con respondida: false",
            ],
            [
                "Sync no hace nada visible",
                "Las acciones de sync se ejecutan en segundo plano. Los resultados llegan "
                "por WhatsApp al grupo configurado.",
            ],
            [
                "Panel no muestra cambios tras editar código",
                "cd desktop && npm run build para recompilar. "
                "Luego sudo systemctl restart agente-pro. "
                "En desarrollo usar npm run dev para hot reload.",
            ],
        ],
    ))

    story.append(Spacer(1, 1 * inch))
    story.append(Paragraph(
        "McKenna Group S.A.S. — Bogotá, Colombia — 2026",
        ParagraphStyle("footer", parent=body, alignment=TA_CENTER, textColor=GRAY, fontSize=8),
    ))

    doc.build(story)
    print(f"Guía generada: {OUT}")


if __name__ == "__main__":
    build()
