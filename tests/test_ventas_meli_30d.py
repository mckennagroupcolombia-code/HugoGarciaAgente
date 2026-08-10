"""Tests de análisis de ventas MeLi 30d (sin API externa)."""

from app.sync import obtener_ventas_meli_por_item


def test_ventas_nivel_clasificacion(monkeypatch, tmp_path):
    import app.sync as sync_mod

    monkeypatch.setattr(sync_mod, "_VENTAS_CACHE_PATH", str(tmp_path / "v.json"))
    monkeypatch.setattr(sync_mod, "refrescar_token_meli", lambda: "tok")

    class FakeResp:
        def __init__(self, payload, status=200):
            self._payload = payload
            self.status_code = status
            self.text = str(payload)

        def json(self):
            return self._payload

    calls = {"n": 0}

    def fake_get(url, headers=None, timeout=None):
        calls["n"] += 1
        if "users/me" in url:
            return FakeResp({"id": 123})
        # Una página con 2 órdenes del mismo ítem
        return FakeResp(
            {
                "results": [
                    {
                        "id": "1",
                        "status": "paid",
                        "order_items": [
                            {
                                "quantity": 2,
                                "unit_price": 1000,
                                "item": {"id": "MCO111"},
                            }
                        ],
                    },
                    {
                        "id": "2",
                        "status": "cancelled",
                        "order_items": [
                            {
                                "quantity": 9,
                                "unit_price": 1000,
                                "item": {"id": "MCO111"},
                            }
                        ],
                    },
                    {
                        "id": "3",
                        "status": "paid",
                        "order_items": [
                            {
                                "quantity": 1,
                                "unit_price": 500,
                                "item": {"id": "MCO222"},
                            }
                        ],
                    },
                ],
                "paging": {"total": 3},
            }
        )

    monkeypatch.setattr(sync_mod.requests, "get", fake_get)
    res = obtener_ventas_meli_por_item(dias=30, refresh=True)
    assert res["fuente"] == "live"
    assert res["por_item"]["MCO111"]["unidades"] == 2
    assert res["por_item"]["MCO111"]["ordenes"] == 1
    assert res["por_item"]["MCO111"]["nivel"] == "baja"
    assert res["por_item"]["MCO222"]["unidades"] == 1
    assert "MCO111" in res["por_item"]
    # cancelada no suma
    assert res["por_item"]["MCO111"]["monto"] == 2000.0
