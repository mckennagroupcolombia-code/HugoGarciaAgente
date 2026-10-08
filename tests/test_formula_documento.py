"""Documento técnico enlazado a mano a una fórmula (`formula_id` en su YAML)."""
import json

import pytest
import yaml

from app.services import formulas_db, mapa_producto
from app.services import ficha_tecnica as ft


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    archivo = tmp_path / "formulas.json"
    archivo.write_text(json.dumps({"formulas": [{
        "id": "abc123def456", "nombre": "ALOE VERA mL", "sku_alegra": "C-FOR-EXTALOVERmL",
        "ingredientes": [{"codigo": "", "nombre": "AGUA DESTILADA", "porcentaje": 98.5},
                         {"codigo": "", "nombre": "GEL DE ALOE", "porcentaje": 1.5}],
    }]}), encoding="utf-8")
    monkeypatch.setattr(formulas_db, "_ARCHIVO", str(archivo))
    monkeypatch.setattr(formulas_db, "_CANDADO", str(archivo) + ".lock")
    datos = tmp_path / "datos"
    datos.mkdir()
    (datos / "ft_coa_sds_aloe.yaml").write_text(
        "titulo: ALOE VERA\nnombre_producto: ALOE VERA\nreferencia: ALOMPg\ndescripcion: |\n  Gel.\n",
        encoding="utf-8")
    monkeypatch.setattr(ft, "DATOS_DIR", datos)
    monkeypatch.setattr(mapa_producto, "invalidar", lambda: None)
    return datos


def test_enlazar_y_quitar_formula_toca_solo_una_linea(entorno):
    ruta = entorno / "ft_coa_sds_aloe.yaml"
    antes = yaml.safe_load(ruta.read_text(encoding="utf-8"))

    r = mapa_producto.fijar_formula_documento("ft_coa_sds_aloe.yaml", "abc123def456")
    assert r["ok"] and r["formula_id"] == "abc123def456"
    despues = yaml.safe_load(ruta.read_text(encoding="utf-8"))
    assert despues.pop("formula_id") == "abc123def456"
    assert despues == antes

    assert mapa_producto.fijar_formula_documento("ft_coa_sds_aloe.yaml", "abc123def456")["sin_cambios"]

    mapa_producto.fijar_formula_documento("ft_coa_sds_aloe.yaml", "")
    assert yaml.safe_load(ruta.read_text(encoding="utf-8")) == antes


def test_formula_inexistente_no_se_escribe(entorno):
    with pytest.raises(ValueError):
        mapa_producto.fijar_formula_documento("ft_coa_sds_aloe.yaml", "ffffffffffff")
    assert "formula_id" not in (entorno / "ft_coa_sds_aloe.yaml").read_text(encoding="utf-8")


def test_composicion_por_id_aunque_la_referencia_no_sea_el_sku(entorno, monkeypatch):
    monkeypatch.setattr(mapa_producto, "_auditoria", lambda: (_ for _ in ()).throw(RuntimeError("sin catálogo")))
    assert formulas_db.composicion_por_sku("ALOMPg") is None
    c = formulas_db.composicion_por_id("abc123def456")
    assert c["sku"] == "C-FOR-EXTALOVERmL"
    assert c["filas"] == [["Agua destilada", "98,5 %", ""], ["Gel de aloe", "1,5 %", ""]]
    assert formulas_db.resumen() == [{"id": "abc123def456", "nombre": "ALOE VERA mL", "sku": "C-FOR-EXTALOVERmL"}]
