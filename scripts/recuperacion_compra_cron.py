#!/usr/bin/env python3
"""
Cron: correos de recuperación de compra (pedidos web que no se pagaron).

Corre cada hora desde crontab (scripts/instalar_cron_mcKenna.sh); la frecuencia
real la decide Sistemas → Tareas Programadas (job `recuperacion_compra`,
app/data/cron_frecuencias.json). Idempotente: cada envío queda registrado en
`recuperacion_envios` y un pedido nunca recibe la misma etapa dos veces.

  python3 scripts/recuperacion_compra_cron.py            # envía lo que toque
  python3 scripts/recuperacion_compra_cron.py --simular  # muestra qué enviaría, sin correos
  RECUPERACION_COMPRA_ACTIVO=0                            # apaga el envío sin tocar el crontab
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO / ".env")

JOB_ID = "recuperacion_compra"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--simular", action="store_true", help="no envía ni registra; solo lista candidatos")
    ap.add_argument("--forzar", action="store_true", help="ignora la frecuencia de Tareas Programadas")
    a = ap.parse_args()

    from app.services import cron_scheduler
    from app.tools import recuperacion_compra as rc

    if not a.simular and not a.forzar and not cron_scheduler.debe_ejecutar(JOB_ID):
        return 0
    r = rc.enviar_pendientes(simular=a.simular)
    if not a.simular and r.get("candidatos", 0):
        cron_scheduler.registrar_ejecucion(JOB_ID)
    elif not a.simular:
        cron_scheduler.registrar_ejecucion(JOB_ID)
    if a.simular or r.get("enviados"):
        print(f"recuperacion_compra: candidatos={r.get('candidatos', 0)} enviados={r.get('enviados', 0)} activo={r.get('activo')}")
        for d in r.get("detalle", []):
            print(f"  {'OK ' if d['ok'] else 'ERR'} {d['etapa']:12s} {d['reference']} → {d['email']} · {d['asunto']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
