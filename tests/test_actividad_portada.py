"""Caja "En este momento" de la portada (sep-2026): señales que no bajan a
cero de madrugada — último despacho, respuesta humana por WhatsApp, pedidos
del mes — en vez de "Pedidos hoy" / "Consultas hoy"."""

from __future__ import annotations

import re
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

import website  # noqa: E402


def test_hace_es_legible():
    ahora = datetime.now()
    assert website._hace(None) == ""
    assert website._hace(ahora - timedelta(seconds=30)) == "hace un momento"
    assert website._hace(ahora - timedelta(minutes=25)) == "hace 25 min"
    assert website._hace(ahora - timedelta(days=4)) == "hace 4 días"
    assert website._hace(datetime.combine(ahora.date() - timedelta(days=1), datetime.min.time())) == "ayer"


def _wa_db(tmp_path: Path, filas: list[tuple[float, str, str, str]]) -> Path:
    p = tmp_path / "wa_chats.db"
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE mensajes (id INTEGER PRIMARY KEY, ts REAL, jid TEXT, direccion TEXT, enviado_por TEXT, eliminado INTEGER DEFAULT 0)")
    con.executemany("INSERT INTO mensajes (ts, jid, direccion, enviado_por) VALUES (?,?,?,?)", filas)
    con.commit()
    con.close()
    return p


def test_tiempo_respuesta_solo_cuenta_humanos_en_horario(tmp_path, monkeypatch):
    # martes 10:00 hace una semana
    base = datetime.now() - timedelta(days=7)
    base = base - timedelta(days=(base.weekday() - 1) % 7)
    base = base.replace(hour=10, minute=0, second=0, microsecond=0)
    filas = []
    for i in range(25):
        t0 = (base + timedelta(minutes=i * 15)).timestamp()  # 10:00-16:00, dentro de horario
        jid = f"57300{i:04d}@c.us"
        filas.append((t0, jid, "entrada", "cliente"))
        filas.append((t0 + 10, jid, "salida", "bot"))          # el bot no cuenta
        filas.append((t0 + 4 * 60, jid, "salida", "humano"))   # 4 min de respuesta humana
    # uno de madrugada (fuera de horario) con 3 horas de espera: se ignora
    noche = base.replace(hour=2).timestamp()
    filas += [(noche, "57399@c.us", "entrada", "cliente"), (noche + 3 * 3600, "57399@c.us", "salida", "humano")]
    p = _wa_db(tmp_path, filas)
    monkeypatch.setattr(website, "ROOT", tmp_path)
    (tmp_path / "app" / "data").mkdir(parents=True)
    p.rename(tmp_path / "app" / "data" / "wa_chats.db")
    r = website._tiempo_respuesta_wa(dias=30)
    assert r == {"mediana_min": 4.0, "muestra": 25, "pct_15min": 100}


def test_tiempo_respuesta_sin_muestra_suficiente_no_presume(tmp_path, monkeypatch):
    base = (datetime.now() - timedelta(days=2)).replace(hour=10, minute=0)
    base -= timedelta(days=max(0, base.weekday() - 4))  # que caiga entre lunes y viernes
    t0 = base.timestamp()
    (tmp_path / "app" / "data").mkdir(parents=True)
    _wa_db(tmp_path, [(t0, "1@c.us", "entrada", "cliente"), (t0 + 60, "1@c.us", "salida", "humano")]).rename(
        tmp_path / "app" / "data" / "wa_chats.db")
    monkeypatch.setattr(website, "ROOT", tmp_path)
    assert website._tiempo_respuesta_wa() == {}
    monkeypatch.setattr(website, "ROOT", tmp_path / "no-existe")
    assert website._tiempo_respuesta_wa() == {}


@pytest.fixture()
def client():
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        yield c


def test_actividad_expone_las_señales_nuevas(client):
    a = client.get("/api/actividad").get_json()
    for k in ("ultimo_despacho_ciudad", "ultimo_despacho_hace", "respuesta_wa_txt", "ultima_consulta_hace", "pedidos_30d", "pedidos_30d_txt"):
        assert k in a, k
    assert a["pedidos_30d_txt"] == f"{a['pedidos_30d']:,}".replace(",", ".")
    # compatibilidad con el tema Pureza (_actividad_vivo.html)
    assert {"pedidos_hoy", "consultas_hoy", "n_ciudades_semana"} <= set(a)


def test_caja_en_este_momento_no_depende_de_hoy():
    src = (REPO / "PAGINA_WEB" / "site" / "templates" / "index.html").read_text(encoding="utf-8")
    i = src.index("{% macro caja_por_que_elegirnos")
    caja = src[i:src.index("{%- endmacro %}", i)]
    cuerpo = re.sub(r"\{#.*?#\}", "", caja, flags=re.S)
    assert 'data-live="pedidos_hoy"' not in cuerpo and 'data-live="consultas_hoy"' not in cuerpo
    assert "hoy" not in re.sub(r"<[^>]+>", " ", cuerpo).lower()
    for k in ("ultimo_despacho_ciudad", "respuesta_wa_txt", "ultima_consulta_hace", "pedidos_30d_txt", "n_ciudades_semana"):
        assert f'data-live="{k}"' in cuerpo, k
