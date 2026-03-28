import os
import sys
import requests

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.siigo import autenticar_siigo

token = autenticar_siigo()
if not token:
    print("No se pudo obtener el token")
    sys.exit(1)

headers = {
    'Authorization': f'Bearer {token}',
    'Partner-Id': 'MCKGAgente',
    'Content-Type': 'application/json'
}

response = requests.get("https://api.siigo.com/v1/products?page_size=10", headers=headers)
print("Productos:")
for prod in response.json().get("results", []):
    print(f"Code: {prod.get('code')} - Nombre: {prod.get('name')}")
