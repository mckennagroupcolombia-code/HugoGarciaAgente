"""Jenniffer no crea productos en Alegra ni factura «sin SKU»; lo pagado se factura exacto.

9-oct-2026: los productos ya existen. Una cantidad sin publicación propia (una garrafa
de 20 L de aceite de ricino) se factura con el producto base en su unidad mínima por la
cantidad: ACERICg × 20.000 mL. Con esas cantidades el precio base redondeado a centavos
se multiplicaba (24,37 × 20.000 × 1,19 = $580.006 para $580.000 pagados): el precio va
con 6 decimales cuando el redondeo mueve el total.
"""
from __future__ import annotations

import pytest
from flask import Flask

from app.services import tickets_db
from app.services import ventas_directas as V
from app.services.alegra import _precio_base_con_impuesto

JENNIFFER = {"id": 10, "nombre": "Jenniffer Garcia", "username": "jerry", "rol": {"nivel": 1},
             "permisos_secciones": {"cotizar-facturar": True, "productos-siigo": True, "facturas": True}}
OTRO = {**JENNIFFER, "id": 8, "nombre": "Armando", "username": "armando"}


def test_la_regla_es_por_persona():
    assert tickets_db.puede_crear_productos_alegra(JENNIFFER) is False
    assert tickets_db.puede_crear_productos_alegra(OTRO) is True
    # Token del sistema (crons) sin persona detrás: no se restringe.
    assert tickets_db.puede_crear_productos_alegra(None) is True


# ── Precio base exacto ────────────────────────────────────────────────────────

def test_cantidad_grande_en_unidad_minima_queda_exacta():
    precio = _precio_base_con_impuesto(29, 19, 20000)
    assert precio == round(29 / 1.19, 6)
    # Lo que calcula Alegra: precio × cantidad + 19 %.
    assert round(precio * 20000 * 1.19, 2) == pytest.approx(580000, abs=0.05)


@pytest.mark.parametrize("final,cantidad,base", [(22500, 1, 18907.56), (17820, 2, 14974.79), (25020, 3, 21025.21)])
def test_ventas_normales_siguen_con_centavos(final, cantidad, base):
    # Las ventas de siempre (1-3 unidades) no cambian: el redondeo no mueve el total.
    assert _precio_base_con_impuesto(final, 19, cantidad) == base


def test_sin_iva_no_toca_el_precio():
    assert _precio_base_con_impuesto(40000, 0, 1) == 40000


# ── Rutas de alta de productos ────────────────────────────────────────────────

@pytest.fixture()
def app_rutas(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-de-sistema-para-test")
    monkeypatch.setattr(V, "_DB", str(tmp_path / "vd.db"))
    monkeypatch.setattr(V, "_producto_alegra", lambda c: {"id": "274", "tax_ids": ["4"], "tax_rate_total": 19.0})
    from app.routes import register_routes
    from app.routes_ventas_directas import register_ventas_directas_routes

    app = Flask(__name__)
    register_routes(app)
    register_ventas_directas_routes(app)
    with app.test_client() as c:
        yield c


def _sesion(monkeypatch, usuario):
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda _t: usuario)


@pytest.mark.parametrize("ruta", ["/api/siigo/productos", "/api/siigo/combos", "/api/facturas/ABC1/crear-productos"])
def test_jenniffer_no_crea_productos_en_alegra(app_rutas, monkeypatch, ruta):
    import app.services.alegra as A
    import app.tools.importar_productos_siigo as imp

    def no_crear(*a, **k):
        raise AssertionError("no debía llegar a Alegra")

    monkeypatch.setattr(A, "crear_producto_en_alegra", no_crear)
    monkeypatch.setattr(A, "crear_combo_en_alegra", no_crear)
    monkeypatch.setattr(imp, "crear_productos_factura_en_siigo", no_crear)
    _sesion(monkeypatch, JENNIFFER)
    r = app_rutas.post(ruta, json={"codigo": "ACERIC20L", "nombre": "ACEITE DE RICINO 20L", "indices": [0]},
                       headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403
    assert "unidad mínima" in r.get_json()["error"]


def test_otra_persona_pasa_el_filtro(app_rutas, monkeypatch):
    _sesion(monkeypatch, OTRO)
    # Sin código ni nombre: el filtro la deja pasar y la valida la ruta (400), sin crear nada.
    r = app_rutas.post("/api/siigo/productos", json={}, headers={"Authorization": "Bearer sesion"})
    assert r.status_code == 400


# ── Cotizar/Facturar: nada de «sin SKU» ───────────────────────────────────────

def _venta(codigo, nombre, cantidad, precio):
    return {"cliente": {"nombre": "Ricardo Prueba", "identificacion": "91073229"}, "telefono": "",
            "lineas": [{"codigo": codigo, "nombre": nombre, "cantidad": cantidad, "precio_unitario": precio}]}


def test_jenniffer_no_guarda_lineas_sin_sku(app_rutas, monkeypatch):
    _sesion(monkeypatch, JENNIFFER)
    r = app_rutas.post("/api/ventas-directas", json=_venta("VENTA-VARIO-GRAVADO::1", "Aceite de ricino 20 L", 1, 580000),
                       headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403
    assert "ACERICg" in r.get_json()["error"]


def test_jenniffer_factura_con_el_producto_base(app_rutas, monkeypatch):
    _sesion(monkeypatch, JENNIFFER)
    r = app_rutas.post("/api/ventas-directas", json=_venta("ACERICg", "ACEITE DE RICINO G/ML", 20000, 29),
                       headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["venta"]["total"] == 580000


def test_un_borrador_viejo_sin_sku_tampoco_se_factura(app_rutas, monkeypatch):
    venta = V.guardar(_venta("VENTA-VARIO-EXCLUIDO::1", "Algo sin SKU", 1, 1000), usuario="jerry")
    _sesion(monkeypatch, JENNIFFER)
    r = app_rutas.post(f"/api/ventas-directas/{venta['id']}/facturar", json={},
                       headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403


def test_otra_persona_si_puede_usar_el_generico(app_rutas, monkeypatch):
    _sesion(monkeypatch, OTRO)
    r = app_rutas.post("/api/ventas-directas", json=_venta("VENTA-VARIO-GRAVADO::1", "Producto viejo", 1, 1190),
                       headers={"Authorization": "Bearer sesion"})
    assert r.status_code == 200


def test_cotizacion_en_alegra_manda_el_mismo_precio_exacto(monkeypatch, tmp_path):
    import requests

    import app.services.alegra as A

    monkeypatch.setattr(V, "_DB", str(tmp_path / "vd.db"))
    monkeypatch.setattr(V, "_producto_alegra", lambda c: {"id": "274", "tax_ids": ["4"], "tax_rate_total": 19.0})
    enviado = {}

    class Resp:
        status_code = 201

        def json(self):
            return {"id": 1, "number": "1", "total": 580000}

    monkeypatch.setattr(requests, "post", lambda url, headers, json, timeout: enviado.update(payload=json) or Resp())
    monkeypatch.setattr(A, "_alegra_headers", lambda: {})
    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", lambda **kw: ("1005", ""))
    venta = V.guardar(_venta("ACERICg", "ACEITE DE RICINO G/ML", 20000, 29), usuario="jerry")
    r = V.crear_cotizacion_alegra(venta)
    assert r["ok"] and "aviso" not in r, r
    (item,) = enviado["payload"]["items"]
    assert item["price"] == round(29 / 1.19, 6) and item["quantity"] == 20000
