"""Conversión de preventa MeLi: % de quienes preguntaron y luego compraron.

Cruza preguntas recibidas (`/questions/search`) con órdenes pagadas
(`/orders/search`). Unidad principal: par único (comprador, ítem).

No llama LLM. Cachea el resultado ~15 min para no martillar la API de MeLi
cuando el panel está abierto.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "preventa_metricas_cache.json")
CACHE_TTL_SEC = int(os.getenv("PREVENTA_METRICAS_TTL_SEC", "900"))
CACHE_STALE_SEC = int(os.getenv("PREVENTA_METRICAS_STALE_SEC", str(24 * 3600)))
MARGEN_HORAS_DEFAULT = int(os.getenv("PREVENTA_METRICAS_MARGEN_HORAS", "48"))
MAX_PREGUNTAS_POR_STATUS = 500
_CACHE_LOCK = threading.Lock()
_MEM_CACHE: dict[str, tuple[float, dict]] = {}
_REFRESHING: set[str] = set()


def _parse_dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    s = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _pct(num: int, den: int) -> float:
    if den <= 0:
        return 0.0
    return round(100.0 * num / den, 1)


def normalizar_pregunta(q: dict) -> dict | None:
    """Acepta el dict crudo de MeLi o uno ya normalizado (tests)."""
    qid = str(q.get("question_id") or q.get("id") or "").strip()
    buyer = q.get("buyer_id")
    if buyer is None:
        buyer = (q.get("from") or {}).get("id")
    item_id = str(q.get("item_id") or "").strip().upper()
    fecha = q.get("fecha")
    if not isinstance(fecha, datetime):
        fecha = _parse_dt(q.get("date_created") or q.get("timestamp") or fecha)
    if not qid or buyer is None or not item_id or fecha is None:
        return None
    titulo = (
        str(q.get("titulo") or q.get("titulo_producto") or "").strip()
        or str((q.get("item") or {}).get("title") or "").strip()
    )
    status = str(q.get("status") or "ANSWERED").strip().upper() or "ANSWERED"
    return {
        "question_id": qid,
        "buyer_id": str(buyer),
        "item_id": item_id,
        "titulo": titulo,
        "fecha": fecha,
        "status": status,
    }


def extraer_compras(ordenes: list[dict]) -> list[dict]:
    """Normaliza órdenes MeLi a {buyer_id, item_ids, fecha, order_id, total}."""
    out: list[dict] = []
    for orden in ordenes or []:
        buyer = (orden.get("buyer") or {}).get("id")
        if buyer is None:
            buyer = orden.get("buyer_id")
        fecha = orden.get("fecha")
        if not isinstance(fecha, datetime):
            fecha = _parse_dt(
                orden.get("date_closed") or orden.get("date_created") or fecha
            )
        item_ids: set[str] = set()
        titulos: dict[str, str] = {}
        for oi in orden.get("order_items") or []:
            info = oi.get("item") or {}
            mid = str(info.get("id") or oi.get("item_id") or "").strip().upper()
            if not mid:
                continue
            item_ids.add(mid)
            tit = str(info.get("title") or "").strip()
            if tit:
                titulos[mid] = tit
        for mid in orden.get("item_ids") or []:
            mid_s = str(mid).strip().upper()
            if mid_s:
                item_ids.add(mid_s)
        if buyer is None or fecha is None or not item_ids:
            continue
        out.append(
            {
                "buyer_id": str(buyer),
                "item_ids": item_ids,
                "fecha": fecha,
                "order_id": str(orden.get("id") or orden.get("order_id") or ""),
                "total": float(orden.get("total_amount") or orden.get("total") or 0),
                "titulos": titulos,
            }
        )
    return out


def cruzar_preguntas_con_compras(
    preguntas: list[dict],
    ordenes: list[dict],
    *,
    ahora: datetime | None = None,
    desde: datetime | None = None,
    margen_horas: int = MARGEN_HORAS_DEFAULT,
) -> dict:
    """
    Calcula conversión sin pegarle a MeLi.

    - Oportunidad = par único (comprador, ítem) con pregunta en el período.
    - Compra del mismo ítem = orden pagada de ese comprador por ese ítem
      con fecha >= pregunta.
    - Preguntas más recientes que `margen_horas` no entran al denominador
      (aún no hubo tiempo de comprar).
    """
    ahora = ahora or datetime.now(timezone.utc)
    if ahora.tzinfo is None:
        ahora = ahora.replace(tzinfo=timezone.utc)
    else:
        ahora = ahora.astimezone(timezone.utc)

    norm: list[dict] = []
    for q in preguntas or []:
        n = normalizar_pregunta(q)
        if not n:
            continue
        if desde is not None and n["fecha"] < desde:
            continue
        if n["fecha"] > ahora:
            continue
        norm.append(n)

    compras = extraer_compras(ordenes)
    por_buyer: dict[str, list[dict]] = defaultdict(list)
    for c in compras:
        por_buyer[c["buyer_id"]].append(c)

    corte_margen = ahora - timedelta(hours=max(0, int(margen_horas)))

    # Una oportunidad por (buyer, item): se queda la pregunta más antigua
    # (primera duda) para atribuir la compra posterior.
    por_opp: dict[tuple[str, str], dict] = {}
    for q in sorted(norm, key=lambda x: x["fecha"]):
        key = (q["buyer_id"], q["item_id"])
        if key not in por_opp:
            por_opp[key] = q

    def _compra_despues(buyer_id: str, fecha_preg: datetime, item_id: str | None):
        for c in por_buyer.get(buyer_id, []):
            if c["fecha"] < fecha_preg:
                continue
            if item_id is None or item_id in c["item_ids"]:
                return c
        return None

    def _stats_de(opps: list[dict]) -> dict:
        mismo = 0
        cualquier = 0
        buyers_any: set[str] = set()
        buyers_conv: set[str] = set()
        for q in opps:
            c_item = _compra_despues(q["buyer_id"], q["fecha"], q["item_id"])
            c_any = _compra_despues(q["buyer_id"], q["fecha"], None)
            if c_item:
                mismo += 1
            if c_any:
                cualquier += 1
                buyers_conv.add(q["buyer_id"])
            buyers_any.add(q["buyer_id"])
        n = len(opps)
        return {
            "oportunidades": n,
            "compraron_mismo_item": mismo,
            "no_compraron_mismo_item": max(0, n - mismo),
            "tasa_compra_pct": _pct(mismo, n),
            "compraron_cualquier_item": cualquier,
            "tasa_compra_tienda_pct": _pct(cualquier, n),
            "preguntadores_unicos": len(buyers_any),
            "compradores_unicos": len(buyers_conv),
        }

    maduras = [q for q in por_opp.values() if q["fecha"] <= corte_margen]
    en_espera = [q for q in por_opp.values() if q["fecha"] > corte_margen]
    respondidas = [q for q in maduras if q["status"] == "ANSWERED"]
    sin_resp = [q for q in maduras if q["status"] != "ANSWERED"]

    por_producto: dict[str, list[dict]] = defaultdict(list)
    titulos: dict[str, str] = {}
    for q in maduras:
        por_producto[q["item_id"]].append(q)
        if q.get("titulo"):
            titulos[q["item_id"]] = q["titulo"]
    for c in compras:
        for mid, tit in (c.get("titulos") or {}).items():
            titulos.setdefault(mid, tit)

    productos = []
    for mid, opps in por_producto.items():
        st = _stats_de(opps)
        productos.append(
            {
                "item_id": mid,
                "titulo": titulos.get(mid) or mid,
                "preguntas": sum(
                    1 for q in norm if q["item_id"] == mid and q["fecha"] <= corte_margen
                ),
                **st,
            }
        )
    productos.sort(key=lambda p: (-p["oportunidades"], -p["tasa_compra_pct"]))

    resumen = _stats_de(maduras)
    return {
        "preguntas_en_periodo": len(norm),
        "oportunidades_en_espera": len(en_espera),
        "margen_horas": int(margen_horas),
        "resumen": resumen,
        "por_respuesta": {
            "respondidas": _stats_de(respondidas),
            "sin_responder": _stats_de(sin_resp),
        },
        "por_producto": productos[:20],
        "conversion_explicacion": {
            "titulo": "Porcentaje de compra tras preguntar",
            "formula": "compraron el mismo producto ÷ personas que preguntaron por ese producto × 100",
            "numerador": resumen["compraron_mismo_item"],
            "denominador": resumen["oportunidades"],
            "resultado_pct": resumen["tasa_compra_pct"],
            "texto": (
                f"De {resumen['oportunidades']} clientes que preguntaron por un producto "
                f"(hace más de {int(margen_horas)} h), "
                f"{resumen['compraron_mismo_item']} lo compraron después. "
                f"Eso es {resumen['tasa_compra_pct']}%."
            ),
            "compra_significa": (
                "Cuenta una sola vez por persona y producto. La orden tiene que ser "
                "pagada y posterior a la pregunta. Quien preguntó hace menos de "
                f"{int(margen_horas)} h aún no entra al porcentaje (no ha tenido tiempo)."
            ),
        },
    }


def _leer_cache_disco() -> dict:
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _guardar_cache_disco(cache: dict) -> None:
    try:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        tmp = CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, CACHE_PATH)
    except Exception as e:
        print(f"⚠️ [PREVENTA-METRICAS] no se pudo guardar cache: {e}")


def _listar_preguntas_periodo(
    token: str,
    seller_id: str,
    desde: datetime,
    max_por_status: int = MAX_PREGUNTAS_POR_STATUS,
) -> list[dict]:
    import requests

    url = "https://api.mercadolibre.com/questions/search"
    headers = {"Authorization": f"Bearer {token}"}
    out: list[dict] = []
    vistos: set[str] = set()

    for status in ("ANSWERED", "UNANSWERED", "CLOSED_UNANSWERED"):
        offset = 0
        while offset < max_por_status:
            params = {
                "seller_id": seller_id,
                "api_version": 4,
                "status": status,
                "sort_fields": "date_created",
                "sort_types": "DESC",
                "limit": 50,
                "offset": offset,
            }
            try:
                res = requests.get(url, headers=headers, params=params, timeout=20)
            except requests.RequestException as e:
                print(f"⚠️ [PREVENTA-METRICAS] red questions {status} offset {offset}: {e}")
                break
            if res.status_code == 429:
                time.sleep(1.5)
                try:
                    res = requests.get(url, headers=headers, params=params, timeout=20)
                except requests.RequestException:
                    break
            if res.status_code != 200:
                # Fallback del alias /my/received_questions/search si /questions/search falla
                if offset == 0:
                    alt = _listar_preguntas_recibidas(token, status, desde, max_por_status)
                    for q in alt:
                        qid = str(q.get("id") or "")
                        if qid and qid not in vistos:
                            vistos.add(qid)
                            out.append(q)
                else:
                    print(
                        f"⚠️ [PREVENTA-METRICAS] questions {status} "
                        f"offset {offset}: {res.status_code} {res.text[:180]}"
                    )
                break
            data = res.json() if res.content else {}
            questions = data.get("questions") or []
            if not questions:
                break
            viejas = 0
            for q in questions:
                qid = str(q.get("id") or "")
                fecha = _parse_dt(q.get("date_created"))
                if fecha is not None and fecha < desde:
                    viejas += 1
                    continue
                if qid and qid not in vistos:
                    vistos.add(qid)
                    out.append(q)
            offset += len(questions)
            total = int((data.get("total") or (data.get("paging") or {}).get("total") or 0) or 0)
            # Si viene ordenado DESC, un bloque lleno de preguntas viejas cierra.
            if viejas == len(questions) or (total and offset >= total):
                break
            if len(questions) < 50:
                break
    return out


def _listar_preguntas_recibidas(
    token: str, status: str, desde: datetime, max_preguntas: int
) -> list[dict]:
    import requests

    url = "https://api.mercadolibre.com/my/received_questions/search"
    headers = {"Authorization": f"Bearer {token}"}
    out: list[dict] = []
    offset = 0
    while offset < max_preguntas:
        params = {"status": status, "limit": 50, "offset": offset}
        try:
            res = requests.get(url, headers=headers, params=params, timeout=20)
        except requests.RequestException:
            break
        if res.status_code != 200:
            break
        questions = (res.json() or {}).get("questions") or []
        if not questions:
            break
        viejas = 0
        for q in questions:
            fecha = _parse_dt(q.get("date_created"))
            if fecha is not None and fecha < desde:
                viejas += 1
                continue
            out.append(q)
        offset += len(questions)
        if viejas == len(questions) or len(questions) < 50:
            break
    return out


def _enriquecer_titulos(preguntas: list[dict], token: str) -> None:
    """Si la pregunta no trae título, lo toma de GET /items/{id} (cache local)."""
    import requests

    faltantes: dict[str, list[dict]] = defaultdict(list)
    for q in preguntas:
        titulo = str((q.get("item") or {}).get("title") or q.get("titulo") or "").strip()
        item_id = str(q.get("item_id") or "").strip()
        if item_id and not titulo:
            faltantes[item_id].append(q)
    if not faltantes:
        return
    headers = {"Authorization": f"Bearer {token}"}
    for item_id, qs in list(faltantes.items())[:40]:
        try:
            res = requests.get(
                f"https://api.mercadolibre.com/items/{item_id}",
                headers=headers,
                timeout=10,
            )
        except requests.RequestException:
            continue
        if res.status_code != 200:
            continue
        titulo = str((res.json() or {}).get("title") or "").strip()
        if not titulo:
            continue
        for q in qs:
            q["titulo"] = titulo


def _calcular_vivo(dias: int, margen_horas: int) -> dict:
    from app.services.meli import _obtener_seller_id_meli, listar_ordenes_meli_por_estado
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("No hay token de Mercado Libre")
    seller_id = _obtener_seller_id_meli(token)
    if not seller_id:
        raise RuntimeError("No se pudo obtener el id de vendedor de Mercado Libre")

    ahora = datetime.now(timezone.utc)
    desde = ahora - timedelta(days=dias)
    preguntas = _listar_preguntas_periodo(token, seller_id, desde)
    try:
        _enriquecer_titulos(preguntas, token)
    except Exception as e:
        print(f"⚠️ [PREVENTA-METRICAS] títulos: {e}")

    # Órdenes: mismo rango + margen hacia atrás no hace falta; hacia adelante
    # el "hasta" es hoy. Un par de días extra cubre preguntas al borde.
    ordenes = listar_ordenes_meli_por_estado("paid", dias_atras=dias)

    cruzado = cruzar_preguntas_con_compras(
        preguntas,
        ordenes,
        ahora=ahora,
        desde=desde,
        margen_horas=margen_horas,
    )
    cruzado["generado_en"] = ahora.isoformat(timespec="seconds")
    cruzado["periodo"] = {
        "dias": dias,
        "desde": desde.date().isoformat(),
        "hasta": ahora.date().isoformat(),
    }
    cruzado["fuente"] = {
        "preguntas_meli": len(preguntas),
        "ordenes_pagadas": len(ordenes),
    }
    cruzado["desde_cache"] = False
    cruzado["stale"] = False
    return cruzado


def _cache_get(key: str) -> tuple[float, dict] | None:
    mem = _MEM_CACHE.get(key)
    if mem:
        return mem
    disco = _leer_cache_disco().get(key) or {}
    ts = float(disco.get("ts") or 0)
    payload = disco.get("data")
    if payload and ts:
        _MEM_CACHE[key] = (ts, payload)
        return ts, payload
    return None


def _cache_put(key: str, data: dict) -> None:
    ts = time.time()
    _MEM_CACHE[key] = (ts, data)
    disco = _leer_cache_disco()
    disco[key] = {"ts": ts, "data": data}
    _guardar_cache_disco(disco)


def _refrescar_en_fondo(key: str, dias: int, margen: int) -> None:
    if key in _REFRESHING:
        return
    _REFRESHING.add(key)

    def _run() -> None:
        try:
            vivo = _calcular_vivo(dias, margen)
            with _CACHE_LOCK:
                _cache_put(key, vivo)
        except Exception as e:
            print(f"⚠️ [PREVENTA-METRICAS] refresh fondo: {e}")
        finally:
            _REFRESHING.discard(key)

    try:
        from app.observability import spawn_thread

        spawn_thread(_run, daemon=True)
    except Exception:
        threading.Thread(target=_run, daemon=True).start()


def calcular_metricas_preventa(
    dias: int = 30,
    *,
    forzar: bool = False,
    margen_horas: int | None = None,
) -> dict:
    """Punto de entrada del panel. Cachea por `dias` (stale-while-revalidate)."""
    dias = max(7, min(int(dias or 30), 90))
    margen = MARGEN_HORAS_DEFAULT if margen_horas is None else max(0, int(margen_horas))
    key = f"{dias}:{margen}"
    now = time.time()

    with _CACHE_LOCK:
        hit = None if forzar else _cache_get(key)
        if hit:
            ts, payload = hit
            age = now - ts
            data = dict(payload)
            data["desde_cache"] = True
            if age < CACHE_TTL_SEC:
                data["stale"] = False
                return data
            if age < CACHE_STALE_SEC:
                data["stale"] = True
                _refrescar_en_fondo(key, dias, margen)
                return data

    vivo = _calcular_vivo(dias, margen)
    with _CACHE_LOCK:
        _cache_put(key, vivo)
    return vivo
