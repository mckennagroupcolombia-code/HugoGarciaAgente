"""
Fórmulas → «Leer de pantallazo»: Gemini lee una captura de una fórmula (tabla de
ingredientes con gramos, mililitros, kilos o porcentajes) y aquí se calculan los
porcentajes. La IA solo transcribe; la cuenta la hace Python para que sea exacta.

Si la captura ya trae porcentajes y suman ~100 se usan tal cual; si no, cada
ingrediente vale cantidad / total × 100 (kg, mg y L se pasan a g y mL; g y mL se
suman 1:1, como se pesa en el taller, y se avisa).
"""
from __future__ import annotations

import base64
import re
from typing import Any

_FACTOR = {  # a la unidad base: g o mL
    "g": ("g", 1.0), "gr": ("g", 1.0), "grs": ("g", 1.0), "gramos": ("g", 1.0), "gramo": ("g", 1.0),
    "kg": ("g", 1000.0), "kilos": ("g", 1000.0), "kilo": ("g", 1000.0), "kilogramos": ("g", 1000.0),
    "mg": ("g", 0.001), "miligramos": ("g", 0.001),
    "ml": ("mL", 1.0), "mililitros": ("mL", 1.0), "cc": ("mL", 1.0), "cm3": ("mL", 1.0),
    "l": ("mL", 1000.0), "lt": ("mL", 1000.0), "litros": ("mL", 1000.0), "litro": ("mL", 1000.0),
    "oz": ("g", 28.3495), "lb": ("g", 453.592),
    "gotas": ("mL", 0.05), "gota": ("mL", 0.05),
}

_PROMPT = """Eres un OCR técnico. La imagen es un pantallazo de una FÓRMULA o receta de un
producto (cosmético, alimento, jabón…): una lista o tabla de ingredientes con su cantidad
y/o su porcentaje.

Transcribe CADA ingrediente en el orden en que aparece. NO inventes, NO calcules, NO
completes datos que no se ven. No incluyas filas de TOTAL ni subtotales.

Responde SOLO JSON válido:
{
  "nombre": "título de la fórmula si se ve, si no \\"\\"",
  "ingredientes": [
    {"nombre": "Agua desionizada", "cantidad": 350.5, "unidad": "g", "porcentaje": null}
  ]
}
- "cantidad": número tal como se ve (coma decimal → punto), o null si no hay cantidad.
- "unidad": la unidad escrita (g, kg, mg, mL, L, gotas, oz…), o "" si no se ve.
- "porcentaje": número si la captura muestra el % de ese ingrediente, o null.
- Si la imagen no es una fórmula, responde {"nombre": "", "ingredientes": []}."""


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        n = float(str(v).replace(",", ".").replace("%", "").strip())
    except ValueError:
        return None
    return n if n == n and n >= 0 else None


def _repartir_100(valores: list[float]) -> list[float]:
    """Redondea a 4 decimales y ajusta el más grande para que la suma sea exactamente 100."""
    total = sum(valores)
    if total <= 0:
        return [0.0] * len(valores)
    pct = [round(v * 100 / total, 4) for v in valores]
    k = max(range(len(pct)), key=lambda i: pct[i])
    pct[k] = round(pct[k] + 100 - sum(pct), 4)
    return pct


def calcular(leido: dict) -> dict:
    """De lo transcrito por la IA a filas con porcentaje (separado para poder probarlo sin IA)."""
    filas: list[dict] = []
    for raw in leido.get("ingredientes") or []:
        if not isinstance(raw, dict):
            continue
        nombre = str(raw.get("nombre") or "").strip()[:200]
        if not nombre or re.fullmatch(r"(?i)(sub)?total(es)?", nombre):
            continue
        unidad_txt = str(raw.get("unidad") or "").strip()
        base, factor = _FACTOR.get(unidad_txt.lower().rstrip("."), ("", 1.0))
        cant = _num(raw.get("cantidad"))
        filas.append({
            "nombre": nombre,
            "cantidad": cant,
            "unidad_original": unidad_txt,
            "cantidad_base": cant * factor if cant is not None else None,
            "unidad_base": base,
            "porcentaje_captura": _num(raw.get("porcentaje")),
        })

    avisos: list[str] = []
    if not filas:
        return {"nombre": "", "ingredientes": [], "total": 0, "unidad": "g", "origen": "", "avisos": ["No encontré ingredientes en la imagen."]}

    con_pct = [f["porcentaje_captura"] for f in filas]
    con_cant = [f["cantidad_base"] for f in filas]
    suma_pct = sum(p for p in con_pct if p is not None)
    total = 0.0
    unidad = "g"

    if all(c is not None for c in con_cant) and sum(con_cant) > 0:
        origen = "cantidades"
        unidades = {f["unidad_base"] for f in filas if f["unidad_base"]}
        unidad = "mL" if unidades == {"mL"} else "g"
        if len(unidades) > 1:
            avisos.append("La captura mezcla gramos y mililitros: los sumé 1 a 1 (1 mL ≈ 1 g). Revisa los líquidos densos.")
        if any(not f["unidad_base"] for f in filas):
            avisos.append("Algunas cantidades no tenían unidad legible: las tomé en la misma unidad que las demás.")
        if any(f["unidad_original"].lower().startswith("gota") for f in filas):
            avisos.append("Las gotas se calcularon a 0,05 mL cada una (aproximado).")
        total = sum(con_cant)
        pct = _repartir_100(con_cant)
    elif all(p is not None for p in con_pct) and suma_pct > 0:
        origen = "porcentajes"
        if abs(suma_pct - 100) > 0.5:
            avisos.append(f"Los porcentajes de la captura sumaban {str(round(suma_pct, 2)).replace(".", ",")} %: los ajusté en proporción a 100 %.")
        pct = _repartir_100(con_pct)
    else:
        origen = "mixto"
        # Ingredientes sin cantidad ni %: quedan en 0 para que la persona los complete.
        valores = [f["cantidad_base"] if f["cantidad_base"] is not None else 0.0 for f in filas]
        if sum(valores) > 0:
            total = sum(valores)
            pct = _repartir_100(valores)
        else:
            pct = _repartir_100([p or 0.0 for p in con_pct])
        faltan = [f["nombre"] for f in filas if f["cantidad_base"] is None and f["porcentaje_captura"] is None]
        if faltan:
            avisos.append("Sin cantidad legible (quedan en 0 %): " + ", ".join(faltan[:6]) + ".")

    ingredientes = [
        {
            "nombre": f["nombre"],
            "porcentaje": p,
            "cantidad_captura": (f"{f['cantidad']:g} {f['unidad_original']}".strip() if f["cantidad"] is not None else ""),
        }
        for f, p in zip(filas, pct)
    ]
    return {
        "nombre": str(leido.get("nombre") or "").strip()[:160],
        "ingredientes": ingredientes,
        "total": round(total, 4),
        "unidad": unidad,
        "origen": origen,
        "avisos": avisos,
    }


def leer_captura(data_url: str) -> dict:
    m = re.match(r"^data:(image/[\w.+-]+);base64,(.+)$", (data_url or "").strip(), re.DOTALL)
    if not m:
        raise ValueError("Envía la captura como imagen (PNG, JPG o WEBP).")
    datos = base64.b64decode(m.group(2))
    if len(datos) > 8 * 1024 * 1024:
        raise ValueError("La imagen pesa más de 8 MB.")

    from app.services.documento_scan_tablas import _gemini_vision
    from app.services.gemini_vision import _extraer_json

    texto = _gemini_vision([(datos, m.group(1))], _PROMPT, timeout_s=80, contexto="formulas_captura")
    leido = _extraer_json(texto)
    if not isinstance(leido, dict):
        raise ValueError("La IA no devolvió una lista legible; prueba con una captura más nítida.")
    return calcular(leido)
