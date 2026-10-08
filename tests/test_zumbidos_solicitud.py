"""Zumbidos en las solicitudes (7-oct-2026): sacuden la pantalla de los demás miembros."""
from __future__ import annotations

from tests.test_tickets_trabajo_paralelo import H, tickets_app  # noqa: F401


def _solicitud(tickets_db) -> dict:
    # Beto (2) le pide algo a Ana (1).
    t, err = tickets_db.crear_ticket(
        {"titulo": "Pesar bultos", "categoria": "logistica", "descripcion": "x",
         "tipo": "solicitud", "asignado_a": 1},
        2,
    )
    assert not err, err
    return t


def test_zumbido_llega_a_los_demas_y_queda_en_el_hilo(tickets_app):
    client, tickets_db = tickets_app
    t = _solicitud(tickets_db)

    r = client.post(f"/api/tickets/{t['id']}/zumbido", headers=H)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["para"] == [1]

    pend = tickets_db.zumbidos_para_mi(1)
    assert len(pend) == 1 and pend[0]["de_nombre"] == "Beto" and pend[0]["numero"] == t["numero"]
    assert tickets_db.zumbidos_para_mi(2) == []  # a quien lo envía no le suena

    textos = [e["texto"] for e in tickets_db.timeline_ticket(t["id"]) if e.get("tipo") == "sistema"]
    assert any("Beto envió un zumbido" in x for x in textos)

    assert tickets_db.marcar_zumbidos_vistos(1, [pend[0]["id"]]) == 1
    assert tickets_db.zumbidos_para_mi(1) == []


def test_zumbido_espera_entre_uno_y_otro(tickets_app):
    client, tickets_db = tickets_app
    t = _solicitud(tickets_db)
    assert client.post(f"/api/tickets/{t['id']}/zumbido", headers=H).status_code == 200
    r = client.post(f"/api/tickets/{t['id']}/zumbido", headers=H)
    assert r.status_code == 429
    assert len(tickets_db.zumbidos_para_mi(1)) == 1


def test_zumbido_solo_miembros_y_solicitud_abierta(tickets_app):
    client, tickets_db = tickets_app
    t, _ = tickets_db.crear_ticket(
        {"titulo": "Ajena", "categoria": "logistica", "descripcion": "x", "tipo": "solicitud", "asignado_a": 1},
        1,
    )
    assert client.post(f"/api/tickets/{t['id']}/zumbido", headers=H).status_code == 400

    propia = _solicitud(tickets_db)
    with tickets_db._conn() as db:
        db.execute("UPDATE tickets SET estado='resuelto' WHERE id=?", (propia["id"],))
        db.commit()
    assert client.post(f"/api/tickets/{propia['id']}/zumbido", headers=H).status_code == 400
