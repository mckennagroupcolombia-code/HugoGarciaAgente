#!/usr/bin/env python3
"""
Cron diario: revisa publicaciones MeLi en seguimiento compliance (watchlist).

Uso (crontab, desde la raíz del repo):
  30 8 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/meli_compliance_monitor_cron.py >>log_cron.txt 2>&1

Variables:
  AGENTE_COMPLIANCE_MONITOR_SKIP_WA=1 — no enviar WhatsApp aunque haya alertas
  AGENTE_COMPLIANCE_MONITOR_QUIET=1 — no imprimir línea si todo OK
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
    from app.tools.meli_compliance_monitor import revisar_watchlist_diaria

    reporte = revisar_watchlist_diaria(enviar_whatsapp=True)
    revisadas = reporte.get("revisadas", 0)
    problemas = reporte.get("problemas", 0)
    alertas = reporte.get("alertas", 0)

    if revisadas == 0:
        if os.getenv("AGENTE_COMPLIANCE_MONITOR_QUIET") != "1":
            print("[meli_compliance_monitor] watchlist vacía — nada que revisar")
        return 0

    if problemas == 0 and os.getenv("AGENTE_COMPLIANCE_MONITOR_QUIET") == "1":
        return 0

    print(
        f"[meli_compliance_monitor] revisadas={revisadas} activas={reporte.get('activas')} "
        f"problemas={problemas} alertas_wa={alertas}"
    )
    if reporte.get("whatsapp_error"):
        print(f"  whatsapp_error: {reporte['whatsapp_error']}")
    return 0 if problemas == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
