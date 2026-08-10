"""Endpoints de código de verificación en Studio Etiquetas: auto-relleno en GET
y actualización sin perder el resto del diseño guardado."""

from __future__ import annotations

import os

import pytest
from flask import Flask

from app.routes import register_routes
from app.services.lotes_materia_prima import registrar_lote
from app.tools.etiquetas_studio import guardar_studio_sku


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "test-token-123")
    import app.tools.etiquetas_studio as etiquetas_studio
    import app.services.documentos_catalogo as documentos_catalogo

    monkeypatch.setattr(etiquetas_studio, "_STUDIO_PATH", tmp_path / "etiquetas_studio.json")
    monkeypatch.setattr(documentos_catalogo, "MAP_PATH", tmp_path / "documentos_producto.json")

    app = Flask(__name__)
    register_routes(app)
    with app.test_client() as c:
        yield c


def _headers():
    return {"Authorization": f"Bearer {os.environ['CHAT_API_TOKEN']}"}


def test_actualizar_codigo_sin_lote_registrado_da_error_claro(client) -> None:
    guardar_studio_sku("SKU-1", {"nombre_producto": "Producto 1"}, version="original")
    r = client.post("/api/etiquetas/studio/SKU-1/actualizar-codigo", headers=_headers(), json={})
    assert r.status_code == 400
    assert "lote" in r.get_json()["error"].lower()


def test_actualizar_codigo_preserva_diseno_existente(client) -> None:
    guardar_studio_sku(
        "SKU-2",
        {
            "nombre_producto": "Producto 2",
            "diagramacion": {"titulo": {"x": 1, "y": 2}},
            "lote": "L-999",
        },
        version="original",
    )
    entry = registrar_lote("SKU-2", lote_numero="L-1000", fabricante="Fab Test")

    r = client.post("/api/etiquetas/studio/SKU-2/actualizar-codigo", headers=_headers(), json={})
    assert r.status_code == 200
    datos = r.get_json()["datos"]
    assert datos["codigo_verificacion"] == entry["codigo_verificacion"]
    assert datos["nombre_producto"] == "Producto 2"
    assert datos["diagramacion"]["titulo"] == {"x": 1, "y": 2}
    assert datos["lote"] == "L-999"


def test_get_studio_sku_autorrellena_codigo_vigente(client) -> None:
    guardar_studio_sku("SKU-3", {"nombre_producto": "Producto 3"}, version="original")
    registrar_lote("SKU-3", lote_numero="L-1", fabricante="X")

    r = client.get("/api/etiquetas/studio/SKU-3", headers=_headers())
    assert r.status_code == 200
    assert r.get_json()["datos"]["codigo_verificacion"]


def test_get_studio_sku_no_pisa_codigo_ya_guardado(client) -> None:
    guardar_studio_sku(
        "SKU-4", {"nombre_producto": "Producto 4", "codigo_verificacion": "YAEXISTE"}, version="original"
    )
    registrar_lote("SKU-4", lote_numero="L-1", fabricante="X")

    r = client.get("/api/etiquetas/studio/SKU-4", headers=_headers())
    assert r.get_json()["datos"]["codigo_verificacion"] == "YAEXISTE"
