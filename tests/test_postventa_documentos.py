"""Postventa: detección de solicitud de documentos y respuesta de política MeLi
(sin API externa, sin enlaces — ver app/postventa_documentos.py)."""

from __future__ import annotations

import app.postventa_documentos as postventa_documentos
from app.postventa_documentos import (
    mensaje_solicita_documentos,
    respuesta_ficha_coa_meli,
)
from app.utils import meli_postventa_conversacion_cerrada


def test_mensaje_solicita_certificado() -> None:
    t = (
        "Buenas tardes podrias regalarme certificado de la materia prima "
        "somos laboratorios de alimentos y invima nos exige"
    )
    assert mensaje_solicita_documentos(t)


def test_mensaje_no_solicita_documentos() -> None:
    assert not mensaje_solicita_documentos("¿Cuándo despachan mi pedido?")
    assert not mensaje_solicita_documentos("")


def test_conversacion_cerrada_por_reclamo() -> None:
    conv = {
        "status": "blocked",
        "substatus": "blocked_by_claim",
        "claim_ids": [5518190773],
    }
    cerrada, motivo = meli_postventa_conversacion_cerrada(conv)
    assert cerrada
    assert motivo == "blocked_by_claim"


def test_conversacion_abierta() -> None:
    assert meli_postventa_conversacion_cerrada({"status": "active"}) == (False, "")


def test_pregunta_de_uso_no_dispara_docs() -> None:
    """Caso real jul-2026: pregunta técnica de uso NO es solicitud de FT/COA."""
    assert not mensaje_solicita_documentos(
        "Buenos días,  vuelve y se solidifica. Como hago para que me quede aceite liquido?"
    )
    assert not mensaje_solicita_documentos(
        "Si utilizo el de ricino , cual sería la proporcion?"
    )


def test_respuesta_ficha_coa_no_tiene_enlaces_ni_contacto() -> None:
    texto = respuesta_ficha_coa_meli()
    low = texto.lower()
    assert "http" not in low
    assert "@" not in texto
    assert "etiqueta" in low


def test_adjunto_pdf_no_dispara_auto_docs(monkeypatch) -> None:
    """Comprador manda solo un PDF (RUT/comprobante): el texto sintético
    '[Solo adjunto(s)...: X.pdf]' contiene 'pdf' pero NO debe auto-responder
    con fichas técnicas."""
    monkeypatch.setattr(postventa_documentos, "_AUTO_DOCS", True)
    texto = (
        "[Solo adjunto(s) en MeLi: RUT_empresa.pdf] "
        "— revisar conversación en Mercado Libre (p. ej. RUT / factura en PDF)."
    )
    # El guard corta antes de intentar responder por MeLi.
    assert (
        postventa_documentos.intentar_respuesta_automatica_documentos(
            "2000007044713785", texto
        )
        == "sin_match"
    )


def test_auto_responde_con_texto_fijo_sin_llamar_a_meli(monkeypatch) -> None:
    """Cuando se pide ficha técnica/COA, se envía el texto fijo de política
    (sin lookup de Drive ni distinción de producto comprado)."""
    monkeypatch.setattr(postventa_documentos, "_AUTO_DOCS", True)
    enviados = {}

    def fake_responder(pack_id, texto, comprador_id=None):
        enviados["pack_id"] = pack_id
        enviados["texto"] = texto
        return True

    monkeypatch.setattr("modulo_posventa.responder_mensaje_posventa", fake_responder)

    resultado = postventa_documentos.intentar_respuesta_automatica_documentos(
        "123456", "me puedes enviar la ficha tecnica y el coa del producto?"
    )
    assert resultado == "auto_enviado"
    assert enviados["pack_id"] == "123456"
    assert enviados["texto"] == respuesta_ficha_coa_meli()
