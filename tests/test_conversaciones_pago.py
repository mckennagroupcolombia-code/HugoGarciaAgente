"""«Aprobar pago — …» trae `pago_id` en la bandeja: el panel lleva a Solicitudes de pago (7-oct-2026)."""
from __future__ import annotations

import pytest

from app.services import tickets_db


@pytest.fixture()
def db(monkeypatch, tmp_path):
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    monkeypatch.setattr(tickets_db, "UPLOADS_DIR", str(tmp_path / "uploads"))
    tickets_db.init_db()
    with tickets_db._conn() as c:
        for uid, n in ((1, "ana"), (2, "beto")):
            c.execute("INSERT OR REPLACE INTO usuarios (id, nombre, username, password_hash, activo) VALUES (?,?,?,?,1)",
                      (uid, n.title(), n, "x"))
    return tickets_db


def test_solicitud_de_pago_trae_su_id_y_las_demas_no(db):
    pago, err = db.crear_ticket({"tipo": "solicitud", "subtipo": "pago", "categoria": "contabilidad", "titulo": "Aprobar pago — Flete: $285.800",
                                 "descripcion": "Monto…\n\nSYS_SOLICITUD_PAGO: 71", "asignado_a": 2}, 1, None, notificar=False)
    assert not err
    otra, err = db.crear_ticket({"tipo": "solicitud", "categoria": "contabilidad", "titulo": "Etiqueta 50 ml", "descripcion": "SYS_SOLICITUD_PAGO: 9",
                                 "asignado_a": 2}, 1, None, notificar=False)
    assert not err
    por_id = {c["id"]: c for c in db.listar_conversaciones({"id": 2, "rol": {"nivel": 1}})}
    assert por_id[pago["id"]]["pago_id"] == 71
    assert por_id[otra["id"]]["pago_id"] is None  # solo cuenta en subtipo «pago»
    assert "_desc_pago" not in por_id[pago["id"]]
