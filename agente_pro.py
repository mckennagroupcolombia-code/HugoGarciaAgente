
# =======================================================================
#  PUNTO DE ENTRADA PRINCIPAL DE LA APLICACIÓN AGENTE
# =======================================================================
#
#  Este archivo es el corazón del proyecto. Su única responsabilidad
#  es inicializar los componentes clave y ponerlos en marcha.
#
#  Arquitectura:
#  1. Carga las configuraciones y variables de entorno.
#  2. Crea la instancia de la aplicación web (Flask).
#  3. Registra las rutas (endpoints) de la API desde app/routes.py.
#  4. Inicia la Interfaz de Línea de Comandos (CLI) en un hilo separado
#     para no bloquear el servidor web.
#  5. Ejecuta el servidor web Flask para recibir peticiones (webhooks).
#
# =======================================================================

import os
import threading
import logging
from flask import Flask
from dotenv import load_dotenv

# --- 1. Carga de Configuración ---
# Carga las variables definidas en el archivo .env (API Keys, etc.)
load_dotenv()

# --- 2. Importación de Componentes de la App ---
# Importamos los módulos que acabamos de crear. Cada uno tiene una 
# responsabilidad única.
from app.routes import register_routes
from app.cli import iniciar_cli
from app.core import configurar_ia

# --- 3. Inicialización de la Aplicación ---

def create_app():
    """
    Fábrica de aplicaciones: Crea y configura la instancia de Flask.
    """
    app = Flask(__name__, template_folder='app/templates')

    # Configurar el logging para que no muestre los requests HTTP en la consola
    # y así mantener limpia la interfaz del CLI.
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    
    # Configura el motor de IA con las herramientas disponibles.
    # Esta función ahora vive en el "core" de nuestra aplicación.
    configurar_ia(app)
    
    # Registra los endpoints (ej: /whatsapp) definidos en app/routes.py
    register_routes(app)
    
    return app

# --- 4. Ejecución Principal ---

if __name__ == "__main__":
    # Crear la aplicación web usando nuestra fábrica
    app = create_app()

    print("🚀 Iniciando el Agente de McKenna Group...")
    
    # Iniciar la Interfaz de Línea de Comandos (CLI) en un hilo separado.
    # Esto permite que el menú y el servidor web funcionen al mismo tiempo.
    cli_thread = threading.Thread(target=iniciar_cli, daemon=True)
    cli_thread.start()
    
    # Iniciar el servidor Flask.
    # Se ejecuta en el puerto 8081 y es accesible desde la red local.
    # El `debug=False` es importante para producción, pero puede ser útil 
    # activarlo (`debug=True`) durante el desarrollo.
    app.run(host='0.0.0.0', port=8081, debug=False)

