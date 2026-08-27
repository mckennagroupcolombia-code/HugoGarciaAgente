"""
Corrige facturas Siigo de pedidos web (`emitir_factura_siigo_pedido_web`) que
salieron sin IVA discriminado: hasta el 27-ago-2026, `_build_siigo_web_invoice_lines`
mandaba el precio final del checkout (ya incluye IVA) a Siigo sin `taxes`, así
que la factura electrónica quedaba sin la línea de impuesto (no es duplicado
como el bug de astroselling — el total cobrado ya era correcto, solo faltaba
discriminar el 19%). Corregido de raíz en app/tools/web_pedidos.py y
app/services/siigo.py::precio_base_con_impuesto — este script es solo para
las facturas ya emitidas con el código viejo.

Uso:
    python3 scripts/corregir_iva_no_discriminado_web.py --ref MCKG-72176D3DB7 [--ref ...]
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

ORDERS_DB = REPO / "PAGINA_WEB" / "site" / "data" / "orders.db"


def corregir_ref(ref: str) -> dict:
    import requests
    from app.services.siigo import (
        autenticar_siigo,
        PARTNER_ID,
        buscar_producto_siigo_por_sku,
        buscar_nota_credito_existente_siigo,
        crear_nota_credito_siigo,
        crear_factura_venta_siigo,
        precio_base_con_impuesto,
    )
    from app.tools.web_pedidos import _update_invoice_state

    con = sqlite3.connect(ORDERS_DB)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM orders WHERE upper(reference) = ?", (ref.upper(),)).fetchone()
    con.close()
    if not row:
        return {"ok": False, "ref": ref, "error": "Pedido no encontrado en orders.db"}
    order = dict(row)
    factura_id = order.get("siigo_invoice_id")
    if not factura_id:
        return {"ok": False, "ref": ref, "error": "El pedido no tiene factura Siigo emitida."}

    token = autenticar_siigo()
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
    r = requests.get(f"https://api.siigo.com/v1/invoices/{factura_id}", headers=headers, timeout=15)
    if r.status_code != 200:
        return {"ok": False, "ref": ref, "error": f"GET factura {r.status_code}: {r.text[:300]}"}
    factura = r.json()

    if any(it.get("taxes") for it in factura.get("items", [])):
        return {"ok": False, "ref": ref, "error": "Esta factura ya tiene IVA discriminado en algún ítem — no se toca."}

    ya_existe = buscar_nota_credito_existente_siigo(factura_id)
    nc_ya_emitida = None
    if ya_existe:
        if "IVA no discriminado" not in (ya_existe.get("observations") or ""):
            return {"ok": False, "ref": ref, "error": f"Ya existe NC {ya_existe.get('name')} por otra causa — no se toca."}
        nc_ya_emitida = ya_existe

    total_original = factura["total"]
    pago_orig = (factura.get("payments") or [{}])[0]

    nc_items = [
        {"code": it["code"], "description": it["description"], "quantity": it.get("quantity", 1), "price": it["price"]}
        for it in factura["items"]
    ]

    if nc_ya_emitida:
        nc = {"ok": True, "number": nc_ya_emitida.get("number")}
    else:
        nc = crear_nota_credito_siigo(
            invoice_id=factura_id,
            items=nc_items,
            payments=[{"id": pago_orig.get("id"), "value": total_original}],
            reason=2,
            observaciones=f"Anulación por IVA no discriminado (pedido web) — reemplaza {factura.get('name')}. Ref {ref}.",
        )
        if not nc.get("ok"):
            return {"ok": False, "ref": ref, "error": f"Nota crédito falló: {nc.get('error')}"}

    nuevas_lineas = []
    for it in factura["items"]:
        prod = buscar_producto_siigo_por_sku(it["code"])
        tax_ids = (prod or {}).get("tax_ids") or []
        tax_rate = (prod or {}).get("tax_rate_total") or 0
        precio = precio_base_con_impuesto(it["price"], tax_rate) if tax_ids else it["price"]
        linea = {"codigo": it["code"], "nombre": it["description"], "cantidad": it.get("quantity", 1), "precio_unitario": precio}
        if tax_ids:
            linea["tax_ids"] = tax_ids
        nuevas_lineas.append((linea, tax_rate))

    from decimal import ROUND_HALF_UP, Decimal
    total_pago_nuevo = float(sum(
        (Decimal(str(l["precio_unitario"])) * Decimal(str(l["cantidad"])) * (Decimal("1") + Decimal(str(rate)) / Decimal("100"))).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        for l, rate in nuevas_lineas
    ))
    nuevas_lineas = [l for l, _rate in nuevas_lineas]

    customer = factura.get("customer") or {}
    cust_r = requests.get(f"https://api.siigo.com/v1/customers/{customer.get('id')}", headers=headers, timeout=15)
    cust_data = cust_r.json() if cust_r.status_code == 200 else {}
    nombre_cliente = " ".join(cust_data.get("name") or []).strip() or "Consumidor Final"
    direccion = (cust_data.get("address") or {}).get("address", "")
    email = ((cust_data.get("contacts") or [{}])[0]).get("email", "")
    telefono = ((cust_data.get("phones") or [{}])[0]).get("number", "")

    nueva = crear_factura_venta_siigo(
        nombre_cliente=nombre_cliente,
        identificacion=customer.get("identification"),
        direccion_envio=direccion,
        productos=nuevas_lineas,
        total=total_pago_nuevo,
        email=email,
        telefono=telefono,
        observaciones=f"Reemplaza {factura.get('name')} — corrección IVA no discriminado (pedido web). Ref {ref}.",
        purchase_order=factura.get("purchase_order") or ref,
        payment_id=pago_orig.get("id"),
    )
    if not nueva.get("ok"):
        return {"ok": False, "ref": ref, "error": f"Factura nueva falló (NC {nc.get('number')} ya emitida): {nueva.get('error')}", "nc_number": nc.get("number")}

    nuevo_total = (nueva.get("data") or {}).get("total")
    if nuevo_total is not None and abs(nuevo_total - total_original) > 1:
        return {
            "ok": False, "ref": ref,
            "error": f"Factura nueva quedó en {nuevo_total}, esperado ~{total_original} (NC {nc.get('number')} y factura {nueva.get('number')} ya emitidas — revisar a mano).",
            "nc_number": nc.get("number"), "nueva_numero": nueva.get("number"),
        }

    _update_invoice_state(
        ref,
        siigo_invoice_id=str(nueva.get("invoice_id") or ""),
        siigo_invoice_number=str(nueva.get("number") or ""),
        siigo_invoice_status=str(nueva.get("status") or "Accepted"),
        siigo_invoice_cufe=str(nueva.get("cufe") or ""),
    )

    return {
        "ok": True, "ref": ref,
        "factura_original": factura.get("name"),
        "nc_numero": nc.get("number"),
        "factura_nueva": nueva.get("number"),
        "total_original": total_original,
        "total_nuevo": nuevo_total,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", action="append", default=[], required=True)
    args = ap.parse_args()
    for ref in args.ref:
        import json
        print(json.dumps(corregir_ref(ref), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
