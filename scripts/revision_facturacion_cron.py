#!/usr/bin/env python3
"""
Cron: agente autónomo de revisión de facturación MeLi (Astro Killer).

Hasta ahora `app/tools/revision_facturacion.py` solo se disparaba cuando
alguien abría el panel Facturación → Ventas, NC y Astro Killer (ver
`app/services/facturacion_ventas_unificado.py::listar_ventas_meli_unificado`).
Este cron corre la misma detección todos los días sin depender de que
alguien entre al panel, crea/actualiza el ticket-checklist del Centro de
Mando (`app/tools/revision_facturacion.py::crear_o_actualizar_ticket_revision_facturacion`)
y — solo para los casos NUEVOS de esta corrida — pide al modelo una
sugerencia corta de qué hacer, que queda como comentario del ticket.

Importante: la sugerencia NUNCA ejecuta nada por sí sola (no anula factura,
no emite nota crédito, no cambia estado de venta) — mismo criterio que el
resto del repo (ej. postventa MeLi: borrador + aprobación humana, "hugo dale
ok <order_id>"). El operador sigue marcando "revisado" a mano.

Uso típico (crontab, desde la raíz del repo):
  30 7 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/revision_facturacion_cron.py >>log_cron.txt 2>&1

La frecuencia efectiva real la gobierna app/services/cron_scheduler.py (panel
Sistemas → Tareas Programadas) — el crontab solo dispara el chequeo, que se
sale de inmediato si no ha pasado el intervalo configurado.

Variables:
  REVISION_FACTURACION_ACTIVO=0     — desactiva el cron sin tocar el crontab (default: activo)
  REVISION_FACTURACION_QUIET=1      — no envía WhatsApp aunque haya actividad (pruebas)
  REVISION_FACTURACION_DIAS         — ventana hacia atrás en días (default 30, igual que el panel)
  REVISION_FACTURACION_SIN_IA=1     — crea/actualiza el ticket pero no pide sugerencias al modelo
  REVISION_FACTURACION_AUTORIZAR_GASTO_USD — ver `--autorizar-gasto-usd` abajo
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

JOB_ID = "revision_facturacion"


def _activo() -> bool:
    return (os.getenv("REVISION_FACTURACION_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("REVISION_FACTURACION_QUIET", "0") or "0").strip() == "1"


def _sin_ia() -> bool:
    return (os.getenv("REVISION_FACTURACION_SIN_IA", "0") or "0").strip() == "1"


def _dias() -> int:
    try:
        return int(os.getenv("REVISION_FACTURACION_DIAS", "30") or "30")
    except ValueError:
        return 30


def _items_nuevos(items: list[dict]) -> list[dict]:
    """Mismo criterio de dedupe que
    `crear_o_actualizar_ticket_revision_facturacion` — se calcula aparte
    (antes de llamarla) solo para saber a cuáles order_id vale la pena
    pedirles sugerencia de IA (no repetir en casos ya conocidos)."""
    from app.tools.revision_facturacion import pasos_abiertos_facturacion, revisado_map_facturacion

    ya_conocidos = set(revisado_map_facturacion().keys()) | set(pasos_abiertos_facturacion().keys())
    return [it for it in items if str(it.get("order_id")) not in ya_conocidos]


def _sugerir_y_comentar(nuevos: list[dict], *, limite: int) -> int:
    """Pide sugerencia de IA para cada item nuevo (hasta `limite`, defensivo
    aunque `permitir_llamada` ya limita internamente por presupuesto) y la
    deja como comentario en el ticket del día. Nunca interrumpe la corrida
    por un fallo de IA en un item — se salta ese caso y sigue."""
    from app.services import tickets_db as _tdb
    from app.tools.revision_facturacion import pasos_abiertos_facturacion, sugerir_resolucion

    if not nuevos:
        return 0

    pasos = pasos_abiertos_facturacion()  # ya refleja los pasos recién creados
    creador_id = None
    try:
        from app.tools.revision_facturacion import _get_creator_user_id, _db_path

        creador_id = _get_creator_user_id(_db_path())
    except Exception:
        creador_id = None
    if not creador_id:
        print("⚠️  Sin usuario admin/activo — no se pueden comentar sugerencias.")
        return 0

    comentados = 0
    for it in nuevos[:limite]:
        order_id = str(it.get("order_id") or "")
        paso = pasos.get(order_id)
        if not paso:
            continue
        r = sugerir_resolucion(order_id, it.get("tipo") or "revisar", it)
        if not r.get("ok"):
            if r.get("motivo"):
                print(f"   ⏭  {order_id}: sin sugerencia ({r['motivo']})")
            continue
        texto = f"🤖 Sugerencia (orden {order_id}): {r['sugerencia']}"
        try:
            _tdb.agregar_comentario(paso["ticket_id"], creador_id, texto, es_interno=False)
            comentados += 1
        except Exception as e:
            print(f"   ⚠️  {order_id}: no se pudo comentar ({e})")
    return comentados


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--autorizar-gasto-usd",
        type=float,
        default=None,
        help="Autoriza un gasto de IA mayor al límite conservador de fábrica para esta corrida "
        "(25 llamadas / US$1, ver app/services/llm_budget.py). Normalmente no hace falta: la "
        "cadencia real (pocos casos nuevos por corrida) no roza ese límite.",
    )
    args = parser.parse_args()

    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Revisión facturación: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  REVISION_FACTURACION_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    if args.autorizar_gasto_usd:
        from app.services.llm_budget import autorizar_lote

        autorizar_lote(args.autorizar_gasto_usd, descripcion="revision_facturacion_cron")

    from app.services.facturacion_ventas_unificado import items_flaggeados_para_ticket, listar_ventas_meli_unificado
    from app.tools.revision_facturacion import crear_o_actualizar_ticket_revision_facturacion

    dias = _dias()
    print(f"🔎 Revisando facturación MeLi de los últimos {dias} día(s)…")
    try:
        resultado = listar_ventas_meli_unificado(dias=dias, segmento="todas", limite=150, forzar=False)
    except Exception as e:
        print(f"🔴 No se pudo listar ventas MeLi unificadas: {e}")
        registrar_ejecucion(JOB_ID)
        return 1

    if resultado.get("error"):
        print(f"🔴 {resultado['error']}")
        registrar_ejecucion(JOB_ID)
        return 1

    items = items_flaggeados_para_ticket(resultado)
    nuevos = _items_nuevos(items)
    print(f"   {len(items)} caso(s) con problema · {len(nuevos)} nuevo(s) en esta corrida.")

    ok, mensaje = crear_o_actualizar_ticket_revision_facturacion(items)
    print(f"   {mensaje}")

    comentados = 0
    if ok and nuevos and not _sin_ia():
        comentados = _sugerir_y_comentar(nuevos, limite=25)
        if comentados:
            print(f"   🤖 {comentados} sugerencia(s) de IA agregadas como comentario.")

    registrar_ejecucion(JOB_ID)

    hay_actividad = bool(nuevos) or not ok
    if hay_actividad and not _quiet():
        from app.utils import enviar_whatsapp_reporte

        partes = [f"🧾 *Revisión de facturación MeLi* — {dias} día(s)", mensaje]
        if comentados:
            partes.append(f"🤖 {comentados} sugerencia(s) de IA lista(s) para revisar en el ticket.")
        enviar_whatsapp_reporte(
            "\n".join(partes),
            os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us").strip(),
        )

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
