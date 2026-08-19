"""Marca de agua en PDFs servidos o generados al vuelo."""

from __future__ import annotations

import io

MARCA_AGUA_DEFAULT = "MCKENNA GROUP"


def aplicar_marca_agua_pdf(
    pdf_bytes: bytes,
    texto: str = MARCA_AGUA_DEFAULT,
    *,
    opacidad: float = 0.16,
    font_size: float | None = None,
) -> bytes:
    """Superpone texto diagonal semi-transparente en cada página del PDF."""
    if not pdf_bytes or not (texto or "").strip():
        return pdf_bytes

    import PyPDF2
    from reportlab.lib.colors import Color
    from reportlab.pdfgen import canvas as rl_canvas

    reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
    writer = PyPDF2.PdfWriter()

    for page in reader.pages:
        w_pt = float(page.mediabox.width)
        h_pt = float(page.mediabox.height)
        fs = font_size if font_size is not None else max(28.0, min(56.0, w_pt * 0.09))

        buf = io.BytesIO()
        c = rl_canvas.Canvas(buf, pagesize=(w_pt, h_pt))
        c.saveState()
        c.setFillColor(Color(0.45, 0.45, 0.45, alpha=max(0.05, min(0.35, opacidad))))
        c.setFont("Helvetica-Bold", fs)
        c.translate(w_pt / 2, h_pt / 2)
        c.rotate(45)
        c.drawCentredString(0, 0, texto.strip())
        c.restoreState()
        c.save()

        overlay_page = PyPDF2.PdfReader(buf).pages[0]
        page.merge_page(overlay_page)
        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
