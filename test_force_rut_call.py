
from modulo_posventa import automatizar_pedidos_rut
import sys

print("--- EJECUTANDO: automatizar_pedidos_rut(dias_atras=5) ---")

try:
    resultado = automatizar_pedidos_rut(dias_atras=5)
    print("--- REPORTE DE EJECUCIÓN ---")
    print(resultado)
except Exception as e:
    print(f"--- ERROR FATAL AL EJECUTAR FUNCIÓN ---")
    print(f"Error: {e}", file=sys.stderr)

