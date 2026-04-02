"""
Estado compartido entre el servidor Flask (webhooks) y los hilos de la CLI.
Permite que un mensaje de WhatsApp desbloquee una operación en espera.
"""
import threading

# Facturas de compra esperando aprobación del grupo de WhatsApp.
# Formato: { "HAP11350": threading.Event() }
# El Event se activa (.set()) cuando llega "OK" del grupo.
# El valor booleano de aprobado se almacena en el mismo dict como {"HAP11350": {"event": Event, "aprobado": bool}}
eventos_aprobacion_facturas: dict = {}
