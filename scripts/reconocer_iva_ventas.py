#!/usr/bin/env python3
"""Reconoce el IVA de las ventas de un período: lo saca de Ingresos y lo deja en 240805.

Las ventas se contabilizan por su total contra 4135, pero McKenna es responsable
de IVA: parte de ese total no es ingreso suyo sino IVA que le debe a la DIAN.
Esto lo reclasifica, tomando la cifra de las **facturas emitidas** (no de aplicar
19% al total, porque hay materias primas excluidas).

Antes de escribir nada muestra el contraste entre lo facturado y lo que el libro
tiene como ingreso: si no cuadran, hay ventas sin factura o facturas sin
contabilizar, y conviene resolver eso antes de reconocer el IVA sobre una base
que no corresponde.

Uso:
    python3 scripts/reconocer_iva_ventas.py 2026-09            # simula el mes
    python3 scripts/reconocer_iva_ventas.py 2026-09 --confirmar
    python3 scripts/reconocer_iva_ventas.py 2026-07 2026-09    # varios meses
"""

from __future__ import annotations

import argparse
import calendar
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _rango(periodo: str) -> tuple[str, str]:
    anio, mes = int(periodo[:4]), int(periodo[5:7])
    return f"{anio:04d}-{mes:02d}-01", f"{anio:04d}-{mes:02d}-{calendar.monthrange(anio, mes)[1]:02d}"


def _meses(desde: str, hasta: str) -> list[str]:
    a, m = int(desde[:4]), int(desde[5:7])
    fin = (int(hasta[:4]), int(hasta[5:7]))
    out = []
    while (a, m) <= fin:
        out.append(f"{a:04d}-{m:02d}")
        m += 1
        if m > 12:
            a, m = a + 1, 1
    return out


def _fmt(n) -> str:
    return f"${float(n or 0):,.0f}".replace(",", ".")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("periodo", help="AAAA-MM")
    ap.add_argument("hasta", nargs="?", help="AAAA-MM final (opcional)")
    ap.add_argument("--confirmar", action="store_true", help="crea los asientos")
    args = ap.parse_args()

    from app.services.iva_ventas import reconocer

    periodos = _meses(args.periodo, args.hasta or args.periodo)
    print(f"{'PERÍODO':<9} {'FACT':>5} {'NC':>4} {'IVA BRUTO':>13} {'IVA ANULADO':>13} "
          f"{'IVA NETO':>13} {'FACT.NETO':>15} {'LIBRO':>15} {'DIF':>13}")
    total_iva = 0.0
    for p in periodos:
        desde, hasta = _rango(p)
        r = reconocer(desde, hasta, dry_run=not args.confirmar)
        total_iva += r["iva_generado"] if r["estado"] in ("simulado", "reconocido") else 0
        dif = r["diferencia_libro_vs_facturas"]
        marca = {"reconocido": "✓", "ya_reconocido": "=", "sin_iva": "·", "simulado": "~"}.get(r["estado"], "?")
        bruto = r["iva_generado"] + r.get("iva_anulado", 0)
        print(f"{p:<9} {r['facturas']:>5} {r.get('notas_credito', 0):>4} {_fmt(bruto):>13} "
              f"{_fmt(r.get('iva_anulado', 0)):>13} {_fmt(r['iva_generado']):>13} "
              f"{_fmt(r['total_facturado']):>15} {_fmt(r['ingreso_en_libro']):>15} {_fmt(dif):>13} {marca}")
        if abs(dif) > 1000:
            print(f"          ⚠ el libro y las facturas no cuadran por {_fmt(abs(dif))}: "
                  f"{'hay ventas sin facturar' if dif > 0 else 'hay facturas sin contabilizar'}")

    print(f"\nIVA generado del rango: {_fmt(total_iva)}")
    if not args.confirmar:
        print("(simulación — nada se escribió. Agrega --confirmar para crear los asientos)")
    else:
        print("Asientos creados. El IVA descontable de las compras (240810) es un paso aparte:")
        print("sin esa mitad, el saldo de 2408 queda por encima de lo que realmente se declara.")


if __name__ == "__main__":
    main()
