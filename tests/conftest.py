"""
Pytest: configuración global de tests.

Importar `webhook_meli` en el mismo árbol que un proceso systemd activo choca con
`.webhook_meli.lock` (flock). En tests forzamos skip del lock (ver webhook_meli.py).
"""
from __future__ import annotations

import os

# Forzar en suite de tests (no usar en producción).
os.environ["WEBHOOK_MELI_SKIP_SINGLETON_LOCK"] = "1"
