"""Textos reutilizables del chat web (burbuja): regulatorio, WhatsApp, historial."""

from __future__ import annotations

from app.web_chat_intents import wa_publico


def nota_regulatoria_materias_primas_invima() -> str:
    return (
        "ℹ️ En Colombia las **materias primas e insumos** para formulación (cosmética, "
        "nutrición, farmacia magistral, etc.) tienen un marco regulatorio **distinto** al de "
        "un **producto terminado** con registro sanitario INVIMA.\n\n"
        "Por eso, lo que normalmente podemos facilitarle de inmediato es la **ficha técnica** "
        "y/o el **COA** (certificado de análisis) del material que manejamos — no siempre "
        "existe un documento de «registro INVIMA» aplicable a la materia prima como tal."
    )


def nota_asesor_whatsapp_chat_web(
    *,
    motivo: str = "el dato exacto de lote o la documentación adicional",
) -> str:
    display, digits = wa_publico()
    return (
        f"\n\nSi necesita {motivo}, use el **botón de WhatsApp** en la página o escríbanos "
        f"al **{display}**: https://wa.me/{digits}\n"
        "Un **asesor humano** le brinda la información y allí **sí queda el hilo** de la "
        "conversación. **Este chat web no guarda el historial** si cierra la pestaña, "
        "cambia de dispositivo o borra datos del navegador."
    )


def nota_seguimiento_pedido_whatsapp() -> str:
    """Cierre opcional para documentos / cotización formal (tono más corto)."""
    display, digits = wa_publico()
    return (
        f"\n\nPara seguimiento de pedido o cotización formal con asesor: WhatsApp {display} "
        f"(https://wa.me/{digits})."
    )
