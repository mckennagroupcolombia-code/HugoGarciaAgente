"""
Voicebox TTS — cliente HTTP al servicio FastAPI de voicebox (puerto 17493).
https://github.com/jamiepine/voicebox

API flow:
  POST /generate           → { id, status, ... }   (async job)
  GET  /history/{id}       → poll JSON until status == "completed"  ← correcto
  GET  /audio/{id}         → WAV bytes

NOTA: GET /generate/{id}/status es un endpoint SSE (Server-Sent Events),
no JSON plano. Usar /history/{id} para polling estándar.

Motor de síntesis:
  "qwen"  (default)  → Qwen3-TTS-1.7B; con profile_id usa las muestras del perfil.
  "qwen"  model_size="0.6B" → versión más rápida.
  "chatterbox", "chatterbox_turbo", "kokoro", "luxtts" → alternativas.

IMPORTANTE: engine="qwen_custom_voice" NO funciona para perfiles clonados
(la API lo rechaza con 400). Usar engine="qwen" — voicebox selecciona la
estrategia de clonación automáticamente cuando el perfil tiene muestras.

Mapeo nombres internos del panel → parámetros de la API:
  "qwen3"    → engine="qwen"
  "qwen3-0.6b" → engine="qwen"  model_size="0.6B"
  los demás  → engine=mismo nombre
"""
from __future__ import annotations
import os
import time
import threading
import requests as _req

_BASE          = os.getenv("VOICEBOX_URL", "http://localhost:17493")
_TIMEOUT_GEN   = 300   # TTS puede tardar en primera carga de modelos (llamadas en background, no HTTP interactivo)
_TIMEOUT_POLL  = 10
_TIMEOUT_SHORT = 5
_POLL_INTERVAL = 1.5   # segundos entre polls de /history

# Voicebox no serializa sus propias generaciones: dos /generate concurrentes
# en la misma GPU se traban entre sí y pueden quedar "generating" indefinidamente
# (visto en producción 2026-08-18: dos jobs simultáneos nunca terminaron, causando
# HTTP 524 en cadena porque cada reintento del cliente sumaba otro job concurrente).
# Este lock serializa las síntesis del proceso Flask; quien no consigue el lock
# de inmediato debe fallar rápido (VoiceboxOcupado) en vez de encolarse a ciegas.
_gen_lock = threading.Lock()


class VoiceboxOcupado(Exception):
    """Ya hay una síntesis de voicebox en curso en este proceso."""


# ── engine name mapping ────────────────────────────────────────────────────
# qwen_custom_voice eliminado: la API lo rechaza para perfiles clonados.
# engine="qwen" es el correcto — voicebox usa las muestras del perfil automáticamente.

_ENGINE_MAP: dict[str, dict] = {
    "qwen3":           {"engine": "qwen"},
    "qwen3-0.6b":      {"engine": "qwen", "model_size": "0.6B"},
    "chatterbox":      {"engine": "chatterbox"},
    "chatterbox_turbo": {"engine": "chatterbox_turbo"},
    "kokoro":          {"engine": "kokoro"},
    "luxtts":          {"engine": "luxtts"},
}


def voicebox_disponible() -> bool:
    try:
        r = _req.get(f"{_BASE}/profiles", timeout=_TIMEOUT_SHORT)
        return r.status_code < 500
    except Exception:
        return False


def _poll_and_download(gen_id: str, max_espera: float = _TIMEOUT_GEN) -> bytes:
    """Espera a que una generación termine y descarga el WAV.

    Usa GET /history/{id} (JSON) en lugar del endpoint SSE /generate/{id}/status.
    """
    deadline = time.time() + max_espera
    while time.time() < deadline:
        hr = _req.get(f"{_BASE}/history/{gen_id}", timeout=_TIMEOUT_POLL)
        hr.raise_for_status()
        hd = hr.json()
        s  = hd.get("status", "")
        if s == "completed":
            break
        if s in ("failed", "error"):
            raise RuntimeError(f"voicebox generation failed: {hd.get('error')}")
        time.sleep(_POLL_INTERVAL)
    else:
        # No basta con darnos por vencidos: si solo dejamos de esperar, el job
        # sigue corriendo "huérfano" en la GPU de voicebox y choca con el siguiente
        # intento (incidente 2026-08-19: el cliente se rindió a los 70s, liberó el
        # lock, y el siguiente clic arrancó una segunda generación mientras la
        # primera —abandonada, no cancelada— seguía viva). Cancelar aquí libera
        # la GPU de verdad en vez de solo dejar de mirar.
        try:
            _req.post(f"{_BASE}/generate/{gen_id}/cancel", timeout=_TIMEOUT_SHORT)
        except Exception:
            pass
        raise TimeoutError("voicebox: timeout esperando generación (cancelada)")

    ar = _req.get(f"{_BASE}/audio/{gen_id}", timeout=_TIMEOUT_GEN)
    ar.raise_for_status()
    return ar.content


def sintetizar_voicebox(
    texto: str,
    profile_id: str = "",
    engine: str = "",
    language: str = "es",
    max_espera: float = _TIMEOUT_GEN,
) -> bytes:
    """
    Genera audio WAV usando voicebox.

    Con profile_id: POST /generate con engine=qwen (clonación desde muestras del perfil).
    Sin profile_id: POST /speak con voz base.

    max_espera: tope en segundos para esperar la generación (ver _poll_and_download).
    Los llamadores HTTP interactivos deben usar un tope corto (<100s, límite de
    Cloudflare) — usar sintetizar_voicebox_interactivo() en vez de esta función
    directamente para eso.
    """
    from app.services.voz_config import voicebox_language_code
    lang = voicebox_language_code(language)

    if profile_id:
        # engine "qwen" es el correcto para clonación con perfiles.
        # Todos los nombres qwen* mapean a "qwen"; otros engines se respetan.
        if engine in ("qwen3", "qwen3-0.6b", "qwen_custom_voice", "", "qwen"):
            model_size = "0.6B" if engine == "qwen3-0.6b" else "1.7B"
            eng_params: dict = {"engine": "qwen", "model_size": model_size}
        else:
            eng_params = _ENGINE_MAP.get(engine, {"engine": "qwen"})

        payload: dict = {
            "profile_id": profile_id,
            "text":       texto,
            "language":   lang,
            **eng_params,
        }
        r = _req.post(f"{_BASE}/generate", json=payload, timeout=_TIMEOUT_GEN)
        r.raise_for_status()
        gen_id = r.json()["id"]
    else:
        # Sin perfil: /speak con voz base
        eng_params = _ENGINE_MAP.get(engine, {"engine": "qwen"})
        payload = {
            "text":     texto,
            "language": lang,
            "engine":   eng_params.get("engine", "qwen"),
        }
        r = _req.post(f"{_BASE}/speak", json=payload, timeout=_TIMEOUT_GEN)
        r.raise_for_status()
        gen_id = r.json()["id"]

    return _poll_and_download(gen_id, max_espera=max_espera)


def sintetizar_voicebox_interactivo(
    texto: str,
    profile_id: str = "",
    engine: str = "",
    language: str = "es",
    max_espera: float = 70.0,
    espera_lock: float = 3.0,
) -> bytes:
    """
    Igual que sintetizar_voicebox(), pero serializa las llamadas con _gen_lock
    y falla rápido si ya hay otra síntesis en curso, en vez de dejar que dos
    generaciones concurrentes se traben mutuamente en la GPU (ver comentario junto
    a _gen_lock). Pensada para el endpoint HTTP interactivo /api/voz/sintetizar,
    donde Cloudflare corta la conexión a los 100 s (error 524) si no hay respuesta.
    """
    if not _gen_lock.acquire(timeout=espera_lock):
        raise VoiceboxOcupado("Ya hay una síntesis de voz en curso, espera un momento.")
    try:
        return sintetizar_voicebox(
            texto, profile_id=profile_id, engine=engine, language=language,
            max_espera=max_espera,
        )
    finally:
        _gen_lock.release()


def listar_perfiles_voicebox() -> list[dict]:
    """Devuelve lista de perfiles de voz guardados en voicebox."""
    try:
        r = _req.get(f"{_BASE}/profiles", timeout=_TIMEOUT_SHORT)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else data.get("profiles", [])
    except Exception:
        return []


def crear_perfil_voicebox(nombre: str) -> dict:
    """Crea un nuevo perfil de voz. Retorna el perfil creado con su id."""
    r = _req.post(f"{_BASE}/profiles", json={"name": nombre}, timeout=_TIMEOUT_SHORT)
    r.raise_for_status()
    return r.json()


def agregar_muestra_voicebox(
    profile_id: str,
    audio_bytes: bytes,
    ref_text: str = "",
    filename: str = "sample.wav",
    content_type: str = "",
) -> dict:
    """Sube una muestra de audio de referencia a un perfil para clonación de voz.

    API voicebox: multipart/form-data con campos 'file' y 'reference_text' (ambos requeridos).
    """
    fn = filename.lower()
    if content_type and content_type.startswith("audio/"):
        mime = content_type.split(";")[0].strip()
    elif fn.endswith(".wav"):
        mime = "audio/wav"
    elif fn.endswith(".webm"):
        mime = "audio/webm"
    elif fn.endswith(".ogg"):
        mime = "audio/ogg"
    elif fn.endswith(".mp3"):
        mime = "audio/mpeg"
    else:
        mime = "audio/webm"
    r = _req.post(
        f"{_BASE}/profiles/{profile_id}/samples",
        files={"file": (filename, audio_bytes, mime)},
        data={"reference_text": ref_text or " "},  # requerido por la API
        timeout=_TIMEOUT_GEN,
    )
    r.raise_for_status()
    return r.json()


def eliminar_perfil_voicebox(profile_id: str) -> None:
    try:
        _req.delete(f"{_BASE}/profiles/{profile_id}", timeout=_TIMEOUT_SHORT)
    except Exception:
        pass


def estado_modelos_voicebox() -> list[dict]:
    """Devuelve el estado de descarga de todos los modelos."""
    try:
        r = _req.get(f"{_BASE}/models/status", timeout=_TIMEOUT_SHORT)
        r.raise_for_status()
        return r.json().get("models", [])
    except Exception:
        return []


def listar_generaciones_voicebox(profile_id: str = "", limit: int = 30) -> list[dict]:
    """Historial de generaciones (para poder escuchar/borrar las que salieron mal)."""
    params: dict = {"limit": limit}
    if profile_id:
        params["profile_id"] = profile_id
    r = _req.get(f"{_BASE}/history", params=params, timeout=_TIMEOUT_SHORT)
    r.raise_for_status()
    data = r.json()
    return data.get("items", data) if isinstance(data, dict) else data


def eliminar_generacion_voicebox(generation_id: str) -> None:
    """Borra una generación (audio) puntual del historial de voicebox."""
    r = _req.delete(f"{_BASE}/history/{generation_id}", timeout=_TIMEOUT_SHORT)
    r.raise_for_status()


def limpiar_generaciones_fallidas_voicebox() -> dict:
    """Limpia de un solo golpe todas las generaciones marcadas como fallidas."""
    r = _req.delete(f"{_BASE}/history/failed", timeout=_TIMEOUT_SHORT)
    r.raise_for_status()
    return r.json() if r.content else {}


def tareas_activas_voicebox() -> list[dict]:
    """Generaciones que voicebox reporta como realmente en curso ahora mismo.

    Sirve para detectar una generación atascada (ver también cancelar_generacion_voicebox)
    sin depender del estado "generating" que puede quedar huérfano en /history.
    """
    r = _req.get(f"{_BASE}/tasks/active", timeout=_TIMEOUT_SHORT)
    r.raise_for_status()
    return r.json().get("generations", [])


def cancelar_generacion_voicebox(generation_id: str) -> None:
    """Cancela una generación en curso en voicebox (p. ej. una que quedó atascada).

    Si esa generación es la que tiene tomado _gen_lock (petición interactiva en curso),
    su poll la verá "failed"/"cancelled" en el siguiente ciclo (~1.5s) y liberará el
    lock por su cuenta, en vez de agotar el max_espera completo.
    """
    r = _req.post(f"{_BASE}/generate/{generation_id}/cancel", timeout=_TIMEOUT_SHORT)
    r.raise_for_status()


def reiniciar_servicio_voicebox(espera_max: float = 40.0) -> dict:
    """Reinicia voicebox-tts.service (systemd) y espera a que vuelva a responder.

    Motivo: el proceso de voicebox acumula uso de CPU/hilos durante sesiones largas
    (medido en producción 2026-08-19: tras ~2h de uso, ~97% CPU promedio y 150+
    hilos; generaciones que tardaban 5-20s pasaron a 70-90s+ y empezaron a agotar
    max_espera en cadena) — un reinicio limpio del servicio lo resuelve. No es un
    bug de nuestra integración: es degradación del proceso de voicebox mismo.
    Requiere sudo NOPASSWD para systemctl (ya configurado en este host).
    """
    import subprocess
    try:
        subprocess.run(
            ["sudo", "systemctl", "restart", "voicebox-tts"],
            timeout=15, check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as exc:
        return {"ok": False, "error": f"systemctl restart falló: {(exc.stderr or str(exc)).strip()[:300]}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    deadline = time.time() + espera_max
    while time.time() < deadline:
        time.sleep(2)
        if voicebox_disponible():
            return {"ok": True}
    return {"ok": False, "error": "El servicio no respondió tras reiniciar (revisa journalctl -u voicebox-tts)"}
