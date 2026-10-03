"""Reconectar Mercado Pago pegando el Access Token en Sistemas → Conexiones."""
from __future__ import annotations

import json

import pytest


class _Resp:
    def __init__(self, status: int, data: dict):
        self.status_code, self._data, self.text = status, data, json.dumps(data)

    def json(self):
        return self._data


@pytest.fixture()
def cx(monkeypatch, tmp_path):
    from app.services import conexiones as cx

    env = tmp_path / ".env"
    env.write_text("A=1\nMP_ACCESS_TOKEN=APP_USR-viejo\n# MP_ACCESS_TOKEN=comentado\nB=2", encoding="utf-8")
    monkeypatch.setattr(cx, "ENV_PATH", env)
    monkeypatch.setattr(cx, "MP_META", tmp_path / "mp_meta.json")
    monkeypatch.setenv("MP_ACCESS_TOKEN", "APP_USR-viejo")
    cuentas = {"APP_USR-viejo": {"id": 1, "nickname": "MCKENNA"}, "APP_USR-nuevo": {"id": 1, "nickname": "MCKENNA"},
               "APP_USR-otra": {"id": 2, "nickname": "OTRA"}}

    def fake_get(url, headers=None, **_k):
        tok = headers["Authorization"].split()[-1]
        return _Resp(200, cuentas[tok]) if tok in cuentas else _Resp(401, {"message": "invalid_token"})

    monkeypatch.setattr(cx.requests, "get", fake_get)
    return cx, env


def test_token_de_la_misma_cuenta_queda_en_uso(cx, monkeypatch):
    import os

    mod, env = cx
    r = mod.reconectar_mercadopago("  APP_USR-nuevo \n", usuario="Armando")
    assert r["ok"] and r["cuenta"] == "MCKENNA"
    assert env.read_text() == "A=1\nMP_ACCESS_TOKEN=APP_USR-nuevo\n# MP_ACCESS_TOKEN=comentado\nB=2"
    assert os.environ["MP_ACCESS_TOKEN"] == "APP_USR-nuevo"
    meta = json.loads(mod.MP_META.read_text())
    assert meta["user_id"] == 1 and meta["conectado_por"] == "Armando" and "nuevo" not in json.dumps(meta)


@pytest.mark.parametrize("token, pista", [("TEST-123", "PRUEBA"), ("abc", "APP_USR-"), ("APP_USR-malo", "rechazó")])
def test_tokens_que_no_sirven_no_tocan_el_env(cx, token, pista):
    mod, env = cx
    antes = env.read_text()
    r = mod.reconectar_mercadopago(token)
    assert not r["ok"] and pista in r["error"]
    assert env.read_text() == antes


def test_otra_cuenta_pide_confirmacion(cx):
    mod, env = cx
    r = mod.reconectar_mercadopago("APP_USR-otra")
    assert not r["ok"] and r["otra_cuenta"] and "MCKENNA" in r["error"]
    assert "APP_USR-viejo" in env.read_text()
    assert mod.reconectar_mercadopago("APP_USR-otra", aceptar_otra_cuenta=True)["ok"]
    assert "MP_ACCESS_TOKEN=APP_USR-otra\n" in env.read_text()
