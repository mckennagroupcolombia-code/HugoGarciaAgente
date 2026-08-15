"""
Publicidad de Mercado Libre (Product Ads / Mercado Ads).

No hay sincronización previa con este dato en el repo — se integra aquí por
primera vez (ago-2026) tras una auditoría manual que mostró que el 42% del
presupuesto de ads estaba en zona de riesgo (cero ventas o ACOS > 100%) y que
un 20% se iba en reventa de marcas de terceros ajenas al catálogo propio de
materia prima McKenna. Ver panel Contabilidad → Publicidad.

Endpoints usados (API pública de MeLi, confirmados en vivo — no hay doc
oficial estable, la URL "marketplace/advertising" reemplazó a la legada
"advertising/product_ads/..." que MeLi empezó a deprecar en 2025-2026):
  GET /advertising/advertisers?product_id=PADS
  GET /marketplace/advertising/{site}/advertisers/{id}/product_ads/campaigns/search
  GET /marketplace/advertising/{site}/advertisers/{id}/product_ads/ads/search
Ambos "/search" aceptan date_from/date_to (máx. 90 días) y metrics= con la
lista exacta de abajo — otros nombres (p.ej. "sales") devuelven 400.
"""

import json
import os
import time
from datetime import datetime, timedelta
from typing import Any

import requests

from app.utils import refrescar_token_meli

_SITE_ID = "MCO"
_METRICS = "clicks,cost,prints,acos,roas,units_quantity,total_amount"

_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "meli_publicidad_cache.json")
_CACHE_PATH = os.path.normpath(_CACHE_PATH)
_CACHE_TTL_S = 60 * 60  # el gasto de ads no cambia minuto a minuto; 1h evita pegarle a MeLi en cada carga de panel

# Marcas consideradas "catálogo propio" (McKenna Group + genéricas usadas para
# insumos de laboratorio sin marca propia). Todo lo demás se cuenta como
# reventa de marca ajena. Marca vacía ("") se trata como propia — es un hueco
# de metadata en la publicación (falta el atributo Marca), no evidencia de
# reventa de terceros.
_MARCAS_PROPIAS = {"mckenna group", "mckg", "genérica", "soluciones & solventes", "labvida", ""}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Api-Version": "2"}


def _obtener_advertiser_id(token: str) -> int | None:
    try:
        r = requests.get(
            "https://api.mercadolibre.com/advertising/advertisers",
            headers=_headers(token),
            params={"product_id": "PADS"},
            timeout=15,
        )
        if r.status_code != 200:
            return None
        advertisers = (r.json() or {}).get("advertisers") or []
        for a in advertisers:
            if a.get("site_id") == _SITE_ID:
                return a.get("advertiser_id")
        return advertisers[0].get("advertiser_id") if advertisers else None
    except requests.RequestException:
        return None


def _base_url(advertiser_id: int) -> str:
    return f"https://api.mercadolibre.com/marketplace/advertising/{_SITE_ID}/advertisers/{advertiser_id}"


def _listar_campanas(token: str, advertiser_id: int, date_from: str, date_to: str) -> list[dict]:
    r = requests.get(
        f"{_base_url(advertiser_id)}/product_ads/campaigns/search",
        headers=_headers(token),
        params={"date_from": date_from, "date_to": date_to, "metrics": _METRICS},
        timeout=20,
    )
    if r.status_code != 200:
        raise RuntimeError(f"MeLi campaigns/search HTTP {r.status_code}: {(r.text or '')[:200]}")
    return (r.json() or {}).get("results") or []


def _listar_items(token: str, advertiser_id: int, date_from: str, date_to: str) -> list[dict]:
    """Pagina /product_ads/ads/search — típicamente 600-700 anuncios en esta cuenta."""
    url = f"{_base_url(advertiser_id)}/product_ads/ads/search"
    all_results: list[dict] = []
    offset, limit = 0, 50
    while True:
        r = requests.get(
            url,
            headers=_headers(token),
            params={
                "date_from": date_from,
                "date_to": date_to,
                "metrics": _METRICS,
                "limit": limit,
                "offset": offset,
            },
            timeout=30,
        )
        if r.status_code != 200:
            raise RuntimeError(f"MeLi ads/search HTTP {r.status_code}: {(r.text or '')[:200]}")
        data = r.json() or {}
        results = data.get("results") or []
        all_results.extend(results)
        total = int((data.get("paging") or {}).get("total") or 0)
        offset += limit
        if offset >= total or not results or offset > 3000:  # safety
            break
        time.sleep(0.1)
    return all_results


def _dedup_items(items: list[dict]) -> list[dict]:
    """Un mismo item_id puede aparecer 2 veces (histórico deleted + activo actual) con métricas idénticas."""
    seen: dict[str, dict] = {}
    for it in items:
        iid = it.get("item_id")
        if not iid:
            continue
        if iid not in seen or (seen[iid].get("status") == "deleted" and it.get("status") != "deleted"):
            seen[iid] = it
    return list(seen.values())


def _es_marca_ajena(item: dict) -> bool:
    brand = (item.get("brand_value_name") or "").strip().lower()
    return brand not in _MARCAS_PROPIAS


def es_marca_ajena_por_nombre(marca: str | None) -> bool:
    """Misma regla que `_es_marca_ajena` pero sobre el string ya aplanado (`_fila_item`.marca) — usado por meli_ads_campanas."""
    return (marca or "").strip().lower() not in _MARCAS_PROPIAS


def _fila_item(it: dict) -> dict:
    m = it.get("metrics") or {}
    return {
        "item_id": it.get("item_id"),
        "titulo": it.get("title"),
        "marca": it.get("brand_value_name"),
        "dominio": it.get("domain_id"),
        "status": it.get("status"),
        "permalink": it.get("permalink"),
        "campaign_id": it.get("campaign_id"),
        "costo": float(m.get("cost") or 0),
        "ventas": float(m.get("total_amount") or 0),
        "clicks": int(m.get("clicks") or 0),
        "prints": int(m.get("prints") or 0),
        "unidades": int(m.get("units_quantity") or 0),
        "acos": float(m.get("acos") or 0),
    }


def _clasificar_y_resumir(campanas: list[dict], items_raw: list[dict], dias: int) -> dict:
    items = _dedup_items(items_raw)

    activos = [it for it in items if it.get("status") == "active"]
    costo_activos = sum(float((it.get("metrics") or {}).get("cost") or 0) for it in activos)

    cero_ventas = [it for it in items if (it.get("metrics") or {}).get("cost", 0) > 0 and (it.get("metrics") or {}).get("units_quantity", 0) == 0]
    con_ventas = [it for it in items if (it.get("metrics") or {}).get("units_quantity", 0) > 0]
    perdida_directa = [it for it in con_ventas if (it.get("metrics") or {}).get("acos", 0) > 100]
    riesgo_alto = [
        it for it in con_ventas
        if 60 < (it.get("metrics") or {}).get("acos", 0) <= 100
    ]

    cero_ventas.sort(key=lambda it: -(it.get("metrics") or {}).get("cost", 0))
    perdida_directa.sort(key=lambda it: -(it.get("metrics") or {}).get("cost", 0))
    riesgo_alto.sort(key=lambda it: -(it.get("metrics") or {}).get("cost", 0))

    costo_total = sum(float((it.get("metrics") or {}).get("cost") or 0) for it in items)
    ventas_total = sum(float((it.get("metrics") or {}).get("total_amount") or 0) for it in items)

    costo_cero = sum(float((it.get("metrics") or {}).get("cost") or 0) for it in cero_ventas)
    costo_perdida = sum(float((it.get("metrics") or {}).get("cost") or 0) for it in perdida_directa)
    ventas_perdida = sum(float((it.get("metrics") or {}).get("total_amount") or 0) for it in perdida_directa)
    costo_riesgo = sum(float((it.get("metrics") or {}).get("cost") or 0) for it in riesgo_alto)
    costo_resto = max(0.0, costo_total - costo_cero - costo_perdida - costo_riesgo)

    ajenos = [it for it in items if _es_marca_ajena(it)]
    propios = [it for it in items if not _es_marca_ajena(it)]

    def _resumen_grupo(grupo: list[dict]) -> dict:
        c = sum(float((it.get("metrics") or {}).get("cost") or 0) for it in grupo)
        v = sum(float((it.get("metrics") or {}).get("total_amount") or 0) for it in grupo)
        return {"count": len(grupo), "costo": c, "ventas": v, "acos": round(c / v * 100, 1) if v else None}

    top_gastadores = sorted(items, key=lambda it: -(it.get("metrics") or {}).get("cost", 0))[:20]

    # Totales SIEMPRE por suma de items, nunca "la primera campaña" — desde que
    # la cuenta tiene más de una campaña (ago-2026), tomar campanas[0] a ciegas
    # mostraba clicks/prints/roas en 0 si esa campaña resultaba ser la más nueva
    # y todavía sin actividad. Sumar por item es correcto sin importar cuántas
    # campañas existan ni en qué orden las devuelva la API.
    clicks_total = sum(int((it.get("metrics") or {}).get("clicks") or 0) for it in items)
    prints_total = sum(int((it.get("metrics") or {}).get("prints") or 0) for it in items)
    unidades_total = sum(int((it.get("metrics") or {}).get("units_quantity") or 0) for it in items)
    acos_total = round(costo_total / ventas_total * 100, 2) if ventas_total else 0.0
    roas_total = round(ventas_total / costo_total, 2) if costo_total else 0.0

    campanas_resumen = [
        {
            "id": c.get("id"),
            "nombre": c.get("name"),
            "estrategia": c.get("strategy"),
            "acos_target": c.get("acos_target"),
            "roas_target": c.get("roas_target"),
            "presupuesto": c.get("budget"),
            "canal": c.get("channel"),
            "estado": c.get("status"),
            "costo": float((c.get("metrics") or {}).get("cost") or 0),
            "ventas": float((c.get("metrics") or {}).get("total_amount") or 0),
            "acos": float((c.get("metrics") or {}).get("acos") or 0),
        }
        for c in campanas
    ]

    return {
        "campanas": campanas_resumen,
        "totales": {
            "costo": costo_total,
            "ventas_atribuidas": ventas_total,
            "acos": acos_total,
            "roas": roas_total,
            "clicks": clicks_total,
            "prints": prints_total,
            "unidades": unidades_total,
            "anuncios_total": len(items),
            "anuncios_activos": len(activos),
            "costo_activos": costo_activos,
        },
        "riesgo": {
            "cero_ventas": {"count": len(cero_ventas), "costo": costo_cero},
            "perdida_directa": {"count": len(perdida_directa), "costo": costo_perdida, "ventas": ventas_perdida},
            "acos_60_100": {"count": len(riesgo_alto), "costo": costo_riesgo},
            "resto": {"costo": costo_resto},
        },
        "marca": {
            "propia": _resumen_grupo(propios),
            "ajena": _resumen_grupo(ajenos),
        },
        "top_gastadores": [_fila_item(it) for it in top_gastadores],
        "cero_ventas_lista": [_fila_item(it) for it in cero_ventas[:30]],
        "perdida_directa_lista": [_fila_item(it) for it in perdida_directa],
        "ajena_lista": [_fila_item(it) for it in sorted(ajenos, key=lambda it: -(it.get("metrics") or {}).get("cost", 0))[:20]],
    }


def _obtener_datos_crudos(dias: int, refresh: bool) -> tuple[int, list[dict], list[dict], str]:
    """
    Campañas (todas, la cuenta puede tener más de una desde ago-2026) + items
    deduplicados, sin clasificar — fuente única cacheada 1h en disco,
    compartida por `obtener_resumen_publicidad` (panel) y por
    `app.services.meli_ads_recomendaciones` (motor de recomendaciones/cron),
    para no pegarle dos veces a la API de MeLi por los mismos datos.
    """
    now = datetime.now()

    if not refresh and os.path.isfile(_CACHE_PATH):
        try:
            with open(_CACHE_PATH, encoding="utf-8") as f:
                cached = json.load(f)
            ts = float(cached.get("_ts") or 0)
            if cached.get("dias") == dias and (now.timestamp() - ts) < _CACHE_TTL_S:
                return cached["advertiser_id"], cached["campanas_raw"], cached["items_raw"], "cache"
        except Exception:
            pass

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token de Mercado Libre no disponible.")

    advertiser_id = _obtener_advertiser_id(token)
    if not advertiser_id:
        raise RuntimeError(
            "No se pudo obtener el advertiser_id de Mercado Ads. "
            "Verificar que la app de MeLi tenga habilitado el permiso de Advertising en developers.mercadolibre.com."
        )

    date_from = (now - timedelta(days=dias)).strftime("%Y-%m-%d")
    date_to = now.strftime("%Y-%m-%d")

    campanas_raw = _listar_campanas(token, advertiser_id, date_from, date_to)
    items_raw = _dedup_items(_listar_items(token, advertiser_id, date_from, date_to))

    try:
        os.makedirs(os.path.dirname(_CACHE_PATH), exist_ok=True)
        with open(_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "dias": dias,
                    "advertiser_id": advertiser_id,
                    "campanas_raw": campanas_raw,
                    "items_raw": items_raw,
                    "periodo": {"desde": date_from, "hasta": date_to},
                    "actualizado_en": now.strftime("%Y-%m-%dT%H:%M:%S"),
                    "_ts": now.timestamp(),
                },
                f,
                ensure_ascii=False,
            )
    except Exception:
        pass

    return advertiser_id, campanas_raw, items_raw, "live"


def obtener_resumen_publicidad(dias: int = 30, refresh: bool = False) -> dict:
    """
    Resumen de gasto/retorno de Product Ads de MeLi con clasificación de
    riesgo (cero ventas, ACOS >100%, ACOS 60-100%) y comparación catálogo
    propio vs. reventa de marca ajena. Cacheado 1h en disco (ver `_obtener_datos_crudos`).
    """
    dias = max(1, min(int(dias or 30), 90))
    now = datetime.now()

    advertiser_id, campanas_raw, items_raw, fuente = _obtener_datos_crudos(dias, refresh)

    resumen = _clasificar_y_resumir(campanas_raw, items_raw, dias)
    resumen["dias"] = dias
    resumen["advertiser_id"] = advertiser_id
    date_from = (now - timedelta(days=dias)).strftime("%Y-%m-%d")
    date_to = now.strftime("%Y-%m-%d")
    resumen["periodo"] = {"desde": date_from, "hasta": date_to}
    resumen["actualizado_en"] = now.strftime("%Y-%m-%dT%H:%M:%S")
    resumen["fuente"] = fuente
    resumen["cache_ttl_s"] = _CACHE_TTL_S

    return resumen


_GASTO_RANGO_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}
_GASTO_RANGO_TTL_S = 60 * 60  # mismo criterio que _CACHE_TTL_S: el gasto de un rango cerrado no cambia


def gasto_ads_por_rango(date_from: str, date_to: str) -> dict:
    """
    Costo/ventas atribuidas totales de la campaña (nivel campaña, no por ítem)
    en un rango de fechas puntual — usado por app.services.salud_negocio para
    bucketear el gasto en ads por semana/mes sin paginar los ~600-700 anuncios
    por cada bucket (eso sería 1 rebuild completo × N semanas). Reutiliza el
    mismo endpoint /product_ads/campaigns/search que `_obtener_datos_crudos`,
    solo que con date_from/date_to acotados al bucket en vez de a `dias`.
    Cacheado en memoria por rango exacto (no persiste a disco: son muchos
    rangos pequeños, no vale la pena un archivo por cada uno).
    """
    key = (date_from, date_to)
    cached = _GASTO_RANGO_CACHE.get(key)
    now = time.time()
    if cached and (now - cached[0]) < _GASTO_RANGO_TTL_S:
        return cached[1]

    token = refrescar_token_meli()
    if not token:
        resultado = {"costo": 0.0, "ventas_atribuidas": 0.0, "acos": 0.0, "error": "sin_token"}
        return resultado

    advertiser_id = _obtener_advertiser_id(token)
    if not advertiser_id:
        resultado = {"costo": 0.0, "ventas_atribuidas": 0.0, "acos": 0.0, "error": "sin_advertiser"}
        return resultado

    try:
        campanas = _listar_campanas(token, advertiser_id, date_from, date_to)
    except RuntimeError as e:
        resultado = {"costo": 0.0, "ventas_atribuidas": 0.0, "acos": 0.0, "error": str(e)[:200]}
        return resultado

    costo = sum(float((c.get("metrics") or {}).get("cost") or 0) for c in campanas)
    ventas = sum(float((c.get("metrics") or {}).get("total_amount") or 0) for c in campanas)
    resultado = {
        "costo": round(costo, 2),
        "ventas_atribuidas": round(ventas, 2),
        "acos": round(costo / ventas * 100, 2) if ventas else 0.0,
    }
    _GASTO_RANGO_CACHE[key] = (now, resultado)
    return resultado


def listar_items_publicidad_completo(dias: int = 30, refresh: bool = False) -> dict:
    """
    Todos los anuncios (deduplicados, sin capar a un top-N) con su fila
    aplanada (`_fila_item`) — insumo del motor de recomendaciones, que
    necesita ver el catálogo pautado completo, no solo los recortes que
    expone el panel (top 20, top 30…).
    """
    dias = max(1, min(int(dias or 30), 90))
    advertiser_id, campanas_raw, items_raw, fuente = _obtener_datos_crudos(dias, refresh)
    return {
        "dias": dias,
        "advertiser_id": advertiser_id,
        "fuente": fuente,
        "campanas": [
            {"id": c.get("id"), "nombre": c.get("name"), "acos_target": c.get("acos_target")}
            for c in campanas_raw
        ],
        "items": [_fila_item(it) for it in items_raw],
    }
