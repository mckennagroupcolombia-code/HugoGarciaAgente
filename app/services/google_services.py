
import os
import unicodedata
import gspread

# TODO: La ruta a las credenciales debería venir de una configuración central
# en lugar de ser importada directamente desde otro módulo.
from app.sync import GOOGLE_CREDS_PATH

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID") or "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
CREDS_PATH = "/home/mckg/mi-agente/mi-agente-ubuntu-8a79d0d674c3.json"


def _normalizar(s: str) -> str:
    return ''.join(
        c for c in unicodedata.normalize('NFD', s.lower())
        if unicodedata.category(c) != 'Mn'
    )


def _abrir_hoja():
    gc = gspread.service_account(filename=CREDS_PATH)
    workbook = gc.open_by_key(SPREADSHEET_ID)
    try:
        return workbook.worksheet("BASE DE DATOS MCKENNA GROUP S.A.S")
    except gspread.exceptions.WorksheetNotFound:
        return workbook.sheet1

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


def buscar_ficha_tecnica_producto(nombre_producto: str):
    """
    Busca la ficha técnica (columna I, índice 8) de un producto en Google Sheets.
    Usa la columna D (índice 3) como nombre del producto.
    Retorna el contenido de la columna I como string, o None si no encuentra o está vacía.
    """
    import unicodedata

    def normalizar(s: str) -> str:
        return ''.join(
            c for c in unicodedata.normalize('NFD', s.lower())
            if unicodedata.category(c) != 'Mn'
        )

    print(f"🔍 [G-SHEETS] Buscando ficha técnica para: '{nombre_producto}'...")
    try:
        SPREADSHEET_ID = os.getenv("SPREADSHEET_ID") or "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
        CREDS_PATH = "/home/mckg/mi-agente/mi-agente-ubuntu-8a79d0d674c3.json"
        if not os.path.exists(CREDS_PATH):
            print(f"❌ [G-SHEETS] Credenciales no encontradas en {CREDS_PATH}")
            return None

        gc = gspread.service_account(filename=CREDS_PATH)
        workbook = gc.open_by_key(SPREADSHEET_ID)
        try:
            sheet = workbook.worksheet("BASE DE DATOS MCKENNA GROUP S.A.S")
        except gspread.exceptions.WorksheetNotFound:
            sheet = workbook.sheet1

        all_values = sheet.get_all_values()
        if not all_values:
            return None

        rows = all_values[1:]  # saltar encabezado
        IDX_NOMBRE = 3   # columna D
        IDX_TDS    = 8   # columna I

        nombre_norm = normalizar(nombre_producto)
        excluir = {'para', 'con', 'del', 'los', 'las', 'una', 'unos', 'unas', 'por'}
        palabras = [p for p in nombre_norm.split() if len(p) > 4 and p not in excluir]
        if not palabras:
            palabras = nombre_norm.split()

        # Exigir que TODAS las palabras distintivas coincidan (evita falsos positivos)
        def coincide(fila_norm: str) -> bool:
            return all(p in fila_norm for p in palabras)

        for row in rows:
            if len(row) <= IDX_NOMBRE:
                continue
            nombre_fila_norm = normalizar(str(row[IDX_NOMBRE]))
            if coincide(nombre_fila_norm):
                ficha = row[IDX_TDS].strip() if len(row) > IDX_TDS else ""
                if ficha:
                    print(f"✅ [G-SHEETS] Ficha técnica encontrada para '{nombre_producto}'")
                    return ficha
                else:
                    print(f"⚠️ [G-SHEETS] Producto encontrado pero columna I vacía: '{row[IDX_NOMBRE]}'")
                    return None

        print(f"⚠️ [G-SHEETS] Producto '{nombre_producto}' no encontrado en la hoja")
        return None

    except Exception as e:
        print(f"❌ [G-SHEETS] Error en buscar_ficha_tecnica_producto: {e}")
        return None


def buscar_producto_completo(consulta: str):
    """
    Busca un producto combinando Google Sheets + SIIGO.
    Acepta nombre (columna D) o SKU (columna B).
    Retorna nombre oficial de SIIGO, precio, stock y ficha técnica.
    """
    from app.services.siigo import buscar_producto_siigo_por_sku

    print(f"🔍 [CATÁLOGO] Buscando producto: '{consulta}'...")
    try:
        if not os.path.exists(CREDS_PATH):
            print(f"❌ [CATÁLOGO] Credenciales no encontradas: {CREDS_PATH}")
            return None

        sheet = _abrir_hoja()
        data = sheet.get_all_values()
        if not data:
            return None

        consulta_norm = _normalizar(consulta)

        for row in data[1:]:
            if len(row) < 7:
                continue

            sku = str(row[1]).strip()           # columna B
            nombre_sheet = str(row[3]).strip()  # columna D
            stock_siigo = str(row[6]).strip()   # columna G
            ficha_tecnica = str(row[8]).strip() if len(row) > 8 else ""  # columna I

            nombre_norm = _normalizar(nombre_sheet)
            sku_norm = sku.upper()

            if (consulta_norm in nombre_norm or
                    nombre_norm in consulta_norm or
                    consulta.upper() == sku_norm):

                datos_siigo = buscar_producto_siigo_por_sku(sku) if sku else None

                return {
                    "sku": sku,
                    "nombre_meli": nombre_sheet,
                    "nombre_siigo": datos_siigo["nombre"] if datos_siigo else nombre_sheet,
                    "precio": datos_siigo["precio"] if datos_siigo else None,
                    "unidad": datos_siigo["unidad"] if datos_siigo else None,
                    "stock_siigo": stock_siigo,
                    "ficha_tecnica": ficha_tecnica if ficha_tecnica else None,
                    "referencia": datos_siigo["referencia"] if datos_siigo else sku
                }

        print(f"⚠️ [CATÁLOGO] '{consulta}' no encontrado en Google Sheets")
        return None

    except Exception as e:
        print(f"❌ [CATÁLOGO] Error en buscar_producto_completo: {e}")
        return None
