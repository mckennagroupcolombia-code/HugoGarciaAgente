"""Grabaciones de pantalla (video + audio) y clips para enviar por WhatsApp.

El navegador graba con `getDisplayMedia` + `MediaRecorder` (panel Supervisor →
Grabar pantalla) y sube la grabación **por trozos mientras graba**: si la pestaña
se cierra a mitad, lo ya grabado queda en el servidor, y no hay una subida
gigante al final que choque con `MAX_CONTENT_LENGTH` (48 MB) ni con el corte de
100 s de Cloudflare.

Al finalizar, la grabación se remuxea sin recodificar (`-c copy`): el WebM de
MediaRecorder sale sin duración ni índice de búsqueda, y sin eso el <video> del
editor no puede saltar a un segundo concreto.

Los clips se cortan y recortan (la «sección de la pantalla») con ffmpeg a MP4
H.264 + AAC, que es lo que WhatsApp reproduce en todos los teléfonos, y con un
bitrate calculado para quedar por debajo de `CLIP_MAX_MB`. El envío lo hace el
bridge supervisor (:3001 `/enviar-video`) leyendo el archivo del disco — mismo
camino que la nota de voz TTS (`/api/supervisor/bridge/enviar-voz`).

Almacenamiento: `grabaciones_pantalla/<id>/` (gitignored):
    raw.webm          trozos tal como llegan
    grabacion.webm    remux con duración (lo que ve el editor)
    meta.json         título, duración, tamaño, recorte, clips
    clips/<cid>.mp4   clips listos para enviar
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path

from app.observability import spawn_thread

BASE_DIR = Path(__file__).resolve().parent.parent.parent
GRABACIONES_DIR = BASE_DIR / "grabaciones_pantalla"

CLIP_MAX_MB = 15.0          # WhatsApp acepta 16 MB en video "normal"; margen para el contenedor
CLIP_MAX_ANCHO = 1280       # más ancho no se aprecia en un teléfono y solo gasta bitrate
CLIP_MIN_SEG = 0.5
CLIP_MAX_SEG = 600.0
AUDIO_KBPS = 96
VIDEO_KBPS_MAX = 2500
VIDEO_KBPS_MIN = 150

_lock = threading.Lock()


class GrabacionError(ValueError):
    pass


# ── Utilidades ────────────────────────────────────────────────────────────────

def _valido_id(gid: str) -> bool:
    return bool(gid) and len(gid) == 16 and all(c in "0123456789abcdef" for c in gid)


def _dir(gid: str) -> Path:
    if not _valido_id(gid):
        raise GrabacionError("Id de grabación inválido")
    return GRABACIONES_DIR / gid


def _leer_meta(gid: str) -> dict:
    p = _dir(gid) / "meta.json"
    if not p.is_file():
        raise GrabacionError("Grabación no encontrada")
    return json.loads(p.read_text(encoding="utf-8"))


def _guardar_meta(gid: str, meta: dict) -> None:
    p = _dir(gid) / "meta.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def _ffprobe(path: Path) -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,width,height",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise GrabacionError(f"ffprobe no pudo leer el video: {r.stderr[-300:]}")
    data = json.loads(r.stdout or "{}")
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    try:
        duracion = float((data.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duracion = 0.0
    return {
        "duracion": round(duracion, 3),
        "ancho": int(video.get("width") or 0),
        "alto": int(video.get("height") or 0),
        "tiene_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def _normalizar_recorte(recorte, ancho: int, alto: int) -> dict | None:
    """Rectángulo en píxeles del video, dentro del cuadro y con lados pares (x264 lo exige)."""
    if not recorte:
        return None
    try:
        x, y, w, h = (int(round(float(recorte[k]))) for k in ("x", "y", "w", "h"))
    except (KeyError, TypeError, ValueError):
        raise GrabacionError("Recorte inválido: se esperan x, y, w, h")
    if ancho and alto:
        x = max(0, min(x, ancho - 2))
        y = max(0, min(y, alto - 2))
        w = min(w, ancho - x)
        h = min(h, alto - y)
    w -= w % 2
    h -= h % 2
    if w < 16 or h < 16:
        raise GrabacionError("El recorte es demasiado pequeño")
    if ancho and alto and x == 0 and y == 0 and w >= ancho - 1 and h >= alto - 1:
        return None  # es la pantalla completa
    return {"x": x, "y": y, "w": w, "h": h}


def _publica(meta: dict) -> dict:
    out = {k: v for k, v in meta.items() if k != "clips"}
    out["clips"] = sorted(meta.get("clips", {}).values(), key=lambda c: c.get("creado", ""), reverse=True)
    return out


# ── Grabaciones ───────────────────────────────────────────────────────────────

def crear_grabacion(titulo: str = "", usuario: str = "", recorte=None) -> dict:
    gid = uuid.uuid4().hex[:16]
    d = GRABACIONES_DIR / gid
    (d / "clips").mkdir(parents=True, exist_ok=True)
    meta = {
        "id": gid,
        "titulo": (titulo or "").strip()[:120] or f"Grabación {datetime.now():%d/%m %H:%M}",
        "creado": datetime.now().isoformat(timespec="seconds"),
        "usuario": usuario or "",
        "estado": "grabando",
        "trozos": 0,
        "bytes": 0,
        "duracion": 0.0,
        "ancho": 0,
        "alto": 0,
        "tiene_audio": False,
        "recorte": None,
        "clips": {},
    }
    if recorte:
        # Aún no se conoce el tamaño del video: se guarda tal cual y se ajusta al finalizar.
        meta["recorte"] = _normalizar_recorte(recorte, 0, 0)
    _guardar_meta(gid, meta)
    return _publica(meta)


def agregar_trozo(gid: str, seq: int, datos: bytes) -> dict:
    """Agrega un trozo del WebM. Los trozos deben llegar en orden (el panel los encola)."""
    if not datos:
        raise GrabacionError("Trozo vacío")
    with _lock:
        meta = _leer_meta(gid)
        if meta["estado"] != "grabando":
            raise GrabacionError("La grabación ya fue finalizada")
        esperado = int(meta.get("trozos") or 0)
        if seq < esperado:
            return _publica(meta)  # reintento de un trozo ya guardado
        if seq != esperado:
            raise GrabacionError(f"Trozo fuera de orden: llegó {seq}, se esperaba {esperado}")
        with open(_dir(gid) / "raw.webm", "ab") as fh:
            fh.write(datos)
        meta["trozos"] = esperado + 1
        meta["bytes"] = int(meta.get("bytes") or 0) + len(datos)
        _guardar_meta(gid, meta)
        return _publica(meta)


def finalizar_grabacion(gid: str) -> dict:
    d = _dir(gid)
    meta = _leer_meta(gid)
    if meta["estado"] == "lista":
        return _publica(meta)
    raw = d / "raw.webm"
    if not raw.is_file() or raw.stat().st_size == 0:
        raise GrabacionError("La grabación no tiene datos")
    salida = d / "grabacion.webm"
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-fflags", "+genpts", "-i", str(raw),
         "-c", "copy", str(salida)],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0 or not salida.is_file():
        raise GrabacionError(f"ffmpeg no pudo cerrar la grabación: {r.stderr[-300:]}")
    info = _ffprobe(salida)
    with _lock:
        meta = _leer_meta(gid)
        meta.update(info)
        meta["estado"] = "lista"
        meta["bytes"] = salida.stat().st_size
        if meta.get("recorte"):
            try:
                meta["recorte"] = _normalizar_recorte(meta["recorte"], info["ancho"], info["alto"])
            except GrabacionError:
                meta["recorte"] = None
        _guardar_meta(gid, meta)
    raw.unlink(missing_ok=True)
    return _publica(meta)


def listar_grabaciones() -> list[dict]:
    if not GRABACIONES_DIR.is_dir():
        return []
    out = []
    for d in GRABACIONES_DIR.iterdir():
        if not (d.is_dir() and _valido_id(d.name) and (d / "meta.json").is_file()):
            continue
        try:
            out.append(_publica(_leer_meta(d.name)))
        except Exception:
            continue
    return sorted(out, key=lambda m: m.get("creado", ""), reverse=True)


def obtener_grabacion(gid: str) -> dict:
    return _publica(_leer_meta(gid))


def actualizar_grabacion(gid: str, titulo: str | None = None, recorte="__sin_cambio__") -> dict:
    with _lock:
        meta = _leer_meta(gid)
        if titulo is not None:
            meta["titulo"] = titulo.strip()[:120] or meta["titulo"]
        if recorte != "__sin_cambio__":
            meta["recorte"] = _normalizar_recorte(recorte, meta.get("ancho", 0), meta.get("alto", 0))
        _guardar_meta(gid, meta)
        return _publica(meta)


def eliminar_grabacion(gid: str) -> None:
    d = _dir(gid)
    if d.is_dir():
        shutil.rmtree(d)


def ruta_video(gid: str) -> Path | None:
    try:
        p = _dir(gid) / "grabacion.webm"
    except GrabacionError:
        return None
    return p if p.is_file() else None


# ── Clips ─────────────────────────────────────────────────────────────────────

def _kbps_video(duracion: float, con_audio: bool) -> int:
    presupuesto = CLIP_MAX_MB * 8 * 1024 / max(duracion, 1.0)  # kbps totales
    if con_audio:
        presupuesto -= AUDIO_KBPS
    return int(max(VIDEO_KBPS_MIN, min(VIDEO_KBPS_MAX, presupuesto * 0.92)))


def comando_clip(origen: Path, destino: Path, inicio: float, fin: float,
                 recorte: dict | None, con_audio: bool) -> list[str]:
    duracion = fin - inicio
    filtros = []
    if recorte:
        filtros.append(f"crop={recorte['w']}:{recorte['h']}:{recorte['x']}:{recorte['y']}")
    filtros.append(f"scale='min({CLIP_MAX_ANCHO},iw)':-2")
    filtros.append("format=yuv420p")
    kbps = _kbps_video(duracion, con_audio)
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{inicio:.3f}", "-i", str(origen), "-t", f"{duracion:.3f}",
        "-map", "0:v:0",
    ]
    if con_audio:
        cmd += ["-map", "0:a:0"]
    cmd += [
        "-vf", ",".join(filtros),
        "-r", "30",
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high",
        "-b:v", f"{kbps}k", "-maxrate", f"{kbps}k", "-bufsize", f"{kbps * 2}k",
    ]
    cmd += ["-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ac", "2"] if con_audio else ["-an"]
    cmd += ["-movflags", "+faststart", str(destino)]
    return cmd


def crear_clip(gid: str, inicio: float, fin: float, nombre: str = "", recorte="__grabacion__") -> dict:
    """Encola el corte de un clip; el estado se consulta en la grabación (clips[].estado)."""
    meta = _leer_meta(gid)
    if meta["estado"] != "lista":
        raise GrabacionError("La grabación aún no está lista")
    dur_total = float(meta.get("duracion") or 0)
    try:
        inicio = max(0.0, float(inicio))
        fin = float(fin)
    except (TypeError, ValueError):
        raise GrabacionError("inicio y fin deben ser números (segundos)")
    if dur_total:
        fin = min(fin, dur_total)
    if fin - inicio < CLIP_MIN_SEG:
        raise GrabacionError(f"El clip debe durar al menos {CLIP_MIN_SEG} s")
    if fin - inicio > CLIP_MAX_SEG:
        raise GrabacionError(f"El clip no puede pasar de {int(CLIP_MAX_SEG // 60)} minutos")
    rect = meta.get("recorte") if recorte == "__grabacion__" else _normalizar_recorte(
        recorte, meta.get("ancho", 0), meta.get("alto", 0))

    cid = uuid.uuid4().hex[:12]
    clip = {
        "id": cid,
        "nombre": (nombre or "").strip()[:80] or f"Clip {len(meta.get('clips', {})) + 1}",
        "inicio": round(inicio, 3),
        "fin": round(fin, 3),
        "duracion": round(fin - inicio, 3),
        "recorte": rect,
        "estado": "procesando",
        "creado": datetime.now().isoformat(timespec="seconds"),
        "bytes": 0,
        "error": None,
        "enviado_a": [],
    }
    with _lock:
        meta = _leer_meta(gid)
        meta.setdefault("clips", {})[cid] = clip
        _guardar_meta(gid, meta)

    con_audio = bool(meta.get("tiene_audio"))
    spawn_thread(lambda: _procesar_clip(gid, cid, inicio, fin, rect, con_audio), daemon=True)
    return clip


def _procesar_clip(gid: str, cid: str, inicio: float, fin: float, rect, con_audio: bool) -> None:
    d = _dir(gid)
    destino = d / "clips" / f"{cid}.mp4"
    error = None
    try:
        r = subprocess.run(
            comando_clip(d / "grabacion.webm", destino, inicio, fin, rect, con_audio),
            capture_output=True, text=True, timeout=900,
        )
        if r.returncode != 0 or not destino.is_file():
            error = f"ffmpeg falló: {r.stderr[-300:]}"
    except Exception as exc:
        error = str(exc)
    with _lock:
        try:
            meta = _leer_meta(gid)
        except GrabacionError:
            return  # la grabación se borró mientras se procesaba
        clip = meta.get("clips", {}).get(cid)
        if not clip:
            destino.unlink(missing_ok=True)
            return
        if error:
            clip.update(estado="error", error=error)
        else:
            clip.update(estado="listo", bytes=destino.stat().st_size)
        _guardar_meta(gid, meta)


def ruta_clip(gid: str, cid: str) -> Path | None:
    if not (cid and len(cid) == 12 and all(c in "0123456789abcdef" for c in cid)):
        return None
    try:
        p = _dir(gid) / "clips" / f"{cid}.mp4"
    except GrabacionError:
        return None
    return p if p.is_file() else None


def eliminar_clip(gid: str, cid: str) -> None:
    with _lock:
        meta = _leer_meta(gid)
        meta.get("clips", {}).pop(cid, None)
        _guardar_meta(gid, meta)
    p = ruta_clip(gid, cid)
    if p:
        p.unlink(missing_ok=True)


def registrar_envio(gid: str, cid: str, destino: str) -> None:
    with _lock:
        meta = _leer_meta(gid)
        clip = meta.get("clips", {}).get(cid)
        if clip is None:
            return
        clip.setdefault("enviado_a", []).append(
            {"destino": destino, "ts": datetime.now().isoformat(timespec="seconds")}
        )
        _guardar_meta(gid, meta)
