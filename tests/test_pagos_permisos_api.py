"""Quién puede ver las solicitudes de pago por API.

Hasta sep-2026 las rutas `/api/pagos/*` solo exigían `_api_token_valido()`, que
acepta la sesión de CUALQUIER usuario del panel. La sección estaba oculta en el
menú (lib/contabilidadAccess.ts → "pagos"), pero ocultar no es restringir: con
su propio token, el usuario de despachos (`jerry`, nivel operario, sin permiso
`pagos` ni `libro-mayor`) obtenía el listado completo de solicitudes con
proveedor, monto, factura cotejada y saldos 2205.

El backend debe decir lo mismo que el panel. Si vuelven a divergir, esta suite
falla antes de que los datos salgan.
"""
from __future__ import annotations

import os

import pytest
from flask import Flask

from app.routes import register_routes


@pytest.fixture()
def cliente(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-de-sistema-para-test")
    app = Flask(__name__)
    register_routes(app)
    with app.test_client() as c:
        yield c


def _usuario(nivel: int, permisos: dict):
    return {"id": 99, "nombre": "Usuario Prueba", "username": "prueba",
            "rol": {"nivel": nivel}, "permisos_secciones": permisos}


def _sesion(monkeypatch, usuario):
    """Hace que el Bearer de la petición resuelva a `usuario` sin tocar tickets.db."""
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda _t: usuario)


RUTAS_LECTURA = [
    "/api/pagos/solicitudes",
    "/api/pagos/proveedores",
    "/api/pagos/categorias",
    "/api/pagos/plantillas",
]


@pytest.mark.parametrize("ruta", RUTAS_LECTURA)
def test_operario_sin_permiso_no_ve_nada_de_pagos(cliente, monkeypatch, ruta):
    _sesion(monkeypatch, _usuario(1, {"pedidos": True, "operativos": True, "facturas": True}))
    r = cliente.get(ruta, headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403, f"{ruta} se abrió a un operario sin permiso"
    assert "pagos" in (r.get_json() or {}).get("error", "")


def test_operario_sin_permiso_tampoco_aprueba(cliente, monkeypatch):
    _sesion(monkeypatch, _usuario(1, {"pedidos": True}))
    r = cliente.post("/api/pagos/solicitudes/1/aprobar",
                     json={}, headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403


@pytest.mark.parametrize("permisos", [{"pagos": True}, {"libro-mayor": True}])
def test_permiso_explicito_entra(cliente, monkeypatch, permisos):
    # Mismo criterio que el panel: `pagos` o `libro-mayor`, nunca heredado.
    _sesion(monkeypatch, _usuario(1, permisos))
    r = cliente.get("/api/pagos/categorias", headers={"Authorization": "Bearer sesion"})
    assert r.status_code == 200


def test_admin_entra_aunque_no_tenga_la_casilla(cliente, monkeypatch):
    _sesion(monkeypatch, _usuario(3, {}))
    r = cliente.get("/api/pagos/categorias", headers={"Authorization": "Bearer sesion"})
    assert r.status_code == 200


def test_token_de_sistema_sigue_entrando(cliente):
    # Crons y procesos internos usan CHAT_API_TOKEN, sin usuario detrás.
    r = cliente.get("/api/pagos/categorias",
                    headers={"Authorization": f"Bearer {os.environ['CHAT_API_TOKEN']}"})
    assert r.status_code == 200


def test_sin_token_es_401_no_403(cliente):
    r = cliente.get("/api/pagos/solicitudes")
    assert r.status_code == 401
