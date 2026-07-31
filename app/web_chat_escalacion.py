"""
Escalación de consultas técnicas del chat web sin respuesta en ficha/memoria.
"""

from __future__ import annotations

import re

from app.services.web_chat_consultas import (
    alertar_grupo_consulta,
    crear_consulta_pendiente,
    intentar_respuesta_por_codigo_en_mensaje,
    mensaje_cliente_consulta_creada,
)

# Propiedades físico-químicas que suelen requerir dato exacto del equipo
_PATRONES_PROPIEDAD = (
    r"\bdensidad\b",
    r"\bviscosidad\b",
    r"\bpeso\s+espec[ií]fico\b",
    r"\bpunto\s+de\s+fusi[oó]n\b",
    r"\bpunto\s+de\s+ebullici[oó]n\b",
    r"\bsolubilidad\b",
    r"\bph\b",
    r"\bhumedad\b",
    r"\bpureza\b",
    r"\b(?:calcular|calculo|c[aá]lculo)\s+(?:el\s+)?peso\b",
    r"\bpeso\s+(?:neto|total|del\s+producto)\b",
)


def mensaje_pide_propiedad_fisica(texto: str) -> bool:
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    if len(low) < 4:
        return False
    return any(re.search(p, low) for p in _PATRONES_PROPIEDAD)


def _ficha_cubre_pregunta(ficha: str, pregunta: str) -> bool:
    """Heurística: ¿la ficha ya trae el dato que piden?"""
    if not (ficha or "").strip():
        return False
    low_f = ficha.lower()
    low_q = (pregunta or "").lower()
    if "densidad" in low_q and "densidad" in low_f:
        # Debe haber algún valor cerca, no solo el encabezado vacío
        if re.search(r"densidad\s*[:=]?\s*[\d,.]", low_f):
            return True
    if "viscosidad" in low_q and re.search(r"viscosidad\s*[:=]?\s*[\d,.]", low_f):
        return True
    if "ph" in low_q and re.search(r"\bph\s*[:=]?\s*[\d,.]", low_f):
        return True
    if "solubilidad" in low_q and "solubil" in low_f and len(low_f) > 200:
        return True
    return False


def necesita_escalacion_tecnica_web(
    *,
    pregunta: str,
    producto: str,
    ficha: str | None,
    memoria_vec: str,
) -> bool:
    """
    True si piden propiedad física y no hay respuesta confiable en ficha ni memoria.
    """
    if not mensaje_pide_propiedad_fisica(pregunta):
        return False
    if memoria_vec and len(memoria_vec.strip()) > 80:
        low_m = memoria_vec.lower()
        low_q = pregunta.lower()
        if "densidad" in low_q and "densidad" in low_m:
            return False
        if "viscosidad" in low_q and "viscosidad" in low_m:
            return False
    if ficha and _ficha_cubre_pregunta(ficha, pregunta):
        return False
    return True


def manejar_escalacion_tecnica_web(
    *,
    pregunta: str,
    session_id: str,
    producto: str = "",
    page_url: str = "",
    ficha: str | None = None,
    memoria_vec: str = "",
) -> str | None:
    """
    Crea consulta WCQ, alerta al grupo y retorna mensaje al cliente.
    None si no aplica escalación.
    """
    if not necesita_escalacion_tecnica_web(
        pregunta=pregunta,
        producto=producto,
        ficha=ficha,
        memoria_vec=memoria_vec,
    ):
        return None

    registro = crear_consulta_pendiente(
        session_id=session_id,
        pregunta=pregunta,
        producto=producto,
        page_url=page_url,
    )
    alertar_grupo_consulta(registro)
    return mensaje_cliente_consulta_creada(registro)


def manejar_seguimiento_codigo_web(texto: str) -> str | None:
    return intentar_respuesta_por_codigo_en_mensaje(texto)


_PATRONES_OPERATIVA = (
    r"\b(vence|vencimiento|caducidad|caduca)\b",
    r"\blot\.?\b",
    r"\blote\b",
    r"\bfecha\s+de\s+vencimiento\b",
)

# LOTE: MAR2026 / "el lote es MAR2026" / LOTE#A-123 (exige al menos un dígito)
_PAT_LOTE_VALOR = re.compile(
    r"\blote\b\s*(?:es|:|#|n[o°º]\.?|numero|n[uú]mero)?[:\s]*([A-Za-z0-9][\w/-]{2,})",
    re.I,
)
# Referencias tipo C-EXTRAMAL500g / SB-CRD150G (prefijo corto + guion + cuerpo)
_PAT_REF_SKU = re.compile(r"\b([A-Za-z]{1,4}-[A-Za-z0-9]{4,})\b")


def mensaje_pide_info_operativa(texto: str) -> bool:
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    if len(low) < 4:
        return False
    return any(re.search(p, low) for p in _PATRONES_OPERATIVA)


def _extraer_lote(texto: str) -> str:
    m = _PAT_LOTE_VALOR.search(texto or "")
    if not m:
        return ""
    valor = m.group(1).strip()
    # Evita capturar palabras sueltas ("lote impreso"): exige algún dígito
    return valor if re.search(r"\d", valor) else ""


def _extraer_ref(texto: str) -> str:
    m = _PAT_REF_SKU.search(texto or "")
    return m.group(1).strip() if m else ""


def manejar_consulta_operativa_web(
    *,
    pregunta: str,
    session_id: str = "",
    page_url: str = "",
    producto: str = "",
) -> str | None:
    """
    Vencimiento, lote, trazabilidad (COA de un lote comprado).
    Si el cliente ya dio lote y producto/referencia (o escribe desde la página del
    producto), NO repite la petición enlatada: crea consulta WCQ y alerta al equipo.
    """
    if not mensaje_pide_info_operativa(pregunta):
        return None
    from app.web_chat_mensajes import nota_asesor_whatsapp_chat_web

    lote = _extraer_lote(pregunta)
    ref = _extraer_ref(pregunta) or (producto or "").strip()

    if lote and ref:
        registro = crear_consulta_pendiente(
            session_id=session_id,
            pregunta=f"COA/trazabilidad — producto/ref: {ref} — lote: {lote}\n{pregunta}"[:2000],
            producto=ref,
            page_url=page_url,
        )
        alertar_grupo_consulta(registro)
        return mensaje_cliente_consulta_creada(registro)

    if ref and not lote:
        return (
            f"Listo veci, ya tengo la referencia **{ref}**. Solo me falta el **número de lote** "
            "impreso en la etiqueta del empaque (dice LOTE, junto a la fecha de vencimiento). "
            "Apenas me lo escriba, registro la consulta con el equipo técnico."
        )

    return (
        "Veci, para consultar **vencimiento, lote o trazabilidad** de un producto que ya compró, "
        "necesitamos la **referencia (SKU)** y el **número de lote** impreso en el empaque."
        + nota_asesor_whatsapp_chat_web(
            motivo="confirmar fechas y lote con el equipo"
        )
    )
