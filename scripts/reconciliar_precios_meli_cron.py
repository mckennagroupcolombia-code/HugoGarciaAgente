#!/usr/bin/env python3
"""
Cron: trae el precio VIVO de cada publicación activa en MeLi (referencia
maestra, ver app/services/precios_canales.py) y corrige Siigo → Sheets → Web
donde difieran, usando exactamente la misma lógica que el editor manual de
"Ganancia" (reconciliar_precios_meli, dry_run=False).

Origen: el único disparador de esta reconciliación era pedirle a Hugo por
chat "sincroniza precios" — nada corría solo. Si el precio se bajaba directo
en la app/web de MeLi (el flujo real más común, en vez de por el panel
Ganancia), Siigo y la web quedaban con el precio viejo hasta que alguien se
acordara de pedirlo. Ver docs/agentic/modules/ (o pedir contexto) para el
hilo completo — reporte de ago-2026 con citrato de magnesio 250g/500g.

Solo aplica automáticamente los candidatos "seguros" (ratio MeLi/Siigo <2×,
ver ratio_max en reconciliar_precios_meli) — los sospechosos (posible cruce
de SKU) NUNCA se escriben solos, se reportan por WhatsApp para revisión
manual vía el panel Ganancia o el comando de chat con el SKU explícito.

Uso típico (crontab, desde la raíz del repo):
  0 */12 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/reconciliar_precios_meli_cron.py >>log_cron.txt 2>&1

La frecuencia efectiva real la gobierna app/services/cron_scheduler.py
(panel Sistemas → Tareas Programadas) — el crontab solo dispara el chequeo,
que se sale de inmediato si no ha pasado el intervalo configurado.

Variables:
  PRECIOS_MELI_CRON_ACTIVO=0   — desactiva el cron sin tocar el crontab (default: activo)
  PRECIOS_MELI_CRON_QUIET=1    — no envía WhatsApp aunque haya actividad (pruebas)
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

JOB_ID = "reconciliar_precios_meli"


def _activo() -> bool:
    return (os.getenv("PRECIOS_MELI_CRON_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("PRECIOS_MELI_CRON_QUIET", "0") or "0").strip() == "1"


def _fmt(n) -> str:
    try:
        return f"${float(n):,.0f}"
    except (TypeError, ValueError):
        return "—"


def _mensaje_whatsapp(resultado: dict) -> str:
    candidatos = resultado.get("candidatos") or []
    aplicados_ok = [
        c for c in candidatos
        if not c.get("sospechoso") and (c.get("siigo_resultado") or {}).get("ok")
    ]
    aplicados_fallidos = [
        c for c in candidatos
        if not c.get("sospechoso") and not (c.get("siigo_resultado") or {}).get("ok")
    ]
    sospechosos = [c for c in candidatos if c.get("sospechoso")]

    lineas = ["💲 *Sincronización de precios MeLi → Siigo/Web (cron)*", ""]

    if aplicados_ok:
        lineas.append(f"✅ *{len(aplicados_ok)}* precio(s) corregido(s) en Siigo/Web (igualados a MeLi):")
        for c in aplicados_ok[:15]:
            lineas.append(
                f"• {c['nombre'][:45]} (SKU {c['sku']}): "
                f"Siigo {_fmt(c['precio_siigo_antes'])} → {_fmt(c['precio_meli'])}"
            )
        if len(aplicados_ok) > 15:
            lineas.append(f"… y {len(aplicados_ok) - 15} más.")
        lineas.append("")

    if sospechosos:
        lineas.append(
            f"⚠️ *{len(sospechosos)}* con diferencia >2× MeLi vs Siigo — huele a SKU cruzado, "
            f"NO se aplicaron solos. Revisar en Ganancia (/app) o pedir por chat con el SKU explícito:"
        )
        for c in sospechosos[:15]:
            lineas.append(
                f"• {c['nombre'][:45]} (SKU {c['sku']}): "
                f"Siigo {_fmt(c['precio_siigo_antes'])} vs MeLi {_fmt(c['precio_meli'])} "
                f"({c.get('ratio')}×)"
            )
        if len(sospechosos) > 15:
            lineas.append(f"… y {len(sospechosos) - 15} más.")
        lineas.append("")

    if aplicados_fallidos:
        lineas.append(f"🔴 *{len(aplicados_fallidos)}* error(es) al escribir en Siigo:")
        for c in aplicados_fallidos[:10]:
            msg = (c.get("siigo_resultado") or {}).get("msg", "error desconocido")
            lineas.append(f"• {c['nombre'][:45]} (SKU {c['sku']}): {msg}")
        lineas.append("")

    for err in resultado.get("errores") or []:
        if err.get("canal") in ("sheets", "web"):
            lineas.append(f"🔴 Error en {err.get('canal')}: {err.get('msg')}")

    lineas.append("Fuente: precio vivo de publicaciones activas en Mercado Libre.")
    return "\n".join(lineas)


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Sincronización de precios MeLi: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  PRECIOS_MELI_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.services.precios_canales import reconciliar_precios_meli
    from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

    print("🔎 Comparando precio vivo de MeLi vs Siigo por SKU…")
    resultado = reconciliar_precios_meli(dry_run=False)

    if resultado.get("error"):
        print(f"🔴 {resultado['error']}")
        registrar_ejecucion(JOB_ID)
        if not _quiet():
            enviar_whatsapp_reporte(
                f"💲 *Sincronización de precios MeLi (cron)*\n\n🔴 {resultado['error']}",
                jid_grupo_facturacion_ventas_wa(),
            )
        return 1

    candidatos = resultado.get("candidatos") or []
    print(f"   {len(candidatos)} SKU(s) con precio distinto entre MeLi y Siigo.")
    print(f"   Aplicados: {resultado.get('aplicados', 0)} | Sospechosos (>2×): {len(resultado.get('omitidos_ratio') or [])}")

    registrar_ejecucion(JOB_ID)

    if not candidatos:
        print("✅ Precios ya sincronizados entre MeLi, Siigo, Sheets y la web. Sin novedades que reportar.")
        return 0

    if not _quiet():
        enviar_whatsapp_reporte(_mensaje_whatsapp(resultado), jid_grupo_facturacion_ventas_wa())

    return 0 if not resultado.get("errores") else 1


if __name__ == "__main__":
    sys.exit(main())
