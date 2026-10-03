"""Resolución de casos de facturación MeLi desde el panel (Facturación → Ventas →
Bandeja). Nació el 21-sep-2026: la revisión era manual (abrir cada venta, ir a
Alegra, anular a mano) y el panel solo mostraba el problema, no la salida.

Tres piezas, ninguna usa LLM:

- `contexto_venta()`: el «por qué pasó» de una venta rara, armado con evidencia
  de MeLi (reclamos, mediaciones, reembolsos, cancelaciones, envío) y de Alegra
  (qué facturas, a qué hora, con qué diferencia de segundos). Se guarda por
  venta (`contexto_venta` en facturacion_ventas_cache.db) y queda como reporte.
- `plan_anular_sobrantes()` / `anular_sobrantes()`: qué factura sobra y anularla
  con nota crédito. Regla del 9-sep: si hay factura Siigo (astroselling), esa es
  la válida y se anulan las de Alegra; si el doble es Alegra↔Alegra, se conserva
  la PRIMERA emitida y se anulan las demás.
- `subir_pdf_meli()`: la factura existe en Alegra pero MeLi no tiene el PDF.

Anular emite documentos ante la DIAN: el endpoint exige `confirmar=True` y el
panel muestra antes el plan con los números de factura.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime

import requests

from app.services import facturacion_ventas_cache as _cache_db

_MELI = "https://api.mercadolibre.com"

# Motivos de reclamo de MeLi más comunes (reason_id). Lo desconocido se muestra tal cual.
_MOTIVOS_RECLAMO = {
    "PDD9955": "producto incompleto o faltó una unidad",
    "PDD9939": "el producto no llegó",
    "PDD9944": "llegó un producto distinto",
    "PDD9943": "llegó dañado",
    "PNR9501": "no recibió el producto",
}


# ── Persistencia del reporte ─────────────────────────────────────────────

def _tabla(con: sqlite3.Connection) -> None:
    con.execute(
        "CREATE TABLE IF NOT EXISTS contexto_venta (order_id TEXT PRIMARY KEY, pack_id TEXT, "
        "payload TEXT NOT NULL, generado_en TEXT NOT NULL)"
    )


def guardar_contexto(order_id: str, pack_id: str, contexto: dict) -> None:
    _cache_db.init_db()
    with _cache_db._LOCK, _cache_db._conn() as con:
        _tabla(con)
        con.execute(
            "INSERT OR REPLACE INTO contexto_venta VALUES (?,?,?,?)",
            (str(order_id), str(pack_id or ""), json.dumps(contexto, ensure_ascii=False, default=str),
             datetime.now().isoformat(timespec="seconds")),
        )


def contextos_map() -> dict[str, dict]:
    """order_id (y pack_id) -> reporte guardado."""
    _cache_db.init_db()
    out: dict[str, dict] = {}
    with _cache_db._LOCK, _cache_db._conn() as con:
        _tabla(con)
        for r in con.execute("SELECT * FROM contexto_venta"):
            try:
                d = json.loads(r["payload"])
            except (TypeError, ValueError):
                continue
            d["generado_en"] = r["generado_en"]
            out[r["order_id"]] = d
            if r["pack_id"]:
                out.setdefault(r["pack_id"], d)
    return out


# ── Contexto: por qué pasó ───────────────────────────────────────────────

def _meli_get(path: str, token: str, **params) -> dict | None:
    try:
        r = requests.get(f"{_MELI}{path}", headers={"Authorization": f"Bearer {token}"}, params=params or None, timeout=20)
        return r.json() if r.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None


def _hora(txt: str | None) -> str:
    return (txt or "")[:19].replace("T", " ")


def contexto_venta(venta: dict) -> dict:
    """Reporte de por qué una venta tiene la facturación que tiene. `venta` es la
    fila del panel (order_id, pack_id, ordenes_ids, facturas, factura_legado, cruce)."""
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    hallazgos: list[dict] = []

    def h(tipo: str, texto: str, fuente: str) -> None:
        hallazgos.append({"tipo": tipo, "texto": texto, "fuente": fuente})

    reembolso_total = 0.0
    for oid in venta.get("ordenes_ids") or [venta.get("order_id")]:
        o = _meli_get(f"/orders/{oid}", token) or {}
        if not o:
            h("sin_dato", f"No se pudo leer la orden {oid} en MeLi.", "MeLi")
            continue
        estado = o.get("status")
        if estado == "cancelled":
            h("cancelada", f"La orden {oid} está CANCELADA en MeLi ({o.get('status_detail') or 'sin detalle'}).", "MeLi · orden")
        elif estado == "partially_refunded":
            h("reembolso", f"La orden {oid} quedó con reembolso parcial: pagó ${float(o.get('paid_amount') or 0):,.0f} "
                           f"de ${float(o.get('total_amount') or 0):,.0f}.", "MeLi · orden")
        for p in o.get("payments") or []:
            ref = float(p.get("transaction_amount_refunded") or 0)
            if ref > 0:
                reembolso_total += ref
                h("reembolso", f"MeLi devolvió ${ref:,.0f} al comprador (pago {p.get('id')}, "
                               f"{p.get('status_detail') or p.get('status')}, {_hora(p.get('date_last_modified'))}).",
                  "MeLi · pagos")
        reclamos = _meli_get("/post-purchase/v1/claims/search", token, resource_id=oid, resource="order") or {}
        for c in reclamos.get("data") or []:
            res = c.get("resolution") or {}
            motivo = _MOTIVOS_RECLAMO.get(c.get("reason_id"), c.get("reason_id") or "sin motivo")
            texto = f"Reclamo {c.get('id')} ({c.get('type')}, {c.get('status')}): {motivo}."
            if res:
                texto += (f" Resuelto por {res.get('closed_by') or '—'}: {res.get('reason') or '—'}"
                          f"{' a favor del comprador' if 'complainant' in (res.get('benefited') or []) else ''}"
                          f"{', con cobertura de MeLi' if res.get('applied_coverage') else ''}.")
            h("reclamo", texto, "MeLi · reclamos")
        sid = (o.get("shipping") or {}).get("id")
        if sid and oid == (venta.get("ordenes_ids") or [venta.get("order_id")])[0]:
            e = _meli_get(f"/shipments/{sid}", token) or {}
            if e:
                entregado = (e.get("status_history") or {}).get("date_delivered")
                h("envio", f"Envío {sid}: {e.get('status')}{' / ' + e['substatus'] if e.get('substatus') else ''}"
                           f"{' — entregado ' + _hora(entregado) if entregado else ''}.", "MeLi · envío")

    vigentes = [f for f in venta.get("facturas") or [] if not f.get("notas_credito")]
    anuladas = [f for f in venta.get("facturas") or [] if f.get("notas_credito")]
    horas = _horas_facturas_alegra([f.get("factura_id") for f in vigentes])
    if len(vigentes) >= 2:
        orden = sorted(vigentes, key=lambda f: horas.get(str(f.get("factura_id"))) or "")
        linea = " · ".join(f"{f.get('numero')} {horas.get(str(f.get('factura_id'))) or f.get('fecha')}" for f in orden)
        t0, t1 = horas.get(str(orden[0].get("factura_id"))), horas.get(str(orden[-1].get("factura_id")))
        seg = None
        try:
            seg = (datetime.fromisoformat(t1) - datetime.fromisoformat(t0)).total_seconds() if t0 and t1 else None
        except ValueError:
            seg = None
        causa = (
            f" Salieron con {int(seg)} s de diferencia: dos o más solicitudes de «Facturar ahora» sobre la misma "
            "venta al mismo tiempo (el botón tarda 30-100 s y no tenía candado; corregido el 21-sep-2026)."
            if seg is not None and seg < 600 else ""
        )
        h("doble_alegra", f"{len(vigentes)} facturas vigentes en Alegra para la misma venta: {linea}.{causa}", "Alegra")
    leg = venta.get("factura_legado") or {}
    if leg and vigentes:
        h("doble_siigo", f"Facturada en Siigo por {leg.get('integracion') or 'la integración anterior'} "
                         f"({leg.get('factura_numero')}, {leg.get('factura_fecha')}) al COMPRAR, y otra vez en Alegra "
                         f"({', '.join(str(f.get('numero')) for f in vigentes)}) al ENTREGAR — el empalme de la migración "
                         "del 2-3 sep, cuando las dos integraciones facturaban a la vez.", "Siigo + Alegra")
    for f in anuladas:
        nc = ", ".join(str(n.get("numero") or n.get("id")) for n in f.get("notas_credito") or [])
        h("anulada", f"{f.get('numero')} está anulada con {nc}.", "Alegra")

    cruce = venta.get("cruce") or {}
    for eq in cruce.get("equivalencias") or []:
        h("sku", f"Se vendió {eq['vendido']} y se facturó {eq['facturado']} (mismo producto, otro código en Alegra).", "Cruce")
    if cruce.get("reembolso_explica"):
        h("explicado", f"La diferencia entre lo vendido y lo facturado (${cruce.get('diferencia', 0):,.0f}) es lo que MeLi "
                       "reembolsó: la factura por lo realmente pagado es correcta.", "Cruce")
    elif reembolso_total and cruce.get("faltantes"):
        h("revisar", f"MeLi reembolsó ${reembolso_total:,.0f} pero no coincide con lo que falta facturar "
                     f"(${cruce.get('diferencia', 0):,.0f}). Revisar a mano.", "Cruce")

    if not hallazgos:
        h("sin_novedad", "Sin reclamos, reembolsos ni cancelaciones en MeLi.", "MeLi")
    return {"hallazgos": hallazgos, "reembolsado": round(reembolso_total, 2)}


def _horas_facturas_alegra(ids: list) -> dict[str, str]:
    """factura_id -> datetime de emisión (la lista de facturas solo trae la fecha)."""
    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    out: dict[str, str] = {}
    if not ids:
        return out
    headers = _alegra_headers()
    for fid in ids:
        try:
            r = requests.get(f"{_ALEGRA_BASE}/invoices/{fid}", headers=headers, timeout=20)
            if r.status_code == 200:
                out[str(fid)] = (r.json() or {}).get("datetime") or ""
        except requests.RequestException:
            continue
    return out


def generar_y_guardar_contexto(venta: dict) -> dict:
    ctx = contexto_venta(venta)
    guardar_contexto(venta.get("order_id"), venta.get("pack_id"), ctx)
    ctx["generado_en"] = datetime.now().isoformat(timespec="seconds")
    return ctx


# ── Anular la(s) factura(s) que sobran ───────────────────────────────────

def plan_anular_sobrantes(venta: dict) -> dict:
    """Qué se conserva y qué se anula. No emite nada."""
    vigentes = [f for f in venta.get("facturas") or [] if not f.get("notas_credito")]
    leg = venta.get("factura_legado") or {}
    if venta.get("es_cancelada") and vigentes:
        return {
            "ok": True,
            "conservar": "nada (la venta está cancelada en MeLi)",
            "anular": [{"id": f["factura_id"], "numero": f.get("numero"), "total": f.get("total")} for f in vigentes],
            "regla": "Venta cancelada: toda factura vigente se anula con nota crédito.",
        }
    if leg and vigentes:
        return {
            "ok": True,
            "conservar": f"{leg.get('factura_numero')} (Siigo, {leg.get('integracion') or '—'})",
            "anular": [{"id": f["factura_id"], "numero": f.get("numero"), "total": f.get("total")} for f in vigentes],
            "regla": "La de Siigo fue primero y es documento DIAN válido: se anulan las de Alegra y no se reemite nada.",
        }
    if len(vigentes) >= 2 and venta.get("duplicado_alegra"):
        horas = _horas_facturas_alegra([f["factura_id"] for f in vigentes])
        orden = sorted(vigentes, key=lambda f: (horas.get(str(f["factura_id"])) or "", int(str(f["factura_id"])) if str(f["factura_id"]).isdigit() else 0))
        return {
            "ok": True,
            "conservar": f"{orden[0].get('numero')} (la primera emitida)",
            "anular": [{"id": f["factura_id"], "numero": f.get("numero"), "total": f.get("total")} for f in orden[1:]],
            "regla": "Doble emisión dentro de Alegra: se conserva la primera y se anulan las repetidas.",
        }
    return {"ok": False, "error": "Esta venta no tiene facturas sobrantes que anular."}


def _items_inactivos_de_factura(factura_id: str) -> list[dict]:
    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    h = _alegra_headers()
    inv = requests.get(f"{_ALEGRA_BASE}/invoices/{factura_id}", headers=h, timeout=25).json()
    out = []
    for it in inv.get("items") or []:
        meta = requests.get(f"{_ALEGRA_BASE}/items/{it.get('id')}", headers=h, timeout=20).json()
        if (meta.get("status") or "active").strip().lower() != "active":
            out.append({"id": str(it.get("id")), "reference": meta.get("reference")})
    return out


def _set_estado_item(item_id: str, activo: bool) -> bool:
    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    r = requests.put(
        f"{_ALEGRA_BASE}/items/{item_id}", headers=_alegra_headers(),
        json={"status": "active" if activo else "inactive"}, timeout=25,
    )
    return r.status_code == 200


def anular_factura_alegra(factura_id: str, motivo: str) -> dict:
    """Nota crédito de anulación. Si Alegra la rechaza por ítems inactivos (9053),
    reactiva SOLO esos ítems, reintenta y los vuelve a inactivar (misma «opción 1»
    del 9-sep que usa scripts/regularizar_packs_parciales.py)."""
    from app.services.alegra import crear_nota_credito_alegra

    r = crear_nota_credito_alegra(factura_id=str(factura_id), motivo=motivo[:500], enviar_dian=True)
    if r.get("ok") or "9053" not in str(r.get("error") or ""):
        return r
    inactivos = _items_inactivos_de_factura(factura_id)
    reactivados = [i for i in inactivos if _set_estado_item(i["id"], True)]
    try:
        r = crear_nota_credito_alegra(factura_id=str(factura_id), motivo=motivo[:500], enviar_dian=True)
    finally:
        for i in reactivados:
            _set_estado_item(i["id"], False)
    return r


def anular_sobrantes(venta: dict, *, usuario: str = "") -> dict:
    """Ejecuta el plan. Antes de cada nota crédito vuelve a mirar en Alegra que la
    factura siga vigente (otra persona pudo haberla anulado mientras tanto)."""
    from app.services.facturacion_ventas_unificado import _notas_credito_alegra_por_factura
    from app.services.alegra import _alegra_headers

    plan = plan_anular_sobrantes(venta)
    if not plan.get("ok"):
        return plan
    notas = _notas_credito_alegra_por_factura(_alegra_headers(), "2026-09-01")
    resultados = []
    for f in plan["anular"]:
        if notas.get(str(f["id"])):
            resultados.append({**f, "ok": True, "nota": "ya estaba anulada — no se emitió otra"})
            continue
        motivo = (
            f"Anulación por doble facturación de la venta MeLi {venta.get('pack_id')}. "
            f"Se conserva {plan['conservar']}. {plan['regla']}"
            + (f" Solicitado por {usuario} desde /app." if usuario else "")
        )
        r = anular_factura_alegra(str(f["id"]), motivo)
        resultados.append({**f, "ok": bool(r.get("ok")), "nota_credito": r.get("numero") or r.get("nc_id"), "error": r.get("error")})
    return {"ok": all(x["ok"] for x in resultados), "conservar": plan["conservar"], "resultados": resultados}


# ── Subir el PDF a MeLi ──────────────────────────────────────────────────

def subir_pdf_meli(venta: dict) -> dict:
    from app.services.alegra import descargar_factura_pdf_alegra
    from app.services.meli import subir_factura_meli

    vigentes = [f for f in venta.get("facturas") or [] if not f.get("notas_credito")]
    if len(vigentes) != 1:
        return {"ok": False, "error": f"Se esperaba una sola factura vigente y hay {len(vigentes)}: resuelve eso primero."}
    b64 = descargar_factura_pdf_alegra(vigentes[0]["factura_id"])
    if not b64:
        return {"ok": False, "error": "No se pudo descargar el PDF de Alegra."}
    r = subir_factura_meli(str(venta.get("pack_id")), b64, formato="pdf", prefijo_archivo="Fac")
    if r != "✅":
        return {"ok": False, "error": f"MeLi rechazó el PDF: {r}"}
    return {"ok": True, "factura": vigentes[0].get("numero")}
