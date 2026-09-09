"""
Fuente única de "¿esta venta MeLi/web quedó bien facturada?" para el panel
Facturación → Ventas, NC y Astro Killer.

Sustituye a `alegra.py::listar_ventas_meli_con_trazabilidad` (recorría
FACTURAS, así que una orden sin factura nunca aparecía — no podía detectar
"sin_facturar") y a `conciliacion_meli.py::listar_ventas_meli_conciliacion`
(recorría órdenes pero cruzaba solo contra el índice histórico Siigo, ciego a
las facturas Alegra desde la migración del 2026-09-02 — la causa real de las
falsas alarmas "sin_facturar" reportadas el 2026-09-04, porque una venta ya
facturada en Alegra seguía marcándose como sin factura).

Recorre las ÓRDENES MeLi del rango (no las facturas) para poder ver tanto lo
que sí se facturó como lo que no, y le adjunta a cada una:
  - su(s) factura(s) Alegra (agrupadas por order_id — Alegra factura por
    order_id, no por pack_id, ver `crear_factura_venta_alegra(purchase_order=order_id)`),
  - su match en el índice legado Siigo (por pack_id, resuelto igual que en
    Astro Killer vía `_resolver_pack_id_meli`),
  - si MeLi ya tiene el documento fiscal subido (`meli_pack_tiene_documento_fiscal`)
    — la doble verificación: factura sí existe pero no llegó a MeLi es un
    problema distinto de "no está facturada",
  - si está entregada y desde cuándo, para no marcar "sin_facturar" antes de
    que el flujo de autofactura por entrega (Flujo G de CLAUDE.md) tenga
    oportunidad de facturar (`NOTAS_CREDITO_MARGEN_HORAS`, default 48h),
  - cliente (nombre + identificación, de la propia factura Alegra — gratis,
    ya viene embebido) y cuántas facturas tiene ese cliente en el rango
    cargado,
  - si ya fue "revisado" desde el ticket de Centro de Mando (ver
    `app/tools/revision_facturacion.py`) — para que un duplicado ya
    descartado por el operador no vuelva a contarse como alerta.

Pedidos web (referencia "MCKG-xxx"): solo se listan si ya tienen factura
Alegra (mismo alcance que tenía Astro Killer) — detectar "sin facturar" para
web queda fuera de este cambio, tal como ya estaba fuera de "Ventas y NC".
"""
from __future__ import annotations

import time as _time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import requests

from app.services.alegra import (
    _ALEGRA_BASE,
    FECHA_CORTE_MIGRACION_ALEGRA,
    _alegra_headers,
    _detalle_venta_meli,
    _detalle_venta_web,
    _resolver_pack_id_meli,
    items_hibridos_normalizados,
    obtener_facturas_alegra_paginadas,
)
from app.services.conciliacion_meli import (
    _fecha_cancelacion,
    _leer_estado_notas_credito,
    _margen_horas_default,
    leer_indice_facturacion_meli,
)
from app.services.meli import (
    consultar_envio_meli,
    consultar_orden_meli_completa,
    consultar_pack_meli,
    meli_pack_tiene_documento_fiscal,
)

_cache: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL = 60  # segundos, mismo criterio que tenía Astro Killer

# Cachés dedicadas para las dos llamadas más caras (confirmado en vivo
# 2026-09-04: listar 30 días de órdenes "paid" tarda ~30s con volumen real de
# McKenna — 1655 órdenes —, y la paginación de facturas Alegra ronda ~15s
# incluso con pocos resultados, aparentemente por latencia propia de esa
# API). `_cache` de arriba está indexada por (dias, segmento, limite): cambiar
# solo el segmento o el límite invalidaba el cache y repetía TODO el trabajo
# desde cero. Estas dos quedan aparte, indexadas solo por lo que realmente
# determina su resultado, para que ese trabajo se comparta entre pedidos.
_cache_ordenes: dict[tuple[str, int], tuple[float, list]] = {}
_cache_alegra: dict[str, tuple[float, list, dict]] = {}
_CACHE_TTL_FUENTES = 90  # segundos


def _sin_autorreferencia(legado: dict | None, facturas_out: list[dict]) -> dict | None:
    """`scripts/emitir_notas_credito_cron.py` arma el índice legado con
    `obtener_facturas_hibridas` (Siigo + Alegra) desde la migración — y
    `construir_indice_facturacion_meli` matchea por texto de observaciones,
    que para las facturas creadas por `meli_autofactura_entrega.py` incluye
    literalmente "MercadoLibre — Orden {order_id}". Sin este filtro, TODA
    venta facturada en Alegra por ese flujo terminaba marcada
    `posible_duplicado=True` contra SÍ MISMA (confirmado en vivo 2026-09-05,
    ticket TKT-2026-1160: la "factura legada" y la factura Alegra mostrada
    tenían el mismo `factura_id`). Un duplicado real es una factura DISTINTA
    referenciando la misma venta, no la misma factura contada dos veces."""
    if not legado:
        return None
    if any(str(f.get("factura_id")) == str(legado.get("factura_id")) for f in facturas_out):
        return None
    return legado


def _cliente_desde_factura(f: dict) -> dict | None:
    cli = f.get("client") or {}
    if not isinstance(cli, dict):
        return None
    ident = str(
        cli.get("identification") or (cli.get("identificationObject") or {}).get("number") or ""
    ).strip()
    nombre = (cli.get("name") or "").strip()
    if not ident and not nombre:
        return None
    return {"nombre": nombre or None, "identificacion": ident or None}


def _notas_credito_alegra_por_factura(headers: dict, desde: str) -> dict[str, list[dict]]:
    """Notas crédito de Alegra desde `desde`, indexadas por factura_id
    referenciada. OJO rendimiento: el bloque que copió esto de
    `listar_ventas_meli_con_trazabilidad` paginaba TODO el historial de notas
    crédito sin filtro de fecha, sin importar el rango pedido — confirmado en
    vivo 2026-09-04 como una de las causas de que el panel tardara >100s."""
    notas_por_factura: dict[str, list[dict]] = {}
    pagina = 0
    while True:
        try:
            r = requests.get(
                f"{_ALEGRA_BASE}/credit-notes", headers=headers,
                params={"limit": 30, "start": pagina * 30, "date_afterEqual": desde}, timeout=20,
            )
        except requests.RequestException:
            break
        if r.status_code != 200:
            break
        lote = r.json() or []
        if not lote:
            break
        for nc in lote:
            for inv in nc.get("invoices") or []:
                fid = str(inv.get("id"))
                stamp_nc = nc.get("stamp") or {}
                notas_por_factura.setdefault(fid, []).append({
                    "id": nc.get("id"),
                    "numero": (nc.get("numberTemplate") or {}).get("fullNumber"),
                    "fecha": nc.get("date"),
                    "total": nc.get("total"),
                    "tipo": nc.get("type"),
                    "cufe": stamp_nc.get("cufe") or "",
                    "legal_status": stamp_nc.get("legalStatus") or nc.get("status"),
                    "url": f"https://app.alegra.com/credit-note/view/id/{nc.get('id')}",
                })
        if len(lote) < 30:
            break
        pagina += 1
    return notas_por_factura


def _ordenes_meli_cacheadas(status: str, dias: int, *, forzar: bool = False) -> list[dict]:
    key = (status, dias)
    if not forzar:
        cacheado = _cache_ordenes.get(key)
        if cacheado and _time.time() - cacheado[0] < _CACHE_TTL_FUENTES:
            return cacheado[1]
    from app.services.meli import listar_ordenes_meli_por_estado

    ordenes = listar_ordenes_meli_por_estado(status, dias_atras=dias)
    _cache_ordenes[key] = (_time.time(), ordenes)
    return ordenes


def _facturas_alegra_cacheadas(headers: dict, desde: str, *, forzar: bool = False) -> tuple[list, dict]:
    if not forzar:
        cacheado = _cache_alegra.get(desde)
        if cacheado and _time.time() - cacheado[0] < _CACHE_TTL_FUENTES:
            return cacheado[1], cacheado[2]
    facturas = obtener_facturas_alegra_paginadas(desde)
    notas_por_factura = _notas_credito_alegra_por_factura(headers, desde)
    _cache_alegra[desde] = (_time.time(), facturas, notas_por_factura)
    return facturas, notas_por_factura


_CACHE_TTL_PUNTUAL = 900  # 15 min


def _facturas_alegra_para_consulta_puntual(headers: dict) -> tuple[list, dict]:
    """Facturas/NC para resolver UNA venta puntual (búsqueda o botón de refrescar).

    Bajar TODAS las facturas desde la migración toma ~100s (medido en vivo
    2026-09-09), lo que dejaba el botón de refrescar una fila colgado casi dos
    minutos. Acá se reutiliza el caché completo aunque esté algo viejo y se le
    suma la PRIMERA página de Alegra, que es donde cae cualquier factura
    recién emitida — que es justo lo que el operador quiere ver al refrescar.
    Alegra no permite filtrar `/invoices` por orden de compra (probado en vivo:
    ignora `purchase_order`/`query` y devuelve las últimas sin filtrar).
    """
    cacheado = _cache_alegra.get(FECHA_CORTE_MIGRACION_ALEGRA)
    base_facturas: list = []
    notas: dict = {}
    if cacheado and _time.time() - cacheado[0] < _CACHE_TTL_PUNTUAL:
        base_facturas, notas = list(cacheado[1]), dict(cacheado[2])
    else:
        base_facturas, notas = _facturas_alegra_cacheadas(headers, FECHA_CORTE_MIGRACION_ALEGRA)
        return base_facturas, notas

    try:
        r = requests.get(
            f"{_ALEGRA_BASE}/invoices", headers=headers,
            params={"date_afterEqual": FECHA_CORTE_MIGRACION_ALEGRA, "limit": 30, "order_direction": "DESC"},
            timeout=20,
        )
        recientes = r.json() or [] if r.status_code == 200 else []
    except requests.RequestException:
        recientes = []

    conocidas = {str(f.get("id")) for f in base_facturas}
    for f in recientes:
        if str(f.get("id")) in conocidas:
            continue
        f = dict(f)
        f.setdefault("purchase_order", f.get("anotation"))
        base_facturas.append(f)
    return base_facturas, notas


def _guardar_en_cache(filas: list[dict]) -> None:
    """Persiste las filas ya reconstruidas en el histórico SQLite. Nunca debe
    tumbar el listado: si el caché falla, el panel sigue funcionando en vivo."""
    try:
        from app.services.facturacion_ventas_cache import guardar_ventas

        guardar_ventas(filas)
    except Exception as e:  # noqa: BLE001 - el caché es best-effort
        print(f"⚠️ [FACTURACION] No se pudo guardar el histórico de ventas: {e}")


def _clave_item(sku: str | None, nombre: str | None) -> str:
    """Clave para parear una línea comprada con una facturada. El SKU manda; el
    nombre es el respaldo para líneas sin SKU (el listado de órdenes de MeLi no
    siempre trae `seller_custom_field`, a diferencia del GET individual)."""
    s = (sku or "").strip().upper()
    if s and s != "—":
        return s
    return (nombre or "").strip().upper()[:40]


def construir_cruce_pack(
    items_comprados: list[dict], facturas_pack: list[dict], hay_factura_legado: bool = False,
    *, datos_incompletos: bool = False,
) -> dict:
    """Cruce línea por línea de lo que el cliente compró (todo el pack/carrito)
    contra lo que quedó facturado en Alegra para ese mismo pack.

    Es la red de seguridad que faltaba: el estado `facturada_completa` solo mira
    que EXISTA una factura y que MeLi tenga el PDF, no que la factura cubra todo
    lo comprado. Con packs multi-orden eso dejó pasar facturas parciales.

    Las facturas anuladas (con nota crédito) NO cuentan como facturado — si no,
    una factura mala ya anulada seguiría tapando el faltante.

    `concluyente` es False cuando hay una factura del legado Siigo: de esas no
    tenemos las líneas, así que no se puede afirmar que falte algo.
    """
    comprado: dict[str, dict] = {}
    for it in items_comprados:
        k = _clave_item(it.get("sku"), it.get("nombre"))
        if not k:
            continue
        reg = comprado.setdefault(k, {"sku": it.get("sku") or "—", "nombre": it.get("nombre"), "cantidad": 0.0, "total": 0.0})
        reg["cantidad"] += float(it.get("cantidad") or 0)
        reg["total"] += float(it.get("cantidad") or 0) * float(it.get("precio_unitario") or 0)

    facturado: dict[str, dict] = {}
    facturas_vigentes = [f for f in facturas_pack if not f.get("notas_credito")]
    for f in facturas_vigentes:
        for it in f.get("items") or []:
            k = _clave_item(it.get("sku"), it.get("nombre"))
            if not k:
                continue
            reg = facturado.setdefault(k, {"sku": it.get("sku") or "—", "nombre": it.get("nombre"), "cantidad": 0.0, "total": 0.0})
            reg["cantidad"] += float(it.get("cantidad") or 0)
            reg["total"] += float(it.get("total") or 0)

    faltantes, sobrantes = [], []
    for k, c in comprado.items():
        fac = facturado.get(k)
        if not fac:
            faltantes.append({**c, "facturado": 0.0})
        elif fac["cantidad"] + 0.001 < c["cantidad"]:
            faltantes.append({**c, "facturado": fac["cantidad"]})
    for k, f in facturado.items():
        if k not in comprado:
            sobrantes.append(f)

    total_comprado = round(sum(c["total"] for c in comprado.values()), 2)
    total_facturado = round(sum(f["total"] for f in facturado.values()), 2)
    # `datos_incompletos`: no se pudo leer el detalle de alguna orden del pack
    # (timeout/límite de MeLi). Sin esas líneas el cruce inventaría faltantes o
    # sobrantes que no existen — y un falso positivo acá lleva a "corregir" una
    # factura correcta, que es justo el error que este cruce debe evitar.
    concluyente = not hay_factura_legado and not datos_incompletos
    ok = bool(facturas_vigentes) and not faltantes and not sobrantes and concluyente

    if not facturas_vigentes:
        resumen = "Sin factura vigente" if not hay_factura_legado else "Facturada en el legado Siigo"
    elif datos_incompletos:
        resumen = "No verificable: MeLi no devolvió el detalle de todo el carrito — reintenta con 🔄"
    elif not concluyente:
        resumen = "No verificable (factura del legado Siigo, sin líneas)"
    elif ok:
        resumen = f"Coincide: {len(comprado)} producto(s)"
    elif faltantes:
        resumen = f"Faltan {len(faltantes)} de {len(comprado)} producto(s) por facturar"
    else:
        resumen = f"{len(sobrantes)} línea(s) facturada(s) que no están en la compra"

    return {
        "comprado": sorted(comprado.values(), key=lambda x: x["nombre"] or ""),
        "facturado": sorted(facturado.values(), key=lambda x: x["nombre"] or ""),
        "faltantes": faltantes,
        "sobrantes": sobrantes,
        "total_comprado": total_comprado,
        "total_facturado": total_facturado,
        "diferencia": round(total_comprado - total_facturado, 2),
        "ok": ok,
        "concluyente": concluyente,
        "resumen": resumen,
    }


def listar_ventas_meli_unificado(
    *, dias: int = 30, segmento: str = "concretadas", limite: int = 200, forzar: bool = False,
) -> dict:
    """segmento: "concretadas" | "canceladas" | "todas" """
    segmento = segmento if segmento in ("concretadas", "canceladas", "todas") else "concretadas"
    # Cada fila puede costar hasta 3 llamadas HTTP a MeLi (detalle de venta +
    # resolución de pack_id o chequeo de entrega/documento fiscal) — con 10
    # workers en paralelo, ~100 filas ya tardan ~45s (confirmado en vivo
    # 2026-09-04). Tope bajo para no arriesgar un timeout de proxy/túnel en
    # la primera carga (sin cache) de un rango muy amplio.
    limite = min(max(int(limite or 40), 1), 150)
    cache_key = (dias, segmento, limite)
    if not forzar:
        cacheado = _cache.get(cache_key)
        if cacheado and _time.time() - cacheado[0] < _CACHE_TTL:
            return cacheado[1]

    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ventas": [], "total": 0, "error": str(e)}

    from app.utils import refrescar_token_meli

    ordenes: list[dict] = []
    if segmento in ("concretadas", "todas"):
        for o in _ordenes_meli_cacheadas("paid", dias, forzar=forzar):
            o = dict(o)
            o["_es_cancelada"] = False
            ordenes.append(o)
    if segmento in ("canceladas", "todas"):
        for o in _ordenes_meli_cacheadas("cancelled", dias, forzar=forzar):
            o = dict(o)
            o["_es_cancelada"] = True
            ordenes.append(o)

    desde_facturas = max(
        (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d"), FECHA_CORTE_MIGRACION_ALEGRA,
    )
    facturas, notas_por_factura = _facturas_alegra_cacheadas(headers, desde_facturas, forzar=forzar)

    por_orden: dict[str, list[dict]] = {}
    for f in facturas:
        anot = (f.get("purchase_order") or f.get("anotation") or "").strip()
        if anot:
            por_orden.setdefault(anot, []).append(f)

    indice_legado = leer_indice_facturacion_meli().get("indice", {})
    nc_estado_legado = _leer_estado_notas_credito()

    # Conteo de facturas por cliente EN EL RANGO CARGADO (gratis: agregación en
    # memoria sobre las facturas ya traídas, no otra llamada) — señal rápida de
    # "¿a este cliente le facturamos más de una vez?". El botón "ver histórico
    # completo" del panel pide el conteo real vía `contar_facturas_cliente_alegra`.
    conteo_cliente_en_rango: dict[str, int] = {}
    for f in facturas:
        cli = _cliente_desde_factura(f)
        if cli and cli.get("identificacion"):
            conteo_cliente_en_rango[cli["identificacion"]] = conteo_cliente_en_rango.get(cli["identificacion"], 0) + 1

    token_meli = refrescar_token_meli() if ordenes else None

    # OJO rendimiento: la resolución de pack_id real (multi-orden por pack) vía
    # `_resolver_pack_id_meli` es una llamada HTTP a MeLi por orden — NO se
    # hace acá para todo `ordenes` (podrían ser cientos en un rango de días),
    # solo más abajo para el subconjunto final ya recortado por `limite` y
    # que además tenga factura Alegra (es lo único que puede volverse
    # "posible_duplicado"). Antes de ese fix, dias=10 tardaba ~110s.

    from app.tools.revision_facturacion import pasos_abiertos_facturacion, revisado_map_facturacion

    revisados = revisado_map_facturacion()
    abiertos = pasos_abiertos_facturacion()

    total_pagado_pack: dict[str, float] = {}
    # Ítems comprados agrupados por PACK, no por orden. Un carrito de N productos
    # genera N órdenes MeLi que comparten pack_id, así que cruzar
    # orden-contra-factura da un falso "coincide" cuando se facturó UNA sola de
    # las N: cada orden tiene 1 producto y su factura tiene 1 producto (caso real
    # 2026-09-08, pack 2000014920695311: 7 productos por $226.295 y FE181
    # facturó solo uno por $88.315 — el cruce por orden no lo vio). Se arma desde
    # `ordenes`, que ya trae `order_items` en memoria: cero llamadas extra a MeLi.
    items_pack: dict[str, list[dict]] = {}
    ordenes_del_pack: dict[str, list[str]] = {}
    for o in ordenes:
        pid = str(o.get("pack_id") or o.get("id") or "").strip()
        if not pid:
            continue
        total_pagado_pack[pid] = total_pagado_pack.get(pid, 0) + (o.get("total_amount") or 0)
        oid_o = str(o.get("id") or "").strip()
        if oid_o and oid_o not in ordenes_del_pack.setdefault(pid, []):
            ordenes_del_pack[pid].append(oid_o)
        for it in o.get("order_items") or []:
            info = it.get("item") or {}
            sku = (info.get("seller_custom_field") or info.get("seller_sku") or "").strip()
            items_pack.setdefault(pid, []).append({
                "sku": sku or "—",
                "nombre": info.get("title") or "Producto",
                "cantidad": float(it.get("quantity") or 1),
                "precio_unitario": float(it.get("unit_price") or 0),
            })

    def _facturas_out(facturas_orden: list[dict]) -> list[dict]:
        out = []
        for f in facturas_orden:
            fid = str(f.get("id"))
            stamp = f.get("stamp") or {}
            out.append({
                "factura_id": fid,
                "numero": (f.get("numberTemplate") or {}).get("fullNumber"),
                "fecha": f.get("date"),
                "estado": f.get("status"),
                "total": f.get("total"),
                "cufe": stamp.get("cufe") or "",
                "url": f"https://app.alegra.com/invoice/view/id/{fid}",
                "notas_credito": notas_por_factura.get(fid, []),
                "items": [
                    {"sku": it.get("code") or "—", "nombre": it.get("description"),
                     "cantidad": it.get("quantity"), "total": it.get("total")}
                    for it in items_hibridos_normalizados(f)
                ],
            })
        return out

    # Facturas agrupadas por PACK: las de la propia orden, las de sus órdenes
    # hermanas y las emitidas contra el pack_id (una factura consolidada del
    # carrito lleva el pack_id en `purchase_order`). Sin esto, una consolidada
    # se vería como "sin factura" desde las demás órdenes del mismo pack.
    _cruce_por_pack: dict[str, dict] = {}

    def _cruce_pack_cacheado(pack_id: str, hay_legado: bool) -> dict:
        if pack_id in _cruce_por_pack:
            return _cruce_por_pack[pack_id]
        vistos: set[str] = set()
        facturas_del_pack: list[dict] = []
        for clave in [pack_id, *ordenes_del_pack.get(pack_id, [])]:
            for f in por_orden.get(clave, []):
                fid = str(f.get("id"))
                if fid in vistos:
                    continue
                vistos.add(fid)
                facturas_del_pack.append(f)
        cruce = construir_cruce_pack(
            items_pack.get(pack_id, []), _facturas_out(facturas_del_pack), hay_legado,
        )
        _cruce_por_pack[pack_id] = cruce
        return cruce

    filas: list[dict] = []
    ordenes_por_id: dict[str, dict] = {}
    for o in ordenes:
        order_id = str(o.get("id") or "").strip()
        if not order_id:
            continue
        ordenes_por_id[order_id] = o
        pack_id = str(o.get("pack_id") or order_id).strip()
        es_cancelada = bool(o.get("_es_cancelada"))

        facturas_orden = sorted(por_orden.get(order_id, []), key=lambda f: f.get("date") or "")
        facturas_out = _facturas_out(facturas_orden)
        # Match directo (gratis, sin API) — el caso multi-orden (pack_id real
        # distinto al de esta orden) se resuelve más abajo, solo para el
        # subconjunto final visible y solo si esta orden tiene factura Alegra.
        legado = indice_legado.get(order_id) or indice_legado.get(pack_id)
        legado = _sin_autorreferencia(legado, facturas_out)

        cliente = None
        for f in facturas_orden:
            cliente = _cliente_desde_factura(f)
            if cliente:
                break

        factura_total = (
            sum(ff.get("total") or 0 for ff in facturas_out) if facturas_out
            else (legado.get("total") if legado else None)
        )
        total_pack = total_pagado_pack.get(pack_id) or o.get("total_amount") or 0
        monto_discrepancia = bool(
            factura_total is not None and total_pack and not (0.97 <= (factura_total / total_pack) <= 1.03)
        )

        nc_legado = nc_estado_legado.get(pack_id)
        fila = {
            "order_id": order_id,
            "pack_id": pack_id,
            "es_meli": True,
            "es_cancelada": es_cancelada,
            "fecha": o.get("date_closed") or o.get("date_created"),
            "total": o.get("total_amount"),
            # OJO: es pack_id, no order_id — confirmado en vivo 2026-09-05 con
            # la venta de los beakers (pack 2000014865364705, order_id
            # 2000018281990134, un solo pedido en el pack pero igual con
            # pack_id distinto — la suposición de que "un pack de una sola
            # orden usa el mismo id" ya estaba mal en el código heredado).
            "meli_url": f"https://vendedores.mercadolibre.com.co/ventas/{pack_id}/detalle",
            "cliente": cliente,
            "facturas_cliente_en_rango": conteo_cliente_en_rango.get(cliente["identificacion"], 0) if cliente and cliente.get("identificacion") else 0,
            "facturas": facturas_out,
            "factura_legado": legado,
            "posible_duplicado": bool(legado and facturas_orden),
            "monto_discrepancia": monto_discrepancia,
            "nota_credito_legado": nc_legado.get("nc") if nc_legado else None,
            "nc_subida_meli_legado": bool(nc_legado.get("subida_meli")) if nc_legado else None,
        }
        if not es_cancelada:
            cruce = _cruce_pack_cacheado(pack_id, bool(legado))
            fila["cruce"] = cruce
            # Faltante real = hay factura vigente pero NO cubre todo lo comprado.
            # Es distinto de "sin_facturar" (no hay nada emitido todavía).
            fila["facturacion_parcial"] = bool(
                cruce["concluyente"] and cruce["faltantes"] and cruce["total_facturado"] > 0
            )
            fila["ordenes_del_pack"] = len(ordenes_del_pack.get(pack_id, []) or [order_id])
        revis = revisados.get(order_id)
        abierto = abiertos.get(order_id)
        fila["revisado"] = bool(revis)
        fila["revisado_notas"] = revis.get("notas") if revis else None
        fila["ticket_id"] = (revis or abierto or {}).get("ticket_id")
        fila["paso_id"] = (revis or abierto or {}).get("paso_id")
        filas.append(fila)

    # UNA fila por VENTA (pack), no por orden. Un carrito de N productos son N
    # órdenes MeLi con el mismo pack_id: mostrarlas como filas separadas hacía
    # que el operador viera "1 producto, $65.700" en una fila y "1 producto,
    # $38.244" en otra, para una venta que el cliente pagó en $103.944 — y que
    # se factura con UNA sola factura (MeLi admite un documento fiscal por
    # pack). Caso reportado 2026-09-09: pack 2000014944634019.
    por_pack: dict[str, dict] = {}
    filas_pack: list[dict] = []
    for fila in filas:
        pid = fila["pack_id"]
        base = por_pack.get(pid)
        if base is None:
            fila["ordenes_ids"] = [fila["order_id"]]
            por_pack[pid] = fila
            filas_pack.append(fila)
            continue
        base["ordenes_ids"].append(fila["order_id"])
        vistos = {f["factura_id"] for f in base["facturas"]}
        base["facturas"].extend(f for f in fila["facturas"] if f["factura_id"] not in vistos)
        base["factura_legado"] = base["factura_legado"] or fila["factura_legado"]
        base["posible_duplicado"] = base["posible_duplicado"] or fila["posible_duplicado"]
        base["cliente"] = base["cliente"] or fila["cliente"]
        base["revisado"] = base["revisado"] or fila["revisado"]
        base["revisado_notas"] = base["revisado_notas"] or fila["revisado_notas"]
        base["ticket_id"] = base["ticket_id"] or fila["ticket_id"]
        base["paso_id"] = base["paso_id"] or fila["paso_id"]
    for fila in filas_pack:
        fila["total"] = total_pagado_pack.get(fila["pack_id"]) or fila["total"]
        fila["ordenes_del_pack"] = len(fila["ordenes_ids"])
    filas = filas_pack

    # Pedidos web: solo los que YA tienen factura Alegra (mismo alcance que
    # tenía Astro Killer) — no se cruzan con `ordenes` (son MeLi).
    for anot, facturas_orden in por_orden.items():
        if not anot.upper().startswith("MCKG-"):
            continue
        facturas_orden = sorted(facturas_orden, key=lambda f: f.get("date") or "")
        facturas_out = _facturas_out(facturas_orden)
        cliente = None
        for f in facturas_orden:
            cliente = _cliente_desde_factura(f)
            if cliente:
                break
        filas.append({
            "order_id": anot,
            "pack_id": anot,
            "es_meli": False,
            "es_cancelada": False,
            "fecha": facturas_orden[-1].get("date") if facturas_orden else None,
            "total": None,
            "meli_url": None,
            "cliente": cliente,
            "facturas_cliente_en_rango": conteo_cliente_en_rango.get(cliente["identificacion"], 0) if cliente and cliente.get("identificacion") else 0,
            "facturas": facturas_out,
            "factura_legado": None,
            "posible_duplicado": False,
            "monto_discrepancia": False,
            "nota_credito_legado": None,
            "nc_subida_meli_legado": None,
            "revisado": False,
            "revisado_notas": None,
            "ticket_id": None,
            "paso_id": None,
            "estado_facturacion": "facturada_completa",
        })

    filas.sort(key=lambda x: x.get("fecha") or "", reverse=True)
    total_en_rango = len(filas)
    filas = filas[:limite]

    filas_meli = [f for f in filas if f["es_meli"]]
    margen_horas = _margen_horas_default()

    def _procesar_fila_meli(fila: dict) -> None:
        """Todo el trabajo pesado (llamadas MeLi) de UNA fila, para correr
        muchas filas en paralelo (ThreadPoolExecutor) en vez de 3-4 rondas
        secuenciales completas — con `limite` filas y ~1-2s por llamada MeLi,
        rondas secuenciales completas escalaban a más de un minuto (confirmado
        en vivo 2026-09-04: dias=10/limit=100 tardaba >110s antes de este
        cambio; el detalle de venta, la resolución de pack_id y el chequeo de
        entrega/documento fiscal de una misma fila no dependen del de otra
        fila, así que no hay razón para esperar a que TODAS terminen una
        etapa antes de que cualquiera empiece la siguiente)."""
        # "Lo vendido" es el CARRITO COMPLETO (todas las órdenes del pack), no
        # la orden de la fila. Sale de `ordenes` en memoria (cero llamadas)
        # cuando el listado trae los SKU; si a alguna línea le falta el SKU se
        # cae al detalle por orden vía API, que sí lo trae.
        items_carrito = items_pack.get(fila["pack_id"]) or []
        if items_carrito and all(i.get("sku") and i["sku"] != "—" for i in items_carrito):
            fila["venta_original"] = {
                "total_pagado": float(total_pagado_pack.get(fila["pack_id"]) or 0),
                "items": items_carrito,
            }
        else:
            acumulado, total_carrito = [], 0.0
            for oid in fila.get("ordenes_ids") or [fila["order_id"]]:
                det = _detalle_venta_meli(oid, token=token_meli) or {}
                acumulado.extend(det.get("items") or [])
                total_carrito += float(det.get("total_pagado") or 0)
            fila["venta_original"] = {"total_pagado": total_carrito, "items": acumulado} if acumulado else None
        if fila["es_cancelada"]:
            return  # estado de canceladas se resuelve aparte, sin más llamadas MeLi

        # Resolución diferida del pack_id real (packs multi-orden) — solo si
        # esta fila tiene factura Alegra pero no matcheó el índice legado por
        # order_id/pack_id directo (bug confirmado en vivo 2026-09-03 en
        # Astro Killer). Es lo único que puede volverla "posible_duplicado".
        if fila["facturas"] and not fila["factura_legado"]:
            pack_real = _resolver_pack_id_meli(fila["order_id"], token=token_meli)
            if pack_real and pack_real != fila["order_id"]:
                legado_real = _sin_autorreferencia(indice_legado.get(pack_real), fila["facturas"])
                if legado_real:
                    fila["factura_legado"] = legado_real
                    fila["posible_duplicado"] = True

        cruce = fila.get("cruce") or {}
        # Una orden puede no tener factura propia y aun así estar cubierta por la
        # factura CONSOLIDADA del pack (emitida contra el pack_id). Sin esto, las
        # 6 órdenes hermanas de una consolidada se reportarían "sin facturar" y
        # el operador facturaría de nuevo lo ya facturado.
        cubierta_por_pack = bool(cruce.get("ok")) and cruce.get("total_facturado", 0) > 0
        # Una factura ANULADA (con nota crédito) no cuenta como "tiene factura":
        # si no se reemitió, la venta está sin facturar aunque el documento exista.
        facturas_vigentes = [f for f in fila["facturas"] if not f.get("notas_credito")]

        if facturas_vigentes or fila["factura_legado"] or cubierta_por_pack:
            # Doble verificación MeLi: la factura existe (Alegra o legado),
            # ¿MeLi ya tiene el documento fiscal subido?
            tiene_doc = meli_pack_tiene_documento_fiscal(fila["pack_id"], token=token_meli)
            fila["meli_doc_fiscal"] = tiene_doc
            if fila.get("facturacion_parcial"):
                # Hay factura, pero NO cubre todo lo comprado: es el caso que
                # venía pasando inadvertido como "✅ Facturada".
                fila["estado_facturacion"] = "facturada_parcial"
            elif tiene_doc:
                fila["estado_facturacion"] = "facturada_completa"
            else:
                fila["estado_facturacion"] = "facturada_pendiente_subir_meli"
            return

        # Sin factura en ningún lado → ¿ya se entregó y desde cuándo? No se
        # marca "sin_facturar" antes del plazo de entrega (Flujo G/H de
        # CLAUDE.md: se factura AL entregarse, no al vender).
        orden_completa = consultar_orden_meli_completa(fila["order_id"], token=token_meli)
        shipping_id = ((orden_completa or {}).get("shipping") or {}).get("id")
        envio = consultar_envio_meli(str(shipping_id), token=token_meli) if shipping_id else None
        estado_envio = (envio or {}).get("status")
        fila["shipping_status"] = estado_envio
        if estado_envio != "delivered":
            fila["estado_facturacion"] = "en_transito"
            return
        fecha_entrega_txt = (
            ((envio or {}).get("status_history") or {}).get("date_delivered")
            or (envio or {}).get("date_created")
        )
        en_margen = True
        if fecha_entrega_txt:
            try:
                fe = datetime.fromisoformat(str(fecha_entrega_txt).replace("Z", "+00:00"))
                ahora = datetime.now(fe.tzinfo) if fe.tzinfo else datetime.now()
                en_margen = (ahora - fe) < timedelta(hours=margen_horas)
            except ValueError:
                en_margen = False
        fila["estado_facturacion"] = "en_margen_entrega" if en_margen else "sin_facturar"

    if filas_meli:
        with ThreadPoolExecutor(max_workers=10) as pool:
            list(pool.map(_procesar_fila_meli, filas_meli))

    for fila in filas:
        if not fila["es_meli"]:
            fila["venta_original"] = _detalle_venta_web(fila["order_id"])

    # Canceladas: estado según nota crédito (Alegra o legado) + margen 48h.
    for fila in filas_meli:
        if not fila["es_cancelada"]:
            continue
        tiene_nc_alegra = any(f["notas_credito"] for f in fila["facturas"])
        if not fila["facturas"] and not fila["factura_legado"]:
            fila["estado_facturacion"] = "cancelada_sin_factura"
        elif tiene_nc_alegra or fila["nota_credito_legado"]:
            resuelto = tiene_nc_alegra or bool(fila["nc_subida_meli_legado"])
            fila["estado_facturacion"] = "cancelada_resuelta" if resuelto else "cancelada_nc_sin_subir_meli"
        else:
            fc = _fecha_cancelacion(ordenes_por_id.get(fila["order_id"], {}))
            en_margen = False
            if fc:
                ahora = datetime.now(fc.tzinfo) if fc.tzinfo else datetime.now()
                en_margen = (ahora - fc) < timedelta(hours=margen_horas)
            fila["estado_facturacion"] = "cancelada_en_margen" if en_margen else "cancelada_pendiente_nc"

    resultado = {
        "ventas": filas,
        "total": len(filas),
        # Cuántas ventas hay realmente en el rango/segmento pedido, antes de
        # recortar por `limite` — para que el panel diga honestamente
        # "mostrando 30 de 415" en vez de dar a entender que 30 es TODO lo
        # que hay (confirmado en vivo 2026-09-04: con "Todas" + 30 días el
        # panel mostraba silenciosamente solo las 30 más recientes).
        "total_en_rango": total_en_rango,
        "actualizado_en": datetime.now().isoformat(timespec="seconds"),
    }
    _cache[cache_key] = (_time.time(), resultado)
    # El histórico se llena solo con el uso normal del panel: cada listado en
    # vivo deja sus filas persistidas para que la vista "Histórico" pueda
    # mostrar miles sin volver a consultar MeLi (ver facturacion_ventas_cache).
    _guardar_en_cache(filas)
    return resultado


def items_flaggeados_para_ticket(resultado: dict) -> list[dict]:
    """De un resultado de `listar_ventas_meli_unificado`, arma los items para
    `app.tools.revision_facturacion.crear_o_actualizar_ticket_revision_facturacion`
    — solo lo que amerita revisión humana, no lo informativo (`en_transito`,
    `en_margen_entrega`, `facturada_completa`)."""
    items = []
    for v in resultado.get("ventas") or []:
        if v.get("revisado"):
            continue
        estado = v.get("estado_facturacion")
        tipo = None
        motivo = None
        if v.get("facturacion_parcial"):
            cruce = v.get("cruce") or {}
            faltan = ", ".join(
                f"{f.get('nombre') or f.get('sku')} (x{f.get('cantidad'):g})" for f in (cruce.get("faltantes") or [])[:5]
            )
            tipo = "facturacion_parcial"
            motivo = (
                f"La factura no cubre todo lo comprado: {cruce.get('resumen')}. "
                f"Faltan: {faltan}. Diferencia ${cruce.get('diferencia', 0):,.0f}."
            )
        elif v.get("posible_duplicado"):
            tipo = "posible_duplicado"
            legado = v.get("factura_legado") or {}
            ref_legado = legado.get("factura_numero") or legado.get("factura_id") or "sin número"
            motivo = f"También facturada en {legado.get('integracion') or 'Siigo'} ({ref_legado})"
        elif estado == "facturada_pendiente_subir_meli":
            tipo = "facturada_pendiente_subir_meli"
            motivo = "Factura existe en Alegra pero MeLi no tiene el documento fiscal."
        elif estado == "sin_facturar":
            tipo = "sin_facturar"
            motivo = "Entregada hace más del margen y sin factura en Alegra ni en el índice legado."
        elif estado == "cancelada_pendiente_nc":
            tipo = "cancelada_pendiente_nc"
            motivo = "Cancelada, facturada, y sin nota crédito pasado el margen de 48h."
        if tipo:
            items.append({"order_id": v["order_id"], "tipo": tipo, "motivo_sugerido": motivo})
    return items


def consultar_venta_individual(identificador: str) -> dict | None:
    """Busca UNA venta MeLi por order_id o pack_id, sin importar el rango de
    días ni el `limite` del listado masivo.

    Necesario porque `listar_ventas_meli_unificado` ordena por fecha y
    recorta por `limite` — con el volumen real de McKenna (cientos de
    órdenes por semana), una venta puntual (la que trae un reclamo, un
    mensaje de WhatsApp) puede quedar fuera de las primeras N filas, y la
    búsqueda del panel hoy solo filtra lo YA cargado, no busca en MeLi. Un
    operador con un ID concreto en la mano veía "sin resultados" para una
    venta que en realidad sí existe y está resuelta (confirmado en vivo
    2026-09-05, ticket TKT-2026-1156/1160: pack 2000014865364705, MeLi ya
    tenía el documento fiscal pero no estaba entre las filas cargadas).
    """
    identificador = str(identificador or "").strip()
    if not identificador or not identificador.isdigit():
        return None

    from app.utils import refrescar_token_meli

    token_meli = refrescar_token_meli()
    orden = consultar_orden_meli_completa(identificador, token=token_meli)
    if orden and orden.get("id"):
        order_id = str(orden["id"])
        pack_id = str(orden.get("pack_id") or order_id)
    else:
        # No es un order_id válido — probar como pack_id. Un pack puede tener
        # pack_id != order_id incluso con una sola orden adentro (confirmado
        # en vivo: no es exclusivo de packs multi-orden).
        pack = consultar_pack_meli(identificador, token=token_meli)
        ordenes_pack = (pack or {}).get("orders") or []
        if not pack or not ordenes_pack:
            return None
        pack_id = str(pack.get("id") or identificador)
        order_id = str(ordenes_pack[0].get("id") or "")
        if not order_id:
            return None
        orden = consultar_orden_meli_completa(order_id, token=token_meli)
        if not orden:
            return None

    try:
        headers = _alegra_headers()
        facturas, notas_por_factura = _facturas_alegra_para_consulta_puntual(headers)
    except RuntimeError:
        facturas, notas_por_factura = [], {}

    # Órdenes hermanas del pack: hacen falta para cruzar TODO lo comprado en el
    # carrito contra todo lo facturado (ver `construir_cruce_pack`). Con una sola
    # orden a la vista, una factura parcial de un pack se ve perfecta.
    pack_detalle = consultar_pack_meli(pack_id, token=token_meli) if pack_id != order_id else None
    ordenes_hermanas = [str(o.get("id")) for o in (pack_detalle or {}).get("orders") or [] if o.get("id")]
    if order_id not in ordenes_hermanas:
        ordenes_hermanas.append(order_id)

    facturas_orden = sorted(
        [f for f in facturas if (f.get("purchase_order") or f.get("anotation") or "").strip() == order_id],
        key=lambda f: f.get("date") or "",
    )
    facturas_out = []
    for f in facturas_orden:
        fid = str(f.get("id"))
        stamp = f.get("stamp") or {}
        facturas_out.append({
            "factura_id": fid,
            "numero": (f.get("numberTemplate") or {}).get("fullNumber"),
            "fecha": f.get("date"),
            "estado": f.get("status"),
            "total": f.get("total"),
            "cufe": stamp.get("cufe") or "",
            "url": f"https://app.alegra.com/invoice/view/id/{fid}",
            "notas_credito": notas_por_factura.get(fid, []),
            "items": [
                {"sku": it.get("code") or "—", "nombre": it.get("description"),
                 "cantidad": it.get("quantity"), "total": it.get("total")}
                for it in items_hibridos_normalizados(f)
            ],
        })

    indice_legado = leer_indice_facturacion_meli().get("indice", {})
    legado = _sin_autorreferencia(indice_legado.get(order_id) or indice_legado.get(pack_id), facturas_out)
    if not legado and facturas_orden:
        pack_real = _resolver_pack_id_meli(order_id, token=token_meli)
        if pack_real and pack_real != order_id:
            legado = _sin_autorreferencia(indice_legado.get(pack_real), facturas_out)

    cliente = None
    for f in facturas_orden:
        cliente = _cliente_desde_factura(f)
        if cliente:
            break

    es_cancelada = orden.get("status") == "cancelled"
    fila = {
        "order_id": order_id,
        "pack_id": pack_id,
        "es_meli": True,
        "es_cancelada": es_cancelada,
        "fecha": orden.get("date_closed") or orden.get("date_created"),
        "total": orden.get("total_amount"),
        "meli_url": f"https://vendedores.mercadolibre.com.co/ventas/{pack_id}/detalle",
        "cliente": cliente,
        "facturas_cliente_en_rango": 0,  # búsqueda puntual: no se agrega contra el rango cargado
        "facturas": facturas_out,
        "factura_legado": legado,
        "posible_duplicado": bool(legado and facturas_orden),
        "monto_discrepancia": False,
        "nota_credito_legado": None,
        "nc_subida_meli_legado": None,
        "venta_original": _detalle_venta_meli(order_id, token=token_meli),
        "ordenes_del_pack": len(ordenes_hermanas),
    }

    # Cruce a nivel pack: lo comprado en TODAS las órdenes del carrito contra
    # todas las facturas vigentes del pack (incluida una consolidada emitida
    # contra el pack_id).
    items_comprados: list[dict] = []
    hermanas_sin_detalle = 0
    for oid_h in ordenes_hermanas:
        det = fila["venta_original"] if oid_h == order_id else _detalle_venta_meli(oid_h, token=token_meli)
        if not det:
            # Un reintento: MeLi devuelve vacío de forma intermitente bajo carga
            # (confirmado en vivo 2026-09-09 con el pack 2000014920695311, donde
            # una de 7 órdenes no respondió y el cruce reportó un faltante falso).
            det = _detalle_venta_meli(oid_h, token=token_meli)
        if not det or not (det.get("items") or []):
            hermanas_sin_detalle += 1
            continue
        items_comprados.extend(det["items"])
    claves_pack = {pack_id, *ordenes_hermanas}
    facturas_pack_raw = sorted(
        [f for f in facturas if (f.get("purchase_order") or f.get("anotation") or "").strip() in claves_pack],
        key=lambda f: f.get("date") or "",
    )
    facturas_pack_out = [
        {
            "factura_id": str(f.get("id")),
            "numero": (f.get("numberTemplate") or {}).get("fullNumber"),
            "fecha": f.get("date"),
            "estado": f.get("status"),
            "total": f.get("total"),
            "cufe": (f.get("stamp") or {}).get("cufe") or "",
            "url": f"https://app.alegra.com/invoice/view/id/{f.get('id')}",
            "notas_credito": notas_por_factura.get(str(f.get("id")), []),
            "items": [
                {"sku": it.get("code") or "—", "nombre": it.get("description"),
                 "cantidad": it.get("quantity"), "total": it.get("total")}
                for it in items_hibridos_normalizados(f)
            ],
        }
        for f in facturas_pack_raw
    ]
    # La fila representa la VENTA completa: carrito, total pagado y todas las
    # facturas del pack (misma regla que en el listado — una fila por pack).
    if items_comprados:
        fila["venta_original"] = {
            "total_pagado": round(sum(float(i.get("cantidad") or 0) * float(i.get("precio_unitario") or 0) for i in items_comprados), 2),
            "items": items_comprados,
        }
        fila["total"] = fila["venta_original"]["total_pagado"]
    fila["ordenes_ids"] = ordenes_hermanas
    if len(ordenes_hermanas) > 1:
        fila["facturas"] = facturas_pack_out
        facturas_orden = facturas_pack_raw

    if not es_cancelada:
        cruce = construir_cruce_pack(
            items_comprados, facturas_pack_out, bool(legado),
            datos_incompletos=hermanas_sin_detalle > 0,
        )
        fila["cruce"] = cruce
        fila["facturacion_parcial"] = bool(
            cruce["concluyente"] and cruce["faltantes"] and cruce["total_facturado"] > 0
        )

    from app.tools.revision_facturacion import pasos_abiertos_facturacion, revisado_map_facturacion

    revis = revisado_map_facturacion().get(order_id)
    abierto = pasos_abiertos_facturacion().get(order_id)
    fila["revisado"] = bool(revis)
    fila["revisado_notas"] = revis.get("notas") if revis else None
    fila["ticket_id"] = (revis or abierto or {}).get("ticket_id")
    fila["paso_id"] = (revis or abierto or {}).get("paso_id")

    if es_cancelada:
        fila["estado_facturacion"] = "cancelada_resuelta" if (legado or facturas_orden) else "cancelada_sin_factura"
        _guardar_en_cache([fila])
        return fila

    cruce_fila = fila.get("cruce") or {}
    cubierta_por_pack = bool(cruce_fila.get("ok")) and cruce_fila.get("total_facturado", 0) > 0
    facturas_vigentes_orden = [f for f in facturas_out if not f.get("notas_credito")]
    if facturas_vigentes_orden or legado or cubierta_por_pack:
        tiene_doc = meli_pack_tiene_documento_fiscal(pack_id, token=token_meli)
        fila["meli_doc_fiscal"] = tiene_doc
        if fila.get("facturacion_parcial"):
            fila["estado_facturacion"] = "facturada_parcial"
        else:
            fila["estado_facturacion"] = "facturada_completa" if tiene_doc else "facturada_pendiente_subir_meli"
        _guardar_en_cache([fila])
        return fila

    shipping_id = (orden.get("shipping") or {}).get("id")
    envio = consultar_envio_meli(str(shipping_id), token=token_meli) if shipping_id else None
    estado_envio = (envio or {}).get("status")
    fila["shipping_status"] = estado_envio
    if estado_envio != "delivered":
        fila["estado_facturacion"] = "en_transito"
        return fila

    margen_horas = _margen_horas_default()
    fecha_entrega_txt = (
        ((envio or {}).get("status_history") or {}).get("date_delivered") or (envio or {}).get("date_created")
    )
    en_margen = True
    if fecha_entrega_txt:
        try:
            fe = datetime.fromisoformat(str(fecha_entrega_txt).replace("Z", "+00:00"))
            ahora = datetime.now(fe.tzinfo) if fe.tzinfo else datetime.now()
            en_margen = (ahora - fe) < timedelta(hours=margen_horas)
        except ValueError:
            en_margen = False
    fila["estado_facturacion"] = "en_margen_entrega" if en_margen else "sin_facturar"
    _guardar_en_cache([fila])
    return fila
