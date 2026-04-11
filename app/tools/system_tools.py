import os
import shutil
import ast
import subprocess
import sys
from datetime import datetime
from pathlib import Path
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def _repo_root() -> Path:
    """Raíz del repo (directorio que contiene app/)."""
    return Path(__file__).resolve().parents[2]


def _file_tools_restricted() -> bool:
    if os.getenv("AGENTE_RESTRICT_FILE_TOOLS", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        return True
    return os.getenv("FLASK_ENV", "").strip().lower() == "production"


def _allowed_path_prefixes() -> list[str]:
    raw = os.getenv(
        "AGENTE_FILE_TOOL_PREFIXES",
        "scripts/,app/tools/,tests/",
    )
    out = []
    for p in raw.split(","):
        p = p.strip().replace("\\", "/")
        if not p:
            continue
        if not p.endswith("/"):
            p += "/"
        out.append(p)
    return out


def _resolved_relative_posix(path_str: str) -> tuple[bool, str]:
    root = _repo_root()
    p = Path(path_str)
    if not p.is_absolute():
        p = (root / p).resolve()
    else:
        p = p.resolve()
    try:
        rel = p.relative_to(root)
    except ValueError:
        return False, ""
    return True, rel.as_posix()


def _path_allowed_for_mutating_tools(rel_posix: str) -> bool:
    if not _file_tools_restricted():
        return True
    prefixes = _allowed_path_prefixes()
    if not prefixes:
        return False
    for pref in prefixes:
        base = pref.rstrip("/")
        if rel_posix == base or rel_posix.startswith(pref):
            return True
    return False


def _guard_mutable_path(path_str: str) -> str | None:
    ok, rel = _resolved_relative_posix(path_str)
    if not ok:
        return "❌ Error: la ruta queda fuera del directorio del repositorio."
    if not _path_allowed_for_mutating_tools(rel):
        return (
            "❌ Herramienta de archivos restringida (AGENTE_RESTRICT_FILE_TOOLS=1 o FLASK_ENV=production). "
            f"Ruta relativa '{rel}' no está bajo AGENTE_FILE_TOOL_PREFIXES. "
            "Ajusta prefijos solo si es deliberado."
        )
    return None


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
        blocked = _guard_mutable_path(ruta_archivo)
        if blocked:
            return blocked
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
        blocked = _guard_mutable_path(nombre_archivo)
        if blocked:
            return blocked
        ast.parse(codigo_completo)
        with open(nombre_archivo, 'w', encoding='utf-8') as f: f.write(codigo_completo)
        return f"✅ Script '{nombre_archivo}' creado."
    except SyntaxError as e: return f"❌ Error de sintaxis en el código: {e}"
    except Exception as e: return f"❌ Error al crear el script: {e}"

def ejecutar_script_python(nombre_archivo: str) -> str:
    """Ejecuta un script de Python y devuelve su salida."""
    if not os.path.exists(nombre_archivo): return f"❌ Error: El script '{nombre_archivo}' no existe."
    blocked = _guard_mutable_path(nombre_archivo)
    if blocked:
        return blocked
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

import json
import unicodedata

def consultar_tarifa_mercadoenvios(ciudad_destino: str, peso_kg: float) -> dict:
    """
    Consulta tarifa real via API de MercadoLibre.
    Si falla, usa el JSON local como fallback.
    """
    try:
        # Podríamos buscar el zip_code según ciudad, pero como meli_preventa recibe zip_code,
        # simplificamos si la API de Meli no está disponible o falla
        
        # Como no tenemos el código postal exacto, el fallback local es crucial
        tarifa_local = consultar_tarifa_envio(ciudad_destino)
        precio_base = tarifa_local.get("tarifa", {}).get("precio_base", 18000)
        dias = tarifa_local.get("tarifa", {}).get("dias", 4)
        
        # Cálculo de peso extra
        if peso_kg > 1.0:
            kilos_extra = int(peso_kg - 1.0)
            if peso_kg % 1.0 > 0:
                kilos_extra += 1
            precio_final = precio_base + (kilos_extra * 2000)
        else:
            precio_final = precio_base
            
        tarifa_local["tarifa"]["precio_calculado"] = precio_final
        tarifa_local["tarifa"]["peso_kg"] = peso_kg
        return tarifa_local
    except Exception as e:
        print(f"Error en consultar_tarifa_mercadoenvios: {e}")
        return consultar_tarifa_envio(ciudad_destino)

def consultar_tarifa_envio(ciudad: str) -> dict:
    """
    Consulta la tarifa de envío de Interrapidísimo para una ciudad específica.
    """
    try:
        with open('app/data/tarifas_interrapidisimo.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Normalizar ciudad (quitar tildes, minúsculas)
        ciudad_norm = unicodedata.normalize('NFKD', ciudad).encode('ASCII', 'ignore').decode('utf-8').lower().strip()
        
        ciudades = data.get('ciudades', {})
        # Buscar coincidencia flexible
        for ciudad_clave, info in ciudades.items():
            clave_norm = unicodedata.normalize('NFKD', ciudad_clave).encode('ASCII', 'ignore').decode('utf-8').lower()
            if clave_norm in ciudad_norm or ciudad_norm in clave_norm:
                return {"ciudad": ciudad_clave.capitalize(), "tarifa": info}
                
        return {"ciudad": "Default", "tarifa": ciudades.get('default')}
    except Exception as e:
        print(f"Error consultando tarifa de envío: {e}")
        return {"ciudad": "Error", "tarifa": {"precio_kg": 18000, "precio_base": 18000, "dias": 4}}
