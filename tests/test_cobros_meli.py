"""Parser de cobros MeLi (cargo por venta / Envíos MeLi pagarás)."""

from app.services.rentabilidad import parse_cobros_listing_prices, parse_shipping_options_free


def test_parse_listing_prices_sale_fee():
    payload = [
        {"listing_type_id": "free", "sale_fee_amount": 1000},
        {
            "listing_type_id": "gold_pro",
            "sale_fee_amount": 3448,
            "sale_fee_details": {"percentage_fee": 16.5},
        },
    ]
    r = parse_cobros_listing_prices(payload, listing_type_id="gold_pro")
    assert r["cargo_venta"] == 3448.0
    assert r["pct_venta_api"] == 0.165


def test_parse_shipping_options_free_list_cost():
    payload = {
        "coverage": {
            "all_country": {
                "list_cost": 2700,
                "currency_id": "COP",
                "billable_weight": 500,
            }
        }
    }
    assert parse_shipping_options_free(payload) == 2700.0


def test_parse_shipping_options_vacio():
    assert parse_shipping_options_free({}) is None
