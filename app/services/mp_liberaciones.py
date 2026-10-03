"""El lote de MercadoPago detrás de cada retiro al banco.

Un «PAGO INTERBANC MERCADOPAGO SA» en Bancolombia no es una venta: es plata
propia que ya estaba en MercadoPago y se trajo al banco. Las ventas de MeLi
entran a MercadoPago una por una; MercadoPago las **libera** (las deja
disponibles) días después de la entrega; y el retiro es una cifra redonda que
alguien pide contra el saldo disponible. Para saber a qué ventas corresponde un
retiro no hay que adivinar: MercadoPago sabe qué pagos liberó y cuándo. El lote
de un retiro es todo lo liberado desde el retiro anterior hasta éste, y la
diferencia con lo retirado es lo que sigue en la plataforma.

Solo lee: de la API de MercadoPago (`/v1/payments/search` por fecha de
liberación, con el token de la tienda) y del libro propio.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Callable

MP_API = "https://api.mercadopago.com"
# orden MeLi → factura (lo mantiene el cron de facturación MeLi / AstroSelling).
_INDICE_FACTURAS = os.getenv(
    "FACTURACION_MELI_INDEX",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "facturacion_meli_index.json"),
)


# orden MeLi → cómo la facturó el flujo propio (Flujo G / «Facturar ahora»). Es
# el único sitio local con el NÚMERO de la factura Alegra (FE196…) y con el
# shipping_id de la orden: el índice de arriba guarda la factura pero sin número.
_ENTREGAS = os.getenv(
    "MELI_FACTURAS_ENTREGA_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "meli_facturas_entrega.json"),
)
_ESTADOS_FACTURADA = {"facturada", "ya_facturada_legado"}


def _facturas_por_orden() -> dict[str, dict[str, Any]]:
    try:
        with open(_INDICE_FACTURAS, encoding="utf-8") as fh:
            return (json.load(fh) or {}).get("indice") or {}
    except (OSError, ValueError):
        return {}


def _entregas_por_orden() -> dict[str, dict[str, Any]]:
    try:
        with open(_ENTREGAS, encoding="utf-8") as fh:
            return (json.load(fh) or {}).get("procesadas") or {}
    except (OSError, ValueError):
        return {}


def _factura_de_orden(order_id: str, pack: str, indice: dict, entregas: dict) -> dict[str, Any] | None:
    """La factura de una orden: primero el registro del flujo propio (trae el
    número), luego el índice por orden y por pack (lo usa la vía Siigo /
    astroselling, que cita el pack en las observaciones)."""
    e = entregas.get(order_id) or {}
    numero = str(e.get("siigo_invoice_number") or "") if e.get("estado") in _ESTADOS_FACTURADA else ""
    f = indice.get(order_id) or (indice.get(pack) if pack else None)
    if not f and not numero:
        return None
    f = f or {}
    return {
        "numero": numero or str(f.get("factura_numero") or "") or (f"#{f['factura_id']}" if f.get("factura_id") else ""),
        "fecha": f.get("factura_fecha"),
        "total": f.get("total"),
    }


def _clase_pago(p: dict[str, Any], collector_propio: Any) -> str:
    """Qué es cada pago que MercadoPago liberó. Solo `venta` tiene orden, asiento
    y factura; lo demás se muestra pero no se le exige nada de eso.

    - `envio`: lo que el comprador pagó por el envío (`marketplace_shipment`). En
      esos pagos `order.id` NO es la orden: es el shipping_id del envío.
    - `bonificacion`: lo que MeLi reconoce por entregas Flex.
    - `venta_web`: cobro de un pedido de la tienda (referencia `MCKG-…`).
    - `pago_a_meli`: McKenna es quien paga (p. ej. «Facturas con cargos por
      operar», $11,7M liberados el 1-sep). Lo que se libera ahí es la plata de
      MeLi; de la cuenta de McKenna salió el día del pago, así que no entra en
      las sumas del lote. Contarlo como liberación inflaba el lote de un retiro
      en esa cifra.
    """
    if collector_propio is not None and p.get("collector_id") != collector_propio:
        return "pago_a_meli"
    desc = (p.get("descripcion") or "").strip().lower()
    if desc == "marketplace_shipment":
        return "envio"
    if desc.startswith("bonificaciones_flex"):
        return "bonificacion"
    if p.get("order_id"):
        return "venta"
    if str(p.get("referencia") or "").upper().startswith("MCKG-"):
        return "venta_web"
    return "otro"


def _token() -> str:
    tok = (os.getenv("MP_ACCESS_TOKEN") or "").strip()
    if not tok:
        raise ValueError("Falta MP_ACCESS_TOKEN: el token de MercadoPago de la tienda")
    return tok


def _get(url: str, params: dict, token: str) -> dict:
    import requests

    r = requests.get(url, params=params, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code != 200:
        raise ValueError(f"MercadoPago {r.status_code}: {r.text[:200]}")
    return r.json()


def pagos_liberados(desde: str, hasta: str, *, _get: Callable = _get) -> list[dict[str, Any]]:
    """Pagos aprobados cuya plata MercadoPago liberó entre `desde` y `hasta`
    (fechas YYYY-MM-DD, inclusive), con lo que hace falta para cruzarlos:
    la orden de MeLi, el bruto, la comisión y el neto que quedó disponible."""
    token = _token()
    salida: list[dict[str, Any]] = []
    offset = 0
    while True:
        data = _get(
            f"{MP_API}/v1/payments/search",
            {
                "range": "money_release_date",
                "begin_date": f"{desde}T00:00:00.000-05:00",
                "end_date": f"{hasta}T23:59:59.999-05:00",
                "status": "approved",
                "sort": "money_release_date",
                "criteria": "asc",
                "limit": 100,
                "offset": offset,
            },
            token,
        )
        resultados = data.get("results") or []
        for p in resultados:
            orden = p.get("order") or {}
            det = p.get("transaction_details") or {}
            comision = round(sum(float(f.get("amount") or 0) for f in (p.get("fee_details") or [])), 2)
            salida.append({
                "payment_id": str(p.get("id") or ""),
                "collector_id": p.get("collector_id"),
                "order_id": str(orden.get("id") or "") if (orden.get("type") or "") == "mercadolibre" else "",
                "referencia": str(p.get("external_reference") or ""),
                "fecha_pago": str(p.get("date_approved") or "")[:10],
                "fecha_liberacion": str(p.get("money_release_date") or "")[:10],
                "bruto": round(float(p.get("transaction_amount") or 0), 2),
                "comision": comision,
                "neto": round(float(det.get("net_received_amount") or 0), 2),
                "descripcion": str(p.get("description") or "")[:80],
                "estado_liberacion": str(p.get("money_release_status") or ""),
            })
        total = int((data.get("paging") or {}).get("total") or 0)
        offset += len(resultados)
        if not resultados or offset >= total:
            break
    return salida


def _retiros_en_banco(hasta: str, tercero_id: int | None = None) -> list[dict[str, Any]]:
    """Las entradas desde MercadoPago en el extracto, hasta la fecha, más viejas primero."""
    from app.services import extracto_bancario as eb

    eb.ensure_extracto_tables()
    w, p = eb._filtro_titular(tercero_id)
    with eb._conn() as con:
        filas = con.execute(
            f"""SELECT m.id, m.fecha, m.monto FROM extracto_movimientos m
                  JOIN extractos_bancarios e ON e.id = m.extracto_id
                 WHERE {w} AND m.tipo = 'credito' AND m.fecha <= ?
                   AND (upper(m.descripcion) LIKE '%MERCADOPAGO%' OR upper(m.descripcion) LIKE '%MERCADO PAGO%')
                 ORDER BY m.fecha, m.id""",
            (*p, hasta),
        ).fetchall()
    return [dict(f) for f in filas]


def _asientos_meli_por_orden(order_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Qué órdenes ya tienen su asiento de venta en el libro propio (auto_meli_venta)."""
    import app.services.contabilidad_core as cc

    if not order_ids:
        return {}
    salida: dict[str, dict[str, Any]] = {}
    with cc._conn() as con:
        for f in con.execute(
            """SELECT id, fecha, plantilla_datos_json FROM cc_movimientos
                WHERE tipo_origen = 'auto_meli_venta' AND estado <> 'anulado'
                  AND json_extract(plantilla_datos_json, '$.extra.order_id') IN (%s)""" % ",".join("?" * len(order_ids)),
            order_ids,
        ):
            try:
                fila = json.loads(f["plantilla_datos_json"] or "{}")
            except ValueError:
                fila = {}
            oid = str((fila.get("extra") or {}).get("order_id") or "")
            salida[oid] = {"movimiento_id": f["id"], "fecha": f["fecha"], "monto": fila.get("monto"), "pack": fila.get("referencia")}
    return salida


def lote_de_retiro(linea_id: int, *, tercero_id: int | None = None,
                   _pagos: Callable[[str, str], list[dict[str, Any]]] = pagos_liberados) -> dict[str, Any]:
    """El lote detrás de un retiro: qué liberó MercadoPago desde el retiro
    anterior, cuánto suma, cuánto se retiró y cuánto quedó en la plataforma.

    La ventana empieza el día siguiente al retiro anterior (lo liberado ese
    mismo día ya pudo salir en él) y termina el día del retiro. Es una
    aproximación honesta: MercadoPago libera durante el día y el retiro se
    pide a una hora; lo que no alcanzó a salir queda como saldo en plataforma
    y aparece en el lote siguiente. Por eso se informa el acumulado.
    """
    retiros = _retiros_en_banco("9999-12-31", tercero_id)
    actual = next((r for r in retiros if int(r["id"]) == int(linea_id)), None)
    if not actual:
        raise ValueError("Esa línea del banco no es un retiro desde MercadoPago")
    previos = [r for r in retiros if (r["fecha"], r["id"]) < (actual["fecha"], actual["id"])]
    anterior = previos[-1] if previos else None
    desde = (datetime.strptime(anterior["fecha"], "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d") if anterior else \
        (datetime.strptime(actual["fecha"], "%Y-%m-%d") - timedelta(days=14)).strftime("%Y-%m-%d")
    hasta = actual["fecha"]

    pagos = _pagos(desde, hasta)
    # La cuenta propia es la que COBRA casi todos los pagos del lote; un pago
    # cobrado por otro (o sin cobrador) lo hizo McKenna.
    cobradores = Counter(p.get("collector_id") for p in pagos if p.get("collector_id"))
    collector_propio = cobradores.most_common(1)[0][0] if cobradores else None
    indice = _facturas_por_orden()
    entregas = _entregas_por_orden()
    orden_por_envio = {str(e.get("shipping_id")): oid for oid, e in entregas.items() if e.get("shipping_id")}
    for p in pagos:
        p["clase"] = _clase_pago(p, collector_propio)
        p.pop("collector_id", None)
        p["shipping_id"] = p["order_id"] if p["clase"] == "envio" else ""
        p["orden_del_envio"] = orden_por_envio.get(p["shipping_id"], "") if p["shipping_id"] else ""
        if p["clase"] != "venta":
            p["order_id"] = ""
    ventas = [p for p in pagos if p["clase"] == "venta"]
    asientos = _asientos_meli_por_orden([p["order_id"] for p in ventas])
    for p in pagos:
        a = asientos.get(p["order_id"]) if p["clase"] == "venta" else None
        p["asiento"] = a
        p["pack"] = (a or {}).get("pack") or ""
        p["factura"] = _factura_de_orden(p["order_id"], p["pack"], indice, entregas) if p["clase"] == "venta" else None

    del_lote = [p for p in pagos if p["clase"] != "pago_a_meli"]
    bruto = round(sum(p["bruto"] for p in del_lote), 2)
    neto = round(sum(p["neto"] for p in del_lote), 2)
    comision = round(sum(p["comision"] for p in del_lote), 2)
    pagado_a_meli = round(sum(p["bruto"] for p in pagos if p["clase"] == "pago_a_meli"), 2)
    retirado = round(float(actual["monto"] or 0), 2)
    # Saldo que sigue en MercadoPago según el libro propio (111010), si ya se
    # contabiliza contra esa cuenta; si no, se informa lo que el lote deja.
    import app.services.contabilidad_core as cc

    from app.services.puc_colombia import CUENTA_MERCADOPAGO

    cuenta_mp = cc.codigo_vivo(CUENTA_MERCADOPAGO)
    saldo_111010 = _saldo_cuenta(cuenta_mp)
    return {
        "retiro": {"linea_id": actual["id"], "fecha": actual["fecha"], "monto": retirado},
        "retiro_anterior": anterior,
        "ventana": {"desde": desde, "hasta": hasta},
        "pagos": pagos,
        "n_pagos": len(pagos),
        "n_ventas": len(ventas),
        "n_con_asiento": sum(1 for p in ventas if p.get("asiento")),
        "n_con_factura": sum(1 for p in ventas if p.get("factura")),
        "liberado_bruto": bruto,
        "comisiones": comision,
        "pagado_a_meli": pagado_a_meli,
        "liberado_neto": neto,
        "retirado": retirado,
        "queda_en_plataforma": round(neto - retirado, 2),
        "cuenta_mp": cuenta_mp,
        "saldo_111010_libro": saldo_111010,
    }


def _saldo_cuenta(codigo: str) -> float | None:
    import app.services.contabilidad_core as cc

    with cc._conn() as con:
        fila = con.execute(
            """SELECT COALESCE(SUM(l.debito),0) - COALESCE(SUM(l.credito),0) AS s
                 FROM cc_movimiento_lineas l JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
                 JOIN cc_plan_cuentas c ON c.id = l.cuenta_id WHERE c.codigo = ?""",
            (codigo,),
        ).fetchone()
    return round(float(fila["s"] or 0), 2) if fila else None
