#!/usr/bin/env python3
"""
Cron semanal: envía al grupo de sistemas el resumen de costos LLM vía API
(Gemini/Claude) de la última semana, por canal y por modelo.

Uso típico (crontab, lunes 7:45, desde la raíz del repo):
  45 7 * * 1 cd /ruta/mi-agente && ./venv/bin/python scripts/resumen_costos_llm_cron.py >>log_cron.txt 2>&1

Variables:
  GRUPO_ALERTAS_SISTEMAS_WA — destino (default en app.utils.jid_grupo_alertas_sistemas_wa)
  AGENTE_COSTOS_LLM_SKIP_WA=1 — imprimir el resumen sin enviar WhatsApp (pruebas)
"""

from __future__ import annotations

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

# Nombres legibles para los contextos registrados por llm_budget.
_NOMBRES_CANAL = {
    "cliente_chat": "WhatsApp/Web clientes",
    "chat_primario": "Chat panel/CLI",
    "meli_preventa": "Preventa MeLi",
    "test_batch": "Pruebas",
}


def _fmt_bloque(titulo: str, datos: dict[str, float]) -> str:
    if not datos:
        return ""
    filas = "\n".join(
        f"  • {_NOMBRES_CANAL.get(k, k)}: US${v:.2f}"
        for k, v in sorted(datos.items(), key=lambda kv: -kv[1])
        if v >= 0.005
    )
    return f"\n{titulo}\n{filas}" if filas else ""


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar("resumen_costos_llm"):
        print("⏭  Resumen costos LLM: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0
    registrar_ejecucion("resumen_costos_llm")

    from app.services.llm_budget import _f, resumen_semanal

    sem = resumen_semanal()
    total = sem.get("total_usd", 0.0)
    dias_con_gasto = [d for d in sem.get("dias", []) if (d.get("gasto_usd") or 0) > 0]
    pico = max(dias_con_gasto, key=lambda d: d.get("gasto_usd", 0), default=None)

    lineas = [
        "💸 *Costos IA vía API — resumen semanal*",
        f"Semana {sem.get('desde', '?')} → {sem.get('hasta', '?')}",
        f"Total: *US${total:.2f}* en {sem.get('llamadas', 0)} llamadas "
        f"(promedio US${sem.get('promedio_dia_usd', 0):.2f}/día)",
    ]
    if pico:
        lineas.append(
            f"Día más alto: {pico.get('fecha')} con US${pico.get('gasto_usd', 0):.2f}"
        )
    cuerpo = "\n".join(lineas)
    cuerpo += _fmt_bloque("*Por canal:*", sem.get("por_contexto", {}))
    cuerpo += _fmt_bloque("*Por modelo:*", sem.get("por_modelo", {}))
    cuerpo += (
        f"\n\nLímites: alerta US${_f('LLM_BUDGET_DIARIO_USD', 1.0):.2f}/día, "
        f"bloqueo US${_f('LLM_BUDGET_TOPE_USD', 3.0):.2f}/día. "
        "Detalle diario en el monitor: http://localhost:3000/monitor"
    )

    print(f"[{datetime.now().isoformat(timespec='seconds')}] resumen_costos_llm:")
    print(cuerpo)

    if os.getenv("AGENTE_COSTOS_LLM_SKIP_WA", "").strip() == "1":
        print("(AGENTE_COSTOS_LLM_SKIP_WA=1 — no se envía WhatsApp)")
        return 0

    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

        enviar_whatsapp_reporte(cuerpo, jid_grupo_alertas_sistemas_wa())
        print("✅ Resumen enviado al grupo de sistemas")
        return 0
    except Exception as e:
        print(f"❌ No se pudo enviar el resumen por WhatsApp: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
