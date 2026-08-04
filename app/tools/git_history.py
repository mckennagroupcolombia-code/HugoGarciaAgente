"""
Historial de commits de git para el panel "Control de Versiones" (/app).

Expone `obtener_historial_git()`: corre `git log` en modo lectura (sin escribir
nada al repo) y devuelve una lista de commits con hash, padres, autor, fecha,
asunto y refs (ramas/tags), pensada para que el frontend arme el grafo tipo
cladograma. Sigue el mismo patron de subprocess que `app/tools/backup_drive.py`
(`git -C <repo> ...`, timeout, sin bind previo).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Separadores de control (no aparecen en mensajes de commit normales) para
# poder partir cada linea en campos sin que un "|" o "," dentro del asunto
# rompa el parseo.
_FS = "\x1f"  # field separator
_RS = "\x1e"  # record separator

_FORMAT = _FS.join(["%H", "%P", "%an", "%ae", "%ad", "%s", "%D"]) + _RS


def _run_git(args: list, timeout: int = 20) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(_REPO_ROOT)] + args,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _rama_actual() -> str:
    try:
        r = _run_git(["rev-parse", "--abbrev-ref", "HEAD"])
        return (r.stdout or "").strip() or "HEAD"
    except Exception:
        return "HEAD"


def obtener_historial_git(limite: int = 150) -> dict:
    """Devuelve {rama_actual, commits: [...]} o {error}. No falla si no hay .git."""
    if not (_REPO_ROOT / ".git").exists():
        return {"error": "sin repositorio .git"}

    limite = max(1, min(int(limite or 150), 500))
    try:
        r = _run_git(
            [
                "log",
                "--all",
                "--topo-order",
                f"-n{limite}",
                f"--pretty=format:{_FORMAT}",
                "--date=iso-strict",
            ],
            timeout=25,
        )
    except subprocess.TimeoutExpired:
        return {"error": "git log timeout"}

    if r.returncode != 0:
        return {"error": (r.stderr or r.stdout or "git log fallo")[:400]}

    commits = []
    for record in r.stdout.split(_RS):
        record = record.strip("\n")
        if not record.strip():
            continue
        campos = record.split(_FS)
        if len(campos) < 7:
            continue
        h, padres, autor, email, fecha, asunto, refs = campos[:7]
        commits.append(
            {
                "hash": h,
                "hash_corto": h[:7],
                "parents": [p for p in padres.split(" ") if p],
                "autor": autor,
                "email": email,
                "fecha": fecha,
                "asunto": asunto,
                "refs": [x.strip() for x in refs.split(",") if x.strip()],
            }
        )

    return {"rama_actual": _rama_actual(), "commits": commits}
