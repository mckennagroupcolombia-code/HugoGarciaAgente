#!/usr/bin/env python3
"""
Migra combos SIIGO C-* → D-* y deja C-* sin «Operativos Minimos» (OPRMNM4MN).

Estrategia por combo:
  A) Renombrable (PUT acepta los mismos componentes):
       1. PUT code C-XXX → D-XXX (mismos componentes, con operativos)
       2. POST C-XXX nuevo sin OPRMNM4MN
  B) Bloqueado por API (combo anidado / product_settings / non_editable):
       1. POST D-XXX como copia (componentes expandidos + operativos)
       2. C-XXX no se puede editar/borrar por API → queda en reporte `manual_c`

Uso:
  HOME=/home/mckg python3 scripts/migrar_combos_c_a_d_siigo.py
  HOME=/home/mckg python3 scripts/migrar_combos_c_a_d_siigo.py --aplicar
  HOME=/home/mckg python3 scripts/migrar_combos_c_a_d_siigo.py --aplicar --limit 5
  HOME=/home/mckg python3 scripts/migrar_combos_c_a_d_siigo.py --aplicar --solo C-NUEBRA250g
  HOME=/home/mckg python3 scripts/migrar_combos_c_a_d_siigo.py --aplicar --solo C-A,C-B --huerfanos D-X,D-Y
"""
from __future__ import annotations

import argparse
import json
import re
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
    _expandir_lineas_componentes_combo,
    _invalidar_cache_combos_siigo,
    _obtener_producto_siigo_por_codigo,
    _precio_lista_siigo_producto,
    _validar_componente_para_combo,
    autenticar_siigo,
    crear_combo_en_siigo,
    listar_productos_combo_siigo,
)

OP_CODES = {"OPRMNM4MN"}
OP_NAME_RE = re.compile(r"operativos\s+minimos", re.I)
REPORT_DIR = ROOT / "app" / "data"


def _qty_siigo(q: float) -> float | int:
    """Siigo rechaza floats binarios tipo 3.0100000000000002."""
    v = round(float(q), 4)
    if abs(v - round(v)) < 1e-9:
        return int(round(v))
    return v


def _parse_lista_codigos(raw: str) -> list[str]:
    return [c.strip() for c in (raw or "").split(",") if c.strip()]


def _siigo_request(
    method: str,
    url: str,
    *,
    headers: dict,
    json_body: dict | None = None,
    timeout: int = 35,
    retries: int = 5,
) -> requests.Response:
    last: requests.Response | None = None
    for attempt in range(retries):
        try:
            r = requests.request(
                method,
                url,
                headers=headers,
                json=json_body,
                timeout=timeout,
            )
        except requests.RequestException:
            if attempt + 1 >= retries:
                raise
            time.sleep(1.2 * (attempt + 1))
            continue
        last = r
        if r.status_code != 429:
            return r
        time.sleep(1.5 * (attempt + 1))
    assert last is not None
    return last


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }


def _es_operativo(comp: dict) -> bool:
    code = (comp.get("code") or "").strip().upper()
    name = (comp.get("name") or "").strip()
    if code in OP_CODES:
        return True
    return bool(OP_NAME_RE.search(name))


def _d_code(code_c: str) -> str:
    if not code_c.upper().startswith("C-"):
        raise ValueError(code_c)
    return "D-" + code_c[2:]


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


def _precio_put(prod: dict) -> float:
    p = float(_precio_lista_siigo_producto(prod) or 0)
    return p if p > 0 else 1.0


def _fetch_detail(prod: dict, headers: dict) -> dict:
    if prod.get("components") and prod.get("account_group"):
        return prod
    pid = prod.get("id")
    if not pid:
        return prod
    r = requests.get(
        f"https://api.siigo.com/v1/products/{pid}",
        headers=headers,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def _resolver_comps_exactos(
    detail: dict, headers: dict, cache: dict
) -> tuple[list[dict], list[str]]:
    """Componentes tal cual (code real por id), con name para detectar operativos."""
    out: list[dict] = []
    warnings: list[str] = []
    for raw in detail.get("components") or []:
        cid = raw.get("id")
        qty = float(raw.get("quantity") or 1)
        name = (raw.get("name") or "").strip()
        code = (raw.get("code") or "").strip()
        if not code and cid:
            if cache.get(cid):
                code = cache[cid]
            else:
                for attempt in range(3):
                    try:
                        rc = requests.get(
                            f"https://api.siigo.com/v1/products/{cid}",
                            headers=headers,
                            timeout=20,
                        )
                    except requests.RequestException:
                        time.sleep(0.5 * (attempt + 1))
                        continue
                    if rc.status_code in (429, 500, 502, 503):
                        time.sleep(0.8 * (attempt + 1))
                        continue
                    if rc.status_code == 200:
                        d = rc.json() or {}
                        code = (d.get("code") or "").strip()
                        if not name:
                            name = (d.get("name") or "").strip()
                        tipo = (d.get("type") or "").strip()
                        if tipo and tipo.lower() != "product":
                            warnings.append(f"{code or name}:type={tipo}")
                        if d.get("active") is False:
                            warnings.append(f"{code}:inactive")
                        cache[cid] = code
                    break
        if not code:
            warnings.append(f"sin-code:{name or cid}")
        out.append(
            {
                "code": code,
                "name": name,
                "quantity": qty,
                "id": cid,
            }
        )
    return out, warnings


def _comps_expandidos_para_crear(
    comps_exactos: list[dict],
    headers: dict,
    *,
    incluir_operativos: bool = True,
) -> tuple[list[dict], list[str], str]:
    """Expande sin OPRMNM4MN; opcionalmente re-agrega operativos ya resueltos."""
    lineas = [
        (c["code"], float(c["quantity"]))
        for c in comps_exactos
        if c.get("code") and not _es_operativo(c)
    ]
    op_lineas = [
        (c["code"], float(c["quantity"]))
        for c in comps_exactos
        if c.get("code") and _es_operativo(c)
    ]
    if not lineas:
        return [], [], "Sin componentes inventariables tras quitar operativos"
    planos, notas, err = _expandir_lineas_componentes_combo(lineas, headers)
    if err:
        return [], notas, err
    out = []
    for code, qty in planos:
        norm, e = _validar_componente_para_combo(code, _qty_siigo(qty), headers)
        if e or not norm:
            return [], notas, e or f"Componente inválido: {code}"
        norm["quantity"] = _qty_siigo(norm["quantity"])
        out.append(norm)
    if incluir_operativos:
        for code, qty in op_lineas:
            norm, e = _validar_componente_para_combo(code, _qty_siigo(qty), headers)
            if e or not norm:
                notas.append(f"OP omitido ({code}): {e}")
                continue
            norm["quantity"] = _qty_siigo(norm["quantity"])
            out.append(norm)
    return out, notas, ""


def _put_rename(detail: dict, comps_exactos: list[dict], code_d: str, headers: dict) -> dict:
    body = {
        "code": code_d,
        "name": (detail.get("name") or "").strip(),
        "account_group": _account_group_id(detail),
        "type": "Combo",
        "stock_control": False,
        "active": True,
        "unit": _unit_code(detail),
        "taxes": _taxes_payload(detail),
        "components": [
            {"code": c["code"], "quantity": _qty_siigo(c["quantity"])}
            for c in comps_exactos
            if c.get("code")
        ],
        "prices": [
            {
                "currency_code": "COP",
                "price_list": [{"position": 1, "value": _precio_put(detail)}],
            }
        ],
    }
    if not body["account_group"]:
        return {"ok": False, "error": "Sin account_group"}
    if any(not c.get("code") for c in comps_exactos):
        return {"ok": False, "error": "Hay componentes sin code"}
    try:
        r = _siigo_request(
            "PUT",
            f"https://api.siigo.com/v1/products/{detail['id']}",
            headers=headers,
            json_body=body,
            timeout=35,
        )
    except requests.RequestException as e:
        return {"ok": False, "error": f"Red PUT: {e}"}
    if r.status_code in (200, 201):
        return {"ok": True, "mensaje": f"Renombrado → {code_d}"}
    return {"ok": False, "error": f"PUT {r.status_code}: {(r.text or '')[:280]}"}


def _ya_migrado(code_c: str, code_d: str, headers: dict) -> bool:
    c = _obtener_producto_siigo_por_codigo(code_c, headers)
    d = _obtener_producto_siigo_por_codigo(code_d, headers)
    if not (c and d):
        return False
    if c.get("id") == d.get("id"):
        return False
    return (c.get("code") or "").upper().startswith("C-") and (
        d.get("code") or ""
    ).upper().startswith("D-")


def _crear_c_sin_op(
    code_c: str,
    nombre: str,
    comps_expandidos: list[dict],
    *,
    precio: float,
    account_group: int | None,
    iva: bool,
) -> dict:
    comps = [
        {**c, "quantity": _qty_siigo(c.get("quantity") or 1)}
        for c in comps_expandidos
        if (c.get("code") or "").upper() not in OP_CODES
        and not OP_NAME_RE.search(str(c.get("name") or ""))
    ]
    if not comps:
        return {"ok": False, "error": "Sin componentes tras quitar operativos"}
    # Reintentos ante 429 de crear_combo_en_siigo
    last: dict = {}
    for attempt in range(5):
        last = crear_combo_en_siigo(
            code_c,
            nombre,
            comps,
            precio_lista=precio,
            iva=iva,
            account_group=account_group,
        )
        if last.get("ok"):
            return last
        err = str(last.get("error") or "")
        if "429" not in err and "Rate limit" not in err:
            return last
        time.sleep(1.5 * (attempt + 1))
    return last


def _recuperar_huerfano_d(
    code_d: str,
    headers: dict,
    cache: dict,
    *,
    aplicar: bool,
    sleep_s: float,
) -> dict:
    """D- existe y falta C-: recrea C- sin operativos desde los componentes de D."""
    if not code_d.upper().startswith("D-"):
        return {"ok": False, "code_d": code_d, "error": "No es código D-"}
    code_c = "C-" + code_d[2:]
    row: dict = {"code_c": code_c, "code_d": code_d, "ruta": "H"}
    d_prod = _obtener_producto_siigo_por_codigo(code_d, headers)
    if not d_prod:
        row.update({"ok": False, "error": f"{code_d} no existe"})
        return row
    c_prod = _obtener_producto_siigo_por_codigo(code_c, headers)
    if c_prod:
        row.update({"ok": True, "skipped": True, "mensaje": "C ya existe (no huérfano)"})
        return row

    detail = _fetch_detail(d_prod, headers)
    comps_ex, warns = _resolver_comps_exactos(detail, headers, cache)
    removidos = [c for c in comps_ex if _es_operativo(c)]
    row.update(
        {
            "nombre": (detail.get("name") or "").strip(),
            "n_comps": len(comps_ex),
            "removidos": [
                {"code": c.get("code"), "name": c.get("name"), "quantity": c.get("quantity")}
                for c in removidos
            ],
            "warnings": warns,
        }
    )
    comps_crear, notas_exp, err_exp = _comps_expandidos_para_crear(
        comps_ex, headers, incluir_operativos=False
    )
    row["expansion"] = notas_exp
    if err_exp:
        row.update({"ok": False, "error": f"Expandir: {err_exp}"})
        return row

    if not aplicar:
        row.update({"ok": True, "accion": "dry-run-huerfano"})
        return row

    r2 = _crear_c_sin_op(
        code_c,
        (detail.get("name") or "").strip(),
        comps_crear,
        precio=_precio_put(detail),
        account_group=_account_group_id(detail),
        iva=bool(_taxes_payload(detail)),
    )
    row["create_c"] = {
        "ok": r2.get("ok"),
        "mensaje": r2.get("mensaje") or r2.get("error"),
        "siigo_id": r2.get("siigo_id"),
    }
    if r2.get("ok"):
        row["ok"] = True
        row["mensaje"] = f"Recuperado: creado {code_c} sin operativos"
    else:
        row["ok"] = False
        row["error"] = r2.get("error")
    time.sleep(sleep_s)
    return row


def _procesar_combo_c(
    raw: dict,
    headers: dict,
    cache: dict,
    *,
    aplicar: bool,
    sleep_s: float,
    i: int,
    total: int,
    stats: dict,
) -> dict:
    code_c = (raw.get("code") or "").strip()
    code_d = _d_code(code_c)
    row: dict = {"code_c": code_c, "code_d": code_d}

    detail = _fetch_detail(raw, headers)
    comps_ex, warns = _resolver_comps_exactos(detail, headers, cache)
    removidos = [c for c in comps_ex if _es_operativo(c)]
    row.update(
        {
            "nombre": (detail.get("name") or "").strip(),
            "n_comps": len(comps_ex),
            "removidos": [
                {"code": c.get("code"), "name": c.get("name"), "quantity": c.get("quantity")}
                for c in removidos
            ],
            "warnings": warns,
        }
    )

    if _ya_migrado(code_c, code_d, headers):
        print(f"[{i}/{total}] {code_c} ✔ ya migrado", flush=True)
        row.update({"ok": True, "skipped": True, "mensaje": "ya migrado"})
        stats["ok"] += 1
        stats["skip"] += 1
        return row

    comps_crear_d, notas_exp, err_exp = _comps_expandidos_para_crear(
        comps_ex, headers, incluir_operativos=True
    )
    comps_crear_c, _, err_c = _comps_expandidos_para_crear(
        comps_ex, headers, incluir_operativos=False
    )
    if err_exp and err_c:
        row.update({"ok": False, "error": f"Expandir: {err_exp or err_c}"})
        stats["error"] += 1
        print(f"[{i}/{total}] {code_c} ✖ expand: {err_exp or err_c}", flush=True)
        return row
    if err_c:
        row.update({"ok": False, "error": f"Expandir C: {err_c}"})
        stats["error"] += 1
        print(f"[{i}/{total}] {code_c} ✖ expand C: {err_c}", flush=True)
        return row
    if err_exp:
        # D sin OP si no se pudo validar OP; mejor que abortar
        comps_crear_d = comps_crear_c
        notas_exp = [f"D sin OP (fallback): {err_exp}"]

    row["ruta"] = "A"
    print(
        f"[{i}/{total}] {code_c} → {code_d} | intento A | "
        f"comps {len(comps_ex)} quita {len(removidos)}"
        + (f" | warn {warns[:2]}" if warns else ""),
        flush=True,
    )

    if not aplicar:
        if any("type=Combo" in w for w in warns):
            row["ruta"] = "B"
            stats["ruta_b"] += 1
        else:
            stats["ruta_a"] += 1
        row["ok"] = True
        row["accion"] = "dry-run"
        stats["ok"] += 1
        return row

    precio = _precio_put(detail)
    ag = _account_group_id(detail)
    iva = bool(_taxes_payload(detail))
    nombre = (detail.get("name") or "").strip()

    stats["ruta_a"] += 1
    r1 = _put_rename(detail, comps_ex, code_d, headers)
    row["rename"] = r1
    if r1.get("ok"):
        print(f"    ✔ {r1.get('mensaje')}", flush=True)
        time.sleep(sleep_s)
        r2 = _crear_c_sin_op(
            code_c,
            nombre,
            comps_crear_c,
            precio=precio,
            account_group=ag,
            iva=iva,
        )
        row["create_c"] = {
            "ok": r2.get("ok"),
            "mensaje": r2.get("mensaje") or r2.get("error"),
            "siigo_id": r2.get("siigo_id"),
        }
        if not r2.get("ok"):
            row["ok"] = False
            row["error"] = r2.get("error")
            stats["error"] += 1
            print(f"    ✖ create C: {r2.get('error')}", flush=True)
        else:
            row["ok"] = True
            row["ruta"] = "A"
            stats["ok"] += 1
            print("    ✔ C sin operativos", flush=True)
        time.sleep(sleep_s)
        return row

    print(f"    ⚠ rename falló → ruta B: {r1.get('error')}", flush=True)
    row["ruta"] = "B"
    stats["ruta_a"] -= 1
    stats["ruta_b"] += 1

    d_exist = _obtener_producto_siigo_por_codigo(code_d, headers)
    if d_exist:
        row["create_d"] = {
            "ok": True,
            "skipped": True,
            "mensaje": f"{code_d} ya existía",
            "siigo_id": d_exist.get("id"),
        }
        print(f"    ✔ {code_d} ya existía", flush=True)
    else:
        r_d = None
        for attempt in range(5):
            r_d = crear_combo_en_siigo(
                code_d,
                nombre,
                comps_crear_d,
                precio_lista=precio,
                iva=iva,
                account_group=ag,
            )
            if r_d.get("ok"):
                break
            err = str(r_d.get("error") or "")
            if "429" not in err and "Rate limit" not in err:
                break
            time.sleep(1.5 * (attempt + 1))
        assert r_d is not None
        row["create_d"] = {
            "ok": r_d.get("ok"),
            "mensaje": r_d.get("mensaje") or r_d.get("error"),
            "siigo_id": r_d.get("siigo_id"),
            "expansion": notas_exp,
        }
        if not r_d.get("ok"):
            row["ok"] = False
            row["error"] = r_d.get("error")
            stats["error"] += 1
            print(f"    ✖ create D: {r_d.get('error')}", flush=True)
            return row
        print(f"    ✔ creado {code_d}", flush=True)

    row["ok"] = True
    row["manual_c"] = True
    row["mensaje"] = (
        "D creado/ok; C- no editable por API. "
        "Quitar OPRMNM4MN a mano en Siigo Nube."
    )
    stats["ok"] += 1
    stats["manual_c"] += 1
    print("    ⚠ C queda pendiente manual", flush=True)
    time.sleep(sleep_s)
    return row


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--solo", type=str, default="", help="C-... separados por coma")
    ap.add_argument(
        "--huerfanos",
        type=str,
        default="",
        help="D-... sin C- a recuperar, separados por coma",
    )
    ap.add_argument("--sleep", type=float, default=0.6)
    args = ap.parse_args()

    token = autenticar_siigo()
    if not token:
        print("ERROR: auth Siigo")
        return 1
    headers = _headers(token)

    solo = {c.upper() for c in _parse_lista_codigos(args.solo)}
    huerfanos = _parse_lista_codigos(args.huerfanos)

    if solo:
        combos = []
        faltan = set()
        for code in sorted(solo):
            p = _obtener_producto_siigo_por_codigo(code, headers)
            if p and (p.get("code") or "").upper().startswith("C-"):
                combos.append(p)
            else:
                faltan.add(code)
        for code in list(faltan):
            if not code.startswith("C-"):
                continue
            dcode = "D-" + code[2:]
            if _obtener_producto_siigo_por_codigo(dcode, headers) and not _obtener_producto_siigo_por_codigo(
                code, headers
            ):
                huerfanos.append(dcode)
                faltan.discard(code)
        if faltan:
            print(f"AVISO: no encontrados como C-: {sorted(faltan)}", flush=True)
    else:
        combos = [
            p
            for p in (listar_productos_combo_siigo() or [])
            if (p.get("code") or "").upper().startswith("C-")
        ]

    combos.sort(key=lambda p: (p.get("code") or "").upper())
    if args.limit > 0:
        combos = combos[: args.limit]

    modo = "APLICAR" if args.aplicar else "DRY-RUN"
    print(
        f"[{modo}] candidatos C-: {len(combos)} | huérfanos D-: {len(huerfanos)}",
        flush=True,
    )

    cache: dict = {}
    resultados = []
    stats = {
        "ok": 0,
        "error": 0,
        "skip": 0,
        "manual_c": 0,
        "ruta_a": 0,
        "ruta_b": 0,
        "huerfanos_ok": 0,
        "huerfanos_err": 0,
    }

    for i, raw in enumerate(combos, 1):
        try:
            row = _procesar_combo_c(
                raw,
                headers,
                cache,
                aplicar=args.aplicar,
                sleep_s=args.sleep,
                i=i,
                total=len(combos),
                stats=stats,
            )
            resultados.append(row)
        except Exception as e:
            code_c = (raw.get("code") or "").strip()
            row = {"code_c": code_c, "code_d": _d_code(code_c), "ok": False, "error": str(e)}
            resultados.append(row)
            stats["error"] += 1
            print(f"[{i}/{len(combos)}] {code_c} ✖ {e}", flush=True)

    for j, code_d in enumerate(huerfanos, 1):
        print(f"[H {j}/{len(huerfanos)}] recuperar {code_d}", flush=True)
        try:
            row = _recuperar_huerfano_d(
                code_d.strip(),
                headers,
                cache,
                aplicar=args.aplicar,
                sleep_s=args.sleep,
            )
            resultados.append(row)
            if row.get("ok"):
                stats["ok"] += 1
                stats["huerfanos_ok"] += 1
                if row.get("skipped"):
                    stats["skip"] += 1
                print(f"    ✔ {row.get('mensaje') or 'ok'}", flush=True)
            else:
                stats["error"] += 1
                stats["huerfanos_err"] += 1
                print(f"    ✖ {row.get('error')}", flush=True)
        except Exception as e:
            resultados.append({"code_d": code_d, "ok": False, "error": str(e)})
            stats["error"] += 1
            stats["huerfanos_err"] += 1
            print(f"    ✖ {e}", flush=True)

    _invalidar_cache_combos_siigo()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = REPORT_DIR / f"migracion_combos_c_a_d_{stamp}.json"
    payload = {
        "modo": modo,
        "ts": datetime.now().isoformat(timespec="seconds"),
        "total": len(combos) + len(huerfanos),
        "stats": stats,
        "resultados": resultados,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"\nResumen: ok={stats['ok']} err={stats['error']} skip={stats['skip']} "
        f"manual_c={stats['manual_c']} huerfanos_ok={stats['huerfanos_ok']} "
        f"rutaA={stats['ruta_a']} rutaB={stats['ruta_b']} → {out}",
        flush=True,
    )
    return 0 if stats["error"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
