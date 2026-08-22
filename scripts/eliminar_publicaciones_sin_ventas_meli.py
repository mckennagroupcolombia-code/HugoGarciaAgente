#!/usr/bin/env python3
"""
Inventaría publicaciones MeLi sin ventas pagadas en los últimos N meses y
crea un ticket en el Centro de Mando para que un operador las revise una a
una — este script NUNCA cierra ni elimina publicaciones por sí mismo.

(Hasta 2026-08-18 sí lo hacía automáticamente con --ejecutar: cerró/eliminó
22 publicaciones sin comprobar antes si el ítem era demasiado nuevo para
haber tenido ventas, incluyendo dos creadas 23 días antes. Se removió esa
ruta automática por eso.)

Omite del inventario: closed/inactive, fulfillment (Full), under_review.

Uso:
  python3 scripts/eliminar_publicaciones_sin_ventas_meli.py
  python3 scripts/eliminar_publicaciones_sin_ventas_meli.py --meses 6
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.utils import refrescar_token_meli  # noqa: E402

MELI_API = "https://api.mercadolibre.com"
_NO_OPERABLES = frozenset({"closed", "inactive"})
_REPORT_DIR = ROOT / "app" / "data"
_CREDS_PATH = ROOT / "credenciales_meli.json"
_TICKETS_DB_PATH = ROOT / "app" / "data" / "tickets.db"


def _token_meli() -> str:
    """Prefiere refresh; si el archivo de creds es de solo lectura, usa access_token vigente."""
    try:
        token = refrescar_token_meli()
        if token:
            return token
    except Exception as e:
        print(f"⚠️ refresh token falló ({e}); intento access_token en disco")
    try:
        creds = json.loads(_CREDS_PATH.read_text(encoding="utf-8"))
        token = (creds.get("access_token") or "").strip()
        if not token:
            raise RuntimeError("access_token vacío en credenciales_meli.json")
        # Validación rápida
        r = requests.get(
            f"{MELI_API}/users/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
        if r.status_code != 200:
            raise RuntimeError(f"access_token inválido HTTP {r.status_code}")
        return token
    except Exception as e:
        raise RuntimeError(f"Token MeLi no disponible: {e}") from e


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _seller_id(headers: dict):
    r = requests.get(f"{MELI_API}/users/me", headers=headers, timeout=20)
    r.raise_for_status()
    sid = (r.json() or {}).get("id")
    if not sid:
        raise RuntimeError("No se pudo obtener seller_id MeLi")
    return sid


def _ventas_paid_por_item(
    headers: dict, seller_id, desde: datetime, hasta: datetime
) -> dict[str, int]:
    """Unidades pagadas por MCO… en [desde, hasta]. Parte el rango si offset ≥ 9950."""
    url = f"{MELI_API}/orders/search"
    params = {
        "seller": seller_id,
        "order.date_created.from": desde.strftime("%Y-%m-%dT00:00:00.000-05:00"),
        "order.date_created.to": hasta.strftime("%Y-%m-%dT23:59:59.000-05:00"),
        "order.status": "paid",
        "sort": "date_asc",
        "limit": 50,
        "offset": 0,
    }
    por_item: dict[str, int] = {}
    offset = 0
    while True:
        params["offset"] = offset
        r = requests.get(url, headers=headers, params=params, timeout=40)
        if r.status_code != 200:
            raise RuntimeError(
                f"orders/search HTTP {r.status_code}: {(r.text or '')[:200]}"
            )
        data = r.json() or {}
        results = data.get("results") or []
        for ord_ in results:
            for oi in ord_.get("order_items") or []:
                item = oi.get("item") or {}
                mid = str(item.get("id") or "").strip().upper()
                qty = int(oi.get("quantity") or 0)
                if mid.startswith("MCO") and qty > 0:
                    por_item[mid] = por_item.get(mid, 0) + qty
        total = int((data.get("paging") or {}).get("total") or 0)
        offset += len(results)
        if offset >= total or not results:
            break
        if offset >= 9950:
            if hasta - desde <= timedelta(days=1):
                break
            mitad = desde + (hasta - desde) / 2
            izquierda = _ventas_paid_por_item(headers, seller_id, desde, mitad)
            derecha = _ventas_paid_por_item(
                headers, seller_id, mitad + timedelta(seconds=1), hasta
            )
            for mid, qty in izquierda.items():
                por_item[mid] = por_item.get(mid, 0) + qty
            for mid, qty in derecha.items():
                por_item[mid] = por_item.get(mid, 0) + qty
            return por_item
    return por_item


def _listar_item_ids(seller_id, headers: dict, status: str) -> list[str]:
    ids: list[str] = []
    offset = 0
    while True:
        r = requests.get(
            f"{MELI_API}/users/{seller_id}/items/search",
            params={"status": status, "limit": 100, "offset": offset},
            headers=headers,
            timeout=40,
        )
        if r.status_code >= 400:
            raise RuntimeError(
                f"items/search status={status} HTTP {r.status_code}: {(r.text or '')[:200]}"
            )
        data = r.json() or {}
        batch = data.get("results") or []
        if not batch:
            break
        ids.extend(str(x) for x in batch)
        offset += len(batch)
        total = int((data.get("paging") or {}).get("total") or 0)
        if offset >= total:
            break
        if offset > 20000:
            break
    return ids


def _multiget(ids: list[str], headers: dict) -> list[dict]:
    out: list[dict] = []
    for i in range(0, len(ids), 20):
        lote = ids[i : i + 20]
        r = requests.get(
            f"{MELI_API}/items",
            params={"ids": ",".join(lote)},
            headers=headers,
            timeout=45,
        )
        if r.status_code >= 400:
            print(f"⚠️ multiget HTTP {r.status_code}: {(r.text or '')[:160]}")
            continue
        for row in r.json() or []:
            if row.get("code") == 200 and isinstance(row.get("body"), dict):
                out.append(row["body"])
        time.sleep(0.05)
    return out


def _sku_de_item(item: dict) -> str:
    for a in item.get("attributes") or []:
        if a.get("id") == "SELLER_SKU":
            return (a.get("value_name") or "").strip()
    return (item.get("seller_custom_field") or "").strip()


def inventariar(meses: int) -> dict:
    token = _token_meli()
    headers = _headers(token)
    seller_id = _seller_id(headers)

    ids_active = _listar_item_ids(seller_id, headers, "active")
    ids_paused = _listar_item_ids(seller_id, headers, "paused")
    vistos: set[str] = set()
    all_ids: list[str] = []
    for iid in ids_active + ids_paused:
        if iid not in vistos:
            vistos.add(iid)
            all_ids.append(iid)

    print(f"📦 Publicaciones active={len(ids_active)} paused={len(ids_paused)} únicas={len(all_ids)}")

    ahora = datetime.now()
    desde = ahora - timedelta(days=int(meses * 30.44))
    print(
        f"🔎 Ventas pagadas {desde.date()} → {ahora.date()} "
        f"(~{meses} meses)…"
    )
    ventas = _ventas_paid_por_item(headers, seller_id, desde, ahora)
    print(f"✅ Ítems con ≥1 venta en el período: {len(ventas)}")

    detalles = _multiget(all_ids, headers)
    candidatos: list[dict] = []
    omitidos: list[dict] = []
    con_ventas = 0

    for item in detalles:
        mid = str(item.get("id") or "").upper()
        status = (item.get("status") or "").lower()
        logistic = ((item.get("shipping") or {}).get("logistic_type") or "").lower()
        titulo = (item.get("title") or "")[:80]
        sku = _sku_de_item(item)
        uds = int(ventas.get(mid, 0) or 0)

        base = {
            "meli_id": mid,
            "sku": sku,
            "titulo": titulo,
            "status": status,
            "logistic_type": logistic,
            "sold_quantity_lifetime": int(item.get("sold_quantity") or 0),
            "unidades_periodo": uds,
            "permalink": item.get("permalink") or "",
        }

        if status in _NO_OPERABLES:
            omitidos.append({**base, "razon": f"ya_{status}"})
            continue
        if status == "under_review":
            omitidos.append({**base, "razon": "under_review"})
            continue
        if logistic == "fulfillment":
            omitidos.append({**base, "razon": "fulfillment_full"})
            continue
        if uds > 0:
            con_ventas += 1
            continue

        candidatos.append(base)

    return {
        "generado_en": ahora.strftime("%Y-%m-%dT%H:%M:%S"),
        "meses": meses,
        "desde": desde.strftime("%Y-%m-%d"),
        "hasta": ahora.strftime("%Y-%m-%d"),
        "total_publicaciones": len(all_ids),
        "con_ventas_periodo": con_ventas,
        "candidatos": sorted(candidatos, key=lambda x: (x.get("sku") or "", x["meli_id"])),
        "omitidos": omitidos,
        "resumen_omitidos": _contar_razones(omitidos),
    }


def _contar_razones(omitidos: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for o in omitidos:
        r = o.get("razon") or "?"
        out[r] = out.get(r, 0) + 1
    return out


def _crear_ticket_revision_manual(candidatos: list[dict], meses: int) -> str | None:
    """Crea un ticket en el Centro de Mando listando los candidatos, para que
    un operador decida caso por caso — este script no cierra nada por su cuenta."""
    if not candidatos:
        return None
    try:
        from app.services.tickets_db import crear_ticket, init_db

        init_db()
        db = sqlite3.connect(_TICKETS_DB_PATH)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
        if not row:
            row = db.execute(
                "SELECT id FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1"
            ).fetchone()
        creador_id = int(row["id"]) if row else None
        db.close()
        if not creador_id:
            print("⚠️ No hay usuario admin/activo en el Centro de Mando; no se crea ticket")
            return None

        lineas = [
            f"- {c['meli_id']}  sku={c.get('sku') or '-'}  hist_sold={c.get('sold_quantity_lifetime')}  "
            f"{c.get('titulo')}\n  {c.get('permalink')}"
            for c in candidatos
        ]
        descripcion = (
            f"Publicaciones MeLi sin ventas pagadas en los últimos {meses} meses "
            f"({len(candidatos)} candidatas). Revisar una a una antes de cerrarlas: "
            "puede ser un ítem nuevo que aún no ha tenido tiempo de vender.\n\n"
            + "\n".join(lineas)
        )
        data = {
            "tipo": "accion",
            "titulo": f"Revisar {len(candidatos)} publicaciones MeLi sin ventas ({meses}m)",
            "categoria": "operaciones",
            "descripcion": descripcion,
            "prioridad": "media",
        }
        ticket, err = crear_ticket(data, creador_id, None)
        if err:
            print(f"⚠️ No se pudo crear el ticket: {err}")
            return None
        return f"#{ticket.get('id')}"
    except Exception as e:
        print(f"⚠️ No se pudo crear el ticket de revisión manual: {e}")
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--meses", type=int, default=6, help="Meses sin ventas (default 6)")
    args = ap.parse_args()
    if args.meses < 1 or args.meses > 24:
        print("❌ --meses debe estar entre 1 y 24")
        return 2

    inv = inventariar(args.meses)
    candidatos = inv["candidatos"]
    print(
        f"\n📋 Candidatos sin ventas en {args.meses} meses: {len(candidatos)} "
        f"(con ventas en período: {inv['con_ventas_periodo']}; "
        f"omitidos: {inv['resumen_omitidos']})"
    )
    for c in candidatos[:30]:
        print(
            f"  - {c['meli_id']}  [{c['status']}]  sku={c['sku'] or '-'}  "
            f"hist_sold={c['sold_quantity_lifetime']}  {c['titulo']}"
        )
    if len(candidatos) > 30:
        print(f"  … y {len(candidatos) - 30} más")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = _REPORT_DIR / f"meli_sin_ventas_{args.meses}m_{stamp}.json"
    os.makedirs(_REPORT_DIR, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(inv, f, ensure_ascii=False, indent=2)
    print(f"\n💾 Inventario guardado: {report_path}")

    ticket_ref = _crear_ticket_revision_manual(candidatos, args.meses)
    if ticket_ref:
        print(f"🎫 Ticket {ticket_ref} creado en el Centro de Mando para revisión manual.")
    elif candidatos:
        print("ℹ️  Hay candidatos pero no se pudo crear el ticket (ver aviso arriba).")

    print(
        "ℹ️  Este script no cierra ni elimina nada — cada publicación se revisa "
        "y se cierra manualmente desde el panel o MeLi si corresponde."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
