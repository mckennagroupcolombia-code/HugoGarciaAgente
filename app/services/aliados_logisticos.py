"""
Aliados logísticos para importación (DDP y ordinaria) — panel Importaciones (/app).

Fuente de datos: app/data/aliados_logisticos.json — un solo master file con la
lista de aliados (cada uno con `tipo_modalidad`: "ddp" | "importacion_ordinaria")
y una guía de cuándo usar cada modalidad. El JSON se relee si cambia en disco
(mismo patrón que app/services/tarifas_envio.py).

El cotizador con tarifas reales solo existe para el aliado "china-latin-agent"
(ver app/services/tarifas_china_latin_agent.py, que lee su bloque de este mismo
archivo) — los demás aliados (ej. "aduamarcol", importación ordinaria) no
publican tarifas propias, por eso `tiene_cotizador` es False para ellos.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_DATOS_PATH = Path(__file__).resolve().parents[1] / "data" / "aliados_logisticos.json"

_cache: dict = {"mtime": None, "data": {}}


def _datos() -> dict:
    try:
        mtime = os.path.getmtime(_DATOS_PATH)
        if _cache["mtime"] != mtime:
            _cache["data"] = json.loads(_DATOS_PATH.read_text(encoding="utf-8"))
            _cache["mtime"] = mtime
    except Exception:
        pass
    return _cache["data"] or {}


def listar_aliados() -> list[dict]:
    return _datos().get("aliados", [])


def obtener_aliado(aliado_id: str) -> dict | None:
    for aliado in listar_aliados():
        if aliado.get("id") == aliado_id:
            return aliado
    return None


def guia_modalidad() -> dict:
    return _datos().get("guia_modalidad", {})
