"""
Configuración persistente del motor TTS y clonación de voz.

Estructura de app/data/voz_config.json:
{
  "engine":        "qwen3" | "elevenlabs" | "browser",
  "language":      "Spanish" | "English" | "Chinese" | ...,
  "speaker":       "ryan",      # solo para Qwen3 sin clonación
  "clone_enabled": false,       # true cuando hay audio de referencia guardado
  "ref_text":      "",          # transcripción del audio de referencia
  "ref_audio_path": ""          # ruta al WAV de referencia en disco
}
"""
from __future__ import annotations
import json
import os

_DATA_DIR   = os.path.join(os.path.dirname(__file__), "../data")
_CONFIG_FILE = os.path.join(_DATA_DIR, "voz_config.json")
_CLONES_DIR  = os.path.join(_DATA_DIR, "voz_clones")
_REF_WAV     = os.path.join(_CLONES_DIR, "referencia.wav")

_DEFAULTS: dict = {
    "engine":           "qwen3",
    "language":         "Spanish",
    "speaker":          "ryan",
    "clone_enabled":    False,
    "ref_text":         "",
    "ref_audio_path":   "",
    "wake_word":        "hugo",
    "listen_memory":    True,
    "voicebox_profile": "",
    "voicebox_engine":  "qwen3",
}

_ENGINES_VALIDOS = {"qwen3", "voicebox", "elevenlabs", "browser"}
_LANGS_VALIDOS   = {"Spanish", "English", "Chinese", "Japanese", "Korean",
                    "German", "French", "Italian", "Russian"}


def leer_config() -> dict:
    try:
        with open(_CONFIG_FILE, encoding="utf-8") as f:
            data = json.load(f)
        cfg = {**_DEFAULTS, **{k: v for k, v in data.items() if k in _DEFAULTS}}
    except (FileNotFoundError, json.JSONDecodeError):
        cfg = dict(_DEFAULTS)
    # Verificar si todavía existe el audio de referencia
    if cfg.get("clone_enabled") and not os.path.isfile(cfg.get("ref_audio_path", "")):
        cfg["clone_enabled"] = False
        cfg["ref_audio_path"] = ""
        _escribir_config(cfg)
    return cfg


def _escribir_config(cfg: dict) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def guardar_config(
    engine: str | None = None,
    language: str | None = None,
    speaker: str | None = None,
    ref_text: str | None = None,
    wake_word: str | None = None,
    listen_memory: bool | None = None,
    voicebox_profile: str | None = None,
    voicebox_engine: str | None = None,
) -> dict:
    cfg = leer_config()
    if engine and engine in _ENGINES_VALIDOS:
        cfg["engine"] = engine
    if language and language in _LANGS_VALIDOS:
        cfg["language"] = language
    if speaker:
        cfg["speaker"] = speaker.lower().strip()
    if ref_text is not None:
        cfg["ref_text"] = ref_text.strip()
    if wake_word is not None:
        cfg["wake_word"] = wake_word.strip().lower()
    if listen_memory is not None:
        cfg["listen_memory"] = bool(listen_memory)
    if voicebox_profile is not None:
        cfg["voicebox_profile"] = voicebox_profile.strip()
    if voicebox_engine is not None:
        cfg["voicebox_engine"] = voicebox_engine.strip()
    _escribir_config(cfg)
    return cfg


def guardar_audio_referencia(audio_bytes: bytes, ref_text: str = "") -> dict:
    """Guarda el WAV de referencia y activa la clonación."""
    os.makedirs(_CLONES_DIR, exist_ok=True)
    with open(_REF_WAV, "wb") as f:
        f.write(audio_bytes)
    cfg = leer_config()
    cfg["clone_enabled"]  = True
    cfg["ref_audio_path"] = _REF_WAV
    cfg["ref_text"]       = ref_text.strip()
    _escribir_config(cfg)
    return cfg


def eliminar_audio_referencia() -> dict:
    """Borra el audio de referencia y desactiva la clonación."""
    try:
        os.unlink(_REF_WAV)
    except FileNotFoundError:
        pass
    cfg = leer_config()
    cfg["clone_enabled"]  = False
    cfg["ref_audio_path"] = ""
    cfg["ref_text"]       = ""
    _escribir_config(cfg)
    return cfg


def leer_audio_referencia() -> bytes | None:
    cfg = leer_config()
    path = cfg.get("ref_audio_path", "")
    if not path or not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return f.read()
