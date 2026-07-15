#!/usr/bin/env python3
"""Sube los EAN de la planilla local al campo código de barras en SIIGO."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.siigo import sincronizar_barcodes_ean_a_siigo


def main() -> int:
    ap = argparse.ArgumentParser(description=main.__doc__)
    ap.add_argument(
        "--forzar",
        action="store_true",
        help="Sobrescribe barcodes aunque ya tengan valor",
    )
    ap.add_argument("--limite", type=int, default=None, help="Máximo de productos a procesar")
    ap.add_argument("--delay", type=float, default=0.25, help="Pausa entre PUTs (segundos)")
    args = ap.parse_args()

    print(
        f"Sincronizando barcodes → SIIGO "
        f"(solo_vacios={not args.forzar}, limite={args.limite}, delay={args.delay})…"
    )
    res = sincronizar_barcodes_ean_a_siigo(
        solo_vacios=not args.forzar,
        delay_s=args.delay,
        limite=args.limite,
    )
    if not res.get("ok"):
        print("ERROR:", res.get("error") or res)
        return 1
    print(
        f"OK actualizados={res['actualizados']} omitidos={res['omitidos']} "
        f"procesados={res['procesados']} en_planilla={res['en_planilla']}"
    )
    if res.get("errores"):
        print(f"errores ({len(res['errores'])}):")
        for e in res["errores"][:30]:
            print(" ", e)
    if res.get("detalle"):
        print("muestra:")
        for d in res["detalle"][:10]:
            print(f"  {d['sku']} → {d['barcode']}")
    return 0 if not res.get("errores") else 2


if __name__ == "__main__":
    raise SystemExit(main())
