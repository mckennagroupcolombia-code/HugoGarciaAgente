
# Script temporal para probar la función actualizada

# Mocking de las dependencias si es necesario, pero intentaremos ejecutar directamente
from modulo_posventa import automatizar_pedidos_rut

# --- MOCK DE DEPENDENCIAS CRÍTICAS (Si fallara la ejecución) ---
# En un entorno real, esto no sería necesario si el módulo es importable y el token es válido.
# Como no podemos realizar llamadas reales a ML aquí, el resultado será el reporte final si todo el flujo es exitoso.

try:
    resultado = automatizar_pedidos_rut(dias_atras=1) # Probamos con 1 día
    print("--- EJECUCIÓN EXITOSA DE automatizar_pedidos_rut ---")
    print(resultado)
except Exception as e:
    print(f"--- FALLO LA EJECUCIÓN DE LA FUNCIÓN ---")
    print(f"Error: {e}")

