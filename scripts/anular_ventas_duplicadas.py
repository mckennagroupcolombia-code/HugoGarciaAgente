#!/usr/bin/env python3
"""Anula los asientos de venta que se contaron dos veces.

El libro toma ingresos de tres fuentes que se solapan: las órdenes de MeLi
(`meli_venta`), los pedidos de la tienda (`web_venta`) y las **facturas**
(`siigo_venta`) — que son las facturas de esas mismas órdenes. Una venta de MeLi
facturada entraba por dos caminos y se contaba dos veces, inflando a la vez el
ingreso y el saldo de Bancos.

`contabilidad_ledger.factura_ya_contada()` corrige el flujo hacia adelante. Este
script limpia lo que ya quedó asentado.

**Cómo se decide qué es duplicado, sin adivinar:** cada asiento guarda en
`plantilla_datos_json` el id de la factura que lo originó. Se consulta esa
factura en Siigo y se mira su `observations`: si dice «Venta Mercado Libre
#<orden>», la venta ya está en el libro por su propio canal. Una factura sin esa
marca es venta directa y **no se toca** — perderla sería el error contrario, y
peor, porque nadie la echaría de menos.

Los asientos se **anulan**, no se borran: un asiento que existió es historia del
libro, y anular deja la huella de cuándo y por qué.

Uso:
    python3 scripts/anular_ventas_duplicadas.py              # simula
    python3 scripts/anular_ventas_duplicadas.py --confirmar
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DESDE_SIIGO = "2026-08-01"   # margen holgado hacia atrás para cubrir el histórico


def _fmt(n) -> str:
    return f"${float(n or 0):,.0f}".replace(",", ".")


def analizar() -> tuple[list[dict], list[dict]]:
    import app.services.contabilidad_core as cc
    from app.services.contabilidad_ledger import factura_ya_contada
    from app.services.siigo import obtener_facturas_siigo_paginadas

    facturas = obtener_facturas_siigo_paginadas(DESDE_SIIGO) or []
    por_id = {str(f.get("id")): f for f in facturas}
    print(f"Facturas consultadas en Siigo desde {DESDE_SIIGO}: {len(facturas)}")

    cc._ensure()
    duplicados, conservados = [], []
    with cc._conn() as con:
        filas = con.execute(
            """SELECT m.id, m.fecha, m.plantilla_datos_json, SUM(l.credito) AS valor
                 FROM cc_movimiento_lineas l
                 JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
                 JOIN cc_plan_cuentas p ON p.id = l.cuenta_id
                WHERE p.codigo = '4135' AND m.tipo_origen = 'auto_siigo_venta'
                GROUP BY m.id ORDER BY m.fecha""",
        ).fetchall()
    for r in filas:
        datos = json.loads(r["plantilla_datos_json"] or "{}")
        factura = por_id.get(str(datos.get("referencia") or ""))
        registro = {"id": r["id"], "fecha": r["fecha"], "valor": round(float(r["valor"] or 0), 2),
                    "factura": str(datos.get("referencia") or "")}
        if factura is None:
            # No se pudo verificar: se conserva. Anular sin prueba sería peor.
            registro["motivo"] = "no se encontró la factura en Siigo — se conserva por precaución"
            conservados.append(registro)
        elif factura_ya_contada(factura):
            registro["motivo"] = str(factura.get("observations") or "")[:70]
            duplicados.append(registro)
        else:
            registro["motivo"] = "venta directa: la factura es su única fuente"
            conservados.append(registro)
    return duplicados, conservados


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmar", action="store_true", help="anula los duplicados")
    args = ap.parse_args()

    import app.services.contabilidad_core as cc

    duplicados, conservados = analizar()
    total_dup = sum(d["valor"] for d in duplicados)
    print(f"\nDUPLICADOS (ya contados como Venta MeLi): {len(duplicados)} asientos · {_fmt(total_dup)}")
    for d in duplicados[:5]:
        print(f"   #{d['id']:<6} {d['fecha']}  {_fmt(d['valor']):>12}  {d['motivo'][:56]}")
    if len(duplicados) > 5:
        print(f"   … y {len(duplicados) - 5} más")
    print(f"\nSE CONSERVAN: {len(conservados)} asientos · {_fmt(sum(c['valor'] for c in conservados))}")
    for c_ in conservados[:4]:
        print(f"   #{c_['id']:<6} {c_['fecha']}  {_fmt(c_['valor']):>12}  {c_['motivo'][:56]}")

    antes = cc.balance_comprobacion()
    if not args.confirmar:
        print("\n(simulación — nada se escribió. Agrega --confirmar para anularlos)")
        return
    if not duplicados:
        return

    for d in duplicados:
        cc.anular_movimiento(d["id"])
    despues = cc.balance_comprobacion()
    print(f"\n{len(duplicados)} asientos anulados por {_fmt(total_dup)}.")
    print(f"Balance: cuadraba={antes['cuadra']} → cuadra={despues['cuadra']}")
    print("Baja el ingreso y también Bancos: el duplicado inflaba las dos, "
          "porque el asiento era débito a Bancos contra Ingresos.")


if __name__ == "__main__":
    main()
