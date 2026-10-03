"""Visto bueno del documento técnico desde el taller de combos (21-sep-2026).

El documento es de la materia prima y lo heredan todas las presentaciones del
producto (250 g, 500 g, kg): con `con_presentaciones`, marcar una marca todas.
"""
from __future__ import annotations

import pytest
from flask import Flask

from app.routes import register_routes

TOKEN = "token-de-sistema-para-test"


@pytest.fixture()
def cliente(monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", TOKEN)
    app = Flask(__name__)
    register_routes(app)
    with app.test_client() as c:
        yield c


def test_marca_todas_las_presentaciones(cliente, monkeypatch):
    from app.services import documentos_revision, mapa_producto

    marcados: list[str] = []
    monkeypatch.setattr(mapa_producto, "presentaciones_de", lambda ref: ["C-X100g", "C-X250g", "C-XKg"])
    monkeypatch.setattr(documentos_revision, "marcar_revisado",
                        lambda ref, revisado, **k: marcados.append(ref) or {"revisado": revisado})
    r = cliente.post("/api/documentos/revision-checklist/marcar",
                     json={"producto_ref": "C-X250g", "revisado": True, "con_presentaciones": True},
                     headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert marcados == ["C-X100g", "C-X250g", "C-XKg"]
    assert r.get_json()["refs"] == marcados


def test_sin_la_opcion_marca_solo_el_propio(cliente, monkeypatch):
    from app.services import documentos_revision

    marcados: list[str] = []
    monkeypatch.setattr(documentos_revision, "marcar_revisado",
                        lambda ref, revisado, **k: marcados.append(ref) or {"revisado": revisado})
    r = cliente.post("/api/documentos/revision-checklist/marcar",
                     json={"producto_ref": "C-X250g"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200 and marcados == ["C-X250g"]
