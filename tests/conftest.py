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


_BANDERAS_DOCUMENTOS_FISCALES = (
    "PAGOS_DOC_SOPORTE_ACTIVO", "PAGOS_DOC_SOPORTE_TRANSMITIR", "PRESTAMOS_DOC_SOPORTE_ACTIVO",
    "COMPRAS_SOCIOS_DOC_SOPORTE_ACTIVO", "MELI_AUTOFACTURA_ENTREGA_ACTIVO",
)


@pytest.fixture(autouse=True)
def _sin_documentos_fiscales_reales_en_tests(monkeypatch):
    """Ningún test debe crear nada en la Alegra real.

    Varios módulos hacen `load_dotenv(.env)` al importarse, así que los tests
    corren con las banderas de PRODUCCIÓN encendidas. El fixture de
    `test_prestamos.py` no apagaba `PRESTAMOS_DOC_SOPORTE_ACTIVO` y cada corrida
    emitía un documento soporte real a «Juan Pérez» (79123456): DSMG2 a DSMG5 del
    19-sep-2026, que se comieron numeración de la resolución DIAN y hubo que
    borrar a mano. Se apagan las banderas y, por si otra se escapa, se bloquea
    toda escritura HTTP hacia Alegra (los tests que simulan Alegra parchean más
    arriba y no llegan hasta aquí).
    """
    import requests

    for bandera in _BANDERAS_DOCUMENTOS_FISCALES:
        monkeypatch.delenv(bandera, raising=False)

    original = requests.sessions.Session.request

    def _request(self, method, url, *args, **kwargs):
        if "alegra.com" in str(url) and str(method).upper() != "GET":
            raise RuntimeError(f"Test intentó escribir en la Alegra real: {method} {url}")
        return original(self, method, url, *args, **kwargs)

    monkeypatch.setattr(requests.sessions.Session, "request", _request)
