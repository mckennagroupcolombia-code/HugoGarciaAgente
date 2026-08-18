"""Herramientas de video del panel Contenido: quitar marca de agua y/o poner audio.

Expone la lógica reusada por el CLI (`eliminar_marca_agua_video.py` en la raíz del
repo, solo watermark) y por el panel de Sistemas → Contenido
(`/api/contenido/procesar-video` en `app/routes.py`, ambas capacidades). El
procesamiento corre en un hilo daemon vía `spawn_thread`; el estado se consulta
por `job_id` igual que el patrón de `app/tools/plantillas_texto_ia.py` (jobs de
texto mágico).

La voz clonada NO se genera aquí: el panel la sintetiza aparte llamando a
`/api/voz/sintetizar` (motor voicebox, mismo servicio que usa Voz IA — ver
`app/services/tts_voicebox.py`) y sube el WAV resultante como `audio_externo`.
"""
from __future__ import annotations

import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np

from app.observability import spawn_thread

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONTENIDO_VIDEO_DIR = BASE_DIR / "contenido_video"
ENTRADA_DIR = CONTENIDO_VIDEO_DIR / "entrada"
SALIDA_DIR = CONTENIDO_VIDEO_DIR / "salida"

_JOB_TTL_SEC = 3600  # 1 hora: tiempo suficiente para previsualizar y descargar
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

AUDIO_MODOS = ("original", "sin_audio", "externo")


def _construir_mascara(alto: int, ancho: int, alto_marca: int, region: tuple[int, int, int, int] | None) -> np.ndarray:
    mask = np.zeros((alto, ancho), dtype=np.uint8)
    if region:
        x, y, w, h = region
        x = max(0, min(x, ancho))
        y = max(0, min(y, alto))
        w = max(0, min(w, ancho - x))
        h = max(0, min(h, alto - y))
        mask[y:y + h, x:x + w] = 255
    else:
        y_inicio = max(0, alto - alto_marca)
        mask[y_inicio:alto, 0:ancho] = 255
    return mask


def _tiene_pista_audio(video_entrada: str) -> bool:
    resultado = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", video_entrada],
        capture_output=True, text=True,
    )
    return bool(resultado.stdout.strip())


def procesar_video(
    video_entrada: str,
    video_salida: str,
    *,
    quitar_marca_agua: bool = True,
    alto_marca: int = 80,
    region: tuple[int, int, int, int] | None = None,
    inpaint_radius: int = 3,
    audio_modo: str = "original",
    audio_externo: str | None = None,
    on_progreso=None,
) -> None:
    """Quita la marca de agua (opcional) y resuelve la pista de audio final.

    El video intermedio de cv2.VideoWriter queda en MPEG-4 Part 2 (fourcc
    "mp4v"): lo reproduce cualquier navegador, pero WhatsApp y otras apps de
    mensajería lo rechazan como "archivo no compatible" porque solo aceptan
    H.264/AAC. Por eso el paso final SIEMPRE transcodifica a H.264 con ffmpeg
    (obligatorio, no opcional), incluso cuando `quitar_marca_agua=False` (en
    ese caso se salta el inpainting por completo — solo transcodifica/muxa).

    :param audio_modo: "original" (pista del propio `video_entrada`),
        "sin_audio" (silencio) o "externo" (usa `audio_externo`: voz clonada
        generada con voicebox, o un archivo de audio subido por el usuario).
    :param audio_externo: ruta a un archivo de audio; requerido si audio_modo="externo".
    :param on_progreso: callback opcional `(frame_actual, total_frames)`, solo
        se invoca si `quitar_marca_agua=True` (con marca desactivada el paso
        es un simple mux/transcode, casi instantáneo).
    """
    if not Path(video_entrada).is_file():
        raise FileNotFoundError(f"No existe el video de entrada: {video_entrada}")
    if audio_modo not in AUDIO_MODOS:
        raise ValueError(f"audio_modo inválido: {audio_modo}")
    if audio_modo == "externo" and not audio_externo:
        raise ValueError("audio_modo='externo' requiere audio_externo")
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg no está instalado en el servidor; no se puede generar un video compatible.")

    salida_path = Path(video_salida)
    salida_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_video: Path | None = None
    fuente_video = video_entrada

    if quitar_marca_agua:
        cap = cv2.VideoCapture(video_entrada)
        if not cap.isOpened():
            raise RuntimeError(f"No se pudo abrir el video de entrada: {video_entrada}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        ancho = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        alto = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        mask = _construir_mascara(alto, ancho, alto_marca, region)
        tmp_video = SALIDA_DIR / f".tmp-{uuid.uuid4().hex[:12]}.mp4"

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(str(tmp_video), fourcc, fps, (ancho, alto))
        if not out.isOpened():
            cap.release()
            raise RuntimeError(f"No se pudo crear el video de salida: {tmp_video}")

        frame_count = 0
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                frame_limpio = cv2.inpaint(frame, mask, inpaintRadius=inpaint_radius, flags=cv2.INPAINT_TELEA)
                out.write(frame_limpio)

                frame_count += 1
                if on_progreso and frame_count % 15 == 0:
                    on_progreso(frame_count, total_frames)
        finally:
            cap.release()
            out.release()

        if on_progreso:
            on_progreso(frame_count, total_frames)

        fuente_video = str(tmp_video)

    try:
        if audio_modo == "externo":
            incluir_audio = True
            audio_fuente = audio_externo
        elif audio_modo == "sin_audio":
            incluir_audio = False
            audio_fuente = None
        else:  # "original"
            incluir_audio = _tiene_pista_audio(video_entrada)
            audio_fuente = video_entrada

        comando = ["ffmpeg", "-y", "-i", fuente_video]
        if incluir_audio:
            comando += ["-i", audio_fuente, "-map", "0:v:0", "-map", "1:a:0"]
        else:
            comando += ["-an"]
        comando += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"]
        if incluir_audio:
            comando += ["-c:a", "aac", "-b:a", "128k", "-shortest"]
        comando += ["-movflags", "+faststart", video_salida]

        resultado = subprocess.run(comando, capture_output=True, text=True)
        if resultado.returncode != 0:
            raise RuntimeError(f"ffmpeg falló al generar el video final: {resultado.stderr[-1500:]}")
    finally:
        if tmp_video and tmp_video.exists():
            tmp_video.unlink(missing_ok=True)


def _limpiar_jobs() -> None:
    limite = time.time() - _JOB_TTL_SEC
    with _jobs_lock:
        viejos = [k for k, v in _jobs.items() if (v.get("created") or 0) < limite]
        for k in viejos:
            job = _jobs.pop(k, None)
            if not job:
                continue
            for campo in ("entrada_path", "salida_path"):
                ruta = job.get(campo)
                if ruta:
                    Path(ruta).unlink(missing_ok=True)


def iniciar_job_procesar_video(
    video_bytes: bytes,
    video_ext: str,
    quitar_marca_agua: bool = True,
    alto_marca: int = 80,
    region: tuple[int, int, int, int] | None = None,
    inpaint_radius: int = 3,
    audio_modo: str = "original",
    audio_bytes: bytes | None = None,
    audio_ext: str = ".wav",
) -> str:
    """Guarda el video (y audio externo, si aplica) subidos y lanza el procesamiento en un hilo daemon."""
    _limpiar_jobs()
    ENTRADA_DIR.mkdir(parents=True, exist_ok=True)
    SALIDA_DIR.mkdir(parents=True, exist_ok=True)

    job_id = uuid.uuid4().hex[:16]
    ext = (video_ext or ".mp4").lower()
    if not ext.startswith("."):
        ext = f".{ext}"
    entrada_path = ENTRADA_DIR / f"{job_id}{ext}"
    salida_path = SALIDA_DIR / f"{job_id}.mp4"
    entrada_path.write_bytes(video_bytes)

    audio_path: Path | None = None
    if audio_modo == "externo" and audio_bytes:
        aext = (audio_ext or ".wav").lower()
        if not aext.startswith("."):
            aext = f".{aext}"
        audio_path = ENTRADA_DIR / f"{job_id}-audio{aext}"
        audio_path.write_bytes(audio_bytes)

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "pending",
            "created": time.time(),
            "entrada_path": str(entrada_path),
            "salida_path": None,
            "frame_actual": 0,
            "total_frames": 0,
            "error": None,
        }

    def _on_progreso(frame_actual: int, total_frames: int) -> None:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job:
                job["frame_actual"] = frame_actual
                job["total_frames"] = total_frames

    def _run() -> None:
        try:
            procesar_video(
                str(entrada_path),
                str(salida_path),
                quitar_marca_agua=quitar_marca_agua,
                alto_marca=alto_marca,
                region=region,
                inpaint_radius=inpaint_radius,
                audio_modo=audio_modo,
                audio_externo=str(audio_path) if audio_path else None,
                on_progreso=_on_progreso,
            )
            with _jobs_lock:
                job = _jobs.get(job_id)
                if job:
                    job["status"] = "done"
                    job["salida_path"] = str(salida_path)
        except Exception as exc:
            with _jobs_lock:
                job = _jobs.get(job_id)
                if job:
                    job["status"] = "error"
                    job["error"] = str(exc)
        finally:
            entrada_path.unlink(missing_ok=True)
            if audio_path:
                audio_path.unlink(missing_ok=True)

    with _jobs_lock:
        _jobs[job_id]["status"] = "processing"
    spawn_thread(_run, daemon=True)
    return job_id


def estado_job(job_id: str) -> dict | None:
    _limpiar_jobs()
    with _jobs_lock:
        job = _jobs.get((job_id or "").strip())
        if not job:
            return None
        return dict(job)


def ruta_salida(job_id: str) -> Path | None:
    with _jobs_lock:
        job = _jobs.get((job_id or "").strip())
    if not job or job.get("status") != "done":
        return None
    salida = job.get("salida_path")
    if not salida:
        return None
    path = Path(salida)
    return path if path.is_file() else None


def eliminar_job(job_id: str) -> bool:
    with _jobs_lock:
        job = _jobs.pop((job_id or "").strip(), None)
    if not job:
        return False
    for campo in ("entrada_path", "salida_path"):
        ruta = job.get(campo)
        if ruta:
            Path(ruta).unlink(missing_ok=True)
    return True
