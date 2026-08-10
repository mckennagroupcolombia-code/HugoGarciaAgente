"""Tests del cruce de códigos MeLi ↔ Siigo (sin APIs externas)."""

from app.tools.relacion_codigos_meli_siigo import (
    _es_prefijo_combo,
    _estado_fila,
    _fila_tiene_prefijo_c,
    _sku_desde_item_meli,
)


def test_sku_desde_seller_custom_field():
    assert _sku_desde_item_meli({"seller_custom_field": "C-UREA250g"}) == "C-UREA250g"


def test_sku_prioriza_seller_sku_sobre_custom_field():
    body = {
        "seller_custom_field": "VIEJO",
        "attributes": [{"id": "SELLER_SKU", "value_name": "C-NUEVO100g"}],
    }
    assert _sku_desde_item_meli(body) == "C-NUEVO100g"


def test_sku_desde_atributo_seller_sku():
    body = {
        "seller_custom_field": "",
        "attributes": [{"id": "SELLER_SKU", "value_name": "ALGNA100g"}],
    }
    assert _sku_desde_item_meli(body) == "ALGNA100g"


def test_sku_desde_variacion():
    body = {
        "seller_custom_field": "",
        "attributes": [],
        "variations": [
            {"id": 1, "attributes": [{"id": "SELLER_SKU", "value_name": "C-TEST100g"}]},
        ],
    }
    assert _sku_desde_item_meli(body) == "C-TEST100g"


def test_estado_vinculado_cuando_coincide():
    assert (
        _estado_fila(
            sku_meli="C-UREA250g",
            codigo_siigo="C-UREA250g",
            en_siigo=True,
            sku_coincide=True,
        )
        == "vinculado"
    )


def test_estado_divergente():
    assert (
        _estado_fila(
            sku_meli="ALGNA100g",
            codigo_siigo="ALGNA100GR",
            en_siigo=True,
            sku_coincide=False,
        )
        == "sku_divergente"
    )


def test_estado_sin_siigo():
    assert (
        _estado_fila(
            sku_meli="AS-99",
            codigo_siigo="AS-99",
            en_siigo=False,
            sku_coincide=True,
        )
        == "sin_siigo"
    )


def test_estado_sin_codigo():
    assert (
        _estado_fila(
            sku_meli="",
            codigo_siigo="",
            en_siigo=False,
            sku_coincide=False,
        )
        == "sin_codigo"
    )


def test_es_prefijo_combo_normal_y_con_espacio():
    assert _es_prefijo_combo("C-UREA250g") is True
    assert _es_prefijo_combo("c-urea250g") is True
    assert _es_prefijo_combo("C- PISTOS250g") is True
    assert _es_prefijo_combo("ALGNA100g") is False
    assert _es_prefijo_combo("") is False
    assert _es_prefijo_combo("X-C-FOO") is False


def test_fila_tiene_prefijo_c_por_sku_o_siigo():
    assert _fila_tiene_prefijo_c({"sku_meli": "C-UREA250g", "codigo_siigo": ""}) is True
    assert _fila_tiene_prefijo_c({"sku_meli": "", "codigo_siigo": "C-ALGNA100g"}) is True
    assert _fila_tiene_prefijo_c({"sku_meli": "ALGNA100g", "codigo_siigo": "ALGNA100g"}) is False
    assert _fila_tiene_prefijo_c({"sku_meli": "", "codigo_siigo": ""}) is False


def test_filtro_sin_c_lista_solo_sin_prefijo(monkeypatch):
    from app.tools import relacion_codigos_meli_siigo as mod

    cache_items = [
        {
            "meli_id": "MCO1",
            "titulo": "Con combo",
            "sku_meli": "C-UREA250g",
            "codigo_siigo": "C-UREA250g",
            "nombre_siigo": "",
            "estado": "vinculado",
        },
        {
            "meli_id": "MCO2",
            "titulo": "Sin C",
            "sku_meli": "ALGNA100g",
            "codigo_siigo": "ALGNA100g",
            "nombre_siigo": "",
            "estado": "sin_siigo",
        },
        {
            "meli_id": "MCO3",
            "titulo": "Vacio",
            "sku_meli": "",
            "codigo_siigo": "",
            "nombre_siigo": "",
            "estado": "sin_codigo",
        },
    ]
    monkeypatch.setattr(
        mod,
        "_load_cache",
        lambda: {
            "version": 2,
            "ts": 9e12,
            "actualizado_en": "2099-01-01T00:00:00",
            "items": cache_items,
            "error": None,
        },
    )
    res = mod.listar_relacion_codigos_meli_siigo(filtro="sin_c", refresh=False)
    ids = {it["meli_id"] for it in res["items"]}
    assert ids == {"MCO2", "MCO3"}
    assert res["totales"]["sin_c"] == 2
    assert res["totales"]["filtrados"] == 2


def test_editar_relacion_requiere_codigo():
    from app.tools.relacion_codigos_meli_siigo import editar_relacion_codigos
    import pytest

    with pytest.raises(ValueError, match="sku_meli"):
        editar_relacion_codigos("MCO123", sku_meli="", codigo_siigo="")


def test_editar_relacion_sku_y_vinculo(monkeypatch):
    from app.tools import relacion_codigos_meli_siigo as mod

    calls = {"sku": None, "vinc": None}

    def fake_sku(mid, sku):
        calls["sku"] = (mid, sku)
        return {"ok": True, "meli_id": mid, "sku_antes": "OLD", "sku_meli": sku}

    def fake_vinc(codigo, mid):
        calls["vinc"] = (codigo, mid)
        return {"ok": True, "codigo_siigo": codigo, "meli_id": mid, "en_siigo": False}

    monkeypatch.setattr(mod, "actualizar_sku_meli_item", fake_sku)
    monkeypatch.setattr(mod, "vincular_meli_con_siigo", fake_vinc)

    res = mod.editar_relacion_codigos(
        "MCO999", sku_meli="C-NUEVO100g", codigo_siigo="", vincular_si_sku=True
    )
    assert calls["sku"] == ("MCO999", "C-NUEVO100g")
    assert calls["vinc"] == ("C-NUEVO100g", "MCO999")
    assert res["meli"]["sku_meli"] == "C-NUEVO100g"
    assert res["vinculo"]["codigo_siigo"] == "C-NUEVO100g"
