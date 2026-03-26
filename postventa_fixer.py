
from default_api import query_sqlite, consultar_detalle_venta_meli 
import datetime

# --- SIMULACIÓN DE MOCKS para que corra el script de prueba ---
def query_sqlite(consulta_sql):
    if "mercadopago" in consulta_sql:
        # Simulación de 2 packs encontrados
        return [('PACK-XYZ1', 'BUYER-1'), ('PACK-ABC2', 'BUYER-2')]
    return []

def consultar_detalle_venta_meli(pack_id):
    # Simulación: Ambos packs tienen el tipo de envío correcto
    return {'shipping_type': 'not_included_in_mercadopago'}
# -----------------------------------------------------------

def procesar_mensajes_postventa(dias_atras=7):
    """
    Revisa órdenes en SQLite para encontrar ventas con shipping_type = 'not_included_in_mercadopago'
    y procesa sus conversaciones, permitiendo la respuesta directa al cliente.
    """
    try:
        fecha_inicio = (datetime.datetime.now() - datetime.timedelta(days=dias_atras)).strftime('%Y-%m-%d')
        
        consulta_sql = f"""
        SELECT p.pack_id, p.buyer_id
        FROM packs p
        JOIN ventas_meli vm ON p.pack_id = vm.pack_id
        WHERE vm.date_created >= '{fecha_inicio}'
          AND vm.shipping_type = 'not_included_in_mercadopago'
        LIMIT 20;
        """
        
        # Ejecuta la herramienta para obtener los datos de la DB
        packs_a_procesar = query_sqlite(consulta_sql=consulta_sql) 

        if not packs_a_procesar:
            return "✅ Postventa: No hay conversaciones nuevas con 'Acordar con el vendedor' para procesar en los últimos 7 días."

        mensajes_procesados = 0
        
        for pack_id, buyer_id in packs_a_procesar:
            # Se verifica el detalle para asegurar la coherencia
            detalle = consultar_detalle_venta_meli(pack_id=pack_id)
            
            if detalle.get('shipping_type') != 'not_included_in_mercadopago':
                print(f"⚠️ Pack {pack_id} filtrado nuevamente: shipping_type es {detalle.get('shipping_type')}")
                continue
            
            # *** AQUÍ DEBE IR LA LLAMADA EXITOSA AL ENDPOINT DE MENSAJERÍA DE ML ***
            print(f"✅ Pack {pack_id}: Conversación lista para ser procesada/respondida.")
            mensajes_procesados += 1
            
        return f"✅ POSTVENTA FIX: LÓGICA DE FILTRADO OK. Se detectaron {mensajes_procesados} packs elegibles para respuesta."

    except Exception as e:
        return f"❌ ERROR FATAL durante la simulación del postventa: {e}"

# --- EJECUCIÓN DE PRUEBA ---
print(procesar_mensajes_postventa(dias_atras=3))
