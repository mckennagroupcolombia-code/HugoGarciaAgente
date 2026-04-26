#!/usr/bin/env python3
"""
Bridge entre app/services/local_ai.py y ejecución de fixes.

1) Si OPENHANDS_EXEC está definido y no es placeholder → ejecuta ese comando (shell).
2) Si no → remediación integrada McKenna (solo unidades systemd en lista blanca).

Entrada: --payload '<json>' con tarea, contexto, dry_run.

Salida stdout: JSON { ok, patch, checks, riesgo, rollback, ... }
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent

# Unidades permitidas para restart automático (mismo criterio que monitor).
_ALLOWLIST: list[tuple[str, list[str]]] = [
    ("webhook-meli", ["webhook-meli"]),
    ("agente-pro", ["agente-pro"]),
    ("whatsapp-bridge", ["mckenna-whatsapp-bridge"]),
]


def _exec_placeholder(cmd: str) -> bool:
    c = (cmd or "").strip()
    if not c:
        return True
    low = c.lower().replace("_", " ")
    if c.startswith("<") or "tu comando" in low:
        return True
    return False


def _units_from_text(text: str) -> list[str]:
    low = text.lower()
    out: list[str] = []
    for key, units in _ALLOWLIST:
        if key in low:
            for u in units:
                u = u.replace(".service", "")
                if u not in out:
                    out.append(u)
    return out


def _systemctl_restart(unit: str, dry_run: bool) -> tuple[bool, str]:
    if dry_run:
        return True, f"dry_run: omitido systemctl restart {unit}"
    try:
        proc = subprocess.run(
            ["sudo", "systemctl", "restart", unit],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "systemctl falló").strip()
            return False, err[:800]
        return True, f"systemctl restart {unit} OK"
    except Exception as e:
        return False, str(e)[:800]


def remedacion_mckenna_builtin(tarea: str, contexto: str, dry_run: bool) -> dict:
    blob = f"{tarea}\n{contexto}"
    units = _units_from_text(blob)
    if not units:
        return {
            "ok": False,
            "patch": "",
            "checks": [],
            "riesgo": "medio",
            "rollback": "manual",
            "error": "remediación integrada: no reconoció servicio en lista blanca",
            "remediacion": "mckenna_builtin",
            "unidades_detectadas": [],
        }

    acciones: list[str] = []
    ok_all = True
    for u in units:
        ok, msg = _systemctl_restart(u, dry_run)
        acciones.append(msg)
        if not ok:
            ok_all = False

    checks: list[str] = []
    if "webhook-meli" in units:
        checks.append("curl -sS http://localhost:8080/status")
    if "agente-pro" in units:
        checks.append("curl -sS http://localhost:8081/status")
    if any(x in units for x in ("mckenna-whatsapp-bridge",)):
        checks.append("curl -sS http://localhost:3000/monitor/json")

    return {
        "ok": ok_all,
        "patch": "; ".join(acciones),
        "checks": checks,
        "riesgo": "medio" if ok_all else "alto",
        "rollback": "journalctl -u " + units[0] + " -n 80",
        "remediacion": "mckenna_builtin",
        "unidades": units,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True, help="JSON con tarea/contexto")
    args = parser.parse_args()

    try:
        payload = json.loads(args.payload)
    except Exception as e:
        print(
            json.dumps(
                {
                    "ok": False,
                    "patch": "",
                    "checks": [],
                    "riesgo": "alto",
                    "rollback": "manual",
                    "error": f"payload inválido: {e}",
                },
                ensure_ascii=False,
            )
        )
        return 0

    tarea = str(payload.get("tarea", "")).strip()
    contexto = str(payload.get("contexto", "")).strip()
    dry_run = bool(payload.get("dry_run", False))

    cmd = os.getenv("OPENHANDS_EXEC", "").strip()
    if not _exec_placeholder(cmd):
        try:
            proc = subprocess.run(
                cmd,
                shell=True,
                cwd=str(_REPO_ROOT),
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
            if proc.returncode != 0:
                out = {
                    "ok": False,
                    "patch": "",
                    "checks": [],
                    "riesgo": "alto",
                    "rollback": "git checkout manual",
                    "error": (proc.stderr or proc.stdout or "OpenHands failed")[:1000],
                    "remediacion": "openhands_exec",
                }
                print(json.dumps(out, ensure_ascii=False))
                return 0
            stdout = (proc.stdout or "").strip()
            try:
                data = json.loads(stdout)
                print(json.dumps(data, ensure_ascii=False))
            except Exception:
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "patch": "",
                            "checks": [],
                            "riesgo": "desconocido",
                            "rollback": "manual",
                            "raw": stdout[:4000],
                            "dry_run": dry_run,
                            "remediacion": "openhands_exec",
                        },
                        ensure_ascii=False,
                    )
                )
            return 0
        except Exception as e:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "patch": "",
                        "checks": [],
                        "riesgo": "alto",
                        "rollback": "manual",
                        "error": str(e),
                        "remediacion": "openhands_exec",
                    },
                    ensure_ascii=False,
                )
            )
            return 0

    if os.getenv("OPENHANDS_BUILTIN", "1").strip() not in ("0", "false", "no"):
        result = remedacion_mckenna_builtin(tarea, contexto, dry_run)
        print(json.dumps(result, ensure_ascii=False))
        return 0

    print(
        json.dumps(
            {
                "ok": False,
                "patch": "",
                "checks": [],
                "riesgo": "medio",
                "rollback": "no aplica",
                "error": "OPENHANDS_EXEC no configurado y OPENHANDS_BUILTIN=0",
                "preview": {"tarea": tarea[:300], "contexto_chars": len(contexto)},
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
