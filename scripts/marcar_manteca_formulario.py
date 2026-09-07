"""Marca MANTECA DE CACAO REFINADA 1000g como formulario de etiqueta.

Solo muta esa plantilla (id 24191d5d-bea). No mueve x/y/fontSize.
Recorta width/height de cajas que el scan dejó más grandes que el dibujo.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path("/home/mckg/mi-agente")
PATH = ROOT / "app/data/plantillas_visuales.json"

# Recorta cajas que el scan dejó más grandes que el dibujo (si no, el
# autofit escribe sobre Concentración / logo). No mueve x/y ni fontSize.
CLIP_CAJAS = {
    # Barra naranja tagline (9.7,56.9,155.3×15.9) — no invadir columna CAS.
    "0c93c76f-92d": {"width": 153.3, "height": 12.7},
}

# id de texto → (campoProducto | None, nombreCapa, autofit, visible)
TEXTOS = {
    "d6ccd690-b57": ("nombre", "Nombre del producto", True, True),
    "0c93c76f-92d": ("tagline", "Tagline / grado", True, True),
    "870ea28d-51c": ("concentracionValor", "Concentración", True, True),
    "9d9ed4f4-d81": ("casNumero", "Número CAS", True, True),
    "9b91b3c6-0d5": ("ghs", "GHS", True, True),
    "484d6d05-387": ("origen", "Origen", True, True),
    "f1836fd9-92e": ("apariencia", "Apariencia", True, True),
    "d9545e81-c32": ("olor", "Olor", True, True),
    "47188ae1-7d2": ("composicion", "Composición", True, True),
    "3945abe6-fd1": ("grado", "Grado", True, True),
    "e5ce96df-64e": ("almacenamiento", "Conservación", True, True),
    "baa81846-5c7": ("peso", "Contenido neto", True, True),
    # Caja vacía que se superponía a "Alimentario"
    "d8e8a9d4-260": (None, "Grado (vacío)", False, False),
}

PLANTILLA_ID = "24191d5d-bea"


def _dump_item(obj: dict) -> str:
    """Serializa un objeto ya posicionado en el `{` de un ítem de array (indent 4)."""
    dumped = json.dumps(obj, ensure_ascii=False, indent=2)
    lines = dumped.splitlines()
    return "\n".join([lines[0], *("    " + ln for ln in lines[1:])])


def _reemplazar_primer_objeto_array(raw: str, array_key: str, nuevo_obj: dict) -> str:
    """Sustituye el primer objeto de `array_key` sin re-serializar el resto del JSON."""
    marker = f'"{array_key}": ['
    i = raw.find(marker)
    if i < 0:
        raise SystemExit(f"No se encontró {array_key}")
    j = i + len(marker)
    while j < len(raw) and raw[j] in " \t\r\n":
        j += 1
    if raw[j] != "{":
        raise SystemExit("El array no empieza con un objeto")
    depth = 0
    in_str = False
    esc = False
    k = j
    while k < len(raw):
        ch = raw[k]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    k += 1
                    break
        k += 1
    return raw[:j] + _dump_item(nuevo_obj) + raw[k:]


def main() -> None:
    raw = PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    plantilla = next(p for p in data["plantillas"] if p.get("id") == PLANTILLA_ID)
    plantilla["formulario"] = True
    plantilla["sku"] = plantilla.get("sku") or "C-MANCACREFKG"
    vistos: set[str] = set()
    for el in plantilla.get("elementos") or []:
        if el.get("type") != "text":
            continue
        eid = el.get("id")
        if eid not in TEXTOS or eid in vistos:
            continue
        vistos.add(eid)
        campo, capa, autofit, visible = TEXTOS[eid]
        el["nombreCapa"] = capa
        el["visible"] = visible
        if campo:
            el["campoProducto"] = campo
            el["autofit"] = autofit
            if autofit and "minFontSize" not in el:
                el["minFontSize"] = max(4.0, round(float(el.get("fontSize") or 6) * 0.55, 2))
        clip = CLIP_CAJAS.get(eid)
        if clip:
            for k, v in clip.items():
                el[k] = v
    missing = set(TEXTOS) - vistos
    if missing:
        raise SystemExit(f"No se encontraron textos: {missing}")
    PATH.write_text(_reemplazar_primer_objeto_array(raw, "plantillas", plantilla) + (
        "" if raw.endswith("\n") else "\n"
    ), encoding="utf-8")
    print(f"OK {PLANTILLA_ID}: {len(vistos)} textos marcados, formulario=true")


if __name__ == "__main__":
    main()
