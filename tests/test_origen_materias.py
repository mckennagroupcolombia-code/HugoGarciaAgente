"""País de origen de materias primas por línea comercial + overrides por SKU."""

from __future__ import annotations

from app.tools import origen_materias as om


def _reset(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(om, "ORIGEN_MATERIAS_FILE", tmp_path / "origen_materias.json")
    om._cache = {}
    om._cache_mtime = None


def test_defaults_vacios(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    cfg = om.cargar_origen_materias(force=True)
    assert cfg["lineas_default"] == {}
    assert cfg["overrides_sku"] == {}
    assert cfg["paises"] == {}


def test_guardar_linea_default_y_resolver(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    cfg = om.guardar_origen_materias({"lineas_default": {"cosmetica": "China"}})
    assert cfg["lineas_default"]["cosmetica"] == "China"
    # país sugerido se auto-registra con coordenadas
    assert cfg["paises"]["China"]["lat"] == 35.0
    assert om.resolver_pais_sku("SKU-1", "cosmetica") == "China"


def test_override_sku_pisa_linea(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    om.guardar_origen_materias({"lineas_default": {"cosmetica": "China"}})
    om.guardar_origen_materias({"overrides_sku": {"SKU-1": "India"}})
    assert om.resolver_pais_sku("SKU-1", "cosmetica") == "India"
    assert om.resolver_pais_sku("SKU-2", "cosmetica") == "China"


def test_linea_invalida_se_descarta(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    cfg = om.guardar_origen_materias({"lineas_default": {"linea-inventada": "China", "cosmetica": "China"}})
    assert "linea-inventada" not in cfg["lineas_default"]
    assert cfg["lineas_default"]["cosmetica"] == "China"


def test_resumen(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    om.guardar_origen_materias({
        "lineas_default": {"cosmetica": "China", "laboratorio": "Estados Unidos"},
        "overrides_sku": {"SKU-1": "India"},
    })
    r = om.resumen()
    assert r["lineas_cubiertas"] == 2
    assert r["total_lineas"] == 6
    assert r["overrides_sku"] == 1
    assert set(r["paises_usados"]) == {"China", "Estados Unidos", "India"}


def test_cambios_invalidos_lanzan_value_error(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    try:
        om.guardar_origen_materias({"lineas_default": "no-es-un-dict"})
        assert False, "debería haber lanzado ValueError"
    except ValueError:
        pass


def test_escritura_atomica_persiste_entre_cargas(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    om.guardar_origen_materias({"lineas_default": {"agro": "Brasil"}})
    om._cache = {}
    om._cache_mtime = None
    cfg = om.cargar_origen_materias()
    assert cfg["lineas_default"]["agro"] == "Brasil"
