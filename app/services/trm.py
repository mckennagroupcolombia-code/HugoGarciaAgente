"""TRM (Tasa Representativa del Mercado) oficial BanRep vía datos.gov.co.

Fuente: https://www.datos.gov.co/resource/32sa-8pi3.json
Convierte USD → COP con la TRM vigente en la fecha de la compra.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any

log = logging.getLogger(__name__)

TRM_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json"
_RE_FECHA = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


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

    Si la fecha es None, usa hoy (America/Bogota aproximado con date.today()).
    Si no hay registro exacto (festivo/fin de semana cubierto por vigencia),
    busca el rango que contiene la fecha; si falla, el último vigente ≤ fecha.
    """
    import requests

    fecha_s = normalizar_fecha(fecha) or date.today().isoformat()
    # No consultar futuro: BanRep aún no publica
    hoy = date.today().isoformat()
    if fecha_s > hoy:
        fecha_s = hoy

    ts = f"{fecha_s}T00:00:00.000"
    headers = {"Accept": "application/json", "User-Agent": "mckenna-agente/1.0"}

    # 1) Rango que contiene la fecha (cubre fines de semana / festivos)
    where = (
        f"vigenciadesde <= '{ts}' AND vigenciahasta >= '{ts}'"
    )
    try:
        r = requests.get(
            TRM_URL,
            params={"$where": where, "$limit": 1},
            headers=headers,
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
            headers=headers,
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
            headers=headers,
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
