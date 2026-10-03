"""
Mantiene la «Hoja 1» del Google Sheet de productos al día con las publicaciones de MeLi.

Columnas de la hoja: A=ID MeLi, B=SKU, C=presentación, D=nombre, E=precio, F=stock MeLi,
G=stock Siigo (vacía), H=link de la publicación, I=TDS, J=link TDS. Antes de este módulo nadie
agregaba filas: 67 de 168 publicaciones registradas quedaron fuera del Sheet (tandas desde junio),
y sin fila el bot de preventa no encuentra la ficha (col. I) ni el barrido de stock ve el ítem.

`asegurar_fila` es idempotente (no duplica por ID ni por SKU) y NUNCA lanza: una falla del
Sheet no debe tumbar una publicación. `SHEET_PRODUCTOS_AUTOFILA=0` la apaga.
"""

from __future__ import annotations

import os
import re
import threading
from typing import Any

from app.observability import log_json

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID") or "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
_CREDS = os.getenv("GOOGLE_SERVICE_ACCOUNT_PATH", "/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json")
_lock = threading.Lock()

_PAT_MCO = re.compile(r"^MCO\d{6,}$")
_PAT_PRESENTACION = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|grs|gramos?|ml|l|lt|litros?)\b", re.I)


def activo() -> bool:
    return os.getenv("SHEET_PRODUCTOS_AUTOFILA", "1").strip().lower() not in ("0", "false", "no")


def presentacion_de(sku: str = "", titulo: str = "") -> str:
    """'250 g' / '1 kg' / '30 mL' a partir del título (o del SKU: C-PSYESC250g)."""
    for texto in (titulo, sku):
        m = _PAT_PRESENTACION.search(texto or "")
        if not m:
            continue
        num = m.group(1).replace(",", ".")
        num = num[:-2] if num.endswith(".0") else num
        u = m.group(2).lower()
        if u.startswith("k"):
            return f"{num} kg"
        if u in ("l", "lt") or u.startswith("lit"):
            return f"{num} L"
        if u == "ml":
            return f"{num} mL"
        return f"{num} g"
    if re.search(r"kg$", sku or "", re.I):
        return "1 kg"
    return ""


def _hoja():
    import gspread

    sh = gspread.service_account(filename=_CREDS).open_by_key(SPREADSHEET_ID)
    try:
        return sh.worksheet("Hoja 1")
    except gspread.exceptions.WorksheetNotFound:
        return sh.sheet1


def _item_meli(item_id: str) -> dict | None:
    try:
        import requests

        from app.utils import refrescar_token_meli

        token = refrescar_token_meli()
        if not token:
            return None
        r = requests.get(
            f"https://api.mercadolibre.com/items/{item_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


def _sku_de_item(item: dict) -> str:
    for a in item.get("attributes") or []:
        if a.get("id") == "SELLER_SKU" and a.get("value_name"):
            return str(a["value_name"]).strip()
    return str(item.get("seller_custom_field") or "").strip()


def asegurar_fila(
    meli_id: str,
    sku: str = "",
    *,
    titulo: str = "",
    precio: float | None = None,
    stock: int | None = None,
    permalink: str = "",
    hoja: Any = None,
) -> dict:
    """
    Garantiza que la publicación tenga su fila en la Hoja 1. Devuelve
    {"ok", "accion": "agregada|completada|ya_estaba|omitida|error", ...}. Nunca lanza.
    Lo que no se pase se lee de MeLi (título, precio, stock, permalink, SELLER_SKU).
    """
    mid = str(meli_id or "").strip().upper().replace("-", "")
    if not activo():
        return {"ok": True, "accion": "omitida", "motivo": "SHEET_PRODUCTOS_AUTOFILA=0"}
    if not _PAT_MCO.match(mid):
        return {"ok": False, "accion": "omitida", "motivo": f"ID de MeLi inválido: {meli_id!r}"}
    try:
        item = None
        if not (titulo and precio is not None and stock is not None and permalink and sku):
            item = _item_meli(mid) or {}
        item = item or {}
        sku = (sku or _sku_de_item(item)).strip()
        titulo = titulo or str(item.get("title") or "").strip()
        precio = precio if precio is not None else item.get("price")
        stock = stock if stock is not None else item.get("available_quantity")
        permalink = permalink or str(item.get("permalink") or "").strip()
        if not titulo:
            return {"ok": False, "accion": "error", "motivo": "sin título (MeLi no respondió)", "meli_id": mid}

        with _lock:
            ws = hoja if hoja is not None else _hoja()
            datos = ws.get_all_values()
            por_id, por_sku = {}, {}
            for i, r in enumerate(datos[1:], start=2):
                a = (r[0] if r else "").strip().upper()
                b = (r[1] if len(r) > 1 else "").strip().upper()
                if a:
                    por_id.setdefault(a, i)
                if b:
                    por_sku.setdefault(b, i)
            if mid in por_id:
                return {"ok": True, "accion": "ya_estaba", "meli_id": mid, "fila": por_id[mid]}

            fila = [
                mid,
                sku,
                presentacion_de(sku, titulo),
                titulo,
                float(precio) if precio is not None else "",
                int(stock) if stock is not None else "",
                "",
                permalink,
            ]
            existente = por_sku.get(sku.upper()) if sku else None
            if existente and not (datos[existente - 1][0] or "").strip():
                # Fila con el SKU pero sin ID de MeLi: se completa en vez de duplicar.
                ws.batch_update(
                    [
                        {"range": f"A{existente}", "values": [[mid]]},
                        {"range": f"H{existente}", "values": [[permalink]]},
                    ],
                    value_input_option="USER_ENTERED",
                )
                log_json("sheet_productos_completada", meli_id=mid, sku=sku, fila=existente)
                return {"ok": True, "accion": "completada", "meli_id": mid, "sku": sku, "fila": existente}
            # Fila destino explícita (la primera libre bajo el último dato). append_row con
            # table_range="A1" llegó a sobrescribir el ENCABEZADO de la hoja: nunca usarlo aquí.
            destino = len(datos) + 1
            if destino < 2:
                return {"ok": False, "accion": "error", "motivo": "la hoja no tiene encabezado", "meli_id": mid}
            if getattr(ws, "row_count", destino) < destino:
                ws.add_rows(destino - ws.row_count)
            ws.batch_update(
                [{"range": f"A{destino}:H{destino}", "values": [fila]}], value_input_option="USER_ENTERED"
            )
            log_json("sheet_productos_agregada", meli_id=mid, sku=sku, fila=destino)
            return {"ok": True, "accion": "agregada", "meli_id": mid, "sku": sku, "fila": destino, "fila_datos": fila}
    except Exception as e:  # el Sheet nunca debe tumbar una publicación
        log_json("sheet_productos_error", meli_id=mid, error=str(e)[:200])
        return {"ok": False, "accion": "error", "motivo": str(e)[:200], "meli_id": mid}


def asegurar_fila_en_segundo_plano(meli_id: str, sku: str = "", **kw) -> None:
    """Para los flujos de publicación: no suma latencia a la respuesta del panel."""
    if not activo():
        return
    try:
        from app.observability import spawn_thread

        spawn_thread(asegurar_fila, args=(meli_id, sku), kwargs=kw, daemon=True)
    except Exception as e:
        log_json("sheet_productos_error", meli_id=str(meli_id), error=f"hilo: {str(e)[:150]}")
