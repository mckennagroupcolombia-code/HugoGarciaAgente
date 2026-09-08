"""Marca MANTECA DE CACAO REFINADA 1000g como formulario de etiqueta.

Nombra cada capa (título naranja / valor negro / logo / barcode).
No mueve x/y/fontSize salvo recortes de cajas sobredimensionadas.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path("/home/mckg/mi-agente")
PATH = ROOT / "app/data/plantillas_visuales.json"

CLIP_CAJAS = {
    "0c93c76f-92d": {"width": 153.3, "height": 12.7},
}

# id → (campoProducto | None, nombreCapa, autofit, visible)
TEXTOS = {
    "d6ccd690-b57": ("nombre", "NOMBRE", True, True),
    "0c93c76f-92d": ("tagline", "CATEGORÍA", True, True),
    "bcac9ef6-8c4": (None, "CONCENTRACIÓN (título)", False, True),
    "870ea28d-51c": ("concentracionValor", "CONCENTRACIÓN", True, True),
    "762463a5-2eb": (None, "CAS (título)", False, True),
    "9d9ed4f4-d81": ("casNumero", "CAS", True, True),
    "9b91b3c6-0d5": ("ghs", "GHS", True, True),
    "e344e8ca-ce1": (None, "ORIGEN (título)", False, True),
    "484d6d05-387": ("origen", "ORIGEN", True, True),
    "ee4caa82-7d2": (None, "APARIENCIA (título)", False, True),
    "f1836fd9-92e": ("apariencia", "APARIENCIA", True, True),
    "00b42ccb-2ea": (None, "OLOR (título)", False, True),
    "d9545e81-c32": ("olor", "OLOR", True, True),
    "66e7f153-0b7": (None, "COMPOSICIÓN (título)", False, True),
    "47188ae1-7d2": ("composicion", "COMPOSICIÓN", True, True),
    "e5615835-3b1": (None, "GRADO (título)", False, True),
    "3945abe6-fd1": ("grado", "GRADO", True, True),
    "3203d5c6-c4b": (None, "CONSERVACIÓN (título)", False, True),
    "e5ce96df-64e": ("almacenamiento", "CONSERVACIÓN", True, True),
    "f5a23ab0-2f8": (None, "CONTENIDO NETO (título)", False, True),
    "baa81846-5c7": ("peso", "CONTENIDO NETO", True, True),
    "d8e8a9d4-260": (None, "GRADO (vacío)", False, False),
    "64ea6057-d26": (None, "GHS (vacío)", False, False),
    "972d0412-6d8": (None, "Información técnica", False, True),
    "4a85d122-192": (None, "TDS - COA", False, True),
    "970c85a3-ddd": (None, "Disponible en", False, True),
    "a389866d-22f": (None, "Sitio web", False, True),
    "eb49da27-3ec": (None, "Ciudad", False, True),
    "3e264f28-bf1": (None, "Teléfono", False, True),
    "76d2310f-c74": (None, "Correo", False, True),
}

# id → (rolCapa, nombreCapa)
IMAGENES = {
    "36fe30e4-a41": ("logo", "LOGO"),
    "96906f34-997": ("barcode", "CÓDIGO DE BARRAS"),
    "87409e9e-f48": ("icono", "Icono ORIGEN"),
    "382f52b2-ebe": ("icono", "Icono APARIENCIA"),
    "761a2b2b-72e": ("icono", "Icono OLOR"),
    "9a6c561b-dfb": ("icono", "Icono COMPOSICIÓN"),
    "99b9ba0e-91b": ("icono", "Icono GRADO"),
    "57830dca-e2c": ("icono", "Icono CONSERVACIÓN"),
    "704645b4-c9c": ("icono", "Icono ubicación"),
    "39c504bd-0fb": ("icono", "Icono teléfono"),
    "fe135ab0-dd7": ("icono", "Icono correo"),
}

PLANTILLA_ID = "24191d5d-bea"


def _dump_item(obj: dict) -> str:
    dumped = json.dumps(obj, ensure_ascii=False, indent=2)
    lines = dumped.splitlines()
    return "\n".join([lines[0], *("    " + ln for ln in lines[1:])])


def _reemplazar_primer_objeto_array(raw: str, array_key: str, nuevo_obj: dict) -> str:
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
    vistos_t: set[str] = set()
    vistos_i: set[str] = set()
    for el in plantilla.get("elementos") or []:
        eid = el.get("id")
        if el.get("type") == "text" and eid in TEXTOS and eid not in vistos_t:
            vistos_t.add(eid)
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
                el.update(clip)
        elif el.get("type") == "image" and eid in IMAGENES and eid not in vistos_i:
            vistos_i.add(eid)
            rol, capa = IMAGENES[eid]
            el["rolCapa"] = rol
            el["nombreCapa"] = capa
    missing_t = set(TEXTOS) - vistos_t
    missing_i = set(IMAGENES) - vistos_i
    if missing_t or missing_i:
        raise SystemExit(f"Faltan textos={missing_t} imagenes={missing_i}")
    PATH.write_text(
        _reemplazar_primer_objeto_array(raw, "plantillas", plantilla)
        + ("" if raw.endswith("\n") else "\n"),
        encoding="utf-8",
    )
    print(
        f"OK {PLANTILLA_ID}: {len(vistos_t)} textos, {len(vistos_i)} imágenes, formulario=true"
    )


if __name__ == "__main__":
    main()
