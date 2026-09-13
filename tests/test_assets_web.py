"""Fase B del plan de portada (sep-2026): recursos estáticos livianos.
Fija que el sitio no vuelva a cargar el logo de 584 KB, fuentes TTF sin
subconjunto ni iconos desde unpkg."""

from __future__ import annotations

import re
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


def test_logo_del_header_es_la_version_liviana():
    html = _home()
    assert "img/isotipo-web.png" in html
    liviano = SITE / "static" / "img" / "isotipo-web.png"
    assert liviano.exists() and liviano.stat().st_size < 40_000
    # el original sigue existiendo para PDF, correo y pipelines
    assert (SITE / "static" / "img" / "isotipo.png").exists()


def test_iconos_phosphor_autoalojados_y_subconjuntados():
    html = _home()
    assert "unpkg.com" not in html
    assert "vendor/phosphor/regular/phosphor-subset.css" in html
    carpeta = SITE / "static" / "vendor" / "phosphor" / "regular"
    assert (carpeta / "Phosphor-subset.woff2").stat().st_size < 30_000
    css = (carpeta / "phosphor-subset.css").read_text(encoding="utf-8")
    assert "Phosphor-subset.woff2" in css


def test_todo_icono_usado_en_plantillas_esta_en_el_subconjunto():
    """Si alguien agrega un ph-* nuevo sin correr scripts/optimizar_assets_web.py,
    el icono saldría en blanco. Este test lo grita antes."""
    carpeta = SITE / "static" / "vendor" / "phosphor" / "regular"
    subset = set(re.findall(r"\.ph\.ph-([a-z0-9-]+):before", (carpeta / "phosphor-subset.css").read_text(encoding="utf-8")))
    completo = set(re.findall(r"\.ph\.ph-([a-z0-9-]+):before", (carpeta / "style.css").read_text(encoding="utf-8")))
    import importlib.util

    spec = importlib.util.spec_from_file_location("optimizar_assets_web", REPO / "scripts" / "optimizar_assets_web.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    usados = mod._iconos_usados()  # mismo rastreo que usa el generador
    assert {"bowl-food", "plant", "flask", "arrow-right"} <= usados  # nombres sueltos en dicts de Jinja
    faltan = sorted((usados & completo) - subset)
    assert not faltan, f"iconos sin subconjuntar: {faltan} -> correr scripts/optimizar_assets_web.py"


def test_fuentes_montserrat_en_woff2_con_subconjunto():
    css = (SITE / "static" / "css" / "fonts-montserrat.css").read_text(encoding="utf-8")
    woff2 = re.findall(r"fonts/montserrat/(Montserrat-[A-Za-z]+)\.woff2", css)
    assert len(woff2) >= 13
    for nombre in set(woff2):
        f = SITE / "static" / "fonts" / "montserrat" / f"{nombre}.woff2"
        assert f.exists(), nombre
        assert f.stat().st_size < 40_000, f"{nombre} no está subconjuntada"
    html = _home()
    assert 'rel="preload"' in html and "Montserrat-Regular.woff2" in html


def test_ilustracion_del_hero_en_webp():
    html = _home()
    m = re.search(r'class="hero-foto[^"]*" src="([^"]+)"', html)
    assert m, "el hero no trae la ilustración"
    assert m.group(1).endswith(".webp")
    f = SITE / m.group(1).lstrip("/")
    assert f.exists() and f.stat().st_size < 120_000
