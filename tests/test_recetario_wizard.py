"""Recetario en modo laboratorio (Fase 1 del plan de guías vivas, sep-2026):
migración de recetas.json a v2, ruta /recetario/<slug> y carrito por lote."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

import website  # noqa: E402


def _migrador():
    spec = importlib.util.spec_from_file_location("migrar_recetas_v2", REPO / "scripts" / "migrar_recetas_v2.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── Inferencia de acción y tiempo (sin IA) ──────────────────────────────────

@pytest.mark.parametrize("texto, esperado", [
    ("Mezcla el aloe vera con el agua destilada en recipiente de vidrio.", "mezclar"),
    ("Agrega la vitamina C en polvo poco a poco mientras mezclas hasta disolver completamente.", "disolver"),
    ("Incorpora el aceite de rosa suavemente.", "verter"),
    ("Transfiere a frasco oscuro con gotero. Refrigera y usa en 30 días.", "envasar"),
    ("Calentar la fase oleosa a 70 °C hasta fundir las ceras.", "calentar"),
    ("Dejar enfriar a 40 °C antes de añadir los activos.", "enfriar"),
    ("Pesar todos los ingredientes con balanza de precisión.", "pesar"),
    ("Dejar reposar 24 horas antes de usar.", "reposar"),
    ("Texto sin verbo reconocible.", "mezclar"),
])
def test_inferir_accion(texto, esperado):
    assert _migrador().inferir_accion(texto) == esperado


@pytest.mark.parametrize("texto, esperado", [
    ("Agitar durante 5 minutos.", 5),
    ("Mezclar 3 a 5 min hasta homogeneizar.", 5),
    ("Dejar reposar 2 horas.", 120),
    ("Sin tiempo explícito.", None),
    ("Refrigera y usa en 30 días.", None),
])
def test_extraer_minutos_no_inventa(texto, esperado):
    assert _migrador().extraer_minutos(texto) == esperado


# ── Cruce ingrediente → producto ─────────────────────────────────────────────

def _catalogo():
    return [
        {"slug": "vit-c-250", "name": "VITAMINA C ACIDO ASCORBICO 250g", "claves": {"vitamina", "c", "acido", "ascorbico", "250g"}, "buyable": True, "is_family": False, "precio_num": 30000},
        {"slug": "vit-e-30", "name": "VITAMINA E 30mL", "claves": {"vitamina", "e", "30ml"}, "buyable": True, "is_family": False, "precio_num": 12000},
        {"slug": "arbol-te", "name": "Aceite esencial de árbol de té", "claves": {"aceite", "esencial", "de", "arbol", "te"}, "buyable": True, "is_family": True, "precio_num": 0},
        {"slug": "kit-arbol", "name": "Aceite Esencial Árbol De Té 30 ML + Aceite De Jojoba 30 ML", "claves": {"aceite", "esencial", "arbol", "de", "te", "30", "ml", "jojoba"}, "buyable": True, "is_family": False, "precio_num": 50000},
        {"slug": "karite-125", "name": "MANTECA KARITE BLANCA 125g", "claves": {"manteca", "karite", "blanca", "125g"}, "buyable": True, "is_family": False, "precio_num": 15000},
        {"slug": "karite-500", "name": "MANTECA KARITE BLANCA 500g", "claves": {"manteca", "karite", "blanca", "500g"}, "buyable": True, "is_family": False, "precio_num": 40000},
    ]


def test_vitamina_c_no_cruza_con_vitamina_e():
    m = _migrador()
    assert m.cruzar_ingrediente("Vitamina C (ác. ascórbico)", _catalogo())["slug"] == "vit-c-250"
    assert m.cruzar_ingrediente("Vitamina E (Tocoferol)", _catalogo())["slug"] == "vit-e-30"


def test_prefiere_producto_solo_sobre_kit_y_presentacion_pequena():
    m = _migrador()
    assert m.cruzar_ingrediente("Aceite Esencial de Árbol de Té", _catalogo())["slug"] == "arbol-te"
    assert m.cruzar_ingrediente("Manteca de Karité", _catalogo())["slug"] == "karite-125"


def test_ingrediente_desconocido_no_inventa_producto():
    assert _migrador().cruzar_ingrediente("DMSO", _catalogo()) is None
    assert _migrador().cruzar_ingrediente("", _catalogo()) is None


def test_migrar_receta_respeta_campos_manuales_y_uso_propio():
    m = _migrador()
    receta = {
        "id": 99, "title": "Prueba", "title2": "Manual", "cat": "hogar", "base": 100, "unidad": "ml",
        "ings": [
            {"n": "Agua destilada", "q": 50, "u": "ml", "src": "uso propio"},
            {"n": "Vitamina C", "q": 5, "u": "g", "src": "McKenna Group", "slug": "elegido-a-mano", "manual": True},
        ],
        "pasos": ["Calentar el agua.", {"texto": "Reposar.", "accion": "envasar", "manual": True}],
    }
    out, avisos = m.migrar_receta(receta, _catalogo(), set())
    assert out["slug"] == "prueba-manual"
    assert out["ings"][0]["propio"] is True and "slug" not in out["ings"][0]
    assert out["ings"][1]["slug"] == "elegido-a-mano"
    assert out["pasos"][0] == {"texto": "Calentar el agua.", "accion": "calentar"}
    assert out["pasos"][1]["accion"] == "envasar"
    assert avisos == []


# ── Rutas ────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client():
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        yield c


def test_recetario_enlaza_a_cada_receta(client):
    html = client.get("/recetario").get_data(as_text=True)
    assert "href=\"/recetario/'+(r.slug||'')" in html  # tarjetas son enlaces
    assert "rec-overlay" not in html  # el modal ya no existe


def test_receta_detalle_trae_wizard_jsonld_y_texto_plano(client):
    recetas = website._cargar_recetas()
    assert recetas, "recetas.json vacío"
    r = recetas[0]
    resp = client.get(f"/recetario/{r['slug']}")
    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert 'id="receta-data"' in html
    assert '"@type": "Recipe"' in html
    assert "recetario-wizard.js" in html
    assert "Ver la receta completa en texto" in html
    assert r["pasos"][0]["texto"] in html


def test_receta_inexistente_404(client):
    assert client.get("/recetario/esta-no-existe").status_code == 404


def test_sitemap_incluye_recetas(client):
    xml = client.get("/sitemap.xml").get_data(as_text=True)
    assert xml.count("/recetario/") == len(website._cargar_recetas())


def test_agregar_lote_suma_y_reporta_avisos(client, monkeypatch):
    productos = {
        "bueno": {"slug": "bueno", "name": "Bueno", "ref": "B1", "precio_num": 1000, "buyable": True, "stock": 5},
        "agotado": {"slug": "agotado", "name": "Agotado", "ref": "A1", "precio_num": 1000, "buyable": False},
        "familia": {"slug": "familia", "name": "Familia", "ref": "F1", "precio_num": 0, "buyable": True, "is_family": True},
        "poco": {"slug": "poco", "name": "Poco", "ref": "P1", "precio_num": 500, "buyable": True, "stock": 1},
    }
    monkeypatch.setattr(website, "find_product", lambda s: productos.get(s))
    resp = client.post("/carrito/agregar-lote", json={"items": [
        {"slug": "bueno", "qty": 2}, {"slug": "agotado"}, {"slug": "familia"}, {"slug": "nada"}, {"slug": "poco", "qty": 3},
    ]})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["agregados"] == 3  # 2 de "bueno" + 1 de "poco" (stock corto)
    assert data["en_carrito"] == 2
    assert any("agotado" in a.lower() for a in data["avisos"])
    assert any("presentación" in a for a in data["avisos"])
    assert any("Solo quedan 1" in a for a in data["avisos"])
    with client.session_transaction() as sess:
        assert sess["cart"]["bueno"]["qty"] == 2
        assert sess["cart"]["poco"]["qty"] == 1


def test_agregar_lote_sin_items_es_400(client):
    assert client.post("/carrito/agregar-lote", json={"items": []}).status_code == 400


def test_agregar_formulario_y_lote_dejan_el_mismo_item(client, monkeypatch):
    p = {"slug": "x1", "name": "X", "ref": "X1", "precio_num": 2500, "buyable": True, "photo": "", "envio_gratis_web": True}
    monkeypatch.setattr(website, "find_product", lambda s: p if s == "x1" else None)
    client.post("/carrito/agregar", data={"slug": "x1", "qty": "1", "next": "/carrito"})
    with client.session_transaction() as sess:
        por_formulario = dict(sess["cart"]["x1"])
        sess["cart"] = {}
    client.post("/carrito/agregar-lote", json={"items": [{"slug": "x1", "qty": 1}]})
    with client.session_transaction() as sess:
        assert sess["cart"]["x1"] == por_formulario
