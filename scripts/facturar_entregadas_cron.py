#!/usr/bin/env python3
"""
Cron: factura electrónicamente las ventas MeLi ENTREGADAS hace más de 48 h que
siguen sin factura (política «facturar al entregar», flujo H de CLAUDE.md).

Por qué un cron y no el webhook: `MELI_AUTOFACTURA_ENTREGA_ACTIVO` (factura en
el instante en que MeLi avisa `delivered`) está apagado desde el 9-sep-2026
por los packs a medias y los dobles. Desde entonces se facturaba solo con el
botón «Facturar ahora» y las ventas se quedaban colgadas si nadie lo oprimía.
Este cron hace lo mismo que el botón, venta por venta y con TODAS sus barreras:
- candado por venta + verificación directa en Alegra antes de emitir
  (`facturar_pack_meli_manual`);
- no factura si una orden del carrito está cancelada o MeLi devolvió plata
  (`_venta_no_cuadra`), ni si MeLi ya tiene documento fiscal, ni si falta un SKU;
- el estado de cada venta sale de `consultar_venta_individual` con la base
  COMPLETA de Alegra (descarga estricta): solo se emite si el estado es
  `sin_facturar` = entregada hace más del margen (48 h) y sin factura vigente.

Uso:
  python3 scripts/facturar_entregadas_cron.py            # corrida normal
  python3 scripts/facturar_entregadas_cron.py --simular  # lista lo que facturaría, no emite nada

Variables:
  FACTURACION_ENTREGADAS_CRON_ACTIVO=0   — apaga el cron sin tocar el crontab (default 1)
  FACTURACION_ENTREGADAS_DIAS            — ventana de ventas a revisar (default 30)
  FACTURACION_ENTREGADAS_MAX             — tope de facturas por corrida (default 20)
  FACTURACION_ENTREGADAS_QUIET=1         — no envía WhatsApp (pruebas)
El margen de 48 h es el mismo del panel (NOTAS_CREDITO_MARGEN_HORAS, default 48).
Sin LLM.
"""

from __future__ import annotations

import json
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

JOB_ID = "facturar_entregadas_48h"
ESTADO_PATH = REPO / "app" / "data" / "facturar_entregadas_cron.json"


def _env_int(nombre: str, default: int) -> int:
    try:
        return int(os.getenv(nombre, str(default)) or default)
    except ValueError:
        return default


def _leer_estado() -> dict:
    try:
        data = json.loads(ESTADO_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("avisadas", {})
            return data
    except Exception:
        pass
    return {"avisadas": {}}


def _guardar_estado(data: dict) -> None:
    tmp = ESTADO_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, ESTADO_PATH)


def _ordenes_pagadas_por_ventanas(dias: int) -> list[dict]:
    """`/orders/search` corta la paginación en silencio con rangos largos: se
    pide por ventanas de 3 días (misma lección que regularizar_packs_parciales)."""
    from app.services.meli import listar_ordenes_meli_por_estado

    vistas: dict[str, dict] = {}
    hoy = datetime.now().date()
    fin = 0
    while fin < dias:
        inicio = min(fin + 3, dias)
        hasta = (hoy - timedelta(days=fin)).strftime("%Y-%m-%d")
        for o in listar_ordenes_meli_por_estado("paid", dias_atras=inicio, fecha_hasta=hasta):
            if o.get("id"):
                vistas[str(o["id"])] = o
        fin = inicio
    return list(vistas.values())


def main() -> int:
    simular = "--simular" in sys.argv
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not simular:
        if (os.getenv("FACTURACION_ENTREGADAS_CRON_ACTIVO", "1") or "1").strip() != "1":
            print("⏸️  FACTURACION_ENTREGADAS_CRON_ACTIVO=0 — no se hace nada.")
            return 0
        if not debe_ejecutar(JOB_ID):
            print("⏭  Facturar entregadas: aún no toca según la frecuencia configurada.")
            return 0

    from app.services import facturacion_ventas_unificado as fv
    from app.tools.meli_autofactura_entrega import facturar_pack_meli_manual
    from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

    dias = _env_int("FACTURACION_ENTREGADAS_DIAS", 30)
    tope = _env_int("FACTURACION_ENTREGADAS_MAX", 20)
    quiet = simular or (os.getenv("FACTURACION_ENTREGADAS_QUIET", "0") or "0").strip() == "1"
    print(f"🧾 [{datetime.now():%Y-%m-%d %H:%M}] Facturar entregadas +48h (últimos {dias} días, tope {tope})"
          + (" — SIMULACIÓN" if simular else ""))

    # Base COMPLETA de Alegra; si no se puede bajar entera, no se factura nada
    # (con una lista parcial, una venta ya facturada parecería pendiente).
    try:
        fv.invalidar_caches()
        facturas, notas = fv._facturas_alegra_cacheadas(
            fv._alegra_headers(), fv.FECHA_CORTE_MIGRACION_ALEGRA, forzar=True,
        )
    except Exception as e:  # noqa: BLE001
        print(f"🔴 No se pudo descargar completa la base de Alegra, se aborta: {e}")
        return 1

    vigentes_por_ref: set[str] = set()
    for f in facturas:
        if notas.get(str(f.get("id"))):
            continue
        ref = (f.get("purchase_order") or f.get("anotation") or "").strip()
        if ref:
            vigentes_por_ref.add(ref)

    ordenes = _ordenes_pagadas_por_ventanas(dias)
    packs: dict[str, list[str]] = {}
    for o in ordenes:
        pid = str(o.get("pack_id") or o.get("id"))
        packs.setdefault(pid, []).append(str(o["id"]))
    candidatos = [
        (pid, oids) for pid, oids in packs.items()
        if not ({pid, *oids} & vigentes_por_ref)
    ]
    print(f"   {len(ordenes)} órdenes pagadas, {len(packs)} ventas, {len(candidatos)} sin factura vigente en Alegra.")

    # Filtro barato (1 llamada por venta, en paralelo): solo las entregadas hace
    # más del margen pasan a la consulta completa, que cuesta ~10 llamadas.
    from concurrent.futures import ThreadPoolExecutor

    from app.services.conciliacion_meli import _margen_horas_default
    from app.services.meli import consultar_envio_meli
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    margen = _margen_horas_default()
    orden_por_id = {str(o["id"]): o for o in ordenes}

    def _entregada_vencida(item: tuple[str, list[str]]) -> bool:
        envio_id = (orden_por_id[item[1][0]].get("shipping") or {}).get("id")
        if not envio_id:
            return False
        envio = consultar_envio_meli(str(envio_id), token=token) or {}
        if envio.get("status") != "delivered":
            return False
        fe_txt = fv._fecha_entrega_envio(envio)
        if not fe_txt:
            return False
        try:
            fe = datetime.fromisoformat(str(fe_txt).replace("Z", "+00:00"))
        except ValueError:
            return False
        return (datetime.now(fe.tzinfo) - fe) >= timedelta(hours=margen)

    with ThreadPoolExecutor(max_workers=6) as pool:
        marcas = list(pool.map(_entregada_vencida, candidatos))
    candidatos = [c for c, ok in zip(candidatos, marcas) if ok]
    print(f"   {len(candidatos)} entregadas hace más de {margen:.0f} h.")

    estado = _leer_estado()
    emitidas: list[dict] = []
    bloqueadas_nuevas: list[dict] = []
    errores: list[dict] = []
    facturables: list[dict] = []

    for pid, oids in candidatos:
        if len(emitidas) >= tope:
            print(f"   Tope de {tope} facturas por corrida alcanzado; el resto queda para la siguiente.")
            break
        try:
            venta = fv.consultar_venta_individual(oids[0])
        except Exception as e:  # noqa: BLE001
            errores.append({"pack": pid, "error": f"no se pudo consultar: {e}"})
            continue
        if not venta or venta.get("estado_facturacion") != "sin_facturar":
            continue  # en tránsito, en margen de 48 h, ya facturada, cancelada…
        facturables.append({"pack": pid, "total": venta.get("total"), "fecha": venta.get("fecha")})
        if simular:
            print(f"   🧪 Facturaría pack {pid} — ${float(venta.get('total') or 0):,.0f} (venta {str(venta.get('fecha'))[:10]})")
            continue
        res = facturar_pack_meli_manual(str(venta.get("order_id") or oids[0]))
        if res.get("ok"):
            numero = res.get("factura_numero") or res.get("numero") or res.get("name") or ""
            emitidas.append({"pack": pid, "numero": numero, "total": venta.get("total")})
            estado["avisadas"].pop(pid, None)
            print(f"   ✅ pack {pid} facturado {numero}")
            try:
                fv.consultar_venta_individual(oids[0])  # refresca la fila del panel
            except Exception:  # noqa: BLE001
                pass
        elif res.get("ya_facturada") or res.get("en_curso"):
            print(f"   ⏭  pack {pid}: {res.get('error')}")
        else:
            motivo = str(res.get("error") or "error desconocido")
            print(f"   ⛔ pack {pid}: {motivo}")
            if estado["avisadas"].get(pid) != motivo[:200]:
                estado["avisadas"][pid] = motivo[:200]
                bloqueadas_nuevas.append({"pack": pid, "motivo": motivo})

    if simular:
        print(f"Simulación: {len(facturables)} venta(s) se facturarían.")
        return 0

    _guardar_estado(estado)
    registrar_ejecucion(JOB_ID)
    print(f"Resumen: {len(emitidas)} emitidas, {len(bloqueadas_nuevas)} bloqueadas nuevas, {len(errores)} errores.")

    if (emitidas or bloqueadas_nuevas or errores) and not quiet:
        lineas = ["🧾 *Facturación automática MeLi (entregadas +48 h)*", ""]
        if emitidas:
            total = sum(float(e.get("total") or 0) for e in emitidas)
            lineas.append(f"✅ {len(emitidas)} factura(s) emitida(s) — ${total:,.0f}")
            lineas += [f"• {e['numero']} — pack {e['pack']}" for e in emitidas[:20]]
            lineas.append("")
        if bloqueadas_nuevas:
            lineas.append(f"⛔ {len(bloqueadas_nuevas)} venta(s) sin facturar por un bloqueo (revisar en Facturación → Ventas):")
            lineas += [f"• {b['pack']}: {b['motivo'][:160]}" for b in bloqueadas_nuevas[:15]]
            lineas.append("")
        if errores:
            lineas.append(f"🔴 {len(errores)} error(es) consultando ventas.")
        enviar_whatsapp_reporte("\n".join(lineas), jid_grupo_facturacion_ventas_wa())
    return 0 if not errores else 1


if __name__ == "__main__":
    sys.exit(main())
