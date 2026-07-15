#!/usr/bin/env python3
"""Registro masivo de EAN para combos SIIGO (C-) faltantes en la planilla."""
from __future__ import annotations

import json
import shutil
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path

from app.services.siigo import listar_productos_combo_siigo
from app.tools.etiquetas_codigos_ean import (
    anio_bimestre_actual,
    normalizar_sku_ean,
    presentacion_ean_desde_sku,
    siguiente_numero_producto,
)

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "app" / "data" / "etiquetas_codigos_ean.json"


def ean_check(d12: str) -> int:
    s = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(d12))
    return (10 - (s % 10)) % 10


def main() -> None:
    backup = PATH.with_suffix(".json.bak_pre_masivo")
    shutil.copy2(PATH, backup)
    print("backup:", backup)

    data = json.loads(PATH.read_text(encoding="utf-8"))
    items = data.get("codigos") or []
    existentes = {normalizar_sku_ean(str(c.get("sku") or "")) for c in items}
    numeros = [int(c.get("numero_producto") or 0) for c in items]
    anio, bimestre = anio_bimestre_actual()

    combos = listar_productos_combo_siigo()
    candidatos = []
    for p in combos:
        code = (p.get("code") or "").strip()
        if not code.upper().startswith("C-"):
            continue
        if normalizar_sku_ean(code) in existentes:
            continue
        candidatos.append(p)
    candidatos.sort(key=lambda p: normalizar_sku_ean(p.get("code") or ""))

    print(
        f"a registrar: {len(candidatos)} | desde #{siguiente_numero_producto(numeros)} "
        f"| anio={anio} bim={bimestre}"
    )
    for code, name in [
        ("C-INUKg", "INULINA"),
        ("C-CLOMAGHEXKg", "CLORURO"),
        ("C-ACEARG50mL", "50"),
        ("C-MENCRI100g", "100"),
        ("C-TEGBETLt", "TEGO Lt"),
    ]:
        print(f"  check {code} -> {presentacion_ean_desde_sku(code, name)}")

    creados = []
    for p in candidatos:
        code = (p.get("code") or "").strip()
        nombre = (p.get("name") or "").strip()
        num = siguiente_numero_producto(numeros)
        if num is None:
            print("LÍMITE 900 alcanzado")
            break
        presentacion = presentacion_ean_desde_sku(code, nombre)
        d12 = f"770{num:03d}{presentacion}{anio:02d}{bimestre}"
        entry = {
            "id": uuid.uuid4().hex[:12],
            "sku": code,
            "nombre_producto": nombre,
            "numero_producto": num,
            "presentacion": presentacion,
            "anio": anio,
            "bimestre": bimestre,
            "codigo": f"{d12}{ean_check(d12)}",
            "creado_at": datetime.now().isoformat(timespec="seconds"),
        }
        items.append(entry)
        numeros.append(num)
        existentes.add(normalizar_sku_ean(code))
        creados.append(entry)

    items.sort(key=lambda x: x.get("numero_producto") or 0)
    PATH.write_text(
        json.dumps({"codigos": items}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    pres = Counter(e["presentacion"] for e in creados)
    print(f"OK creados={len(creados)} total_planilla={len(items)} siguiente={siguiente_numero_producto(numeros)}")
    print("presentaciones:", dict(sorted(pres.items())))
    print("muestra primeros 8:")
    for e in creados[:8]:
        print(
            f"  #{e['numero_producto']:03d} {e['sku']} [{e['presentacion']}] "
            f"{e['codigo']} | {e['nombre_producto'][:40]}"
        )
    zeros = [e for e in creados if e["presentacion"] == "000"]
    print(f"con presentacion 000: {len(zeros)}")
    for e in zeros:
        print(f"  {e['sku']} | {e['nombre_producto'][:50]}")


if __name__ == "__main__":
    main()
