# -*- coding: utf-8 -*-
"""Notificaciones dentro del panel (la campana), para dejar de avisar todo por WhatsApp.

Hoy cada aviso de tickets sale como WhatsApp 1:1 al operador (bridge supervisor,
`tickets_notificaciones.enviar_texto_operador`). Desde el 24-sep-2026 cada aviso se
guarda SIEMPRE aquí, y el WhatsApp solo sale si la preferencia de la persona lo pide
(`usuarios.notif_pref`: 'ambos' por defecto — nada cambia hasta que cada quien elija
«solo en el panel»). Migración gradual, sin tocar los `notificar_*` existentes.

Tabla en tickets.db. Sin LLM.
"""
from __future__ import annotations

import sqlite3
import threading
import time

from app.services import tickets_db

PREFERENCIAS = ("ambos", "inapp", "wa")
_lock = threading.Lock()
_listo: dict[str, bool] = {}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notificaciones_panel (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id    INTEGER NOT NULL,
    tipo          TEXT NOT NULL DEFAULT 'aviso',
    titulo        TEXT NOT NULL,
    cuerpo        TEXT DEFAULT '',
    panel_destino TEXT,
    ref_id        TEXT,
    creada_en     REAL NOT NULL,
    leida_en      REAL
);
CREATE INDEX IF NOT EXISTS ix_notif_usuario ON notificaciones_panel(usuario_id, leida_en, id);
"""


def _conn() -> sqlite3.Connection:
    ruta = tickets_db.DB_PATH
    c = sqlite3.connect(ruta, timeout=15)
    c.row_factory = sqlite3.Row
    if not _listo.get(ruta):
        with _lock:
            if not _listo.get(ruta):
                c.executescript(_SCHEMA)
                tickets_db._safe_migrate(lambda: tickets_db._add_col(c, "usuarios", "notif_pref", "TEXT DEFAULT 'ambos'"))
                c.commit()
                _listo[ruta] = True
    return c


def crear(usuario_id: int, titulo: str, cuerpo: str = "", *, tipo: str = "aviso",
          panel_destino: str | None = "hugo", ref_id: str | None = None) -> int:
    titulo = (titulo or "").strip()[:200] or "Aviso"
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO notificaciones_panel (usuario_id, tipo, titulo, cuerpo, panel_destino, ref_id, creada_en) "
            "VALUES (?,?,?,?,?,?,?)",
            (int(usuario_id), tipo, titulo, (cuerpo or "").strip()[:2000], panel_destino, ref_id, time.time()),
        )
        return int(cur.lastrowid)


def desde_texto(usuario_id: int, texto: str, **kw) -> int:
    """El texto de WhatsApp de siempre → título (primera línea) + cuerpo (el resto)."""
    lineas = [ln for ln in (texto or "").strip().splitlines()]
    titulo = (lineas[0] if lineas else "Aviso").replace("*", "").strip()
    cuerpo = "\n".join(lineas[1:]).replace("*", "").strip()
    return crear(usuario_id, titulo, cuerpo, **kw)


def listar(usuario_id: int, *, solo_no_leidas: bool = False, limite: int = 40) -> list[dict]:
    with _conn() as c:
        filas = c.execute(
            "SELECT * FROM notificaciones_panel WHERE usuario_id=?"
            + (" AND leida_en IS NULL" if solo_no_leidas else "")
            + " ORDER BY id DESC LIMIT ?",
            (int(usuario_id), max(1, min(int(limite), 200))),
        ).fetchall()
    return [dict(f) for f in filas]


def contar_no_leidas(usuario_id: int) -> int:
    with _conn() as c:
        return int(c.execute(
            "SELECT COUNT(*) FROM notificaciones_panel WHERE usuario_id=? AND leida_en IS NULL", (int(usuario_id),)
        ).fetchone()[0])


def marcar_leidas(usuario_id: int, ids: list[int] | None = None) -> int:
    with _conn() as c:
        if ids:
            marks = ",".join("?" * len(ids))
            cur = c.execute(
                f"UPDATE notificaciones_panel SET leida_en=? WHERE usuario_id=? AND leida_en IS NULL AND id IN ({marks})",
                (time.time(), int(usuario_id), *[int(i) for i in ids]),
            )
        else:
            cur = c.execute(
                "UPDATE notificaciones_panel SET leida_en=? WHERE usuario_id=? AND leida_en IS NULL",
                (time.time(), int(usuario_id)),
            )
        return int(cur.rowcount or 0)


def preferencia(usuario_id: int | None) -> str:
    if not usuario_id:
        return "ambos"
    try:
        with _conn() as c:
            r = c.execute("SELECT notif_pref FROM usuarios WHERE id=?", (int(usuario_id),)).fetchone()
        p = (r["notif_pref"] if r else None) or "ambos"
        return p if p in PREFERENCIAS else "ambos"
    except Exception:
        return "ambos"


def fijar_preferencia(usuario_id: int, pref: str) -> str:
    if pref not in PREFERENCIAS:
        raise ValueError(f"Preferencia inválida: {pref}")
    with _conn() as c:
        c.execute("UPDATE usuarios SET notif_pref=? WHERE id=?", (pref, int(usuario_id)))
    return pref
