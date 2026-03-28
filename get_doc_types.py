import os, sys, requests
from app.services.siigo import autenticar_siigo
token = autenticar_siigo()
headers = {'Authorization': f'Bearer {token}', 'Partner-Id': 'MCKGAgente'}
res = requests.get("https://api.siigo.com/v1/document-types", headers=headers)
for doc in res.json():
    print(f"{doc.get('type')}: {doc.get('id')} - {doc.get('name')}")
