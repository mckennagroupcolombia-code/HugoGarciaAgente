
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
load_dotenv()

# --- 2. Importación de Componentes de la App ---
from app.routes import register_routes
from app.cli import iniciar_cli
from app.core import configurar_ia

# --- 3. Inicialización de la Aplicación ---

def create_app():
    """Fábrica de aplicaciones: Crea y configura la instancia de Flask."""
    app = Flask(__name__, template_folder='templates')

    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)

    # REC-09: Rate limiting global
    try:
        from flask_limiter import Limiter
        from flask_limiter.util import get_remote_address
        limiter = Limiter(
            get_remote_address,
            app=app,
            default_limits=["300 per minute", "5000 per hour"],
            storage_uri="memory://",
        )
        # Límites estrictos en endpoints sensibles
        limiter.limit("30 per minute")(app.view_functions.get("chat") or (lambda: None))
        app.extensions["limiter"] = limiter
        print("✅ Rate limiting activo (300 req/min global)")
    except Exception as e:
        print(f"⚠️ Rate limiting no disponible: {e}")

    configurar_ia(app)
    register_routes(app)

    # Iniciar daemons de las nuevas funcionalidades
    try:
        from app.monitor import iniciar_monitor
        iniciar_monitor()
    except Exception as e:
        print(f"⚠️ Monitor global: {e}")

    try:
        from app.tools.seguimiento_postventa import iniciar_monitor_postventa
        iniciar_monitor_postventa()
    except Exception as e:
        print(f"⚠️ Monitor postventa: {e}")

    try:
        from app.tools.backup_drive import iniciar_backup_nocturno
        iniciar_backup_nocturno()
    except Exception as e:
        print(f"⚠️ Backup nocturno: {e}")

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

