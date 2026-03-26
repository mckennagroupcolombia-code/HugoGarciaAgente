import os
try:
    os.remove('leer_reporte.py')
    print("✅ leer_reporte.py eliminado.")
except FileNotFoundError:
    print("⚠️ leer_reporte.py no encontrado.")