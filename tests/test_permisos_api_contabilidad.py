"""Quién puede leer la contabilidad por API.

Hasta sep-2026 las rutas `/api/pagos/*` solo exigían `_api_token_valido()`, que
acepta la sesión de CUALQUIER usuario del panel. La sección estaba oculta en el
menú (lib/contabilidadAccess.ts → "pagos"), pero ocultar no es restringir: con
su propio token, el usuario de despachos (`jerry`, nivel operario, sin permiso
`pagos` ni `libro-mayor`) obtenía el listado completo de solicitudes con
proveedor, monto, factura cotejada y saldos 2205.

Lo mismo pasaba en el resto del hub: Libro Mayor, Préstamos (cédula, correo y
cuenta bancaria de cada prestamista), saldos con socios y extractos bancarios
estaban abiertos a cualquier sesión del panel.

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


# ─── El resto del hub Contabilidad ────────────────────────────────────────────

RUTAS_CONTABLES = [
    "/api/contabilidad/cc/movimientos",
    "/api/contabilidad/cc/terceros",
    "/api/contabilidad/cc/medios-pago",
    "/api/contabilidad/cc/balance-comprobacion",
    "/api/contabilidad/cc/mi-tercero",
    "/api/contabilidad/checklist",
    "/api/contabilidad/creditos",
    "/api/contabilidad/extractos",
    "/api/prestamos",
    "/api/socios/saldos",
    "/api/alegra/espejo",
]


@pytest.mark.parametrize("ruta", RUTAS_CONTABLES)
def test_operario_sin_permiso_contable_no_lee_nada(cliente, monkeypatch, ruta):
    _sesion(monkeypatch, _usuario(1, {"pedidos": True, "operativos": True, "stock": True}))
    r = cliente.get(ruta, headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403, f"{ruta} quedó abierta a un operario sin permiso contable"


@pytest.mark.parametrize("ruta", RUTAS_CONTABLES)
def test_el_alias_del_proxy_esta_igual_de_cerrado(cliente, monkeypatch, ruta):
    # El panel habla por /app/api/... cuando el proxy lo obliga; cerrar solo
    # /api/... dejaría la puerta de al lado abierta.
    _sesion(monkeypatch, _usuario(1, {"pedidos": True}))
    r = cliente.get(f"/app{ruta}", headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403


def test_libro_mayor_abre_todo_el_hub(cliente, monkeypatch):
    _sesion(monkeypatch, _usuario(1, {"libro-mayor": True}))
    for ruta in ("/api/contabilidad/cc/terceros", "/api/prestamos", "/api/socios/saldos"):
        r = cliente.get(ruta, headers={"Authorization": "Bearer sesion"})
        assert r.status_code != 403, ruta


def test_prestamos_ve_los_movimientos_que_su_panel_necesita(cliente, monkeypatch):
    # PrestamosPanel lee /cc/movimientos y /cc/medios-pago para armar el
    # cronograma: negárselos rompería el panel de quien sí tiene el permiso.
    _sesion(monkeypatch, _usuario(1, {"prestamos": True}))
    for ruta in ("/api/prestamos", "/api/contabilidad/cc/movimientos",
                 "/api/contabilidad/cc/medios-pago", "/api/contabilidad/cc/terceros"):
        r = cliente.get(ruta, headers={"Authorization": "Bearer sesion"})
        assert r.status_code != 403, ruta


def test_pagos_llega_a_los_catalogos_pero_no_al_libro(cliente, monkeypatch):
    # El wizard necesita plan de cuentas, terceros y medios de pago (TerceroSelect
    # crea terceros desde ahí); el Libro Mayor completo no es asunto suyo.
    _sesion(monkeypatch, _usuario(1, {"pagos": True}))
    for ruta in ("/api/contabilidad/cc/plan-cuentas", "/api/contabilidad/cc/terceros",
                 "/api/contabilidad/cc/medios-pago"):
        assert cliente.get(ruta, headers={"Authorization": "Bearer s"}).status_code != 403, ruta
    for ruta in ("/api/contabilidad/cc/movimientos", "/api/prestamos"):
        assert cliente.get(ruta, headers={"Authorization": "Bearer s"}).status_code == 403, ruta


def test_una_ruta_contable_nueva_nace_protegida(cliente, monkeypatch):
    # El guard es por prefijo a propósito: lo que se agregue bajo
    # /api/contabilidad/ queda cerrado aunque nadie se acuerde de protegerlo.
    _sesion(monkeypatch, _usuario(1, {"pedidos": True}))
    r = cliente.get("/api/contabilidad/lo-que-sea-que-venga-despues",
                    headers={"Authorization": "Bearer sesion-de-jerry"})
    assert r.status_code == 403


def test_el_expediente_fiscal_conserva_su_propio_control(cliente, monkeypatch):
    # /api/socios/<id>/… es el Declarador (app/routes_declarador.py): cada socio
    # ve SOLO el suyo, con su propia regla. Este guard no debe pisarla.
    from app import routes

    assert routes  # import explícito: el guard vive en register_routes
    _sesion(monkeypatch, _usuario(1, {"socios": True}))
    r = cliente.get("/api/socios", headers={"Authorization": "Bearer sesion"})
    assert r.status_code != 403
