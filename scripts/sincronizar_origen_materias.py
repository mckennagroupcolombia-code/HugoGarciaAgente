#!/usr/bin/env python3
"""Rutas de origen de la web (mapa «Del origen a tu fórmula») desde los datos reales.

El mapa pinta cada combo con `overrides_sku` de PAGINA_WEB/site/data/origen_materias.json
y, si no tiene, con el país por defecto de su línea (alimentario → Estados Unidos). Los
productos que entraron después del 3-sep (frutos secos, sales, especias…) quedaron todos
con ese default. Este script les busca el país de verdad, en este orden:

  1. Lote vigente del documento técnico (app/data/documentos_producto.json → pais_origen).
  2. Producto del proveedor ligado por SKU (proveedores.db → sku_siigo = materia prima o combo).
  3. Producto del proveedor por nombre (todas las palabras del nombre del proveedor están en
     el de la materia prima, mínimo dos).

«Colombia» en proveedores suele ser el distribuidor nacional, no el origen: solo cuenta si
no hay otro país. Nunca pisa un override que ya exista (los lista si los datos dicen otra
cosa, para decidir a mano). Sin LLM.

    python3 scripts/sincronizar_origen_materias.py            # muestra qué cambiaría
    python3 scripts/sincronizar_origen_materias.py --aplicar  # escribe los overrides nuevos
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from app.tools.origen_materias import cargar_origen_materias, guardar_origen_materias  # noqa: E402

DOCS_FILE = REPO / "app" / "data" / "documentos_producto.json"
PROVEEDORES_DB = REPO / "app" / "data" / "proveedores.db"

# Nombre canónico (como ya lo usa origen_materias.json) de las variantes que aparecen en
# documentos y proveedores.
CANONICO = {
    "usa": "Estados Unidos", "eeuu": "Estados Unidos", "estados unidos": "Estados Unidos",
    "united states": "Estados Unidos", "tunisia": "Túnez", "tunez": "Túnez",
    "turquia": "Turquía", "turkey": "Turquía", "peru": "Perú", "india": "India",
    "brasil": "Brasil", "brazil": "Brasil", "pakistan": "Pakistán", "afganistan": "Afganistán",
    "afghanistan": "Afganistán", "iran": "Irán", "belgica": "Bélgica", "espana": "España",
    "mexico": "México", "japon": "Japón", "china": "China", "vietnam": "Vietnam",
    "sri lanka": "Sri Lanka", "chile": "Chile", "colombia": "Colombia", "francia": "Francia",
    "marruecos": "Marruecos", "argentina": "Argentina", "bolivia": "Bolivia", "egipto": "Egipto",
    "indonesia": "Indonesia", "malasia": "Malasia", "alemania": "Alemania", "italia": "Italia",
    "paises bajos": "Países Bajos", "nueva zelanda": "Nueva Zelanda", "corea del sur": "Corea del Sur",
    "australia": "Australia", "ghana": "Ghana", "uzbekistan": "Uzbekistán", "tailandia": "Tailandia",
    "filipinas": "Filipinas", "sudafrica": "Sudáfrica", "canada": "Canadá", "ecuador": "Ecuador",
}

# Coordenadas (centro aproximado) y puerto de entrada para países que el mapa aún no tiene.
COORDENADAS = {
    "Afganistán": {"lat": 33.9, "lon": 67.7, "puerto_entrada": "Cartagena"},
    "Vietnam": {"lat": 14.1, "lon": 108.3, "puerto_entrada": "Buenaventura"},
    "Túnez": {"lat": 33.9, "lon": 9.5, "puerto_entrada": "Cartagena"},
    "Sri Lanka": {"lat": 7.9, "lon": 80.8, "puerto_entrada": "Cartagena"},
    "Irán": {"lat": 32.4, "lon": 53.7, "puerto_entrada": "Cartagena"},
    "Bélgica": {"lat": 50.5, "lon": 4.5, "puerto_entrada": "Cartagena"},
    "Italia": {"lat": 41.9, "lon": 12.6, "puerto_entrada": "Cartagena"},
    "Uzbekistán": {"lat": 41.4, "lon": 64.6, "puerto_entrada": "Cartagena"},
    "Tailandia": {"lat": 15.9, "lon": 100.9, "puerto_entrada": "Buenaventura"},
    "Filipinas": {"lat": 12.9, "lon": 121.8, "puerto_entrada": "Buenaventura"},
    "Sudáfrica": {"lat": -30.6, "lon": 22.9, "puerto_entrada": "Cartagena"},
    "Canadá": {"lat": 56.1, "lon": -106.3, "puerto_entrada": "Cartagena"},
    "Ecuador": {"lat": -1.8, "lon": -78.2, "puerto_entrada": "Terrestre · Ipiales"},
}

_VACIAS = {"de", "del", "la", "el", "en", "con", "sin", "y", "x", "kg", "g", "gr", "ml", "saco", "bulto"}


def _sin_tildes(txt: str) -> str:
    t = unicodedata.normalize("NFD", txt or "")
    return "".join(c for c in t if unicodedata.category(c) != "Mn").lower().strip()


def canonico(pais: str) -> str:
    p = _sin_tildes(pais)
    return CANONICO.get(p, (pais or "").strip().title()) if p else ""


def _palabras(nombre: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", _sin_tildes(nombre)) if len(w) > 2 and w not in _VACIAS}


def _elegir(paises: list[str]) -> str:
    """El país más repetido; Colombia solo si no hay ningún otro."""
    fuera = [p for p in paises if p and p != "Colombia"]
    lista = fuera or [p for p in paises if p]
    return Counter(lista).most_common(1)[0][0] if lista else ""


def pais_desde_documentos() -> dict[str, str]:
    try:
        productos = json.loads(DOCS_FILE.read_text(encoding="utf-8")).get("productos") or {}
    except (OSError, ValueError):
        return {}
    out = {}
    for ref, d in productos.items():
        lotes = [l for l in d.get("lotes") or [] if (l.get("pais_origen") or "").strip()]
        vigentes = [l for l in lotes if l.get("vigente")] or lotes
        if vigentes:
            out[ref.upper()] = canonico(vigentes[-1]["pais_origen"])
    return out


def productos_proveedor() -> list[dict]:
    con = sqlite3.connect(f"file:{PROVEEDORES_DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    filas = con.execute(
        "SELECT nombre, sku_siigo, origen_pais FROM proveedor_productos WHERE origen_pais <> ''"
    ).fetchall()
    con.close()
    return [
        {"sku": (r["sku_siigo"] or "").upper(), "palabras": _palabras(r["nombre"]),
         "pais": canonico(r["origen_pais"]), "nombre": r["nombre"]}
        for r in filas
    ]


def calcular() -> list[dict]:
    from app.services import mapa_producto

    combos = mapa_producto.anatomia_combos().get("combos") or []
    docs = pais_desde_documentos()
    prov = productos_proveedor()
    por_sku: dict[str, list[str]] = {}
    for p in prov:
        if p["sku"]:
            por_sku.setdefault(p["sku"], []).append(p["pais"])

    filas = []
    for c in combos:
        ref = c.get("ref") or ""
        mps = [k.get("codigo") or "" for k in c.get("componentes") or [] if k.get("casilla") == "materia_prima"]
        mp = (c.get("familia") or (mps[0] if mps else "")).upper()
        doc = (c.get("eslabones") or {}).get("documento") or {}
        nombre_mp = doc.get("doc_titulo") or c.get("nombre") or ""

        pais, fuente = docs.get(ref.upper(), ""), "documento técnico"
        if not pais:
            pais, fuente = _elegir(por_sku.get(mp, []) + por_sku.get(ref.upper(), [])), "proveedor (SKU)"
        if not pais:
            mias = _palabras(nombre_mp)
            candidatos = [p for p in prov if len(p["palabras"]) >= 2 and p["palabras"] <= mias]
            pais = _elegir([p["pais"] for p in candidatos])
            fuente = "proveedor (nombre: " + ", ".join(sorted({p["nombre"] for p in candidatos})[:2]) + ")"
        if pais:
            filas.append({"ref": ref, "nombre": nombre_mp, "pais": pais, "fuente": fuente})
    return filas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--aplicar", action="store_true", help="escribir los overrides nuevos en origen_materias.json")
    args = ap.parse_args()

    cfg = cargar_origen_materias(force=True)
    overrides = cfg.get("overrides_sku") or {}
    existentes = {k.upper(): (k, v) for k, v in overrides.items()}
    nuevos: dict[str, str] = {}
    distintos: list[tuple] = []
    for f in calcular():
        previo = existentes.get(f["ref"].upper())
        if previo is None:
            nuevos[f["ref"]] = f["pais"]
            print(f"  + {f['ref']:<24} {f['nombre'][:38]:<38} → {f['pais']:<14} [{f['fuente']}]")
        elif previo[1] != f["pais"]:
            distintos.append((f["ref"], f["nombre"], previo[1], f["pais"], f["fuente"]))

    paises_nuevos = {p for p in nuevos.values() if p not in (cfg.get("paises") or {})}
    sin_coord = sorted(p for p in paises_nuevos if p not in COORDENADAS)
    print(f"\n{len(nuevos)} productos sin país propio reciben el de sus datos.")
    if paises_nuevos:
        print("Países nuevos en el mapa:", ", ".join(sorted(paises_nuevos)))
    if sin_coord:
        print("⚠️  Sin coordenadas (no se agregan hasta completarlas en COORDENADAS):", ", ".join(sin_coord))
    if distintos:
        print(f"\n{len(distintos)} overrides existentes que NO coinciden con los datos (no se tocan):")
        for ref, nom, antes, dato, fuente in distintos:
            print(f"  ≠ {ref:<24} {nom[:38]:<38} mapa: {antes:<14} datos: {dato:<14} [{fuente}]")

    if not args.aplicar:
        print("\nSolo vista previa. Para escribir: --aplicar")
        return 0
    nuevos = {r: p for r, p in nuevos.items() if p not in sin_coord}
    cambios = {"overrides_sku": {**overrides, **nuevos}}
    faltan = {p: COORDENADAS[p] for p in paises_nuevos if p in COORDENADAS}
    if faltan:
        cambios["paises"] = {**(cfg.get("paises") or {}), **faltan}
    guardar_origen_materias(cambios)
    print(f"\nGuardado: {len(nuevos)} overrides nuevos, {len(faltan)} países nuevos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
