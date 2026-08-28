"""
Respuesta automática postventa MeLi a solicitudes de ficha técnica / COA.

Política MeLi: no se comparten enlaces externos (Drive, sitio web) ni datos
de contacto en preguntas o mensajes postventa — Mercado Libre intermedia la
relación comercial y prohíbe ese tipo de intercambio. Por eso la respuesta es
siempre el mismo texto fijo indicando revisar la etiqueta del producto, sin
importar cuál producto se compró o se menciona.
"""

from __future__ import annotations

import os
import re

_AUTO_DOCS = os.getenv("POSTVENTA_AUTO_DOCUMENTOS", "1").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)

_CLAVES_SOLICITUD = (
    "certificado",
    "certificados",
    "ficha tecnica",
    "ficha técnica",
    "fichas tecnicas",
    "fichas técnicas",
    "coa",
    "analisis",
    "análisis",
    "hoja de seguridad",
    "msds",
    "invima",
    "registro sanitario",
    "documentacion",
    "documentación",
    "pdf",
    "hoja tecnica",
    "hoja técnica",
)


_CLAVES_SOLICITUD_RE = tuple(
    re.compile(r"\b" + re.escape(k) + r"\b") for k in _CLAVES_SOLICITUD
)


def mensaje_solicita_documentos(texto: str) -> bool:
    """Ojo: match por palabra completa — 'coa' en substring (p. ej. "cocoamida",
    "cocoa") NO debe activar la solicitud de documentos."""
    t = (texto or "").lower()
    t = re.sub(r"\s+", " ", t)
    return any(p.search(t) for p in _CLAVES_SOLICITUD_RE)


def respuesta_ficha_coa_meli() -> str:
    """Texto fijo de política para MeLi (preventa y postventa): sin enlaces
    externos ni datos de contacto, ya que Mercado Libre intermedia la
    relación comercial."""
    return (
        "Hola veci, para consultar la ficha técnica y el COA debe revisar la "
        "etiqueta del producto: allí encuentra dónde consultarla. Por "
        "políticas de Mercado Libre no podemos compartir enlaces externos ni "
        "datos de contacto, ya que ellos intermedian toda la relación "
        "comercial. Cualquier otra duda con gusto le colaboramos."
    )


def intentar_respuesta_automatica_documentos(
    pack_id: str,
    texto_comprador: str,
    *,
    comprador_id: str | None = None,
    texto_contexto_hilo: str = "",
) -> str:
    """
    Si el mensaje pide documentación (ficha técnica, COA, certificados, etc.),
    responde de inmediato en MeLi con el texto fijo de política → "auto_enviado".
    Si no aplica → "sin_match" (sigue el flujo normal de cola manual
    "posventa <código>: ...").
    texto_contexto_hilo se acepta por compatibilidad con el llamador pero ya
    no se usa: la respuesta es la misma sin importar el producto.
    """
    if not _AUTO_DOCS or not mensaje_solicita_documentos(texto_comprador):
        return "sin_match"
    # El texto sintético de adjuntos ("[Solo adjunto(s) en MeLi: RUT.pdf] …")
    # contiene la palabra "pdf" y disparaba el envío cuando el comprador solo
    # mandó un archivo (RUT, comprobante) sin pedir nada.
    if (texto_comprador or "").lstrip().startswith("[Solo adjunto"):
        return "sin_match"

    from modulo_posventa import responder_mensaje_posventa

    ok = responder_mensaje_posventa(pack_id, respuesta_ficha_coa_meli(), comprador_id)
    if ok:
        print(f"✅ [POSTVENTA-DOC] Auto-respuesta de política enviada pack {pack_id}")
    return "auto_enviado" if ok else "sin_match"
