"""Humo: marcar/desmarcar pasos de ticket."""
from __future__ import annotations

import pytest


@pytest.fixture
def tickets_client(tmp_path, monkeypatch):
    db_path = tmp_path / "tickets_pasos_test.db"
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(db_path))
    tickets_db.init_db()
    with tickets_db._conn() as db:
        if not db.execute("SELECT id FROM roles WHERE id=1").fetchone():
            db.execute("INSERT INTO roles (id, nombre, nivel) VALUES (1, 'Admin', 3)")
        db.execute(
            "INSERT OR REPLACE INTO usuarios (id, username, nombre, password_hash, rol_id, activo) "
            "VALUES (1, 'tester', 'Tester', 'x', 1, 1)",
        )
        db.execute(
            "INSERT INTO tickets (id, numero, titulo, descripcion, categoria, estado, creado_por) "
            "VALUES (1, 'TKT-T-0001', 'Test', 'Desc', 'logistica', 'en_proceso', 1)",
        )
        db.execute(
            "INSERT INTO ticket_pasos (id, ticket_id, orden, descripcion, completado) "
            "VALUES (10, 1, 1, 'Paso A', 0)",
        )
        db.commit()

    from flask import Flask
    from app.routes_tickets import register_tickets_routes

    app = Flask(__name__)
    register_tickets_routes(app)
    return app.test_client(), tickets_db


def _login(client, tickets_db):
    with tickets_db._conn() as db:
        db.execute(
            "INSERT INTO sesiones (usuario_id, token, expira_en) VALUES (1, 'tok-test', '2099-01-01 00:00:00')",
        )
        db.commit()
    return {"Authorization": "Bearer tok-test"}


def test_put_establecer_paso_completado(tickets_client):
    client, _ = tickets_client
    h = _login(client, _)

    r = client.put(
        "/api/tickets/1/pasos/10",
        json={"completado": 1},
        headers=h,
    )
    assert r.status_code == 200
    data = r.get_json()
    pasos = data["pasos"] if isinstance(data, dict) else data
    paso = next(p for p in pasos if p["id"] == 10)
    assert paso["completado"] == 1

    r2 = client.put(
        "/api/tickets/1/pasos/10",
        json={"completado": 0},
        headers=h,
    )
    assert r2.status_code == 200
    data2 = r2.get_json()
    pasos2 = data2["pasos"] if isinstance(data2, dict) else data2
    paso2 = next(p for p in pasos2 if p["id"] == 10)
    assert paso2["completado"] == 0
