"""Grupos de trabajo: canal vinculado a un módulo y mensajes con enlace (canales_vinculos)."""
from __future__ import annotations

import pytest

from app.services import tickets_db


@pytest.fixture()
def CI(monkeypatch, tmp_path):
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    monkeypatch.setattr(tickets_db, "UPLOADS_DIR", str(tmp_path / "uploads"))
    tickets_db.init_db()
    from app.services import canales_internos

    monkeypatch.setattr("app.services.panel_presencia.registrar_evento_panel", lambda *a, **kw: None)
    monkeypatch.setattr(canales_internos, "_reenviar_a_wa", lambda jid, txt: None)
    return canales_internos


ANA = {"id": 1, "nombre": "Ana", "username": "ana", "rol": {"nivel": 2}}


def test_canal_con_modulo(CI):
    canal = CI.crear_canal(ANA, "Solicitudes de pago", modulo="solicitudes_pago")
    assert canal["modulo"] == "solicitudes_pago"
    assert CI.actualizar_canal(canal["id"], ANA, modulo="")["modulo"] is None
    with pytest.raises(ValueError):
        CI.crear_canal(ANA, "Otro", modulo="no-existe")


def test_mensaje_con_enlace(CI):
    from app.services.canales_vinculos import normalizar_ref

    canal = CI.crear_canal(ANA, "Fórmulas", modulo="formulas")
    ref = normalizar_ref({"modulo": "formulas", "id": "f1", "titulo": "Crema de karité", "extra": "x"})
    assert ref == {"modulo": "formulas", "id": "f1", "titulo": "Crema de karité", "detalle": ""}
    # Un enlace solo (sin texto ni adjunto) es un mensaje válido.
    m = CI.enviar_mensaje(canal["id"], ANA, "", ref=ref)
    assert m["ref"]["titulo"] == "Crema de karité"


def test_normalizar_ref_rechaza_basura():
    from app.services.canales_vinculos import normalizar_ref

    assert normalizar_ref(None) is None
    assert normalizar_ref({"modulo": "otro", "id": "1"}) is None
    assert normalizar_ref({"modulo": "formulas", "id": ""}) is None
    assert normalizar_ref({"modulo": "guias_envio", "id": "7"})["titulo"] == "Guía 7"


def test_buscar_respeta_permisos(monkeypatch):
    from app.services import canales_vinculos as CV

    monkeypatch.setattr(CV, "puede_usar", lambda u, m: False)
    with pytest.raises(PermissionError):
        CV.buscar("solicitudes_pago", "", ANA)
    with pytest.raises(ValueError):
        CV.buscar("nada", "", ANA)
