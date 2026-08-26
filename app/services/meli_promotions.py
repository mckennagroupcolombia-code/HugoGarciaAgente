"""Promociones Mercado Libre (seller-promotions v2).

Lista campañas del vendedor, consulta elegibilidad por ítem y opt-in/opt-out.
"""
from __future__ import annotations

from typing import Any

import requests

from app.utils import refrescar_token_meli

MELI_API = "https://api.mercadolibre.com"
APP_V2 = {"app_version": "v2"}

# Campañas que se aceptan con offer_id (candidato).
TYPES_OFFER_ID = frozenset(
    {
        "SMART",
        "PRICE_MATCHING",
        "MARKETPLACE_CAMPAIGN",
        "VOLUME",
        "PRE_NEGOTIATED",
        "UNHEALTHY_STOCK",
    }
)

# Campañas donde el vendedor define deal_price.
TYPES_DEAL_PRICE = frozenset(
    {
        "DEAL",
        "DOD",
        "LIGHTNING",
        "SELLER_CAMPAIGN",
        "PRICE_DISCOUNT",
    }
)

# Relámpago / oferta del día: MeLi exige stock reservado en el POST.
TYPES_REQUIRE_STOCK = frozenset({"LIGHTNING", "DOD"})

# Estados de campaña en los que aún se puede sumar ítems.
STATUSES_JOINABLE = frozenset({"started", "pending"})


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _meli_error_text(resp: requests.Response) -> str:
    try:
        body = resp.json()
    except Exception:
        return (resp.text or f"HTTP {resp.status_code}")[:400]
    if isinstance(body, dict):
        msg = body.get("message") or body.get("error") or ""
        causes = body.get("cause") or []
        if isinstance(causes, list) and causes:
            bits = []
            for c in causes[:4]:
                if isinstance(c, dict):
                    bits.append(
                        c.get("error_message")
                        or c.get("message")
                        or c.get("error_code")
                        or str(c)
                    )
                else:
                    bits.append(str(c))
            if bits:
                msg = f"{msg}: {'; '.join(bits)}" if msg else "; ".join(bits)
        return (msg or str(body))[:500]
    return str(body)[:500]


def _seller_id(token: str) -> int:
    r = requests.get(f"{MELI_API}/users/me", headers=_headers(token), timeout=20)
    r.raise_for_status()
    return int(r.json()["id"])


def stock_reservar(stock: Any) -> int | None:
    """Stock a reservar en opt-in. Acepta int o `{min, max}` del candidato MeLi."""
    if isinstance(stock, dict):
        for k in ("min", "min_stock"):
            v = stock.get(k)
            if v is None:
                continue
            try:
                n = int(v)
            except (TypeError, ValueError):
                continue
            if n > 0:
                return n
        return None
    if isinstance(stock, bool) or stock is None:
        return None
    try:
        n = int(stock)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def modo_optin(promotion_type: str) -> str:
    t = (promotion_type or "").upper()
    if t in TYPES_OFFER_ID:
        return "offer_id"
    if t in TYPES_DEAL_PRICE:
        return "deal_price"
    # Fallback: si hay ref_id en el ítem, preferir offer_id.
    return "offer_id"


def listar_promociones_vendedor(*, status_filter: str | None = None) -> dict[str, Any]:
    """GET /seller-promotions/users/{id}?app_version=v2"""
    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token MeLi no disponible")
    seller_id = _seller_id(token)
    r = requests.get(
        f"{MELI_API}/seller-promotions/users/{seller_id}",
        headers=_headers(token),
        params=APP_V2,
        timeout=40,
    )
    if r.status_code != 200:
        raise RuntimeError(_meli_error_text(r))
    data = r.json() or {}
    results = list(data.get("results") or [])
    if status_filter:
        sf = status_filter.lower()
        results = [p for p in results if (p.get("status") or "").lower() == sf]
    else:
        results = [
            p for p in results if (p.get("status") or "").lower() in STATUSES_JOINABLE
        ]
    out = []
    for p in results:
        out.append(
            {
                "id": p.get("id"),
                "type": p.get("type"),
                "status": p.get("status"),
                "name": p.get("name") or p.get("id"),
                "start_date": p.get("start_date"),
                "finish_date": p.get("finish_date"),
                "deadline_date": p.get("deadline_date"),
                "benefits": p.get("benefits"),
                "modo_optin": modo_optin(str(p.get("type") or "")),
            }
        )
    return {
        "seller_id": seller_id,
        "promociones": out,
        "total": len(out),
        "paging": data.get("paging") or {},
    }


def _pct(n: float | None, digits: int = 1) -> float | None:
    if n is None:
        return None
    try:
        return round(float(n), digits)
    except (TypeError, ValueError):
        return None


def _descuento_pct(original: Any, promo: Any) -> float | None:
    try:
        o = float(original)
        p = float(promo)
    except (TypeError, ValueError):
        return None
    if o <= 0 or p <= 0 or p >= o:
        return None
    return round((1.0 - (p / o)) * 100.0, 1)


def _campanas_por_id(token: str) -> dict[str, dict[str, Any]]:
    """Mapa id → fechas/nombre desde la lista del vendedor (rellena SMART sin fechas)."""
    try:
        seller_id = _seller_id(token)
        r = requests.get(
            f"{MELI_API}/seller-promotions/users/{seller_id}",
            headers=_headers(token),
            params=APP_V2,
            timeout=40,
        )
        if r.status_code != 200:
            return {}
        out: dict[str, dict[str, Any]] = {}
        for p in r.json().get("results") or []:
            pid = p.get("id")
            if not pid:
                continue
            out[str(pid)] = {
                "name": p.get("name"),
                "start_date": p.get("start_date"),
                "finish_date": p.get("finish_date"),
                "deadline_date": p.get("deadline_date"),
                "status": p.get("status"),
            }
        return out
    except Exception:
        return {}


def promociones_del_item(meli_id: str) -> dict[str, Any]:
    """GET /seller-promotions/items/{ITEM_ID}?app_version=v2"""
    meli_id = (meli_id or "").strip().upper()
    if not meli_id:
        raise ValueError("meli_id requerido")
    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token MeLi no disponible")
    r = requests.get(
        f"{MELI_API}/seller-promotions/items/{meli_id}",
        headers=_headers(token),
        params=APP_V2,
        timeout=40,
    )
    if r.status_code != 200:
        raise RuntimeError(_meli_error_text(r))
    raw = r.json()
    if not isinstance(raw, list):
        raw = []

    # Fechas de campaña (SMART/etc. suelen no traerlas en el GET por ítem).
    need_campaign_dates = any(
        isinstance(p, dict)
        and p.get("id")
        and not (p.get("start_date") or p.get("finish_date") or p.get("end_date"))
        for p in raw
    )
    campanas = _campanas_por_id(token) if need_campaign_dates else {}

    candidatas: list[dict[str, Any]] = []
    activas: list[dict[str, Any]] = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        status = (p.get("status") or "").lower()
        ptype = str(p.get("type") or "")
        pid = p.get("id")
        camp = campanas.get(str(pid)) if pid else None

        start = p.get("start_date") or (camp or {}).get("start_date")
        finish = (
            p.get("finish_date")
            or p.get("end_date")
            or (camp or {}).get("finish_date")
        )
        name = p.get("name") or (camp or {}).get("name") or pid or ptype

        # Precio sugerido / vigente para % y input
        sugerido = (
            p.get("suggested_discounted_price")
            or (p.get("price") if p.get("price") not in (None, 0, 0.0) else None)
            or p.get("max_discounted_price")
        )
        original = p.get("original_price")
        meli_pct = _pct(p.get("meli_percentage"))
        seller_pct = _pct(p.get("seller_percentage"))
        descuento_pct = _descuento_pct(original, sugerido)
        # En co-fondeadas el total ≈ aporte MeLi + vendedor
        if descuento_pct is None and meli_pct is not None and seller_pct is not None:
            descuento_pct = _pct(meli_pct + seller_pct)

        row = {
            "id": pid,
            "type": ptype,
            "status": status,
            "name": name,
            "price": p.get("price"),
            "original_price": original,
            "meli_percentage": meli_pct,
            "seller_percentage": seller_pct,
            "descuento_pct": descuento_pct,
            "ref_id": p.get("ref_id") or p.get("offer_id"),
            "min_discounted_price": p.get("min_discounted_price"),
            "max_discounted_price": p.get("max_discounted_price"),
            "suggested_discounted_price": p.get("suggested_discounted_price"),
            "start_date": start,
            "finish_date": finish,
            "deadline_date": (camp or {}).get("deadline_date") or p.get("deadline_date"),
            "stock": stock_reservar(p.get("stock")),
            "modo_optin": modo_optin(ptype),
            "precio_sugerido": sugerido,
        }
        if status == "candidate":
            candidatas.append(row)
        elif status in ("started", "pending", "active", "programmed"):
            activas.append(row)
    return {
        "meli_id": meli_id,
        "candidatas": candidatas,
        "activas": activas,
        "total_candidatas": len(candidatas),
        "total_activas": len(activas),
    }


def cuerpo_optin_meli(
    *,
    promotion_type: str,
    promotion_id: str = "",
    offer_id: str | None = None,
    deal_price: float | None = None,
    top_deal_price: float | None = None,
    start_date: str | None = None,
    finish_date: str | None = None,
    stock: int | None = None,
) -> dict[str, Any]:
    """Arma el JSON de POST /seller-promotions/items/{id} (sin llamar a MeLi)."""
    promotion_type = (promotion_type or "").strip().upper()
    promotion_id = (promotion_id or "").strip()
    if not promotion_type:
        raise ValueError("promotion_type es requerido")
    if not promotion_id and promotion_type != "PRICE_DISCOUNT":
        raise ValueError("promotion_id es requerido")

    body: dict[str, Any] = {"promotion_type": promotion_type}
    if promotion_id:
        body["promotion_id"] = promotion_id

    mode = modo_optin(promotion_type)
    oid = (offer_id or "").strip()
    sd = (start_date or "").strip()
    fd = (finish_date or "").strip()

    if mode == "deal_price" or (
        deal_price is not None and promotion_type in TYPES_DEAL_PRICE
    ):
        if deal_price is None or float(deal_price) <= 0:
            raise ValueError("deal_price requerido y debe ser > 0")
        body["deal_price"] = float(deal_price)
        if top_deal_price is not None and float(top_deal_price) > 0:
            body["top_deal_price"] = float(top_deal_price)
        if promotion_type == "PRICE_DISCOUNT":
            if not sd or not fd:
                raise ValueError(
                    "PRICE_DISCOUNT requiere start_date y finish_date (máx. 14 días)"
                )
            body["start_date"] = sd
            body["finish_date"] = fd
        if oid:
            body["offer_id"] = oid
    else:
        if not oid:
            raise ValueError(
                "offer_id (candidato) requerido para este tipo de promoción"
            )
        body["offer_id"] = oid
        # SMART Relámpago rechaza si falta START_DATE.
        if sd:
            body["start_date"] = sd
        if fd:
            body["finish_date"] = fd

    if promotion_type in TYPES_REQUIRE_STOCK:
        n = stock_reservar(stock)
        if n is None:
            raise ValueError(
                "Lightning / oferta del día exige stock reservado (mínimo del candidato)"
            )
        body["stock"] = n

    return body


def agregar_item_a_promocion(
    meli_id: str,
    *,
    promotion_id: str,
    promotion_type: str,
    offer_id: str | None = None,
    deal_price: float | None = None,
    top_deal_price: float | None = None,
    start_date: str | None = None,
    finish_date: str | None = None,
    stock: int | None = None,
) -> dict[str, Any]:
    """POST /seller-promotions/items/{ITEM_ID}?app_version=v2"""
    meli_id = (meli_id or "").strip().upper()
    promotion_id = (promotion_id or "").strip()
    promotion_type = (promotion_type or "").strip().upper()
    if not meli_id or not promotion_type:
        raise ValueError("meli_id y promotion_type son requeridos")
    # PRICE_DISCOUNT individual a veces no trae promotion_id en el candidato
    if not promotion_id and promotion_type != "PRICE_DISCOUNT":
        raise ValueError("promotion_id es requerido")

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token MeLi no disponible")

    oid = (offer_id or "").strip() or None
    sd = (start_date or "").strip() or None
    fd = (finish_date or "").strip() or None
    st = stock_reservar(stock)
    need_lookup = (
        (modo_optin(promotion_type) == "offer_id" and not oid)
        or (promotion_type == "SMART" and (not sd or not fd))
        or (promotion_type in TYPES_REQUIRE_STOCK and st is None)
    )
    if need_lookup:
        try:
            info = promociones_del_item(meli_id)
        except Exception:
            info = {}
        for c in info.get("candidatas") or []:
            cid = str(c.get("id") or "")
            ctype = str(c.get("type") or "").upper()
            same = (cid and cid == promotion_id) or (
                not promotion_id and ctype == promotion_type
            )
            if not same:
                continue
            if not oid and c.get("ref_id"):
                oid = str(c["ref_id"])
            if not sd and c.get("start_date"):
                sd = str(c["start_date"])
            if not fd and c.get("finish_date"):
                fd = str(c["finish_date"])
            if st is None:
                st = stock_reservar(c.get("stock"))
            break

    body = cuerpo_optin_meli(
        promotion_type=promotion_type,
        promotion_id=promotion_id,
        offer_id=oid,
        deal_price=deal_price,
        top_deal_price=top_deal_price,
        start_date=sd,
        finish_date=fd,
        stock=st,
    )

    r = requests.post(
        f"{MELI_API}/seller-promotions/items/{meli_id}",
        headers=_headers(token),
        params=APP_V2,
        json=body,
        timeout=45,
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(_meli_error_text(r))
    try:
        data = r.json() if r.content else {}
    except Exception:
        data = {}
    return {
        "ok": True,
        "meli_id": meli_id,
        "promotion_id": promotion_id or None,
        "promotion_type": promotion_type,
        "request": body,
        "response": data if isinstance(data, dict) else {"raw": data},
    }


def quitar_item_de_promocion(
    meli_id: str,
    *,
    promotion_id: str,
    promotion_type: str,
    offer_id: str | None = None,
) -> dict[str, Any]:
    """DELETE /seller-promotions/items/{ITEM_ID}?…&app_version=v2"""
    meli_id = (meli_id or "").strip().upper()
    promotion_id = (promotion_id or "").strip()
    promotion_type = (promotion_type or "").strip().upper()
    if not meli_id or not promotion_id or not promotion_type:
        raise ValueError("meli_id, promotion_id y promotion_type son requeridos")

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token MeLi no disponible")

    params: dict[str, str] = {
        "app_version": "v2",
        "promotion_id": promotion_id,
        "promotion_type": promotion_type,
    }
    if offer_id:
        params["offer_id"] = offer_id.strip()

    r = requests.delete(
        f"{MELI_API}/seller-promotions/items/{meli_id}",
        headers=_headers(token),
        params=params,
        timeout=45,
    )
    if r.status_code not in (200, 204):
        raise RuntimeError(_meli_error_text(r))
    return {
        "ok": True,
        "meli_id": meli_id,
        "promotion_id": promotion_id,
        "promotion_type": promotion_type,
    }
