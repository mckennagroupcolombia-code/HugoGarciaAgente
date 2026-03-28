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

response = requests.get("https://api.siigo.com/v1/document-types?type=FC", headers=headers)
print("Tipos de Comprobante FC:")
for doc in response.json():
    print(f"ID: {doc.get('id')} - Nombre: {doc.get('name')} - Descripción: {doc.get('description')}")
