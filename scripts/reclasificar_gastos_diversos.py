#!/usr/bin/env python3
"""Saca de 5195 «Diversos» lo que nunca fue diverso.

El auto-posteo manda a `5195 Diversos` toda factura de compra que no sabe
clasificar. Con el tiempo eso deja un cajón de sastre que no dice nada: al
16-sep-2026 tenía $3,17M donde el 47% eran fletes de Interrapidísimo y el 40%
era el registro mercantil de la Cámara de Comercio. Un estado de resultados con
«Diversos $3,17M» no le sirve a nadie.

**Se reclasifica en el sitio, no con un asiento de ajuste.** Ninguno de estos
asientos se ha espejado a Alegra todavía (se comprobó: 0 de 37), así que nada
externo los ha visto; cambiar la cuenta de la línea es exactamente lo que
significa reclasificar. Cuando un asiento YA está espejado la corrección va por
asiento de ajuste — ver `corregir_prestacion_servicios_sep2026.py`.

No mueve un peso: el débito, el crédito y el tercero quedan iguales; cambia la
cuenta dentro de la misma clase. El balance tiene que cuadrar antes y después, y
el script lo verifica.

**Solo reclasifica lo que tiene una respuesta inequívoca por tercero.** Lo demás
se lista y se deja quieto: adivinar qué fue una compra suelta en D1 es cómo se
llenó el cajón en primer lugar.

Uso:
    python3 scripts/reclasificar_gastos_diversos.py              # simula
    python3 scripts/reclasificar_gastos_diversos.py --confirmar  # aplica
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CUENTA_ORIGEN = "5195"

# Tercero (tal como está en cc_terceros) → cuenta PUC a la que pertenece su gasto.
# Cada regla necesita ser cierta para TODO lo que ese tercero factura; si un
# proveedor vende cosas de naturaleza distinta, no va acá.
REGLAS = {
    "INTER RAPIDISIMO S.A": ("513550", "Transporte, fletes y acarreos — es una transportadora"),
    "CAMARA DE COMERCIO DE BOGOTA": ("514010", "Registro mercantil — es lo único que cobra"),
    "RUEDAS INNOVACION GP SAS": ("514515", "Mantenimiento de maquinaria y equipo (ruedas de bodega)"),
    "D1 S A S": ("519525", "Elementos de aseo y cafetería"),
    # Las pilas AAA van DENTRO de las grameras que McKenna importa y vende, así
    # que no son un gasto de la empresa: son parte de lo que el cliente compra.
    # Su costo pertenece a la mercancía, y dejarlo como gasto subestima el costo
    # de la gramera y sobreestima el margen. Ojo: al entrar a inventario queda
    # como activo hasta que se cause el costo de lo vendido.
    "TRONEX S.A.S": ("1435", "Pilas que se venden dentro de la gramera: es mercancía, no gasto"),
}


def _fmt(n) -> str:
    return f"${float(n or 0):,.0f}".replace(",", ".")


def analizar() -> tuple[list[dict], list[dict]]:
    """(líneas a reclasificar, líneas que se dejan quietas). No escribe nada."""
    import app.services.contabilidad_core as cc

    cc._ensure()
    mover, dejar = [], []
    with cc._conn() as con:
        filas = [dict(r) for r in con.execute(
            """SELECT l.id AS linea_id, l.movimiento_id, l.debito, l.credito,
                      m.fecha, m.concepto,
                      COALESCE(t.nombre,'(sin tercero)') AS tercero
                 FROM cc_movimiento_lineas l
                 JOIN cc_movimientos m ON m.id = l.movimiento_id
                 JOIN cc_plan_cuentas p ON p.id = l.cuenta_id
                 LEFT JOIN cc_terceros t ON t.id = COALESCE(l.tercero_id, m.tercero_id)
                WHERE p.codigo = ? AND m.estado <> 'anulado'
                ORDER BY t.nombre, m.fecha""", (CUENTA_ORIGEN,))]
        for f in filas:
            regla = REGLAS.get(f["tercero"])
            if not regla:
                dejar.append(f)
                continue
            destino, motivo = regla
            cuenta_id = cc._cuenta_id_por_codigo(con, destino)
            if not cuenta_id:
                raise SystemExit(f"⛔ La cuenta destino {destino} no existe en el plan")
            mover.append({**f, "destino": destino, "motivo": motivo, "destino_id": cuenta_id})
    return mover, dejar


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmar", action="store_true", help="aplica la reclasificación")
    args = ap.parse_args()

    import app.services.contabilidad_core as cc

    mover, dejar = analizar()
    if not mover:
        print("No hay nada que reclasificar.")
        return

    por_destino: dict[str, list[dict]] = {}
    for m in mover:
        por_destino.setdefault(f"{m['destino']} · {m['tercero']}", []).append(m)

    print(f"\nSE RECLASIFICAN {len(mover)} líneas desde {CUENTA_ORIGEN}:\n")
    for clave, ls in sorted(por_destino.items()):
        neto = sum(l["debito"] - l["credito"] for l in ls)
        print(f"  → {clave}")
        print(f"      {len(ls)} líneas · {_fmt(neto)} · {ls[0]['motivo']}")

    if dejar:
        neto = sum(l["debito"] - l["credito"] for l in dejar)
        print(f"\nSE DEJAN QUIETAS {len(dejar)} líneas ({_fmt(neto)}) — sin regla clara:")
        for l in dejar:
            print(f"      {l['fecha']}  {_fmt(l['debito'] - l['credito']):>12}  {l['tercero']}")

    balance_antes = cc.balance_comprobacion()
    if not args.confirmar:
        print("\n(simulación — nada se escribió. Agrega --confirmar para aplicarlo)")
        return

    with cc._conn() as con:
        for m in mover:
            con.execute(
                "UPDATE cc_movimiento_lineas SET cuenta_id=? WHERE id=?",
                (m["destino_id"], m["linea_id"]),
            )
    balance_despues = cc.balance_comprobacion()

    print(f"\n{len(mover)} líneas reclasificadas.")
    print(f"Balance: cuadraba={balance_antes['cuadra']} → cuadra={balance_despues['cuadra']}")
    if round(balance_antes["total_debito"], 2) != round(balance_despues["total_debito"], 2):
        raise SystemExit("⛔ El total del balance cambió: reclasificar no debería moverlo. REVISAR.")
    print("El total del balance no se movió, como debe ser.")


if __name__ == "__main__":
    main()
