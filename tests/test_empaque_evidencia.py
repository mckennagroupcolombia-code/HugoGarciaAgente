"""Tests del módulo empaque / evidencia fotográfica."""

from __future__ import annotations

import os

import pytest


@pytest.fixture()
def empaque_tmp(monkeypatch, tmp_path):
    db = tmp_path / "empaque.db"
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr("app.services.empaque_evidencia.DB_PATH", str(db))
    monkeypatch.setattr("app.services.empaque_evidencia.UPLOADS_DIR", str(uploads))
    monkeypatch.setattr("app.services.empaque_evidencia._DB_READY", False)
    from app.services import empaque_evidencia as mod

    mod.init_db()
    return mod


def test_crear_venta_wa_y_evidencia(empaque_tmp):
    mod = empaque_tmp
    venta = mod.crear_venta_wa(
        cliente="Cliente Prueba",
        telefono="3001234567",
        productos="Ácido ascórbico 100g\nUrea 250g",
        total=45000,
        creado_por="Tester",
    )
    assert venta["canal"] == "whatsapp"
    assert venta["id"].startswith("WA-")
    assert len(venta["items"]) == 2

    # archivo fake
    nombre = "emp_test_foto.jpg"
    path = os.path.join(mod.UPLOADS_DIR, nombre)
    with open(path, "wb") as f:
        f.write(b"fake-image")

    ev = mod.registrar_evidencia(
        "whatsapp",
        venta["id"],
        nombre,
        nota="2 frascos visibles",
        subido_por="Tester",
        subido_por_id=1,
    )
    assert ev["id"] >= 1
    lista = mod.listar_evidencias("whatsapp", venta["id"])
    assert len(lista) == 1
    assert lista[0]["nota"] == "2 frascos visibles"

    data = mod.listar_ventas(canal="whatsapp", dias=7, q="Cliente Prueba")
    assert data["total"] >= 1
    found = next(v for v in data["ventas"] if v["id"] == venta["id"])
    assert found["evidencias_count"] == 1

    ok, _ = mod.eliminar_evidencia(ev["id"])
    assert ok
    assert mod.listar_evidencias("whatsapp", venta["id"]) == []


def test_ruta_upload_segura_bloquea_traversal(empaque_tmp):
    mod = empaque_tmp
    assert mod.ruta_upload_segura("../etc/passwd") is None
    assert mod.ruta_upload_segura("emp_ok.jpg") is None  # no existe aún
    path = os.path.join(mod.UPLOADS_DIR, "emp_ok.jpg")
    open(path, "wb").write(b"x")
    assert mod.ruta_upload_segura("emp_ok.jpg") == path
