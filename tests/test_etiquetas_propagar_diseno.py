"""Propagar el diseño de una plantilla de categoría a las etiquetas hechas con ella."""
import json

import pytest

from app.tools import etiquetas_fichas as ef


@pytest.fixture()
def almacen(tmp_path, monkeypatch):
    ruta = tmp_path / "etiquetas_fichas.json"
    fichas = [
        {
            "id": "tpl", "nombre": "Plantilla Aceites 30 mL", "es_plantilla_categoria": True,
            "categoria": "aceites", "tipo_nombre": "30 mL",
            "data": {
                "ordenCeldas": "origin,appearance,composition,odor,grade,storage",
                "storageSugerido": "Mantener bien cerrado.", "sinTimbreCentro": True,
                "clasificacionTitulo": "Modo de uso", "productName": "",
            },
            "attribute_icons": {"storage": "data:svg-candado"},
        },
        {
            "id": "hija", "nombre": "ACEITE NEEM 60mL", "plantilla_id": "tpl", "categoria": "aceites",
            "data": {"productName": "ACEITE NEEM", "cas": "8002-65-1", "storage": "Envase lleno."},
            "attribute_icons": {"origin": "data:svg-propio"},
        },
        {
            "id": "ajena", "nombre": "SAL ROSADA 500g", "plantilla_id": "otra",
            "data": {"productName": "SAL ROSADA", "storage": "Lugar seco."},
        },
    ]
    ruta.write_text(json.dumps({"fichas": fichas}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(ef, "_DATA_PATH", ruta)
    monkeypatch.setitem(ef._cache, "mtime", None)
    monkeypatch.setitem(ef._cache, "items", None)
    return ruta


def test_en_seco_informa_y_no_escribe(almacen):
    antes = almacen.read_text(encoding="utf-8")
    r = ef.propagar_diseno_plantilla("tpl", aplicar=False)
    assert [e["id"] for e in r["etiquetas"]] == ["hija"]
    assert "ordenCeldas" in r["etiquetas"][0]["cambios"]
    assert almacen.read_text(encoding="utf-8") == antes


def test_aplica_diseno_sin_tocar_datos_del_producto(almacen):
    ef.propagar_diseno_plantilla("tpl", aplicar=True)
    hija = ef.obtener_ficha("hija")
    assert hija["data"]["ordenCeldas"].startswith("origin,appearance")
    assert hija["data"]["sinTimbreCentro"] is True
    assert hija["data"]["storage"] == "Mantener bien cerrado."
    # Datos del producto e íconos propios que la plantilla no define: intactos.
    assert hija["data"]["productName"] == "ACEITE NEEM" and hija["data"]["cas"] == "8002-65-1"
    assert hija["attribute_icons"] == {"origin": "data:svg-propio", "storage": "data:svg-candado"}
    # Las etiquetas de otra plantilla no se tocan.
    assert ef.obtener_ficha("ajena")["data"] == {"productName": "SAL ROSADA", "storage": "Lugar seco."}
    # Repetirlo no cambia nada más.
    assert not any(e["cambios"] for e in ef.propagar_diseno_plantilla("tpl")["etiquetas"])


def test_rechaza_lo_que_no_es_plantilla(almacen):
    with pytest.raises(ValueError):
        ef.propagar_diseno_plantilla("hija", aplicar=True)
