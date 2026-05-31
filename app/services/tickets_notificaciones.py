"""
Notas de voz del supervisor WA a operadores del panel de tickets.

Eventos:
- Nueva acción/solicitud asignada
- Compras delegadas asignadas
- Solicitud emitida resuelta por otro usuario
- Lista de compras esperada completada
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_TELEFONOS_JSON = _REPO / "app" / "data" / "tickets_telefonos_operadores.json"


def _voz_habilitada() -> bool:
    return os.getenv("TICKETS_VOZ_OPERADOR", "1").strip().lower() not in ("0", "false", "no")


def normalizar_telefono_wa(raw: str) -> str:
    s = re.sub(r"\D", "", (raw or "").strip())
    if not s:
        return ""
    if "@c.us" in (raw or ""):
        return raw.strip()
    if len(s) == 10 and s.startswith("3"):
        return "57" + s
    if len(s) == 12 and s.startswith("57"):
        return s
    return s


def _telefono_desde_env(usuario_id: int) -> str:
    key = f"TICKETS_VOZ_TELEFONO_{usuario_id}"
    return normalizar_telefono_wa(os.getenv(key, ""))


def _telefono_desde_json(usuario_id: int) -> str:
    if not _TELEFONOS_JSON.is_file():
        return ""
    try:
        data = json.loads(_TELEFONOS_JSON.read_text(encoding="utf-8"))
        raw = data.get(str(usuario_id)) or data.get(usuario_id)
        return normalizar_telefono_wa(str(raw or ""))
    except Exception:
        return ""


def telefono_operador(usuario_id: int | None) -> str:
    if not usuario_id:
        return ""
    with _conn_ctx() as db:
        row = db.execute(
            "SELECT telefono FROM usuarios WHERE id=? AND activo=1", (int(usuario_id),),
        ).fetchone()
        if row and row["telefono"]:
            tel = normalizar_telefono_wa(str(row["telefono"]))
            if tel:
                return tel
    tel = _telefono_desde_env(int(usuario_id))
    if tel:
        return tel
    return _telefono_desde_json(int(usuario_id))


def _conn_ctx():
    from app.services.tickets_db import _conn
    return _conn()


def _nombre_usuario(db, uid: int | None) -> str:
    if not uid:
        return "Operador"
    row = db.execute("SELECT nombre FROM usuarios WHERE id=?", (uid,)).fetchone()
    return (row["nombre"] if row else None) or "Operador"


def _sintetizar_voz(texto: str) -> tuple[bytes | None, str]:
    texto = (texto or "").strip()[:280]
    if not texto:
        return None, "audio/wav"
    mime_type = "audio/wav"
    audio_bytes = None
    engine = os.getenv("TICKETS_VOZ_TTS_ENGINE", "").strip().lower()

    from app.services.tts_voicebox import voicebox_disponible, sintetizar_voicebox
    from app.services.tts_qwen3 import qwen3_disponible, sintetizar_qwen3

    cfg: dict = {}
    try:
        from app.services.voz_config import leer_config
        cfg = leer_config() or {}
    except Exception:
        pass

    if engine in ("", "voicebox") and voicebox_disponible():
        try:
            from app.services.voz_config import resolver_voicebox_profile, voicebox_language_code
            profile = resolver_voicebox_profile({}, cfg)
            voz_lang = voicebox_language_code(cfg.get("language"))
            audio_bytes = sintetizar_voicebox(texto, profile_id=profile, language=voz_lang)
        except Exception as exc:
            print(f"[tickets-voz] Voicebox: {exc}")

    if audio_bytes is None and engine in ("", "qwen3") and qwen3_disponible():
        try:
            audio_bytes = sintetizar_qwen3(
                texto, speaker=cfg.get("speaker"), language=cfg.get("language"),
            )
        except Exception as exc:
            print(f"[tickets-voz] Qwen3: {exc}")

    if audio_bytes is None:
        eleven_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
        eleven_voice = os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9").strip()
        if eleven_key:
            import requests as _req
            try:
                r = _req.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{eleven_voice}",
                    headers={"xi-api-key": eleven_key, "Content-Type": "application/json"},
                    json={
                        "text": texto,
                        "model_id": "eleven_multilingual_v2",
                        "voice_settings": {"stability": 0.45, "similarity_boost": 0.80},
                    },
                    timeout=30,
                )
                r.raise_for_status()
                audio_bytes = r.content
                mime_type = "audio/mpeg"
            except Exception as exc:
                print(f"[tickets-voz] ElevenLabs: {exc}")

    return audio_bytes, mime_type


def enviar_nota_voz_operador(usuario_id: int | None, guion: str) -> bool:
    if not _voz_habilitada():
        return False
    numero = telefono_operador(usuario_id)
    if not numero:
        print(f"[tickets-voz] Sin teléfono para usuario {usuario_id}")
        return False
    audio, mime = _sintetizar_voz(guion)
    if not audio:
        print(f"[tickets-voz] TTS falló para usuario {usuario_id}")
        return False
    from app.utils import enviar_voz_supervisor
    ok = enviar_voz_supervisor(numero, audio, mime)
    if ok:
        print(f"[tickets-voz] Enviado a usuario {usuario_id} ({numero[:6]}…)")
    return ok


def _programar(usuario_id: int | None, guion: str) -> None:
    if not usuario_id or not guion.strip():
        return
    try:
        from app.observability import spawn_thread
        spawn_thread(
            enviar_nota_voz_operador,
            (int(usuario_id), guion),
            daemon=True,
        )
    except Exception as exc:
        print(f"[tickets-voz] programar: {exc}")


def _ticket_row(db, ticket_id: int) -> dict | None:
    row = db.execute(
        "SELECT id, numero, titulo, tipo, subtipo, estado, creado_por, asignado_a, ticket_padre_id "
        "FROM tickets WHERE id=?",
        (ticket_id,),
    ).fetchone()
    return dict(row) if row else None


def _titulo_corto(t: str, n: int = 48) -> str:
    t = (t or "").strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def notificar_ticket_creado(ticket_id: int) -> None:
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t or t["tipo"] not in ("accion", "solicitud"):
            return
        asig = t.get("asignado_a")
        if not asig or asig == t.get("creado_por"):
            return
        tipo = "compras" if (t.get("subtipo") or "").strip() == "compra" else (
            "solicitud" if t["tipo"] == "solicitud" else "acción"
        )
        guion = (
            f"Hola. Te asignaron una nueva {tipo} en el panel: "
            f"{_titulo_corto(t.get('titulo') or t.get('numero'))}. "
            "Revisa solicitudes o acciones cuando puedas."
        )
        _programar(asig, guion)


def notificar_compra_delegada(solicitud_id: int) -> None:
    with _conn_ctx() as db:
        t = _ticket_row(db, solicitud_id)
        if not t or (t.get("subtipo") or "").strip() != "compra":
            return
        asig = t.get("asignado_a")
        if not asig:
            return
        padre = ""
        if t.get("ticket_padre_id"):
            p = _ticket_row(db, int(t["ticket_padre_id"]))
            padre = _titulo_corto((p or {}).get("titulo") or "", 40)
        extra = f" para la acción {padre}." if padre else "."
        guion = (
            "Hola. Te delegaron una lista de compras en el panel"
            f"{extra} Abre solicitudes e inicia las compras cuando estés listo."
        )
        _programar(asig, guion)


def notificar_ticket_resuelto(ticket_id: int, resolvio_uid: int) -> None:
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t:
            return
        resolvio = _nombre_usuario(db, resolvio_uid)
        numero = t.get("numero") or ""
        titulo = _titulo_corto(t.get("titulo") or numero)
        subtipo = (t.get("subtipo") or "").strip()

        creador = t.get("creado_por")
        if t["tipo"] == "solicitud" and creador and creador != resolvio_uid:
            if subtipo == "compra":
                guion = (
                    f"Hola. {resolvio} ya terminó la lista de compras "
                    f"de la solicitud {numero}. "
                )
                if t.get("ticket_padre_id"):
                    p = _ticket_row(db, int(t["ticket_padre_id"]))
                    if p:
                        guion += (
                            f"Puedes continuar la acción "
                            f"{_titulo_corto(p.get('titulo') or '')}."
                        )
                else:
                    guion += "Puedes continuar con tu acción en el panel."
            else:
                guion = (
                    f"Hola. {resolvio} ya resolvió tu solicitud {numero}: "
                    f"{titulo}."
                )
            _programar(creador, guion)

        if subtipo == "compra" and t.get("ticket_padre_id"):
            padre = _ticket_row(db, int(t["ticket_padre_id"]))
            if padre:
                esperan = {padre.get("creado_por"), padre.get("asignado_a")} - {
                    None, resolvio_uid,
                }
                for uid in esperan:
                    if uid == creador:
                        continue
                    guion = (
                        f"Hola. {resolvio} completó la lista de compras que esperabas "
                        f"para la acción {_titulo_corto(padre.get('titulo') or numero)}. "
                        "Ya puedes seguir en el panel."
                    )
                    _programar(uid, guion)


def notificar_ticket_reasignado(ticket_id: int, nuevo_asignado: int | None) -> None:
    if not nuevo_asignado:
        return
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t or t["tipo"] not in ("accion", "solicitud"):
            return
        guion = (
            f"Hola. Te reasignaron una tarea en el panel: "
            f"{_titulo_corto(t.get('titulo') or t.get('numero'))}."
        )
        _programar(nuevo_asignado, guion)
