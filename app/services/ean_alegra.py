"""Códigos EAN ↔ combos de Alegra.

Cada código EAN de Diseño → Códigos EAN se registra con el SKU de venta del combo
(`C-…`). Este módulo lo enlaza con el combo de Alegra y escribe el número en el campo
adicional «Código de barras» del ítem (custom field de la empresa, clave `barcode`).

Por qué existe (23-sep-2026): el botón «Subir EAN a Alegra» en realidad subía a Siigo
(`siigo.sincronizar_barcodes_ean_a_siigo`) y en Alegra el campo estaba inactivo y
vacío en los 243 combos. Solo se toca ese campo: el PUT de ítems de Alegra es parcial
(como `alegra.actualizar_nombre_alegra_producto`), así que nombre, precio y receta
quedan como estaban.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests

from app.services import alegra as _alegra

_REPO = Path(__file__).resolve().parents[2]
_EAN_PATH = _REPO / "app" / "data" / "etiquetas_codigos_ean.json"
_CLAVE_CAMPO = "barcode"
_campo_cache: dict | None = None


def _norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _codigos_ean() -> list[dict]:
    try:
        data = json.loads(_EAN_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [c for c in (data.get("codigos") or []) if isinstance(c, dict)]


def campo_codigo_barras(forzar: bool = False) -> dict | None:
    """El campo adicional «Código de barras» de Alegra (id, status)."""
    global _campo_cache
    if _campo_cache is not None and not forzar:
        return _campo_cache
    r = requests.get(f"{_alegra._ALEGRA_BASE}/custom-fields", headers=_alegra._alegra_headers(), timeout=20)
    r.raise_for_status()
    campo = next((c for c in (r.json() or []) if (c.get("key") or "") == _CLAVE_CAMPO), None)
    _campo_cache = campo
    return campo


def activar_campo_codigo_barras() -> dict:
    """Deja activo el campo «Código de barras» (estaba inactivo en la empresa)."""
    campo = campo_codigo_barras(forzar=True)
    if not campo:
        return {"ok": False, "msg": "En Alegra no existe el campo adicional «Código de barras» (clave barcode)"}
    if campo.get("status") == "active":
        return {"ok": True, "msg": "Ya estaba activo", "id": campo["id"]}
    r = requests.put(
        f"{_alegra._ALEGRA_BASE}/custom-fields/{campo['id']}",
        headers=_alegra._alegra_headers(),
        json={"status": "active"},
        timeout=20,
    )
    if r.status_code != 200:
        return {"ok": False, "msg": f"Alegra no activó el campo ({r.status_code}): {r.text[:200]}"}
    campo = campo_codigo_barras(forzar=True) or {}
    return {"ok": campo.get("status") == "active", "msg": "Campo activado", "id": campo.get("id")}


def _kits_activos() -> dict[str, dict]:
    """Combos activos de la copia local del catálogo de Alegra, por referencia."""
    from app.services import alegra_catalogo_db as ac

    items: list[dict] = []
    off = 0
    while True:
        r = ac.listar_items(limit=500, offset=off, solo_activos=True)
        lote = r.get("items") if isinstance(r, dict) else r
        items += lote or []
        if not lote or len(lote) < 500:
            break
        off += 500
    return {i["reference"]: i for i in items if i.get("type") == "kit" and i.get("reference")}


def enlaces() -> list[dict]:
    """Cada código EAN con su combo de Alegra: `enlazado` (mismo SKU), `aproximado`
    (mismo SKU salvo espacios/mayúsculas), `producto` (existe pero no es combo) o
    `sin_combo`."""
    from app.services import alegra_catalogo_db as ac

    kits = _kits_activos()
    por_norm = {_norm(r): r for r in kits}
    out = []
    for c in _codigos_ean():
        sku = (c.get("sku") or "").strip()
        fila = {"id": c.get("id"), "sku": sku, "codigo": c.get("codigo"), "nombre": c.get("nombre_producto")}
        if sku in kits:
            fila.update(estado="enlazado", combo=sku, combo_nombre=kits[sku].get("name"))
        elif _norm(sku) in por_norm:
            ref = por_norm[_norm(sku)]
            fila.update(estado="aproximado", combo=ref, combo_nombre=kits[ref].get("name"))
        elif ac.obtener_item(sku):
            fila.update(estado="producto", combo="", combo_nombre="")
        else:
            fila.update(estado="sin_combo", combo="", combo_nombre="")
        out.append(fila)
    return out


def _item_por_referencia(ref: str) -> dict | None:
    r = requests.get(
        f"{_alegra._ALEGRA_BASE}/items",
        headers=_alegra._alegra_headers(),
        params={"reference": ref, "limit": 5},
        timeout=20,
    )
    r.raise_for_status()
    return next((i for i in (r.json() or []) if (i.get("reference") or "") == ref), None)


def escribir_ean_en_combo(ref: str, ean: str, campo_id: str | None = None) -> dict:
    """Escribe `ean` en el campo «Código de barras» del combo `ref`. Solo ese campo."""
    ean = re.sub(r"\D", "", ean or "")
    if len(ean) != 13:
        return {"ok": False, "ref": ref, "msg": f"EAN inválido: {ean!r}"}
    if not campo_id:
        campo = campo_codigo_barras()
        if not campo:
            return {"ok": False, "ref": ref, "msg": "Falta el campo «Código de barras» en Alegra"}
        campo_id = campo["id"]
    item = _item_por_referencia(ref)
    if not item:
        return {"ok": False, "ref": ref, "msg": "El combo no existe en Alegra"}
    actuales = item.get("customFields") or []
    if any(str(cf.get("id")) == str(campo_id) and str(cf.get("value") or "") == ean for cf in actuales):
        return {"ok": True, "ref": ref, "msg": "Ya lo tenía", "sin_cambio": True}
    r = requests.put(
        f"{_alegra._ALEGRA_BASE}/items/{item['id']}",
        headers=_alegra._alegra_headers(),
        json={"customFields": [{"id": campo_id, "value": ean}]},
        timeout=20,
    )
    if r.status_code != 200:
        return {"ok": False, "ref": ref, "msg": f"Alegra PUT {r.status_code}: {r.text[:200]}"}
    return {"ok": True, "ref": ref, "msg": "Cargado"}


def sincronizar_todos(pausa_s: float = 0.35) -> dict:
    """Activa el campo si hace falta y carga el EAN en cada combo enlazado (exacto)."""
    act = activar_campo_codigo_barras()
    if not act.get("ok"):
        return {"ok": False, "msg": act.get("msg"), "cargados": 0, "sin_cambio": 0, "errores": []}
    campo_id = act["id"]
    cargados = sin_cambio = 0
    errores: list[dict] = []
    pendientes = [e for e in enlaces() if e["estado"] == "enlazado"]
    for e in pendientes:
        try:
            res = escribir_ean_en_combo(e["combo"], e["codigo"], campo_id)
        except requests.RequestException as ex:
            res = {"ok": False, "ref": e["combo"], "msg": f"Error de red: {ex}"}
        if res.get("ok"):
            if res.get("sin_cambio"):
                sin_cambio += 1
            else:
                cargados += 1
        else:
            errores.append(res)
        time.sleep(pausa_s)  # Alegra limita las peticiones por minuto
    no_enlazados = [e for e in enlaces() if e["estado"] != "enlazado"]
    return {
        "ok": not errores,
        "cargados": cargados,
        "sin_cambio": sin_cambio,
        "errores": errores,
        "no_enlazados": no_enlazados,
    }
