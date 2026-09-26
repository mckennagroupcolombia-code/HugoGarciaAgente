"""Ficha de rendimiento: clasificación de tareas, promedio por vez y reglas de reclasificación."""

from __future__ import annotations

import sqlite3
from datetime import datetime

import pytest

from app.services import rendimiento as R
from app.services import tickets_db


@pytest.fixture()
def db(tmp_path, monkeypatch):
    ruta = tmp_path / "tickets.db"
    c = sqlite3.connect(ruta)
    c.executescript(
        """
        CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT, username TEXT, activo INTEGER DEFAULT 1);
        CREATE TABLE tickets (id INTEGER PRIMARY KEY, titulo TEXT, asignado_a INTEGER, creado_en TEXT);
        CREATE TABLE ticket_corridas (id INTEGER PRIMARY KEY, ticket_id INTEGER, usuario_id INTEGER,
                                      iniciada_en TEXT, finalizada_en TEXT);
        CREATE TABLE panel_eventos_operativos (id INTEGER PRIMARY KEY, session_uuid TEXT, usuario_id INTEGER,
                                               tipo TEXT, panel TEXT, creado_en TEXT);
        INSERT INTO usuarios VALUES (1,'Operaria','stella',1),(2,'Socio','armando',1);
        INSERT INTO tickets VALUES (1,'Empacar productos en polvo',1,'2026-09-10 13:00:00'),
                                   (2,'El aseo',1,'2026-09-11 13:00:00'),
                                   (3,'Empacar sellar y etiquetar',2,'2026-09-11 13:00:00');
        INSERT INTO ticket_corridas VALUES
          (1,1,1,'2026-09-10 13:00:00','2026-09-10 15:00:00'),
          (2,1,1,'2026-09-12 13:00:00','2026-09-12 14:00:00'),
          (3,2,1,'2026-09-11 13:00:00','2026-09-11 14:00:00'),
          (4,2,1,'2026-09-11 13:00:00','2026-09-12 13:00:00'),
          (5,3,2,'2026-09-11 13:00:00','2026-09-11 14:00:00');
        INSERT INTO panel_eventos_operativos VALUES
          (1,'s1',2,'panel_view','libro-mayor','2026-09-11 13:00:00'),
          (2,'s1',2,'panel_view','hugo','2026-09-11 13:20:00');
        """
    )
    c.commit()
    c.close()
    monkeypatch.setattr(tickets_db, "DB_PATH", str(ruta))
    return ruta


def test_promedio_por_vez_y_tipos(db):
    r = R.rendimiento_usuario(1, dias=30, hoy=datetime(2026, 9, 20))
    f = {x["id"]: x for x in r["funciones"]}
    assert f["empacar"]["veces"] == 2 and f["empacar"]["promedio_min"] == 90 and f["empacar"]["horas"] == 3.0
    # la corrida de 24 h (cronómetro sin cerrar) no cuenta
    assert f["aseo"]["veces"] == 1 and f["aseo"]["horas"] == 1.0
    assert r["horas_mes"] == 4.0
    assert {t["nombre"] for t in r["tipos"]} == {"Operativo", "Servicios generales"}


def test_quien_desarrolla_no_empaca(db):
    r = R.rendimiento_usuario(2, dias=30, hoy=datetime(2026, 9, 20))
    nombres = [x["funcion"] for x in r["funciones"]]
    assert "Trabaja el módulo de empaque con IA" in nombres
    assert all("Empaca" not in n for n in nombres)
    assert any(x["id"] == "contab" and x["horas"] == pytest.approx(0.3, abs=0.01) for x in r["funciones"])
    assert "desarrollo del sistema" in r["nota"]


def test_clasificar():
    assert R.clasificar("Procedo a hacer el almuerzo para los empleados") == "almuerzo"
    assert R.clasificar("IMPRIMIR GUIAS DE MERCADOLIBRE") == "guias"
    assert R.clasificar("Voy a hacer la preparación para hacer vasos para la inoculación") == "hongos"
    assert R.clasificar("algo sin categoría") is None
