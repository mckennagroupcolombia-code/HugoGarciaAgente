#!/usr/bin/env python3
"""
Asigna el código UNSPSC (`productKey`) a los ítems de Alegra.

Por qué: la DIAN acepta las facturas pero devuelve la notificación **FAZ09**
("Debe existir el grupo de información de identificación del bien o servicio")
cuando los ítems no traen código estándar de producto. Las 150 facturas
electrónicas emitidas hasta el 2026-09-12 quedaron todas
`STAMPED_AND_ACCEPTED_WITH_OBSERVATIONS` por esto — son válidas, pero en Alegra
se ven con alerta y parecen fallidas. Los 548 ítems de la cuenta tienen
`productKey: null`.

Qué NO hace: no corrige facturas ya emitidas (no se puede; el código viaja en el
XML). A partir de la siguiente emisión, los ítems actualizados salen sin FAZ09.

Uso:
    python3 scripts/alegra_codigos_unspsc.py            # simulación, no escribe
    python3 scripts/alegra_codigos_unspsc.py --aplicar  # escribe en Alegra

Los códigos son de nivel SEGMENTO (8 dígitos terminados en 000000), válidos en
el catálogo UNSPSC v14.080 que usa Colombia. Bastan para cerrar FAZ09; si más
adelante se quiere granularidad (familia/clase), se afina este mapa sin tocar
el resto.
"""
import argparse
import os
import sys

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from app.services.alegra import _ALEGRA_BASE, _alegra_headers  # noqa: E402

UNSPSC_QUIMICO = "12000000"      # Material químico incluyendo bioquímicos y gas
UNSPSC_ALIMENTO = "50000000"     # Alimentos, bebidas y tabaco
UNSPSC_FARMA = "51000000"        # Medicamentos y productos farmacéuticos
UNSPSC_ENVASES = "24000000"      # Manejo, acondicionamiento y almacenamiento
UNSPSC_TRANSPORTE = "78000000"   # Servicios de transporte, almacenaje y correo

# El orden importa: gana la primera coincidencia.
_REGLAS: list[tuple[tuple[str, ...], str]] = [
    (("envio", "envío", "flete", "transporte", "domicilio"), UNSPSC_TRANSPORTE),
    (("envase", "frasco", "tapa", "gotero", "atomizador", "bolsa", "empaque",
      "etiqueta", "caja"), UNSPSC_ENVASES),
    (("capsula", "cápsula", "excipiente", "estearato", "celulosa microcristalina",
      "lactosa"), UNSPSC_FARMA),
    (("almendra", "nuez", "nueces", "mani", "maní", "semilla", "avena", "quinua",
      "harina", "chia", "chía", "linaza", "arandano", "arándano", "pasas",
      "ciruela", "coco rallado", "cacao", "azucar", "azúcar", "sal marina",
      "proteina", "proteína", "colageno", "colágeno"), UNSPSC_ALIMENTO),
]


def codigo_unspsc(nombre: str) -> str:
    """UNSPSC para un ítem según su nombre. Default: químico — es el 90% del
    catálogo de McKenna (materias primas cosméticas y farmacéuticas)."""
    n = (nombre or "").lower()
    for claves, codigo in _REGLAS:
        if any(c in n for c in claves):
            return codigo
    return UNSPSC_QUIMICO


def listar_items(headers: dict) -> list[dict]:
    items, start = [], 0
    while True:
        res = requests.get(
            f"{_ALEGRA_BASE}/items", headers=headers,
            params={"start": start, "limit": 30}, timeout=30,
        )
        res.raise_for_status()
        lote = res.json() or []
        if not lote:
            return items
        items.extend(lote)
        start += 30


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aplicar", action="store_true",
                    help="Escribe en Alegra. Sin esto solo simula.")
    ap.add_argument("--sobrescribir", action="store_true",
                    help="También cambia los ítems que YA tienen productKey.")
    args = ap.parse_args()

    headers = _alegra_headers()
    items = listar_items(headers)
    print(f"{len(items)} ítems en Alegra")

    pendientes = [
        it for it in items
        if args.sobrescribir or not (it.get("productKey") or "").strip()
    ]
    print(f"{len(pendientes)} por actualizar\n")

    resumen: dict[str, int] = {}
    errores = 0
    for it in pendientes:
        codigo = codigo_unspsc(it.get("name") or "")
        resumen[codigo] = resumen.get(codigo, 0) + 1
        if not args.aplicar:
            continue
        res = requests.put(
            f"{_ALEGRA_BASE}/items/{it['id']}", headers=headers,
            json={"productKey": codigo}, timeout=30,
        )
        if res.status_code not in (200, 201):
            errores += 1
            print(f"  ⚠️ {it['id']} {it.get('name')}: HTTP {res.status_code} {res.text[:200]}")

    for codigo, n in sorted(resumen.items(), key=lambda kv: -kv[1]):
        print(f"  {codigo}  {n} ítems")
    if not args.aplicar:
        print("\n(simulación — usa --aplicar para escribir en Alegra)")
    elif errores:
        print(f"\n{errores} ítems con error")
    else:
        print("\n✅ listo — las próximas facturas salen sin la notificación FAZ09")
    return 1 if errores else 0


if __name__ == "__main__":
    raise SystemExit(main())
