
import time

# --- Importaciones de Lógica de Negocio ---
# Estas funciones ahora viven en sus propios módulos, bien organizadas.
from app.sync import (
    sincronizar_inteligente,
    sincronizar_facturas_recientes,
    ejecutar_sincronizacion_y_reporte,
    sincronizar_manual_por_id,
    sincronizar_por_dia_especifico
)
from app.services.google_services import leer_datos_hoja
from app.services.meli import aprender_de_interacciones_meli

# --- Importación del Cerebro de la IA ---
# El núcleo que procesa el lenguaje natural.
# TODO: La función `obtener_respuesta_ia` debe ser refactorizada y movida a `app/core.py`.
from agente_pro import obtener_respuesta_ia


def mostrar_menu():
    """Imprime el menú principal de opciones en la consola."""
    print("\n" + "═"*45)
    print("🛠️  CENTRO DE MANDO MCKENNA GROUP S.A.S.")
    print("═"*45)
    print("1. 💬 [CHAT] Modo conversación con el Agente (IA)")
    print("2. 🧠 [SYNC] Inteligente (Pendientes de MeLi vs Siigo)")
    print("3. 📦 [SYNC] Facturas Recientes (Último día)")
    print("4. 📦 [SYNC] Facturas Recientes (Últimos 10 días)")
    print("5. 📊 [TOTAL] Sincronización Completa y Reporte de Stock")
    print("6. 🔍 [DATA] Consultar Producto en Google Sheets")
    print("7. 🛠️  [MANUAL] Sincronizar por Pack ID Específico")
    print("8. 🎓 [IA] Forzar Aprendizaje de Interacciones de MeLi")
    print("9. 📅 [FECHA] Sincronizar Facturas por Día Específico")
    print("10. 🚪 [EXIT] Salir del Centro de Mando")
    print("═"*45)

def iniciar_cli():
    """
    Bucle principal de la Interfaz de Línea de Comandos (CLI).
    Gestiona la navegación del usuario y ejecuta las tareas correspondientes.
    """
    # Pequeña pausa para asegurar que el servidor Flask (si se ejecuta en paralelo) inicie primero.
    time.sleep(2)
    
    while True:
        mostrar_menu()
        opcion = input("Seleccione una opción (1-10): ")

        if opcion == "1":
            print("\n--- 💬 MODO CHAT ACTIVADO (Escribe 'salir' o 'menu' para volver) ---")
            sesion_historial = [] # El historial se reinicia cada vez que se entra al modo chat.
            while True:
                user_input = input("👤 Tú: ")
                if user_input.lower() in ["salir", "exit", "menu", "volver"]:
                    print("--- 🔙 Volviendo al menú principal ---\n")
                    break
                
                # Llama a la función central de IA para obtener una respuesta.
                respuesta, nuevo_historial = obtener_respuesta_ia(
                    pregunta=user_input, 
                    usuario_id="usuario_terminal_cli", 
                    historial=sesion_historial
                )
                
                if nuevo_historial:
                    sesion_historial = nuevo_historial
                
                print(f"\n🤖 Agente: {respuesta}\n")

        elif opcion == "2":
            print(sincronizar_inteligente())
        elif opcion == "3":
            print(sincronizar_facturas_recientes(dias=1))
        elif opcion == "4":
            print(sincronizar_facturas_recientes(dias=10))
        elif opcion == "5":
            print(ejecutar_sincronizacion_y_reporte())
        elif opcion == "6":
            producto = input("🔍 Ingrese el nombre del producto a buscar: ")
            print(leer_datos_hoja(producto))
        elif opcion == "7":
            pack_id = input("📝 Ingrese el Pack ID que desea sincronizar: ")
            print(sincronizar_manual_por_id(pack_id))
        elif opcion == "8":
            print(aprender_de_interacciones_meli())
        elif opcion == "9":
            fecha = input("📅 Ingrese la fecha (formato AAAA-MM-DD): ")
            print(sincronizar_por_dia_especifico(fecha))
        elif opcion == "10":
            print("👋 Apagando el Centro de Mando...")
            break
        else:
            print("❌ Opción no válida. Por favor, intente de nuevo.")

