"""Postventa: detección de solicitud de documentos y drive (sin API externa)."""

from __future__ import annotations

import app.postventa_documentos as postventa_documentos
from app.postventa_documentos import (
    _detectar_producto_no_comprado,
    mensaje_solicita_documentos,
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


_CATALOGO_FAKE = [
    "CARBONATO DE MAGNESIO",
    "CLORURO DE MAGNESIO",
    "PROTEINA 80% SUERO DE LECHE",
]


def test_detecta_producto_mencionado_solo_en_hilo_previo(monkeypatch) -> None:
    """Compra cancelada de Proteína; el comprador preguntó antes por Carbonato
    de Magnesio en un mensaje previo del mismo hilo y luego solo pide 'la
    ficha técnica' — debe detectarse el producto distinto usando el contexto."""
    monkeypatch.setattr(
        postventa_documentos, "_catalogo_productos_documentados", lambda: _CATALOGO_FAKE
    )
    titulos_comprados = ["Proteína 80% Suero De Leche"]

    contexto = (
        "Hola quería preguntar si tienen disponible el carbonato de magnesio "
        "Me podrías proporcionar la ficha técnica, por favor."
    )
    assert (
        _detectar_producto_no_comprado(contexto, titulos_comprados)
        == "CARBONATO DE MAGNESIO"
    )


def test_no_detecta_producto_distinto_sin_mencion_en_contexto(monkeypatch) -> None:
    monkeypatch.setattr(
        postventa_documentos, "_catalogo_productos_documentados", lambda: _CATALOGO_FAKE
    )
    titulos_comprados = ["Proteína 80% Suero De Leche"]

    assert (
        _detectar_producto_no_comprado(
            "Me podrías proporcionar la ficha técnica, por favor.",
            titulos_comprados,
        )
        is None
    )


def test_no_detecta_producto_distinto_si_pregunta_por_lo_comprado(monkeypatch) -> None:
    monkeypatch.setattr(
        postventa_documentos, "_catalogo_productos_documentados", lambda: _CATALOGO_FAKE
    )
    titulos_comprados = ["Proteína 80% Suero De Leche"]

    assert (
        _detectar_producto_no_comprado(
            "Me podrías proporcionar la ficha técnica de la proteína, por favor.",
            titulos_comprados,
        )
        is None
    )


def test_pregunta_de_uso_no_dispara_docs() -> None:
    """Caso real jul-2026: pregunta técnica de uso NO es solicitud de FT/COA."""
    assert not mensaje_solicita_documentos(
        "Buenos días,  vuelve y se solidifica. Como hago para que me quede aceite liquido?"
    )
    assert not mensaje_solicita_documentos(
        "Si utilizo el de ricino , cual sería la proporcion?"
    )


def test_adjunto_pdf_no_dispara_auto_docs(monkeypatch) -> None:
    """Comprador manda solo un PDF (RUT/comprobante): el texto sintético
    '[Solo adjunto(s)...: X.pdf]' contiene 'pdf' pero NO debe auto-responder
    con fichas técnicas."""
    monkeypatch.setattr(postventa_documentos, "_AUTO_DOCS", True)
    texto = (
        "[Solo adjunto(s) en MeLi: RUT_empresa.pdf] "
        "— revisar conversación en Mercado Libre (p. ej. RUT / factura en PDF)."
    )
    # El guard corta antes de tocar red (refrescar_token_meli no se llama).
    assert (
        postventa_documentos.intentar_respuesta_automatica_documentos(
            "2000007044713785", texto
        )
        == "sin_match"
    )
