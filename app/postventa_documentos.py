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


def mensaje_solicita_documentos(texto: str) -> bool:
    t = (texto or "").lower()
    t = re.sub(r"\s+", " ", t)
    return any(k in t for k in _CLAVES_SOLICITUD)


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
) -> bool:
    """
    Si el mensaje pide documentación y hay PDFs en Drive, responde en MeLi.
    Retorna True si envió respuesta automática.
    """
    if not _AUTO_DOCS or not mensaje_solicita_documentos(texto_comprador):
        return False

    from app.utils import refrescar_token_meli
    from modulo_posventa import responder_mensaje_posventa

    token = refrescar_token_meli()
    if not token:
        return False

    titulos = _titulos_productos_pack(pack_id, token)
    cuerpo, encontrados = armar_respuesta_documentos(titulos)
    if not cuerpo:
        print(
            f"ℹ️ [POSTVENTA-DOC] Solicitud de docs en pack {pack_id} "
            f"sin PDFs localizados en Drive para: {titulos[:3]}"
        )
        return False

    ok = responder_mensaje_posventa(pack_id, cuerpo, comprador_id)
    if ok:
        print(
            f"✅ [POSTVENTA-DOC] Auto-respuesta enviada pack {pack_id} "
            f"({len(encontrados)} producto(s))"
        )
    return bool(ok)
