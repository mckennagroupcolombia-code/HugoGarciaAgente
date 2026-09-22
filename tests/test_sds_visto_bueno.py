"""SDS sugerida por IA a partir del título: no sale como documento final sin visto bueno.

El formulario FT + COA + SDS propone la hoja de seguridad con IA según el nombre
del producto. Esa propuesta puede traer frases H o pictogramas equivocados, así que
el backend rechaza el documento final hasta que alguien le dé el visto bueno; la
vista previa sí se genera, pero como borrador (banda BORRADOR, sin firma).
"""
from __future__ import annotations

import pytest
from flask import Flask

from app.routes import register_routes

TOKEN = "token-de-sistema-para-test"


@pytest.fixture()
def cliente(monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", TOKEN)
    app = Flask(__name__)
    register_routes(app)
    with app.test_client() as c:
        yield c


@pytest.fixture()
def generacion(monkeypatch):
    """Sustituye todo lo que escribe a disco; devuelve las llamadas a generar_pdf_completo."""
    from app.services import ficha_tecnica, lotes_materia_prima

    llamadas: list[dict] = []

    def _generar(datos_ft, **kw):
        llamadas.append(kw)
        return {"ok": True, "pdf_nombre": "FT COA SDS PRUEBA.pdf"}

    monkeypatch.setattr(ficha_tecnica, "generar_pdf_completo", _generar)
    monkeypatch.setattr(ficha_tecnica, "guardar_yaml_datos", lambda *a, **k: None)
    monkeypatch.setattr(ficha_tecnica, "eliminar_borrador_completo_por_titulo", lambda *a, **k: False)
    monkeypatch.setattr(lotes_materia_prima, "registrar_lote_desde_documento", lambda *a, **k: None)
    return llamadas


def _body(sds: dict, **extra) -> dict:
    return {"ft": {"titulo": "PRUEBA SDS"}, "sds": {"titulo": "PRUEBA SDS", **sds}, **extra}


def _post(cliente, body):
    return cliente.post(
        "/api/fichas/generar-completo", json=body, headers={"Authorization": f"Bearer {TOKEN}"}
    )


def test_sds_sugerida_sin_visto_bueno_no_genera_final(cliente, generacion):
    r = _post(cliente, _body({"sugerida_ia": True, "visto_bueno": None}))
    assert r.status_code == 409
    assert r.get_json()["codigo"] == "sds_sin_visto_bueno"
    assert generacion == []


def test_vista_previa_sale_como_borrador(cliente, generacion):
    r = _post(cliente, _body({"sugerida_ia": True}, vista_previa=True))
    assert r.status_code == 200
    assert generacion[-1]["borrador"] is True


def test_con_visto_bueno_genera_final(cliente, generacion):
    vb = {"por": "Armando", "en": "2026-09-21T15:00:00Z"}
    r = _post(cliente, _body({"sugerida_ia": True, "visto_bueno": vb}))
    assert r.status_code == 200
    assert generacion[-1]["borrador"] is False


def test_sds_escrita_a_mano_no_exige_visto_bueno(cliente, generacion):
    r = _post(cliente, _body({"peligros": {"clasificacion": "No peligroso"}}))
    assert r.status_code == 200
    assert generacion[-1]["borrador"] is False


# ── La composición se imprime en el COA (21-sep-2026) ──────────────────────────

def test_composicion_de_la_sds_pasa_al_coa():
    from app.services.ficha_tecnica import mover_composicion_al_coa

    ft_ctx = {"composicion": []}
    coa = {"composicion": []}
    sds = {"composicion": [["Aceite de cedro", "100 %", "8023-85-6"]]}
    mover_composicion_al_coa(ft_ctx, coa, sds)
    assert coa["composicion"] == [["Aceite de cedro", "100 %", "8023-85-6"]]
    assert coa["composicion_con_cas"] is True
    assert sds["composicion"] == []


def test_composicion_de_la_ft_pasa_al_coa_sin_columna_cas():
    from app.services.ficha_tecnica import mover_composicion_al_coa

    ft_ctx = {"composicion": [("Ácido oleico", "14 - 39 %")]}
    coa = {"composicion": []}
    mover_composicion_al_coa(ft_ctx, coa, None)
    assert coa["composicion"] == [["Ácido oleico", "14 - 39 %", ""]]
    assert coa["composicion_con_cas"] is False
    assert ft_ctx["composicion"] == []


def test_sin_coa_la_composicion_de_la_sds_pasa_a_la_ft():
    """La SDS no lleva sección de composición: sin COA, se imprime en la FT."""
    from app.services.ficha_tecnica import mover_composicion_al_coa

    ft_ctx = {"composicion": []}
    sds = {"composicion": [["X", "1 %", ""]]}
    mover_composicion_al_coa(ft_ctx, None, sds)
    assert ft_ctx["composicion"] == [("X", "1 %")]
    assert sds["composicion"] == []
