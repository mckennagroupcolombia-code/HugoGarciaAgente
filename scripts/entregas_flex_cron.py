#!/usr/bin/env python3
"""
Cron diario: acumula las entregas Flex de MeLi (hora de salida y de entrega de
cada envío) para el panel Atención → Entregas Flex. Ver
app/services/entregas_flex.py.

Corre de noche (23:15), cuando ya cerró la ruta del día: la última entrega
suele caer entre las 20:00 y las 21:30. Revisa las órdenes de los últimos 10
días y solo consulta los envíos nuevos o todavía abiertos, así que son unas
decenas de llamadas a MeLi. Sin LLM.

La frecuencia real la gobierna app/services/cron_scheduler.py (Sistemas →
Tareas Programadas, job "entregas_flex") — el crontab solo dispara el chequeo.

Uso típico (crontab, desde la raíz del repo):
  15 23 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/entregas_flex_cron.py >>log_cron.txt 2>&1

Backfill manual (90 días, ~2.500 llamadas a MeLi, unos 3 minutos):
  ./venv/bin/python scripts/entregas_flex_cron.py --dias 90 --forzar

Variables:
  ENTREGAS_FLEX_CRON_ACTIVO=0  — desactiva el cron sin tocar el crontab
  ENTREGAS_FLEX_CORTE_HORA     — hora de corte del mismo día en decimal (default 12.33 = 12:20)
"""

from __future__ import annotations

import argparse
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

JOB_ID = "entregas_flex"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dias", type=int, default=10, help="Órdenes de los últimos N días (máx. 90)")
    parser.add_argument("--forzar", action="store_true", help="Ignora la frecuencia configurada")
    args = parser.parse_args()

    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if (os.getenv("ENTREGAS_FLEX_CRON_ACTIVO", "1") or "1").strip() == "0":
        print("⏸️  ENTREGAS_FLEX_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0
    if not args.forzar and not debe_ejecutar(JOB_ID):
        print("⏭  Entregas Flex: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    from app.services.entregas_flex import sincronizar

    r = sincronizar(dias=max(1, min(args.dias, 90)))
    marca = datetime.now().isoformat(timespec="seconds")
    if not r.get("ok"):
        # No se registra la ejecución: mañana vuelve a intentar.
        print(f"[{marca}] ❌ Entregas Flex: {r.get('error')}")
        return 1
    registrar_ejecucion(JOB_ID)
    print(
        f"[{marca}] 🛵 Entregas Flex: {r['ordenes']} órdenes, {r['envios']} envíos, "
        f"{r['consultados']} consultados, {r['flex_actualizados']} Flex actualizados, {r['errores']} con error."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
