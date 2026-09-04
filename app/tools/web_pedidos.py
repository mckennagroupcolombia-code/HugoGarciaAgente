"""
Pedidos web (Flask site): correos transaccionales, WhatsApp interno, envío y facturación.

Base de datos: PAGINA_WEB/site/data/orders.db (misma que website.py).
"""
from __future__ import annotations

import html as html_module
import json
import logging
import os
import re
import smtplib
import sqlite3
import ssl
import uuid
from datetime import datetime, timedelta
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from dotenv import load_dotenv

log = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(_ROOT / ".env")

ORDERS_DB = _ROOT / "PAGINA_WEB" / "site" / "data" / "orders.db"
SITE_URL = os.getenv("SITE_URL", os.getenv("WEB_SITE_URL", "https://mckennagroup.co")).rstrip("/")
GRUPO_PEDIDOS_WEB_WA = os.getenv("GRUPO_PEDIDOS_WEB_WA", "120363391665421264@g.us")


def _env_strip_quotes(val: str) -> str:
    s = (val or "").strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1]
    return s.strip()


SMTP_USER = (
    os.getenv("SMTP_USER", "").strip() or os.getenv("EMAIL_SENDER", "").strip()
)
SMTP_PASSWORD = _env_strip_quotes(
    os.getenv("SMTP_PASSWORD", "").strip()
    or os.getenv("EMAIL_PASSWORD", "").strip()
)
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
if not SMTP_HOST and SMTP_USER:
    SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
EMAIL_FROM = os.getenv("EMAIL_FROM", "").strip() or SMTP_USER
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "McKenna Group").strip()
# Si el pedido no trae correo en facturación ni comprador, el PDF de la FE va aquí (SMTP).
WEB_INVOICE_EMAIL_FALLBACK = (
    os.getenv("WEB_INVOICE_EMAIL_FALLBACK", "facturasmckennagroup@gmail.com") or ""
).strip()

# Paleta alineada con PAGINA_WEB/site/static/css/main.css
_MCK_GREEN = "#0c6069"
_MCK_GREEN_DARK = "#045159"
_MCK_GREEN_DEEP = "#022d33"
_MCK_GREEN_LIGHT = "#6aacb3"
_MCK_BG = "#e3fcff"
_MCK_MUTED = "#3a7e87"
_MCK_FONT = "Montserrat, Helvetica Neue, Arial, sans-serif"
_LOGO_URL = f"{SITE_URL}/static/img/isotipo.png"


def _wrap_mckenna_email(*, preheader: str, inner_html: str) -> str:
    """Plantilla tipo sitio web: fondo aqua, tipografía Montserrat, barra marca verde."""
    pre = html_module.escape(preheader)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<title>McKenna Group</title>
</head>
<body style="margin:0;padding:0;background-color:{_MCK_BG};">
  <div style="display:none;font-size:1px;color:{_MCK_BG};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{pre}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:{_MCK_BG};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(12,96,105,0.18);box-shadow:0 4px 24px rgba(2,45,51,0.06);">
          <tr>
            <td style="background:{_MCK_GREEN};padding:18px 24px;text-align:center;border-bottom:2px solid {_MCK_GREEN_DARK};">
              <table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <img src="{_LOGO_URL}" alt="" width="44" height="44" style="display:block;border:0;">
                </td>
                <td style="vertical-align:middle;text-align:left;">
                  <div style="font-family:{_MCK_FONT};font-weight:800;font-size:17px;color:{_MCK_BG};letter-spacing:-0.3px;line-height:1.2;">McKenna Group</div>
                  <div style="font-family:{_MCK_FONT};font-size:9px;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:rgba(227,252,255,0.85);margin-top:4px;">Materias primas</div>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 28px 28px;font-family:{_MCK_FONT};font-size:15px;line-height:1.75;color:{_MCK_GREEN_DEEP};">
              {inner_html}
            </td>
          </tr>
          <tr>
            <td style="background:{_MCK_GREEN_DEEP};padding:20px 24px;text-align:center;">
              <p style="margin:0;font-family:{_MCK_FONT};font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:rgba(227,252,255,0.75);">McKenna Group S.A.S. · Bogotá, Colombia</p>
              <p style="margin:10px 0 0 0;font-family:{_MCK_FONT};font-size:13px;">
                <a href="{html_module.escape(SITE_URL)}" style="color:{_MCK_GREEN_LIGHT};text-decoration:none;font-weight:600;">mckennagroup.co</a>
                &nbsp;·&nbsp;
                <a href="{html_module.escape(SITE_URL + "/catalogo")}" style="color:{_MCK_GREEN_LIGHT};text-decoration:none;">Catálogo</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def orders_db_path() -> Path:
    return ORDERS_DB


def _smtp_ready() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and EMAIL_FROM)


def migrate_orders_table() -> None:
    ORDERS_DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(ORDERS_DB)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            reference   TEXT UNIQUE,
            buyer_name  TEXT,
            buyer_email TEXT,
            buyer_phone TEXT,
            buyer_city  TEXT,
            items_json  TEXT,
            total       REAL,
            status      TEXT DEFAULT 'pending',
            payu_ref    TEXT,
            created_at  TEXT
        )
        """
    )
    cur = con.execute("PRAGMA table_info(orders)")
    existing = {row[1] for row in cur.fetchall()}
    additions = [
        ("tracking_token", "TEXT"),
        ("shipping_status", "TEXT DEFAULT 'preparing'"),
        ("tracking_number", "TEXT"),
        ("tracking_carrier", "TEXT"),
        ("confirmation_email_sent_at", "TEXT"),
        ("shipped_email_sent_at", "TEXT"),
        ("whatsapp_notified_at", "TEXT"),
        ("invoice_requested_at", "TEXT"),
        ("siigo_invoice_id", "TEXT"),
        ("siigo_invoice_number", "TEXT"),
        ("siigo_invoice_status", "TEXT"),
        ("siigo_invoice_cufe", "TEXT"),
        ("siigo_invoice_emitted_at", "TEXT"),
        ("siigo_invoice_error", "TEXT"),
        ("siigo_invoice_attempted_at", "TEXT"),
        ("siigo_invoice_email_sent_at", "TEXT"),
        ("stock_descontado_at", "TEXT"),
        ("cancelled_at", "TEXT"),
        ("cancel_reason", "TEXT"),
        ("stock_restaurado_at", "TEXT"),
        ("delivered_at", "TEXT"),
        # Método de pago Mercado Pago (payment_method_id / payment_type_id)
        ("payment_method", "TEXT"),
        ("payment_type", "TEXT"),
        ("refunded_at", "TEXT"),
        ("mp_refund_id", "TEXT"),
        ("mp_refund_json", "TEXT"),
    ]
    for col, decl in additions:
        if col not in existing:
            con.execute(f"ALTER TABLE orders ADD COLUMN {col} {decl}")
    con.commit()
    for row in con.execute(
        "SELECT id FROM orders WHERE tracking_token IS NULL OR tracking_token = ''"
    ).fetchall():
        con.execute(
            "UPDATE orders SET tracking_token = ? WHERE id = ?",
            (str(uuid.uuid4()), row[0]),
        )
    con.commit()
    con.close()


def _row_dict(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in row.keys()}


def get_order_by_reference(reference: str) -> dict | None:
    if not reference or not ORDERS_DB.exists():
        return None
    con = sqlite3.connect(ORDERS_DB)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT * FROM orders WHERE upper(reference) = ? LIMIT 1",
        (reference.upper().strip(),),
    ).fetchone()
    con.close()
    return _row_dict(row) if row else None


def resolver_referencia_desde_token(token: str) -> tuple[str | None, str]:
    """
    Acepta referencia completa (MCKG-HEX) o los últimos 3 caracteres alfanuméricos
    (ej. 250 para MCKG-F09BC12250). Retorna (reference en mayúsculas, "") o (None, aviso).
    """
    raw = (token or "").strip()
    if not raw:
        return None, "⚠️ Falta el código del pedido."
    up = raw.upper()
    if re.fullmatch(r"MCKG-[A-F0-9]+", up):
        if get_order_by_reference(up):
            return up, ""
        return None, f"⚠️ No encontré pedido *{up}*."
    if re.fullmatch(r"[A-Z0-9]{3}", up):
        if not ORDERS_DB.exists():
            return None, "⚠️ Base de pedidos no disponible."
        migrate_orders_table()
        con = sqlite3.connect(ORDERS_DB, timeout=30)
        rows = con.execute(
            "SELECT upper(reference) AS r FROM orders WHERE upper(reference) LIKE ?",
            (f"%{up}",),
        ).fetchall()
        con.close()
        refs = [r[0] for r in rows]
        if len(refs) == 0:
            return None, (
                f"⚠️ Ningún pedido termina en *{up}*. "
                "Usa la ref completa *MCKG-…* o revisa el código."
            )
        if len(refs) > 1:
            preview = ", ".join(refs[:4])
            extra = f" (+{len(refs) - 4} más)" if len(refs) > 4 else ""
            return None, (
                f"⚠️ Varios pedidos terminan en *{up}*: {preview}{extra}.\n"
                "Escribe el *MCKG-…* completo para desambiguar."
            )
        return refs[0], ""
    return None, (
        "⚠️ Código inválido. Ej: *facturar 250* (3 caracteres finales) "
        "o *facturar MCKG-F09BC12250*."
    )


def _items_summary(items_json: str) -> tuple[str, str]:
    """(texto_plano, html_lista simple)"""
    try:
        data = json.loads(items_json or "{}")
    except json.JSONDecodeError:
        return ("(sin detalle)", "<p>(sin detalle)</p>")
    items = data.get("items") or []
    lines = []
    lis = []
    for it in items:
        name = it.get("name", "")
        qty = it.get("qty", 1)
        price = it.get("price", 0)
        ref = it.get("ref", "")
        line = f"- {name} x{qty} — ${price:,.0f} COP (Ref: {ref})".replace(",", ".")
        lines.append(line)
        lis.append(f"<li>{name} × {qty} — <strong>${price:,.0f}</strong> COP <small>({ref})</small></li>".replace(",", "."))
    body = "\n".join(lines) if lines else "(sin ítems)"
    html = "<ul>" + "".join(lis) + "</ul>" if lis else "<p>(sin ítems)</p>"
    return body, html


def _items_email_cards_html(items_json: str) -> str:
    try:
        data = json.loads(items_json or "{}")
    except json.JSONDecodeError:
        return ""
    items = data.get("items") or []
    if not items:
        return f'<p style="margin:0;font-family:{_MCK_FONT};font-size:14px;color:{_MCK_MUTED};">(Sin ítems)</p>'
    blocks = []
    for it in items:
        name = html_module.escape(str(it.get("name", "")))
        qty = int(it.get("qty", 1) or 1)
        price = float(it.get("price", 0) or 0)
        ref = html_module.escape(str(it.get("ref", "")))
        price_fmt = f"${price:,.0f}".replace(",", ".")
        blocks.append(
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="margin:0 0 10px 0;"><tr><td style="padding:14px 16px;background:{_MCK_BG};'
            f"border-radius:12px;border-left:4px solid {_MCK_GREEN};"
            f'">'
            f'<span style="font-family:{_MCK_FONT};font-size:15px;font-weight:600;color:{_MCK_GREEN_DEEP};">'
            f"{name} × {qty}</span><br>"
            f'<span style="font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">'
            f"Ref {ref} · <strong style=\"color:{_MCK_GREEN_DARK};\">{price_fmt} COP</strong></span>"
            f"</td></tr></table>"
        )
    return "".join(blocks)


def _shipping_billing_block(items_json: str, buyer_city: str = "") -> tuple[str, str]:
    try:
        data = json.loads(items_json or "{}")
    except json.JSONDecodeError:
        return ("", "")
    plain = []
    html = []
    dept = data.get("dept", "")
    if data.get("address"):
        plain.append(f"Dirección envío: {data.get('address', '')}")
        plain.append(f"Municipio/ciudad: {buyer_city} — Depto: {dept}")
        if data.get("notes"):
            plain.append(f"Notas: {data['notes']}")
        ad = html_module.escape(str(data.get("address", "")))
        bc = html_module.escape(str(buyer_city))
        dp = html_module.escape(str(dept))
        html.append(
            f'<p style="margin:0 0 8px 0;"><strong style="color:{_MCK_GREEN_DARK};">Envío</strong><br>'
            f'<span style="color:{_MCK_GREEN_DEEP};">{ad}</span><br>'
            f'<span style="color:{_MCK_MUTED};font-size:14px;">{bc} — {dp}</span></p>'
        )
        if data.get("notes"):
            nt = html_module.escape(str(data["notes"]))
            html.append(
                f'<p style="margin:12px 0 0 0;padding:12px 14px;background:{_MCK_BG};border-radius:10px;font-size:14px;color:{_MCK_GREEN_DEEP};"><strong>Notas:</strong> {nt}</p>'
            )
    bill = data.get("billing") or {}
    if bill:
        plain.append(
            f"Facturación: {bill.get('name', '')} — NIT/CC {bill.get('nit', '')} — {bill.get('email', '')}"
        )
        bn = html_module.escape(str(bill.get("name", "")))
        nit = html_module.escape(str(bill.get("nit", "")))
        em = html_module.escape(str(bill.get("email", "")))
        html.append(
            f'<p style="margin:16px 0 0 0;"><strong style="color:{_MCK_GREEN_DARK};">Facturación</strong><br>'
            f'<span style="color:{_MCK_GREEN_DEEP};">{bn}</span><br>'
            f'<span style="color:{_MCK_MUTED};font-size:14px;">NIT/CC {nit}<br>{em}</span></p>'
        )
    return "\n".join(plain), "".join(html)


def _send_smtp(to_addr: str, subject: str, text_body: str, html_body: str) -> bool:
    if not _smtp_ready():
        log.warning("SMTP no configurado: no se envía correo a %s", to_addr)
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{EMAIL_FROM_NAME} <{EMAIL_FROM}>"
    msg["To"] = to_addr
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls(context=ctx)
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(EMAIL_FROM, [to_addr], msg.as_string())
        return True
    except Exception as e:
        log.exception("Error enviando correo a %s: %s", to_addr, e)
        return False


def _send_smtp_with_attachments(
    to_addr: str,
    subject: str,
    text_body: str,
    html_body: str,
    attachments: list[tuple[str, str, bytes]],
) -> bool:
    """attachments: [(filename, mime_type, data)]"""
    if not _smtp_ready():
        log.warning("SMTP no configurado: no se envía correo a %s", to_addr)
        return False
    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = f"{EMAIL_FROM_NAME} <{EMAIL_FROM}>"
    msg["To"] = to_addr
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text_body, "plain", "utf-8"))
    alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(alt)
    for fname, mime, data in attachments:
        if not fname or not data:
            continue
        part = MIMEApplication(data, _subtype=mime.split("/")[-1] if "/" in mime else "octet-stream")
        part.add_header("Content-Disposition", "attachment", filename=fname)
        msg.attach(part)
    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls(context=ctx)
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(EMAIL_FROM, [to_addr], msg.as_string())
        return True
    except Exception as e:
        log.exception("Error enviando correo con adjuntos a %s: %s", to_addr, e)
        return False


def _billing_email_from_order(order: dict) -> str:
    """Correo para PDF de FE: primero facturación (billing.email), luego comprador (buyer_email)."""
    try:
        data = json.loads(order.get("items_json") or "{}")
    except json.JSONDecodeError:
        data = {}
    bill = data.get("billing") or {}
    return (bill.get("email") or order.get("buyer_email") or "").strip()


def _invoice_email_for_fe(order: dict) -> tuple[str, bool]:
    """
    Correo destino del PDF de factura electrónica (billing.email → buyer_email).
    Retorna (email, True) si se usa el fallback interno por falta de cualquier correo en la venta.
    """
    direct = _billing_email_from_order(order)
    if direct:
        return direct, False
    if WEB_INVOICE_EMAIL_FALLBACK:
        return WEB_INVOICE_EMAIL_FALLBACK, True
    return "", True


def _ensure_siigo_invoice_pdf_path(
    invoice_id: str, invoice_number: str | int | None, existing_path: str | None
) -> str | None:
    if existing_path and Path(existing_path).is_file():
        return existing_path
    if not invoice_id:
        return None
    try:
        # descargar_factura_pdf_alegra() usa GET /invoices/{id}?fields=pdf (URL firmada
        # de CloudFront) — confirmado en vivo 2026-09-03. Antes de ese fix devolvía
        # siempre "" y los correos de factura a clientes web salían sin PDF adjunto
        # desde la migración a Alegra, sin que nada lo reportara como error.
        from app.services.alegra import descargar_factura_pdf_alegra
        import base64

        b64 = descargar_factura_pdf_alegra(invoice_id)
        if not b64 or "Error" in str(b64):
            return None
        pdf_dir = _ROOT / "facturas_descargadas"
        pdf_dir.mkdir(parents=True, exist_ok=True)
        name = f"Factura_{invoice_number or invoice_id}.pdf"
        out = pdf_dir / name
        out.write_bytes(base64.b64decode(b64))
        return str(out)
    except Exception as e:
        log.warning("No se pudo descargar PDF Alegra %s: %s", invoice_id, e)
        return None


def send_siigo_invoice_email_to_customer(
    order: dict,
    *,
    invoice_number: str | int | None,
    invoice_id: str | None,
    pdf_path: str | None,
    cufe: str = "",
) -> bool:
    to_addr, used_fallback = _invoice_email_for_fe(order)
    if not to_addr:
        log.warning(
            "Pedido %s sin correo de facturación y sin WEB_INVOICE_EMAIL_FALLBACK",
            order.get("reference"),
        )
        return False
    ref = order.get("reference") or ""
    if used_fallback:
        log.info(
            "FE pedido %s: sin email en datos de venta; envío PDF a %s",
            ref,
            to_addr,
        )
    num = str(invoice_number or "").strip() or str(invoice_id or "").strip()
    pdf = _ensure_siigo_invoice_pdf_path(str(invoice_id or ""), invoice_number, pdf_path)
    subj = f"Factura electrónica {num} — McKenna Group"
    cufe_txt = (cufe or "").strip()
    text = (
        f"Hola,\n\n"
        f"Adjuntamos la factura electrónica de tu compra en McKenna Group.\n\n"
        f"Pedido: {ref}\n"
        f"Factura: {num}\n"
    )
    if cufe_txt:
        text += f"CUFE: {cufe_txt}\n"
    text += (
        f"\nSi tienes dudas, responde a este correo o escríbenos por WhatsApp.\n\n"
        f"McKenna Group S.A.S.\n"
    )
    num_esc = html_module.escape(num)
    ref_esc = html_module.escape(str(ref))
    cufe_esc = html_module.escape(cufe_txt) if cufe_txt else ""
    inner = f"""
<p style="margin:0 0 18px 0;">Hola,</p>
<p style="margin:0 0 18px 0;">Adjuntamos la <strong style="color:{_MCK_GREEN_DARK};">factura electrónica</strong> de tu compra en McKenna Group.</p>
<table role="presentation" width="100%" style="margin:0 0 20px 0;background:{_MCK_BG};border-radius:12px;border:1px solid rgba(12,96,105,0.12);">
  <tr><td style="padding:16px 18px;">
    <p style="margin:0 0 8px 0;font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">Pedido</p>
    <p style="margin:0 0 14px 0;font-family:{_MCK_FONT};font-size:16px;font-weight:700;color:{_MCK_GREEN_DEEP};">{ref_esc}</p>
    <p style="margin:0 0 8px 0;font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">Factura</p>
    <p style="margin:0;font-family:{_MCK_FONT};font-size:16px;font-weight:700;color:{_MCK_GREEN};">{num_esc}</p>
    {f'<p style="margin:14px 0 0 0;font-family:{_MCK_FONT};font-size:12px;color:{_MCK_MUTED};">CUFE<br><span style="word-break:break-all;color:{_MCK_GREEN_DEEP};">{cufe_esc}</span></p>' if cufe_esc else ''}
  </td></tr>
</table>
<p style="margin:0;font-size:14px;color:{_MCK_MUTED};line-height:1.65;">Si tienes dudas, responde a este correo.</p>
""".strip()
    html = _wrap_mckenna_email(preheader=f"Factura {num} — McKenna Group", inner_html=inner)
    atts: list[tuple[str, str, bytes]] = []
    if pdf and Path(pdf).is_file():
        atts.append((Path(pdf).name, "application/pdf", Path(pdf).read_bytes()))
    return _send_smtp_with_attachments(to_addr, subj, text, html, atts)


def _build_order_confirmation_content(order: dict) -> tuple[str, str, str]:
    """Retorna (subject, text_plain, html_full)."""
    ref = order["reference"]
    token = order.get("tracking_token") or ""
    track_url = f"{SITE_URL}/pedido/seguimiento/{ref}?t={token}"
    items_txt, _ = _items_summary(order.get("items_json") or "")
    ship_txt, ship_html = _shipping_billing_block(
        order.get("items_json") or "", order.get("buyer_city") or ""
    )
    subj = f"Recibimos tu pedido {ref} — McKenna Group"
    text = f"""Hola {order.get('buyer_name', 'cliente')},

Recibimos tu pedido y el pago fue confirmado.

Referencia: {ref}
Total: ${order.get('total', 0):,.0f} COP

Productos:
{items_txt}

{ship_txt}

Seguimiento del envío (guarda este enlace):
{track_url}

Te avisaremos por correo cuando tu envío esté en camino con el número de guía.

Gracias por comprar en McKenna Group.
""".replace(",", ".")
    total_fmt = f"${order.get('total', 0):,.0f}".replace(",", ".")
    name_esc = html_module.escape(str(order.get("buyer_name", "cliente")))
    ref_esc = html_module.escape(str(ref))
    track_esc = html_module.escape(track_url)
    items_cards = _items_email_cards_html(order.get("items_json") or "")
    preheader = f"Pedido {ref} confirmado. Total {total_fmt} COP. Seguimiento y detalle dentro."
    inner = f"""
<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{_MCK_MUTED};">Pedido confirmado</p>
<p style="margin:0 0 20px 0;font-size:22px;font-weight:800;letter-spacing:-0.5px;color:{_MCK_GREEN_DEEP};line-height:1.25;">¡Gracias por tu compra!</p>
<p style="margin:0 0 18px 0;">Hola <strong style="color:{_MCK_GREEN_DARK};">{name_esc}</strong>,</p>
<p style="margin:0 0 22px 0;color:{_MCK_GREEN_DEEP};">Recibimos tu pedido y el <strong style="color:{_MCK_GREEN};">pago fue confirmado</strong>.</p>
<table role="presentation" width="100%" style="margin:0 0 24px 0;background:{_MCK_BG};border-radius:12px;border:1px solid rgba(12,96,105,0.12);">
  <tr><td style="padding:16px 18px;">
    <table role="presentation" width="100%">
      <tr>
        <td style="font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">Referencia</td>
        <td align="right" style="font-family:{_MCK_FONT};font-size:13px;font-weight:700;color:{_MCK_GREEN_DEEP};">{ref_esc}</td>
      </tr>
      <tr><td colspan="2" style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td style="font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">Total</td>
        <td align="right" style="font-family:{_MCK_FONT};font-size:18px;font-weight:800;color:{_MCK_GREEN};">{total_fmt} COP</td>
      </tr>
    </table>
  </td></tr>
</table>
<p style="margin:0 0 12px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{_MCK_MUTED};">Tu pedido</p>
{items_cards}
{ship_html}
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 20px 0;" width="100%"><tr><td align="center">
  <a href="{track_esc}" style="display:inline-block;padding:14px 28px;background:{_MCK_GREEN};color:#ffffff !important;font-family:{_MCK_FONT};font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;border:2px solid {_MCK_GREEN_DARK};">Ver estado de mi pedido</a>
</td></tr></table>
<p style="margin:0;font-size:14px;color:{_MCK_MUTED};line-height:1.65;">Te enviaremos otro correo cuando el envío esté <strong style="color:{_MCK_GREEN_DARK};">en camino</strong> con el número de guía.</p>
""".strip()
    html = _wrap_mckenna_email(preheader=preheader, inner_html=inner)
    return subj, text, html


def send_order_confirmation_email(order: dict) -> bool:
    subj, text, html = _build_order_confirmation_content(order)
    email = (order.get("buyer_email") or "").strip()
    if not email:
        return False
    return _send_smtp(email, subj, text, html)


def reenviar_correo_confirmacion_pedido(
    reference: str, *, force: bool = False
) -> tuple[bool, str]:
    """
    Correo estándar de «pedido confirmado» (misma plantilla que tras pago aprobado).

    - Si ya hay ``confirmation_email_sent_at`` y ``force`` es False, no reenvía.
    - Si ``force`` es True, reenvía igual y refresca el timestamp (útil tras fallos de SMTP).
    """
    migrate_orders_table()
    ref = (reference or "").strip().upper()
    if not ref:
        return False, "Falta la referencia del pedido."
    if not _smtp_ready():
        return False, "SMTP no configurado (SMTP_HOST / SMTP_USER / SMTP_PASSWORD / EMAIL_FROM)."
    order = get_order_by_reference(ref)
    if not order:
        return False, f"No encontré el pedido {ref}."
    if not (order.get("buyer_email") or "").strip():
        return False, "El pedido no tiene correo del comprador."
    prev = order.get("confirmation_email_sent_at")
    if prev and not force:
        return (
            False,
            f"Ya consta confirmación enviada ({prev}). Usa force=True o el flag --force del script.",
        )
    if not send_order_confirmation_email(order):
        return False, "Falló el envío SMTP (revisa credenciales y red)."
    now = datetime.now().isoformat()
    con = sqlite3.connect(ORDERS_DB)
    con.execute(
        "UPDATE orders SET confirmation_email_sent_at = ? WHERE upper(reference) = ?",
        (now, ref),
    )
    con.commit()
    con.close()
    return True, f"Correo de confirmación enviado a {order.get('buyer_email', '').strip()}."


def send_order_confirmation_preview_test(to_email: str) -> bool:
    """Envía un correo de muestra con datos ficticios (misma plantilla que pedido real)."""
    if not _smtp_ready():
        log.warning("SMTP no configurado")
        return False
    demo = {
        "reference": "MCKG-PREVIEW01",
        "tracking_token": str(uuid.uuid4()),
        "buyer_name": "Cynthia",
        "buyer_email": to_email.strip(),
        "buyer_city": "Bogotá D.C.",
        "total": 73131.0,
        "items_json": json.dumps(
            {
                "items": [
                    {
                        "name": "Ácido ascórbico 250g",
                        "ref": "ACDASC250g",
                        "qty": 1,
                        "price": 15865,
                    },
                    {
                        "name": "Agua de rosas 250ml",
                        "ref": "H2ORS250ML",
                        "qty": 1,
                        "price": 5762,
                    },
                    {
                        "name": "Aceite esencial rosa mosqueta",
                        "ref": "OILESNRSM5ML",
                        "qty": 1,
                        "price": 11440,
                    },
                ],
                "dept": "Bogotá D.C.",
                "address": "Cll 66 # 59-31 torre 8 apto 1104",
                "notes": "Conjunto parques de los cipreses (ejemplo visual).",
                "billing": {
                    "name": "Cynthia Álvarez",
                    "nit": "52218143",
                    "email": to_email.strip(),
                },
            },
            ensure_ascii=False,
        ),
    }
    subj, text, html = _build_order_confirmation_content(demo)
    subj = "[PRUEBA] " + subj
    return _send_smtp(to_email.strip(), subj, text, html)


def _build_shipped_email_content(
    order: dict, tracking_number: str, carrier: str
) -> tuple[str, str, str]:
    ref = order["reference"]
    token = order.get("tracking_token") or ""
    track_url = f"{SITE_URL}/pedido/seguimiento/{ref}?t={token}"
    es_flex = str(tracking_number).strip().lower() == "flex"
    carrier = (carrier or "").strip() or (
        "Mensajero motorizado (mismo día)" if es_flex else "Transportadora"
    )
    name_esc = html_module.escape(str(order.get("buyer_name", "cliente")))
    ref_esc = html_module.escape(str(ref))
    car_esc = html_module.escape(str(carrier))
    track_esc = html_module.escape(track_url)

    if es_flex:
        subj = f"Tu pedido {ref} va en mensajería el mismo día — McKenna Group"
        text = f"""Hola {order.get('buyer_name', 'cliente')},

Tu pedido {ref} va en camino por mensajero motorizado el mismo día (sin número de guía de transportadora).

Modalidad: {carrier}

Puedes ver el resumen del pedido aquí:
{track_url}

Cualquier duda, escríbenos por WhatsApp.

— McKenna Group
"""
        preheader = f"Pedido {ref} — envío mismo día por mensajero"
        inner = f"""
<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{_MCK_MUTED};">Despacho</p>
<p style="margin:0 0 20px 0;font-size:22px;font-weight:800;letter-spacing:-0.5px;color:{_MCK_GREEN_DEEP};line-height:1.25;">¡Tu envío va en camino hoy!</p>
<p style="margin:0 0 18px 0;">Hola <strong style="color:{_MCK_GREEN_DARK};">{name_esc}</strong>,</p>
<p style="margin:0 0 22px 0;color:{_MCK_GREEN_DEEP};">El pedido <strong style="color:{_MCK_GREEN};">{ref_esc}</strong> salió por <strong>mensajero motorizado</strong> el mismo día. No aplica guía de transportadora tradicional.</p>
<table role="presentation" width="100%" style="margin:0 0 24px 0;background:{_MCK_BG};border-radius:12px;border:1px solid rgba(12,96,105,0.12);">
  <tr><td style="padding:16px 18px;">
    <p style="margin:0 0 8px 0;font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">Modalidad</p>
    <p style="margin:0;font-family:{_MCK_FONT};font-size:16px;font-weight:700;color:{_MCK_GREEN_DEEP};">{car_esc}</p>
  </td></tr>
</table>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 16px 0;" width="100%"><tr><td align="center">
  <a href="{track_esc}" style="display:inline-block;padding:14px 28px;background:{_MCK_GREEN};color:#ffffff !important;font-family:{_MCK_FONT};font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;border:2px solid {_MCK_GREEN_DARK};">Ver detalle del pedido</a>
</td></tr></table>
<p style="margin:0;font-size:14px;color:{_MCK_MUTED};">¿Dudas? Escríbenos por WhatsApp desde <a href="{html_module.escape(SITE_URL + "/contacto")}" style="color:{_MCK_GREEN};font-weight:600;">mckennagroup.co</a>.</p>
""".strip()
        html = _wrap_mckenna_email(preheader=preheader, inner_html=inner)
        return subj, text, html

    guia_esc = html_module.escape(str(tracking_number))
    subj = f"Tu pedido {ref} va en camino — McKenna Group"
    text = f"""Hola {order.get('buyer_name', 'cliente')},

Tu pedido {ref} ya fue despachado.

Transportadora: {carrier}
Número de guía: {tracking_number}

Puedes ver el estado aquí:
{track_url}

Cualquier duda, escríbenos por WhatsApp.

— McKenna Group
"""
    preheader = f"Tu pedido {ref} va en camino — Guía {tracking_number}"
    inner = f"""
<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{_MCK_MUTED};">Despacho</p>
<p style="margin:0 0 20px 0;font-size:22px;font-weight:800;letter-spacing:-0.5px;color:{_MCK_GREEN_DEEP};line-height:1.25;">¡Tu envío va en camino!</p>
<p style="margin:0 0 18px 0;">Hola <strong style="color:{_MCK_GREEN_DARK};">{name_esc}</strong>,</p>
<p style="margin:0 0 22px 0;color:{_MCK_GREEN_DEEP};">El pedido <strong style="color:{_MCK_GREEN};">{ref_esc}</strong> ya salió de bodega.</p>
<table role="presentation" width="100%" style="margin:0 0 24px 0;background:{_MCK_BG};border-radius:12px;border:1px solid rgba(12,96,105,0.12);">
  <tr><td style="padding:16px 18px;">
    <p style="margin:0 0 8px 0;font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">Transportadora</p>
    <p style="margin:0 0 16px 0;font-family:{_MCK_FONT};font-size:16px;font-weight:700;color:{_MCK_GREEN_DEEP};">{car_esc}</p>
    <p style="margin:0 0 8px 0;font-family:{_MCK_FONT};font-size:13px;color:{_MCK_MUTED};">Número de guía</p>
    <p style="margin:0;font-family:{_MCK_FONT};font-size:18px;font-weight:800;color:{_MCK_GREEN};letter-spacing:0.5px;">{guia_esc}</p>
  </td></tr>
</table>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 16px 0;" width="100%"><tr><td align="center">
  <a href="{track_esc}" style="display:inline-block;padding:14px 28px;background:{_MCK_GREEN};color:#ffffff !important;font-family:{_MCK_FONT};font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;border:2px solid {_MCK_GREEN_DARK};">Ver seguimiento del pedido</a>
</td></tr></table>
<p style="margin:0;font-size:14px;color:{_MCK_MUTED};">¿Dudas? Escríbenos por WhatsApp desde <a href="{html_module.escape(SITE_URL + "/contacto")}" style="color:{_MCK_GREEN};font-weight:600;">mckennagroup.co</a>.</p>
""".strip()
    html = _wrap_mckenna_email(preheader=preheader, inner_html=inner)
    return subj, text, html


def send_shipped_email(order: dict, tracking_number: str, carrier: str) -> bool:
    subj, text, html = _build_shipped_email_content(order, tracking_number, carrier)
    email = (order.get("buyer_email") or "").strip()
    if not email:
        return False
    return _send_smtp(email, subj, text, html)


def _format_whatsapp_pedido(order: dict) -> str:
    """Aviso operativo al grupo de guías/envíos con los datos clave del pedido."""
    try:
        data = json.loads(order.get("items_json") or "{}")
    except json.JSONDecodeError:
        data = {}
    items = data.get("items") or []
    n = len(items)
    item_lines = []
    for it in items[:8]:
        name = str(it.get("name") or "Producto").strip()
        ref_item = str(it.get("ref") or "").strip()
        qty = it.get("qty", 1)
        price = it.get("price", 0)
        try:
            price_s = f"${float(price):,.0f}".replace(",", ".")
        except (TypeError, ValueError):
            price_s = str(price or "—")
        item_lines.append(f"• {name} x{qty} — {price_s} ({ref_item})")
    if n > 8:
        item_lines.append(f"• +{n - 8} ítem(s) más")
    items_txt = "\n".join(item_lines) if item_lines else "• (sin detalle)"
    ref = order["reference"]
    pay = order.get("payu_ref") or "—"
    total = f"${order.get('total', 0):,.0f}".replace(",", ".")
    city = order.get("buyer_city", "") or "—"
    dept = data.get("dept") or "—"
    address = data.get("address") or "—"
    cedula = data.get("cedula") or "—"
    notes = data.get("notes") or "—"
    shipping = data.get("shipping") or 0
    try:
        shipping_s = f"${float(shipping):,.0f}".replace(",", ".")
    except (TypeError, ValueError):
        shipping_s = str(shipping or "—")
    billing = data.get("billing") or {}
    bill_name = billing.get("name") or order.get("buyer_name", "") or "—"
    bill_nit = billing.get("nit") or cedula
    bill_email = billing.get("email") or order.get("buyer_email", "") or "—"
    bill_addr = billing.get("address") or address
    suf = ref[-3:].upper() if len(ref) >= 3 else ref.upper()
    return (
        f"🛒 *Web pagado* `{ref}`\n"
        f"💰 *{total} COP* · MP `{pay}`\n"
        f"\n"
        f"👤 *Cliente:* {order.get('buyer_name', '')}\n"
        f"🪪 *CC/NIT:* {cedula}\n"
        f"📧 *Email:* {order.get('buyer_email', '')}\n"
        f"📱 *Tel:* {order.get('buyer_phone', '')}\n"
        f"📍 *Envío:* {address} · {city}, {dept}\n"
        f"🚚 *Costo envío:* {shipping_s} COP\n"
        f"📝 *Notas:* {notes}\n"
        f"\n"
        f"🧾 *Facturar a:* {bill_name} · {bill_nit}\n"
        f"📧 *Email factura:* {bill_email}\n"
        f"🏢 *Dirección factura:* {bill_addr}\n"
        f"\n"
        f"📦 *Ítems ({n}):*\n{items_txt}\n"
        f"\n"
        f"📋 *Cómo responder en este grupo* (copiar y ajustar):\n"
        f"• Pedir factura en Siigo/registro:\n"
        f"  _facturar {suf}_\n"
        f"  _(también vale la ref completa: facturar {ref})_\n"
        f"• Registrar guía de transportadora:\n"
        f"  _envio {suf} 1234567890 Interrapidísimo_\n"
        f"  _(el número es la guía real; la transportadora al final es opcional)_\n"
        f"• Envío mismo día / mensajero (sin número de guía):\n"
        f"  _envio {suf} flex_\n"
        f"• Anular venta (devuelve stock web):\n"
        f"  _anular {suf}_\n"
    )


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "si", "sí"}


def _web_siigo_auto_invoice_enabled() -> bool:
    """Tienda ↔ Siigo: tras pago aprobado emitir FE (WEB_SIIGO_AUTO_INVOICE=0 desactiva; ausente/vacío = sí)."""
    raw = os.getenv("WEB_SIIGO_AUTO_INVOICE")
    if raw is None or not str(raw).strip():
        return True
    return _env_bool("WEB_SIIGO_AUTO_INVOICE", False)


def _whatsapp_pedido_factura_siigo_reportable(ok: bool, out: str) -> bool:
    """Solo emisión nueva o error (evita doble WA si return + IPN y la FE ya existe)."""
    if not (out or "").strip():
        return False
    if not ok:
        return True
    return "Factura automática web emitida" in out


def _es_invoice_id_alegra(invoice_id: str | None) -> bool:
    """Los ids de Alegra son enteros pequeños ("1", "2"...); los de Siigo son
    UUID con guiones. Distingue sin depender de la fecha de la factura —
    pedidos web facturados antes de que este archivo migrara a Alegra
    (2026-09-03) siguen con un `siigo_invoice_id` real de Siigo en la BD."""
    invoice_id = str(invoice_id or "").strip()
    return bool(invoice_id) and invoice_id.isdigit()


def _siigo_invoice_url(invoice_id: str | None) -> str:
    invoice_id = str(invoice_id or "").strip()
    if not invoice_id:
        return ""
    if _es_invoice_id_alegra(invoice_id):
        return f"https://app.alegra.com/invoice/view/id/{invoice_id}"
    # Bug real hasta este fix: toda factura Siigo histórica generaba un link a
    # app.alegra.com que no existe — no era solo un detalle de texto.
    return f"https://siigonube.siigo.com/#/invoice/843/{invoice_id}"


def _proveedor_factura_web(invoice_id: str | None) -> str:
    return "Alegra" if _es_invoice_id_alegra(invoice_id) else "Siigo"


def _money_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _shipping_sku_for_amount(amount: float) -> str:
    amount_int = int(round(amount))
    env_key = f"WEB_SIIGO_SHIPPING_CODE_{amount_int}"
    override = os.getenv(env_key, "").strip()
    if override:
        return override
    legacy = os.getenv("WEB_SIIGO_SHIPPING_CODE", "").strip()
    if legacy:
        return legacy
    prefix = os.getenv("WEB_SIIGO_SHIPPING_SKU_PREFIX", "WEB-ENVIO").strip() or "WEB-ENVIO"
    return f"{prefix}-{amount_int}"


def _qty_float(value) -> float:
    try:
        qty = float(value)
    except (TypeError, ValueError):
        qty = 1.0
    return qty if qty > 0 else 1.0


def _update_invoice_state(reference: str, **fields) -> None:
    allowed = {
        "siigo_invoice_id",
        "siigo_invoice_number",
        "siigo_invoice_status",
        "siigo_invoice_cufe",
        "siigo_invoice_emitted_at",
        "siigo_invoice_error",
        "siigo_invoice_attempted_at",
        "siigo_invoice_email_sent_at",
        "invoice_requested_at",
    }
    updates = [(k, v) for k, v in fields.items() if k in allowed]
    if not updates:
        return
    set_sql = ", ".join(f"{k} = ?" for k, _ in updates)
    params = [v for _, v in updates]
    params.append(reference.strip().upper())
    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.execute(f"UPDATE orders SET {set_sql} WHERE upper(reference) = ?", params)
    con.commit()
    con.close()


def _parse_order_items_json(order: dict) -> tuple[dict, str | None]:
    try:
        data = json.loads(order.get("items_json") or "{}")
    except json.JSONDecodeError:
        return {}, "Detalle JSON del pedido inválido."
    if not isinstance(data, dict):
        return {}, "Detalle del pedido inválido."
    return data, None


def _build_siigo_web_invoice_lines(order: dict, data: dict) -> tuple[list[dict], str | None]:
    from app.services.alegra import buscar_producto_alegra_por_referencia

    items = data.get("items") or []
    if not items:
        return [], "El pedido no tiene ítems para facturar."

    # OJO: precio_unitario va SIEMPRE como el precio final (lo que pagó el cliente,
    # IVA incluido) — crear_factura_venta_alegra() descuenta el IVA internamente
    # usando el impuesto real de la ficha del producto en Alegra. NO restar el IVA
    # acá (bug confirmado en vivo el 2026-09-02: hacerlo dos veces sub-factura la venta).
    lines = []
    missing = []
    for it in items:
        code = str(it.get("ref") or "").strip()
        name = str(it.get("name") or "Producto").strip()
        qty = _qty_float(it.get("qty", 1))
        price = _money_float(it.get("price"), -1)
        if not code:
            missing.append(f"{name}: sin SKU/ref")
            continue
        if price < 0:
            missing.append(f"{code}: precio inválido")
            continue
        alegra_prod = buscar_producto_alegra_por_referencia(code)
        if not alegra_prod:
            missing.append(f"{code}: no existe en Alegra")
            continue
        lines.append({
            "codigo": code,
            "nombre": name,
            "cantidad": qty,
            "precio_unitario": price,
        })

    shipping = _money_float(data.get("shipping"), 0)
    if shipping > 0:
        shipping_code = _shipping_sku_for_amount(shipping)
        shipping_prod = buscar_producto_alegra_por_referencia(shipping_code) if shipping_code else None
        if shipping_code and not shipping_prod:
            # Montos nuevos (tarifas 2026 por peso) no tienen producto propio en Alegra:
            # cae al producto genérico de envío con precio variable por línea.
            generic = os.getenv("WEB_SIIGO_SHIPPING_CODE_GENERIC", "WEB-ENVIO-VAR").strip()
            shipping_prod = buscar_producto_alegra_por_referencia(generic) if generic else None
            if generic and shipping_prod:
                shipping_code = generic
            else:
                missing.append(
                    f"envío {shipping_code}: no existe en Alegra (ni el genérico {generic or 'WEB-ENVIO-VAR'})"
                )
                shipping_code = ""
        if not shipping_code:
            if not missing:
                missing.append("envío: no se pudo resolver SKU de envío")
        else:
            lines.append({
                "codigo": shipping_code,
                "nombre": os.getenv("WEB_SIIGO_SHIPPING_NAME", "Envío pedido web").strip()
                or "Envío pedido web",
                "cantidad": 1,
                "precio_unitario": shipping,
            })

    if missing:
        return [], "No puedo emitir factura automática: " + "; ".join(missing)
    return lines, None


def _build_web_order_siigo_observations(order: dict, data: dict, ref: str) -> str:
    """Texto para campo observations en Siigo: envío, facturación y contacto (como en checkout web)."""
    chunks: list[str] = []
    pay = (order.get("payu_ref") or "").strip() or "N/A"
    chunks.append(f"Pedido web {ref}. Mercado Pago: {pay}.")

    ship_addr = (data.get("address") or "").strip()
    city = (order.get("buyer_city") or "").strip()
    dept = (data.get("dept") or "").strip()
    loc = " — ".join(x for x in (city, dept) if x)
    if ship_addr or loc:
        if ship_addr and loc:
            chunks.append(f"ENVÍO: {ship_addr} | {loc}")
        elif ship_addr:
            chunks.append(f"ENVÍO: {ship_addr}")
        else:
            chunks.append(f"ENVÍO: {loc}")

    billing = data.get("billing") or {}
    bn = (billing.get("name") or "").strip()
    nit = (billing.get("nit") or data.get("cedula") or "").strip()
    be = (billing.get("email") or "").strip()
    ba = (billing.get("address") or "").strip()
    bc = (billing.get("city") or "").strip()
    fac: list[str] = []
    if bn:
        fac.append(bn)
    if nit:
        fac.append(f"NIT/CC {nit}")
    if be:
        fac.append(be)
    bill_loc = " — ".join(x for x in (ba, bc) if x)
    if bill_loc:
        fac.append(bill_loc)
    if fac:
        chunks.append("FACTURACIÓN: " + " · ".join(fac))

    phone = (order.get("buyer_phone") or "").strip()
    if phone:
        chunks.append(f"Tel: {phone}")
    notes = (data.get("notes") or "").strip()
    if notes:
        chunks.append(f"Notas pedido: {notes}")

    obs = " ".join(chunks)
    try:
        max_obs = int(os.getenv("WEB_SIIGO_OBSERVATIONS_MAX", "3900"))
    except (TypeError, ValueError):
        max_obs = 3900
    if len(obs) > max_obs:
        obs = obs[: max(0, max_obs - 3)] + "..."
    return obs


def _infer_siigo_city_codes_from_web_order(order: dict, data: dict) -> tuple[str, str]:
    """
    Códigos ciudad/departamento Siigo para dirección del tercero.
    Heurística: Bogotá → 11001 / 11; si no, variables de entorno o Bogotá por defecto.
    """
    blob = " ".join(
        [
            str(order.get("buyer_city") or ""),
            str(data.get("dept") or ""),
            str((data.get("billing") or {}).get("city") or ""),
        ]
    ).upper()
    if "BOGOT" in blob:
        return "11001", "11"
    return (
        (os.getenv("SIIGO_INVOICE_CUSTOMER_CITY_CODE") or "11001").strip(),
        (os.getenv("SIIGO_INVOICE_CUSTOMER_STATE_CODE") or "11").strip(),
    )


def _lock_order_for_siigo_invoice(reference: str, force: bool) -> tuple[dict | None, str | None]:
    ref = reference.strip().upper()
    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT * FROM orders WHERE upper(reference) = ?",
            (ref,),
        ).fetchone()
        if not row:
            con.rollback()
            return None, f"No encontré el pedido {ref}."
        order = _row_dict(row)
        if order.get("status") != "approved":
            con.rollback()
            return None, f"El pedido {ref} no está aprobado para facturar."
        if order.get("siigo_invoice_id"):
            con.rollback()
            return order, None
        if order.get("siigo_invoice_status") == "processing" and not force:
            con.rollback()
            return None, f"La factura de {ref} ya está en proceso."
        now = datetime.now().isoformat()
        con.execute(
            """UPDATE orders
               SET siigo_invoice_status = 'processing',
                   siigo_invoice_attempted_at = ?,
                   siigo_invoice_error = NULL,
                   invoice_requested_at = COALESCE(invoice_requested_at, ?)
               WHERE upper(reference) = ?""",
            (now, now, ref),
        )
        con.commit()
        return order, None
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def emitir_factura_siigo_pedido_web(reference: str, *, force: bool = False) -> tuple[bool, str]:
    """Emite/reintenta la factura Siigo de un pedido web aprobado, sin duplicarla.

    Datos tomados del checkout (``website.py`` → ``orders.items_json`` / columnas ``orders``):

    - **Tercero / FE:** nombre y NIT/CC de ``billing`` (fallback ``buyer_name`` / ``cedula``);
      email y teléfono de facturación; dirección fiscal = ``billing.address`` o envío ``address``.
    - **Observaciones:** bloques ENVÍO (calle, ciudad, depto) y FACTURACIÓN (nombre, NIT, email,
      dirección/ciudad facturación), MP y notas.
    - **Ciudad DIAN en Siigo:** heurística Bogotá (11001/11) desde ciudad/depto del pedido; si no,
      ``SIIGO_INVOICE_CUSTOMER_*`` en ``.env``.
    - **Sincronización:** si ``WEB_SIIGO_SYNC_CUSTOMER_BEFORE_INVOICE`` (default 1), se hace
      ``PUT`` del tercero en Siigo antes de facturar para que la FE no use una ficha antigua
      con el mismo documento.
    """
    migrate_orders_table()
    ref = (reference or "").strip().upper()
    if not ref:
        return False, "Referencia vacía."

    order, lock_msg = _lock_order_for_siigo_invoice(ref, force)
    if lock_msg:
        return False, lock_msg
    if not order:
        return False, f"No encontré el pedido {ref}."
    if order.get("siigo_invoice_id"):
        number = order.get("siigo_invoice_number") or order.get("siigo_invoice_id")
        status = order.get("siigo_invoice_status") or "emitida"
        cufe = order.get("siigo_invoice_cufe") or "pendiente/no registrado"
        proveedor = _proveedor_factura_web(order.get("siigo_invoice_id"))
        return True, (
            f"✅ *{ref}* ya tiene factura {proveedor} *{number}*.\n"
            f"Estado: {status}\n"
            f"CUFE: {cufe}\n"
            f"{_siigo_invoice_url(order.get('siigo_invoice_id'))}"
        )

    data, parse_error = _parse_order_items_json(order)
    if parse_error:
        _update_invoice_state(
            ref,
            siigo_invoice_status="error",
            siigo_invoice_error=parse_error,
        )
        return False, f"❌ *{ref}*: {parse_error}"

    lines, line_error = _build_siigo_web_invoice_lines(order, data)
    if line_error:
        _update_invoice_state(
            ref,
            siigo_invoice_status="error",
            siigo_invoice_error=line_error,
        )
        return False, f"❌ *{ref}*: {line_error}"

    billing = data.get("billing") or {}
    cedula = data.get("cedula") or ""
    address = data.get("address") or ""
    billing_name = billing.get("name") or order.get("buyer_name") or ""
    billing_nit = billing.get("nit") or cedula
    billing_email = billing.get("email") or order.get("buyer_email") or ""
    # Dirección en Siigo (cliente.address): preferir calle de facturación; si no, envío.
    fiscal_address_line = (billing.get("address") or "").strip() or (address or "").strip()
    total = _money_float(order.get("total"), 0)
    observations = _build_web_order_siigo_observations(order, data, ref)

    try:
        from app.services.alegra import crear_factura_venta_alegra

        # A diferencia de Siigo, crear_factura_venta_alegra() ya sincroniza el
        # contacto (nombre/dirección/email/teléfono frescos) internamente antes
        # de facturar — no hace falta un paso separado de sync.
        result = crear_factura_venta_alegra(
            nombre_cliente=billing_name,
            identificacion=billing_nit,
            direccion_envio=fiscal_address_line,
            productos=lines,
            total=total,
            email=billing_email,
            telefono=order.get("buyer_phone") or "",
            observaciones=observations,
            purchase_order=ref,
            descargar_pdf=True,
            enviar_dian=True,
            enviar_correo=_env_bool("WEB_SIIGO_SIIGO_MAIL", False),
        )
    except Exception as e:
        result = {"ok": False, "error": f"Error llamando Alegra: {e}"}

    now = datetime.now().isoformat()
    if result.get("ok"):
        invoice_id = str(result.get("invoice_id") or "")
        number = str(result.get("number") or invoice_id or "")
        status = str(result.get("status") or "emitida")
        cufe = str(result.get("cufe") or "")
        stamp = result.get("stamp") if isinstance(result.get("stamp"), dict) else {}
        stamp_error = stamp.get("errors") or stamp.get("observations") or None
        mail_customer = False
        # Solo enviar correo al cliente cuando DIAN aceptó el documento (CUFE real asignado).
        # Si está en Processing/retry, el hilo check_and_finalize_processing_invoices lo enviará
        # cuando Siigo confirme la aceptación.
        if status == "Accepted":
            try:
                mail_customer = send_siigo_invoice_email_to_customer(
                    order,
                    invoice_number=number,
                    invoice_id=invoice_id,
                    pdf_path=result.get("pdf_path"),
                    cufe=cufe,
                )
            except Exception as e:
                log.warning("Correo factura cliente %s: %s", ref, e)
        else:
            log.info(
                "Factura %s en estado '%s' — correo diferido hasta aceptación DIAN", ref, status
            )
        invoice_state: dict = dict(
            siigo_invoice_id=invoice_id,
            siigo_invoice_number=number,
            siigo_invoice_status=status,
            siigo_invoice_cufe=cufe or None,
            siigo_invoice_emitted_at=now,
            siigo_invoice_error=stamp_error,
        )
        if mail_customer:
            invoice_state["siigo_invoice_email_sent_at"] = now
        _update_invoice_state(ref, **invoice_state)
        cufe_line = f"CUFE: `{cufe}`\n" if cufe else "CUFE: pendiente/no recibido aún\n"
        used_fe_fallback = bool(_invoice_email_for_fe(order)[1])
        if mail_customer:
            mail_line = "Correo PDF cliente: enviado ✅\n"
        elif status != "Accepted":
            mail_line = f"Correo PDF cliente: diferido (DIAN en {status}) ⏳\n"
        elif _billing_email_from_order(order) or WEB_INVOICE_EMAIL_FALLBACK:
            mail_line = "Correo PDF cliente: no enviado (revisa SMTP o email en datos de facturación)\n"
        else:
            mail_line = "Correo PDF cliente: sin email en pedido ni fallback configurado\n"
        if mail_customer and used_fe_fallback and WEB_INVOICE_EMAIL_FALLBACK:
            mail_line += (
                f"_(Sin email en la venta → PDF a {WEB_INVOICE_EMAIL_FALLBACK})_\n"
            )
        return True, (
            f"✅ *Factura automática web emitida*\n"
            f"Pedido: *{ref}*\n"
            f"Factura Siigo: *{number}*\n"
            f"Estado DIAN/Siigo: {status}\n"
            f"{cufe_line}"
            f"{mail_line}"
            f"{result.get('url') or _siigo_invoice_url(invoice_id)}"
        )

    error = str(result.get("error") or "Siigo no emitió la factura.")
    _update_invoice_state(
        ref,
        siigo_invoice_status="error",
        siigo_invoice_error=error[:1000],
    )
    return False, f"❌ *{ref}*: {error}\nReintenta con *facturar {ref[-3:]}* cuando corrijas el dato."


def process_order_paid_side_effects(reference: str) -> None:
    """Efectos al aprobar pago (MercadoPago): orden `approved` desde ``website``.

    Pipeline idempotente (puede ejecutarse desde ``/pago/respuesta`` y/o IPN ``/pago/confirmacion``):

    1. Correo de confirmación al comprador (una vez).
    2. WhatsApp al grupo pedidos web con resumen (una vez).
    3. Factura electrónica en Siigo con datos del checkout cuando ``WEB_SIIGO_AUTO_INVOICE`` está activo:
       por defecto **activado** (variable ausente); ``WEB_SIIGO_AUTO_INVOICE=0`` en ``.env`` desactiva.
       La sync del tercero y la emisión están en ``emitir_factura_siigo_pedido_web``.
    """
    migrate_orders_table()
    ref = (reference or "").strip().upper()
    if not ref:
        return

    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT * FROM orders WHERE upper(reference) = ? AND status = 'approved'",
        (ref,),
    ).fetchone()
    con.close()
    if not row:
        return
    order = _row_dict(row)
    now = datetime.now().isoformat()

    if not order.get("stock_descontado_at"):
        try:
            from app.tools.stock_web import descontar_stock_web

            data, parse_error = _parse_order_items_json(order)
            if not parse_error:
                for it in data.get("items") or []:
                    sku = str(it.get("ref") or "").strip()
                    qty = _qty_float(it.get("qty", 0))
                    if sku and qty > 0:
                        descontar_stock_web(sku, int(qty))
            con = sqlite3.connect(ORDERS_DB)
            con.execute(
                "UPDATE orders SET stock_descontado_at = ? WHERE upper(reference) = ? "
                "AND stock_descontado_at IS NULL",
                (now, ref),
            )
            con.commit()
            con.close()
        except Exception as e:
            log.warning("Descuento de stock web %s: %s", ref, e)

    if not order.get("confirmation_email_sent_at") and order.get("buyer_email"):
        if send_order_confirmation_email(order):
            con = sqlite3.connect(ORDERS_DB)
            con.execute(
                "UPDATE orders SET confirmation_email_sent_at = ? WHERE upper(reference) = ? "
                "AND confirmation_email_sent_at IS NULL",
                (now, ref),
            )
            con.commit()
            con.close()

    con = sqlite3.connect(ORDERS_DB)
    con.row_factory = sqlite3.Row
    row2 = con.execute(
        "SELECT * FROM orders WHERE upper(reference) = ?", (ref,)
    ).fetchone()
    con.close()
    if not row2:
        return
    order2 = _row_dict(row2)

    if not order2.get("whatsapp_notified_at"):
        try:
            from app.utils import enviar_whatsapp_reporte

            body = _format_whatsapp_pedido(order2)
            if enviar_whatsapp_reporte(body, numero_destino=GRUPO_PEDIDOS_WEB_WA):
                con = sqlite3.connect(ORDERS_DB)
                con.execute(
                    "UPDATE orders SET whatsapp_notified_at = ? WHERE upper(reference) = ? "
                    "AND whatsapp_notified_at IS NULL",
                    (now, ref),
                )
                con.commit()
                con.close()
        except Exception as e:
            log.warning("WhatsApp pedido web: %s", e)

    if _web_siigo_auto_invoice_enabled():
        try:
            ok, out = emitir_factura_siigo_pedido_web(ref)
            if _whatsapp_pedido_factura_siigo_reportable(ok, out):
                from app.utils import enviar_whatsapp_reporte

                enviar_whatsapp_reporte(out, numero_destino=GRUPO_PEDIDOS_WEB_WA)
            if not ok:
                log.warning("Factura Siigo web pendiente/fallida %s: %s", ref, out)
        except Exception as e:
            log.warning("Factura Siigo web %s: %s", ref, e)


def registrar_envio_y_notificar(
    reference: str, tracking_number: str, carrier: str = ""
) -> tuple[bool, str]:
    migrate_orders_table()
    ref = reference.strip().upper()
    tracking_number = tracking_number.strip()
    es_flex = tracking_number.lower() == "flex"
    if es_flex:
        carrier_eff = (carrier or "").strip() or "Mensajero motorizado (mismo día)"
        tracking_store = "FLEX"
    else:
        if not tracking_number:
            return False, "Falta número de guía"
        carrier_eff = (carrier or "").strip() or "Interrapidísimo"
        tracking_store = tracking_number

    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT * FROM orders WHERE upper(reference) = ?", (ref,)
    ).fetchone()
    con.close()
    if not row:
        return False, "Pedido no encontrado"
    order = _row_dict(row)

    now = datetime.now().isoformat()
    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.execute(
        """UPDATE orders SET shipping_status = 'shipped', tracking_number = ?,
           tracking_carrier = ? WHERE upper(reference) = ?""",
        (tracking_store, carrier_eff, ref),
    )
    con.commit()
    con.close()

    order = get_order_by_reference(ref) or order
    if not order.get("shipped_email_sent_at"):
        if send_shipped_email(order, tracking_store, carrier_eff):
            con = sqlite3.connect(ORDERS_DB)
            con.execute(
                "UPDATE orders SET shipped_email_sent_at = ? WHERE upper(reference) = ?",
                (now, ref),
            )
            con.commit()
            con.close()

    if es_flex:
        return (
            True,
            "Envío *flex* (mismo día, sin guía) registrado; "
            "cliente notificado por correo si hay email y SMTP configurado.",
        )
    return True, "Guía registrada; cliente notificado por correo si hay email y SMTP configurado."


def marcar_solicitud_facturacion(reference: str) -> tuple[bool, str]:
    migrate_orders_table()
    ref = reference.strip().upper()
    con = sqlite3.connect(ORDERS_DB)
    cur = con.execute(
        "UPDATE orders SET invoice_requested_at = ? WHERE upper(reference) = ?",
        (datetime.now().isoformat(), ref),
    )
    con.commit()
    ok = cur.rowcount > 0
    con.close()
    if not ok:
        return False, f"No encontré el pedido {ref}."
    return emitir_factura_siigo_pedido_web(ref, force=True)


def registrar_entrega_y_facturar(reference: str) -> tuple[bool, str]:
    """
    Marca el pedido como entregado y dispara la factura Siigo en ESE momento
    (no al momento de la venta/aprobación). Reduce notas crédito por
    arrepentimiento del cliente entre la compra y la entrega.

    Idempotente: si ya tenía factura, emitir_factura_siigo_pedido_web() la
    devuelve sin duplicar (mismo dedup que usa 'facturar').
    """
    migrate_orders_table()
    ref = reference.strip().upper()
    order = get_order_by_reference(ref)
    if not order:
        return False, f"No encontré el pedido {ref}."

    now = datetime.now().isoformat()
    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.execute(
        """UPDATE orders SET shipping_status = 'delivered',
           delivered_at = COALESCE(delivered_at, ?) WHERE upper(reference) = ?""",
        (now, ref),
    )
    con.commit()
    con.close()

    ok, out = emitir_factura_siigo_pedido_web(ref, force=True)
    prefijo = "✅ Entrega registrada. " if ok else "⚠️ Entrega registrada, pero "
    return ok, prefijo + out


def anular_pedido_web(
    reference: str,
    *,
    reason: str = "",
    force: bool = False,
    notify_wa: bool = False,
) -> tuple[bool, str]:
    """Anula un pedido de la tienda web y restaura stock local si se había descontado.

    - `pending` / `approved` / `declined` / `no_realizado`: se pueden anular.
    - Ya `cancelled` / `refunded`: no-op con error.
    - Enviado (`shipping_status=shipped`): requiere `force=True`.
    - Si hay factura Siigo, anula igual pero avisa (no emite nota crédito automática).
    """
    migrate_orders_table()
    raw = (reference or "").strip()
    if not raw:
        return False, "Falta la referencia del pedido."

    ref, err = resolver_referencia_desde_token(raw)
    if err or not ref:
        return False, err or "No encontré el pedido."

    order = get_order_by_reference(ref)
    if not order:
        return False, f"No encontré el pedido {ref}."

    status = (order.get("status") or "").strip().lower()
    if status in ("cancelled", "canceled", "refunded"):
        return False, f"El pedido *{ref}* ya está anulado ({status})."

    ship = (order.get("shipping_status") or "").strip().lower()
    if ship == "shipped" and not force:
        return (
            False,
            f"El pedido *{ref}* ya tiene guía/envío. "
            f"Confirma con *force* (panel) o vuelve a intentar con anulación forzada.",
        )

    now = datetime.now().isoformat()
    motivo = (reason or "").strip()[:500]
    stock_restored = False
    restored_skus: list[str] = []

    if order.get("stock_descontado_at") and not order.get("stock_restaurado_at"):
        try:
            from app.tools.stock_web import restaurar_stock_web

            data, parse_error = _parse_order_items_json(order)
            if not parse_error:
                for it in data.get("items") or []:
                    sku = str(it.get("ref") or "").strip()
                    qty = _qty_float(it.get("qty", 0))
                    if sku and qty > 0:
                        restaurar_stock_web(sku, int(qty))
                        restored_skus.append(f"{sku}×{int(qty)}")
                        stock_restored = True
        except Exception as e:
            log.warning("Restaurar stock web %s: %s", ref, e)
            return False, f"No pude restaurar el stock de *{ref}*: {e}"

    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.execute(
        """
        UPDATE orders SET
            status = 'cancelled',
            cancelled_at = ?,
            cancel_reason = ?,
            stock_restaurado_at = COALESCE(stock_restaurado_at, ?)
        WHERE upper(reference) = ?
        """,
        (now, motivo or None, now if stock_restored else None, ref),
    )
    con.commit()
    con.close()

    parts = [f"✅ Pedido *{ref}* anulado."]
    if stock_restored:
        parts.append(f"Stock web restaurado: {', '.join(restored_skus)}.")
    elif order.get("stock_descontado_at"):
        parts.append("Stock ya estaba restaurado o no había ítems con SKU.")
    else:
        parts.append("No había descuento de stock (pedido sin stock descontado).")

    siigo_num = (order.get("siigo_invoice_number") or "").strip()
    if siigo_num:
        proveedor = _proveedor_factura_web(order.get("siigo_invoice_id"))
        try:
            from app.tools.notas_credito import crear_ticket_nota_credito

            _tk_ok, tk_msg = crear_ticket_nota_credito(
                canal="Web",
                referencia=ref,
                motivo=motivo,
                siigo_factura_numero=siigo_num,
                siigo_factura_estado=order.get("siigo_invoice_status"),
                siigo_factura_url=_siigo_invoice_url(order.get("siigo_invoice_id")),
                detalles_extra={"proveedor_factura": proveedor},
            )
            parts.append(f"⚠️ Tiene factura {proveedor} #{siigo_num}. {tk_msg}")
        except Exception as e:
            log.warning("Ticket nota crédito %s: %s", ref, e)
            parts.append(
                f"⚠️ Tiene factura {proveedor} #{siigo_num}: anula o nota crédito manual en {proveedor} si aplica "
                f"(no se pudo crear el ticket automático: {e})."
            )
    if motivo:
        parts.append(f"Motivo: {motivo}")

    msg = " ".join(parts)

    if notify_wa:
        try:
            from app.utils import enviar_whatsapp_reporte

            enviar_whatsapp_reporte(
                f"🚫 *Venta web anulada*\n{msg}",
                numero_destino=GRUPO_PEDIDOS_WEB_WA,
            )
        except Exception as e:
            log.warning("WA anular pedido web %s: %s", ref, e)

    return True, msg


def _mp_access_token() -> str:
    return (os.getenv("MP_ACCESS_TOKEN") or "").strip()


def _mp_consultar_pago(payment_id: str) -> dict:
    """GET /v1/payments/{id}. Retorna dict vacío si falla."""
    import requests

    pid = str(payment_id or "").strip()
    token = _mp_access_token()
    if not pid or not token:
        return {}
    try:
        res = requests.get(
            f"https://api.mercadopago.com/v1/payments/{pid}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if res.status_code == 200:
            data = res.json()
            return data if isinstance(data, dict) else {}
    except Exception as e:
        log.warning("MP consultar pago %s: %s", pid, e)
    return {}


def _fmt_cop(valor: float | int | None) -> str:
    try:
        n = float(valor or 0)
    except (TypeError, ValueError):
        n = 0.0
    return f"$ {n:,.0f}".replace(",", ".")


def _armar_recibo_reembolso(
    order: dict,
    *,
    payment_id: str,
    refund_data: dict,
    amount: float | None,
    motivo: str,
    already: bool = False,
) -> dict:
    """Recibo legible para panel / WhatsApp a partir de la respuesta MP + orden."""
    pay = _mp_consultar_pago(payment_id) if payment_id else {}
    refund_id = str(refund_data.get("id") or "").strip()
    st = str(refund_data.get("status") or ("approved" if not already else "refunded")).strip()
    monto_raw = refund_data.get("amount")
    if monto_raw is None:
        monto_raw = amount if amount is not None else order.get("total")
    try:
        monto = float(monto_raw or 0)
    except (TypeError, ValueError):
        monto = float(order.get("total") or 0)
    fecha = (
        str(refund_data.get("date_created") or "").strip()
        or datetime.now().isoformat(timespec="seconds")
    )
    metodo = (
        str(order.get("payment_method") or "").strip()
        or str(pay.get("payment_method_id") or "").strip()
        or "Mercado Pago"
    )
    pay_type = (
        str(order.get("payment_type") or "").strip()
        or str(pay.get("payment_type_id") or "").strip()
    )
    return {
        "titulo": "Recibo de reembolso — Mercado Pago",
        "pedido": str(order.get("reference") or "").upper(),
        "comprador": str(order.get("buyer_name") or "").strip(),
        "email": str(order.get("buyer_email") or "").strip(),
        "payment_id": str(payment_id),
        "refund_id": refund_id,
        "monto": monto,
        "monto_fmt": _fmt_cop(monto),
        "moneda": str(refund_data.get("currency_id") or pay.get("currency_id") or "COP"),
        "estado": st,
        "fecha": fecha,
        "metodo": metodo,
        "tipo_pago": pay_type,
        "motivo": (motivo or "").strip()[:500],
        "parcial": amount is not None,
        "ya_existia": bool(already),
        "mp_activity_url": (
            f"https://www.mercadopago.com.co/activities/{payment_id}"
            if payment_id
            else ""
        ),
    }


def _recibo_texto_plano(recibo: dict) -> str:
    lines = [
        recibo.get("titulo") or "Recibo de reembolso",
        f"Pedido: {recibo.get('pedido') or '—'}",
        f"Cliente: {recibo.get('comprador') or '—'}",
        f"Monto: {recibo.get('monto_fmt') or '—'} {recibo.get('moneda') or 'COP'}",
        f"Estado: {recibo.get('estado') or '—'}",
        f"Payment ID: {recibo.get('payment_id') or '—'}",
        f"Refund ID: {recibo.get('refund_id') or '—'}",
        f"Fecha: {recibo.get('fecha') or '—'}",
        f"Método: {recibo.get('metodo') or '—'}",
    ]
    if recibo.get("motivo"):
        lines.append(f"Motivo: {recibo['motivo']}")
    if recibo.get("mp_activity_url"):
        lines.append(f"Ver en MP: {recibo['mp_activity_url']}")
    return "\n".join(lines)


def _mp_reembolsar_pago(
    payment_id: str,
    *,
    amount: float | None = None,
    idempotency_key: str = "",
) -> tuple[bool, str, dict]:
    """POST /v1/payments/{id}/refunds en Mercado Pago.

    Retorna (ok, mensaje, refund_data). ``amount`` None = devolución total.
    """
    import requests

    pid = str(payment_id or "").strip()
    token = _mp_access_token()
    if not pid:
        return False, "Falta el payment_id de Mercado Pago.", {}
    if not token:
        return False, "Falta MP_ACCESS_TOKEN en el entorno (.env).", {}

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Idempotency-Key": (idempotency_key or str(uuid.uuid4())).strip()[:64],
    }
    body: dict = {}
    if amount is not None:
        try:
            amt = float(amount)
        except (TypeError, ValueError):
            return False, "Monto de reembolso inválido.", {}
        if amt <= 0:
            return False, "El monto de reembolso debe ser mayor a 0.", {}
        body["amount"] = round(amt, 2)

    try:
        res = requests.post(
            f"https://api.mercadopago.com/v1/payments/{pid}/refunds",
            headers=headers,
            json=body,
            timeout=30,
        )
    except Exception as e:
        log.warning("MP refund payment=%s: %s", pid, e)
        return False, f"Error de red al llamar Mercado Pago: {e}", {}

    data: dict = {}
    try:
        raw = res.json()
        if isinstance(raw, dict):
            data = raw
        elif isinstance(raw, list) and raw and isinstance(raw[0], dict):
            data = raw[0]
    except Exception:
        data = {}

    refund_id = str(data.get("id") or "").strip()
    st = str(data.get("status") or "").strip().lower()

    if res.status_code in (200, 201) and (st in ("approved", "refunded", "") or refund_id):
        msg = f"Reembolso MP #{refund_id or 'ok'} ({st or 'approved'})."
        return True, msg, data

    # Ya reembolsado / duplicado: tratar como éxito idempotente si MP lo indica.
    cause0 = ""
    causes = data.get("cause")
    if isinstance(causes, list) and causes and isinstance(causes[0], dict):
        cause0 = str(causes[0].get("description") or causes[0].get("code") or "")
    err_msg = (
        str(data.get("message") or "").strip()
        or cause0
        or str(data.get("error") or "").strip()
        or (res.text or "")[:200]
        or f"HTTP {res.status_code}"
    )
    err_l = str(err_msg).lower()
    if res.status_code in (400, 409) and any(
        x in err_l
        for x in ("already", "ya fue", "refunded", "reembols", "duplicat")
    ):
        # Completar con el último refund del pago si la respuesta no trae id.
        if not refund_id:
            pay = _mp_consultar_pago(pid)
            refunds = pay.get("refunds") if isinstance(pay, dict) else None
            if isinstance(refunds, list) and refunds:
                last = refunds[-1] if isinstance(refunds[-1], dict) else {}
                data = {
                    "id": last.get("id"),
                    "amount": last.get("amount"),
                    "status": last.get("status") or "approved",
                    "date_created": last.get("date_created"),
                    "currency_id": pay.get("currency_id") or "COP",
                    "payment_id": pid,
                }
                refund_id = str(data.get("id") or "").strip()
        return (
            True,
            f"El pago ya estaba reembolsado en Mercado Pago ({err_msg}).",
            {**data, "_already": True},
        )

    log.warning("MP refund falló payment=%s status=%s body=%s", pid, res.status_code, data or res.text[:300])
    return False, f"Mercado Pago rechazó el reembolso: {err_msg}", {}


def reembolsar_pedido_web(
    reference: str,
    *,
    reason: str = "",
    force: bool = False,
    amount: float | None = None,
    notify_wa: bool = False,
) -> tuple[bool, str, dict | None]:
    """Devuelve el dinero vía Mercado Pago y cierra el pedido como ``refunded``.

    Retorna ``(ok, mensaje, recibo)``. El recibo es un dict listo para UI cuando ok=True.
    """
    migrate_orders_table()
    raw = (reference or "").strip()
    if not raw:
        return False, "Falta la referencia del pedido.", None

    ref, err = resolver_referencia_desde_token(raw)
    if err or not ref:
        return False, err or "No encontré el pedido.", None

    order = get_order_by_reference(ref)
    if not order:
        return False, f"No encontré el pedido {ref}.", None

    status = (order.get("status") or "").strip().lower()
    if status == "refunded":
        recibo_prev = None
        raw_json = (order.get("mp_refund_json") or "").strip()
        if raw_json:
            try:
                parsed = json.loads(raw_json)
                if isinstance(parsed, dict):
                    recibo_prev = parsed
            except Exception:
                recibo_prev = None
        return False, f"El pedido *{ref}* ya está reembolsado.", recibo_prev

    # Con payment_id se puede reembolsar aunque el estado local sea "unknown"
    # (IPN incompleto). Solo bloqueamos pendientes / rechazados / no realizados.
    status_bloqueado = ("pending", "declined", "rejected", "no_realizado")
    if status in status_bloqueado:
        return (
            False,
            f"Solo se puede reembolsar un pedido con pago capturado "
            f"(estado actual: {status or '—'}).",
            None,
        )

    payment_id = str(order.get("payu_ref") or "").strip()
    if not payment_id:
        return (
            False,
            f"El pedido *{ref}* no tiene payment_id de Mercado Pago (payu_ref). "
            f"Reembolso manual en el panel de MP.",
            None,
        )

    ship = (order.get("shipping_status") or "").strip().lower()
    if ship == "shipped" and not force:
        return (
            False,
            f"El pedido *{ref}* ya tiene guía/envío. "
            f"Confirma con *force* (panel) para reembolsar de todas formas.",
            None,
        )

    motivo = (reason or "").strip()[:500] or "Reembolso desde panel (producto agotado / anulación)"
    idem = f"web-refund-{ref}-{payment_id}"[:64]
    ok_mp, msg_mp, refund_data = _mp_reembolsar_pago(
        payment_id,
        amount=amount,
        idempotency_key=idem,
    )
    if not ok_mp:
        return False, msg_mp, None

    already = bool(refund_data.pop("_already", False)) if isinstance(refund_data, dict) else False
    refund_id = str((refund_data or {}).get("id") or "").strip()
    recibo = _armar_recibo_reembolso(
        order,
        payment_id=payment_id,
        refund_data=refund_data or {},
        amount=amount,
        motivo=motivo,
        already=already,
    )

    now = datetime.now().isoformat()
    stock_restored = False
    restored_skus: list[str] = []

    if order.get("stock_descontado_at") and not order.get("stock_restaurado_at"):
        try:
            from app.tools.stock_web import restaurar_stock_web

            data, parse_error = _parse_order_items_json(order)
            if not parse_error:
                for it in data.get("items") or []:
                    sku = str(it.get("ref") or "").strip()
                    qty = _qty_float(it.get("qty", 0))
                    if sku and qty > 0:
                        restaurar_stock_web(sku, int(qty))
                        restored_skus.append(f"{sku}×{int(qty)}")
                        stock_restored = True
        except Exception as e:
            log.warning("Restaurar stock tras refund %s: %s", ref, e)

    recibo_json = json.dumps(recibo, ensure_ascii=False)
    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.execute(
        """
        UPDATE orders SET
            status = 'refunded',
            refunded_at = ?,
            mp_refund_id = COALESCE(?, mp_refund_id),
            mp_refund_json = ?,
            cancelled_at = COALESCE(cancelled_at, ?),
            cancel_reason = COALESCE(?, cancel_reason),
            stock_restaurado_at = COALESCE(stock_restaurado_at, ?)
        WHERE upper(reference) = ?
        """,
        (
            now,
            refund_id or None,
            recibo_json,
            now,
            motivo,
            now if stock_restored else None,
            ref,
        ),
    )
    con.commit()
    con.close()

    parts = [
        f"✅ Pedido *{ref}* reembolsado.",
        msg_mp,
        f"MP payment `{payment_id}`.",
    ]
    if amount is not None:
        parts.append(f"Monto parcial: {_fmt_cop(amount)} COP.")
    if stock_restored:
        parts.append(f"Stock web restaurado: {', '.join(restored_skus)}.")
    elif order.get("stock_descontado_at") and not order.get("stock_restaurado_at") and not stock_restored:
        parts.append("⚠️ No se pudo restaurar stock automáticamente; revisa inventario.")
    elif order.get("stock_descontado_at"):
        parts.append("Stock ya estaba restaurado.")
    else:
        parts.append("Sin descuento de stock previo.")

    siigo_num = (order.get("siigo_invoice_number") or "").strip()
    if siigo_num:
        proveedor = _proveedor_factura_web(order.get("siigo_invoice_id"))
        try:
            from app.tools.notas_credito import crear_ticket_nota_credito

            _tk_ok, tk_msg = crear_ticket_nota_credito(
                canal="Web",
                referencia=ref,
                motivo=motivo,
                siigo_factura_numero=siigo_num,
                siigo_factura_estado=order.get("siigo_invoice_status"),
                siigo_factura_url=_siigo_invoice_url(order.get("siigo_invoice_id")),
                detalles_extra={"proveedor_factura": proveedor},
            )
            parts.append(f"⚠️ Tiene factura {proveedor} #{siigo_num}. {tk_msg}")
        except Exception as e:
            log.warning("Ticket nota crédito (refund) %s: %s", ref, e)
            parts.append(
                f"⚠️ Tiene factura {proveedor} #{siigo_num}: gestiona nota crédito en {proveedor} "
                f"(no se pudo crear el ticket: {e})."
            )
    if motivo:
        parts.append(f"Motivo: {motivo}")

    msg = " ".join(parts)

    if notify_wa:
        try:
            from app.utils import enviar_whatsapp_reporte

            enviar_whatsapp_reporte(
                f"💸 *Reembolso web (Mercado Pago)*\n{msg}\n\n"
                f"🧾 *Recibo*\n{_recibo_texto_plano(recibo)}",
                numero_destino=GRUPO_PEDIDOS_WEB_WA,
            )
        except Exception as e:
            log.warning("WA reembolso pedido web %s: %s", ref, e)

    return True, msg, recibo


def marcar_pedidos_expirados(horas: int = 24) -> int:
    """Marca como 'no_realizado' todos los pedidos que llevan más de `horas` horas en 'pending'.

    Retorna el número de pedidos marcados.
    """
    if not ORDERS_DB.exists():
        return 0
    desde = (datetime.now() - timedelta(hours=horas)).isoformat()
    try:
        con = sqlite3.connect(ORDERS_DB, timeout=30)
        cur = con.execute(
            "UPDATE orders SET status = 'no_realizado' "
            "WHERE status = 'pending' AND created_at < ?",
            (desde,),
        )
        count = cur.rowcount
        con.commit()
        con.close()
        if count:
            log.info("marcar_pedidos_expirados: %d pedido(s) → no_realizado", count)
        return count
    except Exception as e:
        log.warning("marcar_pedidos_expirados: %s", e)
        return 0


def check_and_finalize_processing_invoices() -> int:
    """Re-consulta Alegra para facturas en estado Processing y envía correo cuando DIAN las acepta.

    Retorna el número de facturas cuyo correo se envió en esta ronda.
    """
    import requests as _requests

    if not ORDERS_DB.exists():
        return 0

    con = sqlite3.connect(ORDERS_DB, timeout=30)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """SELECT * FROM orders
           WHERE status = 'approved'
             AND siigo_invoice_id IS NOT NULL AND siigo_invoice_id != ''
             AND (siigo_invoice_email_sent_at IS NULL OR siigo_invoice_email_sent_at = '')
           ORDER BY id DESC LIMIT 20""",
    ).fetchall()
    con.close()

    if not rows:
        return 0

    from app.services.alegra import _alegra_headers, _ALEGRA_BASE

    try:
        headers = _alegra_headers()
    except RuntimeError:
        log.warning("check_and_finalize_processing_invoices: no pudo autenticar con Alegra")
        return 0

    finalized = 0

    for row in rows:
        order = _row_dict(row)
        invoice_id = str(order.get("siigo_invoice_id") or "")
        ref = order.get("reference") or ""
        try:
            res = _requests.get(
                f"{_ALEGRA_BASE}/invoices/{invoice_id}",
                headers=headers,
                timeout=15,
            )
            if res.status_code != 200:
                continue
            factura = res.json()
            stamp = factura.get("stamp") or {}
            # Alegra ya viene síncrono en la creación (a diferencia de Siigo, que a
            # veces queda "Processing" y hay que reconsultar) — este chequeo diferido
            # queda como red de seguridad por si algún día vuelve pendiente.
            stamp_status = stamp.get("legalStatus", "")

            if "ACCEPTED" not in stamp_status:
                continue

            cufe = stamp.get("cufe") or stamp.get("cude") or ""
            number = str(order.get("siigo_invoice_number") or invoice_id)
            pdf_path = _ensure_siigo_invoice_pdf_path(invoice_id, number, None)

            sent = False
            try:
                sent = send_siigo_invoice_email_to_customer(
                    order,
                    invoice_number=number,
                    invoice_id=invoice_id,
                    pdf_path=pdf_path,
                    cufe=cufe,
                )
            except Exception as e:
                log.warning("Correo factura diferida %s: %s", ref, e)

            updates: dict = {"siigo_invoice_status": stamp_status}
            if cufe:
                updates["siigo_invoice_cufe"] = cufe
            if sent:
                updates["siigo_invoice_email_sent_at"] = datetime.now().isoformat()
                finalized += 1
                log.info("Correo factura diferida enviado: %s (FE %s)", ref, number)

            _update_invoice_state(ref, **updates)

        except Exception as e:
            log.warning("check_and_finalize invoice %s: %s", invoice_id, e)

    return finalized
