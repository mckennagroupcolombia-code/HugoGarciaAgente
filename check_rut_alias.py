from modulo_posventa import automatizar_pedidos_rut

def ejecutar_escaneo_rut_3_dias():
    """Ejecuta la revisión de RUT solicitada por el usuario (3 días)."""
    DIAS = 3
    print(f"--- Hugo: Ejecutando chequeo de RUT para las últimas {DIAS} días. ---")
    
    # Llamada a la función centralizada
    reporte = automatizar_pedidos_rut(dias_atras=DIAS)
    
    print("--- Resumen de Ejecución ---")
    print(reporte)
    return reporte

if __name__ == "__main__":
    ejecutar_escaneo_rut_3_dias()