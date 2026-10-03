"""
REC-02: Generación automática de Cotizaciones en PDF
Membrete corporativo McKenna Group S.A.S.
Envía al cliente por WhatsApp y al grupo.

Diseño (sep-2026): misma identidad que la página web (tema clásico de
`app/tools/tema_web.py`: turquesa #0c6069 sobre página blanca, Montserrat) y
el mismo logotipo que sale en la factura electrónica de Alegra
(`DISENO CORPORATIVO /LOGOTIPO TURQUESA.png`). Todo texto variable va en
`Paragraph` para que haga salto de línea: la versión anterior metía cadenas
planas en las celdas y un nombre de producto o una razón social larga se
montaban encima de la columna siguiente.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_ROOT = "/home/mckg/mi-agente"
CARPETA = os.path.join(_ROOT, "cotizaciones_pdf")
os.makedirs(CARPETA, exist_ok=True)

# Mismo logotipo que la factura de Alegra (isotipo + «MCKENNA GROUP»), en el
# turquesa de la web. Si no está, cae al isotipo solo.
_LOGO = os.path.join(_ROOT, "DISENO CORPORATIVO ", "LOGOTIPO TURQUESA.png")
_LOGO_ISOTIPO = os.path.join(_ROOT, "DISENO CORPORATIVO ", "isotipo_final.png")

FONT_DIR = "/usr/share/fonts/truetype/montserrat/"
LEMA = "Proveemos a tus ideas"
VIGENCIA_DIAS_DEFAULT = 15

# Paleta = COLORES_CLASICO_DEFAULT de la web (tema_web.py) + tintas derivadas.
ACENTO = colors.HexColor("#0c6069")        # --green
ACENTO_OSCURO = colors.HexColor("#045159")  # --green-dark
TINTA = colors.HexColor("#022d33")          # --text-dark / --green-deep
ACENTO_CLARO = colors.HexColor("#6aacb3")   # --green-light
TEXTO_SUAVE = colors.HexColor("#3a7e87")    # --text-muted
BORDE = colors.HexColor("#d3e3e5")          # rgba(12,96,105,.18) sobre blanco
FONDO_SUAVE = colors.HexColor("#f5f6f7")    # --off-white
TINTE = colors.HexColor("#eef6f7")          # acento al 8 % sobre blanco
BLANCO = colors.white

# Compatibilidad con quien importe los nombres viejos.
AZUL_OSCURO, AZUL, AZUL_CLARO, GRIS, GRIS_CLARO, VERDE = (
    TINTA, ACENTO, TINTE, TEXTO_SUAVE, FONDO_SUAVE, ACENTO_OSCURO,
)

_FUENTES_OK: bool | None = None


def _registrar_fuentes() -> bool:
    """Montserrat (la tipografía del sitio). Si falta, Helvetica sin fallar."""
    global _FUENTES_OK
    if _FUENTES_OK is not None:
        return _FUENTES_OK
    try:
        for nombre, archivo in (
            ("Mont-Regular", "Montserrat-Regular.ttf"),
            ("Mont-Medium", "Montserrat-Medium.ttf"),
            ("Mont-SemiBold", "Montserrat-SemiBold.ttf"),
            ("Mont-Bold", "Montserrat-Bold.ttf"),
        ):
            if nombre not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(nombre, os.path.join(FONT_DIR, archivo)))
        pdfmetrics.registerFontFamily(
            "Mont-Regular", normal="Mont-Regular", bold="Mont-Bold",
            italic="Mont-Regular", boldItalic="Mont-Bold",
        )
        _FUENTES_OK = True
    except Exception as e:  # noqa: BLE001 — sin Montserrat el PDF igual sale
        print(f"⚠️ [COTIZACIÓN PDF] Sin Montserrat ({e}); se usa Helvetica.")
        _FUENTES_OK = False
    return _FUENTES_OK


def _fuentes() -> dict[str, str]:
    if _registrar_fuentes():
        return {"regular": "Mont-Regular", "medium": "Mont-Medium",
                "semibold": "Mont-SemiBold", "bold": "Mont-Bold"}
    return {"regular": "Helvetica", "medium": "Helvetica",
            "semibold": "Helvetica-Bold", "bold": "Helvetica-Bold"}


# ─── Formatos ───────────────────────────────────────────────────────────────

def _pesos(valor) -> str:
    """$ 1.750.000 — formato colombiano, sin decimales."""
    try:
        n = round(float(valor or 0))
    except (TypeError, ValueError):
        n = 0
    signo = "-" if n < 0 else ""
    return f"{signo}$ {abs(n):,.0f}".replace(",", ".")


def _cantidad(valor) -> str:
    try:
        n = float(valor or 0)
    except (TypeError, ValueError):
        return str(valor or "")
    return f"{int(n)}" if n.is_integer() else f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _pct(valor) -> str:
    try:
        n = float(valor or 0)
    except (TypeError, ValueError):
        return "—"
    if n <= 0:
        return "0 %"
    return f"{int(n)} %" if n.is_integer() else f"{n:g} %"


def _esc(texto) -> str:
    """Escapa lo que Paragraph interpretaría como marcado."""
    return (str(texto if texto is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _fecha_texto(fecha) -> tuple[str, datetime]:
    """Acepta dd/mm/YYYY o YYYY-mm-dd; devuelve (texto dd/mm/YYYY, datetime)."""
    if isinstance(fecha, datetime):
        return fecha.strftime("%d/%m/%Y"), fecha
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            d = datetime.strptime(str(fecha or "")[:19], fmt)
            return d.strftime("%d/%m/%Y"), d
        except ValueError:
            continue
    hoy = datetime.now()
    return hoy.strftime("%d/%m/%Y"), hoy


# ─── Identidad de la empresa ────────────────────────────────────────────────

def _empresa() -> dict:
    """Identidad fiscal desde `app/services/empresa.py` (fuente única) y el
    WhatsApp desde el remitente editable en el panel (Guías de envío). La
    cotización no lleva dirección física (decisión del 23-sep-2026): ciudad basta."""
    datos = {
        "razon_social": "McKenna Group S.A.S.",
        "nit": "901.316.016-3",
        "ciudad": "Bogotá D.C.",
        "telefono": "319 518 35 96",
        "correo": os.getenv("EMPRESA_CORREO", "mckenna.group.colombia@gmail.com"),
        "web": os.getenv("EMPRESA_WEB", "mckennagroup.co"),
    }
    try:
        from app.services import empresa

        datos.update(razon_social=empresa.razon_social(), nit=empresa.nit(), ciudad=empresa.ciudad())
    except Exception:
        pass
    try:
        from app.tools.guias_envio import leer_remitente

        rem = leer_remitente()
        if rem.get("telefono"):
            datos["telefono"] = rem["telefono"]
    except Exception:
        pass
    return datos


_LOGO_CACHE: dict = {}


def _logo() -> tuple[bytes | None, float]:
    """(PNG, ancho/alto) del logotipo reducido a ~800 px: a 5,6 cm de ancho eso
    son ~360 ppp, de sobra para imprimir, y el PDF pasa de ~640 KB a ~80 KB (el
    original de 2158 px iba entero en cada cotización enviada por WhatsApp)."""
    if "png" in _LOGO_CACHE:
        return _LOGO_CACHE["png"], _LOGO_CACHE.get("aspect", 3.0)
    _LOGO_CACHE["png"] = None
    ruta = _LOGO if os.path.isfile(_LOGO) else _LOGO_ISOTIPO
    try:
        import io

        from PIL import Image as PILImage

        with PILImage.open(ruta) as img:
            img = img.convert("RGBA")
            _LOGO_CACHE["aspect"] = img.size[0] / max(1, img.size[1])
            if img.size[0] > 800:
                img = img.resize((800, round(800 / _LOGO_CACHE["aspect"])), PILImage.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
        _LOGO_CACHE["png"] = buf.getvalue()
    except Exception:
        pass
    return _LOGO_CACHE["png"], _LOGO_CACHE.get("aspect", 3.0)


# ─── Documento ──────────────────────────────────────────────────────────────

def _estilos() -> dict[str, ParagraphStyle]:
    f = _fuentes()
    return {
        "etiqueta": ParagraphStyle("etiqueta", fontName=f["semibold"], fontSize=7, leading=9,
                                   textColor=TEXTO_SUAVE),
        "titulo_doc": ParagraphStyle("titulo_doc", fontName=f["bold"], fontSize=20, leading=23,
                                     textColor=ACENTO, alignment=TA_RIGHT),
        "numero": ParagraphStyle("numero", fontName=f["medium"], fontSize=10, leading=13,
                                 textColor=TINTA, alignment=TA_RIGHT),
        "meta": ParagraphStyle("meta", fontName=f["regular"], fontSize=8.5, leading=12,
                               textColor=TEXTO_SUAVE, alignment=TA_RIGHT),
        "seccion": ParagraphStyle("seccion", fontName=f["semibold"], fontSize=8, leading=10,
                                  textColor=ACENTO),
        "nombre": ParagraphStyle("nombre", fontName=f["semibold"], fontSize=10.5, leading=13.5,
                                 textColor=TINTA),
        "cuerpo": ParagraphStyle("cuerpo", fontName=f["regular"], fontSize=8.5, leading=12,
                                 textColor=TINTA),
        "cuerpo_suave": ParagraphStyle("cuerpo_suave", fontName=f["regular"], fontSize=8.5,
                                       leading=12, textColor=TEXTO_SUAVE),
        "th": ParagraphStyle("th", fontName=f["semibold"], fontSize=7.5, leading=9.5,
                             textColor=BLANCO),
        "th_der": ParagraphStyle("th_der", fontName=f["semibold"], fontSize=7.5, leading=9.5,
                                 textColor=BLANCO, alignment=TA_RIGHT),
        "th_centro": ParagraphStyle("th_centro", fontName=f["semibold"], fontSize=7.5, leading=9.5,
                                    textColor=BLANCO, alignment=TA_CENTER),
        "td": ParagraphStyle("td", fontName=f["regular"], fontSize=8.5, leading=11.5, textColor=TINTA),
        "td_sku": ParagraphStyle("td_sku", fontName=f["regular"], fontSize=7, leading=9,
                                 textColor=TEXTO_SUAVE),
        "td_der": ParagraphStyle("td_der", fontName=f["regular"], fontSize=8.5, leading=11.5,
                                 textColor=TINTA, alignment=TA_RIGHT),
        "td_der_b": ParagraphStyle("td_der_b", fontName=f["semibold"], fontSize=8.5, leading=11.5,
                                   textColor=TINTA, alignment=TA_RIGHT),
        "td_centro": ParagraphStyle("td_centro", fontName=f["regular"], fontSize=8.5, leading=11.5,
                                    textColor=TEXTO_SUAVE, alignment=TA_CENTER),
        "tot_lbl": ParagraphStyle("tot_lbl", fontName=f["regular"], fontSize=8.5, leading=12,
                                  textColor=TEXTO_SUAVE, alignment=TA_RIGHT),
        "tot_val": ParagraphStyle("tot_val", fontName=f["medium"], fontSize=8.5, leading=12,
                                  textColor=TINTA, alignment=TA_RIGHT),
        "total_lbl": ParagraphStyle("total_lbl", fontName=f["semibold"], fontSize=9.5, leading=13,
                                    textColor=BLANCO, alignment=TA_RIGHT),
        "total_val": ParagraphStyle("total_val", fontName=f["bold"], fontSize=12.5, leading=15,
                                    textColor=BLANCO, alignment=TA_RIGHT),
        "nota_titulo": ParagraphStyle("nota_titulo", fontName=f["semibold"], fontSize=8, leading=11,
                                      textColor=ACENTO_OSCURO),
        "nota": ParagraphStyle("nota", fontName=f["regular"], fontSize=8, leading=11.5,
                               textColor=TINTA),
        "lema": ParagraphStyle("lema", fontName=f["medium"], fontSize=9, leading=12,
                               textColor=ACENTO, alignment=TA_LEFT),
    }


def _pie_de_pagina(empresa: dict, fuentes: dict):
    """Pie fijo en cada página: identidad + numeración. Dibujado sobre el canvas."""
    def dibujar(canvas, doc):
        canvas.saveState()
        ancho, _ = letter
        x0, x1 = doc.leftMargin, ancho - doc.rightMargin
        y = doc.bottomMargin - 0.55 * cm
        canvas.setStrokeColor(BORDE)
        canvas.setLineWidth(0.6)
        canvas.line(x0, y + 0.55 * cm, x1, y + 0.55 * cm)
        canvas.setFillColor(TEXTO_SUAVE)
        canvas.setFont(fuentes["regular"], 7)
        linea1 = f"{empresa['razon_social']}  ·  NIT {empresa['nit']}  ·  {empresa['ciudad']}"
        linea2 = f"{empresa['web']}  ·  {empresa['correo']}  ·  WhatsApp {empresa['telefono']}"
        canvas.drawString(x0, y, linea1)
        canvas.drawString(x0, y - 10, linea2)
        canvas.setFont(fuentes["medium"], 7)
        canvas.setFillColor(ACENTO)
        canvas.drawRightString(x1, y, f"Página {doc.page}")
        canvas.setFont(fuentes["regular"], 7)
        canvas.setFillColor(TEXTO_SUAVE)
        canvas.drawRightString(x1, y - 10, "Documento informativo · no es factura electrónica")
        canvas.restoreState()
    return dibujar


def _bloque_datos(titulo: str, filas: list[tuple[str, str]], nombre: str, st: dict, ancho: float) -> Table:
    """Tarjeta «De» / «Para»: nombre en grande y debajo etiqueta → valor, todo con salto de línea."""
    celdas = [[Paragraph(_esc(titulo), st["etiqueta"])], [Paragraph(_esc(nombre), st["nombre"])]]
    for etiqueta, valor in filas:
        if not valor:
            continue
        celdas.append([Paragraph(
            f'<font color="#3a7e87">{_esc(etiqueta)}</font>  {_esc(valor)}', st["cuerpo"])])
    t = Table(celdas, colWidths=[ancho])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("TOPPADDING", (0, 0), (-1, 0), 0),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 4),
        ("LINEBEFORE", (0, 0), (0, -1), 2, ACENTO),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def generar_cotizacion_pdf(cotizacion: dict, *, carpeta: str | None = None) -> str:
    """
    Genera PDF de cotización con membrete corporativo.

    cotizacion = {
        "numero": "COT-2026-001",
        "fecha": "2026-04-02" | "02/04/2026",
        "vigencia_dias": 15,                       # opcional
        "cliente": {"nombre": "...", "nit": "...", "correo": "...", "direccion": "...",
                    "telefono": "..."},            # telefono opcional
        "productos": [{"nombre": "...", "sku": "...", "cantidad": 1, "precio_unit": 5000,
                       "subtotal": 5000, "iva_pct": 19}],   # iva_pct opcional
        "subtotal": 100000,
        "iva": 19000,
        "total": 119000,
        "notas": "..."
    }
    Retorna la ruta del PDF generado.
    """
    numero = cotizacion.get("numero", f"COT-{datetime.now().strftime('%Y%m%d%H%M%S')}")
    filename = os.path.join(carpeta or CARPETA, f"{numero}.pdf")

    fuentes = _fuentes()
    st = _estilos()
    empresa = _empresa()
    fecha_txt, fecha_dt = _fecha_texto(cotizacion.get("fecha"))
    try:
        vigencia = int(cotizacion.get("vigencia_dias") or VIGENCIA_DIAS_DEFAULT)
    except (TypeError, ValueError):
        vigencia = VIGENCIA_DIAS_DEFAULT
    vence_txt = (fecha_dt + timedelta(days=vigencia)).strftime("%d/%m/%Y")

    doc = SimpleDocTemplate(
        filename, pagesize=letter,
        topMargin=1.6 * cm, bottomMargin=2.2 * cm, leftMargin=1.9 * cm, rightMargin=1.9 * cm,
        title=f"Cotización {numero} · {empresa['razon_social']}",
        author=empresa["razon_social"], subject="Cotización",
    )
    ancho_util = letter[0] - doc.leftMargin - doc.rightMargin
    story: list = []

    # ── Cabecera: logotipo a la izquierda, datos del documento a la derecha
    logo_png, aspecto = _logo()
    logo_w = 5.6 * cm
    if logo_png:
        import io

        celda_logo = Image(io.BytesIO(logo_png), width=logo_w, height=logo_w / aspecto)
    else:
        celda_logo = Paragraph(_esc(empresa["razon_social"]), st["nombre"])
    celda_logo.hAlign = "LEFT"
    meta = [
        Paragraph("COTIZACIÓN", st["titulo_doc"]),
        Paragraph(_esc(numero), st["numero"]),
        Spacer(1, 4),
        Paragraph(f"Fecha  <font color='#022d33'>{fecha_txt}</font>", st["meta"]),
        Paragraph(f"Válida hasta  <font color='#022d33'>{vence_txt}</font>", st["meta"]),
    ]
    cab = Table([[celda_logo, meta]], colWidths=[ancho_util * 0.55, ancho_util * 0.45])
    cab.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 1.4, ACENTO),
    ]))
    story.append(cab)
    story.append(Spacer(1, 4))
    story.append(Paragraph(_esc(LEMA), st["lema"]))
    story.append(Spacer(1, 14))

    # ── De / Para
    cliente = cotizacion.get("cliente") or {}
    de = _bloque_datos("DE", [
        ("NIT", empresa["nit"]),
        ("", empresa["ciudad"]),
        ("WhatsApp", empresa["telefono"]),
        ("", empresa["correo"]),
    ], empresa["razon_social"], st, ancho_util * 0.47)
    para = _bloque_datos("PARA", [
        ("NIT / Cédula", cliente.get("nit") or ""),
        ("Dirección", cliente.get("direccion") or ""),
        ("WhatsApp", cliente.get("telefono") or ""),
        ("Correo", cliente.get("correo") or ""),
    ], cliente.get("nombre") or "Cliente", st, ancho_util * 0.47)
    partes = Table([[de, para]], colWidths=[ancho_util * 0.5, ancho_util * 0.5])
    partes.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(partes)
    story.append(Spacer(1, 16))

    # ── Detalle
    productos = cotizacion.get("productos") or []
    con_iva = any(p.get("iva_pct") is not None for p in productos)
    encabezado = [Paragraph("#", st["th_centro"]), Paragraph("Producto", st["th"]),
                  Paragraph("Cant.", st["th_der"]), Paragraph("Precio unit.", st["th_der"])]
    if con_iva:
        encabezado.append(Paragraph("IVA", st["th_der"]))
    encabezado.append(Paragraph("Total", st["th_der"]))
    filas = [encabezado]
    for i, p in enumerate(productos, 1):
        nombre = Paragraph(_esc(p.get("nombre", "")), st["td"])
        sku = (p.get("sku") or "").strip()
        celda_nombre = [nombre, Paragraph(f"Ref. {_esc(sku)}", st["td_sku"])] if sku else nombre
        fila = [Paragraph(str(i), st["td_centro"]), celda_nombre,
                Paragraph(_cantidad(p.get("cantidad")), st["td_der"]),
                Paragraph(_pesos(p.get("precio_unit")), st["td_der"])]
        if con_iva:
            fila.append(Paragraph(_pct(p.get("iva_pct")), st["td_der"]))
        fila.append(Paragraph(_pesos(p.get("subtotal")), st["td_der_b"]))
        filas.append(fila)

    if con_iva:
        col_ws = [0.05, 0.47, 0.09, 0.15, 0.08, 0.16]
    else:
        col_ws = [0.05, 0.53, 0.10, 0.16, 0.16]
    tabla = Table(filas, colWidths=[ancho_util * w for w in col_ws], repeatRows=1)
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), ACENTO),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [BLANCO, FONDO_SUAVE]),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDE),
    ]
    tabla.setStyle(TableStyle(estilo))
    story.append(tabla)
    story.append(Spacer(1, 10))

    # ── Totales: precios al público con IVA incluido; el desglose es informativo
    sub = cotizacion.get("subtotal", 0)
    iva = cotizacion.get("iva", 0)
    tot = cotizacion.get("total", 0)
    tot_filas = [
        [Paragraph("Subtotal sin IVA", st["tot_lbl"]), Paragraph(_pesos(sub), st["tot_val"])],
        [Paragraph("IVA", st["tot_lbl"]), Paragraph(_pesos(iva), st["tot_val"])],
        [Paragraph("TOTAL A PAGAR", st["total_lbl"]), Paragraph(f"{_pesos(tot)} <font size='7'>COP</font>", st["total_val"])],
    ]
    tot_ancho = ancho_util * 0.44
    tot_t = Table(tot_filas, colWidths=[tot_ancho * 0.52, tot_ancho * 0.48])
    tot_t.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, 1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, 1), 3),
        ("LINEBELOW", (0, 1), (-1, 1), 0.5, BORDE),
        ("BACKGROUND", (0, 2), (-1, 2), ACENTO_OSCURO),
        ("TOPPADDING", (0, 2), (-1, 2), 8),
        ("BOTTOMPADDING", (0, 2), (-1, 2), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    tot_t.hAlign = "RIGHT"
    story.append(KeepTogether([tot_t]))
    story.append(Spacer(1, 18))

    # ── Condiciones
    notas = (cotizacion.get("notas") or "").strip()
    condiciones = [
        f"Precios en pesos colombianos con IVA incluido. Cotización válida hasta el {vence_txt} "
        f"({vigencia} días calendario); pasada esa fecha los precios pueden cambiar.",
        "Para confirmar el pedido, realice el pago y envíe el comprobante por WhatsApp. Con el pago "
        "confirmado emitimos la factura electrónica y programamos el despacho.",
        "Materias primas farmacéuticas y cosméticas reenvasadas; cada producto viaja con su etiqueta "
        "y, si lo requiere, con su ficha técnica y certificado de análisis.",
    ]
    cuerpo = [Paragraph("CONDICIONES", st["nota_titulo"])]
    if notas:
        cuerpo.append(Paragraph(f"<b>Nota:</b> {_esc(notas)}", st["nota"]))
    cuerpo += [Paragraph(f"•  {_esc(c)}", st["nota"]) for c in condiciones]
    nt = Table([[cuerpo]], colWidths=[ancho_util])
    nt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TINTE),
        ("LINEBEFORE", (0, 0), (0, -1), 2, ACENTO),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(KeepTogether([nt]))
    story.append(Spacer(1, 14))
    story.append(Paragraph(
        "Gracias por contar con McKenna Group. Cualquier ajuste en cantidades o presentaciones, "
        "escríbanos por WhatsApp y le enviamos la cotización actualizada.",
        st["cuerpo_suave"],
    ))

    pie = _pie_de_pagina(empresa, fuentes)
    doc.build(story, onFirstPage=pie, onLaterPages=pie)
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
