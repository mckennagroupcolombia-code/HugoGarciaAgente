"""
Auditoría puntual: publicaciones activas de MeLi sin seller_custom_field (SKU),
cruzadas contra Google Sheets (columna A meli_id, columna B SKU) para proponer
el valor a cargar. NO escribe nada — solo reporta. La escritura real se hace
aparte con app.services.meli.actualizar_seller_custom_field_meli() por cada caso
ya revisado.

Uso: python3 scripts/auditar_sku_meli_faltantes.py
"""
import requests

from app.utils import refrescar_token_meli


def listar_items_activos(seller_id: int, headers: dict) -> list[str]:
    ids: list[str] = []
    offset = 0
    while True:
        r = requests.get(
            f"https://api.mercadolibre.com/users/{seller_id}/items/search",
            params={"status": "active", "limit": 100, "offset": offset},
            headers=headers,
            timeout=30,
        ).json()
        batch = r.get("results") or []
        if not batch:
            break
        ids.extend(batch)
        offset += len(batch)
        total = (r.get("paging") or {}).get("total", 0)
        if offset >= total:
            break
    return ids


def detalle_items(ids: list[str], headers: dict) -> list[dict]:
    out = []
    for i in range(0, len(ids), 20):
        lote = ids[i : i + 20]
        res = requests.get(
            f"https://api.mercadolibre.com/items?ids={','.join(lote)}",
            headers=headers,
            timeout=40,
        ).json()
        for r in res:
            if r.get("code") == 200:
                out.append(r["body"])
    return out


def main():
    token = refrescar_token_meli()
    if not token:
        print("No se pudo obtener token de MeLi.")
        return
    headers = {"Authorization": f"Bearer {token}"}

    me = requests.get("https://api.mercadolibre.com/users/me", headers=headers, timeout=15).json()
    seller_id = me.get("id")
    print(f"seller_id: {seller_id}")

    ids = listar_items_activos(seller_id, headers)
    print(f"Publicaciones activas: {len(ids)}")

    items = detalle_items(ids, headers)
    sin_sku = [it for it in items if not (it.get("seller_custom_field") or "").strip()]
    print(f"Sin seller_custom_field: {len(sin_sku)}")

    # Sheets: meli_id (col A) -> sku (col B)
    from app.services.google_services import _abrir_hoja

    sheet = _abrir_hoja()
    data = sheet.get_all_values()
    mapa_sheet: dict[str, tuple[str, str]] = {}
    for row in data[1:]:
        if len(row) < 4:
            continue
        meli_id = str(row[0]).strip().upper()
        sku = str(row[1]).strip()
        nombre = str(row[3]).strip()
        if meli_id and sku:
            mapa_sheet[meli_id] = (sku, nombre)

    encontrados = []
    no_encontrados = []
    for it in sin_sku:
        mid = str(it.get("id") or "").strip().upper()
        title = it.get("title") or ""
        if mid in mapa_sheet:
            sku, nombre_sheet = mapa_sheet[mid]
            encontrados.append((mid, title, sku, nombre_sheet))
        else:
            no_encontrados.append((mid, title))

    print(f"\n=== Con SKU encontrado en Sheets ({len(encontrados)}) ===")
    for mid, title, sku, nombre_sheet in encontrados:
        print(f"{mid} | SKU propuesto: {sku:20s} | MeLi: {title[:60]}")

    print(f"\n=== SIN match en Sheets por meli_id ({len(no_encontrados)}) ===")
    for mid, title in no_encontrados:
        print(f"{mid} | {title[:70]}")


if __name__ == "__main__":
    main()
