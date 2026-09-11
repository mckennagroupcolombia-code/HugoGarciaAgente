"""Marco visual e identidad de los correos que McKenna envía a terceros.

Vivía embebido en `web_pedidos.py`, donde nació para los pedidos de la tienda.
Al necesitarlo también los correos de préstamos se sacó aquí en vez de
copiarlo: dos plantillas de marca que se editan por separado terminan
divergiendo, y el tercero que recibe ambas nota la diferencia.

`firma_html()` cierra el correo con el nombre real de quien lo manda — el
remitente SMTP es una cuenta genérica de la empresa, así que sin este bloque la
correspondencia financiera llega sin una persona detrás.
"""

from __future__ import annotations

import html as _html
import os

from app.services import empresa as _empresa

SITE_URL = (os.getenv("SITE_URL") or "https://mckennagroup.co").rstrip("/")

# Paleta alineada con PAGINA_WEB/site/static/css/main.css
VERDE = "#0c6069"
VERDE_OSCURO = "#045159"
VERDE_PROFUNDO = "#022d33"
VERDE_CLARO = "#6aacb3"
FONDO = "#e3fcff"
TENUE = "#3a7e87"
FUENTE = "Montserrat, Helvetica Neue, Arial, sans-serif"
LOGO_URL = f"{SITE_URL}/static/img/isotipo.png"


def marco(*, preheader: str, inner_html: str) -> str:
    """Envuelve el cuerpo en la plantilla de marca (fondo aqua, barra verde, logo)."""
    pre = _html.escape(preheader)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<title>McKenna Group</title>
</head>
<body style="margin:0;padding:0;background-color:{FONDO};">
  <div style="display:none;font-size:1px;color:{FONDO};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{pre}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:{FONDO};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(12,96,105,0.18);box-shadow:0 4px 24px rgba(2,45,51,0.06);">
          <tr>
            <td style="background:{VERDE};padding:18px 24px;text-align:center;border-bottom:2px solid {VERDE_OSCURO};">
              <table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <img src="{LOGO_URL}" alt="" width="44" height="44" style="display:block;border:0;">
                </td>
                <td style="vertical-align:middle;text-align:left;">
                  <div style="font-family:{FUENTE};font-weight:800;font-size:17px;color:{FONDO};letter-spacing:-0.3px;line-height:1.2;">McKenna Group</div>
                  <div style="font-family:{FUENTE};font-size:9px;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:rgba(227,252,255,0.85);margin-top:4px;">Materias primas</div>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 28px 28px;font-family:{FUENTE};font-size:15px;line-height:1.75;color:{VERDE_PROFUNDO};">
              {inner_html}
            </td>
          </tr>
          <tr>
            <td style="background:{VERDE_PROFUNDO};padding:20px 24px;text-align:center;">
              <p style="margin:0;font-family:{FUENTE};font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:rgba(227,252,255,0.75);">McKenna Group S.A.S. · Bogotá, Colombia</p>
              <p style="margin:10px 0 0 0;font-family:{FUENTE};font-size:13px;">
                <a href="{_html.escape(SITE_URL)}" style="color:{VERDE_CLARO};text-decoration:none;font-weight:600;">mckennagroup.co</a>
                &nbsp;·&nbsp;
                <a href="{_html.escape(SITE_URL + "/catalogo")}" style="color:{VERDE_CLARO};text-decoration:none;">Catálogo</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def firma_html() -> str:
    """Bloque de cierre con la persona que firma, no solo la razón social."""
    rep = _empresa.representante_legal()
    correo = (os.getenv("EMAIL_FROM") or os.getenv("SMTP_USER") or "").strip()
    linea_correo = (
        f'<br><a href="mailto:{_html.escape(correo)}" style="color:{VERDE};text-decoration:none;">'
        f"{_html.escape(correo)}</a>"
        if correo
        else ""
    )
    return (
        f'<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:26px;border-top:1px solid rgba(12,96,105,0.18);">'
        f'<tr><td style="padding-top:16px;font-family:{FUENTE};font-size:13px;line-height:1.6;color:{VERDE_PROFUNDO};">'
        f'<strong style="font-size:14px;color:{VERDE};">{_html.escape(rep["nombre"])}</strong><br>'
        f'<span style="color:{TENUE};">{_html.escape(rep["cargo"])} · {_html.escape(_empresa.razon_social())}</span><br>'
        f'<span style="color:{TENUE};">NIT {_html.escape(_empresa.nit())} · {_html.escape(_empresa.ciudad())}</span>'
        f"{linea_correo}"
        f"</td></tr></table>"
    )


def firma_texto() -> str:
    """La misma firma para la versión en texto plano del correo."""
    rep = _empresa.representante_legal()
    correo = (os.getenv("EMAIL_FROM") or os.getenv("SMTP_USER") or "").strip()
    partes = [
        rep["nombre"],
        f"{rep['cargo']} · {_empresa.razon_social()}",
        f"NIT {_empresa.nit()} · {_empresa.ciudad()}",
    ]
    if correo:
        partes.append(correo)
    partes.append(SITE_URL.replace("https://", ""))
    return "\n".join(partes)
