
import os
import gspread

# TODO: La ruta a las credenciales debería venir de una configuración central
# en lugar de ser importada directamente desde otro módulo.
from core_sync import GOOGLE_CREDS_PATH

def leer_datos_hoja(producto_buscar: str):
    """
    Busca información de un producto en una hoja de cálculo de Google Sheets.

    Valida que las variables de entorno y las credenciales necesarias existan
    antes de intentar conectarse.
    """
    print(f"🔍 [G-SHEETS] Buscando producto: '{producto_buscar}'...")
    try:
        # 1. Validar configuración esencial
        SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")
        if not SPREADSHEET_ID:
            return "❌ Error Crítico: El ID de la hoja de cálculo (SPREADSHEET_ID) no está configurado en el archivo .env. Notifique al administrador."

        if not os.path.exists(GOOGLE_CREDS_PATH):
            return f"❌ Error Crítico: El archivo de credenciales de Google no se encuentra en la ruta esperada: {GOOGLE_CREDS_PATH}."

        # 2. Conectar con Google Sheets
        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sheet = gc.open_by_key(SPREADSHEET_ID).worksheet("BASE DE DATOS MCKENNA GROUP S.A.S")

        # 3. Buscar el producto
        resultados = []
        palabras_clave = producto_buscar.lower().split()
        
        # Obtener todos los valores para evitar múltiples llamadas a la API
        all_values = sheet.get_all_values()
        header = all_values[0]
        rows = all_values[1:]

        # Mapeo de columnas (más robusto que usar índices fijos)
        try:
            idx_nombre = header.index("NOMBRE")
            idx_precio = header.index("PRECIO")
            idx_stock = header.index("CANTIDAD")
        except ValueError as e:
            return f"❌ Error: La hoja de cálculo no tiene las columnas esperadas (NOMBRE, PRECIO, CANTIDAD). Falta: {e}"

        for row in rows:
            # Asegurarse de que la fila tiene suficientes columnas
            if len(row) > max(idx_nombre, idx_precio, idx_stock):
                nombre_producto = row[idx_nombre].lower()
                # Comprobar que todas las palabras clave estén en el nombre del producto
                if all(p in nombre_producto for p in palabras_clave):
                    resultados.append(
                        f"- {row[idx_nombre]} | Precio: ${row[idx_precio]} | Stock: {row[idx_stock]}"
                    )

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
