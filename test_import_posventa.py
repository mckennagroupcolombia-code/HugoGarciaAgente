import modulo_posventa
import sys

try:
    # Ejecutamos la función desactivada para ver su resultado
    resultado = modulo_posventa.automatizar_pedidos_rut(dias_atras=5)
    print("--- Resultado de la llamada a modulo_posventa.automatizar_pedidos_rut(5) ---")
    print(resultado)

except AttributeError:
    print("ERROR: La función 'automatizar_pedidos_rut' no fue encontrada en el módulo después de la importación.")
except Exception as e:
    print(f"ERROR FATAL al ejecutar el script: {e}")