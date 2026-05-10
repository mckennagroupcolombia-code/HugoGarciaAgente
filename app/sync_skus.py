"""
Sincronización de SKUs entre MeLi (atributo SELLER_SKU) y Google Sheets (col B).
"""
import requests
from datetime import datetime

from app.utils import (
    refrescar_token_meli,
    enviar_whatsapp_reporte,
    jid_grupo_inventario_wa,
)
from app.services.google_services import _abrir_hoja


def _fetch_meli_seller_skus(token: str, item_ids: list) -> dict:
    """Retorna {item_id: seller_sku | None} leyendo el atributo SELLER_SKU en lotes de 20."""
    result = {}
    for i in range(0, len(item_ids), 20):
        batch = item_ids[i : i + 20]
        try:
            res = requests.get(
                "https://api.mercadolibre.com/items?ids="
                + ",".join(batch)
                + "&attributes=id,attributes",
                headers={"Authorization": f"Bearer {token}"},
                timeout=25,
            )
            res.raise_for_status()
            for item in res.json():
                body = item.get("body", {})
                mid = body.get("id", "")
                sku_val = None
                for a in body.get("attributes", []):
                    if a.get("id") == "SELLER_SKU":
                        sku_val = a.get("value_name")
                        break
                result[mid] = sku_val
        except Exception as e:
            print(f"⚠️  Error leyendo MeLi batch {i // 20 + 1}: {e}")
    return result


def sincronizar_skus_meli_sheets() -> str:
    """
    Lee el atributo SELLER_SKU de cada publicación MeLi y actualiza
    la columna B de Google Sheets donde el nuevo SKU tiene prefijo C-.
    Solo modifica filas cuyo SKU realmente cambió.
    """
    print("🔄 Sincronizando SKUs MeLi → Sheets…")
    token = refrescar_token_meli()
    if not token:
        return "✖ No se pudo obtener token de MeLi."

    sheet = _abrir_hoja()
    data = sheet.get_all_values()

    # Mapear MeLi ID → lista de filas (índice 1-based, saltando cabecera)
    id_to_rows: dict = {}
    for idx, row in enumerate(data[1:], 2):
        mid = str(row[0]).strip()
        if mid.startswith("MCO"):
            id_to_rows.setdefault(mid, []).append(idx)

    unique_ids = list(id_to_rows.keys())
    print(f"  IDs únicos en Sheets: {len(unique_ids)}")

    meli_skus = _fetch_meli_seller_skus(token, unique_ids)
    c_skus = {k: v for k, v in meli_skus.items() if v and str(v).startswith("C-")}
    print(f"  Publicaciones con SKU combo (C-): {len(c_skus)}")

    updates = []
    for mid, nuevo_sku in c_skus.items():
        for fila_idx in id_to_rows.get(mid, []):
            row = data[fila_idx - 1]
            sku_actual = str(row[1]).strip() if len(row) > 1 else ""
            if sku_actual != nuevo_sku:
                updates.append({"range": f"B{fila_idx}", "values": [[nuevo_sku]]})

    if not updates:
        msg = "✔ Sheets ya está al día — ningún SKU cambió."
        print(msg)
        return msg

    workbook = sheet.spreadsheet
    workbook.values_batch_update({
        "valueInputOption": "RAW",
        "data": [{"range": u["range"], "values": u["values"]} for u in updates],
    })

    msg = f"✔ SKUs actualizados: {len(updates)} filas sincronizadas ({len(c_skus)} publicaciones con combo)."
    print(msg)
    return msg


def reporte_skus_pendientes_wa() -> str:
    """
    Genera un informe de publicaciones MeLi sin SKU tipo combo (prefijo C-)
    y lo envía al grupo Sincronizacion_Inventario por WhatsApp.
    """
    print("📋 Generando reporte de SKUs pendientes…")
    token = refrescar_token_meli()
    if not token:
        return "✖ No se pudo obtener token de MeLi."

    sheet = _abrir_hoja()
    data = sheet.get_all_values()

    # Un registro por MCO ID único
    id_to_info: dict = {}
    for idx, row in enumerate(data[1:], 2):
        mid = str(row[0]).strip()
        if not mid.startswith("MCO") or mid in id_to_info:
            continue
        sku = str(row[1]).strip() if len(row) > 1 else ""
        nombre = str(row[3]).strip() if len(row) > 3 else ""
        id_to_info[mid] = {"sku": sku, "nombre": nombre}

    unique_ids = list(id_to_info.keys())
    print(f"  IDs únicos: {len(unique_ids)}")

    meli_skus = _fetch_meli_seller_skus(token, unique_ids)

    pendientes = []
    for mid, info in id_to_info.items():
        seller_sku = meli_skus.get(mid)
        if not seller_sku or not str(seller_sku).startswith("C-"):
            pendientes.append({
                "id": mid,
                "nombre": info["nombre"],
                "sku_sheets": info["sku"],
                "sku_meli": seller_sku or "—",
            })

    pendientes.sort(key=lambda x: x["nombre"].lower())

    fecha = datetime.now().strftime("%d/%m/%Y %H:%M")
    lineas = [
        f"📋 *Publicaciones MeLi sin SKU combo* — {fecha}",
        f"Total pendientes: *{len(pendientes)}* publicaciones sin migrar a combo SIIGO",
        "",
    ]
    for i, p in enumerate(pendientes, 1):
        nombre_corto = p["nombre"][:50] + ("…" if len(p["nombre"]) > 50 else "")
        lineas.append(f"{i}. *{nombre_corto}*")
        lineas.append(f"   ID: {p['id']}  |  SKU Sheets: {p['sku_sheets']}")

    lineas += [
        "",
        "_Para migrar: crear combo en SIIGO con prefijo C-, actualizar SKU en MeLi panel, "
        "luego ejecutar *Sincronizar SKUs MeLi→Sheets* desde el panel de operaciones._",
    ]

    mensaje = "\n".join(lineas)
    jid = jid_grupo_inventario_wa()
    ok = enviar_whatsapp_reporte(mensaje, numero_destino=jid)

    resultado = (
        f"✔ Reporte enviado a Sincronizacion_Inventario: {len(pendientes)} pendientes."
        if ok
        else f"✖ Fallo al enviar WA — {len(pendientes)} publicaciones pendientes identificadas."
    )
    print(resultado)
    return resultado
