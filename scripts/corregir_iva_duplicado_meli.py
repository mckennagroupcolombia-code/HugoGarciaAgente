"""
Corrige facturas Siigo de ventas MeLi emitidas por la integración externa
astroselling.com que llegaron con IVA duplicado: astroselling pasa el precio
final de MeLi (ya incluye IVA) como si fuera la base gravable, y Siigo le
suma 19% encima (ver app/data/... y docs/agentic/learned_context.md — bug
documentado desde ago-2026, recurrente porque la causa está fuera de este
repo, en la config de astroselling).

Uso:
    python3 scripts/corregir_iva_duplicado_meli.py --detectar --dias 10
    python3 scripts/corregir_iva_duplicado_meli.py --corregir --pack 2000014588977037 [--pack ...]
    python3 scripts/corregir_iva_duplicado_meli.py --corregir --dias 10   # corrige todo lo detectado

Solo corrige packs de UNA sola orden (n_orders == 1): en packs multi-orden
la contaminación puede afectar solo algunos ítems y requiere revisión manual
antes de tocar la factura DIAN.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

INDICE_PATH = REPO / "app" / "data" / "facturacion_meli_index.json"
TAX_ID_IVA_19 = 3118


def _leer_indice() -> dict:
    with open(INDICE_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)["indice"]


def _total_meli_pack(pack_id: str, *, headers: dict) -> tuple[float | None, int]:
    import requests

    rp = requests.get(f"https://api.mercadolibre.com/packs/{pack_id}", headers=headers, timeout=10)
    if rp.status_code == 200:
        orders = [o["id"] for o in rp.json().get("orders", [])]
    elif rp.status_code == 404:
        orders = [pack_id]
    else:
        return None, 0
    total = 0.0
    for oid in orders:
        ro = requests.get(f"https://api.mercadolibre.com/orders/{oid}", headers=headers, timeout=10)
        if ro.status_code != 200:
            return None, len(orders)
        total += ro.json().get("total_amount") or 0
    return total, len(orders)


def detectar(dias: int) -> list[dict]:
    from app.utils import refrescar_token_meli
    from datetime import datetime, timedelta

    idx = _leer_indice()
    desde = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    candidatos = [
        (pid, v) for pid, v in idx.items()
        if v.get("integracion") == "astroselling" and (v.get("factura_fecha") or "") >= desde
    ]

    token = refrescar_token_meli()
    if not token:
        print("No se pudo refrescar el token de MeLi.")
        return []
    headers = {"Authorization": f"Bearer {token}"}

    hallazgos = []
    for i, (pid, v) in enumerate(candidatos):
        total_meli, n_orders = _total_meli_pack(pid, headers=headers)
        if total_meli is None or not total_meli:
            continue
        total_factura = v.get("total") or 0
        ratio = total_factura / total_meli
        if 1.14 <= ratio <= 1.23:
            hallazgos.append({
                "pack_id": pid,
                "factura_id": v.get("factura_id"),
                "factura_numero": v.get("factura_numero"),
                "factura_fecha": v.get("factura_fecha"),
                "n_orders": n_orders,
                "total_meli": total_meli,
                "total_factura": total_factura,
                "ratio": ratio,
            })
        if i % 60 == 0:
            print(f"...revisando {i}/{len(candidatos)}", file=sys.stderr)
        time.sleep(0.02)
    return hallazgos


def _redondear_cop(valor) -> int:
    return int(Decimal(str(valor)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _precio_y_total_corregidos(total_meli: float, cantidad) -> tuple[float, float]:
    """Precio unitario (2 decimales) tal que precio*cantidad*1.19 caiga exacto
    en el total pagado — Siigo rechaza `invalid_total_payments` si el pago no
    coincide al centavo con lo que su motor de impuestos calcula a partir del
    precio (ver nota en docs/agentic/learned_context.md sobre redondeo con
    Decimal, no con round() de float)."""
    precio = (Decimal(str(total_meli)) / Decimal(str(cantidad)) / Decimal("1.19")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    total_calculado = (precio * Decimal(str(cantidad)) * Decimal("1.19")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return float(precio), float(total_calculado)


def corregir_pack(pack_id: str, *, dry_run: bool = False) -> dict:
    from app.services.siigo import (
        autenticar_siigo,
        PARTNER_ID,
        buscar_nota_credito_existente_siigo,
        crear_nota_credito_siigo,
        crear_factura_venta_siigo,
    )
    from app.services.meli import (
        eliminar_documentos_fiscales_meli,
        subir_factura_meli,
    )
    import requests

    idx = _leer_indice()
    entry = idx.get(pack_id)
    if not entry or not entry.get("factura_id"):
        return {"ok": False, "pack_id": pack_id, "error": "No hay factura indexada para ese pack."}

    token = autenticar_siigo()
    if not token:
        return {"ok": False, "pack_id": pack_id, "error": "No se pudo autenticar con Siigo."}
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}

    factura_id = entry["factura_id"]
    r = requests.get(f"https://api.siigo.com/v1/invoices/{factura_id}", headers=headers, timeout=15)
    if r.status_code != 200:
        return {"ok": False, "pack_id": pack_id, "error": f"GET factura {r.status_code}: {r.text[:300]}"}
    factura = r.json()

    if len(factura.get("items") or []) != 1:
        return {"ok": False, "pack_id": pack_id, "error": "Factura con más de un ítem — requiere revisión manual, no se corrige automático."}

    item_orig = factura["items"][0]
    precio_original = item_orig["price"]
    cantidad = item_orig.get("quantity", 1)
    total_original = factura["total"]

    from app.utils import refrescar_token_meli as _refrescar_meli
    total_meli, _n = _total_meli_pack(pack_id, headers={"Authorization": f"Bearer {_refrescar_meli()}"})
    if total_meli is None:
        return {"ok": False, "pack_id": pack_id, "error": "No se pudo obtener el total real de MeLi para este pack — no se corrige a ciegas."}
    if abs(precio_original * cantidad - total_meli) > 1:
        return {
            "ok": False, "pack_id": pack_id,
            "error": f"precio_original*cantidad ({precio_original * cantidad}) no coincide con lo pagado en MeLi ({total_meli}) — no es el patrón esperado, requiere revisión manual.",
        }

    ya_existe = buscar_nota_credito_existente_siigo(factura_id)
    nc_ya_emitida = None
    if ya_existe:
        obs = ya_existe.get("observations") or ""
        if "IVA duplicado" not in obs:
            return {"ok": False, "pack_id": pack_id, "error": f"Ya existe nota crédito {ya_existe.get('name')} para esta factura por otra causa — no se toca."}
        nc_ya_emitida = ya_existe

    precio_corregido, total_pago_nuevo = _precio_y_total_corregidos(total_meli, cantidad)

    if dry_run:
        return {
            "ok": True, "dry_run": True, "pack_id": pack_id,
            "factura_original": entry.get("factura_numero"),
            "precio_original": precio_original, "precio_corregido": precio_corregido,
            "total_original": total_original, "total_meli": total_meli,
            "total_pago_nuevo": total_pago_nuevo,
        }

    pago_orig = (factura.get("payments") or [{}])[0]

    if nc_ya_emitida:
        # Corrida anterior ya anuló la factura original pero no llegó a crear
        # la de reemplazo (ej. invalid_total_payments) — no volver a anular.
        nc = {"ok": True, "number": nc_ya_emitida.get("number")}
    else:
        # 1) Nota crédito anulando la factura original completa.
        nc = crear_nota_credito_siigo(
            invoice_id=factura_id,
            items=[{
                "code": item_orig["code"],
                "description": item_orig["description"],
                "quantity": cantidad,
                "price": precio_original,
                "tax_ids": [TAX_ID_IVA_19],
            }],
            payments=[{"id": pago_orig.get("id"), "value": total_original}],
            reason=2,
            observaciones=f"Anulación por IVA duplicado (astroselling) — reemplaza {entry.get('factura_numero')}. Pack MeLi #{pack_id}.",
        )
        if not nc.get("ok"):
            return {"ok": False, "pack_id": pack_id, "error": f"Nota crédito falló: {nc.get('error')}"}

    # 2) Factura nueva con el precio base correcto (MeLi ya incluye IVA).
    customer = factura.get("customer") or {}
    cust_id = customer.get("identification")
    cust_r = requests.get(f"https://api.siigo.com/v1/customers/{customer.get('id')}", headers=headers, timeout=15)
    cust_data = cust_r.json() if cust_r.status_code == 200 else {}
    nombre_cliente = " ".join(cust_data.get("name") or []).strip() or "Consumidor Final"
    direccion = (cust_data.get("address") or {}).get("address", "")
    email = ((cust_data.get("contacts") or [{}])[0]).get("email", "")
    telefono = ((cust_data.get("phones") or [{}])[0]).get("number", "")

    nueva = crear_factura_venta_siigo(
        nombre_cliente=nombre_cliente,
        identificacion=cust_id,
        direccion_envio=direccion,
        productos=[{
            "codigo": item_orig["code"],
            "nombre": item_orig["description"],
            "cantidad": cantidad,
            "precio_unitario": precio_corregido,
            "tax_ids": [TAX_ID_IVA_19],
        }],
        total=total_pago_nuevo,
        email=email,
        telefono=telefono,
        observaciones=f"Reemplaza {entry.get('factura_numero')} — corrección IVA duplicado (astroselling). Pack MeLi #{pack_id}.",
        purchase_order=(factura.get("purchase_order") or f"Mercado Libre #{pack_id}"),
        payment_id=pago_orig.get("id"),
    )
    if not nueva.get("ok"):
        return {"ok": False, "pack_id": pack_id, "error": f"Factura nueva falló (NC {nc.get('number')} ya emitida): {nueva.get('error')}", "nc_number": nc.get("number")}

    nuevo_total = (nueva.get("data") or {}).get("total")
    if nuevo_total is not None and abs(nuevo_total - total_meli) > 1:
        return {
            "ok": False, "pack_id": pack_id,
            "error": f"Factura nueva quedó en {nuevo_total}, esperado ~{total_meli} (NC {nc.get('number')} ya emitida, factura {nueva.get('number')} ya emitida — revisar a mano).",
            "nc_number": nc.get("number"), "nueva_numero": nueva.get("number"),
        }

    # 3) Reemplazar el documento fiscal en el pack de MeLi.
    ok_del, err_del = eliminar_documentos_fiscales_meli(pack_id)
    subida = None
    if ok_del and nueva.get("pdf_path"):
        import base64
        with open(nueva["pdf_path"], "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        subida = subir_factura_meli(pack_id, b64, formato="pdf", prefijo_archivo="Fac")

    return {
        "ok": True,
        "pack_id": pack_id,
        "factura_original": entry.get("factura_numero"),
        "nc_numero": nc.get("number"),
        "factura_nueva": nueva.get("number"),
        "total_original": total_original,
        "total_nuevo": nuevo_total,
        "meli_doc_reemplazado": bool(subida and str(subida).startswith("✅")) if subida else None,
        "meli_doc_msg": subida,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detectar", action="store_true")
    ap.add_argument("--corregir", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dias", type=int, default=10)
    ap.add_argument("--pack", action="append", default=[])
    args = ap.parse_args()

    if args.detectar:
        hallazgos = detectar(args.dias)
        print(json.dumps(hallazgos, indent=2, ensure_ascii=False))
        print(f"\nTotal detectados: {len(hallazgos)}")
        return

    if args.corregir:
        packs = args.pack
        if not packs:
            hallazgos = detectar(args.dias)
            packs = [h["pack_id"] for h in hallazgos if h["n_orders"] == 1]
        resultados = []
        for pid in packs:
            res = corregir_pack(pid, dry_run=args.dry_run)
            resultados.append(res)
            print(json.dumps(res, indent=2, ensure_ascii=False))
            time.sleep(0.3)
        out_path = Path("/tmp/claude-1000/-home-mckg-mi-agente/74a0aeb3-b0b0-4803-aba9-39072ed70b42/scratchpad/correccion_iva_resultados.json")
        json.dump(resultados, open(out_path, "w"), indent=2, ensure_ascii=False)
        return

    ap.print_help()


if __name__ == "__main__":
    main()
