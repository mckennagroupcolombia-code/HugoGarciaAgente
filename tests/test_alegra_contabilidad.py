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
    assert captured["json"]["name"] == "UREA COSMÉTICA"
    assert captured["json"]["type"] == "simple"
    assert captured["json"]["inventory"]["unit"] == "gram"
    assert captured["json"]["inventory"]["initialQuantity"] == 0
    assert captured["json"]["inventory"]["negativeSale"] is True
    assert captured["json"]["price"] == 25000
    assert captured["json"]["tax"] == [{"id": 19}]


def test_nombre_mayusculas_alegra_preserva_unidades():
    from app.services.alegra import _nombre_mayusculas_alegra

    assert _nombre_mayusculas_alegra("urea cosmética 250 g") == "UREA COSMÉTICA 250 g"
    assert _nombre_mayusculas_alegra("Aceite Arbol de Te 5 mL") == "ACEITE ARBOL DE TE 5 mL"
    assert _nombre_mayusculas_alegra("aceite 30ml") == "ACEITE 30mL"
    assert _nombre_mayusculas_alegra("vitamina 100MG") == "VITAMINA 100MG"
    # Graneles: unidad suelta al final (sin número delante)
    assert _nombre_mayusculas_alegra("ajonjolí negro g") == "AJONJOLI NEGRO g"
    assert _nombre_mayusculas_alegra("ACEITE DE COCO mL") == "ACEITE DE COCO mL"
    assert _nombre_mayusculas_alegra("ACEITE DE COCO ML") == "ACEITE DE COCO mL"
    assert _nombre_mayusculas_alegra("semilla de chia G") == "SEMILLA DE CHIA g"
    assert _nombre_mayusculas_alegra("saco 25kg") == "SACO 25KG"
    # Espacios entre palabras se conservan (el bug del panel era trim en cada tecla
    # en el frontend; al guardar Alegra también debe aceptar nombres multi-palabra).
    assert _nombre_mayusculas_alegra("  acido  ascorbico  100 g  ") == "ACIDO  ASCORBICO  100 g"
    assert " " in _nombre_mayusculas_alegra("niacinamida 10%")


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


def test_actualizar_nombre_alegra_producto(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})
    ag._producto_cache["UREA250"] = {"id": "1", "name": "viejo", "price": 0}

    puts = []

    def _get(url, headers=None, params=None, timeout=None):
        return _Resp(200, [{"id": "42", "name": "urea cosmética 250 g", "reference": "UREA250"}])

    def _put(url, headers=None, json=None, timeout=None):
        puts.append({"url": url, "json": json})
        return _Resp(200, {"id": "42", "name": json["name"]})

    monkeypatch.setattr(ag.requests, "get", _get)
    monkeypatch.setattr(ag.requests, "put", _put)

    out = ag.actualizar_nombre_alegra_producto("UREA250", "  urea cosmética 250 g  ")
    assert out["ok"] is True
    assert out["nombre"] == "UREA COSMÉTICA 250 g"
    assert puts[0]["url"].endswith("/items/42")
    assert puts[0]["json"] == {"name": "UREA COSMÉTICA 250 g"}
    assert "UREA250" not in ag._producto_cache


def test_actualizar_nombre_alegra_producto_sin_cambios(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})
    puts = []

    def _get(url, headers=None, params=None, timeout=None):
        return _Resp(200, [{"id": "7", "name": "NIACINAMIDA 10%", "reference": "NIAC"}])

    def _put(url, headers=None, json=None, timeout=None):
        puts.append(json)
        return _Resp(200, {})

    monkeypatch.setattr(ag.requests, "get", _get)
    monkeypatch.setattr(ag.requests, "put", _put)

    out = ag.actualizar_nombre_alegra_producto("NIAC", "niacinamida 10%")
    assert out["ok"] is True
    assert out["msg"] == "Sin cambios"
    assert puts == []


def test_actualizar_nombre_alegra_producto_no_existe(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})
    monkeypatch.setattr(
        ag.requests, "get",
        lambda *a, **k: _Resp(200, []),
    )
    out = ag.actualizar_nombre_alegra_producto("NOEXISTE", "Algo")
    assert out["ok"] is False
    assert "no existe" in out["msg"].lower()


def test_actualizar_combo_alegra_ok(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})
    puts = []

    def _get(url, headers=None, params=None, timeout=None):
        ref = (params or {}).get("reference")
        if ref == "C-TEST":
            return _Resp(200, [{
                "id": "99",
                "name": "KIT TEST",
                "reference": "C-TEST",
                "type": "kit",
                "inventory": {"unit": "unit", "initialQuantity": 0, "availableQuantity": 0},
            }])
        return _Resp(200, [])

    def _put(url, headers=None, json=None, timeout=None):
        puts.append({"url": url, "json": json})
        return _Resp(200, {"id": "99"})

    monkeypatch.setattr(ag.requests, "get", _get)
    monkeypatch.setattr(ag.requests, "put", _put)
    monkeypatch.setattr(
        ag, "buscar_producto_alegra_por_referencia",
        lambda c: {"id": f"id-{c}", "name": c, "nombre": c},
    )

    out = ag.actualizar_combo_alegra(
        "C-TEST",
        [{"codigo": "UREA", "cantidad": 2}, {"codigo": "NIAC", "cantidad": 1}],
        nombre="kit test actualizado",
    )
    assert out["ok"] is True
    assert puts[0]["url"].endswith("/items/99")
    assert puts[0]["json"]["subitems"] == [
        {"item": {"id": "id-UREA"}, "quantity": 2.0},
        {"item": {"id": "id-NIAC"}, "quantity": 1.0},
    ]
    assert puts[0]["json"]["name"] == "KIT TEST ACTUALIZADO"


def test_actualizar_combo_alegra_bloqueado_por_movimientos(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})

    def _get(url, headers=None, params=None, timeout=None):
        return _Resp(200, [{
            "id": "7",
            "name": "KIT",
            "reference": "C-X",
            "type": "kit",
            "inventory": {"unit": "unit", "initialQuantity": 0, "availableQuantity": 0},
        }])

    def _put(url, headers=None, json=None, timeout=None):
        return _Resp(400, {"message": "El ítem no se puede editar porque tiene movimientos asociados"})

    monkeypatch.setattr(ag.requests, "get", _get)
    monkeypatch.setattr(ag.requests, "put", _put)
    monkeypatch.setattr(
        ag, "buscar_producto_alegra_por_referencia",
        lambda c: {"id": "1", "name": c},
    )

    out = ag.actualizar_combo_alegra("C-X", [{"codigo": "A", "cantidad": 1}])
    assert out["ok"] is False
    assert out.get("bloqueado_movimientos") is True
    assert "movimientos" in out["error"].lower()


def test_actualizar_combo_alegra_no_es_kit(monkeypatch):
    from app.services import alegra as ag

    monkeypatch.setattr(ag, "_alegra_headers", lambda: {"Authorization": "Basic x"})
    monkeypatch.setattr(
        ag.requests, "get",
        lambda *a, **k: _Resp(200, [{"id": "1", "type": "simple", "reference": "P1", "name": "X"}]),
    )
    out = ag.actualizar_combo_alegra("P1", [{"codigo": "A", "cantidad": 1}])
    assert out["ok"] is False
    assert "combo" in out["error"].lower() or "kit" in out["error"].lower()
