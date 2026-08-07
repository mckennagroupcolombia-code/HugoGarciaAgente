"""
Libro de ingresos / egresos para Contabilidad.

Fuentes:
- Ingresos: Siigo + MeLi + página web (orders.db)
- Egresos: compras Gmail + cobros MeLi + impuestos + servicios +
  cuentas de cobro del correo (honorarios/contabilidad)

Las fuentes remotas (Siigo / MeLi) corren en paralelo con presupuesto de tiempo
para que el panel no se quede en "Cargando…" indefinidamente.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta
from typing import Any

# Presupuesto para APIs remotas en el panel (segundos). Lo local siempre se incluye.
_REMOTE_BUDGET_S = 28.0
_SIIGO_PAGE_SIZE = 100
_SIIGO_MAX_PAGES = 20
_MELI_MAX_PAGES = 25
_CACHE_TTL_S = 90.0
_libro_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def invalidar_cache_libro() -> None:
    """Limpia caché del libro (tras vincular extracto, sync cobros, etc.)."""
    _libro_cache.clear()


def _segundos_restantes(deadline: float, *, tope: float = 15.0) -> float:
    return max(3.0, min(tope, deadline - time.monotonic()))

_HISTORIAL_COMPRA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "facturas_compra_historial.json",
)
_CUENTAS_COBRO = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "cuentas_cobro_correo.json",
)
_ORDERS_DB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "PAGINA_WEB",
    "site",
    "data",
    "orders.db",
)

_COBRO_RE = re.compile(r"cuenta\s*de\s*cobro|honorarios\s+asesoria", re.I)


def _fecha10(val: Any) -> str:
    s = str(val or "").strip()
    if not s:
        return ""
    # 2026-05-22T… or 2026-05-22
    if "T" in s:
        s = s.split("T", 1)[0]
    return s[:10]


def _en_rango(fecha: str, desde: str, hasta: str) -> bool:
    f = _fecha10(fecha)
    if not f:
        return False
    return desde <= f <= hasta


def _row(
    *,
    fecha: str,
    tipo: str,
    fuente: str,
    concepto: str,
    monto: float,
    referencia: str = "",
    contraparte: str = "",
    extra: dict | None = None,
) -> dict[str, Any]:
    return {
        "fecha": _fecha10(fecha),
        "tipo": tipo,  # ingreso | egreso
        "fuente": fuente,
        "concepto": (concepto or "")[:220],
        "monto": round(float(monto or 0), 2),
        "referencia": (referencia or "")[:80],
        "contraparte": (contraparte or "")[:120],
        "extra": extra or {},
    }


def _egresos_compras(desde: str, hasta: str) -> list[dict]:
    """Facturas de compra confirmadas (Gmail → Siigo).

    Usa la fecha de *registro/pago* (`timestamp`) para el flujo de caja del período.
    La fecha del documento queda en `extra.fecha_factura`.
    """
    if not os.path.isfile(_HISTORIAL_COMPRA):
        return []
    try:
        with open(_HISTORIAL_COMPRA, encoding="utf-8") as f:
            data = json.load(f)
        hist = data.get("historial") if isinstance(data, dict) else data
    except Exception:
        return []
    out = []
    for h in hist or []:
        if not isinstance(h, dict):
            continue
        accion = (h.get("accion") or "compra").strip().lower()
        if accion == "omitida":
            continue
        fecha_factura = _fecha10(h.get("fecha_factura") or "")
        fecha_reg = _fecha10(h.get("timestamp") or "")
        # Flujo de caja: cuándo se registró/pagó; fallback a fecha documento
        fecha = fecha_reg or fecha_factura
        if not _en_rango(fecha, desde, hasta):
            continue
        monto = float(h.get("total") or 0)
        if monto <= 0:
            continue
        num = str(h.get("numero_factura") or h.get("id") or "")
        out.append(
            _row(
                fecha=fecha,
                tipo="egreso",
                fuente="compra_gmail",
                # Concepto sin número: la UI agrupa por concepto+fecha.
                concepto=f"Pago factura compra ({accion})".strip(),
                monto=monto,
                referencia=num,
                contraparte=str(h.get("proveedor") or ""),
                extra={
                    "nit": h.get("nit"),
                    "estado": h.get("estado"),
                    "accion": accion,
                    "fecha_factura": fecha_factura,
                    "fecha_registro": fecha_reg,
                },
            )
        )
    return out


def _total_compra_exterior_cop(c: dict) -> float:
    """Mercancía + flete en COP."""
    mon = str(c.get("moneda") or "USD").upper()
    trm = float(c.get("trm") or (1.0 if mon == "COP" else 0.0))
    if mon != "COP" and trm <= 0:
        return 0.0
    lineas = c.get("lineas") if isinstance(c.get("lineas"), list) else []
    sub = 0.0
    for ln in lineas:
        if not isinstance(ln, dict):
            continue
        s = float(ln.get("subtotal") or 0)
        if s <= 0:
            packs = float(ln.get("cantidad") or 0)
            s = packs * float(ln.get("precio_unit") or 0)
        sub += max(s, 0.0)
    merc_cop = sub if mon == "COP" else sub * trm
    flete = float(c.get("flete") or 0)
    mf = str(c.get("moneda_flete") or mon).upper()
    if flete > 0:
        if mf == "COP":
            merc_cop += flete
        else:
            merc_cop += flete * (trm if trm > 0 else 0.0)
    return round(merc_cop, 2)


def _egresos_compras_exterior(desde: str, hasta: str) -> list[dict]:
    """Compras exterior del panel Contabilidad (flujo de caja por fecha de registro)."""
    try:
        from app.services.contabilidad_db import listar_compras_exterior
        compras = listar_compras_exterior(limit=200)
    except Exception:
        return []
    out = []
    for c in compras or []:
        fecha_compra = _fecha10(c.get("fecha_compra") or "")
        fecha_reg = _fecha10(c.get("created_at") or "")
        # Igual que facturas: cuándo se registró en el panel; fallback a fecha_compra
        fecha = fecha_reg or fecha_compra
        if not _en_rango(fecha, desde, hasta):
            continue
        monto = _total_compra_exterior_cop(c)
        if monto <= 0:
            continue
        cid = c.get("id")
        prov = str(c.get("proveedor") or "").strip() or "Compra exterior"
        n_lin = len(c.get("lineas") or [])
        mon = str(c.get("moneda") or "").upper()
        concepto = "Compra exterior"
        if mon and mon != "COP":
            concepto += f" ({mon})"
        out.append(
            _row(
                fecha=fecha,
                tipo="egreso",
                fuente="compra_exterior",
                concepto=concepto,
                monto=monto,
                referencia=str(cid or ""),
                contraparte=prov,
                extra={
                    "moneda": c.get("moneda"),
                    "trm": c.get("trm"),
                    "flete": c.get("flete"),
                    "fecha_compra": fecha_compra,
                    "fecha_registro": fecha_reg,
                    "n_lineas": n_lin,
                },
            )
        )
    return out


def _egresos_impuestos(desde: str, hasta: str) -> list[dict]:
    try:
        from app.services.impuestos import listar_pagos
        pagos = listar_pagos()
    except Exception:
        return []
    out = []
    for p in pagos:
        fecha = p.get("fecha_pago") or ""
        if not _en_rango(fecha, desde, hasta):
            continue
        monto = float(p.get("monto") or 0)
        if monto <= 0:
            continue
        periodo = p.get("periodo") or ""
        tipo_imp = p.get("tipo") or "Impuesto"
        out.append(
            _row(
                fecha=fecha,
                tipo="egreso",
                fuente="operativos_impuestos",
                concepto=f"{tipo_imp}" + (f" · {periodo}" if periodo else ""),
                monto=monto,
                referencia=str(p.get("referencia") or p.get("id") or ""),
                contraparte=str(p.get("entidad") or "DIAN"),
            )
        )
    return out


def _es_cuenta_cobro_correo(comprobante: str, notas: str) -> bool:
    blob = f"{comprobante or ''} {notas or ''}"
    return bool(_COBRO_RE.search(blob))


def _egresos_servicios_y_cobros(desde: str, hasta: str) -> tuple[list[dict], list[dict]]:
    """Servicios/operativos del panel + cuentas de cobro del correo (sin duplicar)."""
    servicios: list[dict] = []
    claves_srv: set[tuple[str, float]] = set()
    try:
        from app.services.contabilidad_db import _conn, _ensure
        _ensure()
        with _conn() as con:
            rows = con.execute(
                """
                SELECT p.fecha, p.monto, p.comprobante, p.notas, p.id AS pago_id,
                       s.empresa
                FROM pagos_servicios p
                JOIN servicios s ON s.id = p.servicio_id
                WHERE p.fecha >= ? AND p.fecha <= ?
                ORDER BY p.fecha DESC
                """,
                (desde, hasta),
            ).fetchall()
        for r in rows:
            monto = float(r["monto"] or 0)
            if monto <= 0:
                continue
            empresa = r["empresa"] or "Servicio"
            notas = (r["notas"] or "").strip()
            comp = str(r["comprobante"] or "")
            fecha = _fecha10(r["fecha"] or "")
            # Todos los pagos de Operativos → Servicios (incl. honorarios/cuentas de cobro).
            servicios.append(
                _row(
                    fecha=fecha,
                    tipo="egreso",
                    fuente="operativos_servicios",
                    concepto=notas or f"Pago servicio · {empresa}",
                    monto=monto,
                    referencia=comp or str(r["pago_id"] or ""),
                    contraparte=empresa,
                    extra={"es_cuenta_cobro": _es_cuenta_cobro_correo(comp, notas)},
                )
            )
            if fecha:
                claves_srv.add((fecha, round(monto, 0)))
    except Exception:
        pass

    cobros: list[dict] = []

    def _add_cobro(c: dict) -> None:
        fecha = _fecha10(c.get("fecha") or c.get("email_date") or "")
        if not _en_rango(fecha, desde, hasta):
            return
        monto = float(c.get("monto") or 0)
        if monto <= 0:
            return
        # Evitar duplicar lo ya cargado desde Operativos → Servicios
        if (fecha, round(monto, 0)) in claves_srv:
            return
        cobros.append(
            _row(
                fecha=fecha,
                tipo="egreso",
                fuente="cuenta_cobro_correo",
                concepto=str(c.get("concepto") or c.get("subject") or "Cuenta de cobro"),
                monto=monto,
                referencia=str(c.get("filename") or c.get("mid") or ""),
                contraparte=str(c.get("beneficiario") or c.get("from") or ""),
                extra={"origen": "correo", "periodo": c.get("periodo")},
            )
        )

    try:
        from app.services.cuentas_cobro_correo import cargar_cobros
        for c in cargar_cobros():
            _add_cobro(c)
    except Exception:
        if os.path.isfile(_CUENTAS_COBRO):
            try:
                with open(_CUENTAS_COBRO, encoding="utf-8") as f:
                    data = json.load(f)
                for c in data.get("cobros") or []:
                    _add_cobro(c)
            except Exception:
                pass
    return servicios, cobros


def _ingresos_web(desde: str, hasta: str) -> list[dict]:
    """Ventas aprobadas de la tienda web (orders.db)."""
    if not os.path.isfile(_ORDERS_DB):
        return []
    try:
        con = sqlite3.connect(_ORDERS_DB)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT reference, buyer_name, total, status, created_at
            FROM orders
            WHERE lower(status) = 'approved'
              AND substr(created_at, 1, 10) >= ?
              AND substr(created_at, 1, 10) <= ?
            ORDER BY created_at DESC
            """,
            (desde, hasta),
        ).fetchall()
        con.close()
    except Exception:
        return []
    out = []
    for r in rows:
        monto = float(r["total"] or 0)
        if monto <= 0:
            continue
        fecha = _fecha10(r["created_at"])
        ref = str(r["reference"] or "")
        out.append(
            _row(
                fecha=fecha,
                tipo="ingreso",
                fuente="web_venta",
                concepto="Venta página web",
                monto=monto,
                referencia=ref,
                contraparte=str(r["buyer_name"] or ""),
                extra={"status": r["status"]},
            )
        )
    return out


def _facturas_siigo_rapido(
    desde: str,
    hasta: str,
    *,
    deadline: float,
) -> tuple[list[dict], str | None]:
    """Lista facturas Siigo con page_size alto y tope de tiempo (panel interactivo)."""
    try:
        import requests
        from app.services.siigo import (
            PARTNER_ID,
            autenticar_siigo,
            _siigo_retry_after_seconds,
            _invalidar_cache_token_siigo,
        )
    except Exception as e:
        return [], str(e)

    token = autenticar_siigo()
    if not token:
        return [], "Sin credenciales / token Siigo"

    facturas: list[dict] = []
    page = 1
    truncado = False
    aviso: str | None = None
    puede_reintentar_auth = True
    reintentos_429 = 0

    while page <= _SIIGO_MAX_PAGES:
        if time.monotonic() >= deadline:
            truncado = True
            aviso = f"Siigo: tiempo límite; {len(facturas)} facturas parciales"
            break
        try:
            params = {
                "created_start": desde,
                "page": page,
                "page_size": _SIIGO_PAGE_SIZE,
            }
            if hasta:
                params["created_end"] = hasta
            to = _segundos_restantes(deadline, tope=12.0)
            res = requests.get(
                "https://api.siigo.com/v1/invoices",
                headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"},
                params=params,
                timeout=to,
            )
        except requests.Timeout:
            truncado = True
            aviso = f"Siigo: timeout; {len(facturas)} facturas parciales"
            break
        except Exception as e:
            if facturas:
                return facturas, f"Siigo: error parcial ({len(facturas)} facturas): {e}"
            return [], f"Siigo red: {e}"

        if res.status_code == 200:
            data = res.json() or {}
            batch = data.get("results") or []
            if not batch:
                break
            facturas.extend(batch)
            pag = data.get("pagination") or {}
            total = int(pag.get("total_results") or 0)
            if total and len(facturas) >= total:
                break
            if len(batch) < _SIIGO_PAGE_SIZE:
                break
            page += 1
            reintentos_429 = 0
            continue

        if res.status_code == 401 and puede_reintentar_auth:
            _invalidar_cache_token_siigo()
            token = autenticar_siigo(forzar=True)
            puede_reintentar_auth = False
            if not token:
                return facturas, "Siigo 401 sin token"
            continue

        if res.status_code == 429 and reintentos_429 < 3:
            reintentos_429 += 1
            espera = min(int(_siigo_retry_after_seconds(res)), 5)
            if time.monotonic() + espera >= deadline:
                truncado = True
                aviso = f"Siigo: rate limit; {len(facturas)} facturas parciales"
                break
            time.sleep(espera)
            continue

        return facturas, f"Siigo HTTP {res.status_code}"

    if page > _SIIGO_MAX_PAGES and not truncado:
        truncado = True
        aviso = f"Siigo: tope de páginas; {len(facturas)} facturas parciales"
    return facturas, aviso if truncado else None


def _ingresos_siigo(
    desde: str,
    hasta: str,
    *,
    deadline: float | None = None,
) -> tuple[list[dict], str | None]:
    dl = deadline if deadline is not None else (time.monotonic() + _REMOTE_BUDGET_S)
    facturas, aviso = _facturas_siigo_rapido(desde, hasta, deadline=dl)
    out = []
    for f in facturas or []:
        fecha = _fecha10(f.get("date"))
        if not _en_rango(fecha, desde, hasta):
            continue
        monto = float(f.get("total") or 0)
        if monto <= 0:
            continue
        num = ""
        name = f.get("name") or {}
        if isinstance(name, dict):
            pref = name.get("prefix") or ""
            number = name.get("number") or ""
            num = f"{pref}{number}".strip()
        cliente = ""
        cust = f.get("customer") or {}
        if isinstance(cust, dict):
            cliente = str(cust.get("identification") or cust.get("id") or "")
        out.append(
            _row(
                fecha=fecha,
                tipo="ingreso",
                fuente="siigo_venta",
                # Concepto fijo: la UI agrupa por concepto+fecha (sumatoria del día).
                # El número de factura va en referencia.
                concepto="Venta Siigo",
                monto=monto,
                referencia=num or str(f.get("id") or ""),
                contraparte=cliente,
            )
        )
    return out, aviso


def _meli_ordenes_rango(
    desde: str,
    hasta: str,
    *,
    max_pages: int = _MELI_MAX_PAGES,
    deadline: float | None = None,
) -> tuple[list[dict], list[dict], str | None]:
    """Ingresos por ventas MeLi pagadas + egresos por comisión (marketplace_fee)."""
    try:
        import requests
        from app.utils import refrescar_token_meli

        dl = deadline if deadline is not None else (time.monotonic() + _REMOTE_BUDGET_S)
        token = refrescar_token_meli()
        if not token:
            return [], [], "Sin token MeLi"
        headers = {"Authorization": f"Bearer {token}", "x-version": "2"}
        me = requests.get(
            "https://api.mercadolibre.com/users/me", headers=headers, timeout=15
        )
        if me.status_code != 200:
            return [], [], f"MeLi users/me {me.status_code}"
        seller_id = me.json().get("id")
        # MeLi usa ISO; ampliar un día al tope por timezone
        desde_iso = f"{desde}T00:00:00.000-05:00"
        hasta_dt = datetime.strptime(hasta, "%Y-%m-%d") + timedelta(days=1)
        hasta_iso = hasta_dt.strftime("%Y-%m-%dT00:00:00.000-05:00")

        ingresos: list[dict] = []
        egresos: list[dict] = []
        offset, limit = 0, 50
        pages = 0
        total_n = 0
        truncado = False
        while pages < max_pages:
            if time.monotonic() >= dl:
                truncado = True
                break
            url = (
                f"https://api.mercadolibre.com/orders/search?seller={seller_id}"
                f"&order.date_created.from={desde_iso}"
                f"&order.date_created.to={hasta_iso}"
                f"&order.status=paid&sort=date_desc&limit={limit}&offset={offset}"
            )
            to = _segundos_restantes(dl, tope=12.0)
            res = requests.get(url, headers=headers, timeout=to)
            if res.status_code != 200:
                return ingresos, egresos, f"MeLi orders {res.status_code}"
            data = res.json() or {}
            results = data.get("results") or []
            for o in results:
                fecha = _fecha10(o.get("date_closed") or o.get("date_created"))
                if not _en_rango(fecha, desde, hasta):
                    continue
                oid = str(o.get("id") or "")
                pack = str(o.get("pack_id") or oid)
                total = float(o.get("total_amount") or 0)
                if total > 0:
                    buyer = o.get("buyer") or {}
                    nickname = buyer.get("nickname") if isinstance(buyer, dict) else ""
                    ingresos.append(
                        _row(
                            fecha=fecha,
                            tipo="ingreso",
                            fuente="meli_venta",
                            concepto="Venta MeLi",
                            monto=total,
                            referencia=pack,
                            contraparte=str(nickname or ""),
                            extra={"order_id": oid},
                        )
                    )
                fee = 0.0
                for pay in o.get("payments") or []:
                    if not isinstance(pay, dict):
                        continue
                    fee += float(pay.get("marketplace_fee") or 0)
                if fee <= 0:
                    fee = float(o.get("marketplace_fee") or 0)
                if fee > 0:
                    egresos.append(
                        _row(
                            fecha=fecha,
                            tipo="egreso",
                            fuente="meli_cobro",
                            concepto="Comisión MeLi",
                            monto=fee,
                            referencia=pack,
                            contraparte="Mercado Libre",
                            extra={"order_id": oid},
                        )
                    )
            paging = data.get("paging") or {}
            total_n = int(paging.get("total") or 0)
            offset += limit
            pages += 1
            if offset >= total_n or not results:
                break
            if pages >= max_pages and offset < total_n:
                truncado = True
                break
        aviso = None
        if truncado:
            aviso = f"MeLi: resultado parcial ({len(ingresos)} ventas)"
        return ingresos, egresos, aviso
    except Exception as e:
        return [], [], str(e)


def armar_libro(
    desde: str,
    hasta: str | None = None,
    *,
    incluir_meli: bool = True,
    incluir_siigo: bool = True,
) -> dict[str, Any]:
    """Devuelve movimientos ordenados por fecha + totales."""
    desde = _fecha10(desde)
    hasta = _fecha10(hasta) or datetime.now().strftime("%Y-%m-%d")
    if not desde:
        raise ValueError("desde requerido (YYYY-MM-DD)")

    cache_key = f"{desde}|{hasta}|{int(incluir_meli)}|{int(incluir_siigo)}"
    hit = _libro_cache.get(cache_key)
    if hit and (time.time() - hit[0]) < _CACHE_TTL_S:
        return hit[1]

    avisos: list[str] = []
    movimientos: list[dict] = []

    # Egresos / ingresos locales (rápidos)
    movimientos.extend(_egresos_compras(desde, hasta))
    movimientos.extend(_egresos_compras_exterior(desde, hasta))
    movimientos.extend(_egresos_impuestos(desde, hasta))
    srv_rows, cobro_rows = _egresos_servicios_y_cobros(desde, hasta)
    movimientos.extend(srv_rows)
    movimientos.extend(cobro_rows)
    movimientos.extend(_ingresos_web(desde, hasta))

    deadline = time.monotonic() + _REMOTE_BUDGET_S
    if incluir_siigo or incluir_meli:
        # No usar `with ThreadPoolExecutor`: al salir espera hilos que aún
        # pueden estar en un requests.get y alarga la respuesta del panel.
        pool = ThreadPoolExecutor(max_workers=2)
        futures: dict[Any, str] = {}
        try:
            if incluir_siigo:
                futures[pool.submit(_ingresos_siigo, desde, hasta, deadline=deadline)] = "siigo"
            if incluir_meli:
                futures[
                    pool.submit(_meli_ordenes_rango, desde, hasta, deadline=deadline)
                ] = "meli"
            done, not_done = wait(
                list(futures.keys()),
                timeout=_REMOTE_BUDGET_S + 3.0,
            )
            for fut in done:
                kind = futures[fut]
                try:
                    if kind == "siigo":
                        ing_s, err_s = fut.result(timeout=0.1)
                        movimientos.extend(ing_s)
                        if err_s:
                            avisos.append(
                                err_s if err_s.startswith("Siigo") else f"Siigo: {err_s}"
                            )
                    else:
                        ing_m, egr_m, err_m = fut.result(timeout=0.1)
                        movimientos.extend(ing_m)
                        movimientos.extend(egr_m)
                        if err_m:
                            avisos.append(
                                err_m if err_m.startswith("MeLi") else f"MeLi: {err_m}"
                            )
                except Exception as e:
                    avisos.append(f"{'Siigo' if kind == 'siigo' else 'MeLi'}: {e}")
            for fut in not_done:
                kind = futures[fut]
                avisos.append(
                    f"{'Siigo' if kind == 'siigo' else 'MeLi'}: sin respuesta a tiempo"
                )
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    movimientos.sort(
        key=lambda r: (r.get("fecha") or "", r.get("tipo") or "", r.get("fuente") or ""),
        reverse=True,
    )

    # Id estable + vínculo a extracto bancario (si existe)
    try:
        from app.services.extracto_bancario import (
            id_movimiento_ledger,
            mapa_vinculos_por_movimiento,
        )

        for r in movimientos:
            r["id"] = id_movimiento_ledger(r)
        vinculos = mapa_vinculos_por_movimiento([r["id"] for r in movimientos])
        for r in movimientos:
            r["extracto"] = vinculos.get(r["id"])
    except Exception as e:
        avisos.append(f"Extracto bancario: {e}")
        for r in movimientos:
            r.setdefault("id", "")
            r.setdefault("extracto", None)

    total_ing = sum(r["monto"] for r in movimientos if r["tipo"] == "ingreso")
    total_egr = sum(r["monto"] for r in movimientos if r["tipo"] == "egreso")
    por_fuente: dict[str, dict[str, float]] = {}
    vinculados = 0
    for r in movimientos:
        f = r["fuente"]
        if f not in por_fuente:
            por_fuente[f] = {"ingreso": 0.0, "egreso": 0.0}
        por_fuente[f][r["tipo"]] = round(por_fuente[f][r["tipo"]] + r["monto"], 2)
        if r.get("extracto"):
            vinculados += 1

    out = {
        "desde": desde,
        "hasta": hasta,
        "movimientos": movimientos,
        "totales": {
            "ingresos": round(total_ing, 2),
            "egresos": round(total_egr, 2),
            "neto": round(total_ing - total_egr, 2),
            "cantidad": len(movimientos),
            "vinculados_extracto": vinculados,
        },
        "por_fuente": por_fuente,
        "avisos": avisos,
    }
    _libro_cache[cache_key] = (time.time(), out)
    return out
