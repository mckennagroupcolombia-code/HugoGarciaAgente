"""
Salud del negocio: rentabilidad neta semanal/mensual, cruzando ingresos
(MeLi + web) contra costo de producto, comisiones/envío MeLi, gasto en
publicidad (Product Ads) y costos administrativos/fijos (nómina + servicios).

Nada de esto existía cruzado en un solo lugar — cada pieza vivía aislada:
costos de producto y cobros MeLi en `app.services.rentabilidad`, gasto en
ads en `app.services.meli_ads`, nómina/servicios en
`app.services.contabilidad_db`. Este módulo solo agrega y cruza; no
reimplementa ninguna de esas fuentes.

Aproximaciones documentadas (no hay forma exacta con los datos disponibles
hoy — mejor una cifra aproximada y honesta que ninguna):

  1. Comisión/envío MeLi histórico: MeLi no expone el cobro real facturado
     por una orden pasada sin una API de billing aparte. Se aplica la
     tarifa ACTUAL por SKU (`rentabilidad.listar_cobros_meli`) a las
     unidades vendidas en cada período — razonable a corto plazo, se
     degrada cuanto más viejo es el período (si MeLi cambió comisiones).
  2. Nómina: no hay tabla de pagos históricos de nómina, solo el total
     mensual vigente (`contabilidad_db.resumen_nomina`). Se prorratea ese
     total por los días del bucket — es costo DEVENGADO, no caja real.
  3. Servicios/fijos: sí hay pagos reales con fecha
     (`contabilidad_db.pagos_servicios_en_rango`), se usan tal cual — caja
     real. Mezcla intencional de devengado (nómina) y caja (servicios),
     igual que otros reportes del repo (ver `reporte_financiero.py`).
  4. Gasto en ads por período: se pide el total de CAMPAÑA (no por ítem)
     por rango vía `meli_ads.gasto_ads_por_rango` — 1 llamada por bucket,
     no una por producto × semana (con ~600-700 anuncios activos, hacerlo
     por ítem sería carísimo en llamadas a la API de MeLi).
  5. Comisión de pasarela de pago en ventas web (Mercado Pago): NO se
     descuenta — no hay ninguna fuente en el repo que la registre hoy. La
     utilidad web reportada aquí está, por tanto, levemente sobreestimada.
"""

from __future__ import annotations

import sqlite3
from calendar import monthrange
from datetime import date, datetime, timedelta

from app.tools.web_pedidos import ORDERS_DB

# Mismos cortes de calificación que `colorNota` en el frontend
# (desktop/src/components/ui/ScoreRing.tsx) — si cambian allá, cambiar acá.
_CORTES_CALIFICACION = (
    (85, "excelente"),
    (70, "bueno"),
    (50, "regular"),
)


def _calificacion(score: float) -> str:
    for corte, nombre in _CORTES_CALIFICACION:
        if score >= corte:
            return nombre
    return "riesgo"


def _interp(x: float, puntos: list[tuple[float, float]]) -> float:
    """Interpolación lineal por tramos; `puntos` ordenados por x ascendente."""
    if x <= puntos[0][0]:
        return puntos[0][1]
    if x >= puntos[-1][0]:
        return puntos[-1][1]
    for (x0, y0), (x1, y1) in zip(puntos, puntos[1:]):
        if x0 <= x <= x1:
            if x1 == x0:
                return y0
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return puntos[-1][1]


# ─── Score de salud (regla de negocio auditable, mismo espíritu que
#     NIVELES_ACOS en meli_ads_recomendaciones.py) ──────────────────────────

_PUNTOS_MARGEN = [(-10.0, 0.0), (0.0, 20.0), (5.0, 40.0), (15.0, 70.0), (25.0, 100.0)]
_PUNTOS_ACOS = [(0.0, 100.0), (40.0, 100.0), (100.0, 0.0)]
_PESO_MARGEN = 0.6
_PESO_ADS = 0.2
_PESO_TENDENCIA = 0.2


def _score_bucket(margen_pct: float, acos_pct: float | None, margen_pct_anterior: float | None) -> dict:
    score_margen = _interp(margen_pct, _PUNTOS_MARGEN)
    score_ads = 100.0 if not acos_pct else _interp(acos_pct, _PUNTOS_ACOS)
    if margen_pct_anterior is None:
        score_tendencia = 50.0
    else:
        delta = margen_pct - margen_pct_anterior
        score_tendencia = max(0.0, min(100.0, 50.0 + delta * 2))

    score = round(
        score_margen * _PESO_MARGEN + score_ads * _PESO_ADS + score_tendencia * _PESO_TENDENCIA
    )
    score = max(0, min(100, score))
    return {
        "score": score,
        "calificacion": _calificacion(score),
        "componentes": {
            "margen": round(score_margen, 1),
            "eficiencia_ads": round(score_ads, 1),
            "tendencia": round(score_tendencia, 1),
        },
    }


# ─── Bucketing de fechas ──────────────────────────────────────────────────

_MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _lunes_semana(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _rangos_semanas(n: int) -> list[dict]:
    hoy = datetime.now().date()
    lunes_actual = _lunes_semana(hoy)
    rangos = []
    for i in range(n - 1, -1, -1):
        inicio = lunes_actual - timedelta(weeks=i)
        fin = min(inicio + timedelta(days=6), hoy)
        anio, semana, _ = inicio.isocalendar()
        rangos.append({
            "inicio": inicio.strftime("%Y-%m-%d"),
            "fin": fin.strftime("%Y-%m-%d"),
            "label": f"Sem {semana}",
            "dias": (fin - inicio).days + 1,
        })
    return rangos


def _rangos_meses(n: int) -> list[dict]:
    hoy = datetime.now().date()
    metas: list[tuple[int, int]] = []
    y, m = hoy.year, hoy.month
    for i in range(n - 1, -1, -1):
        mm = m - i
        yy = y
        while mm <= 0:
            mm += 12
            yy -= 1
        metas.append((yy, mm))
    rangos = []
    for yy, mm in metas:
        inicio = date(yy, mm, 1)
        fin = min(date(yy, mm, monthrange(yy, mm)[1]), hoy)
        rangos.append({
            "inicio": inicio.strftime("%Y-%m-%d"),
            "fin": fin.strftime("%Y-%m-%d"),
            "label": f"{_MESES_ES[mm - 1]} {yy}",
            "dias": (fin - inicio).days + 1,
        })
    return rangos


# ─── Ingresos y costo de producto por canal ──────────────────────────────

def _ventas_meli_crudas(dias_atras: int) -> list[dict]:
    from app.services.meli import listar_ordenes_meli_por_estado

    return listar_ordenes_meli_por_estado("paid", dias_atras=dias_atras)


def _acumular_orden_meli(orden: dict, acc: dict, relacion_por_mid: dict, costos: dict, cobros_por_sku: dict) -> None:
    acc["ingresos"] += float(orden.get("total_amount") or 0)
    for oi in orden.get("order_items") or []:
        item_info = oi.get("item") or {}
        mid = str(item_info.get("id") or "").strip().upper()
        qty = float(oi.get("quantity") or 0)
        if not mid or qty <= 0:
            continue
        rel = relacion_por_mid.get(mid)
        sku = (rel or {}).get("sku", "").upper()
        if not sku:
            continue
        costo_info = costos.get(sku)
        if costo_info:
            acc["costo_producto"] += float(costo_info.get("costo_total") or 0) * qty
        cobro = cobros_por_sku.get(sku)
        if cobro:
            cargo = float(cobro.get("cargo_venta") or 0) + float(cobro.get("cargo_envio") or 0)
            acc["comisiones_meli"] += cargo * qty


def _ventas_web_en_rango(fecha_inicio: str, fecha_fin: str) -> dict:
    """Ingresos + detalle de ítems de pedidos web pagados (`status='approved'`) en el rango."""
    acc = {"ingresos": 0.0, "items": []}
    if not ORDERS_DB.exists():
        return acc
    con = sqlite3.connect(str(ORDERS_DB))
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """SELECT total, items_json, created_at FROM orders
               WHERE status = 'approved'
                 AND substr(created_at, 1, 10) BETWEEN ? AND ?""",
            (fecha_inicio, fecha_fin),
        ).fetchall()
    finally:
        con.close()

    import json as _json

    for row in rows:
        acc["ingresos"] += float(row["total"] or 0)
        try:
            data = _json.loads(row["items_json"] or "{}")
        except _json.JSONDecodeError:
            continue
        for it in data.get("items") or []:
            ref = str(it.get("ref") or "").strip().upper()
            qty = float(it.get("qty") or 0)
            if ref and qty > 0:
                acc["items"].append({"sku": ref, "qty": qty})
    return acc


def _costo_producto_web(items: list[dict], costos: dict) -> float:
    total = 0.0
    for it in items:
        info = costos.get(it["sku"])
        if info:
            total += float(info.get("costo_total") or 0) * it["qty"]
    return total


# ─── Costos administrativos ───────────────────────────────────────────────

def _costo_admin_en_rango(rango: dict, total_mensual_nomina: float) -> dict:
    from app.services.contabilidad_db import pagos_servicios_en_rango

    inicio = date.fromisoformat(rango["inicio"])
    dias_del_mes = monthrange(inicio.year, inicio.month)[1]
    nomina_prorrateada = (total_mensual_nomina / dias_del_mes) * rango["dias"] if dias_del_mes else 0.0

    pagos = pagos_servicios_en_rango(rango["inicio"], rango["fin"])
    servicios_total = sum(float(p.get("monto") or 0) for p in pagos)

    return {
        "nomina": round(nomina_prorrateada, 2),
        "servicios": round(servicios_total, 2),
        "total": round(nomina_prorrateada + servicios_total, 2),
    }


# ─── Orquestador ──────────────────────────────────────────────────────────

def salud_negocio_resumen(periodicidad: str = "semana", n: int = 8, refresh: bool = False) -> dict:
    """
    Devuelve una fila de P&L por bucket (semana o mes) + score de salud, más
    un resumen del período actual vs el anterior. Ver docstring del módulo
    para las aproximaciones asumidas (comisión MeLi actual aplicada
    retroactivamente, nómina prorrateada, sin comisión de pasarela web).
    """
    from app.services.contabilidad_db import resumen_nomina
    from app.services.meli_ads import gasto_ads_por_rango
    from app.services.rentabilidad import (
        _sku_canonico_desde_relacion,
        costos_todos_resumen,
        listar_cobros_meli,
    )

    periodicidad = periodicidad if periodicidad in ("semana", "mes") else "semana"
    n = max(1, min(int(n or 8), 26 if periodicidad == "semana" else 12))

    rangos = _rangos_semanas(n) if periodicidad == "semana" else _rangos_meses(n)

    # Fuentes compartidas por todos los buckets (una sola carga, no una por bucket)
    dias_atras_meli = (datetime.now().date() - date.fromisoformat(rangos[0]["inicio"])).days + 2
    ordenes_meli = _ventas_meli_crudas(dias_atras_meli)
    relacion_por_mid = _sku_canonico_desde_relacion()
    costos = costos_todos_resumen(refresh=refresh)
    cobros = listar_cobros_meli(refresh=refresh)
    cobros_por_sku = {(c.get("sku") or "").upper(): c for c in cobros.get("items") or [] if c.get("sku")}
    total_mensual_nomina = resumen_nomina().get("total_mensual", 0.0)

    filas: list[dict] = []
    margen_anterior: float | None = None

    for rango in rangos:
        acc = {"ingresos": 0.0, "costo_producto": 0.0, "comisiones_meli": 0.0}
        for orden in ordenes_meli:
            fecha_orden = (orden.get("date_created") or "")[:10]
            if rango["inicio"] <= fecha_orden <= rango["fin"]:
                _acumular_orden_meli(orden, acc, relacion_por_mid, costos, cobros_por_sku)

        web = _ventas_web_en_rango(rango["inicio"], rango["fin"])
        costo_producto_web = _costo_producto_web(web["items"], costos)

        ads = gasto_ads_por_rango(rango["inicio"], rango["fin"])
        admin = _costo_admin_en_rango(rango, total_mensual_nomina)

        ingresos_total = acc["ingresos"] + web["ingresos"]
        costo_producto_total = acc["costo_producto"] + costo_producto_web
        utilidad_neta = (
            ingresos_total
            - costo_producto_total
            - acc["comisiones_meli"]
            - ads["costo"]
            - admin["total"]
        )
        margen_pct = round(utilidad_neta / ingresos_total * 100, 2) if ingresos_total > 0 else 0.0

        salud = _score_bucket(margen_pct, ads.get("acos"), margen_anterior)
        margen_anterior = margen_pct

        filas.append({
            **rango,
            "ingresos_meli": round(acc["ingresos"], 2),
            "ingresos_web": round(web["ingresos"], 2),
            "ingresos_total": round(ingresos_total, 2),
            "costo_producto": round(costo_producto_total, 2),
            "comisiones_meli": round(acc["comisiones_meli"], 2),
            "gasto_ads": round(ads["costo"], 2),
            "acos_ads": ads.get("acos"),
            "costos_admin": admin,
            "utilidad_neta": round(utilidad_neta, 2),
            "margen_pct": margen_pct,
            **salud,
        })

    actual = filas[-1] if filas else None
    anterior = filas[-2] if len(filas) > 1 else None
    tendencia_margen_pp = (
        round(actual["margen_pct"] - anterior["margen_pct"], 2) if actual and anterior else None
    )

    return {
        "periodicidad": periodicidad,
        "n": n,
        "generado_en": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "buckets": filas,
        "actual": actual,
        "tendencia_margen_pp": tendencia_margen_pp,
    }
