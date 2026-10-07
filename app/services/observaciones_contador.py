"""Observaciones del contador sobre el expediente: «revisado», nota, pregunta o ajuste.

El contador (perfil `contador`) no edita cifras: marca lo que revisó y deja preguntas
o ajustes sobre una cuenta, un asiento, una fila del cruce con la DIAN o un documento.
Lo que escribe sale para el equipo en «Revisión del libro → Para ajustar hoy», y el
equipo lo resuelve con una respuesta. Nada de esto toca el Libro Mayor. Sin LLM.

objeto_tipo · objeto_id:  mes · '2026-09'  |  cuenta · '2365'  |  asiento · '6132'
                          cruce · 'FE797'  |  documento · 'comprobante:6132'
estado: revisado (sin texto; uno por objeto, el último manda) · nota · pregunta · ajuste
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

OBJETOS = ("mes", "cuenta", "asiento", "cruce", "documento")
ESTADOS = ("revisado", "nota", "pregunta", "ajuste")
ABIERTAS = ("pregunta", "ajuste")


def _conn() -> sqlite3.Connection:
    from app.services.contabilidad_core import _DB_PATH

    con = sqlite3.connect(_DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS cc_observaciones_contador (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            periodo TEXT NOT NULL,
            objeto_tipo TEXT NOT NULL CHECK (objeto_tipo IN ('mes','cuenta','asiento','cruce','documento')),
            objeto_id TEXT NOT NULL,
            estado TEXT NOT NULL CHECK (estado IN ('revisado','nota','pregunta','ajuste')),
            texto TEXT NOT NULL DEFAULT '',
            por TEXT NOT NULL DEFAULT '',
            por_usuario_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            resuelto_en TEXT,
            resuelto_por TEXT,
            respuesta TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_obs_objeto ON cc_observaciones_contador (periodo, objeto_tipo, objeto_id);
        """
    )
    return con


def _fila(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["abierta"] = d["estado"] in ABIERTAS and not d.get("resuelto_en")
    return d


def crear(periodo: str, objeto_tipo: str, objeto_id: str, estado: str, texto: str = "", *,
          por: str, por_usuario_id: int | None = None) -> dict[str, Any]:
    if objeto_tipo not in OBJETOS:
        raise ValueError("Objeto inválido")
    if estado not in ESTADOS:
        raise ValueError("Estado inválido")
    texto = (texto or "").strip()
    if estado in ABIERTAS and not texto:
        raise ValueError("Una pregunta o un ajuste necesita texto: sin él nadie sabe qué atender.")
    if not (por or "").strip():
        raise ValueError("Falta quién observa")
    objeto_id = str(objeto_id or "").strip()
    if not objeto_id or not periodo:
        raise ValueError("Falta el objeto o el período")
    with _conn() as con:
        if estado == "revisado":
            # Un «revisado» nuevo reemplaza al anterior del mismo objeto: es un estado, no un hilo.
            con.execute("DELETE FROM cc_observaciones_contador WHERE periodo=? AND objeto_tipo=? AND objeto_id=? AND estado='revisado'",
                        (periodo, objeto_tipo, objeto_id))
        cur = con.execute(
            "INSERT INTO cc_observaciones_contador (periodo, objeto_tipo, objeto_id, estado, texto, por, por_usuario_id) "
            "VALUES (?,?,?,?,?,?,?)", (periodo, objeto_tipo, objeto_id, estado, texto, por.strip(), por_usuario_id),
        )
        con.commit()
        r = con.execute("SELECT * FROM cc_observaciones_contador WHERE id=?", (cur.lastrowid,)).fetchone()
    _invalidar()
    return _fila(r)


def quitar_revisado(periodo: str, objeto_tipo: str, objeto_id: str) -> bool:
    with _conn() as con:
        n = con.execute("DELETE FROM cc_observaciones_contador WHERE periodo=? AND objeto_tipo=? AND objeto_id=? AND estado='revisado'",
                        (periodo, objeto_tipo, str(objeto_id))).rowcount
        con.commit()
    _invalidar()
    return n > 0


def listar(*, periodo: str | None = None, objeto_tipo: str | None = None, objeto_id: str | None = None,
           abiertas: bool | None = None) -> list[dict[str, Any]]:
    where, params = [], []
    if periodo:
        where.append("periodo=?"); params.append(periodo)
    if objeto_tipo:
        where.append("objeto_tipo=?"); params.append(objeto_tipo)
    if objeto_id is not None:
        where.append("objeto_id=?"); params.append(str(objeto_id))
    if abiertas is True:
        where.append("estado IN ('pregunta','ajuste') AND resuelto_en IS NULL")
    elif abiertas is False:
        where.append("NOT (estado IN ('pregunta','ajuste') AND resuelto_en IS NULL)")
    sql = "SELECT * FROM cc_observaciones_contador" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY created_at, id"
    with _conn() as con:
        return [_fila(r) for r in con.execute(sql, params)]


def resolver(obs_id: int, *, respuesta: str, por: str) -> dict[str, Any]:
    with _conn() as con:
        r = con.execute("SELECT * FROM cc_observaciones_contador WHERE id=?", (int(obs_id),)).fetchone()
        if not r:
            raise ValueError("Observación no encontrada")
        con.execute("UPDATE cc_observaciones_contador SET resuelto_en=?, resuelto_por=?, respuesta=? WHERE id=?",
                    (datetime.now().isoformat(timespec="seconds"), (por or "").strip(), (respuesta or "").strip(), int(obs_id)))
        con.commit()
        r = con.execute("SELECT * FROM cc_observaciones_contador WHERE id=?", (int(obs_id),)).fetchone()
    _invalidar()
    return _fila(r)


def resumen(periodo: str) -> dict[str, Any]:
    """Conteos del mes y, por objeto, si está revisado y cuántas abiertas tiene."""
    por_objeto: dict[str, dict[str, Any]] = {}
    total = abiertas = revisados = 0
    with _conn() as con:
        for r in con.execute("SELECT * FROM cc_observaciones_contador WHERE periodo=?", (periodo,)):
            total += 1
            k = f"{r['objeto_tipo']}:{r['objeto_id']}"
            o = por_objeto.setdefault(k, {"revisado": False, "revisado_por": None, "abiertas": 0, "notas": 0})
            if r["estado"] == "revisado":
                revisados += 1
                o["revisado"], o["revisado_por"] = True, r["por"]
            elif r["estado"] in ABIERTAS and not r["resuelto_en"]:
                abiertas += 1
                o["abiertas"] += 1
            else:
                o["notas"] += 1
    return {"total": total, "abiertas": abiertas, "revisados": revisados, "por_objeto": por_objeto}


def para_revision_libro() -> list[dict[str, Any]]:
    """Preguntas y ajustes abiertos, para «Revisión del libro → Para ajustar hoy»."""
    return listar(abiertas=True)


def _invalidar() -> None:
    try:
        from app.services import expediente_contable

        expediente_contable._cache.clear()
    except Exception:  # noqa: BLE001
        pass
