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


@pytest.mark.parametrize("juego", ["duckhunt", "circus-nes", "bass", "chess"])
def test_cada_juego_exige_sesion_en_su_pagina(client, monkeypatch, juego):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: None)
    assert client.get(f"/app/juegos/{juego}/index.html").status_code == 403
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: {"id": 1})
    r = client.get(f"/app/juegos/{juego}/index.html")
    csp = r.headers["Content-Security-Policy"]
    assert r.status_code == 200 and "sandbox allow-scripts" in csp
    # sin red: cerrado del todo, o (juegos wasm) solo su propia carpeta
    assert "connect-src 'none'" in csp or "connect-src 'self'" in csp


def test_los_assets_salen_con_la_misma_csp(client, monkeypatch):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: None)
    r = client.get("/app/juegos/duckhunt/src/Duck.js")
    assert r.status_code == 200 and "sandbox allow-scripts" in r.headers["Content-Security-Policy"]


@pytest.mark.parametrize("ruta", ["../index.html", "duckhunt/../../../../.env", "..%2f..%2f.env"])
def test_no_se_sale_de_la_carpeta_de_juegos(client, monkeypatch, ruta):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: {"id": 1})
    assert client.get(f"/app/juegos/{ruta}").status_code in (403, 404)


def test_los_juegos_wasm_tienen_csp_propia_y_los_demas_siguen_cerrados(client, monkeypatch):
    monkeypatch.setattr(spa_sesion, "usuario_de_cookie", lambda: {"id": 1})
    csp = client.get("/app/juegos/bass/index.html").headers["Content-Security-Policy"]
    assert "'wasm-unsafe-eval'" in csp and "connect-src 'self'" in csp
    assert "127.0.0.1" not in csp and "localhost" not in csp   # la URL absoluta rompía tras el túnel
    assert client.get("/app/juegos/bass/emulador.js").headers.get("Access-Control-Allow-Origin") == "*"
    assert "Access-Control-Allow-Origin" not in client.get("/app/juegos/circus-nes/emulador.js").headers
    assert "sandbox allow-scripts" in csp and "allow-same-origin" not in csp
    otro = client.get("/app/juegos/circus-nes/index.html").headers["Content-Security-Policy"]
    assert "connect-src 'none'" in otro and "wasm-unsafe-eval" not in otro


def test_partidas_guardadas_por_usuario(client, monkeypatch, tmp_path):
    """La SRAM del cartucho se guarda por usuario del panel y vuelve tal cual; sin token, nada."""
    import base64

    monkeypatch.setattr(routes, "chat_api_token_matches_request", lambda: False)
    assert client.put("/api/juegos/partidas/bass", json={"datos": "AA=="}).status_code == 401

    from app.services import tickets_db
    from app import api_auth
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda tok: {"id": 7} if tok == "tok7" else None)
    monkeypatch.setattr(api_auth, "bearer_token_from_request", lambda: "tok7")
    monkeypatch.setenv("JUEGOS_PARTIDAS_DIR", str(tmp_path))   # no tocar las partidas reales
    cab = {"Authorization": "Bearer tok7"}
    datos = base64.b64encode(bytes(range(256)) * 32).decode()
    r = client.put("/api/juegos/partidas/bass", json={"datos": datos}, headers=cab)
    assert r.status_code == 200 and r.get_json()["bytes"] == 8192
    assert (tmp_path / "usuario_7" / "bass.sav").is_file()
    assert client.get("/api/juegos/partidas/bass", headers=cab).get_json()["datos"] == datos
    assert client.get("/api/juegos/partidas/otro", headers=cab).get_json()["datos"] is None
    assert client.put("/api/juegos/partidas/../x", json={"datos": datos}, headers=cab).status_code in (400, 404)
    assert client.put("/api/juegos/partidas/bass", json={"datos": "no-es-base64!"}, headers=cab).status_code == 400
    assert client.put("/api/juegos/partidas/bass", json={"datos": base64.b64encode(b"x" * 300000).decode()}, headers=cab).status_code == 400


def _b64(b: bytes) -> str:
    import base64
    return base64.b64encode(b).decode()


def test_los_admins_no_comparten_partida(client, monkeypatch, tmp_path):
    """Con CHAT_API_TOKEN la persona sale de X-Tickets-Token: antes todos caían en «comun»."""
    from app.services import tickets_db

    monkeypatch.setattr(routes, "chat_api_token_matches_request", lambda: True)
    monkeypatch.setattr(tickets_db, "get_usuario_by_token",
                        lambda tok: {"armando": {"id": 8}, "cynthia": {"id": 3}}.get(tok))
    monkeypatch.setenv("JUEGOS_PARTIDAS_DIR", str(tmp_path))
    a = {"Authorization": "Bearer sistema", "X-Tickets-Token": "armando"}
    c = {"Authorization": "Bearer sistema", "X-Tickets-Token": "cynthia"}
    assert client.put("/api/juegos/partidas/bass", json={"datos": _b64(b"A" * 10 + b"a")}, headers=a).status_code == 200
    assert client.put("/api/juegos/partidas/bass", json={"datos": _b64(b"C" * 10 + b"c")}, headers=c).status_code == 200
    assert client.get("/api/juegos/partidas/bass", headers=a).get_json()["datos"] == _b64(b"A" * 10 + b"a")
    assert client.get("/api/juegos/partidas/bass", headers=c).get_json()["datos"] == _b64(b"C" * 10 + b"c")
    # Token de sistema sin persona: ni lee ni guarda (no hay carpeta común).
    r = client.put("/api/juegos/partidas/bass", json={"datos": _b64(b"x1")}, headers={"Authorization": "Bearer sistema"})
    assert r.status_code == 403
    assert not (tmp_path / "comun").exists()


def test_respaldos_blanco_protegido_y_restaurar(client, monkeypatch, tmp_path):
    from app.services import tickets_db
    from app import api_auth

    monkeypatch.setattr(routes, "chat_api_token_matches_request", lambda: False)
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda tok: {"id": 7} if tok == "tok7" else None)
    monkeypatch.setattr(api_auth, "bearer_token_from_request", lambda: "tok7")
    monkeypatch.setenv("JUEGOS_PARTIDAS_DIR", str(tmp_path))
    cab = {"Authorization": "Bearer tok7"}
    v1, v2 = b"\x01\x02" * 8, b"\x03\x04" * 8
    client.put("/api/juegos/partidas/chess", json={"datos": _b64(v1)}, headers=cab)
    client.put("/api/juegos/partidas/chess", json={"datos": _b64(v2)}, headers=cab)
    # Una SRAM en blanco (el emulador arrancó sin leer la partida) no pisa la que tiene datos.
    r = client.put("/api/juegos/partidas/chess", json={"datos": _b64(b"\x00" * 16)}, headers=cab)
    assert r.get_json().get("protegida") is True
    assert client.get("/api/juegos/partidas/chess", headers=cab).get_json()["datos"] == _b64(v2)
    lista = client.get("/api/juegos/partidas/chess/respaldos", headers=cab).get_json()
    normales = [x for x in lista["respaldos"] if not x["en_blanco"]]
    assert len(normales) == 1 and any(x["en_blanco"] for x in lista["respaldos"])
    # Volver a v1: v2 queda como respaldo, no se pierde nada.
    r = client.post("/api/juegos/partidas/chess/restaurar", json={"respaldo": normales[0]["id"]}, headers=cab)
    assert r.status_code == 200
    assert client.get("/api/juegos/partidas/chess", headers=cab).get_json()["datos"] == _b64(v1)
    lista = client.get("/api/juegos/partidas/chess/respaldos", headers=cab).get_json()
    assert sum(1 for x in lista["respaldos"] if not x["en_blanco"]) == 2
    assert client.post("/api/juegos/partidas/chess/restaurar", json={"respaldo": "../../x"}, headers=cab).status_code == 400


def test_el_colaborador_externo_puede_guardar_su_partida(client, monkeypatch, tmp_path):
    from app.services import tickets_db, colaboradores
    from app import api_auth

    monkeypatch.setattr(routes, "chat_api_token_matches_request", lambda: False)
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda tok: {"id": 13} if tok == "seb" else None)
    monkeypatch.setattr(api_auth, "bearer_token_from_request", lambda: "seb")
    monkeypatch.setattr(colaboradores, "es_colaborador_externo", lambda u: bool(u) and u.get("id") == 13)
    monkeypatch.setenv("JUEGOS_PARTIDAS_DIR", str(tmp_path))
    cab = {"Authorization": "Bearer seb"}
    assert client.put("/api/juegos/partidas/bass", json={"datos": _b64(b"sebas")}, headers=cab).status_code == 200
    assert (tmp_path / "usuario_13" / "bass.sav").read_bytes() == b"sebas"
    # El resto de la API sigue cerrada para él.
    assert client.get("/api/metricas", headers=cab).status_code == 403


def test_el_juego_no_trae_ejecutables_ni_llamadas_externas():
    raiz = Path(__file__).resolve().parents[1] / "desktop" / "public" / "juegos"
    for p in raiz.rglob("*"):
        assert p.suffix.lower() not in (".exe", ".swf", ".dll", ".php"), p
    for p in list(raiz.rglob("*.html")) + list(raiz.rglob("*.js")):
        texto = p.read_text(encoding="utf-8", errors="ignore")
        if p.name.endswith("_datos.js") or "externalLib" in p.parts:
            continue  # base64 (MP3, ROM) · librerías de terceros ya revisadas a mano (cake.js, YUI, jsnes, snes9x)
        if "bass" in p.parts or "chess" in p.parts:
            continue  # emuladores wasm: usan fetch al mismo origen (CSP propia, ver _csp_juego)
        for linea in texto.splitlines():
            if linea.lstrip().startswith(("*", "//", "#")):
                continue  # comentarios con la URL del repositorio de origen
            assert "http://" not in linea and "https://" not in linea and "//platform" not in linea, (p, linea)
            assert "fetch(" not in linea and "XMLHttpRequest" not in linea and "localStorage" not in linea, (p, linea)
