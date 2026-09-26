#!/usr/bin/env python3
"""
Cron: propuesta diaria de precios indexados a la TRM oficial (BanRep).

Solo CALCULA la propuesta y avisa al grupo de facturación de ventas; los
precios cambian cuando un administrador aprueba en /app → Rentabilidad →
Precios TRM. Ver app/services/precios_trm.py.

  python3 scripts/precios_trm_cron.py            # propone y avisa si hay algo
  python3 scripts/precios_trm_cron.py --forzar   # ignora la frecuencia de Tareas Programadas
  PRECIOS_TRM_ACTIVO=0                            # apaga el cron sin tocar el crontab
  PRECIOS_TRM_QUIET=1                             # no envía WhatsApp (pruebas)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO / ".env")

JOB_ID = "precios_trm"


def _mensaje(r: dict) -> str:
    return "\n".join([
        "💱 *Precios según TRM — propuesta del día*",
        "",
        f"TRM BanRep: ${r['trm_actual']:,.2f} (vigente {r.get('trm_vigencia') or 'hoy'})",
        f"*{r['propuestas']}* producto(s) para ajustar: ⬆️ {r['suben']} suben · ⬇️ {r['bajan']} bajan",
        "",
        "Nada cambia hasta aprobarlo en /app → Rentabilidad → Precios TRM.",
    ])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--forzar", action="store_true")
    a = ap.parse_args()

    if (os.getenv("PRECIOS_TRM_ACTIVO", "1") or "1").strip() == "0":
        return 0

    from app.services import cron_scheduler
    from app.services import precios_trm

    if not a.forzar and not cron_scheduler.debe_ejecutar(JOB_ID):
        return 0

    quiet = (os.getenv("PRECIOS_TRM_QUIET", "0") or "0").strip() == "1"
    try:
        r = precios_trm.proponer()
    except RuntimeError as e:
        print(f"precios_trm: 🔴 {e}")
        cron_scheduler.registrar_ejecucion(JOB_ID)
        if not quiet:
            from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa
            enviar_whatsapp_reporte(f"💱 *Precios según TRM*\n\n🔴 {e}", jid_grupo_facturacion_ventas_wa())
        return 1

    cron_scheduler.registrar_ejecucion(JOB_ID)
    if not r.get("ok"):
        print(f"precios_trm: 🔴 {r.get('error')}")
        return 1
    print(
        f"precios_trm: TRM {r['trm_actual']:,.2f} · catálogo {r['catalogo']} · propuestas {r['propuestas']} "
        f"(suben {r['suben']}, bajan {r['bajan']}) · anclas nuevas {r['anclas_nuevas']} · reancladas {r['reancladas']}"
    )
    if r["propuestas"] and not quiet:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa
        enviar_whatsapp_reporte(_mensaje(r), jid_grupo_facturacion_ventas_wa())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
