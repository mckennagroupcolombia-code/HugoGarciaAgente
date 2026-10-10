#!/usr/bin/env python3
"""
Cron: recordatorios mensuales del módulo de préstamos. Hace DOS trabajos, cada
uno en su día del mes; corre a diario y el script decide si hay algo que hacer.

1) Pagos de préstamos (día PRESTAMOS_DIA_RECORDATORIO, default 5)
   ── las cuotas que vencen ese mes, de todos los préstamos vigentes, quedan
   como borrador en Contabilidad → Solicitudes de pago; cada una sale en «Por
   hacer» el día que vence (antes solo en «Borradores»), y de ahí se envía a
   aprobación y se gira. NO abre ticket (desde el 2026-10-09): el
   ticket remitía a una pestaña que ocultaba esos borradores y la cuota venció
   sin montarse. Un aviso al grupo de sistemas por WhatsApp, nada más.
2) Declaración de retención en la fuente del mes ANTERIOR (a diario desde el
   día PRESTAMOS_DIA_AVISO_RETENCIONES, default 3)
   ── un RECORDATORIO en la Agenda de quien coordina con el contador, con la
   cuenta regresiva en el título (se reescribe cada día). El día que vence
   (PRESTAMOS_RETENCIONES_DIAS_URGENTE días antes, default 0) pasa a solicitud
   urgente con el detalle para el formulario 350. Antes era un ticket desde el
   día 3 con «quedan 16 días» congelado (TKT-2026-1645).

Van juntos en un solo script para no sumar dos entradas de crontab por lo mismo.

Idempotente: cada cuota se monta una sola vez (`origen_ref` de la solicitud),
así que puede correr todos los días sin riesgo.

Uso típico (crontab, desde la raíz del repo):
  30 7 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/prestamos_recordatorio_cron.py >>log_cron.txt 2>&1

Variables:
  PRESTAMOS_RECORDATORIO_ACTIVO=0  — desactiva sin tocar el crontab (default: activo)
  PRESTAMOS_DIA_RECORDATORIO       — día del mes en que monta las cuotas (default 5)
  PRESTAMOS_DIA_AVISO_RETENCIONES  — desde qué día del mes avisa lo de retenciones (default 3)
  PRESTAMOS_RETENCIONES_DIAS_URGENTE — días antes del vencimiento en que pasa a solicitud (default 0 = ese día)
  PRESTAMOS_USUARIO_CONTABILIDAD   — username que coordina con el contador (si no, Sistemas → Aliados)
  PRESTAMOS_RECORDATORIO_SKIP_WA=1 — no envía WhatsApp (pruebas)
  --forzar                         — ignora el día del mes (corrida manual)
  --dry-run                        — muestra qué haría, sin montar nada ni WhatsApp
"""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")


def _activo() -> bool:
    return (os.getenv("PRESTAMOS_RECORDATORIO_ACTIVO", "1") or "1").strip() == "1"


def _skip_wa() -> bool:
    return (os.getenv("PRESTAMOS_RECORDATORIO_SKIP_WA", "0") or "0").strip() == "1"


def _dia_recordatorio() -> int:
    from app.services.prestamos import DIA_RECORDATORIO_DEFAULT

    try:
        dia = int(os.getenv("PRESTAMOS_DIA_RECORDATORIO", "") or DIA_RECORDATORIO_DEFAULT)
    except ValueError:
        return DIA_RECORDATORIO_DEFAULT
    return dia if 1 <= dia <= 28 else DIA_RECORDATORIO_DEFAULT


def _dia_retenciones() -> int:
    from app.services.prestamos import DIA_AVISO_RETENCIONES_DEFAULT

    try:
        dia = int(os.getenv("PRESTAMOS_DIA_AVISO_RETENCIONES", "") or DIA_AVISO_RETENCIONES_DEFAULT)
    except ValueError:
        return DIA_AVISO_RETENCIONES_DEFAULT
    return dia if 1 <= dia <= 28 else DIA_AVISO_RETENCIONES_DEFAULT


def _mes_anterior(hoy: date) -> tuple[int, int]:
    return (hoy.year - 1, 12) if hoy.month == 1 else (hoy.year, hoy.month - 1)


def _tarea_retenciones(hoy: date, forzar: bool, dry_run: bool) -> int:
    """Recordatorio de la declaración de retención del mes pasado, con cuenta
    regresiva; el día que vence pasa a solicitud urgente. Corre a diario desde
    el día PRESTAMOS_DIA_AVISO_RETENCIONES (los días anteriores no hay nada
    que avisar: el período anterior todavía se está cerrando)."""
    if hoy.day < _dia_retenciones() and not forzar:
        return 0

    from app.services.prestamos import recordatorio_retenciones_mes

    anio, mes = _mes_anterior(hoy)
    try:
        r = recordatorio_retenciones_mes(anio, mes, dry_run=dry_run)
    except Exception as e:
        print(f"❌ Aviso de retenciones falló: {e}", flush=True)
        _avisar_whatsapp(f"❌ El aviso de la declaración de retención falló: {e}")
        return 1

    if not r.get("ok"):
        print(f"❌ {r.get('error')}", flush=True)
        _avisar_whatsapp(f"❌ No se pudo avisar la declaración de retención: {r.get('error')}")
        return 1

    accion, periodo = r.get("accion"), r.get("periodo")
    if r.get("dry_run"):
        print(f"[dry-run retenciones {periodo}] {accion}: {r.get('titulo') or r.get('descripcion', '')}")
        return 0
    if accion == "creado":
        msg = (
            f"🗓️ Declaración de retención {periodo}: vence el {r.get('vence')}. Quedó como "
            "recordatorio en la Agenda con la cuenta regresiva; el día que vence pasa a solicitud urgente."
        )
    elif accion == "ticket" and r.get("ticket_id"):
        msg = f"🧾 Hoy vence la declaración de retención {periodo}: solicitud urgente #{r.get('ticket_id')}."
    else:
        print(f"Retenciones {periodo}: {accion} ({r.get('motivo') or r.get('titulo') or ''})", flush=True)
        return 0
    print(msg, flush=True)
    _avisar_whatsapp(msg)
    return 0


def _avisar_whatsapp(texto: str) -> None:
    if _skip_wa():
        return
    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

        enviar_whatsapp_reporte(texto, jid_grupo_alertas_sistemas_wa())
    except Exception as e:  # nunca tumbar el cron por un fallo de mensajería
        print(f"⚠️ No se pudo avisar por WhatsApp: {e}", flush=True)


def main() -> int:
    forzar = "--forzar" in sys.argv
    dry_run = "--dry-run" in sys.argv

    if not _activo() and not forzar:
        return 0

    hoy = date.today()

    # Las dos tareas son independientes: que una no aplique hoy (o falle) no
    # debe impedir la otra.
    rc = _tarea_retenciones(hoy, forzar, dry_run)

    if hoy.day != _dia_recordatorio() and not forzar:
        return rc

    from app.services.prestamos import crear_recordatorio_pagos_mes

    try:
        r = crear_recordatorio_pagos_mes(hoy.year, hoy.month, dry_run=dry_run)
    except Exception as e:
        print(f"❌ Recordatorio de préstamos falló: {e}", flush=True)
        _avisar_whatsapp(f"❌ El recordatorio mensual de pagos de préstamos falló: {e}")
        return 1 or rc

    if not r.get("ok"):
        print(f"❌ {r.get('error')}", flush=True)
        _avisar_whatsapp(f"❌ No se pudieron montar las cuotas de préstamos: {r.get('error')}")
        return 1

    if r.get("dry_run"):
        print(f"[dry-run] {r.get('cuotas')} cuota(s), total a girar ${r.get('total_girar', 0):,.0f}")
        print("\n".join(r.get("detalle") or []))
        return rc

    fallidas = r.get("fallidas") or 0
    if fallidas:
        _avisar_whatsapp(
            f"⚠️ {fallidas} cuota(s) de préstamos {r.get('periodo')} no se pudieron montar en "
            "Solicitudes de pago (ver log_cron.txt). Siguen pendientes en Contabilidad → Préstamos."
        )

    if not r.get("creado"):
        # "sin cuotas pendientes" y "ya estaban montadas" son el camino normal, no anomalías
        print(f"Sin novedad ({r.get('motivo')}) — período {r.get('periodo')}", flush=True)
        return 1 if fallidas else rc

    total = r.get("total_girar") or 0
    msg = (
        f"💸 Pagos de préstamos {r.get('periodo')}: {r.get('cuotas')} cuota(s) montadas en "
        "Contabilidad → Solicitudes de pago; cada una sale en «Por hacer» el día que vence. "
        f"Total del mes ${round(total):,}".replace(",", ".")
    )
    print(msg, flush=True)
    _avisar_whatsapp(msg)
    return 1 if fallidas else rc


if __name__ == "__main__":
    raise SystemExit(main())
