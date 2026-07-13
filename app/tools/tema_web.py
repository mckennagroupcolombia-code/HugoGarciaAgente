"""
Tema visual del sitio web público (PAGINA_WEB/site).

Config compartida entre el agente (panel de operaciones, puerto 8081) que la
edita, y website.py (puerto 8083) que la lee en cada request (cache por mtime).

Temas disponibles:
  - "clasico": el diseño original (verde McKenna, hero oscuro).
  - "pureza":  propuesta "Pureza & Trazabilidad" — fondo claro, tipografía
               serif de display y secciones enfocadas en el valor agregado
               (COA por lote, VUCE, ruta de trazabilidad).
"""

from __future__ import annotations

import copy
import json
import os
import tempfile
import threading
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent  # /home/mckg/mi-agente
TEMA_WEB_FILE = _ROOT / "PAGINA_WEB" / "site" / "data" / "tema_web.json"

TEMAS_VALIDOS = ("clasico", "pureza")

TEMA_WEB_DEFAULTS: dict = {
    "tema_activo": "clasico",
    "actualizado": None,
    "pureza": {
        "colores": {
            "acento": "#0c6069",
            "acento_oscuro": "#04353b",
            "fondo": "#f8f6f1",
            "tinta": "#1c2b2a",
            "destacado": "#b9862f",
        },
        "anuncio": "Pureza verificada por lote · COA + ficha técnica en cada despacho · Bogotá, Colombia",
        "hero": {
            "eyebrow": "Materias primas farmacéuticas y cosméticas",
            "titulo": "Pureza que puedes",
            "titulo_em": "verificar",
            "subtitulo": (
                "Cada lote llega con Certificado de Análisis (COA), ficha técnica y "
                "trazabilidad completa desde el fabricante hasta tu puerta. "
                "Importación 100% legal con visto bueno INVIMA."
            ),
            "cta_principal": "Explorar catálogo",
            "cta_secundario": "Hablar con un asesor",
        },
        "metricas": [
            {"valor": "+200", "etiqueta": "referencias en stock"},
            {"valor": "100%", "etiqueta": "lotes con COA"},
            {"valor": "15", "etiqueta": "años en la industria"},
            {"valor": "48 h", "etiqueta": "despacho nacional"},
        ],
        "trazabilidad": {
            "eyebrow": "Nuestro valor agregado",
            "titulo": "La ruta de tu materia prima",
            "texto": (
                "No vendemos ingredientes anónimos: cada producto conserva su identidad "
                "de origen a destino. Esta es la ruta que garantiza pureza y legalidad "
                "en cada envase."
            ),
            "pasos": [
                {
                    "titulo": "Origen certificado",
                    "texto": "Fabricantes auditados con estándares farmacéuticos y cosméticos internacionales.",
                    "icono": "globe-hemisphere-west",
                },
                {
                    "titulo": "Importación legal",
                    "texto": "Ingreso al país con Visto Bueno de Importación (VUCE) e INVIMA. Sin atajos.",
                    "icono": "shield-check",
                },
                {
                    "titulo": "Control de calidad",
                    "texto": "Certificado de Análisis (COA) de laboratorio por cada lote que entra a bodega.",
                    "icono": "flask",
                },
                {
                    "titulo": "Reenvase trazable",
                    "texto": "Reenvasado bajo Res. 2674/2013 con etiqueta que conserva lote, CAS y concentración.",
                    "icono": "package",
                },
                {
                    "titulo": "Entrega documentada",
                    "texto": "Tu pedido viaja con ficha técnica descargable y soporte técnico de formulación.",
                    "icono": "truck",
                },
            ],
        },
        "pilares": [
            {
                "titulo": "Pureza verificada",
                "texto": "Concentración y número CAS declarados en cada etiqueta, respaldados por el COA del lote.",
                "icono": "seal-check",
            },
            {
                "titulo": "Trazabilidad total",
                "texto": "Del fabricante a tu formulación: lote, origen y documentos disponibles en todo momento.",
                "icono": "path",
            },
            {
                "titulo": "Acompañamiento técnico",
                "texto": "Asesoría real de formulación por WhatsApp, sin costo, antes y después de tu compra.",
                "icono": "chats-circle",
            },
        ],
        "badges_producto": ["COA por lote", "Ficha técnica", "Trazable VUCE"],
        "cta": {
            "titulo": "¿Formulando algo nuevo?",
            "texto": "Nuestro equipo técnico te ayuda a elegir la materia prima correcta, con documentación completa.",
            "boton": "Cotizar por WhatsApp",
        },
        "secciones": {
            "metricas": True,
            "trazabilidad": True,
            "pilares": True,
            "categorias": True,
            "destacados": True,
            "cta": True,
        },
    },
}

_lock = threading.Lock()
_cache: dict = {}
_cache_mtime: float | None = None


def _deep_merge(base: dict, extra: dict) -> dict:
    """Merge recursivo: extra pisa base; dicts se combinan, listas se reemplazan."""
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def cargar_tema_web(force: bool = False) -> dict:
    """Config completa (defaults + archivo). Cache por mtime; segura entre hilos."""
    global _cache, _cache_mtime
    with _lock:
        try:
            mtime = TEMA_WEB_FILE.stat().st_mtime
        except OSError:
            mtime = None
        if not force and _cache and mtime == _cache_mtime:
            return copy.deepcopy(_cache)
        data: dict = {}
        if mtime is not None:
            try:
                data = json.loads(TEMA_WEB_FILE.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        merged = _deep_merge(TEMA_WEB_DEFAULTS, data if isinstance(data, dict) else {})
        if merged.get("tema_activo") not in TEMAS_VALIDOS:
            merged["tema_activo"] = "clasico"
        _cache = merged
        _cache_mtime = mtime
        return copy.deepcopy(merged)


def guardar_tema_web(cambios: dict) -> dict:
    """Aplica cambios sobre la config actual y persiste (escritura atómica)."""
    if not isinstance(cambios, dict):
        raise ValueError("La configuración del tema debe ser un objeto JSON")
    tema = cambios.get("tema_activo")
    if tema is not None and tema not in TEMAS_VALIDOS:
        raise ValueError(f"tema_activo inválido: {tema!r} (válidos: {TEMAS_VALIDOS})")

    actual = cargar_tema_web(force=True)
    nuevo = _deep_merge(actual, cambios)
    nuevo["actualizado"] = datetime.now().isoformat(timespec="seconds")

    TEMA_WEB_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(TEMA_WEB_FILE.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(nuevo, f, ensure_ascii=False, indent=2)
        os.replace(tmp, TEMA_WEB_FILE)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

    global _cache, _cache_mtime
    with _lock:
        _cache = nuevo
        _cache_mtime = TEMA_WEB_FILE.stat().st_mtime
    return copy.deepcopy(nuevo)


def restaurar_tema_pureza() -> dict:
    """Restaura el contenido del tema 'pureza' a los valores por defecto."""
    actual = cargar_tema_web(force=True)
    actual["pureza"] = copy.deepcopy(TEMA_WEB_DEFAULTS["pureza"])
    actual["actualizado"] = datetime.now().isoformat(timespec="seconds")
    TEMA_WEB_FILE.parent.mkdir(parents=True, exist_ok=True)
    TEMA_WEB_FILE.write_text(
        json.dumps(actual, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return cargar_tema_web(force=True)
