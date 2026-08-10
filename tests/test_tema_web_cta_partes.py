"""CTAs del home: caja, icono y texto son nodos distintos."""

from __future__ import annotations

from app.tools import tema_web as tw


def test_estilo_caja_e_icono_cta(tmp_path, monkeypatch) -> None:
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
                "nodos": {
                    "hero.cta_principal": {
                        "padX": 48,
                        "padY": 18,
                        "background": "#0c6069",
                        "hoverBackground": "#022d33",
                    },
                    "hero.cta_principal.icono": {"icono": "storefront", "fontSize": 18},
                    "hero.cta_principal.texto": {"fontSize": 12, "color": "#ffffff"},
                    "hero.cta_secundario.icono": {"hidden": True},
                },
            }
        }
    )
    ctx = tw.resolver_layout_ctx(tw.cargar_tema_web(force=True), key="layout_clasico")
    caja = ctx["estilos"]["hero.cta_principal"]
    assert "--studio-pad-x:48px" in caja
    assert "background-color:#0c6069" in caja
    assert "--studio-hover-bg:#022d33" in caja
    icono = ctx["nodos"]["hero.cta_principal.icono"]
    assert icono["icono"] == "storefront"
    assert "font-size:18px" in ctx["estilos"]["hero.cta_principal.icono"]
    assert "font-size:12px" in ctx["estilos"]["hero.cta_principal.texto"]
    assert ctx["estilos"]["hero.cta_secundario.icono"] == "display:none"


def test_estilo_caja_cta_con_ancho_forzado() -> None:
    css = tw.estilo_nodo_layout({"width": 240, "height": 52, "background": "#0c6069"})
    assert "width:240px" in css
    assert "height:52px" in css
    assert "box-sizing:border-box" in css
    assert "background-color:#0c6069" in css
