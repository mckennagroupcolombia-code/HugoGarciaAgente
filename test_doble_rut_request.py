from default_api import responder_solicitud_rut

order_id = "2000015703413240"
print(f"--- Iniciando Doble Intento para Order ID: {order_id} ---")

# Intento 1
print("Intentando enviar solicitud de RUT (Intento 1/2)...")
resultado1 = responder_solicitud_rut(order_id=order_id)
print(f"Resultado Intento 1: {resultado1}")

# Intento 2 (Doble Intento)
if "No se pudo enviar" in str(resultado1):
    print("El intento 1 falló. Iniciando Intento 2/2...")
    resultado2 = responder_solicitud_rut(order_id=order_id)
    print(f"Resultado Intento 2: {resultado2}")
else:
    print("El intento 1 fue exitoso. No es necesario el segundo intento.")

print("\n--- Doble Intento finalizado ---")