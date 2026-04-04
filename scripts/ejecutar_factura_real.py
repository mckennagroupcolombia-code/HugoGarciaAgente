from app.services.siigo import crear_factura_completa_siigo
import os

def generar_factura_real_prueba():
    # En este caso, solo probaremos la edición de una factura existente
    print("🚀 Editando la factura existente 64810...")
    
    from app.services.siigo import autenticar_siigo, editar_factura_siigo
    autenticar_siigo(forzar=True)

    # Factura ID de la 64810
    # Obtenemos el ID verdadero (puede que no sea 64810, el ID alfanumerico devuelto por SIIGO)
    import requests, json
    token = autenticar_siigo()
    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": "SiigoAPI",
    }
    # Buscar factura por numero
    res = requests.get("https://api.siigo.com/v1/invoices?number=64810", headers=headers)
    if res.status_code == 200 and len(res.json().get("results", [])) > 0:
        factura_id = res.json()["results"][0]["id"]
        print(f"✅ ID de factura encontrado: {factura_id}")
        
        # Payload con los datos actualizados
        # (Depende de lo que queramos corregir para que pase en la DIAN. En este caso el nombre, u otros campos)
        factura_data = {
             "document": {"id": 26670},
             "date": "2026-03-28", # Ajustar fecha a la correcta
             "customer": {
                 "identification": "3241821",
                 "id_type": "13",
                 "person_type": "Person",
                 "name": ["Victor Hugo Garcia Barrero", ""]
             },
             "seller": 150,
             "items": [
                 {
                     "code": "CTRK500g",
                     "description": "Citrato De Potasio 500 Gr",
                     "quantity": 1,
                     "price": 25000
                 }
             ],
             "payments": [
                 {
                     "id": 1333,
                     "value": 25000,
                     "due_date": "2026-03-28"
                 }
             ]
        }
        
        resultado = editar_factura_siigo(factura_id, factura_data)
        print(f"\n✅ Resultado: {resultado}")
    else:
        print("❌ No se encontro la factura 64810")

if __name__ == "__main__":
    generar_factura_real_prueba()
