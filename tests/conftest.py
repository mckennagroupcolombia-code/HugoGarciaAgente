"""
Pytest: configuración global de tests.

Importar `webhook_meli` en el mismo árbol que un proceso systemd activo choca con
`.webhook_meli.lock` (flock). En tests forzamos skip del lock (ver webhook_meli.py).
"""
from __future__ import annotations

import os
import smtplib

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


class _FakeSMTP:
    """Doble sin red: ningún test debe abrir una conexión SMTP real."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self, *args, **kwargs):
        pass

    def starttls(self, *args, **kwargs):
        pass

    def login(self, *args, **kwargs):
        pass

    def sendmail(self, *args, **kwargs):
        pass

    def send_message(self, *args, **kwargs):
        pass

    def quit(self):
        pass

    def close(self):
        pass


@pytest.fixture(autouse=True)
def _bloquear_smtp_real_en_tests(monkeypatch):
    """Ningún test debe enviar correo real.

    `app/tools/web_pedidos.py` hace `load_dotenv(.env)` a nivel de módulo, así que
    en esta máquina los tests corren con las credenciales SMTP reales de
    mckenna.group.colombia@gmail.com cargadas. Sin este bloqueo, cualquier test que
    llegue a status "Accepted" (factura aceptada por DIAN) dispara un envío SMTP
    real: pasó 50 veces entre 2026-05-09 y 2026-07-11 (asunto "Factura electrónica
    FE-RETRY/FE-123 — McKenna Group" a cliente@example.com, ~1/día).
    """
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)
