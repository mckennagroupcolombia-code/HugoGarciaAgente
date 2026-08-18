"""Elimina una marca de agua estática de un video mediante inpainting (OpenCV).

Uso:
    python3 eliminar_marca_agua_video.py input.mp4 output_sin_marca.mp4
    python3 eliminar_marca_agua_video.py input.mp4 output.mp4 --alto-marca 70
    python3 eliminar_marca_agua_video.py input.mp4 output.mp4 --region 0,900,400,80

Requiere: opencv-python-headless, numpy (ver requirements.txt) y ffmpeg en PATH
(para conservar el audio original, que cv2.VideoWriter no soporta).
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np


def _construir_mascara(alto: int, ancho: int, alto_marca: int, region: tuple[int, int, int, int] | None) -> np.ndarray:
    mask = np.zeros((alto, ancho), dtype=np.uint8)
    if region:
        x, y, w, h = region
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


def eliminar_marca_agua(
    video_entrada: str,
    video_salida: str,
    alto_marca: int = 80,
    region: tuple[int, int, int, int] | None = None,
    inpaint_radius: int = 3,
    conservar_audio: bool = True,
) -> None:
    """Elimina una marca de agua estática rellenando la zona con inpainting.

    El video intermedio de cv2.VideoWriter queda en MPEG-4 Part 2 (fourcc "mp4v"):
    lo reproduce cualquier navegador, pero WhatsApp y otras apps de mensajería lo
    rechazan como "archivo no compatible" porque solo aceptan H.264/AAC. Por eso
    el paso final SIEMPRE transcodifica a H.264 con ffmpeg (obligatorio, no
    opcional), agregando el audio original si aplica.

    :param video_entrada: Ruta al archivo de video original.
    :param video_salida: Ruta al video resultante sin marca.
    :param alto_marca: Píxeles desde el borde inferior que ocupa la marca (ignorado si se pasa `region`).
    :param region: (x, y, w, h) de la zona a limpiar; si se da, tiene prioridad sobre `alto_marca`.
    :param inpaint_radius: Radio de vecindad para cv2.inpaint.
    :param conservar_audio: Si True, incluye el audio original del video de entrada en la salida.
    """
    if not Path(video_entrada).is_file():
        raise FileNotFoundError(f"No existe el video de entrada: {video_entrada}")

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg no está instalado; no se puede generar un video compatible con WhatsApp.")

    cap = cv2.VideoCapture(video_entrada)
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir el video de entrada: {video_entrada}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    ancho = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    alto = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))  # puede venir en 0 según el contenedor

    mask = _construir_mascara(alto, ancho, alto_marca, region)

    salida_path = Path(video_salida)
    salida_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_silencioso = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_silencioso.close()
    ruta_escritura = tmp_silencioso.name

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(ruta_escritura, fourcc, fps, (ancho, alto))
    if not out.isOpened():
        cap.release()
        raise RuntimeError(f"No se pudo crear el video de salida: {ruta_escritura}")

    print(f"Procesando video ({total_frames or '?'} fotogramas estimados)...")
    frame_count = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_limpio = cv2.inpaint(frame, mask, inpaintRadius=inpaint_radius, flags=cv2.INPAINT_TELEA)
            out.write(frame_limpio)

            frame_count += 1
            if total_frames and frame_count % 30 == 0:
                print(f"  {frame_count}/{total_frames} fotogramas...")
    finally:
        cap.release()
        out.release()

    print("Transcodificando a H.264 (compatible con WhatsApp)...")
    try:
        incluir_audio = conservar_audio and _tiene_pista_audio(video_entrada)
        if incluir_audio:
            comando = [
                "ffmpeg", "-y",
                "-i", ruta_escritura,
                "-i", video_entrada,
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "20",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "128k",
                "-shortest",
                "-movflags", "+faststart",
                video_salida,
            ]
        else:
            comando = [
                "ffmpeg", "-y",
                "-i", ruta_escritura,
                "-an",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "20",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                video_salida,
            ]

        resultado = subprocess.run(comando, capture_output=True, text=True)
        if resultado.returncode != 0:
            raise RuntimeError(f"ffmpeg falló al generar el video final:\n{resultado.stderr[-2000:]}")
    finally:
        if Path(ruta_escritura).exists():
            Path(ruta_escritura).unlink(missing_ok=True)

    print(f"Proceso finalizado ({frame_count} fotogramas). Video guardado en: {video_salida}")


def _parse_region(valor: str) -> tuple[int, int, int, int]:
    partes = [int(p) for p in valor.split(",")]
    if len(partes) != 4:
        raise argparse.ArgumentTypeError("El formato de --region debe ser x,y,w,h")
    return tuple(partes)  # type: ignore[return-value]


def main() -> None:
    parser = argparse.ArgumentParser(description="Elimina una marca de agua estática de un video (inpainting).")
    parser.add_argument("video_entrada", help="Ruta al video original")
    parser.add_argument("video_salida", help="Ruta al video resultante")
    parser.add_argument("--alto-marca", type=int, default=80, help="Alto en píxeles de la franja inferior a limpiar (default: 80)")
    parser.add_argument("--region", type=_parse_region, default=None, help="Región exacta x,y,w,h a limpiar (tiene prioridad sobre --alto-marca)")
    parser.add_argument("--inpaint-radius", type=int, default=3, help="Radio de vecindad para cv2.inpaint (default: 3)")
    parser.add_argument("--sin-audio", action="store_true", help="No conservar el audio original (más rápido)")
    args = parser.parse_args()

    eliminar_marca_agua(
        args.video_entrada,
        args.video_salida,
        alto_marca=args.alto_marca,
        region=args.region,
        inpaint_radius=args.inpaint_radius,
        conservar_audio=not args.sin_audio,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - script de consola, se reporta y se sale con código de error
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
