#!/usr/bin/env python3
"""
Cron semanal (frecuencia real vía Sistemas → Tareas Programadas, ver
app.services.cron_scheduler): archiva en `app/data/salud_negocio_cache.json`
el gasto en Product Ads de las últimas semanas mientras siguen dentro de la
ventana de 90 días de MeLi.

Por qué existe: MeLi rechaza (HTTP 400) pedir métricas de campaña con más de
90 días de antigüedad — confirmado ago-2026 tanto por la API como por el
propio panel web de Mercado Ads (no hay reporte, exportable ni de la IA
asistente de MeLi, que lo recupere después de esa ventana). El asistente de
MeLi lo resume así: "si no descargaste los reportes y el período ya supera
los 90 días, no podrás recuperar el detalle" — y MeLi tampoco manda nada
automático por correo. Este script es exactamente ese "guardar un reporte
periódico" que recomienda MeLi, pero automático y dentro de la propia app:
`app.services.salud_negocio.salud_negocio_resumen(periodicidad="semana", n=12)`
ya cachea en disco cada semana cerrada la primera vez que se calcula — correr
esto una vez por semana garantiza que ninguna semana llegue a los 90 días
sin haber sido archivada, sin depender de que alguien abra el panel a tiempo.

Una vez archivado (`ads_disponible=True`), el dato queda protegido para
siempre aunque cambie `_CACHE_VERSION` del módulo — ver
`salud_negocio._buscar_ads_archivado`.

Uso típico (crontab dispara semanal — desde la raíz del repo):
  20 8 * * 1 cd /ruta/mi-agente && ./venv/bin/python scripts/archivar_gasto_ads_cron.py >>log_cron.txt 2>&1

Variables:
  GRUPO_ALERTAS_SISTEMAS_WA — destino de la alerta SOLO si algo quedó sin archivar
  AGENTE_ARCHIVAR_ADS_SKIP_WA=1 — imprime sin enviar WhatsApp (pruebas)
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

_MARGEN_DIAS_ALERTA = 80  # avisar si una semana sin archivar ya lleva >80 días (10 de margen antes del corte de 90)


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar("archivar_gasto_ads"):
        print("⏭  Archivo de gasto en ads: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    from app.services.salud_negocio import salud_negocio_resumen

    try:
        resultado = salud_negocio_resumen(periodicidad="semana", n=12)
    except Exception as e:
        print(f"❌ Error calculando/archivando salud del negocio: {e}")
        return 1

    registrar_ejecucion("archivar_gasto_ads")

    hoy = datetime.now().date()
    en_riesgo = []
    archivadas_ahora = 0
    for b in resultado["buckets"]:
        if b.get("ads_disponible"):
            if b.get("fuente") == "calculado":
                archivadas_ahora += 1
            continue
        dias_desde_fin = (hoy - date.fromisoformat(b["fin"])).days
        if dias_desde_fin >= _MARGEN_DIAS_ALERTA:
            en_riesgo.append((b["label"], dias_desde_fin))

    print(
        f"[{datetime.now().isoformat(timespec='seconds')}] archivar_gasto_ads: "
        f"{len(resultado['buckets'])} semanas revisadas, {archivadas_ahora} archivadas en esta corrida, "
        f"{len(en_riesgo)} sin dato y por vencerse."
    )

    if not en_riesgo:
        print("✅ Todas las semanas dentro de la ventana de 90 días están archivadas.")
        return 0

    lineas = [
        "⚠️ *Salud del negocio — gasto en ads a punto de perderse*",
        "MeLi rechaza pedir gasto en ads con más de 90 días de antigüedad — estas semanas están a menos de "
        f"{90 - _MARGEN_DIAS_ALERTA} días de ese corte y todavía no tienen el dato archivado:",
    ]
    for label, dias in en_riesgo:
        lineas.append(f"• {label} — {dias} días desde que cerró (quedan ~{max(0, 90 - dias)})")
    lineas.append(
        "\nRevisar si el token de MeLi está vigente o si la cuenta perdió acceso a Mercado Ads → "
        "Métricas. Detalle en /app → Contabilidad → Salud del negocio."
    )
    cuerpo = "\n".join(lineas)
    print(cuerpo)

    if os.getenv("AGENTE_ARCHIVAR_ADS_SKIP_WA", "").strip() == "1":
        print("(AGENTE_ARCHIVAR_ADS_SKIP_WA=1 — no se envía WhatsApp)")
        return 0

    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

        enviar_whatsapp_reporte(cuerpo, jid_grupo_alertas_sistemas_wa())
        print("✅ Alerta enviada por WhatsApp")
        return 0
    except Exception as e:
        print(f"❌ No se pudo enviar la alerta por WhatsApp: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
