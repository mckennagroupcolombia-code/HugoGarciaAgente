"""Jobs en memoria para análisis de captura de competencia MeLi.

Cloudflare / proxies cortan POSTs largos (~100s) con HTML 502/504/524.
El POST solo encola; Gemini corre en un hilo; el panel hace GET hasta listo.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from typing import Any

from app.observability import spawn_thread

_JOB_TTL_SEC = 600
_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def _limpiar_jobs() -> None:
    limite = time.time() - _JOB_TTL_SEC
    with _lock:
        viejos = [k for k, v in _jobs.items() if float(v.get("created") or 0) < limite]
        for k in viejos:
            _jobs.pop(k, None)


def _set_job(job_id: str, **campos: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(campos)


def _correr(
    job_id: str,
    *,
    item_id: str,
    imagen: bytes,
    mime: str,
    titulo: str,
    precio: Any,
) -> None:
    _set_job(job_id, status="running", progreso="Leyendo pantallazo con IA…")
    try:
        from app.tools.analisis_competencia_precios import generar_reporte_competencia_captura

        out = generar_reporte_competencia_captura(
            item_id=item_id,
            imagen=imagen,
            mime=mime,
            titulo=titulo,
            precio=precio,
        )
        if not out.get("ok"):
            _set_job(
                job_id,
                status="error",
                error=str(out.get("error") or "No se pudo armar el reporte")[:400],
                progreso="",
            )
            return
        _set_job(
            job_id,
            status="done",
            progreso="Listo",
            resultado=out,
            error=None,
        )
    except Exception as e:
        _set_job(
            job_id,
            status="error",
            error=str(e)[:400] or "Error al analizar la captura",
            progreso="",
        )


def iniciar_competencia_captura_job(
    *,
    item_id: str,
    imagen: bytes,
    mime: str = "image/jpeg",
    titulo: str = "",
    precio: Any = None,
) -> str:
    _limpiar_jobs()
    job_id = uuid.uuid4().hex[:16]
    with _lock:
        _jobs[job_id] = {
            "status": "pending",
            "progreso": "En cola…",
            "created": time.time(),
            "item_id": str(item_id or "").upper(),
            "resultado": None,
            "error": None,
        }
    spawn_thread(
        _correr,
        kwargs={
            "job_id": job_id,
            "item_id": item_id,
            "imagen": imagen,
            "mime": mime,
            "titulo": titulo,
            "precio": precio,
        },
        daemon=True,
    )
    return job_id


def estado_competencia_captura_job(job_id: str) -> dict[str, Any] | None:
    _limpiar_jobs()
    key = (job_id or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{8,32}", key):
        return None
    with _lock:
        job = _jobs.get(key)
        if not job:
            return None
        out: dict[str, Any] = {
            "ok": True,
            "job_id": key,
            "status": job.get("status"),
            "progreso": job.get("progreso") or "",
            "item_id": job.get("item_id") or "",
        }
        if job.get("error"):
            out["error"] = job["error"]
        if job.get("status") == "done" and isinstance(job.get("resultado"), dict):
            out.update(job["resultado"])
        return out
