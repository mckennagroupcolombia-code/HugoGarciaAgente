#!/usr/bin/env python3
"""
Cron: revisión diaria de facturación MeLi (Facturación → Ventas).

Hasta el 21-sep-2026 este cron armaba un ticket GLOBAL por día («Revisión
facturación MeLi — <fecha>») con un paso por venta y sugerencias de IA como
comentarios. Se dejó de hacer: el checklist se llenaba de ventas que ya se
habían facturado después de la foto (85 de 94 «sin facturar» el 21-sep), y la
revisión real se hace en el panel, venta por venta, donde está el botón
«Facturar ahora» y el cruce comprado vs facturado. Cuando una venta necesita a
otra persona, el operador le pide la intervención desde esa venta
(`revision_facturacion.pedir_intervencion`): una solicitud por venta.

Lo que hace ahora, sin LLM:
  1. Recalcula el listado de los últimos N días (actualiza el histórico).
  2. Revalida las filas del histórico cuya foto puede estar vieja (sin
     facturar, en tránsito, en margen, duplicados…) contra MeLi y Alegra.
  3. Cierra los tickets globales viejos que ya tengan todos sus pasos hechos.
  4. Si aparecieron casos NUEVOS que piden acción (no revisados y sin una
     intervención abierta), manda UN WhatsApp corto al grupo de contabilidad
     que lleva al panel. Un caso ya avisado no se vuelve a avisar.

Uso típico (crontab, desde la raíz del repo):
  30 7 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/revision_facturacion_cron.py >>log_cron.txt 2>&1

La frecuencia efectiva la gobierna app/services/cron_scheduler.py (Sistemas →
Tareas Programadas).

Variables:
  REVISION_FACTURACION_ACTIVO=0     — desactiva el cron sin tocar el crontab (default: activo)
  REVISION_FACTURACION_QUIET=1      — no envía WhatsApp (pruebas)
  REVISION_FACTURACION_DIAS         — ventana hacia atrás en días (default 30)
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

JOB_ID = "revision_facturacion"


def _activo() -> bool:
    return (os.getenv("REVISION_FACTURACION_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("REVISION_FACTURACION_QUIET", "0") or "0").strip() == "1"


def _dias() -> int:
    try:
        return int(os.getenv("REVISION_FACTURACION_DIAS", "30") or "30")
    except ValueError:
        return 30


def _ya_avisados(ids: list[str]) -> set[str]:
    """order_id ya avisados por WhatsApp (tabla en el mismo SQLite del histórico)."""
    from app.services.facturacion_ventas_cache import _conn, init_db

    init_db()
    with _conn() as con:
        con.execute("CREATE TABLE IF NOT EXISTS avisos_revision (order_id TEXT PRIMARY KEY, avisado_en TEXT)")
        if not ids:
            return set()
        marcas = ",".join("?" * len(ids))
        return {r[0] for r in con.execute(f"SELECT order_id FROM avisos_revision WHERE order_id IN ({marcas})", ids)}


def _registrar_avisados(ids: list[str]) -> None:
    from app.services.facturacion_ventas_cache import _conn

    ahora = datetime.now().isoformat(timespec="seconds")
    with _conn() as con:
        con.executemany("INSERT OR IGNORE INTO avisos_revision VALUES (?, ?)", [(i, ahora) for i in ids])


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Revisión facturación: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0
    if not _activo():
        print("⏸️  REVISION_FACTURACION_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.services.facturacion_ventas_cache import filas_para_revalidar, listar_historial
    from app.services.facturacion_ventas_unificado import (
        _revalidar_una,
        anotar_filas,
        listar_ventas_meli_unificado,
        problema_de_venta,
    )
    from app.tools.revision_facturacion import cerrar_tickets_revision_completados

    dias = _dias()
    print(f"🔎 Revisando facturación MeLi de los últimos {dias} día(s)…")
    try:
        resultado = listar_ventas_meli_unificado(dias=dias, segmento="todas", limite=150, forzar=True)
        if resultado.get("error"):
            print(f"🔴 {resultado['error']}")
    except Exception as e:  # noqa: BLE001
        print(f"🔴 No se pudo listar ventas MeLi unificadas: {e}")

    ids = filas_para_revalidar(max_filas=300, edad_minima_min=60)
    print(f"   Revalidando {len(ids)} fila(s) del histórico con foto vieja…")
    for oid in ids:
        _revalidar_una(oid)

    cerrados = cerrar_tickets_revision_completados()
    if cerrados:
        print(f"   ✅ Tickets globales viejos con todos los pasos hechos, cerrados: {cerrados}")

    ventas = anotar_filas(listar_historial(segmento="todas", limite=5000)["ventas"])
    casos = [
        v for v in ventas
        if not v.get("revisado")
        and not (v.get("intervencion") or {}).get("abierta")
        and problema_de_venta(v)[0]
    ]
    nuevos = [v for v in casos if v["order_id"] not in _ya_avisados([v["order_id"] for v in casos])]
    print(f"   {len(casos)} venta(s) piden acción · {len(nuevos)} nueva(s) desde el último aviso.")

    registrar_ejecucion(JOB_ID)

    if nuevos and not _quiet():
        from app.utils import enviar_whatsapp_reporte

        por_tipo: dict[str, int] = {}
        for v in nuevos:
            t = problema_de_venta(v)[0]
            por_tipo[t] = por_tipo.get(t, 0) + 1
        from app.tools.revision_facturacion import ETIQUETA_PROBLEMA

        detalle = " · ".join(f"{n} {ETIQUETA_PROBLEMA.get(t, t)}" for t, n in sorted(por_tipo.items()))
        enviar_whatsapp_reporte(
            f"🧾 *Facturación MeLi*: {len(nuevos)} venta(s) nueva(s) piden acción ({detalle}).\n"
            f"Total pendientes: {len(casos)}. Revisar en /app → Facturación → Ventas → «Solo pendientes»; "
            "si una necesita a otra persona, usar «Pedir intervención» en esa venta.",
            os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us").strip(),
        )
        _registrar_avisados([v["order_id"] for v in nuevos])
    return 0


if __name__ == "__main__":
    sys.exit(main())
