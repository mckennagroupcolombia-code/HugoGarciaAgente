#!/usr/bin/env python3
"""Crea en Alegra las dos cuentas que faltan y espeja las facturas de MeLi.

Correr UNA VEZ, después de elegir el catálogo contable en Alegra
(app.alegra.com/category — McKenna eligió **NIIF**). Hasta que esa opción esté
marcada, `POST /categories` responde 400 «primero selecciona si usarás el
catálogo NIIF o PUC» — no hay endpoint para elegirlo, es un clic de la interfaz.

Cuál de los dos catálogos se elija **no cambia este script**: el puente entre los
dos libros es `alegra_espejo.MAPA_PUC`, que mapea código PUC interno → **id** de
cuenta de Alegra, y esas ids son internas de Alegra, no dependen del catálogo.
Lo que cambia es el código que Alegra le muestra al contador.

Qué hace:
  1. Crea «Publicidad en MercadoLibre (Product Ads)» bajo el grupo 5222
     (Propaganda y publicidad, que Alegra ya trae vacío) y «MercadoPago - saldo
     en plataforma» bajo 5005 (Bancos).
  2. Escribe las dos ids en MAPA_PUC de alegra_espejo.py.
  3. Espeja los 5 asientos (abr-ago 2026) como comprobantes contables.

Idempotente: si una cuenta ya existe la reutiliza, y `espejar_movimiento` no
crea un comprobante dos veces para el mismo asiento.

Uso:
    ALEGRA_ESPEJO_ACTIVO=1 python3 scripts/completar_espejo_meli_alegra.py
    python3 scripts/completar_espejo_meli_alegra.py --simular   # sin escribir
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import requests

from app.services.alegra import _ALEGRA_BASE, _alegra_headers

DB = "app/data/contabilidad.db"
ESPEJO_PY = "app/services/alegra_espejo.py"

CUENTAS = [
    ("529505", {"name": "Publicidad en MercadoLibre (Product Ads)", "type": "expense",
                "idParent": "5222", "nature": "debit", "use": "movement",
                "description": "Cargos PADS de la factura mensual de MercadoLibre"}),
    ("111010", {"name": "MercadoPago - saldo en plataforma", "type": "asset",
                "idParent": "5005", "nature": "debit", "use": "movement",
                "description": "Dinero retenido en MercadoPago hasta el giro al banco"}),
]


def _buscar_por_nombre(headers: dict, nombre: str) -> str | None:
    r = requests.get(f"{_ALEGRA_BASE}/categories", headers=headers,
                     params={"limit": 300}, timeout=40)
    if not r.ok:
        return None
    for c in r.json() or []:
        if str(c.get("name") or "").strip().lower() == nombre.strip().lower():
            return str(c.get("id"))
    return None


def crear_cuentas(simular: bool) -> dict[str, str]:
    headers = _alegra_headers()
    ids: dict[str, str] = {}
    for puc, payload in CUENTAS:
        existente = _buscar_por_nombre(headers, payload["name"])
        if existente:
            print(f"  {puc}  ya existía en Alegra (id {existente})")
            ids[puc] = existente
            continue
        if simular:
            print(f"  {puc}  [simulado] crearía «{payload['name']}»")
            continue
        r = requests.post(f"{_ALEGRA_BASE}/categories", headers=headers, json=payload, timeout=30)
        d = r.json() if r.content else {}
        if not r.ok:
            msg = str(d.get("message") or r.text)[:160]
            if "cat" in msg.lower() and ("niif" in msg.lower() or "puc" in msg.lower()):
                raise SystemExit(
                    "\n⛔ Alegra todavía no tiene catálogo elegido.\n"
                    "   Entrá a app.alegra.com/category y elegí el catálogo; después volvé a correr esto.\n"
                )
            raise SystemExit(f"⛔ No se pudo crear «{payload['name']}»: {msg}")
        ids[puc] = str(d.get("id"))
        print(f"  {puc}  creada en Alegra (id {ids[puc]})")
    return ids


def fijar_mapa(ids: dict[str, str], simular: bool) -> None:
    """Deja las ids en MAPA_PUC para que el espejo las use de acá en adelante."""
    with open(ESPEJO_PY, encoding="utf-8") as fh:
        src = fh.read()
    if not ids:
        # En simulación no se crea nada, así que no hay ids que fijar. Decir
        # «ya estaban» acá sería mentir sobre el estado real del archivo.
        print("  MAPA_PUC: nada que fijar todavía (no hay ids de Alegra)")
        return
    nuevas = [(p, i) for p, i in ids.items() if f'"{p}"' not in src]
    if not nuevas:
        print("  MAPA_PUC ya tenía las dos cuentas")
        return
    if simular:
        print(f"  [simulado] agregaría a MAPA_PUC: {nuevas}")
        return
    bloque = "".join(
        f'    "{p}": "{i}",  # agregada por completar_espejo_meli_alegra.py\n' for p, i in nuevas
    )
    src = re.sub(r"(MAPA_PUC[^=]*=\s*\{\n)", r"\1" + bloque, src, count=1)
    with open(ESPEJO_PY, "w", encoding="utf-8") as fh:
        fh.write(src)
    print(f"  MAPA_PUC actualizado: {nuevas}")


def espejar(simular: bool) -> None:
    from app.services import alegra_espejo as ae

    with sqlite3.connect(DB) as con:
        ids = [r[0] for r in con.execute(
            "SELECT id FROM cc_movimientos WHERE tipo_origen='meli_factura' ORDER BY fecha")]
    print(f"\nAsientos de facturas MeLi: {ids}")
    if simular:
        print("  [simulado] no se espeja nada")
        return
    for mid in ids:
        r = ae.espejar_movimiento(mid)
        estado = r.get("status") or ("ok" if r.get("alegra_id") else "?")
        print(f"  #{mid}: {estado}  {r.get('alegra_id') or r.get('message') or ''}")


def main() -> None:
    simular = "--simular" in sys.argv
    if not simular and os.getenv("ALEGRA_ESPEJO_ACTIVO") != "1":
        raise SystemExit(
            "⛔ Este script escribe en Alegra. Correlo con ALEGRA_ESPEJO_ACTIVO=1, "
            "o con --simular para ver qué haría."
        )
    print("Cuentas contables en Alegra:")
    ids = crear_cuentas(simular)
    fijar_mapa(ids, simular)
    espejar(simular)


if __name__ == "__main__":
    main()
