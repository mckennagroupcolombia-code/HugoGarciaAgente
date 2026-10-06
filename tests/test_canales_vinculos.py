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


def _ticket(titulo="Pago frascos", categoria="logistica", asignado=9002):
    import sqlite3

    c = sqlite3.connect(tickets_db.DB_PATH)
    for uid, nom in ((9001, "Ana Prueba"), (9002, "Beto")):
        c.execute("INSERT OR IGNORE INTO usuarios (id, nombre, username, password_hash) VALUES (?,?,?,?)",
                  (uid, nom, f"prueba{uid}", "x"))
    cur = c.execute(
        "INSERT INTO tickets (numero, titulo, categoria, descripcion, creado_por, asignado_a) VALUES (?,?,?,?,?,?)",
        (f"T-{titulo[:6]}", titulo, categoria, "", 9001, asignado))
    c.commit()
    tid = cur.lastrowid
    c.close()
    return tid


def test_solicitud_vive_en_el_grupo(CI):
    canal = CI.crear_canal(ANA, "Solicitudes de pago", modulo="solicitudes_pago")
    tid = _ticket()
    CI.vincular_solicitud(canal["id"], ANA, tid, fecha_limite="2026-10-07", tipo="pago",
                          ref={"modulo": "solicitudes_pago", "id": "61", "titulo": "#61 · Envases"})
    lista = CI.listar_solicitudes(canal["id"], ANA)
    assert [(s["id"], s["fecha_limite"], s["asignado_nombre"], s["origen"], s["tipo"]) for s in lista] == [
        (tid, "2026-10-07", "Beto", "grupo", "pago")]
    assert lista[0]["ref"]["id"] == "61"
    aviso = CI.listar_mensajes(canal["id"], ANA)[-1]
    assert aviso["tipo"] == "sistema" and aviso["ref"]["ticket_id"] == tid
    assert "solicitó a Beto" in aviso["texto"] and "Pago" in aviso["texto"]


def test_compras_exterior_muestra_importaciones(CI):
    canal = CI.crear_canal(ANA, "Compras en el exterior", modulo="importaciones")
    tid = _ticket("Contenedor China", categoria="importaciones")
    _ticket("Otra cosa", categoria="logistica")
    assert [s["id"] for s in CI.listar_solicitudes(canal["id"], ANA)] == [tid]


def test_novedades_y_destinatarios(CI):
    from app.services import canales_avisos as CA

    canal = CI.crear_canal(ANA, "Fórmulas", miembros=[1, 2])
    base = CA.novedades(ANA, 0, inicio=True)["ultimo_id"]
    assert CA.novedades(ANA, 0, inicio=True)["mensajes"] == []
    BETO = {"id": 2, "nombre": "Beto", "username": "beto", "rol": {"nivel": 1}}
    CI.enviar_mensaje(canal["id"], BETO, "Ajusté la cera al 4 %")
    CI.enviar_mensaje(canal["id"], ANA, "Gracias")
    nov = CA.novedades(ANA, base)
    # Solo lo que escribieron otros, con el nombre del grupo.
    assert [(m["autor_nombre"], m["canal_nombre"]) for m in nov["mensajes"]] == [("Beto", "Fórmulas")]
    assert CA.destinatarios(canal["id"], 2) == [1]
