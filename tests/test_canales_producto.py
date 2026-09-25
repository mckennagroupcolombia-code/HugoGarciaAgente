"""Canales del producto: la tabla maestra por SKU de venta y su clasificación.

Cada fuente se reemplaza por un doble: el servicio no debe llamar a Alegra ni a
MeLi para armar la tabla, y una fuente caída no puede tumbarla.
"""
from __future__ import annotations

import pytest

from app.services import canales_producto as cp


def _alegra(**items):
    """items: REF=("kit"|"product", "active"|"inactive")."""
    return {
        ref.upper(): {"ref": ref, "nombre": f"Nombre {ref}", "tipo": t, "status": s}
        for ref, (t, s) in items.items()
    }


def _pub(estado_meli="active", relacion="vinculado"):
    return [{"meli_id": "MCO1", "titulo": "Pub", "estado_meli": estado_meli,
             "relacion": relacion, "permalink": "https://x", "en_siigo": True}]


@pytest.fixture()
def fuentes(monkeypatch):
    """Devuelve un dict mutable; el servicio lee de él."""
    estado = {
        "alegra": {}, "alias": {}, "meli": {}, "web": {}, "ean": {}, "combos": {},
    }
    monkeypatch.setattr(cp, "_fuente_alegra", lambda: estado["alegra"])
    monkeypatch.setattr(cp, "_fuente_alias", lambda: estado["alias"])
    monkeypatch.setattr(cp, "_fuente_meli", lambda: estado["meli"])
    monkeypatch.setattr(cp, "_fuente_web", lambda: estado["web"])
    monkeypatch.setattr(cp, "_fuente_ean", lambda: estado["ean"])
    monkeypatch.setattr(cp, "_fuente_combos", lambda: estado["combos"])
    monkeypatch.setattr(cp, "_frescura_fuentes", lambda: {})
    cp.invalidar()
    yield estado
    cp.invalidar()


def _fila(sku: str) -> dict:
    tabla = cp.tabla_maestra(refrescar=True)
    return next(f for f in tabla["filas"] if f["sku"].upper() == sku.upper())


_COMPLETO = {"receta": "ok", "documento": "ok", "etiqueta": "ok", "ean": "ok", "nombre": ""}


def test_publicado_sin_alegra_ni_alias_no_factura(fuentes):
    fuentes["meli"] = {"0606462652407": _pub()}
    f = _fila("0606462652407")
    assert f["canales"]["alegra"]["estado"] == "falta"
    assert f["canales"]["facturable"]["estado"] == "no"
    assert f["clasificacion"] == "vendible_no_facturable"
    assert any(s["panel"] == "catalogo-alegra" for s in f["saltos"])


def test_pausada_de_verdad_sin_alegra_es_trampa_latente(fuentes):
    """Pausada desde antes del cese: no vende hoy, pero reactivarla rompería la factura."""
    fuentes["meli"] = {"X-PAUS": _pub(estado_meli="paused")}
    f = _fila("X-PAUS")
    assert f["canales"]["meli"]["estado"] == "pausado"
    assert f["clasificacion"] == "pausado_no_facturable"


def test_pausada_por_cese_cuenta_como_activa(monkeypatch, tmp_path):
    """El cese pausa todo MeLi: lo que estaba activo antes sigue siendo «se vende»."""
    import json

    rel = tmp_path / "rel.json"
    rel.write_text(json.dumps({"items": [
        {"meli_id": "MCO1", "sku_meli": "S1", "estado_meli": "paused", "estado": "sin_siigo"},
        {"meli_id": "MCO2", "sku_meli": "S2", "estado_meli": "paused", "estado": "sin_siigo"},
    ]}), encoding="utf-8")
    pausa = tmp_path / "pausa.json"
    pausa.write_text(json.dumps({"activa": True, "items_pausados": ["MCO1"]}), encoding="utf-8")
    monkeypatch.setattr(cp, "_RELACION_JSON", rel)
    monkeypatch.setattr(cp, "_PAUSA_GLOBAL_JSON", pausa)
    m = cp._fuente_meli()
    assert m["S1"][0]["estado_meli"] == "active" and m["S1"][0]["pausada_por_cese"] is True
    assert m["S2"][0]["estado_meli"] == "paused" and m["S2"][0]["pausada_por_cese"] is False
    # Levantado el cese, se respeta lo que diga MeLi.
    pausa.write_text(json.dumps({"activa": False, "items_pausados": ["MCO1"]}), encoding="utf-8")
    assert cp._fuente_meli()["S1"][0]["estado_meli"] == "paused"


def test_alias_hace_facturable(fuentes):
    fuentes["alegra"] = _alegra(CAPGELVAC0AZUBLA=("product", "active"))
    fuentes["alias"] = {"C-CAPVAC1000UN": "CAPGELVAC0AZUBLA"}
    fuentes["meli"] = {"C-CAPVAC1000UN": _pub()}
    f = _fila("C-CAPVAC1000UN")
    assert f["canales"]["facturable"] == {"estado": "alias", "alias_destino": "CAPGELVAC0AZUBLA"}
    assert f["clasificacion"] == "inactivo_con_alias"


def test_alias_a_codigo_inexistente_no_factura(fuentes):
    fuentes["alias"] = {"C-X": "NO-EXISTE"}
    fuentes["meli"] = {"C-X": _pub()}
    f = _fila("C-X")
    assert f["canales"]["facturable"]["estado"] == "no"
    assert f["clasificacion"] == "vendible_no_facturable"


def test_inactivo_publicado_sin_alias(fuentes):
    fuentes["alegra"] = _alegra(**{"C-VIEJO": ("kit", "inactive")})
    fuentes["meli"] = {"C-VIEJO": _pub()}
    f = _fila("C-VIEJO")
    assert f["canales"]["alegra"]["estado"] == "inactivo"
    assert f["canales"]["facturable"]["estado"] == "inactivo"
    assert f["clasificacion"] == "inactivo_publicado"


def test_inactivo_con_alias_activo_gana_el_alias(fuentes):
    fuentes["alegra"] = _alegra(**{"C-ALBHV500g": ("kit", "inactive"), "C-ALBHUE500g": ("kit", "active")})
    fuentes["alias"] = {"C-ALBHV500G": "C-ALBHUE500g"}
    fuentes["meli"] = {"C-ALBHV500G": _pub()}
    f = _fila("C-ALBHV500g")
    assert f["canales"]["facturable"]["estado"] == "alias"
    assert f["clasificacion"] == "inactivo_con_alias"


def test_sku_divergente_es_discrepancia(fuentes):
    fuentes["alegra"] = _alegra(**{"C-A": ("kit", "active")})
    fuentes["meli"] = {"C-A": _pub(relacion="sku_divergente")}
    fuentes["web"] = {"C-A": {"nombre": "A", "cat": "Ácidos", "buyable": True, "stock": 3}}
    fuentes["combos"] = {"C-A": _COMPLETO}
    assert _fila("C-A")["clasificacion"] == "discrepancia_canales"


def test_web_sin_meli_es_discrepancia(fuentes):
    fuentes["alegra"] = _alegra(**{"C-B": ("kit", "active")})
    fuentes["web"] = {"C-B": {"nombre": "B", "cat": "", "buyable": True, "stock": None}}
    fuentes["combos"] = {"C-B": _COMPLETO}
    assert _fila("C-B")["clasificacion"] == "discrepancia_canales"


def test_kit_activo_sin_canales_es_suelto(fuentes):
    fuentes["alegra"] = _alegra(**{"C-SUELTO": ("kit", "active")})
    fuentes["combos"] = {"C-SUELTO": _COMPLETO}
    f = _fila("C-SUELTO")
    assert f["clasificacion"] == "suelto"
    assert any(s["panel"] == "publicaciones" for s in f["saltos"])


def test_kit_con_piezas_faltantes_es_incompleto(fuentes):
    fuentes["alegra"] = _alegra(**{"C-INC": ("kit", "active")})
    fuentes["meli"] = {"C-INC": _pub()}
    fuentes["web"] = {"C-INC": {"nombre": "I", "cat": "Sales", "buyable": True, "stock": 5}}
    fuentes["combos"] = {"C-INC": {**_COMPLETO, "documento": "falta"}}
    f = _fila("C-INC")
    assert f["clasificacion"] == "incompleto"
    assert any(s["panel"] == "combos" for s in f["saltos"])


def test_producto_simple_vendido_sin_combo_no_es_completo(fuentes):
    fuentes["alegra"] = _alegra(AGDSTGL=("product", "active"))
    fuentes["meli"] = {"AGDSTGL": _pub()}
    f = _fila("AGDSTGL")
    assert f["canales"]["facturable"]["estado"] == "si"
    assert f["clasificacion"] == "incompleto"
    assert any(s["panel"] == "catalogo-alegra" for s in f["saltos"])


def test_todo_en_orden_es_completo(fuentes):
    fuentes["alegra"] = _alegra(**{"C-OK": ("kit", "active")})
    fuentes["meli"] = {"C-OK": _pub()}
    fuentes["web"] = {"C-OK": {"nombre": "OK", "cat": "Sales", "buyable": True, "stock": 5}}
    fuentes["combos"] = {"C-OK": _COMPLETO}
    fuentes["ean"] = {"C-OK": {"estado": "enlazado", "codigo": "7700000000001"}}
    f = _fila("C-OK")
    assert f["clasificacion"] == "completo"
    assert f["saltos"] == []


def test_materia_prima_sin_canal_no_entra_al_universo(fuentes):
    """Los productos simples no son SKU de venta: solo entran si un canal los referencia."""
    fuentes["alegra"] = _alegra(UREAg=("product", "active"))
    tabla = cp.tabla_maestra(refrescar=True)
    assert all(f["sku"] != "UREAg" for f in tabla["filas"])


def test_fuente_caida_se_anuncia_y_la_tabla_sale(fuentes, monkeypatch):
    def _rota():
        raise RuntimeError("cache corrupto")

    monkeypatch.setattr(cp, "_fuente_meli", _rota)
    fuentes["alegra"] = _alegra(**{"C-Z": ("kit", "active")})
    tabla = cp.tabla_maestra(refrescar=True)
    assert tabla["total"] == 1
    assert any("MeLi" in s["fuente"] for s in tabla["sin_senal"])


def test_contrato_y_resumen(fuentes):
    fuentes["meli"] = {"X1": _pub()}
    fuentes["alegra"] = _alegra(**{"C-OK": ("kit", "active")})
    tabla = cp.tabla_maestra(refrescar=True)
    assert set(tabla) >= {"filas", "total", "resumen", "sin_senal", "fuentes", "generado"}
    assert set(tabla["resumen"]) == set(cp.CLASIFICACIONES)
    assert sum(tabla["resumen"].values()) == tabla["total"]
    for f in tabla["filas"]:
        assert f["clasificacion"] in cp.CLASIFICACIONES
        assert set(f["canales"]) == {"alegra", "combo", "documento", "ean", "etiqueta", "meli", "web", "facturable"}


def test_bloqueos_apuntan_al_panel(fuentes):
    fuentes["meli"] = {"X1": _pub()}
    cp.invalidar()
    bl = cp.resumen_bloqueos()
    assert bl and bl[0]["panel"] == "canales-producto" and bl[0]["etapa"] == "publicar"
    assert set(bl[0]) == {"etapa", "id", "n", "texto", "panel", "severidad"}
