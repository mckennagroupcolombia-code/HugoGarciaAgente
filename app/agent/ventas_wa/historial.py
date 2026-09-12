"""
Lectura del historial real de WhatsApp (wa_chats.db) para el agente de ventas.

Fuente única de verdad del canal directo: incluye lo que escribe el cliente, lo
que respondió el bot y lo que el asesor escribió desde el teléfono. La memoria
vieja del bot (conversaciones_whatsapp.sqlite3) no veía los mensajes del asesor
y además comparte tabla con las sesiones del chat web; este módulo no la usa.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from app.services.wa_chats import listar_mensajes

_TZ_COL = timezone(timedelta(hours=-5))


def mensajes(jid: str, limite: int = 60, dias: int = 14) -> list[dict]:
    corte = time.time() - dias * 86400
    return [m for m in listar_mensajes(jid, limit=limite) if float(m.get("ts") or 0) >= corte]


def _rol(m: dict) -> str:
    if m.get("direccion") == "entrada":
        return "cliente"
    return "asesor" if m.get("enviado_por") == "humano" else "hugo"


def ultimo_mensaje_asesor(msgs: list[dict]) -> float | None:
    ts = [float(m["ts"]) for m in msgs if _rol(m) == "asesor"]
    return max(ts) if ts else None


def pendientes_del_cliente(msgs: list[dict]) -> list[dict]:
    """Mensajes del cliente que nadie ha respondido todavía (el turno a atender)."""
    out: list[dict] = []
    for m in reversed(msgs):
        if _rol(m) != "cliente":
            break
        out.append(m)
    return list(reversed(out))


def texto_mensaje(m: dict) -> str:
    t = str(m.get("texto") or "").strip()
    if m.get("tiene_media"):
        mime = str(m.get("media_mime") or "")
        tipo = "imagen" if mime.startswith("image/") else ("PDF" if "pdf" in mime else "adjunto")
        if t in ("", "[adjunto]"):
            return f"[envió un {tipo}]"
        return f"[envió un {tipo}] {t}"
    return t


def transcripcion(msgs: list[dict], max_chars: int = 9000) -> str:
    """Conversación como texto con hora de Colombia y quién habló."""
    etiquetas = {"cliente": "CLIENTE", "hugo": "HUGO (bot)", "asesor": "ASESOR (humano)"}
    lineas = []
    for m in msgs:
        hora = datetime.fromtimestamp(float(m.get("ts") or 0), _TZ_COL).strftime("%d/%m %H:%M")
        lineas.append(f"[{hora}] {etiquetas[_rol(m)]}: {texto_mensaje(m)[:1200]}")
    texto = "\n".join(lineas)
    if len(texto) > max_chars:
        texto = "…(mensajes anteriores omitidos)\n" + texto[-max_chars:]
    return texto


def id_por_wa_id(wa_id: str | None) -> int | None:
    if not wa_id:
        return None
    try:
        from app.services.wa_chats import _conn, _lock

        with _lock, _conn() as c:
            r = c.execute("SELECT id FROM mensajes WHERE wa_id=? LIMIT 1", (wa_id,)).fetchone()
        return int(r["id"]) if r else None
    except Exception:
        return None


def ahora_colombia() -> datetime:
    return datetime.now(_TZ_COL)
