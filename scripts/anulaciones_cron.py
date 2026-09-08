#!/usr/bin/env python3
"""
Cron de Resolución de Anulaciones (RA).

Barre las ventas MeLi con reintegro al comprador, abre/actualiza su expediente,
las clasifica según la matriz de situaciones, emite la nota crédito de las que
la política de autonomía permite, y **reporta la deuda abierta aunque no haya
pasado nada**.

Reemplaza a `scripts/emitir_notas_credito_cron.py`, que tenía tres huecos:

  1. Partía de `order.status == "cancelled"`. Una devolución deja la orden
     PAGADA con un reclamo encima, así que nunca entraba al barrido — por eso
     el pack 2000014813807951 quedó sin nota crédito y sin dejar rastro.
  2. Descartaba con un `continue` silencioso cualquier cancelación sin factura
     localizable: sin log, sin ticket, sin nada.
  3. Solo avisaba cuando emitía o cuando fallaba al emitir. Un caso que nunca
     llegaba a intentarse producía la misma salida que un día sin devoluciones.
     Ese es el mecanismo exacto que dejó acumular 44 casos y $2,1 M entre el
     26-jun y el 10-ago de 2026 sin que nadie lo notara.

Aquí, en cambio, TODO evento con reintegro abre expediente. Un caso sin factura
localizable no desaparece: queda en `bloqueada` con motivo `factura_no_encontrada`
y aparece en el reporte de deuda hasta que alguien lo resuelva.

Uso típico (crontab, desde la raíz del repo):
  35 7 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/anulaciones_cron.py >>log_cron.txt 2>&1

La frecuencia efectiva la gobierna `app/services/cron_scheduler.py`
(panel Sistemas → Tareas Programadas).

Variables:
  RA_CRON_ACTIVO=0            — desactiva el cron sin tocar el crontab
  RA_CRON_QUIET=1             — no envía WhatsApp (pruebas)
  RA_EMISION_ACTIVA=1         — habilita la emisión real (default 0 = modo sombra)
  RA_UMBRAL_AUTONOMIA         — monto máximo que se emite sin aprobación (default 300000)
  NOTAS_CREDITO_MARGEN_HORAS  — margen tras el reintegro (default 48)
  MELI_CANCELADAS_DIAS_ATRAS  — ventana de búsqueda (default 90)
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

JOB_ID = "anulaciones_ra"


def _activo() -> bool:
    return (os.getenv("RA_CRON_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("RA_CRON_QUIET", "0") or "0").strip() == "1"


def _dias_atras() -> int:
    try:
        return int(os.getenv("MELI_CANCELADAS_DIAS_ATRAS", "90") or "90")
    except ValueError:
        return 90


def _texto_factura(f: dict) -> str:
    return f"{f.get('observations', '')} {f.get('purchase_order', '')}"


def _mensaje(emitidas, decisiones, bloqueadas, deuda) -> str:
    L = ["🧾 *Resolución de Anulaciones (RA)*", ""]
    if emitidas:
        total = sum(float(e.get("nc_total") or 0) for e in emitidas)
        L.append(f"✅ *{len(emitidas)}* nota(s) crédito emitida(s) — ${total:,.0f} COP")
        for e in emitidas[:15]:
            L.append(f"• {e['codigo']}: {e.get('nc_numero')} — factura {e.get('factura_numero')}")
        if len(emitidas) > 15:
            L.append(f"… y {len(emitidas) - 15} más.")
        L.append("")
    if decisiones:
        L.append(f"🟡 *{len(decisiones)}* caso(s) requieren decisión humana:")
        for c in decisiones[:10]:
            L.append(f"• {c['codigo']} (${float(c.get('factura_total') or 0):,.0f}) — {c.get('_motivos', '')[:120]}")
        L.append("")
    if bloqueadas:
        L.append(f"🔴 *{len(bloqueadas)}* bloqueada(s):")
        for c in bloqueadas[:10]:
            L.append(f"• {c['codigo']}: {c.get('bloqueo_motivo')}")
        L.append("")

    # El bloque de deuda va SIEMPRE, haya o no actividad. Es el cambio de fondo
    # respecto del cron viejo: se reporta deuda, no actividad, para que el
    # silencio deje de ser un estado válido.
    L.append(f"📌 *Deuda abierta:* {deuda['abiertas']} anulación(es) por ${deuda['monto']:,.0f}")
    if deuda.get("dias_mas_antigua") is not None:
        L.append(f"   La más antigua lleva *{deuda['dias_mas_antigua']} día(s)* sin resolver.")
    for estado, d in sorted(deuda["por_estado"].items(), key=lambda kv: -kv[1]["n"]):
        L.append(f"   · {estado}: {d['n']} (${d['monto']:,.0f})")
    L.append("")
    L.append("Detalle: Contabilidad → Anulaciones (/app).")
    return "\n".join(L)


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  RA: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0
    if not _activo():
        print("⏸️  RA_CRON_ACTIVO=0 — cron desactivado.")
        return 0

    from app.services import anulaciones_db as adb
    from app.services import anulaciones_motor as motor
    from app.services.alegra import es_factura_alegra, obtener_facturas_hibridas
    from app.services.meli import listar_ordenes_meli_por_estado
    from app.tools.anulaciones import crear_ticket_para_expediente
    from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

    adb.init_db()
    dias = _dias_atras()

    print(f"🔎 RA: barriendo órdenes MeLi de los últimos {dias} días…")
    # Se miran canceladas Y pagadas: una devolución deja la orden PAGADA con el
    # reintegro reflejado en `payments`. Mirar solo `cancelled` es precisamente
    # el hueco que dejó el pack 2000014813807951 sin nota crédito.
    ordenes: list[dict] = []
    for estado in ("cancelled", "paid"):
        try:
            ordenes.extend(listar_ordenes_meli_por_estado(estado, dias_atras=dias))
        except Exception as e:
            print(f"⚠️ No se pudieron listar órdenes '{estado}': {e}")
    print(f"   {len(ordenes)} órdenes en la ventana.")

    con_reintegro = []
    for o in ordenes:
        r = motor.reintegro_de_orden(o)
        if r["hubo"]:
            con_reintegro.append((o, r))
    print(f"   {len(con_reintegro)} con reintegro al comprador.")

    if not con_reintegro:
        deuda = adb.deuda_abierta()
        registrar_ejecucion(JOB_ID)
        if deuda["abiertas"] and not _quiet():
            enviar_whatsapp_reporte(_mensaje([], [], [], deuda), jid_grupo_facturacion_ventas_wa())
        print(f"Sin reintegros nuevos. Deuda abierta: {deuda['abiertas']} por ${deuda['monto']:,.0f}.")
        return 0

    fecha_inicio = (datetime.now() - timedelta(days=dias + 5)).strftime("%Y-%m-%d")
    try:
        facturas = obtener_facturas_hibridas(fecha_inicio, estricto=True)
    except Exception as e:
        # No seguir con una lista incompleta: haría que ventas CON factura se
        # traten como "sin factura". Mejor abortar, avisar y reintentar mañana.
        print(f"🔴 Listado de facturas incompleto (Siigo+Alegra); se aborta la corrida: {e}")
        registrar_ejecucion(JOB_ID)
        return 1
    print(f"   {len(facturas)} facturas (Siigo+Alegra) en la ventana.")

    emitidas, decisiones, bloqueadas = [], [], []

    for orden, reintegro in con_reintegro:
        pack_id = str(orden.get("pack_id") or orden.get("id") or "").strip()
        if not pack_id:
            continue
        order_id = str(orden.get("id") or "")

        clas = motor.clasificar(orden, reintegro)
        comprador = orden.get("buyer") or {}

        caso = adb.abrir_expediente(
            referencia=adb.referencia_meli(pack_id),
            origen="meli_cancelacion" if orden.get("status") == "cancelled" else "meli_reclamo",
            actor="cron",
            pack_id=pack_id, order_id=order_id,
            cliente_nombre=str(comprador.get("nickname") or ""),
            monto_reintegrado=reintegro["monto"],
            motivo=clas["motivo"], alcance=clas["alcance"],
            producto_retorna=clas["producto_retorna"], financia=clas["financia"],
            resumen=f"Reintegro de ${reintegro['monto']:,.0f} detectado ({reintegro['fuente']}).",
        )
        if caso["estado"] in ("cerrada", "emitida", "subida_meli", "posteado_libro"):
            continue

        if not clas["emite_nc"]:
            if caso["estado"] != "descartada":
                adb.transicionar(caso["id"], "descartada", actor="cron", resumen=clas["nota"])
            continue

        factura = next((f for f in facturas if pack_id in _texto_factura(f) or order_id in _texto_factura(f)), None)
        if not factura:
            # A diferencia del cron viejo, esto NO es un `continue` silencioso.
            if caso["estado"] != "bloqueada":
                adb.transicionar(
                    caso["id"], "bloqueada", actor="cron", tipo_evento="fallo",
                    resumen="No se encontro la factura de esta venta en Siigo ni en Alegra.",
                    bloqueo_motivo="factura_no_encontrada",
                )
            bloqueadas.append(adb.obtener(caso["id"]))
            continue

        es_alegra = es_factura_alegra(factura)
        caso = adb.actualizar(
            caso["id"], actor="cron",
            resumen=f"Factura localizada en {'Alegra' if es_alegra else 'Siigo'}.",
            factura_proveedor="alegra" if es_alegra else "siigo",
            factura_id=str(factura.get("id") or ""),
            factura_numero=(
                (factura.get("numberTemplate") or {}).get("fullNumber") if es_alegra
                else (factura.get("name") or str(factura.get("number") or ""))
            ) or "",
            factura_fecha=str(factura.get("date") or "")[:10],
            factura_total=float(factura.get("total") or 0),
            factura_cufe=str(((factura.get("stamp") or {}) if isinstance(factura.get("stamp"), dict) else {}).get("cufe") or ""),
        )

        if not motor.paso_el_margen(caso, reintegro.get("fecha")):
            if caso["estado"] == "detectada":
                adb.transicionar(
                    caso["id"], "en_margen", actor="cron",
                    resumen=f"Dentro del margen de {motor.margen_horas():.0f}h: se le da tiempo a contabilidad.",
                )
            continue

        politica = motor.evaluar_autonomia(caso)
        if politica["autonomia"] != "automatica":
            if caso["estado"] != "requiere_decision":
                adb.transicionar(
                    caso["id"], "requiere_decision", actor="cron", autonomia="manual",
                    resumen="Fuera de la politica de autonomia: " + "; ".join(politica["motivos"]),
                )
                crear_ticket_para_expediente(caso["id"], motivos=politica["motivos"])
            fila = adb.obtener(caso["id"]) or {}
            fila["_motivos"] = "; ".join(politica["motivos"])
            decisiones.append(fila)
            continue

        if caso["estado"] not in ("lista", "emitiendo"):
            adb.transicionar(caso["id"], "lista", actor="cron", autonomia="automatica",
                             resumen="Dentro de la politica de autonomia: se emite sin aprobacion.")

        res = motor.emitir(caso["id"], actor="cron")
        actualizado = adb.obtener(caso["id"]) or {}
        if res.get("ok") and actualizado.get("nc_numero"):
            emitidas.append(actualizado)
            print(f"   ✅ {actualizado['codigo']} → {actualizado['nc_numero']}")
        elif res.get("modo_sombra"):
            print(f"   👤 {actualizado['codigo']}: modo sombra, no se emitió (RA_EMISION_ACTIVA=0).")
        elif actualizado.get("estado") == "bloqueada":
            bloqueadas.append(actualizado)
            print(f"   🔴 {actualizado['codigo']}: {actualizado.get('bloqueo_motivo')}")

        # Guardar el relato acumulado para el panel y para el próximo agente.
        adb.actualizar(actualizado["id"], relato=motor.relato_largo(actualizado, adb.eventos(actualizado["id"])))
        motor.cerrar_si_completo(actualizado["id"])

    deuda = adb.deuda_abierta()
    registrar_ejecucion(JOB_ID)
    print(
        f"Resumen: {len(emitidas)} emitidas, {len(decisiones)} requieren decisión, "
        f"{len(bloqueadas)} bloqueadas. Deuda abierta: {deuda['abiertas']} por ${deuda['monto']:,.0f}."
    )
    if not _quiet():
        enviar_whatsapp_reporte(_mensaje(emitidas, decisiones, bloqueadas, deuda), jid_grupo_facturacion_ventas_wa())
    return 0


if __name__ == "__main__":
    sys.exit(main())
