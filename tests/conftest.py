"""
Pytest: configuración global de tests.

Importar `webhook_meli` en el mismo árbol que un proceso systemd activo choca con
`.webhook_meli.lock` (flock). En tests forzamos skip del lock (ver webhook_meli.py).
"""
from __future__ import annotations

import os

import pytest

# Forzar en suite de tests (no usar en producción).
os.environ["WEBHOOK_MELI_SKIP_SINGLETON_LOCK"] = "1"
# Evita que un secret de Actions con CHAT_API_TOKEN rompa tests que esperan 401.
os.environ.pop("CHAT_API_TOKEN", None)
os.environ["CHAT_API_TOKEN"] = ""


@pytest.fixture(autouse=True)
def _forzar_chat_api_token_vacio_en_tests(monkeypatch):
    """Aísla cada test de CHAT_API_TOKEN del runner o de load_dotenv(.env)."""
    monkeypatch.delenv("CHAT_API_TOKEN", raising=False)
    monkeypatch.setenv("CHAT_API_TOKEN", "")
