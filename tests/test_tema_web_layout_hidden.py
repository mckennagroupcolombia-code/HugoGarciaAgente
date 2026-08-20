"""Nodos hidden del Studio: persistencia y CSS del sitio."""

from __future__ import annotations

from app.tools import tema_web as tw


def test_estilo_nodo_hidden_es_display_none() -> None:
    assert tw.estilo_nodo_layout({"hidden": True}) == "display:none"
    assert "display:none" not in tw.estilo_nodo_layout({"dx": 8})


def test_normalizar_layout_preserva_hidden(tmp_path, monkeypatch) -> None:
    pub = tmp_path / "tema_web.json"
    monkeypatch.setattr(tw, "TEMA_WEB_FILE", pub)
    tw._cache = {}
    tw._cache_mtime = None

    tw.guardar_tema_web(
        {
            "layout_clasico": {
                "orden": ["hero", "features", "categorias", "destacados", "cta"],
                "nodos": {
                    "anuncio": {"hidden": True},
                    "header": {"hidden": True},
                    "hero.cta_principal": {"hidden": True},
                    "hero.kit.0": {"hidden": True},
                },
            }
        }
    )
    cfg = tw.cargar_tema_web(force=True)
    nodos = cfg["layout_clasico"]["nodos"]
    assert nodos["anuncio"]["hidden"] is True
    assert nodos["header"]["hidden"] is True
    assert nodos["hero.cta_principal"]["hidden"] is True
    assert nodos["hero.kit.0"]["hidden"] is True
    ctx = tw.resolver_layout_ctx(cfg, key="layout_clasico")
    assert ctx["estilos"]["anuncio"] == "display:none"
    assert ctx["estilos"]["header"] == "display:none"
