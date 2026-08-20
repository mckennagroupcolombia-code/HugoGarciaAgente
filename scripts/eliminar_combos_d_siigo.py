#!/usr/bin/env python3
"""Elimina (o inactiva si DELETE falla) combos SIIGO con prefijo D-."""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.siigo import (  # noqa: E402
    PARTNER_ID,
    autenticar_siigo,
    listar_productos_combo_siigo,
    _invalidar_cache_combos_siigo,
    _precio_lista_siigo_producto,
)

REPORT_DIR = ROOT / "app" / "data"


def _qty(q) -> float | int:
    v = round(float(q or 1), 4)
    if abs(v - round(v)) < 1e-9:
        return int(round(v))
    return v


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }


def _request(method, url, *, headers, json_body=None, timeout=35, retries=6):
    last = None
    for attempt in range(retries):
        try:
            r = requests.request(
                method, url, headers=headers, json=json_body, timeout=timeout
            )
        except requests.RequestException:
            if attempt + 1 >= retries:
                raise
            time.sleep(1.2 * (attempt + 1))
            continue
        last = r
        if r.status_code == 401:
            token = autenticar_siigo(forzar=True)
            if token:
                headers["Authorization"] = f"Bearer {token}"
                time.sleep(0.4)
                continue
        if r.status_code != 429:
            return r
        time.sleep(1.6 * (attempt + 1))
    return last


def _account_group_id(prod: dict) -> int | None:
    ag = prod.get("account_group")
    if isinstance(ag, dict) and ag.get("id") is not None:
        try:
            return int(ag["id"])
        except (TypeError, ValueError):
            return None
    if isinstance(ag, int):
        return ag
    return None


def _unit_code(prod: dict) -> str:
    unit = prod.get("unit")
    if isinstance(unit, dict) and unit.get("code"):
        return str(unit["code"])
    if isinstance(unit, str) and unit:
        return unit
    return "94"


def _taxes_payload(prod: dict) -> list:
    return [
        {"id": t["id"]}
        for t in (prod.get("taxes") or [])
        if isinstance(t, dict) and t.get("id")
    ]


def _fetch_detail(prod: dict, headers: dict) -> dict:
    pid = prod.get("id")
    if not pid:
        return prod
    r = _request("GET", f"https://api.siigo.com/v1/products/{pid}", headers=headers)
    if r is not None and r.status_code == 200:
        return r.json() or prod
    return prod


def _code_por_id(cid, headers: dict, cache: dict) -> str:
    if cid is None:
        return ""
    key = str(cid)
    if key in cache:
        return cache[key]
    r = _request("GET", f"https://api.siigo.com/v1/products/{key}", headers=headers)
    code = ""
    if r is not None and r.status_code == 200:
        code = ((r.json() or {}).get("code") or "").strip()
    cache[key] = code
    return code


def _resolver_componentes(detail: dict, headers: dict, cache: dict) -> tuple[list[dict], list[str]]:
    comps: list[dict] = []
    faltan: list[str] = []
    for c in detail.get("components") or []:
        code = (c.get("code") or "").strip()
        if not code:
            code = _code_por_id(c.get("id"), headers, cache)
        if not code:
            faltan.append(str(c.get("name") or c.get("id") or "?"))
            continue
        comps.append({"code": code, "quantity": _qty(c.get("quantity") or 1)})
    return comps, faltan


def _inactivar(detail: dict, headers: dict, cache: dict) -> dict:
    comps, faltan = _resolver_componentes(detail, headers, cache)
    if faltan:
        return {"ok": False, "error": f"Componentes sin code: {faltan[:4]}"}
    if not comps:
        return {"ok": False, "error": "El combo no trajo componentes"}
    ag = _account_group_id(detail)
    if not ag:
        return {"ok": False, "error": "Sin account_group para inactivar"}
    precio = float(_precio_lista_siigo_producto(detail) or 0) or 1.0
    body = {
        "code": (detail.get("code") or "").strip(),
        "name": (detail.get("name") or "").strip(),
        "account_group": ag,
        "type": "Combo",
        "stock_control": False,
        "active": False,
        "unit": _unit_code(detail),
        "taxes": _taxes_payload(detail),
        "prices": [
            {
                "currency_code": "COP",
                "price_list": [{"position": 1, "value": precio}],
            }
        ],
    }
    body["components"] = comps
    r = _request(
        "PUT",
        f"https://api.siigo.com/v1/products/{detail['id']}",
        headers=headers,
        json_body=body,
    )
    if r is None:
        return {"ok": False, "error": "Sin respuesta PUT inactivar"}
    if r.status_code in (200, 201):
        return {"ok": True, "accion": "inactivado"}
    return {"ok": False, "error": f"PUT {r.status_code}: {(r.text or '')[:280]}"}


def main() -> int:
    token = autenticar_siigo()
    if not token:
        print("ERROR: auth Siigo")
        return 1
    headers = _headers(token)

    combos = [
        p
        for p in (listar_productos_combo_siigo() or [])
        if (p.get("code") or "").upper().startswith("D-")
    ]
    combos.sort(key=lambda p: (p.get("code") or "").upper())
    print(f"[APLICAR] combos D- restantes: {len(combos)}", flush=True)

    resultados = []
    stats = {"deleted": 0, "inactivated": 0, "error": 0}
    cache: dict = {}

    for i, raw in enumerate(combos, 1):
        code = (raw.get("code") or "").strip()
        pid = raw.get("id")
        nombre = (raw.get("name") or "").strip()
        row = {"code": code, "id": pid, "nombre": nombre}
        print(f"[{i}/{len(combos)}] {code} …", flush=True)
        try:
            r = _request(
                "DELETE", f"https://api.siigo.com/v1/products/{pid}", headers=headers
            )
            if r is not None and r.status_code in (200, 204):
                row.update({"ok": True, "accion": "eliminado"})
                stats["deleted"] += 1
                print("    ✔ eliminado", flush=True)
            else:
                status = r.status_code if r is not None else "sin-resp"
                err_txt = (r.text or "")[:280] if r is not None else "sin respuesta"
                print(f"    ⚠ DELETE {status} → inactivar", flush=True)
                detail = _fetch_detail(raw, headers)
                ina = _inactivar(detail, headers, cache)
                row["delete_error"] = f"{status}: {err_txt}"
                row.update(ina)
                if ina.get("ok"):
                    stats["inactivated"] += 1
                    print("    ✔ inactivado", flush=True)
                else:
                    stats["error"] += 1
                    print(f"    ✖ {ina.get('error')}", flush=True)
        except Exception as e:
            row.update({"ok": False, "error": str(e)})
            stats["error"] += 1
            print(f"    ✖ {e}", flush=True)
        resultados.append(row)
        time.sleep(0.35)

    _invalidar_cache_combos_siigo()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = REPORT_DIR / f"eliminar_combos_d_{stamp}.json"
    payload = {
        "modo": "APLICAR",
        "ts": datetime.now().isoformat(timespec="seconds"),
        "total": len(combos),
        "stats": stats,
        "resultados": resultados,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"\nResumen: deleted={stats['deleted']} inactivated={stats['inactivated']} "
        f"err={stats['error']} → {out}",
        flush=True,
    )
    return 0 if stats["error"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
