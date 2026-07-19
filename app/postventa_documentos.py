"""
Respuesta automática postventa MeLi: certificados, fichas técnicas y COA (Drive).
"""

from __future__ import annotations

import os
import re

from app.services.drive_documentos import buscar_coa_pdf, buscar_ficha_tecnica_pdf

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


def _catalogo_productos_documentados() -> list[str]:
    """Nombres de producto derivados de los PDFs de ficha técnica en Drive.
    Catálogo aproximado usado solo para detectar cuándo el comprador pregunta
    por un producto distinto al que compró (no para armar el link en sí)."""
    from app.services.drive_documentos import DRIVE_FT_FOLDER_ID, listar_pdfs_en_carpeta

    nombres: list[str] = []
    for f in listar_pdfs_en_carpeta(DRIVE_FT_FOLDER_ID):
        nombre = re.sub(r"^(FT|RS|INVIMA)\s*[-:]?\s*", "", f.get("name") or "", flags=re.I)
        nombre = re.sub(r"\.pdf$", "", nombre, flags=re.I).strip()
        if nombre:
            nombres.append(nombre)
    return nombres


def _detectar_producto_no_comprado(
    texto_contexto: str, titulos_comprados: list[str]
) -> str | None:
    """
    Si el texto del comprador (mensaje actual + hilo reciente) menciona un
    producto del catálogo de fichas técnicas que NO es ninguno de los
    comprados, retorna ese nombre (el de match más específico). None si no
    hay mención clara de un producto distinto — evita falsos positivos con
    una sola palabra clave suelta.
    """
    from app.services.drive_documentos import _palabras_clave

    claves_texto = set(_palabras_clave(texto_contexto))
    if not claves_texto:
        return None

    claves_comprados: set[str] = set()
    for t in titulos_comprados:
        claves_comprados |= set(_palabras_clave(t))

    mejor: str | None = None
    mejor_score = 0
    for nombre in _catalogo_productos_documentados():
        claves_prod = _palabras_clave(nombre)
        if len(claves_prod) < 2 or not all(p in claves_texto for p in claves_prod):
            continue
        # Si todas sus palabras clave ya están cubiertas por lo comprado, no es "distinto".
        if all(p in claves_comprados for p in claves_prod):
            continue
        if len(claves_prod) > mejor_score:
            mejor, mejor_score = nombre, len(claves_prod)
    return mejor


def _titulos_productos_pack(pack_id: str, token: str) -> list[str]:
    import requests as req

    headers = {"Authorization": f"Bearer {token}", "x-version": "2"}
    titulos: list[str] = []
    try:
        r = req.get(
            f"https://api.mercadolibre.com/orders/{pack_id}",
            headers=headers,
            timeout=10,
        )
        if r.status_code == 200:
            for item in r.json().get("order_items", []) or []:
                t = (item.get("item") or {}).get("title", "")
                if t:
                    titulos.append(str(t).strip())
    except Exception as e:
        print(f"⚠️ [POSTVENTA-DOC] No pude leer orden {pack_id}: {e}")
    return titulos


def armar_respuesta_documentos(titulos: list[str]) -> tuple[str, list[str]]:
    """
    Construye texto para MeLi con enlaces FT/COA por producto.
    Retorna (texto, productos_con_al_menos_un_link).
    """
    if not titulos:
        return "", []

    lineas = [
        "Cordial saludo veci, somos McKenna Group. "
        "Con gusto compartimos la documentación de sus materias primas:\n"
    ]
    con_link: list[str] = []

    for titulo in titulos[:6]:
        ft = buscar_ficha_tecnica_pdf(titulo)
        coa = buscar_coa_pdf(titulo)
        if not ft and not coa:
            continue
        con_link.append(titulo)
        lineas.append(f"\n*{titulo}*")
        if ft:
            lineas.append(f"📄 Ficha técnica: {ft}")
        if coa:
            lineas.append(f"📋 COA / certificado: {coa}")

    if not con_link:
        return "", []

    lineas.append(
        "\nSi necesita otro documento o un producto adicional, cuéntenos y con gusto lo enviamos. "
        "Quedamos atentos. Saludos cordiales."
    )
    return "\n".join(lineas), con_link


def intentar_respuesta_automatica_documentos(
    pack_id: str,
    texto_comprador: str,
    *,
    comprador_id: str | None = None,
    texto_contexto_hilo: str = "",
) -> str:
    """
    Si el mensaje pide documentación:
      - Si los PDFs encontrados corresponden a lo que el comprador compró,
        responde de inmediato en MeLi → "auto_enviado".
      - Si el texto (o `texto_contexto_hilo`, mensajes recientes del mismo
        comprador) menciona un producto DISTINTO al comprado — p. ej. una
        compra cancelada y pregunta por otra materia prima — arma un
        borrador y lo deja pendiente de aprobación humana ("hugo dale ok
        <código>") en vez de enviarlo solo, para evitar mandar el documento
        de un producto equivocado sin revisión → "borrador_pendiente".
      - Si no hay match de ningún tipo → "sin_match" (sigue el flujo normal
        de cola manual "posventa <código>: ...").
    """
    if not _AUTO_DOCS or not mensaje_solicita_documentos(texto_comprador):
        return "sin_match"
    # El texto sintético de adjuntos ("[Solo adjunto(s) en MeLi: RUT.pdf] …")
    # contiene la palabra "pdf" y disparaba el envío de FT/COA cuando el
    # comprador solo mandó un archivo (RUT, comprobante) sin pedir nada.
    if (texto_comprador or "").lstrip().startswith("[Solo adjunto"):
        return "sin_match"

    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        return "sin_match"

    titulos = _titulos_productos_pack(pack_id, token)
    contexto = f"{texto_contexto_hilo} {texto_comprador}".strip()
    producto_distinto = _detectar_producto_no_comprado(contexto, titulos)

    if producto_distinto:
        ft = buscar_ficha_tecnica_pdf(producto_distinto)
        coa = buscar_coa_pdf(producto_distinto)
        if not ft and not coa:
            return "sin_match"

        lineas = [
            "Cordial saludo veci, somos McKenna Group. "
            f"Con gusto le compartimos la documentación de *{producto_distinto}*:\n"
        ]
        if ft:
            lineas.append(f"📄 Ficha técnica: {ft}")
        if coa:
            lineas.append(f"📋 COA / certificado: {coa}")
        lineas.append(
            "\nSi necesita otro documento o un producto adicional, cuéntenos y con gusto lo enviamos. "
            "Quedamos atentos. Saludos cordiales."
        )
        cuerpo = "\n".join(lineas)

        from app.meli_postventa_notif import sufijo_pack_postventa
        from app.routes import borradores_aprobacion
        from app.utils import enviar_whatsapp_reporte, jid_grupo_postventa_wa

        borradores_aprobacion[str(pack_id)] = cuerpo
        sufijo = sufijo_pack_postventa(pack_id)
        notif = (
            f"🔔 *RESPUESTA PENDIENTE DE APROBACIÓN (FT/COA)*\n"
            f"🔢 Código: *{sufijo}*\n"
            f"🗣 El comprador pidió documentación mencionando un producto "
            f"*distinto* al comprado: *{producto_distinto}*\n\n"
            f"🤖 Mensaje propuesto:\n_{cuerpo}_\n\n"
            f"Para enviar: *hugo dale ok {sufijo}*"
        )
        enviar_whatsapp_reporte(notif, numero_destino=jid_grupo_postventa_wa())
        print(
            f"📝 [POSTVENTA-DOC] Borrador pendiente de aprobación pack {pack_id} "
            f"— producto distinto detectado: {producto_distinto}"
        )
        return "borrador_pendiente"

    cuerpo, encontrados = armar_respuesta_documentos(titulos)
    if not cuerpo:
        print(
            f"ℹ️ [POSTVENTA-DOC] Solicitud de docs en pack {pack_id} "
            f"sin PDFs localizados en Drive para: {titulos[:3]}"
        )
        return "sin_match"

    from modulo_posventa import responder_mensaje_posventa

    ok = responder_mensaje_posventa(pack_id, cuerpo, comprador_id)
    if ok:
        print(
            f"✅ [POSTVENTA-DOC] Auto-respuesta enviada pack {pack_id} "
            f"({len(encontrados)} producto(s))"
        )
    return "auto_enviado" if ok else "sin_match"
