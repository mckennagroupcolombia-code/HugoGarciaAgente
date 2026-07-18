"""Regresión del matcher de combos SIIGO (afinado jul 2026).

Fallas reales del chat web que motivaron el ajuste:
- Refs exactas intermitentes (C-PROCONSUE80PKg encontrada y luego "no encontré").
- Frases largas muertas por exigir TODOS los tokens ≥4 en el producto.
- Dos productos en un mensaje ("glicerina vegetal y arcilla caolín") sin match.
- Caché que devolvía [] si la API fallaba justo al vencer el TTL.
"""
from __future__ import annotations

from unittest.mock import patch

import app.services.siigo as siigo
from app.services.siigo import buscar_combos_siigo_estructurado


_COMBOS = [
    {"code": "C-PROCONSUE80PKg", "name": "PROTEINA CONCENTRADA SUERO LECHE 80P Kg", "active": True, "prices": [{"price_list": [{"value": 101000}]}]},
    {"code": "C-FLOSECLAV100g", "name": "FLORES SECAS LAVANDA 100g", "active": True, "prices": [{"price_list": [{"value": 18000}]}]},
    {"code": "C-GLIVEG500mL", "name": "GLICERINA VEGETAL USP 500mL", "active": True, "prices": [{"price_list": [{"value": 20000}]}]},
    {"code": "C-ARCCAO250g", "name": "ARCILLA CAOLIN 250g", "active": True, "prices": [{"price_list": [{"value": 14000}]}]},
    {"code": "C-ACISAL50g", "name": "ACIDO SALICILICO 50g", "active": True, "prices": [{"price_list": [{"value": 15000}]}]},
    {"code": "C-ACILAC30mL", "name": "ACIDO LACTICO 30mL", "active": True, "prices": [{"price_list": [{"value": 12000}]}]},
    {"code": "C-GOMGUA500g", "name": "GOMA GUAR 500g", "active": True, "prices": [{"price_list": [{"value": 25000}]}]},
]


def _patch(monkeypatch):
    monkeypatch.setattr(
        "app.services.siigo.listar_productos_combo_siigo", lambda: _COMBOS
    )


def _nombres(consulta):
    items, _ = buscar_combos_siigo_estructurado(consulta)
    return [i["name"] for i in items]


def test_ref_exacta_directa(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("C-PROCONSUE80PKg") == ["PROTEINA CONCENTRADA SUERO LECHE 80P Kg"]


def test_ref_exacta_dentro_de_frase(monkeypatch):
    _patch(monkeypatch)
    q = "C-FLOSECLAV100g es la referencia, pero favor me envía cotización"
    assert _nombres(q) == ["FLORES SECAS LAVANDA 100g"]


def test_ref_como_slug_web(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("c-floseclav100g") == ["FLORES SECAS LAVANDA 100g"]


def test_frase_larga_no_mata_el_match(monkeypatch):
    _patch(monkeypatch)
    q = (
        "He mirado su catálogo y encontré flores secas de lavanda. Quiero saber "
        "a partir de qué cantidad se puede hacer pedido. Y las condiciones del "
        "envío a Bucaramanga."
    )
    assert "FLORES SECAS LAVANDA 100g" in _nombres(q)


def test_dos_productos_en_un_mensaje(monkeypatch):
    _patch(monkeypatch)
    nombres = _nombres("Glicerina vegetal y arcilla caolín vegetal")
    assert "GLICERINA VEGETAL USP 500mL" in nombres
    assert "ARCILLA CAOLIN 250g" in nombres


def test_producto_con_ruido_conversacional(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("Goma Guar por kilo") == ["GOMA GUAR 500g"]
    assert _nombres("que precio tiene la goma guar") == ["GOMA GUAR 500g"]
    assert "FLORES SECAS LAVANDA 100g" in _nombres(
        "tienen lavanda para hacer jabones artesanales?"
    )


def test_variante_inexistente_no_ofrece_la_familia(monkeypatch):
    """'ácido tánico' no existe: no ofrecer salicílico/láctico en su lugar."""
    _patch(monkeypatch)
    assert _nombres("Quisiera por favor cotizar acido tanico?") == []


def test_no_producto_sigue_vacio(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("tienes barro del mar muerto") == []
    assert _nombres("Buen día señor Hugo") == []


def test_cache_stale_si_api_falla(monkeypatch):
    """API caída al vencer el TTL: devolver catálogo viejo, no lista vacía."""
    monkeypatch.setattr(siigo, "_combos_cache", list(_COMBOS))
    monkeypatch.setattr(siigo, "_combos_cache_ts", 0)  # TTL vencido
    with patch.object(siigo, "_siigo_get", lambda *a, **k: None):
        assert len(siigo.listar_productos_combo_siigo()) == len(_COMBOS)
