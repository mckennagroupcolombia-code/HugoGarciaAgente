"""Tiempos estándar: mediana con mínimo de muestras, estimados y horas ganadas sin cronómetro."""

from __future__ import annotations

import sqlite3
from datetime import datetime

import pytest

from app.services import tickets_db
from app.services import tiempos_estandar as T


@pytest.fixture()
def db(tmp_path, monkeypatch):
    ruta = tmp_path / "tickets.db"
    c = sqlite3.connect(ruta)
    c.executescript(
        """
        CREATE TABLE tickets (id INTEGER PRIMARY KEY, titulo TEXT, asignado_a INTEGER, estado TEXT, resuelto_en TEXT,
                              resultado_cantidad REAL, resultado_unidad TEXT);
        CREATE TABLE ticket_corridas (id INTEGER PRIMARY KEY, ticket_id INTEGER, usuario_id INTEGER, iniciada_en TEXT, finalizada_en TEXT);
        CREATE TABLE panel_eventos_operativos (id INTEGER PRIMARY KEY, usuario_id INTEGER, tipo TEXT, creado_en TEXT);
        CREATE TABLE logs_auditoria (id INTEGER PRIMARY KEY, usuario_id INTEGER, creado_en TEXT);
        -- tres expedientes cerrados en tanda: 14:59:00, 14:59:40 y 15:00:00 (la huella de cada uno son segundos)
        INSERT INTO logs_auditoria VALUES (1,1,'2026-09-03 14:59:00'),(2,1,'2026-09-03 14:59:40');
        """
    )
    # 5 empaques de 60 min (uno con 20 unidades) → estándar 60 min/vez
    for i in range(5):
        c.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?)", (i + 1, "Empacar productos en polvo", 1, "resuelto", None,
                                                              20 if i == 0 else None, "und" if i == 0 else None))
        c.execute("INSERT INTO ticket_corridas VALUES (?,?,?,?,?)", (i + 1, i + 1, 1, f"2026-09-0{i + 1} 13:00:00", f"2026-09-0{i + 1} 14:00:00"))
    # solo 2 almuerzos cronometrados: no alcanza para estándar
    for i in range(2):
        c.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?)", (10 + i, "Hacer el almuerzo", 1, "resuelto", None, None, None))
        c.execute("INSERT INTO ticket_corridas VALUES (?,?,?,?,?)", (10 + i, 10 + i, 1, "2026-09-02 16:00:00", "2026-09-02 18:00:00"))
    # expediente de nota crédito resuelto sin cronómetro, 20 s después de la acción anterior
    c.execute("INSERT INTO tickets VALUES (20,'Anulación / Nota crédito — RA-1',1,'resuelto','2026-09-03 15:00:00',NULL,NULL)")
    c.commit()
    c.close()
    monkeypatch.setattr(tickets_db, "DB_PATH", str(ruta))
    monkeypatch.setattr(T, "_cache", {"t": 0.0, "v": None})


def test_estandares(db):
    e = T.estandares(ahora=datetime(2026, 9, 20), usar_cache=False)
    assert e["empacar"]["minutos"] == 60 and e["empacar"]["muestras"] == 5
    assert "almuerzo" not in e  # 2 muestras: menos del mínimo
    assert "nc" not in e and "aprobar" not in e  # nada de tiempos estimados a mano


def test_horas_ganadas(db):
    est = T.estandares(ahora=datetime(2026, 9, 20), usar_cache=False)
    g = T.horas_ganadas(1, datetime(2026, 9, 1), datetime(2026, 9, 10), est=est)
    f = {x["id"]: x for x in g["funciones"]}
    assert f["empacar"]["veces"] == 5 and f["empacar"]["horas"] == pytest.approx(5.0)
    # la nota crédito sin cronómetro toma su huella real: 20 segundos, no 15 minutos
    assert f["nc"]["veces"] == 1 and f["nc"]["veces_huella"] == 1 and f["nc"]["horas"] == pytest.approx(20 / 3600, abs=0.01)
    assert g["sin_estandar"] == 2  # los almuerzos no tienen estándar todavía
