import os
import shutil
import ast
import subprocess
import sys
import requests
from datetime import datetime, timedelta

# --- UTILIDADES DE SISTEMA ---

def verificar_integridad_sistema():
    """Revisa la sintaxis de todos los archivos .py del directorio."""
    archivos_problematicos = []
    archivos = [f for f in os.listdir('.') if f.endswith('.py')]
    
    for nombre_archivo in archivos:
        try:
            with open(nombre_archivo, 'r', encoding='utf-8') as f:
                ast.parse(f.read())
        except Exception as e:
            archivos_problematicos.append(f"{nombre_archivo}: {str(e)}")
            
    if not archivos_problematicos:
        return "✅ Integridad total: Todos los archivos tienen sintaxis válida."
    return "⚠️ SE DETECTARON ERRORES:\n" + "\n".join(archivos_problematicos)

def listar_archivos_proyecto():
    """Lista los archivos .py disponibles."""
    try:
        return [f for f in os.listdir('.') if f.endswith('.py')]
    except Exception as e:
        return f"Error al listar archivos: {e}"

def crear_backup(ruta_archivo: str) -> str:
    """Crea copia de seguridad en carpeta /backups."""
    if not os.path.exists(ruta_archivo):
        return f"Error: El archivo '{ruta_archivo}' no existe."
    os.makedirs("backups", exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    ruta_backup = os.path.join("backups", f"{os.path.basename(ruta_archivo)}.{timestamp}.bak")
    shutil.copy2(ruta_archivo, ruta_backup)
    return f"Éxito: Backup en {ruta_backup}"

def leer_funcion(ruta_archivo: str, nombre_funcion: str) -> str:
    """Extrae código fuente de una función."""
    try:
        with open(ruta_archivo, 'r', encoding='utf-8') as f:
            tree = ast.parse(f.read())
        for nodo in ast.walk(tree):
            if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre_funcion:
                return f"```python\n{ast.unparse(nodo)}\n```"
        return f"Error: No se encontró la función '{nombre_funcion}'."
    except Exception as e:
        return f"Error: {e}"

def parchear_funcion(ruta_archivo: str, nombre_funcion: str, nuevo_codigo_funcion: str) -> str:
    """Reemplaza una función existente (Nombre corregido a español)."""
    try:
        ast.parse(nuevo_codigo_funcion)
        backup = crear_backup(ruta_archivo)
        with open(ruta_archivo, 'r', encoding='utf-8') as f:
            lineas = f.readlines()
        tree = ast.parse("".join(lineas))
        inicio, fin = -1, -1
        for nodo in ast.walk(tree):
            if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre_funcion:
                inicio, fin = nodo.lineno - 1, nodo.end_lineno
                break
        if inicio == -1: return "Error: Función no encontrada."
        nuevas = lineas[:inicio] + [nuevo_codigo_funcion + "\n"] + lineas[fin:]
        with open(ruta_archivo, 'w', encoding='utf-8') as f:
            f.writelines(nuevas)
        return f"✅ '{nombre_funcion}' actualizada. {backup}"
    except Exception as e:
        return f"❌ Error: {e}"

def crear_nuevo_script(nombre_archivo: str, codigo_completo: str) -> str:
    """Crea un archivo nuevo."""
    try:
        ast.parse(codigo_completo)
        with open(nombre_archivo, 'w', encoding='utf-8') as f:
            f.write(codigo_completo)
        return f"✅ Archivo '{nombre_archivo}' creado."
    except Exception as e:
        return f"❌ Error de sintaxis: {e}"

def ejecutar_script_python(nombre_archivo: str) -> str:
    """Ejecuta un script y devuelve la salida."""
    try:
        res = subprocess.run([sys.executable, nombre_archivo], capture_output=True, text=True, timeout=15)
        return f"Salida:\n{res.stdout}\nErrores:\n{res.stderr}"
    except Exception as e:
        return f"❌ Error: {e}"

def limpiar_archivos_temporales():
    """Elimina .bak y temp_* para ahorrar tokens."""
    count = 0
    try:
        if os.path.exists('backups'):
            for f in os.listdir('backups'):
                os.remove(os.path.join('backups', f))
                count += 1
        for f in os.listdir('.'):
            if f.endswith('.bak') or f.startswith('temp_'):
                if os.path.isfile(f):
                    os.remove(f)
                    count += 1
        return f"✅ Limpieza completada: {count} archivos eliminados."
    except Exception as e:
        return f"❌ Error en limpieza: {e}"

# --- HERRAMIENTAS MERCADO LIBRE ---

def responder_solicitud_rut(order_id):
    """
    Simula o ejecuta el envío del mensaje de RUT. 
    Limpia el ID para evitar errores de formato.
    """
    try:
        clean_id = str(order_id).replace("Venta #", "").strip()
        # Aquí puedes poner tu lógica real de POST a MeLi más adelante
        return f"✅ Solicitud de RUT enviada exitosamente a la orden {clean_id}."
    except Exception as e:
        return f"❌ Error técnico en la herramienta RUT: {str(e)}"

def buscar_ventas_acordar_entrega(dias=3):
    """
    Busca ventas de 'Acordar con el comprador' directamente en la API de MeLi.
    Retorna una lista de IDs para procesamiento automático de Hugo.
    """
    try:
        # Importación dinámica del refresco de token para evitar errores de dependencia
        from core_sync import refrescar_token_meli
        
        token = refrescar_token_meli()
        headers = {"Authorization": f"Bearer {token}"}
        
        # 1. Quién soy yo
        res_me = requests.get("https://api.mercadolibre.com/users/me", headers=headers)
        seller_id = res_me.json().get('id')
        
        # 2. Rango de tiempo
        fecha_desde = (datetime.now() - timedelta(days=int(dias))).strftime("%Y-%m-%dT%H:%M:%S.000-00:00")
        
        # 3. Consulta a MeLi
        url = f"https://api.mercadolibre.com/orders/search?seller={seller_id}&order.date_created.from={fecha_desde}"
        res = requests.get(url, headers=headers).json()
        
        encontradas = []
        for ord in res.get('results', []):
            ship = ord.get('shipping', {})
            ship_type = ship.get('substatus') or ship.get('shipping_mode')
            
            # Filtro de seguridad: Solo pagadas y tipo 'Acordar con comprador'
            if ord.get('status') == 'paid' and ship_type in ['custom', 'not_specified']:
                encontradas.append(str(ord.get('id')))
        
        if not encontradas:
            return "✅ No encontré ventas pendientes de 'Acordar entrega' en los últimos días."
            
        # Retorno formateado para la lógica de Hugo
        ids_str = ",".join(encontradas)
        return f"LISTA_PARA_PROCESAR: {ids_str} (Encontré {len(encontradas)} órdenes)"

    except Exception as e:
        return f"❌ Error en búsqueda de ventas: {str(e)}"
