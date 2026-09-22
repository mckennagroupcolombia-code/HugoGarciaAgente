"""Agenda → Juegos: la página exige sesión, todo sale con la CSP que aísla al juego
(sandbox + sin red) y la ruta no deja salir de desktop/dist/juegos/."""
from __future__ import annotations

from pathlib import Path

import pytest
from flask import Flask

from app import routes, spa_sesion

_DIST = Path(__file__).resolve().parents[1] / "desktop" / "dist" / "juegos" / "duckhunt" / "index.html"


@pytest.fixture
def client(monkeypatch):
    if not _DIST.exists():
        pytest.skip("panel sin compilar (cd desktop && npm run build)")
    app = Flask(__name__)
    app.config["TESTING"] = True
    routes.register_routes(app)
    monkeypatch.setattr(spa_sesion, "gate_activo", lambda: True)
    return app.test_client()


def test_la_pagina_del_juego_exige_sesion(client, monkeypatch):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: None)
    assert client.get("/app/juegos/duckhunt/index.html").status_code == 403
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: {"id": 1})
    r = client.get("/app/juegos/duckhunt/index.html")
    assert r.status_code == 200
    csp = r.headers["Content-Security-Policy"]
    assert "sandbox allow-scripts" in csp and "allow-same-origin" not in csp
    assert "connect-src 'none'" in csp


@pytest.mark.parametrize("juego", ["duckhunt", "circus"])
def test_cada_juego_exige_sesion_en_su_pagina(client, monkeypatch, juego):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: None)
    assert client.get(f"/app/juegos/{juego}/index.html").status_code == 403
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: {"id": 1})
    r = client.get(f"/app/juegos/{juego}/index.html")
    assert r.status_code == 200 and "connect-src 'none'" in r.headers["Content-Security-Policy"]


def test_los_assets_salen_con_la_misma_csp(client, monkeypatch):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: None)
    r = client.get("/app/juegos/duckhunt/src/Duck.js")
    assert r.status_code == 200 and "sandbox allow-scripts" in r.headers["Content-Security-Policy"]


@pytest.mark.parametrize("ruta", ["../index.html", "duckhunt/../../../../.env", "..%2f..%2f.env"])
def test_no_se_sale_de_la_carpeta_de_juegos(client, monkeypatch, ruta):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: {"id": 1})
    assert client.get(f"/app/juegos/{ruta}").status_code in (403, 404)


def test_el_juego_no_trae_ejecutables_ni_llamadas_externas():
    raiz = Path(__file__).resolve().parents[1] / "desktop" / "public" / "juegos"
    for p in raiz.rglob("*"):
        assert p.suffix.lower() not in (".exe", ".swf", ".dll", ".php"), p
    for p in list(raiz.rglob("*.html")) + list(raiz.rglob("*.js")):
        texto = p.read_text(encoding="utf-8", errors="ignore")
        if p.name == "sonidos_datos.js" or "externalLib" in p.parts:
            continue  # base64 de los MP3 · librerías de terceros ya revisadas a mano (cake.js, YUI)
        for linea in texto.splitlines():
            if linea.lstrip().startswith(("*", "//", "#")):
                continue  # comentarios con la URL del repositorio de origen
            assert "http://" not in linea and "https://" not in linea and "//platform" not in linea, (p, linea)
            assert "fetch(" not in linea and "XMLHttpRequest" not in linea and "localStorage" not in linea, (p, linea)
