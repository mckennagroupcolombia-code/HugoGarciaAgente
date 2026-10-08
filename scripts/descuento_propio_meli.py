#!/usr/bin/env python3
"""Deja cada publicación activa de MeLi con UN solo descuento propio.

Contexto (28-sep-2026): las publicaciones acumulaban campañas (DEAL «Ofertas del
mundo», SMART «Rompela…», Hot Sale ya inscritas) y algunas quedaban con 25-30 %
de descuento. Política: sacar el ítem de todas las campañas y ponerle un
PRICE_DISCOUNT propio del 10 % (o el mínimo que MeLi acepte si exige más).

MeLi limita el PRICE_DISCOUNT a 30 días: volver a correr este script antes de
que venzan (es idempotente: si el ítem ya solo tiene el descuento propio
vigente al % objetivo, lo deja quieto).

Uso:
    python3 scripts/descuento_propio_meli.py                # vista previa
    python3 scripts/descuento_propio_meli.py --aplicar      # ejecuta
    python3 scripts/descuento_propio_meli.py --aplicar --item MCO123
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(RAIZ / ".env")

import requests  # noqa: E402

from app.services import meli_promotions  # noqa: E402
from app.services.meli_promotions import (  # noqa: E402
    MELI_API,
    agregar_item_a_promocion,
    promociones_del_item,
    quitar_item_de_promocion,
)
from app.utils import refrescar_token_meli  # noqa: E402

# meli_promotions refresca el OAuth en CADA llamada: con cientos de ítems MeLi
# responde 429 al refresh_token y eso tumba también a los servicios de producción
# que comparten las credenciales. Aquí se refresca una vez y se reusa.
_TOKEN: dict[str, str] = {}


def _token_cacheado() -> str | None:
    if "t" not in _TOKEN:
        t = refrescar_token_meli()
        if not t:
            return None
        _TOKEN["t"] = t
    return _TOKEN["t"]


meli_promotions.refrescar_token_meli = _token_cacheado

DIAS_VIGENCIA = 30  # máximo que MeLi acepta para PRICE_DISCOUNT
LOG_DIR = RAIZ / "logs"


def _items_activos(token: str) -> list[str]:
    h = {"Authorization": f"Bearer {token}"}
    uid = requests.get(f"{MELI_API}/users/me", headers=h, timeout=20).json()["id"]
    ids: list[str] = []
    scroll = None
    while True:
        p = {"search_type": "scan", "status": "active", "limit": 100}
        if scroll:
            p["scroll_id"] = scroll
        r = requests.get(f"{MELI_API}/users/{uid}/items/search", headers=h, params=p, timeout=40).json()
        res = r.get("results") or []
        if not res:
            return ids
        ids += res
        scroll = r.get("scroll_id")


def _reintentar(fn, *a, **kw):
    for intento in range(4):
        try:
            return fn(*a, **kw)
        except requests.RequestException:
            time.sleep(2 * (intento + 1))
    return fn(*a, **kw)


def _precio_objetivo(cand: dict, pct: float) -> tuple[int | None, float | None]:
    """deal_price = original × (1-pct), pero nunca por encima del máximo que MeLi
    acepta (= su descuento mínimo). Devuelve (precio, % real)."""
    orig = float(cand.get("original_price") or 0)
    if orig <= 0:
        return None, None
    precio = round(orig * (1 - pct))
    mx = cand.get("max_discounted_price")
    mn = cand.get("min_discounted_price")
    if mx:
        precio = min(precio, int(float(mx)))
    if mn and precio < float(mn):
        return None, None
    return precio, round((1 - precio / orig) * 100, 1)


def procesar(iid: str, pct: float, aplicar: bool) -> dict:
    out: dict = {"id": iid, "quitadas": [], "errores": []}
    info = _reintentar(promociones_del_item, iid)
    activas = info.get("activas") or []
    propias = [p for p in activas if p["type"] == "PRICE_DISCOUNT"]
    otras = [p for p in activas if p["type"] != "PRICE_DISCOUNT"]
    if not otras and len(propias) == 1 and propias[0].get("descuento_pct") is not None:
        if abs(propias[0]["descuento_pct"] - pct * 100) < 0.6:
            out["estado"] = "ya_ok"
            return out
    cand = next((c for c in info.get("candidatas") or [] if c["type"] == "PRICE_DISCOUNT"), None)
    out["antes"] = [(p["type"], p["id"], p.get("descuento_pct")) for p in activas]
    if not aplicar:
        out["estado"] = "vista_previa"
        if cand:
            out["precio"], out["pct"] = _precio_objetivo(cand, pct)
        return out

    for p in activas:
        try:
            _reintentar(
                quitar_item_de_promocion,
                iid,
                promotion_id=p["id"] or "",
                promotion_type=p["type"],
                offer_id=p.get("ref_id"),
            )
            out["quitadas"].append(p["id"] or p["type"])
        except Exception as e:  # sigue con las demás
            out["errores"].append(f"quitar {p['type']} {p['id']}: {e}")

    if cand is None:
        cand = next(
            (c for c in (_reintentar(promociones_del_item, iid).get("candidatas") or []) if c["type"] == "PRICE_DISCOUNT"),
            None,
        )
    if cand is None and "PRICE_DISCOUNT" in out["quitadas"]:
        # Recién quitado el descuento propio, MeLi tarda en volver a ofrecerlo como candidato:
        # sin esto el ítem quedaba a precio lleno (creatina, 8-oct-2026). El original es el
        # precio de la publicación; MeLi valida el rango al inscribir.
        try:
            r = requests.get(f"{MELI_API}/items/{iid}", headers={"Authorization": f"Bearer {_token_cacheado()}"}, timeout=30)
            precio_item = float((r.json() or {}).get("price") or 0)
        except Exception:
            precio_item = 0.0
        if precio_item > 0:
            cand = {"original_price": precio_item}
    if cand is None:
        out["estado"] = "sin_candidato_price_discount"
        return out
    precio, pct_real = _precio_objetivo(cand, pct)
    if precio is None:
        out["estado"] = "fuera_de_rango"
        return out
    hoy = dt.date.today()
    # Justo después de quitar el descuento anterior MeLi responde «No candidates found for
    # item» durante unos segundos; rendirse ahí dejaba el ítem a precio lleno (8-oct-2026).
    ultimo = None
    for _ in range(8):
        try:
            _reintentar(
                agregar_item_a_promocion,
                iid,
                promotion_id="",
                promotion_type="PRICE_DISCOUNT",
                deal_price=precio,
                start_date=f"{hoy}T00:00:00",
                finish_date=f"{hoy + dt.timedelta(days=DIAS_VIGENCIA)}T23:59:59",
            )
            out.update(estado="ok", precio=precio, pct=pct_real, original=cand.get("original_price"))
            return out
        except Exception as e:
            ultimo = e
            if "no candidates" not in str(e).lower():
                break
            time.sleep(10)
    out["errores"].append(f"agregar PRICE_DISCOUNT: {ultimo}")
    out["estado"] = "error"
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="ejecuta en MeLi (sin esto: vista previa)")
    ap.add_argument("--pct", type=float, default=10.0, help="descuento propio en %% (default 10)")
    ap.add_argument("--item", action="append", help="solo estos MCO (repetible)")
    ap.add_argument("--hilos", type=int, default=4)
    args = ap.parse_args()

    token = _token_cacheado()
    ids = [i.strip().upper() for i in args.item] if args.item else _items_activos(token)
    print(f"{len(ids)} publicaciones · {'APLICAR' if args.aplicar else 'vista previa'} · {args.pct}%", flush=True)
    with ThreadPoolExecutor(args.hilos) as ex:
        res = list(ex.map(lambda i: procesar(i, args.pct / 100, args.aplicar), ids))

    resumen: dict[str, int] = {}
    for r in res:
        resumen[r["estado"]] = resumen.get(r["estado"], 0) + 1
    print("Resumen:", resumen)
    for r in res:
        if r["estado"] not in ("ok", "ya_ok", "vista_previa") or r["errores"]:
            print(" -", r["id"], r["estado"], r["errores"])
    LOG_DIR.mkdir(exist_ok=True)
    log = LOG_DIR / f"descuento_propio_meli_{dt.datetime.now():%Y%m%d_%H%M%S}.json"
    log.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print("Detalle:", log)


if __name__ == "__main__":
    main()
