"""Costo de la receta contra el precio publicado (Árbol del producto)."""

import pytest

from app.services import costo_receta as cr


@pytest.fixture
def fuentes(monkeypatch):
    datos = {
        "compras": {
            "ACECOCML": {"costo": 31.0, "fecha": "2026-08-25", "fuente": "factura", "detalle": "Factura FEA18545"},
            "BOLTRA13X21ZIP": {"costo": 220.0, "fecha": "2026-09-02", "fuente": "libro", "detalle": "Compra"},
        },
        "manuales": {"ETIQUETA TERMICA 10 X 15": {"costo": 54.97, "fecha": "", "fuente": "manual", "detalle": "a mano"}},
        "referencias": {"ACECOCVIRG": {"compra_de": "ACECOCmL", "factor": 1.087, "motivo": "densidad"}},
    }
    monkeypatch.setattr(cr, "_fuentes", lambda: datos)
    return datos


def test_numero_colombiano():
    assert cr._num("10.000") == 10000
    assert cr._num("19,6") == 19.6
    assert cr._num("1.234,5") == 1234.5
    assert cr._num("220") == 220


def test_linea_del_libro_mayor():
    m = cr._LINEA_COMPRA.search("BOLTRA13X21ZIP BOLSA 13 X 21 (PET) · 5000 und × $220")
    assert m and m.group(1) == "5000" and m.group(3) == "220"
    m = cr._LINEA_COMPRA.search("LGLCIg L-GLICINA g (factura: GLICINA USP · 75 kg × $19.600) · 75000 g × $19,6")
    assert m and cr._num(m.group(3)) == 19.6  # manda el último tramo (unidad del inventario)


def test_receta_con_equivalencia_y_pieza_sin_costo(fuentes):
    r = cr.costo_combo([
        {"codigo": "ACECOCVIRg", "nombre": "ACEITE DE COCO VIRGEN g", "cantidad": 250, "casilla": "materia_prima"},
        {"codigo": "BOLTRA13X21ZIP", "nombre": "BOLSA", "cantidad": 1, "casilla": "bolsa"},
        {"codigo": "ETQTRM", "nombre": "Etiqueta  térmica 10 x 15", "cantidad": 1, "casilla": "etiqueta"},
        {"codigo": "XX", "nombre": "PIEZA NUEVA", "cantidad": 1, "casilla": "bolsa"},
    ])
    assert r["lineas"][0]["fuente"] == "referencia"
    assert r["lineas"][0]["subtotal"] == pytest.approx(31 * 1.087 * 250, abs=0.01)
    assert r["lineas"][2]["fuente"] == "manual"  # nombre sin tildes ni espacios dobles
    assert r["sin_costo"] == ["XX"] and not r["completo"]
    assert r["total"] == pytest.approx(31 * 1.087 * 250 + 220 + 54.97, abs=0.01)


def test_contraste_sin_iva_y_comision_meli():
    web, meli = cr.contraste(10000, {"web": 23800, "meli": 23800, "lista": None})
    assert web["neto"] == 20000 and web["utilidad"] == 10000 and web["margen"] == 0.5
    assert meli["comision"] == pytest.approx(20000 * cr.COMISION_MELI)
    assert meli["utilidad"] == pytest.approx(20000 - 3300 - 10000)


def test_parcial_marca_el_margen_como_techo(fuentes):
    r = cr.para_presentacion([{"codigo": "XX", "nombre": "?", "cantidad": 1},
                              {"codigo": "BOLTRA13X21ZIP", "nombre": "", "cantidad": 1}], {"web": 5000})
    assert r["parcial"] and r["contraste"][0]["canal"] == "web"


def test_contraste_con_la_tarifa_real_del_combo():
    """La avena va al 5 %: dividir por 1,19 subestimaba lo que nos queda."""
    (web,) = cr.contraste(4000, {"web": 6300}, tasa_iva=0.05)
    assert web["neto"] == 6000 and web["utilidad"] == 2000


def test_tasa_iva_desde_alegra():
    from app.services.alegra_catalogo_db import _tasa_iva

    assert _tasa_iva({"tax": [{"id": "3", "name": "IVA", "percentage": "5.00", "type": "IVA"}]}) == 5
    assert _tasa_iva({"tax": []}) == 0
