#!/usr/bin/env python3
"""
Cron: recordatorio + ticket de aprobación para el pago mensual a William
Fernando Novoa Molano (contador externo), igual que ya existe para nómina
("APROBAR PAGO NOMINA"). Antes este pago solo se aprobaba si alguien se
acordaba de crear el ticket a mano — no había nada que corriera solo.

Cada vez que corre (frecuencia real vía Sistemas → Tareas Programadas):
  1. Relee Gmail (cuentas de cobro, ver app/services/cuentas_cobro_correo.py)
     y busca si ya llegó la cuenta de cobro de William para el mes en curso.
  2. Si llegó y no se ha creado ticket para ese periodo, crea
     "APROBAR PAGO CONTADOR" (tipo solicitud, mismo patrón que nómina) con
     el monto exacto y la cuenta bancaria, asignado para aprobación.
  3. Si aún no ha llegado su cuenta de cobro y ya estamos a partir del día
     RECORDATORIO_PAGO_CONTADOR_DIA_AVISO (default 25) del mes, manda un
     aviso de WhatsApp al grupo de contabilidad (una sola vez por mes).

Origen: corrección de ago-2026 — un encargado negoció el aumento mensual de
William al 15% cuando él había pedido 23% (confirmado con los PDFs: la
cuenta de cobro original de junio-2026 pedía $573.243 = 466.051×1.23; la
corregida y la de julio-2026 quedaron en $535.959 = 466.051×1.15). El ajuste
retroactivo de ese saldo se resolvió aparte, a mano, una sola vez — este
cron es solo para que el pago MENSUAL de aquí en adelante no vuelva a
depender de que alguien se acuerde de crear el ticket, como ya pasaba con
nómina. También avisa si el monto facturado no coincide con la tarifa
vigente acordada, para no repetir el mismo error de negociación.

Uso típico (crontab, desde la raíz del repo):
  0 9 * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/recordatorio_pago_contador_cron.py >>${LOG} 2>&1

Variables:
  RECORDATORIO_PAGO_CONTADOR_CRON_ACTIVO=0   — desactiva el cron sin tocar el crontab (default: activo)
  RECORDATORIO_PAGO_CONTADOR_QUIET=1         — no envía WhatsApp aunque haya actividad (pruebas)
  RECORDATORIO_PAGO_CONTADOR_DIA_AVISO       — día del mes desde el que se avisa si aún no ha llegado su cuenta de cobro (default 25)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

JOB_ID = "recordatorio_pago_contador"
ESTADO_PATH = REPO / "app" / "data" / "recordatorio_pago_contador_log.json"
TARIFA_VIGENTE = 573243.0  # 23% acordado realmente sobre $466.051 (corrección ago-2026)


def _activo() -> bool:
    return (os.getenv("RECORDATORIO_PAGO_CONTADOR_CRON_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("RECORDATORIO_PAGO_CONTADOR_QUIET", "0") or "0").strip() == "1"


def _dia_aviso() -> int:
    try:
        return int(os.getenv("RECORDATORIO_PAGO_CONTADOR_DIA_AVISO", "25") or "25")
    except ValueError:
        return 25


def _leer_estado() -> dict:
    try:
        with open(ESTADO_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                data.setdefault("tickets_creados", {})
                data.setdefault("avisos_enviados", {})
                return data
    except Exception:
        pass
    return {"tickets_creados": {}, "avisos_enviados": {}}


def _guardar_estado(data: dict) -> None:
    ESTADO_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ESTADO_PATH)


def _crear_ticket_pago(periodo: str, cobro: dict) -> int | None:
    from app.services import tickets_db as tdb
    import sqlite3

    tdb.init_db()
    with sqlite3.connect(tdb.DB_PATH) as db:
        db.row_factory = sqlite3.Row
        admin_row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
        jerry_row = db.execute("SELECT id FROM usuarios WHERE username='jerry'").fetchone()
    creado_por = admin_row["id"] if admin_row else None
    asignado_a = jerry_row["id"] if jerry_row else None
    if not creado_por:
        print("🔴 No existe usuario 'admin' — no se pudo crear el ticket.")
        return None

    monto = float(cobro.get("monto") or 0)
    aviso_tarifa = ""
    if monto and abs(monto - TARIFA_VIGENTE) > 500:
        aviso_tarifa = (
            f"\n\n⚠️ El monto facturado (${monto:,.0f}) no coincide con la tarifa "
            f"vigente acordada (${TARIFA_VIGENTE:,.0f} = 23% sobre $466.051, "
            f"corrección ago-2026) — revisar antes de aprobar."
        )
    descripcion = (
        f"Cuenta de cobro de William Fernando Novoa Molano (contador) — periodo {periodo}.\n"
        f"Valor a girar: ${monto:,.0f} COP\n"
        f"Concepto: {cobro.get('concepto', '')}\n"
        f"Cuenta: Bancolombia ahorros No 24178692751 a nombre William Novoa"
        f"{aviso_tarifa}"
    )
    data = {
        "tipo": "solicitud",
        "titulo": "APROBAR PAGO CONTADOR",
        "categoria": "logistica",
        "descripcion": descripcion,
        "prioridad": "urgente",
        "asignado_a": asignado_a,
    }
    ticket, error = tdb.crear_ticket(data, creado_por, None)
    if error:
        print(f"🔴 No se pudo crear el ticket de pago: {error}")
        return None
    return ticket["id"]


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Recordatorio pago contador: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  RECORDATORIO_PAGO_CONTADOR_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.services.cuentas_cobro_correo import sincronizar_desde_gmail, cargar_cobros
    from app.utils import enviar_whatsapp_reporte

    hoy = datetime.now()
    periodo_actual = hoy.strftime("%Y-%m")

    try:
        sincronizar_desde_gmail()
    except Exception as e:
        print(f"⚠️ No se pudo releer Gmail ({e}); se usa el último caché disponible.")

    cobros = cargar_cobros()
    william_mes = next(
        (c for c in cobros if c.get("proveedor") == "william" and c.get("periodo") == periodo_actual),
        None,
    )

    estado = _leer_estado()
    grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")

    if william_mes:
        if estado["tickets_creados"].get(periodo_actual):
            print(f"✅ Ya existe ticket para {periodo_actual} (ticket #{estado['tickets_creados'][periodo_actual]}).")
            registrar_ejecucion(JOB_ID)
            return 0
        tid = _crear_ticket_pago(periodo_actual, william_mes)
        if tid:
            estado["tickets_creados"][periodo_actual] = tid
            _guardar_estado(estado)
            print(f"✅ Ticket #{tid} creado: APROBAR PAGO CONTADOR ({periodo_actual}, ${william_mes['monto']:,.0f}).")
            if not _quiet():
                mensaje = (
                    f"🎫 *Cuenta de cobro de William (contador) — {periodo_actual}*\n\n"
                    f"Llegó su cuenta de cobro por ${william_mes['monto']:,.0f} COP. "
                    f"Se creó el ticket de aprobación de pago.\n"
                    f"Revisar en Centro de Mando → Solicitudes."
                )
                enviar_whatsapp_reporte(mensaje, grupo)
        registrar_ejecucion(JOB_ID)
        return 0

    # Aún no llega su cuenta de cobro este mes.
    if hoy.day >= _dia_aviso() and not estado["avisos_enviados"].get(periodo_actual):
        print(f"ℹ️ Aún no llega la cuenta de cobro de William para {periodo_actual} (día {hoy.day}).")
        if not _quiet():
            mensaje = (
                f"📌 *Recordatorio: pago contador (William)*\n\n"
                f"Aún no ha llegado la cuenta de cobro de William Novoa correspondiente a "
                f"{periodo_actual}. Verificar con él o revisar mckenna.group.colombia@gmail.com."
            )
            enviar_whatsapp_reporte(mensaje, grupo)
        estado["avisos_enviados"][periodo_actual] = True
        _guardar_estado(estado)
    else:
        print(f"⏭  Sin novedades para {periodo_actual}.")

    registrar_ejecucion(JOB_ID)
    return 0


if __name__ == "__main__":
    sys.exit(main())
