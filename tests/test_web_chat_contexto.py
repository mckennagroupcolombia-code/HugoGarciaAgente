"""Regresión: el chat web no debe responder enlatados sin contexto.

Cubre el arreglo de julio 2026: los interceptores regex respondían
"no encontré esa presentación" a saludos y frases cortas (16% de los turnos),
partían frases por comas como si fueran listas de productos y trataban
"gracias" como saludo nuevo (reinicio del hilo).
"""
from __future__ import annotations

from app.core import (
    _contexto_producto_pagina_web,
    _es_agradecimiento_puro_web,
    _es_saludo_puro_web,
    _formatear_respuesta_directa_combos_web,
    _preflight_contexto_combos_web,
    _producto_pagina_web,
    _respuesta_directa_web_si_combos,
    _respuesta_enlace_meli_web,
    _respuesta_multiproducto_web,
)


_COMBOS_FIXTURE = [
    {
        "code": "C-FLOSECLAV100g",
        "name": "FLORES SECAS LAVANDA 100g",
        "active": True,
        "prices": [{"price_list": [{"value": 18000}]}],
    },
    {
        "code": "C-ACEGIR500mL",
        "name": "ACEITE GIRASOL 500mL",
        "active": True,
        "prices": [{"price_list": [{"value": 23000}]}],
    },
]


def _patch_combos(monkeypatch, combos=None):
    monkeypatch.setattr(
        "app.services.siigo.listar_productos_combo_siigo",
        lambda: _COMBOS_FIXTURE if combos is None else combos,
    )


def test_saludo_no_dispara_no_encontrado(monkeypatch):
    """'Buen día señor Hugo' terminaba en 'no encontré esa presentación'."""
    _patch_combos(monkeypatch)
    assert _respuesta_directa_web_si_combos("Buen día señor Hugo", []) is None


def test_busqueda_sin_match_cae_al_llm(monkeypatch):
    """Producto inexistente: None (responde el LLM), no el enlatado muerto."""
    _patch_combos(monkeypatch)
    assert _respuesta_directa_web_si_combos("tienes barro del mar muerto", []) is None


def test_busqueda_con_match_sigue_directa(monkeypatch):
    _patch_combos(monkeypatch)
    resp = _respuesta_directa_web_si_combos("precio de la lavanda seca", [])
    assert resp and "LAVANDA" in resp


def test_preflight_sin_match_inyecta_nota_honesta(monkeypatch):
    """El LLM debe saber que la búsqueda no arrojó nada para no inventar precios."""
    _patch_combos(monkeypatch)
    nota = _preflight_contexto_combos_web("tienes barro del mar muerto", [])
    assert nota and "no arrojó resultados" in nota


def test_gracias_no_es_saludo():
    """'Gracias' clasificado como saludo reiniciaba la conversación."""
    assert not _es_saludo_puro_web("Gracias")
    assert not _es_saludo_puro_web("ok")
    assert _es_agradecimiento_puro_web("Gracias")
    assert _es_saludo_puro_web("Buenas tardes")


def test_multiproducto_no_parte_frases_por_comas():
    q = "Mi WhatsApp es 3152555850, quedó aclarado espera de que un asesor me contacte"
    assert _respuesta_multiproducto_web(q) is None


def test_enlace_meli_sin_match_cae_al_llm(monkeypatch):
    _patch_combos(monkeypatch)
    resp = _respuesta_enlace_meli_web("Dame el enlace de coenzima Q10 en MercadoLibre")
    assert resp is None


def test_formatear_directa_filtros_vacios_devuelve_none():
    items = [{"name": "ACEITE GIRASOL 500mL", "ref": "C-ACEGIR500mL", "precio_web": 23000}]
    assert _formatear_respuesta_directa_combos_web(items, "ylang ylang") is None


def test_producto_pagina_web_resuelve_slug(monkeypatch):
    _patch_combos(monkeypatch)
    url = "https://www.mckennagroup.co/producto/c-floseclav100g?utm_source=chatgpt"
    it = _producto_pagina_web(url)
    assert it and it["ref"] == "C-FLOSECLAV100g"
    ctx = _contexto_producto_pagina_web(url)
    assert "FLORES SECAS LAVANDA 100g" in ctx
    assert "COP" in ctx and "C-FLOSECLAV100g" in ctx


def test_producto_pagina_web_sin_slug():
    assert _producto_pagina_web("https://mckennagroup.co/catalogo/") is None
    assert _contexto_producto_pagina_web("") == ""


def test_detecta_pregunta_reingreso():
    from app.core import _mensaje_pregunta_reingreso_web as reingreso

    # Caso real del 17-jul: producto agotado + cuándo llega
    assert reingreso(
        "Estoy i teresada en la manteca de karite la blanca que viene en pote "
        "pequeño que esta agotada, cuando les llega?"
    )
    assert reingreso("cuando vuelven a tener acido hialuronico?")
    assert reingreso("¿está agotada? quiero comprar 2")
    assert reingreso("cuándo llega la glicerina")
    # Negativos: consultas normales no disparan el playbook
    assert not reingreso("que precio tiene la goma guar")
    assert not reingreso("Buenas tardes")
    assert not reingreso("como se usa la manteca de karite")


def test_reingreso_no_recibe_lista_de_precios(monkeypatch):
    """'¿Cuándo llega X?' con X en catálogo NO debe responder con precios."""
    _patch_combos(monkeypatch)
    assert (
        _respuesta_directa_web_si_combos("cuando les llega la lavanda seca?", [])
        is None
    )


def test_alerta_reingreso_dedupe(monkeypatch):
    import app.core as core

    enviados = []
    monkeypatch.setattr(core, "_reingreso_alertados", {})
    monkeypatch.setattr(
        core, "spawn_thread", lambda fn, *a, **k: enviados.append(fn) or None
    )
    core._alertar_reingreso_inventario("sesion-1", "MANTECA KARITE BLANCA 125g", "cuando llega?")
    core._alertar_reingreso_inventario("sesion-1", "MANTECA KARITE BLANCA 125g", "cuando llega??")
    core._alertar_reingreso_inventario("sesion-2", "MANTECA KARITE BLANCA 125g", "cuando llega?")
    # misma sesión+producto solo alerta una vez en 24h; otra sesión sí alerta
    assert len(enviados) == 2
