#!/usr/bin/env python3
"""Crea en Alegra las cuentas del PUC que su catálogo no trae y McKenna sí usa.

**El problema.** El catálogo PUC de Alegra es parcial. Faltan cuentas donde vive
plata real de McKenna, y `alegra_espejo` se niega —con razón— a postear un
comprobante al que le falte una cuenta: hacerlo lo dejaría descuadrado.

  · `523560` Publicidad, propaganda y promoción  → Product Ads de MeLi ($105,5M)
  · `529505` Comisiones                          → comisiones de venta ($52,3M)
  · `112515` Fondos especiales moneda nacional   → saldo en MercadoPago
  · `235510` Socios                              → deudas con Armando y Cynthia
  · `219505` Particulares                        → préstamos de terceros

**Por qué se crean también las cuentas mayores.** Alegra exige asentar contra
subcuentas; las de 4 dígitos son agrupadoras. Así que cada subcuenta necesita su
padre (`5235`, `5295`, `1125`), salvo cuando Alegra ya lo trae (`2355`, `2195`).

Idempotente, y con una precaución aprendida a los golpes: **Alegra devuelve 503
«Service Unavailable» en POST que SÍ se ejecutaron**. El primer intento de crear
`5235` respondió 503 y la cuenta quedó creada igual. Por eso, ante un 503 este
script no falla ni reintenta a ciegas: vuelve a leer el catálogo y comprueba si
la cuenta apareció. Reintentar sin comprobar es como se crean duplicados en el
plan de cuentas de una contabilidad real.

(El 503, además, es lo que Alegra responde cuando falta `code` en modo PUC —
un error de validación disfrazado de caída del servicio.)

Uso:
    python3 scripts/crear_cuentas_ventas_alegra.py              # simula
    python3 scripts/crear_cuentas_ventas_alegra.py --confirmar  # crea en Alegra
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import requests

_BASE = "https://api.alegra.com/api/v1"

# (código, nombre, padre, uso, tipo, naturaleza). El orden importa: la cuenta
# mayor antes que su subcuenta, porque el `idParent` de la segunda sale de la
# primera. Los nombres son los del Decreto 2650, verificados uno por uno — no
# los que uno supondría: 235505 es «Accionistas» y 235510 «Socios»; 219505 es
# «Particulares», que es exactamente lo que son los prestamistas de McKenna.
CUENTAS = [
    ("5235", "Servicios", "52", "accumulative", "expense", "debit"),
    ("523560", "Publicidad, propaganda y promoción", "5235", "movement", "expense", "debit"),
    ("5295", "Diversos", "52", "accumulative", "expense", "debit"),
    ("529505", "Comisiones", "5295", "movement", "expense", "debit"),
    ("1125", "Fondos", "11", "accumulative", "asset", "debit"),
    ("112515", "Especiales moneda nacional", "1125", "movement", "asset", "debit"),
    ("235510", "Socios", "2355", "movement", "liability", "credit"),
    ("219505", "Particulares", "2195", "movement", "liability", "credit"),
]


def _headers() -> dict:
    from app.services.alegra_puc import _headers as h

    return h()


def _catalogo_vivo() -> dict[str, dict]:
    from app.services.alegra_puc import descargar_catalogo

    return descargar_catalogo()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmar", action="store_true", help="crea las cuentas en Alegra")
    args = ap.parse_args()

    plano = _catalogo_vivo()
    headers = _headers()
    creadas: dict[str, str] = {}

    for codigo, nombre, padre_cod, uso, tipo, naturaleza in CUENTAS:
        existente = plano.get(codigo)
        if existente:
            print(f"  = {codigo:<8} ya existe en Alegra (id {existente['id']}, «{existente['nombre']}»)")
            creadas[codigo] = existente["id"]
            continue

        padre = plano.get(padre_cod) or {"id": creadas.get(padre_cod)}
        padre_id = padre.get("id") if isinstance(padre, dict) else None
        if not padre_id:
            raise SystemExit(f"⛔ No encuentro la cuenta padre {padre_cod} para crear {codigo}")

        payload = {
            "name": nombre,
            "code": codigo,
            "type": tipo,
            "nature": naturaleza,
            "use": uso,
            "idParent": str(padre_id),
            "description": f"PUC {codigo} — creada para el espejo del Libro Mayor de McKenna",
        }
        if not args.confirmar:
            print(f"  + {codigo:<8} [simulado] «{nombre}» bajo {padre_cod} (id {padre_id}), uso {uso}")
            creadas[codigo] = f"simulada-{codigo}"
            continue

        r = requests.post(f"{_BASE}/categories", headers=headers, json=payload, timeout=40)
        d = r.json() if r.content else {}
        if r.ok:
            creadas[codigo] = str(d.get("id"))
            print(f"  + {codigo:<8} creada «{nombre}» (id {creadas[codigo]}) bajo {padre_cod}")
        else:
            # 503 y «ya existe» significan lo mismo acá: hay que ir a mirar.
            plano = _catalogo_vivo()
            aparecio = plano.get(codigo)
            if not aparecio:
                raise SystemExit(
                    f"⛔ No se pudo crear {codigo} ({r.status_code}): "
                    f"{str(d.get('message') or r.text)[:200]}"
                )
            creadas[codigo] = aparecio["id"]
            print(f"  + {codigo:<8} Alegra respondió {r.status_code} pero la cuenta SÍ quedó "
                  f"(id {aparecio['id']}) — no se reintenta")
        plano = _catalogo_vivo()   # el padre de la siguiente puede ser esta

    if not args.confirmar:
        print("\n(simulación — nada se creó. Agrega --confirmar para hacerlo)")
        return

    # Refrescar el caché y comprobar que el puente ya resuelve.
    from app.services.alegra_puc import construir_mapa

    r = construir_mapa(refrescar=True)
    print(f"\nCatálogo refrescado: {r['cuentas_alegra']} cuentas, {len(r['mapa'])} emparejadas.")
    for codigo in (c[0] for c in CUENTAS if c[3] == "movement"):
        destino = r["mapa"].get(codigo)
        print(f"  {codigo} -> {destino or '✗ SIGUE SIN EMPAREJAR'}")


if __name__ == "__main__":
    main()
