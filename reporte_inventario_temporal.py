
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

# Usar el módulo interno del agente para leer la hoja
from app.sheets_utils import get_sheet_data

data = get_sheet_data()

print(f"TOTAL FILAS: {len(data)}")

disponibles = []
agotados = []

for row in data:
    # Normalizar claves
    nombre = (row.get("Nombre") or row.get("nombre") or row.get("NOMBRE") or
              row.get("Product") or row.get("product") or "").strip()
    sku    = (row.get("SKU") or row.get("sku") or row.get("Ref") or
              row.get("REF") or "").strip()
    stock_raw = (row.get("Stock") or row.get("stock") or row.get("STOCK") or
                 row.get("Cantidad") or row.get("cantidad") or "0")
    precio = (row.get("Precio") or row.get("precio") or row.get("PRECIO") or 0)

    try:
        stock_n = int(str(stock_raw).replace(",","").replace(".","").strip() or 0)
    except:
        stock_n = 0

    if nombre:
        e = {"nombre": nombre, "sku": sku, "stock": stock_n, "precio": precio}
        if stock_n > 0:
            disponibles.append(e)
        else:
            agotados.append(e)

resultado = {
    "total": len(data),
    "disponibles": disponibles,
    "agotados": agotados
}
print(json.dumps(resultado, ensure_ascii=False, indent=2))
