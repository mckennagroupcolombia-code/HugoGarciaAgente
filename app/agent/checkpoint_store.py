"""
Checkpoint store para AgentRun.

Persiste el estado completo de un run (messages + metadata) en SQLite
para permitir rollback exacto ante fallos catastróficos entre iteraciones.
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data",
    "agent_checkpoints.sqlite3",
)


@dataclass
class AgentCheckpoint:
    run_id: str
    iteration: int
    messages: list[dict]
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


def _ensure_db() -> None:
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS checkpoints (
                run_id      TEXT NOT NULL,
                iteration   INTEGER NOT NULL,
                messages    TEXT NOT NULL,
                metadata    TEXT NOT NULL DEFAULT '{}',
                created_at  TEXT NOT NULL,
                PRIMARY KEY (run_id, iteration)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cp_run ON checkpoints(run_id, iteration DESC)"
        )


def save(checkpoint: AgentCheckpoint) -> None:
    _ensure_db()
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO checkpoints
                (run_id, iteration, messages, metadata, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                checkpoint.run_id,
                checkpoint.iteration,
                json.dumps(checkpoint.messages, ensure_ascii=False),
                json.dumps(checkpoint.metadata, ensure_ascii=False, default=str),
                checkpoint.created_at,
            ),
        )


def load_latest(run_id: str) -> AgentCheckpoint | None:
    _ensure_db()
    with sqlite3.connect(_DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT iteration, messages, metadata, created_at
            FROM checkpoints
            WHERE run_id = ?
            ORDER BY iteration DESC
            LIMIT 1
            """,
            (run_id,),
        ).fetchone()
    if not row:
        return None
    iteration, messages_json, metadata_json, created_at = row
    try:
        messages = json.loads(messages_json)
        metadata = json.loads(metadata_json)
    except Exception:
        return None
    return AgentCheckpoint(
        run_id=run_id,
        iteration=iteration,
        messages=messages,
        metadata=metadata,
        created_at=created_at,
    )


def delete_run(run_id: str) -> None:
    """Limpia todos los checkpoints de un run completado."""
    _ensure_db()
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute("DELETE FROM checkpoints WHERE run_id = ?", (run_id,))


def purge_old(max_age_hours: int = 24) -> int:
    """Elimina checkpoints más antiguos de max_age_hours. Retorna filas eliminadas."""
    _ensure_db()
    cutoff = datetime.utcnow()
    # ISO compare funciona porque el formato es fijo
    cutoff_str = cutoff.isoformat()[:13]  # "YYYY-MM-DDTHH"
    with sqlite3.connect(_DB_PATH) as conn:
        cur = conn.execute(
            "DELETE FROM checkpoints WHERE substr(created_at, 1, 13) < ?",
            (cutoff_str,),
        )
        return cur.rowcount
