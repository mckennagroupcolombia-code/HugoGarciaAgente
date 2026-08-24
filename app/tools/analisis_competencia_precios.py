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


def extraer_presentacion(titulo: str) -> Optional[dict]:
    """
    Primera presentación del título.
    Unidad canónica: g (masa) o ml (volumen). kg→g, L→ml.
    """
    m = _RX_PRESENTACION.search(titulo or "")
    if not m:
        return None
    raw = float(m.group(1).replace(",", "."))
    unidad = m.group(2).lower()
    if unidad in ("kg", "kilo", "kilos"):
        return {"valor": raw, "unidad_raw": unidad, "canonica": "g", "cantidad": int(round(raw * 1000))}
    if unidad in ("g", "gr", "grs", "gramo", "gramos"):
        return {"valor": raw, "unidad_raw": unidad, "canonica": "g", "cantidad": int(round(raw))}
    if unidad in ("l", "lt", "lts", "litro", "litros"):
        return {"valor": raw, "unidad_raw": unidad, "canonica": "ml", "cantidad": int(round(raw * 1000))}
    # ml, mls, cc
    return {"valor": raw, "unidad_raw": unidad, "canonica": "ml", "cantidad": int(round(raw))}


def presentacion_texto(pres: Optional[dict]) -> str:
    if not pres:
        return ""
    cant = pres["cantidad"]
    if pres["canonica"] == "g":
        if cant >= 1000 and cant % 1000 == 0:
            return f"{cant // 1000}kg"
        return f"{cant}g"
    if cant >= 1000 and cant % 1000 == 0:
        return f"{cant // 1000}l"
    return f"{cant}ml"


def query_busqueda(titulo: str) -> str:
    toks = tokens_significativos(titulo)[:4]
    pres = presentacion_texto(extraer_presentacion(titulo))
    partes = toks + ([pres] if pres else [])
    return " ".join(partes).strip() or (titulo or "")[:80]


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


def precio_por_100(precio: float, pres: Optional[dict]) -> Optional[float]:
    if not pres or not precio or pres["cantidad"] <= 0:
        return None
    return round(float(precio) * 100.0 / pres["cantidad"], 2)


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
        p["url_busqueda_meli"] = url_busqueda_meli_navegador(p.get("query") or p.get("titulo") or "")
        obs = list(por_item.get(mid) or [])
        p["observaciones_manual"] = obs
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
            "query": query_busqueda(titulo),
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
    unit_n = nuestro.get("precio_por_100")
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
        misma = bool(
            pres_n and pres_c
            and pres_n.get("canonica") == pres_c.get("canonica")
            and abs(int(pres_n["cantidad"]) - int(pres_c["cantidad"])) <= max(1, int(pres_n["cantidad"]) * 0.05)
        )
        unit_c = precio_por_100(precio_c, pres_c)
        # Comparar por unidad cuando hay presentación comparable; si no, precio de lista
        base_n = unit_n if (misma and unit_n and unit_c) else precio_n
        base_c = unit_c if (misma and unit_n and unit_c) else precio_c
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
            "precio_por_100": unit_c,
            "relacion_titulo": score,
            "delta_pct": delta_pct(base_n, base_c) if base_n and base_c else None,
        })
    out.sort(key=lambda c: (0 if c["misma_presentacion"] else 1, c.get("precio") or 0))
    return out[:15], metodo


def _veredicto_producto(nuestro: dict, comps: list[dict]) -> tuple[str, Optional[float], Optional[float]]:
    misma = [c for c in comps if c.get("misma_presentacion")]
    pool = misma or comps
    if not pool:
        return "sin_competencia", None, None
    # Precio comparable: unidad si todos tienen; si no, lista de misma presentación
    precios: list[float] = []
    for c in pool:
        if c.get("misma_presentacion") and nuestro.get("precio_por_100") and c.get("precio_por_100"):
            precios.append(float(c["precio_por_100"]))
        else:
            precios.append(float(c.get("precio") or 0))
    precios = [p for p in precios if p > 0]
    if not precios:
        return "sin_competencia", None, None
    minimo = min(precios)
    ref = float(nuestro.get("precio_por_100") or 0) if (
        misma and nuestro.get("precio_por_100")
    ) else float(nuestro.get("precio") or 0)
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
        max_w = 1400
        if w > max_w and w > 0:
            nh = max(1, int(h * max_w / w))
            im = im.resize((max_w, nh), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=72, optimize=True)
        out = buf.getvalue()
        if len(out) > 1_200_000:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=55, optimize=True)
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
    return {
        "titulo": titulo,
        "precio": precio,
        "vendedor": str(raw.get("vendedor") or raw.get("seller") or "").strip()[:80],
        "permalink": permalink_meli_seguro(str(raw.get("permalink") or raw.get("url") or "")),
        "vendidos": vendidos_n,
        "envio_gratis": bool(raw.get("envio_gratis") or raw.get("free_shipping")),
        "parece_nuestra": bool(raw.get("parece_nuestra") or raw.get("is_ours")),
    }


def filtrar_listados_comparables(
    nuestro_titulo: str,
    nuestro_item_id: str,
    nuestro_precio: float,
    listados: list[dict],
) -> list[dict]:
    ours = str(nuestro_item_id or "").upper()
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
        if abs(float(row["precio"]) - float(nuestro_precio or 0)) < 1 and score >= 0.85:
            continue
        key = f"{row['precio']:.0f}|{_norm(row.get('titulo') or '')[:40]}"
        if key in vistos:
            continue
        vistos.add(key)
        d_pct = delta_pct(float(nuestro_precio or 0), float(row["precio"]))
        out.append({
            **row,
            "relacion_titulo": score,
            "delta_pct": d_pct,
            "comparable": True,
        })
    out.sort(key=lambda c: float(c.get("precio") or 0))
    return out[:12]


def armar_reporte_captura(
    *,
    item_id: str,
    titulo: str,
    precio: float,
    listados_visibles: list[dict],
) -> dict:
    comps = filtrar_listados_comparables(titulo, item_id, precio, listados_visibles)
    precios = [float(c["precio"]) for c in comps if c.get("precio")]
    minimo = min(precios) if precios else None
    veredicto = clasificar_vs_min(float(precio or 0), minimo)
    delta = delta_pct(float(precio or 0), minimo) if minimo else None
    if not comps:
        resumen = (
            "Vi el pantallazo pero no encontré publicaciones comparables "
            "(mismo producto / presentación). Probá bajar un poco para que "
            "se vean más tarjetas, o anotá un precio a mano."
        )
    elif veredicto == "mas_caro":
        resumen = (
            f"Hay {len(comps)} publicación(es) comparable(s). La más barata está "
            f"en {_cop(minimo)} ({delta:+.1f}% vs nosotros {_cop(precio)}). Conviene revisar precio."
        )
    elif veredicto == "mas_barato":
        resumen = (
            f"Hay {len(comps)} comparable(s). Estamos por debajo del mínimo "
            f"({_cop(minimo)}). Nosotros {_cop(precio)}."
        )
    else:
        resumen = (
            f"Hay {len(comps)} comparable(s). Andamos parecidos al mínimo "
            f"({_cop(minimo)}). Nosotros {_cop(precio)}."
        )
    return {
        "item_id": str(item_id or "").upper(),
        "generado_en": _ahora_iso(),
        "nuestro_titulo": titulo,
        "nuestro_precio": float(precio or 0),
        "n_vistos": len(listados_visibles or []),
        "n_comparables": len(comps),
        "min_precio": minimo,
        "veredicto": veredicto,
        "delta_pct_vs_min": delta,
        "resumen": resumen,
        "listados": comps,
        "fuente": "captura_vision",
    }


def _invocar_vision_captura(
    imagen: bytes,
    mime: str,
    titulo: str,
    precio: float,
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

    prompt = (
        "Sos un extractor de listados de Mercado Libre Colombia. "
        "La imagen es un pantallazo del RESULTADO DE BÚSQUEDA (tarjetas). "
        "Solo extraé lo visible; no inventes.\n\n"
        f"Nuestra publicación de referencia:\n- título: {titulo}\n- precio nuestro: {precio}\n\n"
        'Devolvé SOLO JSON válido: {"listados":[{"titulo":"","precio":24900,'
        '"vendedor":"","permalink":"","vendidos":null,"envio_gratis":false,'
        '"parece_nuestra":false}]}\n\n'
        "Reglas: precio en COP sin puntos de miles; parece_nuestra=true si es "
        "McKenna o el mismo título/precio de referencia; permalink solo si se "
        "lee mercadolibre.com.co; máximo 15 tarjetas visibles."
    )
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
        listados = _invocar_vision_captura(jpeg, mime_out, titulo_n, float(precio_n or 0))
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
    _reemplazar_observaciones_captura(mid, reporte.get("listados") or [])
    hist = [r for r in _cargar_reportes_captura() if str(r.get("item_id") or "").upper() != mid]
    hist.append(reporte)
    _guardar_reportes_captura(hist)
    analisis = obtener_ultimo_analisis_competencia()
    return {"ok": True, "reporte": reporte, **analisis}
