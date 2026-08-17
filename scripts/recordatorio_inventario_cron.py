#!/usr/bin/env python3
"""
Cron: recordatorio semanal de revisión de inventario — le da al equipo un día
fijo para revisar stock agotado/crítico/bajo, en vez del esquema actual donde
la reposición es puramente reactiva (sin cadencia definida).

No reemplaza el reporte diario de stock (app.sync.ejecutar_sincronizacion_y_reporte_stock,
cron 8am) — ese informa niveles. Este manda UN mensaje semanal apuntando al
panel Control de Inventario (/app), donde el equipo puede actuar (agregar
unidades, solicitar compra, marcar revisado) en vez de solo leer un reporte.

La frecuencia efectiva la gobierna app/services/cron_scheduler.py (panel
Sistemas → Tareas Programadas, job "recordatorio_inventario", por defecto
168h = semanal) — el crontab solo dispara el chequeo.

Uso típico (crontab, desde la raíz del repo):
  30 8 * * 1 cd /ruta/mi-agente && ./venv/bin/python scripts/recordatorio_inventario_cron.py >>log_cron.txt 2>&1

Variables:
  RECORDATORIO_INVENTARIO_SKIP_WA=1   — no envía WhatsApp aunque haya novedades (pruebas)
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

JOB_ID = "recordatorio_inventario"


def _quiet() -> bool:
    return (os.getenv("RECORDATORIO_INVENTARIO_SKIP_WA", "0") or "0").strip() == "1"


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Recordatorio de inventario: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    from app.services.inventario_control import resumen_control_inventario
    from app.utils import enviar_whatsapp_reporte, jid_grupo_inventario_wa

    resumen = resumen_control_inventario()
    items = resumen.get("items", [])
    agotados = sum(1 for i in items if i["estado"] == "agotado")
    criticos = sum(1 for i in items if i["estado"] == "critico")
    bajos = sum(1 for i in items if i["estado"] == "bajo")
    divergentes = sum(1 for i in items if i.get("divergencia"))
    total_atencion = agotados + criticos + bajos

    registrar_ejecucion(JOB_ID)

    if total_atencion == 0:
        print("✅ Sin productos que requieran atención esta semana.")
        return 0

    mensaje = (
        "📋 *Revisión semanal de inventario*\n\n"
        f"🚫 Agotados: {agotados}\n"
        f"⚠️ Última unidad: {criticos}\n"
        f"🟡 Stock bajo: {bajos}\n"
    )
    if divergentes:
        mensaje += f"🔀 Con posible diferencia frente a bodega (Siigo): {divergentes}\n"
    mensaje += (
        f"\nTotal a revisar: *{total_atencion}*.\n"
        "Revísalos y actúa (agregar unidades / solicitar compra / marcar revisado) "
        "en *Control de Inventario* → /app."
    )

    print(f"Resumen: agotados={agotados} criticos={criticos} bajos={bajos} divergentes={divergentes}")

    if not _quiet():
        enviar_whatsapp_reporte(mensaje, jid_grupo_inventario_wa())

    return 0


if __name__ == "__main__":
    sys.exit(main())
