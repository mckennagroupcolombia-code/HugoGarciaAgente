import os
import gspread
import unicodedata
import re
import time
from docx import Document
from app.sync import GOOGLE_CREDS_PATH, SPREADSHEET_ID
from googleapiclient.discovery import build
from google.oauth2 import service_account

# NUEVO ID DE CARPETA (Actualizado según tu link)
DRIVE_FOLDER_ID = "1hHwif79Rf9O6vgAQt5X0CCVML4LeAIz6"

def normalizar_texto(texto):
    if not texto: return ""
    texto = ''.join(c for c in unicodedata.normalize('NFD', texto) if unicodedata.category(c) != 'Mn')
    texto = re.sub(r'[^a-zA-Z0-9\s]', ' ', texto)
    return texto.lower().strip()

def extraer_texto_word(ruta_archivo):
    try:
        doc = Document(ruta_archivo)
        return "\n".join([para.text for para in doc.paragraphs if para.text.strip()])
    except Exception as e:
        return f"Error: {e}"

def buscar_link_drive(service, nombre_completo_excel):
    """Busca el PDF con una lógica de palabras clave más flexible."""
    try:
        palabras = normalizar_texto(nombre_completo_excel).split()
        # Filtramos palabras que ensucian la búsqueda de archivos
        ignorar = ["ft", "ficha", "tecnica", "de", "del", "para", "producto", "certificado", "gr", "kg", "ml", "usp", "n/a", "envio", "gratis", "puro"]
        claves = [p for p in palabras if p not in ignorar and len(p) > 2]
        
        if not claves: return None

        # Intentar búsqueda con las 2 primeras palabras clave (ej: "cloruro calcio")
        termino_busqueda = " ".join(claves[:2])
        query = f"'{DRIVE_FOLDER_ID}' in parents and name contains '{termino_busqueda}' and mimeType = 'application/pdf' and trashed = false"
        
        results = service.files().list(q=query, fields="files(id, name, webViewLink)").execute()
        files = results.get('files', [])
        
        if not files:
            # Fallback: intentar solo con la palabra más larga (ej: "alginato")
            palabra_principal = max(claves, key=len)
            query = f"'{DRIVE_FOLDER_ID}' in parents and name contains '{palabra_principal}' and mimeType = 'application/pdf' and trashed = false"
            results = service.files().list(q=query, fields="files(id, name, webViewLink)").execute()
            files = results.get('files', [])

        return files[0].get('webViewLink') if files else None
    except Exception as e:
        print(f"❌ Error API Drive: {e}")
        return None

def carga_masiva_tds():
    try:
        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sh = gc.open_by_key(SPREADSHEET_ID)
        sheet = sh.worksheet("Hoja 1")
        
        creds_drive = service_account.Credentials.from_service_account_file(GOOGLE_CREDS_PATH)
        drive_service = build('drive', 'v3', credentials=creds_drive)
    except Exception as e:
        print(f"🚫 Error de conexión: {e}")
        return

    directorio = os.path.expanduser("~/mi-agente/fichas_word")
    data = sheet.get_all_values()
    
    print(f"🚀 Procesando {len(data)-1} filas en la carpeta {DRIVE_FOLDER_ID}...")

    for i, row in enumerate(data[1:], start=2):
        nombre_excel = str(row[3])
        if not nombre_excel.strip(): continue

        # --- PARTE A: TEXTO TDS (COL I) ---
        # (Aquí va tu lógica actual de búsqueda de .docx local)
        # ... [Se asume que esta parte ya te funciona bien] ...

        # --- PARTE B: LINK DRIVE (COL J) ---
        link = buscar_link_drive(drive_service, nombre_excel)
        
        if link:
            try:
                sheet.update_cell(i, 10, link)
                print(f"🔗 VINCULADO: {nombre_excel[:30]} -> {link}")
            except:
                time.sleep(10)
                sheet.update_cell(i, 10, link)
        else:
            print(f"❓ Sin PDF: {nombre_excel[:30]}")

        time.sleep(1.2) # Evitar bloqueo de Google

if __name__ == "__main__":
    carga_masiva_tds()
