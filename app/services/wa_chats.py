"""
Historial de conversaciones WhatsApp para el panel de operaciones.
Almacena mensajes entrantes (clientes) y salientes (bot o humano) en SQLite.
"""
import sqlite3
import time
import os
import threading

_DB = os.path.join("app", "data", "wa_chats.db")
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB, check_same_thread=False, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init() -> None:
    with _lock, _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS mensajes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          REAL    NOT NULL,
                jid         TEXT    NOT NULL,
                direccion   TEXT    NOT NULL CHECK(direccion IN ('entrada','salida')),
                texto       TEXT,
                tiene_media INTEGER NOT NULL DEFAULT 0,
                nombre_arch TEXT,
                enviado_por TEXT    NOT NULL DEFAULT 'bot',
                leido       INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_jid_ts ON mensajes(jid, ts);
        """)


_init()


def guardar(
    jid: str,
    direccion: str,
    texto: str = "",
    tiene_media: bool = False,
    nombre_arch: str = "",
    enviado_por: str = "bot",
) -> None:
    """Guarda un mensaje (entrada del cliente o salida del bot/operador)."""
    if not jid or not direccion:
        return
    try:
        with _lock, _conn() as c:
            c.execute(
                """INSERT INTO mensajes
                   (ts, jid, direccion, texto, tiene_media, nombre_arch, enviado_por)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    time.time(),
                    jid,
                    direccion,
                    (texto or "")[:2000],
                    int(tiene_media),
                    nombre_arch or "",
                    enviado_por,
                ),
            )
    except Exception as e:
        print(f"[wa_chats] error al guardar: {e}")


def marcar_leido(jid: str) -> None:
    try:
        with _lock, _conn() as c:
            c.execute(
                "UPDATE mensajes SET leido=1 WHERE jid=? AND leido=0 AND direccion='entrada'",
                (jid,),
            )
    except Exception as e:
        print(f"[wa_chats] error marcar_leido: {e}")


def listar_conversaciones(limit: int = 60) -> list[dict]:
    """Una fila por JID: último mensaje + conteo de no leídos."""
    try:
        with _lock, _conn() as c:
            rows = c.execute(
                """
                SELECT
                    m.jid,
                    m.ts,
                    m.texto,
                    m.direccion,
                    m.tiene_media,
                    m.enviado_por,
                    COALESCE(u.no_leidos, 0) AS no_leidos
                FROM mensajes m
                JOIN (
                    SELECT jid, MAX(id) AS max_id
                    FROM mensajes
                    GROUP BY jid
                ) latest ON m.id = latest.max_id
                LEFT JOIN (
                    SELECT jid, COUNT(*) AS no_leidos
                    FROM mensajes
                    WHERE leido=0 AND direccion='entrada'
                    GROUP BY jid
                ) u ON m.jid = u.jid
                ORDER BY m.ts DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        print(f"[wa_chats] error listar_conversaciones: {e}")
        return []


def listar_mensajes(jid: str, limit: int = 120) -> list[dict]:
    """Mensajes de una conversación, de más antiguo a más nuevo."""
    try:
        with _lock, _conn() as c:
            rows = c.execute(
                """SELECT id, ts, jid, direccion, texto, tiene_media,
                          nombre_arch, enviado_por, leido
                   FROM mensajes
                   WHERE jid=?
                   ORDER BY ts DESC LIMIT ?""",
                (jid, limit),
            ).fetchall()
            return list(reversed([dict(r) for r in rows]))
    except Exception as e:
        print(f"[wa_chats] error listar_mensajes: {e}")
        return []


def total_no_leidos() -> int:
    try:
        with _lock, _conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM mensajes WHERE leido=0 AND direccion='entrada'"
            ).fetchone()
            return int(row["n"]) if row else 0
    except Exception:
        return 0
