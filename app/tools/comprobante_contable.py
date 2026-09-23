"""Comprobante de contabilidad de un asiento del Libro Mayor, en PDF y en imagen.

Es la «captura» que acompaña la respuesta a un proveedor (hoy, la cuenta de
cobro del contador, ver `app/services/cuenta_cobro_contador.py`): muestra el
asiento tal como quedó en el libro propio —código PUC, ruta del PUC (clase ›
grupo › cuenta), tercero, débitos y créditos con sumas iguales— y el resumen
de lo causado, lo retenido y lo pagado.

Misma identidad que la cotización (`cotizacion_pdf.py`: Montserrat, turquesa de
la web, logotipo de la factura de Alegra). Solo lectura: no toca el libro.

Los números de cuenta bancaria de McKenna se enmascaran (`****0974`): el
documento sale de la empresa y el proveedor no los necesita.
"""
from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.tools import cotizacion_pdf as marca


def _cop(n) -> str:
    v = round(float(n or 0))
    return ("-" if v < 0 else "") + "$" + f"{abs(v):,}".replace(",", ".")


def _esc(s) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _enmascarar(texto: str) -> str:
    """Oculta números de cuenta (8+ dígitos seguidos), deja los 4 últimos."""
    return re.sub(r"\b(\d{4,})(\d{4})\b", lambda m: "****" + m.group(2), texto or "")


def _ruta_puc(codigo: str) -> str:
    """«5 Gastos › 51 Operacionales de administración › 5110 Honorarios»."""
    import app.services.contabilidad_core as cc
    from app.services.contabilidad_mayor import _nombre_sintetico

    partes = []
    with cc._conn() as con:
        for n in (1, 2, 4):
            if len(codigo) <= n:
                break
            c = codigo[:n]
            r = con.execute("SELECT nombre FROM cc_plan_cuentas WHERE codigo=?", (c,)).fetchone()
            partes.append(f"{c} {r['nombre'] if r else _nombre_sintetico(c)}")
    return " › ".join(partes)


def estilos() -> dict[str, ParagraphStyle]:
    f = marca._fuentes()
    base = dict(fontName=f["regular"], textColor=marca.TINTA, fontSize=8.5, leading=11)
    return {
        "titulo": ParagraphStyle("t", **{**base, "fontName": f["bold"], "fontSize": 14, "leading": 17,
                                         "textColor": marca.ACENTO_OSCURO, "alignment": TA_RIGHT}),
        "meta": ParagraphStyle("m", **{**base, "fontSize": 8.5, "textColor": marca.TEXTO_SUAVE,
                                       "alignment": TA_RIGHT}),
        "rotulo": ParagraphStyle("r", **{**base, "fontName": f["semibold"], "fontSize": 7,
                                         "textColor": marca.TEXTO_SUAVE, "leading": 9}),
        "cuerpo": ParagraphStyle("c", **base),
        "fuerte": ParagraphStyle("f", **{**base, "fontName": f["semibold"]}),
        "cab": ParagraphStyle("h", **{**base, "fontName": f["semibold"], "fontSize": 7.5,
                                      "textColor": colors.white}),
        "cab_der": ParagraphStyle("hd", **{**base, "fontName": f["semibold"], "fontSize": 7.5,
                                           "textColor": colors.white, "alignment": TA_RIGHT}),
        "codigo": ParagraphStyle("cod", **{**base, "fontName": f["bold"], "textColor": marca.ACENTO_OSCURO}),
        "ruta": ParagraphStyle("ru", **{**base, "fontSize": 6.5, "leading": 8, "textColor": marca.TEXTO_SUAVE}),
        "num": ParagraphStyle("n", **{**base, "alignment": TA_RIGHT}),
        "num_fuerte": ParagraphStyle("nf", **{**base, "fontName": f["bold"], "alignment": TA_RIGHT}),
        "pie": ParagraphStyle("p", **{**base, "fontSize": 6.5, "leading": 8.5, "textColor": marca.TEXTO_SUAVE}),
        "seccion": ParagraphStyle("s", **{**base, "fontName": f["bold"], "fontSize": 10.5, "leading": 13,
                                          "textColor": marca.ACENTO_OSCURO, "spaceBefore": 4, "spaceAfter": 2}),
        "nota": ParagraphStyle("no", **{**base, "fontSize": 8, "leading": 10.5, "textColor": marca.TEXTO_SUAVE}),
        "ok": ParagraphStyle("ok", **{**base, "fontName": f["bold"], "textColor": marca.ACENTO,
                                      "alignment": TA_RIGHT}),
    }


def cabecera(titulo: str, lineas: list[str], st: dict, ancho: float) -> list:
    """Logotipo a la izquierda, título y datos a la derecha, filete turquesa debajo."""
    from app.services import empresa

    logo_png, aspecto = marca._logo()
    celda_logo = (Image(io.BytesIO(logo_png), width=5.2 * cm, height=5.2 * cm / aspecto)
                  if logo_png else Paragraph(_esc(empresa.razon_social()), st["fuerte"]))
    celda_logo.hAlign = "LEFT"
    meta = [Paragraph(_esc(titulo), st["titulo"])] + [Paragraph(x, st["meta"]) for x in lineas]
    cab = Table([[celda_logo, meta]], colWidths=[ancho * 0.42, ancho * 0.58])
    cab.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    linea = Table([[""]], colWidths=[ancho], rowHeights=[2])
    linea.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), marca.ACENTO)]))
    return [cab, Spacer(1, 8), linea, Spacer(1, 10)]


def tabla_datos(datos: list[tuple[str, str]], st: dict, ancho: float) -> Table:
    """Rótulo / valor sobre fondo tenue (tercero, concepto, soporte…)."""
    filas = [[Paragraph(_esc(k), st["rotulo"]),
              Paragraph(_esc(v), st["ruta"] if k in ("CUDS",) else st["cuerpo"])] for k, v in datos]
    t = Table(filas, colWidths=[2.6 * cm, ancho - 2.6 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), marca.TINTE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, marca.BORDE),
    ]))
    return t


def tabla_asiento(lineas: list[dict], st: dict, ancho: float, *, rotulo_codigo: str = "CÓDIGO PUC") -> Table:
    """Asiento en partida doble con sumas iguales.

    Cada línea: `codigo`, `cuenta`, `ruta` (opcional), `detalle` (opcional),
    `tercero` (opcional), `debito`, `credito`.
    """
    w = [2.3 * cm, 7.0 * cm, 3.4 * cm, 2.7 * cm, 2.7 * cm]
    w[1] = ancho - sum(w) + w[1]
    filas = [[Paragraph(rotulo_codigo, st["cab"]), Paragraph("CUENTA", st["cab"]),
              Paragraph("TERCERO", st["cab"]), Paragraph("DÉBITO", st["cab_der"]),
              Paragraph("CRÉDITO", st["cab_der"])]]
    for ln in lineas:
        celda = [Paragraph(_esc(ln["cuenta"]), st["fuerte"])]
        if ln.get("ruta"):
            celda.append(Paragraph(_esc(ln["ruta"]), st["ruta"]))
        if ln.get("detalle"):
            celda.append(Paragraph(_esc(_enmascarar(ln["detalle"])), st["ruta"]))
        filas.append([
            Paragraph(_esc(ln.get("codigo") or "—"), st["codigo"]),
            celda,
            Paragraph(_esc(ln.get("tercero") or "—"), st["ruta"]),
            Paragraph(_cop(ln["debito"]) if ln.get("debito") else "", st["num"]),
            Paragraph(_cop(ln["credito"]) if ln.get("credito") else "", st["num"]),
        ])
    td = round(sum(float(x.get("debito") or 0) for x in lineas), 2)
    tc = round(sum(float(x.get("credito") or 0) for x in lineas), 2)
    filas.append(["", Paragraph("SUMAS IGUALES" if abs(td - tc) < 0.5 else "DESCUADRE", st["fuerte"]), "",
                  Paragraph(_cop(td), st["num_fuerte"]), Paragraph(_cop(tc), st["num_fuerte"])])
    t = Table(filas, colWidths=w, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), marca.ACENTO_OSCURO),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, marca.BORDE),
        ("BACKGROUND", (0, -1), (-1, -1), marca.TINTE),
        ("LINEABOVE", (0, -1), (-1, -1), 1, marca.ACENTO),
    ]))
    return t


def lineas_libro(mov: dict) -> list[dict]:
    """Las líneas de un asiento del Libro Mayor en el formato de `tabla_asiento`."""
    return [{"codigo": ln["cuenta_codigo"], "cuenta": ln["cuenta_nombre"], "ruta": _ruta_puc(ln["cuenta_codigo"]),
             "detalle": ln.get("descripcion") or "", "tercero": ln.get("tercero_nombre") or "",
             "debito": ln["debito"], "credito": ln["credito"]} for ln in mov["lineas"]]


def resumen_asiento(mov: dict) -> dict[str, float]:
    """Causado, retenido, pagado y saldo por pagar al tercero, leídos del asiento."""
    ls = mov["lineas"]
    return {
        "causado": sum(ln["debito"] for ln in ls if str(ln["cuenta_codigo"])[:1] in "567"),
        "retenido": sum(ln["credito"] for ln in ls if str(ln["cuenta_codigo"]).startswith("236")),
        "pagado": sum(ln["credito"] for ln in ls if str(ln["cuenta_codigo"]).startswith("11")),
        "por_pagar": sum(ln["credito"] - ln["debito"] for ln in ls
                         if str(ln["cuenta_codigo"])[:2] in ("22", "23")
                         and not str(ln["cuenta_codigo"]).startswith("236")),
    }


def generar_pdf(movimiento_id: int, *, documento_soporte: dict | None = None,
                solicitud: dict | None = None) -> bytes:
    """PDF del comprobante del asiento `movimiento_id` (una página, solo el Libro Mayor).

    `documento_soporte`: fila de `cc_doc_soporte` (número y CUDS) si el asiento lo tiene.
    `solicitud`: la solicitud de pago de la que nació el asiento (para la referencia).
    """
    import app.services.contabilidad_core as cc
    from app.services import empresa

    mov = cc.obtener_movimiento(int(movimiento_id))
    if not mov:
        raise ValueError(f"No existe el asiento {movimiento_id}")
    st = estilos()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=1.8 * cm, rightMargin=1.8 * cm,
                            topMargin=1.5 * cm, bottomMargin=1.5 * cm,
                            title=f"Comprobante de contabilidad {movimiento_id}",
                            author=empresa.razon_social())
    ancho = letter[0] - 3.6 * cm
    story = cabecera("COMPROBANTE DE CONTABILIDAD", [
        f"Asiento N.º <b>{mov['id']}</b>  ·  Fecha <b>{_esc(mov['fecha'])}</b>",
        f"{_esc(empresa.razon_social())}  ·  NIT {_esc(empresa.nit())}",
    ], st, ancho)
    t = mov.get("tercero") or {}
    ref = []
    if solicitud:
        ref.append(f"Solicitud de pago #{solicitud.get('id')}")
    if documento_soporte and documento_soporte.get("numero"):
        ref.append(f"Documento soporte {documento_soporte['numero']}")
    if not ref and mov.get("referencia"):
        ref.append(mov["referencia"])
    datos = [
        ("TERCERO", f"{t.get('nombre', '')}" + (f"  ·  CC/NIT {t.get('identificacion')}" if t.get("identificacion") else "")),
        ("CONCEPTO", _enmascarar(mov.get("concepto", ""))),
        ("SOPORTE", "  ·  ".join(ref) or "—"),
    ]
    if documento_soporte and documento_soporte.get("cuds"):
        datos.append(("CUDS", documento_soporte["cuds"]))
    story += [tabla_datos(datos, st, ancho), Spacer(1, 14),
              tabla_asiento(lineas_libro(mov), st, ancho), Spacer(1, 14)]

    r = resumen_asiento(mov)
    resumen = [("Valor causado", r["causado"]), ("Retenciones practicadas", r["retenido"]),
               ("Pagado (salida de bancos)", r["pagado"]), ("Saldo por pagar al tercero", r["por_pagar"])]
    tres = Table([[Paragraph(k, st["cuerpo"]), Paragraph(_cop(v), st["num_fuerte" if i == 2 else "num"])]
                  for i, (k, v) in enumerate(resumen)], colWidths=[5.2 * cm, 3.2 * cm], hAlign="RIGHT")
    tres.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -2), 0.4, marca.BORDE),
                              ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [tres, Spacer(1, 18)]
    story.append(Paragraph(
        f"Registrado en el Libro Mayor de {_esc(empresa.razon_social())} (partida doble, Plan Único de "
        f"Cuentas — Decreto 2650 de 1993). Estado del asiento: {_esc(mov.get('estado') or 'confirmado')}. "
        f"Generado el {datetime.now():%Y-%m-%d %H:%M}. Los números de cuenta bancaria se muestran "
        "enmascarados.", st["pie"]))
    doc.build(story)
    return buf.getvalue()


def pdf_a_png(pdf: bytes, *, ppp: int = 150, pagina: int = 1) -> bytes | None:
    """Una página del PDF como PNG (la «captura»). None si no hay pdftoppm."""
    if not shutil.which("pdftoppm"):
        return None
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "c.pdf"
        src.write_bytes(pdf)
        subprocess.run(["pdftoppm", "-png", "-r", str(ppp), "-f", str(pagina), "-l", str(pagina), "-singlefile",
                        str(src), str(Path(d) / "c")], check=True, timeout=60)
        png = Path(d) / "c.png"
        if not png.exists():
            return None
        # Recorta el blanco sobrante bajo el contenido: es una captura, no una hoja.
        try:
            from PIL import Image as PILImage, ImageChops

            with PILImage.open(png) as img:
                img = img.convert("RGB")
                bbox = ImageChops.difference(img, PILImage.new("RGB", img.size, "white")).getbbox()
                if bbox:
                    m = int(ppp * 0.45)
                    img = img.crop((0, 0, img.size[0], min(img.size[1], bbox[3] + m)))
                out = io.BytesIO()
                img.save(out, format="PNG", optimize=True)
                return out.getvalue()
        except Exception:
            return png.read_bytes()
