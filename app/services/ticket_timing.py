"""Cronómetro por ticket (corridas) y sumatoria de tiempos por misión."""
from __future__ import annotations

from app.services.recetas_ops import _now_iso, _parse_dt, _segundos_corrida
from app.services.tickets_db import _conn, registrar_tiempo


def _migrate_ticket_corridas():
    with _conn() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS ticket_corridas (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id           INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
                estado              TEXT NOT NULL DEFAULT 'activa'
                                        CHECK(estado IN ('activa','pausada','finalizada')),
                iniciada_en         TEXT NOT NULL,
                reanudada_en        TEXT,
                segundos_acumulados INTEGER NOT NULL DEFAULT 0,
                finalizada_en       TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_ticket_corridas_ticket
                ON ticket_corridas(ticket_id, estado);
        """)
        db.commit()


def _corrida_ticket_dict(row) -> dict:
    d = dict(row)
    d["segundos_transcurridos"] = _segundos_corrida(d)
    return d


def _corrida_abierta_ticket(db, ticket_id: int, usuario_id: int | None = None):
    q = """
        SELECT * FROM ticket_corridas
        WHERE ticket_id=? AND estado IN ('activa','pausada')
    """
    params: list = [ticket_id]
    if usuario_id is not None:
        q += " AND usuario_id=?"
        params.append(usuario_id)
    q += " ORDER BY id DESC LIMIT 1"
    return db.execute(q, params).fetchone()


def segundos_bitacora_ticket(db, ticket_id: int) -> int:
    row = db.execute(
        "SELECT COALESCE(SUM(horas), 0) AS h FROM bitacora_tiempo WHERE ticket_id=?",
        (ticket_id,),
    ).fetchone()
    return int(round(float(row["h"] or 0) * 3600))


def segundos_ticket_total(db, ticket_id: int, usuario_id: int | None = None) -> int:
    total = segundos_bitacora_ticket(db, ticket_id)
    c = _corrida_abierta_ticket(db, ticket_id, usuario_id)
    if c:
        total += _segundos_corrida(dict(c))
    return total


def enriquecer_tiempos_mision(d: dict) -> dict:
    """Suma tiempos de todos los tickets de la misión (bitácora + cronómetros abiertos)."""
    with _conn() as db:
        total_seg = 0
        for et in d.get("etapas") or []:
            tid = et.get("ticket_id")
            if not tid:
                et["ticket_segundos"] = 0
                et["ticket_horas"] = 0.0
                continue
            seg = segundos_ticket_total(db, tid)
            et["ticket_segundos"] = seg
            et["ticket_horas"] = round(seg / 3600, 2)
            total_seg += seg
        d["total_segundos_mision"] = total_seg
        d["total_horas_mision"] = round(total_seg / 3600, 2)
    return d


def adjuntar_corrida_ticket(d: dict, usuario_id: int | None) -> dict:
    if not usuario_id:
        d["corrida"] = None
        return d
    with _conn() as db:
        c = _corrida_abierta_ticket(db, d["id"], usuario_id)
        if not c:
            c = db.execute(
                """
                SELECT * FROM ticket_corridas
                WHERE ticket_id=? AND usuario_id=? AND estado='finalizada'
                ORDER BY id DESC LIMIT 1
                """,
                (d["id"], usuario_id),
            ).fetchone()
        d["corrida"] = _corrida_ticket_dict(c) if c else None
        d["segundos_trabajo"] = segundos_ticket_total(db, d["id"], usuario_id)
        d["total_horas"] = round(d["segundos_trabajo"] / 3600, 2)
    return d


def _persistir_tramo_bitacora(ticket_id: int, usuario_id: int, segundos: int, notas: str) -> None:
    if segundos < 1:
        return
    horas = round(segundos / 3600, 4)
    if horas <= 0:
        return
    registrar_tiempo(ticket_id, usuario_id, horas, notas)


def iniciar_corrida_ticket(
    ticket_id: int,
    usuario_id: int,
    segundos_previos: int = 0,
) -> tuple[dict | None, str | None]:
    with _conn() as db:
        if not db.execute("SELECT 1 FROM tickets WHERE id=?", (ticket_id,)).fetchone():
            return None, "Ticket no encontrado"
        existente = _corrida_abierta_ticket(db, ticket_id, usuario_id)
        if existente:
            c = dict(existente)
            seg_prev = max(0, int(segundos_previos or 0))
            if c["estado"] == "pausada":
                seg_acum = max(int(c.get("segundos_acumulados") or 0), seg_prev)
                now = _now_iso()
                db.execute(
                    """
                    UPDATE ticket_corridas
                    SET estado='activa', reanudada_en=?, segundos_acumulados=?
                    WHERE id=?
                    """,
                    (now, seg_acum, c["id"]),
                )
                db.commit()
            elif seg_prev > int(c.get("segundos_acumulados") or 0):
                db.execute(
                    "UPDATE ticket_corridas SET segundos_acumulados=? WHERE id=?",
                    (seg_prev, c["id"]),
                )
                db.commit()
            row = db.execute(
                "SELECT * FROM ticket_corridas WHERE id=?", (c["id"],),
            ).fetchone()
            return _corrida_ticket_dict(row), None
        seg0 = max(0, int(segundos_previos or 0))
        now = _now_iso()
        db.execute(
            """
            INSERT INTO ticket_corridas (
                ticket_id, usuario_id, estado, iniciada_en, reanudada_en, segundos_acumulados
            ) VALUES (?,?,?,?,?,?)
            """,
            (ticket_id, usuario_id, "activa", now, now, seg0),
        )
        cid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        db.commit()
        row = db.execute("SELECT * FROM ticket_corridas WHERE id=?", (cid,)).fetchone()
        return _corrida_ticket_dict(row), None


def get_corrida_ticket(corrida_id: int, usuario_id: int) -> dict | None:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM ticket_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        return _corrida_ticket_dict(row) if row else None


def pausar_corrida_ticket(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM ticket_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Cronómetro no encontrado"
        c = dict(row)
        if c["estado"] != "activa":
            return None, "El cronómetro no está activo"
        seg = _segundos_corrida(c)
        db.execute(
            """
            UPDATE ticket_corridas
            SET estado='pausada', segundos_acumulados=?, reanudada_en=NULL
            WHERE id=?
            """,
            (seg, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM ticket_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_ticket_dict(row), None


def reanudar_corrida_ticket(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM ticket_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Cronómetro no encontrado"
        if row["estado"] != "pausada":
            return None, "El cronómetro no está en pausa"
        now = _now_iso()
        db.execute(
            "UPDATE ticket_corridas SET estado='activa', reanudada_en=? WHERE id=?",
            (now, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM ticket_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_ticket_dict(row), None


def guardar_corrida_ticket(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    """Guarda el tramo en bitácora y deja el cronómetro listo para seguir."""
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM ticket_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Cronómetro no encontrado"
        c = dict(row)
        if c["estado"] == "finalizada":
            return None, "El cronómetro ya finalizó"
        if c["estado"] == "activa":
            seg = _segundos_corrida(c)
        else:
            seg = int(c.get("segundos_acumulados") or 0)
        _persistir_tramo_bitacora(
            c["ticket_id"], usuario_id, seg, "Cronómetro ticket (tramo guardado)",
        )
        now = _now_iso()
        if c["estado"] == "activa":
            db.execute(
                """
                UPDATE ticket_corridas
                SET segundos_acumulados=0, reanudada_en=?
                WHERE id=?
                """,
                (now, corrida_id),
            )
        else:
            db.execute(
                """
                UPDATE ticket_corridas
                SET segundos_acumulados=0, estado='pausada', reanudada_en=NULL
                WHERE id=?
                """,
                (corrida_id,),
            )
        db.commit()
        row = db.execute("SELECT * FROM ticket_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_ticket_dict(row), None


def finalizar_corrida_ticket(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM ticket_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Cronómetro no encontrado"
        c = dict(row)
        if c["estado"] == "activa":
            seg = _segundos_corrida(c)
        else:
            seg = int(c.get("segundos_acumulados") or 0)
        _persistir_tramo_bitacora(
            c["ticket_id"], usuario_id, seg, "Cronómetro ticket (finalizado)",
        )
        now = _now_iso()
        db.execute(
            """
            UPDATE ticket_corridas
            SET estado='finalizada', segundos_acumulados=0, finalizada_en=?, reanudada_en=NULL
            WHERE id=?
            """,
            (now, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM ticket_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_ticket_dict(row), None


def finalizar_corridas_abiertas_ticket(ticket_id: int) -> None:
    with _conn() as db:
        rows = db.execute(
            """
            SELECT * FROM ticket_corridas
            WHERE ticket_id=? AND estado IN ('activa','pausada')
            """,
            (ticket_id,),
        ).fetchall()
        for row in rows:
            c = dict(row)
            seg = _segundos_corrida(c) if c["estado"] == "activa" else int(c.get("segundos_acumulados") or 0)
            _persistir_tramo_bitacora(
                ticket_id, c["usuario_id"], seg, "Cronómetro ticket (cierre automático)",
            )
            now = _now_iso()
            db.execute(
                """
                UPDATE ticket_corridas
                SET estado='finalizada', segundos_acumulados=0, finalizada_en=?, reanudada_en=NULL
                WHERE id=?
                """,
                (now, c["id"]),
            )
        db.commit()
