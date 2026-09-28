# -*- coding: utf-8 -*-
"""Despliegue gradual de ventas tras el cese de actividades (27-sep-2026).

Al levantar el cese solo vuelve a la venta lo que **hoy se puede facturar**: una
publicación MeLi que estaba activa antes del cese se reactiva si su SKU resuelve en
Alegra (código propio activo o alias de venta — misma regla que la facturación,
`canales_producto._facturable`, contra la copia local del catálogo). Fotos viejas o
documentación técnica incompleta no frenan el despliegue; un SKU que no factura sí.

Estado en ``app/data/despliegue_ventas.json``. Mientras ``"activo": true``:
  - MeLi: la sincronización de stock no reactiva publicaciones fuera de la lista
    (`meli.meli_item_reactivable`). Reactivar a mano desde el panel sigue igual.
  - Web: la tienda solo muestra combos de la lista (website.py lee el archivo).
  - Cotizar/Facturar (ventas directas por WhatsApp): solo se cotizan SKUs de la lista
    (salvo la venta MeLi con RUT, que factura algo ya vendido).
  - Diseño de producto (Árbol del producto): cada combo dice si está desplegado.

Ampliar el despliegue = volver a correr ``scripts/desplegar_ventas_facturables.py``
cuando se enlacen más SKUs. Sin LLM.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ARCHIVO = REPO / "app" / "data" / "despliegue_ventas.json"
_PAUSA_GLOBAL_JSON = REPO / "app" / "data" / "meli_pausa_global.json"
_RELACION_JSON = REPO / "app" / "data" / "relacion_codigos_cache.json"

_lock = threading.Lock()
_memo: dict = {"mtime": None, "data": {}}


def _u(s) -> str:
    return str(s or "").strip().upper()


def estado() -> dict:
    """Contenido del archivo, releído solo si cambió en disco."""
    try:
        mtime = ARCHIVO.stat().st_mtime
    except OSError:
        return {}
    with _lock:
        if _memo["mtime"] == mtime:
            return _memo["data"]
        try:
            data = json.loads(ARCHIVO.read_text(encoding="utf-8")) or {}
        except (OSError, ValueError):
            data = {}
        _memo.update({"mtime": mtime, "data": data})
        return data


def activo() -> bool:
    return bool(estado().get("activo"))


def skus_habilitados() -> set[str] | None:
    """SKUs de venta habilitados, o None si no hay despliegue activo (sin restricción)."""
    data = estado()
    if not data.get("activo"):
        return None
    return {_u(k) for k in (data.get("skus") or {})}


def sku_habilitado(sku: str) -> bool:
    permitidos = skus_habilitados()
    return permitidos is None or _u(sku) in permitidos


def meli_ids_habilitados() -> set[str] | None:
    data = estado()
    if not data.get("activo"):
        return None
    return {_u(m) for info in (data.get("skus") or {}).values() for m in (info.get("meli_ids") or [])}


def info_sku(sku: str) -> dict | None:
    """{nombre, meli_ids, desde} si el SKU está desplegado; None si no (o sin despliegue)."""
    data = estado()
    if not data.get("activo"):
        return None
    info = (data.get("skus") or {}).get(_u(sku))
    if info is None:
        return None
    return {**info, "desde": data.get("desde")}


def _leer(ruta: Path) -> dict:
    try:
        return json.loads(ruta.read_text(encoding="utf-8")) or {}
    except (OSError, ValueError):
        return {}


def calcular() -> dict:
    """Qué publicaciones del cese se reactivan y cuáles no (solo lectura, sin llamadas vivas)."""
    from app.services import canales_producto as cp

    pausa = _leer(_PAUSA_GLOBAL_JSON)
    candidatas = [k for k, v in (pausa.get("resultado_pausa") or {}).items() if v == "ok"]
    candidatas += (pausa.get("recuperadas_del_primer_cese") or {}).get("ids") or []
    candidatas = list(dict.fromkeys(_u(x) for x in candidatas if x))

    rel = _leer(_RELACION_JSON)
    por_id = {_u(it.get("meli_id")): it for it in rel.get("items") or []}
    alegra = cp._fuente_alegra()
    alias = cp._fuente_alias()

    skus: dict[str, dict] = {}
    excluidas: list[dict] = []
    for mid in candidatas:
        it = por_id.get(mid)
        if not it:
            excluidas.append({"meli_id": mid, "sku": "", "titulo": "", "motivo": "sin SKU en la relación de códigos"})
            continue
        sku = _u(it.get("sku_meli") or it.get("codigo_siigo"))
        fact = cp._facturable(sku, alegra, alias) if sku else {"estado": "no", "alias_destino": ""}
        if fact["estado"] not in ("si", "alias"):
            motivo = "código inactivo en Alegra" if fact["estado"] == "inactivo" else "el SKU no existe en Alegra ni tiene alias"
            excluidas.append({"meli_id": mid, "sku": sku, "titulo": it.get("titulo") or "", "motivo": motivo})
            continue
        destino = alegra.get(sku) or alegra.get(_u(fact["alias_destino"])) or {}
        info = skus.setdefault(sku, {
            "nombre": destino.get("nombre") or it.get("titulo") or sku,
            "titulo_meli": it.get("titulo") or "",
            "tipo": destino.get("tipo") or "",
            "alias_destino": fact["alias_destino"],
            "meli_ids": [],
        })
        info["meli_ids"].append(mid)
    return {"candidatas": len(candidatas), "skus": skus, "excluidas": excluidas}


def guardar(calculo: dict, *, usuario: str = "") -> dict:
    previo = estado()
    data = {
        "activo": True,
        "desde": previo.get("desde") or datetime.now().isoformat(timespec="seconds"),
        "actualizado": datetime.now().isoformat(timespec="seconds"),
        "actualizado_por": usuario,
        "criterio": "Publicaciones activas antes del cese cuyo SKU se factura hoy en Alegra (código propio activo o alias).",
        "skus": calculo["skus"],
        "excluidas": calculo["excluidas"],
    }
    tmp = str(ARCHIVO) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ARCHIVO)
    return data
