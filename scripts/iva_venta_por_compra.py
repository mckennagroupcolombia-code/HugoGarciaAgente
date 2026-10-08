#!/usr/bin/env python3
"""IVA de venta = el que cobra el proveedor (app/services/iva_venta_compra.py).

    python3 scripts/iva_venta_por_compra.py            # vista previa, no toca nada
    python3 scripts/iva_venta_por_compra.py --aplicar  # cambia el IVA en Alegra y lo relee

Lo normal es que corra solo al registrar cada compra con la factura cuadrada; esto sirve para
revisar el catálogo entero o repasar después de un cambio de reglas. Sin LLM.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.services import iva_venta_compra as I  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--aplicar", action="store_true", help="cambiar el IVA en Alegra (sin esto, solo muestra)")
    ap.add_argument("--sku", action="append", help="solo este código de compra (se puede repetir)")
    args = ap.parse_args()

    p = I.plan(args.sku)
    print(f"{len(p['cambios'])} ítem(s) con IVA de venta distinto al de la compra:")
    for c in p["cambios"]:
        actual = "sin dato" if c["iva_venta_actual"] is None else f"{c['iva_venta_actual']:g} %"
        print(f"  {c['ref']:<20} {c['tipo']:<13} {actual:>8} → {c['a']:<9} "
              f"(compra {c['compra']} al {c['iva_compra']:g} %, {c['proveedor']} {c['fecha']})")
    if p["omitidos"]:
        print("\nNo se tocan:")
        vistos = set()
        for o in p["omitidos"]:
            clave = (o.get("ref") or o["compra"], o["motivo"])
            if clave not in vistos:
                vistos.add(clave)
                print(f"  {clave[0]:<20} {o['motivo']}")
    if not args.aplicar:
        print("\nVista previa. Para cambiarlos en Alegra: --aplicar")
        return 0
    hechos = I.aplicar(p["cambios"], por="script")
    mal = [h for h in hechos if not h.get("ok")]
    print(f"\nAplicados: {len(hechos) - len(mal)} · para revisar: {len(mal)}")
    for h in mal:
        print(f"  ⚠️ {h['ref']}: {h.get('error') or h.get('otros_cambios')}")
    return 1 if mal else 0


if __name__ == "__main__":
    raise SystemExit(main())
