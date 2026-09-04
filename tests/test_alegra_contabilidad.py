"""Migración Contabilidad Siigo → Alegra: altas de producto, compras y centros de costo."""
from __future__ import annotations


class _Resp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or ("" if payload is None else str(payload))
        self.content = b"{}" if payload is not None else b""

    def json(self):
        return self._payload


def test_creds_alegra_configuradas(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.delenv("ALEGRA_EMAIL", raising=False)
    monkeypatch.delenv("ALEGRA_TOKEN", raising=False)
    assert ag.creds_alegra_configuradas() is False
    monkeypatch.setenv("ALEGRA_EMAIL", "conta@mckennagroup.co")
    monkeypatch.setenv("ALEGRA_TOKEN", "tok")
    assert ag.creds_alegra_configuradas() is True


def test_crear_producto_en_alegra_payload(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})
    monkeypatch.setattr(ag, "buscar_producto_alegra_por_referencia", lambda sku: None)
    monkeypatch.setattr(ag, "_env_int", lambda nombre, default=None: 19 if nombre == "ALEGRA_IVA_TAX_ID" else default)
    ag._producto_cache.clear()

    captured = {}

    def _post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _Resp(201, {"id": "99", "reference": "UREA250", "name": "Urea cosmética"})

    monkeypatch.setattr(ag.requests, "post", _post)
    monkeypatch.setattr("app.services.rentabilidad.registrar_producto_en_cache_costos", lambda *a, **k: None)

    out = ag.crear_producto_en_alegra({
        "codigo": "UREA250",
        "nombre": "Urea cosmética",
        "unidad_min": "g",
        "precio_neto": 12000,
        "precio_lista": 25000,
        "iva": 1,
    })
    assert out["ok"] is True
    assert out["siigo_producto"]["codigo"] == "UREA250"
    assert captured["json"]["type"] == "simple"
    assert captured["json"]["inventory"]["unit"] == "gram"
    assert captured["json"]["inventory"]["initialQuantity"] == 0
    assert captured["json"]["inventory"]["negativeSale"] is True
    assert captured["json"]["price"] == 25000
    assert captured["json"]["tax"] == [{"id": 19}]


def test_crear_producto_en_alegra_rechaza_duplicado(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})
    monkeypatch.setattr(
        ag, "buscar_producto_alegra_por_referencia",
        lambda sku: {"id": "1", "sku": sku, "nombre": "Ya existe", "unidad": "unit"},
    )
    out = ag.crear_producto_en_alegra({"codigo": "UREA250", "nombre": "Urea"})
    assert out["ok"] is False
    assert "ya existe" in out["error"].lower()


def test_crear_factura_compra_siigo_traduce_a_alegra(monkeypatch):
    from app.services import siigo as sg

    llamado = {}

    def _fake(**kwargs):
        llamado.update(kwargs)
        return {"status": "success", "data": {"id": "b1"}}

    monkeypatch.setattr("app.services.alegra.crear_factura_compra_alegra", _fake)
    out = sg.crear_factura_compra_siigo({
        "date": "2026-09-03",
        "supplier": {"identification": "900123456"},
        "provider_invoice": {"prefix": "FE", "number": "123"},
        "items": [
            {"type": "Product", "code": "UREA250", "description": "Urea", "quantity": 2, "price": 1000},
            {"type": "Account", "code": "11051001", "description": "Gasto", "quantity": 1, "price": 50},
        ],
        "observations": "desde Gmail",
    })
    assert out["status"] == "success"
    assert llamado["nit_proveedor"] == "900123456"
    assert llamado["prefijo_proveedor"] == "FE"
    assert llamado["numero_proveedor"] == "123"
    assert llamado["items"][0]["codigo"] == "UREA250"
    assert llamado["items"][1]["codigo"] == "GENERICO"  # cuentas contables Siigo → GENERICO


def test_bill_alegra_a_shape_compra():
    from app.services.alegra import bill_alegra_a_shape_compra

    shaped = bill_alegra_a_shape_compra({
        "id": "7",
        "date": "2026-09-03",
        "total": 15000,
        "numberTemplate": {"fullNumber": "FE32480", "number": "32480"},
        "provider": {"identification": "900111222", "name": "Acme"},
    })
    assert shaped["name"] == "FE32480"
    assert shaped["supplier"]["identification"] == "900111222"
    assert shaped["provider_invoice"]["number"] == "FE32480"
    assert shaped["_fuente"] == "alegra"


def test_listar_centros_costo_alegra(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})

    def _get(url, headers=None, params=None, timeout=None):
        if params and params.get("start"):
            return _Resp(200, [])
        return _Resp(200, [
            {"id": "2", "name": "Ventas", "code": "VEN", "status": "active"},
            {"id": "1", "name": "Admin", "status": "inactive"},
        ])

    monkeypatch.setattr(ag.requests, "get", _get)
    centros, err = ag.listar_centros_costo_alegra()
    assert err is None
    assert centros is not None
    assert centros[0]["name"] == "Admin"
    assert centros[1]["active"] is True
    assert centros[1]["code"] == "VEN"
