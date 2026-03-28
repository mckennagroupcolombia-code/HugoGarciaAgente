import requests
import json
from app.services.siigo import autenticar_siigo, PARTNER_ID

token = autenticar_siigo()

headers = {
    "Authorization": f"Bearer {token}",
    "Partner-Id": PARTNER_ID,
    "Content-Type": "application/json"
}

# The endpoint might be /v1/invoices but we pass a specific document id
# Let's list all invoices to see if there's any hint of estimates
print("Testing /v1/proforma-invoices")
res = requests.get("https://api.siigo.com/v1/proforma-invoices", headers=headers)
print(res.status_code, res.text)

print("Testing /v1/quotes")
res = requests.get("https://api.siigo.com/v1/quotes", headers=headers)
print(res.status_code, res.text)

print("Testing /v1/orders")
res = requests.get("https://api.siigo.com/v1/orders", headers=headers)
print(res.status_code, res.text)
