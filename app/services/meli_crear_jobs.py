"""Job en memoria para «Crear publicación desde cero» en MeLi.

Cloudflare corta los POST largos (~100 s) con 502/504/524, y crear una
publicación encadena búsquedas en MeLi, generación de contenido con IA,
predicción de categoría, subida de fotos y alta del ítem: supera ese límite
con facilidad. Peor aún: el hilo de Flask seguía y la publicación se creaba
aunque el panel viera un 504. Ahora el POST arranca un hilo y devuelve un
job_id; el panel consulta GET hasta done/error. Mismo patrón que
coa_scan_jobs.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from typing import Any

from app.observability import spawn_thread

# Una hora: el resultado (item_id, permalink) debe poder leerse aunque el
# operador tarde en volver a la pestaña.
_JOB_TTL_SEC = 3600
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
        if job:
            job.update(campos)


def _correr(job_id: str, params: dict[str, Any]) -> None:
    _set_job(job_id, status="processing", progreso="Creando la publicación en MeLi…")
    try:
        from app.tools.meli_compliance_monitor import crear_publicacion_nueva_compliance

        resultado = crear_publicacion_nueva_compliance(**params)
        _set_job(job_id, status="done", progreso="Listo", resultado=resultado, error=None)
    except Exception as e:  # noqa: BLE001 — el error se muestra en el panel
        _set_job(job_id, status="error", error=str(e) or "Error al crear la publicación")


def iniciar_job_crear_publicacion(params: dict[str, Any]) -> str:
    _limpiar_jobs()
    job_id = uuid.uuid4().hex[:16]
    with _lock:
        _jobs[job_id] = {
            "status": "pending",
            "progreso": "En cola…",
            "sku": params.get("sku") or "",
            "nombre": params.get("nombre") or "",
            "created": time.time(),
            "resultado": None,
            "error": None,
        }
    spawn_thread(_correr, args=(job_id, params), daemon=True)
    return job_id


def estado_job_crear_publicacion(job_id: str) -> dict[str, Any] | None:
    _limpiar_jobs()
    key = (job_id or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{8,32}", key):
        return None
    with _lock:
        job = _jobs.get(key)
        if not job:
            return None
        return {
            "status": job.get("status"),
            "progreso": job.get("progreso") or "",
            "sku": job.get("sku") or "",
            "nombre": job.get("nombre") or "",
            "segundos": int(time.time() - float(job.get("created") or time.time())),
            "resultado": job.get("resultado"),
            "error": job.get("error"),
        }
