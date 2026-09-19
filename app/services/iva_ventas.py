"""Reconocimiento del IVA de las ventas: sacarlo de Ingresos y dejarlo como pasivo.

**Qué estaba mal.** Cada venta se contabilizaba por su total contra Ingresos:

    1110 Bancos      D $41.776
    4135 Ingresos              C $41.776

Pero McKenna es responsable de IVA: de esos $41.776 una parte no es ingreso
suyo, es IVA que cobró de paso y le debe a la DIAN. El resultado eran dos
errores a la vez — los ingresos inflados y el IVA sin reconocer como pasivo, de
modo que al ir a pagar la declaración no había contra qué bajarla.

**De dónde sale la cifra.** De las facturas emitidas en Alegra, no de aplicar
19% al total. No todo lleva IVA: en una muestra de 300 facturas había 484 ítems
al 19% y 12 sin IVA (materias primas excluidas, Art. 424 E.T.). Dividir todo por
1,19 inventaría IVA sobre lo excluido y lo declararía de más. La factura es
además el documento que ve la DIAN: si el libro y la factura discrepan, la que
manda es la factura.

**Por qué un asiento de ajuste por período y no tocar cada venta.** Las ventas
ya están asentadas —1.269 asientos— y vienen de MeLi, la web y Siigo, que
entregan el total sin desglose. Reescribirlas una por una sería rehacer el
libro; el ajuste mensual reclasifica lo mismo, es reversible y deja la huella de
cuándo se hizo:

    4135 Ingresos       D  (el IVA que estaba inflando ventas)
    240805 IVA generado         C

Idempotente por `referencia = "iva-ventas:<periodo>"`: volver a correrlo no
duplica nada.

**Lo que este módulo NO hace:** el IVA descontable de las compras (240810). El
formulario 300 declara generado menos descontable, así que con solo esta mitad
el saldo de 2408 queda por encima de lo que realmente se paga. Esa mitad sale de
las facturas de compra y es un paso aparte.
"""

from __future__ import annotations

import os
from typing import Any

import requests

_BASE = "https://api.alegra.com/api/v1"
CUENTA_INGRESOS = "4135"
CUENTA_IVA_GENERADO = "240805"


def _headers() -> dict:
    from app.services.alegra_puc import _headers as h

    return h()


def _facturas_siigo(desde: str, hasta: str) -> list[dict]:
    """Facturas de Siigo del rango, con el IVA sacado de los ítems.

    Siigo no da `subtotal` ni un total de impuestos en la cabecera: el IVA vive
    en `items[].taxes[].value`. Se suma de ahí y la base es el total menos ese
    IVA — son las cifras de la propia factura, no una tarifa aplicada por fuera.
    """
    from app.services.siigo import obtener_facturas_siigo_paginadas

    salida = []
    for f in obtener_facturas_siigo_paginadas(desde) or []:
        fecha = str(f.get("date") or "")[:10]
        if not (desde <= fecha <= hasta):
            continue
        total = round(float(f.get("total") or 0), 2)
        if total <= 0:
            continue
        iva = 0.0
        for it in f.get("items") or []:
            for t in it.get("taxes") or []:
                if str(t.get("type") or "").upper() == "IVA":
                    iva += float(t.get("value") or 0)
        iva = round(iva, 2)
        salida.append({
            "id": str(f.get("id")),
            "numero": f"{f.get('prefix') or ''}{f.get('number') or ''}".strip() or str(f.get("id")),
            "fecha": fecha,
            "base": round(total - iva, 2),
            "iva": iva,
            "total": total,
            "anulada": False,   # en Siigo la anulación es una nota crédito aparte
            "cliente": str((f.get("customer") or {}).get("identification") or ""),
            "sistema": "siigo",
        })
    return salida


def facturas_del_periodo(desde: str, hasta: str, limite_paginas: int = 40) -> list[dict]:
    """Facturas de venta emitidas en el rango, con su base y su IVA.

    Se lee de la facturación, no del caché local de ventas: ese caché guarda el
    total de la orden, que es justo el dato que no alcanza — hace falta el
    desglose que solo tiene la factura.

    **Dos sistemas.** McKenna migró a Alegra el 2026-09-02; antes de esa fecha
    las facturas están en Siigo. Consultar solo Alegra devolvía cero IVA para
    julio y agosto —meses que sí lo tuvieron— y reconocerlo así habría dejado
    dos períodos sin declarar.
    """
    from app.services.alegra import FECHA_CORTE_MIGRACION_ALEGRA

    salida: list[dict] = []
    if desde < FECHA_CORTE_MIGRACION_ALEGRA:
        salida.extend(_facturas_siigo(desde, min(hasta, FECHA_CORTE_MIGRACION_ALEGRA)))
    if hasta < FECHA_CORTE_MIGRACION_ALEGRA:
        return salida
    desde = max(desde, FECHA_CORTE_MIGRACION_ALEGRA)

    headers = _headers()
    start = 0
    for _ in range(limite_paginas):
        r = requests.get(
            f"{_BASE}/invoices", headers=headers,
            params={"limit": 30, "start": start, "date_afterOrNow": desde, "date_beforeOrNow": hasta},
            timeout=60,
        )
        if not r.ok:
            raise RuntimeError(f"Alegra respondió {r.status_code} al listar facturas: {r.text[:160]}")
        lote = r.json() or []
        if not lote:
            break
        for f in lote:
            fecha = str(f.get("date") or "")[:10]
            if not (desde <= fecha <= hasta):
                continue
            # `status` anulada/void: una factura anulada no genera IVA.
            estado = str(f.get("status") or "").lower()
            anulada = estado in ("void", "voided", "anulada", "cancelled", "canceled")
            salida.append({
                "id": str(f.get("id")),
                "numero": (f.get("numberTemplate") or {}).get("fullNumber") or str(f.get("id")),
                "fecha": fecha,
                "base": round(float(f.get("subtotal") or 0), 2),
                "iva": round(float(f.get("tax") or 0), 2),
                "total": round(float(f.get("total") or 0), 2),
                "anulada": anulada,
                "cliente": ((f.get("client") or {}).get("name") or ""),
                "sistema": "alegra",
            })
        start += 30
        if len(lote) < 30:
            break
    return salida


def notas_credito_del_periodo(desde: str, hasta: str) -> list[dict]:
    """Notas crédito del rango, con el IVA que **devuelven**.

    Sin esto el IVA se declara de más. Agosto-2026 tuvo 712 notas crédito por
    $44.441.972 —la campaña de corrección del IVA duplicado de astroselling, que
    anuló cada factura mala y reexpidió— con $4.560.640 de IVA. Contar solo las
    facturas dejaba ese IVA como deuda con la DIAN cuando la venta se había
    anulado.

    También es lo que explica el hueco entre lo facturado y el libro: $113,5M
    facturados menos $44,4M anulados son $69,1M, contra $66,7M registrados.
    """
    import requests

    from app.services.alegra import FECHA_CORTE_MIGRACION_ALEGRA

    salida: list[dict] = []

    def _agregar(id_, numero, fecha, total, iva, sistema):
        salida.append({
            "id": str(id_), "numero": numero, "fecha": fecha,
            "total": round(float(total or 0), 2), "iva": round(float(iva or 0), 2),
            "sistema": sistema,
        })

    def _iva_items(doc) -> float:
        iva = 0.0
        for it in doc.get("items") or []:
            for t in it.get("taxes") or it.get("tax") or []:
                if str(t.get("type") or t.get("name") or "").upper().startswith("IVA"):
                    # Siigo trae el valor; Alegra, el porcentaje.
                    if t.get("value") is not None:
                        iva += float(t.get("value") or 0)
                    else:
                        base = float(it.get("price") or 0) * float(it.get("quantity") or 1)
                        iva += base * float(t.get("percentage") or 0) / 100
        return iva

    if desde < FECHA_CORTE_MIGRACION_ALEGRA:
        from app.services.siigo import PARTNER_ID, autenticar_siigo

        tok = autenticar_siigo()
        h = {"Authorization": tok if str(tok).lower().startswith("bearer") else f"Bearer {tok}",
             "Partner-Id": PARTNER_ID, "Content-Type": "application/json"}
        hasta_siigo = min(hasta, FECHA_CORTE_MIGRACION_ALEGRA)
        pagina = 1
        while pagina <= 40:
            r = requests.get("https://api.siigo.com/v1/credit-notes", headers=h,
                             params={"created_start": desde, "created_end": hasta_siigo,
                                     "page": pagina, "page_size": 100}, timeout=60)
            if not r.ok:
                raise RuntimeError(f"Siigo respondió {r.status_code} al listar notas crédito")
            res = (r.json() or {}).get("results") or []
            if not res:
                break
            for x in res:
                _agregar(x.get("id"), f"{x.get('prefix') or ''}{x.get('number') or ''}",
                         str(x.get("date") or "")[:10], x.get("total"), _iva_items(x), "siigo")
            pagina += 1

    if not hasta or hasta >= FECHA_CORTE_MIGRACION_ALEGRA:
        desde_alegra = max(desde, FECHA_CORTE_MIGRACION_ALEGRA)
        start = 0
        while start < 1200:
            r = requests.get(f"{_BASE}/credit-notes", headers=_headers(),
                             params={"limit": 30, "start": start}, timeout=60)
            if not r.ok:
                break
            lote = r.json() or []
            if not lote:
                break
            for x in lote:
                fecha = str(x.get("date") or "")[:10]
                if desde_alegra <= fecha <= hasta:
                    _agregar(x.get("id"),
                             (x.get("numberTemplate") or {}).get("fullNumber") or x.get("id"),
                             fecha, x.get("total"), x.get("tax") or _iva_items(x), "alegra")
            start += 30
            if len(lote) < 30:
                break

    return salida


def resumen(desde: str, hasta: str) -> dict[str, Any]:
    """Base gravable, IVA generado y ventas sin IVA del período, más el contraste
    contra lo que el libro tiene como ingreso.

    El contraste importa: si el libro registra más ventas de las que se
    facturaron, hay ventas sin factura; si registra menos, hay facturas sin
    contabilizar. Reconocer el IVA sin mirar eso lo calcularía sobre una base
    que no corresponde.
    """
    import app.services.contabilidad_core as cc

    facturas = [f for f in facturas_del_periodo(desde, hasta) if not f["anulada"]]
    notas = notas_credito_del_periodo(desde, hasta)
    iva_nc = round(sum(n["iva"] for n in notas), 2)
    total_nc = round(sum(n["total"] for n in notas), 2)
    base = round(sum(f["base"] for f in facturas) - (total_nc - iva_nc), 2)
    iva = round(sum(f["iva"] for f in facturas) - iva_nc, 2)
    total = round(sum(f["total"] for f in facturas) - total_nc, 2)
    sin_iva = [f for f in facturas if f["iva"] <= 0]

    cc._ensure()
    with cc._conn() as con:
        r = con.execute(
            """SELECT COALESCE(SUM(l.credito),0) - COALESCE(SUM(l.debito),0) AS ingreso
                 FROM cc_movimiento_lineas l
                 JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
                 JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                WHERE c.codigo = ? AND m.fecha BETWEEN ? AND ?""",
            (CUENTA_INGRESOS, desde, hasta),
        ).fetchone()
        ingreso_libro = round(float(r["ingreso"] or 0), 2)

    return {
        "desde": desde, "hasta": hasta,
        "facturas": len(facturas),
        "notas_credito": len(notas),
        "iva_anulado": iva_nc,
        "total_anulado": total_nc,
        "base_gravable": base,
        "iva_generado": iva,
        "total_facturado": total,
        "facturas_sin_iva": len(sin_iva),
        "ingreso_en_libro": ingreso_libro,
        "diferencia_libro_vs_facturas": round(ingreso_libro - total, 2),
        "detalle": facturas,
    }


def _referencia(desde: str, hasta: str) -> str:
    return f"iva-ventas:{desde}..{hasta}"


def reconocer(desde: str, hasta: str, dry_run: bool = True) -> dict[str, Any]:
    """Saca de Ingresos el IVA del período y lo deja en 240805 IVA generado."""
    import app.services.contabilidad_core as cc

    datos = resumen(desde, hasta)
    iva = datos["iva_generado"]
    referencia = _referencia(desde, hasta)

    cc._ensure()
    with cc._conn() as con:
        ya = con.execute(
            "SELECT id FROM cc_movimientos WHERE referencia=? AND estado <> 'anulado'", (referencia,)
        ).fetchone()
        id_ingresos = cc._cuenta_id_por_codigo(con, CUENTA_INGRESOS)
        id_iva = cc._cuenta_id_por_codigo(con, CUENTA_IVA_GENERADO)
    if ya:
        return {**datos, "estado": "ya_reconocido", "movimiento_id": ya["id"], "dry_run": dry_run}
    if iva <= 0:
        return {**datos, "estado": "sin_iva", "dry_run": dry_run}
    if not (id_ingresos and id_iva):
        raise ValueError(f"Faltan las cuentas {CUENTA_INGRESOS} / {CUENTA_IVA_GENERADO} en el plan")

    lineas = [
        {"cuenta_id": id_ingresos, "debito": iva, "credito": 0,
         "descripcion": f"IVA que estaba dentro de los ingresos ({datos['facturas']} facturas)"},
        {"cuenta_id": id_iva, "debito": 0, "credito": iva,
         "descripcion": f"IVA generado {desde} a {hasta}"},
    ]
    if dry_run:
        return {**datos, "estado": "simulado", "lineas": lineas, "dry_run": True}

    mov = cc.crear_movimiento(
        fecha=hasta,
        concepto=f"IVA generado {desde} a {hasta} — reconocido desde las facturas emitidas",
        lineas=lineas,
        tipo_origen="iva_ventas",
        referencia=referencia,
    )
    return {**datos, "estado": "reconocido", "movimiento_id": mov["id"], "dry_run": False}
