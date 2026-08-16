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
  2. Nómina: no hay pagos históricos, solo el total mensual vigente (ver
     `_total_mensual_nomina` — fuente real: RRHH → Compensaciones, NO la
     tabla `contabilidad_db.empleados`, que está vacía en producción; hallazgo
     de la auditoría de ago-2026 que motivó este fallback, ver su docstring).
     Se prorratea ese total por los días del bucket — es costo DEVENGADO, no
     caja real.
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
  6. Gasto en ads más viejo de 90 días: MeLi RECHAZA (400) pedir métricas de
     campaña con `date_from` fuera de la ventana móvil de 90 días desde hoy
     — no hay forma de recuperar gasto en ads histórico más viejo que eso.
     CONFIRMADO ago-2026 también por el usuario desde el propio panel web de
     Mercado Ads (no solo la API): ahí tampoco deja ver ni exportar métricas
     de más de 90 días — es un límite duro y PERMANENTE de la plataforma, no
     un dato pendiente de conseguir por otra vía (revisado: los reportes de
     "Evolución del negocio" y "Rendimiento de publicaciones" de MeLi no
     traen gasto en ads, son de ventas/tráfico). Esos buckets quedan con
     `gasto_ads=0` PERO
     `ads_disponible=False` — la utilidad neta de esos meses NO incluye
     publicidad y está sobreestimada si en ese período sí hubo gasto real
     (que probablemente lo hubo). El panel debe mostrar esto como "sin
     datos", nunca como "$0 gastado" (bug real: la primera versión de este
     módulo mostró 9 meses seguidos de "0% en ads" que en realidad eran
     "dato no disponible", llevando a una conclusión equivocada sobre cuándo
     empezó a caer el margen).
  7. Ingresos de "otros canales" (`ingresos_otros_canales`): venta directa
     por WhatsApp (cliente escribe, el agente cotiza y factura con
     `crear_factura_completa_siigo`, el cliente paga por transferencia) NO
     tenía ningún rastro estructurado hasta ago-2026 — ni tabla, ni JSON, ni
     marca en la factura de Siigo. Investigado a fondo (wa_chats.db no
     captura el flujo de confirmación de pagos, no hay reporte de ventas por
     WhatsApp en ningún lado, comprobantes/ no tiene con qué cruzarse): no
     hay forma de reconstruir el histórico con certeza. Se aproxima por
     DESCARTE (`_ventas_otras_por_bucket`): toda factura de venta de Siigo
     del período que no matchee el patrón de Pack ID de MeLi ni la
     referencia MCKG- de la web. Ese "resto" es sobre todo venta directa por
     WhatsApp, pero también puede incluir cualquier otra factura manual
     (correcciones, pruebas, mostrador) — por eso `otros_canales_facturas`
     y `otros_canales_con_marcador_wa` van aparte, para que el panel pueda
     mostrar cuántas de esas facturas SÍ llevan el marcador nuevo (confianza
     alta) contra cuántas son de antes de ago-2026 (aproximación, sin forma
     de verificar). `crear_factura_completa_siigo` ahora escribe
     "Venta directa WhatsApp (agente IA)" en `observations` — las facturas
     NUEVAS de este canal quedan 100% identificables desde ese cambio.

Caché: un bucket (día, semana o mes) YA CERRADO no cambia — sus órdenes no se
reescriben — así que su cálculo se guarda en `app/data/salud_negocio_cache.json`
y no se vuelve a golpear MeLi/Siigo por él. Solo el bucket en curso se
recalcula en cada llamada. `refresh=True` fuerza recalcular los buckets
pedidos en esa llamada puntual (no vacía el caché completo).
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from calendar import monthrange
from datetime import date, datetime, timedelta

from app.tools.web_pedidos import ORDERS_DB

_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "salud_negocio_cache.json")
_RRHH_COMPENSACIONES_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "rrhh_compensaciones.json")

# Subir esta versión cuando cambie la fórmula del P&L invalida automáticamente
# los buckets cerrados ya cacheados con la fórmula vieja (ver `_clave_bucket`)
# sin tener que borrar el archivo de caché a mano.
_CACHE_VERSION = 7

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
    """
    Etiqueta "Sem N mes" (semana N dentro de ese mes calendario, contando
    desde el lunes que contiene el día 1) en vez del número de semana ISO
    ("Sem 33") — mucho menos legible para comparar de un vistazo contra el
    mes en curso, que es justamente el objetivo de este panel.
    """
    hoy = datetime.now().date()
    lunes_actual = _lunes_semana(hoy)
    rangos = []
    for i in range(n - 1, -1, -1):
        inicio = lunes_actual - timedelta(weeks=i)
        fin = min(inicio + timedelta(days=6), hoy)
        semana_del_mes = ((inicio.day - 1) // 7) + 1
        rangos.append({
            "inicio": inicio.strftime("%Y-%m-%d"),
            "fin": fin.strftime("%Y-%m-%d"),
            "label": f"Sem {semana_del_mes} {_MESES_ES[inicio.month - 1]}",
            "dias": (fin - inicio).days + 1,
        })
    return rangos


def _rangos_dias(n: int) -> list[dict]:
    """Últimos `n` días calendario, cada uno su propio bucket (día en curso incluido)."""
    hoy = datetime.now().date()
    rangos = []
    for i in range(n - 1, -1, -1):
        d = hoy - timedelta(days=i)
        rangos.append({
            "inicio": d.strftime("%Y-%m-%d"),
            "fin": d.strftime("%Y-%m-%d"),
            "label": f"{d.day} {_MESES_ES[d.month - 1]}",
            "dias": 1,
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

def _ventas_meli_en_rango(fecha_inicio: str, fecha_fin: str) -> list[dict]:
    """
    Órdenes MeLi pagadas en el rango dado. Se pide UNA VEZ POR BUCKET (no un
    solo fetch para todo el histórico pedido) porque `/orders/search` corta
    la paginación en offset > 10000 (confirmado ago-2026: pedir un año
    completo de una sola vez trunca silenciosamente los meses más viejos a
    cero). Acotado a un mes/semana, el conteo de órdenes queda muy por
    debajo de ese tope.
    """
    from app.services.meli import listar_ordenes_meli_por_estado

    dias_atras = (datetime.now().date() - date.fromisoformat(fecha_inicio)).days + 2
    return listar_ordenes_meli_por_estado("paid", dias_atras=dias_atras, fecha_hasta=fecha_fin)


def _acumular_orden_meli(orden: dict, acc: dict, relacion_por_mid: dict, costos: dict, cobros_por_sku: dict) -> None:
    acc["ingresos"] += float(orden.get("total_amount") or 0)
    for oi in orden.get("order_items") or []:
        item_info = oi.get("item") or {}
        mid = str(item_info.get("id") or "").strip().upper()
        qty = float(oi.get("quantity") or 0)
        if not mid or qty <= 0:
            continue
        acc["unidades"] = acc.get("unidades", 0.0) + qty
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


# ─── Otras ventas (fuera de MeLi/web) — aproximación por DESCARTE ─────────
#
# Hallazgo ago-2026: la venta directa por WhatsApp (cliente escribe, el
# agente cotiza y factura con `crear_factura_completa_siigo`, el cliente paga
# por transferencia) NO dejaba ningún rastro estructurado — ni tabla, ni
# JSON, ni marca en la factura de Siigo (a diferencia de MeLi y la web, que sí
# escriben Pack ID / referencia MCKG- en observations/purchase_order).
# Investigado a fondo (wa_chats.db, comprobantes/, posibles reportes de
# ventas por WhatsApp): no existe ninguna otra fuente para reconstruir el
# histórico — ver docstring del módulo, aproximación #7.
#
# Fix de raíz: `crear_factura_completa_siigo` ahora escribe
# `"Venta directa WhatsApp (agente IA)"` en `observations` — las facturas
# NUEVAS de este canal ya quedan identificables sin ambigüedad. Las de antes
# de ese cambio (y cualquier otra factura manual que no sea de MeLi ni web)
# caen en el mismo bucket "otro" sin forma de separarlas — por eso esto se
# expone como aproximado, nunca como un hecho verificado como MeLi/web.

_RE_PACK_MELI = re.compile(r"Mercado ?Libre[^\d]{0,10}#?\s*(\d{9,17})", re.I)
_RE_REF_WEB = re.compile(r"MCKG-[A-F0-9]+", re.I)
_MARCADOR_WA_DIRECTO = "venta directa whatsapp"


def _clasificar_canal_factura_siigo(factura: dict) -> str:
    # OJO: `GET /v1/invoices` (list, usado por `obtener_facturas_siigo_paginadas`)
    # NUNCA devuelve `purchase_order` — solo aparece en el detalle individual
    # de cada factura (bug real, confirmado ago-2026: con esto revisando
    # `purchase_order` ninguna venta web se excluía y se colaba entera en
    # "otro", inflando la aproximación de WhatsApp con ventas web reales).
    # La referencia MCKG- SÍ queda en `observations` como texto plano — ver
    # `web_pedidos._build_web_order_siigo_observations` ("Pedido web MCKG-...").
    texto = f"{factura.get('observations', '')} {factura.get('purchase_order', '')}".lower()
    if _RE_PACK_MELI.search(texto) or "mercado libre" in texto or "mercadolibre" in texto:
        return "meli"
    if _RE_REF_WEB.search(texto):
        return "web"
    return "otro"


def _ventas_otras_por_bucket(rangos: list[dict], costos: dict) -> dict[str, dict]:
    """
    Para cada rango en `rangos`, ingresos/costo/unidades de facturas de venta
    de Siigo que NO son de MeLi ni de la web — una sola paginación de Siigo
    para todo el lote de buckets pendientes (no una por bucket), igual que
    `_prefetch_ordenes_meli`/`_prefetch_gasto_ads` evitan repetir llamadas.
    """
    vacio = {"ingresos": 0.0, "costo_producto": 0.0, "unidades": 0.0, "facturas": 0, "con_marcador_wa": 0}
    resultado: dict[str, dict] = {r["inicio"]: dict(vacio) for r in rangos}
    if not rangos:
        return resultado

    from app.services.siigo import obtener_facturas_siigo_paginadas

    fecha_desde = min(r["inicio"] for r in rangos)
    try:
        facturas = obtener_facturas_siigo_paginadas(fecha_desde)
    except Exception:
        return resultado

    rangos_ordenados = sorted(rangos, key=lambda r: r["inicio"])

    for f in facturas:
        fecha = (f.get("date") or "")[:10]
        if not fecha or _clasificar_canal_factura_siigo(f) != "otro":
            continue
        rango = next((r for r in rangos_ordenados if r["inicio"] <= fecha <= r["fin"]), None)
        if rango is None:
            continue
        acc = resultado[rango["inicio"]]
        acc["facturas"] += 1
        if _MARCADOR_WA_DIRECTO in (f.get("observations") or "").lower():
            acc["con_marcador_wa"] += 1
        acc["ingresos"] += float(f.get("total") or 0)
        for item in (f.get("items") or []):
            code = (item.get("code") or "").strip().upper()
            qty = float(item.get("quantity") or 0)
            acc["unidades"] += qty
            costo_info = costos.get(code)
            if costo_info:
                acc["costo_producto"] += float(costo_info.get("costo_total") or 0) * qty

    return resultado


# ─── Costos administrativos ───────────────────────────────────────────────

def _total_mensual_nomina() -> tuple[float, str]:
    """
    Nómina mensual real. Hay DOS sistemas de nómina que nunca se conectaron
    (hallazgo ago-2026, auditando por qué el margen calculado parecía
    demasiado alto): `contabilidad_db.resumen_nomina()` (tabla `empleados`,
    pensada para Contabilidad → Operativos → Nómina) está vacía en
    producción — nadie cargó ahí al equipo. Los sueldos reales sí están en
    RRHH → Compensaciones (`app/data/rrhh_compensaciones.json`, campo
    `devengado` por persona, excluye a quien no tiene salario fijo — hoy
    Cynthia y Armando, compensados informalmente). Se usa esa fuente primero;
    si algún día se llena la tabla de contabilidad y RRHH queda vacía, se cae
    a esa. Si ninguna tiene datos, se devuelve 0 con fuente "sin_datos" para
    que el panel lo señale en vez de mostrar una utilidad neta inflada en
    silencio (justo el bug que produjo este fallback).
    """
    try:
        with open(_RRHH_COMPENSACIONES_PATH, encoding="utf-8") as f:
            data = json.load(f)
        total_rrhh = sum(float(p.get("devengado") or 0) for p in data.get("nomina") or [])
        if total_rrhh > 0:
            return total_rrhh, "rrhh_compensaciones"
    except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError, ValueError):
        pass

    from app.services.contabilidad_db import resumen_nomina

    total_contab = float(resumen_nomina().get("total_mensual") or 0)
    if total_contab > 0:
        return total_contab, "contabilidad_empleados"
    return 0.0, "sin_datos"


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


# ─── Caché en disco de buckets cerrados ────────────────────────────────────
#
# Un día/semana/mes ya terminado no vuelve a cambiar (las órdenes pasadas no se
# reescriben) — solo el bucket EN CURSO necesita recalcularse siempre. Cachear
# los cerrados en disco evita repaginar un año de órdenes MeLi y volver a
# pedirle a la API de Ads el gasto de meses que ya cerraron, cada vez que se
# abre el panel. `refresh=True` fuerza recalcular los buckets pedidos en esta
# llamada puntual (no borra el caché completo — solo sobrescribe esas claves).

def _clave_bucket(periodicidad: str, rango: dict) -> str:
    return f"v{_CACHE_VERSION}:{periodicidad}:{rango['inicio']}"


def _bucket_cerrado(rango: dict, hoy_str: str) -> bool:
    """Cerrado = su fecha fin ya pasó. El bucket en curso siempre tiene fin == hoy."""
    return rango["fin"] < hoy_str


def _cargar_cache_disco() -> dict:
    try:
        with open(_CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _guardar_cache_disco(cache: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(_CACHE_PATH)), exist_ok=True)
    tmp = _CACHE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    os.replace(tmp, _CACHE_PATH)


def _buscar_ads_archivado(cache_disco: dict, periodicidad: str, rango: dict) -> dict | None:
    """
    Gasto en ads ya archivado para este bucket bajo CUALQUIER versión de
    caché anterior (`_clave_bucket` prefija `v{N}:`, N sube con cada cambio
    de fórmula). A diferencia del resto del P&L, el gasto en ads NUNCA debe
    recalcularse una vez que el bucket sale de la ventana móvil de 90 días
    de MeLi — no hay forma de volver a pedirlo. Sin esto, un bump de
    `_CACHE_VERSION` futuro recalcularía ese bucket, MeLi lo rechazaría de
    nuevo, y se perdería para siempre un dato que ya habíamos archivado.
    """
    sufijo = f":{periodicidad}:{rango['inicio']}"
    for clave, fila in cache_disco.items():
        if clave.endswith(sufijo) and fila.get("ads_disponible"):
            return {"costo": fila.get("gasto_ads", 0.0), "acos": fila.get("acos_ads")}
    return None


def _calcular_bucket(
    rango: dict,
    ordenes_meli: list[dict],
    relacion_por_mid: dict,
    costos: dict,
    cobros_por_sku: dict,
    total_mensual_nomina: float,
    margen_pct_anterior: float | None,
    ads_precalculado: dict | None = None,
    otras_ventas: dict | None = None,
) -> dict:
    """`ordenes_meli` ya viene pre-cargado (una consulta por bucket, en paralelo
    con los demás buckets pendientes — ver `_prefetch_ordenes_meli`).
    `ads_precalculado`, si viene, evita pedirle a MeLi el gasto en ads DENTRO
    de este loop secuencial — con la vista diaria (hasta 120 buckets) hacerlo
    aquí, uno por uno, tardaba minutos; ahora se trae en paralelo antes del
    loop (ver `_prefetch_gasto_ads`), venga de un archivo viejo o de una
    llamada en vivo. Puede traer su propio "error" (rechazo de MeLi) —
    se revisa igual que si se hubiera pedido acá adentro. `otras_ventas`,
    si viene, es el resultado de `_ventas_otras_por_bucket` para ESTE bucket
    (aproximación de venta directa por WhatsApp + otras facturas manuales,
    ver esa función)."""
    acc = {"ingresos": 0.0, "costo_producto": 0.0, "comisiones_meli": 0.0, "unidades": 0.0}
    for orden in ordenes_meli:
        fecha_orden = (orden.get("date_created") or "")[:10]
        if rango["inicio"] <= fecha_orden <= rango["fin"]:
            _acumular_orden_meli(orden, acc, relacion_por_mid, costos, cobros_por_sku)

    web = _ventas_web_en_rango(rango["inicio"], rango["fin"])
    costo_producto_web = _costo_producto_web(web["items"], costos)
    unidades_web = sum(it["qty"] for it in web["items"])

    otras = otras_ventas or {"ingresos": 0.0, "costo_producto": 0.0, "unidades": 0.0, "facturas": 0, "con_marcador_wa": 0}

    if ads_precalculado is not None:
        ads = ads_precalculado
    else:
        from app.services.meli_ads import gasto_ads_por_rango

        ads = gasto_ads_por_rango(rango["inicio"], rango["fin"])
    # MeLi rechaza (400) pedir gasto en ads de hace más de 90 días — "costo: 0"
    # en ese caso NO significa "no hubo gasto", significa "no se puede saber".
    # Sin este chequeo, meses viejos se mostraban con gasto en ads = $0 como
    # si fuera un hecho verificado (bug real, ver docstring de este módulo).
    ads_disponible = not bool(ads.get("error"))
    admin = _costo_admin_en_rango(rango, total_mensual_nomina)

    ingresos_total = acc["ingresos"] + web["ingresos"] + otras["ingresos"]
    costo_producto_total = acc["costo_producto"] + costo_producto_web + otras["costo_producto"]
    utilidad_neta = (
        ingresos_total - costo_producto_total - acc["comisiones_meli"] - ads["costo"] - admin["total"]
    )
    margen_pct = round(utilidad_neta / ingresos_total * 100, 2) if ingresos_total > 0 else 0.0

    # Para el score: "gastó en ads pero MeLi aún no atribuyó ninguna venta"
    # (típico en una campaña recién creada — la atribución tarda) es el PEOR
    # caso posible, no un ACOS de 0% — `gasto_ads_por_rango` ya lo marca como
    # `acos=None` en vez de 0.0 para no mentir en el dato mostrado, pero acá
    # hay que traducir ese "no calculable" a "mal" para el score, no a
    # "excelente" (que es lo que pasaría con `acos_pct=None` normal, pensado
    # para el caso de "no hubo gasto en absoluto").
    acos_para_score = ads.get("acos")
    if acos_para_score is None and float(ads.get("costo") or 0) > 0:
        acos_para_score = 150.0  # fuera de la escala de _PUNTOS_ACOS → score_ads = 0
    salud = _score_bucket(margen_pct, acos_para_score, margen_pct_anterior)

    return {
        **rango,
        "ingresos_meli": round(acc["ingresos"], 2),
        "ingresos_web": round(web["ingresos"], 2),
        "ingresos_otros_canales": round(otras["ingresos"], 2),
        "otros_canales_facturas": otras["facturas"],
        "otros_canales_con_marcador_wa": otras["con_marcador_wa"],
        "ingresos_total": round(ingresos_total, 2),
        "costo_producto": round(costo_producto_total, 2),
        "comisiones_meli": round(acc["comisiones_meli"], 2),
        "gasto_ads": round(ads["costo"], 2),
        "ads_disponible": ads_disponible,
        "acos_ads": ads.get("acos") if ads_disponible else None,
        "costos_admin": admin,
        "utilidad_neta": round(utilidad_neta, 2),
        "margen_pct": margen_pct,
        "unidades_vendidas": round(acc["unidades"] + unidades_web + otras["unidades"]),
        **salud,
    }


def _prefetch_ordenes_meli(periodicidad: str, rangos: list[dict]) -> dict[str, list[dict]]:
    """
    Trae en PARALELO (no en serie) las órdenes MeLi de cada bucket pendiente
    — 1 llamada por bucket, con hasta 3 en vuelo a la vez. En serie, un año
    completo (12 meses) tarda ~3-4 min la primera vez (sin caché); en
    paralelo baja a una fracción de eso. 3 workers, no más: cada fetch ya
    pagina internamente, y MeLi rate-limita (429) si se satura.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    resultado: dict[str, list[dict]] = {}
    if not rangos:
        return resultado
    with ThreadPoolExecutor(max_workers=3) as pool:
        futuros = {
            pool.submit(_ventas_meli_en_rango, r["inicio"], r["fin"]): _clave_bucket(periodicidad, r)
            for r in rangos
        }
        for fut in as_completed(futuros):
            clave = futuros[fut]
            try:
                resultado[clave] = fut.result()
            except Exception:
                resultado[clave] = []
    return resultado


def _prefetch_gasto_ads(periodicidad: str, rangos: list[dict], cache_disco: dict) -> dict[str, dict]:
    """
    Gasto en ads de los buckets pendientes, en PARALELO — imprescindible para
    la vista diaria (hasta 120 buckets): pedirlo uno por uno dentro del loop
    secuencial de `salud_negocio_resumen` tardaba varios minutos y llegaba a
    superar el timeout del panel. Primero revisa el archivo (`_buscar_ads_archivado`,
    barato, en memoria) y solo pide a MeLi los que de verdad no lo tienen.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from app.services.meli_ads import gasto_ads_por_rango

    resultado: dict[str, dict] = {}
    pendientes: list[tuple[str, dict]] = []
    for r in rangos:
        clave = _clave_bucket(periodicidad, r)
        archivado = _buscar_ads_archivado(cache_disco, periodicidad, r)
        if archivado is not None:
            resultado[clave] = archivado
        else:
            pendientes.append((clave, r))

    if not pendientes:
        return resultado

    with ThreadPoolExecutor(max_workers=3) as pool:
        futuros = {
            pool.submit(gasto_ads_por_rango, r["inicio"], r["fin"]): clave
            for clave, r in pendientes
        }
        for fut in as_completed(futuros):
            clave = futuros[fut]
            try:
                resultado[clave] = fut.result()
            except Exception as e:
                resultado[clave] = {"costo": 0.0, "acos": 0.0, "error": str(e)[:200]}
    return resultado


# ─── Orquestador ──────────────────────────────────────────────────────────

def salud_negocio_resumen(periodicidad: str = "semana", n: int = 12, refresh: bool = False) -> dict:
    """
    Devuelve una fila de P&L por bucket (día, semana o mes) + score de salud, más
    un resumen del período actual vs el anterior. Ver docstring del módulo
    para las aproximaciones asumidas (comisión MeLi actual aplicada
    retroactivamente, nómina prorrateada, sin comisión de pasarela web).

    Default = últimas 12 SEMANAS (12 × 7 = 84 días), no meses — a propósito:
    caben dentro de la ventana de 90 días que MeLi retiene el gasto en ads
    (límite permanente de la plataforma, ver aproximación #6 arriba), así
    que con el default ningún bucket queda sin ese dato. Con 12 meses, en
    cambio, 9 de 12 quedan permanentemente sin gasto en ads conocido.
    Los buckets ya cerrados se sirven desde caché en disco (ver sección de
    caché arriba); solo el bucket en curso golpea MeLi/Siigo en cada llamada.
    """
    from app.services.rentabilidad import (
        _sku_canonico_desde_relacion,
        costos_todos_resumen,
        listar_cobros_meli,
    )

    periodicidad = periodicidad if periodicidad in ("dia", "semana", "mes") else "semana"
    _n_max = {"dia": 120, "semana": 26, "mes": 24}[periodicidad]
    _n_default = {"dia": 90, "semana": 12, "mes": 12}[periodicidad]
    n = max(1, min(int(n or _n_default), _n_max))

    if periodicidad == "dia":
        rangos = _rangos_dias(n)
    elif periodicidad == "semana":
        rangos = _rangos_semanas(n)
    else:
        rangos = _rangos_meses(n)
    hoy_str = datetime.now().strftime("%Y-%m-%d")

    cache_disco = _cargar_cache_disco()

    pendientes = [
        r for r in rangos
        if refresh or not _bucket_cerrado(r, hoy_str) or _clave_bucket(periodicidad, r) not in cache_disco
    ]

    # Fuentes compartidas por TODOS los buckets — costos/cobros/nómina no
    # varían por período, se piden una sola vez. Las órdenes MeLi, en cambio,
    # se piden por bucket (un solo fetch para todo el histórico rompe el
    # tope de 10000 resultados de `/orders/search` — ver
    # `_ventas_meli_en_rango`), pero en PARALELO para los pendientes, no en
    # serie (ver `_prefetch_ordenes_meli`) — si no, la primera carga de un
    # año completo sin caché tarda varios minutos.
    relacion_por_mid = _sku_canonico_desde_relacion()
    costos = costos_todos_resumen(refresh=refresh)
    cobros = listar_cobros_meli(refresh=refresh)
    cobros_por_sku = {(c.get("sku") or "").upper(): c for c in cobros.get("items") or [] if c.get("sku")}
    total_mensual_nomina, fuente_nomina = _total_mensual_nomina()
    ordenes_por_bucket = _prefetch_ordenes_meli(periodicidad, pendientes)
    ads_por_bucket = _prefetch_gasto_ads(periodicidad, pendientes, cache_disco)
    otras_ventas_por_bucket = _ventas_otras_por_bucket(pendientes, costos)

    filas: list[dict] = []
    margen_anterior: float | None = None
    cache_tocada = False

    for rango in rangos:
        clave = _clave_bucket(periodicidad, rango)
        cerrado = _bucket_cerrado(rango, hoy_str)
        desde_cache = cache_disco.get(clave) if (cerrado and not refresh) else None

        if desde_cache:
            # `**rango` va DESPUÉS de `**desde_cache`: el P&L cacheado se
            # respeta tal cual, pero inicio/fin/label/dias siempre salen del
            # cálculo de rangos actual — así un cambio de formato de label
            # (o de bucketing) se ve de inmediato en buckets ya archivados,
            # sin tener que recalcular ni arriesgar perder su gasto en ads.
            fila = {**desde_cache, **rango, "fuente": "cache"}
        else:
            fila = _calcular_bucket(
                rango, ordenes_por_bucket.get(clave, []), relacion_por_mid, costos, cobros_por_sku,
                total_mensual_nomina, margen_anterior, ads_por_bucket.get(clave),
                otras_ventas_por_bucket.get(rango["inicio"]),
            )
            fila["fuente"] = "calculado"
            if cerrado:
                cache_disco[clave] = {k: v for k, v in fila.items() if k != "fuente"}
                cache_tocada = True

        # Siempre fresco (no viene del caché ni afecta si se cachea o no):
        # un bucket cerrado alguna vez queda cerrado para siempre, así que
        # esto es barato de recalcular en cada llamada sin invalidar nada.
        fila["cerrado"] = cerrado

        margen_anterior = fila["margen_pct"]
        filas.append(fila)

    if cache_tocada:
        try:
            _guardar_cache_disco(cache_disco)
        except OSError:
            pass  # el proceso del panel a veces no puede escribir (dueño systemd) — no bloquea la respuesta

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
        "nomina_mensual": round(total_mensual_nomina, 2),
        "fuente_nomina": fuente_nomina,
    }
