"""Buscador de chats y ficha de cobros sin factura (Agente WhatsApp → Buscar, 25-sep-2026)."""
from __future__ import annotations

import sqlite3
from datetime import datetime

import pytest


@pytest.fixture()
def wb(monkeypatch, tmp_path):
    from app.services import wa_busqueda

    db = tmp_path / "wa.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE mensajes (id INTEGER PRIMARY KEY, ts REAL, jid TEXT, direccion TEXT, texto TEXT,"
              " tiene_media INT, nombre_arch TEXT, enviado_por TEXT, leido INT, wa_id TEXT, eliminado INT DEFAULT 0, media_path TEXT)")
    ts = datetime(2026, 9, 1, 10).timestamp()
    filas = [
        ("573505239915@c.us", "salida", "320.000 con envío", "humano"),
        ("573505239915@c.us", "entrada", "listo, mi cédula es 1.092.454.536 y el correo ana@x.co", ""),
        ("573174793187@c.us", "salida", "Total 62274 con envío de citrato de magnesio", "humano"),
        ("120363@g.us", "entrada", "320,000 en el grupo", ""),
    ]
    for i, (jid, d, t, por) in enumerate(filas):
        c.execute("INSERT INTO mensajes (ts, jid, direccion, texto, enviado_por) VALUES (?,?,?,?,?)", (ts + i, jid, d, t, por))
    c.commit()
    monkeypatch.setattr(wa_busqueda, "WA_DB", db)
    monkeypatch.setattr(wa_busqueda, "_contacto", lambda jid: {"jid": jid, "display": jid, "telefono": None})
    return wa_busqueda


def test_un_valor_se_busca_con_y_sin_puntos(wb):
    assert set(wb._variantes_valor(320000)) == {"320.000", "320,000", "320000"}
    r = wb.buscar("320000")
    assert r["es_valor"] and [x["jid"] for x in r["resultados"]] == ["573505239915@c.us"]   # sin el grupo


def test_los_grupos_solo_si_se_piden(wb):
    assert len(wb.buscar("320.000", incluir_grupos=True)["resultados"]) == 2


def test_palabras_en_cualquier_orden(wb):
    assert [x["jid"] for x in wb.buscar("magnesio citrato")["resultados"]] == ["573174793187@c.us"]


def test_un_telefono_encuentra_su_chat(wb):
    assert wb.buscar("3174793187")["resultados"][0]["jid"] == "573174793187@c.us"


def test_la_ficha_saca_la_cedula_y_no_el_celular(wb):
    with wb._wa() as c:
        f = wb._ficha_chat(c, "573505239915@c.us", 0, 9e12)
    assert f["documentos"] == ["1092454536"]
    assert f["correos"] == ["ana@x.co"]
    assert f["cotizado"] == ["320.000 con envío"]
