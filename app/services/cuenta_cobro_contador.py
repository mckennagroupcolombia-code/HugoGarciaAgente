"""Respuesta automática a la cuenta de cobro del contador (William Novoa).

William manda su cuenta de cobro por correo, normalmente en los primeros días
del mes siguiente al que cobra. Cada cuenta de cobro nueva sigue uno de dos
caminos:

* **Ya se le pagó** (solicitud de pago en estado `pagada` y su documento
  soporte transmitido a la DIAN): se le responde EN EL MISMO HILO con el
  expediente del pago en un solo PDF (`app/tools/expediente_pago.py`: cruce
  Libro Mayor / Alegra / DIAN, el asiento con códigos PUC, la contabilización
  en Alegra y, como anexo, el documento soporte) más el XML firmado; las dos
  primeras páginas van también como imagen en el cuerpo del correo.
  Vale también para pagos ANTICIPADOS (hasta `_DIAS_ANTICIPO` días antes).

Disparo: `scripts/cuenta_cobro_contador_cron.py` cada 5 min (chequeo de
encabezados; solo procesa si llegó un correo nuevo de William) y el cron
diario `recordatorio_pago_contador_cron.py` como red de seguridad.
* **No se le ha pagado**: ticket a Jenniffer (`jerry`) para que solicite el
  pago por Contabilidad → Solicitudes de pago, con la cuenta de cobro adjunta y
  un borrador ya montado. El caso queda abierto: cuando el pago se confirma y el
  documento soporte sale, la siguiente corrida le responde a William.

Un pago confirmado cuyo documento soporte aún es BORRADOR (nadie pulsó «Emitir
a la DIAN») no se responde todavía: mandarle una confirmación sin soporte es
justo lo que esta automatización evita. Se espera y se deja el aviso en el log.

**Por qué el PDF lo arma McKenna:** la API de Alegra no entrega el PDF de un
documento soporte (`GET /bills/{id}?fields=pdf` no trae nada, verificado el
2026-09-23 contra DSMG2); sí entrega el XML firmado (`fields=xml`), que es el
documento legal. El PDF es su representación gráfica con número, CUDS y QR de
la DIAN, sacados del mismo `stamp` de Alegra.

Estado (idempotencia por Message-ID): `app/data/contador_cobro_respuestas.json`.

Variables:
  CONTADOR_COBRO_RESPUESTA_ACTIVO=0   no envía correos ni crea tickets (solo informa)
  CONTADOR_COBRO_RESPUESTA_DESDE      solo atiende cuentas de cobro recibidas desde esa
                                      fecha (default 2026-09-23, el día que nació: las
                                      anteriores ya se atendieron a mano)
  CONTADOR_COBRO_ASIGNADO             usuario del ticket (default `jerry`, Jenniffer)
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
ESTADO_PATH = _REPO / "app" / "data" / "contador_cobro_respuestas.json"
_TICKETS_UPLOADS = _REPO / "uploads" / "tickets"
_LOCK_PATH = _REPO / "app" / "data" / ".contador_cobro.lock"
_DIAS_ANTICIPO = 60


def activo() -> bool:
    return (os.getenv("CONTADOR_COBRO_RESPUESTA_ACTIVO", "1") or "1").strip() not in ("0", "false", "False")


def _desde() -> str:
    return (os.getenv("CONTADOR_COBRO_RESPUESTA_DESDE") or "2026-09-23").strip()


def _asignado_username() -> str:
    return (os.getenv("CONTADOR_COBRO_ASIGNADO") or "jerry").strip()


# ── estado ────────────────────────────────────────────────────────────────


def _leer_estado() -> dict:
    try:
        data = json.loads(ESTADO_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("cobros", {})
            data.setdefault("vistos", [])
            return data
    except Exception:
        pass
    return {"cobros": {}, "vistos": []}


def _guardar_estado(data: dict) -> None:
    ESTADO_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, ESTADO_PATH)


# ── el contador y sus pagos ───────────────────────────────────────────────


def tercero_contador() -> dict | None:
    """El contador en el Libro Mayor. No se crea solo (ver recordatorio_pago_contador_cron)."""
    import app.services.contabilidad_core as cc

    for t in cc.listar_terceros():
        n = (t.get("nombre") or "").lower()
        if "novoa" in n and "william" in n:
            return t
    return None


def _solicitudes_del_contador(tercero_id: int) -> list[dict]:
    from app.services import pagos_wizard as pw

    pw._ensure()
    with pw._conn() as con:
        rows = con.execute(
            "SELECT id, estado, monto, fecha, periodo, origen_ref, categoria, cuenta_debito,"
            " medio_pago_id, pagado_at, movimiento_id, retencion, retencion_ica FROM cc_solicitudes_pago"
            " WHERE tercero_id=? AND COALESCE(es_plantilla,0)=0 ORDER BY id",
            (int(tercero_id),),
        ).fetchall()
    return [dict(r) for r in rows]


def valores_del_pago(s: dict) -> tuple[float, float]:
    """(bruto, girado) de una solicitud: lo que dice el documento soporte y lo que salió del banco.

    Con William son el MISMO pago visto de dos lados: se le giran $1.200.000
    libres y el documento soporte sale por $1.210.483 porque McKenna asume el
    ReteICA (8,66 ‰ de consultoría, que él discrimina después). Su cuenta de
    cobro puede traer cualquiera de las dos cifras.
    """
    bruto = float(s.get("monto") or 0)
    return bruto, bruto - float(s.get("retencion") or 0) - float(s.get("retencion_ica") or 0)


def _mismo_valor(cobro: dict, s: dict) -> bool:
    monto = float(cobro.get("monto") or 0)
    return bool(monto) and any(abs(v - monto) <= 1 for v in valores_del_pago(s))


def buscar_pago(cobro: dict, solicitudes: list[dict], usadas: set[int]) -> dict | None:
    """La solicitud PAGADA que corresponde a esta cuenta de cobro, o None.

    En orden de firmeza: mismo período declarado, el borrador que montó este
    mismo flujo (`origen_ref contador:<periodo>`), y por último el mismo valor
    (±$1, bruto o girado: ver `valores_del_pago`) pagado desde `_DIAS_ANTICIPO` días antes de recibir la cuenta de cobro
    (pagos anticipados) o después. Una
    solicitud ya usada para otra cuenta de cobro no se reusa: dos meses con el
    mismo valor no pueden quedar confirmados con un solo pago.
    """
    periodo = cobro.get("periodo") or ""
    pagadas = [s for s in solicitudes if s["estado"] == "pagada" and int(s["id"]) not in usadas]
    for s in pagadas:
        if periodo and (s.get("periodo") == periodo or s.get("origen_ref") == f"contador:{periodo}"):
            return s
    monto = float(cobro.get("monto") or 0)
    # Hasta 60 días antes de la cuenta de cobro: a William a veces se le paga
    # ANTICIPADO (el de 1.210.483 salió el 21-sep, antes de que él cobrara), y
    # esa cuenta de cobro llega semanas después del pago.
    try:
        piso = (datetime.strptime(cobro.get("email_date") or "", "%Y-%m-%d")
                - timedelta(days=_DIAS_ANTICIPO)).strftime("%Y-%m-%d")
    except ValueError:
        piso = ""
    for s in pagadas:
        if s.get("periodo") and s.get("periodo") != periodo:
            continue   # pertenece a otro mes, aunque valga lo mismo
        fecha_pago = str(s.get("pagado_at") or s.get("fecha") or "")[:10]
        if _mismo_valor(cobro, s) and fecha_pago >= piso:
            return s
    return None


def _en_curso(cobro: dict, solicitudes: list[dict]) -> dict | None:
    """Una solicitud sin pagar todavía para este período (borrador, pendiente, aprobada, en banco)."""
    periodo = cobro.get("periodo") or ""
    for s in solicitudes:
        if s["estado"] in ("pagada", "rechazada", "anulada"):
            continue
        if periodo and (s.get("periodo") == periodo or s.get("origen_ref") == f"contador:{periodo}"):
            return s
    return None


# ── documento soporte ─────────────────────────────────────────────────────


def _documento_emitido(solicitud_id: int) -> dict | None:
    from app.services import doc_soporte_pagos as ds

    doc = ds.obtener_por_solicitud(int(solicitud_id))
    if doc and doc.get("estado") == "success" and doc.get("alegra_id"):
        return doc
    return None


def _bill_alegra(alegra_id: str) -> tuple[dict, bytes | None]:
    """El documento en Alegra y su XML firmado (None si no se pudo bajar)."""
    import requests

    from app.services import alegra as A

    r = requests.get(f"{A._ALEGRA_BASE}/bills/{alegra_id}", headers=A._alegra_headers(),
                     params={"fields": "xml"}, timeout=20)
    r.raise_for_status()
    bill = r.json() or {}
    xml = None
    url = bill.get("xml")
    if url:
        x = requests.get(url, timeout=30)   # URL firmada de S3: sin headers de Alegra
        if x.status_code == 200 and x.content.lstrip().startswith(b"<?xml"):
            xml = x.content
    return bill, xml


def _cop(n) -> str:
    v = round(float(n or 0))
    return ("-" if v < 0 else "") + "$" + f"{abs(v):,}".replace(",", ".")


def representacion_pdf(bill: dict, dian: dict | None = None) -> bytes:
    """Representación gráfica del documento soporte: datos, valores, CUDS y QR de la DIAN.

    Con `dian` (de `expediente_pago.datos_dian`, leído del XML transmitido) muestra
    SOLO lo que dice el documento: el valor total, sin retenciones ni pagos, que
    viven en Alegra y en el Libro Mayor. El formato del documento soporte no
    discrimina el ICA.
    """
    from io import BytesIO

    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import cm
    from reportlab.pdfgen import canvas

    from app.services import empresa

    nt = bill.get("numberTemplate") or {}
    numero = nt.get("fullNumber") or f"{nt.get('prefix', '')}{nt.get('number', '')}"
    stamp = bill.get("stamp") or {}
    cuds = stamp.get("cude") or stamp.get("cufe") or ""
    prov = bill.get("provider") or {}
    compras = ((bill.get("purchases") or {}).get("categories") or []) + ((bill.get("purchases") or {}).get("items") or [])
    rets = bill.get("retentions") or []
    pagos = bill.get("payments") or []
    total = float(bill.get("total") or 0)
    retenido = sum(float(x.get("amount") or 0) for x in rets)
    qr_url = ""
    m = re.search(r"QRCode:\s*(\S+)", stamp.get("barCodeContent") or "")
    if m:
        qr_url = m.group(1)

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    W, H = letter
    x0, y = 2 * cm, H - 2.2 * cm

    c.setFont("Helvetica-Bold", 13)
    c.drawString(x0, y, "DOCUMENTO SOPORTE EN ADQUISICIONES")
    y -= 14
    c.setFont("Helvetica", 9)
    c.drawString(x0, y, "efectuadas a sujetos no obligados a expedir factura (Res. DIAN 000167 de 2021)")
    c.setFont("Helvetica-Bold", 16)
    c.drawRightString(W - 2 * cm, H - 2.2 * cm, numero)
    c.setFont("Helvetica", 9)
    c.drawRightString(W - 2 * cm, H - 2.2 * cm - 14, f"Fecha: {bill.get('date', '')}")

    y -= 28
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x0, y, "Adquirente")
    c.drawString(W / 2, y, "Vendedor / prestador del servicio")
    c.setFont("Helvetica", 9)
    y -= 13
    c.drawString(x0, y, empresa.razon_social())
    c.drawString(W / 2, y, str(prov.get("name") or ""))
    y -= 12
    c.drawString(x0, y, f"NIT {empresa.nit()}")
    c.drawString(W / 2, y, f"Identificación {prov.get('identification') or ''}")
    y -= 12
    c.drawString(x0, y, empresa.ciudad())
    if prov.get("email"):
        c.drawString(W / 2, y, str(prov.get("email")))

    y -= 26
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x0, y, "Concepto")
    c.drawRightString(W - 2 * cm, y, "Valor")
    c.line(x0, y - 4, W - 2 * cm, y - 4)
    c.setFont("Helvetica", 9)
    for it in compras:
        y -= 15
        texto = str(it.get("observations") or it.get("name") or "")
        c.drawString(x0, y, texto[:95])
        c.drawRightString(W - 2 * cm, y, _cop(it.get("total") or it.get("price")))

    y -= 24
    if dian:
        total = float(dian.get("valor") or total)
        rets, pagos = [], []
        retenido = float(dian.get("retenciones") or 0)
    filas = [("Total documento", total)]
    filas += [(f"(-) {r.get('name') or 'Retención'}", -float(r.get("amount") or 0)) for r in rets]
    filas.append(("Valor a pagar", total - retenido))
    for etiqueta, valor in filas:
        c.setFont("Helvetica-Bold" if etiqueta in ("Total documento", "Valor a pagar") else "Helvetica", 9)
        c.drawString(W / 2, y, etiqueta)
        c.drawRightString(W - 2 * cm, y, _cop(valor))
        y -= 13

    if pagos:
        y -= 10
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x0, y, "Pagos registrados")
        c.setFont("Helvetica", 9)
        for p in pagos:
            y -= 13
            medio = {"transfer": "Transferencia", "cash": "Efectivo"}.get(p.get("paymentMethod"), p.get("paymentMethod") or "")
            c.drawString(x0, y, f"{p.get('date', '')} · {medio}")
            c.drawRightString(W - 2 * cm, y, _cop(p.get("amount")))
        y -= 13
        c.drawString(x0, y, f"Saldo pendiente: {_cop(bill.get('balance'))}")

    y -= 30
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x0, y, "CUDS")
    c.setFont("Helvetica", 7)
    y -= 11
    c.drawString(x0, y, cuds[:80])
    y -= 9
    c.drawString(x0, y, cuds[80:])
    if stamp.get("legalStatus"):
        y -= 13
        c.setFont("Helvetica", 8)
        from app.tools.expediente_pago import estado_dian_legible

        c.drawString(x0, y, f"Estado: {estado_dian_legible(stamp.get('legalStatus'))}")

    if qr_url:
        w = QrCodeWidget(qr_url)
        b = w.getBounds()
        size = 3.4 * cm
        d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
        d.add(w)
        y -= 12 + size
        renderPDF.draw(d, c, x0, y)
        c.setFont("Helvetica", 6.5)
        c.drawString(x0, y - 8, "Consulta en catalogo-vpfe.dian.gov.co")

    c.setFont("Helvetica", 7)
    c.drawString(x0, 1.5 * cm, "Representación gráfica del documento soporte electrónico transmitido a la DIAN "
                               "(el XML firmado va adjunto).")
    c.showPage()
    c.save()
    return buf.getvalue()


# ── correo ────────────────────────────────────────────────────────────────


def _destinatario(cobro: dict) -> str:
    from email.utils import parseaddr

    return parseaddr(cobro.get("from") or "")[1]


def _periodo_legible(periodo: str) -> str:
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
             "septiembre", "octubre", "noviembre", "diciembre"]
    try:
        a, m = periodo.split("-")
        return f"{meses[int(m) - 1]} de {a}"
    except Exception:
        return periodo


_CID_COMPROBANTE = "comprobante-contable"


def armar_respuesta(cobro: dict, solicitud: dict, bill: dict, *, n_capturas: int = 0) -> tuple[str, str, str]:
    """(asunto, texto, html) de la confirmación de pago.

    Presenta el expediente adjunto (Libro Mayor + Alegra + DIAN) y, si hay
    capturas, las muestra en el cuerpo (`cid:comprobante-contable-<n>`).
    """
    from html import escape

    from app.services import empresa

    nt = bill.get("numberTemplate") or {}
    numero = nt.get("fullNumber") or ""
    asunto = cobro.get("subject") or "Cuenta de cobro"
    if not re.match(r"^\s*re:", asunto, re.I):
        asunto = f"RE: {asunto}"
    total = float(bill.get("total") or 0)
    rets = bill.get("retentions") or []
    ica = sum(float(r.get("amount") or 0) for r in rets)
    pagos = bill.get("payments") or []
    fecha_pago = (pagos[0].get("date") if pagos else "") or str(solicitud.get("pagado_at") or "")[:10]
    girado = sum(float(p.get("amount") or 0) for p in pagos) or (total - ica)
    egresos = ", ".join(f"N.º {p.get('number') or p.get('id')}" for p in pagos)
    asiento = solicitud.get("movimiento_id")
    periodo = _periodo_legible(cobro.get("periodo") or "")
    firma = f"{empresa.razon_social()}\nNIT {empresa.nit()}"

    partes = []
    if asiento:
        partes.append("Cruce de las tres fuentes: nuestro Libro Mayor, Alegra y la DIAN.")
        partes.append(f"El asiento N.º {asiento} de nuestro Libro Mayor, con sus códigos del PUC.")
    partes.append(f"La contabilización en Alegra: documento soporte {numero}"
                  + (f" y comprobante de egreso {egresos}." if egresos else "."))
    partes.append(f"El documento soporte {numero} transmitido a la DIAN (anexo del PDF) y su XML firmado.")
    nota_ica = (
        f"Es un solo pago: le giramos {_cop(girado)} libres y McKenna asume el ReteICA de {_cop(ica)} "
        f"(8,66 por mil), por eso el servicio vale {_cop(total)}. El documento soporte no tiene campo para "
        "discriminar el ICA: va por el valor total, y el ICA queda en el Libro Mayor (2368) y en Alegra."
        if ica and abs(total - girado) > 1 else ""
    )
    texto = (
        "Buen día, William.\n\n"
        f"Confirmamos el pago de sus honorarios de {periodo} (cuenta de cobro por {_cop(cobro.get('monto'))}): "
        f"le giramos {_cop(girado)}" + (f" el {fecha_pago}" if fecha_pago else "") + ".\n\n"
        "Para que quede claro cómo se manejó, adjuntamos el soporte completo en un solo PDF:\n"
        + "".join(f"  {i}. {x}\n" for i, x in enumerate(partes, 1))
        + (f"\n{nota_ica}\n" if nota_ica else "")
        + f"\nCordialmente,\n{firma}"
    )
    lista = "".join(f"<li>{escape(x)}</li>" for x in partes)
    imgs = "".join(
        f'<p><img src="cid:{_CID_COMPROBANTE}-{i}" alt="Soporte del pago, página {i}" '
        'style="max-width:100%;border:1px solid #d3e3e5;border-radius:6px;"></p>'
        for i in range(1, n_capturas + 1)
    )
    html = (
        '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:640px;">'
        "<p>Buen día, William.</p>"
        f"<p>Confirmamos el pago de sus honorarios de <b>{escape(periodo)}</b> (cuenta de cobro por "
        f"{_cop(cobro.get('monto'))}): le giramos <b>{_cop(girado)}</b>"
        + (f" el {escape(fecha_pago)}" if fecha_pago else "") + ".</p>"
        "<p>Para que quede claro cómo se manejó, adjuntamos el soporte completo en un solo PDF:</p>"
        f"<ol>{lista}</ol>"
        + (f'<p style="color:#3a7e87;font-size:13px;">{escape(nota_ica)}</p>' if nota_ica else "")
        + imgs
        + f"<p>Cordialmente,<br>{escape(empresa.razon_social())}<br>NIT {escape(empresa.nit())}</p></div>"
    )
    return asunto, texto, html


def _enviar_respuesta(cobro: dict, asunto: str, texto: str, html: str,
                      adjuntos: list[tuple[str, str, bytes]], capturas: list[bytes] | None = None) -> None:
    """Responde en el hilo de la cuenta de cobro (In-Reply-To / References).

    `capturas` van EN el cuerpo del correo (multipart/related, `cid:`), no
    como adjuntos sueltos: es lo primero que tiene que ver quien lo abre.
    """
    import smtplib
    import ssl
    from email.mime.application import MIMEApplication
    from email.mime.image import MIMEImage
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.utils import formatdate, make_msgid

    from app.tools import web_pedidos as wp

    if not wp._smtp_ready():
        raise RuntimeError("SMTP no configurado (SMTP_HOST / SMTP_USER / SMTP_PASSWORD)")
    para = _destinatario(cobro)
    if not para:
        raise RuntimeError(f"La cuenta de cobro no trae remitente: {cobro.get('from')!r}")
    msg = MIMEMultipart("mixed")
    msg["Subject"] = asunto
    msg["From"] = f"{wp.EMAIL_FROM_NAME} <{wp.EMAIL_FROM}>"
    msg["To"] = para
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=(wp.EMAIL_FROM.split("@")[-1] or None))
    if cobro.get("message_id"):
        msg["In-Reply-To"] = cobro["message_id"]
        msg["References"] = cobro["message_id"]
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(texto, "plain", "utf-8"))
    alt.attach(MIMEText(html, "html", "utf-8"))
    if capturas:
        rel = MIMEMultipart("related")
        rel.attach(alt)
        for i, png in enumerate(capturas, 1):
            img = MIMEImage(png, _subtype="png")
            img.add_header("Content-ID", f"<{_CID_COMPROBANTE}-{i}>")
            img.add_header("Content-Disposition", "inline", filename=f"soporte_pago_{i}.png")
            rel.attach(img)
        msg.attach(rel)
    else:
        msg.attach(alt)
    for nombre, mime, data in adjuntos:
        part = MIMEApplication(data, _subtype=mime.split("/")[-1])
        part.add_header("Content-Disposition", "attachment", filename=nombre)
        msg.attach(part)
    with smtplib.SMTP(wp.SMTP_HOST, wp.SMTP_PORT, timeout=30) as server:
        server.ehlo()
        server.starttls(context=ssl.create_default_context())
        server.ehlo()
        server.login(wp.SMTP_USER, wp.SMTP_PASSWORD)
        server.sendmail(wp.EMAIL_FROM, [para], msg.as_string())


def adjuntos_confirmacion(
    solicitud: dict, doc: dict, cobro: dict | None = None,
) -> tuple[str, list[tuple[str, str, bytes]], list[bytes], dict]:
    """(número, adjuntos, capturas PNG, bill) para confirmar el pago de una solicitud.

    Todo va junto en UN expediente (`app/tools/expediente_pago.py`): cruce Libro
    Mayor / Alegra / DIAN, el asiento, la contabilización en Alegra y, como anexo,
    el documento soporte. Aparte, el XML firmado (no se puede meter en un PDF).
    Las capturas son las páginas del expediente que van en el cuerpo del correo.
    """
    bill, xml = _bill_alegra(doc["alegra_id"])
    numero = (bill.get("numberTemplate") or {}).get("fullNumber") or doc.get("numero") or "documento_soporte"
    capturas: list[bytes] = []
    if solicitud.get("movimiento_id"):
        from app.tools import comprobante_contable as cc_pdf
        from app.tools import expediente_pago

        exp = expediente_pago.generar(cobro=cobro or {}, solicitud=solicitud, doc=doc, bill=bill, xml=xml)
        nombre = f"Soporte_pago_honorarios_{(cobro or {}).get('periodo') or numero}.pdf"
        adjuntos = [(nombre, "application/pdf", exp)]
        for pagina in (1, 2):
            png = cc_pdf.pdf_a_png(exp, pagina=pagina)
            if png:
                capturas.append(png)
    else:
        from app.tools.expediente_pago import datos_dian

        adjuntos = [(f"Documento_soporte_{numero}.pdf", "application/pdf",
                     representacion_pdf(bill, dian=datos_dian(xml, bill)))]
    if xml:
        adjuntos.append((f"Documento_soporte_{numero}.xml", "application/xml", xml))
    return numero, adjuntos, capturas, bill


# ── ticket a Jenniffer ────────────────────────────────────────────────────


def _adjunto_cuenta_cobro(cobro: dict) -> tuple[str, bytes] | None:
    """El PDF de la cuenta de cobro, bajado de Gmail por su Message-ID."""
    import email

    from app.services.cuentas_cobro_correo import _dec, _imap_login, _select

    mid = (cobro.get("message_id") or "").strip()
    if not mid:
        return None
    M = _imap_login()
    try:
        if not _select(M, "[Gmail]/Todos"):
            return None
        typ, data = M.search(None, "HEADER", "Message-ID", mid)
        ids = data[0].split() if data and data[0] else []
        if not ids:
            return None
        typ, data = M.fetch(ids[-1], "(RFC822)")
        msg = email.message_from_bytes(data[0][1])
        for part in msg.walk():
            fn = _dec(part.get_filename() or "")
            if fn.lower().endswith(".pdf") and fn == (cobro.get("filename") or fn):
                return fn, part.get_payload(decode=True) or b""
    finally:
        try:
            M.logout()
        except Exception:
            pass
    return None


def _usuario_id(username: str) -> int | None:
    import sqlite3

    from app.services import tickets_db as tdb

    tdb.init_db()
    with sqlite3.connect(tdb.DB_PATH) as db:
        r = db.execute("SELECT id FROM usuarios WHERE username=? AND COALESCE(activo,1)=1", (username,)).fetchone()
    return int(r[0]) if r else None


def monto_a_girar(cobro: dict, ultimo_pago: dict | None) -> float:
    """El valor que se le ingresa al asistente de pagos: lo que se le GIRA.

    Para William el asistente lo toma como libre y le suma el ReteICA encima
    (`retencion_asume_mckenna`): meterle $1.210.483 daría $1.221.057. Si la
    cuenta de cobro trae el bruto de un pago anterior, se usa lo girado de ese
    pago; si no, su cifra se toma como lo libre pactado. El borrador lo coteja
    Jenniffer antes de enviarlo a aprobación.
    """
    monto = float(cobro.get("monto") or 0)
    if ultimo_pago:
        bruto, girado = valores_del_pago(ultimo_pago)
        if abs(bruto - monto) <= 1 and girado > 0:
            return girado
    return monto


def _montar_borrador(cobro: dict, tercero: dict, solicitudes: list[dict], creado_por: int) -> int | None:
    """Borrador de pago con el valor de la cuenta de cobro. Idempotente por período.

    Copia categoría, cuenta y medio de pago del último pago al contador: así
    se contabilizó el anterior (511035 con su ICA asumido), y la ficha del
    tercero decide los impuestos. Sin pago anterior, cae a «honorarios».
    """
    from app.services import pagos_wizard as pw

    periodo = cobro.get("periodo") or ""
    ultimo = next((s for s in reversed(solicitudes) if s["estado"] == "pagada"), None)
    payload: dict[str, Any] = {
        "categoria": (ultimo or {}).get("categoria") or "honorarios",
        "concepto": f"Honorarios contador — {_periodo_legible(periodo)}",
        "monto": monto_a_girar(cobro, ultimo),
        "fecha": datetime.now().strftime("%Y-%m-%d"),
        "tercero_id": tercero["id"],
        "origen_ref": f"contador:{periodo}",
        "origen_sistema": "contador",
        "periodo": periodo,
        "notas": f"Cuenta de cobro recibida por correo el {cobro.get('email_date')}: {cobro.get('filename')}",
    }
    if ultimo and ultimo.get("cuenta_debito"):
        payload["cuenta_debito"] = ultimo["cuenta_debito"]
    if ultimo and ultimo.get("medio_pago_id"):
        payload["medio_pago_id"] = ultimo["medio_pago_id"]
    try:
        return int(pw.crear_borrador_idempotente(payload, created_by=creado_por)["id"])
    except Exception as e:
        print(f"⚠️ No se pudo montar el borrador de honorarios: {e}")
        return None


def _crear_ticket(cobro: dict, borrador_id: int | None, en_curso: dict | None) -> int:
    from app.services import tickets_db as tdb

    asignado = _usuario_id(_asignado_username())
    creado_por = _usuario_id("admin")
    if not creado_por:
        raise RuntimeError("No existe el usuario 'admin' para crear el ticket")
    periodo = _periodo_legible(cobro.get("periodo") or "")
    archivo = None
    try:
        adj = _adjunto_cuenta_cobro(cobro)
        if adj and adj[1]:
            _TICKETS_UPLOADS.mkdir(parents=True, exist_ok=True)
            archivo = f"cuenta_cobro_contador_{cobro.get('periodo')}_{datetime.now():%Y%m%d%H%M%S}.pdf"
            (_TICKETS_UPLOADS / archivo).write_bytes(adj[1])
    except Exception as e:
        print(f"⚠️ No se pudo adjuntar la cuenta de cobro al ticket: {e}")

    if en_curso:
        paso = (f"Ya existe la solicitud de pago **#{en_curso['id']}** (estado «{en_curso['estado']}») para "
                "este período: dale seguimiento hasta que quede pagada.")
    elif borrador_id:
        paso = (f"Ya quedó montado el **borrador #{borrador_id}** en **Contabilidad → Solicitudes de pago** "
                "(filtro «Borradores»). Cotéjalo contra la cuenta de cobro adjunta y envíalo a aprobación.")
    else:
        paso = ("Crea la solicitud en **Contabilidad → Solicitudes de pago** a nombre de William Fernando "
                "Novoa Molano con el valor de la cuenta de cobro adjunta y envíala a aprobación.")
    descripcion = (
        f"William (contador) envió por correo su cuenta de cobro de **{periodo}** por "
        f"**{_cop(cobro.get('monto'))}** ({cobro.get('email_date')}, «{cobro.get('subject')}») "
        "y todavía no se le ha pagado.\n\n"
        f"{paso}\n\n"
        "Cuando el pago quede confirmado y su documento soporte emitido a la DIAN, el sistema le "
        "responde a William en el mismo correo con el documento soporte adjunto; no hace falta "
        "escribirle a mano."
    )
    ticket, error = tdb.crear_ticket(
        {
            "tipo": "solicitud",
            "titulo": f"Solicitar pago honorarios contador — {periodo}",
            "categoria": "contabilidad",
            "descripcion": descripcion,
            "prioridad": "alta",
            "asignado_a": asignado,
        },
        creado_por,
        archivo,
    )
    if error:
        raise RuntimeError(f"No se pudo crear el ticket: {error}")
    return int(ticket["id"])


# ── orquestación ──────────────────────────────────────────────────────────


def _correo_contador() -> str:
    t = tercero_contador() or {}
    return (t.get("email") or "williamfer94@hotmail.com").strip()


def correos_nuevos() -> list[str]:
    """Message-ID de correos de William recibidos desde DESDE que aún no se han revisado.

    Es el chequeo barato del cron de cada pocos minutos: una búsqueda IMAP y
    solo encabezados. La relectura completa de Gmail (PDF por PDF de años de
    cuentas de cobro) solo corre cuando esto devuelve algo.
    """
    import email

    from app.services.cuentas_cobro_correo import _imap_login, _select

    desde = datetime.strptime(_desde(), "%Y-%m-%d").strftime("%d-%b-%Y")
    vistos = set(_leer_estado().get("vistos") or [])
    M = _imap_login()
    try:
        if not _select(M, "[Gmail]/Todos"):
            _select(M, "INBOX")
        typ, data = M.search(None, f'(FROM "{_correo_contador()}" SINCE {desde})')
        ids = data[0].split() if data and data[0] else []
        nuevos = []
        for i in ids:
            typ, d = M.fetch(i, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
            mid = (email.message_from_bytes(d[0][1]).get("Message-ID") or "").strip()
            if mid and mid not in vistos:
                nuevos.append(mid)
        return nuevos
    finally:
        try:
            M.logout()
        except Exception:
            pass


def marcar_vistos(message_ids: list[str]) -> None:
    if not message_ids:
        return
    estado = _leer_estado()
    estado["vistos"] = sorted(set(estado.get("vistos") or []) | set(message_ids))
    _guardar_estado(estado)


def procesar(*, releer_gmail: bool = True, ensayo: bool = False) -> list[dict]:
    """Igual que `_procesar`, con candado: el cron rápido y el diario pueden coincidir,
    y dos corridas a la vez le mandarían el mismo correo dos veces a William."""
    import fcntl

    _LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_LOCK_PATH, "w") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return [{"accion": "ocupado", "detalle": "Otra corrida está atendiendo las cuentas de cobro"}]
        return _procesar(releer_gmail=releer_gmail, ensayo=ensayo)


def _procesar(*, releer_gmail: bool = True, ensayo: bool = False) -> list[dict]:
    """Atiende las cuentas de cobro nuevas o aún sin respuesta. Devuelve lo que hizo.

    `ensayo=True` (o CONTADOR_COBRO_RESPUESTA_ACTIVO=0) solo informa qué haría:
    no envía correos, no crea tickets ni borradores y no toca el estado.
    """
    from app.services.cuentas_cobro_correo import cargar_cobros, sincronizar_desde_gmail

    ensayo = ensayo or not activo()
    if releer_gmail:
        try:
            sincronizar_desde_gmail()
        except Exception as e:
            print(f"⚠️ No se pudo releer Gmail ({e}); se usa el último caché.")
    tercero = tercero_contador()
    if not tercero:
        return [{"accion": "error", "detalle": "El contador no está registrado como tercero en el Libro Mayor"}]

    estado = _leer_estado()
    registro = estado["cobros"]
    usadas = {int(v["solicitud_id"]) for v in registro.values() if v.get("solicitud_id")}
    solicitudes = _solicitudes_del_contador(tercero["id"])
    out: list[dict] = []

    cobros = [c for c in cargar_cobros()
              if c.get("proveedor") == "william" and (c.get("email_date") or "") >= _desde()]
    for cobro in sorted(cobros, key=lambda c: c.get("email_date") or ""):
        clave = cobro.get("message_id") or f"{cobro.get('periodo')}|{cobro.get('filename')}"
        previo = registro.get(clave) or {}
        if previo.get("estado") == "soporte_enviado":
            continue
        base = {"periodo": cobro.get("periodo"), "monto": cobro.get("monto"), "correo": cobro.get("email_date")}

        pago = buscar_pago(cobro, solicitudes, usadas)
        if pago:
            doc = _documento_emitido(pago["id"])
            if not doc:
                out.append({**base, "accion": "esperando_documento", "solicitud_id": pago["id"],
                            "detalle": "Pagado, pero el documento soporte aún no se ha emitido a la DIAN"})
                continue
            if ensayo:
                out.append({**base, "accion": "enviaria_soporte", "solicitud_id": pago["id"],
                            "documento": doc.get("numero"), "para": _destinatario(cobro)})
                continue
            numero, adjuntos, capturas, bill = adjuntos_confirmacion(pago, doc, cobro)
            asunto, texto, html = armar_respuesta(cobro, pago, bill, n_capturas=len(capturas))
            _enviar_respuesta(cobro, asunto, texto, html, adjuntos, capturas)
            usadas.add(int(pago["id"]))
            registro[clave] = {**previo, **base, "estado": "soporte_enviado", "solicitud_id": pago["id"],
                               "documento": numero, "asiento": pago.get("movimiento_id"),
                               "adjuntos": [n for n, _m, _d in adjuntos],
                               "enviado_a": _destinatario(cobro),
                               "enviado_at": datetime.now().isoformat(timespec="seconds")}
            _guardar_estado(estado)
            out.append({**base, "accion": "soporte_enviado", "solicitud_id": pago["id"], "documento": numero})
            continue

        if previo.get("ticket_id"):
            out.append({**base, "accion": "sin_pagar_con_ticket", "ticket_id": previo["ticket_id"]})
            continue
        en_curso = _en_curso(cobro, solicitudes)
        if ensayo:
            out.append({**base, "accion": "crearia_ticket", "asignado": _asignado_username(),
                        "solicitud_en_curso": (en_curso or {}).get("id")})
            continue
        borrador_id = None
        if not en_curso:
            borrador_id = _montar_borrador(cobro, tercero, solicitudes, _usuario_id("admin") or 0)
        tid = _crear_ticket(cobro, borrador_id, en_curso)
        registro[clave] = {**base, "estado": "pendiente_pago", "ticket_id": tid, "borrador_id": borrador_id,
                           "ticket_at": datetime.now().isoformat(timespec="seconds")}
        _guardar_estado(estado)
        out.append({**base, "accion": "ticket_creado", "ticket_id": tid, "borrador_id": borrador_id})
    return out
