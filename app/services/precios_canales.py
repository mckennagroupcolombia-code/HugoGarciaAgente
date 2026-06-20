"""
Precios multicanal McKenna.

Prioridad (cada producto con su propio precio):
  1. MercadoLibre — dicta el precio publicado (referencia maestra).
  2. Siigo — mismo valor que MeLi (es lo que se factura).
  3. Página web — descuento sobre la referencia para mostrar ahorro al comprar directo;
     el envío va en un apartado separado en checkout.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

MELI_COMMISSION = float(__import__("os").getenv("MELI_COMMISSION_WEB", "0.165"))

_TARIFAS_PATH = Path(__file__).resolve().parents[1] / "data" / "tarifas_interrapidisimo.json"

DOCUMENTACION_PRECIOS = {
    "titulo": "Prioridad y lógica de precios por canal",
    "resumen": (
        "Cada producto tiene su propio precio. Lo publicado en MercadoLibre es la referencia "
        "maestra; Siigo replica ese valor para facturación; la web muestra el producto más barato "
        "y el envío en un apartado aparte."
    ),
    "prioridad": [
        {
            "orden": 1,
            "canal": "MercadoLibre",
            "clave": "meli",
            "rol": "Referencia maestra",
            "descripcion": (
                "El precio que ves publicado en MeLi es el que dicta el resto de plataformas. "
                "Suele incluir envío gratis en el monto visible para el comprador."
            ),
        },
        {
            "orden": 2,
            "canal": "Siigo",
            "clave": "siigo",
            "rol": "Facturación",
            "descripcion": (
                "Debe coincidir con MeLi: es el precio de lista con el que se factura "
                "y se registran ventas directas. Si cambias el precio, Siigo y MeLi van al mismo valor."
            ),
        },
        {
            "orden": 3,
            "canal": "Página web",
            "clave": "web",
            "rol": "Ahorro al comprar directo",
            "descripcion": (
                "Se aplica un descuento (~16,5%, comisión MeLi evitada) sobre la referencia para "
                "mostrar al cliente que le sale más barato comprar por mckennagroup.co. "
                "El envío se calcula en un apartado separado al finalizar el pedido."
            ),
        },
    ],
    "entrada_panel": (
        "Al cambiar precios, ingresa el valor publicado en MeLi de ese producto. "
        "El sistema propone Siigo igual y web con descuento automático."
    ),
    "comision_meli_pct": MELI_COMMISSION,
}

REGLAS_CANALES = {
    "meli": DOCUMENTACION_PRECIOS["prioridad"][0]["descripcion"],
    "siigo": DOCUMENTACION_PRECIOS["prioridad"][1]["descripcion"],
    "web": DOCUMENTACION_PRECIOS["prioridad"][2]["descripcion"],
}


def obtener_documentacion_precios() -> dict:
    return dict(DOCUMENTACION_PRECIOS)


def _tarifa_envio_base() -> int:
    try:
        data = json.loads(_TARIFAS_PATH.read_text(encoding="utf-8"))
        return int(data.get("ciudades", {}).get("default", {}).get("precio_base", 18000))
    except Exception:
        return 18000


def _gramos_desde_sku(sku: str) -> int:
    s = (sku or "").upper()
    m_kg = re.search(r"(?:^|[-_])(\d+(?:[.,]\d+)?)\s*KG(?:$|[^A-Z])", s)
    if m_kg:
        return int(float(m_kg.group(1).replace(",", ".")) * 1000)
    m_g = re.search(r"(\d+)\s*G(?:$|[^A-Z])", s)
    if m_g:
        return int(m_g.group(1))
    if s.endswith("KG") or "KG" in s.split("-")[-1].upper():
        return 1000
    return 0


def envio_estimado_por_sku(sku: str) -> int:
    """Envío Interrapidísimo estimado (hasta 1 kg + extra por peso)."""
    base = _tarifa_envio_base()
    gramos = _gramos_desde_sku(sku)
    if gramos <= 1000:
        return base
    kg_extra = max(0, int((gramos - 1000 + 999) // 1000))
    return base + kg_extra * 2000


def es_combo_multipack(sku: str, nombre: str = "") -> bool:
    code = (sku or "").upper()
    nom = (nombre or "").upper()
    if code.startswith("KIT") or code.startswith("COMBO-"):
        return True
    if re.search(r"\bX\s*\d+\b", nom) or re.search(r"\b\d+\s*UN(?:ID)?\b", nom):
        return True
    if re.search(r"\bPACK\b|\bCOMBO\b|\bBUNDLE\b", nom):
        return True
    return False


def _fmt_cop(n: int) -> str:
    return f"${n:,}".replace(",", ".")


def resolver_precios_multicanal(
    sku: str,
    precio_meli: float,
    *,
    nombre: str = "",
) -> dict:
    """
    Calcula precios por canal a partir del precio publicado en MeLi (referencia maestra).

    Args:
        precio_meli: Precio visible en la publicación MeLi de este producto.
    """
    referencia = int(round(float(precio_meli or 0)))
    if referencia <= 0:
        raise ValueError("precio_meli debe ser > 0")

    envio_ref = envio_estimado_por_sku(sku)
    es_combo = es_combo_multipack(sku, nombre)
    web_producto = int(round(referencia * (1 - MELI_COMMISSION)))
    ahorro_web = referencia - web_producto
    pct = int(round(MELI_COMMISSION * 100))

    meli = {
        "prioridad": 1,
        "precio": referencia,
        "envio_gratis": True,
        "envio_embebido_estimado": 0 if es_combo else envio_ref,
        "rol": "Referencia maestra",
        "regla": REGLAS_CANALES["meli"],
        "nota": (
            f"Publicar {_fmt_cop(referencia)} en MeLi (envío gratis para el comprador)."
            + (
                f" En presentaciones sueltas suele incluir ~{_fmt_cop(envio_ref)} de envío en el precio."
                if not es_combo and envio_ref
                else ""
            )
        ),
    }
    siigo = {
        "prioridad": 2,
        "precio": referencia,
        "rol": "Facturación",
        "regla": REGLAS_CANALES["siigo"],
        "nota": f"Lista Siigo {_fmt_cop(referencia)} — mismo valor que MeLi (base de factura).",
    }
    web_canal = {
        "prioridad": 3,
        "precio_producto": web_producto,
        "precio": web_producto,
        "envio_apartado": True,
        "envio_estimado_referencia": envio_ref,
        "ahorro_vs_meli_producto": ahorro_web,
        "descuento_pct": pct,
        "rol": "Ahorro compra directa",
        "regla": REGLAS_CANALES["web"],
        "nota": (
            f"Catálogo web: producto {_fmt_cop(web_producto)} "
            f"(−{pct}% vs MeLi, ahorro {_fmt_cop(ahorro_web)}). "
            f"Envío aparte en checkout (~{_fmt_cop(envio_ref)} según destino)."
        ),
    }

    desglose = (
        f"1° MeLi {_fmt_cop(referencia)} → 2° Siigo {_fmt_cop(referencia)} → "
        f"3° Web producto {_fmt_cop(web_producto)} + envío en apartado."
    )

    return {
        "precio_meli_referencia": referencia,
        "precio_publico": referencia,
        "lista": referencia,
        "meli": referencia,
        "web": web_producto,
        "envio_referencia": envio_ref,
        "envio_meli_embebido": 0 if es_combo else envio_ref,
        "envio_web_apartado": True,
        "meli_envio_gratis": True,
        "es_combo_multipack": es_combo,
        "ahorro_web_vs_meli": ahorro_web,
        "comision_meli_pct": MELI_COMMISSION,
        "desglose": desglose,
        "documentacion": DOCUMENTACION_PRECIOS,
        "canales": {
            "meli": meli,
            "siigo": siigo,
            "web": web_canal,
        },
        "reglas": REGLAS_CANALES,
    }


def precios_catalogo_web_desde_siigo(sku: str, lista_siigo: float, nombre: str = "") -> dict:
    """Catálogo web: Siigo trae el precio MeLi; web muestra producto con descuento."""
    p = resolver_precios_multicanal(sku, lista_siigo, nombre=nombre)
    return {
        "precio_web_num": p["web"],
        "precio_meli_num": p["meli"],
        "lista_num": p["lista"],
        "ahorro_num": p["ahorro_web_vs_meli"],
        "envio_gratis_web": False,
        "envio_referencia": p["envio_referencia"],
    }
