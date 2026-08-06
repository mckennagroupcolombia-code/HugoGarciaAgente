"""Bitácora de pagos de impuestos (JSON local)."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any

_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "impuestos_pagos.json",
)


def _leer() -> list[dict[str, Any]]:
    if not os.path.isfile(_DATA_PATH):
        return []
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
        pagos = data.get("pagos") if isinstance(data, dict) else data
        return list(pagos or [])
    except Exception:
        return []


def _guardar(pagos: list[dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(_DATA_PATH), exist_ok=True)
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump({"pagos": pagos, "actualizado_en": datetime.now().isoformat()}, f, ensure_ascii=False, indent=2)


def listar_pagos() -> list[dict[str, Any]]:
    pagos = _leer()
    pagos.sort(key=lambda p: str(p.get("fecha_pago") or ""), reverse=True)
    return pagos


def crear_pago(payload: dict[str, Any]) -> dict[str, Any]:
    monto = float(payload.get("monto") or 0)
    if monto <= 0:
        raise ValueError("monto debe ser > 0")
    pago = {
        "id": str(uuid.uuid4()),
        "tipo": str(payload.get("tipo") or "Otro").strip() or "Otro",
        "periodo": str(payload.get("periodo") or "").strip(),
        "fecha_pago": str(payload.get("fecha_pago") or datetime.now().strftime("%Y-%m-%d")),
        "monto": round(monto, 2),
        "entidad": str(payload.get("entidad") or "DIAN").strip() or "DIAN",
        "referencia": str(payload.get("referencia") or "").strip(),
        "notas": str(payload.get("notas") or "").strip(),
        "creado_en": datetime.now().isoformat(timespec="seconds"),
    }
    pagos = _leer()
    pagos.append(pago)
    _guardar(pagos)
    return pago


def eliminar_pago(pago_id: str) -> bool:
    pid = str(pago_id or "").strip()
    if not pid:
        return False
    pagos = _leer()
    nuevos = [p for p in pagos if str(p.get("id")) != pid]
    if len(nuevos) == len(pagos):
        return False
    _guardar(nuevos)
    return True
