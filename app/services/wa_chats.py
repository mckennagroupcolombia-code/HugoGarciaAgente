"""
Historial de conversaciones WhatsApp para el panel de operaciones.
Almacena mensajes entrantes (clientes) y salientes (bot o humano) en SQLite.
"""
import sqlite3
import time
import os
import threading

_DB = os.getenv("WA_CHATS_DB", os.path.join("app", "data", "wa_chats.db"))
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
        cols = {r[1] for r in c.execute("PRAGMA table_info(mensajes)").fetchall()}
        if "wa_id" not in cols:
            c.execute("ALTER TABLE mensajes ADD COLUMN wa_id TEXT")
        if "eliminado" not in cols:
            c.execute(
                "ALTER TABLE mensajes ADD COLUMN eliminado INTEGER NOT NULL DEFAULT 0"
            )
        c.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_mensajes_wa_id "
            "ON mensajes(wa_id) WHERE wa_id IS NOT NULL"
        )


_init()


def guardar(
    jid: str,
    direccion: str,
    texto: str = "",
    tiene_media: bool = False,
    nombre_arch: str = "",
    enviado_por: str = "bot",
    wa_id: str | None = None,
    ts: float | None = None,
) -> None:
    """Guarda un mensaje (entrada del cliente o salida del bot/operador)."""
    if not jid or not direccion:
        return
    try:
        from app.services.wa_jid import jid_canonico

        canon = jid_canonico(jid)
        ts_val = float(ts if ts is not None else time.time())
        wa_key = (wa_id or "").strip() or None
        with _lock, _conn() as c:
            if wa_key:
                row = c.execute(
                    "SELECT id FROM mensajes WHERE wa_id=?", (wa_key,)
                ).fetchone()
                if row:
                    c.execute(
                        """UPDATE mensajes SET
                           ts=?, jid=?, direccion=?, texto=?, tiene_media=?,
                           nombre_arch=?, enviado_por=?, eliminado=0
                           WHERE wa_id=?""",
                        (
                            ts_val,
                            canon,
                            direccion,
                            (texto or "")[:2000],
                            int(tiene_media),
                            nombre_arch or "",
                            enviado_por,
                            wa_key,
                        ),
                    )
                else:
                    c.execute(
                        """INSERT INTO mensajes
                           (ts, jid, direccion, texto, tiene_media, nombre_arch,
                            enviado_por, wa_id, eliminado)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                        (
                            ts_val,
                            canon,
                            direccion,
                            (texto or "")[:2000],
                            int(tiene_media),
                            nombre_arch or "",
                            enviado_por,
                            wa_key,
                        ),
                    )
            else:
                c.execute(
                    """INSERT INTO mensajes
                       (ts, jid, direccion, texto, tiene_media, nombre_arch, enviado_por, eliminado)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 0)""",
                    (
                        ts_val,
                        canon,
                        direccion,
                        (texto or "")[:2000],
                        int(tiene_media),
                        nombre_arch or "",
                        enviado_por,
                    ),
                )
    except Exception as e:
        print(f"[wa_chats] error al guardar: {e}")


def marcar_eliminado_por_wa_id(wa_id: str) -> int:
    if not wa_id:
        return 0
    try:
        with _lock, _conn() as c:
            cur = c.execute(
                "UPDATE mensajes SET eliminado=1 WHERE wa_id=? AND eliminado=0",
                (wa_id.strip(),),
            )
            return int(cur.rowcount or 0)
    except Exception as e:
        print(f"[wa_chats] error marcar_eliminado: {e}")
        return 0


def ingestar_desde_whatsapp(mensajes: list[dict]) -> dict:
    """
    Lote desde bridge (sync o mensajes fromMe del celular).
    Cada item: wa_id, jid, ts, from_me, texto, tiene_media, enviado_por (opcional).
    """
    insertados = 0
    actualizados = 0
    omitidos = 0
    for raw in mensajes or []:
        wa_id = str(raw.get("wa_id") or "").strip()
        jid = str(raw.get("jid") or "").strip()
        if not jid:
            omitidos += 1
            continue
        tipo = str(raw.get("type") or "").strip()
        if tipo in ("revoked", "e2e_notification", "notification_template", "call_log"):
            if wa_id:
                marcar_eliminado_por_wa_id(wa_id)
            omitidos += 1
            continue
        from_me = bool(raw.get("from_me"))
        direccion = "salida" if from_me else "entrada"
        enviado = str(raw.get("enviado_por") or ("humano" if from_me else "cliente"))
        texto = str(raw.get("texto") or "")
        if not texto and raw.get("tiene_media"):
            texto = "[adjunto]"
        if not texto and not raw.get("tiene_media"):
            omitidos += 1
            continue
        ts_raw = raw.get("ts")
        try:
            ts_val = float(ts_raw) if ts_raw is not None else time.time()
        except (TypeError, ValueError):
            ts_val = time.time()
        antes = 0
        if wa_id:
            try:
                with _lock, _conn() as c:
                    row = c.execute(
                        "SELECT id FROM mensajes WHERE wa_id=?", (wa_id,)
                    ).fetchone()
                    antes = 1 if row else 0
            except Exception:
                pass
        guardar(
            jid,
            direccion,
            texto=texto,
            tiene_media=bool(raw.get("tiene_media")),
            nombre_arch=str(raw.get("nombre_arch") or ""),
            enviado_por=enviado,
            wa_id=wa_id or None,
            ts=ts_val,
        )
        if antes:
            actualizados += 1
        else:
            insertados += 1
    return {
        "insertados": insertados,
        "actualizados": actualizados,
        "omitidos": omitidos,
        "total": len(mensajes or []),
    }


def marcar_leido(jid: str) -> None:
    try:
        from app.services.wa_jid import jids_relacionados

        jids = list(jids_relacionados(jid))
        if not jids:
            return
        placeholders = ",".join("?" * len(jids))
        with _lock, _conn() as c:
            c.execute(
                f"UPDATE mensajes SET leido=1 WHERE jid IN ({placeholders}) "
                "AND leido=0 AND direccion='entrada'",
                jids,
            )
    except Exception as e:
        print(f"[wa_chats] error marcar_leido: {e}")


def listar_conversaciones(limit: int = 60) -> list[dict]:
    """Una fila por contacto (agrupa @lid y @c.us del mismo cliente)."""
    try:
        from app.services.wa_jid import jid_canonico

        fetch_n = max(limit * 4, 80)
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
                    WHERE eliminado=0
                    GROUP BY jid
                ) latest ON m.id = latest.max_id
                LEFT JOIN (
                    SELECT jid, COUNT(*) AS no_leidos
                    FROM mensajes
                    WHERE leido=0 AND direccion='entrada' AND eliminado=0
                    GROUP BY jid
                ) u ON m.jid = u.jid
                WHERE m.eliminado=0
                ORDER BY m.ts DESC
                LIMIT ?
                """,
                (fetch_n,),
            ).fetchall()
        merged: dict[str, dict] = {}
        for r in rows:
            row = dict(r)
            canon = jid_canonico(row.get("jid", ""))
            prev = merged.get(canon)
            if not prev:
                row["jid"] = canon
                merged[canon] = row
                continue
            no_leidos = int(prev.get("no_leidos") or 0) + int(row.get("no_leidos") or 0)
            if float(row.get("ts") or 0) >= float(prev.get("ts") or 0):
                row["jid"] = canon
                row["no_leidos"] = no_leidos
                merged[canon] = row
            else:
                prev["no_leidos"] = no_leidos
                merged[canon] = prev
        out = sorted(merged.values(), key=lambda x: float(x.get("ts") or 0), reverse=True)
        return out[:limit]
    except Exception as e:
        print(f"[wa_chats] error listar_conversaciones: {e}")
        return []


def listar_mensajes(jid: str, limit: int = 120) -> list[dict]:
    """Mensajes de una conversación (@lid + @c.us unificados), de más antiguo a más nuevo."""
    try:
        from app.services.wa_jid import jids_relacionados

        jids = list(jids_relacionados(jid))
        if not jids:
            return []
        placeholders = ",".join("?" * len(jids))
        with _lock, _conn() as c:
            rows = c.execute(
                f"""SELECT id, ts, jid, direccion, texto, tiene_media,
                          nombre_arch, enviado_por, leido
                   FROM mensajes
                   WHERE jid IN ({placeholders}) AND eliminado=0
                   ORDER BY ts DESC LIMIT ?""",
                (*jids, limit),
            ).fetchall()
            return list(reversed([dict(r) for r in rows]))
    except Exception as e:
        print(f"[wa_chats] error listar_mensajes: {e}")
        return []


def total_no_leidos() -> int:
    try:
        with _lock, _conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM mensajes "
                "WHERE leido=0 AND direccion='entrada' AND eliminado=0"
            ).fetchone()
            return int(row["n"]) if row else 0
    except Exception:
        return 0


def marcar_eliminados(wa_ids: list[str]) -> int:
    n = 0
    for wid in wa_ids or []:
        n += marcar_eliminado_por_wa_id(str(wid).strip())
    return n
