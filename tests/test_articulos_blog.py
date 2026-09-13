"""Artículos del blog científico generados desde PubMed (sep-2026).

Fija lo que no puede romperse al publicar contenido nuevo: citas verificables,
sin lenguaje terapéutico (McKenna vende materia prima reenvasada) y enlace al
producto para que el blog lleve al catálogo.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import unicodedata
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SITE = REPO / "PAGINA_WEB" / "site"
sys.path.insert(0, str(SITE))

import website  # noqa: E402

POSTS = json.loads((SITE / "data" / "posts.json").read_text(encoding="utf-8"))


def _gen():
    spec = importlib.util.spec_from_file_location("generar_articulos_blog", REPO / "scripts" / "generar_articulos_blog.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _slugs_generados() -> set[str]:
    return {t["slug"] for t in _gen().TEMAS}


def _texto(html: str) -> str:
    t = "".join(c for c in unicodedata.normalize("NFD", html or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)).lower()


@pytest.fixture(scope="module")
def articulos() -> list[dict]:
    gen = _slugs_generados()
    arts = [p for p in POSTS if p["slug"] in gen]
    assert arts, "no hay artículos generados en posts.json"
    return arts


def test_cada_articulo_cita_pubmed_con_enlace_abrible(articulos):
    for p in articulos:
        pmids = re.findall(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)/", p["contenido"])
        assert len(pmids) >= 3, f'{p["slug"]}: solo {len(pmids)} referencias'
        assert len(pmids) == len(set(pmids)), f'{p["slug"]}: PMIDs repetidos'
        assert "<h2>Bibliografía</h2>" in p["contenido"], p["slug"]


def test_no_se_usan_fuentes_que_redistribuyen_articulos_de_pago(articulos):
    for p in articulos:
        t = p["contenido"].lower()
        for prohibida in ("sci-hub", "scihub", "sci-bot", "libgen", "z-lib"):
            assert prohibida not in t, f'{p["slug"]} cita {prohibida}'


def test_sin_lenguaje_terapeutico(articulos):
    """McKenna vende materia prima, no medicamento (Res. 2674/2013 y reglas
    de compliance del repositorio). Nada de curar, tratar o prevenir enfermedad."""
    patrones = [r"\bcura\b", r"\bcurar\b", r"\bcuran\b", r"\bremedio\b",
                r"\bmedicamento\b", r"\bdiagnostic\w*\b", r"\bterapeutic\w*\b",
                r"\btratar (?:el|la|los|las) \w+(?:itis|osis|emia)\b",
                r"\bprevien\w*\s+(?:el|la|los|las)\s+\w+(?:itis|osis|cancer)\b"]
    for p in articulos:
        t = _texto(p["contenido"])
        for pat in patrones:
            m = re.search(pat, t)
            assert not m, f'{p["slug"]}: «{m.group(0)}» en «…{t[max(0, m.start() - 60):m.end() + 60]}…»'
        assert "no constituye consejo medico" in t, f'{p["slug"]}: falta el descargo'


def test_cada_articulo_enlaza_su_producto(articulos):
    for p in articulos:
        assert "/producto/" in p["contenido"], f'{p["slug"]}: sin enlace al producto'


def test_titulos_y_extractos_utiles(articulos):
    for p in articulos:
        assert 20 <= len(p["titulo"]) <= 120, f'{p["slug"]}: título de {len(p["titulo"])} caracteres'
        assert p["extracto"] and not p["extracto"].startswith(p["titulo"]), f'{p["slug"]}: extracto repite el título'
        assert len(_texto(p["contenido"]).split()) >= 600, p["slug"]


def test_slugs_unicos_y_publicados_en_el_sitio(articulos):
    slugs = [p["slug"] for p in POSTS]
    assert len(slugs) == len(set(slugs))
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        for p in articulos:
            assert c.get(f'/blog/{p["slug"]}').status_code == 200, p["slug"]


def test_el_verificador_de_citas_rechaza_lo_inventado():
    gen = _gen()
    refs = [{"autor": "Hara-Chikuma", "anio": "2005"}, {"autor": "Fluhr", "anio": "2003"}]
    assert gen.citas_inventadas("<p>Como mostró Fluhr et al. (2003)…</p>", refs) == []
    # apellido compuesto citado por su segunda mitad: es la misma fuente
    assert gen.citas_inventadas("<p>Chikuma et al. (2005) observó…</p>", refs) == []
    # estudio que no está en la evidencia: se detecta
    assert gen.citas_inventadas("<p>Según Smith et al. (2019)…</p>", refs) == ["Smith (2019)"]
    # mismo autor, año distinto: también se detecta
    assert gen.citas_inventadas("<p>Fluhr et al. (2011)…</p>", refs) == ["Fluhr (2011)"]
