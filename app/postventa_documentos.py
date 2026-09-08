"""
Respuesta automática postventa MeLi a solicitudes de ficha técnica / COA.

Política MeLi: no se comparten ENLACES externos (Drive, sitio web) ni datos
de contacto en preguntas o mensajes postventa — Mercado Libre intermedia la
relación comercial y prohíbe ese tipo de intercambio. Un ADJUNTO subido vía
la propia API de mensajería de MeLi (POST /messages/attachments) sí es
compatible con esa política, porque el archivo queda dentro de la plataforma
en vez de apuntar afuera — ver `app.services.meli.subir_adjunto_mensaje_meli`.

Modo de envío del PDF combinado (FT+COA+SDS) — gateado por
`POSTVENTA_ADJUNTAR_DOCUMENTOS_MELI` (default "0", apagado):
mientras esté en 0, se mantiene el texto fijo histórico (remitir a la
etiqueta). En 1, se intenta resolver el producto de la orden → buscar su
documento completo en la biblioteca → subirlo como adjunto → enviarlo junto
con un texto corto. Si cualquier paso falla (orden no resuelve, producto sin
documento, error subiendo a MeLi), se cae al texto fijo de siempre — nunca se
deja al comprador sin respuesta. Activar solo tras confirmar con tráfico real
que /messages/attachments funciona para la cuenta de McKenna (mismo criterio
que otras activaciones de tópicos MeLi documentado en CLAUDE.md).
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

_ADJUNTAR_PDF = os.getenv("POSTVENTA_ADJUNTAR_DOCUMENTOS_MELI", "0").strip().lower() in (
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


def _resolver_pdf_completo_para_pack(pack_id: str):
    """Pack/orden MeLi -> nombre del producto -> PDF combinado (FT+COA+SDS) en la
    biblioteca local, si existe. Devuelve Path o None (nunca lanza)."""
    from app.services.meli import consultar_orden_meli_completa
    from app.services.documentos_web import buscar_documento_completo_web
    from app.services.ficha_tecnica import ruta_archivo_biblioteca_segura

    try:
        orden = consultar_orden_meli_completa(pack_id)
        if not orden:
            return None
        items = orden.get("order_items") or []
        if not items:
            return None
        nombre = (items[0].get("item") or {}).get("title") or ""
        if not nombre.strip():
            return None
        doc = buscar_documento_completo_web(nombre)
        if not doc:
            return None
        pdf_nombre = doc.get("pdf_nombre") or ""
        if not pdf_nombre:
            return None
        return ruta_archivo_biblioteca_segura(pdf_nombre)
    except Exception as e:
        print(f"⚠️ [POSTVENTA-DOC] No pude resolver PDF completo para pack {pack_id}: {e}")
        return None


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

    if _ADJUNTAR_PDF:
        pdf_path = _resolver_pdf_completo_para_pack(pack_id)
        if pdf_path:
            from app.services.meli import subir_adjunto_mensaje_meli

            subida = subir_adjunto_mensaje_meli(pdf_path)
            if subida.get("ok"):
                texto_adjunto = (
                    "Hola veci, le comparto la ficha técnica, el certificado de "
                    "análisis (COA) y la hoja de seguridad del producto en el "
                    "archivo adjunto. Cualquier otra duda con gusto le colaboramos."
                )
                ok = responder_mensaje_posventa(
                    pack_id, texto_adjunto, comprador_id,
                    attachments=[subida["filename"]],
                )
                if ok:
                    print(f"✅ [POSTVENTA-DOC] PDF adjunto enviado pack {pack_id} ({pdf_path.name})")
                    return "auto_enviado"
                print(f"⚠️ [POSTVENTA-DOC] Falló envío con adjunto pack {pack_id}; cayendo a texto fijo")
            else:
                print(f"⚠️ [POSTVENTA-DOC] Falló subida de adjunto pack {pack_id}: {subida.get('error')}")
        # Sin documento resuelto o sin poder subir/enviar -> sigue al texto fijo abajo.

    ok = responder_mensaje_posventa(pack_id, respuesta_ficha_coa_meli(), comprador_id)
    if ok:
        print(f"✅ [POSTVENTA-DOC] Auto-respuesta de política enviada pack {pack_id}")
    return "auto_enviado" if ok else "sin_match"
