"""
Corrige facturas Siigo de ventas MeLi (integración astroselling.com) con IVA
duplicado, **incluyendo packs multi-ítem donde solo algunos ítems quedaron
contaminados** (no todo el pack): astroselling a veces toma el precio final
de MeLi (ya con IVA) como base de UN ítem del pedido y le suma 19% encima,
mientras el resto de ítems del mismo pack/factura sale bien.

A diferencia de scripts/corregir_iva_duplicado_meli.py (solo packs de un
ítem), este cruza cada línea de la factura Siigo contra el ítem de MeLi que
le corresponde (por SKU) y corrige SOLO las líneas duplicadas, dejando las
que ya estaban bien intactas.

Uso:
    python3 scripts/corregir_iva_duplicado_meli_v2.py --detectar --dias 30
    python3 scripts/corregir_iva_duplicado_meli_v2.py --corregir --pack <pack_id> [--pack ...]
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

TAX_ID_IVA_19 = 3118
TASA_IVA = Decimal("1.19")


def _redondear(valor) -> float:
    return float(Decimal(str(valor)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _construir_indice_vivo(dias: int) -> dict[str, dict]:
    """Índice pack_id -> factura Siigo vigente (mayor `number`), SIN filtrar
    por integración astroselling — una factura de reemplazo nuestra no
    menciona "astroselling" en `observations` y quedaría excluida si se
    filtra (bug real encontrado el 28-ago-2026 en la primera versión de
    este barrido)."""
    import requests
    from datetime import datetime, timedelta
    from app.services.siigo import autenticar_siigo, PARTNER_ID
    from app.services.conciliacion_meli import _RE_PACK, _numero_factura_ordenable

    token = autenticar_siigo()
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
    desde = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    hasta = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    todas = []
    page = 1
    while True:
        r = requests.get(
            "https://api.siigo.com/v1/invoices", headers=headers,
            params={"created_start": desde, "created_end": hasta, "page_size": 100, "page": page},
            timeout=25,
        )
        if r.status_code != 200:
            break
        data = r.json()
        todas.extend(data.get("results", []))
        total = (data.get("pagination") or {}).get("total_results", 0)
        if page * 100 >= total:
            break
        page += 1

    indice: dict[str, dict] = {}
    numeros: dict[str, int] = {}
    for f in todas:
        texto = f"{f.get('observations', '')} {f.get('purchase_order', '')}"
        m = _RE_PACK.search(texto)
        if not m:
            continue
        pack_id = m.group(1)
        numero = _numero_factura_ordenable(f)
        if pack_id in numeros and numero <= numeros[pack_id]:
            continue
        numeros[pack_id] = numero
        indice[pack_id] = f
    return indice


def _items_meli_pack(pack_id: str, headers: dict) -> list[dict] | None:
    """Lista de {sku, precio, cantidad} de todos los ítems de todas las
    órdenes del pack (una orden = un ítem normalmente, pero puede haber
    más de una unidad)."""
    import requests

    rp = requests.get(f"https://api.mercadolibre.com/packs/{pack_id}", headers=headers, timeout=15)
    if rp.status_code == 200:
        order_ids = [o["id"] for o in rp.json().get("orders", [])]
    elif rp.status_code == 404:
        order_ids = [pack_id]
    else:
        return None

    items = []
    for oid in order_ids:
        ro = requests.get(f"https://api.mercadolibre.com/orders/{oid}", headers=headers, timeout=15)
        if ro.status_code != 200:
            return None
        for it in ro.json().get("order_items", []):
            item = it.get("item", {})
            sku = item.get("seller_sku") or item.get("seller_custom_field") or ""
            items.append({
                "sku": sku,
                "precio": it.get("unit_price") or 0,
                "cantidad": it.get("quantity") or 1,
                "order_id": oid,
            })
    return items


def _normalizar_sku(sku: str) -> str:
    """Quita un prefijo de una letra + guion (ej. "D-" vs "C-"): mismo
    producto, código Siigo viejo/inactivo vs el vigente en MeLi hoy — se ve
    en pedidos de meses atrás (28-ago-2026: ~28 packs "raros" resultaron ser
    solo esto, no una discrepancia real)."""
    import re as _re
    return _re.sub(r"^[A-Za-z]-", "", sku or "")


def analizar_pack(pack_id: str, factura: dict, headers_meli: dict) -> dict:
    """Compara cada línea de la factura Siigo contra el/los ítem(s) MeLi que
    le corresponden (por SKU, con fallback a SKU normalizado para códigos
    Siigo viejos) y clasifica: 'ok' (ya correcto), 'duplicado' (precio*1.19
    de más, corregible), 'raro' (no cuadra con ningún patrón conocido — no
    se toca)."""
    meli_items = _items_meli_pack(pack_id, headers_meli)
    if meli_items is None:
        return {"ok": False, "error": "No se pudo leer MeLi para este pack."}

    meli_por_sku: dict[str, list[dict]] = {}
    meli_por_sku_norm: dict[str, list[dict]] = {}
    for mi in meli_items:
        meli_por_sku.setdefault(mi["sku"], []).append(mi)
        meli_por_sku_norm.setdefault(_normalizar_sku(mi["sku"]), []).append(mi)

    total_meli = sum(mi["precio"] * mi["cantidad"] for mi in meli_items)
    lineas = []
    for it in factura.get("items", []):
        sku = it["code"]
        candidatos = meli_por_sku.get(sku) or meli_por_sku_norm.get(_normalizar_sku(sku)) or []
        if not candidatos:
            lineas.append({"sku": sku, "estado": "raro", "detalle": "0 candidatos MeLi para este SKU (ni exacto ni normalizado)"})
            continue
        cantidad_meli = sum(mi["cantidad"] for mi in candidatos)
        if cantidad_meli != it.get("quantity", 1):
            lineas.append({"sku": sku, "estado": "raro", "detalle": f"cantidad factura ({it.get('quantity')}) != cantidad MeLi ({cantidad_meli})"})
            continue
        esperado = sum(mi["precio"] * mi["cantidad"] for mi in candidatos)
        actual = it["total"]
        if esperado == 0:
            lineas.append({"sku": sku, "estado": "raro", "detalle": "precio MeLi en 0"})
            continue
        ratio = actual / esperado
        if 0.97 <= ratio <= 1.03:
            lineas.append({"sku": sku, "estado": "ok", "item": it, "meli": {"precio": esperado / cantidad_meli, "cantidad": cantidad_meli}})
        elif 1.14 <= ratio <= 1.23:
            lineas.append({"sku": sku, "estado": "duplicado", "item": it, "meli": {"precio": esperado / cantidad_meli, "cantidad": cantidad_meli}, "esperado": esperado})
        else:
            lineas.append({"sku": sku, "estado": "raro", "detalle": f"ratio {ratio:.3f} no reconocido", "item": it, "meli": {"precio": esperado / cantidad_meli, "cantidad": cantidad_meli}})

    n_dup = sum(1 for l in lineas if l["estado"] == "duplicado")
    n_raro = sum(1 for l in lineas if l["estado"] == "raro")
    return {
        "ok": True, "pack_id": pack_id, "factura_numero": factura.get("name"),
        "total_factura": factura.get("total"), "total_meli": total_meli,
        "lineas": lineas, "n_duplicados": n_dup, "n_raros": n_raro,
    }


def corregir_pack(pack_id: str, factura: dict, headers_meli: dict, *, dry_run: bool = False, mapa_codigos: dict[str, str] | None = None) -> dict:
    """`mapa_codigos`: {codigo_inactivo: codigo_activo_equivalente} — Siigo
    rechaza crear notas crédito/facturas referenciando un producto inactivo
    (`parameter_inactive`); para códigos viejos (ej. prefijo "D-" reemplazado
    por "C-" del mismo producto) se sustituye por su equivalente activo en
    vez de reactivar el maestro de productos (evita tocar combos con
    componentes internos en producción)."""
    mapa_codigos = mapa_codigos or {}
    from app.services.siigo import (
        autenticar_siigo, PARTNER_ID, buscar_nota_credito_existente_siigo,
        crear_nota_credito_siigo, crear_factura_venta_siigo,
    )

    analisis = analizar_pack(pack_id, factura, headers_meli)
    if not analisis.get("ok"):
        return {"ok": False, "pack_id": pack_id, "error": analisis.get("error")}
    if analisis["n_raros"] > 0:
        return {"ok": False, "pack_id": pack_id, "error": "Tiene líneas 'raras' (no reconciliables) — requiere revisión manual.", "analisis": analisis}
    if analisis["n_duplicados"] == 0:
        return {"ok": False, "pack_id": pack_id, "error": "No se detectó IVA duplicado en ninguna línea — no se toca."}

    factura_id = factura["id"]
    ya_existe = buscar_nota_credito_existente_siigo(factura_id)
    nc_ya_emitida = None
    if ya_existe:
        if "IVA duplicado" not in (ya_existe.get("observations") or ""):
            return {"ok": False, "pack_id": pack_id, "error": f"Ya existe NC {ya_existe.get('name')} por otra causa — no se toca."}
        nc_ya_emitida = ya_existe

    if dry_run:
        nuevas = []
        for l in analisis["lineas"]:
            it = l["item"]
            if l["estado"] == "duplicado":
                cantidad = it.get("quantity", 1)
                base = _redondear(Decimal(str(l["esperado"])) / TASA_IVA / Decimal(str(cantidad)))
                nuevas.append({"sku": l["sku"], "precio_nuevo": base, "estado": "corregido"})
            else:
                nuevas.append({"sku": l["sku"], "precio_nuevo": it["price"], "estado": "sin_cambio"})
        return {"ok": True, "dry_run": True, "pack_id": pack_id, "lineas": nuevas, "total_meli": analisis["total_meli"], "total_factura": analisis["total_factura"]}

    total_original = factura["total"]
    pago_orig = (factura.get("payments") or [{}])[0]

    nc_items = [
        {
            "code": mapa_codigos.get(it["code"], it["code"]), "description": it["description"], "quantity": it.get("quantity", 1),
            "price": it["price"], "tax_ids": [t["id"] for t in (it.get("taxes") or [])],
        }
        for it in factura["items"]
    ]

    if nc_ya_emitida:
        nc = {"ok": True, "number": nc_ya_emitida.get("number")}
    else:
        nc = crear_nota_credito_siigo(
            invoice_id=factura_id, items=nc_items,
            payments=[{"id": pago_orig.get("id"), "value": total_original}],
            reason=2,
            observaciones=f"Anulación por IVA duplicado (astroselling, parcial) — reemplaza {factura.get('name')}. Venta Mercado Libre #{pack_id}.",
        )
        if not nc.get("ok"):
            return {"ok": False, "pack_id": pack_id, "error": f"Nota crédito falló: {nc.get('error')}"}

    lineas_nuevas = []
    for l in analisis["lineas"]:
        it = l["item"]
        tax_ids_orig = [t["id"] for t in (it.get("taxes") or [])]
        codigo = mapa_codigos.get(it["code"], it["code"])
        if l["estado"] == "duplicado":
            cantidad = it.get("quantity", 1)
            base = _redondear(Decimal(str(l["esperado"])) / TASA_IVA / Decimal(str(cantidad)))
            linea = {"codigo": codigo, "nombre": it["description"], "cantidad": cantidad, "precio_unitario": base}
            if tax_ids_orig:
                linea["tax_ids"] = tax_ids_orig
            lineas_nuevas.append((linea, TASA_IVA - 1 if tax_ids_orig else Decimal("0")))
        else:
            linea = {"codigo": codigo, "nombre": it["description"], "cantidad": it.get("quantity", 1), "precio_unitario": it["price"]}
            if tax_ids_orig:
                linea["tax_ids"] = tax_ids_orig
            rate = sum(Decimal(str(t.get("percentage") or 0)) for t in (it.get("taxes") or [])) / Decimal("100")
            lineas_nuevas.append((linea, rate))

    total_pago_nuevo = float(sum(
        (Decimal(str(l["precio_unitario"])) * Decimal(str(l["cantidad"])) * (Decimal("1") + rate)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        for l, rate in lineas_nuevas
    ))
    lineas_nuevas = [l for l, _r in lineas_nuevas]

    import requests
    from app.services.siigo import autenticar_siigo as _auth, PARTNER_ID as _pid
    token = _auth()
    hh = {"Authorization": f"Bearer {token}", "Partner-Id": _pid}
    customer = factura.get("customer") or {}
    cust_r = requests.get(f"https://api.siigo.com/v1/customers/{customer.get('id')}", headers=hh, timeout=15)
    cust_data = cust_r.json() if cust_r.status_code == 200 else {}
    nombre_cliente = " ".join(cust_data.get("name") or []).strip() or "Consumidor Final"
    direccion = (cust_data.get("address") or {}).get("address", "")
    email = ((cust_data.get("contacts") or [{}])[0]).get("email", "")
    telefono = ((cust_data.get("phones") or [{}])[0]).get("number", "")

    nueva = crear_factura_venta_siigo(
        nombre_cliente=nombre_cliente,
        identificacion=customer.get("identification"),
        direccion_envio=direccion,
        productos=lineas_nuevas,
        total=total_pago_nuevo,
        email=email,
        telefono=telefono,
        observaciones=f"Reemplaza {factura.get('name')} — corrección IVA duplicado parcial (astroselling). Venta Mercado Libre #{pack_id}.",
        purchase_order=factura.get("purchase_order") or f"Mercado Libre #{pack_id}",
        payment_id=pago_orig.get("id"),
    )
    if not nueva.get("ok"):
        return {"ok": False, "pack_id": pack_id, "error": f"Factura nueva falló (NC {nc.get('number')} ya emitida): {nueva.get('error')}", "nc_number": nc.get("number")}

    nuevo_total = (nueva.get("data") or {}).get("total")
    if nuevo_total is not None and abs(nuevo_total - analisis["total_meli"]) > 1:
        return {
            "ok": False, "pack_id": pack_id,
            "error": f"Factura nueva quedó en {nuevo_total}, esperado ~{analisis['total_meli']} (NC {nc.get('number')} y factura {nueva.get('number')} ya emitidas — revisar a mano).",
            "nc_number": nc.get("number"), "nueva_numero": nueva.get("number"),
        }

    return {
        "ok": True, "pack_id": pack_id,
        "factura_original": factura.get("name"), "nc_numero": nc.get("number"),
        "factura_nueva": nueva.get("number"), "total_original": total_original, "total_nuevo": nuevo_total,
        "n_lineas_corregidas": analisis["n_duplicados"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detectar", action="store_true")
    ap.add_argument("--corregir", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dias", type=int, default=30)
    ap.add_argument("--pack", action="append", default=[])
    args = ap.parse_args()

    from app.utils import refrescar_token_meli
    token_meli = refrescar_token_meli()
    headers_meli = {"Authorization": f"Bearer {token_meli}"}

    indice = _construir_indice_vivo(args.dias)
    print(f"Packs MeLi vigentes en el rango: {len(indice)}", file=sys.stderr)

    if args.detectar:
        hallazgos = []
        for i, (pid, f) in enumerate(indice.items()):
            if i % 60 == 0:
                print(f"...{i}/{len(indice)}", file=sys.stderr)
            analisis = analizar_pack(pid, f, headers_meli)
            if analisis.get("ok") and (analisis["n_duplicados"] > 0 or analisis["n_raros"] > 0):
                hallazgos.append(analisis)
            time.sleep(0.02)
        print(json.dumps(hallazgos, indent=2, ensure_ascii=False, default=str))
        print(f"\nTotal con problema: {len(hallazgos)}", file=sys.stderr)
        return

    if args.corregir:
        packs = args.pack or list(indice.keys())
        resultados = []
        for pid in packs:
            f = indice.get(pid)
            if not f:
                resultados.append({"ok": False, "pack_id": pid, "error": "No está en el índice vivo del rango pedido."})
                continue
            res = corregir_pack(pid, f, headers_meli, dry_run=args.dry_run)
            resultados.append(res)
            print(json.dumps(res, indent=2, ensure_ascii=False, default=str))
            time.sleep(0.3)
        out = Path("/tmp/claude-1000/-home-mckg-mi-agente/74a0aeb3-b0b0-4803-aba9-39072ed70b42/scratchpad/correccion_v2_resultados.json")
        json.dump(resultados, open(out, "w"), indent=2, ensure_ascii=False, default=str)
        return

    ap.print_help()


if __name__ == "__main__":
    main()
