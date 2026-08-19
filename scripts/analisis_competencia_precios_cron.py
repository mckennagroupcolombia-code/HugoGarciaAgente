#!/usr/bin/env python3
"""
Cron: ranking de más vendidos MeLi (solo cuenta propia).

No consulta el marketplace ni ítems de otros vendedores (MeLi lo prohíbe;
no hacemos scraping). No envía WhatsApp de competencia.

Uso (crontab, desde la raíz del repo):
  0 9 * * 1 cd /ruta/mi-agente && ./venv/bin/python scripts/analisis_competencia_precios_cron.py >>log_cron.txt 2>&1
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

    if not debe_ejecutar("competencia_precios"):
        print("⏭  Competencia precios: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0
    registrar_ejecucion("competencia_precios")

    from app.tools.analisis_competencia_precios import ejecutar_analisis_competencia

    # Nunca WhatsApp de “competencia”: no consultamos precios ajenos (política MeLi).
    analisis = ejecutar_analisis_competencia(
        top_n=12,
        dias=30,
        usar_cache=False,
        enviar_whatsapp=False,
        pause_s=0,
    )
    if not analisis.get("ok"):
        print(f"[competencia_precios] error: {analisis.get('error')}")
        return 1

    r = analisis.get("resumen") or {}
    quiet = os.getenv("AGENTE_COMPETENCIA_PRECIOS_QUIET") == "1"
    if quiet:
        return 0
    print(
        f"[mas_vendidos_meli] productos={r.get('productos')} "
        f"metodo={analisis.get('metodo_busqueda')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
