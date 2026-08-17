"""
Control de Inventario — agregador de stock por SKU para el panel `/app` (ver
CLAUDE.md y docs/agentic para contexto del resto del sistema).

No introduce una nueva fuente de verdad de stock: MeLi sigue siendo la única
fuente de verdad de stock vendible (`app.sync.obtener_estado_stock_meli`),
Siigo sigue siendo SOLO lectura de referencia (nunca se le escribe stock).
Este módulo combina, para decisión operativa, lo que ya existe:

- Stock vivo en MeLi (canal real).
- Stock de referencia en Siigo (bodega/ERP) — solo para detectar divergencias
  ("hay inventario físico que no se reflejó en el canal").
- Rotación YTD (ya calculada en app.sync).
- Estado de revisión manual del equipo (JSON propio, este módulo).
- Proveedor anotado por SKU (JSON propio, este módulo — texto libre, no un
  catálogo de proveedores).
- Umbrales configurables desde el panel (JSON propio, este módulo).
"""

from __future__ import annotations

import json
import math
import os
import time
from datetime import datetime
from typing import Any

import requests

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_CONFIG_PATH = os.path.join(_DATA_DIR, "inventario_config.json")
_REVISIONES_PATH = os.path.join(_DATA_DIR, "inventario_revisiones.json")
_PROVEEDORES_PATH = os.path.join(_DATA_DIR, "inventario_proveedores.json")
_SIIGO_STOCK_CACHE_PATH = os.path.join(_DATA_DIR, "siigo_stock_cache.json")

_SIIGO_STOCK_CACHE_TTL_S = 30 * 60

DEFAULT_UMBRAL_BAJO_STOCK = 5
DEFAULT_UMBRAL_DIVERGENCIA_SIIGO = 3


def _leer_json(path: str, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _escribir_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def obtener_config_inventario() -> dict:
    data = _leer_json(_CONFIG_PATH, {})
    return {
        "umbral_bajo_stock": int(data.get("umbral_bajo_stock") or DEFAULT_UMBRAL_BAJO_STOCK),
        "umbral_divergencia_siigo": int(
            data.get("umbral_divergencia_siigo") or DEFAULT_UMBRAL_DIVERGENCIA_SIIGO
        ),
    }


def establecer_config_inventario(
    umbral_bajo_stock: int | None = None,
    umbral_divergencia_siigo: int | None = None,
) -> dict:
    actual = obtener_config_inventario()
    if umbral_bajo_stock is not None:
        umbral_bajo_stock = int(umbral_bajo_stock)
        if umbral_bajo_stock < 1:
            raise ValueError("umbral_bajo_stock debe ser >= 1")
        actual["umbral_bajo_stock"] = umbral_bajo_stock
    if umbral_divergencia_siigo is not None:
        umbral_divergencia_siigo = int(umbral_divergencia_siigo)
        if umbral_divergencia_siigo < 1:
            raise ValueError("umbral_divergencia_siigo debe ser >= 1")
        actual["umbral_divergencia_siigo"] = umbral_divergencia_siigo
    _escribir_json(_CONFIG_PATH, actual)
    return actual


def listar_stock_siigo_bulk(refresh: bool = False) -> dict[str, dict]:
    """dict {code: {nombre, stock_siigo}} de todos los productos Siigo.

    Un solo barrido paginado (mismo endpoint/paginación que
    app.tools.verificacion_sync_skus._get_siigo_skus), cacheado — evita una
    llamada HTTP por SKU en cada carga del panel. Siigo sigue siendo solo
    lectura de referencia; esta función no escribe nada en Siigo.
    """
    now = time.time()
    if not refresh:
        cached = _leer_json(_SIIGO_STOCK_CACHE_PATH, {})
        ts = float(cached.get("ts") or 0)
        if (now - ts) < _SIIGO_STOCK_CACHE_TTL_S and isinstance(cached.get("por_codigo"), dict):
            return cached["por_codigo"]

    from app.services.siigo import autenticar_siigo, PARTNER_ID

    token = autenticar_siigo()
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
    por_codigo: dict[str, dict] = {}
    page = 1
    while True:
        r = requests.get(
            f"https://api.siigo.com/v1/products?page={page}&page_size=100",
            headers=headers,
            timeout=20,
        ).json()
        results = r.get("results", [])
        for p in results:
            code = (p.get("code") or "").strip()
            if not code:
                continue
            por_codigo[code] = {
                "nombre": (p.get("name") or "").strip(),
                "stock_siigo": int(p.get("available_quantity") or 0),
            }
        pag = r.get("pagination", {})
        total = pag.get("total_results", 0)
        page_size = pag.get("page_size", 100)
        total_pages = math.ceil(total / page_size) if page_size else 1
        if page >= total_pages or not results:
            break
        page += 1

    _escribir_json(
        _SIIGO_STOCK_CACHE_PATH,
        {"ts": now, "actualizado_en": datetime.now().isoformat(timespec="seconds"), "por_codigo": por_codigo},
    )
    return por_codigo


def marcar_revisado(meli_id: str, usuario_nombre: str = "") -> dict:
    meli_id = (meli_id or "").strip().upper()
    if not meli_id:
        raise ValueError("meli_id requerido")
    data = _leer_json(_REVISIONES_PATH, {})
    entrada = {
        "revisado_en": datetime.now().isoformat(timespec="seconds"),
        "revisado_por": (usuario_nombre or "").strip() or "Equipo",
    }
    data[meli_id] = entrada
    _escribir_json(_REVISIONES_PATH, data)
    return entrada


def guardar_proveedor(sku: str, proveedor: str = "", notas: str = "", usuario_nombre: str = "") -> dict:
    sku = (sku or "").strip()
    if not sku:
        raise ValueError("sku requerido")
    data = _leer_json(_PROVEEDORES_PATH, {})
    entrada = {
        "proveedor": (proveedor or "").strip(),
        "notas": (notas or "").strip(),
        "actualizado_en": datetime.now().isoformat(timespec="seconds"),
        "actualizado_por": (usuario_nombre or "").strip() or "Equipo",
    }
    data[sku] = entrada
    _escribir_json(_PROVEEDORES_PATH, data)
    return entrada


def _dias_desde(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
    except Exception:
        return None
    return max(0, (datetime.now() - dt).days)


def resumen_control_inventario(refresh: bool = False) -> dict:
    """Agregador central de Control de Inventario — una fila por publicación MeLi.

    No es una tabla nueva de verdad: recombina obtener_estado_stock_meli()
    (MeLi = fuente de verdad de stock), la relación de códigos MeLi↔Siigo ya
    existente, y el stock de referencia de Siigo, más las anotaciones locales
    (revisión manual, proveedor) y los umbrales configurables.
    """
    from app.sync import (
        obtener_estado_stock_meli,
        obtener_ventas_meli_ytd_por_item,
        clasificar_rotacion,
    )
    from app.tools.relacion_codigos_meli_siigo import listar_relacion_codigos_meli_siigo

    config = obtener_config_inventario()
    umbral_bajo = config["umbral_bajo_stock"]
    umbral_divergencia = config["umbral_divergencia_siigo"]

    items_meli = obtener_estado_stock_meli()

    try:
        ventas_ytd = obtener_ventas_meli_ytd_por_item()
        unidades_ytd_por_item = ventas_ytd["por_item"]
    except Exception:
        unidades_ytd_por_item = {}

    try:
        relacion = listar_relacion_codigos_meli_siigo(refresh=refresh)
        codigo_siigo_por_meli = {
            it["meli_id"]: it.get("codigo_siigo") or "" for it in relacion.get("items", [])
        }
    except Exception:
        codigo_siigo_por_meli = {}

    try:
        stock_siigo_por_codigo = listar_stock_siigo_bulk(refresh=refresh)
    except Exception:
        stock_siigo_por_codigo = {}

    revisiones = _leer_json(_REVISIONES_PATH, {})
    proveedores = _leer_json(_PROVEEDORES_PATH, {})

    salida: list[dict] = []
    for it in items_meli:
        mid = str(it.get("meli_id") or "").strip().upper()
        sku = str(it.get("sku") or "").strip()
        stock = int(it.get("stock") or 0)
        nombre = it.get("nombre") or ""

        if stock == 0:
            estado = "agotado"
        elif stock == 1:
            estado = "critico"
        elif stock < umbral_bajo:
            estado = "bajo"
        else:
            estado = "ok"

        rotacion = clasificar_rotacion(unidades_ytd_por_item.get(mid, 0))

        codigo_siigo = codigo_siigo_por_meli.get(mid, "")
        stock_siigo = None
        if codigo_siigo:
            entrada_siigo = stock_siigo_por_codigo.get(codigo_siigo)
            if entrada_siigo:
                stock_siigo = int(entrada_siigo.get("stock_siigo") or 0)

        divergencia = bool(
            stock_siigo is not None
            and estado in ("agotado", "critico", "bajo")
            and (stock_siigo - stock) >= umbral_divergencia
        )

        revision = revisiones.get(mid) or {}
        proveedor_info = proveedores.get(sku) or {}

        salida.append(
            {
                "meli_id": mid,
                "sku": sku,
                "nombre": nombre,
                "stock_meli": stock,
                "stock_siigo": stock_siigo,
                "estado": estado,
                "divergencia": divergencia,
                "rotacion": rotacion,
                "revisado_en": revision.get("revisado_en"),
                "revisado_por": revision.get("revisado_por"),
                "dias_sin_revisar": _dias_desde(revision.get("revisado_en")),
                "proveedor": proveedor_info.get("proveedor") or "",
                "notas_proveedor": proveedor_info.get("notas") or "",
            }
        )

    salida.sort(
        key=lambda x: (
            {"agotado": 0, "critico": 1, "bajo": 2, "ok": 3}[x["estado"]],
            {"alta": 0, "media": 1, "baja": 2, "sin_ventas": 3}.get(x["rotacion"], 4),
            x["nombre"].lower(),
        )
    )

    return {
        "items": salida,
        "total": len(salida),
        "actualizado_en": datetime.now().isoformat(timespec="seconds"),
        "umbral_bajo_stock": umbral_bajo,
        "umbral_divergencia_siigo": umbral_divergencia,
    }
