"""Expediente de un pago a proveedor: Libro Mayor + Alegra + DIAN en un solo PDF.

Nació para responderle al contador (William) su cuenta de cobro dejando claro
cómo se manejó el pago en los tres lugares donde vive:

1. **Cruce de las tres fuentes**: valor del servicio, ReteICA, girado y saldo,
   columna por columna, con el porqué de cada diferencia de forma.
2. **Libro Mayor de McKenna** — el asiento en partida doble con códigos PUC
   (el espejo fiel de la realidad).
3. **Alegra** — cómo quedó contabilizado allá: el documento soporte (gasto,
   retención y cuenta por pagar) y el comprobante de egreso que la cancela, y
   el efecto neto (igual al Libro Mayor: la cuenta por pagar queda en $0).
4. **DIAN** — el documento soporte transmitido, tal como dice su XML.
   Anexo: la representación gráfica del documento soporte.

**El ICA no va en el documento soporte**: el XML de la DIAN (DSMG2, verificado
el 2026-09-23) trae `PayableAmount` = valor total y ninguna retención; el
formato no la discrimina. McKenna gira lo libre pactado y asume el ReteICA
(8,66 ‰, consultoría), que el contador discrimina después. Por eso el ICA
aparece en el Libro Mayor (2368) y en Alegra (retención del documento), y la
columna DIAN muestra el valor total.

Alegra no expone por API el código contable de la retención ni el del banco:
se muestran con su nombre, sin inventar código. Solo lectura en los tres lados.
"""
from __future__ import annotations

import io
import re
from datetime import datetime

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.tools import comprobante_contable as cc_pdf
from app.tools import cotizacion_pdf as marca

_cop = cc_pdf._cop
_esc = cc_pdf._esc


# ── datos ────────────────────────────────────────────────────────────────


_ESTADOS_DIAN = {
    "STAMPED_AND_ACCEPTED": "Aceptado por la DIAN",
    "STAMPED_AND_ACCEPTED_WITH_OBSERVATIONS": "Aceptado por la DIAN (con notificaciones)",
    "STAMPED_AND_WAITING_RESPONSE": "Transmitido, esperando respuesta de la DIAN",
    "REJECTED": "Rechazado por la DIAN",
}


def estado_dian_legible(estado: str) -> str:
    return _ESTADOS_DIAN.get(estado or "", estado or "—")


def datos_dian(xml: bytes | None, bill: dict) -> dict:
    """Lo que dice el documento transmitido: el XML manda; el `stamp` de Alegra de respaldo."""
    stamp = bill.get("stamp") or {}
    out = {"valor": None, "retenciones": None, "fecha": bill.get("date") or "",
           "cuds": stamp.get("cude") or stamp.get("cufe") or "", "estado": stamp.get("legalStatus") or "",
           "qr": ""}
    m = re.search(r"QRCode:\s*(\S+)", stamp.get("barCodeContent") or "")
    if m:
        out["qr"] = m.group(1)
    if xml:
        x = xml.decode("utf-8", errors="replace")
        m = re.search(r"<cbc:PayableAmount[^>]*>([\d.]+)<", x)
        if m:
            out["valor"] = float(m.group(1))
        out["retenciones"] = sum(float(v) for v in re.findall(
            r"<cac:WithholdingTaxTotal>.*?<cbc:TaxAmount[^>]*>([\d.]+)<", x, re.S))
        m = re.search(r"<cbc:IssueDate>([^<]+)<", x)
        if m:
            out["fecha"] = m.group(1)
    if out["valor"] is None:
        m = re.search(r"ValTolDS:\s*([\d.]+)", stamp.get("barCodeContent") or "")
        out["valor"] = float(m.group(1)) if m else float(bill.get("total") or 0)
    return out


def datos_alegra(bill: dict) -> dict:
    """La contabilización en Alegra, reconstruida desde sus documentos (sin escribir nada)."""
    import requests

    from app.services import alegra as A

    H = A._alegra_headers()
    prov = bill.get("provider") or {}
    cxp = {"code": "", "name": "Cuentas por pagar a proveedores"}
    try:
        c = requests.get(f"{A._ALEGRA_BASE}/contacts/{prov.get('id')}", headers=H, timeout=20).json()
        d = ((c or {}).get("accounting") or {}).get("debtToPay") or {}
        cxp = {"code": d.get("code") or "", "name": d.get("name") or cxp["name"]}
    except Exception:
        pass
    gasto = []
    for cat in ((bill.get("purchases") or {}).get("categories") or []):
        code = ""
        try:
            code = requests.get(f"{A._ALEGRA_BASE}/categories/{cat.get('id')}", headers=H,
                                timeout=20).json().get("code") or ""
        except Exception:
            pass
        gasto.append({"code": code, "name": cat.get("name") or "", "valor": float(cat.get("total") or 0),
                      "detalle": cat.get("observations") or ""})
    pagos = []
    for p in bill.get("payments") or []:
        banco = ""
        try:
            banco = ((requests.get(f"{A._ALEGRA_BASE}/payments/{p.get('id')}", headers=H, timeout=20).json()
                      or {}).get("bankAccount") or {}).get("name") or ""
        except Exception:
            pass
        pagos.append({"id": p.get("id"), "numero": p.get("number") or p.get("id"), "fecha": p.get("date") or "",
                      "valor": float(p.get("amount") or 0), "banco": banco or "Banco",
                      "medio": {"transfer": "Transferencia", "cash": "Efectivo"}.get(p.get("paymentMethod"),
                                                                                    p.get("paymentMethod") or "")})
    rets = [{"name": r.get("name") or "Retención", "valor": float(r.get("amount") or 0), "tipo": r.get("type") or ""}
            for r in bill.get("retentions") or []]
    return {"numero": (bill.get("numberTemplate") or {}).get("fullNumber") or "", "fecha": bill.get("date") or "",
            "total": float(bill.get("total") or 0), "pagado": float(bill.get("totalPaid") or 0),
            "saldo": float(bill.get("balance") or 0), "estado": bill.get("status") or "",
            "proveedor": prov.get("name") or "", "cxp": cxp, "gasto": gasto, "retenciones": rets, "pagos": pagos}


# ── documento ────────────────────────────────────────────────────────────


def efecto_neto_alegra(al: dict, mov: dict | None, st: dict, ancho: float) -> list:
    """Lo que queda en Alegra después del documento y su egreso: el mismo asiento del Libro Mayor.

    Alegra registra todo documento soporte en dos pasos (causación contra la
    cuenta por pagar al proveedor, y el egreso que la cancela), aunque se pague
    en el acto. La cuenta por pagar solo hace de puente: si el pago es del mismo
    día, se abre y se cierra ese día y no queda deuda. Sin este cuadro, quien lee
    la página ve la 22050501 y cree que quedó debiéndose algo.
    """
    ret = sum(r["valor"] for r in al["retenciones"])
    girado = sum(p["valor"] for p in al["pagos"])
    causado_cxp = al["total"] - ret
    saldo_cxp = causado_cxp - girado
    fechas = sorted({p["fecha"] for p in al["pagos"] if p.get("fecha")})
    mismo_dia = bool(fechas) and fechas == [al["fecha"]]
    cuando = "el mismo día" if mismo_dia else ("el " + ", ".join(fechas) if fechas else "")
    bancos = sorted({p["banco"] for p in al["pagos"]}) or ["Banco"]
    lineas = (
        [{"codigo": g["code"], "cuenta": g["name"], "tercero": al["proveedor"], "debito": g["valor"]}
         for g in al["gasto"]]
        + [{"codigo": "", "cuenta": "Retención de industria y comercio por pagar", "detalle": r["name"],
            "tercero": al["proveedor"], "credito": r["valor"]} for r in al["retenciones"]]
        + [{"codigo": "", "cuenta": " / ".join(bancos), "detalle": "Salida de bancos", "credito": girado}]
    )
    if abs(saldo_cxp) > 0.5:   # pago parcial: la deuda que queda sí es un saldo real
        lineas.append({"codigo": al["cxp"]["code"], "cuenta": al["cxp"]["name"], "tercero": al["proveedor"],
                       "detalle": "Saldo pendiente con el proveedor", "credito": saldo_cxp})
    out = [Paragraph("Efecto neto en Alegra", st["fuerte"]), Spacer(1, 3),
           cc_pdf.tabla_asiento(lineas, st, ancho, rotulo_codigo="CUENTA"), Spacer(1, 4)]
    puente = (
        f"La cuenta {al['cxp']['code']} {al['cxp']['name']} solo hace de puente: se causó por "
        f"{_cop(causado_cxp)} con el documento {al['numero']} y se canceló {cuando} con el egreso "
        f"por {_cop(girado)}. <b>Saldo {_cop(saldo_cxp)}: no quedó ninguna deuda con el proveedor.</b> "
        if abs(saldo_cxp) <= 0.5 else
        f"Queda un saldo de {_cop(saldo_cxp)} en la cuenta {al['cxp']['code']} por pagar al proveedor. "
    )
    igual = ""
    if mov:
        r = cc_pdf.resumen_asiento(mov)
        if abs(r["causado"] - al["total"]) <= 1 and abs(r["retenido"] - ret) <= 1 and abs(r["pagado"] - girado) <= 1:
            igual = f"El resultado es el mismo del asiento {mov['id']} de nuestro Libro Mayor, que lo registra en un solo paso. "
    out.append(Paragraph(
        puente + igual + "Alegra no publica en su API el código contable de la retención ni del banco: "
        "se muestran con su nombre.", st["nota"]))
    return out


def _seccion(n: int, titulo: str, st: dict) -> Paragraph:
    return Paragraph(f"{n}. {_esc(titulo)}", st["seccion"])


def _periodo_legible(periodo: str) -> str:
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
             "septiembre", "octubre", "noviembre", "diciembre"]
    try:
        a, m = periodo.split("-")
        return f"{meses[int(m) - 1]} de {a}"
    except Exception:
        return periodo or ""


def generar(*, cobro: dict, solicitud: dict, doc: dict, bill: dict, xml: bytes | None) -> bytes:
    """PDF del expediente completo, con la representación del documento soporte como anexo."""
    import app.services.contabilidad_core as cc
    from app.services import empresa

    mov = cc.obtener_movimiento(int(solicitud["movimiento_id"])) if solicitud.get("movimiento_id") else None
    al = datos_alegra(bill)
    di = datos_dian(xml, bill)
    lib = cc_pdf.resumen_asiento(mov) if mov else None

    st = cc_pdf.estilos()
    buf = io.BytesIO()
    periodo = _periodo_legible(cobro.get("periodo") or "")
    pdf = SimpleDocTemplate(buf, pagesize=letter, leftMargin=1.8 * cm, rightMargin=1.8 * cm,
                            topMargin=1.4 * cm, bottomMargin=1.4 * cm,
                            title=f"Soporte del pago de honorarios — {periodo}", author=empresa.razon_social())
    ancho = letter[0] - 3.6 * cm
    story = cc_pdf.cabecera("SOPORTE DEL PAGO DE HONORARIOS", [
        f"Período <b>{_esc(periodo)}</b>  ·  Pagado el <b>{_esc(str(solicitud.get('pagado_at') or '')[:10])}</b>",
        f"{_esc(empresa.razon_social())}  ·  NIT {_esc(empresa.nit())}",
    ], st, ancho)

    t = (mov or {}).get("tercero") or {}
    story.append(cc_pdf.tabla_datos([
        ("PROVEEDOR", f"{t.get('nombre') or al['proveedor']}"
                      + (f"  ·  CC {t.get('identificacion')}" if t.get("identificacion") else "")),
        ("CUENTA DE COBRO", f"{cobro.get('subject') or ''} — recibida el {cobro.get('email_date') or ''}, "
                            f"por {_cop(cobro.get('monto'))}"),
        ("REFERENCIAS", f"Libro Mayor: asiento {solicitud.get('movimiento_id') or '—'} (solicitud de pago "
                        f"#{solicitud.get('id')})  ·  Alegra: {al['numero']}"
                        + "".join(f" + egreso N.º {p['numero']}" for p in al["pagos"])
                        + f"  ·  DIAN: documento soporte {al['numero'] or doc.get('numero') or ''}"),
    ], st, ancho))
    story.append(Spacer(1, 12))

    # 1. cruce
    ret_al = sum(r["valor"] for r in al["retenciones"])
    girado_al = sum(p["valor"] for p in al["pagos"])
    story.append(_seccion(1, "Cruce de las tres fuentes", st))
    col = [5.2 * cm, 0, 0, 0]
    col[1] = col[2] = col[3] = (ancho - col[0]) / 3

    def fila(nombre, a, b, c, fuerte=False):
        e = st["num_fuerte"] if fuerte else st["num"]
        return [Paragraph(nombre, st["fuerte"] if fuerte else st["cuerpo"]),
                Paragraph(a, e), Paragraph(b, e), Paragraph(c, e)]

    dian_ret = ("No se discrimina*" if not di["retenciones"] else _cop(di["retenciones"]))
    filas = [
        [Paragraph("", st["cab"]), Paragraph("LIBRO MAYOR McKENNA", st["cab_der"]),
         Paragraph("ALEGRA", st["cab_der"]), Paragraph("DIAN (documento soporte)", st["cab_der"])],
        fila("Valor del servicio", _cop(lib["causado"]) if lib else "—", _cop(al["total"]), _cop(di["valor"])),
        fila("ReteICA 8,66 ‰ asumido por McKenna", _cop(lib["retenido"]) if lib else "—", _cop(ret_al), dian_ret),
        fila("Valor girado al proveedor", _cop(lib["pagado"]) if lib else "—", _cop(girado_al), "No aplica", True),
        fila("Saldo pendiente", _cop(lib["por_pagar"]) if lib else "—", _cop(al["saldo"]), "—"),
        fila("Estado", "Asiento confirmado" if mov else "—",
             "Cerrado" if al["estado"] == "closed" else (al["estado"] or "—"),
             "Aceptado" if "ACCEPTED" in (di["estado"] or "") else (di["estado"] or "—")),
    ]
    tcr = Table(filas, colWidths=col)
    tcr.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), marca.ACENTO_OSCURO),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, marca.BORDE),
        ("BACKGROUND", (0, 3), (-1, 3), marca.TINTE),
    ]))
    story.append(tcr)
    coincide = bool(lib) and all(abs(a - b) <= 1 for a, b in (
        (lib["causado"], al["total"]), (lib["causado"], di["valor"]),
        (lib["retenido"], ret_al), (lib["pagado"], girado_al)))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        ("Resultado: las tres fuentes coinciden (mismo valor del servicio, misma retención y mismo giro)."
         if coincide else "Atención: hay diferencias entre las fuentes: revisar antes de dar el pago por soportado."),
        st["fuerte"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"* Es un solo pago. Al proveedor se le giraron <b>{_cop(girado_al or (lib or {}).get('pagado'))}</b> "
        f"libres; McKenna asume el ReteICA de <b>{_cop(ret_al)}</b> (8,66 por mil, consultoría en Bogotá) y "
        f"por eso el servicio vale <b>{_cop(al['total'])}</b>. El documento soporte electrónico no tiene "
        "campo para discriminar el ICA: se transmite por el valor total y el ICA queda registrado en el "
        "Libro Mayor (cuenta 2368) y en Alegra (retención del documento), de donde se declara.",
        st["nota"]))
    story.append(Spacer(1, 12))

    # 2. Libro Mayor
    if mov:
        story.append(_seccion(2, f"Libro Mayor de McKenna — asiento N.º {mov['id']} del {mov['fecha']}", st))
        story.append(cc_pdf.tabla_asiento(cc_pdf.lineas_libro(mov), st, ancho))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            "Partida doble sobre el Plan Único de Cuentas (Decreto 2650 de 1993). El pago se registra en un "
            "solo asiento: se causa el gasto, se reconoce la retención por pagar y sale el dinero del banco.",
            st["nota"]))

    story.append(PageBreak())

    # 3. Alegra
    story.append(_seccion(3, "Alegra — cómo quedó contabilizado", st))
    rets_lineas = [{"codigo": "", "cuenta": "Retención de industria y comercio por pagar", "detalle": r["name"],
                    "tercero": al["proveedor"], "credito": r["valor"]} for r in al["retenciones"]]
    lineas_ds = ([{"codigo": g["code"], "cuenta": g["name"], "tercero": al["proveedor"],
                   "debito": g["valor"]} for g in al["gasto"]]
                 + rets_lineas
                 + [{"codigo": al["cxp"]["code"], "cuenta": al["cxp"]["name"], "tercero": al["proveedor"],
                     "credito": al["total"] - ret_al}])
    story.append(Paragraph(f"Documento soporte {al['numero']} — {al['fecha']}", st["fuerte"]))
    story.append(Spacer(1, 3))
    story.append(cc_pdf.tabla_asiento(lineas_ds, st, ancho, rotulo_codigo="CUENTA"))
    for p in al["pagos"]:
        story.append(Spacer(1, 10))
        story.append(Paragraph(f"Comprobante de egreso N.º {p['numero']} — {p['fecha']} · {p['medio']}",
                               st["fuerte"]))
        story.append(Spacer(1, 3))
        story.append(cc_pdf.tabla_asiento([
            {"codigo": al["cxp"]["code"], "cuenta": al["cxp"]["name"], "tercero": al["proveedor"],
             "detalle": f"Pago aplicado al documento {al['numero']}", "debito": p["valor"]},
            {"codigo": "", "cuenta": p["banco"], "detalle": "Salida de bancos", "credito": p["valor"]},
        ], st, ancho, rotulo_codigo="CUENTA"))
    story.append(Spacer(1, 8))
    story += efecto_neto_alegra(al, mov, st, ancho)
    story.append(Spacer(1, 8))

    # 4. DIAN
    story.append(_seccion(4, "DIAN — documento soporte electrónico", st))
    story.append(cc_pdf.tabla_datos([
        ("DOCUMENTO", f"{al['numero'] or doc.get('numero') or ''} — expedido el {di['fecha']}"),
        ("VALOR", f"{_cop(di['valor'])} (valor total; el formato no discrimina retenciones)"),
        ("ESTADO", estado_dian_legible(di["estado"])),
        ("CUDS", di["cuds"]),
        ("CONSULTA", di["qr"] or "catalogo-vpfe.dian.gov.co"),
    ], st, ancho))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Anexos: representación gráfica del documento soporte (página siguiente) y el XML "
                           "firmado, adjunto al correo.", st["nota"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Expediente generado el {datetime.now():%Y-%m-%d %H:%M} desde el Libro Mayor de "
        f"{_esc(empresa.razon_social())}, Alegra y el XML transmitido a la DIAN. Los números de cuenta bancaria "
        "se muestran enmascarados.", st["pie"]))
    pdf.build(story)

    # Anexo: el documento soporte tal como lo recibió la DIAN.
    from PyPDF2 import PdfReader, PdfWriter

    from app.services.cuenta_cobro_contador import representacion_pdf

    w = PdfWriter()
    for fuente in (buf.getvalue(), representacion_pdf(bill, dian=di)):
        for page in PdfReader(io.BytesIO(fuente)).pages:
            w.add_page(page)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()
