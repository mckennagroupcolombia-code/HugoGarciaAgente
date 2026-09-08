#!/usr/bin/env python3
"""
Cron: postea al libro de partida doble propio (app/services/contabilidad_core.py)
lo que app/services/contabilidad_ledger.py::armar_libro() agrega de ventas
MeLi/web/Siigo, compras, compras al exterior, servicios, impuestos y cuotas de
créditos — ver app/services/contabilidad_autopost.py::auto_postear_periodo().

Sin este cron, `armar_libro()` sigue siendo solo una vista de lectura y el
balance de comprobación de contabilidad_core.py nunca refleja la operación
real del negocio (ver Fase 1 del plan "Contabilidad unificada").

Ventana móvil de los últimos CONTABILIDAD_AUTOPOST_DIAS días (default 10, igual
que el resto de los cron de sincronización del repo) para recoger correcciones
tardías (facturas registradas días después, ajustes de compras exterior, etc.)
sin tener que re-procesar todo el histórico cada vez — el dedup por
`referencia=f"auto:{hash}"` hace que reprocesar el mismo rango sea gratis.

Uso típico (crontab, desde la raíz del repo):
  15 */6 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/contabilidad_autopost_cron.py >>log_cron.txt 2>&1

La frecuencia efectiva real la gobierna app/services/cron_scheduler.py (panel
Sistemas → Tareas Programadas) — el crontab solo dispara el chequeo, que se
sale de inmediato si no ha pasado el intervalo configurado.

Variables:
  CONTABILIDAD_AUTOPOST_ACTIVO=0   — desactiva el cron sin tocar el crontab (default: activo)
  CONTABILIDAD_AUTOPOST_QUIET=1    — no envía WhatsApp aunque haya actividad (pruebas)
  CONTABILIDAD_AUTOPOST_DIAS       — ventana móvil hacia atrás en días (default 10)
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

JOB_ID = "contabilidad_autopost"


def _activo() -> bool:
    return (os.getenv("CONTABILIDAD_AUTOPOST_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("CONTABILIDAD_AUTOPOST_QUIET", "0") or "0").strip() == "1"


def _dias_atras() -> int:
    try:
        return int(os.getenv("CONTABILIDAD_AUTOPOST_DIAS", "10") or "10")
    except ValueError:
        return 10


def _mensaje_whatsapp(r: dict) -> str:
    partes = [
        "📒 *Auto-posteo contable* — "
        f"{r['desde']} → {r['hasta']}",
        f"✅ {r['creados']} asiento(s) nuevo(s) · {r['omitidos']} ya existían",
    ]
    if r.get("fuentes_sin_mapeo"):
        detalle = ", ".join(f"{k} ({v})" for k, v in r["fuentes_sin_mapeo"].items())
        partes.append(f"⚠️ Fuentes sin clasificar (no se postearon): {detalle}")
    if r.get("errores"):
        partes.append(f"🔴 {len(r['errores'])} error(es):")
        for e in r["errores"][:5]:
            partes.append(f"  · {e.get('fuente')}: {e.get('error')}")
    return "\n".join(partes)


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Auto-posteo contable: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  CONTABILIDAD_AUTOPOST_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.services.contabilidad_autopost import auto_postear_periodo

    hasta = datetime.now().strftime("%Y-%m-%d")
    desde = (datetime.now() - timedelta(days=_dias_atras())).strftime("%Y-%m-%d")
    print(f"🔎 Auto-posteando contabilidad {desde} → {hasta}…")

    try:
        r = auto_postear_periodo(desde, hasta)
    except Exception as e:
        print(f"🔴 No se pudo correr el auto-posteo: {e}")
        registrar_ejecucion(JOB_ID)
        if not _quiet():
            from app.utils import enviar_whatsapp_reporte
            enviar_whatsapp_reporte(
                f"🔴 *Auto-posteo contable* — falló la corrida {desde} → {hasta}:\n{e}",
                os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us").strip(),
            )
        return 1

    print(
        f"   {r['creados']} creado(s), {r['omitidos']} omitido(s) (ya existían), "
        f"{len(r['fuentes_sin_mapeo'])} fuente(s) sin mapeo, {len(r['errores'])} error(es)."
    )

    hay_actividad = r["creados"] > 0 or r["fuentes_sin_mapeo"] or r["errores"]
    if hay_actividad and not _quiet():
        from app.utils import enviar_whatsapp_reporte
        enviar_whatsapp_reporte(
            _mensaje_whatsapp(r),
            os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us").strip(),
        )

    registrar_ejecucion(JOB_ID)
    return 1 if r["errores"] else 0


if __name__ == "__main__":
    sys.exit(main())
