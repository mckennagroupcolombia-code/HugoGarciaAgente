"""Tests para marca de agua en PDFs técnicos."""

from __future__ import annotations

import io

from reportlab.pdfgen import canvas


def _pdf_minimo() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 720, "Documento de prueba")
    c.save()
    return buf.getvalue()


def test_aplicar_marca_agua_pdf_mantiene_paginas():
    from app.services.pdf_watermark import aplicar_marca_agua_pdf
    import PyPDF2

    original = _pdf_minimo()
    marcado = aplicar_marca_agua_pdf(original, "MCKENNA GROUP")
    assert marcado.startswith(b"%PDF")
    reader = PyPDF2.PdfReader(io.BytesIO(marcado))
    assert len(reader.pages) == 1


def test_aplicar_marca_agua_pdf_bytes_vacios():
    from app.services.pdf_watermark import aplicar_marca_agua_pdf

    assert aplicar_marca_agua_pdf(b"") == b""
