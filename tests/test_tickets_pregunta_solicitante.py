"""Pedir una aclaración al solicitante: pausa la solicitud, avisa por WA y la reanuda.

Cubre el flujo del botón "Pedir intervención" del panel (`subtipo="pregunta"`):
sub-ticket para quien pidió la solicitud → padre bloqueado → respuesta → padre en proceso.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def tickets_app(tmp_path, monkeypatch):
    db_path = tmp_path / "tickets_pregunta_test.db"
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(db_path))
    monkeypatch.setenv("TICKETS_NOTIF_OPERADOR", "0")  # nunca enviar WhatsApp real
    # Dos pasadas: en la primera se crean las tablas, y las migraciones `_add_col`
    # (tipo/subtipo) corren antes del CREATE TABLE, así que solo aplican en la segunda.
    tickets_db.init_db()
    tickets_db.init_db()
    with tickets_db._conn() as db:
        if not db.execute("SELECT id FROM roles WHERE id=1").fetchone():
            db.execute("INSERT INTO roles (id, nombre, nivel) VALUES (1, 'Admin', 3)")
        for uid, user, nombre in ((1, "solicitante", "Ana"), (2, "ejecutor", "Beto")):
            db.execute(
                "INSERT OR REPLACE INTO usuarios (id, username, nombre, password_hash, rol_id, activo) "
                "VALUES (?,?,?,'x',1,1)",
                (uid, user, nombre),
            )
        db.execute(
            "INSERT INTO tickets (id, numero, titulo, descripcion, categoria, estado, tipo, "
            "creado_por, asignado_a) "
            "VALUES (1, 'TKT-T-0001', 'Llevar el pedido', 'Desc', 'logistica', 'en_proceso', "
            "'solicitud', 1, 2)",
        )
        db.execute(
            "INSERT INTO sesiones (usuario_id, token, expira_en) "
            "VALUES (2, 'tok-ejecutor', '2099-01-01 00:00:00'), "
            "       (1, 'tok-solicitante', '2099-01-01 00:00:00')",
        )
        db.commit()

    from flask import Flask
    from app.routes_tickets import register_tickets_routes

    app = Flask(__name__)
    register_tickets_routes(app)
    return app.test_client(), tickets_db


H_EJECUTOR = {"Authorization": "Bearer tok-ejecutor"}
H_SOLICITANTE = {"Authorization": "Bearer tok-solicitante"}


def test_pregunta_pausa_solicitud_y_respuesta_la_reanuda(tickets_app, monkeypatch):
    client, tickets_db = tickets_app

    avisos: list[tuple[int, str]] = []
    from app.services import tickets_notificaciones as tn
    monkeypatch.setattr(tn, "_programar", lambda uid, texto: avisos.append((uid, texto)))

    r = client.post(
        "/api/tickets/1/pedir-intervencion",
        json={"titulo": "¿Entrego en la sede norte o en bodega?", "asignado_a": 1,
              "subtipo": "pregunta"},
        headers=H_EJECUTOR,
    )
    assert r.status_code == 200, r.get_data(as_text=True)
    padre = r.get_json()

    # Pausada y apuntando al sub-ticket de la pregunta
    assert padre["estado"] == "pendiente"
    assert padre["bloqueado_por"]
    assert padre["bloqueado_por_subtipo"] == "pregunta"
    assert padre["bloqueado_por_asignado_nombre"] == "Ana"
    # La pregunta queda en el hilo (reporte de la solicitud)
    assert "en pausa" in padre["comentarios"][-1]["texto"].lower()

    # Aviso de WhatsApp al solicitante
    tn.notificar_intervencion_solicitada(padre["bloqueado_por"])
    assert avisos and avisos[-1][0] == 1
    assert "necesita tu respuesta" in avisos[-1][1]

    # No se puede encadenar otra pausa ni pedírsela a uno mismo
    assert client.post("/api/tickets/1/pedir-intervencion",
                       json={"titulo": "otra", "asignado_a": 1}, headers=H_EJECUTOR
                       ).status_code == 400
    assert client.post("/api/tickets/1/pedir-intervencion",
                       json={"titulo": "yo", "asignado_a": 2}, headers=H_EJECUTOR
                       ).status_code == 400

    # El solicitante responde y cierra la pregunta
    hijo = padre["bloqueado_por"]
    assert client.post(f"/api/tickets/{hijo}/comentarios",
                       json={"texto": "En bodega."}, headers=H_SOLICITANTE
                       ).status_code in (200, 201)
    assert client.put(f"/api/tickets/{hijo}/estado",
                      json={"estado": "resuelto"}, headers=H_SOLICITANTE
                      ).status_code == 200

    r2 = client.get("/api/tickets/1", headers=H_EJECUTOR)
    padre2 = r2.get_json()
    assert padre2["bloqueado_por"] is None
    assert padre2["estado"] == "en_proceso"
    # La respuesta viaja al hilo del padre
    assert "En bodega." in padre2["comentarios"][-1]["texto"]
