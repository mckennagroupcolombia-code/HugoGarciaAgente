"""Cuerpo de opt-in a promociones MeLi (sin red)."""

from __future__ import annotations

import pytest

from app.services.meli_promotions import cuerpo_optin_meli, stock_reservar


def test_stock_reservar_dict_min() -> None:
    assert stock_reservar({"min": 5, "max": 40}) == 5
    assert stock_reservar(8) == 8
    assert stock_reservar(None) is None
    assert stock_reservar({"max": 10}) is None


def test_cuerpo_lightning_incluye_stock_y_precio() -> None:
    body = cuerpo_optin_meli(
        promotion_type="LIGHTNING",
        promotion_id="LGH-MCO1000",
        deal_price=25415,
        stock=5,
        offer_id="CANDIDATE-MCO1-2",
    )
    assert body["promotion_type"] == "LIGHTNING"
    assert body["deal_price"] == 25415.0
    assert body["stock"] == 5
    assert body["offer_id"] == "CANDIDATE-MCO1-2"


def test_cuerpo_lightning_sin_stock_falla() -> None:
    with pytest.raises(ValueError, match="stock"):
        cuerpo_optin_meli(
            promotion_type="LIGHTNING",
            promotion_id="LGH-MCO1000",
            deal_price=10000,
        )


def test_cuerpo_smart_incluye_offer_y_fechas() -> None:
    body = cuerpo_optin_meli(
        promotion_type="SMART",
        promotion_id="P-MCO17937076",
        offer_id="CANDIDATE-MCO4074246724-76601185833",
        start_date="2026-08-13T15:08:00Z",
        finish_date="2026-09-08T04:50:00Z",
    )
    assert body["offer_id"].startswith("CANDIDATE-")
    assert body["start_date"].startswith("2026-08-13")
    assert body["finish_date"].startswith("2026-09-08")
    assert "stock" not in body
    assert "deal_price" not in body


def test_cuerpo_deal_precio() -> None:
    body = cuerpo_optin_meli(
        promotion_type="DEAL",
        promotion_id="P-MCO17963012",
        deal_price=25415,
    )
    assert body["deal_price"] == 25415.0
    assert body["promotion_id"] == "P-MCO17963012"
    assert "offer_id" not in body
