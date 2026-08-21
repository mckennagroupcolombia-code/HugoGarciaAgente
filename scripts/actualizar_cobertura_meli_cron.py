#!/usr/bin/env python3
"""
Cron: acumula la cobertura geográfica REAL de MercadoLibre (departamento +
municipio de envíos ya despachados/entregados) para la sección "¿A dónde hemos
llegado?" del inicio de la tienda web (ver PAGINA_WEB/site/website.py::
_calcular_cobertura(), que combina esto con el histórico de pedidos web).

No existe un endpoint agregado barato en la API de MeLi para pedir "en qué
ciudades hemos vendido" — hay que resolver envío por envío vía
GET /shipments/{id}. Por eso esto corre como cron diario y acumula: cada
corrida solo consulta los shipping_id que todavía no se habían visto (ver
app/tools/cobertura_meli.py), así que el conteo por municipio solo crece hacia
adelante desde que este cron empezó a correr — no hay backfill retroactivo de
todo el historial (costaría miles de llamadas de una sola vez).

La frecuencia efectiva la gobierna app/services/cron_scheduler.py (panel
Sistemas → Tareas Programadas, job "cobertura_meli") — el crontab solo dispara
el chequeo.

Uso típico (crontab, desde la raíz del repo):
  50 6 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/actualizar_cobertura_meli_cron.py >>log_cron.txt 2>&1

Variables:
  COBERTURA_MELI_CRON_ACTIVO=0   — desactiva el cron sin tocar el crontab (default: activo)
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

JOB_ID = "cobertura_meli"


def _activo() -> bool:
    return (os.getenv("COBERTURA_MELI_CRON_ACTIVO", "1") or "1").strip() == "1"


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Cobertura MeLi: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  COBERTURA_MELI_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.tools.cobertura_meli import actualizar_cobertura_meli

    print("🗺️  Actualizando cobertura geográfica MeLi (departamento/municipio)…")
    resultado = actualizar_cobertura_meli()
    registrar_ejecucion(JOB_ID)

    print(
        f"   Órdenes revisadas: {resultado['ordenes_revisadas']} | "
        f"Envíos nuevos consultados: {resultado['envios_consultados']} | "
        f"Resueltos: {resultado['resueltos']} | "
        f"Sin resolver: {resultado['sin_resolver']} | "
        f"Aún no despachados: {resultado['aun_no_despachados']}"
    )
    print(f"   Total municipios acumulados: {resultado['total_municipios_acumulados']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
