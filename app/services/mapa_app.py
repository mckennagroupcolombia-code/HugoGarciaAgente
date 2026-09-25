# -*- coding: utf-8 -*-
"""Bloqueos por etapa — alimenta /app → Mapa de la aplicación.

La app tiene 61 paneles agrupados por departamento. El mapa los reordena por la
SECUENCIA del negocio (abastecer → preparar → publicar → vender → entregar →
facturar → contar) y sobre cada etapa muestra qué está detenido ahora mismo.

Esto NO calcula nada nuevo: junta señales que cada módulo ya produce (el checklist
de contabilidad, el resumen de solicitudes de pago, la matriz de productos, el
caché de inventario, la base de pedidos web). Si una fuente falla, esa señal se
omite y se anota en `sin_senal`: un mapa que se cae porque un módulo no responde
escondería justo lo que tiene que mostrar. Solo lectura, sin LLM, sin red.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable

REPO = Path(__file__).resolve().parents[2]
_TTL_S = 60
_lock = threading.Lock()
_memo: dict[str, Any] = {"t": 0.0, "data": None}


def _b(etapa: str, clave: str, n: int, texto: str, panel: str, severidad: str = "alta") -> dict:
    return {"etapa": etapa, "id": clave, "n": int(n), "texto": texto, "panel": panel, "severidad": severidad}


def _pagos() -> list[dict]:
    from app.services import pagos_wizard

    pe = pagos_wizard.resumen().get("por_estado") or {}
    n = lambda k: int((pe.get(k) or {}).get("n") or 0)  # noqa: E731
    out = []
    if n("pendiente"):
        out.append(_b("abastecer", "pagos_por_aprobar", n("pendiente"), "solicitudes de pago esperando aprobación", "pagos"))
    girar = n("aprobada") + n("en_banco")
    if girar:
        out.append(_b("abastecer", "pagos_por_girar", girar, "pagos ya contabilizados que el banco aún no gira", "pagos"))
    if n("borrador"):
        out.append(_b("abastecer", "pagos_borrador", n("borrador"), "borradores de pago sin enviar a aprobación", "pagos", "media"))
    return out


def _producto() -> list[dict]:
    from app.services import mapa_producto

    m = mapa_producto.matriz_productos()
    out = []
    if m["se_venden_incompletos"]:
        out.append(_b("preparar", "se_venden_incompletos", m["se_venden_incompletos"],
                      "productos que se venden sin etiqueta o sin documento listo", "combos"))
    if m["sin_combo"]:
        out.append(_b("preparar", "sin_combo", m["sin_combo"], "productos comprados sin ninguna presentación de venta", "combos"))
    listos = sum(1 for f in m["filas"] if f["ean"] == "ok" and f["etiqueta"] == "ok" and "falta" in (f["meli"], f["web"]))
    if listos:
        out.append(_b("publicar", "listos_sin_publicar", listos, "productos con código y etiqueta que no están en MeLi o en la web", "publicaciones", "media"))
    return out


def _canales() -> list[dict]:
    from app.services import canales_producto

    # resumen_bloqueos ya devuelve la misma forma que _b().
    return canales_producto.resumen_bloqueos()


def _inventario() -> list[dict]:
    d = json.loads((REPO / "app" / "data" / "inventario_control_resumen_cache.json").read_text(encoding="utf-8"))
    items = (d.get("data") or {}).get("items") or []
    agotados = sum(1 for x in items if x.get("estado") == "agotado")
    criticos = sum(1 for x in items if x.get("estado") == "critico")
    out = []
    if agotados:
        out.append(_b("preparar", "agotados", agotados, "publicaciones agotadas", "control-inventario"))
    if criticos:
        out.append(_b("preparar", "stock_critico", criticos, "publicaciones con stock crítico", "control-inventario", "media"))
    return out


def _preventa() -> list[dict]:
    d = json.loads((REPO / "app" / "data" / "preguntas_pendientes_preventa.json").read_text(encoding="utf-8"))
    n = sum(1 for p in d.get("preguntas") or [] if not p.get("respondida"))
    return [_b("vender", "preventa_sin_responder", n, "preguntas de MercadoLibre sin responder", "preventa")] if n else []


def _pedidos_web() -> list[dict]:
    ruta = REPO / "PAGINA_WEB" / "site" / "data" / "orders.db"
    con = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True, timeout=3)
    try:
        sin_despachar = con.execute(
            "SELECT COUNT(*) FROM orders WHERE status='approved' AND shipping_status='preparing'"
            " AND created_at >= date('now','-30 day')").fetchone()[0]
        factura_error = con.execute(
            "SELECT COUNT(*) FROM orders WHERE status='approved' AND siigo_invoice_status='error'"
            " AND created_at >= date('now','-30 day')").fetchone()[0]
    finally:
        con.close()
    out = []
    if sin_despachar:
        out.append(_b("entregar", "web_sin_despachar", sin_despachar, "pedidos web pagados que siguen sin despachar", "pedidos"))
    if factura_error:
        out.append(_b("facturar", "web_factura_error", factura_error, "pedidos web cuya factura terminó en error", "pedidos"))
    return out


# A qué etapa y a qué panel lleva cada renglón del checklist de contabilidad.
_CHECKLIST = {
    "facturacion_pendiente": ("facturar", "facturacion", "ventas de MeLi pendientes de facturar"),
    "extractos_pendientes": ("contar", "libro-mayor", "movimientos del banco sin clasificar"),
    "extracto_sin_cargar": ("contar", "libro-mayor", "extracto bancario del mes sin cargar"),
    "conciliacion_contador": ("contar", "conciliacion-contador", "hallazgos del cruce con el contador por decidir"),
    "prestamos_pendientes": ("contar", "prestamos", "préstamos con cuotas pendientes"),
    "socios_expedientes": ("contar", "socios", "pendientes en los expedientes fiscales de socios"),
}


def _contabilidad() -> list[dict]:
    from app.services import contabilidad_checklist

    out = []
    for it in contabilidad_checklist.resumen_checklist().get("items") or []:
        destino = _CHECKLIST.get(it.get("id"))
        n = int(it.get("cantidad") or 0)
        if destino and n and it.get("severidad") != "ok":
            etapa, panel, texto = destino
            out.append(_b(etapa, it["id"], n, texto, panel, "alta" if it.get("severidad") == "alta" else "media"))
    return out


_FUENTES: tuple[tuple[str, Callable[[], list[dict]]], ...] = (
    ("solicitudes de pago", _pagos), ("cadena del producto", _producto), ("inventario", _inventario),
    ("preventa MeLi", _preventa), ("pedidos web", _pedidos_web), ("contabilidad", _contabilidad),
    ("canales del producto", _canales),
)


_refrescando = threading.Event()


def _refrescar_en_segundo_plano() -> None:
    if _refrescando.is_set():
        return
    _refrescando.set()

    def _run():
        try:
            bloqueos(refrescar=True)
        finally:
            _refrescando.clear()

    threading.Thread(target=_run, name="mapa-app-bloqueos", daemon=True).start()


def precalentar() -> None:
    """La primera lectura cuesta ~9 s (248 YAML + catálogo + 42 MB de etiquetas): que la
    pague el arranque del servidor y no quien abre el mapa."""
    _refrescar_en_segundo_plano()


def bloqueos(refrescar: bool = False) -> dict:
    with _lock:
        viejo = _memo["data"]
        if not refrescar and viejo is not None:
            if time.time() - _memo["t"] >= _TTL_S:
                # Se sirve el último dato al instante y se renueva detrás: el mapa es una
                # pantalla de inicio, no puede esperar 9 s cada minuto.
                _refrescar_en_segundo_plano()
            return viejo
    items: list[dict] = []
    sin_senal: list[dict] = []
    for nombre, fuente in _FUENTES:
        try:
            items += fuente()
        except Exception as exc:  # una fuente caída no tumba el mapa: se dice cuál faltó
            sin_senal.append({"fuente": nombre, "error": str(exc)[:160]})
    por_etapa: dict[str, dict] = {}
    for b in items:
        e = por_etapa.setdefault(b["etapa"], {"alta": 0, "media": 0, "items": []})
        e[b["severidad"]] += b["n"]
        e["items"].append(b)
    for e in por_etapa.values():
        e["items"].sort(key=lambda x: (x["severidad"] != "alta", -x["n"]))
    data = {"por_etapa": por_etapa, "sin_senal": sin_senal, "generado": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with _lock:
        _memo.update(t=time.time(), data=data)
    return data
