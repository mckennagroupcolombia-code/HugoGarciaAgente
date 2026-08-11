"""
Alertas operativas visibles en el panel (banner global, todas las secciones de /app).

Hoy cubre: puente WhatsApp caído (detectado el 2026-08-10 — el proceso quedó vivo
14h sin sesión activa y nadie se enteró porque el propio canal de aviso, WhatsApp,
era el que estaba caído). Diseño extensible: agregar más chequeos a
calcular_alertas_sistema() según se necesiten, cada uno devolviendo None (sano) o
un dict de alerta.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

import requests

_ESTADO_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "alertas_sistema_estado.json")
_GRACIA_SEGUNDOS = 120  # evita falso positivo en reinicios cortos/rutinarios
_BRIDGE_URL = "http://localhost:3000/monitor/json"
_BRIDGE_TIMEOUT = 3


def _leer_estado() -> dict:
    try:
        with open(_ESTADO_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _guardar_estado(data: dict) -> None:
    try:
        with open(_ESTADO_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _chequear_whatsapp_bridge() -> dict | None:
    """None si está sano o recién cayó (dentro del periodo de gracia). dict de alerta si no."""
    estado = _leer_estado()
    ahora = time.time()

    sano = False
    try:
        res = requests.get(_BRIDGE_URL, timeout=_BRIDGE_TIMEOUT)
        if res.status_code == 200:
            data = res.json()
            sano = bool(data.get("sistemaListo")) and bool(data.get("waSesionOperativa"))
    except requests.RequestException:
        sano = False

    if sano:
        if estado.get("whatsapp_bridge_down_since"):
            estado.pop("whatsapp_bridge_down_since", None)
            _guardar_estado(estado)
        return None

    down_since = estado.get("whatsapp_bridge_down_since")
    if not down_since:
        estado["whatsapp_bridge_down_since"] = ahora
        _guardar_estado(estado)
        return None  # recién detectado — dentro de gracia, aún no se alerta

    elapsed = ahora - down_since
    if elapsed < _GRACIA_SEGUNDOS:
        return None

    minutos = int(elapsed // 60)
    desde_iso = datetime.fromtimestamp(down_since, tz=timezone.utc).isoformat()
    return {
        "id": "whatsapp_bridge_down",
        "severidad": "critica",
        "titulo": "Puente WhatsApp caído",
        "detalle": (
            f"Sin sesión activa desde hace {minutos} min. Preventa, posventa, pagos y "
            "comandos de operador no están llegando ni saliendo por WhatsApp."
        ),
        "desde": desde_iso,
        "accion_sugerida": "sudo systemctl restart mckenna-whatsapp-bridge",
    }


def calcular_alertas_sistema() -> list[dict]:
    alertas = []
    a = _chequear_whatsapp_bridge()
    if a:
        alertas.append(a)
    return alertas
