import os
import json
import time
import requests
from datetime import datetime

# Variable de configuración para la API de Siigo
PARTNER_ID = "SiigoAPI"

def autenticar_siigo(forzar=False):
    """
    Autentica con la API de Siigo para obtener un token de acceso.
    Maneja el cacheo del token para no re-autenticar en cada llamada.
    """
    try:
        # TODO: Centralizar la gestión de credenciales en lugar de un path hard-coded.
        ruta_json = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
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
            else:
                print(f"⚠️ Error obteniendo facturas de Siigo (Página {page}): {res.status_code}")
                break
        except requests.RequestException as e:
            print(f"⚠️ Error de red obteniendo facturas de Siigo: {e}")
            break
    return todas_las_facturas

def descargar_factura_pdf_siigo(id_factura):
    """
    Descarga el PDF de una factura específica de Siigo en formato base64.
    """
    token = autenticar_siigo()
    if not token:
        return "❌ Error: No se pudo autenticar con Siigo."

    try:
        res = requests.get(
            f"https://api.siigo.com/v1/invoices/{id_factura}/pdf",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=15
        )
        if res.status_code == 200:
            return res.json().get("base64", "")
        else:
            print(f"⚠️ Error descargando PDF de Siigo (ID: {id_factura}): {res.status_code}")
            return "❌ Error"
    except requests.RequestException as e:
        print(f"⚠️ Error de red descargando PDF de Siigo: {e}")
        return f"⚠️ Error: {e}"

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
            print(f"✅ Factura de compra creada en SIIGO: {response.json().get("id")}")
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
