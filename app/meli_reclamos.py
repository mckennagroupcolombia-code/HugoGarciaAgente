"""
Reclamos / devoluciones MeLi → crear acción en Centro de mando (tickets).

Objetivo: cuando se abre un reclamo (y potencialmente una devolución) de una venta ya
facturada, generar automáticamente una "acción" para que un colaborador:
- anule la factura electrónica
- emita la nota crédito en SIIGO

Esta pieza NO ejecuta acciones en SIIGO; solo crea la solicitud/acción en el panel.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from typing import Any

import requests

from app.observability import log_json
from app.utils import refrescar_token_meli


def _digits(s: str) -> str:
    return re.sub(r"\D", "", str(s or ""))


def _conn_tickets(db_path: str):
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def _get_creator_user_id(db_path: str) -> int | None:
    """
    Las acciones/tickets requieren `creado_por`.
    Preferimos el usuario admin; si no existe, el primer usuario activo.
    """
    try:
        db = _conn_tickets(db_path)
        row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
        if row:
            return int(row["id"])
        row = db.execute("SELECT id FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1").fetchone()
        if row:
            return int(row["id"])
    except Exception:
        return None
    finally:
        try:
            db.close()
        except Exception:
            pass
    return None


def _ticket_ya_existe(db_path: str, claim_id: str) -> bool:
    cid = _digits(claim_id)
    if not cid:
        return False
    try:
        db = _conn_tickets(db_path)
        row = db.execute(
            """
            SELECT id FROM tickets
            WHERE tipo IN ('accion','solicitud')
              AND (titulo LIKE ? OR descripcion LIKE ?)
            ORDER BY id DESC
            LIMIT 1
            """,
            (f"%{cid}%", f"%{cid}%"),
        ).fetchone()
        return bool(row)
    except Exception:
        return False
    finally:
        try:
            db.close()
        except Exception:
            pass


def _fetch_meli_resource(token: str, resource: str) -> dict[str, Any] | None:
    r = (resource or "").strip().strip("/")
    if not r:
        return None
    url = f"https://api.mercadolibre.com/{r}"
    try:
        res = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
        if res.status_code != 200:
            return None
        payload = res.json()
        return payload if isinstance(payload, dict) else {"_raw": payload}
    except Exception:
        return None


def _siigo_buscar_factura_por_pack_id(pack_id: str) -> dict[str, Any] | None:
    """
    Busca una factura de venta en Siigo cuyo `observations` o `purchase_order`
    contenga el Pack/Order ID de MeLi. Devuelve metadatos útiles para el ticket.
    """
    pack_id = str(pack_id or "").strip()
    if not pack_id:
        return None
    try:
        from datetime import datetime, timedelta

        from app.services.siigo import (
            obtener_facturas_siigo_paginadas,
            siigo_factura_etiqueta_log,
            siigo_factura_estado_log,
        )

        fecha_inicio = (datetime.now() - timedelta(days=120)).strftime("%Y-%m-%d")
        facturas = obtener_facturas_siigo_paginadas(fecha_inicio)
        for fac in facturas:
            obs = f"{fac.get('observations', '')} {fac.get('purchase_order', '')}"
            if pack_id in obs:
                factura_id = str(fac.get("id") or "").strip()
                etiqueta = siigo_factura_etiqueta_log(fac)
                estado = siigo_factura_estado_log(fac)
                url = (
                    f"https://siigonube.siigo.com/#/invoice/843/{factura_id}"
                    if factura_id
                    else ""
                )
                return {
                    "siigo_factura_id": factura_id or None,
                    "siigo_factura_numero": fac.get("number") or etiqueta,
                    "siigo_factura_estado": estado,
                    "siigo_factura_url": url or None,
                }
    except Exception:
        return None
    return None


def _extract_ids(resource: str, payload: dict[str, Any] | None) -> dict[str, str]:
    """
    Best-effort: trata de extraer claim_id / pack_id / order_id desde resource o payload.
    No dependemos de un esquema exacto (MeLi cambia).
    """
    out = {"claim_id": "", "pack_id": "", "order_id": ""}
    r = (resource or "").strip().strip("/")
    segs = [s for s in r.split("/") if s]
    for i, s in enumerate(segs):
        if s in ("claims", "mediations", "returns") and i + 1 < len(segs):
            out["claim_id"] = str(segs[i + 1])
            break
    if not out["claim_id"] and segs:
        last = segs[-1]
        if _digits(last):
            out["claim_id"] = last

    if isinstance(payload, dict):
        # campos comunes (no garantizados)
        for k in ("claim_id", "id"):
            if not out["claim_id"] and payload.get(k):
                out["claim_id"] = str(payload.get(k))
        for k in ("pack_id", "order_id"):
            if payload.get(k):
                out[k] = str(payload.get(k))
        # formas alternativas
        rid = payload.get("resource_id") or payload.get("resource")
        if isinstance(rid, (str, int)) and not out["claim_id"] and _digits(str(rid)):
            out["claim_id"] = str(rid)
        order = payload.get("order")
        if isinstance(order, dict):
            if not out["order_id"] and order.get("id"):
                out["order_id"] = str(order.get("id"))
            if not out["pack_id"] and order.get("pack_id"):
                out["pack_id"] = str(order.get("pack_id"))
    return out


def crear_accion_anular_factura_por_reclamo(resource: str, *, topic: str | None = None) -> None:
    """
    Entrada principal: se invoca desde /notifications cuando llega topic claims/mediations/returns.
    Crea una acción en el Centro de mando (tickets) si no existe aún.
    """
    from app.services import tickets_db as _tdb

    _tdb.init_db()

    token = refrescar_token_meli() or (os.environ.get("MELI_ACCESS_TOKEN") or "").strip()
    if not token:
        log_json("meli_claim_action_skip", reason="no_token", resource=(resource or "")[:300])
        return

    payload = _fetch_meli_resource(token, resource)
    ids = _extract_ids(resource, payload)
    claim_id = ids.get("claim_id") or ""

    if claim_id and _ticket_ya_existe(_tdb.DB_PATH, claim_id):
        log_json("meli_claim_action_dedup", claim_id=claim_id, resource=(resource or "")[:300])
        return

    creador_id = _get_creator_user_id(_tdb.DB_PATH)
    if not creador_id:
        log_json("meli_claim_action_skip", reason="no_creator_user", resource=(resource or "")[:300])
        return

    suf = _digits(claim_id)[-4:] if _digits(claim_id) else ""
    titulo = "Anular factura / Nota crédito (MeLi reclamo)"
    if suf:
        titulo += f" #{suf}"

    # Links útiles para operación (no dependemos de que exista para todos los casos)
    claim_link = f"https://www.mercadolibre.com.co/claims/{_digits(claim_id)}" if _digits(claim_id) else ""

    detalles = {
        "topic": (topic or "").strip() or None,
        "resource": resource,
        "claim_id": claim_id or None,
        "order_id": ids.get("order_id") or None,
        "pack_id": ids.get("pack_id") or None,
        "claim_link": claim_link or None,
        "meli_payload_preview": payload,
        "instrucciones": [
            "Verificar si la venta ya tuvo factura electrónica emitida.",
            "Anular factura / emitir nota crédito en SIIGO según corresponda.",
            "Dejar el número de nota crédito / soporte en comentarios del ticket.",
        ],
    }

    # Enriquecer con número de factura Siigo (si el Pack ID está embebido en observations/purchase_order).
    siigo_info = _siigo_buscar_factura_por_pack_id(ids.get("pack_id") or ids.get("order_id") or "")
    if siigo_info:
        detalles.update(siigo_info)

    descripcion = (
        "Se detectó un reclamo/devolución en MercadoLibre para una venta posiblemente ya facturada.\n\n"
        "Acción requerida: **anular factura electrónica** y **emitir nota crédito en SIIGO**.\n\n"
        + (
            "Factura Siigo (detectada):\n"
            f"- Número: {detalles.get('siigo_factura_numero')}\n"
            f"- Estado: {detalles.get('siigo_factura_estado')}\n"
            + (f"- URL: {detalles.get('siigo_factura_url')}\n" if detalles.get("siigo_factura_url") else "")
            + "\n"
            if detalles.get("siigo_factura_numero")
            else ""
        )
        + (
        f"- Topic: {detalles.get('topic')}\n"
        f"- Resource: {resource}\n"
        f"- Claim ID: {claim_id}\n"
        f"- Pack/Order ID: {(ids.get('pack_id') or ids.get('order_id') or '').strip()}\n"
        )
        + (f"- Link: {claim_link}\n" if claim_link else "")
        + "\nDetalles (preview):\n"
        + json.dumps(detalles, ensure_ascii=False, indent=2)[:6000]
    )

    # Asignación automática al "aliado" configurado (si existe).
    asignado_a = None
    try:
        from app.services.tickets_db import (
            get_aliados_asignaciones,
            TAREA_RECLAMO_MELI_ANULAR_FACTURA,
        )

        asignado_a = (
            (get_aliados_asignaciones().get(TAREA_RECLAMO_MELI_ANULAR_FACTURA) or {}).get("usuario_id")
            or None
        )
    except Exception:
        asignado_a = None

    data = {
        "tipo": "accion",
        "titulo": titulo,
        "categoria": "contabilidad",
        "descripcion": descripcion,
        "prioridad": "alta",
        "asignado_a": asignado_a,
    }

    ticket, err = _tdb.crear_ticket(data, creador_id, None)
    if err:
        log_json("meli_claim_action_error", error=err, claim_id=claim_id, resource=(resource or "")[:300])
        return
    log_json("meli_claim_action_created", ticket_id=ticket.get("id"), claim_id=claim_id, resource=(resource or "")[:300])

