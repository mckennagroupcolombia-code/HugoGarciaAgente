#!/usr/bin/env python3
"""Corrige los pagos de prestación de servicios de septiembre 2026.

**Qué estaba mal.** A Víctor, Stella y Jenniffer se les practicó retención en la
fuente de renta del 4% por «servicios», y el contador aclaró (sep-2026) que a
estas personas NO se les practica retención de renta. Además el gasto cayó en
5135 «Servicios», que es la cuenta genérica; va en 511095 «Honorarios — otros».

**Por qué un asiento de ajuste y no un borrado.** Los cinco asientos ya están
espejados en Alegra como comprobantes (journal 123, 128, 129, 131, 132). Un
comprobante contable emitido no se borra: se corrige con otro asiento, que se
espeja a su vez. Anular y rehacer rompería además el vínculo con la solicitud de
pago (`pago:8`, `pago:10`, `pago:11`) y dejaría a Alegra con el comprobante viejo
sin contrapartida.

**A nadie se le devuelve plata.** La retención nunca salió del bolsillo de
ellos: el valor pactado era el neto y McKenna giró exactamente eso
($1.100.000 / $1.200.000 / $1.535.040). Lo que estaba inflado era el GASTO
—se causó el bruto— y la deuda con la DIAN. El ajuste baja las dos.

    D 2365     retención practicada de más   (anula el pasivo con la DIAN)
    D 511095   lo realmente pagado           (lo lleva a su cuenta PUC)
    C 5135     el bruto que se había causado (vacía la cuenta genérica)

**Lo que este script NO hace:** no practica ICA retroactivo. De aquí en adelante
el wizard lo calcula (9,66 por mil, en la ficha de cada tercero), pero aplicarlo
hacia atrás crea una deuda nueva con el municipio sobre pagos ya girados, y eso
lo decide el contador, no un script.

Uso:
    python3 scripts/corregir_prestacion_servicios_sep2026.py             # simula
    python3 scripts/corregir_prestacion_servicios_sep2026.py --confirmar # escribe
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Los asientos a corregir, tal como quedaron el 15 y 16 de septiembre.
ASIENTOS = (1792, 1872, 1873, 1875, 1876)

CUENTA_DESTINO = "511095"
CUENTA_ORIGEN = "5135"
CUENTA_RETENCION = "2365"
FECHA_AJUSTE = "2026-09-16"


def _fmt(n) -> str:
    return f"${float(n or 0):,.0f}".replace(",", ".")


def analizar() -> list[dict]:
    """Lee los asientos y arma el ajuste de cada uno. No escribe nada."""
    import app.services.contabilidad_core as cc

    cc._ensure()
    planes: list[dict] = []
    with cc._conn() as con:
        id_origen = cc._cuenta_id_por_codigo(con, CUENTA_ORIGEN)
        id_destino = cc._cuenta_id_por_codigo(con, CUENTA_DESTINO)
        id_ret = cc._cuenta_id_por_codigo(con, CUENTA_RETENCION)
        if not (id_origen and id_destino and id_ret):
            raise SystemExit("⛔ Faltan cuentas en el plan (5135 / 511095 / 2365)")

        for mid in ASIENTOS:
            mov = con.execute("SELECT * FROM cc_movimientos WHERE id=?", (mid,)).fetchone()
            if not mov:
                print(f"  ⚠ asiento #{mid} no existe — se omite")
                continue
            if mov["estado"] == "anulado":
                print(f"  ⚠ asiento #{mid} ya está anulado — se omite")
                continue
            lineas = [dict(r) for r in con.execute(
                """SELECT l.*, p.codigo FROM cc_movimiento_lineas l
                     JOIN cc_plan_cuentas p ON p.id = l.cuenta_id
                    WHERE l.movimiento_id=? ORDER BY l.orden""", (mid,))]
            gasto = next((l for l in lineas if l["codigo"] == CUENTA_ORIGEN and l["debito"] > 0), None)
            if not gasto:
                print(f"  ⚠ asiento #{mid} ya no carga contra {CUENTA_ORIGEN} — se omite (¿ya corregido?)")
                continue
            retencion = sum(l["credito"] for l in lineas if str(l["codigo"]).startswith("2365"))
            tercero_id = gasto["tercero_id"] or mov["tercero_id"]
            nombre = con.execute(
                "SELECT nombre FROM cc_terceros WHERE id=?", (tercero_id,)
            ).fetchone()
            nombre = nombre["nombre"] if nombre else "sin tercero"

            bruto = round(float(gasto["debito"]), 2)
            neto = round(bruto - float(retencion), 2)
            ajuste = []
            if retencion:
                ajuste.append({
                    "cuenta_id": id_ret, "codigo": CUENTA_RETENCION,
                    "debito": round(float(retencion), 2), "credito": 0,
                    "tercero_id": tercero_id,
                    "descripcion": "Anula la retención de renta practicada de más",
                })
            ajuste.append({
                "cuenta_id": id_destino, "codigo": CUENTA_DESTINO,
                "debito": neto, "credito": 0, "tercero_id": tercero_id,
                "descripcion": f"Prestación de servicios — {nombre}",
            })
            ajuste.append({
                "cuenta_id": id_origen, "codigo": CUENTA_ORIGEN,
                "debito": 0, "credito": bruto, "tercero_id": tercero_id,
                "descripcion": "Reclasifica desde servicios genéricos",
            })
            planes.append({
                "movimiento_id": mid, "fecha": mov["fecha"], "nombre": nombre,
                "concepto_original": mov["concepto"], "bruto": bruto,
                "retencion": round(float(retencion), 2), "neto": neto,
                "lineas": ajuste,
                "referencia": f"ajuste-puc:{mid}",
            })
    return planes


def aplicar(planes: list[dict]) -> list[int]:
    import app.services.contabilidad_core as cc

    creados = []
    with cc._conn() as con:
        for p in planes:
            ya = con.execute(
                "SELECT id FROM cc_movimientos WHERE referencia=?", (p["referencia"],)
            ).fetchone()
            if ya:
                print(f"  ↻ #{p['movimiento_id']} ya tenía su ajuste (#{ya['id']}) — se omite")
                continue
    for p in planes:
        with cc._conn() as con:
            if con.execute("SELECT 1 FROM cc_movimientos WHERE referencia=?",
                           (p["referencia"],)).fetchone():
                continue
        mov = cc.crear_movimiento(
            fecha=FECHA_AJUSTE,
            concepto=(
                f"Ajuste PUC — {p['nombre']}: sin retención de renta y gasto a "
                f"{CUENTA_DESTINO} (corrige asiento #{p['movimiento_id']})"
            ),
            lineas=[{k: v for k, v in l.items() if k != "codigo"} for l in p["lineas"]],
            tipo_origen="ajuste_puc",
            referencia=p["referencia"],
        )
        creados.append(mov["id"])
        print(f"  ✓ #{p['movimiento_id']} → ajuste #{mov['id']}")
    return creados


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmar", action="store_true", help="escribe los asientos de ajuste")
    args = ap.parse_args()

    planes = analizar()
    if not planes:
        print("\nNo hay nada que corregir.")
        return

    print(f"\n{'ASIENTO':<9} {'PERSONA':<32} {'BRUTO':>14} {'RETENCIÓN':>12} {'QUEDA EN 511095':>16}")
    for p in planes:
        print(f"#{p['movimiento_id']:<8} {p['nombre'][:31]:<32} {_fmt(p['bruto']):>14} "
              f"{_fmt(p['retencion']):>12} {_fmt(p['neto']):>16}")
    total_ret = sum(p["retencion"] for p in planes)
    total_neto = sum(p["neto"] for p in planes)
    print(f"{'':<9} {'TOTAL':<32} {'':>14} {_fmt(total_ret):>12} {_fmt(total_neto):>16}")
    print(f"\nLa cuenta 2365 baja {_fmt(total_ret)} y el gasto queda en lo realmente girado.")
    print("A nadie se le gira nada: el valor pactado ya se pagó completo.")

    if not args.confirmar:
        print("\n(simulación — nada se escribió. Agrega --confirmar para aplicarlo)")
        return
    print()
    creados = aplicar(planes)
    print(f"\n{len(creados)} asiento(s) de ajuste creados.")
    if os.getenv("ALEGRA_ESPEJO_ACTIVO", "0") == "1":
        print("Se espejan a Alegra como comprobantes nuevos (el viejo no se toca: no se borra un comprobante emitido).")


if __name__ == "__main__":
    main()
