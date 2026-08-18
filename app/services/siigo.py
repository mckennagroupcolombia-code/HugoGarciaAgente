import os
import json
import time
import copy
import requests
import base64
import re
import xml.etree.ElementTree as ET
from io import BytesIO
from datetime import datetime, timedelta

# Variable de configuración para la API de Siigo
PARTNER_ID = "SiigoAPI"


def _ruta_credenciales_siigo():
    return os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")


def _invalidar_cache_token_siigo():
    """Si el Bearer está revocado o caducó antes del cache, forzar nuevo POST /auth."""
    ruta_json = _ruta_credenciales_siigo()
    try:
        if not os.path.exists(ruta_json):
            return
        with open(ruta_json, "r") as f:
            creds = json.load(f)
        creds["token_vencimiento"] = 0
        creds.pop("access_token", None)
        with open(ruta_json, "w") as f:
            json.dump(creds, f)
    except Exception:
        pass


def _siigo_get(url: str, *, params: dict | None = None, timeout: int = 25):
    """GET a Siigo con reintento automático si el Bearer en caché devolvió 401."""
    token = autenticar_siigo()
    if not token:
        return None
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
    for _ in range(2):
        try:
            res = requests.get(url, params=params, headers=headers, timeout=timeout)
        except requests.RequestException:
            return None
        if res.status_code == 401:
            _invalidar_cache_token_siigo()
            token = autenticar_siigo(forzar=True)
            if not token:
                return None
            headers["Authorization"] = f"Bearer {token}"
            continue
        return res
    return None


def autenticar_siigo(forzar=False):
    """
    Autentica con la API de Siigo para obtener un token de acceso.
    Maneja el cacheo del token para no re-autenticar en cada llamada.
    """
    try:
        # TODO: Centralizar la gestión de credenciales en lugar de un path hard-coded.
        ruta_json = _ruta_credenciales_siigo()
        if not os.path.exists(ruta_json):
            print(f"⚠️ Error Crítico: El archivo de credenciales de SIIGO no se encuentra en {ruta_json}")
            return None

        with open(ruta_json, "r") as f:
            creds = json.load(f)

        if not forzar and time.time() < creds.get("token_vencimiento", 0):
            return creds["access_token"]

        res = requests.post(
            "https://api.siigo.com/auth",
            json={"username": creds["username"], "access_key": creds["api_key"]},
            headers={"Partner-Id": PARTNER_ID},
            timeout=10
        )

        if res.status_code == 200:
            token = res.json().get("access_token")
            creds.update({"access_token": token, "token_vencimiento": time.time() + (23 * 3600)})
            with open(ruta_json, "w") as f:
                json.dump(creds, f)
            return token
        else:
            print(f"⚠️ Error de autenticación Siigo: {res.status_code} - {res.text}")

    except Exception as e:
        print(f"⚠️ Error crítico en autenticación Siigo: {e}")
    
    return None


def listar_centros_costo_siigo() -> tuple[list | None, str | None]:
    """Centros de costo activos en Siigo (API v1/cost-centers)."""
    token = autenticar_siigo()
    if not token:
        return None, "No se pudo autenticar con Siigo"

    def _fetch(bearer: str):
        return requests.get(
            "https://api.siigo.com/v1/cost-centers",
            headers={"Authorization": f"Bearer {bearer}", "Partner-Id": PARTNER_ID},
            timeout=15,
        )

    try:
        res = _fetch(token)
        if res.status_code == 401:
            _invalidar_cache_token_siigo()
            token = autenticar_siigo(forzar=True)
            if not token:
                return None, "Sesión Siigo expirada"
            res = _fetch(token)
        if res.status_code != 200:
            return None, f"Siigo respondió {res.status_code}"
        data = res.json()
        raw = data if isinstance(data, list) else data.get("results", [])
        centros = []
        for c in raw:
            if not isinstance(c, dict):
                continue
            centros.append({
                "id": c.get("id"),
                "code": c.get("code"),
                "name": c.get("name"),
                "active": c.get("active", True),
            })
        centros.sort(key=lambda x: (str(x.get("code") or ""), str(x.get("name") or "")))
        return centros, None
    except Exception as e:
        return None, str(e)


def obtener_facturas_siigo_paginadas(fecha_inicio, estricto: bool = False):
    """
    Obtiene todas las facturas de Siigo a partir de una fecha de inicio,
    manejando la paginación de la API.

    `estricto=True`: si la paginación se corta por un error de red a mitad de
    camino, relanza la excepción en vez de devolver la lista parcial en
    silencio. Por defecto queda en False para no cambiar el comportamiento de
    los demás llamadores (app/sync.py, meli_reclamos.py, rentabilidad.py,
    reporte_financiero.py), que hoy asumen que siempre reciben una lista.
    """
    token = autenticar_siigo()
    if not token:
        return []

    todas_las_facturas = []
    page = 1
    puede_reintentar_auth = True
    reintentos_429 = 0
    reintentos_red = 0
    MAX_REINTENTOS_RED = 3
    while True:
        try:
            res = requests.get(
                f"https://api.siigo.com/v1/invoices?created_start={fecha_inicio}&page={page}",
                headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"},
                timeout=20
            )
            if res.status_code == 200:
                reintentos_red = 0
                data = res.json()
                facturas_pagina = data.get("results")
                if facturas_pagina:
                    todas_las_facturas.extend(facturas_pagina)
                    if not data.get("pagination") or data["pagination"]["total_results"] == len(todas_las_facturas):
                        break
                    page += 1
                else:
                    break
            elif res.status_code == 401 and puede_reintentar_auth:
                _invalidar_cache_token_siigo()
                token = autenticar_siigo(forzar=True)
                puede_reintentar_auth = False
                if not token:
                    raise RuntimeError(
                        "Siigo /v1/invoices devolvió 401 y POST /auth no devolvió token. "
                        "Revise username y api_key en credenciales_SIIGO.json."
                    )
                continue
            elif res.status_code == 429 and reintentos_429 < 8:
                reintentos_429 += 1
                espera_429 = _siigo_retry_after_seconds(res)
                print(
                    f"⏳ Siigo rate limit listando facturas "
                    f"(página {page}); reintento {reintentos_429}/8 en {espera_429}s."
                )
                time.sleep(espera_429)
                continue
            elif res.status_code == 401:
                cuerpo = (res.text or "")[:500]
                raise RuntimeError(
                    "Siigo /v1/invoices respondió 401 tras renovar el token. "
                    "Revise `username` y `access_key` (API key) en credenciales_SIIGO.json; "
                    "si la clave se regeneró en Siigo Nube, actualice el JSON. "
                    f"Detalle: {cuerpo}"
                )
            else:
                print(
                    f"⚠️ Error obteniendo facturas de Siigo (Página {page}): {res.status_code} "
                    f"{(res.text or '')[:200]}"
                )
                break
        except requests.RequestException as e:
            reintentos_red += 1
            if reintentos_red <= MAX_REINTENTOS_RED:
                espera_red = 3 * reintentos_red
                print(
                    f"⏳ Error de red listando facturas Siigo (página {page}); "
                    f"reintento {reintentos_red}/{MAX_REINTENTOS_RED} en {espera_red}s: {e}"
                )
                time.sleep(espera_red)
                continue
            print(f"⚠️ Error de red obteniendo facturas de Siigo tras {MAX_REINTENTOS_RED} reintentos: {e}")
            if estricto:
                raise
            break
    return todas_las_facturas


def _siigo_extraer_base64_pdf_respuesta(res: requests.Response) -> str | None:
    """
    Siigo puede devolver JSON {base64:...} o PDF binario según Accept.
    """
    ctype = (res.headers.get("Content-Type") or "").lower()
    if "application/pdf" in ctype or "octet-stream" in ctype:
        raw = res.content or b""
        if _bytes_pdf_valido(raw):
            return base64.b64encode(raw).decode("ascii")
        return None
    try:
        data = res.json()
    except ValueError:
        return None
    if isinstance(data, dict):
        for key in ("base64", "file", "data", "pdf", "content", "document"):
            v = data.get(key)
            if isinstance(v, str) and _base64_pdf_valido(v):
                return _limpiar_base64_documento(v)
    return None


def _limpiar_base64_documento(valor: str) -> str:
    doc = str(valor or "").strip().replace("\n", "").replace("\r", "")
    if "," in doc:
        doc = doc.split(",", 1)[1]
    return doc


def _decodificar_base64_documento(valor: str) -> bytes:
    doc = _limpiar_base64_documento(valor)
    if not doc:
        return b""
    padding = "=" * (-len(doc) % 4)
    try:
        return base64.b64decode(doc + padding, validate=True)
    except Exception:
        return b""


def _bytes_pdf_valido(raw: bytes) -> bool:
    return bool(raw and len(raw) > 32 and raw.lstrip().startswith(b"%PDF"))


def _base64_pdf_valido(valor: str) -> bool:
    return _bytes_pdf_valido(_decodificar_base64_documento(valor))


def _bytes_xml_fiscal_valido(raw: bytes) -> bool:
    if not raw or len(raw.strip()) < 80:
        return False
    inicio = raw.lstrip()[:256].lower()
    if not inicio.startswith((b"<?xml", b"<attached", b"<invoice", b"<creditnote", b"<applicationresponse")):
        return False
    muestra = raw[:200000].lower()
    return any(
        tag in muestra
        for tag in (
            b"<invoice",
            b":invoice",
            b"<attacheddocument",
            b":attacheddocument",
            b"<creditnote",
            b":creditnote",
        )
    )


def _base64_xml_fiscal_valido(valor: str) -> bool:
    return _bytes_xml_fiscal_valido(_decodificar_base64_documento(valor))


def _xml_local_name(tag: str) -> str:
    return str(tag or "").split("}")[-1].split(":")[-1]


def _xml_find_first(node, tag_name: str):
    if node is None:
        return None
    for elem in node.iter():
        if _xml_local_name(elem.tag) == tag_name:
            return elem
    return None


def _xml_find_children(node, tag_name: str) -> list:
    if node is None:
        return []
    return [elem for elem in node.iter() if _xml_local_name(elem.tag) == tag_name]


def _xml_text(node, tag_name: str, default: str = "") -> str:
    elem = _xml_find_first(node, tag_name)
    if elem is not None and elem.text:
        return elem.text.strip()
    return default


def _xml_parse_factura(raw: bytes):
    text = raw.decode("utf-8", errors="ignore")
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    try:
        root = ET.fromstring(cleaned.encode("utf-8"))
    except ET.ParseError:
        safe = re.sub(r"(</?)[a-zA-Z0-9]+:", r"\1", cleaned)
        safe = re.sub(r" [a-zA-Z0-9]+:([a-zA-Z0-9]+)=", r" \1=", safe)
        root = ET.fromstring(safe.encode("utf-8"))

    invoice = _xml_find_first(root, "Invoice")
    if invoice is None:
        for desc in _xml_find_children(root, "Description"):
            if desc.text and "<" in desc.text and "Invoice" in desc.text:
                embedded = desc.text.strip()
                try:
                    invoice = ET.fromstring(embedded.encode("utf-8"))
                except ET.ParseError:
                    safe = re.sub(r"(</?)[a-zA-Z0-9]+:", r"\1", embedded)
                    safe = re.sub(r" [a-zA-Z0-9]+:([a-zA-Z0-9]+)=", r" \1=", safe)
                    try:
                        invoice = ET.fromstring(safe.encode("utf-8"))
                    except ET.ParseError:
                        invoice = None
                if invoice is not None:
                    break
    return root, invoice if invoice is not None else root


def _xml_party_info(invoice, tag_name: str) -> dict:
    party_node = _xml_find_first(invoice, tag_name)
    party = _xml_find_first(party_node, "Party") if party_node is not None else None
    node = party or party_node
    return {
        "name": _xml_text(node, "RegistrationName") or _xml_text(node, "Name"),
        "nit": _xml_text(node, "CompanyID"),
    }


def _xml_float(node, tag_name: str) -> float:
    raw = _xml_text(node, tag_name, "0")
    try:
        return float(str(raw).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def _xml_extraer_resumen_factura(raw: bytes) -> dict:
    root, invoice = _xml_parse_factura(raw)
    supplier = _xml_party_info(invoice, "AccountingSupplierParty")
    customer = _xml_party_info(invoice, "AccountingCustomerParty")
    legal_total = _xml_find_first(invoice, "LegalMonetaryTotal")
    tax_total = _xml_find_first(invoice, "TaxTotal")
    lineas = []
    for line in _xml_find_children(invoice, "InvoiceLine"):
        item = _xml_find_first(line, "Item")
        price = _xml_find_first(line, "Price")
        lineas.append({
            "descripcion": _xml_text(item, "Description") or "Producto",
            "cantidad": _xml_text(line, "InvoicedQuantity", "1"),
            "valor": _xml_float(line, "LineExtensionAmount"),
            "precio": _xml_float(price, "PriceAmount"),
        })
    return {
        "numero": _xml_text(invoice, "ID") or _xml_text(root, "ParentDocumentID") or "Factura",
        "fecha": _xml_text(invoice, "IssueDate"),
        "hora": _xml_text(invoice, "IssueTime"),
        "proveedor": supplier,
        "cliente": customer,
        "lineas": lineas,
        "subtotal": _xml_float(legal_total, "LineExtensionAmount"),
        "impuestos": _xml_float(tax_total, "TaxAmount"),
        "total": _xml_float(legal_total, "PayableAmount"),
        "cufe": _xml_text(invoice, "UUID") or _xml_text(root, "UUID"),
    }


def _pdf_line(c, x: int, y: int, text: str, *, size: int = 9, bold: bool = False) -> int:
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.drawString(x, y, str(text or "")[:115])
    return y - int(size * 1.45)


def _money(value: float) -> str:
    return f"${value:,.2f} COP"


def convertir_xml_fiscal_a_pdf_base64(xml_base64: str) -> str:
    """
    Convierte XML DIAN/Siigo a una representación PDF legible para MeLi.
    No reemplaza la representación gráfica oficial de Siigo; evita subir XML cuando MeLi lo
    descarga con extensión PDF y el comprador no lo puede abrir.
    """
    raw = _decodificar_base64_documento(xml_base64)
    if not _bytes_xml_fiscal_valido(raw):
        return ""

    data = _xml_extraer_resumen_factura(raw)
    buffer = BytesIO()
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
    except Exception as e:
        print(f"⚠️ No se pudo importar ReportLab para convertir XML a PDF: {e}")
        return ""

    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    y = int(height) - 48

    y = _pdf_line(c, 42, y, "McKenna Group S.A.S.", size=16, bold=True)
    y = _pdf_line(c, 42, y, "Representación gráfica generada desde XML fiscal electrónico", size=10)
    y -= 8
    y = _pdf_line(c, 42, y, f"Factura: {data['numero']}", size=13, bold=True)
    y = _pdf_line(c, 42, y, f"Fecha: {data.get('fecha', '')} {data.get('hora', '')}".strip(), size=10)
    y -= 8

    prov = data["proveedor"]
    cli = data["cliente"]
    y = _pdf_line(c, 42, y, "Emisor", size=10, bold=True)
    y = _pdf_line(c, 58, y, f"{prov.get('name') or 'N/D'}  NIT: {prov.get('nit') or 'N/D'}", size=9)
    y = _pdf_line(c, 42, y, "Adquiriente", size=10, bold=True)
    y = _pdf_line(c, 58, y, f"{cli.get('name') or 'N/D'}  ID/NIT: {cli.get('nit') or 'N/D'}", size=9)
    y -= 8

    y = _pdf_line(c, 42, y, "Detalle", size=10, bold=True)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(42, y, "Cant.")
    c.drawString(92, y, "Descripción")
    c.drawRightString(width - 42, y, "Valor")
    y -= 13
    c.line(42, y + 8, width - 42, y + 8)

    for linea in data["lineas"][:28]:
        if y < 105:
            c.showPage()
            y = int(height) - 48
            y = _pdf_line(c, 42, y, f"Factura {data['numero']} - continuación", size=11, bold=True)
        c.setFont("Helvetica", 8)
        c.drawString(42, y, str(linea.get("cantidad") or ""))
        c.drawString(92, y, str(linea.get("descripcion") or "")[:74])
        c.drawRightString(width - 42, y, _money(float(linea.get("valor") or 0)))
        y -= 13

    y -= 8
    c.line(width - 230, y + 6, width - 42, y + 6)
    y = _pdf_line(c, width - 230, y, f"Subtotal: {_money(data['subtotal'])}", size=9)
    y = _pdf_line(c, width - 230, y, f"Impuestos: {_money(data['impuestos'])}", size=9)
    y = _pdf_line(c, width - 230, y, f"Total: {_money(data['total'])}", size=10, bold=True)

    if data.get("cufe"):
        y -= 8
        y = _pdf_line(c, 42, y, "CUFE/CUDE:", size=8, bold=True)
        _pdf_line(c, 42, y, data["cufe"], size=7)

    c.setFont("Helvetica", 7)
    c.drawString(
        42,
        36,
        "PDF generado automáticamente desde XML DIAN/Siigo para visualización del comprador en Mercado Libre.",
    )
    c.save()
    pdf = buffer.getvalue()
    return base64.b64encode(pdf).decode("ascii") if _bytes_pdf_valido(pdf) else ""


def _siigo_prefetch_invoice_antes_pdf(id_factura: str, token: str) -> None:
    """GET /invoices/{id}; a veces la API genera PDF estable tras refrescar el documento."""
    try:
        requests.get(
            f"https://api.siigo.com/v1/invoices/{id_factura}",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=15,
        )
    except Exception:
        pass


def _siigo_retry_after_seconds(res: requests.Response, default: int = 3) -> int:
    retry_after = res.headers.get("Retry-After")
    if retry_after:
        try:
            return max(1, min(30, int(float(retry_after))))
        except (TypeError, ValueError):
            pass
    try:
        data = res.json()
    except ValueError:
        data = {}
    text = json.dumps(data) if isinstance(data, dict) else (res.text or "")
    match = re.search(r"try again in (\d+) seconds?", text, re.I)
    if match:
        return max(1, min(30, int(match.group(1))))
    return default


def descargar_nota_credito_pdf_siigo(id_credit_note: str) -> str:
    """
    Descarga el PDF de una nota crédito de Siigo en base64 (GET
    /v1/credit-notes/{id}/pdf, misma forma de respuesta que la de facturas).
    A diferencia de `descargar_factura_pdf_siigo`, no necesita las oleadas de
    espera por generación DIAN — `crear_nota_credito_siigo` ya hace polling
    del estado del timbrado antes de devolver el `credit_note_id`.
    """
    id_credit_note = str(id_credit_note).strip()
    token = autenticar_siigo()
    if not token:
        return "❌ Error: No se pudo autenticar con Siigo."

    url = f"https://api.siigo.com/v1/credit-notes/{id_credit_note}/pdf"
    puede_reintentar_auth = True
    reintentos_429 = 0
    try:
        while True:
            res = requests.get(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Partner-Id": PARTNER_ID,
                    "Accept": "application/json",
                },
                timeout=30,
            )
            if res.status_code == 200:
                b64 = _siigo_extraer_base64_pdf_respuesta(res)
                if b64:
                    return b64
                return "❌ Error"
            if res.status_code == 401 and puede_reintentar_auth:
                _invalidar_cache_token_siigo()
                token = autenticar_siigo(forzar=True)
                puede_reintentar_auth = False
                if token:
                    continue
            if res.status_code == 429 and reintentos_429 < 4:
                reintentos_429 += 1
                time.sleep(_siigo_retry_after_seconds(res))
                continue
            print(
                f"⚠️ Error descargando PDF de nota crédito Siigo (ID: {id_credit_note}): "
                f"{res.status_code} {(res.text or '')[:300]}"
            )
            return "❌ Error"
    except requests.RequestException as e:
        print(f"⚠️ Error de red descargando PDF de nota crédito de Siigo: {e}")
        return f"⚠️ Error: {e}"


def descargar_factura_pdf_siigo(id_factura):
    """
    Descarga el PDF de una factura específica de Siigo en formato base64.
    """
    id_factura = str(id_factura).strip()
    token = autenticar_siigo()
    if not token:
        return "❌ Error: No se pudo autenticar con Siigo."

    url = f"https://api.siigo.com/v1/invoices/{id_factura}/pdf"
    ultimo_status = None
    ultimo_cuerpo = ""
    # Segundos de espera antes de cada oleada (0 = primera petición inmediata)
    oleadas_sleep = [0, 2, 5, 10]

    try:
        for oleada, espera in enumerate(oleadas_sleep):
            if espera > 0:
                _siigo_prefetch_invoice_antes_pdf(id_factura, token)
                time.sleep(espera)

            for accept in ("application/json", "application/pdf"):
                puede_reintentar_auth = True
                reintentos_429 = 0
                while True:
                    _siigo_throttle_antes_pdf()
                    res = requests.get(
                        url,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Partner-Id": PARTNER_ID,
                            "Accept": accept,
                        },
                        timeout=45,
                    )
                    ultimo_status = res.status_code
                    ultimo_cuerpo = (res.text or "")[:500]

                    if res.status_code == 200:
                        b64 = _siigo_extraer_base64_pdf_respuesta(res)
                        if b64:
                            return b64
                        break

                    if res.status_code == 401 and puede_reintentar_auth:
                        _invalidar_cache_token_siigo()
                        token = autenticar_siigo(forzar=True)
                        puede_reintentar_auth = False
                        if token:
                            continue
                    if res.status_code == 429 and reintentos_429 < 4:
                        reintentos_429 += 1
                        espera_429 = _siigo_retry_after_seconds(res)
                        print(
                            f"⏳ Siigo rate limit PDF ({id_factura}); "
                            f"reintento {reintentos_429}/4 en {espera_429}s."
                        )
                        time.sleep(espera_429)
                        continue
                    break

            if ultimo_status not in (429, 500, 502, 503, 504, None):
                break

        detalle = f" {ultimo_cuerpo}" if ultimo_cuerpo else ""
        print(
            f"⚠️ Error descargando PDF de Siigo (ID: {id_factura}): "
            f"{ultimo_status}{detalle}"
        )
        return "❌ Error"
    except requests.RequestException as e:
        print(f"⚠️ Error de red descargando PDF de Siigo: {e}")
        return f"⚠️ Error: {e}"


def descargar_xml_factura_siigo(id_factura: str) -> str:
    """
    GET /v1/invoices/{id}/xml — XML de factura electrónica (DIAN) en base64.
    Documentación Siigo: alternativa cuando /pdf responde error.
    """
    id_factura = str(id_factura).strip()
    token = autenticar_siigo()
    if not token:
        return "❌ Error: No se pudo autenticar con Siigo."

    url = f"https://api.siigo.com/v1/invoices/{id_factura}/xml"
    ultimo_status = None
    ultimo_cuerpo = ""
    oleadas_sleep = [0, 3]

    try:
        for espera in oleadas_sleep:
            if espera > 0:
                time.sleep(espera)
            puede_reintentar_auth = True
            reintentos_429 = 0
            while True:
                _siigo_throttle_antes_pdf()
                res = requests.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Partner-Id": PARTNER_ID,
                        "Accept": "application/json",
                    },
                    timeout=45,
                )
                ultimo_status = res.status_code
                ultimo_cuerpo = (res.text or "")[:500]

                if res.status_code == 200:
                    raw = res.content or b""
                    ctype = (res.headers.get("Content-Type") or "").lower()
                    if "xml" in ctype and _bytes_xml_fiscal_valido(raw):
                        return base64.b64encode(raw).decode("ascii")
                    try:
                        data = res.json()
                    except ValueError:
                        if _bytes_xml_fiscal_valido(raw):
                            return base64.b64encode(raw).decode("ascii")
                        break
                    if isinstance(data, dict):
                        for key in ("base64", "file", "data", "xml", "content", "document"):
                            b64 = data.get(key)
                            if isinstance(b64, str) and _base64_xml_fiscal_valido(b64):
                                return _limpiar_base64_documento(b64)
                    break

                if res.status_code == 401 and puede_reintentar_auth:
                    _invalidar_cache_token_siigo()
                    token = autenticar_siigo(forzar=True)
                    puede_reintentar_auth = False
                    if token:
                        continue
                if res.status_code == 429 and reintentos_429 < 4:
                    reintentos_429 += 1
                    espera_429 = _siigo_retry_after_seconds(res)
                    print(
                        f"⏳ Siigo rate limit XML ({id_factura}); "
                        f"reintento {reintentos_429}/4 en {espera_429}s."
                    )
                    time.sleep(espera_429)
                    continue
                break

            if ultimo_status not in (429, 500, 502, 503, 504, None):
                break

        detalle = f" {ultimo_cuerpo}" if ultimo_cuerpo else ""
        print(
            f"⚠️ Error descargando XML de Siigo (ID: {id_factura}): "
            f"{ultimo_status}{detalle}"
        )
        return "❌ Error"
    except requests.RequestException as e:
        print(f"⚠️ Error de red descargando XML de Siigo: {e}")
        return f"⚠️ Error: {e}"


def obtener_documento_fiscal_siigo_para_meli(id_factura: str) -> tuple[str, str]:
    """
    Preferencia: PDF para MeLi. Si GET /pdf falla (p. ej. 500), intenta XML DIAN (/xml),
    que Mercado Libre Colombia acepta en fiscal_documents.
    Devuelve (base64, \"pdf\"|\"xml\") o (\"\", \"\").
    """
    pdf = descargar_factura_pdf_siigo(id_factura)
    if (
        pdf
        and "❌" not in str(pdf)
        and not str(pdf).startswith("⚠️ Error")
        and _base64_pdf_valido(str(pdf))
    ):
        return pdf, "pdf"
    xml = descargar_xml_factura_siigo(id_factura)
    if (
        xml
        and "❌" not in str(xml)
        and not str(xml).startswith("⚠️ Error")
        and _base64_xml_fiscal_valido(str(xml))
    ):
        pdf_generado = convertir_xml_fiscal_a_pdf_base64(str(xml))
        if not pdf_generado:
            print(
                f"⚠️ [SIIGO] XML fiscal descargado pero no se pudo convertir a PDF "
                f"({str(id_factura)[:13]}…)."
            )
            return "", ""
        print(
            f"ℹ️ [SIIGO] PDF no disponible por API; generando PDF desde XML DIAN "
            f"({str(id_factura)[:13]}…)."
        )
        return pdf_generado, "pdf"
    return "", ""


def crear_factura_compra_siigo(factura_data: dict):
    """
    Crea una factura de compra en SIIGO Nube via API.
    factura_data debe contener la estructura esperada por la API de SIIGO para facturas de compra.
    """
    token = autenticar_siigo()
    if not token:
        return {"status": "error", "message": "No se pudo autenticar con Siigo."}

    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Partner-Id": PARTNER_ID,
            "Content-Type": "application/json"
        }
        response = requests.post(
            "https://api.siigo.com/v1/purchases", # Endpoint corregido para facturas de compra según la documentación
            json=factura_data,
            headers=headers,
            timeout=15
        )

        if response.status_code == 201: # 201 Created
            print(f"✅ Factura de compra creada en SIIGO: {response.json().get('id')}")
            return {"status": "success", "data": response.json()}
        else:
            print(f"❌ Error al crear factura de compra en SIIGO: {response.status_code} - {response.text}")
            return {"status": "error", "message": response.text}
    except requests.exceptions.RequestException as e:
        print(f"⚠️ Error de red al crear factura en SIIGO: {e}")
        return {"status": "error", "message": f"Error de red: {e}"}

def obtener_facturas_compra_siigo(fecha_inicio: str) -> list:
    """
    Obtiene facturas de compra de SIIGO a partir de una fecha de inicio.
    """
    token = autenticar_siigo()
    if not token:
        return []

    purchase_invoices = []
    page = 1
    puede_reintentar_auth = True
    while True:
        try:
            # Usando el endpoint correcto para facturas de compra: /v1/purchases
            res = requests.get(
                f"https://api.siigo.com/v1/purchases?date_start={fecha_inicio}&page={page}",
                headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"},
                timeout=15
            )

            if res.status_code == 200:
                data = res.json()
                invoices_page = data.get("results")
                if invoices_page:
                    purchase_invoices.extend(invoices_page)
                    if not data.get("pagination") or data["pagination"]["total_results"] == len(purchase_invoices):
                        break
                    page += 1
                else:
                    break
            elif res.status_code == 401 and puede_reintentar_auth:
                _invalidar_cache_token_siigo()
                token = autenticar_siigo(forzar=True)
                puede_reintentar_auth = False
                if not token:
                    raise RuntimeError(
                        "Siigo /v1/purchases devolvió 401 y POST /auth no devolvió token. "
                        "Revise credenciales_SIIGO.json."
                    )
                continue
            elif res.status_code == 401:
                cuerpo = (res.text or "")[:500]
                raise RuntimeError(
                    "Siigo /v1/purchases respondió 401 tras renovar el token. "
                    "Revise credenciales_SIIGO.json. "
                    f"Detalle: {cuerpo}"
                )
            else:
                print(f"⚠️ Error obteniendo facturas de compra de Siigo (Página {page}): {res.status_code} - {res.text}")
                break
        except requests.RequestException as e:
            print(f"⚠️ Error de red obteniendo facturas de compra de Siigo: {e}")
            break
    return purchase_invoices

def crear_cotizacion_siigo(nombre_cliente: str, identificacion: str, email: str, direccion_envio: str, productos: str, total: float):
    """
    Crea una cotización en Siigo y la envía al correo del cliente.
    productos: JSON string con lista de productos, ej: '[{"nombre":"Acido Citrico","cantidad":1,"precio_unitario":15000}]'
    """
    from app.tools.system_tools import enviar_email_reporte
    try:
        productos = json.loads(productos) if isinstance(productos, str) else productos
    except Exception:
        productos = []

    token = autenticar_siigo()
    if not token:
        return "Error: No se pudo obtener el token de Siigo para crear la cotización."
        
    print(f"📝 [SIIGO] Creando cotización para {nombre_cliente}...")
    
    # 1. Construir el cliente (simplificado para cotización rápida o si ya existe)
    cliente_data = {
        "person_type": "Person",
        "id_type": "13", # Cédula de ciudadanía por defecto
        "identification": identificacion,
        "name": [nombre_cliente, ""], # Nombre y Apellido
        "address": {"address": direccion_envio, "city": {"city_code": "11001", "state_code": "11"}}, # Bogota por defecto para simplificar
        "phones": [{"number": cotizacion_data.get("telefono", "3000000000"), "extension": ""}], # Usar el teléfono del cliente de la cotización
        "contacts": [{"first_name": nombre_cliente, "last_name": "", "email": email}]
    }
    
    # Para simplicidad, asumo que enviamos un payload básico de cotización (quotes)
    # según la documentación estándar de Siigo (o simulamos el payload si no tenemos todos los IDs)
    
    # Generar items
    items = []
    for p in productos:
        items.append({
            "code": p.get("codigo", "GENERICO"), # Un código genérico si no lo tenemos
            "description": p["nombre"],
            "quantity": p["cantidad"],
            "price": p["precio_unitario"]
        })
        
    payload = {
        "document": {
            "id": 5804 # Factura de Venta estándar
        },
        "date": datetime.now().strftime("%Y-%m-%d"),
        "customer": {
            "identification": identificacion,
            "branch_office": 0
        },
        "seller": 704, # Vendedor: Victor Hugo Garcia Barrero
        "observations": "COTIZACIÓN: Este documento es una factura en estado de borrador/cotización. No tiene validez fiscal ni contable como venta cerrada.",
        "items": items,
        "payments": [
            {
                "id": 1333, # Método de pago Efectivo genérico en SIIGO (o cualquier válido)
                "value": total,
                "due_date": datetime.now().strftime("%Y-%m-%d")
            }
        ]
    }
    
    # 2. Enviar a Siigo API
    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json"
    }
    
    print(f"📡 [SIIGO] Payload de la cotización simulada como Factura de Venta: {json.dumps(payload, indent=2)}")
    
    siigo_result = ""
    try:
        # Usamos /v1/invoices para Facturas de Venta
        res = requests.post("https://api.siigo.com/v1/invoices", json=payload, headers=headers, timeout=15)
        if res.status_code in [200, 201]:
            print(f"✅ [SIIGO] Factura Borrador creada exitosamente: {res.json()}")
            siigo_result = f"Factura Borrador creada exitosamente con ID: {res.json().get('id')}"
        else:
            print(f"❌ [SIIGO] Error en la API de Siigo ({res.status_code}): {res.text}")
            siigo_result = f"Fallo al crear en SIIGO: {res.text}"
            return f"Error en la creación de la cotización en SIIGO: {res.text}"
    except requests.RequestException as e:
        print(f"⚠️ [SIIGO] Error de red: {e}")
        return f"Error de red al conectar con SIIGO: {str(e)}"
    
    mensaje_email = f"""
    Hola {nombre_cliente},
    
    Adjuntamos los detalles de su cotización solicitada:
    
    Productos:
    """
    for p in productos:
        mensaje_email += f"- {p['cantidad']} x {p['nombre']} (${p['precio_unitario']} c/u)\n"
        
    mensaje_email += f"\nTotal: ${total}\n"
    mensaje_email += f"Dirección de envío: {direccion_envio}\n\n"
    mensaje_email += "Gracias por preferir McKenna Group."
    
    # Enviar correo usando la herramienta existente
    resultado_email = enviar_email_reporte("Cotización McKenna Group", mensaje_email, email)
    
    # Enviar reporte al grupo de facturación de ventas
    import os as _os
    from app.utils import enviar_whatsapp_reporte
    grupo_ventas = _os.getenv("GRUPO_FACTURACION_VENTAS_WA", "120363425465848868@g.us")
    mensaje_wa = f"📝 *Nueva Cotización Generada en SIIGO*\n"
    mensaje_wa += f"👤 *Cliente:* {nombre_cliente} ({identificacion})\n"
    mensaje_wa += f"💰 *Total:* ${total}\n"
    mensaje_wa += f"📍 *Dirección:* {direccion_envio}\n"
    mensaje_wa += f"📧 *Correo:* {email}\n"
    mensaje_wa += "📦 *Productos:*\n"
    for p in productos:
        mensaje_wa += f"- {p['cantidad']}x {p['nombre']}\n"

    enviar_whatsapp_reporte(mensaje_wa, numero_destino=grupo_ventas)
    
    if "Error" in resultado_email:
        return f"✅ Cotización generada en SIIGO, pero falló el envío por correo: {resultado_email}"
        
    return f"✅ Cotización generada con éxito en SIIGO para {nombre_cliente} y enviada al correo {email}."

def crear_cotizacion_preliminar(nombre_cliente: str, identificacion: str, email: str, direccion_envio: str, productos: str, total: float):
    """
    Crea una cotización preliminar localmente sin usar la API de Siigo.
    productos: JSON string con lista de productos, ej: '[{"nombre":"Acido Citrico","cantidad":1,"precio_unitario":15000}]'
    """
    try:
        productos = json.loads(productos) if isinstance(productos, str) else productos
    except Exception:
        productos = []
    cotizacion = {
        "id_preliminar": f"PRE-{int(time.time())}",
        "nombre_cliente": nombre_cliente,
        "identificacion": identificacion,
        "email": email,
        "direccion_envio": direccion_envio,
        "productos": productos,
        "total": total,
        "fecha": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Guardar localmente para referencia
    os.makedirs("cotizaciones_preliminares", exist_ok=True)
    file_path = f"cotizaciones_preliminares/{cotizacion['id_preliminar']}.json"
    with open(file_path, "w") as f:
        json.dump(cotizacion, f, indent=4)
    
    mensaje_resumen = f"📝 *Cotización Preliminar Generada*\n"
    mensaje_resumen += f"🆔 *ID:* {cotizacion['id_preliminar']}\n"
    mensaje_resumen += f"👤 *Cliente:* {nombre_cliente}\n"
    mensaje_resumen += f"💰 *Total:* ${total}\n"
    
    print(f"✅ Cotización preliminar guardada en {file_path}")
    return {"status": "success", "message": "Cotización preliminar creada con éxito.", "cotizacion": cotizacion}

def editar_factura_siigo(factura_id: str, factura_data: dict):
    """
    Edita una factura existente en SIIGO.
    """
    token = autenticar_siigo()
    if not token:
        return "Error: No se pudo autenticar con Siigo."

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json"
    }

    try:
        # Nota: La API de Siigo nube generalmente no permite editar facturas que ya han 
        # sido emitidas a la DIAN, independientemente del estado. 
        # Pero si el endpoint lo permite para Drafts/Rejected, lo intentamos.
        res = requests.put(f"https://api.siigo.com/v1/invoices/{factura_id}", json=factura_data, headers=headers, timeout=15)
        if res.status_code in [200, 201]:
            print(f"✅ Factura editada exitosamente: {res.json()}")
            return {"status": "success", "data": res.json()}
        else:
            print(f"❌ Error al editar factura en Siigo ({res.status_code}): {res.text}")
            return {"status": "error", "message": res.text}
    except requests.RequestException as e:
        print(f"⚠️ Error de red al conectar con SIIGO: {e}")
        return {"status": "error", "message": str(e)}


def _env_int_siigo(nombre: str, default: int) -> int:
    try:
        return int(os.getenv(nombre, str(default)))
    except (TypeError, ValueError):
        return default


def _siigo_customer_address_payload(
    direccion: str,
    *,
    city_code: str | None = None,
    state_code: str | None = None,
    country_code: str | None = None,
) -> dict | None:
    """
    Dirección del cliente en factura Siigo (requiere ciudad/código DIAN en Siigo).
    Por defecto Bogotá D.C.; ajustar con SIIGO_INVOICE_CUSTOMER_* en .env.
    """
    line = (direccion or "").strip()
    if not line:
        return None
    cc = (city_code or os.getenv("SIIGO_INVOICE_CUSTOMER_CITY_CODE", "11001") or "11001").strip()
    sc = (state_code or os.getenv("SIIGO_INVOICE_CUSTOMER_STATE_CODE", "11") or "11").strip()
    co = (country_code or os.getenv("SIIGO_INVOICE_CUSTOMER_COUNTRY_CODE", "Co") or "Co").strip()
    return {
        "address": line[:256],
        "city": {"city_code": cc, "state_code": sc, "country_code": co},
    }


def _siigo_person_name_parts(nombre_completo: str) -> tuple[str, str]:
    """Nombres y apellidos para customer.name (Person): primer token / resto."""
    parts = (nombre_completo or "").strip().split()
    if not parts:
        return "Cliente", ""
    if len(parts) == 1:
        return parts[0][:100], ""
    return parts[0][:100], " ".join(parts[1:])[:100]


def _siigo_phone_digits(telefono: str) -> str:
    d = "".join(c for c in (telefono or "") if c.isdigit())
    if len(d) > 10 and d.startswith("57"):
        d = d[2:]
    return d[:10]


def _construir_customer_payload_factura_siigo(
    *,
    nombre_cliente: str,
    identificacion: str,
    direccion: str,
    email: str,
    telefono: str,
    city_code: str | None = None,
    state_code: str | None = None,
    country_code: str | None = None,
) -> dict:
    """Payload customer según doc Siigo (factura con creación/actualización de tercero)."""
    identificacion = "".join(ch for ch in str(identificacion or "") if ch.isdigit())
    person_type = "Person" if len(identificacion) <= 10 else "Company"
    id_type = "13" if person_type == "Person" else "31"
    if person_type == "Person":
        n0, n1 = _siigo_person_name_parts(nombre_cliente)
        name_arr = [n0, n1]
    else:
        name_arr = [(nombre_cliente or "").strip()[:100], ""]
    customer: dict = {
        "person_type": person_type,
        "id_type": id_type,
        "identification": identificacion,
        "branch_office": 0,
        "name": name_arr,
    }
    addr = _siigo_customer_address_payload(
        direccion,
        city_code=city_code,
        state_code=state_code,
        country_code=country_code,
    )
    if addr:
        customer["address"] = addr
    ph = _siigo_phone_digits(telefono)
    if ph:
        customer["phones"] = [{"number": ph}]
    em = (email or "").strip()
    if em:
        customer["contacts"] = [
            {
                "first_name": (name_arr[0] or "Cliente")[:50],
                "last_name": (name_arr[1] or name_arr[0] or "Cliente")[:50],
                "email": em[:100],
            }
        ]
    return customer


def sincronizar_tercero_siigo_antes_factura_web(
    *,
    nombre_cliente: str,
    identificacion: str,
    direccion: str,
    email: str,
    telefono: str,
    city_code: str | None = None,
    state_code: str | None = None,
    country_code: str | None = None,
) -> dict:
    """
    Si el NIT/CC ya existe en Siigo, la factura usa la ficha del tercero (dirección/correo viejos).
    Actualiza tercero con los datos del checkout web antes del POST /v1/invoices.
    """
    identificacion = "".join(ch for ch in str(identificacion or "") if ch.isdigit())
    if not identificacion:
        return {"ok": False, "error": "Identificación vacía."}

    token = autenticar_siigo()
    if not token:
        return {"ok": False, "error": "No se pudo autenticar con Siigo."}

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }

    try:
        res = requests.get(
            "https://api.siigo.com/v1/customers",
            params={"identification": identificacion, "page": 1, "page_size": 10},
            headers=headers,
            timeout=20,
        )
        if res.status_code != 200:
            return {
                "ok": False,
                "error": f"GET customers {res.status_code}: {res.text[:800]}",
            }
        data = res.json()
        results = data.get("results") if isinstance(data, dict) else None
        if not results:
            return {"ok": True, "message": "Tercero nuevo en Siigo; se creará con la factura."}

        cust = results[0]
        cid = cust.get("id")
        if not cid:
            return {"ok": False, "error": "Cliente Siigo sin id en respuesta."}

        body = copy.deepcopy(cust)
        for k in ("metadata", "_links", "self", "id"):
            body.pop(k, None)

        patch = _construir_customer_payload_factura_siigo(
            nombre_cliente=nombre_cliente,
            identificacion=identificacion,
            direccion=direccion,
            email=email,
            telefono=telefono,
            city_code=city_code,
            state_code=state_code,
            country_code=country_code,
        )
        body["person_type"] = patch["person_type"]
        # PUT /customers exige id_type como código (string); el GET devuelve objeto.
        body["id_type"] = patch["id_type"]
        body["name"] = patch["name"]
        body["branch_office"] = patch.get("branch_office", 0)
        if "address" in patch:
            body["address"] = patch["address"]
        if "phones" in patch:
            body["phones"] = patch["phones"]
        if "contacts" in patch:
            body["contacts"] = patch["contacts"]

        res_put = requests.put(
            f"https://api.siigo.com/v1/customers/{cid}",
            json=body,
            headers=headers,
            timeout=25,
        )
        if res_put.status_code not in (200, 201):
            return {
                "ok": False,
                "error": f"PUT customer {res_put.status_code}: {res_put.text[:1200]}",
            }
        return {"ok": True, "customer_id": cid, "message": "Tercero actualizado en Siigo con datos del pedido web."}
    except requests.RequestException as e:
        return {"ok": False, "error": f"Red Siigo (tercero): {e}"}


def _estado_factura_siigo(factura: dict) -> str:
    if not isinstance(factura, dict):
        return "Desconocido"
    stamp = factura.get("stamp") or {}
    if isinstance(stamp, dict) and stamp.get("status"):
        return str(stamp.get("status"))
    return str(factura.get("state") or "Desconocido")


# Evita ráfagas GET /pdf: Siigo a veces responde 500 bajo muchas peticiones seguidas.
_last_siigo_pdf_req_at = 0.0
_SIIGO_PDF_MIN_INTERVAL_S = 0.35


def _siigo_throttle_antes_pdf() -> None:
    global _last_siigo_pdf_req_at
    ahora = time.time()
    transcurrido = ahora - _last_siigo_pdf_req_at
    if _last_siigo_pdf_req_at > 0 and transcurrido < _SIIGO_PDF_MIN_INTERVAL_S:
        time.sleep(_SIIGO_PDF_MIN_INTERVAL_S - transcurrido)
    _last_siigo_pdf_req_at = time.time()


def siigo_factura_etiqueta_log(factura: dict) -> str:
    """Nombre o número visible para logs (listado GET /v1/invoices)."""
    if not isinstance(factura, dict):
        return "?"
    name = str(factura.get("name") or "").strip()
    ds = factura.get("document_settings")
    if not name and isinstance(ds, dict):
        name = f"{ds.get('prefix') or ''}{ds.get('number') or ''}".strip()
    if not name:
        name = str(factura.get("id") or "?")[:12]
    return name[:88]


def siigo_omitir_pdf_mientras_timbrado(factura: dict) -> bool:
    """
    GET /v1/invoices/{id}/pdf suele devolver 500 si el timbrado DIAN aún no terminó
    (borrador / enviando / pendiente).
    """
    est = (str(_estado_factura_siigo(factura) or "")).strip().lower()
    return est in (
        "draft",
        "sending",
        "pending",
        "en proceso",
        "processing",
    )


def siigo_factura_estado_log(factura: dict) -> str:
    """Estado DIAN / documento (listado GET /v1/invoices)."""
    return _estado_factura_siigo(factura)


def _stamp_info_siigo(factura: dict) -> dict:
    stamp = factura.get("stamp") if isinstance(factura, dict) else {}
    if not isinstance(stamp, dict):
        stamp = {}
    return {
        "status": str(stamp.get("status") or _estado_factura_siigo(factura)),
        "cufe": stamp.get("cufe") or "",
        "cude": stamp.get("cude") or "",
        "observations": stamp.get("observations") or "",
        "errors": stamp.get("errors") or "",
    }


def _siigo_invoice_put_body_sin_numero_auto(factura: dict) -> dict | None:
    """
    Siigo rechaza PUT si se envía document_settings.number con numeración automática.
    Clonamos el GET y quitamos ese campo.
    """
    if not isinstance(factura, dict):
        return None
    body = copy.deepcopy(factura)
    ds = body.get("document_settings")
    if isinstance(ds, dict) and "number" in ds:
        ds.pop("number", None)
    return body


def forzar_envio_dian_factura_siigo(factura_id: str, *, poll_loops: int = 10, sleep_s: float = 2.0) -> dict:
    """
    Si la factura queda en Draft / Sending tras POST, fuerza stamp.send vía PUT
    (mismo cuerpo que GET, sin document_settings.number) y reconsulta hasta Accepted/Rejected.
    """
    factura_id = str(factura_id or "").strip()
    if not factura_id:
        return {"ok": False, "error": "factura_id vacío."}

    token = autenticar_siigo()
    if not token:
        return {"ok": False, "error": "No se pudo autenticar con Siigo."}

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }

    try:
        res_get = requests.get(
            f"https://api.siigo.com/v1/invoices/{factura_id}",
            headers=headers,
            timeout=15,
        )
        if res_get.status_code != 200:
            return {
                "ok": False,
                "error": f"GET factura {res_get.status_code}: {res_get.text[:800]}",
            }
        factura = res_get.json()
        put_body = _siigo_invoice_put_body_sin_numero_auto(factura)
        if not put_body:
            return {"ok": False, "error": "No se pudo armar cuerpo PUT."}
        put_body["stamp"] = {"send": True}

        res_put = requests.put(
            f"https://api.siigo.com/v1/invoices/{factura_id}",
            json=put_body,
            headers=headers,
            timeout=20,
        )
        if res_put.status_code not in (200, 201):
            return {
                "ok": False,
                "error": f"PUT timbrado {res_put.status_code}: {res_put.text[:1000]}",
                "get_data": factura,
            }

        for _ in range(max(1, poll_loops)):
            time.sleep(sleep_s)
            res_poll = requests.get(
                f"https://api.siigo.com/v1/invoices/{factura_id}",
                headers=headers,
                timeout=15,
            )
            if res_poll.status_code != 200:
                break
            factura = res_poll.json()
            st = _stamp_info_siigo(factura).get("status") or ""
            if st in {"Accepted", "Rejected"}:
                break

        stamp_info = _stamp_info_siigo(factura)
        return {
            "ok": True,
            "invoice_id": factura_id,
            "status": stamp_info.get("status") or _estado_factura_siigo(factura),
            "cufe": stamp_info.get("cufe") or stamp_info.get("cude") or "",
            "stamp": stamp_info,
            "data": factura,
        }
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red timbrado Siigo: {e}"}


def _siigo_invoice_url(factura_id: str | int | None) -> str:
    return f"https://siigonube.siigo.com/#/invoice/843/{factura_id}" if factura_id else ""


def crear_factura_venta_siigo(
    *,
    nombre_cliente: str,
    identificacion: str,
    direccion_envio: str,
    productos: list[dict],
    total: float,
    email: str = "",
    telefono: str = "",
    observaciones: str = "",
    purchase_order: str = "",
    document_id: int | None = None,
    seller_id: int | None = None,
    payment_id: int | None = None,
    descargar_pdf: bool = True,
    enviar_dian: bool = True,
    enviar_correo: bool = False,
    customer_city_code: str | None = None,
    customer_state_code: str | None = None,
    customer_country_code: str | None = None,
) -> dict:
    """
    Crea una factura electrónica de venta en Siigo y retorna un resultado estructurado.

    `direccion_envio`: si viene, se envía a Siigo como `customer.address` (máx. 256 caracteres).
    Ciudad/códigos: `customer_city_code` / `customer_state_code` o variables de entorno
    `SIIGO_INVOICE_CUSTOMER_*` (por defecto Bogotá 11001 / 11 / Co).

    Para pedidos web, antes conviene llamar `sincronizar_tercero_siigo_antes_factura_web` si el
    tercero ya existe en Siigo (si no, la FE puede salir con dirección/correo viejos de la ficha).

    `productos` debe venir normalizado como:
    [{"codigo": "SKU", "nombre": "Producto", "cantidad": 1, "precio_unitario": 1000}]
    """
    token = autenticar_siigo()
    if not token:
        return {"ok": False, "error": "No se pudo autenticar con Siigo."}

    if not productos:
        return {"ok": False, "error": "La factura no tiene productos."}

    nombre_cliente = (nombre_cliente or "").strip()
    identificacion = "".join(ch for ch in str(identificacion or "") if ch.isdigit())
    direccion_envio = (direccion_envio or "").strip()
    email = (email or "").strip()
    telefono = (telefono or "").strip()
    if not nombre_cliente or not identificacion:
        return {"ok": False, "error": "Faltan nombre o identificación del cliente."}

    document_id = document_id or _env_int_siigo("SIIGO_SALES_DOCUMENT_ID", 26670)
    seller_id = seller_id or _env_int_siigo("SIIGO_SELLER_ID", 150)
    payment_id = payment_id or _env_int_siigo("SIIGO_PAYMENT_ID", 1333)
    hoy = datetime.now().strftime("%Y-%m-%d")

    items = []
    for p in productos:
        codigo = str(p.get("codigo") or "").strip()
        nombre = str(p.get("nombre") or "").strip()
        try:
            cantidad = float(p.get("cantidad", 1))
            precio_unitario = float(p.get("precio_unitario", 0))
        except (TypeError, ValueError):
            return {"ok": False, "error": f"Cantidad/precio inválido para {nombre or codigo}."}
        if not codigo or not nombre or cantidad <= 0 or precio_unitario < 0:
            return {"ok": False, "error": f"Línea inválida para factura: {p!r}"}
        items.append(
            {
                "code": codigo,
                "description": nombre,
                "quantity": cantidad,
                "price": precio_unitario,
            }
        )

    customer = _construir_customer_payload_factura_siigo(
        nombre_cliente=nombre_cliente,
        identificacion=identificacion,
        direccion=direccion_envio,
        email=email,
        telefono=telefono,
        city_code=customer_city_code,
        state_code=customer_state_code,
        country_code=customer_country_code,
    )

    payload = {
        "document": {"id": document_id},
        "date": hoy,
        "customer": customer,
        "seller": seller_id,
        "items": items,
        "payments": [
            {
                "id": payment_id,
                "value": float(total),
                "due_date": hoy,
            }
        ],
    }
    if observaciones:
        payload["observations"] = observaciones
    if purchase_order:
        payload["purchase_order"] = purchase_order
    if enviar_dian:
        payload["stamp"] = {"send": True}
    if enviar_correo:
        payload["mail"] = {"send": True}

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }

    puede_reintentar_auth = True
    try:
        while True:
            res = requests.post(
                "https://api.siigo.com/v1/invoices",
                json=payload,
                headers=headers,
                timeout=20,
            )
            if res.status_code in (200, 201):
                break
            if res.status_code == 401 and puede_reintentar_auth:
                _invalidar_cache_token_siigo()
                token = autenticar_siigo(forzar=True)
                puede_reintentar_auth = False
                if not token:
                    return {"ok": False, "error": "Siigo 401 y no fue posible renovar token."}
                headers["Authorization"] = f"Bearer {token}"
                continue
            return {
                "ok": False,
                "status_code": res.status_code,
                "error": f"Error al crear factura en Siigo: {res.text[:1000]}",
                "payload": payload,
            }

        factura_siigo = res.json()
        factura_id = factura_siigo.get("id")
        factura_numero = factura_siigo.get("number")

        if factura_id:
            poll_count = 6 if enviar_dian else 1
            for poll_idx in range(poll_count):
                if poll_idx:
                    time.sleep(2)
                try:
                    res_get = requests.get(
                        f"https://api.siigo.com/v1/invoices/{factura_id}",
                        headers=headers,
                        timeout=15,
                    )
                    if res_get.status_code == 200:
                        factura_siigo = res_get.json()
                        stamp_status = _stamp_info_siigo(factura_siigo).get("status")
                        if not enviar_dian or stamp_status in {"Accepted", "Rejected"}:
                            break
                except requests.RequestException as e:
                    print(f"⚠️ No se pudo refrescar el estado de la factura: {e}")
                    break

            if enviar_dian and factura_id:
                st = (_stamp_info_siigo(factura_siigo).get("status") or "").strip()
                if st and st not in {"Accepted", "Rejected"}:
                    forced = forzar_envio_dian_factura_siigo(str(factura_id))
                    if forced.get("ok") and isinstance(forced.get("data"), dict):
                        factura_siigo = forced["data"]

        pdf_path = None
        if descargar_pdf and factura_id:
            pdf_base64 = descargar_factura_pdf_siigo(factura_id)
            if pdf_base64 and "Error" not in str(pdf_base64):
                pdf_dir = "facturas_descargadas"
                os.makedirs(pdf_dir, exist_ok=True)
                pdf_name = f"Factura_{factura_numero or factura_id}.pdf"
                pdf_path = os.path.join(pdf_dir, pdf_name)
                try:
                    with open(pdf_path, "wb") as f:
                        f.write(base64.b64decode(pdf_base64))
                except Exception as e:
                    print(f"⚠️ No se pudo guardar PDF Siigo {factura_id}: {e}")
                    pdf_path = None

        stamp_info = _stamp_info_siigo(factura_siigo)
        return {
            "ok": True,
            "invoice_id": factura_id,
            "number": factura_numero,
            "status": stamp_info.get("status") or _estado_factura_siigo(factura_siigo),
            "cufe": stamp_info.get("cufe") or stamp_info.get("cude") or "",
            "stamp": stamp_info,
            "url": _siigo_invoice_url(factura_id),
            "pdf_path": pdf_path,
            "data": factura_siigo,
            "payload": payload,
        }
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red con Siigo: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"Error crítico creando factura Siigo: {e}"}


def buscar_nota_credito_existente_siigo(invoice_id: str, dias_atras: int = 120) -> dict | None:
    """
    Busca si una factura ya tiene nota crédito emitida en Siigo — compara por
    `invoice.id` entre las notas crédito creadas en los últimos `dias_atras`.

    Chequeo de último segundo antes de emitir: evita duplicar si alguien la
    generó a mano en el medio (incidente 10-ago-2026: una corrida automática
    duplicó 4 notas crédito por no volver a revisar justo antes de cada POST,
    justo cuando contabilidad estaba resolviendo esos mismos tickets a mano).
    """
    token = autenticar_siigo()
    if not token:
        return None
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
    desde = (datetime.now() - timedelta(days=dias_atras)).strftime("%Y-%m-%d")
    hasta = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    page = 1
    while True:
        try:
            res = requests.get(
                "https://api.siigo.com/v1/credit-notes",
                params={"created_start": desde, "created_end": hasta, "page_size": 100, "page": page},
                headers=headers,
                timeout=20,
            )
        except requests.RequestException:
            return None
        if res.status_code != 200:
            return None
        data = res.json()
        for nc in data.get("results", []):
            inv = nc.get("invoice") or {}
            if str(inv.get("id") or "") == str(invoice_id):
                return nc
        total = (data.get("pagination") or {}).get("total_results", 0)
        if page * 100 >= total:
            break
        page += 1
    return None


def crear_nota_credito_siigo(
    *,
    invoice_id: str,
    items: list[dict],
    payments: list[dict],
    reason: int = 2,
    observaciones: str = "",
    document_id: int | None = None,
    enviar_dian: bool = True,
) -> dict:
    """
    Crea una nota crédito en Siigo referenciando una factura ya emitida.

    `items`: [{"code", "description", "quantity", "price", "tax_ids": [int, ...]}]
      — mismos valores de la línea de la factura original. `price` es el
      precio unitario ANTES de impuestos; si se omite `tax_ids` el total de
      la nota queda sin IVA y Siigo rechaza con `invalid_total_payments`.
    `payments`: [{"id", "value"}] — mismos métodos/valores de pago de la
      factura original; la suma debe ser exactamente igual al total (items + IVA).
    `reason`: código de motivo Siigo (1 devolución parcial, 2 anulación de
      factura electrónica, 3 rebaja/descuento, 4 ajuste de precio, 6/7
      descuento comercial). Default 2 = anulación, el caso de cancelaciones.

    Cliente y datos del vendedor se toman automáticamente de `invoice_id`,
    no hace falta pasarlos.
    """
    token = autenticar_siigo()
    if not token:
        return {"ok": False, "error": "No se pudo autenticar con Siigo."}
    if not invoice_id:
        return {"ok": False, "error": "Falta invoice_id de la factura a anular."}
    if not items:
        return {"ok": False, "error": "La nota crédito no tiene ítems."}

    document_id = document_id or _env_int_siigo("SIIGO_CREDIT_NOTE_DOCUMENT_ID", 26671)
    hoy = datetime.now().strftime("%Y-%m-%d")

    items_payload = []
    for it in items:
        codigo = str(it.get("code") or "").strip()
        if not codigo:
            return {"ok": False, "error": f"Ítem sin código: {it!r}"}
        items_payload.append({
            "code": codigo,
            "description": str(it.get("description") or ""),
            "quantity": it.get("quantity", 1),
            "price": it.get("price", 0),
            "taxes": [{"id": tid} for tid in (it.get("tax_ids") or [])],
        })

    payments_payload = [{"id": p["id"], "value": p["value"]} for p in payments]

    payload = {
        "document": {"id": document_id},
        "date": hoy,
        "reason": reason,
        "invoice": invoice_id,
        "items": items_payload,
        "payments": payments_payload,
    }
    if observaciones:
        payload["observations"] = observaciones
    if enviar_dian:
        payload["stamp"] = {"send": True}

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }

    puede_reintentar_auth = True
    try:
        while True:
            res = requests.post(
                "https://api.siigo.com/v1/credit-notes",
                json=payload,
                headers=headers,
                timeout=25,
            )
            if res.status_code in (200, 201):
                break
            if res.status_code == 401 and puede_reintentar_auth:
                _invalidar_cache_token_siigo()
                token = autenticar_siigo(forzar=True)
                puede_reintentar_auth = False
                if not token:
                    return {"ok": False, "error": "Siigo 401 y no fue posible renovar token."}
                headers["Authorization"] = f"Bearer {token}"
                continue
            return {
                "ok": False,
                "status_code": res.status_code,
                "error": f"Error al crear nota crédito en Siigo: {res.text[:1000]}",
                "payload": payload,
            }

        nc = res.json()
        nc_id = nc.get("id")

        if enviar_dian and nc_id:
            for poll_idx in range(6):
                if poll_idx:
                    time.sleep(2)
                try:
                    res_get = requests.get(
                        f"https://api.siigo.com/v1/credit-notes/{nc_id}",
                        headers=headers,
                        timeout=15,
                    )
                    if res_get.status_code == 200:
                        nc = res_get.json()
                        stamp_status = (nc.get("stamp") or {}).get("status")
                        if stamp_status in {"Accepted", "Rejected"}:
                            break
                except requests.RequestException:
                    break

        stamp = nc.get("stamp") or {}
        return {
            "ok": True,
            "credit_note_id": nc_id,
            "name": nc.get("name"),
            "number": nc.get("number"),
            "status": stamp.get("status"),
            "cude": stamp.get("cude") or stamp.get("cufe") or "",
            "total": nc.get("total"),
            "data": nc,
            "payload": payload,
        }
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red con Siigo: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"Error crítico creando nota crédito Siigo: {e}"}


def crear_factura_completa_siigo(nombre_cliente: str, identificacion: str, direccion_envio: str, productos: str, total: float, comprobante_pago_path: str = ""):
    """
    Genera una factura electrónica en Siigo basada en una cotización preliminar,
    adjunta el comprobante de pago y envía el reporte a WhatsApp.
    nombre_cliente: nombre completo o razón social del cliente.
    identificacion: cédula o NIT del cliente.
    direccion_envio: dirección de entrega del pedido.
    productos: JSON string con lista de productos, ej: '[{"nombre":"Acido Citrico","cantidad":1,"precio_unitario":15000}]'
    total: valor total de la factura en pesos colombianos.
    comprobante_pago_path: ruta local al archivo del comprobante (opcional, dejar vacío si no hay).
    """
    import json as _json
    from app.utils import enviar_whatsapp_archivo, enviar_whatsapp_reporte
    import base64

    token = autenticar_siigo()
    if not token:
        return "Error: No se pudo autenticar con Siigo."

    try:
        cotizacion_data = _json.loads(productos) if isinstance(productos, str) else productos
        if isinstance(cotizacion_data, list):
            productos_lista = cotizacion_data
        else:
            productos_lista = [cotizacion_data]
    except Exception:
        productos_lista = []

    comprobante_pago_path = comprobante_pago_path or None

    # 1. Crear la Factura Electrónica en Siigo
    items = []
    for p in productos_lista:
        items.append({
            "code": p.get("codigo", "GENERICO"),
            "description": p["nombre"],
            "quantity": p["cantidad"],
            "price": p["precio_unitario"]
        })

    payload = {
        "document": {"id": 26670}, # ID de Documento para Factura Electrónica de Venta en Siigo
        "date": datetime.now().strftime("%Y-%m-%d"),
        # Marca el canal — sin esto, esta factura queda indistinguible en
        # Siigo de una de MeLi o de la web (que sí llevan Pack ID / MCKG-ref
        # en observations/purchase_order). app.services.salud_negocio la usa
        # para aproximar ingresos de venta directa por WhatsApp (hallazgo
        # ago-2026: antes de este cambio, ese canal no dejaba ningún rastro
        # estructurado — ni aquí ni en ningún otro lado del repo).
        "observations": "Venta directa WhatsApp (agente IA)",
        "customer": {
            "identification": identificacion,
            "id_type": "13" if len(identificacion) <= 10 else "31", # 13: Cédula, 31: NIT
            "person_type": "Person" if len(identificacion) <= 10 else "Company",
            "name": [nombre_cliente, ""], # Nombre y apellido
            "branch_office": 0
        },
        "seller": 150, # Vendedor por defecto: mckenna.group.colombia@gmail.com
        "items": items,
        "payments": [{
            "id": 1333, # ID de pago 'Efectivo'
            "value": total,
            "due_date": datetime.now().strftime("%Y-%m-%d")
        }]
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json"
    }

    try:
        res = requests.post("https://api.siigo.com/v1/invoices", json=payload, headers=headers, timeout=15)
        if res.status_code not in [200, 201]:
            return f"Error al crear factura en Siigo: {res.text}"
        
        factura_siigo = res.json()
        factura_id = factura_siigo.get("id")
        factura_numero = factura_siigo.get("number")
        print(f"✅ Factura electrónica creada: {factura_numero}")

        # Refrescar los datos de la factura con GET para obtener el estado real en la DIAN
        time.sleep(2) # Dar tiempo a que se procese en la DIAN
        try:
            res_get = requests.get(f"https://api.siigo.com/v1/invoices/{factura_id}", headers=headers, timeout=15)
            if res_get.status_code == 200:
                factura_siigo = res_get.json()
        except Exception as e:
            print(f"⚠️ No se pudo refrescar el estado de la factura: {e}")
            
        estado_factura = factura_siigo.get("stamp", {}).get("status", "Desconocido") if "stamp" in factura_siigo else factura_siigo.get("state", "Desconocido")
        observaciones_adicionales = ""
        if estado_factura == "Rejected":
            inconsistencies_raw = factura_siigo.get("observations", "No se especificaron inconsistencias.")
            inconsistencies = inconsistencies_raw if isinstance(inconsistencies_raw, str) else json.dumps(inconsistencies_raw)
            observaciones_adicionales = f"\n⚠️ *Estado DIAN:* RECHAZADA. Inconsistencias: {inconsistencies}"
            print(f"⚠️ Factura {factura_numero} RECHAZADA por la DIAN. Inconsistencias: {inconsistencies}")
        elif estado_factura == "Accepted":
            observaciones_adicionales = f"\n✅ *Estado DIAN:* ACEPTADA."
            print(f"✅ Factura {factura_numero} ACEPTADA por la DIAN.")
        else:
            observaciones_adicionales = f"\nℹ️ *Estado DIAN:* {estado_factura}"
            
        url_siigo = f"https://siigonube.siigo.com/#/invoice/843/{factura_id}"

        # 2. Adjuntar Comprobante de Pago (si se proporciona)
        # Siigo permite adjuntos mediante el endpoint /v1/invoices/{id}/attachments
        if comprobante_pago_path and os.path.exists(comprobante_pago_path):
            with open(comprobante_pago_path, "rb") as f:
                encoded_file = base64.b64encode(f.read()).decode('utf-8')
            
            attachment_payload = {
                "file_name": os.path.basename(comprobante_pago_path),
                "base64": encoded_file
            }
            att_res = requests.post(
                f"https://api.siigo.com/v1/invoices/{factura_id}/attachments",
                json=attachment_payload,
                headers=headers,
                timeout=20
            )
            if att_res.status_code in [200, 201]:
                print(f"✅ Comprobante de pago adjunto a la factura {factura_numero}")
            else:
                print(f"⚠️ No se pudo adjuntar el comprobante: {att_res.text}")

        # 3. Descargar PDF de la factura
        pdf_base64 = descargar_factura_pdf_siigo(factura_id)
        pdf_path = f"facturas_descargadas/Factura_{factura_numero}.pdf"
        os.makedirs("facturas_descargadas", exist_ok=True)
        
        if "Error" not in pdf_base64:
            with open(pdf_path, "wb") as f:
                f.write(base64.b64decode(pdf_base64))
            print(f"✅ PDF de factura guardado en {pdf_path}")
        else:
            pdf_path = None

        # 4. Enviar reporte a WhatsApp
        mensaje_wa = f"🚀 *Factura Electrónica Generada*\n\n"
        mensaje_wa += f"📄 *Número:* {factura_numero}\n"
        mensaje_wa += f"🔗 *Link SIIGO:* {url_siigo}\n"
        mensaje_wa += f" *Cliente:* {nombre_cliente}\n"
        mensaje_wa += f"💰 *Total:* ${total}\n"
        mensaje_wa += f"📍 *Dirección de Envío:* {direccion_envio}\n"
        mensaje_wa += observaciones_adicionales + "\n\n"
        mensaje_wa += "📦 *Resumen del Pedido:*\n"
        for p in productos_lista:
            mensaje_wa += f"- {p['cantidad']}x {p['nombre']} (${p['precio_unitario']})\n"
        
        # Enviar mensaje de texto con resumen al grupo de facturación de ventas
        import os as _os
        grupo_ventas = _os.getenv("GRUPO_FACTURACION_VENTAS_WA", "120363425465848868@g.us")
        enviar_whatsapp_reporte(mensaje_wa, numero_destino=grupo_ventas)

        # Enviar PDF de la factura
        if pdf_path:
            enviar_whatsapp_archivo(pdf_path, f"Factura Electrónica {factura_numero}", f"Factura_{factura_numero}.pdf", numero_destino=grupo_ventas)

        # Enviar Comprobante de Pago si existe
        if comprobante_pago_path:
            enviar_whatsapp_archivo(comprobante_pago_path, "Comprobante de Pago del Cliente", numero_destino=grupo_ventas)

        return f"✅ Factura {factura_numero} generada y reportada exitosamente.{observaciones_adicionales}"

    except Exception as e:
        print(f"❌ Error en el proceso de facturación: {e}")
        return f"Error crítico: {str(e)}"


def buscar_producto_siigo_por_sku(sku: str):
    """
    Busca un producto en SIIGO por SKU y retorna nombre oficial,
    precio de venta y unidad de medida.
    """
    token = autenticar_siigo()
    if not token:
        return None

    try:
        res = requests.get(
            f"https://api.siigo.com/v1/products?code={sku}",
            headers={
                "Authorization": f"Bearer {token}",
                "Partner-Id": PARTNER_ID
            },
            timeout=10
        )
        if res.status_code == 200:
            data = res.json()
            productos = data.get('results', [])
            if productos:
                p = productos[0]
                # prices[0].price_list[0].value
                try:
                    precio = p['prices'][0]['price_list'][0]['value']
                except (IndexError, KeyError):
                    precio = 0
                # unit es un objeto {"code": ..., "name": ...}
                unidad_raw = p.get('unit', {})
                unidad = unidad_raw.get('name', '') if isinstance(unidad_raw, dict) else str(unidad_raw)
                return {
                    "sku": sku,
                    "nombre": p.get('name', ''),
                    "precio": precio,
                    "unidad": unidad,
                    "referencia": p.get('code', sku),
                    "stock_siigo": p.get('available_quantity', None)
                }
        else:
            print(f"⚠️ SIIGO products API: {res.status_code} para SKU {sku}")
    except Exception as e:
        print(f"❌ Error consultando SIIGO por SKU: {e}")
    return None


def buscar_productos_siigo_picker(
    consulta: str,
    *,
    max_items: int = 40,
    excluir_combos: bool = True,
) -> list[dict]:
    """
    Busca productos activos en Siigo para pickers del panel (código o nombre).
    Combina API en vivo (código exacto, name, creados recientes) + caché de costos,
    para que productos recién creados aparezcan de inmediato.
    Retorna [{codigo, nombre, type}].
    """
    from datetime import datetime, timedelta

    q = (consulta or "").strip()
    if "—" in q or " - " in q:
        q = q.split("—")[0].split(" - ")[0].strip()
    if len(q) < 1:
        return []

    items: list[dict] = []
    seen: set[str] = set()

    def _add(raw: dict) -> None:
        if len(items) >= max_items:
            return
        code = (raw.get("code") or "").strip()
        name = (raw.get("name") or "").strip()
        if not code:
            return
        cu = code.upper()
        if cu in seen:
            return
        t = (raw.get("type") or "Product").strip() or "Product"
        if excluir_combos and t.lower() == "combo":
            return
        if raw.get("active") is False:
            return
        seen.add(cu)
        items.append({"codigo": code, "nombre": name or code, "type": t})

    def _match_local(code: str, name: str) -> bool:
        q_up = q.upper()
        q_low = q.lower()
        cu = (code or "").upper()
        nl = (name or "").lower()
        return cu == q_up or q_up in cu or q_low in nl

    # 1) Código exacto en Siigo (incluye recién creados)
    res = _siigo_get(
        "https://api.siigo.com/v1/products",
        params={"code": q, "page_size": 10},
    )
    if res is not None and res.status_code == 200:
        for p in (res.json() or {}).get("results") or []:
            code = (p.get("code") or "").strip()
            # Siigo a veces ignora el filtro; solo aceptar coincidencias reales
            if code and (code.upper() == q.upper() or q.upper() in code.upper()):
                _add(p)

    # Si el usuario pegó un código exacto y ya hay match, no hace falta más red
    if items and any(it["codigo"].upper() == q.upper() for it in items):
        return items[:max_items]

    # 2) Filtro por nombre (algunos tenants Siigo lo soportan)
    if len(items) < max_items and len(q) >= 2:
        res = _siigo_get(
            "https://api.siigo.com/v1/products",
            params={"name": q, "active": "true", "page_size": min(max_items, 100)},
        )
        if res is not None and res.status_code == 200:
            for p in (res.json() or {}).get("results") or []:
                code = (p.get("code") or "").strip()
                name = (p.get("name") or "").strip()
                if _match_local(code, name):
                    _add(p)

    # 3) Productos creados recientemente (cubre altas del panel no indexadas en caché)
    if len(items) < max_items and len(q) >= 2:
        created_start = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        for page in range(1, 4):
            if len(items) >= max_items:
                break
            res = _siigo_get(
                "https://api.siigo.com/v1/products",
                params={
                    "created_start": created_start,
                    "active": "true",
                    "page": page,
                    "page_size": 100,
                },
            )
            if res is None or res.status_code != 200:
                break
            results = (res.json() or {}).get("results") or []
            if not results:
                break
            for p in results:
                code = (p.get("code") or "").strip()
                name = (p.get("name") or "").strip()
                if _match_local(code, name):
                    _add(p)
            if len(results) < 100:
                break

    # 4) Caché de costos (cobertura histórica / búsqueda por nombre)
    if len(items) < max_items:
        try:
            from app.services.rentabilidad import construir_catalogo_costos, indice_codigo_a_nombre

            catalogo = construir_catalogo_costos()
            codigo_a_nombre = indice_codigo_a_nombre(catalogo)
        except Exception:
            codigo_a_nombre = {}

        q_up = q.upper()
        q_low = q.lower()
        exactos, prefijos, nombres = [], [], []
        for code, name in codigo_a_nombre.items():
            code_s = str(code)
            name_s = str(name or "")
            # Prefijo C- suele ser combo: se incluyen (la creación los expande a Product)
            cu = code_s.upper()
            if cu in seen:
                continue
            if cu == q_up:
                exactos.append((code_s, name_s))
            elif cu.startswith(q_up) or q_up in cu:
                prefijos.append((code_s, name_s))
            elif q_low in name_s.lower():
                nombres.append((code_s, name_s))
        for bucket in (exactos, prefijos, nombres):
            for code_s, name_s in bucket:
                _add({"code": code_s, "name": name_s, "type": "Product", "active": True})
                if len(items) >= max_items:
                    break
            if len(items) >= max_items:
                break

    return items[:max_items]


def _precio_lista_siigo_producto(p: dict) -> float:
    try:
        return float(p["prices"][0]["price_list"][0]["value"])
    except (KeyError, IndexError, TypeError, ValueError):
        return 0.0


_combos_cache: list = []
_combos_cache_ts: float = 0.0
_COMBOS_TTL = 300  # 5 minutos


def listar_productos_combo_siigo() -> list:
    """
    Devuelve los items crudos de la API SIIGO con type Combo (activos).
    Si el filtro type=Combo no devuelve datos, pagina todos los productos y filtra.
    """
    global _combos_cache, _combos_cache_ts
    if _combos_cache and time.time() - _combos_cache_ts < _COMBOS_TTL:
        return _combos_cache

    out = []
    seen = set()

    def consume_results(results, strict_combo: bool) -> None:
        for p in results:
            code = (p.get("code") or "").strip()
            if not code or code.upper() in seen:
                continue
            t = (p.get("type") or "").strip().lower()
            if strict_combo and t != "combo":
                continue
            if not p.get("active", True):
                continue
            seen.add(code.upper())
            out.append(p)

    def _paginar(params: dict, max_pages: int) -> None:
        for page in range(1, max_pages):
            res = _siigo_get(
                "https://api.siigo.com/v1/products",
                params={**params, "page": page, "page_size": 100},
            )
            if res is None or res.status_code != 200:
                break
            data = res.json()
            results = data.get("results") or []
            if not results:
                break
            consume_results(results, strict_combo=True)
            pag = data.get("pagination") or {}
            total = int(pag.get("total_results") or 0)
            if total and page * 100 >= total:
                break
            if len(results) < 100:
                break

    _paginar({"type": "Combo", "active": "true"}, max_pages=500)

    if not out:
        _paginar({}, max_pages=2000)

    if out:
        _combos_cache = out
        _combos_cache_ts = time.time()
        return out
    # API caída o respuesta vacía al refrescar: devolver el catálogo anterior
    # (aunque esté vencido) en vez de una lista vacía — con [] el chat web le
    # decía al cliente "no encontré esa referencia" para productos que sí
    # existen, de forma intermitente según el minuto del TTL.
    return _combos_cache


_ACCOUNT_GROUP_PRODUCTO_DEFAULT = 297
_TAX_IVA_ID = 3118


def _account_group_desde_combo_existente() -> int:
    """Toma el account_group de un combo activo; fallback al de productos (297)."""
    for raw in listar_productos_combo_siigo() or []:
        ag = raw.get("account_group")
        if isinstance(ag, dict) and ag.get("id"):
            try:
                return int(ag["id"])
            except (TypeError, ValueError):
                continue
        if isinstance(ag, int):
            return ag
    return _ACCOUNT_GROUP_PRODUCTO_DEFAULT


def _invalidar_cache_combos_siigo() -> None:
    global _combos_cache, _combos_cache_ts
    _combos_cache = []
    _combos_cache_ts = 0.0


def _obtener_producto_siigo_por_codigo(codigo: str, headers: dict) -> dict | None:
    """GET producto por code (prueba variantes de mayúsculas)."""
    code = (codigo or "").strip()
    if not code:
        return None
    variants = [code]
    for v in (code.upper(), code.lower()):
        if v not in variants:
            variants.append(v)
    for variant in variants:
        try:
            res = requests.get(
                "https://api.siigo.com/v1/products",
                params={"code": variant, "page_size": 5},
                headers=headers,
                timeout=15,
            )
        except requests.RequestException:
            continue
        if res.status_code != 200:
            continue
        for p in (res.json() or {}).get("results") or []:
            if (p.get("code") or "").strip().upper() == variant.upper():
                return p
        results = (res.json() or {}).get("results") or []
        if results:
            return results[0]
    return None


def _codigo_desde_componente_siigo(comp: dict, headers: dict) -> str:
    """Resuelve el code de un componente GET (a veces solo trae id/name)."""
    code = (comp.get("code") or "").strip()
    if code:
        return code
    comp_id = comp.get("id")
    if not comp_id:
        return ""
    try:
        rc = requests.get(
            f"https://api.siigo.com/v1/products/{comp_id}",
            headers=headers,
            timeout=12,
        )
        if rc.status_code == 200:
            return ((rc.json() or {}).get("code") or "").strip()
    except requests.RequestException:
        pass
    return ""


def _expandir_lineas_componentes_combo(
    lineas: list[tuple[str, float]],
    headers: dict,
    *,
    max_depth: int = 4,
) -> tuple[list[tuple[str, float]], list[str], str]:
    """
    Siigo no admite Combo como componente de otro Combo.
    Expande recursivamente combos anidados a productos inventariables.
    Retorna (lineas_planas, notas_expansion, error).
    """
    acumulado: dict[str, float] = {}
    notas: list[str] = []

    def _sumar(code: str, qty: float) -> None:
        cu = code.upper()
        # conservar casing del primero visto
        for k in list(acumulado.keys()):
            if k.upper() == cu:
                acumulado[k] = acumulado[k] + qty
                return
        acumulado[code] = qty

    def _walk(codigo: str, cantidad: float, depth: int, ruta: list[str]) -> str:
        if depth > max_depth:
            return (
                f"Anidamiento demasiado profundo al expandir '{codigo}' "
                f"({' → '.join(ruta + [codigo])})."
            )
        prod = _obtener_producto_siigo_por_codigo(codigo, headers)
        if not prod:
            return (
                f"El componente '{codigo}' no existe en Siigo. "
                "Créalo primero o verifica el código."
            )
        code_real = (prod.get("code") or codigo).strip()
        tipo_low = (prod.get("type") or "").strip().lower()

        if tipo_low != "combo":
            _sumar(code_real, cantidad)
            return ""

        if prod.get("active") is False:
            return f"El combo '{code_real}' está inactivo; no se puede expandir."

        comps = prod.get("components") or []
        if not comps:
            return f"El combo '{code_real}' no tiene componentes en Siigo."

        notas.append(
            f"{code_real}×{cantidad:g} → {len(comps)} componente(s) inventariable(s)"
        )
        for sub in comps:
            sub_code = _codigo_desde_componente_siigo(sub, headers)
            if not sub_code:
                nombre = (sub.get("name") or "?").strip()
                return (
                    f"No se pudo resolver el código del componente '{nombre}' "
                    f"dentro de '{code_real}'."
                )
            try:
                sub_qty = float(sub.get("quantity") or 1)
            except (TypeError, ValueError):
                sub_qty = 1.0
            if sub_qty <= 0:
                continue
            err = _walk(sub_code, cantidad * sub_qty, depth + 1, ruta + [code_real])
            if err:
                return err
        return ""

    for codigo, qty in lineas:
        err = _walk(codigo, qty, 0, [])
        if err:
            return [], notas, err

    planos = [(c, q) for c, q in acumulado.items() if q > 0]
    if not planos:
        return [], notas, "Tras expandir combos no quedó ningún producto inventariable"
    return planos, notas, ""


def _validar_componente_para_combo(
    codigo: str,
    cantidad: float,
    headers: dict,
) -> tuple[dict | None, str]:
    """
    Verifica que un código pueda usarse como componente de Combo en Siigo.
    Retorna ({code, quantity}, "") o (None, error_es).
    (Los Combos deben expandirse antes con _expandir_lineas_componentes_combo.)
    """
    prod = _obtener_producto_siigo_por_codigo(codigo, headers)
    if not prod:
        return None, (
            f"El componente '{codigo}' no existe en Siigo. "
            "Créalo primero como Producto (no Combo) o verifica el código."
        )

    code_real = (prod.get("code") or codigo).strip()
    nombre = (prod.get("name") or "").strip()
    tipo = (prod.get("type") or "").strip()
    tipo_low = tipo.lower()

    if prod.get("active") is False:
        return None, (
            f"El componente '{code_real}' ({nombre}) está inactivo en Siigo. Actívalo antes de usarlo en un combo."
        )

    if tipo_low == "combo":
        return None, (
            f"'{code_real}' sigue siendo Combo tras la expansión. "
            "Revisa que sus componentes tengan código de Producto."
        )

    if tipo_low in ("service", "consumergood", "consumer good"):
        return None, (
            f"'{code_real}' es tipo '{tipo}'. Los componentes del combo deben ser Productos inventariables."
        )

    if tipo and tipo_low != "product":
        return None, (
            f"'{code_real}' tiene tipo '{tipo}'. Solo productos tipo Product pueden armar un combo."
        )

    if not prod.get("stock_control", False):
        # Intentar activar control de inventario (requisito frecuente en Siigo Premium).
        product_id = prod.get("id")
        if product_id:
            try:
                body, err = _preparar_producto_siigo_para_put(
                    copy.deepcopy(prod), headers
                )
                if body and not err:
                    body["stock_control"] = True
                    if not body.get("warehouses"):
                        body["warehouses"] = [
                            {"id": 41, "quantity": 0, "unit_cost": 0}
                        ]
                    ru = requests.put(
                        f"https://api.siigo.com/v1/products/{product_id}",
                        json=body,
                        headers=headers,
                        timeout=20,
                    )
                    if ru.status_code not in (200, 201):
                        return None, (
                            f"'{code_real}' no tiene control de inventario y Siigo lo exige para combos. "
                            f"Actívalo en Siigo Nube (Inventario → producto → control de stock). "
                            f"Detalle: {(ru.text or '')[:160]}"
                        )
            except Exception as e:
                return None, (
                    f"'{code_real}' no tiene control de inventario (requerido en combos). "
                    f"Actívalo en Siigo. ({e})"
                )
        else:
            return None, (
                f"'{code_real}' no tiene control de inventario. Actívalo en Siigo antes de usarlo en un combo."
            )

    qty = float(cantidad)
    if qty <= 0:
        return None, f"Cantidad inválida para '{code_real}'"
    # Siigo suele preferir enteros cuando la cantidad es exacta
    qty_out: float | int = int(qty) if abs(qty - int(qty)) < 1e-9 else qty
    return {"code": code_real, "quantity": qty_out}, ""


def _mensaje_error_combo_siigo(status: int, text: str) -> str:
    """Traduce errores frecuentes de creación de combo a mensaje accionable."""
    raw = (text or "").strip()
    low = raw.lower()
    if "product_settings" in low and "components" in low:
        return (
            "Siigo rechazó un componente del combo (product_settings). "
            "Cada componente debe existir, estar activo, ser tipo Product "
            "(no Combo/Servicio) y tener control de inventario. "
            f"Detalle: {raw[:220]}"
        )
    if "parameter_required" in low and "prices" in low:
        return (
            "Siigo exige un precio de lista válido si se envía la lista de precios. "
            f"Detalle: {raw[:220]}"
        )
    return f"SIIGO HTTP {status}: {raw[:300]}"


def crear_combo_en_siigo(
    codigo: str,
    nombre: str,
    componentes: list,
    *,
    precio_lista: float = 0.0,
    iva: bool = True,
    account_group: int | None = None,
) -> dict:
    """
    Crea un producto tipo Combo en SIIGO (POST /v1/products).
    componentes: [{code|codigo, quantity|cantidad}, ...]
    Retorna {ok, mensaje|error, siigo_id?, siigo_producto?}.
    """
    import re

    codigo_limpio = re.sub(r"[^A-Za-z0-9._-]", "", (codigo or "").strip())
    if not codigo_limpio or not re.match(r"^[A-Za-z0-9._-]{2,40}$", codigo_limpio):
        return {"ok": False, "error": f"Código SIIGO inválido: {codigo}"}
    nombre_limpio = (nombre or "").strip()[:100]
    if not nombre_limpio:
        return {"ok": False, "error": "El nombre del combo es obligatorio"}

    comps_raw = []
    for raw in componentes or []:
        if not isinstance(raw, dict):
            continue
        c = re.sub(
            r"[^A-Za-z0-9._-]",
            "",
            str(raw.get("code") or raw.get("codigo") or "").strip(),
        )
        if not c:
            continue
        try:
            qty = float(
                raw.get("quantity")
                if raw.get("quantity") is not None
                else raw.get("cantidad") or 1
            )
        except (TypeError, ValueError):
            qty = 1.0
        if qty <= 0:
            return {"ok": False, "error": f"Cantidad inválida para componente {c}"}
        comps_raw.append((c, qty))

    if len(comps_raw) < 1:
        return {"ok": False, "error": "El combo necesita al menos un componente"}

    token = autenticar_siigo()
    if not token:
        return {"ok": False, "error": "No se pudo autenticar con SIIGO"}

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }

    # Duplicado del código del combo
    existente_combo = _obtener_producto_siigo_por_codigo(codigo_limpio, headers)
    if existente_combo:
        return {
            "ok": False,
            "error": f"El código {codigo_limpio} ya existe en SIIGO",
            "siigo_producto": {
                "codigo": existente_combo.get("code", codigo_limpio),
                "nombre": existente_combo.get("name", ""),
                "activo": existente_combo.get("active", True),
            },
        }

    comps_out = []
    planos, notas_exp, err_exp = _expandir_lineas_componentes_combo(comps_raw, headers)
    if err_exp:
        return {"ok": False, "error": err_exp}
    for c, qty in planos:
        normalizado, err = _validar_componente_para_combo(c, qty, headers)
        if err or not normalizado:
            return {"ok": False, "error": err or f"Componente inválido: {c}"}
        comps_out.append(normalizado)

    ag = account_group if account_group is not None else _account_group_desde_combo_existente()
    try:
        precio = float(precio_lista or 0)
    except (TypeError, ValueError):
        precio = 0.0

    payload = {
        "code": codigo_limpio,
        "name": nombre_limpio,
        "account_group": int(ag),
        "type": "Combo",
        "stock_control": False,
        "unit": {"code": "94"},
        "components": comps_out,
        "taxes": [{"id": _TAX_IVA_ID}] if iva else [],
    }
    if precio > 0:
        payload["prices"] = [
            {
                "currency_code": "COP",
                "price_list": [{"position": 1, "value": round(precio, 0)}],
            }
        ]

    try:
        r = requests.post(
            "https://api.siigo.com/v1/products",
            json=payload,
            headers=headers,
            timeout=25,
        )
        if r.status_code in (200, 201):
            data = r.json() if r.content else {}
            _invalidar_cache_combos_siigo()
            mensaje = f"Combo {codigo_limpio} creado en SIIGO"
            if notas_exp:
                mensaje += " · Expandió: " + "; ".join(notas_exp[:3])
                if len(notas_exp) > 3:
                    mensaje += f" (+{len(notas_exp) - 3} más)"
            return {
                "ok": True,
                "mensaje": mensaje,
                "siigo_id": data.get("id"),
                "siigo_producto": {
                    "codigo": data.get("code", codigo_limpio),
                    "nombre": data.get("name", nombre_limpio),
                    "activo": data.get("active", True),
                    "type": "Combo",
                },
                "componentes_expandidos": comps_out,
                "expansion": notas_exp,
            }
        return {
            "ok": False,
            "error": _mensaje_error_combo_siigo(r.status_code, r.text or ""),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def actualizar_precio_combo_siigo(code: str, nuevo_precio: float) -> dict:
    """
    Actualiza el precio de lista de un producto combo en Siigo.
    GET product → modifica prices → PUT /v1/products/{id}.
    Retorna {"ok": bool, "msg": str}.
    """
    token = autenticar_siigo()
    if not token:
        return {"ok": False, "msg": "No se pudo autenticar en Siigo"}

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }

    try:
        res = requests.get(
            "https://api.siigo.com/v1/products",
            params={"code": code},
            headers=headers,
            timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red obteniendo producto: {e}"}

    if res.status_code != 200:
        return {"ok": False, "msg": f"Siigo GET error {res.status_code}: {res.text[:200]}"}

    products = res.json().get("results", [])
    if not products:
        for variant in {code.upper(), code.lower()} - {code}:
            try:
                rv = requests.get(
                    "https://api.siigo.com/v1/products",
                    params={"code": variant},
                    headers=headers,
                    timeout=15,
                )
                if rv.status_code == 200:
                    products = rv.json().get("results", [])
                    if products:
                        code = variant
                        break
            except requests.RequestException:
                pass
    if not products:
        return {"ok": False, "msg": f"Producto '{code}' no encontrado en Siigo"}

    product = copy.deepcopy(products[0])
    product_id = product.get("id")
    if not product_id:
        return {"ok": False, "msg": "Producto sin ID en Siigo"}

    prices = product.get("prices") or []
    if not prices:
        return {"ok": False, "msg": "Producto sin estructura de precios en Siigo"}

    for price_group in prices:
        for pl in (price_group.get("price_list") or []):
            pl["value"] = round(nuevo_precio, 2)

    product["prices"] = prices

    # Siigo PUT exige account_group numérico y code en cada componente del combo.
    ag = product.get("account_group")
    if isinstance(ag, dict) and ag.get("id"):
        product["account_group"] = ag["id"]
    elif not isinstance(ag, int):
        return {"ok": False, "msg": "Producto sin account_group válido en Siigo"}

    for comp in product.get("components") or []:
        if comp.get("code"):
            continue
        comp_id = comp.get("id")
        if not comp_id:
            continue
        try:
            rc = requests.get(
                f"https://api.siigo.com/v1/products/{comp_id}",
                headers=headers,
                timeout=12,
            )
            if rc.status_code == 200:
                fetched_code = rc.json().get("code") or ""
                if fetched_code:
                    comp["code"] = fetched_code
        except requests.RequestException:
            pass

    try:
        res_put = requests.put(
            f"https://api.siigo.com/v1/products/{product_id}",
            json=product,
            headers=headers,
            timeout=20,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red actualizando precio: {e}"}

    if res_put.status_code in (200, 201):
        return {"ok": True, "msg": f"Precio actualizado en Siigo (id={product_id})"}
    return {"ok": False, "msg": f"Siigo PUT {res_put.status_code}: {res_put.text[:300]}"}


def _siigo_headers_json(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }


def _obtener_producto_siigo_por_code(code: str, headers: dict) -> tuple[dict | None, str]:
    """GET producto por code. Retorna (producto, code_efectivo) o (None, error)."""
    try:
        res = requests.get(
            "https://api.siigo.com/v1/products",
            params={"code": code},
            headers=headers,
            timeout=15,
        )
    except requests.RequestException as e:
        return None, f"Error de red obteniendo producto: {e}"

    if res.status_code != 200:
        return None, f"Siigo GET error {res.status_code}: {res.text[:200]}"

    products = res.json().get("results", [])
    if not products:
        for variant in {code.upper(), code.lower()} - {code}:
            try:
                rv = requests.get(
                    "https://api.siigo.com/v1/products",
                    params={"code": variant},
                    headers=headers,
                    timeout=15,
                )
                if rv.status_code == 200:
                    products = rv.json().get("results", [])
                    if products:
                        code = variant
                        break
            except requests.RequestException:
                pass
    if not products:
        return None, f"Producto '{code}' no encontrado en Siigo"
    return products[0], code


def _preparar_producto_siigo_para_put(
    product: dict,
    headers: dict,
    *,
    cache_componentes: dict | None = None,
) -> tuple[dict | None, str]:
    """Normaliza account_group/unit/taxes/components para PUT Siigo.

    Si un componente está inactivo, intenta sustituir su code por un producto
    activo con el mismo nombre (necesario: Siigo rechaza codes inactivos en PUT).
    """
    product = copy.deepcopy(product)
    product_id = product.get("id")
    if not product_id:
        return None, "Producto sin ID en Siigo"

    ag = product.get("account_group")
    if isinstance(ag, dict) and ag.get("id"):
        product["account_group"] = ag["id"]
    elif not isinstance(ag, int):
        return None, "Producto sin account_group válido en Siigo"

    unit = product.get("unit")
    if isinstance(unit, dict) and unit.get("code"):
        product["unit"] = unit["code"]

    taxes = product.get("taxes")
    if isinstance(taxes, list):
        product["taxes"] = [
            {"id": t["id"]} for t in taxes if isinstance(t, dict) and t.get("id")
        ]

    cache = cache_componentes if cache_componentes is not None else {}
    for comp in product.get("components") or []:
        qty = comp.get("quantity", 1)
        if comp.get("code"):
            continue
        comp_id = comp.get("id")
        if not comp_id:
            continue

        def _aplicar_code(code: str) -> None:
            if not code:
                return
            comp.clear()
            comp["code"] = code
            comp["quantity"] = qty

        if comp_id in cache and cache[comp_id]:
            _aplicar_code(cache[comp_id])
            continue
        # Si el cache tenía "", reintentar fetch (puede haber sido un fallo temporal).
        try:
            rc = requests.get(
                f"https://api.siigo.com/v1/products/{comp_id}",
                headers=headers,
                timeout=12,
            )
            if rc.status_code != 200:
                cache[comp_id] = ""
                continue
            detail = rc.json()
            fetched_code = (detail.get("code") or "").strip()
            active = detail.get("active", True)
            if fetched_code and active:
                cache[comp_id] = fetched_code
                _aplicar_code(fetched_code)
                continue
            # Inactivo: intentar equivalente activo por nombre (sin cambiar si SIIGO lo bloquea luego)
            nombre = (detail.get("name") or comp.get("name") or "").strip()
            alt = _buscar_code_activo_por_nombre(nombre, headers) if nombre else None
            if alt:
                cache[comp_id] = alt
                _aplicar_code(alt)
            elif fetched_code:
                cache[comp_id] = fetched_code
                _aplicar_code(fetched_code)
            else:
                cache[comp_id] = ""
        except requests.RequestException:
            cache[comp_id] = ""

    for k in ("metadata", "available_quantity"):
        product.pop(k, None)

    return product, product_id


_nombre_activo_cache: dict[str, str] = {}


def _buscar_code_activo_por_nombre(nombre: str, headers: dict) -> str | None:
    """Busca un producto activo cuyo nombre coincida (cacheado por nombre)."""
    key = re.sub(r"\s+", " ", (nombre or "").strip().upper())
    if not key:
        return None
    if key in _nombre_activo_cache:
        return _nombre_activo_cache[key] or None

    # Coincidencias conocidas (inactive → active) observados en combos 30mL
    aliases = {
        "GOTERO PIPETA 77MM NEGRO": "GOTPIPNEG77mm",
        "GOTERO PIPETA 77MM NEGRA": "GOTPIPNEG77mm",
    }
    if key in aliases:
        _nombre_activo_cache[key] = aliases[key]
        return aliases[key]

    try:
        res = requests.get(
            "https://api.siigo.com/v1/products",
            params={"name": nombre.strip(), "active": "true", "page_size": 25},
            headers=headers,
            timeout=15,
        )
    except requests.RequestException:
        _nombre_activo_cache[key] = ""
        return None
    if res.status_code != 200:
        _nombre_activo_cache[key] = ""
        return None
    for p in res.json().get("results") or []:
        if not p.get("active", True):
            continue
        n = re.sub(r"\s+", " ", (p.get("name") or "").strip().upper())
        if n == key:
            code = (p.get("code") or "").strip()
            _nombre_activo_cache[key] = code
            return code or None
    _nombre_activo_cache[key] = ""
    return None


def actualizar_barcode_producto_siigo(
    code: str,
    barcode: str,
    *,
    forzar: bool = False,
    cache_componentes: dict | None = None,
    producto: dict | None = None,
) -> dict:
    """
    Escribe el código de barras (EAN) en additional_fields.barcode del producto Siigo.
    GET → PUT. Si ya tiene el mismo barcode y forzar=False, no hace PUT.
    """
    barcode = re.sub(r"\D", "", str(barcode or ""))
    if not barcode:
        return {"ok": False, "msg": "Barcode vacío"}
    if len(barcode) not in (8, 12, 13, 14):
        return {"ok": False, "msg": f"Barcode con longitud inválida ({len(barcode)})"}

    token = autenticar_siigo()
    if not token:
        return {"ok": False, "msg": "No se pudo autenticar en Siigo"}

    headers = _siigo_headers_json(token)
    if producto is None:
        product, err_or_code = _obtener_producto_siigo_por_code(code, headers)
        if product is None:
            return {"ok": False, "msg": err_or_code}
        code = err_or_code
    else:
        product = producto

    af = product.get("additional_fields")
    if not isinstance(af, dict):
        af = {}
    actual = re.sub(r"\D", "", str(af.get("barcode") or ""))
    if actual == barcode and not forzar:
        return {
            "ok": True,
            "skipped": True,
            "msg": f"Ya tenía barcode {barcode}",
            "code": code,
            "barcode": barcode,
        }

    prepared, product_id = _preparar_producto_siigo_para_put(
        product, headers, cache_componentes=cache_componentes
    )
    if prepared is None:
        return {"ok": False, "msg": product_id}

    af = dict(prepared.get("additional_fields") or {})
    af["barcode"] = barcode
    prepared["additional_fields"] = af

    try:
        res_put = requests.put(
            f"https://api.siigo.com/v1/products/{product_id}",
            json=prepared,
            headers=headers,
            timeout=25,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red actualizando barcode: {e}"}

    if res_put.status_code in (200, 201):
        global _combos_cache, _combos_cache_ts
        _combos_cache = []
        _combos_cache_ts = 0.0
        return {
            "ok": True,
            "skipped": False,
            "msg": f"Barcode actualizado en Siigo ({code})",
            "code": code,
            "barcode": barcode,
            "id": product_id,
        }
    return {
        "ok": False,
        "msg": f"Siigo PUT {res_put.status_code}: {res_put.text[:300]}",
        "code": code,
    }


def sincronizar_barcodes_ean_a_siigo(
    *,
    solo_vacios: bool = True,
    delay_s: float = 0.35,
    limite: int | None = None,
) -> dict:
    """
    Empuja los EAN de app/data/etiquetas_codigos_ean.json a additional_fields.barcode en Siigo.
    Empareja por SKU exacto (normalizado).
    """
    from app.tools.etiquetas_codigos_ean import normalizar_sku_ean

    ruta = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data",
        "etiquetas_codigos_ean.json",
    )
    try:
        with open(ruta, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return {"ok": False, "error": f"No se pudo leer planilla EAN: {e}"}

    items = data.get("codigos") if isinstance(data, dict) else []
    if not isinstance(items, list):
        return {"ok": False, "error": "Planilla EAN inválida"}

    by_sku = {}
    for it in items:
        sku = normalizar_sku_ean(str(it.get("sku") or ""))
        codigo = re.sub(r"\D", "", str(it.get("codigo") or ""))
        if sku and len(codigo) == 13:
            by_sku[sku] = {"sku": it.get("sku"), "codigo": codigo}

    combos = listar_productos_combo_siigo()
    actualizados = 0
    omitidos = 0
    errores: list[str] = []
    detalle: list[dict] = []
    procesados = 0
    cache_componentes: dict = {}

    for p in combos:
        code = (p.get("code") or "").strip()
        if not code:
            continue
        entry = by_sku.get(normalizar_sku_ean(code))
        if not entry:
            continue
        if limite is not None and procesados >= limite:
            break
        procesados += 1

        af = p.get("additional_fields") if isinstance(p.get("additional_fields"), dict) else {}
        actual = re.sub(r"\D", "", str(af.get("barcode") or ""))
        if solo_vacios and actual:
            omitidos += 1
            continue

        res = actualizar_barcode_producto_siigo(
            code,
            entry["codigo"],
            forzar=not solo_vacios,
            cache_componentes=cache_componentes,
            producto=p,
        )
        if res.get("ok") and res.get("skipped"):
            omitidos += 1
        elif res.get("ok"):
            actualizados += 1
            detalle.append({"sku": code, "barcode": entry["codigo"]})
        else:
            errores.append(f"{code}: {res.get('msg')}")
        if delay_s > 0:
            time.sleep(delay_s)

    return {
        "ok": True,
        "actualizados": actualizados,
        "omitidos": omitidos,
        "errores": errores,
        "procesados": procesados,
        "en_planilla": len(by_sku),
        "detalle": detalle[:40],
    }


def actualizar_costo_componente_siigo(
    nombre: str,
    precio_sin_iva: float,
    catalogo: dict | None = None,
    codigo: str | None = None,
) -> dict:
    """
    Actualiza el precio de lista de un componente (insumo) en Siigo.
    Preferir `codigo` (SKU Siigo) cuando se conozca; si no, busca por nombre
    normalizado en el catálogo. GET → PUT prices.
    Retorna {"ok": bool, "msg": str, "codigo": str|None}.
    """
    from app.services.rentabilidad import _norm, construir_catalogo_costos

    codigo_eff = (codigo or "").strip()
    if not codigo_eff:
        if catalogo is None:
            try:
                catalogo = construir_catalogo_costos()
            except Exception as e:
                return {"ok": False, "msg": f"Error cargando catálogo: {e}", "codigo": None}

        codigo_eff = (catalogo.get("nombre_a_codigo", {}) or {}).get(_norm(nombre)) or ""
        if not codigo_eff:
            # Fallback: match parcial por nombre en codigo_a_nombre / nombre_a_codigo
            target = _norm(nombre)
            for nrm, code in (catalogo.get("nombre_a_codigo") or {}).items():
                if nrm == target or (target and target in nrm) or (nrm and nrm in target):
                    codigo_eff = str(code)
                    break
        if not codigo_eff:
            return {
                "ok": False,
                "msg": f"'{nombre}' no encontrado en catálogo Siigo (indique código SKU)",
                "codigo": None,
            }

    token = autenticar_siigo()
    if not token:
        return {"ok": False, "msg": "No se pudo autenticar en Siigo", "codigo": codigo_eff}

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }

    try:
        res = requests.get(
            "https://api.siigo.com/v1/products",
            params={"code": codigo_eff},
            headers=headers,
            timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red: {e}", "codigo": codigo_eff}

    if res.status_code != 200:
        return {"ok": False, "msg": f"Siigo GET {res.status_code}: {res.text[:200]}", "codigo": codigo_eff}

    products = res.json().get("results", [])
    if not products:
        # Variantes mayúsculas/minúsculas
        for variant in {codigo_eff.upper(), codigo_eff.lower()} - {codigo_eff}:
            try:
                rv = requests.get(
                    "https://api.siigo.com/v1/products",
                    params={"code": variant},
                    headers=headers,
                    timeout=15,
                )
                if rv.status_code == 200 and rv.json().get("results"):
                    products = rv.json()["results"]
                    codigo_eff = variant
                    break
            except requests.RequestException:
                pass
    if not products:
        return {
            "ok": False,
            "msg": f"Producto code='{codigo_eff}' no encontrado en Siigo",
            "codigo": codigo_eff,
        }

    product = copy.deepcopy(products[0])
    product_id = product.get("id")
    if not product_id:
        return {"ok": False, "msg": "Producto sin ID en Siigo", "codigo": codigo_eff}

    # Siigo PUT exige account_group numérico; GET devuelve objeto
    ag = product.get("account_group")
    if isinstance(ag, dict) and ag.get("id"):
        product["account_group"] = ag["id"]
    elif not isinstance(ag, int):
        return {"ok": False, "msg": "Producto sin account_group válido en Siigo", "codigo": codigo_eff}

    prices = product.get("prices") or []
    if not prices:
        return {"ok": False, "msg": "Producto sin estructura de precios en Siigo", "codigo": codigo_eff}
    for price_group in prices:
        for pl in (price_group.get("price_list") or []):
            pl["value"] = round(float(precio_sin_iva), 2)
    product["prices"] = prices

    # Limpiar campos que Siigo rechaza en PUT de Product
    for k in ("metadata", "available_quantity", "id"):
        product.pop(k, None)

    # Completar code en componentes si es Combo
    for comp in product.get("components") or []:
        if comp.get("code"):
            continue
        comp_id = comp.get("id")
        if not comp_id:
            continue
        try:
            rc = requests.get(
                f"https://api.siigo.com/v1/products/{comp_id}",
                headers=headers,
                timeout=12,
            )
            if rc.status_code == 200:
                fetched = (rc.json().get("code") or "").strip()
                if fetched:
                    comp["code"] = fetched
        except requests.RequestException:
            pass

    try:
        res_put = requests.put(
            f"https://api.siigo.com/v1/products/{product_id}",
            json=product,
            headers=headers,
            timeout=20,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red al actualizar: {e}", "codigo": codigo_eff}

    if res_put.status_code in (200, 201):
        return {
            "ok": True,
            "msg": f"Costo actualizado en Siigo (code={codigo_eff})",
            "codigo": codigo_eff,
        }
    return {
        "ok": False,
        "msg": f"Siigo PUT {res_put.status_code}: {res_put.text[:300]}",
        "codigo": codigo_eff,
    }


# Precio web en chat/cotizaciones: misma fórmula que el catálogo (MeLi − 10%).


def _skus_excluidos_chat_web() -> set[str]:
    raw = os.getenv("WEB_CHAT_EXCLUDE_COMBO_SKUS", "").strip()
    if not raw:
        return set()
    return {s.strip().upper() for s in raw.split(",") if s.strip()}


def _normalizar_texto_busqueda_combo(texto: str) -> str:
    import unicodedata

    t = (texto or "").strip().lower()
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


_STOPWORDS_BUSQUEDA_COMBO = frozenset(
    {
        "de",
        "del",
        "la",
        "el",
        "los",
        "las",
        "un",
        "una",
        "unos",
        "unas",
        "y",
        "o",
        "con",
        "sin",
        "para",
        "por",
        "en",
        "al",
        "a",
        "hola",
        "tienes",
        "tiene",
        "tienen",
        "hay",
        "manejan",
        "venden",
        "esencia",
        "productos",
        "producto",
        "necesito",
        "quiero",
        "quisiera",
        "gustaria",
        "podria",
        "podrian",
        "cotizar",
        "cotizacion",
        "cotizarme",
        "precio",
        "precios",
        "cuesta",
        "cuanto",
        "cuanta",
        "cuantos",
        "vale",
        "dame",
        "mercadolibre",
        "meli",
        "enlace",
        "link",
        "favor",
        "cas",
        "lugar",
        "otros",
        "estos",
        "estas",
        "ese",
        "esa",
        "me",
        "te",
        "le",
        "ya",
        "dig",
        "digo",
        "ml",
        "gr",
        "gramos",
        "mililitros",
        "litros",
    }
)


def _tokens_busqueda_combo(consulta_norm: str) -> list[str]:
    """Tokens útiles para puntuar; excluye ruido conversacional."""
    out: list[str] = []
    seen: set[str] = set()
    for w in consulta_norm.split():
        if len(w) < 2 or w in _STOPWORDS_BUSQUEDA_COMBO:
            continue
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def _tokens_distintivos_combo(consulta_norm: str) -> list[str]:
    return [w for w in _tokens_busqueda_combo(consulta_norm) if len(w) >= 4]


def _combo_item_desde_raw(raw: dict) -> dict:
    code = (raw.get("code") or "").strip()
    name = (raw.get("name") or "").strip()
    lista = _precio_lista_siigo_producto(raw)
    if lista > 0:
        from app.services.precios_canales import precios_catalogo_web_desde_siigo

        web = float(precios_catalogo_web_desde_siigo(code, lista, name)["precio_web_num"])
    else:
        web = 0.0
    return {
        "ref": code,
        "name": name,
        "precio_lista": lista,
        "precio_web": web,
        "activo": bool(raw.get("active", True)),
    }


def buscar_combos_siigo_estructurado(consulta: str, max_items: int = 8) -> tuple[list[dict], str]:
    """
    Busca combos SIIGO y devuelve lista estructurada + mensaje de estado.
    """
    consulta = (consulta or "").strip()
    if len(consulta) < 2:
        return [], "Consulta vacía."

    consulta_norm = _normalizar_texto_busqueda_combo(consulta)
    palabras = _tokens_busqueda_combo(consulta_norm)
    if not palabras:
        palabras = [w for w in consulta_norm.split() if len(w) >= 2]
    if not palabras:
        return [], f"No pude interpretar la búsqueda '{consulta}'."

    distintivos = _tokens_distintivos_combo(consulta_norm)

    combos_raw = listar_productos_combo_siigo()
    if not combos_raw:
        return [], "No hay combos SIIGO activos en este momento."

    excl = _skus_excluidos_chat_web()

    # ── Fast-path: referencia exacta ──────────────────────────────────────
    # Si algún token del mensaje (o el mensaje completo) es un código SIIGO
    # —"C-PROCONSUE80PKg", el slug de la página web, o la ref pegada dentro
    # de una frase— devolver ese producto directo, sin depender del scoring.
    tokens_ref = {
        re.sub(r"[^a-z0-9]", "", t) for t in consulta.lower().split()
    }
    tokens_ref.add(re.sub(r"[^a-z0-9]", "", consulta.lower()))
    tokens_ref.discard("")
    for raw in combos_raw:
        code = (raw.get("code") or "").strip()
        if not code:
            continue
        code_alnum = re.sub(r"[^a-z0-9]", "", code.lower())
        if code_alnum and code_alnum in tokens_ref:
            if excl and code.upper() in excl:
                continue
            return [_combo_item_desde_raw(raw)], "ok"

    scored: list[tuple[int, dict, str]] = []
    for raw in combos_raw:
        code = (raw.get("code") or "").strip()
        name = (raw.get("name") or "").strip()
        if not code or not name:
            continue
        blob = _normalizar_texto_busqueda_combo(f"{name} {code}")
        score = 0
        for w in palabras:
            if w in blob:
                score += 3
            elif len(w) >= 4 and w in _normalizar_texto_busqueda_combo(name):
                score += 2
        if consulta_norm in blob or blob in consulta_norm:
            score += 5
        if score > 0:
            scored.append((score, raw, blob))

    if not scored:
        return [], (
            f"No encontré combo SIIGO activo para '{consulta}'. "
            "Solo vendemos presentaciones tipo combo registradas en SIIGO."
        )

    filtro_relajado = False
    if distintivos:
        estrictos = [
            (s, r, b) for s, r, b in scored if all(d in b for d in distintivos)
        ]
        if estrictos:
            scored = estrictos
        elif len(distintivos) >= 2:
            # Frases largas ("...flores secas de lavanda... envío a Bucaramanga")
            # o varios productos en un mensaje ("glicerina vegetal y arcilla
            # caolín"): exigir TODOS los distintivos mataba matches válidos.
            # Aceptar productos que cubran ≥2 distintivos, o 1 solo si ese token
            # es casi único en el catálogo (nombre distintivo tipo "lavanda");
            # tokens genéricos ("acido", "aceite") solos NO bastan — así
            # "ácido tánico" sigue sin ofrecer otros ácidos.
            df = {
                d: sum(1 for _, _, b in scored if d in b) for d in distintivos
            }
            secuencia = consulta_norm.split()

            def _pegado_a_variante_inexistente(token: str) -> bool:
                # "ácido tánico": el cliente nombró una variante concreta que no
                # existe en el catálogo (df=0 del vecino). Con un solo token
                # coincidente NO ofrecer los demás ácidos/aceites de la familia.
                for i, t in enumerate(secuencia):
                    if t != token:
                        continue
                    for j in (i - 1, i + 1):
                        if 0 <= j < len(secuencia):
                            vecino = secuencia[j]
                            if vecino in df and df[vecino] == 0:
                                return True
                return False

            candidatos: list[tuple[int, int, dict, str]] = []
            for s, r, b in scored:
                matched = [d for d in distintivos if d in b]
                if len(matched) >= 2 or (
                    len(matched) == 1
                    and df[matched[0]] <= 3
                    and not _pegado_a_variante_inexistente(matched[0])
                ):
                    candidatos.append((len(matched), s, r, b))
            if not candidatos:
                return [], (
                    f"No encontré combo SIIGO activo para '{consulta}'. "
                    "Solo vendemos presentaciones tipo combo registradas en SIIGO."
                )
            candidatos.sort(
                key=lambda x: (-x[0], -x[1], x[2].get("name", ""))
            )
            scored = [(s, r, b) for _, s, r, b in candidatos]
            filtro_relajado = True
        else:
            return [], (
                f"No encontré combo SIIGO activo para '{consulta}'. "
                "Solo vendemos presentaciones tipo combo registradas en SIIGO."
            )

    if not filtro_relajado:
        scored.sort(key=lambda x: (-x[0], x[1].get("name", "")))
        if distintivos and scored[0][0] < len(distintivos) * 3:
            return [], (
                f"No encontré combo SIIGO activo para '{consulta}'. "
                "Solo vendemos presentaciones tipo combo registradas en SIIGO."
            )
    items = []
    for _, raw, _ in scored:
        code = (raw.get("code") or "").strip().upper()
        if excl and code in excl:
            continue
        items.append(_combo_item_desde_raw(raw))
        if len(items) >= max_items:
            break
    if not items and scored and excl:
        return [], (
            f"No hay combo SIIGO publicado para '{consulta}' "
            "(tras filtro de SKUs permitidos en chat web)."
        )
    return items, "ok"


def _stock_tienda_web() -> dict:
    """
    Stock actual de la tienda web por referencia (PAGINA_WEB/site/data/stock_web.json).
    {REF_MAYUSCULA: int}. Vacío si el archivo no existe o falla la lectura.
    """
    try:
        ruta = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "PAGINA_WEB", "site", "data", "stock_web.json",
        )
        with open(ruta, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            str(ref).strip().upper(): int(info.get("stock", 0) or 0)
            for ref, info in data.items()
            if isinstance(info, dict)
        }
    except Exception:
        return {}


def buscar_productos_combo_siigo(consulta: str) -> str:
    """
    Busca presentaciones activas tipo Combo en SIIGO (catálogo comprable en la web).
    Usar en chat web cuando el cliente pregunte precio, disponibilidad o presentaciones.
    No inventar SKUs ni gramajes que no aparezcan aquí.
    """
    items, estado = buscar_combos_siigo_estructurado(consulta)
    if not items:
        return estado

    stock_web = _stock_tienda_web()
    hubo_agotado = False
    lines = [
        f"Combos SIIGO activos relacionados con '{consulta}' "
        "(únicas presentaciones que puede ofrecer en chat web):",
    ]
    for it in items:
        if it["precio_web"] > 0:
            precio_txt = (
                f"${it['precio_web']:,.0f} COP "
                f"(lista SIIGO ${it['precio_lista']:,.0f})"
            )
        else:
            precio_txt = "precio: consultar"
        disp = "activo" if it["activo"] else "inactivo"
        stock = stock_web.get(str(it["ref"]).strip().upper())
        if stock is None:
            web_txt = ""
        elif stock <= 0:
            web_txt = " | AGOTADO en tienda web"
            hubo_agotado = True
        else:
            web_txt = " | disponible en tienda web"
        lines.append(
            f"- {it['name']} | Ref/SKU: {it['ref']} | {precio_txt} | {disp}{web_txt}"
        )

    lines.append(
        "IMPORTANTE: cite solo estas líneas al cliente. "
        "No ofrezca presentaciones del catálogo histórico Sheets."
    )
    if hubo_agotado:
        lines.append(
            "Las presentaciones marcadas AGOTADO en tienda web no están comprables ahora: "
            "no diga que sí hay ni que la página tiene un error; ofrezca alternativas con stock."
        )
    return "\n".join(lines)
