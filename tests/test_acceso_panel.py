"""El panel (/app y su bundle) no se entrega sin sesión.

Hasta el 21-sep-2026 `GET https://bot.mckennagroup.co/app` respondía 200 a
cualquiera y con él todo el JavaScript del panel: la estructura de módulos, los
textos internos y la superficie de la API. Lo público ahora es solo la pantalla
de ingreso. Ver app/spa_sesion.py.
"""
from __future__ import annotations

import pytest
from flask import Flask

from app import spa_sesion

USUARIO = {"id": 8, "nombre": "Armando", "rol": {"nivel": 3}, "permisos_secciones": {}}


@pytest.fixture()
def cliente(monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-sistema")
    from app.routes import register_routes
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "get_usuario_by_token",
                        lambda t: USUARIO if t == "sesion-viva" else None)
    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_sin_sesion_solo_se_ve_la_pantalla_de_ingreso(cliente):
    r = cliente.get("/app")
    assert r.status_code == 200
    cuerpo = r.get_data(as_text=True)
    assert "Entrar" in cuerpo
    # Nada del panel: ni el bundle ni los nombres de los módulos.
    assert "/app/assets/" not in cuerpo and "index-" not in cuerpo


def test_sin_sesion_el_bundle_no_se_descarga(cliente):
    r = cliente.get("/app/assets/index-abc123.js")
    assert r.status_code == 403
    r = cliente.get("/app/assets/vendor-abc123.js", headers={"Cookie": f"{spa_sesion.COOKIE}=inventada"})
    assert r.status_code == 403


def test_con_la_cookie_el_bundle_se_sirve(cliente):
    cliente.set_cookie(spa_sesion.COOKIE, "sesion-viva", path="/app")
    r = cliente.get("/app/assets/no-existe-igual.js")
    assert r.status_code == 404           # pasa el guardia; el archivo es otro cuento


def test_el_token_de_la_vuelta_de_google_deja_la_cookie(cliente):
    r = cliente.get("/app?_token=sesion-viva")
    assert r.status_code in (200, 404)    # 404 si no hay build compilado en esta máquina
    if r.status_code == 200:
        assert spa_sesion.COOKIE in r.headers.get("Set-Cookie", "")


def test_un_token_vencido_no_abre_el_panel(cliente):
    r = cliente.get("/app?_token=vencido")
    assert r.status_code == 200 and "Entrar" in r.get_data(as_text=True)
    assert spa_sesion.COOKIE not in r.headers.get("Set-Cookie", "")


def test_la_pantalla_de_ingreso_no_cuenta_nada_del_proyecto():
    html = spa_sesion.pagina_ingreso()
    # Las dos rutas de ingreso son inevitables (el formulario tiene que enviar a
    # algún lado); lo que no puede aparecer es qué hace la casa por dentro.
    for palabra in ("Alegra", "MercadoLibre", "Siigo", "Colaboradores", "Contabilidad",
                    "inventario", "nómina", "/api/pagos", "/api/contabilidad"):
        assert palabra not in html
    assert html.count("/api/") == 2 and "/api/tickets/auth/" in html


# ── Build de colaboradores (dist-colab) y sourcemaps ─────────────────────────
# Un colaborador externo recibe otra aplicación (desktop/vite.colab.config.ts),
# no el panel con partes ocultas; y nadie recibe los .map (traen el código fuente).

from pathlib import Path

COLAB = {"id": 13, "nombre": "Colaborador", "rol": {"nivel": 1},
         "permisos_secciones": {"colaborador_externo": True, "colaboradores": True, "tickets": True}}
_DESKTOP = Path(__file__).resolve().parent.parent / "desktop"


@pytest.fixture()
def cliente2(monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-sistema")
    from app.routes import register_routes
    from app.services import tickets_db

    usuarios = {"sesion-viva": USUARIO, "sesion-colab": COLAB}
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda t: usuarios.get(t))
    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _un_archivo(carpeta: Path, patron: str):
    hits = sorted(carpeta.glob(patron)) if carpeta.is_dir() else []
    return hits[0].name if hits else None


def test_los_sourcemaps_no_se_entregan_ni_con_sesion(cliente2):
    cliente2.set_cookie(spa_sesion.COOKIE, "sesion-viva", path="/app")
    nombre = _un_archivo(_DESKTOP / "dist" / "assets", "*.js.map") or "index-abc.js.map"
    assert cliente2.get(f"/app/assets/{nombre}").status_code == 404
    assert cliente2.get(f"/app/assets/{nombre.upper()}").status_code == 404


def test_el_colaborador_recibe_su_propia_app(cliente2):
    if not (_DESKTOP / "dist-colab" / "colaboradores.html").is_file():
        pytest.skip("sin build de colaboradores en esta máquina")
    cliente2.set_cookie(spa_sesion.COOKIE, "sesion-colab", path="/app")
    html = cliente2.get("/app").get_data(as_text=True)
    assert "Colaboradores" in html and "Panel de Operaciones" not in html


def test_el_colaborador_no_descarga_chunks_del_panel(cliente2):
    nombre = _un_archivo(_DESKTOP / "dist" / "assets", "index-*.js")
    if not nombre:
        pytest.skip("sin build del panel en esta máquina")
    cliente2.set_cookie(spa_sesion.COOKIE, "sesion-colab", path="/app")
    assert cliente2.get(f"/app/assets/{nombre}").status_code == 404
    cliente2.set_cookie(spa_sesion.COOKIE, "sesion-viva", path="/app")
    assert cliente2.get(f"/app/assets/{nombre}").status_code == 200


def test_el_token_de_la_url_manda_sobre_la_cookie(cliente2):
    if not (_DESKTOP / "dist-colab" / "colaboradores.html").is_file():
        pytest.skip("sin build de colaboradores en esta máquina")
    cliente2.set_cookie(spa_sesion.COOKIE, "sesion-viva", path="/app")
    r = cliente2.get("/app?_token=sesion-colab")
    assert "Panel de Operaciones" not in r.get_data(as_text=True)
    assert "sesion-colab" in r.headers.get("Set-Cookie", "")
