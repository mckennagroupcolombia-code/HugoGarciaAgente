#!/usr/bin/env python3
"""
Genera y envía por email un catálogo de productos WooCommerce enriquecido con precios de SIIGO.
"""

import os
import sys
import json
import time
import base64
import requests
from datetime import datetime
from email.mime.text import MIMEText
from dotenv import load_dotenv

# --- Cargar variables de entorno ---
load_dotenv('/home/mckg/mi-agente/.env')

# ── WooCommerce ──────────────────────────────────────────────────────────────

def obtener_todos_los_productos_wc():
    """Obtiene TODOS los productos publicados de WooCommerce con paginación."""
    from woocommerce import API

    wcapi = API(
        url=os.getenv('WC_URL'),
        consumer_key=os.getenv('WC_KEY'),
        consumer_secret=os.getenv('WC_SECRET'),
        version="wc/v3",
        timeout=30
    )

    todos = []
    page = 1
    print("Obteniendo productos de WooCommerce...")
    while True:
        resp = wcapi.get("products", params={
            "status": "publish",
            "per_page": 100,
            "page": page,
            "fields": "id,name,sku,price,stock_quantity,status"
        })
        if resp.status_code != 200:
            print(f"  Error WooCommerce página {page}: {resp.status_code} - {resp.text[:200]}")
            break
        lote = resp.json()
        if not lote:
            break
        todos.extend(lote)
        print(f"  Página {page}: {len(lote)} productos (total hasta ahora: {len(todos)})")
        if len(lote) < 100:
            break
        page += 1

    print(f"Total productos WooCommerce: {len(todos)}")
    return todos


# ── SIIGO ────────────────────────────────────────────────────────────────────

PARTNER_ID = "SiigoAPI"

def autenticar_siigo():
    ruta_json = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
    if not os.path.exists(ruta_json):
        print(f"Advertencia: credenciales SIIGO no encontradas en {ruta_json}")
        return None
    with open(ruta_json) as f:
        creds = json.load(f)

    if time.time() < creds.get("token_vencimiento", 0):
        return creds["access_token"]

    res = requests.post(
        "https://api.siigo.com/auth",
        json={"username": creds["username"], "access_key": creds["api_key"]},
        headers={"Partner-Id": PARTNER_ID},
        timeout=10
    )
    if res.status_code == 200:
        token = res.json().get("access_token")
        creds.update({"access_token": token, "token_vencimiento": time.time() + 23 * 3600})
        with open(ruta_json, "w") as f:
            json.dump(creds, f)
        return token
    else:
        print(f"Error autenticación SIIGO: {res.status_code}")
        return None


def obtener_todos_los_productos_siigo(token):
    """
    Descarga todos los productos del catálogo SIIGO con paginación.
    Retorna un dict {code: producto} para búsqueda rápida por SKU/código.
    """
    if not token:
        return {}

    todos = []
    page = 1
    print("Obteniendo productos de SIIGO...")
    while True:
        res = requests.get(
            f"https://api.siigo.com/v1/products?page={page}&page_size=100",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=15
        )
        if res.status_code != 200:
            print(f"  Error SIIGO página {page}: {res.status_code}")
            break
        data = res.json()
        resultados = data.get("results", [])
        if not resultados:
            break
        todos.extend(resultados)
        print(f"  Página {page}: {len(resultados)} productos (total: {len(todos)})")
        pagination = data.get("pagination", {})
        total_results = pagination.get("total_results", len(todos))
        if len(todos) >= total_results:
            break
        page += 1

    # Indexar por 'code' (que equivale al SKU) en minúsculas para búsqueda insensible a mayúsculas
    indice = {}
    for p in todos:
        code = (p.get("code") or "").strip()
        if code:
            indice[code.lower()] = p
            indice[code] = p  # también guardar con case original
    print(f"Total productos SIIGO: {len(todos)}")
    return indice


def precio_de_siigo(producto_siigo):
    """Extrae el primer precio de venta del producto SIIGO."""
    try:
        return producto_siigo["prices"][0]["price_list"][0]["value"]
    except (IndexError, KeyError, TypeError):
        return None


# ── HTML ─────────────────────────────────────────────────────────────────────

def formatear_precio(valor):
    """Formatea un número como $X,XXX COP"""
    if valor is None or valor == "" or valor == 0:
        return "—"
    try:
        v = float(valor)
        if v == 0:
            return "—"
        return f"${v:,.0f} COP".replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return "—"


def construir_html(productos_tabla, fecha_str):
    filas_html = ""
    for i, row in enumerate(productos_tabla):
        bg = "#ffffff" if i % 2 == 0 else "#f5f7fa"
        disponibilidad = row["disponibilidad"]
        if disponibilidad == "En stock":
            disp_style = "color:#27ae60;font-weight:600;"
        elif disponibilidad == "Sin stock":
            disp_style = "color:#e74c3c;font-weight:600;"
        else:
            disp_style = "color:#7f8c8d;"

        sku_display = row["sku"] if row["sku"] else '<em style="color:#aaa;">(sin referencia)</em>'

        filas_html += f"""
        <tr style="background:{bg};">
            <td style="padding:10px 14px;border-bottom:1px solid #e9ecef;">{row['nombre']}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e9ecef;font-family:monospace;">{sku_display}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e9ecef;text-align:right;">{row['precio_fmt']}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e9ecef;text-align:center;{disp_style}">{disponibilidad}</td>
        </tr>"""

    total_productos = len(productos_tabla)
    con_precio = sum(1 for r in productos_tabla if r["precio_fmt"] != "—")
    sin_referencia = sum(1 for r in productos_tabla if not r["sku"])

    html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Catálogo de Productos - McKenna Group</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f0f2f5;color:#2c3e50;">

<!-- Encabezado -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1a3a5c 0%,#2980b9 100%);">
  <tr>
    <td style="padding:36px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:1px;">McKenna Group</h1>
      <p style="margin:6px 0 0;color:#aed6f1;font-size:14px;">Materias Primas Farmacéuticas · Bogotá, Colombia</p>
    </td>
    <td style="padding:36px 40px;text-align:right;vertical-align:middle;">
      <p style="margin:0;color:#aed6f1;font-size:13px;">Catálogo generado el</p>
      <p style="margin:4px 0 0;color:#ffffff;font-size:15px;font-weight:600;">{fecha_str}</p>
    </td>
  </tr>
</table>

<!-- Título sección -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-bottom:3px solid #2980b9;">
  <tr>
    <td style="padding:22px 40px;">
      <h2 style="margin:0;font-size:20px;color:#1a3a5c;">Catálogo de Productos Disponibles</h2>
      <p style="margin:6px 0 0;color:#7f8c8d;font-size:13px;">
        {total_productos} productos · {con_precio} con precio · {sin_referencia} sin referencia SKU
      </p>
    </td>
  </tr>
</table>

<!-- Tabla de productos -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:0;">
  <thead>
    <tr style="background:#1a3a5c;">
      <th style="padding:12px 14px;text-align:left;color:#ffffff;font-size:13px;font-weight:600;width:45%;">Nombre del Producto</th>
      <th style="padding:12px 14px;text-align:left;color:#ffffff;font-size:13px;font-weight:600;width:20%;">SKU / Referencia</th>
      <th style="padding:12px 14px;text-align:right;color:#ffffff;font-size:13px;font-weight:600;width:20%;">Precio</th>
      <th style="padding:12px 14px;text-align:center;color:#ffffff;font-size:13px;font-weight:600;width:15%;">Disponibilidad</th>
    </tr>
  </thead>
  <tbody>
    {filas_html}
  </tbody>
</table>

<!-- Footer -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#2c3e50;margin-top:0;">
  <tr>
    <td style="padding:28px 40px;">
      <p style="margin:0;color:#bdc3c7;font-size:13px;line-height:1.7;">
        <strong style="color:#ffffff;">McKenna Group S.A.S.</strong><br>
        Bogotá, Colombia · Tel: +57 311 817 2528<br>
        mckenna.group.colombia@gmail.com · mckennagroup.co<br><br>
        <em style="color:#95a5a6;font-size:12px;">
          Los precios indicados son de referencia y pueden variar según volumen, condiciones de pago y disponibilidad.
          Para cotizaciones formales o pedidos, contáctenos directamente.
        </em>
      </p>
    </td>
  </tr>
</table>

</body>
</html>"""
    return html


# ── Gmail ─────────────────────────────────────────────────────────────────────

def enviar_email(asunto, cuerpo_html, destinatario):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    SCOPES = ['https://www.googleapis.com/auth/gmail.send']
    token_path = '/home/mckg/mi-agente/app/tools/token_gmail.json'

    creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    service = build('gmail', 'v1', credentials=creds)

    message = MIMEText(cuerpo_html, 'html', 'utf-8')
    message['to'] = destinatario
    message['subject'] = asunto

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    resultado = service.users().messages().send(userId='me', body={'raw': raw}).execute()
    return resultado


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  CATÁLOGO DE PRODUCTOS - McKenna Group")
    print("=" * 60)

    # 1. Productos WooCommerce
    productos_wc = obtener_todos_los_productos_wc()
    if not productos_wc:
        print("No se obtuvieron productos de WooCommerce. Abortando.")
        sys.exit(1)

    # 2. Productos SIIGO
    token_siigo = autenticar_siigo()
    catalogo_siigo = obtener_todos_los_productos_siigo(token_siigo) if token_siigo else {}

    # 3. Construir tabla
    print("\nEnriqueciendo datos con precios SIIGO...")
    productos_tabla = []
    sin_precio_wc = 0
    enriquecidos_siigo = 0

    for p in productos_wc:
        nombre = (p.get("name") or "").strip()
        sku = (p.get("sku") or "").strip()
        precio_wc = p.get("price", "")
        stock = p.get("stock_quantity")

        # Precio: primero WooCommerce, luego SIIGO por SKU
        precio_final = None
        fuente_precio = "WC"

        if precio_wc and float(precio_wc) > 0:
            precio_final = float(precio_wc)
        elif sku:
            # Buscar en SIIGO (insensible a mayúsculas)
            prod_siigo = catalogo_siigo.get(sku) or catalogo_siigo.get(sku.lower())
            if prod_siigo:
                precio_siigo = precio_de_siigo(prod_siigo)
                if precio_siigo and precio_siigo > 0:
                    precio_final = precio_siigo
                    fuente_precio = "SIIGO"
                    enriquecidos_siigo += 1
            if precio_final is None:
                sin_precio_wc += 1
        else:
            sin_precio_wc += 1

        # Disponibilidad
        if stock is None:
            disponibilidad = "Consultar"
        elif stock > 0:
            disponibilidad = "En stock"
        else:
            disponibilidad = "Sin stock"

        productos_tabla.append({
            "nombre": nombre,
            "sku": sku,
            "precio_final": precio_final,
            "precio_fmt": formatear_precio(precio_final),
            "disponibilidad": disponibilidad,
            "fuente_precio": fuente_precio,
        })

    # Ordenar alfabéticamente por nombre
    productos_tabla.sort(key=lambda x: x["nombre"].lower())

    print(f"  Productos procesados: {len(productos_tabla)}")
    print(f"  Con precio (WC): {len(productos_tabla) - sin_precio_wc - enriquecidos_siigo}")
    print(f"  Enriquecidos con SIIGO: {enriquecidos_siigo}")
    print(f"  Sin precio: {sin_precio_wc}")

    # 4. Generar HTML
    fecha_str = datetime.now().strftime("%d de %B de %Y").replace(
        "January","enero").replace("February","febrero").replace("March","marzo").replace(
        "April","abril").replace("May","mayo").replace("June","junio").replace(
        "July","julio").replace("August","agosto").replace("September","septiembre").replace(
        "October","octubre").replace("November","noviembre").replace("December","diciembre")

    html = construir_html(productos_tabla, fecha_str)

    # 5. Enviar email
    destinatario = "cynthua0418@gmail.com"
    asunto = f"Catálogo de Productos - McKenna Group ({fecha_str})"
    print(f"\nEnviando email a {destinatario}...")

    try:
        resultado = enviar_email(asunto, html, destinatario)
        print(f"Email enviado exitosamente. ID del mensaje: {resultado.get('id')}")
    except Exception as e:
        print(f"Error al enviar el email: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print("\n" + "=" * 60)
    print("  PROCESO COMPLETADO")
    print("=" * 60)
    print(f"  Destinatario : {destinatario}")
    print(f"  Productos    : {len(productos_tabla)}")
    print(f"  Asunto       : {asunto}")
    print("=" * 60)


if __name__ == "__main__":
    main()
