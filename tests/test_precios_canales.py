"""Tests precios multicanal — prioridad MeLi → Siigo → Web."""

from app.services import precios_canales as P
from app.services.precios_canales import (
    DOCUMENTACION_PRECIOS,
    envio_estimado_por_sku,
    obtener_documentacion_precios,
    reconciliar_precios_meli,
    resolver_precios_multicanal,
)


def test_documentacion_tres_canales_prioridad():
    doc = obtener_documentacion_precios()
    assert len(doc["prioridad"]) == 3
    assert doc["prioridad"][0]["canal"] == "MercadoLibre"
    assert doc["prioridad"][1]["canal"] == "Siigo"
    assert doc["prioridad"][2]["canal"] == "Página web"


def test_meli_dicta_siigo_igual():
    p = resolver_precios_multicanal("C-CITMAGKg", 65000)
    assert p["meli"] == 65000
    assert p["lista"] == 65000
    assert p["canales"]["siigo"]["precio"] == 65000
    assert p["canales"]["meli"]["prioridad"] == 1


def test_web_descuento_envio_apartado():
    p = resolver_precios_multicanal("C-CITMAG500g", 40000)
    assert p["web"] == int(round(40000 * 0.835))
    assert p["envio_web_apartado"] is True
    assert p["canales"]["web"]["envio_apartado"] is True
    assert p["canales"]["web"]["envio_estimado_referencia"] == envio_estimado_por_sku("C-CITMAG500g")


# ─── reconciliar_precios_meli: MeLi (referencia maestra) → Siigo/Sheets/Web ──


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


def _fake_get_meli(items_search_pages, items_batch):
    """Fake de requests.get que distingue /items/search (paginado) de /items (batch)."""
    calls = {"search": 0}

    def _get(url, params=None, headers=None, timeout=None):
        if url.endswith("/items/search"):
            page = calls["search"]
            calls["search"] += 1
            if page < len(items_search_pages):
                return _FakeResponse(200, items_search_pages[page])
            return _FakeResponse(200, {"results": [], "paging": {"total": 0}})
        if url.endswith("/items"):
            ids = (params or {}).get("ids", "").split(",")
            body = [items_batch[iid] for iid in ids if iid in items_batch]
            return _FakeResponse(200, body)
        raise AssertionError(f"URL inesperada: {url}")

    return _get


def _mockear_dependencias(monkeypatch, *, siigo_precios: dict, siigo_ok=True, ws_mock=None, web_mock=None):
    monkeypatch.setattr("app.utils.refrescar_token_meli", lambda: "TOKEN")
    monkeypatch.setattr("app.services.meli._obtener_seller_id_meli", lambda token: "12345")

    def _buscar_siigo(sku):
        precio = siigo_precios.get(sku)
        if precio is None:
            return None
        return {"sku": sku, "precio": precio, "nombre": f"Producto {sku}"}

    monkeypatch.setattr("app.services.siigo.buscar_producto_siigo_por_sku", _buscar_siigo)

    llamadas_siigo_write = []

    def _actualizar_siigo(code, nuevo_precio):
        llamadas_siigo_write.append((code, nuevo_precio))
        if siigo_ok:
            return {"ok": True, "msg": "actualizado"}
        return {"ok": False, "msg": "Siigo caído"}

    monkeypatch.setattr("app.services.siigo.actualizar_precio_combo_siigo", _actualizar_siigo)

    if ws_mock is not None:
        monkeypatch.setattr("app.services.google_services._abrir_hoja", lambda: ws_mock)

    llamadas_web = []
    if web_mock is None:
        def web_mock(productos):
            llamadas_web.append(productos)
            return "✅ Web ok"

    monkeypatch.setattr("app.tools.sincronizar_productos_pagina_web.sincronizar_productos_pagina_web", web_mock)

    return llamadas_siigo_write, llamadas_web


def _item_body(item_id, price, sku):
    return {
        "code": 200,
        "body": {"id": item_id, "price": price, "title": f"Título {sku}", "seller_custom_field": sku},
    }


def test_reconciliar_detecta_diferencia_y_no_escribe_en_dry_run(monkeypatch):
    monkeypatch.setattr(
        P,
        "requests",
        type("R", (), {"get": staticmethod(_fake_get_meli(
            [{"results": ["MCO1"], "paging": {"total": 1}}],
            {"MCO1": _item_body("MCO1", 50000.0, "C-TEST")},
        ))}),
    )
    llamadas_siigo_write, llamadas_web = _mockear_dependencias(monkeypatch, siigo_precios={"C-TEST": 60000.0})

    resultado = reconciliar_precios_meli(dry_run=True)

    assert resultado["dry_run"] is True
    assert len(resultado["candidatos"]) == 1
    c = resultado["candidatos"][0]
    assert c["sku"] == "C-TEST"
    assert c["precio_meli"] == 50000.0
    assert c["precio_siigo_antes"] == 60000.0
    assert resultado["aplicados"] == 0
    assert llamadas_siigo_write == []  # dry_run no escribe nada


def test_reconciliar_ignora_diferencias_dentro_del_umbral(monkeypatch):
    monkeypatch.setattr(
        P,
        "requests",
        type("R", (), {"get": staticmethod(_fake_get_meli(
            [{"results": ["MCO1"], "paging": {"total": 1}}],
            {"MCO1": _item_body("MCO1", 50000.0, "C-TEST")},
        ))}),
    )
    _mockear_dependencias(monkeypatch, siigo_precios={"C-TEST": 50000.50})

    resultado = reconciliar_precios_meli(dry_run=True, umbral=1.0)

    assert resultado["candidatos"] == []


def test_reconciliar_aplica_siigo_sheets_web_una_sola_vez(monkeypatch):
    monkeypatch.setattr(
        P,
        "requests",
        type("R", (), {"get": staticmethod(_fake_get_meli(
            [{"results": ["MCO1", "MCO2"], "paging": {"total": 2}}],
            {
                "MCO1": _item_body("MCO1", 50000.0, "C-A"),
                "MCO2": _item_body("MCO2", 70000.0, "C-B"),
            },
        ))}),
    )

    class _FakeWorksheet:
        def __init__(self):
            self.batch_calls = []

        def get_all_values(self):
            return [
                ["meli_id", "SKU", "", "NOMBRE", "PRECIO"],
                ["MCO1", "C-A", "", "Producto A", "60000"],
                ["MCO2", "C-B", "", "Producto B", "80000"],
            ]

        def batch_update(self, data):
            self.batch_calls.append(data)

    ws = _FakeWorksheet()
    llamadas_siigo_write, llamadas_web = _mockear_dependencias(
        monkeypatch, siigo_precios={"C-A": 60000.0, "C-B": 80000.0}, ws_mock=ws,
    )

    resultado = reconciliar_precios_meli(dry_run=False)

    assert resultado["aplicados"] == 2
    assert sorted(llamadas_siigo_write) == [("C-A", 50000), ("C-B", 70000)]
    assert len(ws.batch_calls) == 1  # Sheets: un solo batch_update para ambos SKU
    assert len(llamadas_web) == 1  # Web: UNA sola llamada aunque haya 2 SKU corregidos
    assert {p["sku"] for p in llamadas_web[0]} == {"C-A", "C-B"}


def test_reconciliar_skus_permitidos_filtra_lo_que_se_aplica(monkeypatch):
    """Reporta TODOS los candidatos, pero solo escribe los que vienen en skus_permitidos."""
    monkeypatch.setattr(
        P,
        "requests",
        type("R", (), {"get": staticmethod(_fake_get_meli(
            [{"results": ["MCO1", "MCO2"], "paging": {"total": 2}}],
            {
                "MCO1": _item_body("MCO1", 50000.0, "C-A"),
                "MCO2": _item_body("MCO2", 70000.0, "C-B"),
            },
        ))}),
    )

    class _FakeWorksheet:
        def get_all_values(self):
            return [
                ["meli_id", "SKU", "", "NOMBRE", "PRECIO"],
                ["MCO1", "C-A", "", "Producto A", "60000"],
                ["MCO2", "C-B", "", "Producto B", "80000"],
            ]

        def batch_update(self, data):
            pass

    llamadas_siigo_write, llamadas_web = _mockear_dependencias(
        monkeypatch, siigo_precios={"C-A": 60000.0, "C-B": 80000.0}, ws_mock=_FakeWorksheet(),
    )

    resultado = reconciliar_precios_meli(dry_run=False, skus_permitidos={"C-A"})

    assert len(resultado["candidatos"]) == 2  # se reportan los 2 igual
    assert resultado["aplicados"] == 1  # pero solo se aplica el permitido
    assert llamadas_siigo_write == [("C-A", 50000)]
    assert {p["sku"] for p in llamadas_web[0]} == {"C-A"}


def test_reconciliar_error_en_un_sku_no_detiene_el_resto(monkeypatch):
    monkeypatch.setattr(
        P,
        "requests",
        type("R", (), {"get": staticmethod(_fake_get_meli(
            [{"results": ["MCO1", "MCO2"], "paging": {"total": 2}}],
            {
                "MCO1": _item_body("MCO1", 50000.0, "C-A"),
                "MCO2": _item_body("MCO2", 70000.0, "C-B"),
            },
        ))}),
    )

    class _FakeWorksheet:
        def get_all_values(self):
            return [["meli_id", "SKU", "", "NOMBRE", "PRECIO"]]

        def batch_update(self, data):
            pass

    llamadas_siigo_write, llamadas_web = _mockear_dependencias(
        monkeypatch, siigo_precios={"C-A": 60000.0, "C-B": 80000.0}, siigo_ok=False, ws_mock=_FakeWorksheet(),
    )

    resultado = reconciliar_precios_meli(dry_run=False)

    assert resultado["aplicados"] == 0
    assert len(resultado["errores"]) == 2
    assert all(e["canal"] == "siigo" for e in resultado["errores"])
