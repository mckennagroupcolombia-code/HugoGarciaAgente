"""
Auto-límite de frecuencia para los crons de la app — sin tocar el crontab del sistema.

Los 5 jobs (auditoría de scripts, compliance MeLi, certificados de retención,
resumen de costos LLM, monitor de comunicaciones de importaciones) siguen
instalados en el crontab real de siempre (o pendientes de instalar, ver
scripts/monitor_comunicaciones_importaciones.py) y cron los sigue disparando en
su horario de siempre. Lo que cambia es que cada script, al arrancar, primero
llama `debe_ejecutar(job_id)`: si no ha pasado el intervalo configurado desde
la última vez que SÍ hizo trabajo real, se sale de inmediato sin hacer nada.

Esto le da al panel "Tareas Programadas" (Sistemas) control real sobre la
frecuencia efectiva sin necesitar permisos para reescribir el crontab del
servidor (riesgo mucho menor: un bug acá solo afecta el auto-límite, nunca
puede dejar el crontab del sistema en un estado roto).

Config editable: app/data/cron_frecuencias.json — se relee en cada llamada
(mismo patrón que tarifas_envio.py), así que cambiar la frecuencia desde el
panel no requiere reiniciar nada.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "data" / "cron_frecuencias.json"

DEFAULT_INTERVALO_HORAS = 168  # una vez por semana — estas operaciones no son frecuentes

# El crontab del sistema dispara siempre a una hora fija, pero `ultima_ejecucion`
# se registra cuando el job TERMINA. Si un job tarda unos minutos (ej. paginación
# de una API externa) y su intervalo configurado coincide con la cadencia del
# crontab (ej. 24h para un cron diario), el disparo de mañana siempre cae unos
# minutos ANTES de cumplirse el intervalo exacto — el job se autobloquea todos
# los días desde entonces, en silencio, porque `ultima_ejecucion` nunca vuelve
# a avanzar. Precedente: notas_credito_auto quedó así trabado desde el 13-ago-2026
# tras una única corrida que tardó 2m19s. Este margen absorbe ese jitter.
_MARGEN_TOLERANCIA_MIN = 15

JOBS: dict[str, dict[str, str]] = {
    "auditoria_scripts": {
        "nombre": "Auditoría de scripts",
        "descripcion": "py_compile de los scripts del manifiesto; alerta por WhatsApp si algo falla.",
        "script": "scripts/auditar_scripts_cron.py",
    },
    "compliance_meli": {
        "nombre": "Compliance MeLi (watchlist)",
        "descripcion": "Revisa el estado de publicaciones en la watchlist de compliance y alerta por WhatsApp.",
        "script": "scripts/meli_compliance_monitor_cron.py",
    },
    "certificados_retencion": {
        "nombre": "Certificados de retención (correo)",
        "descripcion": "Detecta correos de proveedores con certificados de retención y crea solicitud para Cynthia.",
        "script": "scripts/monitor_correos_certificados_retencion_cron.py",
    },
    "resumen_costos_llm": {
        "nombre": "Resumen de costos LLM",
        "descripcion": "Envía al grupo de sistemas el resumen semanal de gasto en modelos de IA.",
        "script": "scripts/resumen_costos_llm_cron.py",
    },
    "resumen_actividad_sede_sur": {
        "nombre": "Resumen diario SEDE SUR",
        "descripcion": "Envía al grupo SEDE SUR un único resumen diario de acciones/solicitudes creadas y completadas, en vez de un mensaje por cada evento. El detalle en vivo queda en el banner Actividad del equipo de /app.",
        "script": "scripts/resumen_actividad_sede_sur_cron.py",
    },
    "monitor_importaciones": {
        "nombre": "Monitor comunicaciones importaciones",
        "descripcion": "Busca correos/WhatsApp nuevos de aliados logísticos y los comenta en los tickets activos.",
        "script": "scripts/monitor_comunicaciones_importaciones.py",
    },
    "notas_credito_auto": {
        "nombre": "Notas crédito automáticas (MeLi canceladas)",
        "descripcion": "Emite en Siigo la nota crédito de ventas MeLi canceladas con factura ya emitida (margen 48h) y avisa por WhatsApp.",
        "script": "scripts/emitir_notas_credito_cron.py",
    },
    "informe_reposicion_mensual": {
        "nombre": "Reposición alta rotación (informe mensual)",
        "descripcion": "Cierre de mes: cuánto se demoró McKenna en reponer productos de alta rotación (promedio de días, calificación A-D) + qué sigue agotado ahora mismo. Envía a MCKG Sede Sur. El propio script valida que sea el último día del mes.",
        "script": "scripts/informe_reposicion_mensual_cron.py",
    },
    "publicidad_recomendaciones": {
        "nombre": "Recomendaciones de publicidad MeLi",
        "descripcion": "Cruza ACOS de Product Ads con rotación real de ventas y avisa qué productos pausar/revisar, y cuáles cambiaron de rotación y deberían moverse entre las campañas Alta/Media/Baja (ticket + WhatsApp). Cadencia por defecto cada 15 días — la rotación se mide sobre 30 días, revisarla más seguido no aporta señal nueva. No mueve ni pausa nada solo — MeLi no expone control por producto vía API.",
        "script": "scripts/publicidad_recomendaciones_cron.py",
    },
    "archivar_gasto_ads": {
        "nombre": "Archivo semanal de gasto en ads",
        "descripcion": "Guarda en caché el gasto/ACOS de Product Ads de las últimas 12 semanas antes de que MeLi las saque de su ventana de 90 días (límite duro de la plataforma, ni siquiera recuperable desde el panel web de Mercado Ads — confirmado ago-2026). Una vez archivada, una semana no se pierde aunque cambie la fórmula del panel Salud del negocio. Avisa por WhatsApp solo si alguna semana quedó a menos de 10 días del corte sin archivar.",
        "script": "scripts/archivar_gasto_ads_cron.py",
    },
    "recordatorio_inventario": {
        "nombre": "Recordatorio semanal de inventario",
        "descripcion": "Envía al grupo de inventario un resumen de productos que necesitan revisión (agotados/críticos/bajo stock) y apunta a Control de Inventario (/app) — le da al equipo un día fijo de revisión en vez de reponer solo de forma reactiva.",
        "script": "scripts/recordatorio_inventario_cron.py",
    },
}


def _cargar() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _guardar(config: dict) -> None:
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, _CONFIG_PATH)


def _entrada(config: dict, job_id: str) -> dict:
    return config.get(job_id) or {"intervalo_horas": DEFAULT_INTERVALO_HORAS, "ultima_ejecucion": None}


def debe_ejecutar(job_id: str) -> bool:
    """True si ya pasó el intervalo configurado desde la última ejecución real."""
    config = _cargar()
    entrada = _entrada(config, job_id)
    ultima = entrada.get("ultima_ejecucion")
    if not ultima:
        return True
    try:
        ultima_dt = datetime.fromisoformat(ultima)
    except Exception:
        return True
    intervalo = float(entrada.get("intervalo_horas") or DEFAULT_INTERVALO_HORAS)
    umbral = ultima_dt + timedelta(hours=intervalo) - timedelta(minutes=_MARGEN_TOLERANCIA_MIN)
    return datetime.now() >= umbral


def registrar_ejecucion(job_id: str) -> None:
    """Marca que el job hizo trabajo real ahora — usado para el auto-límite."""
    config = _cargar()
    entrada = _entrada(config, job_id)
    entrada["ultima_ejecucion"] = datetime.now().isoformat(timespec="seconds")
    config[job_id] = entrada
    _guardar(config)


def establecer_frecuencia(job_id: str, intervalo_horas: float) -> tuple[bool, str]:
    if job_id not in JOBS:
        return False, f"Job desconocido: {job_id}"
    if intervalo_horas <= 0:
        return False, "El intervalo debe ser mayor a 0 horas"
    config = _cargar()
    entrada = _entrada(config, job_id)
    entrada["intervalo_horas"] = float(intervalo_horas)
    config[job_id] = entrada
    _guardar(config)
    return True, ""


def listar_tareas() -> list[dict]:
    config = _cargar()
    tareas = []
    for job_id, meta in JOBS.items():
        entrada = _entrada(config, job_id)
        ultima = entrada.get("ultima_ejecucion")
        proxima = None
        if ultima:
            try:
                proxima = (
                    datetime.fromisoformat(ultima)
                    + timedelta(hours=float(entrada.get("intervalo_horas") or DEFAULT_INTERVALO_HORAS))
                ).isoformat(timespec="seconds")
            except Exception:
                proxima = None
        tareas.append({
            "id": job_id,
            "nombre": meta["nombre"],
            "descripcion": meta["descripcion"],
            "script": meta["script"],
            "intervalo_horas": float(entrada.get("intervalo_horas") or DEFAULT_INTERVALO_HORAS),
            "ultima_ejecucion": ultima,
            "proxima_ejecucion_estimada": proxima,
        })
    return tareas
