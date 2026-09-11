"""La factura mensual de MercadoLibre, desglosada y traducida al PUC.

Existe porque este gasto no se veía por ningún lado. MeLi cobra entre $44 y $47
millones al mes —de los cuales ~$24M son publicidad— y **nada de eso aparece en
el extracto bancario**: la factura se paga contra el saldo de MercadoPago, no
por transferencia. Lo único que se ve en el banco es el traslado que fondea esa
cuenta. Sin leer la factura, la segunda línea de gasto de la empresa es invisible.

Tampoco sirve la API de métricas de Product Ads: para ago-2026 reportó $654.448
de costo cuando la factura cobró $23.853.390. La factura es la fuente de verdad;
las métricas sirven para decidir campañas, no para contabilizar.

Endpoints (confirmados en vivo el 2026-09-11):
  GET /billing/integration/monthly/periods?group=ML&document_type=BILL
  GET /billing/integration/periods/key/{key}/group/ML/details?document_type=BILL

⚠️ **5 peticiones por minuto.** Un período de 2.600 líneas son 3 páginas de
1.000; tres meses ya rozan el límite. `_get()` pacea solo y reintenta el 429.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

import requests

_BASE = "https://api.mercadolibre.com/billing/integration"
_GRUPO_DEFAULT = "ML"
_PAGINA = 1000

# MeLi limita a 5 peticiones por minuto este recurso. 13s deja margen.
_ESPERA_SEGUNDOS = 13.0
_lock = threading.Lock()
_ultima_llamada = [0.0]

_CACHE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "meli_facturacion_cache.json")

# Un `detail_sub_type` que empieza por «B» es una anulación (BV anula CV, BXD
# anula CXD, BFF anula CFF) y **resta**. La API la manda con importe positivo y
# sin marcarla como CREDIT, así que hay que deducirlo del código. Verificado
# contra el total oficial del período en jul y ago 2026: sumando todo en
# positivo sobraba exactamente 2× el valor de las anulaciones.
def es_anulacion(sub_type: str) -> bool:
    return str(sub_type or "").upper().startswith("B")


# Concepto de MeLi → cuenta del PUC interno.
MAPA_PUC: dict[str, str] = {
    "PADS": "529505",   # Publicidad en plataformas de venta
    "CV":   "5299",     # Comisiones por venta
    "CXD":  "513550",   # Envíos — transporte y fletes
    "CFF":  "513550",
    "CFCB": "513550",   # Colecta Full
    "CFBA": "513550",   # Stock antiguo en Full — bodegaje de la plataforma
    "CFPB": "513550",   # Incumplimiento en envíos Full
    "CESM": "513560",   # Mantenimiento de Mi Página → software y suscripciones
    "CDSD": "5299",     # Cargo por devolución
}


def cuenta_para(sub_type: str) -> str | None:
    """Cuenta del PUC de un concepto de la factura.

    Una anulación va a la misma cuenta que el cargo que anula, y MeLi nombra los
    pares de forma regular: BV anula CV, BXD anula CXD, BFF anula CFF. Cambiar
    la «B» inicial por «C» resuelve el par sin tener que listarlos uno por uno —
    y cubre el que MeLi estrene mañana.
    """
    cod = str(sub_type or "").upper()
    if cod in MAPA_PUC:
        return MAPA_PUC[cod]
    if es_anulacion(cod):
        return MAPA_PUC.get("C" + cod[1:])
    return None


def _get(url: str, params: dict, token: str) -> requests.Response:
    """Pacea a 5 req/min y reintenta una vez si MeLi igual responde 429."""
    for intento in range(2):
        with _lock:
            espera = _ESPERA_SEGUNDOS - (time.time() - _ultima_llamada[0])
            if espera > 0:
                time.sleep(espera)
            _ultima_llamada[0] = time.time()
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"},
                         params=params, timeout=60)
        if r.status_code != 429:
            return r
        time.sleep(20)
    return r


def _token() -> str:
    from app.utils import refrescar_token_meli

    tok = refrescar_token_meli()
    if isinstance(tok, dict):
        tok = tok.get("access_token")
    if not tok:
        raise RuntimeError("No se pudo obtener el token de MercadoLibre.")
    return str(tok)


def listar_periodos(grupo: str = _GRUPO_DEFAULT, limite: int = 12) -> list[dict[str, Any]]:
    """Facturas mensuales: clave del período, rango de fechas, total y si está paga."""
    r = _get(f"{_BASE}/monthly/periods",
             {"group": grupo, "document_type": "BILL", "offset": 0, "limit": limite}, _token())
    r.raise_for_status()
    salida = []
    for p in r.json().get("results") or []:
        per = p.get("period") or {}
        salida.append({
            "key": p.get("key"),
            "desde": per.get("date_from"),
            "hasta": per.get("date_to"),
            "total": float(p.get("amount") or 0),
            "sin_pagar": float(p.get("unpaid_amount") or 0),
            "estado": p.get("period_status"),
            "vence": p.get("expiration_date"),
        })
    return salida


def _leer_cache() -> dict:
    try:
        with open(_CACHE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}


def desglose_periodo(key: str, grupo: str = _GRUPO_DEFAULT, *, usar_cache: bool = True) -> dict[str, Any]:
    """Suma la factura por concepto y le pone la cuenta del PUC a cada uno.

    Un período CERRADO ya no cambia, así que se cachea a disco: volver a paginar
    2.600 líneas contra un recurso de 5 req/min cuesta más de un minuto cada vez.
    El período abierto nunca se sirve de caché — todavía le entran cargos.
    """
    cache = _leer_cache()
    if usar_cache and key in cache and cache[key].get("estado") == "CLOSED":
        return cache[key]

    token = _token()
    conceptos: dict[str, dict] = {}
    off = 0
    total_lineas = None
    while True:
        r = _get(f"{_BASE}/periods/key/{key}/group/{grupo}/details",
                 {"document_type": "BILL", "limit": _PAGINA, "offset": off}, token)
        r.raise_for_status()
        d = r.json()
        res = d.get("results") or []
        total_lineas = d.get("total") or 0
        for x in res:
            ci = x.get("charge_info") or {}
            cod = str(ci.get("detail_sub_type") or "?").upper()
            monto = float(ci.get("detail_amount") or 0)
            if es_anulacion(cod) or str(ci.get("detail_type") or "").upper() == "CREDIT":
                monto = -monto
            c = conceptos.setdefault(cod, {
                "codigo": cod,
                "descripcion": ci.get("transaction_detail") or "",
                "cuenta_puc": cuenta_para(cod),
                "lineas": 0, "monto": 0.0,
            })
            c["lineas"] += 1
            c["monto"] += monto
        off += len(res)
        if not res or off >= total_lineas:
            break

    for c in conceptos.values():
        c["monto"] = round(c["monto"], 2)

    periodo = next((p for p in listar_periodos(grupo) if p["key"] == key), {})
    salida = {
        "key": key,
        "grupo": grupo,
        "desde": periodo.get("desde"),
        "hasta": periodo.get("hasta"),
        "estado": periodo.get("estado"),
        "lineas": off,
        "total_calculado": round(sum(c["monto"] for c in conceptos.values()), 2),
        "total_meli": periodo.get("total"),
        "conceptos": sorted(conceptos.values(), key=lambda c: -c["monto"]),
        "sin_mapear": sorted(c["codigo"] for c in conceptos.values() if not c["cuenta_puc"]),
    }
    # Si el total calculado no coincide con el que MeLi declara, hay un concepto
    # con signo mal interpretado. Se avisa en vez de contabilizar una cifra que
    # no cuadra con la factura que el proveedor va a cobrar.
    if salida["total_meli"] is not None:
        salida["cuadra"] = abs(salida["total_calculado"] - salida["total_meli"]) < 1.0

    cache[key] = salida
    try:
        os.makedirs(os.path.dirname(_CACHE), exist_ok=True)
        with open(_CACHE, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, ensure_ascii=False, indent=1)
    except OSError:
        pass
    return salida


def lineas_asiento(key: str, grupo: str = _GRUPO_DEFAULT) -> list[dict[str, Any]]:
    """El desglose ya como líneas de asiento, contra el saldo de MercadoPago.

    La factura no se paga por banco: se cobra contra 111010. Por eso la
    contrapartida de todo el gasto es esa cuenta y no 1110 — registrarlo contra
    Bancos descuadraría la conciliación, porque ese débito nunca existió.
    """
    d = desglose_periodo(key, grupo)
    if not d.get("cuadra", True):
        raise ValueError(
            f"El desglose de {key} suma {d['total_calculado']:,.0f} pero MeLi factura "
            f"{d['total_meli']:,.0f}. No se arma el asiento hasta entender la diferencia."
        )
    lineas = []
    for c in d["conceptos"]:
        if not c["cuenta_puc"]:
            raise ValueError(f"Concepto {c['codigo']} ({c['descripcion']}) sin cuenta PUC asignada.")
        if c["monto"] >= 0:
            lineas.append({"cuenta": c["cuenta_puc"], "debito": c["monto"], "credito": 0,
                           "descripcion": f"{c['descripcion']} ({c['codigo']})"})
        else:
            lineas.append({"cuenta": c["cuenta_puc"], "debito": 0, "credito": -c["monto"],
                           "descripcion": f"{c['descripcion']} ({c['codigo']})"})
    lineas.append({"cuenta": "111010", "debito": 0, "credito": d["total_calculado"],
                   "descripcion": f"Factura MercadoLibre período {key}"})
    return lineas
