#!/usr/bin/env python3
"""
Cron: copia de las alertas de abono de Bancolombia a la asesora comercial.

Corre cada 5 minutos desde crontab (scripts/instalar_cron_mcKenna.sh). Ver
app/tools/reenvio_alertas_banco.py para qué se reenvía y qué no (OTP y claves nunca).

  python3 scripts/reenvio_alertas_banco_cron.py             # reenvía lo nuevo
  python3 scripts/reenvio_alertas_banco_cron.py --simular   # lista qué enviaría
  REENVIO_BANCO_ACTIVO=0                                     # apaga sin tocar el crontab
  REENVIO_BANCO_DESTINO=otro@correo.com                      # cambia la destinataria
  REENVIO_BANCO_INCLUIR_SALIDAS=1                            # incluye pagos salientes
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--simular", action="store_true", help="no envía ni etiqueta; solo lista")
    a = ap.parse_args()

    from app.tools import reenvio_alertas_banco as rab

    try:
        r = rab.reenviar_pendientes(simular=a.simular)
    except Exception as exc:  # token vencido, red, etc.: una línea en el log, sin traceback cada 5 min
        print(f"reenvio_alertas_banco: ERROR {type(exc).__name__}: {exc}")
        return 1
    if a.simular or r.get("enviados"):
        print(f"reenvio_alertas_banco: enviados={r['enviados']} omitidos={r['omitidos']} "
              f"destino={r['destino']} activo={r['activo']}")
        for d in r["detalle"]:
            print(f"  [{d['accion']}] {d['tipo']}: {d['resumen']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
