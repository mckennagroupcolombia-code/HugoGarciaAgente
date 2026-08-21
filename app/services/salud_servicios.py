"""Semáforo de salud del ecosistema para el panel Inicio (/app).

Checks locales y rápidos (systemctl is-active + lectura de JSON ya en disco) — sin
llamadas a APIs externas (MeLi, etc.), que ya tienen su propio canal de alerta por
WhatsApp (ver scripts/auditar_scripts_cron.py, scripts/meli_compliance_monitor_cron.py).
Pensado para pollearse cada ~60s desde Inicio sin generar carga.
"""

from __future__ import annotations

import os
import subprocess

_SERVICIOS = [
    ("webhook-meli", "Webhook MeLi · :8080"),
    ("mckenna-agente", "Agente · :8081"),
    ("mckenna-website", "Sitio web · :8083"),
    ("mckenna-whatsapp-bridge", "WhatsApp bot · :3000"),
    ("mckenna-whatsapp-supervisor", "WhatsApp supervisor · :3001"),
]


def _systemctl_is_active(unidad: str) -> str:
    try:
        out = subprocess.run(
            ["systemctl", "is-active", unidad],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip()
        return out or "unknown"
    except Exception:
        return "unknown"


def _item(nombre: str, estado: str, detalle: str) -> dict:
    return {"nombre": nombre, "estado": estado, "detalle": detalle}


def estado_ecosistema() -> dict:
    items: list[dict] = []

    for unidad, etiqueta in _SERVICIOS:
        activo = _systemctl_is_active(unidad)
        if activo == "active":
            items.append(_item(etiqueta, "ok", "activo"))
        elif activo in ("activating", "reloading"):
            items.append(_item(etiqueta, "alerta", activo))
        else:
            items.append(_item(etiqueta, "caido", activo))

    try:
        from app.services.llm_budget import gasto_hoy

        def _f(nombre: str, default: float) -> float:
            try:
                return float(os.getenv(nombre, "").strip() or default)
            except ValueError:
                return default

        estado_llm = gasto_hoy()
        gasto = float(estado_llm.get("gasto_usd") or 0.0)
        tope = _f("LLM_BUDGET_TOPE_USD", 3.0)
        alerta = _f("LLM_BUDGET_DIARIO_USD", 1.0)
        if gasto >= tope:
            items.append(_item("Presupuesto IA", "caido", f"US${gasto:.2f} — tope US${tope:.2f} alcanzado"))
        elif gasto >= alerta:
            items.append(_item("Presupuesto IA", "alerta", f"US${gasto:.2f} de hoy"))
        else:
            items.append(_item("Presupuesto IA", "ok", f"US${gasto:.2f} de hoy"))
    except Exception as exc:
        items.append(_item("Presupuesto IA", "alerta", f"sin datos ({exc})"))

    hay_caido = any(i["estado"] == "caido" for i in items)
    hay_alerta = any(i["estado"] == "alerta" for i in items)
    general = "caido" if hay_caido else "alerta" if hay_alerta else "ok"

    return {"general": general, "items": items}
