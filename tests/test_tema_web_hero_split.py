"""Hero Clásico: splitPct mueve la división de los dos fondos."""

from __future__ import annotations

from app.tools import tema_web as tw


def test_split_pct_persiste_y_emite_vars(tmp_path, monkeypatch) -> None:
    pub = tmp_path / "tema_web.json"
    prev = tmp_path / "tema_web_preview.json"
    monkeypatch.setattr(tw, "TEMA_WEB_FILE", pub)
    monkeypatch.setattr(tw, "TEMA_WEB_PREVIEW_FILE", prev)
    tw._cache = {}
    tw._cache_mtime = None
    tw._preview_cache = None
    tw._preview_mtime = None

    tw.guardar_tema_web(
        {
            "layout_clasico": {
                "orden": ["hero", "features", "categorias", "destacados", "cta"],
                "nodos": {"hero": {"splitPct": 38, "basura": 1}},
            }
        }
    )
    nodos = tw.cargar_tema_web(force=True)["layout_clasico"]["nodos"]
    assert nodos["hero"]["splitPct"] == 38
    assert "basura" not in nodos["hero"]
    css = tw.estilo_nodo_layout(nodos["hero"])
    assert "--hero-split-izq:38%" in css
    assert "--hero-split-der:62%" in css


def test_split_pct_estilo_clampa() -> None:
    assert "--hero-split-izq:28%" in tw.estilo_nodo_layout({"splitPct": 10})
    assert "--hero-split-izq:72%" in tw.estilo_nodo_layout({"splitPct": 99})


def test_transform_no_pisa_display_grid_del_hero() -> None:
    css = tw.estilo_nodo_layout({"dx": -10, "dy": 4, "splitPct": 50})
    assert "transform:translate(-10px,4px)" in css
    assert "display:inline-block" not in css
    assert "--hero-split-izq:50%" in css
