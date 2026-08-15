"""
Margen real por producto pautado, cruzando Product Ads (MeLi) con el costeo
de combo real de Siigo (materia prima + envase + etiqueta + operativos).

El vínculo correcto entre una publicación de MeLi y su código de Siigo es el
campo `seller_custom_field` del ítem — NO el nombre de la publicación
(confirmado ago-2026: nombres como "Creatina Monohidrato 500g N/a" en MeLi
vs "CREATINA MONOHIDRATO 500g" en Siigo no cruzan por texto, pero
seller_custom_field trae literalmente el código Siigo, ej. "C-INUKg").
`app/services/meli_ads.py` (ads/search) no incluye ese campo — hay que
pedirlo aparte vía GET /items?ids=...&attributes=seller_custom_field
(multiget, hasta 20 ids por llamada).

Con eso resuelto, el costo real sale de `costos_todos_resumen()`
(app/services/rentabilidad.py) y el margen neto aproximado se calcula neto
de la comisión de MeLi (COMISION_MELI_DEFAULT = 16.5%) sobre el precio de
venta actual de la publicación. No se neta el IVA por falta de ese dato por
producto — el margen calculado aquí es una aproximación conservadora útil
para fijar techos de ACOS, no una cifra contable exacta.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime

import requests

from app.services.meli_ads import listar_items_publicidad_completo
from app.services.rentabilidad import COMISION_MELI_DEFAULT, costos_todos_resumen
from app.utils import refrescar_token_meli

_SKU_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "meli_sku_map_cache.json")
_SKU_CACHE_PATH = os.path.normpath(_SKU_CACHE_PATH)
_SKU_CACHE_TTL_S = 24 * 60 * 60  # el SKU de una publicación casi nunca cambia

# Qué tan por debajo del punto de equilibrio (margen neto) se sugiere el
# objetivo de ACOS, para dejar utilidad real y no solo no perder plata.
_FACTOR_OBJETIVO = 0.65
_ACOS_OBJETIVO_MIN = 5.0


def _cargar_sku_cache() -> dict:
    try:
        with open(_SKU_CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "mapa" in data:
            return data
    except Exception:
        pass
    return {"mapa": {}, "_ts": 0}


def _guardar_sku_cache(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_SKU_CACHE_PATH), exist_ok=True)
        with open(_SKU_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


def _obtener_sku_map(item_ids: list[str], refresh: bool = False) -> dict[str, str | None]:
    """item_id -> seller_custom_field (o None si la publicación no tiene SKU cargado)."""
    cache = _cargar_sku_cache()
    mapa: dict[str, str | None] = dict(cache.get("mapa") or {})
    vigente = not refresh and (time.time() - float(cache.get("_ts") or 0)) < _SKU_CACHE_TTL_S

    faltantes = [i for i in item_ids if not vigente or i not in mapa]
    if not faltantes:
        return {i: mapa.get(i) for i in item_ids}

    token = refrescar_token_meli()
    if not token:
        return {i: mapa.get(i) for i in item_ids}

    headers = {"Authorization": f"Bearer {token}"}
    for i in range(0, len(faltantes), 20):
        lote = faltantes[i : i + 20]
        try:
            r = requests.get(
                "https://api.mercadolibre.com/items",
                params={"ids": ",".join(lote), "attributes": "id,seller_custom_field"},
                headers=headers,
                timeout=20,
            )
            if r.status_code != 200:
                continue
            for entry in r.json() or []:
                body = entry.get("body") or {}
                iid = body.get("id")
                if iid:
                    mapa[iid] = body.get("seller_custom_field")
        except requests.RequestException:
            continue
        time.sleep(0.1)

    _guardar_sku_cache({"mapa": mapa, "_ts": time.time()})
    return {i: mapa.get(i) for i in item_ids}


def obtener_margenes_reales(dias: int = 30, refresh: bool = False) -> dict:
    """
    Cruza cada producto pautado con su SKU real de MeLi y el costo de combo
    de Siigo. Devuelve cobertura, lista de productos con margen conocido
    (con ACOS de equilibrio y objetivo sugerido), y la lista de publicaciones
    sin SKU cargado en MeLi (acción muy concreta: completar ese campo).
    """
    completo = listar_items_publicidad_completo(dias=dias, refresh=False)
    items = completo["items"]
    item_ids = [it["item_id"] for it in items]

    sku_map = _obtener_sku_map(item_ids, refresh=refresh)
    combos = costos_todos_resumen(refresh=False)

    con_margen: list[dict] = []
    sin_sku: list[dict] = []
    sku_sin_costo: list[dict] = []
    sin_ventas_periodo = 0

    for it in items:
        sku = sku_map.get(it["item_id"])
        if not sku:
            if it["costo"] > 0:
                sin_sku.append(it)
            continue

        combo = combos.get(sku.upper())
        costo_combo = float((combo or {}).get("costo_total") or 0)
        if costo_combo <= 0:
            if it["costo"] > 0:
                sku_sin_costo.append({**it, "sku": sku})
            continue

        # Margen se deriva del precio de venta realizado (ventas/unidades) — sin
        # unidades vendidas en el período no hay con qué calcularlo. Esos casos ya
        # se tratan aparte en el motor de recomendaciones (cero ventas = pausar
        # candidato sin necesitar margen), así que aquí solo se cuentan.
        if not it["unidades"]:
            if it["costo"] > 0:
                sin_ventas_periodo += 1
            continue
        precio_venta = float(it.get("ventas") or 0) / it["unidades"]
        if not precio_venta:
            continue

        comision = precio_venta * COMISION_MELI_DEFAULT
        margen_neto_valor = precio_venta - costo_combo - comision
        margen_neto_pct = round(margen_neto_valor / precio_venta * 100, 1) if precio_venta else 0.0
        acos_equilibrio = max(0.0, margen_neto_pct)
        acos_objetivo = max(_ACOS_OBJETIVO_MIN, round(acos_equilibrio * _FACTOR_OBJETIVO, 1))

        con_margen.append({
            **it,
            "sku": sku,
            "costo_combo": costo_combo,
            "precio_venta_ref": round(precio_venta, 0),
            "margen_neto_pct": margen_neto_pct,
            "acos_equilibrio_pct": round(acos_equilibrio, 1),
            "acos_objetivo_pct": acos_objetivo,
            "rentable_hoy": it["acos"] < acos_equilibrio,
        })

    con_margen.sort(key=lambda x: -x["costo"])
    sin_sku.sort(key=lambda x: -x["costo"])
    sku_sin_costo.sort(key=lambda x: -x["costo"])

    total_pautado = len(items)
    return {
        "dias": dias,
        "generado_en": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "comision_meli_pct": COMISION_MELI_DEFAULT * 100,
        "cobertura": {
            "total_pautado": total_pautado,
            "con_margen_real": len(con_margen),
            "sin_sku_en_meli": len(sin_sku),
            "con_sku_sin_costo_siigo": len(sku_sin_costo),
            "con_costo_pero_sin_ventas_periodo": sin_ventas_periodo,
        },
        "con_margen": con_margen,
        "sin_sku_en_meli": sin_sku[:40],
        "con_sku_sin_costo_siigo": sku_sin_costo[:40],
    }
