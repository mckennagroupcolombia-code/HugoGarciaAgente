import requests
import json
from app.services.siigo import autenticar_siigo, PARTNER_ID

token = autenticar_siigo()
headers = {
    "Authorization": f"Bearer {token}",
    "Partner-Id": PARTNER_ID,
    "Content-Type": "application/json"
}

# The siigo document-types endpoint usually needs a parameter like `FV`, `FC`, `RC`, `NC`, `ND`, `CC`.
types = ["FV", "FC", "RC", "NC", "ND", "CC", "RC", "CP", "CT", "PT"]
found = []

for t in types:
    res = requests.get(f"https://api.siigo.com/v1/document-types?type={t}", headers=headers)
    if res.status_code == 200:
        docs = res.json()
        for doc in docs:
            print(f"[{t}] ID: {doc.get('id')} - Name: {doc.get('name')}")
            
print("Done")
