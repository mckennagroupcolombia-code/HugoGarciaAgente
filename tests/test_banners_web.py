"""Banners promocionales del inicio del sitio web (vigencia por fecha + activo)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.tools import banners_web as bw


def _reset(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(bw, "BANNERS_FILE", tmp_path / "banners_promo.json")
    bw._cache = None
    bw._cache_mtime = None


def test_crear_banner_minimo(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    b = bw.crear_banner({"titulo": "Envío gratis"})
    assert b["id"].startswith("b_")
    assert b["activo"] is True
    assert b["link_tipo"] == "catalogo"
    assert bw.cargar_banners() == [b]


def test_titulo_vacio_falla(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        bw.crear_banner({"titulo": ""})


def test_link_tipo_invalido_falla(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        bw.crear_banner({"titulo": "x", "link_tipo": "no-existe"})


def test_fecha_invalida_falla(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        bw.crear_banner({"titulo": "x", "vigente_desde": "20-08-2026"})


def test_actualizar_y_eliminar(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    b = bw.crear_banner({"titulo": "Original"})
    actualizado = bw.actualizar_banner(b["id"], {"titulo": "Editado", "activo": False})
    assert actualizado["titulo"] == "Editado"
    assert actualizado["activo"] is False
    bw.eliminar_banner(b["id"])
    assert bw.cargar_banners() == []


def test_eliminar_inexistente_falla(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        bw.eliminar_banner("b_no_existe")


def test_banners_vigentes_filtra_inactivo(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    b = bw.crear_banner({"titulo": "Activo"})
    bw.crear_banner({"titulo": "Inactivo", "activo": False})
    assert [x["titulo"] for x in bw.banners_vigentes()] == ["Activo"]


def test_banners_vigentes_filtra_por_fecha(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    hoy = date.today()
    ayer = (hoy - timedelta(days=1)).isoformat()
    manana = (hoy + timedelta(days=1)).isoformat()
    bw.crear_banner({"titulo": "Vencido", "vigente_hasta": ayer})
    bw.crear_banner({"titulo": "Futuro", "vigente_desde": manana})
    bw.crear_banner({"titulo": "Vigente", "vigente_desde": ayer, "vigente_hasta": manana})
    assert [x["titulo"] for x in bw.banners_vigentes(hoy)] == ["Vigente"]


def test_orden_automatico_al_crear(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    b1 = bw.crear_banner({"titulo": "Primero"})
    b2 = bw.crear_banner({"titulo": "Segundo"})
    assert b1["orden"] == 0
    assert b2["orden"] == 1


def test_entradas_corruptas_no_tumban_la_carga(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    bw.BANNERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    bw.BANNERS_FILE.write_text('[{"titulo": ""}, {"titulo": "Bueno"}]', encoding="utf-8")
    bw._cache = None
    bw._cache_mtime = None
    items = bw.cargar_banners()
    assert [x["titulo"] for x in items] == ["Bueno"]
