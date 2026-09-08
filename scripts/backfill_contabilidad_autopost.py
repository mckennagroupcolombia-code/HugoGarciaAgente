#!/usr/bin/env python3
"""
Backfill único: puebla el libro de partida doble propio
(app/services/contabilidad_core.py) con el histórico que ya trae
app/services/contabilidad_ledger.py::armar_libro() (ventas MeLi/web/Siigo,
compras, compras al exterior, servicios, impuestos, cuotas de créditos).

Después de esta corrida, el cron scripts/contabilidad_autopost_cron.py se
encarga de mantenerlo al día (ventana móvil de los últimos días) — este
script es solo para el rango histórico que el cron no cubre.

Por defecto corre en modo `--dry-run` (no escribe nada, solo cuenta). Para
escribir de verdad hay que pasar `--confirmar` explícitamente.

Uso:
  python scripts/backfill_contabilidad_autopost.py --desde 2024-01-01 --hasta 2026-09-07
  python scripts/backfill_contabilidad_autopost.py --desde 2024-01-01 --hasta 2026-09-07 --confirmar
"""

from __future__ import annotations

import argparse
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--desde", required=True, help="YYYY-MM-DD")
    ap.add_argument("--hasta", default=datetime.now().strftime("%Y-%m-%d"), help="YYYY-MM-DD (default: hoy)")
    ap.add_argument(
        "--confirmar",
        action="store_true",
        help="Escribe de verdad. Sin esta bandera solo cuenta (dry-run).",
    )
    ap.add_argument("--sin-meli", action="store_true", help="No consultar MeLi (más rápido, solo fuentes locales)")
    ap.add_argument("--sin-siigo", action="store_true", help="No consultar Siigo/Alegra (más rápido, solo fuentes locales)")
    args = ap.parse_args()

    from app.services.contabilidad_autopost import auto_postear_periodo

    dry_run = not args.confirmar
    modo = "DRY-RUN (no escribe nada)" if dry_run else "ESCRIBIENDO en contabilidad.db"
    print(f"→ Backfill {args.desde} → {args.hasta} — {modo}")

    r = auto_postear_periodo(
        args.desde,
        args.hasta,
        incluir_meli=not args.sin_meli,
        incluir_siigo=not args.sin_siigo,
        dry_run=dry_run,
    )

    print(f"  creados:          {r['creados']}")
    print(f"  ya existían:      {r['omitidos']}")
    if r["fuentes_sin_mapeo"]:
        print("  fuentes sin mapeo (NO se postearon):")
        for f, n in r["fuentes_sin_mapeo"].items():
            print(f"    - {f}: {n}")
    if r["errores"]:
        print(f"  errores: {len(r['errores'])}")
        for e in r["errores"][:20]:
            print(f"    - {e['fuente']} ({e['referencia']}): {e['error']}")

    if dry_run and r["creados"] > 0:
        print("\nEsto fue un dry-run. Para escribir de verdad, vuelve a correr con --confirmar.")

    return 1 if r["errores"] else 0


if __name__ == "__main__":
    sys.exit(main())
