"""Ganancia = precio − costo real − cobros MeLi."""

from app.services import rentabilidad as R


def test_listar_ganancia_formula(monkeypatch):
    monkeypatch.setattr(
        R,
        "listar_cobros_meli",
        lambda buscar="", refresh=False: {
            "items": [
                {
                    "sku": "C-TEST",
                    "nombre": "Producto test",
                    "meli_id": "MCO1",
                    "precio_meli": 20900,
                    "cargo_venta": 3448,
                    "cargo_envio": 2700,
                    "free_shipping": False,
                }
            ],
            "actualizado_en": "2026-08-01T12:00:00",
            "cache_hit": True,
        },
    )
    monkeypatch.setattr(
        R,
        "costos_todos_resumen",
        lambda: {"C-TEST": {"costo_total": 5000.0, "sin_costo": 0}},
    )
    out = R.listar_ganancia_meli()
    assert out["total"] == 1
    row = out["items"][0]
    # 20900 - 5000 - (3448+2700) = 9752
    assert row["cobros_meli"] == 6148.0
    assert row["ganancia"] == 9752.0
    assert row["margen_pct"] == round(9752 / 20900, 4)
    assert out["totales"]["ganancia"] == 9752.0
