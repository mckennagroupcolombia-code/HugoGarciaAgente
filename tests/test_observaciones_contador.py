"""Observaciones del contador: lo que puede escribir, lo que no, y de dónde sale el autor.

Lo que se protege: «revisado» es un estado (uno por objeto) y una pregunta exige texto;
el contador puede crear observaciones y pedir el paquete pero no resolver ni importar;
el autor sale de su sesión aunque el body traiga otro nombre; y lo abierto aparece en
«Revisión del libro».
"""

from __future__ import annotations

import pytest


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.contabilidad_db as cdb

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setattr(cdb, "_DB_PATH", db)
    cc.init_db()
    from app.services import expediente_contable

    expediente_contable._cache.clear()
    return cc


def test_revisado_es_un_estado_y_las_preguntas_exigen_texto(libro):
    from app.services.observaciones_contador import crear, listar, quitar_revisado, resolver, resumen

    crear("2026-09", "cuenta", "2365", "revisado", por="William")
    crear("2026-09", "cuenta", "2365", "revisado", por="William")      # reemplaza, no duplica
    with pytest.raises(ValueError):
        crear("2026-09", "cuenta", "2365", "pregunta", "", por="William")
    with pytest.raises(ValueError):
        crear("2026-09", "cuenta", "2365", "nota", por="")
    p = crear("2026-09", "cuenta", "2365", "pregunta", "¿Este IVA va a 2408?", por="William", por_usuario_id=12)
    assert p["abierta"] is True
    r = resumen("2026-09")
    assert r == {"total": 2, "abiertas": 1, "revisados": 1,
                 "por_objeto": {"cuenta:2365": {"revisado": True, "revisado_por": "William", "abiertas": 1, "notas": 0}}}
    resuelto = resolver(p["id"], respuesta="Sí, se reclasifica", por="Armando")
    assert resuelto["abierta"] is False and resuelto["respuesta"] == "Sí, se reclasifica"
    assert listar(abiertas=True) == []
    assert quitar_revisado("2026-09", "cuenta", "2365") is True
    assert resumen("2026-09")["revisados"] == 0


def test_lo_abierto_sale_en_revision_del_libro(libro):
    from app.services.observaciones_contador import crear
    from app.services.revision_libro import _ajustes

    crear("2026-09", "asiento", "6132", "ajuste", "La retención es del 4 %, no 11 %", por="William")
    renglones = _ajustes("2026-09-01", __import__("datetime").date(2026, 10, 5), 0.0, 0.0)
    obs = next(r for r in renglones if r["id"] == "observaciones_contador")
    assert obs["cifra"] == "1" and obs["ir"] == "expediente"
    assert "6132" in obs["detalle"][0] and "William" in obs["detalle"][0]


@pytest.fixture()
def cliente_contador(libro, monkeypatch, tmp_path):
    """Flask con un usuario de perfil contador cuyo token es «tok-william»."""
    import app.services.tickets_db as tdb
    from app.services import expediente_paquete

    monkeypatch.setattr(expediente_paquete, "_CACHE_DIR", tmp_path / "paq")
    william = {"id": 12, "nombre": "William Novoa", "username": "william.novoa", "activo": 1,
               "rol": {"id": 5, "nombre": "Contador", "nivel": 1}, "permisos_secciones": {"contador": True}, "departamento": None}
    orig = tdb.get_usuario_by_token
    monkeypatch.setattr(tdb, "get_usuario_by_token", lambda t: william if t == "tok-william" else orig(t))
    monkeypatch.setattr(tdb, "aplicar_privilegios_admin_cynthia", lambda u: u, raising=False)
    monkeypatch.setenv("AGENTE_SKIP_THREADS", "1")
    from flask import Flask

    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    return app.test_client()


def test_el_contador_observa_con_su_nombre_y_no_puede_resolver_ni_importar(cliente_contador):
    H = {"Authorization": "Bearer tok-william", "X-Tickets-Token": "tok-william"}
    r = cliente_contador.post("/api/contabilidad/expediente/observaciones", json={
        "periodo": "2026-09", "objeto_tipo": "cuenta", "objeto_id": "2365", "estado": "pregunta",
        "texto": "¿Y el IVA?", "por": "Alguien más",
    }, headers=H)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["por"] == "William Novoa"           # el body no manda
    oid = r.get_json()["id"]
    assert cliente_contador.post(f"/api/contabilidad/expediente/observaciones/{oid}/resolver", json={"respuesta": "x"}, headers=H).status_code == 403
    assert cliente_contador.post("/api/contabilidad/expediente/dian/importar", json={}, headers=H).status_code == 403
    assert cliente_contador.get("/api/contabilidad/expediente/periodos", headers=H).status_code == 200
    assert cliente_contador.get("/api/contabilidad/expediente/2026-09/paquete", headers=H).status_code == 200
    assert cliente_contador.get("/api/prestamos/1/documento", headers=H).status_code == 403
    assert cliente_contador.get("/api/contabilidad/expediente/documento?ref=prestamo_contrato:999", headers=H).status_code == 404
