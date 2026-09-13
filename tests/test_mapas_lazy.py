"""Los dos mapas de la portada (mundo y Colombia) viajan fuera del HTML y se
cargan por fetch cuando la sección se acerca a la pantalla (sep-2026)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SITE = REPO / "PAGINA_WEB" / "site"
sys.path.insert(0, str(SITE))

import website  # noqa: E402


def _home() -> str:
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        return c.get("/").get_data(as_text=True)


def test_portada_no_trae_la_geometria_de_los_mapas():
    html = _home()
    assert 'id="dep-ama"' not in html  # departamentos de Colombia
    assert html.count("data-lazy-svg") == 2
    assert "maps/world_land.svg.html" in html and "maps/colombia_map.svg.html" in html
    assert len(html.encode("utf-8")) < 200_000  # antes: 260 KB


def test_fragmentos_estaticos_validos():
    for nombre, marca in (("world_land.svg.html", "<path"), ("colombia_map.svg.html", 'id="dep-ama"')):
        f = SITE / "static" / "maps" / nombre
        s = f.read_text(encoding="utf-8")
        assert marca in s
        assert "{#" not in s and "{{" not in s and "{%" not in s, "el fragmento no puede llevar Jinja: se sirve tal cual"


def test_fragmentos_se_sirven_como_estaticos():
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        r = c.get("/static/maps/colombia_map.svg.html")
        assert r.status_code == 200
        assert b'class="co-dep"' in r.data


def test_los_datos_de_interaccion_siguen_en_linea():
    """El JS necesita rutas y departamentos al arrancar; solo la geometría es diferida."""
    html = _home()
    assert "data-tz-data" in html and "data-co-data" in html
    assert 'data-tz-pin="' in html
