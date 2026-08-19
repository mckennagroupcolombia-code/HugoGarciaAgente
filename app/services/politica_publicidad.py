"""
Política de publicidad vigente — un interruptor de negocio editable a mano
(no vía API de MeLi: no hay endpoint de escritura habilitado para esta app,
confirmado ago-2026 — `PUT /advertising/product_ads/campaigns/{id}` devuelve
401 "User does not have permission to write"; pausar/reactivar campañas solo
se puede hacer manualmente en el panel de Mercado Ads).

Activada ago-2026 tras el saneamiento de liquidez: la factura de servicios
MeLi del 25-ago ($23.750.770 pendientes de pago) resultó ser 99,7% cargos de
publicidad — comisión y envío ya se habían descontado en tiempo real de cada
venta, publicidad se facturó aparte y de una sola vez a mes vencido. Con ACOS
real confirmado hasta 242% en varios SKUs (ver `meli_ads_vs_promociones.py`)
y 66% del gasto de ads de 30 días marcado pausar/revisar por
`meli_ads_recomendaciones.py`, se decidió dejar de confiar en las ventas
"atribuidas a ads" que reporta MeLi (esa atribución sobreestima cuánto de esa
venta era realmente incremental) y priorizar Promociones — MeLi cofinancia
parte del descuento — mientras se reconstruye el colchón de caja.

`modo_saneamiento()` es la única función que el resto del código debe
consultar; mantiene el criterio de decisión en un solo lugar. Reversible sin
tocar código: editar `app/data/politica_publicidad.json` (o borrarlo) vuelve
al criterio normal de margen+rotación.
"""

from __future__ import annotations

import json
import os

_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "politica_publicidad.json")
_PATH = os.path.normpath(_PATH)


def leer_politica_publicidad() -> dict:
    try:
        with open(_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def modo_saneamiento() -> bool:
    return leer_politica_publicidad().get("modo") == "saneamiento"
