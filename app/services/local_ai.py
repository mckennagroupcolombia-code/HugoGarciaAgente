import json
import os
import shlex
import subprocess


_OLLAMA_MODEL = os.getenv("LOCAL_AI_MODEL", "gemma4:26b").strip() or "gemma4:26b"
_OLLAMA_BIN = os.getenv("OLLAMA_BIN", "ollama").strip() or "ollama"


def estado_local_ai() -> dict:
    """
    Estado del modelo local (Ollama/Gemma) sin romper flujo si no está instalado.
    """
    try:
        proc = subprocess.run(
            [_OLLAMA_BIN, "list"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        txt = (proc.stdout or "") + "\n" + (proc.stderr or "")
        disponible = proc.returncode == 0 and _OLLAMA_MODEL in txt
        return {
            "motor": "ollama",
            "modelo": _OLLAMA_MODEL,
            "disponible": disponible,
            "returncode": proc.returncode,
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
        cmd = [_OLLAMA_BIN, "run", _OLLAMA_MODEL, prompt[:8000]]
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
    cmd_tpl = os.getenv("OPENHANDS_CMD", "").strip()
    if not cmd_tpl:
        return {
            "ok": False,
            "error": "OPENHANDS_CMD no configurado",
            "patch": "",
            "checks": [],
            "riesgo": "desconocido",
            "rollback": "manual",
        }
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
