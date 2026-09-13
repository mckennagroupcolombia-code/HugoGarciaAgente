"""Guía viva (Fase 2 del plan de guías vivas, sep-2026): extractor sin IA de
la ficha rápida y plantilla con módulos interactivos en /guias/<slug>."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

import website  # noqa: E402


def _extractor():
    spec = importlib.util.spec_from_file_location("extraer_ficha_rapida_guias", REPO / "scripts" / "extraer_ficha_rapida_guias.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


GUIA_MINIMA = {
    "slug": "prueba",
    "secciones": [
        {"titulo": "Descripción técnica del ingrediente", "contenido": "<p>Intro.</p><ul><li><strong>Estado:</strong> Polvo blanco.</li><li><strong>pH de trabajo:</strong> 4.0 – 6.0. A pH &gt; 7.0 se oxida.</li></ul>"},
        {"titulo": "Concentraciones de uso recomendadas", "contenido": "<table><thead><tr><th>Aplicación</th><th>Concentración</th><th>Tipo</th></tr></thead><tbody><tr><td>Sérums</td><td>0.5 % – 1.0 %</td><td>Leave-on</td></tr><tr><td>Mascarillas</td><td>hasta 2 %</td><td>Rinse-off</td></tr></tbody></table><p>La UE aprueba hasta 1 % en leave-on.</p>"},
        {"titulo": "Compatibilidad e incompatibilidades", "contenido": "<p><strong>✅ Compatible con:</strong> niacinamida, AHAs (pH controlado), EDTA.</p><p><strong>❌ Incompatible con:</strong> pH &gt; 7.0, iones de Fe y Cu (catalizan su degradación) y temperaturas &gt; 45 °C.</p>"},
        {"titulo": "Instrucciones de incorporación", "contenido": "<ol><li>Disolver en la <strong>fase acuosa</strong> a temperatura ≤ 40 °C.</li><li><strong>Quelar:</strong> añadir EDTA 0.1 %.</li></ol>"},
        {"titulo": "Condiciones de almacenamiento", "contenido": "<p>Envase hermético, lugar fresco, seco y oscuro. Temperatura recomendada: 5 – 25 °C.</p>"},
        {"titulo": "Normativa INVIMA aplicable", "contenido": "<p>Verifique la resolución vigente.</p>"},
        {"titulo": "Preguntas frecuentes", "contenido": "<div class='faq-item'><strong>¿Por qué amarillea?</strong><p>Oxidación.</p></div>"},
    ],
}


def test_extrae_concentraciones_ph_temp_y_listas():
    v = _extractor().extraer(GUIA_MINIMA)
    assert [(c["min_pct"], c["max_pct"]) for c in v["concentraciones"]] == [(0.5, 1.0), (2.0, 2.0)]
    assert v["conc_max_pct"] == 2.0
    assert "hasta 1 %" in v["conc_nota"]
    assert v["ph"] == {"min": 4.0, "max": 6.0}
    assert v["temp_max_c"] == 45  # el ">45" de incompatibles manda sobre el "≤ 40" de proceso
    assert [c["n"] for c in v["compatibles"]] == ["niacinamida", "AHAs", "EDTA"]
    assert v["compatibles"][1]["nota"] == "pH controlado"
    assert v["incompatibles"][0]["n"] == "pH > 7.0"
    assert v["incorporacion"][0]["fase"] == "acuosa" and v["incorporacion"][0]["temp_c"] == 40
    assert v["incorporacion"][1]["n"] == "Quelar"
    assert v["almacenamiento"]["temp_min_c"] == 5 and v["almacenamiento"]["temp_max_c"] == 25
    assert v["almacenamiento"]["luz"] and v["almacenamiento"]["hermetico"] and v["almacenamiento"]["humedad"]
    assert v["faq"] == [{"q": "¿Por qué amarillea?", "a": "Oxidación."}]
    assert v["faltan"] == []


def test_no_inventa_datos_que_no_estan():
    g = {"slug": "x", "secciones": [
        {"titulo": "Concentraciones de uso recomendadas", "contenido": "<p>Depende del proceso.</p>"},
        {"titulo": "Instrucciones de incorporación", "contenido": "<ol><li>Pesar.</li></ol>"},
    ]}
    v = _extractor().extraer(g)
    assert v["concentraciones"] == [] and v["conc_max_pct"] is None
    assert v["ph"] is None and v["temp_max_c"] is None
    assert "concentraciones" in v["faltan"] and "ph" in v["faltan"] and "faq" in v["faltan"]


def test_ph_fuera_de_escala_se_descarta():
    m = _extractor()
    assert m.parse_ph("pH 4.0 – 6.0") == {"min": 4.0, "max": 6.0}
    assert m.parse_ph("pH entre 12 y 20") is None
    assert m.parse_ph("sin dato") is None


def test_guia_es_viva_exige_incorporacion_y_algo_mas():
    assert website._guia_es_viva({"viva": {"incorporacion": [{"n": "a", "texto": "b"}], "compat_texto": "ok"}})
    assert not website._guia_es_viva({"viva": {"incorporacion": [], "concentraciones": [{"min_pct": 1, "max_pct": 2}]}})
    assert not website._guia_es_viva({"viva": {"incorporacion": [{"n": "a", "texto": "b"}]}})
    assert not website._guia_es_viva({"viva": {"incorporacion": [{"n": "a", "texto": "b"}], "faq": [{}], "concentraciones": [{}], "desactivar": True}})
    assert not website._guia_es_viva({})


@pytest.fixture()
def client():
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        yield c


def test_guia_viva_renderiza_modulos_y_texto_completo(client):
    html = client.get("/guias/acido-kojico").get_data(as_text=True)
    assert 'id="gv"' in html
    for mid in ('id="dosis"', 'id="ph"', 'id="compat"', 'id="incorporacion"', 'id="almacen"', 'id="faq"', 'id="texto"'):
        assert mid in html
    assert "guia-viva.js" in html
    assert 'data-ph-min="4.0"' in html and 'data-ph-max="6.0"' in html
    assert "Bibliografía" in html  # las referencias no se pierden


def test_guia_sin_datos_cae_a_la_plantilla_clasica(client, monkeypatch):
    import json
    original = website._GUIAS_JSON.read_text
    datos = json.loads(original(encoding="utf-8"))
    g = next(x for x in datos if x["slug"] == "acido-kojico")
    g["viva"] = {"desactivar": True}
    monkeypatch.setattr(type(website._GUIAS_JSON), "read_text", lambda self, encoding="utf-8": json.dumps(datos))
    html = client.get("/guias/acido-kojico").get_data(as_text=True)
    assert 'id="gv"' not in html
    assert "gd-hero" in html


def test_todas_las_guias_publicadas_responden_200(client):
    import json
    datos = json.loads(website._GUIAS_JSON.read_text(encoding="utf-8"))
    for g in datos:
        if g.get("publicada", True):
            assert client.get(f"/guias/{g['slug']}").status_code == 200, g["slug"]
