"""Visor 3D del grafo de código: reescritura de rutas del bundle y guardas del proxy."""

import pytest

from app.routes_arquitectura import CSP_VISOR, reescribir_visor


def test_html_apunta_assets_bajo_cbm():
    html = b'<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="stylesheet" href="/assets/index-B.css">'
    out = reescribir_visor(html, "text/html; charset=utf-8", "/").decode()
    assert 'src="/app/cbm/assets/index-A.js"' in out
    assert 'href="/app/cbm/assets/index-B.css"' in out


def test_js_reescribe_api_y_rpc_con_las_tres_comillas():
    js = b'fetch("/api/ui-config");fetch(`/api/layout?${r}`);fetch("/rpc",{method:"POST"});x=\'/api/adr\';y="/apix"'
    out = reescribir_visor(js, "text/javascript", "/assets/index-A.js").decode()
    assert 'fetch("/app/cbm/api/ui-config")' in out
    assert "fetch(`/app/cbm/api/layout?${r}`)" in out
    assert 'fetch("/app/cbm/rpc",' in out
    assert "\'/app/cbm/api/adr\'" in out
    # "/apix" no es /api/: no se toca
    assert 'y="/apix"' in out


def test_js_no_toca_urls_absolutas_ni_relativas():
    js = b'import("./chunk-B.js");u="https://github.com/x/api/y";v="//cdn/api"'
    assert reescribir_visor(js, "text/javascript", "/assets/a.js") == js


def test_css_reescribe_url_raiz():
    css = b"@font-face{src:url(/assets/f.woff2)}a{background:url(\"/img/x.png\")}b{background:url(data:x)}"
    out = reescribir_visor(css, "text/css", "/assets/a.css").decode()
    assert "url(/app/cbm/assets/f.woff2)" in out
    assert 'url("/app/cbm/img/x.png")' in out
    assert "url(data:x)" in out


def test_binarios_pasan_intactos():
    raw = b"\x89PNG\r\n\x1a\n\x00/api/"
    assert reescribir_visor(raw, "image/png", "/assets/x.png") == raw


def test_csp_embebible_en_el_panel():
    assert "frame-ancestors 'self'" in CSP_VISOR
    assert "wasm-unsafe-eval" in CSP_VISOR


@pytest.fixture
def cliente(monkeypatch):
    from flask import Flask

    from app.routes_arquitectura import register_arquitectura_routes

    app = Flask(__name__)
    register_arquitectura_routes(app)
    monkeypatch.setenv("CHAT_API_TOKEN", "token-de-prueba-xyz")
    return app.test_client()


def test_proxy_sin_sesion_responde_401(cliente):
    r = cliente.get("/app/cbm/")
    assert r.status_code == 401


def test_proxy_con_visor_apagado_responde_502(cliente, monkeypatch):
    # Un puerto donde no escucha nadie: el proxy lo dice, no se cae.
    monkeypatch.setenv("CBM_UI_URL", "http://127.0.0.1:1")
    r = cliente.get("/app/cbm/", headers={"Authorization": "Bearer token-de-prueba-xyz"})
    assert r.status_code == 502
    assert r.get_json()["error"] == "visor_apagado"
