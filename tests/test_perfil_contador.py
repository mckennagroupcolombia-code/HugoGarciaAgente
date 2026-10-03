"""Perfil «contador»: el contador externo ve TODA la contabilidad, no toca nada.

Lectura + comentarios en el historial de terceros, y nada del resto de la
aplicación. Se controla en el backend por lista blanca: esconder un panel no
restringe su API («ocultar no es restringir», 15-sep-2026).
"""
from __future__ import annotations

import pytest

CONTADOR = {"id": 90, "nombre": "William Novoa", "username": "contador",
            "rol": {"id": 3, "nombre": "Operario", "nivel": 1},
            "permisos_secciones": {"contador": True}}
ADMIN = {"id": 1, "nombre": "Admin", "username": "admin",
         "rol": {"id": 1, "nombre": "Administrador", "nivel": 3},
         "permisos_secciones": {"contador": True}}


@pytest.fixture()
def cliente(monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-sistema")
    from flask import Flask

    from app.routes import register_routes
    from app.services import tickets_db

    usuarios = {"tok-contador": CONTADOR, "tok-admin": ADMIN}
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda t: usuarios.get(t))
    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _h(tok="tok-contador"):
    return {"Authorization": f"Bearer {tok}"}


def _bloqueado(r) -> bool:
    return r.status_code == 403 and "Perfil contador" in (r.get_json() or {}).get("error", "")


@pytest.mark.parametrize("ruta", [
    "/api/contabilidad/cc/balance-comprobacion",
    "/api/contabilidad/cc/diario",
    "/api/contabilidad/cc/plan-cuentas",
    "/api/pagos/documentos-soporte",
])
def test_el_contador_consulta_la_contabilidad(cliente, ruta):
    r = cliente.get(ruta, headers=_h())
    assert r.status_code not in (401, 403), (ruta, r.status_code, r.get_data(as_text=True)[:200])


@pytest.mark.parametrize("metodo, ruta", [
    ("post", "/api/contabilidad/cc/movimientos"),
    ("delete", "/api/contabilidad/cc/movimientos/1"),
    ("post", "/api/contabilidad/cc/terceros"),
    ("post", "/api/pagos/solicitudes"),
    ("post", "/api/pagos/solicitudes/1/documento-soporte/emitir"),
])
def test_el_contador_no_modifica_nada(cliente, metodo, ruta):
    assert _bloqueado(getattr(cliente, metodo)(ruta, headers=_h(), json={}))


@pytest.mark.parametrize("ruta", ["/api/sync/hoy", "/api/tickets", "/api/tickets/usuarios", "/api/preventa/pendientes"])
def test_el_resto_de_la_aplicacion_no_es_asunto_del_contador(cliente, ruta):
    assert _bloqueado(cliente.get(ruta, headers=_h()))


def test_sus_comentarios_quedan_como_indicacion_del_contador_y_firmados(cliente, monkeypatch):
    from app.services import terceros_historial as th

    capturado = {}
    monkeypatch.setattr(th, "registrar", lambda tid, **kw: capturado.update(kw, tid=tid) or {"ok": True})
    r = cliente.post("/api/contabilidad/cc/terceros/50/historial", headers=_h(),
                     json={"titulo": "Retener ICA 8,66", "tipo": "decision", "por": "otro", "monto": 5})
    assert r.status_code == 200
    assert capturado["tipo"] == "contador" and capturado["por"] == "William Novoa"
    assert capturado["monto"] is None


def test_un_administrador_no_queda_limitado(cliente):
    r = cliente.get("/api/tickets/usuarios", headers=_h("tok-admin"))
    assert not _bloqueado(r)


def test_se_entra_con_el_correo_y_la_contrasena(monkeypatch, tmp_path):
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "t.db"))
    tickets_db.init_db()
    u, err = tickets_db.crear_usuario("William", "william.contador", 3, password="clave-segura-1",
                                      email="WilliamFer94@Hotmail.com")
    assert u and not err
    res, err = tickets_db.login_usuario("williamfer94@hotmail.com", "clave-segura-1")
    assert res and res["token"] and not err
    assert tickets_db.login_usuario("williamfer94@hotmail.com", "mala")[1]


def test_cinco_intentos_fallidos_frenan_el_ingreso(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-sistema")
    from flask import Flask

    from app import routes_tickets
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(routes_tickets, "_LOGIN_FALLOS", {})
    app = Flask(__name__)
    routes_tickets.register_tickets_routes(app)
    with app.test_client() as c:
        codigos = [c.post("/api/tickets/auth/login", json={"username": "x@y.co", "password": "no"}).status_code
                   for _ in range(6)]
    assert codigos[:5] == [401] * 5 and codigos[5] == 429
