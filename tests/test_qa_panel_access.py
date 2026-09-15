"""Los permisos del panel y los del backend tienen que decir lo mismo.

La comprobación vive en `desktop/scripts/qa-panel-access.mjs` porque necesita
ejecutar el TypeScript real del panel (`panelAccess`, `permisosCatalogo`,
`NAV_SECTIONS`): reescribirla en Python sería una segunda copia de las reglas,
que es justo el problema que intenta evitar. Este test la engancha a la suite
para que corra con `pytest` y no solo cuando alguien se acuerda de `npm run
qa:panel-access`.

Comprueba tres cosas:
  1. `App.tsx` no tiene su propia escalera de permisos (delega en `panelAccess`).
  2. Todo panel que exija permiso tiene casilla en Gestión de usuarios — si no,
     el acceso existe en el código y en la base pero nadie puede otorgarlo.
  3. Cada clave de `PERMISOS_CONTABILIDAD` (el guard de `app/routes.py`) tiene
     esa casilla: un endpoint protegido con un permiso que la UI no sabe dar
     queda cerrado para siempre.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
SCRIPT = RAIZ / "desktop" / "scripts" / "qa-panel-access.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node no está instalado")
@pytest.mark.skipif(
    not (RAIZ / "desktop" / "node_modules").is_dir(),
    reason="faltan las dependencias del panel (cd desktop && npm install)",
)
def test_permisos_panel_y_backend_coinciden() -> None:
    res = subprocess.run(
        ["node", str(SCRIPT)],
        cwd=str(RAIZ / "desktop"),
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert res.returncode == 0, (res.stdout or "") + (res.stderr or "")
