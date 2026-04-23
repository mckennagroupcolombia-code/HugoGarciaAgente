import json
import os
import shlex
import subprocess


_OLLAMA_MODEL = os.getenv("LOCAL_AI_MODEL", "gemma4:26b").strip() or "gemma4:26b"
_OLLAMA_BIN = os.getenv("OLLAMA_BIN", "ollama").strip() or "ollama"


def _listar_modelos_ollama() -> list[str]:
    try:
        proc = subprocess.run(
            [_OLLAMA_BIN, "list"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode != 0:
            return []
        modelos: list[str] = []
        for line in (proc.stdout or "").splitlines()[1:]:
            parts = line.split()
            if parts:
                modelos.append(parts[0].strip())
        return modelos
    except Exception:
        return []


def _resolver_modelo_ollama() -> str:
    """
    Prioridad: LOCAL_AI_MODEL si existe; si no, primer modelo instalado.
    """
    modelos = _listar_modelos_ollama()
    if _OLLAMA_MODEL in modelos:
        return _OLLAMA_MODEL
    return modelos[0] if modelos else _OLLAMA_MODEL


def estado_local_ai() -> dict:
    """
    Estado del modelo local (Ollama/Gemma) sin romper flujo si no está instalado.
    """
    try:
        modelos = _listar_modelos_ollama()
        modelo_efectivo = _resolver_modelo_ollama()
        disponible = bool(modelos)
        return {
            "motor": "ollama",
            "modelo": _OLLAMA_MODEL,
            "modelo_efectivo": modelo_efectivo,
            "modelos_instalados": modelos[:10],
            "disponible": disponible,
            "returncode": 0 if disponible else 1,
        }
    except Exception as e:
        return {
            "motor": "ollama",
            "modelo": _OLLAMA_MODEL,
            "disponible": False,
            "error": str(e),
        }


def pedir_reflexion_local(prompt: str, max_chars: int = 3000) -> str:
    """
    Llama Gemma local para estrategia corta de corrección/debug.
    """
    try:
        modelo = _resolver_modelo_ollama()
        cmd = [_OLLAMA_BIN, "run", modelo, prompt[:8000]]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "error local ai").strip()
            return f"[LOCAL_AI_ERROR] {err[:max_chars]}"
        out = (proc.stdout or "").strip()
        return out[:max_chars] if out else "[LOCAL_AI_EMPTY]"
    except Exception as e:
        return f"[LOCAL_AI_ERROR] {e}"


def ejecutar_openhands_task(
    tarea: str,
    contexto: str = "",
    dry_run: bool = False,
) -> dict:
    """
    Bridge simple para OpenHands CLI/script local.
    Debe retornar JSON si OPENHANDS_CMD está configurado.
    """
    default_cmd = "python3 scripts/openhands_bridge.py --payload {payload}"
    cmd_tpl = os.getenv("OPENHANDS_CMD", "").strip() or default_cmd
    payload = json.dumps(
        {"tarea": tarea, "contexto": contexto[:12000], "dry_run": bool(dry_run)},
        ensure_ascii=False,
    )
    try:
        cmd = cmd_tpl.replace("{payload}", shlex.quote(payload))
        proc = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        raw = (proc.stdout or "").strip()
        if proc.returncode != 0:
            return {
                "ok": False,
                "error": (proc.stderr or raw or "openhands command failed")[:1000],
                "patch": "",
                "checks": [],
                "riesgo": "alto",
                "rollback": "git checkout manual",
            }
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {"ok": True, "raw": raw}
        if "ok" not in data:
            data["ok"] = True
        return data
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "patch": "",
            "checks": [],
            "riesgo": "alto",
            "rollback": "manual",
        }
