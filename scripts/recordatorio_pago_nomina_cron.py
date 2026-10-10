#!/usr/bin/env python3
"""
Cron: monta los pagos de la quincena (prestación de servicios) como borradores
en Contabilidad → Solicitudes de pago, donde aparecen en «Por hacer» para que
Jenniffer (jerry) verifique el periodo y las novedades, ajuste el monto y los
envíe a aprobación.

**No abre ticket (desde el 9-oct-2026).** Antes creaba uno «urgente» que decía
«están en Borradores»; el panel ocultaba borradores del sistema y la cuota de un
préstamo venció sin que nadie la viera (TKT-2026-1652). Lo que se le pide a
alguien vive en el panel donde se hace; el aviso es un WhatsApp al grupo de
contabilidad.

Quién cobra y cuánto vive en las plantillas de pago recurrente («¿Este pago se
repite? → Quincenal» en el panel), no en este script. Si no hay ninguna, el
WhatsApp lo dice y no se monta nada.

Dispara únicamente los dos días de pago (mismo patrón de "cierre de quincena"
que ya usa scripts/informe_reposicion_mensual_cron.py para fin de mes):
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
                # «tickets_creados» queda como historia de cuando se avisaba con ticket
                data.setdefault("tickets_creados", {})
                data.setdefault("avisadas", {})
                return data
    except Exception:
        pass
    return {"tickets_creados": {}, "avisadas": {}}


def _guardar_estado(data: dict) -> None:
    ESTADO_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ESTADO_PATH)


def _montar_quincena(quincena: str, hoy: datetime) -> list[dict]:
    """Borradores de la quincena en Solicitudes de pago (idempotente por plantilla y periodo).

    McKenna NO tiene trabajadores formales: lo que se paga cada quincena es
    prestación de servicios (5135, retención de servicios 4%/6%), no nómina
    (5105, que afirmaría una relación laboral que no existe).
    """
    import sqlite3

    from app.services import pagos_wizard as _pw
    from app.services import tickets_db as tdb

    tdb.init_db()
    with sqlite3.connect(tdb.DB_PATH) as db:
        db.row_factory = sqlite3.Row
        admin_row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
    return _pw.instanciar_plantillas_de(
        "nomina", quincena, fecha=hoy.strftime("%Y-%m-%d"),
        created_by=admin_row["id"] if admin_row else None, frecuencia="quincenal",
    )


def _mensaje(quincena: str, borradores: list[dict]) -> str:
    if not borradores:
        return (
            f"⚠️ *Prestación de servicios — quincena {quincena}*\n\n"
            "Toca pagar la quincena, pero no hay pagos recurrentes configurados, así que no "
            "se montó nada.\n"
            "Créalos una sola vez en Contabilidad → Solicitudes de pago: uno por persona, "
            "categoría «Prestación de servicios», y en «¿Este pago se repite?» elige "
            "*Quincenal*. De ahí en adelante se montan solos cada quincena.\n"
            "No usar «Nómina»: McKenna no tiene trabajadores formales (5105)."
        )
    filas = "\n".join(
        f"• {b['concepto']}" + (f" — {b['tercero']['nombre']}" if b.get("tercero") else "")
        for b in borradores
    )
    return (
        f"💸 *Prestación de servicios — quincena {quincena}*\n\n"
        f"{len(borradores)} pago(s) en Contabilidad → Solicitudes de pago → «Por hacer»:\n"
        f"{filas}\n\n"
        "Verifica el periodo y las novedades, ajusta el monto si cambió y envíalo a aprobación."
    )


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

    borradores = _montar_quincena(quincena, hoy)
    print(f"✅ Quincena {quincena}: {len(borradores)} pago(s) en Solicitudes de pago.")

    # Los borradores no se duplican (origen_ref); el WhatsApp sí se repetiría si
    # el cron corre dos veces el mismo día, por eso se anota a qué quincena ya se avisó.
    estado = _leer_estado()
    if not estado["avisadas"].get(quincena):
        if not _quiet():
            from app.utils import enviar_whatsapp_reporte

            grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
            enviar_whatsapp_reporte(_mensaje(quincena, borradores), grupo)
        estado["avisadas"][quincena] = [b["id"] for b in borradores]
        _guardar_estado(estado)

    registrar_ejecucion(JOB_ID)
    return 0


if __name__ == "__main__":
    sys.exit(main())
