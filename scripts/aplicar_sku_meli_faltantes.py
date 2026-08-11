"""
Aplica en lote el SKU (seller_custom_field) a publicaciones activas de MeLi que
no lo tienen, cruzando por meli_id contra Google Sheets (columna A meli_id,
columna B SKU). Solo toca publicaciones con match exacto — las que no tienen
match en Sheets se listan aparte y NO se tocan (requieren revisión manual).

Uso: python3 -m scripts.aplicar_sku_meli_faltantes
"""
import time

from app.services.meli import actualizar_seller_custom_field_meli
from scripts.auditar_sku_meli_faltantes import (
    detalle_items,
    listar_items_activos,
)


def main():
    from app.utils import refrescar_token_meli
    import requests

    token = refrescar_token_meli()
    if not token:
        print("No se pudo obtener token de MeLi.")
        return
    headers = {"Authorization": f"Bearer {token}"}

    me = requests.get("https://api.mercadolibre.com/users/me", headers=headers, timeout=15).json()
    seller_id = me.get("id")

    ids = listar_items_activos(seller_id, headers)
    items = detalle_items(ids, headers)
    sin_sku = [it for it in items if not (it.get("seller_custom_field") or "").strip()]

    from app.services.google_services import _abrir_hoja

    sheet = _abrir_hoja()
    data = sheet.get_all_values()
    mapa_sheet: dict[str, str] = {}
    for row in data[1:]:
        if len(row) < 4:
            continue
        meli_id = str(row[0]).strip().upper()
        sku = str(row[1]).strip()
        if meli_id and sku:
            mapa_sheet[meli_id] = sku

    a_aplicar = []
    sin_match = []
    for it in sin_sku:
        mid = str(it.get("id") or "").strip().upper()
        if mid in mapa_sheet:
            a_aplicar.append((mid, mapa_sheet[mid], it.get("title") or ""))
        else:
            sin_match.append((mid, it.get("title") or ""))

    print(f"Aplicando SKU a {len(a_aplicar)} publicaciones (sin match: {len(sin_match)}, no se tocan)...\n")

    exitos = []
    errores = []
    for mid, sku, title in a_aplicar:
        res = actualizar_seller_custom_field_meli(mid, sku)
        if res.startswith("✅"):
            exitos.append((mid, sku))
        else:
            errores.append((mid, sku, res))
        print(f"{res}  ({title[:50]})")
        time.sleep(0.3)  # amable con rate limits de MeLi

    print(f"\n=== Resumen ===")
    print(f"Éxitos: {len(exitos)}")
    print(f"Errores: {len(errores)}")
    for mid, sku, err in errores:
        print(f"  ❌ {mid} ({sku}): {err}")
    print(f"Sin match (no tocadas): {len(sin_match)}")


if __name__ == "__main__":
    main()
