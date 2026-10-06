"""Comprobante de egreso imprimible de una solicitud de pago aprobada.

Lo que se entrega o se archiva cuando alguien pregunta «¿y este pago?»: quién
recibe, cuánto se causó, qué se retuvo y cuánto se giró, el asiento tal como
quedó en el Libro Mayor y cada paso del ciclo (solicitó, aprobó, montó en
el banco, confirmó el giro) con su fecha, sin nombres de quién lo hizo. Si ya se adjuntó el soporte del
banco (la captura o el PDF de Sucursal Negocios), va anexo en la página
siguiente: el egreso sin la prueba de que la plata salió queda a medias.

Sale de una solicitud con asiento (aprobada, en el banco o girada): antes de
aprobar no hay egreso que imprimir. Misma identidad y helpers que
`comprobante_contable.py`; solo lectura.
"""
from __future__ import annotations

import io
import os
from datetime import datetime

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.tools import comprobante_contable as cc_pdf
from app.tools import cotizacion_pdf as marca

_cop = cc_pdf._cop
_esc = cc_pdf._esc

_ESTADO = {
    "aprobada": "APROBADA — pendiente de girar en el banco",
    "en_banco": "MONTADA EN EL BANCO — pendiente del segundo visto bueno",
    "pagada": "GIRADA — con comprobante del banco",
}


def _fecha(ts: str | None) -> str:
    return (ts or "")[:16] or "—"


def _cant(n) -> str:
    try:
        v = float(n)
    except (TypeError, ValueError):
        return str(n or "")
    return (f"{v:,.0f}" if v == int(v) else f"{v:,.2f}").replace(",", "X").replace(".", ",").replace("X", ".")


_RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _imagenes_soporte(sol: dict) -> list[bytes]:
    """El soporte del banco como imágenes PNG/JPG: la captura tal cual, o cada página del PDF."""
    rel = sol.get("comprobante_archivo") or ""
    ruta = os.path.join(_RAIZ, rel)
    if not rel or not os.path.exists(ruta):
        return []
    with open(ruta, "rb") as fh:
        datos = fh.read()
    if not datos.startswith(b"%PDF"):
        return [datos]
    paginas = []
    for n in range(1, 6):          # un soporte del banco no pasa de un par de páginas
        png = cc_pdf.pdf_a_png(datos, pagina=n)
        if not png:
            break
        paginas.append(png)
    return paginas


def _anexo_soporte(sol: dict, st: dict, ancho: float, alto: float) -> list:
    """Página(s) con el soporte de pago del banco, escalado para caber sin deformarse."""
    from PIL import Image as PILImage

    out = []
    for i, img in enumerate(_imagenes_soporte(sol)):
        try:
            w, h = PILImage.open(io.BytesIO(img)).size
        except Exception:
            continue
        esc = min(ancho / w, alto / h)
        out += [PageBreak(),
                Paragraph("Soporte de pago del banco" + (f" ({i + 1})" if i else ""), st["seccion"]),
                Paragraph(_esc(f"{sol.get('comprobante_nombre') or ''}  ·  confirmado {_fecha(sol.get('pagado_at'))}"
                               + (f"  ·  ref. banco {sol['montado_ref']}" if sol.get("montado_ref") else "")), st["nota"]),
                Spacer(1, 8), Image(io.BytesIO(img), width=w * esc, height=h * esc)]
    return out


def generar_pdf(sol: dict) -> bytes:
    """PDF del comprobante de egreso de la solicitud `sol` (dict de `pagos_wizard.obtener`)."""
    import app.services.contabilidad_core as cc
    from app.services import empresa

    if not sol.get("movimiento_id"):
        raise ValueError("La solicitud todavía no está aprobada: no tiene asiento.")
    mov = cc.obtener_movimiento(int(sol["movimiento_id"]))
    if not mov:
        raise ValueError(f"No existe el asiento {sol['movimiento_id']}")

    st = cc_pdf.estilos()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=1.8 * cm, rightMargin=1.8 * cm,
                            topMargin=1.2 * cm, bottomMargin=1.0 * cm,
                            title=f"Comprobante de egreso {sol['id']}", author=empresa.razon_social())
    ancho = letter[0] - 3.6 * cm
    story = cc_pdf.cabecera("COMPROBANTE DE EGRESO", [
        f"Solicitud de pago N.º <b>{sol['id']}</b>  ·  Fecha <b>{_esc(sol.get('fecha') or mov['fecha'])}</b>",
        f"Asiento N.º {mov['id']}" + (f"  ·  Alegra #{_esc(sol['alegra_journal_id'])}" if sol.get("alegra_journal_id") else ""),
        f"{_esc(empresa.razon_social())}  ·  NIT {_esc(empresa.nit())}",
    ], st, ancho)

    t = sol.get("tercero") or mov.get("tercero") or {}
    datos = [
        ("PAGADO A", f"{t.get('nombre', '') or '—'}" + (f"  ·  CC/NIT {t.get('identificacion')}" if t.get("identificacion") else "")),
        ("CONCEPTO", cc_pdf._enmascarar(sol.get("concepto") or mov.get("concepto", ""))),
        ("CATEGORÍA", sol.get("categoria_label") or sol.get("categoria") or "—"),
        ("ESTADO", _ESTADO.get(sol.get("estado", ""), sol.get("estado", ""))),
    ]
    soporte = []
    if sol.get("factura_numero"):
        soporte.append(f"Factura {sol['factura_numero']}")
    ds = sol.get("doc_soporte") or {}
    if ds.get("numero") and ds.get("estado") == "success":
        soporte.append(f"Documento soporte {ds['numero']}")
    if sol.get("referencia"):
        soporte.append(f"Ref. {sol['referencia']}")
    if sol.get("montado_ref"):
        soporte.append(f"Banco {sol['montado_ref']}")
    if soporte:
        datos.append(("SOPORTE", "  ·  ".join(soporte)))
    if ds.get("cuds") and ds.get("estado") == "success":
        datos.append(("CUDS", ds["cuds"]))
    story += [cc_pdf.tabla_datos(datos, st, ancho), Spacer(1, 14)]

    # Las cifras del pago, con el valor girado resaltado: es lo que salió del banco.
    cifras = [("Valor del pago", sol.get("monto"))]
    if float(sol.get("retencion") or 0):
        cifras.append(("Retención en la fuente", -float(sol["retencion"])))
    if float(sol.get("retencion_ica") or 0):
        cifras.append(("Retención de ICA", -float(sol["retencion_ica"])))
    if float(sol.get("impuesto_asumido") or 0):
        cifras.append(("Impuesto asumido por la empresa", float(sol["impuesto_asumido"])))
    if float(sol.get("cruce_anticipo") or 0):
        cifras.append(("Cruce con anticipo (133005)", -float(sol["cruce_anticipo"])))
    if float(sol.get("cruce_cxp") or 0):
        cifras.append(("Cruce con cuenta por pagar (2205)", float(sol["cruce_cxp"])))
    cifras.append(("VALOR GIRADO", sol.get("girado")))
    if float(sol.get("gmf") or 0):
        cifras.append(("4x1000 (gasto aparte)", float(sol["gmf"])))
    n_girado = len(cifras) - (2 if float(sol.get("gmf") or 0) else 1)
    tc = Table([[Paragraph(_esc(k), st["fuerte" if i == n_girado else "cuerpo"]),
                 Paragraph(_cop(v), st["num_fuerte" if i == n_girado else "num"])]
                for i, (k, v) in enumerate(cifras)], colWidths=[6.2 * cm, 3.4 * cm], hAlign="RIGHT")
    tc.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -2), 0.4, marca.BORDE),
                            ("BACKGROUND", (0, n_girado), (-1, n_girado), marca.TINTE),
                            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [tc, Spacer(1, 14)]

    items = sol.get("items") or []
    if items:
        filas = [[Paragraph("SKU", st["cab"]), Paragraph("PRODUCTO", st["cab"]),
                  Paragraph("CANT.", st["cab_der"]), Paragraph("PRECIO", st["cab_der"])]]
        for it in items:
            filas.append([Paragraph(_esc(it.get("sku") or "—"), st["codigo"]),
                          Paragraph(_esc(it.get("nombre") or ""), st["cuerpo"]),
                          Paragraph(_esc(f"{_cant(it.get('cantidad'))} {it.get('unidad') or ''}".strip()), st["num"]),
                          Paragraph(_cop(it.get("precio")), st["num"])])
        ti = Table(filas, colWidths=[3.4 * cm, ancho - 8.6 * cm, 2.4 * cm, 2.8 * cm], repeatRows=1)
        ti.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), marca.ACENTO_OSCURO),
                                ("LINEBELOW", (0, 1), (-1, -1), 0.4, marca.BORDE),
                                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        story += [Paragraph("Productos", st["seccion"]), ti, Spacer(1, 12)]

    story += [Paragraph("Asiento en el Libro Mayor", st["seccion"]),
              cc_pdf.tabla_asiento(cc_pdf.lineas_libro(mov), st, ancho), Spacer(1, 16)]

    # El ciclo del pago, paso por paso con su fecha. Sin nombres: el egreso sale
    # de la empresa y no tiene por qué decir qué socio firmó cada paso.
    pasos = [("Solicitado", sol.get("created_at")), ("Aprobado", sol.get("aprobada_at")),
             ("Montado en el banco", sol.get("montado_at")), ("Giro confirmado", sol.get("pagado_at"))]
    celdas = [[Paragraph(_esc(paso), st["fuerte"]), Paragraph(_esc(_fecha(ts)), st["ruta"])]
              for paso, ts in pasos]
    w = ancho / 4
    tf = Table([[c for c in celdas]], colWidths=[w] * 4)
    tf.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.8, marca.TINTA),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                            ("TOPPADDING", (0, 0), (-1, -1), 4)]))
    story += [tf, Spacer(1, 8)]
    story.append(Paragraph(
        f"Comprobante generado desde Solicitudes de pago de {_esc(empresa.razon_social())} el "
        f"{datetime.now():%Y-%m-%d %H:%M}. El asiento es el registrado en el Libro Mayor (partida doble, "
        "PUC — Decreto 2650 de 1993). Los números de cuenta bancaria se muestran enmascarados.", st["pie"]))
    anexo = _anexo_soporte(sol, st, ancho, letter[1] - 3.0 * cm - 2.2 * cm)
    if anexo:
        story += anexo
    elif sol.get("estado") == "pagada":
        story.append(Paragraph("Sin soporte del banco adjunto.", st["nota"]))
    else:
        story.append(Paragraph("El soporte de pago del banco se anexa cuando se confirme el giro.", st["nota"]))
    doc.build(story)
    return buf.getvalue()
