"""Extracto de una cuenta contable en PDF — el «estado de cuenta» del Libro Mayor.

Es lo que se le entrega al contador o se archiva junto al soporte cuando hay
que explicar una cifra: encabezado con la cuenta y el período, saldo inicial,
cada asiento con su contrapartida y el saldo corrido, totales y el resumen por
tercero.

La contrapartida va en el renglón (no en un anexo aparte) a propósito: un
extracto de 2205 sin ella es una columna de cifras sin causa, y la pregunta que
sigue siempre es «¿contra qué se movió esto?».

Formato apaisado (landscape) porque nueve columnas en carta vertical obligan a
partir el concepto en tres líneas y el documento deja de leerse de un vistazo.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime
from typing import Any

from app.services import empresa as _empresa
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_ACCENT = colors.HexColor("#0c6069")
_INK = colors.HexColor("#0f172a")
_MUTED = colors.HexColor("#64748b")
_LINEA = colors.HexColor("#e2e8f0")
_FONDO = colors.HexColor("#f1f5f9")
_ROJO = colors.HexColor("#b91c1c")


def _cop(valor: float | int | None) -> str:
    v = float(valor or 0)
    signo = "-" if v < 0 else ""
    return f"{signo}${abs(v):,.0f}".replace(",", ".")


def _estilos() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "titulo": ParagraphStyle("t", parent=base["Title"], fontSize=15, textColor=_ACCENT, spaceAfter=2, alignment=0),
        "sub": ParagraphStyle("s", parent=base["Normal"], fontSize=9, textColor=_MUTED, spaceAfter=1),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontSize=11, textColor=_INK, spaceBefore=10, spaceAfter=4),
        "celda": ParagraphStyle("c", parent=base["Normal"], fontSize=6.6, leading=8, textColor=_INK),
        "celda_muted": ParagraphStyle("cm", parent=base["Normal"], fontSize=6.2, leading=7.5, textColor=_MUTED),
        "pie": ParagraphStyle("p", parent=base["Normal"], fontSize=7, textColor=_MUTED),
    }


def _pie(canvas, doc, cuenta: str) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(_MUTED)
    canvas.drawString(1.2 * cm, 1.0 * cm, f"{_empresa.razon_social()} · NIT {_empresa.nit()} · {cuenta}")
    canvas.drawRightString(doc.pagesize[0] - 1.2 * cm, 1.0 * cm, f"Página {canvas.getPageNumber()}")
    canvas.restoreState()


def generar_pdf_extracto(extracto: dict[str, Any], destino: str | None = None) -> str:
    """Escribe el PDF del extracto (tal como lo devuelve
    `contabilidad_mayor.extracto_cuenta`) y devuelve la ruta."""
    est = _estilos()
    cuenta = extracto["cuenta"]
    etiqueta = f"{cuenta['codigo']} · {cuenta['nombre']}"

    if destino is None:
        fd, destino = tempfile.mkstemp(
            prefix=f"extracto_{cuenta['codigo']}_", suffix=".pdf", dir=tempfile.gettempdir()
        )
        os.close(fd)

    doc = SimpleDocTemplate(
        destino,
        pagesize=landscape(letter),
        leftMargin=1.2 * cm,
        rightMargin=1.2 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.6 * cm,
        title=f"Extracto contable {etiqueta}",
        author=_empresa.razon_social(),
    )

    periodo = f"{extracto.get('desde') or 'el inicio'} a {extracto.get('hasta') or 'hoy'}"
    flow: list[Any] = [
        Paragraph(f"Extracto contable — {etiqueta}", est["titulo"]),
        Paragraph(
            f"{_empresa.razon_social()} · NIT {_empresa.nit()} · Período: {periodo} · "
            f"Naturaleza: {cuenta['naturaleza']}"
            + (" · incluye subcuentas" if extracto.get("incluir_subcuentas") else ""),
            est["sub"],
        ),
        Paragraph(f"Generado el {datetime.now():%d/%m/%Y %H:%M}", est["sub"]),
        HRFlowable(width="100%", color=_LINEA, spaceBefore=6, spaceAfter=8),
    ]

    # Qué operación vive en esta cuenta y qué impuestos acarrea. Va en el PDF
    # porque este documento es el que se le manda al contador, y es ahí donde la
    # pregunta «¿qué es este saldo?» aparece sin nadie a quien preguntarle.
    guia = " ".join(x for x in (cuenta.get("descripcion"), cuenta.get("nota_tributaria")) if x)
    if guia:
        flow.append(Paragraph(guia, est["sub"]))
        flow.append(HRFlowable(width="100%", color=_LINEA, spaceBefore=6, spaceAfter=8))

    # Resumen de cabecera: los cuatro números que se buscan primero.
    resumen = Table(
        [
            ["Saldo inicial", "Débitos", "Créditos", "Saldo final"],
            [
                _cop(extracto["saldo_inicial"]),
                _cop(extracto["total_debito"]),
                _cop(extracto["total_credito"]),
                _cop(extracto["saldo_final"]),
            ],
        ],
        colWidths=[6 * cm] * 4,
    )
    resumen.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _FONDO),
                ("TEXTCOLOR", (0, 0), (-1, 0), _MUTED),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 7),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 1), (-1, 1), 11),
                ("TEXTCOLOR", (0, 1), (-1, 1), _INK),
                ("TEXTCOLOR", (3, 1), (3, 1), _ACCENT),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("GRID", (0, 0), (-1, -1), 0.4, _LINEA),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    flow.append(resumen)
    flow.append(Spacer(1, 10))

    encabezado = ["Fecha", "Asiento", "Concepto", "Tercero", "Contrapartida", "Débito", "Crédito", "Saldo"]
    filas: list[list[Any]] = [encabezado]
    filas.append(
        [
            "",
            "",
            Paragraph("<i>Saldo inicial del período</i>", est["celda_muted"]),
            "",
            "",
            "",
            "",
            _cop(extracto["saldo_inicial"]),
        ]
    )
    for m in extracto["movimientos"]:
        concepto = m["concepto"]
        if m.get("descripcion") and m["descripcion"] != concepto:
            concepto = f"{concepto}<br/><font size=5 color='#64748b'>{m['descripcion']}</font>"
        # Las referencias "auto:<hash>" son la clave de deduplicación del
        # auto-posteo, no un número que nadie pueda buscar: solo ensucian.
        ref = m.get("referencia") or ""
        if ref and not ref.startswith("auto:"):
            concepto += f"<br/><font size=5 color='#94a3b8'>{ref}</font>"
        contra = "<br/>".join(
            f"{c['codigo']} {c['nombre'][:24]}" for c in m.get("contrapartida", [])[:4]
        ) or "—"
        filas.append(
            [
                m["fecha"],
                str(m["movimiento_id"]),
                Paragraph(concepto, est["celda"]),
                Paragraph(m.get("tercero_nombre") or "—", est["celda"]),
                Paragraph(contra, est["celda_muted"]),
                _cop(m["debito"]) if m["debito"] else "",
                _cop(m["credito"]) if m["credito"] else "",
                _cop(m["saldo"]),
            ]
        )
    filas.append(
        [
            "",
            "",
            Paragraph("<b>Totales del período</b>", est["celda"]),
            "",
            "",
            _cop(extracto["total_debito"]),
            _cop(extracto["total_credito"]),
            _cop(extracto["saldo_final"]),
        ]
    )

    anchos = [1.7 * cm, 1.3 * cm, 7.2 * cm, 4.2 * cm, 4.6 * cm, 2.6 * cm, 2.6 * cm, 2.8 * cm]
    tabla = Table(filas, colWidths=anchos, repeatRows=1)
    tabla.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _ACCENT),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 7),
                ("FONTSIZE", (0, 1), (-1, -1), 6.6),
                ("ALIGN", (5, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.3, _LINEA),
                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#fafbfc")]),
                ("BACKGROUND", (0, 1), (-1, 1), _FONDO),
                ("BACKGROUND", (0, -1), (-1, -1), _FONDO),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (0, -1), (-1, -1), 0.8, _INK),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    flow.append(tabla)

    if extracto.get("truncado"):
        flow.append(Spacer(1, 6))
        flow.append(
            Paragraph(
                "<b>Atención:</b> el extracto llegó al tope de líneas y quedó recortado. "
                "Acota el período para verlo completo.",
                ParagraphStyle("w", parent=est["pie"], textColor=_ROJO),
            )
        )

    por_tercero = extracto.get("por_tercero") or []
    if len(por_tercero) > 1:
        flow.append(Paragraph("Resumen por tercero", est["h2"]))
        ft: list[list[Any]] = [["Tercero", "Movimientos", "Débito", "Crédito", "Saldo"]]
        for t in por_tercero[:40]:
            ft.append(
                [
                    Paragraph(t["nombre"], est["celda"]),
                    str(t["movimientos"]),
                    _cop(t["debito"]),
                    _cop(t["credito"]),
                    _cop(t["saldo"]),
                ]
            )
        tt = Table(ft, colWidths=[10 * cm, 2.6 * cm, 3.4 * cm, 3.4 * cm, 3.4 * cm], repeatRows=1)
        tt.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), _FONDO),
                    ("TEXTCOLOR", (0, 0), (-1, 0), _MUTED),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                    ("GRID", (0, 0), (-1, -1), 0.3, _LINEA),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        flow.append(tt)

    doc.build(
        flow,
        onFirstPage=lambda c, d: _pie(c, d, etiqueta),
        onLaterPages=lambda c, d: _pie(c, d, etiqueta),
    )
    return destino


def generar_pdf_balance(balance: dict[str, Any], destino: str | None = None) -> str:
    """Balance de comprobación jerárquico (el árbol de `arbol_cuentas`) en PDF,
    con la sangría por nivel del PUC: clase, grupo, cuenta, subcuenta."""
    est = _estilos()
    if destino is None:
        fd, destino = tempfile.mkstemp(prefix="balance_", suffix=".pdf", dir=tempfile.gettempdir())
        os.close(fd)

    doc = SimpleDocTemplate(
        destino,
        pagesize=landscape(letter),
        leftMargin=1.2 * cm,
        rightMargin=1.2 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.6 * cm,
        title="Balance de comprobación",
        author=_empresa.razon_social(),
    )
    periodo = f"{balance.get('desde') or 'el inicio'} a {balance.get('hasta') or 'hoy'}"
    flow: list[Any] = [
        Paragraph("Balance de comprobación por cuenta", est["titulo"]),
        Paragraph(
            f"{_empresa.razon_social()} · NIT {_empresa.nit()} · Período: {periodo} · "
            f"Generado el {datetime.now():%d/%m/%Y %H:%M}",
            est["sub"],
        ),
        Paragraph(
            "✓ Débitos y créditos cuadran" if balance.get("cuadra") else "✗ El balance NO cuadra",
            ParagraphStyle(
                "estado",
                parent=est["sub"],
                textColor=colors.HexColor("#047857") if balance.get("cuadra") else _ROJO,
            ),
        ),
        HRFlowable(width="100%", color=_LINEA, spaceBefore=6, spaceAfter=8),
    ]

    filas: list[list[Any]] = [["Código", "Cuenta", "Saldo inicial", "Débitos", "Créditos", "Saldo final"]]
    estilos_fila: list[tuple] = []

    def _recorrer(nodos: list[dict[str, Any]], profundidad: int) -> None:
        for n in nodos:
            i = len(filas)
            sangria = "&nbsp;" * (profundidad * 4)
            negrita = profundidad <= 1
            nombre = f"{sangria}{n['nombre']}"
            if negrita:
                nombre = f"<b>{nombre}</b>"
            filas.append(
                [
                    n["codigo"],
                    Paragraph(nombre, est["celda"]),
                    _cop(n["saldo_inicial"]),
                    _cop(n["debito"]),
                    _cop(n["credito"]),
                    _cop(n["saldo_final"]),
                ]
            )
            if negrita:
                estilos_fila.append(("BACKGROUND", (0, i), (-1, i), _FONDO))
                estilos_fila.append(("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"))
            _recorrer(n.get("hijos") or [], profundidad + 1)

    _recorrer(balance.get("arbol") or [], 0)
    filas.append(
        [
            "",
            Paragraph("<b>Totales</b>", est["celda"]),
            "",
            _cop(balance.get("total_debito")),
            _cop(balance.get("total_credito")),
            "",
        ]
    )

    tabla = Table(filas, colWidths=[2.2 * cm, 11 * cm, 3.6 * cm, 3.4 * cm, 3.4 * cm, 3.6 * cm], repeatRows=1)
    tabla.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _ACCENT),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.3, _LINEA),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (0, -1), (-1, -1), 0.8, _INK),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                *estilos_fila,
            ]
        )
    )
    flow.append(tabla)
    doc.build(
        flow,
        onFirstPage=lambda c, d: _pie(c, d, "Balance de comprobación"),
        onLaterPages=lambda c, d: _pie(c, d, "Balance de comprobación"),
    )
    return destino
