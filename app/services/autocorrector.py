from __future__ import annotations

from datetime import datetime
from threading import Lock

from app.monitor import incrementar_metrica
from app.observability import log_json
from app.services.local_ai import (
    estado_local_ai,
    ejecutar_openhands_task,
    pedir_reflexion_local,
)
from app.tools.memoria import buscar_incidentes_similares, guardar_incidente_fix

_estado = {
    "activo": True,
    "intentos": 0,
    "exitos": 0,
    "ultimo_error": "",
    "ultima_reflexion": "",
    "ultimo_resultado_openhands": {},
    "ultima_ejecucion": "",
}
_lock = Lock()


def estado_autocorrector() -> dict:
    with _lock:
        data = dict(_estado)
    data["local_ai"] = estado_local_ai()
    return data


def _set_estado(**kwargs) -> None:
    with _lock:
        _estado.update(kwargs)


def manejar_incidente_autocorreccion(
    error: str,
    contexto: str = "",
    origen: str = "core",
) -> dict:
    """
    Orquesta búsqueda en memoria vectorial + reflexión local + ejecución OpenHands.
    """
    _set_estado(
        intentos=_estado["intentos"] + 1,
        ultimo_error=(error or "")[:1000],
        ultima_ejecucion=datetime.utcnow().isoformat(),
    )
    try:
        similares = buscar_incidentes_similares(f"{origen}: {error}", max_resultados=3)
        contexto_memoria = "\n\n".join(
            x.get("documento", "") for x in similares if x.get("documento")
        )[:10000]
        prompt = (
            "Eres ingeniero senior. Propón pasos concretos para corregir este incidente.\n"
            f"Origen: {origen}\n"
            f"Error: {error}\n"
            f"Contexto runtime: {contexto[:4000]}\n"
            f"Incidentes similares:\n{contexto_memoria or 'N/A'}\n"
            "Devuelve estrategia breve y segura."
        )
        reflexion = pedir_reflexion_local(prompt)
        _set_estado(ultima_reflexion=reflexion[:2000])
        resultado_openhands = ejecutar_openhands_task(
            tarea=f"Autocorregir incidente: {error[:500]}",
            contexto=f"{contexto}\n\nReflexión local:\n{reflexion}\n\nMemoria:\n{contexto_memoria}",
            dry_run=False,
        )
        _set_estado(ultimo_resultado_openhands=resultado_openhands)
        ok = bool(resultado_openhands.get("ok"))
        if ok:
            _set_estado(exitos=_estado["exitos"] + 1)
            try:
                incrementar_metrica("autocorrecciones_exitosas")
            except Exception:
                pass
            guardar_incidente_fix(
                error=error,
                causa="Detectado en runtime",
                solucion=str(resultado_openhands)[:4000],
                origen=origen,
                metadata={"ok": True},
            )
        else:
            try:
                incrementar_metrica("autocorrecciones_fallidas")
            except Exception:
                pass
        log_json(
            "autocorrector_result",
            origen=origen,
            ok=ok,
            error_preview=(error or "")[:200],
        )
        return {
            "ok": ok,
            "similares": similares,
            "reflexion": reflexion,
            "resultado_openhands": resultado_openhands,
        }
    except Exception as e:
        log_json("autocorrector_error", origen=origen, error=str(e)[:500])
        return {"ok": False, "error": str(e)}
