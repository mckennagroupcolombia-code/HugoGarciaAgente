"""
Ticket-checklist de revisión de facturación MeLi (Astro Killer) — reemplaza el
texto plano por WhatsApp ("revisar Astro Killer: posible doble", "22 posibles
factura doble") por un item accionable en el Centro de Mando: cada venta con
un problema (posible duplicado, factura sin subir a MeLi, sin facturar
vencida) es un paso de checklist con botón "revisado" (`completado`) + motivo
opcional de la discrepancia (`notas`) — mismo mecanismo que ya usa
`TicketPasoAPasoView` en el frontend, sin tocar el schema de `tickets_db`.

Mismo patrón que `app/tools/notas_credito.py::crear_ticket_nota_credito`
(dedupe textual, categoria "contabilidad", tipo "accion"), pero un solo
ticket por día (no uno por order_id) para no saturar el Centro de Mando: si
ya existe el ticket de hoy, se le agregan los `order_id` nuevos como pasos.

Una vez marcado "revisado" (paso completado, en cualquier ticket con este
marcador, no solo el de hoy) el `order_id` queda excluido para siempre de
nuevas alertas — es la decisión explícita del operador, la detección no debe
volver a mostrarlo aunque el problema técnico siga latente (ej. "revisé, no
es un duplicado real").
"""
from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime
from typing import Any

MARCADOR = "Revisión facturación MeLi"

# Modelo por defecto del repo para sugerencias cortas (ver
# app/services/llm_budget.py — tabla de precios). No es configurable por
# item: si algún día se necesita otro modelo, se cambia acá una sola vez.
_MODELO_SUGERENCIA = "claude-sonnet-5"

_PROMPT_SISTEMA = (
    "Eres un asistente de contabilidad/facturación de McKenna Group (Colombia). "
    "Se te da UN caso de una venta de MercadoLibre con un problema de facturación "
    "ya detectado por reglas (no debes re-detectar el problema, ya se sabe cuál es). "
    "Tu única tarea es sugerir, en máximo 3 líneas y en español, el siguiente paso "
    "concreto que debería tomar la persona que revisa el ticket. Nunca digas que ya "
    "resolviste nada — solo sugieres. No inventes números de factura ni montos que no "
    "te dieron."
)


def _db_path() -> str:
    from app.services import tickets_db as _tdb

    _tdb.init_db()
    return _tdb.DB_PATH


def _order_id_desde_descripcion(descripcion: str) -> str | None:
    m = re.match(r"Orden (\S+)", descripcion or "")
    return m.group(1) if m else None


def _pasos_ticket_revision(*, solo_completados: bool) -> dict[str, dict]:
    """order_id -> {"ticket_id", "paso_id", "notas"?, "completado_en"?} para
    pasos de tickets con el marcador `MARCADOR`, filtrando por completado."""
    out: dict[str, dict] = {}
    db = None
    try:
        db = sqlite3.connect(_db_path())
        db.row_factory = sqlite3.Row
        cond = "p.completado = 1" if solo_completados else "p.completado = 0"
        rows = db.execute(
            f"""
            SELECT p.id AS paso_id, p.ticket_id, p.descripcion, p.notas, p.completado_en
            FROM ticket_pasos p
            JOIN tickets t ON t.id = p.ticket_id
            WHERE t.titulo LIKE ? AND {cond}
            """,
            (f"{MARCADOR}%",),
        ).fetchall()
        for r in rows:
            oid = _order_id_desde_descripcion(r["descripcion"])
            if not oid or oid in out:
                continue
            out[oid] = {"ticket_id": r["ticket_id"], "paso_id": r["paso_id"]}
            if solo_completados:
                out[oid]["notas"] = r["notas"]
                out[oid]["completado_en"] = r["completado_en"]
    except Exception:
        pass
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
    return out


def revisado_map_facturacion() -> dict[str, dict]:
    """order_id -> {"ticket_id","paso_id","notas","completado_en"} ya marcados
    revisados. Consumida por `app/services/facturacion_ventas_unificado.py`."""
    return _pasos_ticket_revision(solo_completados=True)


def pasos_abiertos_facturacion() -> dict[str, dict]:
    """order_id -> {"ticket_id","paso_id"} de pasos aún NO marcados — para que
    el panel tenga a mano el ticket_id/paso_id del botón "Revisar" inline sin
    crear un paso duplicado."""
    return _pasos_ticket_revision(solo_completados=False)


def _get_creator_user_id(db_path: str) -> int | None:
    db = None
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
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
    return None


def cerrar_tickets_revision_completados() -> list[int]:
    """Marca como resuelto todo ticket con el marcador `MARCADOR` cuyos pasos
    estén TODOS completados. Antes quedaban abiertos para siempre (#1267 llevaba
    12/12 pasos hechos y seguía "en proceso" contando como solicitud pendiente
    de la operadora). Devuelve los ids cerrados."""
    db_path = _db_path()
    cerrados: list[int] = []
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    try:
        rows = db.execute(
            """
            SELECT t.id
            FROM tickets t
            WHERE t.titulo LIKE ?
              AND t.estado IN ('pendiente','en_proceso','esperando_aprobacion')
              AND EXISTS (SELECT 1 FROM ticket_pasos p WHERE p.ticket_id = t.id)
              AND NOT EXISTS (
                    SELECT 1 FROM ticket_pasos p
                    WHERE p.ticket_id = t.id AND p.completado_en IS NULL
              )
            """,
            (f"{MARCADOR}%",),
        ).fetchall()
        for r in rows:
            db.execute(
                "UPDATE tickets SET estado='resuelto', actualizado_en=datetime('now') WHERE id=?",
                (r["id"],),
            )
            cerrados.append(int(r["id"]))
        db.commit()
    finally:
        db.close()
    return cerrados


def crear_o_actualizar_ticket_revision_facturacion(items: list[dict]) -> tuple[bool, str]:
    """
    `items`: [{"order_id": str, "tipo": str, "motivo_sugerido": str}]
    `tipo` esperado: "posible_duplicado" | "facturada_pendiente_subir_meli" | "sin_facturar"

    Crea (o reusa) el ticket del día en el Centro de Mando, agregando un paso
    por cada `order_id` que no tenga ya un paso — completado o no — en algún
    ticket con el marcador `MARCADOR`. Devuelve (ok, mensaje) listo para
    reportar por WhatsApp.
    """
    from app.services import tickets_db as _tdb

    items = [dict(it) for it in (items or []) if (it or {}).get("order_id")]
    if not items:
        return True, "Nada que reportar."

    ya_conocidos = set(revisado_map_facturacion().keys()) | set(pasos_abiertos_facturacion().keys())
    nuevos = [it for it in items if str(it["order_id"]) not in ya_conocidos]
    if not nuevos:
        return True, "Todos los casos ya estaban reportados o revisados — no se duplica."

    hoy = datetime.now().strftime("%Y-%m-%d")
    titulo = f"{MARCADOR} — {hoy}"
    db_path = _db_path()
    creador_id = _get_creator_user_id(db_path)
    if not creador_id:
        return False, "No se pudo crear el ticket: no hay usuario admin/activo en el Centro de Mando."

    pasos = []
    for it in nuevos:
        motivo = (it.get("motivo_sugerido") or "").strip()
        desc = f"Orden {it['order_id']} — {it.get('tipo') or 'revisar'}"
        if motivo:
            desc += f": {motivo}"
        pasos.append({"descripcion": desc})

    # ¿Ya existe el ticket de hoy? Si sí, se le agregan los pasos nuevos en
    # vez de crear otro (evita saturar el Centro de Mando con un ticket por
    # cada corrida del chequeo).
    ticket_id = None
    db = None
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT id, estado FROM tickets WHERE titulo = ? LIMIT 1", (titulo,)).fetchone()
        if row:
            ticket_id = row["id"]
            if row["estado"] == "resuelto":
                _tdb.cambiar_estado(ticket_id, "en_proceso", creador_id, motivo="Nuevos hallazgos de facturación")
    except Exception:
        pass
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass

    if ticket_id:
        for p in pasos:
            _tdb.agregar_paso(ticket_id, p["descripcion"], creador_id)
        return (
            True,
            f"🎫 Ticket #{ticket_id} actualizado en el Centro de Mando con {len(pasos)} caso(s) nuevo(s): *{titulo}*.",
        )

    asignado_a = None
    try:
        from app.services.tickets_db import TAREA_RECLAMO_MELI_ANULAR_FACTURA, get_aliados_asignaciones

        # Reusa la misma asignación de "anular factura MeLi" como default
        # razonable — es el mismo perfil (contabilidad/facturación) que ya
        # resuelve este tipo de caso. Se puede separar en su propia clave de
        # tarea más adelante si hace falta un aliado distinto.
        asignado_a = (
            (get_aliados_asignaciones().get(TAREA_RECLAMO_MELI_ANULAR_FACTURA) or {}).get("usuario_id") or None
        )
    except Exception:
        asignado_a = None

    descripcion = (
        f"Revisión de {len(pasos)} venta(s) MeLi con posible problema de facturación "
        "(duplicado, factura sin subir a MeLi, o sin facturar vencida).\n\n"
        "Marca cada paso como revisado desde aquí o desde el botón \"Revisar\" del panel "
        "Facturación → Ventas, NC y Astro Killer. El motivo (opcional) queda como registro "
        "de por qué se presentó la discrepancia."
    )
    data = {
        "tipo": "accion",
        "titulo": titulo,
        "categoria": "contabilidad",
        "descripcion": descripcion,
        "prioridad": "alta",
        "asignado_a": asignado_a,
        "pasos": pasos,
    }
    ticket, err = _tdb.crear_ticket(data, creador_id, None)
    if err:
        return False, f"No se pudo crear el ticket: {err}"
    return True, f"🎫 Ticket #{ticket.get('id')} creado en el Centro de Mando: *{titulo}* ({len(pasos)} caso(s))."


def sugerir_resolucion(order_id: str, tipo: str, contexto: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sugerencia corta (IA) de qué hacer con UN caso de revisión de
    facturación — nunca ejecuta nada por sí sola (no anula factura, no emite
    nota crédito, no cambia estado de venta): el operador sigue decidiendo y
    marcando "revisado" a mano, igual que hoy. Se guarda como comentario del
    ticket del día (ver `scripts/revision_facturacion_cron.py`).

    Respeta el presupuesto de `app/services/llm_budget.py` — nunca lanza
    excepción, nunca gasta si `permitir_llamada` lo niega (límite diario o de
    lote ya alcanzado). Devuelve {"ok": bool, "sugerencia"?: str, "motivo"?: str}.
    """
    from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return {"ok": False, "motivo": "Sin ANTHROPIC_API_KEY configurada."}

    ok, motivo = permitir_llamada(_MODELO_SUGERENCIA, contexto="revision_facturacion")
    if not ok:
        return {"ok": False, "motivo": motivo}

    ctx = contexto or {}
    partes_contexto = [f"Orden MeLi: {order_id}", f"Tipo de problema (ya detectado): {tipo}"]
    if ctx.get("motivo_sugerido"):
        partes_contexto.append(f"Detalle de la regla: {ctx['motivo_sugerido']}")
    if ctx.get("cliente"):
        partes_contexto.append(f"Cliente: {ctx['cliente']}")
    if ctx.get("factura_numero"):
        partes_contexto.append(f"Factura relacionada: {ctx['factura_numero']}")
    if ctx.get("fecha_entrega"):
        partes_contexto.append(f"Fecha de entrega: {ctx['fecha_entrega']}")

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=_MODELO_SUGERENCIA,
            max_tokens=300,
            system=_PROMPT_SISTEMA,
            messages=[{"role": "user", "content": "\n".join(partes_contexto)}],
        )
        tin, tout = usage_anthropic(message)
        registrar_llamada(_MODELO_SUGERENCIA, tin, tout, contexto="revision_facturacion")

        texto = ""
        for block in message.content:
            if getattr(block, "type", "") == "text":
                texto += block.text
        texto = texto.strip()
        if not texto:
            return {"ok": False, "motivo": "El modelo no devolvió texto."}
        return {"ok": True, "sugerencia": texto}
    except Exception as e:
        return {"ok": False, "motivo": f"Error llamando al modelo: {e}"}
