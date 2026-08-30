#!/usr/bin/env python3
"""
Cron: recordatorio + ticket de aprobación para el pago de nómina (quincenal),
asignado a Jenniffer (jerry). Antes esto se creaba a mano cada quincena desde
el panel ("APROBAR PAGO DE NOMINA" / "APROBAR PAGO NOMINA", solo 2 veces en
todo el historial: 15-jul-2026 y 31-jul-2026) — no había nada que lo generara
solo, así que dependía por completo de que alguien se acordara.

A diferencia del cron de pago al contador (scripts/recordatorio_pago_contador_cron.py),
acá NO hay una fuente externa (correo/factura) de la que sacar el monto exacto:
la tabla `empleados` de app/services/contabilidad_db.py está vacía en la
práctica (nadie la usa para calcular nómina real), así que este cron solo
puede recordar la fecha — quien lo reciba debe calcular/verificar el monto
antes de aprobar el giro.

Dispara únicamente los dos días de pago de nómina (mismo patrón de "cierre de
quincena" que ya usa scripts/informe_reposicion_mensual_cron.py para fin de
mes):
  - Día 15 de cada mes (primera quincena)
  - Último día calendario del mes (segunda quincena)

Uso típico (crontab, desde la raíz del repo):
  0 9 * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/recordatorio_pago_nomina_cron.py >>${LOG} 2>&1

Variables:
  RECORDATORIO_PAGO_NOMINA_CRON_ACTIVO=0   — desactiva el cron sin tocar el crontab (default: activo)
  RECORDATORIO_PAGO_NOMINA_QUIET=1         — no envía WhatsApp aunque haya actividad (pruebas)
"""
from __future__ import annotations

import calendar
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

JOB_ID = "recordatorio_pago_nomina"
ESTADO_PATH = REPO / "app" / "data" / "recordatorio_pago_nomina_log.json"


def _activo() -> bool:
    return (os.getenv("RECORDATORIO_PAGO_NOMINA_CRON_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("RECORDATORIO_PAGO_NOMINA_QUIET", "0") or "0").strip() == "1"


def _quincena_actual(hoy: datetime) -> str | None:
    """'AAAA-MM-Q1' el día 15, 'AAAA-MM-Q2' el último día del mes, None el resto de días."""
    ultimo_dia = calendar.monthrange(hoy.year, hoy.month)[1]
    if hoy.day == 15:
        return hoy.strftime("%Y-%m") + "-Q1"
    if hoy.day == ultimo_dia:
        return hoy.strftime("%Y-%m") + "-Q2"
    return None


def _leer_estado() -> dict:
    try:
        with open(ESTADO_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                data.setdefault("tickets_creados", {})
                return data
    except Exception:
        pass
    return {"tickets_creados": {}}


def _guardar_estado(data: dict) -> None:
    ESTADO_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ESTADO_PATH)


def _crear_ticket_nomina(quincena: str) -> int | None:
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

    descripcion = (
        f"Recordatorio automático: toca calcular y aprobar el pago de nómina de la "
        f"quincena {quincena}. Verificar horas/novedades del periodo antes de girar."
    )
    data = {
        "tipo": "solicitud",
        "titulo": "APROBAR PAGO NOMINA",
        "categoria": "logistica",
        "descripcion": descripcion,
        "prioridad": "urgente",
        "asignado_a": asignado_a,
    }
    ticket, error = tdb.crear_ticket(data, creado_por, None)
    if error:
        print(f"🔴 No se pudo crear el ticket de nómina: {error}")
        return None
    return ticket["id"]


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Recordatorio pago nómina: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  RECORDATORIO_PAGO_NOMINA_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    hoy = datetime.now()
    quincena = _quincena_actual(hoy)
    if not quincena:
        print(f"⏭  Hoy (día {hoy.day}) no es día de pago de nómina (15 o fin de mes).")
        registrar_ejecucion(JOB_ID)
        return 0

    estado = _leer_estado()
    if estado["tickets_creados"].get(quincena):
        print(f"✅ Ya existe ticket para {quincena} (ticket #{estado['tickets_creados'][quincena]}).")
        registrar_ejecucion(JOB_ID)
        return 0

    tid = _crear_ticket_nomina(quincena)
    if tid:
        estado["tickets_creados"][quincena] = tid
        _guardar_estado(estado)
        print(f"✅ Ticket #{tid} creado: APROBAR PAGO NOMINA ({quincena}).")
        if not _quiet():
            from app.utils import enviar_whatsapp_reporte

            grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
            mensaje = (
                f"🎫 *Pago de nómina — {quincena}*\n\n"
                f"Se creó el ticket de aprobación de pago de nómina para esta quincena.\n"
                f"Revisar en Centro de Mando → Solicitudes."
            )
            enviar_whatsapp_reporte(mensaje, grupo)

    registrar_ejecucion(JOB_ID)
    return 0


if __name__ == "__main__":
    sys.exit(main())
