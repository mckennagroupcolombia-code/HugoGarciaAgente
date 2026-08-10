"""Fase C: actualizar el código de verificación en un PDF ya exportado sin
regenerar el diseño completo (redact + reinsert con PyMuPDF, búsqueda por texto)."""

from __future__ import annotations

import os

import fitz
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


def _crear_pdf_prueba(tmp_path, codigo: str) -> str:
    ruta = tmp_path / "etiqueta_prueba.pdf"
    doc = fitz.open()
    page = doc.new_page(width=200, height=150)
    page.insert_text((20, 20), "CARBONATO DE MAGNESIO", fontsize=12, color=(0, 0, 0))
    page.insert_text((20, 130), codigo, fontsize=8, color=(0.11, 0.11, 0.11), fontname="helv")
    doc.save(str(ruta))
    doc.close()
    return str(ruta)


def test_actualizar_codigo_pdf_sin_lote_da_error(client, tmp_path) -> None:
    ruta = _crear_pdf_prueba(tmp_path, "OLDCOD")
    guardar_studio_sku("SKU-1", {"codigo_verificacion": "OLDCOD"}, version="original")
    r = client.post(
        "/api/etiquetas/studio/SKU-1/actualizar-codigo-pdf",
        headers=_headers(),
        json={"ruta_pdf": ruta},
    )
    assert r.status_code == 400
    assert "lote" in r.get_json()["error"].lower()


def test_actualizar_codigo_pdf_reemplaza_texto_sin_tocar_el_resto(client, tmp_path) -> None:
    ruta = _crear_pdf_prueba(tmp_path, "OLDCOD")
    guardar_studio_sku(
        "SKU-2",
        {
            "nombre_producto": "Carbonato de prueba",
            "diagramacion": {"titulo": {"x": 1, "y": 2}},
            "codigo_verificacion": "OLDCOD",
        },
        version="original",
    )
    registrar_lote("SKU-2", lote_numero="L-NUEVO", fabricante="Fab X", codigo_verificacion="NEWCOD")

    r = client.post(
        "/api/etiquetas/studio/SKU-2/actualizar-codigo-pdf",
        headers=_headers(),
        json={"ruta_pdf": ruta},
    )
    assert r.status_code == 200
    body = r.get_json()
    assert body["cambios"] == 1
    assert body["codigo"] == "NEWCOD"
    assert body["codigo_anterior"] == "OLDCOD"

    doc = fitz.open(ruta)
    texto = doc[0].get_text()
    doc.close()
    assert "NEWCOD" in texto
    assert "OLDCOD" not in texto
    assert "CARBONATO DE MAGNESIO" in texto

    # El JSON de Studio queda consistente sin perder otros campos
    r2 = client.get("/api/etiquetas/studio/SKU-2", headers=_headers())
    datos = r2.get_json()["datos"]
    assert datos["codigo_verificacion"] == "NEWCOD"
    assert datos["nombre_producto"] == "Carbonato de prueba"
    assert datos["diagramacion"]["titulo"] == {"x": 1, "y": 2}


def test_actualizar_codigo_pdf_no_reprocesa_si_ya_esta_al_dia(client, tmp_path) -> None:
    ruta = _crear_pdf_prueba(tmp_path, "MISMO1")
    guardar_studio_sku("SKU-3", {"codigo_verificacion": "MISMO1"}, version="original")
    registrar_lote("SKU-3", lote_numero="L-1", fabricante="X", codigo_verificacion="MISMO1")

    r = client.post(
        "/api/etiquetas/studio/SKU-3/actualizar-codigo-pdf",
        headers=_headers(),
        json={"ruta_pdf": ruta},
    )
    assert r.status_code == 200
    assert r.get_json()["cambios"] == 0


def test_actualizar_codigo_pdf_ruta_invalida(client) -> None:
    guardar_studio_sku("SKU-4", {"codigo_verificacion": "X"}, version="original")
    r = client.post(
        "/api/etiquetas/studio/SKU-4/actualizar-codigo-pdf",
        headers=_headers(),
        json={"ruta_pdf": "/no/existe.pdf"},
    )
    assert r.status_code == 404
