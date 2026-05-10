import os
import json
import time
import copy
import requests
import base64
import re
import xml.etree.ElementTree as ET
from io import BytesIO
from datetime import datetime

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

def obtener_facturas_siigo_paginadas(fecha_inicio):
    """
    Obtiene todas las facturas de Siigo a partir de una fecha de inicio,
    manejando la paginación de la API.
    """
    token = autenticar_siigo()
    if not token:
        return []

    todas_las_facturas = []
    page = 1
    puede_reintentar_auth = True
    reintentos_429 = 0
    while True:
        try:
            res = requests.get(
                f"https://api.siigo.com/v1/invoices?created_start={fecha_inicio}&page={page}",
                headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"},
                timeout=15
            )
            if res.status_code == 200:
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
            print(f"⚠️ Error de red obteniendo facturas de Siigo: {e}")
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


def _precio_lista_siigo_producto(p: dict) -> float:
    try:
        return float(p["prices"][0]["price_list"][0]["value"])
    except (KeyError, IndexError, TypeError, ValueError):
        return 0.0


def listar_productos_combo_siigo() -> list:
    """
    Devuelve los items crudos de la API SIIGO con type Combo (activos).
    Si el filtro type=Combo no devuelve datos, pagina todos los productos y filtra.
    """
    token = autenticar_siigo()
    if not token:
        return []

    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
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

    for page in range(1, 500):
        try:
            res = requests.get(
                "https://api.siigo.com/v1/products",
                params={"page": page, "page_size": 100, "type": "Combo", "active": "true"},
                headers=headers,
                timeout=25,
            )
        except requests.RequestException:
            break
        if res.status_code != 200:
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

    if out:
        return out

    for page in range(1, 2000):
        try:
            res = requests.get(
                "https://api.siigo.com/v1/products",
                params={"page": page, "page_size": 100},
                headers=headers,
                timeout=25,
            )
        except requests.RequestException:
            break
        if res.status_code != 200:
            break
        data = res.json()
        results = data.get("results") or []
        if not results:
            break
        consume_results(results, strict_combo=True)
        if len(results) < 100:
            break

    return out
