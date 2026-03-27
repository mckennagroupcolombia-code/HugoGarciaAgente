
import re
import os
import gspread
import requests
from datetime import datetime, timedelta

# --- Importaciones de Servicios y Utilidades Modulares ---
from app.services.siigo import (
    obtener_facturas_siigo_paginadas,
    descargar_factura_pdf_siigo
)
from app.services.meli import subir_factura_meli
from app.utils import refrescar_token_meli, enviar_whatsapp_reporte
from app.tools.system_tools import enviar_reporte_controlado

# ========================================================
#  CONFIGURACIÓN TEMPORAL
# ========================================================
# TODO: Mover estas constantes a un archivo de configuración central (p.ej. .env)
GOOGLE_CREDS_PATH = os.path.join("/home/mckg/mi-agente", "client_secret_cloud.json")
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", '1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg')

# ========================================================
#  LÓGICAS DE SINCRONIZACIÓN ENTRE PLATAFORMAS
# ========================================================

def sincronizar_facturas_recientes(dias: int = 1):
    """Busca facturas en Siigo de los últimos 'dias' y las sube a Mercado Libre."""
    print(f"\n🚀 [SYNC RECIENTE] Iniciando revisión de facturas de Siigo para los últimos {dias} día(s)...")
    fecha_inicio = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_inicio)
        if not facturas_siigo: return f"✅ No se encontraron facturas en Siigo desde {fecha_inicio}."
        print(f"📊 Se encontraron {len(facturas_siigo)} facturas. Analizando...")
        exitos = 0
        for f in facturas_siigo:
            texto = f"{f.get('observations', '')} {f.get('purchase_order', '')}"
            match = re.search(r'\d{12,20}', texto)
            if match:
                p_id = match.group()
                pdf = descargar_factura_pdf_siigo(f.get('id'))
                if "❌" not in pdf and pdf and "✅" in subir_factura_meli(p_id, pdf):
                    exitos += 1
                    print(f"   └──> ✅ Sincronizado Pack ID: {p_id}")
        return f"✅ Revisión terminada. Se subieron {exitos} facturas."
    except Exception as e: return f"❌ Error crítico en sync reciente: {e}"

def sincronizar_por_dia_especifico(fecha_consulta: str):
    """Busca y sincroniza facturas para un día específico."""
    print(f"\n📅 [SYNC POR DÍA] Buscando facturas para la fecha: {fecha_consulta}...")
    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_consulta)
        facturas_del_dia = [f for f in facturas_siigo if f.get('date', '').startswith(fecha_consulta)]
        if not facturas_del_dia: return f"✅ No se encontraron facturas creadas en la fecha {fecha_consulta}."
        print(f"📊 Se encontraron {len(facturas_del_dia)} facturas. Analizando...")
        exitos = 0
        for f in facturas_del_dia:
            texto = f"{f.get('observations', '')} {f.get('purchase_order', '')}"
            match = re.search(r'\d{12,20}', texto)
            if match:
                p_id = match.group()
                pdf = descargar_factura_pdf_siigo(f.get('id'))
                if "❌" not in pdf and pdf and "✅" in subir_factura_meli(p_id, pdf):
                    exitos += 1
                    print(f"   └──> ✅ Sincronizado Pack ID: {p_id}")
        return f"✅ Fin del proceso para {fecha_consulta}. Facturas subidas: {exitos}"
    except Exception as e: return f"❌ Error crítico en sync por día: {e}"

def sincronizar_manual_por_id(pack_id: str):
    """Busca una factura en Siigo por Pack ID y la sube a Mercado Libre."""
    print(f"\n🔎 [SYNC MANUAL] Buscando factura para el Pack ID: {pack_id}...")
    fecha_inicio = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d") 
    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_inicio)
        for fac in facturas_siigo:
            obs = str(fac.get('observations', "")) + " " + str(fac.get('purchase_order', ""))
            if str(pack_id).strip() in obs:
                print(f"✨ ¡Coincidencia encontrada! Factura Siigo ID: {fac.get('id')}. Procediendo a subir...")
                pdf = descargar_factura_pdf_siigo(fac.get('id'))
                if "❌" not in pdf and pdf: return f"🚀 Resultado de la subida: {subir_factura_meli(pack_id, pdf)}"
                else: return f"❌ Se encontró la factura pero no se pudo descargar el PDF de Siigo."
        return "❌ No se encontró una factura en los últimos 90 días con ese Pack ID."
    except Exception as e: return f"❌ Error crítico en sync manual: {e}"

def sincronizar_inteligente():
    """Busca órdenes en MeLi sin factura y las cruza con facturas de Siigo."""
    print("\n🧠 [SYNC INTELIGENTE] Iniciando cruce de datos entre Mercado Libre y Siigo...")
    try:
        token_meli = refrescar_token_meli()
        res_me = requests.get("https://api.mercadolibre.com/users/me", headers={"Authorization": f"Bearer {token_meli}"})
        seller_id = res_me.json().get('id')
        fecha_hace_15 = (datetime.now() - timedelta(days=15)).strftime("%Y-%m-%dT%H:%M:%S.000-00:00")
        url_meli = f"https://api.mercadolibre.com/orders/search?seller={seller_id}&order.date_created.from={fecha_hace_15}"
        pendientes = []
        for ord in requests.get(url_meli, headers={"Authorization": f"Bearer {token_meli}"}).json().get('results', []):
            if not ord.get('fiscal_documents'):
                p_id = str(ord.get('pack_id') or ord.get('id'))
                if p_id not in pendientes: pendientes.append(p_id)
        if not pendientes: return "✅ ¡Excelente! Mercado Libre está al día. No hay facturas pendientes."
        print(f"⏳ Encontradas {len(pendientes)} órdenes en MeLi sin factura fiscal.")

        facturas_siigo = obtener_facturas_siigo_paginadas((datetime.now() - timedelta(days=15)).strftime('%Y-%m-%d'))
        if not facturas_siigo: return f"⚠️ Alerta: MeLi tiene {len(pendientes)} pendientes pero no hay facturas en Siigo para cruzar."
        print(f"🔍 Obtenidas {len(facturas_siigo)} facturas de Siigo para comparar.")

        exitosas, faltantes = [], []
        for p_id in pendientes:
            encontrada = False
            for fac in facturas_siigo:
                if p_id in f"{fac.get('observations', '')} {fac.get('purchase_order', '')}":
                    pdf = descargar_factura_pdf_siigo(fac.get('id'))
                    if "❌" not in pdf and pdf and "✅" in subir_factura_meli(p_id, pdf):
                        print(f"   └──> ✅ Sincronizada factura para Pack ID: {p_id}")
                        exitosas.append(p_id)
                    encontrada = True
                    break
            if not encontrada: faltantes.append(p_id)

        if faltantes:
            resumen = f"⚠️ *ALERTA DE FACTURACIÓN* ⚠️\nSe subieron {len(exitosas)} facturas, pero faltan las de {len(faltantes)} órdenes de MeLi."
            lista_ids = "\n".join([f"- {f}" for f in faltantes[:20]])
            reporte = f"{resumen}\n\n**IDs sin factura:**\n{lista_ids}"
            if len(faltantes) > 20: reporte += f"\n... y {len(faltantes) - 20} más."
            enviar_reporte_controlado(reporte)
            return f"Sync terminada. Subidas: {len(exitosas)}. Faltantes: {len(faltantes)}. Reporte enviado."

        return f"✅ ¡Sincronización Inteligente completada! Se subieron {len(exitosas)} facturas."
    except Exception as e: return f"❌ Error crítico en Sync Inteligente: {e}"

def ejecutar_sincronizacion_y_reporte_stock():
    """Cruza el stock de Google Sheets con Mercado Libre y envía un reporte de niveles bajos."""
    print("\n💹 [STOCK SYNC] Iniciando escaneo de productos para reporte de stock...")
    token = refrescar_token_meli()
    if not token: return "❌ Error: Token de Mercado Libre no disponible."

    try:
        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sh = gc.open_by_key(SPREADSHEET_ID)
        sheet = sh.worksheet("Hoja 1") 
        data = sheet.get_all_values()
        
        ml_ids, fila_map, nombre_map = [], {}, {}
        for i, row in enumerate(data[1:], start=2):
            if not row: continue
            id_meli = str(row[0]).strip().upper()
            if id_meli.startswith("MCO"):
                ml_ids.append(id_meli)
                fila_map[id_meli] = i
                nombre_map[id_meli] = str(row[3]).strip() if len(row) > 3 else "Producto sin nombre"
        
        if not ml_ids: return "⚠️ No se encontraron códigos MCO en la Columna A de Google Sheets."
        print(f"✅ {len(ml_ids)} productos leídos de Sheets. Consultando stock en Mercado Libre...")

        headers = {'Authorization': f'Bearer {token}'}
        updates, agotados, criticos = [], [], []
        for i in range(0, len(ml_ids), 20):
            lote = ml_ids[i:i+20]
            res = requests.get(f"https://api.mercadolibre.com/items?ids={','.join(lote)}", headers=headers).json()
            for r in res:
                if r.get('code') != 200: continue
                item, ml_id = r['body'], item.get('id')
                stock = sum(v.get('available_quantity', 0) for v in item.get('variations', [])) if item.get('variations') else item.get('available_quantity', 0)
                
                nombre = nombre_map.get(ml_id, item.get('title'))
                if stock == 0: agotados.append(f"🚫 {nombre}")
                elif stock == 1: criticos.append(f"⚠️ {nombre}")
                updates.append({'range': f'F{fila_map[ml_id]}', 'values': [[stock]]})

        if updates: sheet.batch_update(updates)
        print("✅ Stock actualizado en Google Sheets.")

        reporte = "📊 *ALERTA DE STOCK MCKENNA*\n" + "─"*25
        if agotados: reporte += f"\n\n*❌ AGOTADOS ({len(agotados)}):*\n" + "\n".join(agotados[:20])
        if criticos: reporte += f"\n\n*⚠️ ÚLTIMA UNIDAD ({len(criticos)}):*\n" + "\n".join(criticos[:20])
        if not agotados and not criticos: reporte += "\n\n✅ Todo el stock está por encima de 1 unidad."
        
        enviar_whatsapp_reporte(reporte + f"\n\n🤖 _Total procesados: {len(ml_ids)}_")
        return f"✅ Reporte de stock enviado. Agotados: {len(agotados)}, Críticos: {len(criticos)}."

    except Exception as e: return f"❌ Error crítico en reporte de stock: {e}"

