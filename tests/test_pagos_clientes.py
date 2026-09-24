"""Registro durable de pagos de clientes por WhatsApp (app/services/pagos_clientes.py)."""
from __future__ import annotations

import sqlite3

import pytest

from app.services import pagos_clientes as PC
from app.services import tickets_db


@pytest.fixture()
def entorno(tmp_path, monkeypatch):
    monkeypatch.setattr(PC, "_DB", str(tmp_path / "pagos_clientes.db"))
    ruta = tmp_path / "tickets.db"
    c = sqlite3.connect(ruta)
    c.executescript(
        """
        CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT, username TEXT, telefono TEXT, activo INTEGER DEFAULT 1);
        INSERT INTO usuarios VALUES (10, 'Jenniffer Garcia', 'jerry', '573182432463', 1);
        """
    )
    c.commit(); c.close()
    monkeypatch.setattr(tickets_db, "DB_PATH", str(ruta))


def test_comprobante_y_decision_con_autor(entorno):
    pid = PC.registrar_comprobante("573001112233@c.us", "233", "comprobantes/x.jpeg", {"monto": 45000})
    assert pid and len(PC.pendientes()) == 1
    # quien decide se identifica por su teléfono (author del grupo)
    fila = PC.decidir("573001112233@c.us", "confirmado", autor_telefono="573182432463@c.us")
    assert fila["estado"] == "confirmado" and fila["decidido_por_uid"] == 10
    assert fila["decidido_por_nombre"] == "Jenniffer Garcia" and fila["monto_detectado"] == 45000
    assert PC.pendientes() == []
    # decidir sin pendiente no inventa filas
    assert PC.decidir("573001112233@c.us", "rechazado") is None


def test_usuario_por_telefono_y_actividad(entorno, monkeypatch):
    assert PC.usuario_por_telefono("573182432463")[0] == 10
    assert PC.usuario_por_telefono("120363291230325649@g.us")[0] is None
    eventos = []
    monkeypatch.setattr("app.services.panel_presencia.registrar_evento_panel",
                        lambda uid, tipo, **k: eventos.append((uid, tipo, k.get("panel"))))
    assert PC.registrar_actividad_wa("573182432463", tipo="comando_wa", detalle="ok 233") is True
    assert eventos == [(10, "comando_wa", "whatsapp")]
    # un mensaje viejo (sync) no se anota como actividad de ahora
    assert PC.registrar_actividad_wa("573182432463", ts=1.0) is False
    # un número que no es del equipo, tampoco
    assert PC.registrar_actividad_wa("573000000000") is False
    assert len(eventos) == 1
