#!/usr/bin/env python3
"""
Cron diario: envía al grupo MCKG SEDE SUR un único resumen de las acciones y
solicitudes del día (creadas, iniciadas, completadas, por persona) en vez del
mensaje instantáneo que antes se enviaba por cada cambio de estado.

Contexto: en agosto/2026 el grupo llegó a recibir 30-67 mensajes/día (un texto
por cada creación y cada cambio de estado de cada ticket), y el equipo reportó
que la sobrecarga hacía que se olvidaran cosas. El aviso instantáneo de "ticket
nuevo asignado" se mantiene (ver `_notificar_nueva_accion_wa` en
app/routes_tickets.py) porque exige acción inmediata; todo lo demás se agrupa
acá. El detalle en vivo de quién hizo qué sigue disponible en el banner
"Actividad del equipo" de /app (GET /api/tickets/actividad-equipo).

Uso típico (crontab, 18:00, desde la raíz del repo):
  0 18 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/resumen_actividad_sede_sur_cron.py >>log_cron.txt 2>&1

Variables:
  GRUPO_SEDE_SUR_WA — destino (default en app.utils.jid_grupo_sede_sur_wa)
  AGENTE_ACTIVIDAD_SEDE_SUR_SKIP_WA=1 — imprimir el resumen sin enviar WhatsApp (pruebas)
"""

from __future__ import annotations

import json
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

_NOTIF_CONFIG_PATH = REPO / "app" / "data" / "config_notif_wa.json"


def _sede_sur_activo() -> bool:
    try:
        return bool(json.loads(_NOTIF_CONFIG_PATH.read_text()).get("sede_sur_acciones", True))
    except Exception:
        return True


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar("resumen_actividad_sede_sur"):
        print("⏭  Resumen actividad SEDE SUR: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0
    registrar_ejecucion("resumen_actividad_sede_sur")

    if not _sede_sur_activo():
        print("⏭  Notificaciones SEDE SUR desactivadas en app/data/config_notif_wa.json.")
        return 0

    from app.services.tickets_db import actividad_equipo_hoy

    eventos = actividad_equipo_hoy(limite=500)
    print(f"[{datetime.now().isoformat(timespec='seconds')}] resumen_actividad_sede_sur: {len(eventos)} eventos hoy")

    if not eventos:
        print("Sin actividad hoy — no se envía resumen.")
        return 0

    creadas = sum(1 for e in eventos if e["accion"] == "ticket_creado")
    completadas = sum(1 for e in eventos if "completó" in e["resumen"])
    iniciadas = sum(1 for e in eventos if "inició" in e["resumen"])

    por_persona: dict[str, dict[str, int]] = {}
    for e in eventos:
        p = por_persona.setdefault(e["usuario_nombre"], {"nuevas": 0, "completadas": 0})
        if e["accion"] == "ticket_creado":
            p["nuevas"] += 1
        elif "completó" in e["resumen"]:
            p["completadas"] += 1

    lineas = [
        "📋 *Resumen del día — SEDE SUR*",
        f"Hoy: {creadas} nueva{'s' if creadas != 1 else ''} · "
        f"{completadas} completada{'s' if completadas != 1 else ''} · "
        f"{iniciadas} iniciada{'s' if iniciadas != 1 else ''}",
        "",
        "*Por persona:*",
    ]
    for nombre, c in sorted(por_persona.items(), key=lambda kv: -(kv[1]["nuevas"] + kv[1]["completadas"])):
        if c["nuevas"] or c["completadas"]:
            lineas.append(f"• {nombre}: {c['nuevas']} nueva{'s' if c['nuevas'] != 1 else ''}, {c['completadas']} completada{'s' if c['completadas'] != 1 else ''}")

    lineas.append("")
    lineas.append("Detalle en vivo: https://bot.mckennagroup.co/app")
    cuerpo = "\n".join(lineas)
    print(cuerpo)

    if os.getenv("AGENTE_ACTIVIDAD_SEDE_SUR_SKIP_WA", "").strip() == "1":
        print("(AGENTE_ACTIVIDAD_SEDE_SUR_SKIP_WA=1 — no se envía WhatsApp)")
        return 0

    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_sede_sur_wa

        enviar_whatsapp_reporte(cuerpo, jid_grupo_sede_sur_wa())
        print("✅ Resumen enviado al grupo SEDE SUR")
        return 0
    except Exception as e:
        print(f"❌ No se pudo enviar el resumen por WhatsApp: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
