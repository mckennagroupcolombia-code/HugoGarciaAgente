import importlib
import modulo_posventa
import sys

print("--- Estado inicial de la función ---")
print(modulo_posventa.automatizar_pedidos_rut(dias_atras=5))

# Intentamos recargar el módulo
print("\n--- Intentando recargar modulo_posventa con importlib ---")
importlib.reload(modulo_posventa)

# Verificamos el estado después de la recarga
print("\n--- Estado final de la función después de la recarga ---")
print(modulo_posventa.automatizar_pedidos_rut(dias_atras=5))