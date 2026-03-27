import sqlite3
import os

def check_database_and_table():
    """
    Verifica la conexión a la base de datos y la existencia de la tabla 'facturas'.
    """
    db_file = "mckenna_business.db"
    table_name = "facturas"

    if not os.path.exists(db_file):
        print(f"🛑 Error: El archivo de la base de datos '{db_file}' no fue encontrado.")
        return

    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        print(f"✅ Conexión exitosa a la base de datos '{db_file}'.")

        cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
        
        if cursor.fetchone():
            print(f"✅ La tabla '{table_name}' existe en la base de datos.")
        else:
            print(f"🛑 Error: La tabla '{table_name}' NO existe en la base de datos.")

    except sqlite3.Error as e:
        print(f"🛑 Error de SQLite: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()
            print("✅ Conexión a la base de datos cerrada.")

if __name__ == "__main__":
    print("--- Iniciando verificación de la base de datos ---")
    check_database_and_table()
    print("--- Verificación de la base de datos finalizada ---")
