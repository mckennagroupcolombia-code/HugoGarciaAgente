"""
Histórico de costos de importación — dos fuentes unificadas para comparar contra
el cotizador de China Latin Agent (app/services/tarifas_china_latin_agent.py):

- "casos_grandes": embarques/courier con agente de aduanas (DHL, Premium Box...),
  extraídos manualmente de correspondencia real en Gmail y guardados en
  app/data/importaciones_historico.json (ver ese archivo para metodología/fuentes).
- "compras_chicas": compras pequeñas ya registradas en el panel Compras Exterior
  (app/services/contabilidad_db.py, tabla compras_exterior) con costeo landed
  calculado automáticamente vía OCR.

El JSON se relee si cambia en disco (mismo patrón que tarifas_envio.py).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_HISTORICO_PATH = Path(__file__).resolve().parents[1] / "data" / "importaciones_historico.json"

_cache: dict = {"mtime": None, "data": {}}


def _datos() -> dict:
    try:
        mtime = os.path.getmtime(_HISTORICO_PATH)
        if _cache["mtime"] != mtime:
            _cache["data"] = json.loads(_HISTORICO_PATH.read_text(encoding="utf-8"))
            _cache["mtime"] = mtime
    except Exception:
        pass
    return _cache["data"] or {}


def casos_grandes() -> list[dict]:
    return _datos().get("casos", [])


def compras_chicas(limit: int = 50) -> list[dict]:
    try:
        from app.services.contabilidad_db import listar_compras_exterior
        return listar_compras_exterior(limit=limit)
    except Exception:
        return []


def historico_unificado(limit_compras_chicas: int = 50) -> dict:
    return {
        "casos_grandes": casos_grandes(),
        "compras_chicas": compras_chicas(limit=limit_compras_chicas),
        "fuente": _datos().get("fuente", ""),
        "nota_metodologica": _datos().get("nota_metodologica", ""),
    }
