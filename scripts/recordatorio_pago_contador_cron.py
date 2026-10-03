#!/usr/bin/env python3
"""
Cron: cuenta de cobro mensual de William Fernando Novoa Molano (contador externo).

Cada vez que corre (frecuencia real vía Sistemas → Tareas Programadas):
  1. Relee Gmail y atiende cada cuenta de cobro nueva de William
     (app/services/cuenta_cobro_contador.py):
       - ya pagada y con documento soporte emitido → le responde en el mismo
         correo con el documento soporte adjunto (XML firmado + PDF);
       - sin pagar → TKT a Jenniffer para que solicite el pago, con la cuenta
         de cobro adjunta y un borrador en Solicitudes de pago. Cuando el pago
         se confirma, una corrida siguiente le responde a William.
  2. William cobra el mes ANTERIOR (la de agosto llegó el 4-sep). Si a partir
     del día RECORDATORIO_PAGO_CONTADOR_DIA_AVISO (default 10) no ha llegado la
     del mes anterior, avisa por WhatsApp al grupo de contabilidad, una vez.

Historia: la primera versión (ago-2026) buscaba la cuenta de cobro del mes EN
CURSO; como William cobra el mes anterior, nunca la encontró y el ticket de
pago jamás se creó solo (`tickets_creados` seguía vacío el 23-sep-2026). La
comparación contra una tarifa fija ($573.243) se quitó: desde oct-2026 cobra
$1.210.483 y el valor lo coteja quien envía el borrador a aprobación.

Uso típico (crontab, desde la raíz del repo):
  0 9 * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/recordatorio_pago_contador_cron.py >>${LOG} 2>&1

Variables:
  RECORDATORIO_PAGO_CONTADOR_CRON_ACTIVO=0   — desactiva el cron sin tocar el crontab (default: activo)
  RECORDATORIO_PAGO_CONTADOR_QUIET=1         — no envía WhatsApp aunque haya actividad (pruebas)
  RECORDATORIO_PAGO_CONTADOR_DIA_AVISO       — día del mes desde el que se avisa si no ha llegado la cuenta de cobro del mes anterior (default 10)
  CONTADOR_COBRO_RESPUESTA_ACTIVO=0          — solo informa: no responde correos ni crea tickets (ver cuenta_cobro_contador.py)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

JOB_ID = "recordatorio_pago_contador"
ESTADO_PATH = REPO / "app" / "data" / "recordatorio_pago_contador_log.json"


def _activo() -> bool:
    return (os.getenv("RECORDATORIO_PAGO_CONTADOR_CRON_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("RECORDATORIO_PAGO_CONTADOR_QUIET", "0") or "0").strip() == "1"


def _dia_aviso() -> int:
    try:
        return int(os.getenv("RECORDATORIO_PAGO_CONTADOR_DIA_AVISO", "10") or "10")
    except ValueError:
        return 10


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


def _periodo_anterior(hoy: datetime) -> str:
    primero = hoy.replace(day=1)
    return (primero - timedelta(days=1)).strftime("%Y-%m")


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Recordatorio pago contador: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  RECORDATORIO_PAGO_CONTADOR_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.services import cuenta_cobro_contador as ccc
    from app.services.cuentas_cobro_correo import cargar_cobros
    from app.utils import enviar_whatsapp_reporte

    hoy = datetime.now()
    grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")

    # 1. Cada cuenta de cobro nueva: pagada → se le responde con el documento
    #    soporte; sin pagar → TKT a Jenniffer (ver cuenta_cobro_contador.py).
    try:
        acciones = ccc.procesar()
    except Exception as e:
        print(f"🔴 Falló la respuesta a la cuenta de cobro del contador: {e}")
        acciones = []
    for a in acciones:
        print(f"• {a}")
        if _quiet():
            continue
        if a.get("accion") == "soporte_enviado":
            enviar_whatsapp_reporte(
                f"✅ *Contador (William) — {a['periodo']}*\n\nSe le respondió por correo la cuenta de cobro "
                f"con el documento soporte {a['documento']} (pago confirmado, solicitud #{a['solicitud_id']}).",
                grupo,
            )
        elif a.get("accion") == "ticket_creado":
            enviar_whatsapp_reporte(
                f"🎫 *Cuenta de cobro de William (contador) — {a['periodo']}*\n\n"
                f"Llegó por ${float(a['monto'] or 0):,.0f} COP y aún no se le ha pagado. "
                f"Ticket #{a['ticket_id']} a Jenniffer para solicitar el pago"
                + (f" (borrador #{a['borrador_id']} en Solicitudes de pago)." if a.get("borrador_id") else "."),
                grupo,
            )

    # 2. William cobra el mes ANTERIOR (la de agosto llegó el 4-sep). Si pasado el
    #    día de aviso aún no ha llegado, se avisa una vez. Antes se buscaba la del
    #    mes en curso, que por eso nunca aparecía: el ticket jamás se creó solo.
    periodo = _periodo_anterior(hoy)
    llego = any(c.get("proveedor") == "william" and c.get("periodo") == periodo for c in cargar_cobros())
    estado = _leer_estado()
    if not llego and hoy.day >= _dia_aviso() and not estado["avisos_enviados"].get(periodo):
        print(f"ℹ️ Aún no llega la cuenta de cobro de William de {periodo} (día {hoy.day}).")
        if not _quiet():
            enviar_whatsapp_reporte(
                f"📌 *Recordatorio: pago contador (William)*\n\n"
                f"Aún no ha llegado la cuenta de cobro de William Novoa de {periodo}. "
                f"Verificar con él o revisar mckenna.group.colombia@gmail.com.",
                grupo,
            )
        estado["avisos_enviados"][periodo] = True
        _guardar_estado(estado)

    registrar_ejecucion(JOB_ID)
    return 0


if __name__ == "__main__":
    sys.exit(main())
