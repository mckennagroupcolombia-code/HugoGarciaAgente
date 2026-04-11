"""
Auditoría estática de scripts: py_compile sin ejecutar __main__.
Lista base en app/data/scripts_manifest.json; se pueden añadir rutas vía herramienta.
"""

from __future__ import annotations

import json
import py_compile
from pathlib import Path

_MANIFEST = Path(__file__).resolve().parents[1] / "data" / "scripts_manifest.json"


def ejecutar_auditoria_dict(rutas_extra: str = "") -> dict:
    """
    Misma lógica que auditar_scripts pero devuelve dict (cron, tests, agente).
    Claves: resumen + detalle, o solo error si el manifiesto falla.
    """
    root = Path(__file__).resolve().parents[2]
    paths: list[str] = []

    if _MANIFEST.is_file():
        try:
            manifest = json.loads(_MANIFEST.read_text(encoding="utf-8"))
            for item in manifest.get("scripts", []):
                p = (item.get("path") or item.get("ruta") or "").strip()
                if p:
                    paths.append(p)
        except Exception as e:
            return {"error": f"manifest inválido: {e}"}

    for part in (rutas_extra or "").split(","):
        part = part.strip()
        if part:
            paths.append(part)

    seen: set[str] = set()
    uniq: list[str] = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            uniq.append(p)

    detalle: list[dict] = []
    for rel in uniq:
        full = (root / rel).resolve()
        try:
            full.relative_to(root)
        except ValueError:
            detalle.append({"path": rel, "ok": False, "error": "fuera del repo"})
            continue
        if full.suffix != ".py":
            detalle.append({"path": rel, "ok": False, "error": "no es .py"})
            continue
        if not full.is_file():
            detalle.append({"path": rel, "ok": False, "error": "archivo no existe"})
            continue
        try:
            py_compile.compile(str(full), doraise=True)
            detalle.append({"path": rel, "ok": True})
        except py_compile.PyCompileError as e:
            detalle.append({"path": rel, "ok": False, "error": str(e)})

    ok_n = sum(1 for r in detalle if r.get("ok"))
    return {
        "resumen": f"{ok_n}/{len(detalle)} compilación OK",
        "detalle": detalle,
    }


def auditar_scripts(rutas_extra: str = "") -> str:
    """
    Compila cada .py listado (manifiesto + rutas_extra separadas por coma).
    No corre el programa; solo detecta errores de sintaxis y rutas inválidas.
    """
    return json.dumps(
        ejecutar_auditoria_dict(rutas_extra),
        ensure_ascii=False,
        indent=2,
    )
