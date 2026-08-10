"""Contenido relacionado (guías/manuales/recetas) mostrado en /verificar."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))

import website  # noqa: E402


def test_encuentra_guia_y_manual_de_producto_existente() -> None:
    r = website.buscar_contenido_relacionado("Ácido Kójico")
    assert any(g["url"] == "/guias/acido-kojico" for g in r["guias"])
    assert any(m["url"] == "/blog/manual-de-uso-acido-kojico" for m in r["manuales"])


def test_producto_sin_contenido_relacionado_devuelve_listas_vacias() -> None:
    r = website.buscar_contenido_relacionado("Producto Totalmente Inexistente XYZ")
    assert r == {"guias": [], "manuales": [], "recetas": []}


def test_nombre_vacio_no_falla() -> None:
    r = website.buscar_contenido_relacionado("")
    assert r == {"guias": [], "manuales": [], "recetas": []}
