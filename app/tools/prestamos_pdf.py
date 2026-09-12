"""
Documentos digitales de un préstamo recibido de un tercero.

Dos piezas, ambas en PDF:

  - **Contrato de mutuo con interés** (`generar_pdf_contrato`): se emite al
    desembolsar. Lleva las condiciones pactadas y el cronograma completo de las
    24 cuotas, con la separación explícita entre interés bruto, retención y
    valor girado — que es justo donde nacen los reclamos si queda ambiguo.
  - **Certificado de estado** (`generar_pdf_certificado`): foto del préstamo a
    una fecha (cuotas pagadas, retención practicada, saldo pendiente). Sirve al
    prestamista para su declaración de renta.

Los tres porcentajes van SIEMPRE los tres en el documento, con nombre propio,
porque son distintos y confundirlos es el error clásico:
  - tasa pactada (25% E.A.), que es lo único que se pacta;
  - rendimiento bruto (27,97% del capital a 24 meses), que es consecuencia del
    cronograma;
  - rendimiento neto girado (26,01%), después de la retención del 7%.

Nota deliberada: esto NO genera un pagaré. Un pagaré es un título valor con
requisitos propios (Art. 621 y 709 C.Co.) y consecuencias ejecutivas; si el
negocio lo necesita, lo redacta un abogado y se firma aparte. Acá se emite el
contrato de mutuo, que es lo que soporta la operación contablemente.
"""

from __future__ import annotations

import os
import tempfile
from datetime import date, datetime

from app.services import empresa as _empresa
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_ACCENT = colors.HexColor("#0c6069")
_INK = colors.HexColor("#0f172a")
_MUTED = colors.HexColor("#64748b")
_LINEA = colors.HexColor("#e2e8f0")
_FONDO = colors.HexColor("#f8fafc")

_CARPETA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "prestamos_documentos"
)

# Identidad fiscal: siempre desde app/services/empresa.py, nunca literales acá
# (ver el incidente del NIT en cuentas de cobro documentado en ese módulo).
MCKENNA_RAZON = _empresa.razon_social("PRESTAMOS_MUTUARIO_RAZON")
MCKENNA_NIT = _empresa.nit("PRESTAMOS_MUTUARIO_NIT")
MCKENNA_CIUDAD = _empresa.ciudad("PRESTAMOS_MUTUARIO_CIUDAD")
MCKENNA_REPRESENTANTE = os.getenv("PRESTAMOS_MUTUARIO_REPRESENTANTE", "")

_MESES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)


def _cop(n) -> str:
    return "$" + f"{round(float(n or 0)):,}".replace(",", ".")


def _pct(n, dec: int = 2) -> str:
    return f"{float(n or 0):.{dec}f}".replace(".", ",") + "%"


def _fecha_larga(iso: str) -> str:
    try:
        d = datetime.strptime(str(iso)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return str(iso or "")
    return f"{d.day} de {_MESES[d.month - 1]} de {d.year}"


def _fecha_corta(iso: str) -> str:
    try:
        d = datetime.strptime(str(iso)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return str(iso or "")
    return d.strftime("%d/%m/%Y")


def _asegurar_carpeta() -> None:
    os.makedirs(_CARPETA, exist_ok=True)
    try:
        os.chmod(_CARPETA, 0o777)
    except OSError:
        pass


def _guardar(doc: SimpleDocTemplate, story: list, destino: str) -> str:
    """Escribe a temporal y reemplaza: evita chocar con permisos de un PDF
    anterior generado por otro usuario del sistema (el agente corre como
    servicio, el panel a veces como el usuario del shell)."""
    _asegurar_carpeta()
    fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=_CARPETA)
    os.close(fd)
    try:
        doc.filename = tmp
        doc.build(story)
        os.replace(tmp, destino)
        try:
            os.chmod(destino, 0o666)
        except OSError:
            pass
    except Exception:
        try:
            if os.path.isfile(tmp):
                os.unlink(tmp)
        except OSError:
            pass
        raise
    return destino


def _estilos() -> dict:
    base = getSampleStyleSheet()
    return {
        "titulo": ParagraphStyle(
            "t", parent=base["Title"], fontSize=15, leading=19, textColor=_ACCENT, spaceAfter=2
        ),
        "subtitulo": ParagraphStyle(
            "st", parent=base["Normal"], fontSize=8.5, textColor=_MUTED, alignment=TA_CENTER
        ),
        "h": ParagraphStyle(
            "h", parent=base["Normal"], fontSize=9.5, leading=12, textColor=_ACCENT,
            fontName="Helvetica-Bold", spaceBefore=9, spaceAfter=3,
        ),
        "p": ParagraphStyle(
            "p", parent=base["Normal"], fontSize=8.5, leading=11.5, textColor=_INK,
            alignment=TA_JUSTIFY, spaceAfter=4,
        ),
        "nota": ParagraphStyle(
            "n", parent=base["Normal"], fontSize=7.5, leading=10, textColor=_MUTED
        ),
        "celda": ParagraphStyle("c", parent=base["Normal"], fontSize=7.5, leading=9.5, textColor=_INK),
        "der": ParagraphStyle("d", parent=base["Normal"], fontSize=8.5, alignment=TA_RIGHT, textColor=_INK),
    }


def _encabezado(story: list, st: dict, titulo: str, numero: str) -> None:
    story.append(Paragraph(titulo, st["titulo"]))
    story.append(Paragraph(f"{MCKENNA_RAZON} · NIT {MCKENNA_NIT} · {numero}", st["subtitulo"]))
    story.append(Spacer(1, 5))
    story.append(HRFlowable(width="100%", thickness=1.1, color=_ACCENT, spaceAfter=8))


def _tabla(datos: list, anchos: list, st: dict, *, encabezado: bool = True) -> Table:
    t = Table(datos, colWidths=anchos, repeatRows=1 if encabezado else 0, hAlign="LEFT")
    estilo = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.3),
        ("TEXTCOLOR", (0, 0), (-1, -1), _INK),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.35, _LINEA),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if encabezado:
        estilo += [
            ("BACKGROUND", (0, 0), (-1, 0), _ACCENT),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _FONDO]),
        ]
    t.setStyle(TableStyle(estilo))
    return t


def _tabla_cronograma(cuotas: list, st: dict, *, con_estado: bool = False) -> Table:
    cab = ["#", "Vence", "Saldo", "Interés\nbruto", "Retención", "Interés\nneto", "Capital", "A girar"]
    if con_estado:
        cab.append("Estado")
    datos = [cab]
    for c in cuotas:
        fila = [
            str(c["numero"]),
            _fecha_corta(c.get("fecha_vencimiento") or c.get("fecha")),
            _cop(c["saldo_inicial"]),
            _cop(c["interes_bruto"]),
            _cop(c["retencion"]),
            _cop(c["interes_girado"]),
            _cop(c["abono_capital"]),
            _cop(c["cuota_girada"]),
        ]
        if con_estado:
            fila.append({"pagada": "Pagada", "solicitada": "En trámite"}.get(c.get("estado"), "Pendiente"))
        datos.append(fila)
    total_int = sum(float(c["interes_bruto"]) for c in cuotas)
    total_ret = sum(float(c["retencion"]) for c in cuotas)
    total_neto = sum(float(c["interes_girado"]) for c in cuotas)
    total_cap = sum(float(c["abono_capital"]) for c in cuotas)
    total_gir = sum(float(c["cuota_girada"]) for c in cuotas)
    fila_tot = ["", "TOTAL", "", _cop(total_int), _cop(total_ret), _cop(total_neto),
                _cop(total_cap), _cop(total_gir)]
    if con_estado:
        fila_tot.append("")
    datos.append(fila_tot)

    anchos = [0.9 * cm, 1.7 * cm, 2.5 * cm, 2.2 * cm, 2.0 * cm, 2.2 * cm, 2.2 * cm, 2.4 * cm]
    if con_estado:
        anchos.append(1.8 * cm)
    t = _tabla(datos, anchos, st)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, len(datos) - 1), (-1, len(datos) - 1), "Helvetica-Bold"),
        ("BACKGROUND", (0, len(datos) - 1), (-1, len(datos) - 1), colors.HexColor("#e2f5f3")),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
    ]))
    return t


def _pie_retencion(prestamo: dict, st: dict) -> Paragraph:
    """La retención explicada para quien la recibe, no para un abogado."""
    pct = _pct(prestamo["retencion_pct"] * 100, 0)
    if prestamo.get("gross_up"):
        return Paragraph(
            f"La ley obliga a McKenna a retener un {pct} de los intereses y consignárselo a la DIAN "
            f"a nombre suyo. En este contrato <b>ese {pct} lo asume McKenna</b>: a usted le llega el "
            "interés completo, y la retención la paga la empresa aparte. Cada año McKenna le entrega "
            "un certificado con lo retenido, para su declaración de renta.",
            st["p"],
        )
    return Paragraph(
        f"La ley obliga a McKenna a retener un {pct} de los intereses —no del capital— y "
        "consignárselo a la DIAN a nombre suyo (Art. 395 del Estatuto Tributario). "
        f"<b>No es un cobro de McKenna ni dinero perdido</b>: es un anticipo de su impuesto de renta. "
        "Cada año McKenna le entrega un certificado con el total retenido para que lo descuente de "
        "lo que le corresponda pagar. Por eso lo que le llega a la cuenta cada mes es el interés ya "
        f"menos ese {pct}.",
        st["p"],
    )


def nombre_archivo(prestamo: dict, tipo: str, fecha: str | None = None) -> str:
    doc = "".join(ch for ch in str((prestamo.get("tercero") or {}).get("identificacion") or "") if ch.isdigit())
    suf = f"_{str(fecha)[:10]}" if fecha else ""
    return f"{tipo}_prestamo_{prestamo['id']:04d}_{doc or 'sindoc'}{suf}.pdf"


def numero_documento(prestamo: dict, tipo: str) -> str:
    prefijo = {"contrato": "MUT", "certificado": "CERT"}.get(tipo, "DOC")
    anio = str(prestamo.get("fecha_desembolso") or "")[:4] or date.today().strftime("%Y")
    return f"{prefijo}-{anio}-{prestamo['id']:04d}"


def _bloque_firmas(prestamo: dict, st: dict) -> Table:
    """Firmas: la de McKenna va estampada; la del prestamista queda en blanco.

    Firmar de antemano la parte de la empresa ahorra un ida y vuelta — el
    prestamista recibe el documento ya comprometido por McKenna y solo pone la
    suya. La firma se lee de `empresa.firma_representante()`; si no está, queda
    la línea en blanco y el PDF lo dice, en vez de fingir que está firmado.
    """
    from reportlab.platypus import Image as RLImage

    rep = _empresa.representante_legal()
    tercero = prestamo.get("tercero") or {}

    firma_mck: list = []
    if rep.get("firma_path"):
        try:
            firma_mck.append(RLImage(rep["firma_path"], width=4.2 * cm, height=3.2 * cm, kind="proportional"))
        except Exception:
            firma_mck = []
    if not firma_mck:
        firma_mck.append(Paragraph("<i>(firma pendiente)</i>", st["nota"]))
    firma_mck.append(HRFlowable(width=7 * cm, thickness=0.8, color=_INK, spaceBefore=2, spaceAfter=3))
    firma_mck.append(Paragraph(
        f"<b>{rep['nombre']}</b><br/>C.C. {rep['cedula']}<br/>{rep['cargo']} — {MCKENNA_RAZON}<br/>"
        f"<font size=7 color='#64748b'>NIT {MCKENNA_NIT}</font>", st["celda"]))

    firma_tercero = [
        Spacer(1, 46),
        HRFlowable(width=7 * cm, thickness=0.8, color=_INK, spaceBefore=2, spaceAfter=3),
        Paragraph(
            f"<b>{tercero.get('nombre', '')}</b><br/>C.C. {tercero.get('identificacion', '')}<br/>"
            f"El prestamista<br/><font size=7 color='#64748b'>Firme y devuelva una copia</font>",
            st["celda"]),
    ]
    t = Table([[firma_mck, firma_tercero]], colWidths=[8.4 * cm, 8.4 * cm], hAlign="LEFT")
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                           ("TOPPADDING", (0, 0), (-1, -1), 4)]))
    return t


def generar_pdf_contrato(prestamo: dict, destino: str | None = None) -> str:
    """Contrato de mutuo: una hoja que se entiende de un vistazo, y el
    cronograma completo en la segunda.

    Reescrito el 2026-09-11: la versión anterior eran seis cláusulas en lenguaje
    jurídico denso donde lo que el prestamista necesita saber —cuánto pone,
    cuánto recibe, cuándo y por qué le descuentan— quedaba enterrado. Lo legal
    sigue estando, pero después de lo que importa.
    """
    st = _estilos()
    tercero = prestamo.get("tercero") or {}
    r = prestamo["resumen"]
    rep = _empresa.representante_legal()
    numero = numero_documento(prestamo, "contrato")
    destino = destino or os.path.join(_CARPETA, nombre_archivo(prestamo, "contrato"))
    cuotas = prestamo.get("cuotas") or []
    primera = cuotas[0] if cuotas else {}
    ultima = cuotas[-1] if cuotas else {}

    doc = SimpleDocTemplate(
        destino, pagesize=letter,
        leftMargin=2.2 * cm, rightMargin=2.2 * cm, topMargin=1.8 * cm, bottomMargin=1.6 * cm,
        title=f"Contrato de mutuo {numero}", author=MCKENNA_RAZON,
    )
    story: list = []
    _encabezado(story, st, "CONTRATO DE PRÉSTAMO", numero)

    # ── Lo esencial, primero ──────────────────────────────────────────────
    story.append(Paragraph(
        f"<b>{tercero.get('nombre','')}</b> (C.C. {tercero.get('identificacion','')}) le presta a "
        f"<b>{MCKENNA_RAZON}</b> la suma de <b>{_cop(prestamo['capital'])}</b>, "
        f"entregada el {_fecha_larga(prestamo['fecha_desembolso'])}.", st["p"]))

    resumen = Table([
        [Paragraph("<b>Usted presta</b>", st["celda"]), Paragraph(_cop(prestamo["capital"]), st["der"])],
        [Paragraph("Gana en intereses", st["celda"]),
         Paragraph(f"{_cop(r['interes_total'])}  <font size=7 color='#64748b'>({_pct(r['rendimiento_bruto_pct'])} del capital)</font>", st["der"])],
        [Paragraph(f"Menos retención de ley ({_pct(prestamo['retencion_pct'] * 100, 0)})", st["celda"]),
         Paragraph(f"− {_cop(r['retencion_total'])}", st["der"])],
        [Paragraph("<b>Usted recibe en total</b>", st["celda"]),
         Paragraph(f"<b>{_cop(prestamo['capital'] + r['interes_total'] - r['retencion_total'])}</b>", st["der"])],
    ], colWidths=[10 * cm, 6.8 * cm], hAlign="LEFT")
    resumen.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, _LINEA),
        ("BACKGROUND", (0, 0), (-1, 0), _FONDO),
        ("BACKGROUND", (0, 3), (-1, 3), colors.HexColor("#ecfdf5")),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(resumen)
    story.append(Spacer(1, 10))

    # ── Cómo se paga ──────────────────────────────────────────────────────
    dia = prestamo.get("dia_pago")
    story.append(Paragraph("Cómo se le paga", st["h"]))
    story.append(Paragraph(
        f"En <b>{prestamo['plazo_meses']} cuotas mensuales</b>"
        + (f", el <b>día {dia} de cada mes</b>" if dia else "")
        + f", desde el {_fecha_larga(primera.get('fecha_vencimiento',''))} hasta el "
        f"{_fecha_larga(ultima.get('fecha_vencimiento',''))}. Cada cuota trae una parte de "
        f"su dinero de vuelta y una parte de intereses.", st["p"]))
    story.append(Paragraph(
        f"La primera cuota es de <b>{_cop(primera.get('cuota_girada', 0))}</b> y la última de "
        f"<b>{_cop(ultima.get('cuota_girada', 0))}</b>. El detalle mes a mes está en la página "
        "siguiente.", st["p"]))

    # El período de gracia cambia lo que recibe: tiene que estar dicho con
    # todas las letras, no solo reflejado en las fechas del cronograma.
    gracia = int(prestamo.get("meses_gracia") or 0)
    if gracia:
        plural = "es" if gracia > 1 else ""
        story.append(Paragraph(
            f"<b>Período de gracia:</b> se pactó{plural} <b>{gracia} mes{plural} de gracia</b> "
            f"desde la entrega del capital. Durante ese tiempo no se causan intereses y no hay "
            f"cuota que pagar: la primera vence el "
            f"{_fecha_larga(primera.get('fecha_vencimiento',''))}, un mes después de lo que "
            f"correspondería sin la gracia. El plazo no se recorta —siguen siendo "
            f"{prestamo['plazo_meses']} cuotas— y los valores de cada una son los mismos; lo que "
            f"cambia es que el mes de gracia no genera rendimiento.", st["p"]))

    # ── La tasa, explicada ────────────────────────────────────────────────
    story.append(Paragraph("Cuánto le rinde", st["h"]))
    story.append(Paragraph(
        f"La tasa pactada es del <b>{_pct(prestamo['tasa_ea'] * 100)} efectivo anual</b> "
        f"({_pct(r['tasa_mensual_pct'], 4)} mensual), calculada siempre sobre el saldo que McKenna "
        f"aún le debe. Por eso el total de intereses "
        f"({_pct(r['rendimiento_bruto_pct'])} del capital en {prestamo['plazo_meses']} meses) no es el doble "
        f"de la tasa anual: a medida que le devolvemos su dinero, el saldo sobre el que se calculan "
        "los intereses va bajando.", st["p"]))

    # ── La retención, explicada ───────────────────────────────────────────
    story.append(Paragraph(f"Por qué le descontamos el {_pct(prestamo['retencion_pct'] * 100, 0)}", st["h"]))
    story.append(_pie_retencion(prestamo, st))

    story.append(Paragraph("Si McKenna quiere pagar antes", st["h"]))
    story.append(Paragraph(
        "McKenna puede pagar anticipadamente, en todo o en parte, sin sanción. En ese caso los "
        "intereses se calculan solo hasta el día del pago.", st["p"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"Este documento es un contrato de mutuo con interés regido por el Código Civil y el Código "
        f"de Comercio colombianos. Las partes declaran que la tasa pactada no excede el límite de "
        f"usura certificado por la Superintendencia Financiera. Se firma en {MCKENNA_CIUDAD} "
        f"el {_fecha_larga(prestamo['fecha_desembolso'])}.", st["nota"]))
    story.append(Spacer(1, 14))
    story.append(_bloque_firmas(prestamo, st))
    if not rep.get("firma_path"):
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            "⚠️ Este documento salió sin la firma de McKenna. Solicítela antes de darlo por válido.",
            st["nota"]))

    # ── Anexo: el cronograma ──────────────────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("Cronograma de pagos", st["h"]))
    story.append(Paragraph(
        "«A girar» es lo que le llega a su cuenta cada mes, ya con la retención descontada. "
        "El saldo es lo que McKenna le debe justo antes de esa cuota.", st["nota"]))
    story.append(Spacer(1, 5))
    story.append(_tabla_cronograma(cuotas, st))
    return _guardar(doc, story, destino)


def generar_pdf_certificado(prestamo: dict, corte: str | None = None, destino: str | None = None) -> str:
    """Certificado de estado del préstamo a una fecha de corte."""
    st = _estilos()
    tercero = prestamo.get("tercero") or {}
    r = prestamo["resumen"]
    corte = str(corte or date.today().isoformat())[:10]
    numero = numero_documento(prestamo, "certificado")
    destino = destino or os.path.join(_CARPETA, nombre_archivo(prestamo, "certificado", corte))

    doc = SimpleDocTemplate(
        destino, pagesize=letter,
        leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.6 * cm, bottomMargin=1.6 * cm,
        title=f"Certificado de préstamo {numero}", author=MCKENNA_RAZON,
    )
    story: list = []
    _encabezado(story, st, "CERTIFICADO DE ESTADO DE PRÉSTAMO", f"{numero} · corte {_fecha_corta(corte)}")

    story.append(Paragraph(
        f"<b>{MCKENNA_RAZON}</b>, NIT {MCKENNA_NIT}, certifica que <b>{tercero.get('nombre', '')}</b>, "
        f"identificado(a) con documento <b>{tercero.get('identificacion', '')}</b>, es titular de un "
        f"préstamo otorgado a esta compañía el {_fecha_larga(prestamo['fecha_desembolso'])} por "
        f"<b>{_cop(prestamo['capital'])}</b>, pactado a {prestamo['plazo_meses']} cuotas mensuales "
        f"a la tasa de {_pct(prestamo['tasa_ea'] * 100)} efectivo anual, cuyo estado a la fecha de "
        "corte es el siguiente:", st["p"]))

    pagadas = [c for c in (prestamo.get("cuotas") or []) if c.get("estado") == "pagada"]
    filas = [
        ["Cuotas pagadas", f"{r['cuotas_pagadas']} de {r['cuotas']}"],
        ["Capital amortizado", _cop(r["capital_pagado"])],
        ["Capital pendiente", _cop(r["capital_pendiente"])],
        ["Intereses causados y pagados (brutos)", _cop(r["interes_pagado"])],
        [f"Retención practicada ({_pct(prestamo['retencion_pct'] * 100, 0)})", _cop(r["retencion_practicada"])],
        ["Intereses netos girados", _cop(r["interes_pagado"] - r["retencion_practicada"])],
    ]
    t = Table([[Paragraph(a, st["celda"]), Paragraph(b, st["der"])] for a, b in filas],
              colWidths=[9.2 * cm, 8.3 * cm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, _LINEA),
        ("BACKGROUND", (0, 0), (0, -1), _FONDO),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(t)

    story.append(Paragraph("Cuotas pagadas", st["h"]))
    if pagadas:
        story.append(_tabla_cronograma(pagadas, st, con_estado=True))
    else:
        story.append(Paragraph("Aún no se ha pagado ninguna cuota de este préstamo.", st["p"]))

    pendientes = [c for c in (prestamo.get("cuotas") or []) if c.get("estado") != "pagada"]
    if pendientes:
        story.append(Paragraph("Cuotas pendientes", st["h"]))
        story.append(_tabla_cronograma(pendientes, st, con_estado=True))

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"La retención en la fuente practicada corresponde a rendimientos financieros "
        f"({_pct(prestamo['retencion_pct'] * 100, 0)}, Art. 395 E.T.) y fue consignada a la DIAN. "
        "Este documento es informativo sobre el estado de la obligación; el certificado de "
        "retenciones para efectos de la declaración de renta se expide por separado, en los plazos "
        "de ley.", st["nota"]))
    story.append(Spacer(1, 16))
    story.append(Paragraph(
        f"Expedido en {MCKENNA_CIUDAD} el {_fecha_larga(corte)}.<br/><br/><br/>" + "_" * 34 +
        f"<br/><b>{MCKENNA_RAZON}</b><br/>NIT {MCKENNA_NIT}", st["celda"]))
    return _guardar(doc, story, destino)
