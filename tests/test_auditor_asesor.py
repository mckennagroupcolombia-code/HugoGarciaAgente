"""Copiloto del asesor (auditor_canales.revision_asesor) — sin IA ni WhatsApp real."""

from __future__ import annotations

import sqlite3
import time

import pytest

from app.agent.ventas_wa import catalogo as cat_mod
from app.services import auditor_canales as aud
from app.services import wa_chats

CACHE = {
    "sections": [
        {
            "name": "Nutrición",
            "products": [
                {"name": "PROTEINA CONCENTRADA SUERO LECHE 80P KG", "ref": "C-PROCONSUE80PKg", "precio_num": 93510, "stock": 20},
                {"name": "CITRATO MAGNESIO 500g", "ref": "C-CITMAG500g", "precio_num": 26910, "stock": 14},
                {"name": "CREATINA MONOHIDRATO 500g", "ref": "C-CREMON500g", "precio_num": 41053, "stock": 6},
            ],
        }
    ],
    "combos": [],
}


@pytest.fixture(autouse=True)
def entorno(tmp_path, monkeypatch):
    monkeypatch.setattr(cat_mod, "cargar", lambda: cat_mod.construir_desde_dict(CACHE, {}))
    db = tmp_path / "wa_chats.db"
    con = sqlite3.connect(db)
    con.execute(
        """CREATE TABLE mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, jid TEXT NOT NULL,
           direccion TEXT NOT NULL, texto TEXT, tiene_media INTEGER NOT NULL DEFAULT 0, nombre_arch TEXT,
           enviado_por TEXT NOT NULL DEFAULT 'bot', leido INTEGER NOT NULL DEFAULT 0, wa_id TEXT,
           eliminado INTEGER NOT NULL DEFAULT 0, media_path TEXT, media_mime TEXT)"""
    )
    con.commit()
    con.close()
    def _conn():
        c = sqlite3.connect(db, check_same_thread=False)
        c.row_factory = sqlite3.Row
        return c

    monkeypatch.setattr(wa_chats, "_conn", _conn)
    monkeypatch.setattr(aud, "_ciudad_del_chat", lambda jid, ts: ("Manizales", "Caldas"))
    monkeypatch.setattr("app.services.wa_jid.formato_display", lambda j: "+57 300")
    return db


def _msg(db, jid, texto, direccion="salida", por="humano", hace=60):
    con = sqlite3.connect(db)
    con.execute(
        "INSERT INTO mensajes (ts, jid, direccion, texto, enviado_por) VALUES (?, ?, ?, ?, ?)",
        (time.time() - hace, jid, direccion, texto, por),
    )
    con.commit()
    con.close()


def test_precio_distinto_a_la_web_y_precio_igual_no_se_marca(entorno):
    _msg(entorno, "573001@c.us", "te puedo dejar el kilo en 81.000 lo que pasa es que subio")  # sin par nombre: cifra
    _msg(entorno, "573001@c.us", "proteina kilo: 81.000")
    _msg(entorno, "573002@c.us", "libra de citrato de magnesio :  26.910")
    _msg(entorno, "573003@c.us", "creatina libra:  50.0000")
    _msg(entorno, "573008@c.us", "5 kilos  proteina: 467.550 + envio: 30.000")  # 93.510 × 5: total de línea, no unitario
    h = aud.revision_asesor(time.time() - 3600)
    assert not any(x["tipo"] == "precio_distinto" and x["jid"] == "573008@c.us" for x in h)
    tipos = [(x["tipo"], x["jid"]) for x in h]
    assert ("precio_distinto", "573001@c.us") in tipos
    assert not any(t == "precio_distinto" and j == "573002@c.us" for t, j in tipos)  # igual a la web
    assert ("cifra_malformada", "573003@c.us") in tipos
    detalle = next(x["detalle"] for x in h if x["tipo"] == "precio_distinto")
    assert "$81.000" in detalle and "$93.510" in detalle


def test_envio_distinto_a_la_tabla(entorno, monkeypatch):
    monkeypatch.setattr(
        "app.services.tarifas_envio.cotizar_envio",
        lambda ciudad, depto="", peso_kg=1.0: {"costo": {1: 20900, 2: 24000, 3: 28400, 5: 36000}[int(peso_kg)], "zona_nombre": "Nacional", "zona": "nacional", "peso_kg": int(peso_kg), "dias": 3},
    )
    _msg(entorno, "573004@c.us", "Valor de envío🛫 interrapidisimo hasta 1 kilo\nBogotá y Cundinamarca: 8.800\nOtras ciudades: 18.000")
    _msg(entorno, "573005@c.us", "envio: 20.900")
    h = aud.revision_asesor(time.time() - 3600)
    envios = [x for x in h if x["tipo"] == "envio_distinto"]
    assert [x["jid"] for x in envios] == ["573004@c.us"]
    assert "$18.000" in envios[0]["detalle"] and "$20.900" in envios[0]["detalle"]


def test_mensajes_del_bot_y_de_grupos_no_se_revisan(entorno):
    _msg(entorno, "573006@c.us", "proteina kilo: 50.000", por="bot")
    _msg(entorno, "120363@g.us", "proteina kilo: 50.000")
    _msg(entorno, "573007@c.us", "proteina kilo: 50.000", hace=5 * 86400)
    assert aud.revision_asesor(time.time() - 3600) == []
