"""Paleta de fondos/colores del tema Clásico (y Pureza) en tema_web.json."""

from __future__ import annotations

import json

from app.tools import tema_web as tw


def _reset(tmp_path, monkeypatch) -> None:
    pub = tmp_path / "tema_web.json"
    prev = tmp_path / "tema_web_preview.json"
    monkeypatch.setattr(tw, "TEMA_WEB_FILE", pub)
    monkeypatch.setattr(tw, "TEMA_WEB_PREVIEW_FILE", prev)
    tw._cache = {}
    tw._cache_mtime = None
    tw._preview_cache = None
    tw._preview_mtime = None


def test_defaults_incluyen_colores_clasico(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    cfg = tw.cargar_tema_web(force=True)
    assert cfg["clasico"]["colores"]["fondo"] == "#e3fcff"
    assert cfg["clasico"]["colores"]["fondo_oscuro"] == "#022d33"
    assert cfg["clasico"]["colores"]["acento"] == "#0c6069"
    css = tw.resolver_colores_clasico_css(cfg)
    assert css["fondo"] == "#e3fcff"
    assert "color-mix" in css["green_pale"]


def test_guardar_colores_clasico_valida_hex(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    tw.guardar_tema_web(
        {
            "clasico": {
                "colores": {
                    "fondo": "#FFF8E7",
                    "fondo_oscuro": "#1a1a2e",
                    "acento": "rojo",
                    "basura": "#ff00ff",
                }
            }
        }
    )
    cfg = tw.cargar_tema_web(force=True)
    c = cfg["clasico"]["colores"]
    assert c["fondo"] == "#fff8e7"
    assert c["fondo_oscuro"] == "#1a1a2e"
    assert c["acento"] == "#0c6069"
    assert "basura" not in c


def test_restaurar_clasico_devuelve_colores_default(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    tw.guardar_tema_web({"clasico": {"colores": {"fondo": "#111111"}}})
    assert tw.cargar_tema_web(force=True)["clasico"]["colores"]["fondo"] == "#111111"
    restaurado = tw.restaurar_tema_clasico()
    assert restaurado["clasico"]["colores"]["fondo"] == "#e3fcff"


def test_preview_colores_no_publica(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    tw.guardar_tema_web({"clasico": {"colores": {"fondo": "#e3fcff"}}})
    pub = tw.TEMA_WEB_FILE.read_text(encoding="utf-8")
    tw.guardar_tema_preview({"clasico": {"colores": {"fondo": "#ffeecc"}}})
    assert tw.TEMA_WEB_FILE.read_text(encoding="utf-8") == pub
    draft = tw.cargar_tema_preview(force=True)
    assert draft["clasico"]["colores"]["fondo"] == "#ffeecc"
    publicado = tw.cargar_tema_web(force=True)
    assert publicado["clasico"]["colores"]["fondo"] == "#e3fcff"
    assert json.loads(pub)["clasico"]["colores"]["fondo"] == "#e3fcff"
