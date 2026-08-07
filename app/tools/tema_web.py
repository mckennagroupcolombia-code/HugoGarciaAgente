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
import re
import tempfile
import threading
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent  # /home/mckg/mi-agente
TEMA_WEB_FILE = _ROOT / "PAGINA_WEB" / "site" / "data" / "tema_web.json"

TEMAS_VALIDOS = ("clasico", "pureza")

# Tokens del Studio de diseño (tipografía / radio / densidad / tagline).
FUENTES_DISPLAY = ("montserrat",)  # única familia de marca
RADIOS_UI = ("pill", "soft", "sharp")
DENSIDADES = ("compacta", "normal", "amplia")

_FUENTE_CSS = {
    "montserrat": "'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif",
}
_RADIO_CSS = {"pill": "999px", "soft": "12px", "sharp": "4px"}
_DENSIDAD_CSS = {
    "compacta": {"section_y": "48px", "hero_pad": "56px 24px 40px", "card_radius": "12px"},
    "normal": {"section_y": "72px", "hero_pad": "84px 24px 64px", "card_radius": "16px"},
    "amplia": {"section_y": "96px", "hero_pad": "104px 24px 80px", "card_radius": "20px"},
}

_ORDEN_PUREZA = [
    "hero",
    "metricas",
    "trazabilidad",
    "pilares",
    "categorias",
    "destacados",
    "cta",
]
_ORDEN_CLASICO = [
    "hero",
    "features",
    "categorias",
    "destacados",
    "cta",
]

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
        "orden": list(_ORDEN_PUREZA),
        "nodos": {},
    },
    "layout_clasico": {
        "orden": list(_ORDEN_CLASICO),
        "nodos": {},
    },
    "clasico": {
        "anuncio": (
            "Materias primas farmacéuticas y cosméticas certificadas | "
            "Bogotá, Colombia · Lun–Vie 8:00–17:30"
        ),
        "hero": {
            "badge": "Materias Primas Certificadas · Colombia",
            "titulo_l1": "Materias primas",
            "titulo_em": "certificadas",
            "titulo_l2": "para tu industria",
            "subtitulo": (
                "Farmacéuticas, cosméticas y nutracéuticas. Importadas con visto bueno INVIMA, "
                "COA y ficha técnica por lote. Despachos a todo Colombia."
            ),
            "cta_principal": "Comprar ahora",
            "cta_secundario": "Pedir cotización",
            "kit_label": "Por qué elegirnos",
            "kit": [
                {
                    "titulo": "Importación 100% Legal",
                    "texto": "Visto Bueno de Importación (VUCE) + COA de laboratorio + Ficha Técnica por lote",
                    "valor": "COA/TDS",
                    "icono": "certificate",
                },
                {
                    "titulo": "Despacho Nacional",
                    "texto": "Envíos a todo Colombia con trazabilidad",
                    "valor": "48h",
                    "icono": "package",
                },
                {
                    "titulo": "Portafolio Completo",
                    "texto": "+80 referencias disponibles en stock",
                    "valor": "+200",
                    "icono": "flask",
                },
                {
                    "titulo": "Asesoría Técnica",
                    "texto": "Equipo especializado en formulación",
                    "valor": "B2B",
                    "icono": "headset",
                },
            ],
        },
        "features": [
            {
                "titulo": "Importación 100% Legal",
                "texto": "VUCE + COA de laboratorio + Ficha Técnica",
                "icono": "certificate",
            },
            {
                "titulo": "Despacho Nacional",
                "texto": "A todo Colombia",
                "icono": "package",
            },
            {
                "titulo": "Asesoría Técnica",
                "texto": "Equipo especializado",
                "icono": "headset",
            },
            {
                "titulo": "Stock Permanente",
                "texto": "Disponibilidad inmediata",
                "icono": "clock",
            },
        ],
        "categorias": {
            "eyebrow": "Nuestro Portafolio",
            "titulo": "Explora por",
            "titulo_em": "Categoría",
            "texto": (
                "Materias primas para la industria farmacéutica, cosmética y alimentaria. "
                "Todo con calidad certificada y stock permanente."
            ),
        },
        "destacados": {
            "eyebrow": "Productos",
            "titulo": "Selección",
            "titulo_em": "Destacada",
            "texto": "Una muestra de nuestro portafolio con 10% de descuento frente al precio de catálogo.",
        },
        "cta": {
            "eyebrow": "Atención Personalizada",
            "titulo": "¿Necesitas una",
            "titulo_em": "cotización",
            "texto": (
                "Nuestro equipo técnico está listo para asesorarte en la selección "
                "de materias primas para tu formulación específica."
            ),
            "boton_wa": "Cotizar por WhatsApp",
            "boton_contacto": "Formulario de Contacto",
        },
        "secciones": {
            "features": True,
            "categorias": True,
            "destacados": True,
            "cta": True,
        },
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

_FONT_WEIGHTS = (300, 400, 500, 600, 700, 800, 900)

_HEX_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def _sanitize_hex(v) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not _HEX_RE.match(s):
        return None
    return s.lower()


# Compat: familias antiguas del Studio se ignoran; solo Montserrat.
_STUDIO_FONT = "'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif"

_ANIM_LOOP = frozenset({"pulse", "float"})
_ANIM_CSS = {
    "fadeIn": "mck-studio-fade-in",
    "fadeUp": "mck-studio-fade-up",
    "fadeDown": "mck-studio-fade-down",
    "slideLeft": "mck-studio-slide-left",
    "slideRight": "mck-studio-slide-right",
    "zoomIn": "mck-studio-zoom-in",
    "pulse": "mck-studio-pulse",
    "float": "mck-studio-float",
}


def _normalizar_layout(layout: dict | None, orden_default: list[str] | None = None) -> dict:
    """Orden de secciones + nodos (posición, tamaño, efectos)."""
    orden_base = list(orden_default or _ORDEN_PUREZA)
    base = {"orden": orden_base, "nodos": {}}
    if not isinstance(layout, dict):
        return copy.deepcopy(base)
    orden_in = layout.get("orden")
    orden: list[str] = []
    if isinstance(orden_in, list):
        for x in orden_in:
            if isinstance(x, str) and x and x not in orden:
                orden.append(x)
    for x in orden_base:
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
            fw = raw.get("fontWeight")
            if isinstance(fw, (int, float)) and int(fw) in _FONT_WEIGHTS:
                n["fontWeight"] = int(fw)
            if raw.get("fontItalic") is True:
                n["fontItalic"] = True
            for color_key in ("color", "background", "borderColor"):
                hx = _sanitize_hex(raw.get(color_key))
                if hx:
                    n[color_key] = hx
            bw = raw.get("borderWidth")
            if isinstance(bw, (int, float)) and 0 <= float(bw) <= 24:
                n["borderWidth"] = int(round(bw))
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
            anim = raw.get("animation")
            if anim in _ANIM_CSS:
                n["animation"] = anim
            adur = raw.get("animDuration")
            if isinstance(adur, (int, float)) and 0.2 <= float(adur) <= 3:
                n["animDuration"] = round(float(adur), 2)
            adel = raw.get("animDelay")
            if isinstance(adel, (int, float)) and 0 <= float(adel) <= 2:
                n["animDelay"] = round(float(adel), 2)
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
    fw = nodo.get("fontWeight")
    fi = nodo.get("fontItalic") is True
    if (isinstance(fw, (int, float)) and int(fw) in _FONT_WEIGHTS) or fi:
        parts.append(f"font-family:{_STUDIO_FONT}")
        if isinstance(fw, (int, float)) and int(fw) in _FONT_WEIGHTS:
            parts.append(f"font-weight:{int(fw)}")
        if fi:
            parts.append("font-style:italic")
    color = nodo.get("color")
    if isinstance(color, str) and color:
        parts.append(f"color:{color}")
    bg = nodo.get("background")
    if isinstance(bg, str) and bg:
        parts.append(f"background:{bg}")
    bw = nodo.get("borderWidth")
    bc = nodo.get("borderColor")
    if (isinstance(bw, (int, float)) and float(bw) > 0) or isinstance(bc, str):
        parts.append("border-style:solid")
        parts.append(f"border-width:{int(bw) if isinstance(bw, (int, float)) else 1}px")
        parts.append(f"border-color:{bc if isinstance(bc, str) and bc else 'currentColor'}")
        parts.append("box-sizing:border-box")
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
    anim = nodo.get("animation")
    if anim in _ANIM_CSS:
        name = _ANIM_CSS[anim]
        loop = anim in _ANIM_LOOP
        dur = nodo.get("animDuration")
        if not isinstance(dur, (int, float)):
            dur = 2.2 if loop else 0.7
        delay = nodo.get("animDelay")
        if not isinstance(delay, (int, float)):
            delay = 0
        iter_ = "infinite" if loop else "1"
        fill = "none" if loop else "both"
        ease = "ease-in-out" if loop else "ease-out"
        parts.append(
            f"animation:{name} {float(dur)}s {ease} {float(delay)}s {iter_} {fill}"
        )
    return ";".join(parts)


def resolver_layout_ctx(cfg: dict | None = None, *, key: str = "layout") -> dict:
    """Contexto Jinja: orden, mapa de estilos y nodos crudos."""
    cfg = cfg or cargar_tema_web()
    orden_def = _ORDEN_CLASICO if key == "layout_clasico" else _ORDEN_PUREZA
    layout = _normalizar_layout(cfg.get(key) if isinstance(cfg, dict) else None, orden_def)
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
    radio = diseno.get("radio", base["radio"])
    densidad = diseno.get("densidad", base["densidad"])
    tagline = diseno.get("tagline", base["tagline"])
    base["fuente_display"] = "montserrat"
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
        merged["layout"] = _normalizar_layout(merged.get("layout"), _ORDEN_PUREZA)
        merged["layout_clasico"] = _normalizar_layout(
            merged.get("layout_clasico"), _ORDEN_CLASICO
        )
        if not isinstance(merged.get("clasico"), dict):
            merged["clasico"] = copy.deepcopy(TEMA_WEB_DEFAULTS["clasico"])
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
    if "layout_clasico" in cambios and cambios["layout_clasico"] is not None and not isinstance(
        cambios["layout_clasico"], dict
    ):
        raise ValueError("layout_clasico debe ser un objeto JSON")

    actual = cargar_tema_web(force=True)
    layout_in = cambios["layout"] if "layout" in cambios else None
    layout_clasico_in = cambios["layout_clasico"] if "layout_clasico" in cambios else None
    cambios_sin_layout = {
        k: v for k, v in cambios.items() if k not in ("layout", "layout_clasico")
    }
    nuevo = _deep_merge(actual, cambios_sin_layout)
    if layout_in is not None:
        nuevo["layout"] = _normalizar_layout(layout_in, _ORDEN_PUREZA)
    else:
        nuevo["layout"] = _normalizar_layout(nuevo.get("layout"), _ORDEN_PUREZA)
    if layout_clasico_in is not None:
        nuevo["layout_clasico"] = _normalizar_layout(layout_clasico_in, _ORDEN_CLASICO)
    else:
        nuevo["layout_clasico"] = _normalizar_layout(
            nuevo.get("layout_clasico"), _ORDEN_CLASICO
        )
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


def restaurar_tema_clasico() -> dict:
    """Restaura el contenido del tema 'clasico' a los valores por defecto."""
    actual = cargar_tema_web(force=True)
    actual["clasico"] = copy.deepcopy(TEMA_WEB_DEFAULTS["clasico"])
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
    """Restaura orden y nodos del lienzo Pureza a defaults."""
    return guardar_tema_web({"layout": copy.deepcopy(TEMA_WEB_DEFAULTS["layout"])})


def restaurar_layout_clasico() -> dict:
    """Restaura orden y nodos del lienzo Clásico a defaults."""
    return guardar_tema_web(
        {"layout_clasico": copy.deepcopy(TEMA_WEB_DEFAULTS["layout_clasico"])}
    )