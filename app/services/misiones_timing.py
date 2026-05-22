"""Cronómetro de ejecución de misiones (corridas con pausa/reanudación)."""
from __future__ import annotations

from datetime import datetime, timezone

from app.services.recetas_ops import _now_iso, _parse_dt, _segundos_corrida
from app.services.tickets_db import _conn


def _migrate_mision_corridas():
    with _conn() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS mision_corridas (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                mision_id           INTEGER NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
                usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
                estado              TEXT NOT NULL DEFAULT 'activa'
                                        CHECK(estado IN ('activa','pausada','finalizada')),
                iniciada_en         TEXT NOT NULL,
                reanudada_en        TEXT,
                segundos_acumulados INTEGER NOT NULL DEFAULT 0,
                finalizada_en       TEXT
            );
        """)
        db.commit()


def _corrida_mision_dict(row) -> dict:
    d = dict(row)
    d["segundos_transcurridos"] = _segundos_corrida(d)
    return d


def _corrida_activa_usuario(db, mision_id: int, usuario_id: int):
    return db.execute(
        """
        SELECT * FROM mision_corridas
        WHERE mision_id=? AND usuario_id=? AND estado IN ('activa','pausada')
        ORDER BY id DESC LIMIT 1
        """,
        (mision_id, usuario_id),
    ).fetchone()


def adjuntar_corrida_mision(d: dict, usuario_id: int | None) -> dict:
    if not usuario_id:
        d["corrida"] = None
        return d
    with _conn() as db:
        c = _corrida_activa_usuario(db, d["id"], usuario_id)
        if not c:
            c = db.execute(
                """
                SELECT * FROM mision_corridas
                WHERE mision_id=? AND usuario_id=? AND estado='finalizada'
                ORDER BY id DESC LIMIT 1
                """,
                (d["id"], usuario_id),
            ).fetchone()
        d["corrida"] = _corrida_mision_dict(c) if c else None
    return d


def finalizar_corridas_abiertas_mision(mision_id: int) -> None:
    """Cierra cronómetros activos/pausados al renovar o cancelar misión."""
    with _conn() as db:
        rows = db.execute(
            """
            SELECT * FROM mision_corridas
            WHERE mision_id=? AND estado IN ('activa','pausada')
            """,
            (mision_id,),
        ).fetchall()
        now = _now_iso()
        for row in rows:
            c = dict(row)
            seg = _segundos_corrida(c) if c["estado"] == "activa" else int(c.get("segundos_acumulados") or 0)
            db.execute(
                """
                UPDATE mision_corridas
                SET estado='finalizada', segundos_acumulados=?, finalizada_en=?, reanudada_en=NULL
                WHERE id=?
                """,
                (seg, now, c["id"]),
            )
        db.commit()


def iniciar_corrida_mision(
    mision_id: int,
    usuario_id: int,
    segundos_previos: int = 0,
) -> tuple[dict | None, str | None]:
    with _conn() as db:
        if not db.execute("SELECT 1 FROM misiones WHERE id=?", (mision_id,)).fetchone():
            return None, "Misión no encontrada"
        if _corrida_activa_usuario(db, mision_id, usuario_id):
            return None, "Ya hay un cronómetro en curso para esta misión"
        seg0 = max(0, int(segundos_previos or 0))
        now = _now_iso()
        db.execute(
            """
            INSERT INTO mision_corridas (
                mision_id, usuario_id, estado, iniciada_en, reanudada_en, segundos_acumulados
            ) VALUES (?,?,?,?,?,?)
            """,
            (mision_id, usuario_id, "activa", now, now, seg0),
        )
        cid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        db.commit()
        row = db.execute("SELECT * FROM mision_corridas WHERE id=?", (cid,)).fetchone()
        return _corrida_mision_dict(row), None


def get_corrida_mision(corrida_id: int, usuario_id: int) -> dict | None:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM mision_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        return _corrida_mision_dict(row) if row else None


def pausar_corrida_mision(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM mision_corridas WHERE id=? AND usuario_id=?",
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
            UPDATE mision_corridas
            SET estado='pausada', segundos_acumulados=?, reanudada_en=NULL
            WHERE id=?
            """,
            (seg, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM mision_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_mision_dict(row), None


def reanudar_corrida_mision(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM mision_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Cronómetro no encontrado"
        if row["estado"] != "pausada":
            return None, "El cronómetro no está en pausa"
        now = _now_iso()
        db.execute(
            "UPDATE mision_corridas SET estado='activa', reanudada_en=? WHERE id=?",
            (now, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM mision_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_mision_dict(row), None


def guardar_corrida_mision(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    """Persiste segundos acumulados sin finalizar; si está activa, reinicia el tramo."""
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM mision_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Cronómetro no encontrado"
        c = dict(row)
        if c["estado"] == "finalizada":
            return None, "El cronómetro ya finalizó"
        now = _now_iso()
        if c["estado"] == "activa":
            seg = _segundos_corrida(c)
            db.execute(
                """
                UPDATE mision_corridas
                SET segundos_acumulados=?, reanudada_en=?
                WHERE id=?
                """,
                (seg, now, corrida_id),
            )
        db.commit()
        row = db.execute("SELECT * FROM mision_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_mision_dict(row), None


def finalizar_corrida_mision(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM mision_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Cronómetro no encontrado"
        c = dict(row)
        if c["estado"] == "activa":
            seg = _segundos_corrida(c)
        else:
            seg = int(c.get("segundos_acumulados") or 0)
        now = _now_iso()
        db.execute(
            """
            UPDATE mision_corridas
            SET estado='finalizada', segundos_acumulados=?, finalizada_en=?, reanudada_en=NULL
            WHERE id=?
            """,
            (seg, now, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM mision_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_mision_dict(row), None
