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

import json
import os
from datetime import datetime, timedelta

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
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


_DATA = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")


def _metodo_llave() -> dict | None:
    """Método «Llave» de `app/data/datos_pago.json`, la misma fuente que usa el bot."""
    try:
        with open(os.path.join(_DATA, "datos_pago.json"), encoding="utf-8") as f:
            metodos = json.load(f).get("metodos") or []
    except Exception:
        return None
    return next((m for m in metodos if "llave" in str(m.get("nombre", "")).lower()), None)


def _llave_pago() -> dict | None:
    """Llave Bre-B de la empresa, como texto (conserva los ceros iniciales).
    Sin dato, la cotización no muestra forma de pago."""
    dato = str((_metodo_llave() or {}).get("dato") or "").strip()
    return {"banco": "Bancolombia", "llave": dato} if dato else None


def _qr_llave() -> str | None:
    """QR oficial de la llave (recorte del PDF de Bancolombia, sin retocar), si el
    método lo nombra en `qr` y el archivo existe en app/data."""
    nombre = str((_metodo_llave() or {}).get("qr") or "").strip()
    ruta = os.path.join(_DATA, os.path.basename(nombre)) if nombre else ""
    return ruta if ruta and os.path.isfile(ruta) else None


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

# Paleta de la cotización (oct-2026). Va aparte de la de arriba porque los
# comprobantes y el expediente importan ACENTO/TINTA/... y no deben cambiar.
COT_ACENTO = colors.HexColor("#086672")   # turquesa petróleo
COT_SUAVE = colors.HexColor("#EFF6F7")    # fondos de tarjeta
COT_TINTA = colors.HexColor("#173640")    # texto
COT_LINEA = colors.HexColor("#D5E4E7")    # separadores
COT_FILA = colors.HexColor("#F7FAFA")     # fila alterna de la tabla
COT_TENUE = colors.HexColor("#5B7780")    # texto secundario (refs, etiquetas)
RADIO = 5                                 # bordes redondeados, en puntos

MARGEN = 12 * mm
QR_LADO = 45 * mm   # QR Bre-B de ~113 módulos: 0,37 mm por módulo; subir si cuesta leerlo


def _estilos() -> dict[str, ParagraphStyle]:
    f = _fuentes()

    def e(nombre, fuente="regular", tam=10, color=COT_TINTA, alin=TA_LEFT, interlinea=None):
        return ParagraphStyle(nombre, fontName=f[fuente], fontSize=tam,
                              leading=interlinea or round(tam * 1.38, 1), textColor=color, alignment=alin)

    return {
        "titulo_doc": e("titulo_doc", "bold", 24, COT_ACENTO, TA_RIGHT, 27),
        "numero": e("numero", "semibold", 10.5, COT_TINTA, TA_RIGHT),
        "meta": e("meta", "regular", 9.5, COT_TENUE, TA_RIGHT),
        "lema": e("lema", "medium", 9.5, COT_ACENTO),
        "lema_centro": e("lema_centro", "medium", 9.5, COT_ACENTO, TA_CENTER),
        "etiqueta": e("etiqueta", "bold", 8, COT_ACENTO, interlinea=10),
        "nombre": e("nombre", "bold", 11, COT_TINTA),
        "cuerpo": e("cuerpo", "regular", 9.5, COT_TINTA),
        "th": e("th", "semibold", 9, BLANCO),
        "th_centro": e("th_centro", "semibold", 9, BLANCO, TA_CENTER),
        "th_der": e("th_der", "semibold", 9, BLANCO, TA_RIGHT),
        "td": e("td", "medium", 10, COT_TINTA),
        "td_ref": e("td_ref", "regular", 8, COT_TENUE),
        "tot_lbl": e("tot_lbl", "regular", 10, COT_TENUE, TA_RIGHT),
        "tot_val": e("tot_val", "medium", 10, COT_TINTA, TA_RIGHT),
        "total_lbl": e("total_lbl", "semibold", 9.5, BLANCO, TA_LEFT),
        "total_val": e("total_val", "bold", 19, BLANCO, TA_RIGHT, 23),
        "pago_titulo": e("pago_titulo", "bold", 9, COT_ACENTO),
        "pago_lbl": e("pago_lbl", "regular", 9, COT_TENUE),
        "pago_val": e("pago_val", "semibold", 10.5, COT_TINTA),
        "llave": e("llave", "bold", 14, COT_ACENTO, interlinea=17),
        "pago_nota": e("pago_nota", "regular", 9.5, COT_TINTA),
        "pendiente": e("pendiente", "semibold", 10, COT_TENUE, TA_CENTER),
        "nota_titulo": e("nota_titulo", "bold", 9, COT_ACENTO),
        "nota": e("nota", "regular", 9, COT_TINTA, interlinea=13.5),
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


def _pie_cotizacion(empresa: dict, fuentes: dict):
    """Pie de la cotización: línea fina, contacto, aviso legal y número de página."""
    def dibujar(canvas, doc):
        canvas.saveState()
        x0, x1 = doc.leftMargin, doc.pagesize[0] - doc.rightMargin
        y = doc.bottomMargin - 7 * mm
        canvas.setStrokeColor(COT_LINEA)
        canvas.setLineWidth(0.6)
        canvas.line(x0, y + 11, x1, y + 11)
        canvas.setFont(fuentes["regular"], 9)
        canvas.setFillColor(COT_TENUE)
        canvas.drawString(x0, y, f"{empresa['web']}  ·  {empresa['correo']}  ·  WhatsApp {empresa['telefono']}")
        canvas.drawString(x0, y - 12, "Documento informativo · no es factura electrónica")
        canvas.setFont(fuentes["semibold"], 9)
        canvas.setFillColor(COT_ACENTO)
        canvas.drawRightString(x1, y, f"Página {doc.page}")
        canvas.restoreState()
    return dibujar


def _tarjeta(contenido, ancho: float, *, fondo=COT_SUAVE, pad: float = 10) -> Table:
    """Bloque de fondo plano con bordes redondeados."""
    t = Table([[contenido]], colWidths=[ancho])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fondo),
        ("ROUNDEDCORNERS", [RADIO] * 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), pad + 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad + 2),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]))
    return t


def _bloque_datos(titulo: str, filas: list[tuple[str, str]], nombre: str, st: dict) -> list:
    """Contenido de la tarjeta «DE» / «PARA»: etiqueta, nombre en negrita y datos
    con salto de línea (una dirección larga crece hacia abajo, no hacia el lado)."""
    celdas = [Paragraph(_esc(titulo), st["etiqueta"]), Spacer(1, 3), Paragraph(_esc(nombre), st["nombre"]),
              Spacer(1, 2)]
    for etiqueta, valor in filas:
        if valor:
            pre = f'<font color="#5B7780">{_esc(etiqueta)}</font>  ' if etiqueta else ""
            celdas.append(Paragraph(pre + _esc(valor), st["cuerpo"]))
    return celdas


def _bloque_pago(llave: dict, empresa: dict, st: dict, ancho: float):
    """Tarjeta horizontal: datos de pago a la izquierda y el QR original a la derecha.
    El QR se inserta tal cual (PNG sin pérdida, a resolución nativa) dentro de un
    recuadro blanco; nada se dibuja encima del código ni de su margen."""
    qr = _qr_llave()
    izquierda = [
        Paragraph("FORMA DE PAGO", st["pago_titulo"]),
        Spacer(1, 8),
        Paragraph(f"<font color='#5B7780'>Banco</font>  {_esc(llave['banco'])}", st["pago_val"]),
        Spacer(1, 3),
        Paragraph(f"<font color='#5B7780'>Titular</font>  {_esc(empresa['razon_social'])}", st["pago_val"]),
        Spacer(1, 8),
        Paragraph("Llave Bre-B", st["pago_lbl"]), Paragraph(_esc(llave["llave"]), st["llave"]),
        Spacer(1, 8),
        Paragraph("Escanee el QR desde la app de su banco." if qr
                  else "Transfiera a la llave desde la app de su banco.", st["pago_nota"]),
    ]
    caja = QR_LADO + 8
    if qr:
        derecha = Image(qr, width=QR_LADO, height=QR_LADO)
    else:
        # Marcador explícito: nunca un QR generado a partir de la llave.
        derecha = Paragraph("QR original pendiente", st["pendiente"])
    qr_t = Table([[derecha]], colWidths=[caja], rowHeights=[caja])
    qr_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BLANCO),
        ("ROUNDEDCORNERS", [RADIO] * 4),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ] + ([] if qr else [("BOX", (0, 0), (-1, -1), 0.8, COT_LINEA)])))
    t = Table([[izquierda, qr_t]], colWidths=[ancho - caja - 24, caja + 24])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), COT_SUAVE),
        ("ROUNDEDCORNERS", [RADIO] * 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 14), ("RIGHTPADDING", (0, 0), (0, 0), 10),
        ("LEFTPADDING", (1, 0), (1, 0), 12), ("RIGHTPADDING", (1, 0), (1, 0), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
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

    Diseño oct-2026: tamaño carta (el configurado), márgenes de 12 mm, texto de
    9–11 pt, tarjetas planas con bordes de 5 pt. La tabla repite su encabezado
    al pasar de página y ninguna fila, ni los totales, ni la tarjeta de pago se
    parten entre páginas.
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
        topMargin=MARGEN, bottomMargin=MARGEN + 12 * mm, leftMargin=MARGEN, rightMargin=MARGEN,
        title=f"Cotización {numero} · {empresa['razon_social']}",
        author=empresa["razon_social"], subject="Cotización",
    )
    ancho = letter[0] - 2 * MARGEN
    story: list = []

    # ── Cabecera: logotipo + lema | COTIZACIÓN, número y fechas
    logo_png, aspecto = _logo()
    logo_w = 4.6 * cm
    if logo_png:
        import io

        logo = Image(io.BytesIO(logo_png), width=logo_w, height=logo_w / aspecto)
    else:
        logo = Paragraph(_esc(empresa["razon_social"]), st["nombre"])
    # Lema centrado bajo el logo: los dos en un bloque del ancho del logo.
    marca = Table([[logo], [Paragraph(_esc(LEMA), st["lema_centro"])]], colWidths=[logo_w])
    marca.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 0),
    ]))
    marca.hAlign = "LEFT"
    izquierda = [marca]
    derecha = [
        Paragraph("COTIZACIÓN", st["titulo_doc"]),
        Paragraph(_esc(numero), st["numero"]),
        Spacer(1, 3),
        Paragraph(f"Emisión  <font color='#173640'>{fecha_txt}</font>", st["meta"]),
        Paragraph(f"Vence  <font color='#173640'>{vence_txt}</font>", st["meta"]),
    ]
    cab = Table([[izquierda, derecha]], colWidths=[ancho * 0.55, ancho * 0.45])
    cab.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, COT_ACENTO),
    ]))
    story += [cab, Spacer(1, 10)]

    # ── De / Para: dos tarjetas del mismo ancho, alineadas arriba
    cliente = cotizacion.get("cliente") or {}
    hueco = 8
    col = (ancho - hueco) / 2
    de = _bloque_datos("DE", [
        ("NIT", empresa["nit"]),
        ("", empresa["ciudad"]),
        ("WhatsApp", empresa["telefono"]),
        ("", empresa["correo"]),
    ], empresa["razon_social"], st)
    para = _bloque_datos("PARA", [
        ("NIT / Cédula", cliente.get("nit") or ""),
        ("Dirección", ", ".join(x for x in (cliente.get("direccion"), cliente.get("ciudad")) if x)),
        ("WhatsApp", cliente.get("telefono") or ""),
        ("Correo", cliente.get("correo") or ""),
    ], cliente.get("nombre") or "Cliente", st)
    # Las dos tarjetas en la misma fila de una tabla con fondo por celda: así
    # quedan de la misma altura aunque la dirección del cliente ocupe más líneas.
    partes = Table([[de, "", para]], colWidths=[col, hueco, col])
    partes.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), COT_SUAVE),
        ("BACKGROUND", (2, 0), (2, 0), COT_SUAVE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("LEFTPADDING", (1, 0), (1, 0), 0), ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story += [partes, Spacer(1, 12)]

    # ── Detalle: # · producto (ref. debajo) · cant · precio unit · IVA · total
    productos = cotizacion.get("productos") or []
    f_reg, f_semi = fuentes["regular"], fuentes["semibold"]
    filas = [[Paragraph("#", st["th_centro"]), Paragraph("Producto", st["th"]),
              Paragraph("Cant.", st["th_centro"]), Paragraph("Precio unit.", st["th_der"]),
              Paragraph("IVA", st["th_centro"]), Paragraph("Total", st["th_der"])]]
    for i, p in enumerate(productos, 1):
        sku = (p.get("sku") or "").strip()
        celda = [Paragraph(_esc(p.get("nombre", "")), st["td"])]
        if sku:
            celda.append(Paragraph(f"Ref. {_esc(sku)}", st["td_ref"]))
        # Importes como texto plano (no Paragraph): una celda de texto plano no
        # parte la cifra en dos líneas.
        filas.append([str(i), celda, _cantidad(p.get("cantidad")), _pesos(p.get("precio_unit")),
                      _pct(p.get("iva_pct")) if p.get("iva_pct") is not None else "—",
                      _pesos(p.get("subtotal"))])
    if not productos:
        filas.append(["", Paragraph("Sin productos", st["td_ref"]), "", "", "", ""])
    fijas = [0.9 * cm, 1.7 * cm, 2.9 * cm, 1.6 * cm, 3.1 * cm]
    anchos = [fijas[0], ancho - sum(fijas)] + fijas[1:]
    tabla = Table(filas, colWidths=anchos, repeatRows=1)
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COT_ACENTO),
        ("ROUNDEDCORNERS", [RADIO, RADIO, 0, 0]),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [BLANCO, COT_FILA]),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, COT_LINEA),
        ("FONT", (0, 1), (-1, -1), f_reg, 10),
        ("FONT", (5, 1), (5, -1), f_semi, 10),
        ("TEXTCOLOR", (0, 1), (-1, -1), COT_TINTA),
        ("TEXTCOLOR", (0, 1), (0, -1), COT_TENUE),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 1), (2, -1), "CENTER"),
        ("ALIGN", (4, 1), (4, -1), "CENTER"),
        ("ALIGN", (3, 1), (3, -1), "RIGHT"),
        ("ALIGN", (5, 1), (5, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 1), (-1, -1), 5), ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [tabla, Spacer(1, 10)]

    # ── Totales (precios con IVA incluido; los valores llegan ya calculados) a la
    # derecha y, en la misma fila, la tarjeta de pago: así una cotización corriente
    # cabe en una página sin achicar la letra.
    tot_ancho = 8.4 * cm
    resumen = Table([
        [Paragraph("Subtotal sin IVA", st["tot_lbl"]), Paragraph(_pesos(cotizacion.get("subtotal", 0)), st["tot_val"])],
        [Paragraph("IVA", st["tot_lbl"]), Paragraph(_pesos(cotizacion.get("iva", 0)), st["tot_val"])],
    ], colWidths=[tot_ancho * 0.55, tot_ancho * 0.45])
    resumen.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    total = Table([[Paragraph("TOTAL A PAGAR", st["total_lbl"])],
                   [Paragraph(_pesos(cotizacion.get("total", 0)) + " <font size='9'>COP</font>", st["total_val"])]],
                  colWidths=[tot_ancho])
    total.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), COT_ACENTO),
        ("ROUNDEDCORNERS", [RADIO] * 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, 0), 9), ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 2), ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
    ]))
    totales = [resumen, Spacer(1, 6), total]

    llave = _llave_pago()
    if llave:
        hueco = 10
        pago_w = ancho - tot_ancho - hueco
        fila = Table([[_bloque_pago(llave, empresa, st, pago_w), "", totales]],
                     colWidths=[pago_w, hueco, tot_ancho])
        fila.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story += [KeepTogether([fila]), Spacer(1, 12)]
    else:
        for t in totales:
            t.hAlign = "RIGHT"
        story += [KeepTogether(totales), Spacer(1, 12)]

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
    cuerpo = [Paragraph("CONDICIONES", st["nota_titulo"]), Spacer(1, 3)]
    if notas:
        cuerpo += [Paragraph(f"<b>Nota:</b> {_esc(notas)}", st["nota"]), Spacer(1, 3)]
    for c in condiciones:
        cuerpo += [Paragraph(_esc(c), st["nota"], bulletText="•"), Spacer(1, 1)]
    cuerpo.append(Paragraph(
        _esc("¿Necesita ajustar cantidades o presentaciones? Escríbanos por WhatsApp y le enviamos "
             "la cotización actualizada."), st["nota"], bulletText="•"))
    story.append(KeepTogether([_tarjeta(cuerpo, ancho, pad=8)]))

    pie = _pie_cotizacion(empresa, fuentes)
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
        f"💵 Total: *${total:,.0f} COP*\n"
        + (f"🏦 Llave Bre-B {llave['banco']}: *{llave['llave']}* (el QR va en el PDF)\n"
           if (llave := _llave_pago()) else "")
        + "\n"
        + f"📌 Válida por 15 días. Una vez realizado el pago, envíe el comprobante para "
        f"proceder con la factura electrónica y el despacho."
    )

    # Enviar al cliente
    enviar_whatsapp_archivo(ruta, caption, numero_destino=numero_cliente)
    # Enviar al grupo
    enviar_whatsapp_reporte(f"📋 Cotización {numero_cot} enviada a {cliente} · Total: ${total:,.0f} COP")

    return ruta
