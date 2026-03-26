import importlib
import modulo_posventa

print("--- Estado antes de recargar ---")
print(f"ID de la función antes: {id(modulo_posventa.automatizar_pedidos_rut)}")

# Ejecución de la instrucción solicitada
importlib.reload(modulo_posventa)

print("\n--- Estado después de recargar ---")
print(f"ID de la función después: {id(modulo_posventa.automatizar_pedidos_rut)}")
print("Resultado de la llamada después de recargar:")
print(modulo_posventa.automatizar_pedidos_rut(dias_atras=5))