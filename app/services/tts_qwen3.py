"""
Servicio Qwen3 TTS local — carga el modelo en GPU (cuda:0) la primera vez
y lo mantiene en VRAM para respuestas rápidas.

Uso:
    from app.services.tts_qwen3 import sintetizar_qwen3, clonar_voz_qwen3, qwen3_disponible

Requiere instalación previa:
    bash scripts/instalar_qwen3_tts.sh
"""

from __future__ import annotations
import io
import os
import threading

_lock = threading.Lock()
_model = None
_modelo_id = os.getenv(
    "QWEN3_TTS_MODEL",
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
)
_speaker_default = os.getenv("QWEN3_TTS_SPEAKER", "ryan")  # minúsculas: ryan, aiden, serena, vivian…


def qwen3_disponible() -> bool:
    try:
        import importlib.util
        return importlib.util.find_spec("qwen_tts") is not None
    except Exception:
        return False


def _cargar_modelo():
    global _model
    if _model is not None:
        return _model
    import torch
    from qwen_tts import Qwen3TTSModel

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    print(f"[Qwen3 TTS] Cargando {_modelo_id} en {device}…")
    _model = Qwen3TTSModel.from_pretrained(
        _modelo_id,
        device_map=device,
        dtype=dtype,
    )
    print("[Qwen3 TTS] Modelo listo.")
    return _model


def sintetizar_qwen3(
    texto: str,
    speaker: str | None = None,
    language: str = "Spanish",
) -> bytes:
    """
    Genera audio WAV usando voces predefinidas (ryan, aiden, serena, vivian…).
    Retorna bytes WAV.
    """
    if not qwen3_disponible():
        raise RuntimeError(
            "qwen-tts no instalado. Ejecuta: bash scripts/instalar_qwen3_tts.sh"
        )

    import soundfile as sf

    speaker = (speaker or _speaker_default).lower()
    with _lock:
        model = _cargar_modelo()
        wavs, sr = model.generate_custom_voice(
            text=texto,
            language=language,
            speaker=speaker,
        )

    buf = io.BytesIO()
    sf.write(buf, wavs[0], sr, format="WAV")
    buf.seek(0)
    return buf.read()


def clonar_voz_qwen3(
    texto: str,
    ref_audio_bytes: bytes,
    ref_text: str,
    language: str = "Spanish",
) -> bytes:
    """
    Clona la voz del audio de referencia y sintetiza 'texto' con ella.
    ref_audio_bytes: WAV de al menos 3 segundos de la voz a clonar.
    ref_text: transcripción de lo que se dice en el audio de referencia.
    Retorna bytes WAV.
    """
    if not qwen3_disponible():
        raise RuntimeError(
            "qwen-tts no instalado. Ejecuta: bash scripts/instalar_qwen3_tts.sh"
        )

    import soundfile as sf
    import numpy as np

    with _lock:
        model = _cargar_modelo()

        # Cargar ref_audio a numpy array
        import io as _io
        ref_buf = _io.BytesIO(ref_audio_bytes)
        ref_array, ref_sr = sf.read(ref_buf)
        if ref_array.ndim > 1:
            ref_array = ref_array.mean(axis=1)  # mono

        wavs, sr = model.generate_voice_clone(
            text=texto,
            language=language,
            ref_audio=(ref_array, ref_sr),
            ref_text=ref_text,
        )

    buf = io.BytesIO()
    sf.write(buf, wavs[0], sr, format="WAV")
    buf.seek(0)
    return buf.read()
