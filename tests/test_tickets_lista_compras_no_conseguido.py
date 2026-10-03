"""Una solicitud de compra se puede cerrar aunque algo no se haya conseguido.

Antes, `cambiar_estado` exigía `comprado=1` en TODOS los ítems: si un producto
estaba agotado, el asignado veía "Faltan N producto(s) por marcar" y no tenía
ninguna forma de explicar por qué, así que la solicitud quedaba abierta para
siempre.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def tickets_client(tmp_path, monkeypatch):
    db_path = tmp_path / "tickets_compras_test.db"
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(db_path))
    tickets_db.init_db()
    with tickets_db._conn() as db:
        if not db.execute("SELECT id FROM roles WHERE id=1").fetchone():
            db.execute("INSERT INTO roles (id, nombre, nivel) VALUES (1, 'Operador', 1)")
        db.execute(
            "INSERT OR REPLACE INTO usuarios (id, username, nombre, password_hash, rol_id, activo) "
            "VALUES (1, 'comprador', 'Comprador', 'x', 1, 1)",
        )
        db.execute(
            "INSERT INTO tickets (id, numero, titulo, descripcion, categoria, estado, tipo, "
            "subtipo, creado_por, asignado_a) "
            "VALUES (1, 'TKT-T-0001', 'Compras: insumos', 'Desc', 'logistica', 'en_proceso', "
            "'solicitud', 'compra', 1, 1)",
        )
        db.execute(
            "INSERT INTO sesiones (usuario_id, token, expira_en) "
            "VALUES (1, 'tok-test', '2099-01-01 00:00:00')",
        )
        db.commit()

    from flask import Flask
    from app.routes_tickets import register_tickets_routes

    app = Flask(__name__)
    register_tickets_routes(app)
    return app.test_client(), tickets_db


H = {"Authorization": "Bearer tok-test"}


def _items(client, nombres):
    ids = []
    for n in nombres:
        r = client.post("/api/tickets/1/lista-compras", json={"nombre": n}, headers=H)
        assert r.status_code == 201
        ids = [i["id"] for i in r.get_json()]
    return ids


def test_no_se_puede_cerrar_con_items_sin_tocar(tickets_client):
    client, _ = tickets_client
    _items(client, ["Alcohol", "Guantes"])
    r = client.put("/api/tickets/1/estado", json={"estado": "resuelto"}, headers=H)
    assert r.status_code == 400
    assert "2 producto" in r.get_json()["error"]


def test_cerrar_con_uno_comprado_y_otro_no_conseguido(tickets_client):
    client, _ = tickets_client
    ids = _items(client, ["Alcohol", "Guantes"])
    comprado, agotado = ids[0], ids[1]

    client.put(f"/api/tickets/lista-compras/{comprado}", json={"comprado": 1}, headers=H)
    r = client.put(
        f"/api/tickets/lista-compras/{agotado}",
        json={"no_conseguido": 1, "motivo_no_compra": "Agotado en los tres proveedores"},
        headers=H,
    )
    assert r.status_code == 200
    item = next(i for i in r.get_json() if i["id"] == agotado)
    assert item["no_conseguido"] == 1
    assert item["motivo_no_compra"] == "Agotado en los tres proveedores"

    r2 = client.put("/api/tickets/1/estado", json={"estado": "resuelto"}, headers=H)
    assert r2.status_code == 200


def test_no_conseguido_exige_motivo(tickets_client):
    client, _ = tickets_client
    ids = _items(client, ["Alcohol"])
    r = client.put(
        f"/api/tickets/lista-compras/{ids[0]}", json={"no_conseguido": 1}, headers=H,
    )
    assert r.status_code == 400
    assert "por qué" in r.get_json()["error"]


def test_marcar_comprado_limpia_el_motivo(tickets_client):
    client, _ = tickets_client
    ids = _items(client, ["Alcohol"])
    client.put(
        f"/api/tickets/lista-compras/{ids[0]}",
        json={"no_conseguido": 1, "motivo_no_compra": "Agotado"},
        headers=H,
    )
    r = client.put(f"/api/tickets/lista-compras/{ids[0]}", json={"comprado": 1}, headers=H)
    item = r.get_json()[0]
    assert item["comprado"] == 1
    assert item["no_conseguido"] == 0
    assert item["motivo_no_compra"] is None
