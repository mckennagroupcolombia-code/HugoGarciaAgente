import os
import json
import time
import threading
import requests
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import base64
import re
import zipfile
import io
import xml.etree.ElementTree as ET

from app.services.siigo import crear_factura_compra_siigo

SIIGO_CREDS_PATH = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
GOOGLE_CREDS_PATH = os.path.join("/home/mckg/mi-agente", "credenciales_google.json")
TOKEN_GMAIL_PATH = os.path.join(os.path.dirname(__file__), "token_gmail.json")

# Carpeta local para guardar facturas descargadas
CARPETA_FACTURAS_LOCAL = os.path.join("/home/mckg/mi-agente", "facturas_descargadas")
os.makedirs(CARPETA_FACTURAS_LOCAL, exist_ok=True)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.labels"]

def get_gmail_service():
    creds = None
    if os.path.exists(TOKEN_GMAIL_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_GMAIL_PATH, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(GOOGLE_CREDS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_GMAIL_PATH, "w") as token:
            token.write(creds.to_json())
    return build("gmail", "v1", credentials=creds)

def extraer_datos_xml_dian(xml_content):
    """Extrae datos de una factura electrónica (XML DIAN UBL 2.1)."""
    try:
        # En lugar de usar regex (que rompían la estructura), 
        # vamos a usar un parser de etree normal, y para ignorar los
        # namespaces, buscaremos los elementos ignorando su parte de URI.
        # Primero probamos parsear directamente (puede fallar si el XML no está bien formado 
        # pero es lo estándar).
        
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError:
            # Intento de recuperación básico para caracteres inválidos o 
            # saltos de línea problemáticos en archivos raw
            xml_content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', xml_content)
            root = ET.fromstring(xml_content)

        # Función para buscar ignorando cualquier namespace {http://...}Tag
        def find_element(node, tag_name):
            for elem in node.iter():
                # El tag de etree con namespace es de la forma: {URI}Tag
                if elem.tag.split('}')[-1] == tag_name:
                    return elem
            return None
            
        def find_elements(node, tag_name):
            results = []
            for elem in node.iter():
                if elem.tag.split('}')[-1] == tag_name:
                    results.append(elem)
            return results

        # 1. Encontrar el nodo Invoice real
        invoice_node = find_element(root, "Invoice")
        
        if invoice_node is None:
            # Podría estar embebido como texto en la etiqueta Description
            desc_nodes = find_elements(root, "Description")
            for d in desc_nodes:
                if d.text and ("<Invoice" in d.text or "<inv:Invoice" in d.text):
                    embedded_xml = d.text.strip()
                    # Como el texto embebido puede faltarle la declaración de algún namespace
                    # intentaremos parsearlo. Si lanza unbound prefix, es porque tiene `prefijo:Tag`
                    # sin declarar el `xmlns:prefijo`.
                    try:
                        invoice_node = ET.fromstring(embedded_xml)
                    except ET.ParseError as pe:
                        if "unbound prefix" in str(pe).lower():
                            # Limpieza SEGURA de prefijos para evitar "unbound prefix" sin romper tags
                            # Solo quita la parte "prefijo:" del inicio del tag
                            safe_clean = re.sub(r'(</?)[a-zA-Z0-9]+:', r'\1', embedded_xml)
                            # También de los atributos que puedan tener "prefijo:attr="
                            safe_clean = re.sub(r' [a-zA-Z0-9]+:([a-zA-Z0-9]+)=', r' \1=', safe_clean)
                            try:
                                invoice_node = ET.fromstring(safe_clean)
                            except:
                                pass
                    break
            
            # Si aún así no lo encontramos, usamos el root
            if invoice_node is None:
                invoice_node = root
            
        # 2. Número de Factura (En AttachedDocument suele ser ParentDocumentID si existe, si no, ID de Invoice)
        parent_id_elem = find_element(root, "ParentDocumentID")
        if parent_id_elem is not None and parent_id_elem.text:
            full_invoice_id = parent_id_elem.text
        else:
            invoice_id_elem = find_element(invoice_node, "ID")
            full_invoice_id = invoice_id_elem.text if invoice_id_elem is not None else ""

        prefix = ""
        number = full_invoice_id
        
        prefix_match = re.search(r"([A-Za-z]+)(\d+)", full_invoice_id)
        if prefix_match:
            prefix = prefix_match.group(1)
            number = prefix_match.group(2)
        elif not number:
            number = "0000"

        # 3. Datos del Proveedor (AccountingSupplierParty o SenderParty)
        nit = "999999999"
        proveedor_nombre = "Proveedor Desconocido"
        
        supplier_party = find_element(invoice_node, "AccountingSupplierParty")
        if supplier_party is None:
            supplier_party = find_element(root, "SenderParty")
            
        if supplier_party is not None:
            company_id_elem = find_element(supplier_party, "CompanyID")
            if company_id_elem is not None:
                nit = company_id_elem.text
                
            name_elem = find_element(supplier_party, "RegistrationName")
            if name_elem is None:
                name_elem = find_element(supplier_party, "Name")
            if name_elem is not None:
                proveedor_nombre = name_elem.text

        # 4. Datos del Comprador (AccountingCustomerParty o ReceiverParty en AttachedDocument)
        comprador_nit    = ""
        comprador_nombre = ""
        for buyer_tag in ("AccountingCustomerParty", "ReceiverParty", "BuyerCustomerParty"):
            buyer_party = find_element(invoice_node, buyer_tag)
            if buyer_party is None:
                buyer_party = find_element(root, buyer_tag)
            if buyer_party is not None:
                cid = find_element(buyer_party, "CompanyID")
                if cid is not None and cid.text:
                    comprador_nit = re.sub(r"[^0-9]", "", cid.text)
                cname = find_element(buyer_party, "RegistrationName")
                if cname is None:
                    cname = find_element(buyer_party, "Name")
                if cname is not None and cname.text:
                    comprador_nombre = cname.text.strip()
                break

        # 5. Fecha de emisión
        fecha = datetime.now().strftime("%Y-%m-%d")
        date_element = find_element(invoice_node, "IssueDate")
        if date_element is not None:
            fecha = date_element.text

        # 5. Totales e Impuestos Generales (LegalMonetaryTotal y TaxTotal)
        total_bruto = 0.0 # LineExtensionAmount
        total_neto = 0.0  # PayableAmount
        total_descuentos = 0.0 # AllowanceTotalAmount
        
        monetary_total = find_element(invoice_node, "LegalMonetaryTotal")
        if monetary_total is not None:
            bruto_elem = find_element(monetary_total, "LineExtensionAmount")
            if bruto_elem is not None: total_bruto = float(bruto_elem.text)
                
            neto_elem = find_element(monetary_total, "PayableAmount")
            if neto_elem is not None: total_neto = float(neto_elem.text)
                
            desc_elem = find_element(monetary_total, "AllowanceTotalAmount")
            if desc_elem is not None: total_descuentos = float(desc_elem.text)

        # 6. Items detallados con impuestos
        items = []
        for line in find_elements(invoice_node, "InvoiceLine"):
            desc = "Articulo"
            item_node = find_element(line, "Item")
            if item_node is not None:
                desc_elem = find_element(item_node, "Description")
                if desc_elem is not None:
                    desc = desc_elem.text
                    
            qty = 1.0
            qty_elem = find_element(line, "InvoicedQuantity")
            if qty_elem is not None:
                qty = float(qty_elem.text)
                
            price = 0.0
            price_node = find_element(line, "Price")
            if price_node is not None:
                price_amount_elem = find_element(price_node, "PriceAmount")
                if price_amount_elem is not None:
                    price = float(price_amount_elem.text)
                    
            # Valor total de la línea antes de impuestos
            line_ext_elem = find_element(line, "LineExtensionAmount")
            subtotal_linea = float(line_ext_elem.text) if line_ext_elem is not None else (qty * price)

            # Impuestos por línea (IVA, ReteICA, etc)
            impuestos_linea = []
            for tax_total in find_elements(line, "TaxTotal"):
                tax_amount_elem = find_element(tax_total, "TaxAmount")
                tax_amount = float(tax_amount_elem.text) if tax_amount_elem is not None else 0.0
                
                # Para saber de qué impuesto se trata, vemos el TaxScheme/ID
                tax_id = "01" # Por defecto IVA
                percent = 0.0
                
                tax_subtotal = find_element(tax_total, "TaxSubtotal")
                if tax_subtotal is not None:
                    percent_elem = find_element(tax_subtotal, "Percent")
                    if percent_elem is not None: percent = float(percent_elem.text)
                        
                    tax_scheme = find_element(tax_subtotal, "TaxScheme")
                    if tax_scheme is not None:
                        id_elem = find_element(tax_scheme, "ID")
                        if id_elem is not None: tax_id = id_elem.text
                
                # Mapeo básico DIAN: 01=IVA, 03=ICA, 04=INC, 05=ReteIVA, 06=ReteRenta, 07=ReteICA
                nombre_impuesto = "Impuesto"
                if tax_id == "01": nombre_impuesto = f"IVA {percent}%"
                elif tax_id == "03": nombre_impuesto = f"ICA {percent}%"
                elif tax_id == "05": nombre_impuesto = f"ReteIVA {percent}%"
                elif tax_id == "06": nombre_impuesto = f"ReteFte {percent}%"
                elif tax_id == "07": nombre_impuesto = f"ReteICA {percent}%"
                
                impuestos_linea.append({
                    "nombre": nombre_impuesto,
                    "valor": tax_amount,
                    "porcentaje": percent,
                    "id_dian": tax_id
                })
                    
            items.append({
                "description": desc,
                "quantity": qty,
                "price": price, # Valor unitario
                "subtotal": subtotal_linea,
                "impuestos": impuestos_linea
            })

        if not items and total_neto > 0:
            items.append({
                "description": f"Compra general Factura {full_invoice_id}",
                "quantity": 1,
                "price": total_bruto if total_bruto > 0 else total_neto,
                "subtotal": total_bruto if total_bruto > 0 else total_neto,
                "impuestos": []
            })

        return {
            "prefix": prefix,
            "number": number,
            "nit": nit,
            "proveedor": proveedor_nombre,
            "comprador_nit":    comprador_nit,
            "comprador_nombre": comprador_nombre,
            "fecha": fecha,
            "total_bruto": total_bruto,
            "total_descuentos": total_descuentos,
            "total_neto": total_neto,
            "items": items
        }

    except Exception as e:
        print(f"❌ Error extrayendo datos detallados del XML: {e}")
        return None

def leer_correos_no_descargados(fecha_desde: str = "2026/01/01"):
    """
    Devuelve todos los correos de la etiqueta FACTURAS-MCKG que tengan adjunto ZIP,
    desde `fecha_desde` (formato YYYY/MM/DD) hasta hoy.
    Maneja paginación para no perder correos cuando hay más de 100.
    """
    service = get_gmail_service()
    query = f"label:FACTURAS-MCKG has:attachment filename:zip after:{fecha_desde}"

    try:
        messages = []
        page_token = None
        while True:
            kwargs = {"userId": "me", "q": query, "maxResults": 100}
            if page_token:
                kwargs["pageToken"] = page_token
            response = service.users().messages().list(**kwargs).execute()
            batch = response.get("messages", [])
            messages.extend(batch)
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        if not messages:
            print("No hay correos con facturas .zip en el período indicado")
            return []

        print(f"  📧 {len(messages)} correo(s) encontrado(s) desde {fecha_desde}")
        correos_con_facturas = []

        for msg in messages:
            msg_data = service.users().messages().get(userId="me", id=msg["id"], format="full").execute()
            headers = msg_data["payload"]["headers"]
            asunto = next((h["value"] for h in headers if h["name"] == "Subject"), "Sin Asunto")

            # Buscar ZIPs en partes directas y en partes anidadas (multipart)
            adjuntos = []
            def _buscar_zips(partes):
                for part in partes:
                    if part.get("filename", "").lower().endswith(".zip"):
                        att_id = part["body"].get("attachmentId")
                        if att_id:
                            adjuntos.append({"filename": part["filename"], "id": att_id, "msg_id": msg["id"]})
                    if "parts" in part:
                        _buscar_zips(part["parts"])

            payload = msg_data["payload"]
            if "parts" in payload:
                _buscar_zips(payload["parts"])

            if adjuntos:
                correos_con_facturas.append({
                    "id": msg["id"],
                    "asunto": asunto,
                    "adjuntos_zip": adjuntos,
                })

        return correos_con_facturas
    except Exception as e:
        print(f"Error consultando Gmail: {e}")
        return []

def descargar_y_extraer_zip(gmail_service, msg_id, att_id, zip_filename):
    try:
        att = gmail_service.users().messages().attachments().get(userId="me", messageId=msg_id, id=att_id).execute()
        file_data = base64.urlsafe_b64decode(att["data"].encode("UTF-8"))
        
        # Guardar el zip localmente
        zip_path = os.path.join(CARPETA_FACTURAS_LOCAL, zip_filename)
        with open(zip_path, "wb") as f:
            f.write(file_data)
        
        print(f"📦 ZIP guardado en: {zip_path}")
        
        xml_content = None
        pdf_content = None
        pdf_filename = None
        
        with zipfile.ZipFile(io.BytesIO(file_data), "r") as zf:
            for name in zf.namelist():
                # Extraer archivos en la carpeta
                extraido_path = zf.extract(name, CARPETA_FACTURAS_LOCAL)
                
                if name.lower().endswith(".xml"):
                    with open(extraido_path, "r", encoding="utf-8", errors="ignore") as fxml:
                        xml_content = fxml.read()
                elif name.lower().endswith(".pdf"):
                    with open(extraido_path, "rb") as fpdf:
                        pdf_content = fpdf.read()
                        pdf_filename = name
                        
        return xml_content, pdf_content, pdf_filename
    except Exception as e:
        print(f"Error procesando ZIP {zip_filename}: {e}")
        return None, None, None

from app.utils import enviar_whatsapp_reporte

GRUPO_COMPRAS = os.getenv("GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us")

# Proveedores de transporte/mensajería: siempre se registran como un único ítem
# de gasto con cuenta contable 11051001, valor = total neto de la factura.
PROVEEDORES_TRANSPORTE = {
    "800251569": {  # INTERRAPIDISIMO S.A.
        "nombre": "INTERRAPIDISIMO S.A.",
        "cuenta_contable": "11051001",
        "centro_costo": "1-1",
        "descripcion": "Servicio de mensajería/transporte",
    },
}

def _es_proveedor_transporte(nit: str) -> dict | None:
    """Devuelve la config del proveedor si es de transporte, None si no."""
    # Omite guión y dígito de verificación: "800251569-7" → "800251569"
    nit_limpio = re.sub(r"[^0-9]", "", (nit or "").split("-")[0])
    return PROVEEDORES_TRANSPORTE.get(nit_limpio)

def enviar_mensaje_whatsapp_grupo(mensaje):
    """
    Envía mensaje al grupo de WhatsApp de facturas de compra.
    """
    print("="*50)
    print("📱 [WHATSAPP - GRUPO COMPRAS] ENVIANDO MENSAJE:")
    print(mensaje)
    print("="*50)
    enviar_whatsapp_reporte(mensaje, numero_destino=GRUPO_COMPRAS)

def sincronizar_facturas_de_compra_siigo(solo_nit: str = None, modo_terminal: bool = False):
    """
    1. Busca facturas en correos (FACTURAS MCKG).
    2. Descarga a carpeta local y extrae ZIP.
    3. Lee XML.
    4. Muestra borrador y pide aprobación (terminal o WhatsApp según modo_terminal).
    5. Sube a Siigo con PDF adjunto.

    solo_nit: si se especifica, solo procesa facturas de ese NIT (sin dígito verificación).
              Ej: "800251569" para Interrapidísimo.
    modo_terminal: si True, toda la interacción es por consola (sin WhatsApp).
    """
    filtro = re.sub(r"[^0-9]", "", solo_nit) if solo_nit else None
    label = f"solo NIT {filtro}" if filtro else "todos los proveedores"
    print(f"\n🚀 Iniciando sincronización de Facturas de Compra ({label})...")

    correos = leer_correos_no_descargados()
    if not correos:
        print("✅ No se encontraron facturas pendientes de descargar.")
        return "No hay facturas nuevas para sincronizar."

    service = get_gmail_service()
    facturas_procesadas = 0

    for correo in correos:
        print(f"\n📩 Analizando correo: '{correo['asunto']}'")
        for adjunto in correo["adjuntos_zip"]:
            print(f"📥 Descargando {adjunto['filename']}...")
            xml_content, pdf_content, pdf_filename = descargar_y_extraer_zip(
                service, correo["id"], adjunto["id"], adjunto["filename"]
            )

            if not xml_content:
                print("⚠️ No se encontró archivo XML válido dentro del ZIP.")
                continue

            datos_factura = extraer_datos_xml_dian(xml_content)
            if not datos_factura:
                continue

            # Filtrar por NIT si se especificó uno (ignora guión y dígito verificador)
            if filtro:
                nit_factura = re.sub(r"[^0-9]", "", datos_factura.get("nit", "").split("-")[0])
                if not nit_factura.startswith(filtro):
                    print(f"⏭️ Factura de NIT {nit_factura} omitida (filtro: {filtro}).")
                    continue

            # Generar borrador detallado
            items_str = ""
            for i, it in enumerate(datos_factura['items'], 1):
                items_str += f"   {i}. {it['description'][:40]}...\n"
                items_str += f"      Cant: {it['quantity']} | V.Unit: ${it['price']:,.2f} | Subtotal: ${it['subtotal']:,.2f}\n"
                if it['impuestos']:
                    for imp in it['impuestos']:
                        items_str += f"      + {imp['nombre']}: ${imp['valor']:,.2f}\n"

            borrador = (
                f"\n{'='*55}\n"
                f"🧾  BORRADOR FACTURA DE COMPRA\n"
                f"{'='*55}\n"
                f"Proveedor : {datos_factura['proveedor']} (NIT: {datos_factura['nit']})\n"
                f"Fecha     : {datos_factura['fecha']}\n"
                f"Factura   : {datos_factura['prefix']}{datos_factura['number']}\n"
                f"{'─'*55}\n"
                f"Subtotal bruto : ${datos_factura['total_bruto']:>12,.2f}\n"
                f"Descuentos     : ${datos_factura['total_descuentos']:>12,.2f}\n"
                f"TOTAL NETO     : ${datos_factura['total_neto']:>12,.2f}\n"
                f"{'─'*55}\n"
                f"ÍTEMS:\n{items_str}"
                f"{'='*55}"
            )
            print(borrador)

            factura_key = f"{datos_factura['prefix']}{datos_factura['number']}"

            if modo_terminal:
                resp = input(f"\n¿Registrar esta factura en SIIGO? [OK/no]: ").strip().upper()
                aprobacion_final = (resp == "OK")
            else:
                # Modo WhatsApp: envía borrador al grupo y espera evento
                from app import shared_state
                evento = threading.Event()
                shared_state.eventos_aprobacion_facturas[factura_key] = {
                    "event": evento,
                    "aprobado": False,
                }
                enviar_mensaje_whatsapp_grupo(
                    borrador.replace("=", "*").replace("─", "-") +
                    "\n\n❓ ¿Aprueban? Responde *OK* para confirmar."
                )
                print(f"⏳ Esperando OK en WhatsApp para {factura_key} (máx. 10 min)...")

                def _escuchar_consola():
                    try:
                        if input("").strip().upper() == "OK":
                            shared_state.eventos_aprobacion_facturas[factura_key]["aprobado"] = True
                            evento.set()
                    except Exception:
                        pass
                threading.Thread(target=_escuchar_consola, daemon=True).start()
                evento.wait(timeout=600)
                entrada = shared_state.eventos_aprobacion_facturas.pop(factura_key, {})
                aprobacion_final = entrada.get("aprobado", False)

            if aprobacion_final:
                print("⏳ Creando factura en SIIGO...")

                config_transporte = _es_proveedor_transporte(datos_factura["nit"])

                if config_transporte:
                    items_siigo = [{
                        "type": "Product",
                        "code": config_transporte["cuenta_contable"],
                        "description": f"{config_transporte['descripcion']} - {datos_factura['prefix']}{datos_factura['number']}",
                        "quantity": 1,
                        "price": datos_factura["total_neto"],
                        "taxes": []
                    }]
                else:
                    items_siigo = [
                        {
                            "type": "Product",
                            "code": "GENERICO",
                            "description": it["description"][:100],
                            "quantity": it["quantity"],
                            "price": it["price"],
                            "taxes": []
                        } for it in datos_factura["items"]
                    ]

                payload_siigo = {
                    "document": {"id": 5809},
                    "date": datos_factura["fecha"],
                    "supplier": {"identification": datos_factura["nit"], "branch_office": 0},
                    "provider_invoice": {"prefix": datos_factura["prefix"], "number": datos_factura["number"]},
                    "cost_center": 263,   # VENTAS — ID numérico requerido por SIIGO API
                    "items": items_siigo,
                    "payments": [{"id": 1338, "value": datos_factura["total_neto"]}],
                    "observations": f"Sincronizado automáticamente desde correo: {correo['asunto']}"
                }

                if pdf_content and pdf_filename:
                    payload_siigo["attachments"] = [{
                        "file_name": pdf_filename,
                        "content": base64.b64encode(pdf_content).decode('utf-8')
                    }]

                resultado = crear_factura_compra_siigo(payload_siigo)

                if resultado.get("status") == "success":
                    siigo_id = resultado.get("data", {}).get("id", "N/A")
                    tipo_registro = "Gasto / Cuenta contable" if config_transporte else "Producto"
                    cuenta_info = config_transporte['cuenta_contable'] if config_transporte else "GENERICO"
                    print(f"\n✅ FACTURA REGISTRADA EN SIIGO")
                    print(f"   ID Siigo  : {siigo_id}")
                    print(f"   Factura   : {datos_factura['prefix']}{datos_factura['number']}")
                    print(f"   Total     : ${datos_factura['total_neto']:,.2f} COP")
                    print(f"   Cuenta    : {cuenta_info}")
                    print(f"   PDF adj.  : {'Sí' if pdf_content else 'No'}")
                    facturas_procesadas += 1

                    if not modo_terminal:
                        enviar_mensaje_whatsapp_grupo(
                            f"✅ *FACTURA REGISTRADA EN SIIGO*\n"
                            f"Factura: {datos_factura['prefix']}{datos_factura['number']}\n"
                            f"Total: ${datos_factura['total_neto']:,.2f} COP\n"
                            f"ID Siigo: {siigo_id}"
                        )

                    if modo_terminal:
                        input("\nVerifica en SIIGO y presiona Enter para continuar con la siguiente...")
                    else:
                        from app import shared_state
                        clave_ver = f"VER_{factura_key}"
                        evento_ver = threading.Event()
                        shared_state.eventos_aprobacion_facturas[clave_ver] = {"event": evento_ver, "aprobado": False}
                        print("⏳ Esperando OK de verificación en WhatsApp...")
                        def _escuchar_ver():
                            try:
                                if input("").strip().upper() == "OK":
                                    shared_state.eventos_aprobacion_facturas[clave_ver]["aprobado"] = True
                                    evento_ver.set()
                            except Exception:
                                pass
                        threading.Thread(target=_escuchar_ver, daemon=True).start()
                        evento_ver.wait(timeout=600)
                        shared_state.eventos_aprobacion_facturas.pop(clave_ver, None)
                    print("▶️ Continuando con la siguiente factura...")

                else:
                    error_msg = resultado.get('message', str(resultado))
                    print(f"\n❌ Error al crear factura en SIIGO: {error_msg}")
                    if not modo_terminal:
                        enviar_mensaje_whatsapp_grupo(
                            f"❌ *ERROR al registrar factura en SIIGO*\n"
                            f"Factura: {factura_key}\n"
                            f"Error: {error_msg[:300]}"
                        )
                    return f"Error en factura {factura_key}. Proceso detenido."
            else:
                print(f"⏭️ Factura {factura_key} omitida.")

    return f"Proceso finalizado. Se procesaron {facturas_procesadas} facturas."

if __name__ == "__main__":
    sincronizar_facturas_de_compra_siigo()
