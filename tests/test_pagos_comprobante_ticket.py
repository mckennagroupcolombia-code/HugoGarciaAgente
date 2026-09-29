"""El comprobante del giro llega a los tickets (28-sep-2026, TKT-2026-1564/1565).

Un lote de mensajería de Interrapidísimo quedó en DOS tickets: el suelto del
lote («Aprobar pago Interrapidísimo») y el de Solicitudes de pago. Al girar,
el segundo se cerró pero sin el comprobante a la vista («está en la
solicitud»), y el primero siguió abierto: alguien tuvo que iniciarlo,
entregarlo y el solicitante volvió a pedir el soporte. Estos tests protegen
que (a) el comprobante quede como adjunto del ticket de la solicitud, (b) el
aviso diga en qué TKT está, y (c) el ticket suelto del lote se cierre solo
con el mismo comprobante.
"""
from __future__ import annotations

import os

import pytest

JERRY, ARMANDO, CYNTHIA = 10, 8, 6


@pytest.fixture()
def flujo(monkeypatch, tmp_path):
    import app.observability as obs
    import app.services.contabilidad_core as cc
    import app.services.contabilidad_db as cdb
    import app.services.mensajeria_pagos as mp
    import app.services.pagos_wizard as w
    import app.services.tickets_notificaciones as tn
    from app.services import tickets_db

    for mod in (cc, w, cdb):
        monkeypatch.setattr(mod, "_DB_PATH", str(tmp_path / "conta.db"))
        monkeypatch.setattr(mod, "_initialized", False)
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets.db"))
    monkeypatch.setattr(tickets_db, "UPLOADS_DIR", str(tmp_path / "uploads_tickets"))
    monkeypatch.setattr(mp, "_COMPROBANTES_DIR", str(tmp_path / "comprobantes"))
    monkeypatch.setattr(obs, "spawn_thread", lambda fn, args=(), **kw: fn(*args))
    enviados: list[tuple[int, str]] = []
    monkeypatch.setattr(tn, "_programar", lambda uid, texto: enviados.append((uid, texto)))

    w.init_db()
    mp.ensure_mensajeria_tables()
    tickets_db.init_db()
    with tickets_db._conn() as db:
        db.execute("INSERT OR IGNORE INTO roles (id, nombre, nivel) VALUES (1,'Admin',3)")
        db.execute("INSERT OR IGNORE INTO roles (id, nombre, nivel) VALUES (2,'Operario',1)")
        for uid, user, nombre, rol in ((JERRY, "jerry", "Jenniffer Garcia", 2),
                                       (ARMANDO, "armando", "Armando Garcia", 1),
                                       (CYNTHIA, "@cynthia", "Cynthia Ruiz", 1)):
            db.execute("INSERT INTO usuarios (id, username, nombre, password_hash, rol_id, activo)"
                       " VALUES (?,?,?,'x',?,1)", (uid, user, nombre, rol))
        db.execute("INSERT INTO tickets (id, numero, titulo, descripcion, categoria, estado,"
                   " creado_por, asignado_a, tipo, subtipo) VALUES (1,'TKT-T-1',"
                   " 'Aprobar pago — Flete o transporte: $81.490','x','contabilidad','pendiente',?,?,"
                   " 'solicitud','pago')", (JERRY, ARMANDO))
        db.commit()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": banco})
    tercero = cc.crear_tercero({"nombre": "MARIA CAMILA NEIZA", "tipo": "proveedor",
                                "tipo_persona": "natural", "identificacion": "1000000001"})
    s = w.crear_solicitud({"categoria": "flete_transporte", "monto": 81_490, "concepto": "Mensajería",
                           "tercero_id": tercero["id"], "medio_pago_id": medio["id"],
                           "fecha": "2026-09-28", "_sin_ticket": True})
    with w._conn() as con:
        con.execute("UPDATE cc_solicitudes_pago SET ticket_id=1 WHERE id=?", (s["id"],))
    return w, mp, tickets_db, s["id"], enviados


def _girar(w, sid):
    w.aprobar(sid, aprobada_por=ARMANDO, espejar=False)
    w.montar_en_banco(sid, por=ARMANDO)
    w.confirmar_pago(sid, por=CYNTHIA, comprobante=(b"%PDF-1.4 soporte", "banco.pdf"))


def test_el_comprobante_queda_adjunto_en_el_ticket(flujo):
    w, _mp, tickets_db, sid, enviados = flujo
    _girar(w, sid)
    adjuntos = tickets_db.listar_adjuntos(1)
    assert [a["nombre_original"] for a in adjuntos] == ["comprobante_banco.pdf"]
    assert os.path.isfile(os.path.join(tickets_db.UPLOADS_DIR, adjuntos[0]["nombre_archivo"]))
    uid, texto = enviados[-1]
    assert uid == JERRY and "adjunto en el TKT-T-1" in texto


def test_el_ticket_suelto_del_lote_se_cierra_con_el_pago(flujo):
    w, mp, tickets_db, sid, _ = flujo
    envio = mp.guardar_envio({"fecha": "2026-09-25", "cantidad": 6, "valor": 81_490})
    lote = mp.crear_lote([envio["id"]])
    with tickets_db._conn() as db:
        db.execute("INSERT INTO tickets (id, numero, titulo, descripcion, categoria, estado,"
                   " creado_por, asignado_a, tipo) VALUES (2,'TKT-T-2',"
                   " 'Aprobar pago Interrapidísimo — $ 81.490','x','logistica','pendiente',?,?,"
                   " 'solicitud')", (JERRY, ARMANDO))
        db.commit()
    import app.services.contabilidad_db as cdb

    with cdb._conn() as con:
        con.execute("UPDATE mensajeria_lotes SET ticket_id=2, solicitud_pago_id=? WHERE id=?",
                    (sid, lote["id"]))
    with w._conn() as con:
        con.execute("UPDATE cc_solicitudes_pago SET origen_ref=? WHERE id=?",
                    (f"mensajeria:{lote['id']}", sid))

    _girar(w, sid)

    with tickets_db._conn() as db:
        assert db.execute("SELECT estado FROM tickets WHERE id=2").fetchone()["estado"] == "resuelto"
    assert [a["nombre_original"] for a in tickets_db.listar_adjuntos(2)] == ["comprobante_banco.pdf"]
    assert mp.obtener_lote(lote["id"])["estado"] == "pagado"
