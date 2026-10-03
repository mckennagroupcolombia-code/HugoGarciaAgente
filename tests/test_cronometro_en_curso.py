"""Cronómetro de tareas: reloj global «en curso», sin duplicados y limpieza de huérfanos (27-sep-2026)."""
from __future__ import annotations

import threading

import pytest

from tests.test_tickets_trabajo_paralelo import H, _crear_accion, tickets_app  # noqa: F401


def test_en_curso_lista_activas_y_pausadas_de_tareas_abiertas(tickets_app):
    client, tickets_db = tickets_app
    from app.services import ticket_timing as tt

    a, b, c = (_crear_accion(tickets_db, n) for n in ("Empacar", "Alistar", "Cerrada"))
    ca, _ = tt.iniciar_corrida_ticket(a["id"], 2)
    cb, _ = tt.iniciar_corrida_ticket(b["id"], 2)
    tt.pausar_corrida_ticket(cb["id"], 2)
    tt.iniciar_corrida_ticket(c["id"], 2)
    with tickets_db._conn() as db:
        db.execute("UPDATE tickets SET estado='resuelto' WHERE id=?", (c["id"],))
        db.commit()

    r = client.get("/api/tickets/corridas/en-curso", headers=H)
    assert r.status_code == 200
    datos = r.get_json()
    assert [d["titulo"] for d in datos] == ["Empacar", "Alistar"]  # la activa primero
    assert [d["estado"] for d in datos] == ["activa", "pausada"]


def test_iniciar_a_la_vez_no_crea_dos_cronometros(tickets_app):
    _, tickets_db = tickets_app
    from app.services import ticket_timing as tt

    t = _crear_accion(tickets_db, "Doble clic")
    hilos = [threading.Thread(target=tt.iniciar_corrida_ticket, args=(t["id"], 2)) for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    with tickets_db._conn() as db:
        n = db.execute("SELECT COUNT(*) FROM ticket_corridas WHERE ticket_id=?", (t["id"],)).fetchone()[0]
    assert n == 1


def test_huerfanos_se_cierran_sin_sumar_tiempo(tickets_app):
    _, tickets_db = tickets_app
    from app.services import ticket_timing as tt

    t = _crear_accion(tickets_db, "Olvidada")
    tt.iniciar_corrida_ticket(t["id"], 2)
    with tickets_db._conn() as db:
        db.execute("UPDATE tickets SET estado='resuelto' WHERE id=?", (t["id"],))
        db.commit()

    assert len(tt.cerrar_corridas_huerfanas(aplicar=False)) == 1
    tt.cerrar_corridas_huerfanas(aplicar=True)
    with tickets_db._conn() as db:
        fila = db.execute("SELECT estado, finalizada_en FROM ticket_corridas WHERE ticket_id=?", (t["id"],)).fetchone()
        bit = db.execute("SELECT COUNT(*) FROM bitacora_tiempo WHERE ticket_id=?", (t["id"],)).fetchone()[0]
    assert fila["estado"] == "finalizada" and fila["finalizada_en"] is None
    assert bit == 0
    assert tt.cerrar_corridas_huerfanas(aplicar=False) == []
