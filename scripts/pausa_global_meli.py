#!/usr/bin/env python3
"""
Pausa (o reactiva) TODAS las publicaciones activas de Mercado Libre.

    python3 scripts/pausa_global_meli.py --pausar       # guarda la lista y pausa
    python3 scripts/pausa_global_meli.py --reactivar    # reactiva solo lo que se pausó aquí
    python3 scripts/pausa_global_meli.py --estado

Antes de tocar nada escribe app/data/meli_pausa_global.json con los ítems que estaban
activos. Mientras ese archivo diga `"activa": true`, la sincronización de stock no
reactiva publicaciones (ver app/services/meli.py::pausa_global_meli_activa). Las que ya
estaban pausadas antes de la pausa global no se tocan al reactivar. Sin LLM.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests

from app.services.meli import PAUSA_GLOBAL_MELI_PATH
from app.utils import refrescar_token_meli

API = "https://api.mercadolibre.com"


def _headers() -> dict:
    token = refrescar_token_meli()
    if not token:
        sys.exit("No se pudo obtener token MeLi")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _listar(seller_id: int, status: str, h: dict) -> list[str]:
    ids: list[str] = []
    scroll = None
    while True:
        params = {"status": status, "search_type": "scan", "limit": 100}
        if scroll:
            params["scroll_id"] = scroll
        r = requests.get(f"{API}/users/{seller_id}/items/search", params=params, headers=h, timeout=20)
        r.raise_for_status()
        data = r.json()
        res = data.get("results") or []
        if not res:
            break
        ids.extend(res)
        scroll = data.get("scroll_id")
    return list(dict.fromkeys(ids))


def _leer() -> dict:
    try:
        with open(PAUSA_GLOBAL_MELI_PATH, encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, ValueError):
        return {}


def _guardar(data: dict) -> None:
    tmp = PAUSA_GLOBAL_MELI_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PAUSA_GLOBAL_MELI_PATH)


def _cambiar(ids: list[str], estado: str, h: dict) -> dict[str, str]:
    resultado: dict[str, str] = {}
    for i, iid in enumerate(ids, 1):
        for intento in range(3):
            try:
                r = requests.put(f"{API}/items/{iid}", json={"status": estado}, headers=h, timeout=20)
            except requests.RequestException as e:
                resultado[iid] = f"error: {e}"
                time.sleep(2)
                continue
            if r.status_code in (200, 201):
                resultado[iid] = "ok"
                break
            resultado[iid] = f"{r.status_code}: {(r.text or '')[:160]}"
            if r.status_code not in (429, 500, 502, 503, 504):
                break
            time.sleep(2 * (intento + 1))
        if i % 25 == 0:
            print(f"  {i}/{len(ids)}")
        time.sleep(0.25)
    return resultado


def pausar() -> None:
    previo = _leer()
    if previo.get("activa"):
        sys.exit("Ya hay una pausa global en curso; reactívela o revise el archivo antes.")
    h = _headers()
    seller_id = requests.get(f"{API}/users/me", headers=h, timeout=15).json()["id"]
    activos = _listar(seller_id, "active", h)
    data = {
        "activa": True,
        "desde": datetime.now().isoformat(timespec="seconds"),
        "items_pausados": activos,
        "resultado_pausa": {},
    }
    _guardar(data)  # la lista queda escrita ANTES de pausar nada
    print(f"Pausando {len(activos)} publicaciones…")
    data["resultado_pausa"] = _cambiar(activos, "paused", h)
    _guardar(data)
    fallos = {k: v for k, v in data["resultado_pausa"].items() if v != "ok"}
    print(f"Pausadas: {len(activos) - len(fallos)} · fallos: {len(fallos)}")
    for k, v in fallos.items():
        print(f"  {k}: {v}")


def reactivar() -> None:
    data = _leer()
    ids = [k for k, v in (data.get("resultado_pausa") or {}).items() if v == "ok"]
    if not data.get("activa") or not ids:
        sys.exit("No hay pausa global registrada.")
    # Primero se levanta la bandera: si no, el propio guard impediría que la
    # sincronización normal vuelva a funcionar mientras esto corre.
    data["activa"] = False
    data["reactivada"] = datetime.now().isoformat(timespec="seconds")
    _guardar(data)
    h = _headers()
    print(f"Reactivando {len(ids)} publicaciones…")
    data["resultado_reactivacion"] = _cambiar(ids, "active", h)
    _guardar(data)
    fallos = {k: v for k, v in data["resultado_reactivacion"].items() if v != "ok"}
    print(f"Reactivadas: {len(ids) - len(fallos)} · fallos: {len(fallos)}")
    for k, v in fallos.items():
        print(f"  {k}: {v}")


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--pausar", action="store_true")
    g.add_argument("--reactivar", action="store_true")
    g.add_argument("--estado", action="store_true")
    a = ap.parse_args()
    if a.pausar:
        pausar()
    elif a.reactivar:
        reactivar()
    else:
        d = _leer()
        print(json.dumps({k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in d.items()}, indent=2))


if __name__ == "__main__":
    main()
