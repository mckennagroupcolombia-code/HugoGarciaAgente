#!/usr/bin/env python3
"""
Cron: reintenta el aviso de WhatsApp al grupo "Guias_Envios pagina web"
(GRUPO_PEDIDOS_WEB_WA) para pedidos web con pago ya aprobado por Mercado Pago
cuyo `whatsapp_notified_at` nunca se llenó.

Origen: el pedido MCKG-43209FCB19 (6-sep-2026) se pagó, descontó stock, envió
correo de confirmación y facturó correctamente — pero el aviso al grupo se
perdió en silencio porque el puente de WhatsApp (bot-mckenna) respondió 503
"Sincronizando..." durante toda la ventana de reintentos de
`enviar_whatsapp_reporte` (5 intentos en menos de un minuto, ver app/utils.py),
y no existía ningún mecanismo que lo volviera a intentar después. Se
encontraron otros 3 casos iguales en los últimos 5 meses (abril y agosto
2026), aprox. 1 vez al mes.

Este cron reintenta llamando al mismo pipeline idempotente
(`process_order_paid_side_effects` en app/tools/web_pedidos.py), que solo
reenvía lo que falta (el aviso de WhatsApp) y no repite lo que ya se hizo
(descuento de stock, correo, factura) — cada paso ya se protege con su propio
campo `_at` en la base de datos.

Ventana intencional (REINTENTAR_AVISOS_WEB_DIAS, default 7 días): este cron
es una red de seguridad para fallas RECIENTES del puente de WhatsApp, no un
barrido retroactivo de todo el historial. Casos huérfanos más viejos que la
ventana (los de abril/agosto detectados en la auditoría del 7-sep-2026) se
quedan fuera a propósito — reenviar avisos de pedidos de hace meses al grupo
operativo puede confundir más que ayudar si el equipo ya los resolvió a mano
por otra vía; para esos, reenviar es una decisión manual, no automática.

Uso típico (crontab, desde la raíz del repo):
  */30 * * * * cd /ruta/mi-agente && ./venv/bin/python scripts/reintentar_avisos_pedidos_web_cron.py >>log_cron.txt 2>&1

La frecuencia efectiva real la gobierna app/services/cron_scheduler.py
(panel Sistemas → Tareas Programadas) — el crontab solo dispara el chequeo,
que se sale de inmediato si no ha pasado el intervalo configurado (default 1h).

Variables:
  REINTENTAR_AVISOS_WEB_CRON_ACTIVO=0   — desactiva el cron sin tocar el crontab (default: activo)
  REINTENTAR_AVISOS_WEB_DIAS            — ventana de pedidos a revisar (default 7)
"""
from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

JOB_ID = "reintentar_avisos_pedidos_web"


def _activo() -> bool:
    return (os.getenv("REINTENTAR_AVISOS_WEB_CRON_ACTIVO", "1") or "1").strip() == "1"


def _dias_ventana() -> int:
    try:
        return int(os.getenv("REINTENTAR_AVISOS_WEB_DIAS", "7") or "7")
    except ValueError:
        return 7


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Reintento avisos pedidos web: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  REINTENTAR_AVISOS_WEB_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.tools.web_pedidos import (
        ORDERS_DB,
        get_order_by_reference,
        migrate_orders_table,
        process_order_paid_side_effects,
    )

    migrate_orders_table()
    desde = (datetime.now() - timedelta(days=_dias_ventana())).isoformat()

    con = sqlite3.connect(ORDERS_DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT reference FROM orders WHERE status = 'approved' "
        "AND (whatsapp_notified_at IS NULL OR whatsapp_notified_at = '') "
        "AND created_at >= ?",
        (desde,),
    ).fetchall()
    con.close()

    if not rows:
        print("✅ Sin pedidos pagados recientes con aviso pendiente.")
        registrar_ejecucion(JOB_ID)
        return 0

    reenviados: list[str] = []
    fallidos: list[tuple[str, str]] = []
    for row in rows:
        ref = row["reference"]
        try:
            process_order_paid_side_effects(ref)
        except Exception as e:
            fallidos.append((ref, str(e)))
            continue
        order = get_order_by_reference(ref)
        if order and order.get("whatsapp_notified_at"):
            reenviados.append(ref)
        else:
            fallidos.append((ref, "el puente de WhatsApp sigue sin responder; se reintentará en la próxima corrida"))

    registrar_ejecucion(JOB_ID)

    if reenviados:
        print(f"✅ Aviso reenviado al grupo para: {', '.join(reenviados)}")
    for ref, err in fallidos:
        print(f"🔴 Sigue pendiente {ref}: {err}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
