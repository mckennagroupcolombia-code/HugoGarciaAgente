"""Informe del expediente fiscal de un socio, en PDF, para entregarle al contador.

Es la misma línea de tiempo que muestra el panel (`declarador.cronologia`), pero
en un documento que se puede imprimir, firmar y archivar junto a los soportes.

Cada cifra dice de qué archivo salió y en qué carpeta está, con la ruta relativa
a la carpeta del socio (`01_Declaraciones_Renta_F210/F210_2021.pdf`), para que el
contador pueda abrir el PDF y la carpeta al lado y cruzar sin preguntar nada.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
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
_FONDO = colors.HexColor("#f8fafc")
_ROJO = colors.HexColor("#b91c1c")
_VERDE = colors.HexColor("#047857")

_MESES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)

SITUACION_TEXTO = {
    "corregir": "Corregir la declaración",
    "corregir_sin_calculo": "Corregir · falta calcular el efecto",
    "presentada_sin_efecto": "Revisar con el contador",
    "presentar": "Presentar (está en borrador)",
    "presentar_extemporanea": "Presentar (no se declaró)",
    "por_definir": "Falta saber si se declaró",
    "corregida": "Ya corregida",
    "en_preparacion": "En preparación, se presenta ahora",
    "futura": "Aún no abre el plazo",
    "fuera_alcance": "Fuera del período elegido",
}


def _cop(n) -> str:
    if n is None:
        return "—"
    return "$" + f"{round(float(n)):,}".replace(",", ".")


def _usd(n) -> str:
    if n is None:
        return "—"
    return "US$" + f"{float(n):,.2f}"


def _fecha(iso: str) -> str:
    try:
        d = datetime.strptime(str(iso)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return str(iso or "")
    return f"{d.day} de {_MESES[d.month - 1]} de {d.year}"


def _estilos() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "titulo": ParagraphStyle("titulo", parent=base["Title"], fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=_ACCENT, spaceAfter=2),
        "subtitulo": ParagraphStyle("subtitulo", parent=base["Normal"], fontName="Helvetica", fontSize=10.5, leading=14, textColor=_MUTED),
        "anio": ParagraphStyle("anio", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=16, leading=19, textColor=_ACCENT, spaceBefore=2, spaceAfter=1),
        "h2": ParagraphStyle("h2", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=_INK, spaceBefore=8, spaceAfter=3),
        "h3": ParagraphStyle("h3", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=11, textColor=_MUTED, spaceBefore=4, spaceAfter=2),
        "cuerpo": ParagraphStyle("cuerpo", parent=base["Normal"], fontName="Helvetica", fontSize=9, leading=12.5, textColor=_INK),
        "chico": ParagraphStyle("chico", parent=base["Normal"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=_MUTED),
        "chico_ink": ParagraphStyle("chico_ink", parent=base["Normal"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=_INK),
        "num": ParagraphStyle("num", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=_INK, alignment=TA_RIGHT),
        "ruta": ParagraphStyle("ruta", parent=base["Normal"], fontName="Courier", fontSize=6.8, leading=9, textColor=_MUTED),
    }


def _pie(canvas, doc, titular: str) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(_MUTED)
    canvas.drawString(2 * cm, 1.2 * cm, f"{titular} · expediente de criptoactivos")
    canvas.drawRightString(letter[0] - 2 * cm, 1.2 * cm, f"Página {doc.page}")
    canvas.setStrokeColor(_LINEA)
    canvas.line(2 * cm, 1.5 * cm, letter[0] - 2 * cm, 1.5 * cm)
    canvas.restoreState()


def _tabla_datos(filas: list[tuple[str, str]], est: dict, ancho: float) -> Table:
    """Etiqueta a la izquierda, cifra a la derecha, con línea tenue entre filas."""
    data = [[Paragraph(a, est["chico"]), Paragraph(b, est["num"])] for a, b in filas]
    t = Table(data, colWidths=[ancho * 0.56, ancho * 0.44])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("LINEBELOW", (0, 0), (-1, -2), 0.3, _LINEA),
            ]
        )
    )
    return t


def _bloque_anio(a: dict[str, Any], est: dict, ancho: float) -> list:
    """Un año gravable: cabecera, las tres columnas, la línea de tiempo y los soportes."""
    out: list = []
    d = a["declarado"]
    c = a["cripto"]
    corr = a.get("correccion")
    situacion = SITUACION_TEXTO.get(a.get("situacion") or "", a.get("estado") or "")

    cab = [
        [
            Paragraph(f"<b>{a['ano']}</b>", est["anio"]),
            Paragraph(
                f"<b>{situacion}</b>"
                + (f"<br/><font size=7 color='#64748b'>Declarada el {_fecha(d['presentada_en'])} · Formulario {d['formulario'] or '—'}</font>" if d.get("presentada_en") else ""),
                est["cuerpo"],
            ),
            Paragraph(
                f"<b><font color='#b91c1c'>Corregir cuesta {_cop(corr['total_estimado'])}</font></b>" if corr and (corr.get("mayor_valor") or 0) > 0 else "",
                est["num"],
            ),
        ]
    ]
    t = Table(cab, colWidths=[ancho * 0.12, ancho * 0.55, ancho * 0.33])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BACKGROUND", (0, 0), (-1, -1), _FONDO),
                ("LINEBELOW", (0, 0), (-1, -1), 0.8, _ACCENT),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    out.append(t)
    if a.get("accion"):
        out.append(Spacer(1, 3))
        out.append(Paragraph(f"<b>Qué hacer:</b> {a['accion']}", est["cuerpo"]))

    # Tres columnas: declarado · real · efecto de corregir
    col = (ancho - 2 * 0.5 * cm) / 3
    izq = [Paragraph("1 · LO QUE DICE LA DECLARACIÓN", est["h3"])]
    if d.get("presentada_en") or d.get("patrimonio_bruto") is not None:
        izq.append(
            _tabla_datos(
                [
                    ("Patrimonio bruto (r. 29)", _cop(d["patrimonio_bruto"])),
                    ("Deudas (r. 30)", _cop(d["deudas"])),
                    ("Renta líquida gravable", _cop(d["renta_liquida"])),
                    ("Impuesto a cargo", _cop(d["impuesto_pagado"])),
                ],
                est,
                col,
            )
        )
        izq.append(Paragraph("<font color='#b91c1c'>Sin criptoactivos: ni en el patrimonio ni en los ingresos.</font>", est["chico"]))
    else:
        izq.append(Paragraph("No hay declaración presentada para este año." if a.get("situacion") != "en_preparacion" else "Todavía no se presenta; se está preparando.", est["chico"]))

    med = [Paragraph("2 · LO QUE REALMENTE PASÓ", est["h3"])]
    med.append(
        _tabla_datos(
            [
                ("Tenencia en Binance al 31-dic", _cop(c["tenencia_cop"])),
                ("&nbsp;&nbsp;a costo fiscal", f"{_usd(c['tenencia_usd'])}" + (f" · TRM {c['trm']:,.2f}".replace(",", ".") if c.get("trm") else "")),
                ("Ganancia o pérdida realizada", _cop(c["efecto"])),
                ("Operaciones de disposición", f"{c['eventos']:,}".replace(",", ".") if c.get("eventos") else "—"),
            ],
            est,
            col,
        )
    )
    if c.get("detalle"):
        med.append(Spacer(1, 2))
        med.append(Paragraph(" · ".join(f"{x['coin']} {x['cantidad']:,.4f}".rstrip("0").rstrip(".") for x in c["detalle"][:6]), est["chico"]))
    if d.get("patrimonio_bruto") is not None and c.get("tenencia_cop") is not None:
        real = d["patrimonio_bruto"] + c["tenencia_cop"]
        med.append(Spacer(1, 3))
        med.append(
            Paragraph(
                f"<b><font color='#b91c1c'>Patrimonio bruto real: {_cop(real)}</font></b><br/>"
                f"({_cop(d['patrimonio_bruto'])} declarado + {_cop(c['tenencia_cop'])} en cripto)",
                est["chico_ink"],
            )
        )

    der = [Paragraph("3 · EFECTO DE CORREGIR", est["h3"])]
    if corr and corr.get("uvt_cargada"):
        filas = [
            ("Renta líquida corregida", _cop(corr["rlg_corregida"])),
            ("Impuesto corregido", _cop(corr["impuesto_corregido"])),
        ]
        if (corr.get("mayor_valor") or 0) > 0:
            filas += [
                ("Mayor impuesto", _cop(corr["mayor_valor"])),
                ("Sanción por corrección (10 %)", _cop(corr["sancion_correccion_10"])),
                (f"Intereses de mora ({corr['intereses_dias']} días)", _cop(corr["intereses_mora"])),
                ("<b>Total</b>", f"<b>{_cop(corr['total_estimado'])}</b>"),
            ]
        der.append(_tabla_datos(filas, est, col))
        if (corr.get("mayor_valor") or 0) == 0:
            der.append(Paragraph("<font color='#047857'>Incluir la cripto no genera impuesto adicional este año.</font>", est["chico"]))
        elif (corr.get("mayor_valor") or 0) < 0:
            der.append(Paragraph(f"La corrección da {_cop(-corr['mayor_valor'])} a favor; evaluar el término del Art. 589 ET.", est["chico"]))
    else:
        der.append(Paragraph("Se liquida en la declaración que se presenta ahora." if a.get("situacion") == "en_preparacion" else "Sin cálculo para este año.", est["chico"]))
    banco = a.get("banco") or {}
    der.append(Paragraph("RESPALDO BANCARIO", est["h3"]))
    der.append(Paragraph(f"Cuenta de ahorros: {banco.get('meses_extracto', 0)}/12 meses de extracto.", est["chico"]))
    tj = banco.get("tarjeta") or {}
    if tj:
        cons = (tj.get("consumos") or {}).get("COP", {}).get("valor")
        av = tj.get("avances")
        der.append(
            Paragraph(
                f"Tarjeta: consumos {_cop(cons)}"
                + (f" + {_usd((tj.get('consumos') or {}).get('USD', {}).get('valor'))}" if (tj.get("consumos") or {}).get("USD") else "")
                + " · "
                + (f"{av['operaciones']} avance(s) en efectivo" if av else "sin avances"),
                est["chico"],
            )
        )

    tres = Table([[izq, med, der]], colWidths=[col + 0.5 * cm, col + 0.5 * cm, col])
    tres.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8)]))
    out += [Spacer(1, 5), tres]

    # Línea de tiempo: solo los hitos verificables contra el banco
    clave = [h for h in a.get("hitos", []) if h["tipo"] in ("declaracion", "credito") or (h["tipo"] == "p2p" and (h.get("monto") or 0) >= 1_000_000)]
    if clave:
        out.append(Paragraph(f"MOVIMIENTOS DEL AÑO CON RASTRO BANCARIO ({len(clave)} de {len(a['hitos'])})", est["h3"]))
        data = [
            [
                Paragraph(_fecha(h["fecha"]).replace(" de ", " "), est["chico"]),
                Paragraph(f"<b>{h['titulo']}</b><br/><font size=6.5 color='#64748b'>{h['detalle']}</font>", est["chico_ink"]),
                Paragraph(_cop(h["monto"]) if h.get("monto") else "", est["num"]),
            ]
            for h in clave
        ]
        t = Table(data, colWidths=[ancho * 0.15, ancho * 0.68, ancho * 0.17], repeatRows=0)
        t.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2),
                    ("LINEBELOW", (0, 0), (-1, -2), 0.3, _LINEA),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ]
            )
        )
        out.append(t)

    # Soportes con su ruta en la carpeta
    docs = a.get("documentos") or []
    if docs:
        out.append(Paragraph(f"SOPORTES DE {a['ano']} ({len(docs)}) — rutas relativas a la carpeta del expediente", est["h3"]))
        data = []
        for doc in docs:
            data.append([Paragraph(doc["categoria_label"], est["chico"]), Paragraph(doc["ruta"], est["ruta"])])
        t = Table(data, colWidths=[ancho * 0.26, ancho * 0.74])
        t.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 1.2),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ]
            )
        )
        out.append(t)

    if a.get("hallazgos"):
        out.append(Paragraph("PREGUNTAS ABIERTAS DE ESTE AÑO", est["h3"]))
        for h in a["hallazgos"]:
            out.append(Paragraph(f"<b>[{h['severidad']}] {h['titulo']}.</b> {h['detalle'][:600]}", est["chico"]))
            out.append(Spacer(1, 2))

    out.append(Spacer(1, 10))
    return out


def generar_informe(crono: dict[str, Any], destino: str) -> str:
    """Arma el PDF completo a partir de `declarador.cronologia()`."""
    est = _estilos()
    ancho = letter[0] - 4 * cm
    titular = crono["titular"]["nombre"]
    story: list = []

    story.append(Paragraph("Expediente fiscal de criptoactivos", est["titulo"]))
    story.append(
        Paragraph(
            f"<b>{titular}</b>"
            + (f" · CC {crono['titular']['cedula']}" if crono["titular"].get("cedula") else "")
            + (f" · cuenta Binance {crono['titular']['binance_uid']}" if crono["titular"].get("binance_uid") else ""),
            est["subtitulo"],
        )
    )
    story.append(
        Paragraph(
            f"Informe para el contador · generado el {_fecha(crono['generado'][:10])} desde el panel McKenna (Contabilidad · Socios)",
            est["chico"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=0.8, color=_ACCENT))
    story.append(Spacer(1, 8))

    story.append(
        Paragraph(
            "Las declaraciones de renta ya presentadas no incluyen los criptoactivos: ni la tenencia en el patrimonio bruto "
            "ni la ganancia realizada en los ingresos. Este informe reconstruye, año por año, qué se declaró, qué pasó en "
            "realidad y qué costaría corregirlo, señalando para cada cifra el archivo que la respalda.",
            est["cuerpo"],
        )
    )
    story.append(Spacer(1, 8))

    t = crono.get("totales") or {}
    if t.get("total_estimado"):
        tasa = round((crono.get("parametros") or {}).get("tasa_mora_anual", 0) * 1000) / 10
        data = [
            [Paragraph("<b>TOTAL A REGULARIZAR POR LOS AÑOS YA PRESENTADOS</b>", est["cuerpo"]), Paragraph(f"<b><font size=15 color='#b91c1c'>{_cop(t['total_estimado'])}</font></b>", est["num"])],
            [
                Paragraph(
                    f"Mayor impuesto {_cop(t['mayor_valor'])} + sanción por corrección del 10 % (Art. 644 ET) {_cop(t['sancion_correccion_10'])} "
                    f"+ intereses de mora {_cop(t['intereses_mora'])}, estimados al {tasa} % anual desde el vencimiento de cada año. "
                    "Los intereses definitivos los liquida la DIAN."
                    + (f" No incluye {_cop(t['a_favor_no_reclamable'])} a favor por la pérdida de un año, sujeto al término del Art. 589 ET." if t.get("a_favor_no_reclamable") else ""),
                    est["chico"],
                ),
                "",
            ],
        ]
        tab = Table(data, colWidths=[ancho * 0.62, ancho * 0.38])
        tab.setStyle(
            TableStyle(
                [
                    ("SPAN", (0, 1), (1, 1)),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fef2f2")),
                    ("BOX", (0, 0), (-1, -1), 0.8, _ROJO),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(tab)
        story.append(Spacer(1, 10))

    # Resumen por año
    story.append(Paragraph("Resumen por año gravable", est["h2"]))
    enc = ["Año", "Situación", "Patrim. declarado", "Cripto omitida 31-dic", "Efecto del año", "Costo de corregir"]
    data = [[Paragraph(f"<b>{x}</b>", est["chico"]) for x in enc]]
    for a in crono["anios"]:
        corr = a.get("correccion") or {}
        data.append(
            [
                Paragraph(str(a["ano"]), est["chico_ink"]),
                Paragraph(SITUACION_TEXTO.get(a.get("situacion") or "", "—"), est["chico"]),
                Paragraph(_cop(a["declarado"]["patrimonio_bruto"]), est["num"]),
                Paragraph(_cop(a["cripto"]["tenencia_cop"]), est["num"]),
                Paragraph(_cop(a["cripto"]["efecto"]), est["num"]),
                Paragraph(_cop(corr["total_estimado"]) if corr.get("total_estimado") else "—", est["num"]),
            ]
        )
    tab = Table(data, colWidths=[ancho * 0.07, ancho * 0.24, ancho * 0.17, ancho * 0.19, ancho * 0.16, ancho * 0.17], repeatRows=1)
    tab.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BACKGROUND", (0, 0), (-1, 0), _FONDO),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, _ACCENT),
                ("LINEBELOW", (0, 1), (-1, -2), 0.3, _LINEA),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(tab)
    story.append(Spacer(1, 8))

    # Cómo está organizada la carpeta
    story.append(Paragraph("Dónde está cada soporte", est["h2"]))
    story.append(
        Paragraph(
            "Los archivos que sustentan este informe están en la carpeta del expediente, en subcarpetas numeradas. "
            "Cada soporte se cita en este documento con su ruta relativa a esa carpeta.",
            est["cuerpo"],
        )
    )
    carpetas: dict[str, int] = {}
    for a in crono["anios"]:
        for doc in a["documentos"]:
            carpetas[doc["ruta"].split("/")[0]] = carpetas.get(doc["ruta"].split("/")[0], 0) + 1
    for doc in crono.get("sin_ano", []):
        carpetas[doc["ruta"].split("/")[0]] = carpetas.get(doc["ruta"].split("/")[0], 0) + 1
    data = [[Paragraph("<b>Carpeta</b>", est["chico"]), Paragraph("<b>Archivos citados</b>", est["chico"])]]
    for nombre in sorted(carpetas):
        data.append([Paragraph(nombre, est["ruta"]), Paragraph(str(carpetas[nombre]), est["num"])])
    tab = Table(data, colWidths=[ancho * 0.75, ancho * 0.25])
    tab.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BACKGROUND", (0, 0), (-1, 0), _FONDO),
                ("LINEBELOW", (0, 0), (-1, -2), 0.3, _LINEA),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(Spacer(1, 4))
    story.append(tab)

    for a in crono["anios"]:
        story.append(PageBreak())
        story += _bloque_anio(a, est, ancho)

    if crono.get("sin_ano"):
        story.append(PageBreak())
        story.append(Paragraph("Soportes que cubren todo el período", est["h2"]))
        story.append(
            Paragraph(
                "Cálculos, informes y evidencia que no pertenecen a un año concreto: el motor de costo fiscal, "
                "la TRM diaria usada en cada conversión y la evidencia extraída por API de Binance.",
                est["cuerpo"],
            )
        )
        story.append(Spacer(1, 4))
        data = [[Paragraph(d["categoria_label"], est["chico"]), Paragraph(d["ruta"], est["ruta"])] for d in crono["sin_ano"]]
        tab = Table(data, colWidths=[ancho * 0.26, ancho * 0.74])
        tab.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 1.2),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ]
            )
        )
        story.append(tab)

    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_LINEA))
    story.append(
        Paragraph(
            "Este informe lo genera el panel a partir de los documentos cargados y del motor de costo fiscal FIFO. "
            "No reemplaza el criterio profesional del contador: la vía de corrección, las sanciones aplicables y los "
            "intereses definitivos los determina él con la normativa y el liquidador oficial de la DIAN.",
            est["chico"],
        )
    )

    os.makedirs(os.path.dirname(destino) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=os.path.dirname(destino) or ".")
    os.close(fd)
    doc = SimpleDocTemplate(
        tmp,
        pagesize=letter,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=1.8 * cm,
        bottomMargin=2 * cm,
        title=f"Expediente fiscal de criptoactivos — {titular}",
        author="McKenna Group · panel de operaciones",
    )
    try:
        doc.build(story, onFirstPage=lambda c, d_: _pie(c, d_, titular), onLaterPages=lambda c, d_: _pie(c, d_, titular))
        os.replace(tmp, destino)
        try:
            os.chmod(destino, 0o666)
        except OSError:
            pass
    except Exception:
        if os.path.isfile(tmp):
            os.unlink(tmp)
        raise
    return destino
