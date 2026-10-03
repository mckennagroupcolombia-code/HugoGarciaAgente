"""
STT local con faster-whisper (GPU cuando disponible).
Primera llamada descarga el modelo (~460 MB para 'small', ~1.5 GB para 'medium').
"""
from __future__ import annotations
import os
import tempfile
import threading

_lock  = threading.Lock()
_model = None
_MODEL_SIZE = os.getenv("WHISPER_MODEL", "medium")   # tiny / base / small / medium / large-v3


def whisper_disponible() -> bool:
    try:
        import importlib.util
        return importlib.util.find_spec("faster_whisper") is not None
    except Exception:
        return False


def _get_model():
    global _model
    if _model is not None:
        return _model
    from faster_whisper import WhisperModel
    # La GPU se detecta con ctranslate2 (el motor real de faster-whisper), NO con
    # torch: faster-whisper no depende de torch y arrastrarlo por una sola línea
    # de detección metía 7 GB de CUDA+PyTorch en el venv (auditoría 20-sep-2026).
    try:
        import ctranslate2
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        device = "cpu"
    compute = "float16" if device == "cuda" else "int8"
    print(f"[Whisper STT] Cargando modelo '{_MODEL_SIZE}' en {device} ({compute})…")
    _model = WhisperModel(_MODEL_SIZE, device=device, compute_type=compute)
    print("[Whisper STT] Modelo listo.")
    return _model


def transcribir(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Transcribe audio bytes en español. Retorna texto o string vacío."""
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "webm"
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        with _lock:
            model = _get_model()
            segments, _info = model.transcribe(
                tmp_path,
                language="es",
                beam_size=5,
                vad_filter=True,          # elimina silencio
                vad_parameters={"min_silence_duration_ms": 500},
            )
            return " ".join(s.text.strip() for s in segments).strip()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
