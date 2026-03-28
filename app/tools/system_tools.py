
import os
import shutil
import ast
import subprocess
import sys
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# --- UTILIDADES DE SISTEMA Y ARCHIVOS ---

def listar_archivos_proyecto(path: str = '.') -> str:
    """Lista los archivos y directorios en una ruta específica del proyecto."""
    print(f"📁 Listando archivos en: {path}")
    try:
        archivos = os.listdir(path)
        if not archivos:
            return "El directorio está vacío."
        
        resultado = f"Contenido de '{path}':\n"
        for i, nombre in enumerate(sorted(os.listdir(path))):
            ruta_completa = os.path.join(path, nombre)
            es_dir = "[DIR]" if os.path.isdir(ruta_completa) else "[FILE]"
            resultado += f"{i+1}. {es_dir:6} {nombre}\n"
        return resultado

    except FileNotFoundError:
        return f"❌ Error: El directorio '{path}' no fue encontrado."
    except Exception as e:
        return f"❌ Error inesperado al listar archivos: {e}"

def crear_backup(ruta_archivo: str) -> str:
    """Crea una copia de seguridad de un archivo en la carpeta /backups."""
    if not os.path.isfile(ruta_archivo):
        return f"❌ Error: La ruta '{ruta_archivo}' no corresponde a un archivo válido."
    try:
        os.makedirs("backups", exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        nombre_base = os.path.basename(ruta_archivo)
        ruta_backup = os.path.join("backups", f"{nombre_base}.{timestamp}.bak")
        shutil.copy2(ruta_archivo, ruta_backup)
        return f"✅ Éxito: Backup creado en {ruta_backup}"
    except Exception as e:
        return f"❌ Error al crear el backup: {e}"

def leer_funcion(ruta_archivo: str, nombre_funcion: str) -> str:
    """Extrae el código fuente de una función específica dentro de un archivo."""
    try:
        with open(ruta_archivo, 'r', encoding='utf-8') as f:
            source_code = f.read()
        tree = ast.parse(source_code)
        for nodo in ast.walk(tree):
            if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre_funcion:
                return f"""python\n{ast.unparse(nodo)}\n"""
        return f"❌ Error: No se encontró la función '{nombre_funcion}' en '{ruta_archivo}'."
    except FileNotFoundError:
        return f"❌ Error: El archivo '{ruta_archivo}' no existe."
    except Exception as e:
        return f"❌ Error al leer la función: {e}"

def parchear_funcion(ruta_archivo: str, nombre_funcion: str, nuevo_codigo_funcion: str) -> str:
    """Reemplaza el código de una función existente en un archivo por uno nuevo."""
    try:
        ast.parse(nuevo_codigo_funcion)
        backup_msg = crear_backup(ruta_archivo)
        if "❌" in backup_msg:
            return f"No se pudo aplicar el parche porque falló la creación del backup: {backup_msg}"

        with open(ruta_archivo, 'r', encoding='utf-8') as f: lineas = f.readlines()
        tree = ast.parse("".join(lineas))
        inicio, fin = -1, -1
        for nodo in ast.walk(tree):
            if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre_funcion:
                inicio, fin = nodo.lineno - 1, nodo.end_lineno
                break
        if inicio == -1: return f"❌ Error: Función '{nombre_funcion}' no encontrada."

        nuevas_lineas = lineas[:inicio] + [nuevo_codigo_funcion + "\n"] + lineas[fin:]
        with open(ruta_archivo, 'w', encoding='utf-8') as f: f.writelines(nuevas_lineas)
        return f"✅ Función '{nombre_funcion}' actualizada. {backup_msg}"
    except SyntaxError as e: return f"❌ Error de sintaxis en el nuevo código: {e}"
    except Exception as e: return f"❌ Error al aplicar el parche: {e}"

def crear_nuevo_script(nombre_archivo: str, codigo_completo: str) -> str:
    """Crea un nuevo archivo .py con el contenido proporcionado."""
    try:
        if not nombre_archivo.endswith('.py'): return "❌ Error: El nombre debe terminar en '.py'."
        ast.parse(codigo_completo)
        with open(nombre_archivo, 'w', encoding='utf-8') as f: f.write(codigo_completo)
        return f"✅ Script '{nombre_archivo}' creado."
    except SyntaxError as e: return f"❌ Error de sintaxis en el código: {e}"
    except Exception as e: return f"❌ Error al crear el script: {e}"

def ejecutar_script_python(nombre_archivo: str) -> str:
    """Ejecuta un script de Python y devuelve su salida."""
    if not os.path.exists(nombre_archivo): return f"❌ Error: El script '{nombre_archivo}' no existe."
    try:
        resultado = subprocess.run([sys.executable, nombre_archivo], capture_output=True, text=True, timeout=45, check=False)
        salida = f"--- Salida de {nombre_archivo} ---\n{resultado.stdout}\n"
        if resultado.stderr: salida += f"--- Errores de {nombre_archivo} ---\n{resultado.stderr}\n"
        salida += f"--- Código de salida: {resultado.returncode} ---"
        return salida
    except subprocess.TimeoutExpired: return f"❌ Error: El script '{nombre_archivo}' tardó más de 45s y fue terminado."
    except Exception as e: return f"❌ Error al ejecutar el script: {e}"

# --- UTILIDADES DE COMUNICACIÓN ---

def enviar_email_reporte(destinatario: str, asunto: str, cuerpo: str) -> str:
    """Envía un correo electrónico usando SMTP de Gmail de forma segura."""
    print(f"📧 [EMAIL] Intentando enviar reporte a {destinatario}...")
    remitente = os.getenv("EMAIL_SENDER")
    password = os.getenv("EMAIL_PASSWORD")

    if not remitente or not password:
        return "❌ Error Crítico: Revisa que EMAIL_SENDER y EMAIL_PASSWORD estén en .env"

    msg = MIMEMultipart()
    msg['From'] = remitente
    msg['To'] = destinatario
    msg['Subject'] = asunto
    msg.attach(MIMEText(cuerpo, 'plain'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(remitente, password)
        server.send_message(msg)
        server.quit()
        return f"✅ Correo enviado con éxito a {destinatario}."
    except smtplib.SMTPAuthenticationError: return "❌ Error de autenticación SMTP. Revisa credenciales."
    except Exception as e: return f"❌ Error inesperado al enviar correo: {e}"

def enviar_reporte_controlado(mensaje):
    """Envía un reporte a WhatsApp previa confirmación en consola."""
    # TODO: Refactorizar esta función. La entrada del usuario (input)
    # la hace poco reutilizable y difícil de probar. Debería recibir
    # la decisión de enviar como un parámetro.
    print("\n" + "═"*40 + f"\n📋 REPORTE GENERADO:\n{mensaje}\n" + "═"*40)
    if True:
        from app.utils import enviar_whatsapp_reporte # Importación local para evitar dependencias circulares
        return enviar_whatsapp_reporte(mensaje)
    print("Envío cancelado por el usuario.")
    return False
