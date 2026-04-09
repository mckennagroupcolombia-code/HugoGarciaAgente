"""
Skill para generar el reporte de SKUs de WooCommerce vs SIIGO y enviarlo por correo.
"""

import os
import json
import time
import unicodedata
import base64
import requests
from email.mime.text import MIMEText
from datetime import datetime

from woocommerce import API
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.utils import refrescar_token_meli

# ── Config ────────────────────────────────────────────────────────────────────
SIIGO_CREDS_PATH  = "/home/mckg/mi-agente/credenciales_SIIGO.json"
TOKEN_GMAIL_PATH  = "/home/mckg/mi-agente/app/tools/token_gmail.json"
PARTNER_ID        = "SiigoAPI"
MELI_SELLER_ID    = 432439187
WRITE_THRESHOLD   = 0.65
MATCH_THRESHOLD   = 0.55
WC_URL            = os.getenv("WC_URL", "").rstrip("/")
WC_KEY            = os.getenv("WC_KEY", "")
WC_SECRET         = os.getenv("WC_SECRET", "")
DEFAULT_RECIPIENT = "cynthua0418@gmail.com"

def _normalize(text: str) -> str:
    if not text: return ""
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_str.lower().split())

def _token_overlap_ratio(a: str, b: str) -> float:
    ta = set(_normalize(a).split())
    tb = set(_normalize(b).split())
    if not ta or not tb: return 0.0
    return len(ta & tb) / max(len(ta), len(tb))

def _best_name_match_full(name: str, candidates: list, key: str = "name"):
    best_score = 0.0
    best_item = None
    for cand in candidates:
        score = _token_overlap_ratio(name, cand.get(key, ""))
        if score > best_score:
            best_score = score
            best_item = cand
    return best_item, best_score

def _extraer_sku_meli(item: dict) -> str:
    sku = (item.get("seller_custom_field") or "").strip()
    if sku: return sku
    for attr in item.get("attributes", []):
        if attr.get("id") == "SELLER_SKU":
            val = (attr.get("value_name") or "").strip()
            if val: return val
    return ""

def _get_siigo_token() -> str:
    with open(SIIGO_CREDS_PATH) as f:
        creds = json.load(f)
    if time.time() < creds.get("token_vencimiento", 0):
        return creds["access_token"]
    r = requests.post(
        "https://api.siigo.com/auth",
        json={"username": creds["username"], "access_key": creds["api_key"]},
        headers={"Partner-Id": PARTNER_ID},
        timeout=15,
    )
    r.raise_for_status()
    token = r.json()["access_token"]
    creds.update({"access_token": token, "token_vencimiento": time.time() + 23 * 3600})
    with open(SIIGO_CREDS_PATH, "w") as f:
        json.dump(creds, f)
    return token

def _get_siigo_products(token: str) -> list:
    headers = {"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"}
    all_prods = []
    page = 1
    while True:
        url = f"https://api.siigo.com/v1/products?page={page}&page_size=100"
        r = requests.get(url, headers=headers, timeout=20)
        if r.status_code != 200: break
        data = r.json()
        results = data.get("results", [])
        if not results: break
        all_prods.extend(results)
        total = data.get("pagination", {}).get("total_results", 0)
        if len(all_prods) >= total: break
        page += 1
        time.sleep(0.2)
    return all_prods

def _get_woocommerce_products(wcapi) -> list:
    all_prods = []
    page = 1
    while True:
        r = wcapi.get("products", params={
            "status": "publish", "per_page": 100, "page": page, "_fields": "id,name,sku"
        })
        if r.status_code != 200: break
        batch = r.json()
        if not batch: break
        all_prods.extend(batch)
        if len(batch) < 100: break
        page += 1
        time.sleep(0.3)
    return all_prods

def _get_meli_items(meli_token: str) -> list:
    headers = {"Authorization": f"Bearer {meli_token}"}
    all_ids = []
    offset = 0
    while True:
        url = (f"https://api.mercadolibre.com/users/{MELI_SELLER_ID}/items/search"
               f"?status=active&offset={offset}&limit=100")
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code != 200: break
        data = r.json()
        batch = data.get("results", [])
        if not batch: break
        all_ids.extend(batch)
        total = data.get("paging", {}).get("total", 0)
        offset += 100
        if offset >= total: break
        time.sleep(0.3)

    items_detail = []
    for i in range(0, len(all_ids), 20):
        batch_ids = all_ids[i:i + 20]
        ids_param = ",".join(batch_ids)
        url = (f"https://api.mercadolibre.com/items?ids={ids_param}"
               f"&attributes=id,title,seller_custom_field,attributes")
        r = requests.get(url, headers=headers, timeout=20)
        if r.status_code == 200:
            for entry in r.json():
                body = entry.get("body", {})
                if entry.get("code") == 200 and body:
                    items_detail.append(body)
        time.sleep(0.3)
    return items_detail

def _html_style():
    return """
<style>
  body { font-family: Arial, sans-serif; color: #222; background: #f9f9f9; margin: 0; padding: 20px; }
  .container { max-width: 900px; margin: auto; background: white; border-radius: 8px;
               padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  h1 { color: #1a3a5c; border-bottom: 3px solid #1a3a5c; padding-bottom: 10px; }
  h2 { color: #2c5f8a; margin-top: 30px; border-left: 4px solid #2c5f8a; padding-left: 10px; }
  h3 { color: #3a7abf; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0 20px 0; font-size: 13px; }
  th { background: #1a3a5c; color: white; padding: 8px 10px; text-align: left; }
  td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; }
  tr:nth-child(even) { background: #f4f7fb; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-weight: bold;
           font-size: 13px; margin: 2px; }
  .green  { background: #d4edda; color: #155724; }
  .yellow { background: #fff3cd; color: #856404; }
  .red    { background: #f8d7da; color: #721c24; }
  .blue   { background: #d1ecf1; color: #0c5460; }
  .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0; }
  .summary-card { border-radius: 8px; padding: 15px 20px; text-align: center; }
  .stat-num { font-size: 2em; font-weight: bold; }
  .stat-lbl { font-size: 0.85em; margin-top: 4px; }
  .score-bar { display: inline-block; height: 10px; background: #2c5f8a;
               border-radius: 5px; vertical-align: middle; margin-right: 5px; }
  .footer { margin-top: 40px; font-size: 12px; color: #888; border-top: 1px solid #e0e0e0;
            padding-top: 15px; }
  .category-section { margin: 15px 0; padding: 12px 15px; background: #f8f9fa;
                      border-radius: 6px; border: 1px solid #dee2e6; }
  .category-title { font-weight: bold; color: #495057; margin-bottom: 8px; }
</style>
"""

def _build_html_report(updated, skipped_sku, below_thresh, no_match, meli_not_in_siigo, total_wc, report_date):
    lines = []
    lines.append(f"""<!DOCTYPE html><html><head><meta charset="UTF-8">{_html_style()}</head><body>
<div class="container">
<h1>Reporte de Asignacion de SKUs — WooCommerce</h1>
<p style="color:#555; font-size:14px;">Generado: {report_date} | McKenna Group</p>

<h2>Resumen General</h2>
<div class="summary-grid">
  <div class="summary-card" style="background:#d4edda; color:#155724;">
    <div class="stat-num">{len(updated)}</div>
    <div class="stat-lbl">Productos actualizados con SKU nuevo</div>
  </div>
  <div class="summary-card" style="background:#d1ecf1; color:#0c5460;">
    <div class="stat-num">{len(skipped_sku)}</div>
    <div class="stat-lbl">Ya tenian SKU (no modificados)</div>
  </div>
  <div class="summary-card" style="background:#fff3cd; color:#856404;">
    <div class="stat-num">{len(below_thresh)}</div>
    <div class="stat-lbl">Bajo umbral (0.55–0.65) — revision manual</div>
  </div>
  <div class="summary-card" style="background:#f8d7da; color:#721c24;">
    <div class="stat-num">{len(no_match)}</div>
    <div class="stat-lbl">Sin coincidencia en SIIGO (< 0.55)</div>
  </div>
</div>

<table>
  <tr>
    <th>Categoria</th><th>Cantidad</th><th>Estado</th><th>Accion</th>
  </tr>
  <tr>
    <td>Actualizados con SKU SIIGO</td>
    <td><strong>{len(updated)}</strong></td>
    <td><span class="badge green">Completado</span></td>
    <td>SKU asignado en WooCommerce</td>
  </tr>
  <tr>
    <td>Ya tenian SKU</td>
    <td><strong>{len(skipped_sku)}</strong></td>
    <td><span class="badge blue">Sin cambio</span></td>
    <td>No se modificaron</td>
  </tr>
  <tr>
    <td>Coincidencia baja (0.55–0.65)</td>
    <td><strong>{len(below_thresh)}</strong></td>
    <td><span class="badge yellow">Pendiente</span></td>
    <td>Requiere revision manual</td>
  </tr>
  <tr>
    <td>Sin coincidencia (< 0.55)</td>
    <td><strong>{len(no_match)}</strong></td>
    <td><span class="badge red">Sin match</span></td>
    <td>Crear producto en SIIGO o revisar nombre</td>
  </tr>
  <tr>
    <td><strong>Total WC productos</strong></td>
    <td><strong>{total_wc}</strong></td>
    <td colspan="2">&nbsp;</td>
  </tr>
</table>
""")

    lines.append("""
<h2>1. Productos Actualizados</h2>
<p>Los siguientes productos de WooCommerce recibieron su codigo SKU de SIIGO con una
   puntuacion de coincidencia >= 0.65.</p>
<table>
  <tr>
    <th>#</th><th>ID WC</th><th>Nombre WooCommerce</th><th>SKU SIIGO asignado</th>
    <th>Nombre SIIGO</th><th>Score</th>
  </tr>
""")
    for i, p in enumerate(sorted(updated, key=lambda x: -x["score"]), 1):
        score_pct = int(p["score"] * 100)
        lines.append(f"""  <tr>
    <td>{i}</td><td>{p["id"]}</td><td>{p["name"]}</td>
    <td><code>{p["sku"]}</code></td><td>{p["siigo_name"]}</td>
    <td><span class="score-bar" style="width:{score_pct}px"></span>{p["score"]:.2f}</td>
  </tr>""")
    lines.append("</table>")

    lines.append("""
<h2>2. Coincidencia Baja — Zona 0.55-0.65</h2>
<p>Estos productos tienen una coincidencia parcial con SIIGO pero el score es
   insuficiente para asignacion automatica. <strong>Requieren revision manual.</strong></p>
<table>
  <tr>
    <th>#</th><th>ID WC</th><th>Nombre WooCommerce</th>
    <th>Mejor coincidencia SIIGO</th><th>Codigo SIIGO</th><th>Score</th>
  </tr>
""")
    for i, p in enumerate(sorted(below_thresh, key=lambda x: -x["score"]), 1):
        score_pct = int(p["score"] * 100)
        lines.append(f"""  <tr>
    <td>{i}</td><td>{p["id"]}</td><td>{p["name"]}</td>
    <td>{p["siigo_name"]}</td><td><code>{p["siigo_code"]}</code></td>
    <td><span class="score-bar" style="width:{score_pct}px" style="background:#f0ad4e"></span>{p["score"]:.2f}</td>
  </tr>""")
    lines.append("</table>")
    lines.append("""<p><em>Sugerencia: Si la coincidencia es correcta, asignar el SKU manualmente
en WooCommerce. Si no, crear el producto en SIIGO con el nombre exacto del WC.</em></p>""")

    lines.append("""
<h2>3. Sin Coincidencia en SIIGO</h2>
<p>Productos con score < 0.55. No se asigno SKU. Agrupados por categoria.</p>
""")
    aminoacidos = [(p, "L-*") for p in no_match
                   if "L -" in p["name"].upper() or "L-" in p["name"].upper()
                   or "/AMINOACIDO" in p["name"].upper().replace(" ", "")
                   or "AMINOACIDO" in p["name"].upper()
                   or "AMINOÁCIDO" in p["name"].upper()
                   or "BCAA" in p["name"].upper()
                   or p["name"].upper().startswith("L ")]

    accents_keywords = ["CAFEÍNA", "CAFEINA", "BÓRAX", "BORAX", "UREA", "DEXTROSA",
                        "FRUCTOSA", "INULINA", "NIACINAMIDA", "PAPAÍNA", "PAPAINA",
                        "MENTOL", "MALTODEXTRINA", "COLOFONIA", "ALULOSA", "ALANTOÍNA",
                        "ALANTOINA", "COCOAMIDA", "DMSO", "AZUFRE", "LANOLINA",
                        "COLÁGENO", "COLAGENO", "CREATINA", "SHAROMIX"]
    special_chars = []
    for p in no_match:
        name_up = p["name"].upper()
        if any(kw in name_up for kw in accents_keywords):
            if p not in [x[0] for x in aminoacidos]:
                special_chars.append(p)

    non_pharma_keywords = ["KIT REPARADOR", "PLAGUICIDA", "JABÓN", "JABON",
                           "PRENSA", "ROOMBA", "IROBOT", "REPUESTO", "CAPSULAS DE GELATINA",
                           "CERA LANETTE", "TÉ MATCHA", "TE MATCHA", "COLÁGENO MARINO",
                           "ELASTINA", "VITAMINA A", "ACEITE DE ARGÁN", "ACEITE DE ARGAN",
                           "EXTRACTO DE MALTA", "AGAR AGAR", "ACEITE ESENCIAL ROMERO",
                           "GLUTARALDEHIDO", "POLISORBATO", "CELULOSA MICRO"]
    non_pharma = []
    for p in no_match:
        name_up = p["name"].upper()
        already = ([x[0] for x in aminoacidos] + special_chars)
        if p not in already and any(kw in name_up for kw in non_pharma_keywords):
            non_pharma.append(p)

    amino_items = [x[0] for x in aminoacidos]
    other_no_match = [p for p in no_match if p not in amino_items and p not in special_chars and p not in non_pharma]

    def render_group(title, items, desc):
        if not items: return ""
        rows = ""
        for i, p in enumerate(items, 1):
            rows += f"""  <tr>
    <td>{i}</td><td>{p["id"]}</td><td>{p["name"]}</td><td>{p["best_score"]:.2f}</td>
    <td style="color:#888;font-size:12px">{p.get("best_siigo","")[:40] if p.get("best_siigo") else "—"}</td>
  </tr>"""
        return f"""
<div class="category-section">
<div class="category-title">{title} ({len(items)} productos)</div>
<p style="font-size:13px;color:#666;margin:0 0 8px">{desc}</p>
<table>
  <tr><th>#</th><th>ID WC</th><th>Nombre WooCommerce</th><th>Mejor score</th><th>Mejor candidato SIIGO</th></tr>
  {rows}
</table>
</div>"""

    lines.append(render_group("3a. Aminoacidos (L-*)", amino_items, "Usan formato L-"))
    lines.append(render_group("3b. Productos con acentos", special_chars, "Difieren por detalles adicionales."))
    lines.append(render_group("3c. Productos no farmaceuticos / accesorios", non_pharma, "Kits, accesorios, equipo."))
    if other_no_match:
        lines.append(render_group("3d. Otros sin coincidencia", other_no_match, "Revisar nombres en SIIGO."))

    lines.append(f"""
<h2>4. SKUs de MercadoLibre sin producto en SIIGO ({len(meli_not_in_siigo)} SKUs)</h2>
<table>
  <tr><th>#</th><th>SKU MeLi</th><th>Titulo publicacion MeLi</th><th>ID MeLi</th></tr>
""")
    for i, e in enumerate(sorted(meli_not_in_siigo, key=lambda x: x["sku"]), 1):
        lines.append(f"""  <tr><td>{i}</td><td><code>{e["sku"]}</code></td><td>{e["title"]}</td><td><small>{e["id"]}</small></td></tr>""")
    lines.append("</table>")

    lines.append(f"""
<div class="footer">
  <p>Reporte generado automaticamente por el agente McKenna Group el {report_date}.</p>
  <p>Umbral de escritura: &ge;0.65 | Umbral de display: &ge;0.55</p>
</div>
</div></body></html>""")

    return "\n".join(lines)

def _send_email(subject: str, html_body: str, recipient: str):
    creds = Credentials.from_authorized_user_file(
        TOKEN_GMAIL_PATH,
        scopes=["https://www.googleapis.com/auth/gmail.send"]
    )
    service = build("gmail", "v1", credentials=creds)

    message = MIMEText(html_body, "html", "utf-8")
    message["to"] = recipient
    message["subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return result

def generar_reporte_skus_woocommerce(email_destino: str = DEFAULT_RECIPIENT) -> str:
    """
    Genera el reporte de asignación de SKUs en WooCommerce y cruce con SIIGO y MercadoLibre.
    El reporte HTML se envía a un correo electrónico.
    """
    salida = []
    salida.append("📊 Iniciando generación de reporte de SKUs WC-SIIGO-MeLi...")

    try:
        siigo_token = _get_siigo_token()
        siigo_products = _get_siigo_products(siigo_token)
        salida.append(f"✅ {len(siigo_products)} productos SIIGO cargados.")
    except Exception as e:
        return f"❌ Error cargando productos de SIIGO: {e}"

    if not all([WC_URL, WC_KEY, WC_SECRET]):
        return "❌ Error: Faltan credenciales de WooCommerce en .env"
    
    try:
        wcapi = API(url=WC_URL, consumer_key=WC_KEY, consumer_secret=WC_SECRET, version="wc/v3", timeout=30)
        wc_products = _get_woocommerce_products(wcapi)
        salida.append(f"✅ {len(wc_products)} productos WooCommerce cargados.")
    except Exception as e:
        return f"❌ Error cargando productos de WooCommerce: {e}"

    updated = []
    skipped_sku = []
    below_thresh = []
    no_match = []

    for wcp in wc_products:
        wc_id = wcp.get("id")
        wc_name = (wcp.get("name") or "").strip()
        wc_sku = (wcp.get("sku") or "").strip()

        if wc_sku:
            best_item, score = _best_name_match_full(wc_name, siigo_products, key="name")
            siigo_code = (best_item.get("code") or "").strip() if best_item else ""
            siigo_name = (best_item.get("name") or "").strip() if best_item else ""
            if score >= WRITE_THRESHOLD and siigo_code == wc_sku:
                updated.append({"id": wc_id, "name": wc_name, "sku": wc_sku, "score": round(score, 2), "siigo_name": siigo_name})
            else:
                skipped_sku.append({"id": wc_id, "name": wc_name, "sku": wc_sku})
            continue

        best_item, score = _best_name_match_full(wc_name, siigo_products, key="name")

        if score < MATCH_THRESHOLD:
            best_siigo_name = (best_item.get("name") or "") if best_item else ""
            no_match.append({"id": wc_id, "name": wc_name, "best_score": round(score, 2), "best_siigo": best_siigo_name})
            continue

        sku_siigo = (best_item.get("code") or "").strip()
        siigo_name = (best_item.get("name") or "").strip()

        if score < WRITE_THRESHOLD:
            below_thresh.append({"id": wc_id, "name": wc_name, "siigo_code": sku_siigo, "siigo_name": siigo_name, "score": round(score, 2)})
        else:
            updated.append({"id": wc_id, "name": wc_name, "sku": sku_siigo, "score": round(score, 2), "siigo_name": siigo_name})

    salida.append(f"🔍 Cruce listo: {len(updated)} Actualizados | {len(skipped_sku)} Ignorados | {len(below_thresh)} Pendientes | {len(no_match)} Sin Match")

    try:
        meli_token = refrescar_token_meli()
        meli_items = _get_meli_items(meli_token)
        siigo_by_code = { (p.get("code") or "").strip().upper(): p for p in siigo_products if p.get("code") }
        meli_not_in_siigo = []
        for item in meli_items:
            sku = _extraer_sku_meli(item)
            if sku and sku.upper() not in siigo_by_code:
                meli_not_in_siigo.append({"id": item.get("id"), "title": item.get("title", ""), "sku": sku})
        salida.append(f"✅ {len(meli_not_in_siigo)} SKUs en MercadoLibre no encontrados en SIIGO.")
    except Exception as e:
        salida.append(f"⚠️ Error cargando datos de MeLi: {e}")
        meli_not_in_siigo = []

    report_date = datetime.now().strftime("%Y-%m-%d")
    html_body = _build_html_report(updated, skipped_sku, below_thresh, no_match, meli_not_in_siigo, len(wc_products), report_date)

    subject = f"Reporte SKUs WooCommerce - McKenna Group [{report_date}]"
    try:
        res = _send_email(subject, html_body, email_destino)
        salida.append(f"📧 Correo enviado exitosamente a {email_destino} (Msg ID: {res.get('id')})")
    except Exception as e:
        salida.append(f"❌ Error al enviar el correo con el reporte: {e}")

    return "\n".join(salida)
