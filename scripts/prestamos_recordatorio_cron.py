#!/usr/bin/env python3
"""
Cron: recordatorios mensuales del módulo de préstamos. Hace DOS trabajos, cada
uno en su día del mes; corre a diario y el script decide si hay algo que hacer.

1) Pagos de préstamos (día PRESTAMOS_DIA_RECORDATORIO, default 5)
   ── UN ticket con todas las cuotas que vencen ese mes, de todos los préstamos
   vigentes, asignado a quien monta los pagos en Sucursal Negocios.
2) Declaración de retención en la fuente (día PRESTAMOS_DIA_AVISO_RETENCIONES,
   default 3, sobre el mes ANTERIOR)
   ── UN ticket con lo practicado y el detalle por tercero para el formulario
   350, para pasárselo al contador. NO codifica el calendario tributario: los
   vencimientos van por último dígito del NIT y cambian cada año por decreto,
   así que avisa temprano y el contador pone la fecha.

Van juntos en un solo script para no sumar dos entradas de crontab por lo mismo.

Un día fijo del mes (PRESTAMOS_DIA_RECORDATORIO, default 5) crea UN ticket en
el Centro de Mando, asignado a quien monta los pagos en Sucursal Negocios
(PRESTAMOS_USUARIO_PAGOS, default `jerry` = Jenniffer García), listando todas
las cuotas que vencen ese mes de todos los préstamos vigentes: prestamista,
cédula, cuenta bancaria, valor a girar y retención practicada.

Deliberadamente UN solo ticket al mes y no uno por préstamo ni uno por cuota:
despachos monta todas las transferencias en la misma sesión del banco, y N
tickets para N transferencias del mismo día es ruido, no control. Tampoco se
crea ticket si no hay cuotas pendientes — un ticket vacío cada mes entrena a
la gente a ignorar la bandeja.

Idempotente por período: si el ticket del mes ya existe (marca
`SYS_PRESTAMOS_PAGOS_MES: YYYY-MM` en la descripción) no crea otro, así que
puede correr todos los días sin riesgo.

Uso típico (crontab, desde la raíz del repo):
  30 7 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/prestamos_recordatorio_cron.py >>log_cron.txt 2>&1

Variables:
  PRESTAMOS_RECORDATORIO_ACTIVO=0  — desactiva sin tocar el crontab (default: activo)
  PRESTAMOS_DIA_RECORDATORIO       — día del mes en que avisa (default 5)
  PRESTAMOS_USUARIO_PAGOS          — username del panel que monta los pagos (default jerry)
  PRESTAMOS_DIA_AVISO_RETENCIONES  — día del mes en que avisa lo de retenciones (default 3)
  PRESTAMOS_USUARIO_CONTABILIDAD   — username que coordina con el contador (si no, Sistemas → Aliados)
  PRESTAMOS_RECORDATORIO_SKIP_WA=1 — no envía WhatsApp (pruebas)
  --forzar                         — ignora el día del mes (corrida manual)
  --dry-run                        — muestra qué haría, sin crear ticket ni WhatsApp
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
    """Ticket con la retención practicada el mes pasado, para declararla."""
    if hoy.day != _dia_retenciones() and not forzar:
        return 0

    from app.services.prestamos import crear_ticket_retenciones_mes

    anio, mes = _mes_anterior(hoy)
    try:
        r = crear_ticket_retenciones_mes(anio, mes, dry_run=dry_run)
    except Exception as e:
        print(f"❌ Aviso de retenciones falló: {e}", flush=True)
        _avisar_whatsapp(f"❌ El aviso mensual de retenciones de préstamos falló: {e}")
        return 1

    if not r.get("ok"):
        print(f"❌ {r.get('error')}", flush=True)
        _avisar_whatsapp(f"❌ No se pudo crear el ticket de retenciones: {r.get('error')}")
        return 1

    if not r.get("creado"):
        if r.get("dry_run"):
            res = r.get("resumen", {})
            print(f"[dry-run retenciones {r.get('periodo')}] total ${res.get('total_retencion', 0):,.0f}")
            print(r.get("descripcion", ""))
        else:
            print(f"Retenciones sin novedad ({r.get('motivo')}) — período {r.get('periodo')}", flush=True)
        return 0

    msg = (
        f"🧾 Ticket #{r.get('ticket_id')} — Declarar retención en la fuente {r.get('periodo')}\n"
        f"{r.get('terceros')} prestamista(s), total a declarar "
        f"${round(r.get('total_retencion') or 0):,}".replace(",", ".")
    )
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
        _avisar_whatsapp(f"❌ No se pudo crear el ticket de pagos de préstamos: {r.get('error')}")
        return 1

    if not r.get("creado"):
        if r.get("dry_run"):
            print(f"[dry-run] {r.get('cuotas')} cuota(s), total a girar ${r.get('total_girar', 0):,.0f}")
            print(r.get("descripcion", ""))
        else:
            # "sin cuotas pendientes" y "ya existe" son el camino normal, no anomalías
            print(f"Sin novedad ({r.get('motivo')}) — período {r.get('periodo')}", flush=True)
        return rc

    total = r.get("total_girar") or 0
    msg = (
        f"🎫 Ticket #{r.get('ticket_id')} — Pagos de préstamos {r.get('periodo')}\n"
        f"{r.get('cuotas')} cuota(s) por montar en Sucursal Negocios, "
        f"total a girar ${round(total):,}".replace(",", ".")
    )
    print(msg, flush=True)
    _avisar_whatsapp(msg)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
