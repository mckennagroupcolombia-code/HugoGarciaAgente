import requests
import json
from app.services.siigo import autenticar_siigo

def list_payment_types():
    token = autenticar_siigo()
    if not token:
        print("Error de autenticación.")
        return
        
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": "SiigoAPI"}
    res = requests.get("https://api.siigo.com/v1/payment-types?document_type=FV", headers=headers)
    if res.status_code == 200:
        data = res.json()
        print(json.dumps(data, indent=2))
    else:
        print(f"Error {res.status_code}: {res.text}")

if __name__ == "__main__":
    list_payment_types()
