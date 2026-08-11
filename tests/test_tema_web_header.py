"""Header del Studio: fuente, padding de botones y transición de color."""

from __future__ import annotations

from app.tools import tema_web as tw


def test_estilo_nodo_fuente_y_transicion() -> None:
    css = tw.estilo_nodo_layout(
        {
            "fontFamily": "serif",
            "fontSize": 14,
            "fontWeight": 700,
            "padX": 22,
            "padY": 12,
            "transition": "slow",
            "hoverColor": "#022d33",
            "hoverBackground": "#c0f0f5",
        }
    )
    assert "font-family:Georgia" in css
    assert "font-size:14px" in css
    assert "font-weight:700" in css
    assert "--studio-pad-x:22px" in css
    assert "--studio-pad-y:12px" in css
    assert "--studio-tr:0.5s" in css
    assert "transition:color 0.5s,background 0.5s" in css
    assert "--studio-hover-color:#022d33" in css
    assert "--studio-hover-bg:#c0f0f5" in css
    assert "padding:" not in css


def test_normalizar_header_nodos(tmp_path, monkeypatch) -> None:
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
                    "header.nav": {
                        "fontFamily": "system",
                        "fontSize": 12,
                        "padX": 16,
                        "padY": 10,
                        "transition": "fast",
                        "hoverColor": "#04353b",
                        "basura": "x",
                    },
                    "header.btn_wa": {"fontFamily": "mono", "padX": 20, "padY": 9},
                },
            }
        }
    )
    nodos = tw.cargar_tema_web(force=True)["layout_clasico"]["nodos"]
    nav = nodos["header.nav"]
    assert nav["fontFamily"] == "system"
    assert nav["fontSize"] == 12
    assert nav["padX"] == 16
    assert nav["transition"] == "fast"
    assert nav["hoverColor"] == "#04353b"
    assert "basura" not in nav
    assert nodos["header.btn_wa"]["fontFamily"] == "mono"
    estilos = tw.resolver_layout_ctx(
        tw.cargar_tema_web(force=True), key="layout_clasico"
    )["estilos"]
    assert "--studio-tr:0.12s" in estilos["header.nav"]
    assert "font-family:system-ui" in estilos["header.nav"]


def test_estilo_boton_nav_individual(tmp_path, monkeypatch) -> None:
    pub = tmp_path / "tema_web.json"
    prev = tmp_path / "tema_web_preview.json"
    monkeypatch.setattr(tw, "TEMA_WEB_FILE", pub)
    monkeypatch.setattr(tw, "TEMA_WEB_PREVIEW_FILE", prev)
    tw._cache = {}
    tw._cache_mtime = None
    tw._preview_cache = None
    tw._preview_mtime = None

    assert "header.nav.inicio" in tw.HEADER_NAV_BTN_IDS
    tw.guardar_tema_web(
        {
            "layout_clasico": {
                "orden": ["hero", "features", "categorias", "destacados", "cta"],
                "nodos": {
                    "header.nav.inicio": {
                        "fontSize": 14,
                        "padX": 22,
                        "padY": 12,
                        "hoverColor": "#022d33",
                        "background": "#c0f0f5",
                    },
                    "header.nav.blog": {"hidden": True, "fontSize": 11},
                    "header.nav.catalogo": {"fontFamily": "serif", "color": "#0c6069"},
                },
            }
        }
    )
    ctx = tw.resolver_layout_ctx(tw.cargar_tema_web(force=True), key="layout_clasico")
    nodos = ctx["nodos"]
    assert nodos["header.nav.inicio"]["fontSize"] == 14
    assert nodos["header.nav.inicio"]["padX"] == 22
    assert nodos["header.nav.blog"]["hidden"] is True
    inicio = ctx["estilos"]["header.nav.inicio"]
    assert "font-size:14px" in inicio
    assert "--studio-pad-x:22px" in inicio
    assert "--studio-hover-color:#022d33" in inicio
    assert "background-color:#c0f0f5" in inicio
    assert ctx["nodos"]["header.nav.catalogo"]["fontFamily"] == "serif"
    assert "font-family:Georgia" in ctx["estilos"]["header.nav.catalogo"]
    assert ctx["estilos"]["header.nav.blog"] == "display:none"


def test_estilo_header_no_translate_ni_caja() -> None:
    css = tw.estilo_nodo_layout(
        {"dx": 180, "dy": 12, "width": 900, "height": 72, "scale": 1.1},
        "header",
    )
    assert "transform" not in css
    assert "width:" not in css
    assert "height:72" not in css


def test_estilo_logo_solo_var_alto() -> None:
    css = tw.estilo_nodo_layout(
        {"dx": 120, "width": 171, "height": 44},
        "header.logo",
    )
    assert "transform" not in css
    assert "width:171" not in css
    assert "height:44px" not in css
    assert "--studio-logo-h:44px" in css


def test_css_header_nav_flex_como_el_lienzo() -> None:
    from pathlib import Path

    css = (Path(__file__).resolve().parents[1] / "PAGINA_WEB/site/static/css/main.css").read_text(
        encoding="utf-8"
    )
    bloque = css.split(".header-inner {", 1)[1].split(".site-logo", 1)[0]
    assert "justify-content: space-between" not in bloque
    assert "width: 100%" in bloque
    assert "margin: 0 auto" in bloque
    nav = css.split(".main-nav {", 1)[1].split(".main-nav ul li a:hover", 1)[0]
    assert "flex: 1 1 auto" in nav


def test_css_header_no_recorta_login_en_desktop() -> None:
    """Buscar/WA se ocultan antes; hamburguesa a 1100px evita cortar Iniciar sesión."""
    from pathlib import Path

    css = (Path(__file__).resolve().parents[1] / "PAGINA_WEB/site/static/css/main.css").read_text(
        encoding="utf-8"
    )
    i1200 = css.find("@media (max-width: 1200px)")
    i1100 = css.find("@media (max-width: 1100px)")
    i900 = css.find("@media (max-width: 900px)")
    assert i1200 != -1 and i1100 != -1 and i900 != -1
    assert i1200 < i1100 < i900
    bloque_1200 = css[i1200:i1100]
    assert ".header-search { display: none; }" in bloque_1200
    assert ".btn-wa-header { display: none; }" in bloque_1200
    bloque_1100 = css[i1100:i900]
    assert ".main-nav { display: none; }" in bloque_1100
    assert ".menu-toggle { display: flex; }" in bloque_1100


def test_estilo_anuncio_ignora_translate() -> None:
    css = tw.estilo_nodo_layout({"dx": 80, "fontSize": 12}, "anuncio")
    assert "transform" not in css
    assert "font-size:12px" in css
