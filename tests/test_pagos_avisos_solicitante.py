"""Los avisos de WhatsApp de una solicitud de pago (sep-2026).

Quien pide el pago recibía un «Armando escribió en la solicitud» por cada paso
automático (aprobado, montado en el banco), iguales entre sí, y ninguno al
terminar: el ticket no se cerraba porque el segundo token lo da quien no es el
asignado. Lo que protegen estos tests: al solicitante le llegan exactamente dos
avisos —escrito y terminado— y el ticket queda resuelto.
"""
from __future__ import annotations

import pytest

JERRY, ARMANDO, CYNTHIA = 10, 8, 6


@pytest.fixture()
def flujo(monkeypatch, tmp_path):
    import app.observability as obs
    import app.services.contabilidad_core as cc
    import app.services.pagos_wizard as w
    import app.services.tickets_notificaciones as tn
    from app.services import tickets_db

    for mod in (cc, w):
        monkeypatch.setattr(mod, "_DB_PATH", str(tmp_path / "conta.db"))
        monkeypatch.setattr(mod, "_initialized", False)
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets.db"))
    # Los avisos corren en hilos: aquí van en línea y se anotan en vez de enviarse.
    monkeypatch.setattr(obs, "spawn_thread", lambda fn, args=(), **kw: fn(*args))
    enviados: list[tuple[int, str]] = []
    monkeypatch.setattr(tn, "_programar", lambda uid, texto: enviados.append((uid, texto)))

    w.init_db()
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
                   " 'Aprobar pago — Servicios: $81.490','x','contabilidad','pendiente',?,?,"
                   " 'solicitud','pago')", (JERRY, ARMANDO))
        db.commit()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": banco})
    tercero = cc.crear_tercero({"nombre": "ETB", "tipo": "proveedor",
                                "tipo_persona": "juridica", "identificacion": "899999115"})
    s = w.crear_solicitud({"categoria": "flete_transporte", "monto": 81_490, "concepto": "Internet",
                           "tercero_id": tercero["id"], "medio_pago_id": medio["id"],
                           "fecha": "2026-09-21", "_sin_ticket": True})
    with w._conn() as con:
        con.execute("UPDATE cc_solicitudes_pago SET ticket_id=1 WHERE id=?", (s["id"],))
    return w, tickets_db, s["id"], enviados


def _estado_ticket(tickets_db):
    with tickets_db._conn() as db:
        return db.execute("SELECT estado FROM tickets WHERE id=1").fetchone()["estado"]


def test_pago_girado_dos_avisos_solo_al_solicitante(flujo):
    w, tickets_db, sid, enviados = flujo
    w.aprobar(sid, aprobada_por=ARMANDO, espejar=False)
    w.montar_en_banco(sid, por=ARMANDO)
    w.confirmar_pago(sid, por=CYNTHIA, comprobante=(b"%PDF-1.4 soporte", "banco.pdf"))

    assert [uid for uid, _ in enviados] == [JERRY, JERRY]
    assert enviados[0][1].startswith("Armando escribió en tu solicitud: Aprobar pago — Servicios")
    assert enviados[1][1].startswith("Cynthia terminó tu solicitud: Aprobar pago — Servicios")
    # Lo cierra el segundo token aunque Cynthia no sea la asignada.
    assert _estado_ticket(tickets_db) == "resuelto"


def test_rechazo_es_el_aviso_de_terminado(flujo):
    w, tickets_db, sid, enviados = flujo
    w.rechazar(sid, "pago doble", por=ARMANDO)

    assert len(enviados) == 1
    uid, texto = enviados[0]
    assert uid == JERRY and texto.startswith("Armando terminó tu solicitud") and "pago doble" in texto
    assert _estado_ticket(tickets_db) == "resuelto"


def test_quien_se_paga_a_si_mismo_no_recibe_avisos(flujo):
    w, tickets_db, sid, enviados = flujo
    with tickets_db._conn() as db:
        db.execute("UPDATE tickets SET creado_por=? WHERE id=1", (ARMANDO,))
        db.commit()
    w.aprobar(sid, aprobada_por=ARMANDO, espejar=False)
    assert enviados == []


def test_aviso_de_creacion_dice_que_es_un_pago(flujo):
    _w, _tdb, _sid, enviados = flujo
    import app.services.tickets_notificaciones as tn

    tn.notificar_ticket_creado(1)
    assert enviados == [(ARMANDO, "Solicitud de pago: Jenniffer te pide aprobar Servicios: $81.490.")]
