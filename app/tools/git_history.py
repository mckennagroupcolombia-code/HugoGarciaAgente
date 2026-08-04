"""
Historial de commits de git para el panel "Control de Versiones" (/app).

Expone `obtener_historial_git()`: corre `git log` en modo lectura (sin escribir
nada al repo) y devuelve una lista de commits con hash, padres, autor, fecha,
asunto y refs (ramas/tags), pensada para que el frontend arme el grafo tipo
cladograma. Sigue el mismo patron de subprocess que `app/tools/backup_drive.py`
(`git -C <repo> ...`, timeout, sin bind previo).
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Overrides manuales de autor por commit: la cuenta git es compartida
# ("McKenna Group Colombia") y los commits viejos no llevan --author real,
# asi que el panel permite marcar a mano "quien hizo este commit" (Cynthia /
# Armando Garcia / otro) sin reescribir el historial de git.
_AUTOR_OVERRIDES_PATH = _REPO_ROOT / "app" / "data" / "control_versiones_autores_commits.json"

# Lista corta de desarrolladores conocidos del proyecto (cuenta compartida).
# El frontend la usa para armar el selector rapido; el backend acepta
# cualquier texto no vacio, esto es solo una sugerencia de UX.
DESARROLLADORES_CONOCIDOS = ["Cynthia", "Armando García"]


def _leer_overrides_commits() -> dict:
    try:
        return json.loads(_AUTOR_OVERRIDES_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def asignar_autor_commit(hash_commit: str, autor: str) -> dict:
    """
    Guarda (o borra, si autor es vacio) la asignacion manual de autor para un
    commit puntual. No modifica git: es metadata aparte para el panel.
    """
    hash_commit = (hash_commit or "").strip()
    autor = (autor or "").strip()
    if not hash_commit:
        return {"ok": False, "error": "hash requerido"}

    overrides = _leer_overrides_commits()
    if autor:
        overrides[hash_commit] = autor[:120]
    else:
        overrides.pop(hash_commit, None)

    try:
        _AUTOR_OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
        _AUTOR_OVERRIDES_PATH.write_text(
            json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {"ok": True, "hash": hash_commit, "autor_manual": autor or None}

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


def _proxima_hora(hora: int, minuto: int = 0) -> str:
    """Próxima ocurrencia de HH:MM en hora local, en ISO."""
    ahora = datetime.now()
    objetivo = ahora.replace(hour=hora, minute=minuto, second=0, microsecond=0)
    if objetivo <= ahora:
        objetivo += timedelta(days=1)
    return objetivo.isoformat()


def estado_auto_commit() -> dict:
    """
    Estado de los auto-commits programados del repo, para los indicadores del
    panel Control de Versiones:
      - 23:00 cron `auto_commit.sh` (commit + push diario)
      - 02:00 backup nocturno `backup_drive.py` (commit + push tras el backup)
    Incluye cuántos archivos cambiados esperan al próximo auto-commit.
    """
    pendientes = 0
    try:
        st = _run_git(["status", "--porcelain"])
        if st.returncode == 0:
            pendientes = len([l for l in st.stdout.splitlines() if l.strip()])
    except Exception:
        pass
    return {
        "archivos_pendientes": pendientes,
        "proximo_diario": _proxima_hora(23, 0),
        "proximo_backup": _proxima_hora(2, 0),
        "ahora": datetime.now().isoformat(),
    }


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

    overrides = _leer_overrides_commits()
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
                "autor_manual": overrides.get(h),
            }
        )

    return {
        "rama_actual": _rama_actual(),
        "commits": commits,
        "auto_commit": estado_auto_commit(),
        "desarrolladores_conocidos": DESARROLLADORES_CONOCIDOS,
    }
