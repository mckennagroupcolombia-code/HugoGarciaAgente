import os
import gspread
import google.generativeai as genai

# Ruta de las credenciales de Google
GOOGLE_CREDS_PATH = "/home/mckg/mi-agente/mi-agente-ubuntu-8a79d0d674c3.json"
SPREADSHEET_ID_PREVENTA = "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"

def obtener_info_producto_preventa(nombre_producto: str):
    """
    Busca información detallada del producto en la hoja de cálculo específica de preventa.
    """
    try:
        if not os.path.exists(GOOGLE_CREDS_PATH):
            print(f"❌ Error: Credenciales de Google no encontradas en {GOOGLE_CREDS_PATH}")
            return "No se pudo acceder a la información técnica del producto."

        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sheet = gc.open_by_key(SPREADSHEET_ID_PREVENTA).sheet1 # Asumimos la primera hoja

        # Obtener todos los valores
        all_values = sheet.get_all_values()
        if not all_values:
            return "La hoja de inventario está vacía."
            
        header = [h.lower().strip() for h in all_values[0]]
        rows = all_values[1:]

        # Encontrar las columnas relevantes, especialmente la I (TDS)
        try:
            # Buscamos la columna de nombre (usualmente la A o B) y la I (índice 8)
            # Para ser dinámicos, intentamos encontrar la columna de "producto" o "nombre"
            idx_nombre = -1
            for i, col in enumerate(header):
                if "producto" in col or "nombre" in col or "articulo" in col:
                    idx_nombre = i
                    break
            
            if idx_nombre == -1:
                idx_nombre = 0 # Asumimos la primera columna si no encontramos el nombre
                
            # Columna I es el índice 8 (0-based)
            idx_tds = 8 
            
        except ValueError:
            return "No se encontraron las columnas necesarias en el inventario."

        palabras_clave = nombre_producto.lower().split()
        
        for row in rows:
            if len(row) > max(idx_nombre, idx_tds):
                nombre_en_hoja = row[idx_nombre].lower()
                # Verificar si alguna palabra clave importante está en el nombre del producto
                # o si el nombre del producto de MeLi está en la hoja
                match = any(p in nombre_en_hoja for p in palabras_clave if len(p) > 3)
                
                if match:
                    info_tds = row[idx_tds] if len(row) > idx_tds else "Información técnica no disponible."
                    return f"Producto encontrado: {row[idx_nombre]}. Información Técnica (TDS): {info_tds}"
                    
        return f"No se encontró información técnica detallada para el producto '{nombre_producto}' en nuestro inventario."

    except Exception as e:
        print(f"❌ Error leyendo hoja de preventa: {e}")
        return "Hubo un error al consultar el inventario."

def generar_respuesta_preventa_ia(pregunta: str, nombre_producto: str):
    """
    Genera una respuesta de preventa usando Gemini con el contexto del producto.
    """
    # 1. Obtener información técnica del producto desde Google Sheets
    info_tecnica = obtener_info_producto_preventa(nombre_producto)
    
    # 2. Configurar la IA
    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        modelo = genai.GenerativeModel("gemini-2.5-pro")
        
        prompt = f"""
        Eres Hugo Garcia, asistente virtual de McKenna Group en Mercado Libre.
        Debes responder a la siguiente pregunta de un cliente sobre el producto '{nombre_producto}'.
        
        INFORMACIÓN TÉCNICA DEL PRODUCTO (TDS):
        {info_tecnica}
        
        PREGUNTA DEL CLIENTE:
        "{pregunta}"
        
        REGLAS ESTRICTAS PARA TU RESPUESTA:
        1. Tono: Rolo, cálido pero formal y cercano (ej: "Hola veci", "con gusto le colaboro").
        2. Presentación: Preséntate como Hugo Garcia tu asistente (solo si es necesario iniciar la conversación, asume que esta es la primera interacción).
        3. Concreto: Responde exactamente lo que el cliente pregunta. NO te vayas por las ramas. NO entregues información de más.
        4. No sugieras caminos alternativos, solo responde lo que los clientes desean saber.
        5. Límite de palabras: MÁXIMO 2000 palabras (restricción de Mercado Libre).
        6. Ejemplo de estilo (adapta esto a la info técnica real):
           "Hola veci, soy Hugo Garcia su asistente, le comento que esta materia prima (nombre_producto) es de calidad USP. Esto quiere decir que le sirve para elaborar productos alimenticios o cosméticos. Por otro lado, la dosis depende de para qué lo va a usar el producto... Como no somos profesionales de la salud no podemos darte indicaciones sobre sugerencia de dosis diarias, puedes apoyarte bajo tu responsabilidad en datos científicos."
        
        Genera únicamente la respuesta que se enviará al cliente en Mercado Libre, sin comillas ni texto introductorio.
        """
        
        respuesta = modelo.generate_content(prompt)
        
        texto_final = respuesta.text.strip()
        # Asegurar límite de Mercado Libre (aunque 2000 palabras es muchísimo, MeLi suele tener límite de caracteres de 2000, mejor prevenir limitando a 2000 caracteres)
        if len(texto_final) > 2000:
            texto_final = texto_final[:1997] + "..."
            
        return texto_final
        
    except Exception as e:
        print(f"❌ Error generando respuesta de preventa con IA: {e}")
        return "Hola, gracias por tu pregunta. En breve uno de nuestros asesores te responderá con más detalles."
