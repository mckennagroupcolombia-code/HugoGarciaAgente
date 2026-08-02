"""OCR de pantallazos de compras en el exterior → costos unitarios COP (landed).

Extrae líneas con Gemini Vision y prorratea flete opcional por valor de línea.
Si la compra es por sets/packs (ej. 3 sets de 100 pcs = 300 unidades), el costo
unitario se calcula sobre las unidades reales, no sobre el set.
"""
from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any

log = logging.getLogger(__name__)

PROMPT_COMPRA_EXTERIOR = """\
Eres contador de McKenna Group S.A.S. Analiza este pantallazo o documento de una
compra / cotización / invoice / pedido a proveedor en el exterior (Alibaba, China,
USA, Temu, etc.) o marketplace.

Extrae las líneas de producto y responde SOLO JSON válido con este esquema:
{
  "moneda": "USD",
  "proveedor": "",
  "referencia": "",
  "flete_detectado": null,
  "moneda_flete": null,
  "lineas": [
    {
      "nombre": "nombre del producto",
      "cantidad": 3,
      "unidades_por_pack": 100,
      "unidad": "pcs",
      "precio_unit": 166.62,
      "subtotal": 499.86
    }
  ]
}

Reglas CRÍTICAS:
- moneda: código ISO visible (USD, CNY, EUR, COP…). Si el formato usa punto de miles
  y coma decimal (ej. $166.623,00) y parece Colombia/Latam, usa "COP". Si no aparece, "USD".
- cantidad = cuántos SETS/PACKS/JUEGOS se compraron (el "x3" del pantallazo), NO las piezas sueltas.
- unidades_por_pack = piezas/unidades DENTRO de cada set (ej. "100pcs", "100 pcs",
  "pack of 50", "50 unidades", "juego de 10"). Si el producto es unitario (1 pieza), usa 1.
- precio_unit = precio de UN set/pack (el que aparece junto a xN), número plano sin miles.
- subtotal = total de la línea (cantidad × precio_unit del set). Si ves Subtotal/Total de línea, úsalo.
- Ejemplo: "mascara tubes, 100pcs" a $166.62 x3 → cantidad=3, unidades_por_pack=100,
  precio_unit=166.62, subtotal=499.86. Unidades reales = 300; el costo por pieza se
  calculará después como subtotal/300.
- Números: usa punto decimal y SIN separador de miles (166623.00 o 166.62, no 166.623,00).
- flete_detectado: número si ves shipping/freight/flete; si no, null.
- Omite impuestos, descuentos genéricos y totales globales del pedido.
- Sin markdown. Solo JSON.
"""

_RE_PACK = re.compile(
    r"(?:"
    r"(\d+)\s*(?:pcs|pc|pieces?|piezas?|uds?|unidades?|units?)\b"
    r"|"
    r"(?:pack|set|juego|caja|box|lot)\s*(?:de|of|of\s+)?\s*(\d+)"
    r"|"
    r"(\d+)\s*(?:-?\s*)?(?:pack|set|juego|pcs|piezas)"
    r")",
    re.IGNORECASE,
)


def _mime_from_bytes(data: bytes) -> str:
    if data[:4] == b"%PDF":
        return "application/pdf"
    if data[:4] == b"\x89PNG":
        return "image/png"
    if len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:3] == b"GIF":
        return "image/gif"
    return "image/jpeg"


def _extraer_json(texto: str) -> dict[str, Any]:
    raw = (texto or "").strip()
    if not raw:
        return {}
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}


def _num(v: Any, default: float = 0.0) -> float:
    """Parsea números; soporta formato latam 1.234,56 y US 1,234.56."""
    if v is None or v == "":
        return default
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    s = re.sub(r"[^\d.,\-]", "", s)
    if not s or s in "-.,":
        return default
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            # 1.234,56 → 1234.56
            s = s.replace(".", "").replace(",", ".")
        else:
            # 1,234.56 → 1234.56
            s = s.replace(",", "")
    elif "," in s:
        # Solo coma: si hay exactamente 3 dígitos tras la coma → miles; si 1-2 → decimal
        parts = s.split(",")
        if len(parts[-1]) == 3 and len(parts) == 2 and "." not in s:
            # ambigua: 166,623 podría ser miles → preferir miles si ≥3 dígitos enteros
            s = s.replace(",", "")
        else:
            s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return default


def inferir_unidades_por_pack(nombre: str, unidad: str = "", explicit: Any = None) -> float:
    """Infere piezas por set desde campo explícito o texto (100pcs, pack of 50…)."""
    if explicit is not None and str(explicit).strip() != "":
        n = _num(explicit, 0.0)
        if n > 0:
            return n
    blob = f"{nombre} {unidad}"
    m = _RE_PACK.search(blob)
    if m:
        for g in m.groups():
            if g:
                n = _num(g, 0.0)
                if n > 0:
                    return n
    return 1.0


def normalizar_lineas(raw_lineas: list | None) -> list[dict[str, Any]]:
    """Normaliza líneas OCR; calcula unidades_totales = cantidad × unidades_por_pack."""
    out: list[dict[str, Any]] = []
    for i, item in enumerate(raw_lineas or []):
        if not isinstance(item, dict):
            continue
        nombre = str(item.get("nombre") or item.get("name") or "").strip()
        if not nombre:
            continue
        cantidad = _num(
            item.get("cantidad")
            if item.get("cantidad") is not None
            else item.get("qty"),
            0.0,
        )
        precio_unit = _num(item.get("precio_unit") or item.get("precio"), 0.0)
        subtotal = _num(item.get("subtotal"), 0.0)
        if subtotal <= 0 and cantidad > 0 and precio_unit > 0:
            subtotal = round(cantidad * precio_unit, 6)
        if precio_unit <= 0 and cantidad > 0 and subtotal > 0:
            precio_unit = round(subtotal / cantidad, 6)
        if cantidad <= 0 and precio_unit > 0 and subtotal > 0:
            cantidad = round(subtotal / precio_unit, 6)
        if cantidad <= 0:
            cantidad = 1.0
        unidad = str(item.get("unidad") or item.get("unit") or "un").strip() or "un"
        upp = inferir_unidades_por_pack(
            nombre,
            unidad,
            item.get("unidades_por_pack")
            or item.get("pcs_por_set")
            or item.get("piezas_por_set"),
        )
        if upp <= 0:
            upp = 1.0
        unidades_totales = round(cantidad * upp, 6)
        out.append(
            {
                "id": f"L{i + 1}",
                "nombre": nombre,
                "cantidad": cantidad,
                "unidades_por_pack": upp,
                "unidades_totales": unidades_totales,
                "unidad": unidad,
                "precio_unit": precio_unit,
                "subtotal": subtotal if subtotal > 0 else round(cantidad * precio_unit, 6),
            }
        )
    return out


def calcular_landed(
    lineas: list[dict[str, Any]],
    *,
    trm: float,
    flete: float = 0.0,
    moneda: str = "USD",
    moneda_flete: str | None = None,
) -> list[dict[str, Any]]:
    """
    Costo unitario COP por pieza/unidad mínima:

    unidades_totales = cantidad_sets × unidades_por_pack
    costo_unitario_cop = (subtotal_cop + flete_asignado_cop) / unidades_totales

    Flete prorrateado por valor de línea (subtotal).
    """
    mon = (moneda or "USD").strip().upper() or "USD"
    mon_f = (moneda_flete or mon).strip().upper() or mon
    rate = 1.0 if mon == "COP" else max(float(trm or 0), 0.0)
    if mon != "COP" and rate <= 0:
        rate = 0.0

    flete_val = max(float(flete or 0), 0.0)
    if flete_val > 0:
        if mon_f == "COP":
            flete_cop = flete_val
        elif mon_f == mon:
            flete_cop = flete_val * (1.0 if mon == "COP" else rate)
        else:
            flete_cop = flete_val * (1.0 if mon_f == "COP" else rate)
    else:
        flete_cop = 0.0

    suma = sum(max(_num(l.get("subtotal")), 0.0) for l in lineas)
    result: list[dict[str, Any]] = []
    for linea in lineas:
        cantidad = max(_num(linea.get("cantidad")), 0.0) or 1.0
        upp = max(_num(linea.get("unidades_por_pack"), 1.0), 1.0)
        unidades_totales = max(
            _num(linea.get("unidades_totales"), 0.0),
            cantidad * upp,
            1.0,
        )
        precio_unit = _num(linea.get("precio_unit"))
        subtotal = max(_num(linea.get("subtotal")), 0.0)
        if subtotal <= 0:
            subtotal = round(cantidad * precio_unit, 6)
        peso = (subtotal / suma) if suma > 0 else (1.0 / len(lineas) if lineas else 0.0)
        subtotal_cop = subtotal * (1.0 if mon == "COP" else rate)
        flete_asig = flete_cop * peso if flete_cop > 0 else 0.0
        costo = round((subtotal_cop + flete_asig) / unidades_totales, 4)
        result.append(
            {
                **linea,
                "cantidad": cantidad,
                "unidades_por_pack": upp,
                "unidades_totales": unidades_totales,
                "subtotal": subtotal,
                "peso_flete": round(peso, 6),
                "flete_asignado_cop": round(flete_asig, 4),
                "subtotal_cop": round(subtotal_cop, 4),
                "costo_unitario_cop": costo,
            }
        )
    return result


def extraer_compra_desde_imagen(
    data: bytes,
    *,
    trm: float | None = None,
    flete: float | None = None,
    moneda_flete: str | None = None,
    timeout_s: float = 50.0,
) -> dict[str, Any]:
    """Llama Gemini Vision y devuelve líneas + landed cost si hay TRM/flete."""
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return {"error": "GOOGLE_API_KEY no configurada"}
    if not data:
        return {"error": "Imagen vacía"}

    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        return {"error": "google-genai no instalado"}

    mime = _mime_from_bytes(data)

    def _llamar():
        client = genai.Client(api_key=api_key)
        model = os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
        return client.models.generate_content(
            model=model,
            contents=[gtypes.Part.from_bytes(data=data, mime_type=mime), PROMPT_COMPRA_EXTERIOR],
        )

    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_llamar)
            response = fut.result(timeout=timeout_s)
    except FutureTimeout:
        return {"error": "Gemini tardó demasiado — intente con un archivo más pequeño"}
    except Exception as e:
        log.exception("compra_exterior_ocr Gemini falló")
        return {"error": str(e)}

    parsed = _extraer_json(getattr(response, "text", None) or "")
    if not parsed:
        return {"error": "No se pudo interpretar la respuesta de Gemini", "raw": getattr(response, "text", "")}

    moneda = str(parsed.get("moneda") or "USD").strip().upper() or "USD"
    lineas = normalizar_lineas(parsed.get("lineas") if isinstance(parsed.get("lineas"), list) else [])
    flete_det = parsed.get("flete_detectado")
    flete_det_n = _num(flete_det) if flete_det is not None else None
    mon_flete_det = parsed.get("moneda_flete")
    mon_flete_det_s = str(mon_flete_det).strip().upper() if mon_flete_det else None

    trm_eff = float(trm) if trm is not None and float(trm) > 0 else (1.0 if moneda == "COP" else 0.0)
    flete_eff = float(flete) if flete is not None else (flete_det_n or 0.0)
    mon_flete_eff = (moneda_flete or mon_flete_det_s or moneda).strip().upper()

    lineas_landed = (
        calcular_landed(
            lineas,
            trm=trm_eff if trm_eff > 0 else 1.0,
            flete=flete_eff,
            moneda=moneda,
            moneda_flete=mon_flete_eff,
        )
        if lineas and (moneda == "COP" or trm_eff > 0)
        else [
            {
                **l,
                "peso_flete": 0.0,
                "flete_asignado_cop": 0.0,
                "subtotal_cop": None,
                "costo_unitario_cop": None,
            }
            for l in lineas
        ]
    )

    return {
        "moneda": moneda,
        "proveedor": str(parsed.get("proveedor") or "").strip(),
        "referencia": str(parsed.get("referencia") or "").strip(),
        "flete_detectado": flete_det_n,
        "moneda_flete_detectada": mon_flete_det_s,
        "lineas": lineas,
        "lineas_landed": lineas_landed,
        "trm_usada": trm_eff if trm_eff > 0 else None,
        "flete_usado": flete_eff,
        "moneda_flete_usada": mon_flete_eff,
    }
