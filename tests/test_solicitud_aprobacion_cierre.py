"""Una solicitud delegada la cierra quien la pidió, no quien la ejecutó."""
from __future__ import annotations

import pytest


@pytest.fixture
def tdb(tmp_path, monkeypatch):
    db_path = tmp_path / "tickets_aprobacion_test.db"
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(db_path))
    # La primera pasada crea las tablas; las migraciones de columnas (tipo,
    # subtipo, ticket_padre_id) corren antes del CREATE y se saltan en una BD
    # nueva, así que hace falta una segunda pasada.
    tickets_db.init_db()
    tickets_db.init_db()
    with tickets_db._conn() as db:
        for rid, nombre, nivel in ((1, "Admin", 3), (3, "Operario", 1)):
            if not db.execute("SELECT id FROM roles WHERE id=?", (rid,)).fetchone():
                db.execute(
                    "INSERT INTO roles (id, nombre, nivel) VALUES (?,?,?)",
                    (rid, nombre, nivel),
                )
        usuarios = (
            (1, "cynthia", "Cynthia", 1, 1),
            (2, "stella", "Stella", 3, 1),
            (3, "hugo_ia_bot", "Hugo IA", 3, 1),
            (4, "inactiva", "Ex aliada", 3, 0),
        )
        for uid, username, nombre, rol_id, activo in usuarios:
            db.execute(
                "INSERT OR REPLACE INTO usuarios "
                "(id, username, nombre, password_hash, rol_id, activo) VALUES (?,?,?,'x',?,?)",
                (uid, username, nombre, rol_id, activo),
            )
        db.commit()
    return tickets_db


def _crear(tdb, tid, creado_por, asignado_a, *, subtipo=None, padre=None,
           tipo="solicitud", estado="en_proceso"):
    with tdb._conn() as db:
        db.execute(
            "INSERT INTO tickets (id, numero, titulo, descripcion, categoria, estado, "
            "creado_por, asignado_a, tipo, subtipo, ticket_padre_id) "
            "VALUES (?,?,?,?,'logistica',?,?,?,?,?,?)",
            (tid, f"TKT-T-{tid:04d}", "Formulas", "Desc", estado,
             creado_por, asignado_a, tipo, subtipo, padre),
        )
        db.commit()


def _estado(tdb, tid):
    with tdb._conn() as db:
        return db.execute("SELECT estado FROM tickets WHERE id=?", (tid,)).fetchone()["estado"]


STELLA = {"id": 2, "rol": {"nivel": 1}}
CYNTHIA = {"id": 1, "rol": {"nivel": 3}}


def test_asignado_no_cierra_solo_pasa_a_revision(tdb):
    _crear(tdb, 1, creado_por=1, asignado_a=2)

    ok, err = tdb.cambiar_estado(1, "resuelto", STELLA)

    assert ok, err
    assert _estado(tdb, 1) == "esperando_aprobacion"


def test_solicitante_aprueba_y_queda_resuelta(tdb):
    _crear(tdb, 2, creado_por=1, asignado_a=2, estado="esperando_aprobacion")

    ok, err = tdb.cambiar_estado(2, "resuelto", CYNTHIA)

    assert ok, err
    assert _estado(tdb, 2) == "resuelto"


def test_solicitante_puede_devolverla_rechazada(tdb):
    _crear(tdb, 3, creado_por=1, asignado_a=2, estado="esperando_aprobacion")

    ok, err = tdb.cambiar_estado(3, "rechazado", CYNTHIA, motivo="Falta el verde malaquita")

    assert ok, err
    assert _estado(tdb, 3) == "rechazado"


def test_accion_propia_cierra_directo(tdb):
    _crear(tdb, 4, creado_por=2, asignado_a=2, tipo="accion")

    ok, err = tdb.cambiar_estado(4, "resuelto", STELLA)

    assert ok, err
    assert _estado(tdb, 4) == "resuelto"


def test_solicitud_autoasignada_cierra_directo(tdb):
    _crear(tdb, 5, creado_por=2, asignado_a=2)

    ok, err = tdb.cambiar_estado(5, "resuelto", STELLA)

    assert ok, err
    assert _estado(tdb, 5) == "resuelto"


def test_creada_por_el_bot_cierra_directo(tdb):
    _crear(tdb, 6, creado_por=3, asignado_a=2)

    ok, err = tdb.cambiar_estado(6, "resuelto", STELLA)

    assert ok, err
    assert _estado(tdb, 6) == "resuelto"


def test_creador_inactivo_cierra_directo(tdb):
    _crear(tdb, 7, creado_por=4, asignado_a=2)

    ok, err = tdb.cambiar_estado(7, "resuelto", STELLA)

    assert ok, err
    assert _estado(tdb, 7) == "resuelto"


def test_intervencion_cierra_directo_para_desbloquear_al_padre(tdb):
    _crear(tdb, 8, creado_por=1, asignado_a=1, tipo="accion")
    _crear(tdb, 9, creado_por=1, asignado_a=2, padre=8)
    with tdb._conn() as db:
        db.execute("UPDATE tickets SET bloqueado_por=9, estado='pendiente' WHERE id=8")
        db.commit()

    ok, err = tdb.cambiar_estado(9, "resuelto", STELLA)

    assert ok, err
    assert _estado(tdb, 9) == "resuelto"
    assert _estado(tdb, 8) == "en_proceso"


def test_compra_delegada_cierra_directo(tdb):
    _crear(tdb, 10, creado_por=1, asignado_a=2, subtipo="compra")

    ok, err = tdb.cambiar_estado(10, "resuelto", STELLA)

    assert ok, err
    assert _estado(tdb, 10) == "resuelto"
