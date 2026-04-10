"""Prueba rápida del bridge :3000 (no empieza con test_ para no chocar con .gitignore)."""
import requests

url = "http://127.0.0.1:3000/enviar"
data = {
    "numero": "120363407538342427@g.us",
    "mensaje": "Prueba de conexión McKenna: OK",
}

try:
    print("Enviando prueba...")
    res = requests.post(url, json=data, timeout=10)
    print(f"Status: {res.status_code}")
    print(f"Respuesta: {res.text}")
except Exception as e:
    print(f"Error de conexión: {e}")
