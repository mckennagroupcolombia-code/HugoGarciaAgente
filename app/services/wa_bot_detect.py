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
    # Respuestas largas con tono Hugo (veci + párrafo extenso)
    if re.search(r"\bveci\b", low) and len(t) > 100:
        return True
    if low.count("veci") >= 2:
        return True
    return False
