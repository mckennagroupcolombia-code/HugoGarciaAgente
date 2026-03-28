
import os
import gspread

# TODO: La ruta a las credenciales debería venir de una configuración central
# en lugar de ser importada directamente desde otro módulo.
from app.sync import GOOGLE_CREDS_PATH

def leer_datos_hoja(producto_buscar: str):
    """
    Busca información de un producto en una hoja de cálculo de Google Sheets.

    Valida que las variables de entorno y las credenciales necesarias existan
    antes de intentar conectarse.
    """
    print(f"🔍 [G-SHEETS] Buscando producto: '{producto_buscar}'...")
    try:
        # 1. Validar configuración esencial
        # SPREADSHEET_ID fijo basado en la integración de preventa
        SPREADSHEET_ID = os.getenv("SPREADSHEET_ID") or "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
        
        # Ruta de credenciales fija
        CREDS_PATH = "/home/mckg/mi-agente/mi-agente-ubuntu-8a79d0d674c3.json"
        if not os.path.exists(CREDS_PATH):
            return f"❌ Error Crítico: El archivo de credenciales de Google no se encuentra en la ruta esperada: {CREDS_PATH}."

        # 2. Conectar con Google Sheets
        gc = gspread.service_account(filename=CREDS_PATH)
        
        # Intentar abrir la hoja, si la worksheet específica no existe, abrir la primera
        workbook = gc.open_by_key(SPREADSHEET_ID)
        try:
            sheet = workbook.worksheet("BASE DE DATOS MCKENNA GROUP S.A.S")
        except gspread.exceptions.WorksheetNotFound:
            sheet = workbook.sheet1

        # 3. Buscar el producto
        resultados = []
        palabras_clave = producto_buscar.lower().split()
        
        # Obtener todos los valores para evitar múltiples llamadas a la API
        all_values = sheet.get_all_values()
        header = all_values[0]
        rows = all_values[1:]

        # Mapeo de columnas (más robusto que usar índices fijos)
        # Convertir a mayúsculas o minúsculas para encontrar sin importar case
        header_lower = [h.lower().strip() for h in header]
        try:
            # Buscamos columnas de manera más flexible
            idx_nombre = next(i for i, h in enumerate(header_lower) if "nombre" in h or "producto" in h or "articulo" in h)
            idx_precio = next((i for i, h in enumerate(header_lower) if "precio" in h), -1)
            idx_stock = next((i for i, h in enumerate(header_lower) if "cantidad" in h or "stock" in h or "disponible" in h), -1)
        except StopIteration:
            # Si no encuentra 'nombre', asume que es la primera columna. 
            # Si no encuentra las otras, asume que no existen en esta hoja.
            idx_nombre = 0
            idx_precio = -1
            idx_stock = -1

        for row in rows:
            if len(row) > idx_nombre:
                nombre_en_hoja = row[idx_nombre].lower()
                # Comprobar si al menos una palabra clave larga está en el nombre (flexibilidad)
                # O si todas las palabras clave están presentes
                match = all(p in nombre_en_hoja for p in palabras_clave if len(p) > 2)
                
                if match:
                    precio_texto = f" | Precio: ${row[idx_precio]}" if idx_precio != -1 and len(row) > idx_precio else ""
                    stock_texto = f" | Stock: {row[idx_stock]}" if idx_stock != -1 and len(row) > idx_stock else ""
                    resultados.append(f"- {row[idx_nombre]}{precio_texto}{stock_texto}")

        if resultados:
            return "\n".join(resultados)
        else:
            return f"No se encontró ningún producto que coincida con '{producto_buscar}'."

    except gspread.exceptions.SpreadsheetNotFound:
        return "❌ Error: No se pudo encontrar la hoja de cálculo. Verifica que el SPREADSHEET_ID sea correcto."
    except gspread.exceptions.WorksheetNotFound:
        return "❌ Error: No se pudo encontrar la hoja de trabajo 'BASE DE DATOS MCKENNA GROUP S.A.S'."
    except Exception as e:
        return f"❌ Error inesperado al leer la hoja de Google Sheets: {e}"
