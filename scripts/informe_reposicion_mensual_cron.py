#!/usr/bin/env python3
"""
Cron mensual (cierre de mes calendario): mide, para productos de ALTA
rotación, cuánto se demoró McKenna en reponerlos cada vez que quedaron en
stock=0 durante el mes, y asigna una calificación. Envía al grupo MCKG SEDE
SUR.

El histórico se alimenta día a día desde el reporte de stock
(app/sync.py::actualizar_historial_reposicion, llamado dentro de
ejecutar_sincronizacion_y_reporte_stock). Este script NO consulta MeLi — solo
lee app/data/historial_reposicion_stock.json.

El trackeo arrancó en ago-2026 (no existía ningún registro de reposición
antes) — los primeros meses van a tener pocos eventos cerrados; la
calificación gana precisión con más historia acumulada.

cron no soporta "último día del mes" nativamente, así que este script corre
TODOS los días y decide internamente si hoy es el cierre de mes.

Uso típico (crontab, diario 20:00):
  0 20 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/informe_reposicion_mensual_cron.py >>log_cron.txt 2>&1

Variables:
  GRUPO_SEDE_SUR_WA         — destino (default en app.utils.jid_grupo_sede_sur_wa)
  AGENTE_REPOSICION_SKIP_WA=1 — imprimir el informe sin enviar WhatsApp (pruebas)
  AGENTE_REPOSICION_FORZAR=1  — ignora el chequeo de "fin de mes" (pruebas)
"""

from __future__ import annotations

import calendar
import json
import os
import statistics
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

_HISTORIAL_PATH = REPO / "app" / "data" / "historial_reposicion_stock.json"


def _es_fin_de_mes(hoy: date) -> bool:
    ultimo_dia = calendar.monthrange(hoy.year, hoy.month)[1]
    return hoy.day == ultimo_dia


def _calificacion(promedio_dias: float) -> str:
    if promedio_dias <= 3:
        return "🟢 A — Excelente"
    if promedio_dias <= 7:
        return "🟡 B — Bueno"
    if promedio_dias <= 14:
        return "🟠 C — Regular"
    return "🔴 D — Crítico"


def _parse_iso_seguro(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def main() -> int:
    hoy = date.today()
    if os.getenv("AGENTE_REPOSICION_FORZAR", "").strip() != "1" and not _es_fin_de_mes(hoy):
        print(f"⏭  Informe reposición: hoy ({hoy.isoformat()}) no es el último día del mes.")
        return 0

    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar("informe_reposicion_mensual"):
        print("⏭  Informe reposición: ya se envió este cierre de mes.")
        return 0
    registrar_ejecucion("informe_reposicion_mensual")

    try:
        with open(_HISTORIAL_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {}
    except Exception as e:
        print(f"❌ No se pudo leer el historial de reposición: {e}")
        data = {}

    cerrados = data.get("eventos_cerrados") or []
    abiertos = data.get("eventos_abiertos") or {}

    inicio_mes = hoy.replace(day=1)
    del_mes = []
    for c in cerrados:
        dt = _parse_iso_seguro(c.get("repuesto_en"))
        if dt is not None and dt.date() >= inicio_mes:
            del_mes.append(c)

    lineas = [
        "📦 *REPOSICIÓN DE ALTA ROTACIÓN — cierre de mes*",
        f"Periodo: {inicio_mes.isoformat()} → {hoy.isoformat()}",
        "─" * 25,
    ]

    if not del_mes:
        lineas.append(
            "\nNo hay reposiciones completas registradas este mes. El trackeo "
            "arrancó en agosto/2026 — la calificación va a ganar sentido con "
            "más historia acumulada mes a mes."
        )
    else:
        dias = [c["dias"] for c in del_mes]
        promedio = round(sum(dias) / len(dias), 1)
        mediana = round(statistics.median(dias), 1)
        peor = max(del_mes, key=lambda c: c["dias"])
        mejor = min(del_mes, key=lambda c: c["dias"])
        lineas.append(f"\n*{len(del_mes)}* reposiciones completadas este mes (solo alta rotación).")
        lineas.append(f"Promedio: *{promedio} días* · Mediana: {mediana} días")
        lineas.append(f"Más rápida: {mejor['nombre']} ({mejor['dias']} días)")
        lineas.append(f"Más lenta: {peor['nombre']} ({peor['dias']} días)")
        lineas.append(f"\n*Calificación del mes: {_calificacion(promedio)}*")

    if abiertos:
        pendientes = sorted(abiertos.items(), key=lambda kv: kv[1].get("agotado_en", ""))
        lineas.append(
            f"\n⏳ *{len(pendientes)} productos de alta rotación siguen agotados ahora mismo:*"
        )
        for mid, ev in pendientes[:15]:
            dt = _parse_iso_seguro(ev.get("agotado_en"))
            dias_abierto = round((datetime.now() - dt).total_seconds() / 86400, 1) if dt else "?"
            lineas.append(f"  • {ev.get('nombre', mid)} — {dias_abierto} días sin reponer")

    lineas.append(
        "\n_Calificación: 🟢 A ≤3 días · 🟡 B 4-7 · 🟠 C 8-14 · 🔴 D 15+ "
        "(promedio de reposiciones cerradas este mes, solo alta rotación)._"
    )

    cuerpo = "\n".join(lineas)
    print(f"[{datetime.now().isoformat(timespec='seconds')}] informe_reposicion_mensual:")
    print(cuerpo)

    if os.getenv("AGENTE_REPOSICION_SKIP_WA", "").strip() == "1":
        print("(AGENTE_REPOSICION_SKIP_WA=1 — no se envía WhatsApp)")
        return 0

    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_sede_sur_wa

        enviar_whatsapp_reporte(cuerpo, jid_grupo_sede_sur_wa())
        print("✅ Informe de reposición enviado al grupo Sede Sur")
        return 0
    except Exception as e:
        print(f"❌ No se pudo enviar el informe por WhatsApp: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
