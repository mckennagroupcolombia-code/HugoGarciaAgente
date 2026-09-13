"""Fase A del plan de portada (sep-2026): orden del tema Clásico, cta visible,
líneas con mínimo de productos y contadores con valor real en reposo."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

from app.tools import tema_web as tw  # noqa: E402
import website  # noqa: E402


def test_orden_clasico_comercial_antes_que_trazabilidad_y_cta_al_final():
    o = tw._ORDEN_CLASICO
    assert o.index("categorias") < o.index("ruta_origen")
    assert o.index("destacados") < o.index("ruta_origen")  # cobertura va como pestaña dentro de ruta_origen (Fase D)
    assert o[-1] == "cta"


def test_normalizar_layout_ya_no_oculta_la_cta_a_la_fuerza():
    lay = tw._normalizar_layout({"orden": ["hero"], "nodos": {}}, tw._ORDEN_CLASICO)
    assert "cta" not in lay["nodos"]
    # pero si alguien la oculta desde el Studio, se respeta
    lay = tw._normalizar_layout({"orden": ["hero"], "nodos": {"cta": {"hidden": True}}}, tw._ORDEN_CLASICO)
    assert lay["nodos"]["cta"]["hidden"] is True


def test_secciones_no_listadas_se_agregan_en_el_orden_nuevo():
    lay = tw._normalizar_layout({"orden": ["hero", "categorias"]}, tw._ORDEN_CLASICO)
    assert lay["orden"][:2] == ["hero", "categorias"]
    assert lay["orden"].index("destacados") < lay["orden"].index("ruta_origen") < lay["orden"].index("cta")


def test_lineas_para_portada_omite_las_de_menos_de_3_productos():
    catalog = [
        {"name": "Ácidos", "products": [{}] * 5},
        {"name": "Agro", "products": [{}]},
    ]
    todas = {L["name"]: L["n_productos"] for L in website.lineas_desde_catalogo(catalog)}
    portada = {L["name"] for L in website.lineas_para_portada(catalog)}
    assert todas["Agro"] == 1 and "Agro" not in portada
    assert all(L["n_productos"] >= website.LINEAS_MINIMO_PORTADA for L in website.lineas_para_portada(catalog))


def test_portada_rinde_contadores_con_valor_real_y_cta_visible():
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        html = c.get("/").get_data(as_text=True)
    assert 'data-count="200">200<' in html  # no arranca en 0
    assert 'data-count="0">0<' not in html or "n_paises" not in html
    assert "cta-section" in html or "Cotizar por WhatsApp" in html
    # el catálogo va antes que la trazabilidad y la cta cierra
    assert html.index("cats-section") < html.index('id="trazabilidad"') < html.index("Cotizar por WhatsApp")
