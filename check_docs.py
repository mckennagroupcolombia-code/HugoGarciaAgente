import requests
from app.services.siigo import autenticar_siigo, PARTNER_ID

token = autenticar_siigo(forzar=True)

headers = {
    "Authorization": f"Bearer {token}",
    "Partner-Id": PARTNER_ID,
    "Content-Type": "application/json"
}

# Try estimates endpoint
res = requests.get("https://api.siigo.com/v1/estimates", headers=headers)
print("Estimates:", res.text[:200])

# Just in case, try getting document types for Estimates
res2 = requests.get("https://api.siigo.com/v1/document-types?type=CT", headers=headers)
print("CT Docs:", res2.text[:200])

res3 = requests.get("https://api.siigo.com/v1/document-types?type=CC", headers=headers)
print("CC Docs:", res3.text[:200])
