import os
try:
    os.remove('temp_ejecutar_rut_auto.py')
    print("✅ temp_ejecutar_rut_auto.py eliminado.")
except FileNotFoundError:
    print("⚠️ temp_ejecutar_rut_auto.py no encontrado.")