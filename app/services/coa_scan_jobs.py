"""Jobs en memoria para el escáner COA: el POST no espera a Gemini.

Cloudflare / proxies cortan POSTs largos (~100s) con HTML 502/504/524.
El análisis corre en un hilo; el panel consulta GET hasta listo o error.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from typing import Any, Callable

from app.observability import spawn_thread

_JOB_TTL_SEC = 600
_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()

OnProgreso = Callable[[str], None]


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


def _norm_fecha(v: str) -> str:
    s = (v or "").strip()
    if not s:
        return ""
    s = re.sub(r"(?i)[Xx]{1,2}\b", "", s).strip(" -/.")
    m = re.match(r"^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$", s)
    if m:
        y, mo = m.group(1), int(m.group(2))
        d = int(m.group(3) or 1)
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y}-{mo:02d}-{d:02d}"
    return s


def empaquetar_resultado_coa_scan(
    parsed: dict[str, Any] | None,
    partes_bytes: list[tuple[bytes, str]],
    catalogo: list[str],
) -> dict[str, Any]:
    """Normaliza el dict de Gemini al JSON que consume el panel."""
    campos: dict[str, str] = {}
    firma_bbox_raw = None
    if isinstance(parsed, dict):
        firma_bbox_raw = parsed.get("firma_bbox")
        for k, v in parsed.items():
            if v is None or str(k).startswith("_") or k == "firma_bbox":
                continue
            if isinstance(v, (list, dict)):
                continue
            s = str(v).strip()
            if s:
                campos[str(k)] = s

    parametros = str(campos.get("parametros") or "").strip()
    nombre_producto = str(campos.get("nombre_producto") or "").strip()
    if not parametros and not nombre_producto and not campos.get("cas"):
        raise ValueError("Gemini no pudo extraer informacion util de la imagen")

    if campos.get("einecs") and not campos.get("einces"):
        campos["einces"] = campos["einecs"]

    for fk in ("fecha_fabricacion", "fecha_vencimiento", "fecha_analisis", "fecha_emision"):
        if campos.get(fk):
            campos[fk] = _norm_fecha(str(campos[fk]))

    from app.services.documento_traducir_es import espanolizar_campos_documento

    campos = espanolizar_campos_documento(campos)
    parametros = str(campos.get("parametros") or "").strip()
    nombre_producto = str(campos.get("nombre_producto") or "").strip()

    if firma_bbox_raw is not None and partes_bytes:
        try:
            from app.services.coa_firma import recortar_firma_a_data_url

            data0, mime0 = partes_bytes[0]
            firma_url = recortar_firma_a_data_url(data0, mime0, firma_bbox_raw)
            if firma_url:
                campos["firma_imagen_b64"] = firma_url
                from app.services.firmas_guardadas import guardar_firma

                guardar_firma(
                    firma_url,
                    nombre=str(campos.get("firma_nombre") or ""),
                    cargo=str(campos.get("firma_cargo") or ""),
                    organizacion=str(campos.get("firma_organizacion") or ""),
                )
        except Exception as e_firma:
            print(f"⚠️ No se pudo recortar firma del COA: {e_firma}")

    archivo_bib = str(campos.get("archivo_biblioteca") or "").strip()
    if archivo_bib and catalogo:
        low = archivo_bib.lower().removesuffix(".pdf")
        exact = next(
            (
                n
                for n in catalogo
                if n.lower() == archivo_bib.lower()
                or n.lower().removesuffix(".pdf") == low
            ),
            None,
        )
        archivo_bib = exact or ""
    elif not catalogo:
        archivo_bib = ""

    if archivo_bib and nombre_producto:
        from app.services.coa_biblioteca_match import validar_archivo_biblioteca

        archivo_bib = validar_archivo_biblioteca(nombre_producto, archivo_bib)

    n_arch = len(partes_bytes)
    return {
        "ok": True,
        "parametros": parametros,
        "nombre_producto": nombre_producto,
        "archivo_biblioteca": archivo_bib,
        "cas": str(campos.get("cas") or "").strip(),
        "lote": str(campos.get("lote") or "").strip(),
        "firma_imagen_b64": str(campos.get("firma_imagen_b64") or ""),
        "imagenes_procesadas": n_arch,
        "campos": campos,
    }


def _correr_scan(
    job_id: str,
    partes_bytes: list[tuple[bytes, str]],
    catalogo: list[str],
    catalogo_prompt: str,
    multi_nota: str,
) -> None:
    n = len(partes_bytes)
    _set_job(job_id, progreso=f"Leyendo {n} foto(s)…")

    def on_progreso(msg: str) -> None:
        _set_job(job_id, progreso=str(msg or "")[:200])

    try:
        from app.services.documento_scan_tablas import extraer_coa_desde_imagenes

        parsed = extraer_coa_desde_imagenes(
            partes_bytes,
            catalogo_prompt=catalogo_prompt,
            multi_nota=multi_nota,
            on_progreso=on_progreso,
        )
        on_progreso("Armando el formulario…")
        resultado = empaquetar_resultado_coa_scan(parsed, partes_bytes, catalogo)
        _set_job(
            job_id,
            status="done",
            progreso="Listo",
            resultado=resultado,
            error=None,
        )
    except TimeoutError:
        _set_job(
            job_id,
            status="error",
            error="Gemini tardó demasiado — intente con imágenes más pequeñas",
        )
    except Exception as e:
        _set_job(job_id, status="error", error=str(e) or "Error al analizar el documento")
    finally:
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job.pop("_partes", None)


def iniciar_coa_scan_job(
    partes_bytes: list[tuple[bytes, str]],
    *,
    catalogo: list[str] | None = None,
    catalogo_prompt: str = "",
    multi_nota: str = "",
) -> str:
    _limpiar_jobs()
    job_id = uuid.uuid4().hex[:16]
    n = len(partes_bytes)
    with _lock:
        _jobs[job_id] = {
            "status": "pending",
            "progreso": f"En cola · {n} foto(s)",
            "imagenes": n,
            "created": time.time(),
            "resultado": None,
            "error": None,
        }
    spawn_thread(
        _correr_scan,
        args=(job_id, partes_bytes, list(catalogo or []), catalogo_prompt, multi_nota),
        daemon=True,
    )
    return job_id


def estado_coa_scan_job(job_id: str) -> dict[str, Any] | None:
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
            "imagenes": job.get("imagenes") or 0,
            "resultado": job.get("resultado"),
            "error": job.get("error"),
        }


def empaquetar_resultado_ft_scan(parsed: dict[str, Any] | None) -> dict[str, Any]:
    """Normaliza el dict de Gemini al JSON de ficha técnica del panel."""
    campos: dict[str, str] = {}
    if isinstance(parsed, dict):
        for k, v in parsed.items():
            if str(k).startswith("_") or v is None:
                continue
            if isinstance(v, (list, dict)):
                continue
            s = str(v).strip()
            if s:
                campos[str(k)] = s

    nombre_prod = str(campos.get("nombre_producto") or "").strip()
    campos_vacios = [
        k for k in ("cas", "formula_quimica") if not str(campos.get(k) or "").strip()
    ]
    if nombre_prod and campos_vacios:
        try:
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout

            from app.services.documento_cientifico import buscar_pubchem

            with ThreadPoolExecutor(max_workers=1) as ex2:
                fut2 = ex2.submit(lambda: buscar_pubchem(nombre_prod))
                try:
                    pc = fut2.result(timeout=8)
                except FutTimeout:
                    pc = {}
            if not campos.get("cas") and pc.get("cas"):
                campos["cas"] = pc["cas"]
                campos["_cas_fuente"] = "pubchem"
            if not campos.get("formula_quimica") and pc.get("formula_molecular"):
                campos["formula_quimica"] = pc["formula_molecular"]
                campos["_formula_fuente"] = "pubchem"
        except Exception:
            pass

    from app.services.documento_traducir_es import espanolizar_campos_documento

    campos = espanolizar_campos_documento(campos)
    llenos = [
        k
        for k, v in campos.items()
        if not str(k).startswith("_") and str(v or "").strip()
    ]
    if not llenos:
        raise ValueError(
            "La extracción no devolvió campos útiles. Pruebe otras imágenes/PDF."
        )
    return {"ok": True, "campos": campos}


def _correr_ft_scan(
    job_id: str,
    partes_bytes: list[tuple[bytes, str]],
    multi_nota: str,
) -> None:
    n = len(partes_bytes)
    _set_job(job_id, progreso=f"Leyendo {n} archivo(s)…")

    def on_progreso(msg: str) -> None:
        _set_job(job_id, progreso=str(msg or "")[:200])

    try:
        from app.services.documento_scan_tablas import extraer_ft_desde_imagenes

        parsed = extraer_ft_desde_imagenes(
            partes_bytes,
            multi_nota=multi_nota,
            on_progreso=on_progreso,
        )
        on_progreso("Armando el formulario…")
        resultado = empaquetar_resultado_ft_scan(parsed)
        _set_job(
            job_id,
            status="done",
            progreso="Listo",
            resultado=resultado,
            error=None,
        )
    except TimeoutError:
        _set_job(
            job_id,
            status="error",
            error="Gemini tardó demasiado — intente con archivos más pequeños",
        )
    except Exception as e:
        _set_job(job_id, status="error", error=str(e) or "Error al analizar el documento")
    finally:
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job.pop("_partes", None)


def iniciar_ft_scan_job(
    partes_bytes: list[tuple[bytes, str]],
    *,
    multi_nota: str = "",
) -> str:
    _limpiar_jobs()
    job_id = uuid.uuid4().hex[:16]
    n = len(partes_bytes)
    with _lock:
        _jobs[job_id] = {
            "status": "pending",
            "progreso": f"En cola · {n} archivo(s)",
            "imagenes": n,
            "created": time.time(),
            "resultado": None,
            "error": None,
        }
    spawn_thread(
        _correr_ft_scan,
        args=(job_id, partes_bytes, multi_nota),
        daemon=True,
    )
    return job_id


estado_ft_scan_job = estado_coa_scan_job
