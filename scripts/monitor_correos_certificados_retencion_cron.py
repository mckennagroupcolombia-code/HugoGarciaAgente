#!/usr/bin/env python3
"""
Cron diario: revisa mckenna.group.colombia@gmail.com en busca de correos de
proveedores solicitando certificados de retención y crea una solicitud
(ticket) para la persona encargada (Cynthia) en el panel de tickets.

Uso (crontab, desde la raíz del repo):
  0 8 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/monitor_correos_certificados_retencion_cron.py >>log_cron.txt 2>&1

Variables:
  MONITOR_CERTIFICADOS_RETENCION_ASIGNADO — nombre del usuario destino (default: Cynthia)
  AGENTE_MONITOR_CORREOS_CRON_QUIET=1 — no imprimir línea si no hay correos nuevos
  AGENTE_MONITOR_CORREOS_SKIP_WA=1 — no enviar WhatsApp al grupo de sistemas si falla (ej. token Gmail expirado)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar("certificados_retencion"):
        print("⏭  Certificados de retención: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0
    registrar_ejecucion("certificados_retencion")

    from app.tools.monitor_correos_proveedores import revisar_correos_certificados_retencion

    reporte = revisar_correos_certificados_retencion(crear_solicitudes=True)

    if not reporte.get("ok"):
        error = reporte.get("error")
        print(f"[monitor_correos_certificados_retencion] ERROR: {error}")
        if os.getenv("AGENTE_MONITOR_CORREOS_SKIP_WA") != "1":
            try:
                from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

                enviar_whatsapp_reporte(
                    "⚠️ Monitor de correos (certificados de retención) falló:\n"
                    f"{error}",
                    jid_grupo_alertas_sistemas_wa(),
                )
            except Exception as e:
                print(f"  no se pudo enviar alerta WhatsApp: {e}")
        return 1

    nuevos = reporte.get("nuevos", 0)
    if nuevos == 0:
        if os.getenv("AGENTE_MONITOR_CORREOS_CRON_QUIET") != "1":
            print(
                f"[monitor_correos_certificados_retencion] revisados={reporte.get('revisados')} "
                "sin solicitudes nuevas"
            )
        return 0

    print(
        f"[monitor_correos_certificados_retencion] revisados={reporte.get('revisados')} "
        f"nuevos={nuevos} tickets_creados={len(reporte.get('tickets_creados', []))}"
    )
    for t in reporte.get("tickets_creados", []):
        print(f"  {t['numero']}: {t['asunto']} ({t['remitente']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
