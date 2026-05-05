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
from datetime import datetime
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
        from app.services.siigo import descargar_factura_pdf_siigo
        import base64

        b64 = descargar_factura_pdf_siigo(invoice_id)
        if not b64 or "Error" in str(b64):
            return None
        pdf_dir = _ROOT / "facturas_descargadas"
        pdf_dir.mkdir(parents=True, exist_ok=True)
        name = f"Factura_{invoice_number or invoice_id}.pdf"
        out = pdf_dir / name
        out.write_bytes(base64.b64decode(b64))
        return str(out)
    except Exception as e:
        log.warning("No se pudo descargar PDF Siigo %s: %s", invoice_id, e)
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
    )


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "si", "sí"}


def _siigo_invoice_url(invoice_id: str | None) -> str:
    return f"https://siigonube.siigo.com/#/invoice/843/{invoice_id}" if invoice_id else ""


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
    from app.services.siigo import buscar_producto_siigo_por_sku

    items = data.get("items") or []
    if not items:
        return [], "El pedido no tiene ítems para facturar."

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
        if not buscar_producto_siigo_por_sku(code):
            missing.append(f"{code}: no existe en Siigo")
            continue
        lines.append(
            {
                "codigo": code,
                "nombre": name,
                "cantidad": qty,
                "precio_unitario": price,
            }
        )

    shipping = _money_float(data.get("shipping"), 0)
    if shipping > 0:
        shipping_code = _shipping_sku_for_amount(shipping)
        if not shipping_code:
            missing.append("envío: no se pudo resolver SKU de envío")
        elif not buscar_producto_siigo_por_sku(shipping_code):
            missing.append(f"envío {shipping_code}: no existe en Siigo")
        else:
            lines.append(
                {
                    "codigo": shipping_code,
                    "nombre": os.getenv("WEB_SIIGO_SHIPPING_NAME", "Envío pedido web").strip()
                    or "Envío pedido web",
                    "cantidad": 1,
                    "precio_unitario": shipping,
                }
            )

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
        return True, (
            f"✅ *{ref}* ya tiene factura Siigo *{number}*.\n"
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
        from app.services.siigo import crear_factura_venta_siigo, sincronizar_tercero_siigo_antes_factura_web

        city_code, state_code = _infer_siigo_city_codes_from_web_order(order, data)
        if _env_bool("WEB_SIIGO_SYNC_CUSTOMER_BEFORE_INVOICE", True):
            sync = sincronizar_tercero_siigo_antes_factura_web(
                nombre_cliente=billing_name,
                identificacion=billing_nit,
                direccion=fiscal_address_line,
                email=billing_email,
                telefono=order.get("buyer_phone") or "",
                city_code=city_code,
                state_code=state_code,
            )
            if not sync.get("ok"):
                log.warning("Siigo sync tercero antes de factura %s: %s", ref, sync.get("error"))
        else:
            log.info("WEB_SIIGO_SYNC_CUSTOMER_BEFORE_INVOICE=0: omito sync tercero Siigo para %s", ref)

        result = crear_factura_venta_siigo(
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
            # Siigo envía al correo de la cuenta (p. ej. facturasmckennagroup@gmail.com).
            # El PDF al cliente va por SMTP (send_siigo_invoice_email_to_customer).
            enviar_correo=_env_bool("WEB_SIIGO_SIIGO_MAIL", False),
            customer_city_code=city_code,
            customer_state_code=state_code,
        )
    except Exception as e:
        result = {"ok": False, "error": f"Error llamando Siigo: {e}"}

    now = datetime.now().isoformat()
    if result.get("ok"):
        invoice_id = str(result.get("invoice_id") or "")
        number = str(result.get("number") or invoice_id or "")
        status = str(result.get("status") or "emitida")
        cufe = str(result.get("cufe") or "")
        stamp = result.get("stamp") if isinstance(result.get("stamp"), dict) else {}
        stamp_error = stamp.get("errors") or stamp.get("observations") or None
        mail_customer = False
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
        _update_invoice_state(
            ref,
            siigo_invoice_id=invoice_id,
            siigo_invoice_number=number,
            siigo_invoice_status=status,
            siigo_invoice_cufe=cufe or None,
            siigo_invoice_emitted_at=now,
            siigo_invoice_error=stamp_error,
        )
        cufe_line = f"CUFE: `{cufe}`\n" if cufe else "CUFE: pendiente/no recibido aún\n"
        used_fe_fallback = bool(_invoice_email_for_fe(order)[1])
        mail_line = (
            "Correo PDF cliente: enviado ✅\n"
            if mail_customer
            else (
                "Correo PDF cliente: no enviado (revisa SMTP o email en datos de facturación)\n"
                if _billing_email_from_order(order) or WEB_INVOICE_EMAIL_FALLBACK
                else "Correo PDF cliente: sin email en pedido ni fallback configurado\n"
            )
        )
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
    """Idempotente: correo cliente + WhatsApp grupo ventas web (una vez cada uno)."""
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

    if _env_bool("WEB_SIIGO_AUTO_INVOICE", False):
        try:
            ok, out = emitir_factura_siigo_pedido_web(ref)
            if out:
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
