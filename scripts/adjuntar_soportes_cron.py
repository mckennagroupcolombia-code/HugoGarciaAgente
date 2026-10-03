#!/usr/bin/env python3
"""
Cron diario: baja de Alegra los PDF de facturas (FE…) y notas crédito (NC…) propias
que falten en facturas_descargadas/, y adjunta a cada asiento del Libro Mayor sin
soporte su factura (PDF, o XML si no hay PDF). Ver app/services/contabilidad_documentos.py.

Por qué: el contador abre el soporte desde la columna «Soporte» de los CSV del
Libro Mayor. El auto-posteo crea asientos cada 6 horas y ninguno nace con su
factura adjunta; sin esto, la columna vuelve a quedar vacía para todo lo nuevo.

Corre a las 00:40, después del auto-posteo de las 00:10 y antes del backup de
las 02:00. Solo enlaza archivos (hardlink), nunca pisa un soporte subido a mano
y no toca nada anterior a CONTABILIDAD_FECHA_CORTE. Sin LLM; en Alegra solo lee.

La frecuencia real la gobierna app/services/cron_scheduler.py (Sistemas →
Tareas Programadas, job "adjuntar_soportes") — el crontab solo dispara el chequeo.

Uso típico (crontab, desde la raíz del repo):
  40 0 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/adjuntar_soportes_cron.py >>log_cron.txt 2>&1

Manual:
  ./venv/bin/python scripts/adjuntar_soportes_cron.py --forzar          # adjunta ya
  ./venv/bin/python scripts/adjuntar_soportes_cron.py --forzar --simular  # solo informa

Variables:
  ADJUNTAR_SOPORTES_CRON_ACTIVO=0  — desactiva el cron sin tocar el crontab
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

JOB_ID = "adjuntar_soportes"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--forzar", action="store_true", help="Ignora la frecuencia configurada")
    parser.add_argument("--simular", action="store_true", help="Solo informa, no adjunta")
    args = parser.parse_args()

    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if (os.getenv("ADJUNTAR_SOPORTES_CRON_ACTIVO", "1") or "1").strip() == "0":
        print("⏸️  ADJUNTAR_SOPORTES_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0
    if not args.forzar and not debe_ejecutar(JOB_ID):
        print("⏭  Soportes del Libro Mayor: aún no toca según la frecuencia configurada.")
        return 0

    from app.services.contabilidad_documentos import adjuntar_soportes, descargar_soportes_faltantes

    # Primero se bajan de Alegra las facturas/notas propias que el libro nombra y no
    # están en disco (el flujo de facturación no siempre deja el PDF); luego se adjunta.
    try:
        d = descargar_soportes_faltantes(aplicar=not args.simular)
        print(f"   ⬇️  Alegra: {len(d['bajados'])} PDF {'por bajar' if args.simular else 'bajados'}, "
              f"{len(d['fallos'])} con error {[f['documento'] for f in d['fallos']][:10]}, "
              f"{len(d['no_alegra'])} fuera de Alegra {d['no_alegra'][:10]}")
    except Exception as e:  # noqa: BLE001 — sin Alegra igual se adjunta lo que ya hay
        print(f"   ⚠️  No se pudo consultar Alegra: {e}")
    r = adjuntar_soportes(aplicar=not args.simular)
    marca = datetime.now().isoformat(timespec="seconds")
    if not args.simular:
        registrar_ejecucion(JOB_ID)
    print(
        f"[{marca}] 📎 Soportes del Libro Mayor{' (simulación)' if args.simular else ''}: "
        f"{r['revisados']} asientos sin soporte revisados, {r['adjuntados']} adjuntados, "
        f"{r['sin_archivo']} con número pero sin archivo descargado, {r['sin_documento']} sin número de documento."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
