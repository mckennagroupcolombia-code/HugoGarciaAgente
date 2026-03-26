from default_api import responder_solicitud_rut
import json

order_id = "2000015703413240"
print(f"--- Ejecutando prueba de solicitud de RUT para {order_id} ---")
try:
    resultado = responder_solicitud_rut(order_id=order_id)
    print("Resultado de la ejecución:")
    print(resultado)
except Exception as e:
    print(f"Error al llamar a la función: {e}")