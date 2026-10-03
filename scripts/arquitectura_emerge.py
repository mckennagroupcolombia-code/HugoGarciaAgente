#!/usr/bin/env python3
"""
Grafo interactivo de dependencias con Emerge (https://github.com/glato/emerge) para
el panel Sistema → Arquitectura del código → «Grafo interactivo».

Emerge analiza el código por su cuenta (no usa el índice de codebase-memory-mcp):
lee los import de cada archivo y arma un grafo de fuerzas d3 con colores por
comunidad (Louvain), tamaño por líneas o por fan-in, buscador y modo claro/oscuro.
Es lo que se quería del «grafo 3D» y no daba: un dibujo conectado y legible.

Dónde vive cada cosa:
  · Configuración: scripts/emerge_config.yaml (dos análisis: Python del repo y
    TypeScript de desktop/src). Cambiar ahí qué carpetas se ignoran.
  · Entorno: ~/.venvs/emerge (Python 3.10 — Emerge no arranca en 3.12: importa
    pkg_resources y pip internos). Se crea con `uv venv --python 3.10 ~/.venvs/emerge`
    y `uv pip install --python ~/.venvs/emerge/bin/python emerge-viz "setuptools<70" pip`.
    EMERGE_BIN sobreescribe la ruta del ejecutable.
  · Salida: app/data/arquitectura_emerge/html/emerge.html (+ JSON), gitignored.
    Flask la sirve bajo /app/arquitectura-emerge/… con la sesión del panel
    (app/routes_arquitectura.py).

Sin LLM. Tarda ~1-2 min en este repo.
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "scripts" / "emerge_config.yaml"
SALIDA = RAIZ / "app" / "data" / "arquitectura_emerge"


def binario() -> Path:
    if os.getenv("EMERGE_BIN"):
        return Path(os.environ["EMERGE_BIN"])
    for c in (Path.home() / ".venvs" / "emerge" / "bin" / "emerge", Path("/usr/local/bin/emerge")):
        if c.exists():
            return c
    sys.exit("No encuentro emerge. Instálalo (ver docstring) o define EMERGE_BIN.")


# Emerge copia la URL del HTML al portapapeles al terminar cada análisis (pyperclip) y en
# un servidor sin X11 eso lanza una excepción DESPUÉS de exportar el primer análisis,
# con lo que el segundo nunca corre. Se anula el portapapeles antes de arrancar.
_ARRANQUE = (
    "import sys, pyperclip; pyperclip.copy = lambda *a, **k: None; "
    "sys.argv = ['emerge', '-c', sys.argv[1]]; from emerge.main import run; run()"
)

ANALISIS = ("python", "panel")


def main() -> int:
    for nombre in ANALISIS:  # Emerge exige que la carpeta de exportación exista
        (SALIDA / nombre).mkdir(parents=True, exist_ok=True)
    python = binario().parent / "python"
    print(f"Emerge → {SALIDA.relative_to(RAIZ)}/{{{','.join(ANALISIS)}}} …", flush=True)
    r = subprocess.run([str(python), "-c", _ARRANQUE, str(CONFIG)], cwd=RAIZ)
    if r.returncode != 0:
        return r.returncode
    for nombre in ANALISIS:
        html = SALIDA / nombre / "html" / "emerge.html"
        if not html.exists():
            sys.exit(f"Emerge terminó pero no dejó {html.relative_to(RAIZ)}")
        print(f"→ {html.relative_to(RAIZ)} ({html.stat().st_size // 1024} KB)")
    (SALIDA / "generado.txt").write_text(datetime.now().astimezone().isoformat(timespec="seconds") + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
