#!/usr/bin/env python3
"""
Cron: audita sintaxis (py_compile) de scripts del manifiesto y notifica WhatsApp si hay fallos.

Uso típico (crontab, desde la raíz del repo):
  15 7 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/auditar_scripts_cron.py >>log_cron.txt 2>&1

Variables:
  GRUPO_ALERTAS_SISTEMAS_WA — JID por defecto (backup + auditoría); ver app.utils.jid_grupo_alertas_sistemas_wa
  GRUPO_AUDITORIA_SCRIPTS_WA — si se define, anula el destino solo para este cron
  AGENTE_AUDITORIA_SKIP_WA=1 — no enviar WhatsApp aunque falle (pruebas)
  Rutas extra: pasar como args separados por espacio o un solo argumento con comas:
    python scripts/auditar_scripts_cron.py app/foo.py scripts/bar.py
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


def _mensaje_whatsapp(data: dict) -> str:
    if "error" in data:
        return (
            "🔴 *Auditoría scripts (cron)*\n\n"
            f"❌ {data['error']}\n\n"
            "Revisa `app/data/scripts_manifest.json`."
        )
    fallas = [r for r in data.get("detalle", []) if not r.get("ok")]
    lineas = [
        "🔴 *Auditoría scripts (cron)*",
        "",
        f"📊 {data.get('resumen', '')}",
        f"❌ Fallaron *{len(fallas)}* archivo(s):",
        "",
    ]
    for r in fallas[:15]:
        err = (r.get("error") or "")[:280]
        lineas.append(f"• `{r.get('path', '?')}`\n  _{err}_")
    if len(fallas) > 15:
        lineas.append(f"\n… y {len(fallas) - 15} más.")
    lineas.append("\nCorregir sintaxis o rutas; vuelve a correr el audit manualmente.")
    return "\n".join(lineas)


def main() -> int:
    rutas_extra = ",".join(p.strip() for p in sys.argv[1:] if p.strip())

    from app.tools.script_audit import ejecutar_auditoria_dict
    from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

    data = ejecutar_auditoria_dict(rutas_extra=rutas_extra)

    tiene_error_manifest = "error" in data
    fallas = [r for r in data.get("detalle", []) if not r.get("ok")]
    hay_fallo = tiene_error_manifest or bool(fallas)

    if not hay_fallo:
        if os.getenv("AGENTE_AUDITORIA_CRON_QUIET", "").strip().lower() not in (
            "1",
            "true",
            "yes",
        ):
            print(f"✅ Auditoría scripts OK — {data.get('resumen', '')}")
        return 0

    print(f"❌ Auditoría scripts con errores — {data.get('resumen', data.get('error'))}")

    if os.getenv("AGENTE_AUDITORIA_SKIP_WA", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        print("(AGENTE_AUDITORIA_SKIP_WA: no se envía WhatsApp)")
        return 1

    destino = (
        os.getenv("GRUPO_AUDITORIA_SCRIPTS_WA", "").strip().split("#")[0].strip()
        or jid_grupo_alertas_sistemas_wa()
    )
    msg = _mensaje_whatsapp(data)
    ok = enviar_whatsapp_reporte(msg, numero_destino=destino)
    if not ok:
        print("⚠️ No se pudo enviar el aviso a WhatsApp (revisa puente Node / URL_API_WHATSAPP).")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
