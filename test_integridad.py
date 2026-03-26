import herramientas_agente
import os

# Limpiar archivos viejos si existen de pruebas anteriores
if 'test_autonomia.py' in os.listdir('.'):
    os.remove('test_autonomia.py')
if 'test_final.py' in os.listdir('.'):
    os.remove('test_final.py')
    
resultado, fallos = herramientas_agente.verificar_integridad_sistema()

print(f"\n--- RESUMEN FINAL ---")
print(f"Verificación exitosa: {resultado}")
if fallos:
    print(f"Archivos problemáticos: {fallos}")