"""
Ranking de más vendidos McKenna en Mercado Libre (solo nuestra cuenta).

Política (ago-2026): no scraping, no listado web, no `/sites/MCO/search` ni
GET de ítems ajenos. MeLi cierra esas consultas (403) y penaliza recolección
de marketplace. Solo usamos APIs de vendedor: órdenes e ítems propios.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import time
import unicodedata
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus

import requests

_APP_DIR = Path(__file__).resolve().parent.parent
_CACHE_PATH = _APP_DIR / "data" / "analisis_competencia_precios.json"
_OBS_PATH = _APP_DIR / "data" / "competencia_observaciones_manual.json"
_REPORTES_PATH = _APP_DIR / "data" / "competencia_reportes_captura.json"
_PRES_MANUAL_PATH = _APP_DIR / "data" / "competencia_presentaciones_manual.json"
_EVIDENCIAS_DIR = _APP_DIR / "data" / "competencia_evidencias"
_LOGO_EVIDENCIA = _APP_DIR.parent / "DISENO CORPORATIVO " / "LOGO MORADO.png"
_CACHE_TTL_H = 6
_MAX_IMAGEN_CAPTURA = 5_500_000
_MODELO_VISION_CAPTURA = (
    os.getenv("GEMINI_VISION_COMPETENCIA_MODEL", "").strip()
    or os.getenv("GEMINI_VISION_MODEL", "").strip()
    or "gemini-2.5-flash"
)

_STOPWORDS = frozenset({
    "de", "del", "la", "el", "los", "las", "en", "con", "para", "por", "y", "o",
    "un", "una", "al", "a", "x", "plus", "envio", "gratis", "original",
    "calidad", "premium", "oferta", "descuento", "super", "nuevo", "nueva",
    "mckenna", "group", "colombia", "und", "unidades", "unidad", "presentacion",
    "empaque", "pote", "bolsa", "sachet", "frasco", "pack", "promo", "promocion",
    "barato", "economico", "mejor", "alta", "bajo", "tipo", "uso",
})

_RX_PRESENTACION = re.compile(
    r"\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b",
    re.IGNORECASE,
)
# 2x50g · 2 x 50 g · 3×100ml
_RX_PRESENTACION_NX = re.compile(
    r"\b(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b",
    re.IGNORECASE,
)
# 50g + 50g (mismo tamaño dos veces)
_RX_PRESENTACION_SUMA = re.compile(
    r"\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)"
    r"\s*[+]\s*"
    r"(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b",
    re.IGNORECASE,
)
# 50g c/u · 50 g cada uno
_RX_PRESENTACION_CU = re.compile(
    r"\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)"
    r"\s*(?:c\s*/\s*u\.?|c/?u\.?|cada\s+un[oa])\b",
    re.IGNORECASE,
)
# Capacidad de balanza/gramera: «Hasta 50 Gr»
_RX_HASTA_CAPACIDAD = re.compile(
    r"\bhasta\s+(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?)\b",
    re.IGNORECASE,
)
# Precisión de medición: «0.001 G» / «0,01 g» / «1 mg»
_RX_PRECISION_MEDICION = re.compile(
    r"\b(0[.,]\d+|\d+[.,]\d+)\s*(g|grs?|gramos?|mg)\b",
    re.IGNORECASE,
)


def _ahora_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _norm(texto: str) -> str:
    t = unicodedata.normalize("NFD", (texto or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^\w\s%]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def titulo_base_producto(titulo: str) -> str:
    """Quita tamaños y promos: 'Urea Cosmética 250 Gr + Envío' → 'Urea Cosmetica'."""
    t = titulo or ""
    t = re.sub(r"[+]\s*env[ií]o\b", " ", t, flags=re.IGNORECASE)
    t = _RX_PRESENTACION.sub(" ", t)
    t = re.sub(r"\bx\s*\d+\b", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\b\d+\b(?!\s*%)", " ", t)
    t = re.sub(r"[^\w%áéíóúüñÁÉÍÓÚÜÑ\s-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def tokens_significativos(titulo: str) -> list[str]:
    base = _norm(titulo_base_producto(titulo))
    out: list[str] = []
    vistos: set[str] = set()
    for w in base.split():
        if len(w) < 3 or w in _STOPWORDS or w in vistos:
            continue
        vistos.add(w)
        out.append(w)
    return out


_RX_PCT = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(?:%|pct)", re.I)
_RX_VIT = re.compile(r"\b(?:vitamina\s+)?([a-z]\d+)\b", re.I)
_RX_HIFEN = re.compile(r"\b[\w]+(?:-[\w]+)+\b", re.I)


def _extraer_porcentajes(titulo: str) -> list[str]:
    out: list[str] = []
    for m in _RX_PCT.finditer(titulo or ""):
        pct = m.group(1).replace(",", ".")
        if "." in pct:
            pct = pct.rstrip("0").rstrip(".")
        s = f"{pct}%"
        if s not in out:
            out.append(s)
    return out


def _tokens_nombre_busqueda(titulo: str) -> list[str]:
    """Nombre del producto: químicos con guión, vitaminas B5/B12 y tokens ≥3 letras."""
    t = titulo or ""
    extra: list[str] = []
    for m in _RX_HIFEN.finditer(t):
        h = m.group(0).lower()
        h = unicodedata.normalize("NFD", h)
        h = "".join(c for c in h if unicodedata.category(c) != "Mn")
        if len(re.sub(r"[^a-z0-9]", "", h)) >= 3:
            extra.append(h)
        for w in _norm(m.group(0)).split():
            if w and w not in _STOPWORDS and (len(w) >= 3 or re.fullmatch(r"[a-z]\d+", w)):
                extra.append(w)
    for m in _RX_VIT.finditer(t):
        extra.append(m.group(1).lower())
    base = _norm(titulo_base_producto(t))
    base = _RX_PCT.sub(" ", base)
    out: list[str] = []
    vistos: set[str] = set()
    for w in extra + base.split():
        w = w.strip()
        if not w or w in vistos or w in _STOPWORDS:
            continue
        if len(w) >= 3 or re.fullmatch(r"[a-z]\d+", w):
            vistos.add(w)
            out.append(w)
    return out[:6]


def keywords_busqueda_meli(titulo: str, item_id: str = "") -> str:
    """Arma la búsqueda MeLi: nombre + cantidad (g/ml) + concentración (%)."""
    t = titulo or ""
    partes: list[str] = []
    vistos: set[str] = set()

    def add(s: str) -> None:
        s = (s or "").strip()
        if not s:
            return
        k = s.lower()
        if k in vistos:
            return
        vistos.add(k)
        partes.append(s)

    for w in _tokens_nombre_busqueda(t):
        add(w)
    pres = presentacion_efectiva(item_id, t) if item_id else extraer_presentacion(t)
    pt = presentacion_texto(pres)
    if pt:
        add(pt)
    for pct in _extraer_porcentajes(t):
        add(pct)
    return " ".join(partes).strip() or (t[:80])


def desglosar_palabras_clave_meli(titulo: str, item_id: str = "") -> dict:
    """Desglose para UI: nombre, cantidad, porcentajes y query final."""
    t = titulo or ""
    pres = presentacion_efectiva(item_id, t) if item_id else extraer_presentacion(t)
    return {
        "nombre": _tokens_nombre_busqueda(t),
        "cantidad": presentacion_texto(pres) or None,
        "porcentajes": _extraer_porcentajes(t),
        "query": keywords_busqueda_meli(t, item_id),
    }


def _canonizar_cantidad(raw: float, unidad: str) -> Optional[dict]:
    unidad = (unidad or "").lower()
    if unidad in ("kg", "kilo", "kilos"):
        return {"valor": raw, "unidad_raw": unidad, "canonica": "g", "cantidad": int(round(raw * 1000))}
    if unidad in ("g", "gr", "grs", "gramo", "gramos"):
        return {"valor": raw, "unidad_raw": unidad, "canonica": "g", "cantidad": int(round(raw))}
    if unidad in ("l", "lt", "lts", "litro", "litros"):
        return {"valor": raw, "unidad_raw": unidad, "canonica": "ml", "cantidad": int(round(raw * 1000))}
    if unidad in ("ml", "mls", "cc"):
        return {"valor": raw, "unidad_raw": unidad, "canonica": "ml", "cantidad": int(round(raw))}
    return None


def _multiplicador_kit(titulo: str, hasta: int) -> int:
    """Cuántas unidades del tamaño indicado (c/u, 2 frascos, A + B, etc.)."""
    head = (titulo or "")[: max(0, hasta)]
    m = re.search(
        r"\b(\d+)\s*(?:und|unidades?|pcs?|piezas?|frascos?|potes?|sobres?|botellas?)\b",
        head,
        re.IGNORECASE,
    )
    if m:
        n = int(m.group(1))
        if 2 <= n <= 20:
            return n
    if re.search(r"\b(?:duo|par|pareja|kit\s*(?:de\s*)?2|pack\s*(?:de\s*)?2)\b", head, re.IGNORECASE):
        return 2
    # "Alginato + Lactato … 50g c/u" → 2 componentes (ignora "+ envío")
    partes = [
        p.strip()
        for p in re.split(r"\s*\+\s*", head)
        if p.strip() and not re.match(r"(?i)^env[ií]o\b", p.strip())
    ]
    if len(partes) >= 2:
        return min(len(partes), 6)
    return 1


def _es_instrumento_pesaje(titulo: str) -> bool:
    """Gramera/balanza: el 'g' del título es capacidad o precisión, no contenido a vender."""
    t = _norm(titulo)
    return any(
        k in t
        for k in (
            "gramera",
            "balanza",
            "bascula",
            "pesa digital",
            "pesa gramera",
            "bascule",
        )
    )


def extraer_precision_medicion(titulo: str) -> Optional[str]:
    """p. ej. '0.001 g' — resolución de la báscula, no presentación de venta."""
    for m in _RX_PRECISION_MEDICION.finditer(titulo or ""):
        raw = float(m.group(1).replace(",", "."))
        u = m.group(2).lower()
        if u == "mg":
            if raw <= 0:
                continue
            return f"{m.group(1).replace(',', '.')} mg"
        # Precisión en gramos: solo fracciones < 1 g (0.001 g, 0.01 g)
        if 0 < raw < 1:
            return f"{m.group(1).replace(',', '.')} g"
    return None


def _es_precision_no_cantidad(raw: float, unidad: str) -> bool:
    """True si el match parece resolución (0.001 g), no empaque."""
    u = (unidad or "").lower()
    if u in ("mg",):
        return True
    if u in ("g", "gr", "grs", "gramo", "gramos") and 0 < raw < 1:
        return True
    return False


def _anotar_instrumento(pres: Optional[dict], titulo: str) -> Optional[dict]:
    instrumento = _es_instrumento_pesaje(titulo)
    prec = extraer_precision_medicion(titulo)
    if not pres:
        if not instrumento and not prec:
            return None
        out: dict = {
            "valor": 0,
            "unidad_raw": "g",
            "canonica": "g",
            "cantidad": 0,
        }
        if instrumento:
            out["instrumento_pesaje"] = True
        if prec:
            out["precision"] = prec
        return out
    out = dict(pres)
    if instrumento:
        out["instrumento_pesaje"] = True
    if prec:
        out["precision"] = prec
    return out


def extraer_presentacion(titulo: str) -> Optional[dict]:
    """
    Presentación total del título (para $/g o $/ml).
    Unidad canónica: g (masa) o ml (volumen). kg→g, L→ml.

    Kits: «2x50g», «50g + 50g», «A + B 50g c/u» → cantidad total (p. ej. 100 g).
    Instrumentos: «0.001 G … Hasta 50 Gr» → capacidad 50 g (no la precisión).
    """
    t = titulo or ""
    m_hasta = _RX_HASTA_CAPACIDAD.search(t)
    if m_hasta:
        base = _canonizar_cantidad(
            float(m_hasta.group(1).replace(",", ".")),
            m_hasta.group(2),
        )
        if base and int(base["cantidad"]) > 0:
            return _anotar_instrumento(base, t)

    m_nx = _RX_PRESENTACION_NX.search(t)
    if m_nx:
        n_pack = int(m_nx.group(1))
        raw = float(m_nx.group(2).replace(",", "."))
        if not _es_precision_no_cantidad(raw, m_nx.group(3)):
            base = _canonizar_cantidad(raw, m_nx.group(3))
            if base and 1 <= n_pack <= 20 and int(base["cantidad"]) > 0:
                unitaria = int(base["cantidad"])
                return _anotar_instrumento(
                    {
                        **base,
                        "cantidad": unitaria * n_pack,
                        "unidades_kit": n_pack,
                        "cantidad_unitaria": unitaria,
                    },
                    t,
                )

    m_sum = _RX_PRESENTACION_SUMA.search(t)
    if m_sum:
        a = _canonizar_cantidad(float(m_sum.group(1).replace(",", ".")), m_sum.group(2))
        b = _canonizar_cantidad(float(m_sum.group(3).replace(",", ".")), m_sum.group(4))
        if (
            a and b
            and a["canonica"] == b["canonica"]
            and int(a["cantidad"]) > 0
            and int(b["cantidad"]) > 0
            and not _es_precision_no_cantidad(float(m_sum.group(1).replace(",", ".")), m_sum.group(2))
        ):
            return _anotar_instrumento(
                {
                    **a,
                    "cantidad": int(a["cantidad"]) + int(b["cantidad"]),
                    "unidades_kit": 2,
                    "cantidad_unitaria": int(a["cantidad"]),
                },
                t,
            )

    m_cu = _RX_PRESENTACION_CU.search(t)
    if m_cu:
        raw = float(m_cu.group(1).replace(",", "."))
        if not _es_precision_no_cantidad(raw, m_cu.group(2)):
            base = _canonizar_cantidad(raw, m_cu.group(2))
            if base and int(base["cantidad"]) > 0:
                mult = _multiplicador_kit(t, m_cu.start())
                unitaria = int(base["cantidad"])
                return _anotar_instrumento(
                    {
                        **base,
                        "cantidad": unitaria * mult,
                        "unidades_kit": mult,
                        "cantidad_unitaria": unitaria,
                    },
                    t,
                )

    for m in _RX_PRESENTACION.finditer(t):
        raw = float(m.group(1).replace(",", "."))
        if _es_precision_no_cantidad(raw, m.group(2)):
            continue
        base = _canonizar_cantidad(raw, m.group(2))
        if base and int(base["cantidad"]) > 0:
            return _anotar_instrumento(base, t)
    return _anotar_instrumento(None, t) if _es_instrumento_pesaje(t) else None


def presentacion_texto(pres: Optional[dict]) -> str:
    if not pres:
        return ""
    cant = int(pres.get("cantidad") or 0)
    if cant <= 0:
        return ""
    if pres["canonica"] == "g":
        if cant >= 1000 and cant % 1000 == 0:
            return f"{cant // 1000}kg"
        return f"{cant}g"
    if cant >= 1000 and cant % 1000 == 0:
        return f"{cant // 1000}l"
    return f"{cant}ml"


def presentacion_casilla(pres: Optional[dict]) -> str:
    """Texto de columna: '250 g', '100 ml', '2×50 g', '50 g · prec. 0.001 g'."""
    if not pres:
        return "—"
    kit = int(pres.get("unidades_kit") or 1)
    unitaria = pres.get("cantidad_unitaria")
    if kit > 1 and unitaria:
        u = "ml" if pres["canonica"] == "ml" else "g"
        if pres["canonica"] == "g" and int(unitaria) >= 1000 and int(unitaria) % 1000 == 0:
            base = f"{kit}×{int(unitaria) // 1000} kg"
        elif pres["canonica"] == "ml" and int(unitaria) >= 1000 and int(unitaria) % 1000 == 0:
            base = f"{kit}×{int(unitaria) // 1000} L"
        else:
            base = f"{kit}×{int(unitaria)} {u}"
    else:
        cant = int(pres.get("cantidad") or 0)
        if cant <= 0:
            base = "—"
        elif pres["canonica"] == "g":
            if cant >= 1000 and cant % 1000 == 0:
                base = f"{cant // 1000} kg"
            else:
                base = f"{cant} g"
        elif cant >= 1000 and cant % 1000 == 0:
            base = f"{cant // 1000} L"
        else:
            base = f"{cant} ml"
    prec = str(pres.get("precision") or "").strip()
    if prec and base != "—":
        return f"{base} · prec. {prec}"
    if prec and base == "—":
        return f"prec. {prec}"
    return base


def _cargar_pres_manual() -> dict[str, dict]:
    if not _PRES_MANUAL_PATH.exists():
        return {}
    try:
        data = json.loads(_PRES_MANUAL_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    rows = data.get("por_item") if isinstance(data, dict) else {}
    out: dict[str, dict] = {}
    if isinstance(rows, dict):
        for k, v in rows.items():
            mid = str(k or "").strip().upper()
            if mid.startswith("MCO") and isinstance(v, dict) and int(v.get("cantidad") or 0) > 0:
                out[mid] = dict(v)
    return out


def _guardar_pres_manual(por_item: dict[str, dict]) -> None:
    _PRES_MANUAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _PRES_MANUAL_PATH.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps({"version": 1, "por_item": por_item}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp, _PRES_MANUAL_PATH)


def parsear_cantidad_manual(cantidad, unidad: str = "g") -> Optional[dict]:
    """Convierte número + unidad (g/ml) o texto '100 g' en presentación canónica."""
    if isinstance(cantidad, str) and re.search(r"[a-zA-Z]", cantidad):
        pres = extraer_presentacion(cantidad.strip())
        if pres and int(pres.get("cantidad") or 0) > 0:
            out = dict(pres)
            out["manual"] = True
            return out
    try:
        n = float(str(cantidad).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None
    if not (n > 0):
        return None
    u = (unidad or "g").strip().lower()
    if u in ("ml", "mls", "cc", "l", "lt", "lts", "litro", "litros"):
        if u in ("l", "lt", "lts", "litro", "litros"):
            n = n * 1000
            u = "ml"
        base = _canonizar_cantidad(n, "ml")
    else:
        if u in ("kg", "kilo", "kilos"):
            n = n * 1000
            u = "g"
        base = _canonizar_cantidad(n, "g")
    if not base or int(base.get("cantidad") or 0) <= 0:
        return None
    out = dict(base)
    out["manual"] = True
    return out


def presentacion_efectiva(item_id: str = "", titulo: str = "") -> Optional[dict]:
    """Manual del operador gana sobre lo leído del título."""
    mid = str(item_id or "").strip().upper()
    if mid:
        man = _cargar_pres_manual().get(mid)
        if man and int(man.get("cantidad") or 0) > 0:
            out = dict(man)
            out["manual"] = True
            return out
    return extraer_presentacion(titulo or "")


def actualizar_presentacion_manual(
    item_id: str,
    cantidad,
    unidad: str = "g",
) -> dict:
    """Guarda g/ml a mano cuando el título no trae empaque; rearma el reporte de captura."""
    mid = str(item_id or "").strip().upper()
    if not mid.startswith("MCO"):
        return {"ok": False, "error": "item_id MeLi requerido (MCO…)."}
    texto = str(cantidad or "").strip()
    if texto.lower() in ("", "-", "—", "borrar", "limpiar", "none", "null"):
        por = _cargar_pres_manual()
        por.pop(mid, None)
        _guardar_pres_manual(por)
        pres = None
    else:
        pres = parsear_cantidad_manual(cantidad, unidad)
        if not pres:
            return {"ok": False, "error": "Cantidad inválida. Ej.: 100 y unidad g, o «250 ml»."}
        por = _cargar_pres_manual()
        por[mid] = {
            "valor": pres.get("valor"),
            "unidad_raw": pres.get("unidad_raw"),
            "canonica": pres.get("canonica"),
            "cantidad": int(pres["cantidad"]),
            "manual": True,
            "texto": presentacion_casilla(pres),
            "actualizado_en": _ahora_iso(),
        }
        _guardar_pres_manual(por)

    cache = _cargar_cache() or {}
    titulo = ""
    sku = ""
    precio = 0.0
    for p in cache.get("productos") or []:
        if str(p.get("item_id") or "").upper() != mid:
            continue
        titulo = str(p.get("titulo") or "")
        sku = str(p.get("sku") or "")
        precio = float(p.get("precio") or 0)
        ef = presentacion_efectiva(mid, titulo)
        p["presentacion"] = ef
        p["presentacion_manual"] = presentacion_casilla(ef) if (ef or {}).get("manual") else None
        p["precio_por_100"] = precio_por_100(precio, ef)
        p["precio_por_unidad"] = precio_por_unidad(precio, ef)
        kw = desglosar_palabras_clave_meli(titulo, mid)
        p["palabras_clave_meli"] = kw
        p["query"] = kw["query"]
        p["url_busqueda_meli"] = url_busqueda_meli_navegador(kw["query"])
        break
    try:
        if cache.get("productos"):
            _guardar_cache(cache)
    except Exception:
        pass

    reportes = _cargar_reportes_captura()
    hist = []
    for r in reportes:
        if str(r.get("item_id") or "").upper() != mid:
            hist.append(r)
            continue
        listados = r.get("listados") or []
        tit = str(r.get("nuestro_titulo") or titulo or "")
        monto = parsear_precio_cop(r.get("nuestro_precio")) or precio
        nuevo = armar_reporte_captura(
            item_id=mid,
            titulo=tit,
            precio=float(monto or 0),
            listados_visibles=listados,
        )
        try:
            nuevo["evidencia_png"] = render_evidencia_tabla_competencia(nuevo, sku=sku)
        except Exception as e:
            print(f"[competencia] evidencia al guardar cantidad {mid}: {e}")
            nuevo["evidencia_png"] = r.get("evidencia_png")
        hist.append(nuevo)
    if hist != reportes:
        _guardar_reportes_captura(hist)

    analisis = obtener_ultimo_analisis_competencia()
    return {
        "ok": True,
        "item_id": mid,
        "presentacion": presentacion_casilla(pres) if pres else None,
        "presentacion_manual": presentacion_casilla(pres) if pres else None,
        **analisis,
    }


def misma_unidad_medida(pres_n: Optional[dict], pres_c: Optional[dict]) -> bool:
    """True si ambos son masa (g) o ambos volumen (ml). 250 g vs 500 g sí; 250 g vs 250 ml no."""
    if not pres_n or not pres_c:
        return False
    un, uc = pres_n.get("canonica"), pres_c.get("canonica")
    return un in ("g", "ml") and un == uc


def misma_presentacion(
    pres_n: Optional[dict],
    pres_c: Optional[dict],
    *,
    tolerancia_pct: float = 0.05,
) -> bool:
    """
    True si competidor ofrece la misma cantidad en la misma unidad (g o ml).
    Ej.: 250 g vs 250 g sí; 250 g vs 500 g o 250 ml no.
    """
    if not misma_unidad_medida(pres_n, pres_c):
        return False
    cn = int(pres_n["cantidad"])
    cc = int(pres_c["cantidad"])
    if cn <= 0 or cc <= 0:
        return False
    tol = max(1, int(cn * tolerancia_pct))
    return abs(cn - cc) <= tol


def etiqueta_unidad(pres: Optional[dict]) -> str:
    if not pres:
        return ""
    return "/ ml" if pres.get("canonica") == "ml" else "/ g"


def etiqueta_por_100(pres: Optional[dict]) -> str:
    """Alias: la comparación se muestra por g o ml, no por 100."""
    return etiqueta_unidad(pres)


def _presentacion_desde_vision(raw: Optional[dict], titulo: str) -> Optional[dict]:
    if isinstance(raw, dict):
        unidad = str(raw.get("unidad") or raw.get("unidad_cantidad") or "").strip()
        cant = raw.get("cantidad")
        if cant in (None, ""):
            if unidad.lower() in ("ml", "mls", "cc", "l", "lt", "litro", "litros"):
                cant = raw.get("ml")
            else:
                cant = raw.get("gramos") or raw.get("ml")
        try:
            n = float(str(cant).replace(",", "."))
        except (TypeError, ValueError):
            n = 0.0
        if n > 0:
            # 0.001 g es precisión de báscula, no empaque
            if n < 1 and (unidad or "g").lower() in ("g", "gr", "grs", "gramo", "gramos", ""):
                return extraer_presentacion(titulo)
            pres = extraer_presentacion(f"{n} {unidad or 'g'}")
            if pres and int(pres.get("cantidad") or 0) > 0:
                return _anotar_instrumento(pres, titulo) if _es_instrumento_pesaje(titulo) else pres
    return extraer_presentacion(titulo)


def enriquecer_fila_comparacion(
    titulo: str,
    precio: float,
    raw: Optional[dict] = None,
) -> dict:
    pres = _presentacion_desde_vision(raw if isinstance(raw, dict) else None, titulo)
    total = float(precio or 0)
    return {
        "nombre": (titulo or "").strip()[:180],
        "cantidad": presentacion_casilla(pres),
        "valor_total": total,
        "precio_por_100": precio_por_100(total, pres),
        "precio_por_unidad": precio_por_unidad(total, pres),
        "unidad_canonica": (pres or {}).get("canonica"),
    }


def query_busqueda(titulo: str, item_id: str = "") -> str:
    return keywords_busqueda_meli(titulo, item_id)


def url_busqueda_meli_navegador(query: str) -> str:
    """
    URL para que un humano abra el listado de MeLi en *su* navegador.
    El servidor no descarga esa página.
    """
    q = (query or "").strip()
    if not q:
        return "https://www.mercadolibre.com.co/"
    return "https://listado.mercadolibre.com.co/" + quote_plus(q).replace("%20", "-")


def permalink_meli_seguro(url: str) -> str:
    """Acepta solo enlaces de Mercado Libre Colombia; no se visita desde el servidor."""
    u = (url or "").strip()
    if not u:
        return ""
    low = u.lower()
    if low.startswith("https://www.mercadolibre.com.co/") or low.startswith(
        "https://articulo.mercadolibre.com.co/"
    ) or low.startswith("https://listado.mercadolibre.com.co/"):
        return u.split()[0][:500]
    return ""


def parsear_precio_cop(raw) -> Optional[float]:
    if isinstance(raw, (int, float)):
        n = float(raw)
        return n if n > 0 else None
    s = str(raw or "").strip().replace("$", "").replace(" ", "")
    if not s:
        return None
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", s):
        s = s.replace(".", "").replace(",", ".")
    elif "," in s and "." not in s:
        s = s.replace(",", ".")
    else:
        s = re.sub(r"[^\d.]", "", s)
    try:
        n = float(s)
    except ValueError:
        return None
    return n if n > 0 else None


def titulos_relacionados(nuestro: str, competidor: str) -> tuple[bool, float]:
    """
    Relación por núcleo del título (primeros 1-2 tokens significativos
    deben aparecer en el competidor) + score Jaccard del resto.
    """
    a = tokens_significativos(nuestro)
    if not a:
        return False, 0.0
    b_norm = _norm(competidor)
    nucleo = a[:2] if len(a) >= 2 else a[:1]
    if not all(t in b_norm for t in nucleo):
        return False, 0.0
    b = tokens_significativos(competidor)
    inter = len(set(a) & set(b))
    union = len(set(a) | set(b)) or 1
    score = inter / union
    return True, round(score, 3)


def precio_por_unidad(precio: float, pres: Optional[dict]) -> Optional[float]:
    """COP por 1 g o 1 ml. No aplica a grameras/balanzas (capacidad ≠ contenido)."""
    if not pres or not precio:
        return None
    if pres.get("instrumento_pesaje"):
        return None
    if int(pres.get("cantidad") or 0) <= 0:
        return None
    return round(float(precio) / int(pres["cantidad"]), 2)


def precio_por_100(precio: float, pres: Optional[dict]) -> Optional[float]:
    unit = precio_por_unidad(precio, pres)
    if unit is None:
        return None
    return round(unit * 100.0, 2)


def delta_pct(nuestro: float, otro: float) -> Optional[float]:
    if not nuestro:
        return None
    return round((nuestro - otro) * 100.0 / nuestro, 1)


def clasificar_vs_min(nuestro: float, minimo_comp: Optional[float], umbral: float = 0.05) -> str:
    if minimo_comp is None or minimo_comp <= 0:
        return "sin_competencia"
    if nuestro > minimo_comp * (1 + umbral):
        return "mas_caro"
    if nuestro < minimo_comp * (1 - umbral):
        return "mas_barato"
    return "similar"


def _cop(n: float) -> str:
    try:
        return f"${int(round(n)):,}".replace(",", ".")
    except (TypeError, ValueError):
        return str(n)


def _cargar_cache() -> Optional[dict]:
    if not _CACHE_PATH.exists():
        return None
    try:
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict) or data.get("version") != 1:
        return None
    return data


def _guardar_cache(data: dict) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _CACHE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, _CACHE_PATH)


def _cargar_observaciones() -> list[dict]:
    if not _OBS_PATH.exists():
        return []
    try:
        data = json.loads(_OBS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = data.get("observaciones") if isinstance(data, dict) else data
    return [r for r in (rows or []) if isinstance(r, dict) and r.get("id")]


def _guardar_observaciones(rows: list[dict]) -> None:
    _OBS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _OBS_PATH.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps({"version": 1, "observaciones": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp, _OBS_PATH)


def _recontar_resumen(productos: list[dict]) -> dict:
    return {
        "productos": len(productos),
        "con_competencia": sum(1 for p in productos if p.get("veredicto") != "sin_competencia"),
        "nosotros_mas_caros": sum(1 for p in productos if p.get("veredicto") == "mas_caro"),
        "nosotros_mas_baratos": sum(1 for p in productos if p.get("veredicto") == "mas_barato"),
        "similares": sum(1 for p in productos if p.get("veredicto") == "similar"),
        "sin_match": sum(1 for p in productos if p.get("veredicto") == "sin_competencia"),
        "observaciones_manual": sum(len(p.get("observaciones_manual") or []) for p in productos),
    }


def aplicar_observaciones_manuales(analisis: dict) -> dict:
    """Cruza el ranking propio con precios que el equipo anotó a ojo. Sin red a terceros."""
    out = dict(analisis or {})
    productos = [dict(p) for p in (out.get("productos") or [])]
    por_item: dict[str, list[dict]] = {}
    for row in _cargar_observaciones():
        mid = str(row.get("item_id") or "").upper()
        if mid:
            por_item.setdefault(mid, []).append(row)
    reportes_por_item = _indice_ultimo_reporte_captura()
    for p in productos:
        mid = str(p.get("item_id") or "").upper()
        tit = p.get("titulo") or ""
        kw = desglosar_palabras_clave_meli(tit, mid)
        p["palabras_clave_meli"] = kw
        p["query"] = kw["query"]
        p["url_busqueda_meli"] = url_busqueda_meli_navegador(kw["query"])
        obs = list(por_item.get(mid) or [])
        pres_n = presentacion_efectiva(mid, tit)
        if (pres_n or {}).get("manual"):
            p["presentacion_manual"] = presentacion_casilla(pres_n)
            p["presentacion_es_manual"] = True
        else:
            p["presentacion_manual"] = None
            p["presentacion_es_manual"] = False
        p["cantidad_efectiva"] = presentacion_casilla(pres_n)
        p["presentacion"] = pres_n
        if pres_n and int(pres_n.get("cantidad") or 0) > 0:
            obs = [
                o for o in obs
                if misma_unidad_medida(
                    pres_n,
                    extraer_presentacion(str(o.get("titulo") or "")),
                )
            ]
        p["observaciones_manual"] = obs
        unit_n = precio_por_unidad(float(p.get("precio") or 0), pres_n)
        units = []
        for o in obs:
            pu = precio_por_unidad(
                float(o.get("precio") or 0),
                extraer_presentacion(str(o.get("titulo") or "")),
            )
            if pu:
                units.append(pu)
        if unit_n and units:
            minimo = min(units)
            p["veredicto"] = clasificar_vs_min(float(unit_n), minimo)
            p["min_competencia"] = minimo
            p["delta_pct_vs_min"] = delta_pct(float(unit_n), minimo)
            p["n_competidores"] = len(obs)
        else:
            precios = [float(o["precio"]) for o in obs if o.get("precio")]
            minimo = min(precios) if precios else None
            if precios and minimo:
                p["veredicto"] = clasificar_vs_min(float(p.get("precio") or 0), minimo)
                p["min_competencia"] = minimo
                p["delta_pct_vs_min"] = delta_pct(float(p.get("precio") or 0), minimo)
                p["n_competidores"] = len(obs)
            else:
                p["veredicto"] = "sin_competencia"
                p["min_competencia"] = None
                p["delta_pct_vs_min"] = None
                p["n_competidores"] = 0
        p["competidores"] = []
        p["reporte_captura"] = reportes_por_item.get(mid)
    out["productos"] = productos
    if productos or out.get("ok"):
        out["resumen"] = _recontar_resumen(productos)
    out["aviso"] = (
        "Al buscar en MeLi se abre el listado en tu navegador. Pegá o capturá el "
        "pantallazo y armamos el reporte de competencia. El servidor no visita "
        "publicaciones ajenas (MeLi lo bloquea)."
    )
    return out


def registrar_observacion_manual(
    item_id: str,
    precio,
    vendedor: str = "",
    titulo: str = "",
    permalink: str = "",
    notas: str = "",
    fuente: str = "navegador_manual",
) -> dict:
    mid = str(item_id or "").strip().upper()
    if not mid.startswith("MCO"):
        return {"ok": False, "error": "item_id MeLi requerido (MCO…)."}
    monto = parsear_precio_cop(precio)
    if not monto:
        return {"ok": False, "error": "Precio inválido."}
    row = {
        "id": uuid.uuid4().hex[:12],
        "item_id": mid,
        "precio": monto,
        "vendedor": (vendedor or "").strip()[:80],
        "titulo": (titulo or "").strip()[:180],
        "permalink": permalink_meli_seguro(permalink),
        "notas": (notas or "").strip()[:240],
        "visto_en": _ahora_iso(),
        "fuente": (fuente or "navegador_manual").strip()[:40] or "navegador_manual",
    }
    rows = _cargar_observaciones()
    rows.append(row)
    _guardar_observaciones(rows)
    return {"ok": True, "observacion": row, **obtener_ultimo_analisis_competencia()}


def eliminar_observacion_manual(obs_id: str) -> dict:
    oid = str(obs_id or "").strip()
    if not oid:
        return {"ok": False, "error": "id requerido"}
    rows = [r for r in _cargar_observaciones() if str(r.get("id")) != oid]
    _guardar_observaciones(rows)
    return {"ok": True, **obtener_ultimo_analisis_competencia()}


def obtener_ultimo_analisis_competencia() -> dict:
    data = _cargar_cache()
    if not data:
        vacio = {"ok": True, "vacio": True, "productos": [], "resumen": None}
        return aplicar_observaciones_manuales(vacio) if _cargar_observaciones() else vacio
    data = dict(data)
    data["ok"] = True
    data["vacio"] = False
    try:
        ts = datetime.fromisoformat(str(data.get("generado_en") or ""))
        data["stale"] = datetime.now() - ts >= timedelta(hours=_CACHE_TTL_H)
    except Exception:
        data["stale"] = True
    return aplicar_observaciones_manuales(data)


def actualizar_precio_base_competencia(
    item_id: str,
    precio,
    sku: str = "",
    push_meli: bool = True,
) -> dict:
    """Actualiza el precio base de nuestra publicación (cache + MeLi) y rearma el reporte."""
    mid = str(item_id or "").strip().upper()
    if not mid.startswith("MCO"):
        return {"ok": False, "error": "item_id MeLi requerido (MCO…)."}
    monto = parsear_precio_cop(precio)
    if not monto:
        return {"ok": False, "error": "Precio inválido."}

    cache = _cargar_cache() or {}
    encontrado = False
    titulo = ""
    for p in cache.get("productos") or []:
        if str(p.get("item_id") or "").upper() != mid:
            continue
        p["precio"] = monto
        pres = presentacion_efectiva(mid, p.get("titulo") or "")
        p["presentacion"] = pres
        p["presentacion_manual"] = presentacion_casilla(pres) if (pres or {}).get("manual") else None
        p["precio_por_100"] = precio_por_100(monto, pres)
        p["precio_por_unidad"] = precio_por_unidad(monto, pres)
        titulo = str(p.get("titulo") or "")
        if not sku:
            sku = str(p.get("sku") or "")
        encontrado = True
        break
    if encontrado:
        try:
            _guardar_cache(cache)
        except Exception:
            pass

    reportes = _cargar_reportes_captura()
    hist = []
    for r in reportes:
        if str(r.get("item_id") or "").upper() != mid:
            hist.append(r)
            continue
        listados = r.get("listados") or []
        tit = str(r.get("nuestro_titulo") or titulo or "")
        nuevo = armar_reporte_captura(
            item_id=mid,
            titulo=tit,
            precio=monto,
            listados_visibles=listados,
        )
        try:
            nuevo["evidencia_png"] = render_evidencia_tabla_competencia(nuevo, sku=sku)
        except Exception as e:
            print(f"[competencia] evidencia al actualizar precio {mid}: {e}")
            nuevo["evidencia_png"] = r.get("evidencia_png")
        hist.append(nuevo)
    if hist != reportes:
        _guardar_reportes_captura(hist)

    meli = None
    if push_meli:
        try:
            from app.services.meli import actualizar_precio_meli_por_sku

            meli = actualizar_precio_meli_por_sku(sku or "", monto, meli_id=mid)
        except Exception as e:
            meli = {"ok": False, "msg": str(e)[:240]}

    analisis = obtener_ultimo_analisis_competencia()
    out = {
        "ok": True,
        "precio": monto,
        "item_id": mid,
        "cache_ok": encontrado,
        **analisis,
    }
    if meli is not None:
        out["meli"] = meli
        if not meli.get("ok"):
            out["aviso_meli"] = meli.get("msg") or "No se pudo publicar el precio en MeLi."
    return out


def _cache_fresco(data: dict, dias: int, top_n: int, consulta: str) -> bool:
    if (data.get("dias") != dias or data.get("top_n") != top_n
            or (data.get("consulta") or "") != (consulta or "").strip()):
        return False
    try:
        ts = datetime.fromisoformat(str(data.get("generado_en") or ""))
    except Exception:
        return False
    return datetime.now() - ts < timedelta(hours=_CACHE_TTL_H)


def _seller_id_y_token() -> tuple[Optional[str], Optional[str]]:
    from app.utils import obtener_seller_id_meli, refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        return None, None
    return obtener_seller_id_meli(), token


def _multiget_items(ids: list[str], token: str) -> list[dict]:
    items: list[dict] = []
    headers = {"Authorization": f"Bearer {token}"}
    attrs = "id,title,price,permalink,status,sold_quantity,category_id,seller_id,seller_custom_field"
    for i in range(0, len(ids), 20):
        lote = ids[i : i + 20]
        if not lote:
            continue
        try:
            r = requests.get(
                "https://api.mercadolibre.com/items",
                params={"ids": ",".join(lote), "attributes": attrs},
                headers=headers,
                timeout=25,
            )
            if r.status_code != 200:
                continue
            for wrap in r.json():
                if wrap.get("code") != 200:
                    continue
                body = wrap.get("body")
                if isinstance(body, dict) and body.get("id"):
                    items.append(body)
        except Exception:
            continue
    return items


def _sku_item(item: dict) -> str:
    sku = (item.get("seller_custom_field") or "").strip()
    if sku:
        return sku
    for attr in item.get("attributes") or []:
        if attr.get("id") in ("SELLER_SKU", "SKU"):
            return (attr.get("value_name") or "").strip()
    return ""


def nuestros_mas_vendidos(
    dias: int = 30,
    top_n: int = 12,
    consulta: str = "",
) -> dict:
    """
    Ranking de publicaciones propias por unidades vendidas (órdenes pagadas).
    Si `consulta` viene, filtra por título/SKU/item_id.
    """
    from app.sync import obtener_ventas_meli_por_item

    dias = max(7, min(int(dias or 30), 90))
    top_n = max(1, min(int(top_n or 12), 25))
    seller_id, token = _seller_id_y_token()
    if not token or not seller_id:
        return {"ok": False, "error": "No se pudo obtener token o seller_id de MeLi.", "items": []}

    ventas = obtener_ventas_meli_por_item(dias=dias, refresh=False)
    por_item = ventas.get("por_item") or {}
    ranking = sorted(
        por_item.items(),
        key=lambda kv: int((kv[1] or {}).get("unidades") or 0),
        reverse=True,
    )
    ids = [mid for mid, _ in ranking if str(mid).upper().startswith("MCO")]
    if not ids:
        return {
            "ok": True,
            "seller_id": str(seller_id),
            "dias": dias,
            "items": [],
            "fuente_ventas": ventas.get("fuente"),
            "aviso": "No hay ventas pagadas en el período para armar el ranking.",
        }

    # Traemos más de top_n por si el filtro de consulta descarta varios
    detalle = _multiget_items(ids[: max(top_n * 3, 40)], token)
    by_id = {str(d.get("id") or "").upper(): d for d in detalle}
    qn = _norm(consulta)
    items: list[dict] = []
    for mid, slot in ranking:
        d = by_id.get(str(mid).upper())
        if not d:
            continue
        if (d.get("status") or "") != "active":
            continue
        titulo = (d.get("title") or "").strip()
        sku = _sku_item(d)
        if qn:
            blob = _norm(f"{titulo} {sku} {mid}")
            if qn not in blob and not all(t in blob for t in qn.split() if len(t) >= 3):
                continue
        precio = float(d.get("price") or 0)
        if precio <= 0 or not titulo:
            continue
        pres = extraer_presentacion(titulo)
        items.append({
            "item_id": d.get("id"),
            "titulo": titulo,
            "sku": sku,
            "precio": precio,
            "permalink": d.get("permalink") or "",
            "category_id": d.get("category_id") or "",
            "sold_quantity": int(d.get("sold_quantity") or 0),
            "unidades_periodo": int(slot.get("unidades") or 0),
            "ordenes_periodo": int(slot.get("ordenes") or 0),
            "monto_periodo": float(slot.get("monto") or 0),
            "nivel": slot.get("nivel") or "",
            "presentacion": pres,
            "precio_por_100": precio_por_100(precio, pres),
            "precio_por_unidad": precio_por_unidad(precio, pres),
            "query": query_busqueda(titulo, str(d.get("id") or "")),
        })
        if len(items) >= top_n:
            break
    return {
        "ok": True,
        "seller_id": str(seller_id),
        "dias": dias,
        "top_n": top_n,
        "consulta": (consulta or "").strip(),
        "fuente_ventas": ventas.get("fuente"),
        "actualizado_en": ventas.get("actualizado_en"),
        "items": items,
    }


def buscar_publicaciones_meli(query: str, limit: int = 20) -> tuple[list[dict], str]:
    """
    No consulta el marketplace. MeLi responde 403 a `/sites/MCO/search` y a
    ítems de otros vendedores; scraping del listado está prohibido (penalización).
    Se deja el gancho por si un día hay un endpoint oficial de competencia.
    """
    return [], "meli_no_permite"


def _seller_de_resultado(res: dict) -> tuple[str, str]:
    seller = res.get("seller") or {}
    if isinstance(seller, dict):
        sid = str(seller.get("id") or "").strip()
        nick = (seller.get("nickname") or seller.get("name") or "").strip()
        return sid, nick
    return str(seller or "").strip(), ""


def competidores_de_publicacion(
    nuestro: dict,
    seller_id_nuestro: str,
    limit: int = 20,
) -> tuple[list[dict], str]:
    raw, metodo = buscar_publicaciones_meli(nuestro.get("query") or nuestro.get("titulo") or "", limit=limit)
    ours = str(seller_id_nuestro or "")
    our_item = str(nuestro.get("item_id") or "").upper()
    pres_n = nuestro.get("presentacion")
    precio_n = float(nuestro.get("precio") or 0)
    unit_n = nuestro.get("precio_por_unidad")
    if not unit_n and nuestro.get("precio_por_100"):
        unit_n = float(nuestro["precio_por_100"]) / 100.0
    out: list[dict] = []
    vistos: set[str] = set()
    for res in raw:
        if not isinstance(res, dict):
            continue
        cid = str(res.get("id") or "").upper()
        if not cid.startswith("MCO") or cid == our_item or cid in vistos:
            continue
        sid, nick = _seller_de_resultado(res)
        if sid and sid == ours:
            continue
        titulo_c = (res.get("title") or "").strip()
        ok, score = titulos_relacionados(nuestro.get("titulo") or "", titulo_c)
        if not ok:
            continue
        precio_c = float(res.get("price") or 0)
        if precio_c <= 0:
            continue
        pres_c = extraer_presentacion(titulo_c)
        misma_u = misma_unidad_medida(pres_n, pres_c)
        if pres_n and not misma_u:
            continue
        misma = misma_presentacion(pres_n, pres_c)
        unit_c = precio_por_unidad(precio_c, pres_c)
        base_n = unit_n if (unit_n and unit_c) else precio_n
        base_c = unit_c if (unit_n and unit_c) else precio_c
        vistos.add(cid)
        out.append({
            "item_id": res.get("id"),
            "titulo": titulo_c,
            "precio": precio_c,
            "seller_id": sid,
            "seller_nickname": nick,
            "permalink": res.get("permalink") or "",
            "thumbnail": res.get("thumbnail") or "",
            "sold_quantity": int(res.get("sold_quantity") or 0),
            "free_shipping": bool((res.get("shipping") or {}).get("free_shipping")),
            "misma_presentacion": misma,
            "presentacion": pres_c,
            "precio_por_100": precio_por_100(precio_c, pres_c),
            "precio_por_unidad": unit_c,
            "relacion_titulo": score,
            "delta_pct": delta_pct(base_n, base_c) if base_n and base_c else None,
        })
    out.sort(key=lambda c: (
        float(c.get("precio_por_unidad") or c.get("precio_por_100") or 1e18),
        float(c.get("precio") or 0),
    ))
    return out[:15], metodo


def _veredicto_producto(nuestro: dict, comps: list[dict]) -> tuple[str, Optional[float], Optional[float]]:
    if not comps:
        return "sin_competencia", None, None
    use_gramo = bool(nuestro.get("precio_por_unidad")) or any(
        c.get("precio_por_unidad") for c in comps
    )
    precios: list[float] = []
    for c in comps:
        if use_gramo and c.get("precio_por_unidad"):
            precios.append(float(c["precio_por_unidad"]))
        elif (not use_gramo) and c.get("precio_por_100"):
            precios.append(float(c["precio_por_100"]))
        elif c.get("precio"):
            precios.append(float(c.get("precio") or 0))
    precios = [p for p in precios if p > 0]
    if not precios:
        return "sin_competencia", None, None
    minimo = min(precios)
    if use_gramo:
        ref = float(nuestro.get("precio_por_unidad") or 0)
        if not ref and nuestro.get("precio_por_100"):
            ref = float(nuestro["precio_por_100"]) / 100.0
    elif nuestro.get("precio_por_100"):
        ref = float(nuestro["precio_por_100"])
    else:
        ref = float(nuestro.get("precio") or 0)
    return clasificar_vs_min(ref, minimo), minimo, delta_pct(ref, minimo) if ref else None


def formatear_reporte_texto(analisis: dict, *, max_chars: int = 7800) -> str:
    if not analisis.get("ok"):
        return f"❌ Análisis de competencia: {analisis.get('error') or 'falló.'}"
    r = analisis.get("resumen") or {}
    lineas = [
        f"📊 Competencia de precios MeLi — {analisis.get('generado_en') or ''}",
        f"Más vendidos {analisis.get('dias')}d · top {analisis.get('top_n')}"
        + (f" · filtro «{analisis.get('consulta')}»" if analisis.get("consulta") else ""),
        f"Fuente: {analisis.get('metodo_busqueda') or '?'} · "
        f"{r.get('productos', 0)} productos propios (MeLi no permite ver precios ajenos por API)",
        "",
    ]
    metodo = analisis.get("metodo_busqueda") or ""
    bloques = {
        "mas_caro": "⚠ REVISAR PRECIO (hay vendedores más baratos)",
        "similar": "≈ Precio similar al mercado",
        "mas_barato": "✅ Más baratos que la competencia",
        "sin_competencia": (
            "Nuestros más vendidos (solo precio McKenna)"
            if metodo == "meli_no_permite"
            else "○ Sin publicación comparable"
        ),
    }
    por_v: dict[str, list] = {k: [] for k in bloques}
    for p in analisis.get("productos") or []:
        por_v.setdefault(p.get("veredicto") or "sin_competencia", []).append(p)
    for key, titulo in bloques.items():
        grupo = por_v.get(key) or []
        if not grupo:
            continue
        lineas.append(titulo)
        for p in grupo:
            delta = p.get("delta_pct_vs_min")
            delta_s = f" ({'+' if (delta or 0) > 0 else ''}{delta}%)" if delta is not None else ""
            lineas.append(
                f"• {p.get('titulo')} — nosotros {_cop(p.get('precio') or 0)}{delta_s}"
                f" · {p.get('unidades_periodo', 0)} uds/{analisis.get('dias')}d"
            )
            for o in (p.get("observaciones_manual") or [])[:6]:
                nick = o.get("vendedor") or "visto a ojo"
                lineas.append(
                    f"    {nick}: {_cop(o.get('precio') or 0)}"
                    + (f" {o.get('permalink')}" if o.get("permalink") else "")
                )
        lineas.append("")
    texto = "\n".join(lineas).strip()
    if len(texto) > max_chars:
        texto = texto[: max_chars - 20].rstrip() + "\n… (truncado)"
    return texto


def _jid_reporte() -> str:
    from app.utils import jid_grupo_alertas_sistemas_wa

    return (os.getenv("GRUPO_COMPETENCIA_PRECIOS_WA") or "").strip() or jid_grupo_alertas_sistemas_wa()


def enviar_reporte_whatsapp(analisis: dict) -> dict:
    from app.utils import enviar_whatsapp_reporte

    r = analisis.get("resumen") or {}
    n_caros = int(r.get("nosotros_mas_caros") or 0)
    if n_caros <= 0 and not analisis.get("consulta"):
        return {"enviado": False, "motivo": "nada_que_alertar"}
    texto = formatear_reporte_texto(analisis, max_chars=3500)
    try:
        enviar_whatsapp_reporte(texto, _jid_reporte())
        return {"enviado": True}
    except Exception as e:
        return {"enviado": False, "error": str(e)[:240]}


def ejecutar_analisis_competencia(
    top_n: int = 12,
    dias: int = 30,
    consulta: str = "",
    usar_cache: bool = False,
    enviar_whatsapp: bool = False,
    pause_s: float = 0.2,
) -> dict:
    """Corre el análisis completo y lo persiste en app/data/."""
    consulta = (consulta or "").strip()
    try:
        top_n = int(top_n)
        dias = int(dias)
    except (TypeError, ValueError):
        top_n, dias = 12, 30
    top_n = max(1, min(top_n, 25))
    dias = max(7, min(dias, 90))

    if usar_cache:
        cached = _cargar_cache()
        if cached and _cache_fresco(cached, dias, top_n, consulta):
            out = dict(cached)
            out["ok"] = True
            out["desde_cache"] = True
            return aplicar_observaciones_manuales(out)

    base = nuestros_mas_vendidos(dias=dias, top_n=top_n, consulta=consulta)
    if not base.get("ok"):
        return {"ok": False, "error": base.get("error") or "No se pudieron leer los más vendidos.", "productos": []}

    seller_id = str(base.get("seller_id") or "")
    productos: list[dict] = []
    metodos: list[str] = []
    for i, item in enumerate(base.get("items") or []):
        if i:
            time.sleep(max(0.0, float(pause_s)))
        comps, metodo = competidores_de_publicacion(item, seller_id)
        metodos.append(metodo)
        veredicto, minimo, delta = _veredicto_producto(item, comps)
        productos.append({
            **item,
            "veredicto": veredicto,
            "min_competencia": minimo,
            "delta_pct_vs_min": delta,
            "n_competidores": len(comps),
            "competidores": comps,
        })

    n_comp = sum(1 for p in productos if p["veredicto"] != "sin_competencia")
    resumen = {
        "productos": len(productos),
        "con_competencia": n_comp,
        "nosotros_mas_caros": sum(1 for p in productos if p["veredicto"] == "mas_caro"),
        "nosotros_mas_baratos": sum(1 for p in productos if p["veredicto"] == "mas_barato"),
        "similares": sum(1 for p in productos if p["veredicto"] == "similar"),
        "sin_match": sum(1 for p in productos if p["veredicto"] == "sin_competencia"),
    }
    metodo_busqueda = "mixto"
    if metodos and all(m == metodos[0] for m in metodos):
        metodo_busqueda = metodos[0]
    elif not metodos:
        metodo_busqueda = "sin_busquedas"

    analisis = {
        "ok": True,
        "version": 1,
        "generado_en": _ahora_iso(),
        "dias": dias,
        "top_n": top_n,
        "consulta": consulta,
        "seller_id": seller_id,
        "fuente_ventas": base.get("fuente_ventas"),
        "metodo_busqueda": metodo_busqueda,
        "aviso": base.get("aviso") or (
            "Comparación a ojo: abrí MeLi en el navegador y anotá precios. "
            "El servidor no visita publicaciones ajenas."
        ),
        "desde_cache": False,
        "resumen": resumen,
        "productos": productos,
    }
    try:
        _guardar_cache(analisis)
    except Exception:
        analisis["aviso_cache"] = "No se pudo persistir el JSON."

    analisis = aplicar_observaciones_manuales(analisis)
    if enviar_whatsapp:
        analisis["whatsapp"] = enviar_reporte_whatsapp(analisis)
    return analisis


def analizar_competencia_precios(
    top_n: int = 12,
    dias: int = 30,
    consulta: str = "",
    usar_cache: bool = True,
    enviar_whatsapp: bool = False,
) -> str:
    """
    Lista nuestros más vendidos en Mercado Libre (órdenes pagadas) con el
    precio publicado nuestro. No busca ni lee publicaciones de otros
    vendedores: MeLi lo prohíbe por API y no hacemos scraping.

    Args:
        top_n: cuántos más vendidos listar (1-25, default 12).
        dias: ventana de ventas (7-90, default 30).
        consulta: opcional, filtra a un producto (nombre, SKU o MCO…).
        usar_cache: si True, reusa un análisis de las últimas 6 h.
        enviar_whatsapp: reservado; no alerta competencia ajena.
    """
    if isinstance(usar_cache, str):
        usar_cache = usar_cache.strip().lower() in ("1", "true", "si", "sí", "yes")
    if isinstance(enviar_whatsapp, str):
        enviar_whatsapp = enviar_whatsapp.strip().lower() in ("1", "true", "si", "sí", "yes")
    analisis = ejecutar_analisis_competencia(
        top_n=top_n,
        dias=dias,
        consulta=consulta or "",
        usar_cache=bool(usar_cache),
        enviar_whatsapp=bool(enviar_whatsapp),
    )
    return formatear_reporte_texto(analisis)


# ── Reporte por pantallazo (el operador abre MeLi; el servidor no lo visita) ─


def decodificar_imagen_b64(raw: str) -> tuple[bytes, str]:
    s = (raw or "").strip()
    mime = "image/jpeg"
    if s.startswith("data:"):
        header, _, b64 = s.partition(",")
        hl = header.lower()
        if "image/png" in hl:
            mime = "image/png"
        elif "image/webp" in hl:
            mime = "image/webp"
        elif "image/gif" in hl:
            mime = "image/gif"
        s = b64
    if not s:
        return b"", mime
    pad = (-len(s)) % 4
    if pad:
        s += "=" * pad
    try:
        data = base64.b64decode(s, validate=False)
    except Exception:
        return b"", mime
    return data, mime


def comprimir_imagen_captura(data: bytes, mime: str = "") -> tuple[bytes, str]:
    if not data:
        raise ValueError("Imagen vacía.")
    if len(data) > _MAX_IMAGEN_CAPTURA:
        raise ValueError("La imagen pesa demasiado (máx. 5 MB).")
    try:
        from PIL import Image

        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB")
        w, h = im.size
        # Más chico = Gemini más rápido (Cloudflare corta ~100s si el POST espera).
        max_w = 1200
        if w > max_w and w > 0:
            nh = max(1, int(h * max_w / w))
            im = im.resize((max_w, nh), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=65, optimize=True)
        out = buf.getvalue()
        if len(out) > 900_000:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=50, optimize=True)
            out = buf.getvalue()
        return out, "image/jpeg"
    except ValueError:
        raise
    except Exception:
        if data[:3] == b"\xff\xd8\xff":
            return data, "image/jpeg"
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return data, "image/png"
        raise ValueError("No pude leer la imagen. Probá JPEG o PNG.")


def _cargar_reportes_captura() -> list[dict]:
    if not _REPORTES_PATH.exists():
        return []
    try:
        data = json.loads(_REPORTES_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = data.get("reportes") if isinstance(data, dict) else data
    return [r for r in (rows or []) if isinstance(r, dict)]


def _guardar_reportes_captura(rows: list[dict]) -> None:
    _REPORTES_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _REPORTES_PATH.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps({"version": 1, "reportes": rows[-40:]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp, _REPORTES_PATH)


def _indice_ultimo_reporte_captura() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in _cargar_reportes_captura():
        mid = str(row.get("item_id") or "").upper()
        if mid:
            out[mid] = row
    return out


def _parsear_json_modelo(texto: str) -> dict:
    raw = (texto or "").strip()
    if not raw:
        return {}
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}


def _normalizar_listado_vision(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    titulo = str(raw.get("titulo") or raw.get("title") or "").strip()[:180]
    precio = parsear_precio_cop(raw.get("precio") if "precio" in raw else raw.get("price"))
    if not titulo or not precio:
        return None
    vendidos = raw.get("vendidos")
    try:
        vendidos_n = int(vendidos) if vendidos not in (None, "") else None
    except (TypeError, ValueError):
        vendidos_n = None
    pres = _presentacion_desde_vision(raw if isinstance(raw, dict) else None, titulo)
    return {
        "titulo": titulo,
        "precio": precio,
        "vendedor": str(raw.get("vendedor") or raw.get("seller") or "").strip()[:80],
        "permalink": permalink_meli_seguro(str(raw.get("permalink") or raw.get("url") or "")),
        "vendidos": vendidos_n,
        "envio_gratis": bool(raw.get("envio_gratis") or raw.get("free_shipping")),
        "parece_nuestra": bool(raw.get("parece_nuestra") or raw.get("is_ours")),
        "presentacion": pres,
        **enriquecer_fila_comparacion(titulo, precio, raw),
    }


def filtrar_listados_comparables(
    nuestro_titulo: str,
    nuestro_item_id: str,
    nuestro_precio: float,
    listados: list[dict],
) -> list[dict]:
    ours = str(nuestro_item_id or "").upper()
    pres_n = presentacion_efectiva(nuestro_item_id, nuestro_titulo)
    instrumento = bool((pres_n or {}).get("instrumento_pesaje")) or _es_instrumento_pesaje(
        nuestro_titulo
    )
    out: list[dict] = []
    vistos: set[str] = set()
    for raw in listados or []:
        row = _normalizar_listado_vision(raw)
        if not row:
            continue
        perm = (row.get("permalink") or "").upper()
        if ours and ours in perm:
            continue
        if row.get("parece_nuestra"):
            continue
        nick = _norm(row.get("vendedor") or "")
        if "mckenna" in nick:
            continue
        ok, score = titulos_relacionados(nuestro_titulo, row.get("titulo") or "")
        if not ok:
            continue
        pres_c = row.get("presentacion") or extraer_presentacion(row.get("titulo") or "")
        # Grameras: no filtrar por "misma unidad de contenido" (capacidad ≠ empaque).
        if pres_n and not instrumento and not misma_unidad_medida(pres_n, pres_c):
            continue
        if abs(float(row["precio"]) - float(nuestro_precio or 0)) < 1 and score >= 0.85:
            continue
        key = f"{row['precio']:.0f}|{_norm(row.get('titulo') or '')[:40]}"
        if key in vistos:
            continue
        vistos.add(key)
        d_pct = None
        unit_n = precio_por_unidad(float(nuestro_precio or 0), pres_n)
        unit_c = precio_por_unidad(float(row["precio"]), pres_c)
        if instrumento:
            unit_n = None
            unit_c = None
        if unit_n and unit_c:
            d_pct = delta_pct(unit_n, unit_c)
        else:
            d_pct = delta_pct(float(nuestro_precio or 0), float(row["precio"]))
        out.append({
            **row,
            "relacion_titulo": score,
            "delta_pct": d_pct,
            "precio_por_100": None if instrumento else precio_por_100(float(row["precio"]), pres_c),
            "precio_por_unidad": unit_c,
            "misma_presentacion": bool(pres_n and misma_presentacion(pres_n, pres_c)),
            "comparable": True,
        })
    out.sort(key=lambda c: (
        float(c.get("precio_por_unidad") or 1e18),
        float(c.get("precio") or 0),
    ))
    return out[:12]


def armar_reporte_captura(
    *,
    item_id: str,
    titulo: str,
    precio: float,
    listados_visibles: list[dict],
) -> dict:
    comps = filtrar_listados_comparables(titulo, item_id, precio, listados_visibles)
    pres_n = presentacion_efectiva(item_id, titulo)
    pres_txt = presentacion_casilla(pres_n)
    instrumento = bool((pres_n or {}).get("instrumento_pesaje")) or _es_instrumento_pesaje(titulo)
    prec = str((pres_n or {}).get("precision") or extraer_precision_medicion(titulo) or "").strip()
    sufijo = etiqueta_unidad(pres_n)
    unit_n = None if instrumento else precio_por_unidad(float(precio or 0), pres_n)
    units = (
        []
        if instrumento
        else [float(c["precio_por_unidad"]) for c in comps if c.get("precio_por_unidad")]
    )
    min_unit = min(units) if units else None
    if comps:
        cheapest = min(
            comps,
            key=lambda c: (
                float(c.get("precio_por_unidad") or 1e18),
                float(c.get("precio") or 0),
            ),
        )
        minimo_total = float(cheapest.get("precio") or 0) or None
    else:
        minimo_total = None
    if unit_n and min_unit:
        veredicto = clasificar_vs_min(float(unit_n), min_unit)
        delta = delta_pct(float(unit_n), min_unit)
        ref_txt = f"{_cop(unit_n)} {sufijo}".strip()
        min_txt = f"{_cop(min_unit)} {sufijo}".strip()
    else:
        precios = [float(c["precio"]) for c in comps if c.get("precio")]
        minimo_total = min(precios) if precios else minimo_total
        veredicto = clasificar_vs_min(float(precio or 0), minimo_total)
        delta = delta_pct(float(precio or 0), minimo_total) if minimo_total else None
        ref_txt = _cop(precio)
        min_txt = _cop(minimo_total) if minimo_total else "—"
    unidad_nota = ""
    if instrumento:
        unidad_nota = " (instrumentos de pesaje)"
    elif (pres_n or {}).get("canonica") == "g":
        unidad_nota = " (gramos; se pueden comparar 250 g vs 500 g)"
    elif (pres_n or {}).get("canonica") == "ml":
        unidad_nota = " (ml; se pueden comparar 100 ml vs 250 ml)"
    if not comps:
        resumen = (
            "Vi el pantallazo pero no encontré publicaciones comparables "
            f"(mismo producto y misma unidad{unidad_nota}). "
            "No mezcles g con ml. Si no hay tarjetas, anotá un precio a mano."
        )
    elif instrumento and veredicto == "mas_caro" and prec:
        resumen = (
            f"Hay {len(comps)} gramera(s)/balanza(s) en el listado. "
            f"Nuestro precio {ref_txt} vs más barato {min_txt}"
            f"{f' ({delta:+.1f}%)' if delta is not None else ''}. "
            f"La nuestra mide con precisión {prec} (miligramos); "
            "eso suele explicar un precio más alto frente a grameras de cocina "
            "o de menor resolución. Compará por calidad de medición, no solo por precio."
        )
    elif instrumento and veredicto == "mas_caro":
        resumen = (
            f"Hay {len(comps)} instrumento(s) de pesaje. "
            f"Estamos {delta:+.1f}% vs el más barato ({min_txt}). Nosotros {ref_txt}. "
            "Compará por precisión y capacidad, no solo por precio."
        )
    elif instrumento and veredicto == "mas_barato":
        resumen = (
            f"Hay {len(comps)} instrumento(s) de pesaje. "
            f"Estamos por debajo del mínimo ({min_txt}). Nosotros {ref_txt}."
        )
    elif instrumento:
        resumen = (
            f"Hay {len(comps)} instrumento(s) de pesaje. "
            f"Andamos parecidos al mínimo ({min_txt}). Nosotros {ref_txt}."
        )
    elif veredicto == "mas_caro":
        resumen = (
            f"Hay {len(comps)} comparable(s) por unidad de medida. "
            f"Estamos {delta:+.1f}% vs el más barato ({min_txt}). Nosotros {ref_txt}. "
            "Conviene revisar precio."
        )
    elif veredicto == "mas_barato":
        resumen = (
            f"Hay {len(comps)} comparable(s) por unidad. Estamos por debajo del mínimo "
            f"({min_txt}). Nosotros {ref_txt}."
        )
    else:
        resumen = (
            f"Hay {len(comps)} comparable(s) por unidad. Andamos parecidos al mínimo "
            f"({min_txt}). Nosotros {ref_txt}."
        )
    nuestra = {
        **enriquecer_fila_comparacion(titulo, float(precio or 0)),
        "es_nuestra": True,
        "vendedor": "Nosotros",
    }
    if pres_n:
        nuestra["cantidad"] = presentacion_casilla(pres_n)
        nuestra["precio_por_unidad"] = precio_por_unidad(float(precio or 0), pres_n)
        nuestra["precio_por_100"] = precio_por_100(float(precio or 0), pres_n)
        nuestra["unidad_canonica"] = (pres_n or {}).get("canonica")
    tabla = [nuestra]
    for c in comps:
        tabla.append({
            **c,
            "es_nuestra": False,
            "nombre": c.get("nombre") or c.get("titulo") or "",
            "cantidad": c.get("cantidad") or enriquecer_fila_comparacion(
                str(c.get("titulo") or ""), float(c.get("precio") or 0), c,
            )["cantidad"],
            "valor_total": c.get("valor_total") if c.get("valor_total") is not None else c.get("precio"),
        })
    return {
        "item_id": str(item_id or "").upper(),
        "generado_en": _ahora_iso(),
        "nuestro_titulo": titulo,
        "nuestro_precio": float(precio or 0),
        "nuestra_cantidad": nuestra["cantidad"],
        "presentacion_requerida": pres_txt if pres_txt != "—" else None,
        "n_vistos": len(listados_visibles or []),
        "n_comparables": len(comps),
        "min_precio": minimo_total,
        "min_precio_por_100": round(min_unit * 100.0, 2) if min_unit else None,
        "min_precio_por_unidad": min_unit,
        "unidad_comparacion": None if instrumento else (sufijo.strip() or None),
        "veredicto": veredicto,
        "delta_pct_vs_min": delta,
        "resumen": resumen,
        "listados": comps,
        "tabla": tabla,
        "fuente": "captura_vision",
        "instrumento_pesaje": instrumento,
        "precision_medicion": prec or None,
    }


def _invocar_vision_captura(
    imagen: bytes,
    mime: str,
    titulo: str,
    precio: float,
    item_id: str = "",
) -> list[dict]:
    """Lee el pantallazo con Gemini. Mockeable en tests. No llama a MeLi."""
    api_key = (os.getenv("GOOGLE_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Falta GOOGLE_API_KEY para leer el pantallazo.")

    from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_gemini

    modelo = _MODELO_VISION_CAPTURA
    ok, motivo = permitir_llamada(modelo, contexto="competencia_captura")
    if not ok:
        raise RuntimeError(motivo or "Presupuesto LLM agotado.")

    from google import genai
    from google.genai import types

    pres_txt = presentacion_casilla(presentacion_efectiva(item_id, titulo))
    prompt = (
        "Sos un extractor de listados de Mercado Libre Colombia. "
        "La imagen es un pantallazo del RESULTADO DE BÚSQUEDA (tarjetas). "
        "Solo extraé lo visible; no inventes.\n\n"
        f"Nuestra publicación de referencia:\n- título: {titulo}\n- precio nuestro: {precio}\n"
        f"- presentación nuestra: {pres_txt}\n\n"
        'Devolvé SOLO JSON válido: {"listados":[{"titulo":"","precio":24900,'
        '"cantidad":250,"unidad":"g","vendedor":"","permalink":"","vendidos":null,'
        '"envio_gratis":false,"parece_nuestra":false}]}\n\n'
        "Reglas: precio = valor TOTAL de la publicación en COP (sin puntos de miles); "
        "cantidad y unidad (g o ml) = empaque/contenido si es materia prima; "
        "si es gramera/balanza, cantidad = capacidad (p. ej. Hasta 50 g), "
        "NUNCA uses 0.001 g u otra precisión como cantidad; "
        "solo incluí tarjetas del MISMO producto y la MISMA unidad (g con g, ml con ml). "
        "SÍ incluí otros tamaños (250 g y 500 g). NO mezcles gramos con mililitros; "
        "parece_nuestra=true si es McKenna o el mismo título/precio de referencia; "
        "permalink solo si se lee mercadolibre.com.co; máximo 15 tarjetas visibles."
    )
    try:
        client = genai.Client(
            api_key=api_key,
            http_options={"timeout": 180_000},
        )
    except TypeError:
        client = genai.Client(api_key=api_key)
    resp = client.models.generate_content(
        model=modelo,
        contents=[
            types.Part.from_bytes(data=imagen, mime_type=mime or "image/jpeg"),
            prompt,
        ],
    )
    try:
        tin, tout = usage_gemini(resp)
        registrar_llamada(modelo, tin, tout, contexto="competencia_captura")
    except Exception:
        pass
    payload = _parsear_json_modelo(getattr(resp, "text", "") or "")
    rows = payload.get("listados") or payload.get("listings") or []
    if not isinstance(rows, list):
        return []
    out = []
    for r in rows:
        n = _normalizar_listado_vision(r)
        if n:
            out.append(n)
    return out


def _reemplazar_observaciones_captura(item_id: str, comps: list[dict]) -> None:
    mid = str(item_id or "").upper()
    rows = [
        r for r in _cargar_observaciones()
        if not (
            str(r.get("item_id") or "").upper() == mid
            and str(r.get("fuente") or "") == "captura_vision"
        )
    ]
    for c in comps[:8]:
        monto = parsear_precio_cop(c.get("precio"))
        if not monto:
            continue
        rows.append({
            "id": uuid.uuid4().hex[:12],
            "item_id": mid,
            "precio": monto,
            "vendedor": str(c.get("vendedor") or "").strip()[:80],
            "titulo": str(c.get("titulo") or "").strip()[:180],
            "permalink": permalink_meli_seguro(str(c.get("permalink") or "")),
            "notas": "Leído del pantallazo del listado MeLi",
            "visto_en": _ahora_iso(),
            "fuente": "captura_vision",
        })
    _guardar_observaciones(rows)


def _fmt_fecha_evidencia(iso: str | None) -> str:
    raw = (iso or _ahora_iso()).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return raw.replace("T", " ")[:16]
    return dt.strftime("%d/%m/%Y %H:%M")


def _evidencia_filename(item_id: str, generado_en: str | None) -> str:
    mid = re.sub(r"[^\w-]", "", str(item_id or "item").upper())[:24]
    ts = (generado_en or _ahora_iso()).replace(":", "").replace("-", "")
    ts = re.sub(r"[^\dT]", "", ts)[:15] or datetime.now().strftime("%Y%m%dT%H%M%S")
    return f"{mid}_{ts}.png"


def _pil_font(size: int, bold: bool = False):
    from PIL import ImageFont

    paths = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    )
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _pil_fit_text(draw, text: str, font, max_w: int) -> str:
    text = (text or "").strip() or "—"
    if draw.textbbox((0, 0), text, font=font)[2] <= max_w:
        return text
    ell = "…"
    lo, hi = 0, len(text)
    best = ell
    while lo <= hi:
        mid = (lo + hi) // 2
        cand = text[:mid].rstrip() + ell
        if draw.textbbox((0, 0), cand, font=font)[2] <= max_w:
            best = cand
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def render_evidencia_tabla_competencia(reporte: dict, *, sku: str = "") -> str:
    """
    Dibuja la tabla comparativa como PNG (evidencia de revisión humana).
    Retorna el nombre de archivo (sin ruta) guardado en app/data/competencia_evidencias/.
    """
    from PIL import Image, ImageDraw

    tabla = reporte.get("tabla") or []
    if not tabla:
        nuestra = {
            **enriquecer_fila_comparacion(
                str(reporte.get("nuestro_titulo") or ""),
                float(reporte.get("nuestro_precio") or 0),
            ),
            "es_nuestra": True,
            "vendedor": "Nosotros",
        }
        tabla = [nuestra]
        for c in reporte.get("listados") or []:
            tabla.append({
                **c,
                "es_nuestra": False,
                "nombre": c.get("nombre") or c.get("titulo") or "",
                "cantidad": c.get("cantidad") or presentacion_casilla(
                    extraer_presentacion(str(c.get("titulo") or "")),
                ),
                "valor_total": c.get("valor_total") if c.get("valor_total") is not None else c.get("precio"),
            })

    # Paleta clara (evidencia imprimible / WhatsApp)
    _BG = (255, 252, 254)
    _PANEL = (253, 242, 248)
    _PANEL2 = (250, 245, 255)
    _BORDER = (236, 72, 153, 80)
    _TEXT = (30, 27, 38)
    _MUTED = (100, 116, 139)
    _ACCENT = (225, 29, 122)
    _ROW_OURS = (252, 231, 243)

    W = 1080
    PAD = 16
    header_h = 72
    meta_h = 52
    resumen_h = 44
    row_h = 44
    table_head_h = 24
    n_rows = max(1, len(tabla))
    table_h = table_head_h + n_rows * row_h + 8
    footer_h = 28
    H = PAD + header_h + meta_h + resumen_h + table_h + footer_h + PAD

    img = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(img)
    f_brand = _pil_font(11, False)
    f_title = _pil_font(18, True)
    f_sub = _pil_font(11, False)
    f_sec = _pil_font(12, True)
    f_th = _pil_font(10, True)
    f_row = _pil_font(11, False)
    f_row_b = _pil_font(11, True)
    f_small = _pil_font(9, False)

    y = PAD
    draw.rounded_rectangle((PAD, y, W - PAD, y + header_h), radius=8, fill=_PANEL)
    logo_x = PAD + 12
    if _LOGO_EVIDENCIA.is_file():
        try:
            logo = Image.open(_LOGO_EVIDENCIA).convert("RGBA")
            lh = 44
            lw = max(1, int(logo.width * lh / max(logo.height, 1)))
            logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
            img.paste(logo, (logo_x, y + 14), logo)
            logo_x += lw + 12
        except Exception:
            pass
    draw.text((logo_x, y + 10), "McKenna Group", font=f_brand, fill=_ACCENT)
    draw.text((logo_x, y + 26), "Análisis competencia MeLi", font=f_title, fill=_TEXT)
    fecha = _fmt_fecha_evidencia(reporte.get("generado_en"))
    draw.text((logo_x, y + 50), f"Fecha de análisis: {fecha}", font=f_sub, fill=_MUTED)
    badge = "Evidencia · revisión humana"
    bb = draw.textbbox((0, 0), badge, font=f_small)
    bw = bb[2] - bb[0] + 16
    bx = W - PAD - 12 - bw
    draw.rounded_rectangle((bx, y + 22, bx + bw, y + 44), radius=6, fill=_ACCENT)
    draw.text((bx + 8, y + 28), badge, font=f_small, fill=(255, 255, 255))

    y += header_h + 8
    titulo = str(reporte.get("nuestro_titulo") or "Publicación")[:120]
    item_id = str(reporte.get("item_id") or "").upper()
    meta_line = item_id
    pres_req = reporte.get("presentacion_requerida") or reporte.get("nuestra_cantidad")
    if pres_req and pres_req != "—":
        unidad_cmp = reporte.get("unidad_comparacion") or etiqueta_unidad(
            extraer_presentacion(str(reporte.get("nuestro_titulo") or "")),
        )
        meta_line = (
            f"{meta_line} · por unidad {unidad_cmp or pres_req}"
            if meta_line else f"Por unidad {unidad_cmp or pres_req}"
        )
    if sku:
        meta_line = f"{meta_line} · SKU {sku}" if meta_line else f"SKU {sku}"
    draw.rounded_rectangle((PAD, y, W - PAD, y + meta_h), radius=6, fill=_PANEL2)
    draw.text((PAD + 12, y + 8), _pil_fit_text(draw, titulo, f_sec, W - 2 * PAD - 24), font=f_sec, fill=_TEXT)
    draw.text((PAD + 12, y + 28), meta_line, font=f_sub, fill=_MUTED)
    y += meta_h + 8

    resumen = str(reporte.get("resumen") or "").strip()
    if resumen:
        draw.rounded_rectangle((PAD, y, W - PAD, y + resumen_h), radius=6, fill=_PANEL)
        draw.text(
            (PAD + 12, y + 8),
            _pil_fit_text(draw, resumen, f_sub, W - 2 * PAD - 24),
            font=f_sub,
            fill=_TEXT,
        )
        comps = reporte.get("n_comparables")
        min_u = reporte.get("min_precio_por_unidad")
        if min_u is None and reporte.get("min_precio_por_100"):
            min_u = float(reporte["min_precio_por_100"]) / 100.0
        extra = []
        if comps is not None:
            extra.append(f"{comps} comparable(s)")
        if min_u is not None:
            extra.append(f"mínimo {_cop(float(min_u))} {reporte.get('unidad_comparacion') or ''}".strip())
        elif reporte.get("min_precio") is not None:
            extra.append(f"mínimo {_cop(float(reporte['min_precio']))}")
        if extra:
            draw.text((PAD + 12, y + 26), " · ".join(extra), font=f_small, fill=_MUTED)
        y += resumen_h + 8

    sufijo = str(reporte.get("unidad_comparacion") or "").strip()
    if not sufijo or "100" in sufijo:
        sufijo = etiqueta_unidad(extraer_presentacion(str(reporte.get("nuestro_titulo") or ""))) or "/ g"
    _GREEN = (5, 150, 105)
    _BAR_BG = (241, 245, 249)
    _BAR_OTHER = (196, 181, 253)

    def _pu_de(fila: dict) -> Optional[float]:
        pu = fila.get("precio_por_unidad")
        if pu:
            try:
                n = float(pu)
                return n if n > 0 else None
            except (TypeError, ValueError):
                pass
        total = fila.get("valor_total")
        if total is None:
            total = fila.get("precio")
        txt = f"{fila.get('nombre') or fila.get('titulo') or ''} {fila.get('cantidad') or ''}"
        derivado = precio_por_unidad(float(total or 0), extraer_presentacion(str(txt)))
        if derivado:
            return derivado
        p100 = fila.get("precio_por_100")
        if p100:
            try:
                n = float(p100) / 100.0
                return n if n > 0 else None
            except (TypeError, ValueError):
                return None
        return None

    filas_bar = list(tabla)
    pus = [p for p in (_pu_de(f) for f in filas_bar) if p]
    max_pu = max(pus) if pus else 1.0
    min_pu = min(pus) if pus else None
    filas_bar.sort(key=lambda f: (_pu_de(f) is None, _pu_de(f) or 1e18))

    col_nombre = PAD + 12
    col_bar = PAD + 300
    col_unit = W - PAD - 16
    name_w = col_bar - col_nombre - 12
    bar_w = col_unit - col_bar - 150

    draw.rounded_rectangle((PAD, y, W - PAD, y + table_h), radius=8, fill=(255, 255, 255))
    draw.line((PAD + 8, y + table_head_h, W - PAD - 8, y + table_head_h), fill=(244, 114, 182), width=1)
    ty = y + 5
    draw.text((col_nombre, ty), "PUBLICACIÓN", font=f_th, fill=_MUTED)
    draw.text((col_bar, ty), f"PRECIO {sufijo}  (barra más larga = más caro)", font=f_th, fill=_MUTED)
    ty = y + table_head_h + 4

    for idx, fila in enumerate(filas_bar):
        es_nuestra = bool(fila.get("es_nuestra"))
        nombre = str(fila.get("nombre") or fila.get("titulo") or "—")
        if es_nuestra:
            nombre = "★ Nosotros"
        cant = str(fila.get("cantidad") or presentacion_casilla(
            extraer_presentacion(str(fila.get("nombre") or fila.get("titulo") or "")),
        ) or "—")
        total = fila.get("valor_total")
        if total is None:
            total = fila.get("precio")
        total_s = _cop(float(total or 0)) if total is not None else "—"
        pu = _pu_de(fila)
        pu_s = f"{_cop(pu)} {sufijo}".strip() if pu else "—"
        bg = _ROW_OURS if es_nuestra else (_PANEL if idx % 2 == 0 else _BG)
        draw.rounded_rectangle((PAD + 6, ty, W - PAD - 6, ty + row_h - 2), radius=4, fill=bg)
        if es_nuestra:
            draw.rectangle((PAD + 6, ty + 4, PAD + 9, ty + row_h - 6), fill=_ACCENT)
        font_n = f_row_b if es_nuestra else f_row
        draw.text((col_nombre + 6, ty + 6), _pil_fit_text(draw, nombre, font_n, name_w), font=font_n, fill=_TEXT)
        draw.text((col_nombre + 6, ty + 22), f"{cant}  ·  total {total_s}", font=f_small, fill=_MUTED)
        bx0, by0 = col_bar, ty + 14
        bx1, by1 = col_bar + max(8, bar_w), ty + 28
        draw.rounded_rectangle((bx0, by0, bx1, by1), radius=4, fill=_BAR_BG)
        if pu and max_pu:
            fill_w = max(8, int(bar_w * (pu / max_pu)))
            es_min = min_pu is not None and abs(pu - min_pu) < 0.05
            fill = _ACCENT if es_nuestra else (_GREEN if es_min else _BAR_OTHER)
            draw.rounded_rectangle((bx0, by0, bx0 + fill_w, by1), radius=4, fill=fill)
        unit_bb = draw.textbbox((0, 0), pu_s, font=f_row_b)
        draw.text((col_unit - (unit_bb[2] - unit_bb[0]), ty + 14), pu_s, font=f_row_b, fill=_TEXT)
        ty += row_h

    fy = H - footer_h
    draw.text(
        (PAD, fy),
        "Generado desde pantallazo MeLi · comparación por unidad de medida · McKenna Group",
        font=f_small,
        fill=_MUTED,
    )
    draw.text((W - PAD - 220, fy), fecha, font=f_small, fill=_MUTED)

    _asegurar_dir_evidencias()
    fname = _evidencia_filename(str(reporte.get("item_id") or ""), reporte.get("generado_en"))
    path = _EVIDENCIAS_DIR / fname
    img.save(path, format="PNG", optimize=True)
    return fname


def _asegurar_dir_evidencias() -> None:
    """Crea el directorio de PNGs y comprueba que el proceso pueda escribir."""
    _EVIDENCIAS_DIR.mkdir(parents=True, exist_ok=True)
    probe = _EVIDENCIAS_DIR / f".write_probe_{os.getpid()}"
    try:
        probe.write_bytes(b"ok")
        probe.unlink(missing_ok=True)
    except OSError as e:
        raise RuntimeError(
            f"Sin permiso de escritura en {_EVIDENCIAS_DIR} "
            f"(el usuario del servicio Flask debe poder crear archivos ahí): {e}"
        ) from e


def ruta_evidencia_competencia(item_id: str, *, regenerar_si_falta: bool = True) -> Path | None:
    """Ruta absoluta al PNG de evidencia del último reporte de captura del ítem."""
    mid = str(item_id or "").strip().upper()
    if not mid:
        return None
    reporte = _indice_ultimo_reporte_captura().get(mid)
    if not reporte:
        return None
    fname = str(reporte.get("evidencia_png") or "").strip()
    if fname:
        p = _EVIDENCIAS_DIR / Path(fname).name
        if p.is_file():
            return p
    if not regenerar_si_falta:
        return None
    if not (reporte.get("tabla") or reporte.get("listados")):
        return None
    sku = ""
    cache = _cargar_cache() or {}
    for prod in cache.get("productos") or []:
        if str(prod.get("item_id") or "").upper() == mid:
            sku = str(prod.get("sku") or "").strip()
            break
    try:
        fname = render_evidencia_tabla_competencia(reporte, sku=sku)
    except Exception as e:
        print(f"[competencia] no se pudo regenerar evidencia {mid}: {e}")
        return None
    reporte["evidencia_png"] = fname
    try:
        hist = _cargar_reportes_captura()
        for i, row in enumerate(hist):
            if str(row.get("item_id") or "").upper() == mid:
                hist[i] = {**row, "evidencia_png": fname}
                break
        _guardar_reportes_captura(hist)
    except Exception as e:
        print(f"[competencia] evidencia {mid} generada pero no se pudo actualizar JSON: {e}")
    p = _EVIDENCIAS_DIR / fname
    return p if p.is_file() else None


def generar_reporte_competencia_captura(
    item_id: str,
    imagen: bytes,
    mime: str = "image/jpeg",
    titulo: str = "",
    precio=None,
) -> dict:
    """
    Arma el reporte de competencia a partir de un pantallazo que tomó el operador.
    El servidor NO visita Mercado Libre.
    """
    mid = str(item_id or "").strip().upper()
    if not mid.startswith("MCO"):
        return {"ok": False, "error": "item_id MeLi requerido (MCO…)."}
    if not imagen:
        return {"ok": False, "error": "Falta la imagen del listado."}

    cache = _cargar_cache() or {}
    prod = None
    for p in cache.get("productos") or []:
        if str(p.get("item_id") or "").upper() == mid:
            prod = p
            break
    titulo_n = (titulo or (prod or {}).get("titulo") or "").strip()
    precio_n = parsear_precio_cop(precio)
    if precio_n is None:
        precio_n = parsear_precio_cop((prod or {}).get("precio")) or 0

    try:
        jpeg, mime_out = comprimir_imagen_captura(imagen, mime)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    try:
        listados = _invocar_vision_captura(
            jpeg, mime_out, titulo_n, float(precio_n or 0), item_id=mid,
        )
    except RuntimeError as e:
        return {"ok": False, "error": str(e)[:400]}
    except Exception as e:
        return {"ok": False, "error": f"No pude leer el pantallazo: {str(e)[:240]}"}

    reporte = armar_reporte_captura(
        item_id=mid,
        titulo=titulo_n,
        precio=float(precio_n or 0),
        listados_visibles=listados,
    )
    sku_n = str((prod or {}).get("sku") or "").strip()
    try:
        reporte["evidencia_png"] = render_evidencia_tabla_competencia(reporte, sku=sku_n)
    except Exception as e:
        print(f"[competencia] evidencia al generar captura {mid}: {e}")
        reporte["evidencia_png"] = None
    _reemplazar_observaciones_captura(mid, reporte.get("listados") or [])
    hist = [r for r in _cargar_reportes_captura() if str(r.get("item_id") or "").upper() != mid]
    hist.append(reporte)
    _guardar_reportes_captura(hist)
    analisis = obtener_ultimo_analisis_competencia()
    return {"ok": True, "reporte": reporte, **analisis}
