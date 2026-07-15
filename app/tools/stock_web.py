"""
Almacén local de stock de la tienda web (PAGINA_WEB/site/), independiente de MeLi y Siigo.

Se alimenta desde `PUT /products/<sku>` en `PAGINA_WEB/site/website.py`, llamado por
`sincronizar_productos_pagina_web` (panel Stock del bot, fuente real: MeLi editado a mano).
Se descuenta localmente cuando se aprueba un pedido web (`process_order_paid_side_effects`
en `app/tools/web_pedidos.py`). No se propaga automáticamente de vuelta a MeLi ni a Siigo.

`None` significa "nunca sincronizado" — los productos sin dato de stock quedan comprables
(no se bloquean por defecto) hasta que el panel Stock los sincronice al menos una vez.
"""
import json
from datetime import datetime
from pathlib import Path
from threading import Lock

_ROOT = Path(__file__).resolve().parents[2]
STOCK_WEB_FILE = _ROOT / "PAGINA_WEB" / "site" / "data" / "stock_web.json"
_lock = Lock()


def _leer() -> dict:
    try:
        raw = json.loads(STOCK_WEB_FILE.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _escribir(data: dict) -> None:
    STOCK_WEB_FILE.parent.mkdir(parents=True, exist_ok=True)
    STOCK_WEB_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def obtener_stock_web(sku: str) -> int | None:
    sku_u = (sku or "").strip().upper()
    if not sku_u:
        return None
    entry = _leer().get(sku_u)
    if not entry:
        return None
    try:
        return int(entry.get("stock"))
    except (TypeError, ValueError):
        return None


def set_stock_web(sku: str, stock: int) -> None:
    sku_u = (sku or "").strip().upper()
    if not sku_u:
        return
    with _lock:
        data = _leer()
        data[sku_u] = {"stock": max(0, int(stock)), "updated_at": datetime.now().isoformat()}
        _escribir(data)


def descontar_stock_web(sku: str, cantidad: int) -> None:
    """Resta `cantidad` tras un pedido pagado. No hace nada si el SKU nunca fue sincronizado."""
    sku_u = (sku or "").strip().upper()
    if not sku_u or cantidad <= 0:
        return
    with _lock:
        data = _leer()
        entry = data.get(sku_u)
        if not entry:
            return
        try:
            actual = int(entry.get("stock", 0))
        except (TypeError, ValueError):
            return
        entry["stock"] = max(0, actual - int(cantidad))
        entry["updated_at"] = datetime.now().isoformat()
        data[sku_u] = entry
        _escribir(data)
