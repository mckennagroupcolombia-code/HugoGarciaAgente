#!/usr/bin/env python3
"""Reenvía el correo de confirmación de un pedido web (misma plantilla que tras MP aprobado)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.tools.web_pedidos import reenviar_correo_confirmacion_pedido  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("reference", help="Ej: MCKG-0F2D7E4779")
    p.add_argument(
        "--force",
        action="store_true",
        help="Reenviar aunque confirmation_email_sent_at ya exista",
    )
    args = p.parse_args()
    ok, msg = reenviar_correo_confirmacion_pedido(args.reference, force=args.force)
    print(msg)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
