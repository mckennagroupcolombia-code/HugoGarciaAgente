"""
Ticket de "anular factura / nota crédito" en el Centro de Mando — genérico por canal.

Generaliza el patrón que ya funcionaba solo para reclamos de MeLi
(app/meli_reclamos.py::crear_accion_anular_factura_por_reclamo) para poder
usarlo también desde pedidos web (y a futuro WhatsApp) cuando un pedido con
factura ya emitida (Siigo histórico o Alegra desde el 2026-09-03) necesita
anularse / nota crédito.

Esta pieza NO ejecuta la anulación en Siigo/Alegra (el caller decide si pasa
`detalles_extra={"proveedor_factura": "Alegra"|"Siigo"}` para que el texto
del ticket diga el proveedor correcto — por defecto asume Alegra); solo crea
la solicitud/acción en el panel para que un colaborador la resuelva
manualmente.
"""

from __future__ import annotations

import re
import sqlite3
from typing import Any


def _digits(s: str) -> str:
    return re.sub(r"\D", "", str(s or ""))


def _ticket_ya_existe(db_path: str, referencia: str) -> bool:
    ref = (referencia or "").strip()
    if not ref:
        return False
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute(
            """
            SELECT id FROM tickets
            WHERE tipo IN ('accion','solicitud')
              AND (titulo LIKE ? OR descripcion LIKE ?)
            ORDER BY id DESC
            LIMIT 1
            """,
            (f"%{ref}%", f"%{ref}%"),
        ).fetchone()
        return bool(row)
    except Exception:
        return False
    finally:
        try:
            db.close()
        except Exception:
            pass


def _get_creator_user_id(db_path: str) -> int | None:
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
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


def crear_ticket_nota_credito(
    *,
    canal: str,
    referencia: str,
    motivo: str = "",
    siigo_factura_numero: str | None = None,
    siigo_factura_estado: str | None = None,
    siigo_factura_url: str | None = None,
    detalles_extra: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    """
    Crea (o evita duplicar) un ticket "Anular factura / Nota crédito" en el
    Centro de Mando. `canal` es solo para el título/descripción (ej. "Web",
    "WhatsApp", "MeLi"); `referencia` es el identificador de la venta en ese
    canal (ref de pedido web, últimos 3 dígitos WA, pack/order id MeLi...).

    Devuelve (ok, mensaje) — mensaje listo para reportar por WhatsApp.
    """
    from app.services import tickets_db as _tdb

    _tdb.init_db()

    ref = (referencia or "").strip()
    if not ref:
        return False, "Falta la referencia de la venta."

    if _ticket_ya_existe(_tdb.DB_PATH, ref):
        return True, f"Ya existe un ticket abierto para *{ref}* — no se duplica."

    creador_id = _get_creator_user_id(_tdb.DB_PATH)
    if not creador_id:
        return False, "No se pudo crear el ticket: no hay usuario admin/activo en el Centro de Mando."

    titulo = f"Anular factura / Nota crédito ({canal})"
    suf = _digits(ref)[-4:] if _digits(ref) else ref
    if suf:
        titulo += f" #{suf}"

    detalles = {
        "canal": canal,
        "referencia": ref,
        "motivo": (motivo or "").strip() or None,
        "siigo_factura_numero": siigo_factura_numero,
        "siigo_factura_estado": siigo_factura_estado,
        "siigo_factura_url": siigo_factura_url,
        **(detalles_extra or {}),
    }
    # Callers desde el 2026-09-03 pasan "proveedor_factura" (Siigo o Alegra,
    # ver web_pedidos.py::_proveedor_factura_web) — sin eso, asumir Siigo por
    # compatibilidad con callers viejos que no lo pasan.
    proveedor = detalles.get("proveedor_factura") or "Alegra"

    descripcion = (
        f"Solicitud de anulación/nota crédito — canal **{canal}**, referencia **{ref}**.\n\n"
        f"Acción requerida: **anular factura electrónica** y **emitir nota crédito en {proveedor.upper()}** "
        "si corresponde.\n\n"
        + (f"Motivo: {motivo.strip()}\n\n" if motivo and motivo.strip() else "")
        + (
            f"Factura {proveedor} (detectada):\n"
            f"- Número: {siigo_factura_numero}\n"
            f"- Estado: {siigo_factura_estado}\n"
            + (f"- URL: {siigo_factura_url}\n" if siigo_factura_url else "")
            + "\n"
            if siigo_factura_numero
            else f"Nota: no se detectó automáticamente el número de factura {proveedor} — revisar manualmente.\n\n"
        )
        + "Instrucciones:\n"
        "- Verificar si la venta ya tuvo factura electrónica emitida.\n"
        f"- Anular factura / emitir nota crédito en {proveedor.upper()} según corresponda.\n"
        "- Dejar el número de nota crédito / soporte en comentarios del ticket."
    )

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
        return False, f"No se pudo crear el ticket: {err}"

    return True, f"🎫 Ticket #{ticket.get('id')} creado en el Centro de Mando: *{titulo}*."
