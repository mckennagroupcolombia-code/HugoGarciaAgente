"""
Tiempo de sesión y eventos de tareas en el panel React (/app).

- Sesión: UUID del cliente + heartbeats mientras la pestaña está activa.
- Eventos: cambio de panel, tickets resueltos, preventa, pasos, etc.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta

from app.services.tickets_db import DB_PATH, _conn

PING_IDLE_MINUTES = 15
ONLINE_IDLE_MINUTES = 3
TASK_EVENT_TYPES = frozenset({
    "ticket_resuelto",
    "paso_completado",
    "preventa_respondida",
    "solicitud_resuelta",
    "sync_ejecutado",
    "webchat_revisado",
})


def _migrate_panel_presencia():
    with _conn() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS panel_sesiones_operativas (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                session_uuid        TEXT NOT NULL UNIQUE,
                usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
                inicio              TEXT NOT NULL DEFAULT (datetime('now')),
                ultimo_ping         TEXT NOT NULL DEFAULT (datetime('now')),
                fin                 TEXT,
                duracion_segundos   INTEGER DEFAULT 0,
                panel_actual        TEXT,
                user_agent          TEXT,
                activa              INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS panel_eventos_operativos (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                session_uuid TEXT,
                usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
                tipo         TEXT NOT NULL,
                panel        TEXT,
                detalle      TEXT,
                creado_en    TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_panel_ses_usuario_inicio
                ON panel_sesiones_operativas(usuario_id, inicio);
            CREATE INDEX IF NOT EXISTS idx_panel_evt_usuario_creado
                ON panel_eventos_operativos(usuario_id, creado_en);
        """)
        db.commit()


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%f"):
        try:
            return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00").replace("T", " ")[:19])
    except ValueError:
        return None


def _segundos_entre(inicio: str, fin: str) -> int:
    a, b = _parse_dt(inicio), _parse_dt(fin)
    if not a or not b:
        return 0
    return max(0, int((b - a).total_seconds()))


def _cerrar_fila(db, row: sqlite3.Row, fin: str | None = None) -> None:
    fin = fin or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    dur = _segundos_entre(row["inicio"], fin)
    db.execute(
        """UPDATE panel_sesiones_operativas
           SET fin=?, duracion_segundos=?, activa=0, ultimo_ping=?
           WHERE id=?""",
        (fin, dur, fin, row["id"]),
    )


def _sesion_idle(row: sqlite3.Row, *, minutos: int = PING_IDLE_MINUTES) -> bool:
    ult = _parse_dt(row["ultimo_ping"])
    if not ult:
        return True
    return datetime.now() - ult > timedelta(minutes=minutos)


def _usuario_en_linea(row: sqlite3.Row | None) -> bool:
    return bool(row and row["activa"] and not _sesion_idle(row, minutos=ONLINE_IDLE_MINUTES))


def usuarios_en_linea_ahora() -> set[int]:
    """IDs de usuarios con sesión activa de panel en los últimos ONLINE_IDLE_MINUTES.

    Query liviana (sin agregaciones de día) pensada para pollear cada pocos
    segundos desde una vista de chat, a diferencia de `metricas_panel_operadores`.
    """
    corte = (datetime.now() - timedelta(minutes=ONLINE_IDLE_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as db:
        rows = db.execute(
            "SELECT DISTINCT usuario_id FROM panel_sesiones_operativas WHERE activa=1 AND ultimo_ping >= ?",
            (corte,),
        ).fetchall()
        return {r["usuario_id"] for r in rows}


def iniciar_sesion_panel(
    usuario_id: int,
    session_uuid: str,
    *,
    user_agent: str | None = None,
    panel: str | None = None,
) -> dict:
    session_uuid = (session_uuid or "").strip()
    if not session_uuid or len(session_uuid) > 64:
        return {"ok": False, "error": "session_uuid inválido"}

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM panel_sesiones_operativas WHERE session_uuid=?",
            (session_uuid,),
        ).fetchone()
        if row:
            if row["usuario_id"] != usuario_id:
                return {"ok": False, "error": "sesión pertenece a otro usuario"}
            if row["activa"] and not _sesion_idle(row):
                db.execute(
                    """UPDATE panel_sesiones_operativas
                       SET ultimo_ping=?, panel_actual=COALESCE(?, panel_actual)
                       WHERE id=?""",
                    (now, panel, row["id"]),
                )
                db.commit()
                return {"ok": True, "session_uuid": session_uuid, "reanudada": True}
            if row["activa"]:
                _cerrar_fila(db, row, now)
            db.execute(
                """UPDATE panel_sesiones_operativas
                   SET inicio=?, ultimo_ping=?, fin=NULL, duracion_segundos=0,
                       panel_actual=?, user_agent=?, activa=1
                   WHERE id=?""",
                (now, now, panel, (user_agent or "")[:500], row["id"]),
            )
            db.commit()
            return {"ok": True, "session_uuid": session_uuid, "reanudada": False}

        db.execute(
            """INSERT INTO panel_sesiones_operativas
               (session_uuid, usuario_id, inicio, ultimo_ping, panel_actual, user_agent, activa)
               VALUES (?,?,?,?,?,?,1)""",
            (session_uuid, usuario_id, now, now, panel, (user_agent or "")[:500]),
        )
        db.commit()
        return {"ok": True, "session_uuid": session_uuid, "reanudada": False}


def ping_sesion_panel(
    usuario_id: int,
    session_uuid: str,
    *,
    panel: str | None = None,
) -> dict:
    session_uuid = (session_uuid or "").strip()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM panel_sesiones_operativas WHERE session_uuid=?",
            (session_uuid,),
        ).fetchone()
        if not row or row["usuario_id"] != usuario_id:
            return {"ok": False, "error": "sesión no encontrada"}
        if not row["activa"] or _sesion_idle(row):
            return {"ok": False, "error": "sesión expirada", "reiniciar": True}
        db.execute(
            """UPDATE panel_sesiones_operativas
               SET ultimo_ping=?, panel_actual=COALESCE(?, panel_actual)
               WHERE id=?""",
            (now, panel, row["id"]),
        )
        db.commit()
        return {"ok": True, "session_uuid": session_uuid}


def cerrar_sesion_panel(usuario_id: int, session_uuid: str) -> dict:
    session_uuid = (session_uuid or "").strip()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM panel_sesiones_operativas WHERE session_uuid=? AND usuario_id=?",
            (session_uuid, usuario_id),
        ).fetchone()
        if not row:
            return {"ok": True}
        if row["activa"]:
            _cerrar_fila(db, row, now)
        db.commit()
        return {"ok": True}


def registrar_evento_panel(
    usuario_id: int,
    tipo: str,
    *,
    panel: str | None = None,
    detalle: str | dict | None = None,
    session_uuid: str | None = None,
) -> None:
    tipo = (tipo or "").strip()[:64]
    if not tipo:
        return
    if isinstance(detalle, dict):
        detalle = json.dumps(detalle, ensure_ascii=False)[:2000]
    elif detalle:
        detalle = str(detalle)[:2000]
    session_uuid = (session_uuid or "").strip()[:64] or None
    panel = (panel or "")[:64] or None

    with _conn() as db:
        db.execute(
            """INSERT INTO panel_eventos_operativos
               (session_uuid, usuario_id, tipo, panel, detalle)
               VALUES (?,?,?,?,?)""",
            (session_uuid, usuario_id, tipo, panel, detalle),
        )
        db.commit()


def log_panel_tarea(
    usuario: dict | None,
    tipo: str,
    *,
    panel: str | None = None,
    detalle: str | dict | None = None,
    session_uuid: str | None = None,
) -> None:
    """Registra tarea resuelta si hay usuario de tickets (no token admin genérico)."""
    if not usuario or not usuario.get("id"):
        return
    try:
        registrar_evento_panel(
            int(usuario["id"]),
            tipo,
            panel=panel,
            detalle=detalle,
            session_uuid=session_uuid,
        )
    except Exception:
        pass


def metricas_panel_operadores(fecha: str | None = None) -> dict:
    """Resumen por usuario para una fecha (YYYY-MM-DD), hora local del servidor."""
    fecha = (fecha or datetime.now().strftime("%Y-%m-%d"))[:10]
    inicio_dia = f"{fecha} 00:00:00"
    fin_dia = f"{fecha} 23:59:59"

    with _conn() as db:
        usuarios = db.execute(
            """SELECT u.id, u.nombre, u.username, r.nombre as rol_nombre
               FROM usuarios u
               LEFT JOIN roles r ON r.id = u.rol_id
               WHERE u.activo=1
               ORDER BY u.nombre"""
        ).fetchall()

        result = []
        for u in usuarios:
            uid = u["id"]
            sesiones = db.execute(
                """SELECT inicio, ultimo_ping, fin, duracion_segundos, activa
                   FROM panel_sesiones_operativas
                   WHERE usuario_id=?
                     AND inicio <= ?
                     AND COALESCE(fin, ultimo_ping) >= ?""",
                (uid, fin_dia, inicio_dia),
            ).fetchall()

            seg_total = 0
            for s in sesiones:
                fin_eff = s["fin"] or s["ultimo_ping"]
                seg = s["duracion_segundos"] or 0
                if s["activa"] and not s["fin"]:
                    seg = _segundos_entre(s["inicio"], s["ultimo_ping"])
                elif not seg:
                    seg = _segundos_entre(s["inicio"], fin_eff)
                seg_total += seg

            evt_rows = db.execute(
                """SELECT tipo, COUNT(*) as n
                   FROM panel_eventos_operativos
                   WHERE usuario_id=?
                     AND creado_en >= ? AND creado_en <= ?
                   GROUP BY tipo""",
                (uid, inicio_dia, fin_dia),
            ).fetchall()
            por_tipo = {r["tipo"]: r["n"] for r in evt_rows}
            tareas = sum(
                n for t, n in por_tipo.items() if t in TASK_EVENT_TYPES
            )

            panel_views = db.execute(
                """SELECT panel, COUNT(*) as n
                   FROM panel_eventos_operativos
                   WHERE usuario_id=?
                     AND tipo='panel_view'
                     AND creado_en >= ? AND creado_en <= ?
                   GROUP BY panel
                   ORDER BY n DESC
                   LIMIT 8""",
                (uid, inicio_dia, fin_dia),
            ).fetchall()

            sesion_activa = db.execute(
                """SELECT session_uuid, panel_actual, ultimo_ping, activa
                   FROM panel_sesiones_operativas
                   WHERE usuario_id=? AND activa=1
                   ORDER BY ultimo_ping DESC LIMIT 1""",
                (uid,),
            ).fetchone()
            en_linea = _usuario_en_linea(sesion_activa)

            result.append({
                "usuario_id": uid,
                "nombre": u["nombre"],
                "username": u["username"],
                "rol": u["rol_nombre"],
                "minutos_sesion": round(seg_total / 60, 1),
                "tareas_completadas": tareas,
                "eventos_por_tipo": por_tipo,
                "paneles_mas_usados": [
                    {"panel": r["panel"], "visitas": r["n"]}
                    for r in panel_views if r["panel"]
                ],
                "en_linea": en_linea,
                "panel_actual": sesion_activa["panel_actual"] if en_linea else None,
            })

        result.sort(
            key=lambda x: (x["en_linea"], x["tareas_completadas"], x["minutos_sesion"]),
            reverse=True,
        )
        return {"fecha": fecha, "operadores": result}


def get_db_path() -> str:
    return DB_PATH
