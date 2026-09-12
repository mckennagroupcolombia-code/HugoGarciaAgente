"""Detecta respuestas del bot Hugo vs mensajes del asesor humano en historial WA."""

from __future__ import annotations

import re


def parece_respuesta_bot(texto: str) -> bool:
    """Heurística conservadora: bot Hugo vs operador humano."""
    t = (texto or "").strip()
    if not t or t == "[adjunto]":
        return False
    low = t.lower()
    if "hola soy hugo garcia" in low or "hola, soy hugo garcia" in low:
        return True
    if "estimado, cliente, hemos recibido tu mensaje" in low:
        return True
    if "no podemos atenderte" in low and "horario" in low:
        return True
    if "listo veci" in low and "asesor humano" in low:
        return True
    if "a continuación sigue la conversación con un asesor humano" in low:
        return True
    if "tuvimos un problema técnico temporal" in low:
        return True
    if "recibí su comprobante" in low and "contabilidad" in low:
        return True
    # Antes: "veci" + párrafo largo ⇒ bot. Falso positivo grave (sep-2026): el
    # equipo también escribe "veci" (y el reescritor del panel lo agrega), así que
    # las respuestas del asesor quedaban como del bot y el bot creía que nadie
    # humano atendía el chat. Las respuestas reales del bot ya llegan marcadas
    # por el puente (marcarEnvioBot) o con su wa_id; aquí solo frases exactas.
    return False
