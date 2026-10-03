"""Control de horas por quincena: quincenas, bloques sin doble conteo, explicaciones y horas pactadas."""

from __future__ import annotations

import sqlite3
from datetime import date, datetime

import pytest

from app.services import control_horas as CH
from app.services import mapa_funciones as MF
from app.services import tickets_db


@pytest.fixture()
def entorno(tmp_path, monkeypatch):
    ruta = tmp_path / "tickets.db"
    c = sqlite3.connect(ruta)
    c.executescript(
        """
        CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT, username TEXT, activo INTEGER DEFAULT 1);
        CREATE TABLE tickets (id INTEGER PRIMARY KEY, titulo TEXT, asignado_a INTEGER, estado TEXT, resuelto_en TEXT,
                              resultado_cantidad REAL, resultado_unidad TEXT);
        INSERT INTO tickets VALUES (1,'Empacar productos en polvo',1,'resuelto',NULL,NULL,NULL);
        CREATE TABLE ticket_corridas (id INTEGER PRIMARY KEY, ticket_id INTEGER, usuario_id INTEGER, iniciada_en TEXT, finalizada_en TEXT);
        CREATE TABLE panel_eventos_operativos (id INTEGER PRIMARY KEY, session_uuid TEXT, usuario_id INTEGER, tipo TEXT, panel TEXT, creado_en TEXT);
        CREATE TABLE logs_auditoria (id INTEGER PRIMARY KEY, usuario_id INTEGER, creado_en TEXT);
        INSERT INTO usuarios VALUES (1,'Operaria','stella',1);
        -- tarea de 2 h (8:00–10:00 Bogotá = 13:00–15:00 UTC) y un evento dentro: no se cuenta dos veces
        INSERT INTO ticket_corridas VALUES (1,1,1,'2026-09-02 13:00:00','2026-09-02 15:00:00');
        INSERT INTO panel_eventos_operativos VALUES (1,'s',1,'panel_view','tickets','2026-09-02 13:30:00');
        -- cronómetro abierto 12 h: no cuenta
        INSERT INTO ticket_corridas VALUES (2,1,1,'2026-09-03 13:00:00','2026-09-04 01:00:00');
        """
    )
    c.commit()
    c.close()
    monkeypatch.setattr(tickets_db, "DB_PATH", str(ruta))
    monkeypatch.setattr(CH, "_RUTA", str(tmp_path / "control_horas.json"))
    monkeypatch.setattr(MF, "_RUTA", str(tmp_path / "rrhh_valoracion.json"))
    monkeypatch.delenv("RENDIMIENTO_SESIONES_IA", raising=False)
    from app.services import tiempos_estandar as T

    monkeypatch.setattr(T, "_cache", {"t": 0.0, "v": None})
    MF.actualizar_persona(1, {"pago_hoy": 2_500_000, "mercado": {"cargo": "Aux", "min": 1_750_905, "max": 2_100_000}})


def test_quincenas():
    assert CH.quincena_de(date(2026, 9, 15)) == (date(2026, 9, 1), date(2026, 9, 16), "2026-09-Q1")
    assert CH.quincena_de(date(2026, 12, 20)) == (date(2026, 12, 16), date(2027, 1, 1), "2026-12-Q2")
    assert CH.quincena_por_clave("2026-09-Q2")[0] == date(2026, 9, 16)
    assert CH.dias_habiles(date(2026, 9, 1), date(2026, 9, 16)) == 11


def test_horas_pactadas_y_bloques(entorno):
    e = CH.estado(1, quincena="2026-09-Q1", ahora=datetime(2026, 9, 20), con_dinero=True)
    assert e["horas_activas"] == pytest.approx(2.0)  # 8:00 a 10:00 en bloques de 15 min; el evento de 8:30 no suma
    vh = (MF.honorario_equivalente(1_750_905) + MF.honorario_equivalente(2_100_000)) / 2 / CH.JORNADA_MES
    assert e["pactadas"] == pytest.approx(round(1_250_000 / vh, 1))
    assert e["faltan"] > 0 and e["de_mas"] == 0 and e["valor_de_mas"] == 0
    # las dos ejecuciones cuentan como hechas (a tiempo estándar), también la que quedó abierta 12 h
    assert e["ganadas"]["tareas_resueltas"] == 2
    dias = {d["fecha"]: d for d in e["dias"]}
    assert len(e["dias"]) == 15 and dias["2026-09-02"]["horas"] == pytest.approx(2.0)
    assert dias["2026-09-06"]["meta"] == 0  # domingo: sin meta
    assert dias["2026-09-02"]["diferencia"] == pytest.approx(2.0 - dias["2026-09-02"]["meta"], abs=0.01)


def test_explicaciones_con_tope_y_aprobacion(entorno, monkeypatch):
    hoy = CH.datetime.utcnow() + CH._BOGOTA
    f = hoy.date().isoformat()
    x = CH.explicar(1, f, 4, "Recibí y revisé el pedido de insumos")
    with pytest.raises(ValueError):
        CH.explicar(1, f, 3, "Otra cosa larga por aquí")  # pasa de 6 h en la semana
    with pytest.raises(ValueError):
        CH.explicar(1, f, 1, "corto")
    CH.revisar(x["id"], True, "admin")
    with pytest.raises(ValueError):
        CH.revisar(x["id"], True, "admin")
    e = CH.estado(1)
    assert e["horas_explicadas"] == 4


def test_resumen_semanal(entorno):
    # jueves 3-sep: lunes 31-ago (otra quincena) sin registro, miércoles 2 con 2 h
    t = CH.resumen_semanal(1, ahora=datetime(2026, 9, 3, 18, 0))
    assert t.startswith("Hola, Operaria.")
    assert "Esta semana trabajó 2 h" in t
    assert "Le faltan" in t and "de aquí al 15 de septiembre" in t
    assert "colectas" not in t and "mismo valor" in t
    assert "Hay días sin registrar" in t and "lunes 31" in t
    assert "no hacerlo más rápido" in t


def test_colectas_y_mismo_valor(entorno):
    MF.actualizar_persona(1, {"colectas": True})
    e = CH.estado(1, quincena="2026-09-Q1", ahora=datetime(2026, 9, 20), con_dinero=True)
    assert e["regla"]["colectas"] is True
    assert e["valor_hora_adicional"] == e["valor_hora"]  # honorarios: la hora adicional no lleva recargo
    t = CH.resumen_semanal(1, ahora=datetime(2026, 9, 3, 18, 0))
    assert "de lunes a viernes necesitamos su disponibilidad para las colectas" in t



def test_festivos_no_son_habiles():
    from app.services.festivos_co import festivos
    f = festivos(2026)
    assert len(f) == 19 and date(2026, 7, 13) in f and date(2026, 10, 12) in f and date(2026, 4, 3) in f
    # octubre Q1: 11 días de lunes a viernes, menos el lunes festivo 12
    assert CH.dias_habiles(date(2026, 10, 1), date(2026, 10, 16)) == 10


def test_detalle_dia_cuadra_con_el_total(entorno):
    """El detalle de un día suma lo mismo que el conteo de la quincena, y Juegos no cuenta."""
    c = sqlite3.connect(CH.tickets_db.DB_PATH)
    c.executescript(
        """
        INSERT INTO panel_eventos_operativos VALUES (3,'s',1,'panel_view','facturacion','2026-09-02 17:05:00');
        INSERT INTO panel_eventos_operativos VALUES (4,'s',1,'panel_view','juegos','2026-09-02 18:05:00');
        """
    )
    c.commit()
    c.close()
    d = CH.detalle_dia(1, "2026-09-02")
    assert d["horas_activas"] == pytest.approx(2.25)  # tarea 8:00–10:00 + 15 min de facturación; el juego no suma
    tipos = [t["tipo"] for t in d["tramos"]]
    assert tipos == ["tarea", "pausa", "panel"]
    assert d["tramos"][0]["titulo"] == "Empacar productos en polvo" and d["tramos"][0]["desde"] == "08:00"
    assert d["tramos"][2]["panel"] == "facturacion"
    e = CH.estado(1, quincena="2026-09-Q1", ahora=datetime(2026, 9, 20))
    assert {x["fecha"]: x for x in e["dias"]}["2026-09-02"]["horas"] == pytest.approx(d["horas"])
