"""Preventa MeLi: la pregunta frecuente "¿me envías la ficha técnica y el COA?"
se responde de inmediato con el texto fijo de política (sin enlaces ni datos
de contacto — MeLi prohíbe compartirlos), sin pasar por el flujo normal de
ficha técnica + aprobación humana."""

from __future__ import annotations

from unittest.mock import patch

import app.services.meli_preventa as mp
from app.postventa_documentos import respuesta_ficha_coa_meli


def test_pregunta_ficha_coa_se_autoresponde_sin_pasar_por_ficha_tecnica(monkeypatch):
    monkeypatch.setattr("preventa_meli.obtener_token_meli", lambda: "tok")
    enviado = {}

    def fake_enviar(question_id, texto, token):
        enviado["question_id"] = question_id
        enviado["texto"] = texto
        return True

    monkeypatch.setattr("preventa_meli.enviar_respuesta_meli", fake_enviar)

    # Si el flujo NO interceptara antes, intentaría buscar ficha técnica en
    # Sheets — lo dejamos explotar para confirmar que nunca se llega ahí.
    def _no_deberia_llamarse(*a, **k):
        raise AssertionError("no debería consultar ficha técnica para esta FAQ")

    with patch(
        "app.services.google_services.buscar_ficha_tecnica_producto",
        _no_deberia_llamarse,
    ):
        respuesta, fue_gestionada = mp.manejar_pregunta_preventa(
            "999888777",
            "Ácido Cítrico 500 Gr",
            "Hola, me puedes enviar la ficha tecnica y el coa del producto?",
        )

    assert fue_gestionada is True
    assert respuesta == respuesta_ficha_coa_meli()
    assert enviado["question_id"] == "999888777"
    assert enviado["texto"] == respuesta_ficha_coa_meli()
    assert "http" not in enviado["texto"].lower()


def test_pregunta_ficha_coa_delega_al_grupo_si_falla_el_envio(monkeypatch):
    monkeypatch.setattr("preventa_meli.obtener_token_meli", lambda: None)
    monkeypatch.setattr(mp, "guardar_pregunta_pendiente", lambda *a, **k: True)
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **k: True)

    respuesta, fue_gestionada = mp.manejar_pregunta_preventa(
        "111222333",
        "Ácido Cítrico 500 Gr",
        "me pasas la ficha tecnica y coa?",
    )

    assert respuesta is None
    assert fue_gestionada is False
