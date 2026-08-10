"""Tests precios multicanal — prioridad MeLi → Siigo → Web."""

from app.services.precios_canales import (
    DOCUMENTACION_PRECIOS,
    envio_estimado_por_sku,
    obtener_documentacion_precios,
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
