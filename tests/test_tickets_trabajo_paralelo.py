"""Varias acciones y varias solicitudes pueden estar en curso a la vez por usuario.

Regla anterior (retirada ago-2026): `crear_ticket` y `cambiar_estado` rechazaban una
segunda acción `en_proceso` del mismo usuario. Ahora el trabajo es paralelo y cada
labor acumula su tiempo en su propia corrida (`ticket_corridas`).
"""
from __future__ import annotations

import pytest


@pytest.fixture
def tickets_app(tmp_path, monkeypatch):
    db_path = tmp_path / "tickets_paralelo_test.db"
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(db_path))
    monkeypatch.setenv("TICKETS_NOTIF_OPERADOR", "0")
    # Dos pasadas: las migraciones `_add_col` (tipo/subtipo) corren antes del CREATE TABLE.
    tickets_db.init_db()
    tickets_db.init_db()
    with tickets_db._conn() as db:
        if not db.execute("SELECT id FROM roles WHERE id=1").fetchone():
            db.execute("INSERT INTO roles (id, nombre, nivel) VALUES (1, 'Admin', 3)")
        for uid, user, nombre in ((1, "jefe", "Ana"), (2, "operario", "Beto")):
            db.execute(
                "INSERT OR REPLACE INTO usuarios (id, username, nombre, password_hash, rol_id, activo) "
                "VALUES (?,?,?,'x',1,1)",
                (uid, user, nombre),
            )
        db.execute(
            "INSERT INTO sesiones (usuario_id, token, expira_en) "
            "VALUES (2, 'tok-operario', '2099-01-01 00:00:00')",
        )
        db.commit()

    from flask import Flask
    from app.routes_tickets import register_tickets_routes

    app = Flask(__name__)
    register_tickets_routes(app)
    return app.test_client(), tickets_db


H = {"Authorization": "Bearer tok-operario"}


def _crear_accion(tickets_db, titulo: str) -> dict:
    t, err = tickets_db.crear_ticket(
        {"titulo": titulo, "categoria": "logistica", "descripcion": titulo,
         "tipo": "accion", "asignado_a": 2},
        2,
    )
    assert not err, err
    return t


def test_varias_acciones_en_proceso_a_la_vez(tickets_app):
    _, tickets_db = tickets_app

    a1 = _crear_accion(tickets_db, "Limpiar reactor")
    a2 = _crear_accion(tickets_db, "Pesar materia prima")
    a3 = _crear_accion(tickets_db, "Rotular lote")

    for t in (a1, a2, a3):
        assert t["estado"] == "en_proceso", t["titulo"]

    abiertas = tickets_db.acciones_en_proceso_de(2)
    assert {a["id"] for a in abiertas} == {a1["id"], a2["id"], a3["id"]}

    # Pausar una no toca las otras; reanudarla tampoco choca con las que siguen abiertas
    usuario = {"id": 2, "rol": {"nivel": 1}}
    ok, err = tickets_db.cambiar_estado(a2["id"], "pendiente", usuario)
    assert ok, err
    assert len(tickets_db.acciones_en_proceso_de(2)) == 2
    ok, err = tickets_db.cambiar_estado(a2["id"], "en_proceso", usuario)
    assert ok, err
    assert len(tickets_db.acciones_en_proceso_de(2)) == 3


def test_varias_solicitudes_en_resolucion_con_cronometro_propio(tickets_app):
    client, tickets_db = tickets_app

    ids = []
    for titulo in ("Llevar pedido 101", "Llevar pedido 102"):
        t, err = tickets_db.crear_ticket(
            {"titulo": titulo, "categoria": "logistica", "descripcion": titulo,
             "tipo": "solicitud", "asignado_a": 2},
            1,
        )
        assert not err, err
        ids.append(t["id"])

    for tid in ids:
        r = client.put(f"/api/tickets/{tid}/estado", json={"estado": "en_proceso"}, headers=H)
        assert r.status_code == 200, r.get_data(as_text=True)
        rc = client.post(f"/api/tickets/{tid}/corridas/iniciar", json={}, headers=H)
        assert rc.status_code == 200, rc.get_data(as_text=True)

    # Ambas quedan en curso, cada una con su propia corrida activa
    corridas = set()
    for tid in ids:
        det = client.get(f"/api/tickets/{tid}", headers=H).get_json()
        assert det["estado"] == "en_proceso"
        assert det["corrida"] and det["corrida"]["estado"] == "activa"
        corridas.add(det["corrida"]["id"])
    assert len(corridas) == 2
