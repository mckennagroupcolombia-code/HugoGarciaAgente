"""
Compara el costo real de exponer un producto vía Product Ads contra vía
Promociones/Descuentos (Seller Promotions API), para decidir en qué canal
(o en cuáles) conviene meter cada producto — no son sustitutos gratuitos
entre sí, tienen mecánica de costo distinta:

- Ads: el precio al comprador no cambia. El vendedor paga el 100% del ACOS
  aparte, encima de la comisión normal de MeLi (~16.5% sobre precio completo).
- Promociones: el precio SÍ baja (`deal_price`), pero en varios tipos
  (SMART, VOLUME, PRICE_MATCHING…) MeLi cofinancia parte del descuento
  (`meli_percentage`) — el vendedor solo pone su parte (`seller_percentage`).
  No hay cobro adicional de MeLi por participar; la comisión se calcula
  sobre el precio ya rebajado (base menor). Confirmado en vivo ago-2026: para
  Creatina 500g, una promo SMART ofrece 10% de descuento total con MeLi
  cubriendo 3 puntos — el costo real para el vendedor es 7% del precio, muy
  por debajo del 76% de ACOS que paga hoy en ads por ese mismo producto.

Alcance: solo se evalúan productos con margen real conocido (ver
app/services/meli_ads_margenes.py) — sin costo de combo real no hay con qué
comparar honestamente cuánto le cuesta cada canal.

Regla de negocio (documentada, ajustable — confirmada con el usuario ago-2026):
  margen neto < 15%              → NINGUNO (no aguanta ads ni promo)
  margen neto >= 50% y alta rotación → AMBOS (colchón de sobra)
  alta rotación (margen 15-50%)  → ADS (protege precio, ya vende solo)
  media/baja rotación (margen 15-50%) → PROMOCIÓN (mueve inventario que no gira,
                                          aprovecha el cofinanciamiento de MeLi si existe)
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from typing import Any, Literal

from app.services.meli_ads_margenes import obtener_margenes_reales
from app.services.rentabilidad import COMISION_MELI_DEFAULT
from app.sync import obtener_ventas_meli_por_item

Canal = Literal["ninguno", "ads", "promocion", "ambos"]

_UMBRAL_MARGEN_MINIMO = 15.0
_UMBRAL_MARGEN_AMBOS = 50.0

_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "meli_ads_vs_promociones_cache.json")
_CACHE_PATH = os.path.normpath(_CACHE_PATH)
_CACHE_TTL_S = 60 * 60  # las promos candidatas de MeLi no cambian minuto a minuto


def _nivel_rotacion(item_id: str, ventas_por_item: dict) -> str:
    info = ventas_por_item.get(item_id)
    if not info:
        return "baja"
    nivel = info.get("nivel") or "baja"
    return nivel if nivel in ("alta", "media") else "baja"


def _canal_recomendado(margen_neto_pct: float, nivel: str) -> Canal:
    if margen_neto_pct < _UMBRAL_MARGEN_MINIMO:
        return "ninguno"
    if margen_neto_pct >= _UMBRAL_MARGEN_AMBOS and nivel == "alta":
        return "ambos"
    if nivel == "alta":
        return "ads"
    return "promocion"


def _mejor_promo_candidata(candidatas: list[dict]) -> dict | None:
    """De las promociones candidatas de un item, la más favorable para el vendedor:
    mayor cofinanciamiento de MeLi (meli_percentage) sobre el descuento total."""
    con_pct = [c for c in candidatas if c.get("meli_percentage") is not None and c.get("descuento_pct")]
    if con_pct:
        return max(con_pct, key=lambda c: c["meli_percentage"])
    con_descuento = [c for c in candidatas if c.get("descuento_pct")]
    if con_descuento:
        return min(con_descuento, key=lambda c: c["descuento_pct"])
    return None


def _cargar_cache() -> dict | None:
    try:
        with open(_CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if (time.time() - float(data.get("_ts") or 0)) < _CACHE_TTL_S:
            return data
    except Exception:
        pass
    return None


def _guardar_cache(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_CACHE_PATH), exist_ok=True)
        with open(_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump({**data, "_ts": time.time()}, f, ensure_ascii=False)
    except Exception:
        pass


def comparar_canales_publicidad(dias: int = 30, refresh: bool = False) -> dict:
    """
    Para cada producto con margen real conocido, compara costo por unidad en
    Ads (hoy) contra costo por unidad en la mejor promoción candidata
    disponible, y recomienda canal según margen + rotación.
    """
    if not refresh:
        cached = _cargar_cache()
        if cached and cached.get("dias") == dias:
            return cached

    margenes = obtener_margenes_reales(dias=dias, refresh=False)
    con_margen = margenes.get("con_margen") or []

    ventas = obtener_ventas_meli_por_item(dias=dias, refresh=False)
    ventas_por_item: dict[str, Any] = ventas.get("por_item") or {}

    from app.services.meli_promotions import promociones_del_item

    filas = []
    errores_promo = 0
    for it in con_margen:
        nivel = _nivel_rotacion(it["item_id"], ventas_por_item)
        canal_actual_ads = it["costo"] > 0
        try:
            promo_data = promociones_del_item(it["item_id"])
        except Exception:
            errores_promo += 1
            promo_data = {}
        candidatas = (promo_data or {}).get("candidatas") or []
        activas = [c for c in candidatas if c.get("status") not in (None, "candidate")]
        mejor = _mejor_promo_candidata(candidatas)

        precio_venta = it["precio_venta_ref"]
        costo_ads_unidad = it["costo"] / it["unidades"] if it["unidades"] else 0.0

        promo_info = None
        if mejor:
            descuento_pct = float(mejor.get("descuento_pct") or 0)
            meli_pct = float(mejor.get("meli_percentage") or 0)
            seller_pct = float(mejor.get("seller_percentage") or descuento_pct)
            costo_promo_unidad = precio_venta * (seller_pct / 100.0)
            precio_con_descuento = precio_venta * (1 - descuento_pct / 100.0)
            comision_descontada = precio_con_descuento * COMISION_MELI_DEFAULT
            margen_con_promo = (
                (precio_con_descuento - it["costo_combo"] - comision_descontada) / precio_con_descuento * 100
                if precio_con_descuento else None
            )
            promo_info = {
                "nombre": mejor.get("name"),
                "tipo": mejor.get("type"),
                "descuento_pct": descuento_pct,
                "meli_percentage": meli_pct,
                "seller_percentage": seller_pct,
                "costo_promo_por_unidad": round(costo_promo_unidad, 0),
                "margen_neto_con_promo_pct": round(margen_con_promo, 1) if margen_con_promo is not None else None,
            }

        canal_rec = _canal_recomendado(it["margen_neto_pct"], nivel)
        estado_actual = "ambos" if (canal_actual_ads and activas) else ("ads" if canal_actual_ads else ("promocion" if activas else "ninguno"))

        filas.append({
            "item_id": it["item_id"],
            "titulo": it["titulo"],
            "permalink": it.get("permalink"),
            "sku": it["sku"],
            "nivel_rotacion": nivel,
            "margen_neto_pct": it["margen_neto_pct"],
            "costo_ads_por_unidad": round(costo_ads_unidad, 0),
            "acos_actual": it["acos"],
            "canal_actual": estado_actual,
            "canal_recomendado": canal_rec,
            "coincide": estado_actual == canal_rec,
            "promo_candidata": promo_info,
        })

    filas.sort(key=lambda f: -f["costo_ads_por_unidad"])

    resumen = {
        "ninguno": sum(1 for f in filas if f["canal_recomendado"] == "ninguno"),
        "ads": sum(1 for f in filas if f["canal_recomendado"] == "ads"),
        "promocion": sum(1 for f in filas if f["canal_recomendado"] == "promocion"),
        "ambos": sum(1 for f in filas if f["canal_recomendado"] == "ambos"),
        "desalineados": sum(1 for f in filas if not f["coincide"]),
        "errores_consultando_promos": errores_promo,
    }

    resultado = {
        "dias": dias,
        "generado_en": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "total_evaluados": len(filas),
        "resumen": resumen,
        "productos": filas,
    }
    _guardar_cache(resultado)
    return resultado
