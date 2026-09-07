"""
Telemetría interna (logs estructurados + métricas + errores) — McKenna Group.

Cubre toda la aplicación (bot-mckenna/ en Node y los tres procesos Flask: agente_pro.py
:8081, webhook_meli.py :8080, PAGINA_WEB/site/website.py :8083) con almacenamiento
propio, sin servicios externos (Sentry/Grafana/etc.) y sin llamar a ningún LLM — este
módulo NUNCA debe usarse para "resumir" o "clasificar" errores con IA sin pasar antes
por app/services/llm_budget.py.

Dos storages, mismo patrón que ya usa el repo:

- Errores: JSONL append-only en app/data/telemetria_errores.jsonl (una línea = un
  evento), calcado de app/meli_webhook_incidents.py pero con fcntl.flock además del
  Lock local, porque aquí escriben tres procesos Flask distintos a la vez.
- Métricas/contadores: JSON con histórico diario en app/data/telemetria_metricas.json,
  calcado de app/services/llm_budget.py (_con_lock_archivo / _dia_nuevo).

Ambos archivos están en .gitignore (cambian todos los días, igual que
metricas_diarias.json y webhook_meli_incidents.jsonl).

No se registra como tool de Claude (app/core.py) — es infraestructura pasiva.
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import threading
import time
import traceback as _traceback_mod
from datetime import datetime
from typing import Any

from app.observability import get_request_id, log_json

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ERRORES_PATH = os.path.join(_APP_DIR, "data", "telemetria_errores.jsonl")
_METRICAS_PATH = os.path.join(_APP_DIR, "data", "telemetria_metricas.json")
_MAX_BYTES_ERRORES = 5_000_000
_MAX_LINEAS_ERRORES = 10_000
_LOCK_LOCAL = threading.Lock()

_TRUNCAR_TRACEBACK = 4000
_TRUNCAR_CONTEXTO = 2000


# --------------------------------------------------------------------------- errores


def registrar_error(
    event: str,
    *,
    origen: str = "",
    exception: BaseException | None = None,
    contexto: str = "",
    **fields: Any,
) -> None:
    """Registra un error/excepción no manejada. Nunca lanza excepción.

    event: identificador corto (ej. hilo_no_manejado, http_500, uncaught_exception).
    origen: función/endpoint/módulo donde ocurrió.
    exception: si se pasa, se extrae mensaje + traceback.
    contexto: texto libre adicional (se trunca).
    """
    try:
        mensaje = ""
        tb = ""
        if exception is not None:
            mensaje = str(exception)[:500]
            tb = "".join(
                _traceback_mod.format_exception(
                    type(exception), exception, exception.__traceback__
                )
            )[-_TRUNCAR_TRACEBACK:]

        rec = {
            "ts": time.time(),
            "iso": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
            "event": event,
            "origen": origen or "",
            "request_id": get_request_id(),
            "mensaje": mensaje,
            "traceback": tb,
            "contexto": (contexto or "")[:_TRUNCAR_CONTEXTO],
            **fields,
        }
        line = json.dumps(rec, ensure_ascii=False, default=str)
        with _LOCK_LOCAL:
            os.makedirs(os.path.dirname(_ERRORES_PATH), exist_ok=True)
            lock_path = _ERRORES_PATH + ".lock"
            with open(lock_path, "a") as lk:
                fcntl.flock(lk, fcntl.LOCK_EX)
                try:
                    if (
                        os.path.isfile(_ERRORES_PATH)
                        and os.path.getsize(_ERRORES_PATH) > _MAX_BYTES_ERRORES
                    ):
                        _truncar_jsonl(_ERRORES_PATH)
                    with open(_ERRORES_PATH, "a", encoding="utf-8") as f:
                        f.write(line + "\n")
                finally:
                    fcntl.flock(lk, fcntl.LOCK_UN)

        log_json(event, level=logging.ERROR, origen=origen, mensaje=mensaje)
    except Exception as e:
        try:
            log_json("telemetria_error_interno", fase="registrar_error", error=str(e)[:150])
        except Exception:
            pass


def _truncar_jsonl(path: str) -> None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        tail = lines[-_MAX_LINEAS_ERRORES:] if len(lines) > _MAX_LINEAS_ERRORES else lines
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(tail)
    except OSError:
        pass


def _leer_cola_errores(limite_lineas: int) -> list[dict]:
    if not os.path.isfile(_ERRORES_PATH):
        return []
    try:
        with open(_ERRORES_PATH, "rb") as f:
            f.seek(0, os.SEEK_END)
            sz = f.tell()
            chunk = min(sz, 3_000_000)
            f.seek(max(0, sz - chunk))
            raw = f.read().decode("utf-8", errors="replace")
        lines = [ln for ln in raw.splitlines() if ln.strip()][-limite_lineas:]
    except OSError:
        return []
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


def errores_recientes(
    limite: int = 100, event: str | None = None, origen: str | None = None
) -> list[dict]:
    """Últimos errores, más recientes primero. Filtra opcionalmente por event/origen."""
    registros = _leer_cola_errores(max(limite * 5, 2000))
    if event:
        registros = [r for r in registros if r.get("event") == event]
    if origen:
        registros = [r for r in registros if r.get("origen") == origen]
    return list(reversed(registros))[:limite]


def resumen_errores(dias: int = 7) -> dict:
    """Conteo por event y por origen en los últimos `dias` días."""
    desde = time.time() - dias * 86400
    registros = _leer_cola_errores(50_000)
    por_evento: dict[str, int] = {}
    por_origen: dict[str, int] = {}
    total = 0
    for r in registros:
        if (r.get("ts") or 0) < desde:
            continue
        total += 1
        ev = r.get("event") or "desconocido"
        og = r.get("origen") or "desconocido"
        por_evento[ev] = por_evento.get(ev, 0) + 1
        por_origen[og] = por_origen.get(og, 0) + 1
    return {"total": total, "dias": dias, "por_evento": por_evento, "por_origen": por_origen}


# -------------------------------------------------------------------------- métricas


def _dia_nuevo_metricas(hoy: str, historial: list) -> dict:
    return {
        "fecha": hoy,
        "contadores": {},
        "por_canal": {},
        "historial": historial,
    }


def _leer_estado_metricas() -> dict:
    hoy = datetime.now().strftime("%Y-%m-%d")
    try:
        with open(_METRICAS_PATH, encoding="utf-8") as f:
            d = json.load(f)
        if d.get("fecha") == hoy:
            d.setdefault("por_canal", {})
            d.setdefault("historial", [])
            return d
        historial = d.get("historial", [])
        if d.get("fecha") and d.get("contadores"):
            cerrado = {
                k: d.get(k) for k in ("fecha", "contadores", "por_canal")
            }
            historial = (historial + [cerrado])[-400:]
        return _dia_nuevo_metricas(hoy, historial)
    except Exception:
        return _dia_nuevo_metricas(hoy, [])


def _con_lock_metricas(fn):
    """Ejecuta fn(estado) -> estado con lock entre procesos (8080/8081/8083)."""
    with _LOCK_LOCAL:
        os.makedirs(os.path.dirname(_METRICAS_PATH), exist_ok=True)
        lock_path = _METRICAS_PATH + ".lock"
        with open(lock_path, "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                estado = _leer_estado_metricas()
                estado = fn(estado)
                tmp = _METRICAS_PATH + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(estado, f, ensure_ascii=False, indent=1)
                os.replace(tmp, _METRICAS_PATH)
                return estado
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)


def incrementar_evento(nombre: str, *, canal: str | None = None, n: int = 1) -> None:
    """Contador genérico de eventos técnicos/uso (no reemplaza metricas_diarias.json,
    que sigue siendo la fuente de los 4 contadores de negocio existentes). Nunca
    lanza excepción."""
    try:
        def actualizar(estado: dict) -> dict:
            estado["contadores"][nombre] = estado["contadores"].get(nombre, 0) + n
            if canal:
                pc = estado.setdefault("por_canal", {})
                pc[canal] = pc.get(canal, 0) + n
            return estado

        _con_lock_metricas(actualizar)
    except Exception as e:
        log_json("telemetria_error_interno", fase="incrementar_evento", error=str(e)[:150])


def metricas_hoy() -> dict:
    with _LOCK_LOCAL:
        return _leer_estado_metricas()


def resumen_metricas(dias: int = 30) -> dict:
    """Últimos `dias` días cerrados + el día en curso, orden ascendente por fecha."""
    estado = metricas_hoy()
    hist = list(estado.get("historial", []))[-dias:]
    hist.append({k: estado.get(k) for k in ("fecha", "contadores", "por_canal")})
    return {"historial": hist}
