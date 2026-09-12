#!/usr/bin/env python3
"""
Auditor de canales de atención (WhatsApp + chat web). Ver app/services/auditor_canales.py.

Crontab (instalado por scripts/instalar_cron_mcKenna.sh):
  */30 * * * *  auditor_canales_cron.py            # revisiones sin IA
  0 19 * * *    auditor_canales_cron.py --diario   # revisión IA de una muestra (1 llamada)

Variables:
  AUDITOR_CANALES_ACTIVO=0  apaga el cron sin tocar el crontab
  AUDITOR_CANALES_SKIP_WA=1 imprime sin enviar WhatsApp (pruebas)
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
    if os.getenv("AUDITOR_CANALES_ACTIVO", "1").strip() == "0":
        return 0
    from app.services import auditor_canales as aud

    if "--diario" in sys.argv:
        print(aud.auditoria_diaria(enviar=True))
        return 0
    rep = aud.auditar(enviar=True)
    if rep["hallazgos"] or "--verbose" in sys.argv:
        print(f"[auditor_canales {rep['fecha']}] " + " | ".join(h["detalle"] for h in rep["hallazgos"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
