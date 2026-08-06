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

# Tokens del Studio de diseño (tipografía / radio / densidad / tagline).
FUENTES_DISPLAY = ("montserrat", "serif")
RADIOS_UI = ("pill", "soft", "sharp")
DENSIDADES = ("compacta", "normal", "amplia")

_FUENTE_CSS = {
    "montserrat": "'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif",
    "serif": "Georgia, 'Times New Roman', 'Liberation Serif', serif",
}
_RADIO_CSS = {"pill": "999px", "soft": "12px", "sharp": "4px"}
_DENSIDAD_CSS = {
    "compacta": {"section_y": "48px", "hero_pad": "56px 24px 40px", "card_radius": "12px"},
    "normal": {"section_y": "72px", "hero_pad": "84px 24px 64px", "card_radius": "16px"},
    "amplia": {"section_y": "96px", "hero_pad": "104px 24px 80px", "card_radius": "20px"},
}

TEMA_WEB_DEFAULTS: dict = {
    "tema_activo": "clasico",
    "actualizado": None,
    "diseno": {
        "fuente_display": "montserrat",
        "radio": "pill",
        "densidad": "normal",
        "tagline": "Proveemos a tus ideas",
    },
    "layout": {
        "orden": [
            "hero",
            "metricas",
            "trazabilidad",
            "pilares",
            "categorias",
            "destacados",
            "cta",
        ],
        "nodos": {},
    },
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


_SHADOW_CSS = {
    "sm": "0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08)",
    "md": "0 6px 16px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.08)",
    "lg": "0 16px 40px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.1)",
}


def _normalizar_layout(layout: dict | None) -> dict:
    """Orden de secciones + nodos (posición, tamaño, efectos)."""
    base = copy.deepcopy(TEMA_WEB_DEFAULTS["layout"])
    if not isinstance(layout, dict):
        return base
    orden_in = layout.get("orden")
    orden: list[str] = []
    if isinstance(orden_in, list):
        for x in orden_in:
            if isinstance(x, str) and x and x not in orden:
                orden.append(x)
    for x in base["orden"]:
        if x not in orden:
            orden.append(x)
    nodos_out: dict = {}
    nodos_in = layout.get("nodos")
    if isinstance(nodos_in, dict):
        for kid, raw in nodos_in.items():
            if not isinstance(kid, str) or not isinstance(raw, dict):
                continue
            n: dict = {}
            for key in ("dx", "dy"):
                v = raw.get(key)
                if isinstance(v, (int, float)) and abs(v) < 4000:
                    n[key] = int(round(v))
            sc = raw.get("scale")
            if isinstance(sc, (int, float)) and 0.5 <= float(sc) <= 2.5:
                n["scale"] = round(float(sc), 2)
            fs = raw.get("fontSize")
            if isinstance(fs, (int, float)) and 10 <= float(fs) <= 96:
                n["fontSize"] = int(round(fs))
            w = raw.get("width")
            if isinstance(w, (int, float)) and 24 <= float(w) <= 1200:
                n["width"] = int(round(w))
            h = raw.get("height")
            if isinstance(h, (int, float)) and 16 <= float(h) <= 800:
                n["height"] = int(round(h))
            rot = raw.get("rotate")
            if isinstance(rot, (int, float)) and -45 <= float(rot) <= 45:
                n["rotate"] = round(float(rot), 1)
            op = raw.get("opacity")
            if isinstance(op, (int, float)) and 0.05 <= float(op) <= 1:
                n["opacity"] = round(float(op), 2)
            br = raw.get("borderRadius")
            if isinstance(br, (int, float)) and 0 <= float(br) <= 999:
                n["borderRadius"] = int(round(br))
            sh = raw.get("shadow")
            if sh in _SHADOW_CSS:
                n["shadow"] = sh
            ic = raw.get("icono")
            if isinstance(ic, str) and ic.strip():
                n["icono"] = ic.strip().removeprefix("ph-")[:64]
            if raw.get("hidden") is True:
                n["hidden"] = True
            if n:
                nodos_out[kid] = n
    return {"orden": orden, "nodos": nodos_out}


def estilo_nodo_layout(nodo: dict | None) -> str:
    """Inline CSS para un nodo del layout (sitio público)."""
    if not isinstance(nodo, dict):
        return ""
    if nodo.get("hidden") is True:
        return "display:none"
    parts: list[str] = []
    dx = int(nodo.get("dx") or 0)
    dy = int(nodo.get("dy") or 0)
    scale = float(nodo.get("scale") or 1)
    rotate = float(nodo.get("rotate") or 0)
    transforms: list[str] = []
    if dx or dy:
        transforms.append(f"translate({dx}px,{dy}px)")
    if rotate:
        transforms.append(f"rotate({rotate}deg)")
    if scale != 1.0:
        transforms.append(f"scale({scale})")
    if transforms:
        parts.append(f"transform:{' '.join(transforms)}")
        parts.append("transform-origin:top left")
        parts.append("display:inline-block")
    fs = nodo.get("fontSize")
    if isinstance(fs, (int, float)):
        parts.append(f"font-size:{int(fs)}px")
    w = nodo.get("width")
    if isinstance(w, (int, float)):
        parts.append(f"width:{int(w)}px")
        parts.append("max-width:100%")
        parts.append("box-sizing:border-box")
    h = nodo.get("height")
    if isinstance(h, (int, float)):
        parts.append(f"height:{int(h)}px")
        parts.append("box-sizing:border-box")
    op = nodo.get("opacity")
    if isinstance(op, (int, float)) and float(op) < 1:
        parts.append(f"opacity:{round(float(op), 2)}")
    br = nodo.get("borderRadius")
    if isinstance(br, (int, float)):
        parts.append(f"border-radius:{int(br)}px")
    sh = nodo.get("shadow")
    if sh in _SHADOW_CSS:
        parts.append(f"box-shadow:{_SHADOW_CSS[sh]}")
    return ";".join(parts)


def resolver_layout_ctx(cfg: dict | None = None) -> dict:
    """Contexto Jinja: orden, mapa de estilos y nodos crudos."""
    cfg = cfg or cargar_tema_web()
    layout = _normalizar_layout(cfg.get("layout") if isinstance(cfg, dict) else None)
    estilos = {kid: estilo_nodo_layout(n) for kid, n in layout["nodos"].items()}
    orden_map = {sid: i for i, sid in enumerate(layout["orden"])}
    return {
        "orden": layout["orden"],
        "orden_map": orden_map,
        "estilos": estilos,
        "nodos": layout["nodos"],
    }


def _normalizar_diseno(diseno: dict | None) -> dict:
    """Valida enums del Studio; cae a defaults si llega basura."""
    base = copy.deepcopy(TEMA_WEB_DEFAULTS["diseno"])
    if not isinstance(diseno, dict):
        return base
    fuente = diseno.get("fuente_display", base["fuente_display"])
    radio = diseno.get("radio", base["radio"])
    densidad = diseno.get("densidad", base["densidad"])
    tagline = diseno.get("tagline", base["tagline"])
    base["fuente_display"] = fuente if fuente in FUENTES_DISPLAY else base["fuente_display"]
    base["radio"] = radio if radio in RADIOS_UI else base["radio"]
    base["densidad"] = densidad if densidad in DENSIDADES else base["densidad"]
    if isinstance(tagline, str) and tagline.strip():
        base["tagline"] = tagline.strip()[:120]
    return base


def resolver_diseno_css(cfg: dict | None = None) -> dict:
    """Variables CSS listas para inyectar en base.html desde el Studio."""
    cfg = cfg or cargar_tema_web()
    d = _normalizar_diseno(cfg.get("diseno") if isinstance(cfg, dict) else None)
    dens = _DENSIDAD_CSS[d["densidad"]]
    return {
        "fuente_display": _FUENTE_CSS[d["fuente_display"]],
        "radio_btn": _RADIO_CSS[d["radio"]],
        "section_y": dens["section_y"],
        "hero_pad": dens["hero_pad"],
        "card_radius": dens["card_radius"],
        "tagline": d["tagline"],
        "fuente_id": d["fuente_display"],
        "radio_id": d["radio"],
        "densidad_id": d["densidad"],
    }


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
        merged["diseno"] = _normalizar_diseno(merged.get("diseno"))
        merged["layout"] = _normalizar_layout(merged.get("layout"))
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
    if "diseno" in cambios and cambios["diseno"] is not None and not isinstance(cambios["diseno"], dict):
        raise ValueError("diseno debe ser un objeto JSON")
    if "layout" in cambios and cambios["layout"] is not None and not isinstance(cambios["layout"], dict):
        raise ValueError("layout debe ser un objeto JSON")

    actual = cargar_tema_web(force=True)
    layout_in = cambios["layout"] if "layout" in cambios else None
    cambios_sin_layout = {k: v for k, v in cambios.items() if k != "layout"}
    nuevo = _deep_merge(actual, cambios_sin_layout)
    if layout_in is not None:
        nuevo["layout"] = _normalizar_layout(layout_in)
    else:
        nuevo["layout"] = _normalizar_layout(nuevo.get("layout"))
    nuevo["diseno"] = _normalizar_diseno(nuevo.get("diseno"))
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


def restaurar_diseno() -> dict:
    """Restaura tipografía / radio / densidad / tagline del Studio a defaults."""
    return guardar_tema_web({"diseno": copy.deepcopy(TEMA_WEB_DEFAULTS["diseno"])})


def restaurar_layout() -> dict:
    """Restaura orden y nodos del lienzo visual a defaults."""
    return guardar_tema_web({"layout": copy.deepcopy(TEMA_WEB_DEFAULTS["layout"])})
