"""
Memoria Episódica — registro cronológico JSONL de iteraciones de AgentRun.

Registra qué tool se intentó, con qué args, qué devolvió y si falló.
Al iniciar un nuevo intento del mismo run_id se re-inyectan las herramientas
fallidas como contexto para que el LLM no repita el mismo error.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any

_EPISODIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "episodic"
)


@dataclass
class ToolAttempt:
    run_id: str
    iteration: int
    tool_name: str
    tool_input: dict[str, Any]
    result: str
    error: str | None = None
    ts: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    @property
    def failed(self) -> bool:
        return self.error is not None or self.result.startswith("[TOOL_ERROR]")


def _path(run_id: str) -> str:
    os.makedirs(_EPISODIC_DIR, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in run_id)
    return os.path.join(_EPISODIC_DIR, f"{safe}.jsonl")


def record(attempt: ToolAttempt) -> None:
    with open(_path(attempt.run_id), "a", encoding="utf-8") as f:
        f.write(json.dumps(asdict(attempt), ensure_ascii=False) + "\n")


def get_failed_tools(run_id: str) -> list[ToolAttempt]:
    """Devuelve todos los intentos fallidos de un run para re-inyectar como contexto."""
    path = _path(run_id)
    if not os.path.exists(path):
        return []
    attempts: list[ToolAttempt] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                a = ToolAttempt(**d)
                if a.failed:
                    attempts.append(a)
            except Exception:
                continue
    return attempts


def format_failed_context(run_id: str) -> str:
    """
    Formatea los tools fallidos como texto corto para inyectar al system prompt
    del siguiente intento. Máx 1500 chars.
    """
    failed = get_failed_tools(run_id)
    if not failed:
        return ""
    lines = ["[Intentos fallidos en este run — no repetir:]"]
    for a in failed[-5:]:  # últimos 5 fallos
        err = a.error or a.result[:120]
        lines.append(f"- {a.tool_name}({json.dumps(a.tool_input)[:80]}): {err[:120]}")
    return "\n".join(lines)[:1500]


def cleanup(run_id: str) -> None:
    """Elimina el archivo episódico de un run completado."""
    path = _path(run_id)
    if os.path.exists(path):
        os.remove(path)


def purge_old_runs(max_age_hours: int = 48) -> int:
    """Elimina archivos episódicos más antiguos de max_age_hours. Retorna cantidad."""
    import time

    if not os.path.isdir(_EPISODIC_DIR):
        return 0
    cutoff = time.time() - max_age_hours * 3600
    removed = 0
    for fname in os.listdir(_EPISODIC_DIR):
        if not fname.endswith(".jsonl"):
            continue
        fpath = os.path.join(_EPISODIC_DIR, fname)
        if os.path.getmtime(fpath) < cutoff:
            os.remove(fpath)
            removed += 1
    return removed
