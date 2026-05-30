"""
Chat web (burbuja): COA, ficha técnica y ficha de seguridad desde Drive o correo.
"""

from __future__ import annotations

import re

from app.postventa_documentos import mensaje_solicita_documentos
from app.services.drive_documentos import buscar_coa_pdf, buscar_ficha_tecnica_pdf, buscar_sds_pdf
from app.web_chat_intents import wa_publico

_SITE_GUIAS = "https://mckennagroup.co/guias"
_SITE_TIENDA = "https://mckennagroup.co/tienda"

_PREFIJOS_LISTA = re.compile(
    r"^(?:buenos?\s+d[ií]as|buenas?\s+(?:tardes|noches)|hola|vec[ií]|por\s+favor|"
    r"podr[ií]a|podrian|quisiera|necesito|me\s+interesa|perfecto|listo|gracias|"
    r"facilitar(?:me)?|enviar(?:me)?|compartir|solicito)\b[\s,;:.-]*",
    re.IGNORECASE,
)

_RUIDO_DOC = re.compile(
    r"\b(?:certificado|certificados|coa|coay|ficha|fichas|t[eé]cnica|t[eé]cnicas|"
    r"seguridad|msds|hoja|documentaci[oó]n|analisis|an[aá]lisis|actualmente|"
    r"manejando|productos?|materia\s+prima|por\s+favor|muchas\s+gracias|gracias)\b",
    re.IGNORECASE,
)


def mensaje_pide_documentacion_web(texto: str) -> bool:
    t = (texto or "").strip()
    if not t:
        return False
    if mensaje_solicita_documentos(t):
        return True
    low = re.sub(r"\s+", " ", t.lower())
    return bool(
        re.search(
            r"\b(ficha\s+t[eé]cnica|ficha\s+de\s+seguridad|hoja\s+de\s+seguridad)\b",
            low,
        )
    )


def _limpiar_fragmento_producto(fragmento: str) -> str:
    f = (fragmento or "").strip()
    while True:
        nuevo = _PREFIJOS_LISTA.sub("", f).strip(" ,;.-")
        if nuevo == f:
            break
        f = nuevo
    f = _RUIDO_DOC.sub(" ", f)
    f = re.sub(r"\s{2,}", " ", f).strip(" ,;.-")
    return f


def extraer_nombres_productos_documento(texto: str) -> list[str]:
    """Extrae nombres de ingredientes/productos en mensajes con listas o varios ítems."""
    raw = (texto or "").strip()
    if not raw:
        return []

    candidatos: list[str] = []
    partes = re.split(r"[,;\n]|(?:\s+y\s+|\s+e\s+)", raw, flags=re.IGNORECASE)
    for parte in partes:
        limpio = _limpiar_fragmento_producto(parte)
        if len(limpio) >= 3 and not re.match(
            r"^(?:de|del|la|el|los|las|un|una|unos|unas)$", limpio, re.I
        ):
            candidatos.append(limpio)

    vistos: set[str] = set()
    out: list[str] = []
    for c in candidatos:
        key = c.lower()
        if key in vistos:
            continue
        vistos.add(key)
        out.append(c)
    return out[:12]


def _productos_desde_historial(historial_texto: str) -> list[str]:
    """Lista larga de ingredientes en turnos anteriores del mismo chat."""
    if not historial_texto:
        return []
    low = historial_texto.lower()
    if not any(
        sep in low
        for sep in (",", " y ", " e ", "ácido", "acido", "extracto", "l-", "taurina")
    ):
        return []
    return extraer_nombres_productos_documento(historial_texto)


def _nota_whatsapp_opcional() -> str:
    display, digits = wa_publico()
    return (
        f"\n\nPara seguimiento de pedido o cotización formal con asesor: WhatsApp {display} "
        f"(https://wa.me/{digits})."
    )


def manejar_documentos_web(
    *,
    user_message: str,
    historial_texto: str = "",
) -> str | None:
    """
    Si piden COA/FT/MSDS, intenta enlaces Drive; si no hay PDF, pide correo y guías web.
    """
    pide_ahora = mensaje_pide_documentacion_web(user_message)
    pide_en_hist = mensaje_pide_documentacion_web(historial_texto)
    productos_msg = extraer_nombres_productos_documento(user_message)
    lista_ingredientes = len(productos_msg) >= 3

    if not pide_ahora and not (pide_en_hist and lista_ingredientes):
        return None

    productos = list(productos_msg)
    if len(productos) <= 1:
        for p in _productos_desde_historial(historial_texto):
            if p not in productos:
                productos.append(p)

    if not productos:
        return (
            "Veci, con gusto le enviamos COA y ficha técnica (y ficha de seguridad si aplica). "
            "¿Me indica el nombre exacto de cada materia prima o la referencia (ej. C-TAU250g)? "
            "Si prefiere recibir los PDF por correo, déjeme su email y el equipo se los envía en breve."
            + _nota_whatsapp_opcional()
        )

    lineas = [
        "Veci, somos McKenna Group. Compartimos la documentación que tenemos disponible:\n"
    ]
    con_alguno: list[str] = []
    sin_pdf: list[str] = []

    for nombre in productos:
        ft = buscar_ficha_tecnica_pdf(nombre)
        coa = buscar_coa_pdf(nombre)
        sds = buscar_sds_pdf(nombre)
        if not ft and not coa and not sds:
            sin_pdf.append(nombre)
            continue
        con_alguno.append(nombre)
        lineas.append(f"\n*{nombre}*")
        if ft:
            lineas.append(f"📄 Ficha técnica: {ft}")
        if coa:
            lineas.append(f"📋 COA / certificado de análisis: {coa}")
        if sds:
            lineas.append(f"🛡️ Hoja de seguridad (SDS): {sds}")
        low_msg = (user_message + " " + historial_texto).lower()
        if re.search(r"\b(seguridad|msds|hoja\s+de\s+seguridad)\b", low_msg) and not sds:
            lineas.append(
                "ℹ️ Ficha de seguridad (MSDS): si no aparece arriba, la enviamos por correo "
                "al confirmar referencia y lote."
            )

    if not con_alguno:
        nombres = ", ".join(sin_pdf[:6])
        return (
            f"Veci, revisé nuestro archivo para {nombres} y no localicé el PDF en este momento. "
            f"Puede revisar guías en {_SITE_GUIAS} o la ficha en la ficha del producto en "
            f"{_SITE_TIENDA}. "
            "Si me deja su **correo electrónico** y la referencia exacta, el equipo le envía "
            "COA, ficha técnica y ficha de seguridad en breve."
            + _nota_whatsapp_opcional()
        )

    if sin_pdf:
        lineas.append(
            f"\n\nPara {', '.join(sin_pdf[:5])} no encontré PDF ahora; déjeme su **correo** "
            "y la referencia y se los enviamos."
        )
    lineas.append(
        f"\nTambién puede consultar guías en {_SITE_GUIAS}."
    )
    return "\n".join(lineas) + _nota_whatsapp_opcional()
