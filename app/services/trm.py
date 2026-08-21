"""TRM BanRep (oficial diaria, tasa de hoy).

Fuente oficial: https://www.datos.gov.co/resource/32sa-8pi3.json
El gadget de Inicio muestra este valor; el gráfico de mercado es TradingView
en el panel (no Yahoo).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

TRM_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json"
_TZ_BOGOTA = ZoneInfo("America/Bogota")
_RE_FECHA = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_HTTP_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "mckenna-agente/1.0 (+https://mckennagroup.co)",
}

_DOLAR_CACHE_LOCK = threading.Lock()
_DOLAR_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
DOLAR_CACHE_TTL_S = 600.0


def reset_dolar_cache() -> None:
    """Solo tests: vacía el cache en memoria del gadget USD/COP."""
    with _DOLAR_CACHE_LOCK:
        _DOLAR_CACHE["ts"] = 0.0
        _DOLAR_CACHE["data"] = None


def _hoy_bogota() -> date:
    """Calendario civil en America/Bogota (no UTC ni TZ del servidor)."""
    return datetime.now(_TZ_BOGOTA).date()


def normalizar_fecha(fecha: str | date | datetime | None) -> str | None:
    """Devuelve YYYY-MM-DD o None."""
    if fecha is None or fecha == "":
        return None
    if isinstance(fecha, datetime):
        return fecha.date().isoformat()
    if isinstance(fecha, date):
        return fecha.isoformat()
    s = str(fecha).strip()
    # ISO con hora
    if "T" in s:
        s = s.split("T", 1)[0]
    s = s.replace("/", "-")
    # DD-MM-YYYY → YYYY-MM-DD
    m_dmy = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{4})$", s)
    if m_dmy:
        d, mo, y = int(m_dmy.group(1)), int(m_dmy.group(2)), int(m_dmy.group(3))
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            return None
    m = _RE_FECHA.match(s)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def _parse_row(row: dict[str, Any], fecha_consulta: str) -> dict[str, Any] | None:
    try:
        valor = float(str(row.get("valor") or "").replace(",", ""))
    except (TypeError, ValueError):
        return None
    if valor <= 0:
        return None
    return {
        "valor": round(valor, 4),
        "unidad": str(row.get("unidad") or "COP").strip().upper() or "COP",
        "vigencia_desde": str(row.get("vigenciadesde") or "")[:10],
        "vigencia_hasta": str(row.get("vigenciahasta") or "")[:10],
        "fecha": fecha_consulta,
        "fuente": "banrep",
        "fuente_url": TRM_URL,
    }


def obtener_trm(
    fecha: str | date | datetime | None = None,
    *,
    timeout_s: float = 12.0,
) -> dict[str, Any]:
    """
    Obtiene la TRM BanRep vigente para `fecha` (YYYY-MM-DD).

    Si la fecha es None, usa hoy en America/Bogota.
    Si no hay registro exacto (festivo/fin de semana cubierto por vigencia),
    busca el rango que contiene la fecha; si falla, el último vigente ≤ fecha.
    """
    import requests

    fecha_s = normalizar_fecha(fecha) or _hoy_bogota().isoformat()
    # No consultar futuro: BanRep aún no publica
    hoy = _hoy_bogota().isoformat()
    if fecha_s > hoy:
        fecha_s = hoy

    ts = f"{fecha_s}T00:00:00.000"

    # 1) Rango que contiene la fecha (cubre fines de semana / festivos)
    where = (
        f"vigenciadesde <= '{ts}' AND vigenciahasta >= '{ts}'"
    )
    try:
        r = requests.get(
            TRM_URL,
            params={"$where": where, "$limit": 1},
            headers=_HTTP_HEADERS,
            timeout=timeout_s,
        )
        r.raise_for_status()
        rows = r.json()
        if isinstance(rows, list) and rows:
            out = _parse_row(rows[0], fecha_s)
            if out:
                return out
    except Exception as e:
        log.warning("TRM consulta por vigencia falló (%s): %s", fecha_s, e)

    # 2) Última TRM con vigencia_desde ≤ fecha
    try:
        r = requests.get(
            TRM_URL,
            params={
                "$where": f"vigenciadesde <= '{ts}'",
                "$order": "vigenciadesde DESC",
                "$limit": 1,
            },
            headers=_HTTP_HEADERS,
            timeout=timeout_s,
        )
        r.raise_for_status()
        rows = r.json()
        if isinstance(rows, list) and rows:
            out = _parse_row(rows[0], fecha_s)
            if out:
                out["aproximada"] = True
                return out
    except Exception as e:
        log.warning("TRM fallback ≤ fecha falló (%s): %s", fecha_s, e)

    # 3) Última publicada (hoy)
    try:
        r = requests.get(
            TRM_URL,
            params={"$order": "vigenciadesde DESC", "$limit": 1},
            headers=_HTTP_HEADERS,
            timeout=timeout_s,
        )
        r.raise_for_status()
        rows = r.json()
        if isinstance(rows, list) and rows:
            out = _parse_row(rows[0], fecha_s)
            if out:
                out["aproximada"] = True
                out["aviso"] = "Se usó la última TRM publicada (sin dato para la fecha pedida)"
                return out
    except Exception as e:
        log.exception("TRM última publicada falló")
        return {"error": f"No se pudo consultar la TRM BanRep: {e}", "fecha": fecha_s}

    return {"error": f"Sin TRM BanRep para {fecha_s}", "fecha": fecha_s}


def trm_para_usd(
    fecha: str | date | datetime | None = None,
    *,
    timeout_s: float = 12.0,
) -> float | None:
    """Atajo: valor numérico de TRM o None si falla."""
    data = obtener_trm(fecha, timeout_s=timeout_s)
    if data.get("error"):
        return None
    try:
        v = float(data["valor"])
        return v if v > 0 else None
    except (KeyError, TypeError, ValueError):
        return None


def obtener_trm_historico(
    *,
    limit: int = 60,
    timeout_s: float = 12.0,
) -> list[dict[str, Any]]:
    """Últimas TRM BanRep (una por vigencia_desde), más antiguas primero."""
    import requests

    n = max(1, min(int(limit), 180))
    try:
        r = requests.get(
            TRM_URL,
            params={"$order": "vigenciadesde DESC", "$limit": n},
            headers=_HTTP_HEADERS,
            timeout=timeout_s,
        )
        r.raise_for_status()
        rows = r.json()
    except Exception as e:
        log.warning("TRM histórico falló: %s", e)
        return []
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    vistos: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        parsed = _parse_row(row, str(row.get("vigenciadesde") or "")[:10])
        if not parsed:
            continue
        clave = parsed["vigencia_desde"] or parsed["fecha"]
        if not clave or clave in vistos:
            continue
        vistos.add(clave)
        out.append({"t": clave, "v": parsed["valor"]})
    out.sort(key=lambda p: p["t"])
    return out


def _cambio(actual: float, previo: float | None) -> tuple[float, float]:
    if previo is None or previo <= 0:
        return 0.0, 0.0
    abs_ = round(actual - previo, 4)
    pct = round((abs_ / previo) * 100.0, 3)
    return abs_, pct


def obtener_dolar_hora(
    *,
    timeout_s: float = 12.0,
    force: bool = False,
) -> dict[str, Any]:
    """
    TRM BanRep de hoy (America/Bogota) para el gadget de Inicio.

    El gráfico de mercado lo renderiza TradingView en el panel.
    Cache 10 min. `serie_hora` queda vacía a propósito.
    """
    now = time.time()
    if not force:
        with _DOLAR_CACHE_LOCK:
            cached = _DOLAR_CACHE["data"]
            ts = float(_DOLAR_CACHE["ts"] or 0)
            if cached and (now - ts) < DOLAR_CACHE_TTL_S:
                return cached

    trm = obtener_trm(None, timeout_s=timeout_s)
    serie_dia = obtener_trm_historico(limit=45, timeout_s=timeout_s)

    trm_valor = None
    if not trm.get("error"):
        try:
            trm_valor = float(trm["valor"])
        except (KeyError, TypeError, ValueError):
            trm_valor = None

    if not trm_valor or trm_valor <= 0:
        return {
            "error": trm.get("error") or "No se pudo obtener la TRM BanRep USD/COP",
            "unidad": "COP",
        }

    valor = float(trm_valor)
    previo_dia = None
    if serie_dia:
        if serie_dia[-1].get("t") == trm.get("fecha") and len(serie_dia) >= 2:
            previo_dia = float(serie_dia[-2]["v"])
        elif serie_dia[-1].get("t") != trm.get("fecha"):
            previo_dia = float(serie_dia[-1]["v"])
    cambio_abs, cambio_pct = _cambio(valor, previo_dia)
    hora = datetime.now(_TZ_BOGOTA).isoformat(timespec="seconds")

    out = {
        "valor": round(valor, 2),
        "unidad": "COP",
        "simbolo": "USD/COP",
        "hora": hora,
        "cambio_abs": cambio_abs,
        "cambio_pct": cambio_pct,
        "fuente": "banrep",
        "fuente_label": "TRM BanRep · Tasa de hoy",
        "trm_oficial": round(valor, 2),
        "trm_fecha": trm.get("fecha"),
        "trm_fuente": "banrep",
        "serie_hora": [],
        "serie_dia": serie_dia,
        "cache_ttl_s": int(DOLAR_CACHE_TTL_S),
        "actualizado": hora,
    }
    with _DOLAR_CACHE_LOCK:
        _DOLAR_CACHE["ts"] = now
        _DOLAR_CACHE["data"] = out
    return out
