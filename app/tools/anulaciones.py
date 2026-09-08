"""
Superficie de Resolución de Anulaciones para agentes y para el Centro de Mando.

Tres accesos para agentes IA, de más curado a más crudo (el cuarto,
`query_sqlite`, ya existe en `app/core.py` como escape hatch):

  consultar_expediente_anulacion(...)  — el caso entero en una llamada
  buscar_anulaciones_similares(...)    — precedentes: cómo se resolvieron casos parecidos
  registrar_nota_expediente(...)       — devuelve la conclusión al expediente

El punto de `buscar_anulaciones_similares` es la recursividad: un agente que
enfrenta un caso nuevo ve cómo terminaron los parecidos antes de decidir, y con
`registrar_nota_expediente` su propia conclusión queda disponible para el
siguiente. El historial deja de ser auditoría y pasa a ser corpus de
precedentes — el mismo patrón de `docs/agentic/MEMORY.md` y
`app/data/debugging_resuelto.jsonl`, aplicado a contabilidad.

Un solo identificador (`RA-2026-0142`) aparece en el título del ticket, en las
observaciones de la nota crédito, en la referencia del asiento contable y en el
log: un agente que lo vea en cualquier superficie recupera todo lo demás.
"""

from __future__ import annotations

import os
import re
import sqlite3
from typing import Any

from app.services import anulaciones_db as adb

MARCADOR_TICKET = "Anulación / Nota crédito"


# ── Herramientas expuestas al agente (registradas en app/core.py) ─────────────


def consultar_expediente_anulacion(identificador: str) -> str:
    """Consulta el expediente completo de una anulación / nota crédito: por qué
    se anuló la venta, qué factura se afectó, qué nota crédito se emitió, qué
    pasó con el inventario y toda la línea de tiempo del caso. Acepta el código
    del expediente (RA-2026-0142), el pack/order de MercadoLibre, el número de
    factura o el de la nota crédito. Úsala SIEMPRE antes de responder sobre una
    devolución, cancelación, reclamo o nota crédito de una venta concreta."""
    caso = adb.resolver(identificador)
    if not caso:
        return (
            f"No hay expediente de anulación para «{identificador}». "
            "Puede que la venta no tenga ninguna anulación registrada, o que el "
            "identificador sea de otro sistema."
        )
    completo = adb.expediente_completo(caso["id"])
    return _formatear_expediente(completo)


def buscar_anulaciones_similares(descripcion: str) -> str:
    """Busca casos anteriores de anulación / nota crédito parecidos al que se
    describe, para ver cómo se resolvieron y en qué terminaron. Úsala antes de
    decidir qué hacer con una devolución o reclamo nuevo: los precedentes dicen
    qué funcionó y qué se bloqueó. Ejemplos: "devoluciones de colágeno",
    "reembolso a cargo de Mercado Libre", "facturas de Siigo bloqueadas"."""
    casos = adb.buscar(descripcion, limite=8)
    if not casos:
        return f"Sin precedentes registrados para «{descripcion}»."
    lineas = [f"{len(casos)} caso(s) parecido(s):", ""]
    for c in casos:
        lineas.append(
            f"• {c['codigo']} — {c.get('motivo')} · {c.get('estado')} · "
            f"venta {c.get('pack_id') or c.get('order_id') or '?'} · "
            f"factura {c.get('factura_numero') or '?'} "
            f"(${float(c.get('factura_total') or 0):,.0f})"
        )
        if c.get("nc_numero"):
            lineas.append(f"    → nota crédito {c['nc_numero']}")
        if c.get("bloqueo_motivo"):
            lineas.append(f"    → bloqueado por: {c['bloqueo_motivo']}")
    lineas.append("")
    lineas.append("Para el detalle de cualquiera: consultar_expediente_anulacion(<código>).")
    return "\n".join(lineas)


def registrar_nota_expediente(identificador: str, nota: str) -> str:
    """Deja una nota o conclusión en el expediente de una anulación / nota
    crédito (por ejemplo, tras resolver el ticket asociado). La nota queda en la
    línea de tiempo del caso y el próximo agente que lo consulte la verá — es
    así como el aprendizaje de un caso queda disponible para el siguiente."""
    caso = adb.resolver(identificador)
    if not caso:
        return f"No hay expediente de anulación para «{identificador}»."
    actor = os.getenv("RA_ACTOR_AGENTE") or "agente:asistente"
    adb.agregar_nota(caso["id"], nota, actor=actor)
    return f"Nota registrada en el expediente {caso['codigo']}."


def resumen_anulaciones_pendientes() -> str:
    """Resumen de las anulaciones abiertas: cuántas ventas anuladas siguen sin
    su nota crédito, por cuánto dinero, y desde hace cuántos días la más
    antigua. Úsala cuando pregunten por el estado de las notas crédito
    pendientes o por la deuda contable de devoluciones."""
    deuda = adb.deuda_abierta()
    if not deuda["abiertas"]:
        return "No hay anulaciones pendientes: todas las ventas anuladas tienen su nota crédito."
    lineas = [
        f"{deuda['abiertas']} anulación(es) abierta(s) por ${deuda['monto']:,.0f}.",
    ]
    if deuda.get("dias_mas_antigua") is not None:
        lineas.append(f"La más antigua lleva {deuda['dias_mas_antigua']} día(s) abierta.")
    for estado, d in sorted(deuda["por_estado"].items(), key=lambda kv: -kv[1]["n"]):
        lineas.append(f"  · {estado}: {d['n']} (${d['monto']:,.0f})")
    return "\n".join(lineas)


# ── Formato ───────────────────────────────────────────────────────────────────


def _formatear_expediente(e: dict) -> str:
    if not e:
        return "Expediente vacío."
    L = [
        f"EXPEDIENTE {e['codigo']} — {e['estado'].upper()}",
        f"Origen: {e.get('origen')} · Motivo: {e.get('motivo')} · Alcance: {e.get('alcance') or '—'}",
    ]
    venta = e.get("pack_id") or e.get("order_id")
    if venta:
        L.append(f"Venta: {venta}" + (f" · Reclamo: {e['claim_id']}" if e.get("claim_id") else ""))
    if e.get("factura_numero"):
        L.append(
            f"Factura: {e['factura_numero']} ({e.get('factura_proveedor') or '?'}) "
            f"del {str(e.get('factura_fecha') or '')[:10]} por ${float(e.get('factura_total') or 0):,.0f}"
            + (f" · CUFE {e['factura_cufe']}" if e.get("factura_cufe") else "")
        )
    if e.get("monto_reintegrado"):
        L.append(
            f"Reintegro al comprador: ${float(e['monto_reintegrado']):,.0f} "
            f"a cargo de {'Mercado Libre' if e.get('financia') == 'meli' else 'el vendedor'}"
        )
    if e.get("nc_numero"):
        L.append(f"Nota crédito: {e['nc_numero']} ({e.get('nc_proveedor')}) — {e.get('nc_url') or ''}")
    else:
        L.append("Nota crédito: aún no emitida")
    if e.get("bloqueo_motivo"):
        L.append(f"Bloqueado por: {e['bloqueo_motivo']}")
    L.append(f"Inventario: {e.get('inventario_estado')}")
    if e.get("movimiento_id"):
        L.append(f"Asiento contable: {e['movimiento_id']}")
    if e.get("ticket_id"):
        L.append(f"Ticket en Centro de Mando: #{e['ticket_id']}")

    L.append("")
    L.append("LÍNEA DE TIEMPO")
    for ev in e.get("eventos", []):
        L.append(f"  {str(ev.get('ts'))[:16]} · {ev.get('actor')} · {ev.get('tipo')}: {ev.get('resumen')}")

    enlaces = e.get("enlaces") or {}
    if enlaces:
        L.append("")
        L.append("ENLACES")
        for k, v in enlaces.items():
            L.append(f"  {k}: {v}")
    return "\n".join(L)


# ── Ticket en el Centro de Mando ──────────────────────────────────────────────


def _db_path() -> str:
    from app.services import tickets_db as _tdb

    _tdb.init_db()
    return _tdb.DB_PATH


def _creador_id(db_path: str) -> int | None:
    db = None
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        for q in (
            "SELECT id FROM usuarios WHERE username='admin'",
            "SELECT id FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1",
        ):
            row = db.execute(q).fetchone()
            if row:
                return int(row["id"])
    except Exception:
        return None
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass
    return None


def _ticket_existente(db_path: str, codigo: str) -> int | None:
    db = None
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT id FROM tickets WHERE titulo LIKE ? OR descripcion LIKE ? ORDER BY id DESC LIMIT 1",
            (f"%{codigo}%", f"%{codigo}%"),
        ).fetchone()
        return int(row["id"]) if row else None
    except Exception:
        return None
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


def crear_ticket_para_expediente(caso_id: int, *, motivos: list[str] | None = None) -> tuple[bool, str]:
    """Crea el ticket SOLO cuando el caso necesita una decisión humana.

    Deliberadamente NO se crea al abrir el expediente. El flujo viejo
    (`meli_reclamos.crear_accion_anular_factura_por_reclamo`) pedía "anular la
    factura" apenas se ABRÍA el reclamo, no cuando se resolvía: si alguien lo
    trabajaba obedientemente, anulaba facturas de ventas todavía vivas. Aquí el
    ticket aparece cuando ya hay un reintegro confirmado y la política de
    autonomía dice que el caso no se emite solo.
    """
    caso = adb.obtener(caso_id)
    if not caso:
        return False, "Expediente inexistente."
    codigo = caso["codigo"]
    db_path = _db_path()

    ya = _ticket_existente(db_path, codigo)
    if ya:
        adb.actualizar(caso_id, ticket_id=ya)
        return True, f"Ya existe el ticket #{ya} para {codigo}."

    creador = _creador_id(db_path)
    if not creador:
        return False, "No hay usuario admin/activo en el Centro de Mando."

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

    completo = adb.expediente_completo(caso_id)
    descripcion = (
        f"**Expediente {codigo}** — requiere decisión antes de emitir la nota crédito.\n\n"
        + ("**Por qué no se emitió sola:**\n" + "\n".join(f"- {m}" for m in (motivos or [])) + "\n\n"
           if motivos else "")
        + "```\n" + _formatear_expediente(completo) + "\n```\n\n"
        "Un agente puede recuperar todo el contexto con "
        f"`consultar_expediente_anulacion(\"{codigo}\")`, ver precedentes con "
        "`buscar_anulaciones_similares(...)` y dejar la conclusión con "
        f"`registrar_nota_expediente(\"{codigo}\", ...)` — la nota queda en el "
        "expediente para quien lo abra después."
    )

    from app.services import tickets_db as _tdb

    ticket, err = _tdb.crear_ticket(
        {
            "tipo": "accion",
            "titulo": f"{MARCADOR_TICKET} — {codigo}",
            "categoria": "contabilidad",
            "descripcion": descripcion,
            "prioridad": "alta",
            "asignado_a": asignado_a,
        },
        creador,
        None,
    )
    if err:
        return False, f"No se pudo crear el ticket: {err}"
    tid = int(ticket.get("id"))
    adb.actualizar(caso_id, ticket_id=tid)
    adb.registrar_evento(
        caso_id, tipo="decidido", actor="sistema",
        resumen=f"Ticket #{tid} creado para decision humana.",
    )
    return True, f"🎫 Ticket #{tid} creado para el expediente {codigo}."


# ── Entrada desde el webhook de reclamos ──────────────────────────────────────


def _digits(s: Any) -> str:
    return re.sub(r"\D", "", str(s or ""))


def procesar_evento_reclamo(resource: str, *, topic: str | None = None) -> dict:
    """Entrada desde /notifications cuando llega un tópico de reclamo/devolución.

    Abre (o actualiza) el expediente y registra el evento. NO emite ni crea
    ticket todavía: un reclamo recién abierto no es un hecho contable — lo es el
    reintegro. El barrido (`scripts/anulaciones_cron.py`) es el que confirma el
    reintegro y decide.
    """
    from app.observability import log_json
    from app.utils import refrescar_token_meli

    claim_id = ""
    segs = [s for s in (resource or "").strip("/").split("/") if s]
    for i, s in enumerate(segs):
        if s in ("claims", "mediations", "returns") and i + 1 < len(segs):
            claim_id = _digits(segs[i + 1])
            break
    if not claim_id and segs:
        claim_id = _digits(segs[-1])

    token = refrescar_token_meli() or (os.environ.get("MELI_ACCESS_TOKEN") or "").strip()
    claim: dict[str, Any] = {}
    if token:
        try:
            import requests

            r = requests.get(
                f"https://api.mercadolibre.com/{(resource or '').strip('/')}",
                headers={"Authorization": f"Bearer {token}"}, timeout=15,
            )
            if r.status_code == 200 and isinstance(r.json(), dict):
                claim = r.json()
        except Exception:
            claim = {}

    order_id = str(claim.get("order_id") or claim.get("resource_id") or "")
    pack_id = str(claim.get("pack_id") or "")
    orden_emb = claim.get("order")
    if isinstance(orden_emb, dict):
        order_id = order_id or str(orden_emb.get("id") or "")
        pack_id = pack_id or str(orden_emb.get("pack_id") or "")

    referencia = adb.referencia_meli(pack_id or order_id) if (pack_id or order_id) else f"meli:claim:{claim_id}"
    caso = adb.abrir_expediente(
        referencia=referencia,
        origen="meli_reclamo",
        actor="webhook",
        claim_id=claim_id,
        pack_id=pack_id,
        order_id=order_id,
        resumen=f"Reclamo/devolucion MeLi {claim_id} ({topic or 'post_purchase'}).",
    )
    adb.registrar_evento(
        caso["id"], tipo="enriquecido", actor="webhook", dedupe=True,
        resumen=f"Notificacion {topic or ''} sobre {resource}.",
        datos={"claim": claim, "resource": resource},
    )
    try:
        log_json("ra_reclamo_registrado", codigo=caso["codigo"], claim_id=claim_id, topic=topic)
    except Exception:
        pass
    return caso
