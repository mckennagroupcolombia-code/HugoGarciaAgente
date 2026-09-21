"""Accesos rápidos: el ranking sale de la telemetría `panel_view` de cada persona."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

AHORA = datetime(2026, 9, 21, 12, 0, 0)


@pytest.fixture()
def pp(monkeypatch, tmp_path):
    from app.services import tickets_db
    import app.services.panel_presencia as pp

    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets.db"))
    tickets_db.init_db()
    pp._migrate_panel_presencia()
    with tickets_db._conn() as db:
        db.execute("INSERT OR IGNORE INTO roles (id, nombre, nivel) VALUES (1,'Admin',3)")
        for uid in (1, 2):
            db.execute("INSERT OR IGNORE INTO usuarios (id, username, nombre, password_hash, rol_id, activo)"
                       " VALUES (?, ?, ?, 'x', 1, 1)", (uid, f"u{uid}", f"U{uid}"))
        db.commit()
    return pp


def _vistas(pp, uid, panel, *hace_dias):
    from app.services import tickets_db

    with tickets_db._conn() as db:
        for d in hace_dias:
            cuando = (AHORA - timedelta(days=d)).strftime("%Y-%m-%d %H:%M:%S")
            db.execute("INSERT INTO panel_eventos_operativos (usuario_id, tipo, panel, creado_en)"
                       " VALUES (?, 'panel_view', ?, ?)", (uid, panel, cuando))
        db.commit()


def test_lo_reciente_pesa_mas_que_lo_viejo(pp):
    # 6 visitas a etiquetas hace un mes contra 3 a facturación esta semana.
    _vistas(pp, 1, "etiquetas", 30, 31, 32, 33, 34, 35)
    _vistas(pp, 1, "facturacion", 1, 2, 3)
    r = pp.atajos_frecuentes(1, ahora=AHORA)
    assert [f["panel"] for f in r["frecuentes"]] == ["facturacion", "etiquetas"]
    assert r["frecuentes"][1]["visitas"] == 6


def test_la_agenda_y_el_perfil_no_son_atajos(pp):
    _vistas(pp, 1, "hugo", 0, 0.1, 0.2)
    _vistas(pp, 1, "perfil", 0.3)
    _vistas(pp, 1, "pagos", 1)
    r = pp.atajos_frecuentes(1, ahora=AHORA)
    assert [f["panel"] for f in r["frecuentes"]] == ["pagos"]
    assert r["recientes"] == ["pagos"]


def test_cada_quien_ve_lo_suyo_y_nada_fuera_de_la_ventana(pp):
    _vistas(pp, 1, "whatsapp", 1)
    _vistas(pp, 2, "fichas", 1)
    _vistas(pp, 1, "stock", 90)
    r = pp.atajos_frecuentes(1, ahora=AHORA)
    assert [f["panel"] for f in r["frecuentes"]] == ["whatsapp"]


def test_recientes_en_orden_sin_repetir(pp):
    _vistas(pp, 1, "pagos", 3, 0.5)
    _vistas(pp, 1, "stock", 1)
    _vistas(pp, 1, "fichas", 2)
    r = pp.atajos_frecuentes(1, ahora=AHORA)
    assert r["recientes"] == ["pagos", "stock", "fichas"]
