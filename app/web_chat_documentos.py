"""
COA, ficha técnica y ficha de seguridad — chat web (burbuja) y WhatsApp
directo (canal="whatsapp"). Los PDFs viven en la propia página web (ver
app.services.documentos_web, mismo índice que sirve /producto/<slug> y
/documentos-tecnicos/<pdf>), no en Drive. En ambos canales se puede
compartir el enlace directo; para MeLi (preventa/postventa) ver
app/postventa_documentos.py en su lugar, que responde con el texto fijo de
política (sin enlaces).
"""

from __future__ import annotations

import re
from urllib.parse import quote

from app.postventa_documentos import mensaje_solicita_documentos
from app.services.documentos_web import buscar_documento_completo_web
from app.web_chat_mensajes import (
    nota_asesor_whatsapp_chat_web,
    nota_regulatoria_invima_explicacion,
    nota_regulatoria_invima_reempaque,
    nota_regulatoria_materias_primas_invima,
    nota_regulatoria_materias_primas_invima_larga,
    nota_seguimiento_pedido_whatsapp,
)

_SITE_BASE = "https://mckennagroup.co"
_SITE_GUIAS = f"{_SITE_BASE}/guias"
_SITE_TIENDA = f"{_SITE_BASE}/tienda"


def _url_documento_tecnico(doc: dict, seccion: str) -> str:
    pdf = quote(doc.get("pdf_nombre") or "")
    return f"{_SITE_BASE}/documentos-tecnicos/{pdf}?seccion={seccion}"

_USUARIO_PREFIX_RE = re.compile(r"^Usuario_[^:]+:\s*", re.IGNORECASE)

_PREFIJOS_LISTA = re.compile(
    r"^(?:buenos?\s+d[ií]as|buenas?\s+(?:tardes|noches)|hola|vec[ií]|por\s+favor|"
    r"podr[ií]a|podrian|quisiera|necesito|me\s+interesa|perfecto|listo|gracias|"
    r"facilitar(?:me)?|enviar(?:me)?|compartir|solicito|ver\s+un)\b[\s,;:.-]*",
    re.IGNORECASE,
)

_RUIDO_DOC = re.compile(
    r"\b(?:certificado|certificados|coa|coay|ficha|fichas|t[eé]cnica|t[eé]cnicas|"
    r"seguridad|msds|hoja|documentaci[oó]n|analisis|an[aá]lisis|actualmente|"
    r"manejando|productos?|materia\s+prima|por\s+favor|muchas\s+gracias|gracias|"
    r"invima|registro\s+sanitario|registro|sanitario)\b",
    re.IGNORECASE,
)

_GARBAGE_PRODUCTO_RE = re.compile(
    r"usuario_|https?://|wa\.me|whatsapp|mckenna\s+group|revis[eé]\s+nuestro|"
    r"no\s+localic[eé]|puede\s+revisar|correo\s+electr",
    re.IGNORECASE,
)


def _historial_solo_usuario(historial_texto: str) -> str:
    """Ignora respuestas del bot mezcladas en el historial (p. ej. saludo con 'ficha técnica')."""
    if not historial_texto:
        return ""
    partes: list[str] = []
    for chunk in re.split(r"(?<=[.!?])\s+", historial_texto):
        t = _USUARIO_PREFIX_RE.sub("", (chunk or "").strip())
        if not t:
            continue
        low = t.lower()
        if any(
            m in low
            for m in (
                "soy hugo garcía",
                "en qué le puedo servir",
                "puede consultarme precios",
                "revisé nuestro archivo",
                "no localicé el pdf",
            )
        ):
            continue
        partes.append(t)
    return " ".join(partes)[-1200:]


def mensaje_pide_registro_invima(texto: str) -> bool:
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    return bool(re.search(r"\b(invima|registro\s+sanitario)\b", low))


def mensaje_pide_explicacion_invima(texto: str) -> bool:
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    if not re.search(r"\b(invima|registro\s+sanitario|registro)\b", low):
        return False
    return bool(re.search(
        r"\b(por\s*qu[eé]|como\s+funciona|c[oó]mo\s+opera|explica|entiend|no\s+entiendo|"
        r"la\s+l[oó]gica|qu[eé]\s+significa|qu[eé]\s+quiere\s+decir|diferencia|categor)\b",
        low,
    ))


def mensaje_insiste_invima_aplica(texto: str) -> bool:
    """Detecta cuando el cliente argumenta que el INVIMA sí aplica (suplementos, reempaque, etc.)."""
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    if not re.search(r"\b(invima|registro\s+sanitario|registro|nsa|rsa)\b", low):
        return False
    return bool(re.search(
        r"\b(suplementos?|supplements?|reempaque|reenvas|envases?|si\s+aplica|s[ií]\s+es|"
        r"pero\s+s[ií]|porque\s+son|alimentos?|nutri|granola|almendra|pasaboca|"
        r"consumo\s+directo|marca\s+propia|gondola|supermercado|exito|retail|cadena)\b",
        low,
    ))


def _nota_invima_segun_contexto(user_message: str, hist_user: str) -> str:
    """Selecciona la nota INVIMA adecuada según el nivel de la conversación."""
    if mensaje_insiste_invima_aplica(user_message):
        return nota_regulatoria_invima_reempaque()
    if mensaje_pide_explicacion_invima(user_message):
        return nota_regulatoria_invima_explicacion()
    if mensaje_pide_registro_invima(user_message) and mensaje_pide_registro_invima(hist_user):
        return nota_regulatoria_materias_primas_invima_larga()
    return nota_regulatoria_materias_primas_invima()


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


def _es_candidato_producto_valido(texto: str) -> bool:
    t = (texto or "").strip()
    if len(t) < 3 or len(t) > 60:
        return False
    if _GARBAGE_PRODUCTO_RE.search(t):
        return False
    if t.count(" ") > 8:
        return False
    low = t.lower()
    if any(
        w in low
        for w in (
            "adecuados para",
            "proyecto universitario",
            "genera duda",
            "tipo de procedimiento",
            "directamente en la piel",
        )
    ):
        return False
    return True


def _limpiar_fragmento_producto(fragmento: str) -> str:
    f = (fragmento or "").strip()
    while True:
        nuevo = _PREFIJOS_LISTA.sub("", f).strip(" ,;.-")
        if nuevo == f:
            break
        f = nuevo
    f = _RUIDO_DOC.sub(" ", f)
    f = re.sub(r"\s{2,}", " ", f).strip(" ,;.-")
    while True:
        nuevo = re.sub(
            r"^(?:el|la|los|las|del|de\s+la|de\s+los|de\s+las|de|un|una|uno)\s+",
            "",
            f,
            flags=re.IGNORECASE,
        ).strip(" ,;.-")
        if nuevo == f:
            break
        f = nuevo
    return f


def extraer_nombres_productos_documento(texto: str) -> list[str]:
    """Extrae nombres de ingredientes/productos en mensajes con listas o varios ítems."""
    raw = (texto or "").strip()
    if not raw:
        return []

    candidatos: list[str] = []
    partes = re.split(r"[,;\n]|(?:\s+y\s+|\s+e\s+|\s+o\s+)", raw, flags=re.IGNORECASE)
    for parte in partes:
        limpio = _limpiar_fragmento_producto(parte)
        if len(limpio) >= 3 and not re.match(
            r"^(?:de|del|la|el|los|las|un|una|unos|unas)$", limpio, re.I
        ):
            candidatos.append(limpio)

    vistos: set[str] = set()
    out: list[str] = []
    for c in candidatos:
        if not _es_candidato_producto_valido(c):
            continue
        key = c.lower()
        if key in vistos:
            continue
        vistos.add(key)
        out.append(c)
    return out[:12]


def _productos_desde_historial(historial_usuario: str) -> list[str]:
    """Lista larga de ingredientes en turnos anteriores del mismo chat (solo usuario)."""
    hist = _historial_solo_usuario(historial_usuario)
    if not hist:
        return []
    low = hist.lower()
    if not any(
        sep in low
        for sep in (",", " y ", " e ", "ácido", "acido", "extracto", "l-", "taurina")
    ):
        return []
    return extraer_nombres_productos_documento(hist)


def _mensaje_doc_vago(texto: str) -> bool:
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    return bool(
        re.search(r"\b(invima|registro\s+sanitario|registro)\b", low)
        and not extraer_nombres_productos_documento(texto)
    )


def _resolver_productos_documento(user_message: str, historial_usuario: str) -> list[str]:
    productos = list(extraer_nombres_productos_documento(user_message))
    hist = _historial_solo_usuario(historial_usuario)

    if len(productos) <= 1:
        for p in _productos_desde_historial(hist):
            if p not in productos:
                productos.append(p)

    if _mensaje_doc_vago(user_message) and hist:
        previos = extraer_nombres_productos_documento(hist)
        for p in reversed(previos):
            if p not in productos:
                productos.insert(0, p)
                break

    # "ficha tecnica" a secas tras hablar de un producto: usar el más reciente
    # del historial en vez de volver a pedir la referencia.
    if not productos and hist:
        previos = extraer_nombres_productos_documento(hist)
        if previos:
            productos.append(previos[-1])

    vistos: set[str] = set()
    out: list[str] = []
    for p in productos:
        key = p.lower()
        if key in vistos:
            continue
        vistos.add(key)
        out.append(p)
    return out[:12]


def _nota_whatsapp_opcional() -> str:
    return nota_seguimiento_pedido_whatsapp()


def _cierre_asesor(canal: str, *, motivo: str) -> str:
    """Chat web: invita a escribir por WhatsApp para lo que este canal no resuelve.
    WhatsApp directo: el cliente ya está en ese canal, no tiene sentido redirigirlo."""
    if canal == "whatsapp":
        return "\n\nCualquier otra duda con gusto le colaboro."
    return nota_asesor_whatsapp_chat_web(motivo=motivo)


def _mensaje_sin_pdf(nombres: str, *, nota_invima: str = "", canal: str = "web_chat") -> str:
    cuerpo = (
        f"Veci, revisé nuestro archivo para {nombres} y no localicé el PDF en este momento. "
        f"Puede revisar guías en {_SITE_GUIAS} o la ficha del producto en {_SITE_TIENDA}. "
        "Si me deja su **correo electrónico** y la referencia exacta, el equipo le envía "
        "ficha técnica, COA y ficha de seguridad cuando aplique."
    )
    if nota_invima:
        cuerpo = nota_invima + f"\n\n{cuerpo}"
    return cuerpo + _cierre_asesor(
        canal, motivo="COA, ficha técnica o el dato de lote específico"
    )


def manejar_documentos_web(
    *,
    user_message: str,
    historial_texto: str = "",
    historial_usuario: str = "",
    canal: str = "web_chat",
) -> str | None:
    """
    Si piden COA/FT/MSDS/INVIMA, intenta enlaces al PDF publicado en la web; si no hay, pide correo y guías web.
    canal="whatsapp": mismo mecanismo determinista (no depende del LLM) para el
    chat directo por WhatsApp — a diferencia de MeLi, aquí sí se puede compartir
    el enlace porque no hay intermediación de la plataforma.
    """
    hist_user = _historial_solo_usuario(historial_usuario or historial_texto)

    pide_ahora = mensaje_pide_documentacion_web(user_message)
    pide_en_hist = mensaje_pide_documentacion_web(hist_user)
    productos_msg = extraer_nombres_productos_documento(user_message)
    lista_ingredientes = len(productos_msg) >= 3

    if not pide_ahora and not (pide_en_hist and lista_ingredientes):
        return None

    productos = _resolver_productos_documento(user_message, hist_user)

    if not productos:
        intro = (
            "Veci, con gusto le enviamos **ficha técnica** y/o **COA** "
            "(y ficha de seguridad si aplica). "
            "¿Me indica el nombre exacto de cada materia prima o la referencia (ej. C-TAU250g)? "
            "Si prefiere recibir los PDF por correo, déjeme su email y el equipo se los envía en breve."
        )
        pide_invima_ahora = mensaje_pide_registro_invima(user_message)
        pide_invima_antes = mensaje_pide_registro_invima(hist_user)
        if pide_invima_ahora or pide_invima_antes:
            nota = _nota_invima_segun_contexto(user_message, hist_user)
            intro = nota + "\n\n" + intro
        return intro + _cierre_asesor(
            canal, motivo="documentación o datos de lote puntuales"
        )

    pide_invima_ahora = mensaje_pide_registro_invima(user_message)
    pide_invima_antes = mensaje_pide_registro_invima(hist_user)
    pide_invima = pide_invima_ahora or pide_invima_antes
    nota_invima = _nota_invima_segun_contexto(user_message, hist_user) if pide_invima else ""

    lineas: list[str] = []
    if pide_invima:
        lineas.append(nota_invima)
        lineas.append(
            "\nCompartimos la documentación de materia prima que tenemos disponible "
            "(ficha técnica / COA):\n"
        )
    else:
        lineas.append(
            "Veci, somos McKenna Group. Compartimos la documentación que tenemos disponible:\n"
        )
    con_alguno: list[str] = []
    sin_pdf: list[str] = []
    low_ctx = f"{user_message} {hist_user}".lower()

    for nombre in productos:
        doc = buscar_documento_completo_web(nombre)
        if not doc:
            sin_pdf.append(nombre)
            continue
        con_alguno.append(nombre)
        lineas.append(f"\n*{doc.get('titulo') or nombre}*")
        lineas.append(f"📄 Ficha técnica: {_url_documento_tecnico(doc, 'ft')}")
        if doc.get("coa"):
            lineas.append(f"📋 COA / certificado de análisis: {_url_documento_tecnico(doc, 'coa')}")
        if doc.get("sds"):
            lineas.append(f"🛡️ Hoja de seguridad (SDS): {_url_documento_tecnico(doc, 'sds')}")
        if re.search(r"\b(seguridad|msds|hoja\s+de\s+seguridad)\b", low_ctx) and not doc.get("sds"):
            lineas.append(
                "ℹ️ Ficha de seguridad (MSDS): si no aparece arriba, la enviamos por correo "
                "al confirmar referencia y lote."
            )

    if not con_alguno:
        return _mensaje_sin_pdf(", ".join(sin_pdf[:6]), nota_invima=nota_invima, canal=canal)

    if sin_pdf:
        lineas.append(
            f"\n\nPara {', '.join(sin_pdf[:5])} no encontré PDF ahora; déjeme su **correo** "
            "y la referencia y le enviamos ficha técnica / COA."
        )
    lineas.append(f"\nTambién puede consultar guías en {_SITE_GUIAS}.")
    return "\n".join(lineas) + _cierre_asesor(
        canal,
        motivo="registro sanitario de producto terminado u otro documento especial"
        if pide_invima
        else "documentación adicional o datos de lote",
    )
