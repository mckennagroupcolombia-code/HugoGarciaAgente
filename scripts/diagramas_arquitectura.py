# -*- coding: utf-8 -*-
"""Diagramas de arquitectura con Archify: ajustar, validar y entregar.

Las fuentes son `docs/arquitectura/*.{workflow,dataflow,architecture,sequence,lifecycle}.json`
(eso es lo que se versiona y se edita). El HTML se genera acá y lo sirve
`/api/mapa-sistema/diagramas/<nombre>` al panel Inventario → Mapa del sistema.

Uso:
    python3 scripts/diagramas_arquitectura.py validar [nombre]
    python3 scripts/diagramas_arquitectura.py entregar [nombre]     # valida + genera el HTML
    python3 scripts/diagramas_arquitectura.py anchos <nombre>       # fija node.width desde el texto

Requiere la skill de Archify (`npx skills add tt-a1i/archify -g`). Sin LLM.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DIR = REPO / "docs" / "arquitectura"
ARCHIFY = Path.home() / ".claude" / "skills" / "archify" / "bin" / "archify.mjs"
TIPOS = ("workflow", "dataflow", "architecture", "sequence", "lifecycle")


def fuentes(nombre: str | None = None) -> list[tuple[str, str, Path]]:
    out = []
    for p in sorted(DIR.glob("*.json")):
        partes = p.name.split(".")
        if len(partes) != 3 or partes[1] not in TIPOS:
            continue
        if nombre and partes[0] != nombre:
            continue
        out.append((partes[0], partes[1], p))
    return out


def ancho_para(nodo: dict) -> int:
    """Archify mide ~6,9 px por carácter del título y ~5,4 del sublabel."""
    titulo = len(nodo.get("label") or "") * 6.9 + 18
    sub = len(nodo.get("sublabel") or "") * 5.4 + 16
    tag = len(nodo.get("tag") or "") * 5.4 + 22
    return int(max(92, titulo, sub, tag) + 0.5)


def fijar_anchos(ruta: Path) -> int:
    d = json.loads(ruta.read_text(encoding="utf-8"))
    n = 0
    for nodo in d.get("nodes") or []:
        w = ancho_para(nodo)
        if nodo.get("width") != w:
            nodo["width"] = w
            n += 1
    ruta.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return n


def archify(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ARCHIFY), *args], capture_output=True, text=True, timeout=600)


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("validar", "entregar", "anchos"):
        print(__doc__)
        return 2
    accion = sys.argv[1]
    nombre = sys.argv[2] if len(sys.argv) > 2 else None
    if not ARCHIFY.is_file():
        print("Archify no está instalado: npx skills add tt-a1i/archify -g")
        return 1
    items = fuentes(nombre)
    if not items:
        print("No hay fuentes que coincidan")
        return 1
    fallos = 0
    for nom, tipo, ruta in items:
        if accion == "anchos":
            print(f"{nom}: {fijar_anchos(ruta)} ancho(s) ajustado(s)")
            continue
        extra = ["--repo-root", str(REPO)] if '"sources"' in ruta.read_text(encoding="utf-8") else []
        if accion == "validar":
            r = archify("validate", tipo, str(ruta), "--quality", "showcase", *extra)
        else:
            r = archify("deliver", tipo, str(ruta), str(DIR / f"{nom}.html"), "--quality", "showcase", *extra)
        ok = r.returncode == 0
        fallos += 0 if ok else 1
        salida = (r.stdout + r.stderr).strip().splitlines()
        print(f"{'OK  ' if ok else 'FALLA'} {nom} ({tipo})")
        if not ok:
            vistos = set()
            for linea in salida:
                if linea.startswith("[") or linea in vistos:
                    continue  # la segunda mitad repite los mismos diagnósticos con su código
                vistos.add(linea)
                print("     ", linea[:400])
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
