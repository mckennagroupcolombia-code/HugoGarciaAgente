"""Asignación de modelo LLM por canal (WhatsApp, web, MeLi, etc.)."""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from typing import Any

_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "canales_modelos.json"
)
_LOCK = threading.Lock()

# Catálogo fijo (mismo que panel /api/sistema/modelos, sin Ollama dinámico)
MODELOS_FIJOS: list[dict[str, Any]] = [
    {
        "id": "claude-sonnet-4-6",
        "nombre": "Claude Sonnet 4.6",
        "categoria": "claude",
        "proveedor": "Anthropic API",
    },
    {
        "id": "claude-haiku-4-5-20251001",
        "nombre": "Claude Haiku 4.5",
        "categoria": "claude",
        "proveedor": "Anthropic API",
    },
    {
        "id": "gemini-2.5-pro",
        "nombre": "Gemini 2.5 Pro",
        "categoria": "gemini",
        "proveedor": "Google API",
    },
    {
        "id": "gemini-2.5-flash",
        "nombre": "Gemini 2.5 Flash",
        "categoria": "gemini",
        "proveedor": "Google API",
    },
]

CANALES_DEFINICION: list[dict[str, Any]] = [
    {
        "id": "whatsapp",
        "nombre": "WhatsApp",
        "icono": "wa",
        "modelo_id": "claude-sonnet-4-6",
        "modo": "Cliente · catálogo + texto",
        "flujo": "cliente_texto",
        "descripcion": (
            "Ventas a clientes: catálogo Sheets y ficha técnica se cargan en Python; "
            "el LLM (Claude por defecto) solo redacta, sin tool-use API. "
            "Fallback automático a Gemini/Ollama si Claude falla o se agota el presupuesto."
        ),
        "editable": True,
        "categorias_modelo": ["claude", "ollama", "gemini"],
    },
    {
        "id": "meli_preventa",
        "nombre": "MeLi Preventa",
        "icono": "ml",
        "modelo_id": "claude-sonnet-4-6",
        "modo": "Operaciones · ficha MeLi",
        "flujo": "operaciones",
        "descripcion": "Responde con ficha técnica. Sin ficha → delega al equipo.",
        "editable": True,
        "categorias_modelo": ["claude", "gemini"],
    },
    {
        "id": "web_chat",
        "nombre": "Web Chat (burbuja)",
        "icono": "web",
        "modelo_id": "claude-sonnet-4-6",
        "modo": "Cliente · combo SIIGO + texto",
        "flujo": "cliente_texto",
        "descripcion": (
            "Burbuja mckennagroup.co: combos SIIGO y fichas en preflight; "
            "LLM (Claude por defecto) solo texto, sin tool-use API. "
            "Fallback automático a Gemini/Ollama si Claude falla o se agota el presupuesto."
        ),
        "editable": True,
        "categorias_modelo": ["claude", "ollama", "gemini"],
    },
    {
        "id": "panel_chat",
        "nombre": "Panel Chat IA",
        "icono": "panel",
        "modelo_id": "seleccionable",
        "modo": "conversacional",
        "descripcion": "Selector de modelo en este panel (pruebas).",
        "editable": False,
        "categorias_modelo": [],
    },
    {
        "id": "voz_ia",
        "nombre": "Voz IA",
        "icono": "mic",
        "modelo_id": "seleccionable",
        "modo": "voz + TTS",
        "descripcion": "Selector de modelo en panel Voz IA.",
        "editable": False,
        "categorias_modelo": [],
    },
    {
        "id": "sede_sur",
        "nombre": "MCKG SEDE SUR",
        "icono": "bot",
        "modelo_id": "gemma3:1b",
        "modo": "Interno · Ollama",
        "flujo": "interno",
        "descripcion": "Equipo interno Sede Sur. Ollama local sin costo por token.",
        "editable": True,
        "categorias_modelo": ["ollama", "claude", "gemini"],
    },
]

FLOJOS_LABEL: dict[str, str] = {
    "cliente_texto": "Cliente (catálogo en Python + LLM texto)",
    "operaciones": "Operaciones (API dedicada)",
    "interno": "Equipo interno",
    "panel": "Panel / pruebas",
}

CANALES_EDITABLES = {c["id"] for c in CANALES_DEFINICION if c.get("editable")}


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _load_overrides() -> dict[str, str]:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}
    raw = data.get("asignaciones") if isinstance(data, dict) else {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        cid = str(k).strip()
        mid = str(v).strip()
        if cid and mid and cid in CANALES_EDITABLES:
            out[cid] = mid
    return out


def _save_overrides(asignaciones: dict[str, str]) -> None:
    os.makedirs(os.path.dirname(_DATA_PATH), exist_ok=True)
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {"updated_at": _now_iso(), "asignaciones": asignaciones},
            f,
            indent=2,
            ensure_ascii=False,
        )


def _resolver_meta_modelo(modelo_id: str) -> dict[str, str]:
    if modelo_id == "seleccionable":
        return {
            "modelo_id": "seleccionable",
            "modelo_nombre": "Seleccionable en panel",
            "modelo_categoria": "",
            "proveedor": "Multi-proveedor",
        }
    for m in MODELOS_FIJOS:
        if m["id"] == modelo_id:
            return {
                "modelo_id": modelo_id,
                "modelo_nombre": m["nombre"],
                "modelo_categoria": m["categoria"],
                "proveedor": m["proveedor"],
            }
    # Ollama u otro id guardado manualmente
    if modelo_id and not modelo_id.startswith(("claude-", "gemini-")):
        return {
            "modelo_id": modelo_id,
            "modelo_nombre": modelo_id,
            "modelo_categoria": "ollama",
            "proveedor": "Local (Ollama)",
        }
    return {
        "modelo_id": modelo_id or "claude-sonnet-4-6",
        "modelo_nombre": modelo_id or "Desconocido",
        "modelo_categoria": "claude" if str(modelo_id).startswith("claude-") else "gemini",
        "proveedor": "API",
    }


def obtener_modelo_canal(canal_id: str) -> str:
    """ID de modelo asignado al canal (o default de la definición)."""
    canal_id = (canal_id or "").strip()
    if not canal_id or canal_id == "panel_chat":
        return "claude-sonnet-4-6"
    with _LOCK:
        overrides = _load_overrides()
    if canal_id in overrides:
        return overrides[canal_id]
    for c in CANALES_DEFINICION:
        if c["id"] == canal_id:
            mid = c.get("modelo_id") or "claude-sonnet-4-6"
            return mid if mid != "seleccionable" else "claude-sonnet-4-6"
    return "claude-sonnet-4-6"


def es_canal_cliente(canal_id: str) -> bool:
    """True para WhatsApp y web: flujo texto + preflight catálogo (sin AgentRun tools)."""
    base = next((c for c in CANALES_DEFINICION if c["id"] == (canal_id or "").strip()), None)
    return bool(base and base.get("flujo") == "cliente_texto")


def listar_canales() -> list[dict[str, Any]]:
    with _LOCK:
        overrides = _load_overrides()
    out: list[dict[str, Any]] = []
    for base in CANALES_DEFINICION:
        cid = base["id"]
        modelo_id = overrides.get(cid, base["modelo_id"])
        meta = _resolver_meta_modelo(modelo_id)
        flujo = base.get("flujo") or ""
        out.append(
            {
                **base,
                **meta,
                "flujo_label": FLOJOS_LABEL.get(flujo, flujo or "—"),
                "es_cliente": flujo == "cliente_texto",
            }
        )
    return out


def asignar_modelo_canal(canal_id: str, modelo_id: str) -> dict[str, Any] | None:
    canal_id = (canal_id or "").strip()
    modelo_id = (modelo_id or "").strip()
    if canal_id not in CANALES_EDITABLES:
        return None
    if not modelo_id:
        return None
    with _LOCK:
        overrides = _load_overrides()
        overrides[canal_id] = modelo_id
        _save_overrides(overrides)
    for c in listar_canales():
        if c["id"] == canal_id:
            return c
    return None


def canal_acepta_ollama(canal_id: str) -> bool:
    """True si el canal permite modelos Ollama locales."""
    base = next((c for c in CANALES_DEFINICION if c["id"] == canal_id), None)
    return "ollama" in (base.get("categorias_modelo") or []) if base else False


def modelo_valido_para_canal(canal_id: str, modelo_id: str) -> bool:
    base = next((c for c in CANALES_DEFINICION if c["id"] == canal_id), None)
    if not base:
        return False
    cats = base.get("categorias_modelo") or []
    if not cats:
        return False
    if modelo_id.startswith("claude-") and "claude" in cats:
        return True
    if modelo_id.startswith("gemini-") and "gemini" in cats:
        return True
    if "ollama" in cats and not modelo_id.startswith(("claude-", "gemini-")):
        return True
    return False
