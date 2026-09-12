#!/usr/bin/env python3
"""Regulariza carritos MeLi facturados a medias (una factura por un solo producto
de un pack de varios).

Origen del problema: hasta el 2026-09-09 el webhook `shipments` corría con el
código anterior al fix multi-orden, así que facturaba únicamente la orden que
MeLi reportaba en el envío. Un barrido de 12 días encontró 39 packs en ese
estado, con $1,5M sin facturar.

La regularización de cada caso es la misma que se hizo a mano para los packs
2000014920695311 y 2000014923702731: anular la factura parcial con nota crédito
y reemitir UNA consolidada con todos los productos del carrito.

POR DEFECTO NO EMITE NADA: imprime el plan (modo simulación). Emitir exige
`--ejecutar` y además `--si-estoy-seguro`, porque cada caso son dos documentos
electrónicos reales ante la DIAN.

    python3 scripts/regularizar_packs_parciales.py --dias 12
    python3 scripts/regularizar_packs_parciales.py --dias 12 --json plan.json

Exclusiones (un caso excluido NO se toca; se reporta para revisión humana):
  - El pack ya tiene factura en SIIGO / astroselling. Es la exclusión más
    importante: reemitir en Alegra encima de una factura de Siigo es
    exactamente el duplicado que generó 25 notas crédito el 2026-09-03. Se
    verifica por DOS vías, porque el índice local no basta: el pack de Fork
    Catering tenía factura A71352 en Siigo y no figuraba en el índice.
  - La factura parcial ya tiene nota crédito (alguien ya lo resolvió).
  - Falta algún SKU del carrito en Alegra (emitiría incompleto otra vez).
  - No se pudo leer alguna orden del carrito en MeLi.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(str(Path(__file__).resolve().parent.parent / ".env"))

from app.services.alegra import (  # noqa: E402
    _alegra_headers,
    buscar_producto_alegra_por_referencia,
    obtener_facturas_alegra_paginadas,
)
from app.services.conciliacion_meli import leer_indice_facturacion_meli  # noqa: E402
from app.services.facturacion_ventas_unificado import (  # noqa: E402
    FECHA_CORTE_MIGRACION_ALEGRA,
    _notas_credito_alegra_por_factura,
)
from app.services.meli import (  # noqa: E402
    consultar_billing_info_meli,
    consultar_orden_meli_completa,
    listar_ordenes_meli_por_estado,
    refrescar_token_meli,
)

TOLERANCIA = 0.97  # facturado >= 97% del carrito se considera completo

# Packs que NO se tocan aunque cumplan las condiciones. Cada uno con su porqué.
EXCLUIR_PACKS = {
    # Fork Catering: FE198 (Alegra) se emitió A PROPÓSITO el 2026-09-09 para
    # reemplazar A71352 (Siigo, dígito de verificación errado). Es un duplicado
    # deliberado hasta que el contador decida cómo cerrar A71352 (Siigo está en
    # solo lectura y no puede anular). Ver docs/agentic/modules/facturacion-meli-alegra.md.
    "2000018230210348",
}

# Cuántos días ANTES del rango de órdenes hay que mirar en Siigo. La autofactura
# de Alegra dispara al ENTREGAR y astroselling facturaba en Siigo al COMPRAR:
# una venta del 30-ago facturada en Siigo el 1-sep y en Alegra el 5-sep solo se
# detecta como duplicado si Siigo se consulta desde antes del corte de
# migración (2026-09-02). Con la ventana anclada al corte, ese caso se habría
# clasificado como "regularizable" y reemitido por tercera vez.
MARGEN_DIAS_SIIGO = 20


def _facturas_siigo_por_pack(fecha_desde: str) -> dict[str, list[dict]]:
    """Facturas vivas en Siigo indexadas por pack/orden MeLi.

    Siigo quedó en solo lectura tras la migración, pero sus facturas siguen
    siendo documentos DIAN válidos: si una venta ya se facturó allá, reemitirla
    en Alegra la duplica. El cruce es por el id de MeLi dentro de
    `observations` / `purchase_order`, igual que el Flujo F de CLAUDE.md.
    """
    from app.services.siigo import obtener_facturas_siigo_paginadas

    por_ref: dict[str, list[dict]] = {}
    try:
        facturas = obtener_facturas_siigo_paginadas(fecha_desde)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  No se pudo consultar Siigo ({e}). Se aborta: sin ese dato no es seguro reemitir.")
        raise SystemExit(2) from e

    for f in facturas:
        texto = f"{f.get('observations') or ''} {f.get('purchase_order') or ''}"
        for token in texto.replace("#", " ").replace("-", " ").split():
            if token.isdigit() and len(token) >= 12:
                por_ref.setdefault(token, []).append(f)
    return por_ref


def _ordenes_paid_por_ventanas(dias: int, ventana: int = 3) -> list[dict]:
    """Órdenes pagadas del rango, pedidas en ventanas cortas y deduplicadas.

    `listar_ordenes_meli_por_estado` corta la paginación EN SILENCIO cuando
    `/orders/search` falla o supera offset 10000: solo imprime el error y
    devuelve lo acumulado (ver su propio docstring). Como ordena por fecha
    descendente, lo que se pierde son las ventas más viejas del rango — y eso
    hace que el barrido varíe entre corridas: dos ejecuciones seguidas con los
    mismos 12 días dieron 45 y 3 casos. Pedir por ventanas de pocos días
    mantiene cada consulta pequeña y hace el resultado reproducible.
    """
    from datetime import datetime, timedelta

    vistas: dict[str, dict] = {}
    hoy = datetime.now()
    for desde_dias in range(0, dias, ventana):
        hasta_dias = min(desde_dias + ventana, dias)
        fecha_hasta = (hoy - timedelta(days=desde_dias)).strftime("%Y-%m-%d")
        for o in listar_ordenes_meli_por_estado("paid", dias_atras=hasta_dias, fecha_hasta=fecha_hasta):
            oid = str(o.get("id") or "")
            if oid:
                vistas[oid] = o
    return list(vistas.values())


def analizar(dias: int) -> dict:
    token = refrescar_token_meli()
    ordenes = _ordenes_paid_por_ventanas(dias)
    print(f"   órdenes pagadas leídas en {dias} días: {len(ordenes)}")
    facturas_alegra = obtener_facturas_alegra_paginadas(FECHA_CORTE_MIGRACION_ALEGRA)
    notas = _notas_credito_alegra_por_factura(_alegra_headers(), FECHA_CORTE_MIGRACION_ALEGRA)
    indice_legado = leer_indice_facturacion_meli().get("indice", {})
    from datetime import datetime, timedelta

    desde_siigo = (datetime.now() - timedelta(days=dias + MARGEN_DIAS_SIIGO)).strftime("%Y-%m-%d")
    desde_siigo = min(desde_siigo, FECHA_CORTE_MIGRACION_ALEGRA)
    siigo_por_ref = _facturas_siigo_por_pack(desde_siigo)
    print(f"   facturas Siigo consultadas desde {desde_siigo}")

    por_ref_alegra: dict[str, list[dict]] = {}
    for f in facturas_alegra:
        ref = (f.get("purchase_order") or f.get("anotation") or "").strip()
        if ref:
            por_ref_alegra.setdefault(ref, []).append(f)

    packs: dict[str, list[dict]] = {}
    for o in ordenes:
        packs.setdefault(str(o.get("pack_id") or o.get("id")), []).append(o)

    regularizables, duplicados, excluidos = [], [], []

    for pack_id, ords in packs.items():
        if len(ords) < 2:
            continue
        order_ids = [str(o.get("id")) for o in ords]
        claves = {pack_id, *order_ids}
        total_pack = sum(o.get("total_amount") or 0 for o in ords)

        vistas, facturas_vigentes, facturas_anuladas = set(), [], []
        for k in claves:
            for f in por_ref_alegra.get(k, []):
                fid = str(f.get("id"))
                if fid in vistas:
                    continue
                vistas.add(fid)
                (facturas_anuladas if notas.get(fid) else facturas_vigentes).append(f)

        total_facturado = sum(f.get("total") or 0 for f in facturas_vigentes)
        if total_facturado <= 0:
            continue  # sin facturar aún: no es un caso de este script
        if pack_id in EXCLUIR_PACKS:
            continue
        alegra_completa = total_facturado >= total_pack * TOLERANCIA

        caso = {
            "pack_id": pack_id,
            "order_ids": order_ids,
            "total_carrito": round(total_pack, 2),
            "total_facturado": round(total_facturado, 2),
            "falta": round(total_pack - total_facturado, 2),
            "facturas_a_anular": [
                {
                    "id": str(f.get("id")),
                    "numero": (f.get("numberTemplate") or {}).get("fullNumber"),
                    "total": f.get("total"),
                }
                for f in facturas_vigentes
            ],
        }

        # --- ¿Ya facturado en Siigo? ---
        # OJO: el índice legado también registra facturas de Alegra, así que una
        # entrada cuyo número/monto es la MISMA factura parcial que queremos
        # anular no es una factura de Siigo: es una autorreferencia. Sin este
        # filtro, 41 de 42 casos se excluían por un Siigo que no existía.
        # Incluye también las YA ANULADAS: un pack consolidado hoy (FE200) sigue
        # teniendo en el índice la parcial anulada (FE181) con integración
        # "mckenna" = Alegra, no Siigo. Sin esto se reportaba "Siigo parcial".
        todas_alegra = facturas_vigentes + facturas_anuladas
        numeros_alegra = {(f.get("numberTemplate") or {}).get("fullNumber") for f in todas_alegra}
        montos_alegra = {round(f.get("total") or 0) for f in todas_alegra}
        siigo_hits = []
        for k in claves:
            for f in siigo_por_ref.get(k, []):
                siigo_hits.append({
                    "numero": f.get("name") or f.get("number"),
                    "total": f.get("total"),
                    "fecha": f.get("date"),
                    "fuente": "siigo_api",
                })
            leg = indice_legado.get(k)
            if not leg:
                continue
            num_leg = str(leg.get("factura_numero") or "")
            # El índice "legado" se construye con facturas híbridas (Siigo + Alegra).
            # Una entrada es de Alegra si el número es "FE…" o si no trae número y
            # su id es un entero corto (ids Alegra: 90; ids Siigo: UUID). OJO:
            # integracion="mckenna" NO distingue — también marca facturas Siigo
            # reales de la integración propia pre-astroselling (ej. FV-2-71294).
            es_alegra_leg = num_leg.upper().startswith("FE") or (
                not num_leg and str(leg.get("factura_id") or "").isdigit()
            )
            if es_alegra_leg:
                continue
            if num_leg in numeros_alegra or round(leg.get("total") or 0) in montos_alegra:
                continue  # autorreferencia a la propia factura Alegra
            siigo_hits.append({
                "numero": num_leg,
                "total": leg.get("total"),
                "fecha": leg.get("factura_fecha"),
                "fuente": f"indice_legado/{leg.get('integracion')}",
            })

        if siigo_hits:
            total_siigo = max((s.get("total") or 0) for s in siigo_hits)
            caso["siigo"] = siigo_hits
            if total_siigo >= total_pack * TOLERANCIA:
                # Siigo ya cubre el carrito COMPLETO. La de Alegra sobra, sea
                # parcial o completa: la venta está facturada dos veces. Acción
                # correcta = anular la de Alegra y NO reemitir nada (reemitir
                # sería una tercera factura por la misma venta). Siigo fue
                # primero (facturaba al comprar) y es un documento DIAN válido.
                caso["accion"] = "solo_anular_alegra"
                caso["subtipo"] = "duplicado_completo" if alegra_completa else "duplicado_parcial"
                caso["motivo"] = (
                    f"Ya facturada COMPLETA en Siigo ({siigo_hits[0]['numero']} "
                    f"${total_siigo:,.0f}). La de Alegra es un duplicado "
                    f"{'completo' if alegra_completa else 'parcial'}."
                )
                duplicados.append(caso)
            else:
                caso["motivo_exclusion"] = (
                    f"Tiene factura en Siigo por ${total_siigo:,.0f} que NO cubre el carrito "
                    f"(${total_pack:,.0f}) — decisión del contador."
                )
                excluidos.append(caso)
            continue

        if alegra_completa:
            continue  # facturada completa en Alegra y sin Siigo: está bien

        if facturas_anuladas and not facturas_vigentes:
            caso["motivo_exclusion"] = "Las facturas del pack ya están anuladas"
            excluidos.append(caso)
            continue

        # --- Líneas del carrito completo + verificación de SKU en Alegra ---
        lineas, faltan_sku, sin_leer = [], [], []
        for oid in order_ids:
            orden = consultar_orden_meli_completa(oid, token=token)
            if not orden:
                sin_leer.append(oid)
                continue
            for it in orden.get("order_items") or []:
                info = it.get("item") or {}
                sku = (info.get("seller_custom_field") or info.get("seller_sku") or "").strip()
                if not sku:
                    faltan_sku.append(f"{info.get('title')} (sin SKU en MeLi)")
                    continue
                if not buscar_producto_alegra_por_referencia(sku):
                    faltan_sku.append(f"{sku} (no existe en Alegra)")
                    continue
                lineas.append({
                    "codigo": sku,
                    "nombre": info.get("title") or "Producto",
                    "cantidad": float(it.get("quantity") or 1),
                    "precio_unitario": float(it.get("unit_price") or 0),
                })
        if sin_leer:
            caso["motivo_exclusion"] = f"No se pudieron leer las órdenes {', '.join(sin_leer)} en MeLi"
            excluidos.append(caso)
            continue
        if faltan_sku:
            caso["motivo_exclusion"] = "Faltan productos en Alegra: " + "; ".join(faltan_sku)
            excluidos.append(caso)
            continue

        billing = consultar_billing_info_meli(order_ids[0], token=token)
        extra = {i.get("type"): (i.get("value") or "").strip() for i in (billing or {}).get("additional_info") or []}
        nombre = extra.get("BUSINESS_NAME") or " ".join(
            x for x in (extra.get("FIRST_NAME"), extra.get("LAST_NAME")) if x
        )
        caso["comprador"] = {
            "nombre": nombre or "Consumidor Final",
            "identificacion": (billing or {}).get("doc_number") or "",
            "tipo_documento": (billing or {}).get("doc_type") or "",
            "datos_reales": bool(nombre and (billing or {}).get("doc_number")),
        }
        caso["lineas"] = lineas
        caso["total_a_facturar"] = round(sum(l["cantidad"] * l["precio_unitario"] for l in lineas), 2)
        regularizables.append(caso)

    return {"regularizables": regularizables, "duplicados": duplicados, "excluidos": excluidos}


def imprimir(plan: dict) -> None:
    reg, dup, exc = plan["regularizables"], plan["duplicados"], plan["excluidos"]
    print("=" * 78)
    print("PLAN DE REGULARIZACIÓN — MODO SIMULACIÓN (no se emitió ningún documento)")
    print("=" * 78)
    print(f"\nA) Anular + reemitir consolidada: {len(reg)}")
    print(f"B) SOLO anular la de Alegra (ya facturada completa en Siigo): {len(dup)}")
    print(f"C) Revisión humana: {len(exc)}\n")

    if dup:
        print("-" * 78)
        print("B) DUPLICADOS — Siigo ya facturó el carrito completo; la de Alegra sobra.")
        print("   NO se reemite nada: eso sería una tercera factura por la misma venta.")
        total_dup = 0.0
        for c in sorted(dup, key=lambda x: x["total_facturado"], reverse=True):
            nums = ", ".join(f["numero"] or f["id"] for f in c["facturas_a_anular"])
            s = c["siigo"][0]
            print(f"  · [{c.get('subtipo', 'duplicado')}] Pack {c['pack_id']}: anular {nums} (${c['total_facturado']:,.0f}) — "
                  f"Siigo {s['numero']} ${(s.get('total') or 0):,.0f} del {s.get('fecha') or '?'} cubre el carrito "
                  f"(${c['total_carrito']:,.0f})")
            total_dup += c["total_facturado"]
        print(f"    TOTAL a anular en Alegra: ${total_dup:,.0f}\n")
        print("-" * 78)
        print("A) FACTURACIÓN PARCIAL REAL — anular la parcial y reemitir el carrito completo\n")

    total_nc = total_nuevo = 0.0
    for c in sorted(reg, key=lambda x: x["falta"], reverse=True):
        nums = ", ".join(f["numero"] or f["id"] for f in c["facturas_a_anular"])
        comp = c["comprador"]
        print(f"■ Pack {c['pack_id']}  ({len(c['order_ids'])} órdenes, {len(c['lineas'])} productos)")
        print(f"    Carrito ${c['total_carrito']:,.0f} · facturado ${c['total_facturado']:,.0f} · falta ${c['falta']:,.0f}")
        print(f"    1) ANULAR con nota crédito: {nums} (${c['total_facturado']:,.0f})")
        print(f"    2) EMITIR consolidada por ${c['total_a_facturar']:,.0f} a {comp['nombre']} "
              f"({comp['tipo_documento']} {comp['identificacion'] or 's/d'})"
              f"{'' if comp['datos_reales'] else '  ⚠️ sin datos fiscales reales del comprador'}")
        total_nc += c["total_facturado"]
        total_nuevo += c["total_a_facturar"]
    if reg:
        print(f"\n  TOTALES: {len(reg)} notas crédito por ${total_nc:,.0f}  →  "
              f"{len(reg)} facturas nuevas por ${total_nuevo:,.0f}")

    if exc:
        print("\n" + "-" * 78)
        print("EXCLUIDOS — requieren decisión humana, el script no los tocaría:")
        for c in exc:
            print(f"  · Pack {c['pack_id']} (falta ${c['falta']:,.0f}): {c['motivo_exclusion']}")
            for s in c.get("siigo", []):
                print(f"        Siigo: {s['numero']} ${(s.get('total') or 0):,.0f} [{s['fuente']}]")
    print()


LOG_PATH = Path(__file__).resolve().parent.parent / "app" / "data" / "regularizacion_packs_log.jsonl"


def _packs_ya_procesados() -> set[str]:
    """Packs que una corrida anterior ya resolvió. Sin esto, repetir el comando
    volvería a emitir todo: cada caso son documentos DIAN reales."""
    if not LOG_PATH.exists():
        return set()
    hechos = set()
    for linea in LOG_PATH.read_text(encoding="utf-8").splitlines():
        try:
            d = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if d.get("ok"):
            hechos.add(str(d.get("pack_id")))
    return hechos


def _registrar_log(entrada: dict) -> None:
    from datetime import datetime

    entrada["ts"] = datetime.now().isoformat(timespec="seconds")
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entrada, ensure_ascii=False, default=str) + "\n")


_ALEGRA_SNAPSHOT: dict = {"ts": 0.0, "facturas": [], "notas": {}}
_ALEGRA_SNAPSHOT_TTL = 180  # segundos


def _facturas_y_notas_alegra_recientes() -> tuple[list, dict]:
    """Listado completo de Alegra, reutilizado hasta 3 minutos entre casos.

    Bajar todas las facturas + NC cuesta ~100 s; hacerlo por CADA caso ponía el
    lote de 13 en ~25 min y el de 26 en más de una hora. Una foto de hasta 3
    minutos sigue cumpliendo el propósito de la re-verificación (detectar que
    alguien resolvió el caso a mano en paralelo), y este script es el único
    que emite en lote.
    """
    import time as _t

    if _t.time() - _ALEGRA_SNAPSHOT["ts"] > _ALEGRA_SNAPSHOT_TTL:
        _ALEGRA_SNAPSHOT["facturas"] = obtener_facturas_alegra_paginadas(FECHA_CORTE_MIGRACION_ALEGRA)
        _ALEGRA_SNAPSHOT["notas"] = _notas_credito_alegra_por_factura(_alegra_headers(), FECHA_CORTE_MIGRACION_ALEGRA)
        _ALEGRA_SNAPSHOT["ts"] = _t.time()
    return _ALEGRA_SNAPSHOT["facturas"], _ALEGRA_SNAPSHOT["notas"]


def _estado_actual_del_pack(caso: dict) -> tuple[float, list[dict]]:
    """Relee las facturas vigentes del pack en Alegra (foto de ≤3 min).

    El plan pudo calcularse hace rato y contabilidad puede haber resuelto el
    caso a mano en paralelo — exactamente lo que produjo 4 notas crédito
    duplicadas el 10-ago-2026 por no rechequear justo antes del POST.
    """
    facturas, notas = _facturas_y_notas_alegra_recientes()
    claves = {caso["pack_id"], *caso["order_ids"]}
    vigentes, vistas = [], set()
    for f in facturas:
        ref = (f.get("purchase_order") or f.get("anotation") or "").strip()
        fid = str(f.get("id"))
        if ref not in claves or fid in vistas or notas.get(fid):
            continue
        vistas.add(fid)
        vigentes.append(f)

    # Si una factura del plan no aparece en la foto, NO concluir que fue anulada:
    # la paginación de Alegra se corta en silencio (timeouts) y en el lote A del
    # 2026-09-09 eso hizo saltar 15 casos válidos como "ya no vigente". Se
    # confirma factura por factura con GET directo + búsqueda de NC.
    import requests
    from app.services.alegra import _ALEGRA_BASE, buscar_nota_credito_existente_alegra

    for f in caso["facturas_a_anular"]:
        if f["id"] in vistas:
            continue
        try:
            d = requests.get(f"{_ALEGRA_BASE}/invoices/{f['id']}", headers=_alegra_headers(), timeout=25).json()
        except Exception:  # noqa: BLE001
            continue
        if not d.get("id") or d.get("status") == "void":
            continue
        if buscar_nota_credito_existente_alegra(str(f["id"])):
            continue  # sí tiene NC: realmente ya no está vigente
        d.setdefault("purchase_order", d.get("anotation"))
        vistas.add(str(d["id"]))
        vigentes.append(d)
    return sum(f.get("total") or 0 for f in vigentes), vigentes


def _items_inactivos_de_factura(factura_id: str) -> list[dict]:
    import requests
    from app.services.alegra import _ALEGRA_BASE

    h = _alegra_headers()
    inv = requests.get(f"{_ALEGRA_BASE}/invoices/{factura_id}", headers=h, timeout=25).json()
    out = []
    for it in inv.get("items") or []:
        meta = requests.get(f"{_ALEGRA_BASE}/items/{it.get('id')}", headers=h, timeout=20).json()
        if (meta.get("status") or "active").strip().lower() != "active":
            out.append({"id": str(it.get("id")), "reference": meta.get("reference")})
    return out


def _set_estado_item(item_id: str, activo: bool) -> bool:
    import requests
    from app.services.alegra import _ALEGRA_BASE

    r = requests.put(
        f"{_ALEGRA_BASE}/items/{item_id}", headers=_alegra_headers(),
        json={"status": "active" if activo else "inactive"}, timeout=25,
    )
    return r.status_code == 200


def _anular(factura_id: str, numero: str, motivo: str) -> dict:
    """Nota crédito de anulación. Si Alegra la rechaza porque la factura tiene
    ítems inactivos (error 9053 — pasa con los `-LEGACY` y con ítems que se
    inactivaron al recrear el catálogo después de facturar), reactiva SOLO esos
    ítems, reintenta, y los vuelve a inactivar. Es la "opción 1" acordada el
    2026-09-09: reversible y no altera precios ni el catálogo visible."""
    from app.services.alegra import crear_nota_credito_alegra

    r = crear_nota_credito_alegra(factura_id=str(factura_id), motivo=motivo[:500], enviar_dian=True)
    if r.get("ok") or "9053" not in str(r.get("error") or ""):
        return r

    inactivos = _items_inactivos_de_factura(factura_id)
    if not inactivos:
        return r
    print(f"    ↻ {numero}: reactivando temporalmente {', '.join(i['reference'] or i['id'] for i in inactivos)}")
    reactivados = [i for i in inactivos if _set_estado_item(i["id"], True)]
    try:
        r = crear_nota_credito_alegra(factura_id=str(factura_id), motivo=motivo[:500], enviar_dian=True)
    finally:
        for i in reactivados:
            if not _set_estado_item(i["id"], False):
                print(f"    ⚠️ no se pudo volver a inactivar el ítem {i['reference'] or i['id']} — revisar en Alegra")
    return r


def ejecutar(plan: dict, limite: int) -> None:
    import base64
    import time

    from app.services.alegra import crear_factura_venta_alegra
    from app.services.meli import eliminar_documentos_fiscales_meli, subir_factura_meli
    from app.tools.meli_autofactura_entrega import _registrar_estado_orden

    hechos = _packs_ya_procesados()
    pendientes = [
        ("duplicado", c) for c in plan["duplicados"] if c["pack_id"] not in hechos
    ] + [
        ("regularizar", c) for c in plan["regularizables"] if c["pack_id"] not in hechos
    ]
    pendientes = pendientes[:limite]
    if not pendientes:
        print("No hay casos pendientes (¿ya se procesaron todos? ver el log).")
        return

    print(f"Se procesarán {len(pendientes)} caso(s). Log: {LOG_PATH}\n")
    for i, (tipo, caso) in enumerate(pendientes, 1):
        pack = caso["pack_id"]
        print(f"[{i}/{len(pendientes)}] Pack {pack} ({tipo})")

        total_ahora, vigentes_ahora = _estado_actual_del_pack(caso)
        ids_plan = {f["id"] for f in caso["facturas_a_anular"]}
        ids_ahora = {str(f.get("id")) for f in vigentes_ahora}
        if ids_plan - ids_ahora:
            print("    ⏭️  La factura del plan ya no está vigente (¿anulada por alguien más?). Se omite.")
            _registrar_log({"pack_id": pack, "tipo": tipo, "ok": False, "motivo": "factura ya no vigente"})
            continue
        if tipo == "regularizar" and total_ahora >= caso["total_carrito"] * TOLERANCIA:
            print("    ⏭️  El pack ya quedó facturado completo por otra vía. Se omite.")
            _registrar_log({"pack_id": pack, "tipo": tipo, "ok": False, "motivo": "ya facturado completo"})
            continue

        nueva = None
        if tipo == "regularizar":
            # Emitir ANTES de anular: si algo falla después, la venta queda con
            # factura (recuperable). Al revés quedaría sin ninguna.
            comp = caso["comprador"]
            nueva = crear_factura_venta_alegra(
                nombre_cliente=comp["nombre"],
                identificacion=comp["identificacion"],
                tipo_documento=comp["tipo_documento"],
                direccion_envio="",
                productos=caso["lineas"],
                total=caso["total_a_facturar"],
                observaciones=(
                    f"Venta MercadoLibre - Pack {pack} (carrito de {len(caso['order_ids'])} ordenes). "
                    f"Consolidada que reemplaza la facturacion parcial "
                    f"{', '.join(f['numero'] or '' for f in caso['facturas_a_anular'])}."
                ),
                purchase_order=pack,
                descargar_pdf=True,
                enviar_dian=True,
                enviar_correo=False,
            )
            if not nueva.get("ok"):
                print(f"    ❌ No se pudo emitir la consolidada: {nueva.get('error')}. No se anula nada.")
                _registrar_log({"pack_id": pack, "tipo": tipo, "ok": False, "motivo": nueva.get("error")})
                continue
            print(f"    ✅ Consolidada {nueva.get('number')} por ${caso['total_a_facturar']:,.0f}")

        anuladas, fallos_anulacion = [], []
        for f in caso["facturas_a_anular"]:
            motivo = (
                f"Anulacion por facturacion parcial: {f['numero']} cubria solo "
                f"${(f['total'] or 0):,.0f} de un carrito de ${caso['total_carrito']:,.0f} "
                f"(pack MercadoLibre {pack}). "
                + (f"Se reemite consolidada en {nueva.get('number')}." if nueva
                   else f"La venta ya esta facturada completa en Siigo {caso['siigo'][0]['numero']}.")
            )
            r = _anular(f["id"], f["numero"], motivo)
            if r.get("ok"):
                anuladas.append(r.get("numero"))
                print(f"    ✅ {f['numero']} anulada con {r.get('numero')}")
            else:
                fallos_anulacion.append(f"{f['numero']}: {r.get('error')}")
                print(f"    ⚠️ No se pudo anular {f['numero']}: {r.get('error')}")

        if nueva:
            pdf_ok = False
            if nueva.get("pdf_base64"):
                eliminar_documentos_fiscales_meli(pack)
                pdf_ok = subir_factura_meli(pack, nueva["pdf_base64"], formato="pdf", prefijo_archivo="Fac") == "✅"
            print(f"    {'✅' if pdf_ok else '⚠️'} PDF en MeLi: {'reemplazado' if pdf_ok else 'NO se pudo subir'}")
            for j, oid in enumerate(caso["order_ids"]):
                _registrar_estado_orden(
                    oid, estado="facturada", proveedor="alegra", pack_id=pack,
                    siigo_invoice_id=nueva.get("invoice_id"), siigo_invoice_number=nueva.get("number"),
                    siigo_invoice_status=nueva.get("status"), siigo_invoice_cufe=nueva.get("cufe") or None,
                    pdf_subido_meli=pdf_ok and j == 0,
                    nota="Regularizacion de facturacion parcial (script).",
                )

        # `ok` SOLO si el caso quedó realmente resuelto: si alguna anulación
        # falló, el pack debe poder reintentarse. Marcarlo ok con `anuladas: []`
        # lo daba por hecho para siempre sin haber tocado nada — el mismo tipo
        # de fallo silencioso que dejó 44 casos sin trabajar 6 semanas.
        resuelto = not fallos_anulacion and bool(anuladas)
        _registrar_log({
            "pack_id": pack, "tipo": tipo, "ok": resuelto,
            "anuladas": anuladas, "nueva": nueva.get("number") if nueva else None,
            "fallos": fallos_anulacion,
            "total_carrito": caso["total_carrito"],
        })
        if not resuelto:
            print("    ❗ Caso NO resuelto — queda pendiente para reintentar.")
            if nueva:
                print(f"       OJO: la consolidada {nueva.get('number')} SÍ se emitió; "
                      f"la parcial sigue viva. Hay que anularla a mano antes de reintentar.")
        time.sleep(2)  # respiro entre casos: cada uno son 1-2 documentos DIAN

    print("\nListo. Revisa el log y el panel antes de correr otro lote.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, default=12, help="Días hacia atrás a revisar (default 12)")
    ap.add_argument("--json", help="Guarda el plan completo en este archivo")
    ap.add_argument("--ejecutar", action="store_true", help="Emitir de verdad (requiere --si-estoy-seguro)")
    ap.add_argument("--limite", type=int, default=1, help="Máx. casos por corrida (default 1: lotes pequeños)")
    ap.add_argument("--si-estoy-seguro", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.ejecutar and not args.si_estoy_seguro:
        print("❌ --ejecutar exige también --si-estoy-seguro: son documentos DIAN reales.")
        raise SystemExit(1)

    plan = analizar(args.dias)
    imprimir(plan)
    if args.json:
        Path(args.json).write_text(json.dumps(plan, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(f"Plan guardado en {args.json}")

    if args.ejecutar:
        print(f"\n⚠️  EMISIÓN REAL — lote de máximo {args.limite} caso(s).\n")
        ejecutar(plan, args.limite)
    else:
        print("(Simulación: no se emitió nada. Para ejecutar: "
              "--ejecutar --si-estoy-seguro --limite N)")


if __name__ == "__main__":
    main()
