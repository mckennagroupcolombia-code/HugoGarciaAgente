"""OCR de pantallazos de compras en el exterior → costos unitarios COP (landed).

Extrae líneas con Gemini Vision y prorratea flete opcional por unidades compradas
(packs × contenido ml/g/un), no por valor monetario de la línea.

Unidad base obligatoria: ml | g | un
  - ml / g: materia prima → costo real por mililitro o por gramo
  - un: piezas/envases → costo por unidad suelta

unidades_totales = cantidad_packs × contenido_por_pack
costo_unitario_cop = (subtotal_neto_cop + flete_asignado) / unidades_totales
"""
from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any

log = logging.getLogger(__name__)

UNIDADES_BASE = frozenset({"ml", "g", "un"})

PROMPT_COMPRA_EXTERIOR = """\
Eres contador de McKenna Group S.A.S. Analiza este pantallazo o documento de una
compra / cotización / invoice / pedido a proveedor en el exterior (Alibaba, China,
USA, Temu, etc.) o marketplace.

Extrae las líneas de producto y responde SOLO JSON válido con este esquema:
{
  "moneda": "USD",
  "fecha_compra": "2026-08-01",
  "proveedor": "",
  "referencia": "",
  "flete_detectado": null,
  "moneda_flete": null,
  "descuento_detectado": null,
  "descuento_pct": null,
  "lineas": [
    {
      "nombre": "nombre del producto",
      "cantidad": 3,
      "unidades_por_pack": 500,
      "unidad": "ml",
      "precio_unit": 12.5,
      "subtotal": 37.5,
      "descuento": 0,
      "descuento_pct": null
    }
  ]
}

Reglas de FECHA:
- fecha_compra: fecha del invoice/pedido en formato YYYY-MM-DD (Order date, Invoice date,
  Date, Fecha). Si solo ves día/mes, usa el año más probable del documento. Si no aparece, null.

Reglas CRÍTICAS de UNIDAD (solo una de: ml, g, un):
- unidad = "ml" si el producto es líquido con volumen (500ml, 1L, 30 mL, litros…).
  unidades_por_pack = mililitros por cada ítem/pack comprado (1L → 1000, 500ml → 500).
- unidad = "g" si es sólido/polvo con peso (250g, 1kg, 500 gramos…).
  unidades_por_pack = gramos por ítem (1kg → 1000, 250g → 250).
- unidad = "un" si son piezas/envases/sets sin volumen ni peso de materia prima
  (100pcs, pack of 50, frascos, tubos, tapas). unidades_por_pack = piezas por set
  (100pcs → 100; si es 1 pieza unitaria → 1).
- Si aparecen pcs Y ml/g (ej. "100 bottles 500ml glycerin"):
  · materia prima líquida/sólida → preferir ml o g (contenido del envase).
  · solo empaque vacío → preferir un (conteo de piezas).
- cantidad = cuántos SETS/PACKS/ítems se compraron (el "x3" del pantallazo), NO el
  contenido interno.
- precio_unit = precio de UN set/pack/ítem ANTES de descuento (list price / unit price).
- subtotal = cantidad × precio_unit ANTES de descuento de línea.
- descuento (por línea) = monto ABSOLUTO descontado en esa línea (Discount -$X).
  Si solo ves %, usa descuento_pct (ej. 10) y deja descuento en 0.
- Si el total de línea ya viene neto (tras promo), calcula descuento = subtotal − neto
  y reporta ambos.

Reglas de DESCUENTO DEL PEDIDO (obligatorio si aparece):
- descuento_detectado: monto ABSOLUTO del descuento global (Coupon, Promo, Discount,
  Store coupon, Seller discount, Save $X, -$X). Número positivo (10.5 = $10.50 off).
- descuento_pct: si el descuento global es porcentaje (10% off) y no hay monto, pon 10.
- NO omitas descuentos: deben aplicarse al costo real.
- NO trates el descuento como línea de producto.

Ejemplos:
  · "Glycerin 500ml" × 10 a $5, cupón −$8 → cantidad=10, precio_unit=5, subtotal=50,
    descuento_detectado=8. Costo sobre (50−8).
  · Línea con 20% off: precio_unit=10, cantidad=2, subtotal=20, descuento_pct=20
    → descuento de línea = 4; neto = 16.

Otras reglas:
- moneda: código ISO visible (USD, CNY, EUR, COP…). Si el formato usa punto de miles
  y coma decimal (ej. $166.623,00) y parece Colombia/Latam, usa "COP". Si no aparece, "USD".
- Números: usa punto decimal y SIN separador de miles (166623.00 o 166.62, no 166.623,00).
- flete_detectado: número si ves shipping/freight/flete; si no, null.
- Omite impuestos y totales globales (salvo para inferir descuento = merchandise − goods paid).
- Sin markdown. Solo JSON.
"""

# Volumen → ml
_RE_ML = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(?:m\.?\s*l\.?|mililitros?)\b",
    re.IGNORECASE,
)
_RE_L = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?\b|l)\b(?!\s*b\b)",  # 1L; no lb
    re.IGNORECASE,
)

# Peso → g
_RE_G = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(?:gramos?|grs?|g)\b(?!\s*[/.a-z])",  # 250g / UREA250g; no g/ml
    re.IGNORECASE,
)
_RE_KG = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|kilogramos?)\b",
    re.IGNORECASE,
)

# Piezas → un
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

_RE_UNIDAD_TOKEN = re.compile(
    r"^(?:m\.?l\.?|mililitros?|l|lt|litros?|g|grs?|gramos?|kg|kilos?|"
    r"pcs?|piezas?|uds?|unidades?|units?|un)$",
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
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts[-1]) == 3 and len(parts) == 2 and "." not in s:
            s = s.replace(",", "")
        else:
            s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return default


def normalizar_unidad_base(unidad: str | None) -> str | None:
    """Mapea sinónimos a ml | g | un. None si no se reconoce."""
    u = (unidad or "").strip().lower().replace(" ", "")
    if not u:
        return None
    if u in UNIDADES_BASE:
        return u
    if u in ("m.l.", "m.l", "mililitro", "mililitros", "l", "lt", "litro", "litros"):
        return "ml"
    if u in ("gr", "grs", "gramo", "gramos", "kg", "kilo", "kilos", "kilogramo", "kilogramos"):
        return "g"
    if u in (
        "pcs", "pc", "pieza", "piezas", "ud", "uds", "unidad", "unidades",
        "unit", "units", "set", "sets", "pack", "packs", "bottle", "bottles",
        "frasco", "frascos", "tubo", "tubos",
    ):
        return "un"
    if _RE_UNIDAD_TOKEN.match(u):
        if "l" in u and "g" not in u and "k" not in u:
            return "ml"
        if u.startswith("g") or "kg" in u or "gram" in u:
            return "g"
        return "un"
    return None


def _primer_match_num(regex: re.Pattern[str], blob: str) -> float | None:
    m = regex.search(blob)
    if not m:
        return None
    n = _num(m.group(1), 0.0)
    return n if n > 0 else None


def inferir_unidad_y_contenido(
    nombre: str,
    unidad: str = "",
    *,
    explicit_contenido: Any = None,
    preferir: str | None = None,
) -> tuple[str, float]:
    """
    Detecta unidad base (ml|g|un) y contenido por pack desde el texto.

    Returns:
        (unidad_base, contenido_por_pack) — contenido siempre en la unidad base
        (ml, g o piezas).
    """
    blob = f"{nombre} {unidad}".strip()
    unidad_norm = normalizar_unidad_base(unidad)

    ml_val = _primer_match_num(_RE_ML, blob)
    if ml_val is None:
        l_val = _primer_match_num(_RE_L, blob)
        if l_val is not None:
            ml_val = l_val * 1000.0

    g_val = _primer_match_num(_RE_G, blob)
    kg_val = _primer_match_num(_RE_KG, blob)
    if kg_val is not None:
        g_from_kg = kg_val * 1000.0
        g_val = g_from_kg if g_val is None else max(g_val, g_from_kg)

    pcs_val: float | None = None
    m_pack = _RE_PACK.search(blob)
    if m_pack:
        for grp in m_pack.groups():
            if grp:
                n = _num(grp, 0.0)
                if n > 0:
                    pcs_val = n
                    break

    explicit = None
    if explicit_contenido is not None and str(explicit_contenido).strip() != "":
        explicit = _num(explicit_contenido, 0.0)
        if explicit <= 0:
            explicit = None

    pref = normalizar_unidad_base(preferir) if preferir else None

    # Contenido efectivo: si OCR manda 1 genérico, preferir el del texto
    def _contenido(detectado: float) -> float:
        if explicit is not None and explicit > 1:
            return float(explicit)
        return float(detectado)

    # Señales en texto primero (ml / g / pcs)
    if ml_val is not None:
        if pcs_val is not None and pcs_val >= 10 and ml_val <= 1000:
            if re.search(
                r"\b(glycer|oil|acid|extract|serum|agua|water|alcohol|solvent|"
                r"urea|powder|sal|aceite|glicer|hidrolat|tonic)\b",
                blob,
                re.I,
            ):
                return "ml", _contenido(ml_val)
            if re.search(r"\b(bottle|tubo|tube|frasco|vial|jar|dropper|gotero|tapa|cap)\b", blob, re.I):
                return "un", _contenido(pcs_val)
        if pref == "un" and pcs_val is not None and not re.search(
            r"\b(glycer|oil|acid|extract|serum|agua|water|alcohol|aceite|glicer)\b", blob, re.I
        ):
            return "un", _contenido(pcs_val)
        return "ml", _contenido(ml_val)

    if g_val is not None:
        if pcs_val is not None and pcs_val >= 10 and g_val <= 5000:
            if re.search(
                r"\b(urea|powder|sal|acid|extract|wax|cera|manteca|butter|clay|"
                r"arcilla|polvo|cristales?)\b",
                blob,
                re.I,
            ):
                return "g", _contenido(g_val)
            if re.search(r"\b(bottle|tubo|tube|frasco|bag|bolsa|sachet)\b", blob, re.I):
                return "un", _contenido(pcs_val)
        return "g", _contenido(g_val)

    if pcs_val is not None:
        return "un", _contenido(pcs_val)

    if pref in UNIDADES_BASE and explicit is not None:
        return pref, float(explicit)
    if unidad_norm in UNIDADES_BASE:
        return unidad_norm, float(explicit) if explicit is not None else 1.0
    if explicit is not None:
        return unidad_norm or "un", float(explicit)
    return "un", 1.0


def inferir_unidades_por_pack(nombre: str, unidad: str = "", explicit: Any = None) -> float:
    """Compat: solo el contenido numérico (ml, g o piezas según el texto)."""
    _, contenido = inferir_unidad_y_contenido(nombre, unidad, explicit_contenido=explicit)
    return contenido


def normalizar_lineas(raw_lineas: list | None) -> list[dict[str, Any]]:
    """Normaliza líneas OCR; calcula unidades_totales = cantidad × contenido."""
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

        unidad_raw = str(item.get("unidad") or item.get("unit") or "").strip()
        unidad, upp = inferir_unidad_y_contenido(
            nombre,
            unidad_raw,
            explicit_contenido=item.get("unidades_por_pack")
            or item.get("pcs_por_set")
            or item.get("piezas_por_set")
            or item.get("contenido"),
            preferir=unidad_raw or None,
        )
        if upp <= 0:
            upp = 1.0
        unidades_totales = round(cantidad * upp, 6)

        desc_linea = max(_num(item.get("descuento") or item.get("discount"), 0.0), 0.0)
        desc_pct = _num(item.get("descuento_pct") or item.get("discount_pct"), 0.0)
        if desc_linea <= 0 and desc_pct > 0:
            desc_linea = round(subtotal * min(desc_pct, 100.0) / 100.0, 6)
        desc_linea = min(desc_linea, subtotal) if subtotal > 0 else desc_linea

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
                "descuento": desc_linea,
                "descuento_pct": desc_pct if desc_pct > 0 else None,
            }
        )
    return out


def _monto_a_cop(monto: float, moneda: str, rate: float) -> float:
    mon = (moneda or "USD").strip().upper() or "USD"
    if mon == "COP":
        return float(monto)
    return float(monto) * max(rate, 0.0)


def calcular_landed(
    lineas: list[dict[str, Any]],
    *,
    trm: float,
    flete: float = 0.0,
    moneda: str = "USD",
    moneda_flete: str | None = None,
    descuento: float = 0.0,
    descuento_pct: float | None = None,
    moneda_descuento: str | None = None,
) -> list[dict[str, Any]]:
    """
    Costo unitario COP sobre el neto tras descuentos:

    subtotal_neto = subtotal − descuento_línea − descuento_pedido_prorrateado
    flete se reparte por unidades compradas (packs × contenido), no por valor.
    costo = (precio_neto_pack_cop + flete_por_pack) / contenido
          = (subtotal_neto_cop + flete_línea) / unidades_totales
    """
    mon = (moneda or "USD").strip().upper() or "USD"
    mon_f = (moneda_flete or mon).strip().upper() or mon
    mon_d = (moneda_descuento or mon).strip().upper() or mon
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

    # Brutos, descuentos de línea y unidades compradas (para prorratear flete)
    brutos: list[float] = []
    desc_lineas: list[float] = []
    unidades_lineas: list[float] = []
    for l in lineas:
        cantidad = max(_num(l.get("cantidad")), 0.0) or 1.0
        upp = max(_num(l.get("unidades_por_pack"), 1.0), 0.0) or 1.0
        precio_unit = _num(l.get("precio_unit"))
        subtotal = max(_num(l.get("subtotal")), 0.0)
        if subtotal <= 0:
            subtotal = round(cantidad * precio_unit, 6)
        d_lin = max(_num(l.get("descuento")), 0.0)
        d_pct = _num(l.get("descuento_pct"), 0.0)
        if d_lin <= 0 and d_pct > 0:
            d_lin = round(subtotal * min(d_pct, 100.0) / 100.0, 6)
        d_lin = min(d_lin, subtotal) if subtotal > 0 else 0.0
        brutos.append(subtotal)
        desc_lineas.append(d_lin)
        unidades_lineas.append(max(cantidad * upp, 0.0))

    suma_bruta = sum(brutos)
    suma_unidades = sum(unidades_lineas)
    # Descuento de pedido (absoluto o % sobre suma bruta)
    desc_pedido = max(float(descuento or 0), 0.0)
    if desc_pedido <= 0 and descuento_pct is not None and float(descuento_pct or 0) > 0:
        desc_pedido = round(suma_bruta * min(float(descuento_pct), 100.0) / 100.0, 6)
    # Convertir descuento de pedido a moneda de líneas si viniera en otra (raro)
    if mon_d == "COP" and mon != "COP" and rate > 0:
        desc_pedido_mon = desc_pedido / rate
    elif mon_d != mon and mon_d != "COP" and mon == "COP":
        desc_pedido_mon = desc_pedido * rate
    else:
        desc_pedido_mon = desc_pedido
    # No superar lo ya neto tras descuentos de línea
    suma_tras_linea = max(suma_bruta - sum(desc_lineas), 0.0)
    desc_pedido_mon = min(desc_pedido_mon, suma_tras_linea) if suma_tras_linea > 0 else 0.0

    result: list[dict[str, Any]] = []
    n_lineas = len(lineas) or 1
    for i, linea in enumerate(lineas):
        cantidad = max(_num(linea.get("cantidad")), 0.0) or 1.0
        upp = max(_num(linea.get("unidades_por_pack"), 1.0), 0.0) or 1.0
        unidad = normalizar_unidad_base(str(linea.get("unidad") or "")) or "un"
        unidades_totales = max(cantidad * upp, 1.0)
        precio_unit = _num(linea.get("precio_unit"))
        subtotal = brutos[i]
        d_lin = desc_lineas[i]
        # Prorrateo del cupón/pedido sobre el valor tras descuento de línea
        base_peso = max(subtotal - d_lin, 0.0)
        peso = (base_peso / suma_tras_linea) if suma_tras_linea > 0 else (1.0 / n_lineas)
        d_ped = desc_pedido_mon * peso if desc_pedido_mon > 0 else 0.0
        subtotal_neto = max(subtotal - d_lin - d_ped, 0.0)
        precio_neto_pack = (subtotal_neto / cantidad) if cantidad > 0 else 0.0

        subtotal_cop = _monto_a_cop(subtotal, mon, rate)
        subtotal_neto_cop = _monto_a_cop(subtotal_neto, mon, rate)
        precio_pack_cop = _monto_a_cop(precio_neto_pack, mon, rate)
        # Flete por unidades compradas (ml/g/un totales de la línea)
        uds = unidades_lineas[i]
        peso_flete = (uds / suma_unidades) if suma_unidades > 0 else (1.0 / n_lineas)
        flete_asig = flete_cop * peso_flete if flete_cop > 0 else 0.0
        flete_por_pack = flete_asig / cantidad if cantidad > 0 else 0.0
        costo = round((precio_pack_cop + flete_por_pack) / upp, 4) if upp > 0 else 0.0
        result.append(
            {
                **linea,
                "cantidad": cantidad,
                "unidades_por_pack": upp,
                "unidades_totales": unidades_totales,
                "unidad": unidad,
                "subtotal": subtotal,
                "descuento": round(d_lin, 6),
                "descuento_pedido_asignado": round(d_ped, 6),
                "subtotal_neto": round(subtotal_neto, 6),
                "precio_neto_pack": round(precio_neto_pack, 6),
                "precio_pack_cop": round(precio_pack_cop, 4),
                "peso_flete": round(peso_flete, 6),
                "flete_asignado_cop": round(flete_asig, 4),
                "flete_por_unidad_cop": round(flete_asig / unidades_totales, 4) if unidades_totales > 0 else 0.0,
                "subtotal_cop": round(subtotal_cop, 4),
                "subtotal_neto_cop": round(subtotal_neto_cop, 4),
                "costo_unitario_cop": costo,
            }
        )
    return result


PROMPT_LISTA_COMPRAS = """\
Eres asistente de compras de McKenna Group S.A.S. Analiza esta imagen
(pantallazo, nota, chat WhatsApp, lista manuscrita, cotización o factura)
y extrae SOLO los productos/materiales a comprar.

Responde SOLO JSON válido con este esquema:
{
  "items": [
    {"nombre": "Urea cosmética", "cantidad": 500, "unidad": "g"}
  ]
}

Reglas:
- nombre: producto o material claro, sin precios ni totales.
- cantidad: número positivo. Si no aparece, usa 1.
- unidad: una de g | ml | und | kg | L (normaliza sinónimos:
  gramos/gr → g; mililitros → ml; unidades/u/pcs/piezas → und;
  kilos → kg; litros/lts → L).
- Si ves "1 kg" o "500g" en el nombre, sepáralo: cantidad + unidad y deja
  el nombre limpio (ej. "Urea 500g" → nombre "Urea", cantidad 500, unidad "g").
- Omite precios, impuestos, flete, descuentos y totales.
- Si hay varias líneas, incluye todas. Sin duplicar la misma línea.
- Sin markdown. Solo JSON.
"""

PROMPT_LISTA_ETIQUETAS = """\
Eres asistente de producción de McKenna Group S.A.S. Analiza esta imagen
(pantallazo, nota, chat WhatsApp, lista manuscrita o pedido)
y extrae SOLO las etiquetas a imprimir.

Responde SOLO JSON válido con este esquema:
{
  "items": [
    {"nombre": "Elastina 30 ml", "cantidad": 50}
  ]
}

Reglas CRÍTICAS:
- nombre: producto + presentación/tipo de etiqueta juntos
  (ej. "Elastina 30 ml", "Vitamina C 30 ml", "Urea 125 g", "Circular 70", "Lactato").
- cantidad: cuántas ETIQUETAS hay que imprimir (×50 u, 30 und, "50 etiquetas").
  Si no aparece cantidad de impresión, usa 1.
- NUNCA uses la presentación como cantidad:
  "Elastina 30 ml × 50" → nombre "Elastina 30 ml", cantidad 50
  "Urea 125g" sin cantidad de impresión → nombre "Urea 125 g", cantidad 1
- Presentaciones típicas: 30 mL, 5 mL, 125 g, 250 g, 100 g, 5 g, 1 Lt, Circular, Circular 70, Lactato, 54mm.
- Omite saludos, precios y texto de relleno.
- Si hay varias líneas, incluye todas. Sin duplicar.
- Sin markdown. Solo JSON.
"""


def normalizar_unidad_lista_compras(unidad: Any) -> str:
    """Normaliza unidad libre a g|ml|und|kg|L para solicitudes de compra."""
    s = str(unidad or "").strip().lower()
    aliases = {
        "un": "und",
        "u": "und",
        "und": "und",
        "unidad": "und",
        "unidades": "und",
        "pcs": "und",
        "pc": "und",
        "pieza": "und",
        "piezas": "und",
        "g": "g",
        "gr": "g",
        "grs": "g",
        "gramo": "g",
        "gramos": "g",
        "kg": "kg",
        "kilo": "kg",
        "kilos": "kg",
        "kilogramo": "kg",
        "kilogramos": "kg",
        "ml": "ml",
        "mililitro": "ml",
        "mililitros": "ml",
        "l": "L",
        "lt": "L",
        "lts": "L",
        "litro": "L",
        "litros": "L",
    }
    return aliases.get(s, (str(unidad or "").strip() or "und"))


def normalizar_items_lista_compras(raw_items: list | None) -> list[dict[str, Any]]:
    """Limpia items OCR → [{nombre, cantidad, unidad}] para checklist de compra."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in raw_items or []:
        if not isinstance(it, dict):
            continue
        nombre = str(it.get("nombre") or it.get("n") or it.get("producto") or "").strip()
        if not nombre:
            continue
        cant = _num(it.get("cantidad") if it.get("cantidad") is not None else it.get("c"), 1.0)
        if cant <= 0:
            cant = 1.0
        unidad = normalizar_unidad_lista_compras(it.get("unidad") or it.get("u") or "und")
        key = nombre.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append({"nombre": nombre, "cantidad": cant, "unidad": unidad})
    return out


def normalizar_items_lista_etiquetas(raw_items: list | None) -> list[dict[str, Any]]:
    """Limpia items OCR → [{nombre, cantidad, unidad:'u'}] para pedido de etiquetas."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in raw_items or []:
        if not isinstance(it, dict):
            continue
        nombre = str(
            it.get("nombre") or it.get("n") or it.get("producto") or it.get("label") or ""
        ).strip()
        if not nombre:
            continue
        cant = _num(it.get("cantidad") if it.get("cantidad") is not None else it.get("c"), 1.0)
        if cant <= 0:
            cant = 1.0
        cant_i = max(1, int(round(cant)))
        key = nombre.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append({"nombre": nombre, "cantidad": float(cant_i), "unidad": "u"})
    return out


def extraer_lista_compras_desde_imagen(
    data: bytes,
    *,
    modo: str = "compra",
    timeout_s: float = 60.0,
) -> dict[str, Any]:
    """OCR ligero: pantallazo/nota → items de lista (compra o etiquetas)."""
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return {"error": "GOOGLE_API_KEY no configurada"}
    if not data:
        return {"error": "Imagen vacía"}

    modo_norm = (modo or "compra").strip().lower()
    es_etiqueta = modo_norm in ("etiqueta", "etiquetas", "label", "labels")
    prompt = PROMPT_LISTA_ETIQUETAS if es_etiqueta else PROMPT_LISTA_COMPRAS
    contexto_budget = (
        "solicitud_lista_etiquetas_ocr" if es_etiqueta else "solicitud_lista_compras_ocr"
    )
    vacio_msg = (
        "No se detectaron etiquetas en la imagen"
        if es_etiqueta
        else "No se detectaron productos en la imagen"
    )

    model_name = (
        os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
    )
    registrar_llamada = None
    usage_gemini = None
    try:
        from app.services.llm_budget import (
            permitir_llamada as _permitir,
            registrar_llamada as _registrar,
            usage_gemini as _usage,
        )

        ok_budget, motivo_budget = _permitir(model_name, contexto=contexto_budget)
        if not ok_budget:
            return {"error": f"Presupuesto IA agotado: {motivo_budget}"}
        registrar_llamada = _registrar
        usage_gemini = _usage
    except Exception:
        pass

    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        return {"error": "google-genai no instalado"}

    parts = [
        gtypes.Part.from_bytes(data=data, mime_type=_mime_from_bytes(data)),
        prompt,
    ]

    def _llamar():
        client = genai.Client(api_key=api_key)
        return client.models.generate_content(model=model_name, contents=parts)

    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_llamar)
            response = fut.result(timeout=max(float(timeout_s), 30.0))
    except FutureTimeout:
        return {"error": "Gemini tardó demasiado — intente con una imagen más pequeña"}
    except Exception as e:
        log.exception("lista_%s_ocr Gemini falló", "etiquetas" if es_etiqueta else "compras")
        return {"error": str(e)}

    if registrar_llamada and usage_gemini:
        try:
            t_in, t_out = usage_gemini(response)
            registrar_llamada(
                model_name,
                tokens_in=t_in,
                tokens_out=t_out,
                contexto=contexto_budget,
            )
        except Exception:
            pass

    parsed = _extraer_json(getattr(response, "text", None) or "")
    if not parsed:
        return {
            "error": "No se pudo interpretar la respuesta de Gemini",
            "raw": getattr(response, "text", ""),
        }
    raw_items = parsed.get("items") if isinstance(parsed.get("items"), list) else []
    if not raw_items and isinstance(parsed.get("lineas"), list):
        raw_items = parsed["lineas"]
    items = (
        normalizar_items_lista_etiquetas(raw_items)
        if es_etiqueta
        else normalizar_items_lista_compras(raw_items)
    )
    if not items:
        return {"error": vacio_msg, "items": []}
    return {"items": items, "imagenes_procesadas": 1, "modo": "etiqueta" if es_etiqueta else "compra"}


def extraer_compra_desde_imagen(
    data: bytes,
    *,
    trm: float | None = None,
    flete: float | None = None,
    moneda_flete: str | None = None,
    fecha_compra: str | None = None,
    timeout_s: float = 50.0,
) -> dict[str, Any]:
    """OCR de una sola imagen (compat)."""
    return extraer_compra_desde_imagenes(
        [data],
        trm=trm,
        flete=flete,
        moneda_flete=moneda_flete,
        fecha_compra=fecha_compra,
        timeout_s=timeout_s,
    )


def extraer_compra_desde_imagenes(
    imagenes: list[bytes],
    *,
    trm: float | None = None,
    flete: float | None = None,
    moneda_flete: str | None = None,
    fecha_compra: str | None = None,
    timeout_s: float = 90.0,
) -> dict[str, Any]:
    """Llama Gemini Vision con una o varias imágenes del mismo pedido.

    Si la moneda es USD y no se pasa TRM manual, consulta la TRM BanRep de la
    fecha de compra (OCR o parámetro).
    """
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return {"error": "GOOGLE_API_KEY no configurada"}
    blobs = [b for b in (imagenes or []) if b]
    if not blobs:
        return {"error": "Imagen vacía"}

    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        return {"error": "google-genai no instalado"}

    prompt = PROMPT_COMPRA_EXTERIOR
    if len(blobs) > 1:
        prompt = (
            f"Hay {len(blobs)} pantallazos/páginas del MISMO pedido o invoice. "
            "Consolida TODAS las líneas de producto de todas las imágenes en un solo JSON "
            "(sin duplicar la misma línea si se repite). "
            + PROMPT_COMPRA_EXTERIOR
        )

    parts = [
        gtypes.Part.from_bytes(data=b, mime_type=_mime_from_bytes(b)) for b in blobs
    ]
    parts.append(prompt)

    def _llamar():
        client = genai.Client(api_key=api_key)
        model = os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
        return client.models.generate_content(model=model, contents=parts)

    # Más tiempo si hay varias imágenes
    timeout_eff = max(float(timeout_s), 40.0 + 25.0 * (len(blobs) - 1))

    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_llamar)
            response = fut.result(timeout=timeout_eff)
    except FutureTimeout:
        return {"error": "Gemini tardó demasiado — intente con archivos más pequeños"}
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

    from app.services.trm import normalizar_fecha, obtener_trm

    fecha_ocr = normalizar_fecha(parsed.get("fecha_compra"))
    fecha_eff = normalizar_fecha(fecha_compra) or fecha_ocr

    trm_meta: dict[str, Any] | None = None
    trm_fuente = None
    trm_eff = float(trm) if trm is not None and float(trm) > 0 else 0.0
    if moneda == "COP":
        trm_eff = 1.0
        trm_fuente = "cop"
    elif moneda == "USD" and trm_eff <= 0:
        trm_meta = obtener_trm(fecha_eff)
        if not trm_meta.get("error"):
            trm_eff = float(trm_meta["valor"])
            trm_fuente = "banrep"
            if not fecha_eff:
                fecha_eff = trm_meta.get("fecha")
        else:
            log.warning("TRM BanRep no disponible: %s", trm_meta.get("error"))
    elif trm_eff > 0:
        trm_fuente = "manual"

    flete_eff = float(flete) if flete is not None else (flete_det_n or 0.0)
    mon_flete_eff = (moneda_flete or mon_flete_det_s or moneda).strip().upper()

    desc_det = parsed.get("descuento_detectado")
    desc_det_n = abs(_num(desc_det)) if desc_det is not None and str(desc_det).strip() != "" else 0.0
    desc_pct_raw = parsed.get("descuento_pct")
    desc_pct_n = (
        _num(desc_pct_raw)
        if desc_pct_raw is not None and str(desc_pct_raw).strip() != ""
        else None
    )
    if desc_pct_n is not None and desc_pct_n <= 0:
        desc_pct_n = None

    lineas_landed = (
        calcular_landed(
            lineas,
            trm=trm_eff if trm_eff > 0 else 1.0,
            flete=flete_eff,
            moneda=moneda,
            moneda_flete=mon_flete_eff,
            descuento=desc_det_n,
            descuento_pct=desc_pct_n,
        )
        if lineas and (moneda == "COP" or trm_eff > 0)
        else [
            {
                **l,
                "peso_flete": 0.0,
                "flete_asignado_cop": 0.0,
                "subtotal_cop": None,
                "subtotal_neto": None,
                "costo_unitario_cop": None,
            }
            for l in lineas
        ]
    )

    out: dict[str, Any] = {
        "moneda": moneda,
        "fecha_compra": fecha_eff,
        "proveedor": str(parsed.get("proveedor") or "").strip(),
        "referencia": str(parsed.get("referencia") or "").strip(),
        "flete_detectado": flete_det_n,
        "moneda_flete_detectada": mon_flete_det_s,
        "descuento_detectado": desc_det_n if desc_det_n > 0 else None,
        "descuento_pct": desc_pct_n,
        "lineas": lineas,
        "lineas_landed": lineas_landed,
        "trm_usada": trm_eff if trm_eff > 0 else None,
        "trm_fuente": trm_fuente,
        "flete_usado": flete_eff,
        "descuento_usado": desc_det_n if desc_det_n > 0 else (
            None if desc_pct_n is None else "pct"
        ),
        "moneda_flete_usada": mon_flete_eff,
        "imagenes_procesadas": len(blobs),
    }
    if trm_meta and not trm_meta.get("error"):
        out["trm_detalle"] = {
            "valor": trm_meta.get("valor"),
            "vigencia_desde": trm_meta.get("vigencia_desde"),
            "vigencia_hasta": trm_meta.get("vigencia_hasta"),
            "aproximada": bool(trm_meta.get("aproximada")),
            "aviso": trm_meta.get("aviso"),
        }
    elif moneda == "USD" and trm_eff <= 0:
        out["trm_error"] = (trm_meta or {}).get("error") or "Indique fecha de compra para consultar la TRM BanRep"
    return out
