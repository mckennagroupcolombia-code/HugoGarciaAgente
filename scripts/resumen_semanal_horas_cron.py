#!/usr/bin/env python3
"""
Cron semanal (viernes): mensaje de WhatsApp a cada persona con cómo le fue en la semana y
cómo va su quincena (app/services/control_horas.resumen_semanal). Sin LLM.

  30 17 * * 5 cd /ruta/mi-agente && ./venv/bin/python scripts/resumen_semanal_horas_cron.py >>log_cron.txt 2>&1

Solo envía con RESUMEN_HORAS_WA_ACTIVO=1 en .env (o --enviar); si no, imprime los mensajes.
No repite: guarda en app/data/control_horas.json a quién se le envió cada semana.
Destino: el teléfono del usuario en el panel (tickets.db → usuarios.telefono).
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
os.chdir(REPO)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO / ".env")

from app.services import control_horas as CH  # noqa: E402
from app.services import tickets_db  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Resumen semanal de horas por WhatsApp")
    ap.add_argument("--enviar", action="store_true", help="enviar aunque RESUMEN_HORAS_WA_ACTIVO no esté en 1")
    ap.add_argument("--solo", type=int, help="solo este usuario_id")
    ap.add_argument("--forzar", action="store_true", help="reenviar aunque ya se haya enviado esta semana")
    a = ap.parse_args()
    enviar = a.enviar or os.getenv("RESUMEN_HORAS_WA_ACTIVO", "0") == "1"

    ahora = datetime.utcnow() + timedelta(hours=-5)
    semana = f"{ahora.isocalendar().year}-W{ahora.isocalendar().week:02d}"
    datos = CH._cargar()
    enviados = datos.setdefault("resumenes_enviados", {}).setdefault(semana, [])

    with sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True) as c:
        usuarios = c.execute(
            "SELECT id, nombre, telefono FROM usuarios WHERE activo=1 AND telefono IS NOT NULL AND telefono<>''"
        ).fetchall()
    from app.utils import enviar_whatsapp_reporte

    n = 0
    for uid, nombre, tel in usuarios:
        if a.solo and uid != a.solo:
            continue
        if uid in enviados and not a.forzar:
            print(f"· {nombre}: ya se envió la semana {semana}")
            continue
        try:
            texto = CH.resumen_semanal(uid, ahora=ahora)
        except ValueError as e:
            print(f"· {nombre}: {e}")
            continue
        if not texto:
            continue
        print(f"\n── {nombre} ({tel[-4:].rjust(len(tel), '*')}) ──\n{texto}")
        if enviar:
            if enviar_whatsapp_reporte(texto, numero_destino=tel):
                enviados.append(uid)
                n += 1
            else:
                print(f"   ⚠️ No se pudo enviar a {nombre}")
    if enviar:
        CH._guardar(datos)
        print(f"\nEnviados: {n}")
    else:
        print("\n(Ensayo: no se envió nada. Para enviar: RESUMEN_HORAS_WA_ACTIVO=1 o --enviar)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
