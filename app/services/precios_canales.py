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
import time
from pathlib import Path

import requests

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


def _obtener_precios_activos_meli(token: str, seller_id: str) -> dict[str, dict]:
    """
    {item_id: {"price": float, "sku": str, "title": str}} de todas las
    publicaciones activas — mismo patrón de paginación/batch que
    scripts/sincronizar_precios_meli_sheets.py, reutilizado acá para no
    depender de un script de consola con token sin refrescar.
    """
    headers = {"Authorization": f"Bearer {token}"}
    all_item_ids: list[str] = []
    offset = 0
    while True:
        r = requests.get(
            f"https://api.mercadolibre.com/users/{seller_id}/items/search",
            params={"status": "active", "limit": 100, "offset": offset},
            headers=headers,
            timeout=20,
        )
        if r.status_code != 200:
            break
        data = r.json() or {}
        ids = data.get("results") or []
        all_item_ids.extend(ids)
        total = int((data.get("paging") or {}).get("total") or 0)
        offset += 100
        if offset >= total or not ids:
            break

    meli_data: dict[str, dict] = {}
    for i in range(0, len(all_item_ids), 20):
        batch = all_item_ids[i : i + 20]
        r = requests.get(
            "https://api.mercadolibre.com/items",
            params={"ids": ",".join(batch)},
            headers=headers,
            timeout=30,
        )
        if r.status_code != 200:
            continue
        for entry in r.json() or []:
            if entry.get("code") != 200:
                continue
            item = entry.get("body") or {}
            item_id = item.get("id") or ""
            price = item.get("price")
            if not item_id or price is None:
                continue
            sku = (item.get("seller_custom_field") or "").strip()
            if not sku:
                for attr in item.get("attributes") or []:
                    if attr.get("id") == "SELLER_SKU":
                        sku = (attr.get("value_name") or "").strip()
                        break
            if not sku:
                continue
            meli_data[item_id] = {"price": float(price), "sku": sku, "title": item.get("title") or ""}
        time.sleep(0.2)

    return meli_data


def reconciliar_precios_meli(
    dry_run: bool = True, umbral: float = 1.0, skus_permitidos: set[str] | None = None
) -> dict:
    """
    Trae el precio VIVO de cada publicación activa en MeLi (referencia maestra,
    ver DOCUMENTACION_PRECIOS) y lo cruza contra el precio actual en Siigo por
    SKU. Cuando difieren más de `umbral`, corrige Siigo → Sheets → Web (en ese
    orden) usando exactamente la misma fórmula que el editor manual de
    "Ganancia" (`resolver_precios_multicanal`).

    Por qué existe: el push manual de precios (POST /api/rentabilidad/actualizar-precio)
    solo se dispara si alguien escribe un precio nuevo en el panel — si el precio
    se cambió directo en la app/web de MeLi, nada más se entera. Este es el otro
    sentido: MeLi → el resto.

    dry_run=True (default): solo arma la lista de candidatos, no escribe nada en
    ningún canal — pensado para revisar antes de aplicar, ya que escribe en el
    mismo Siigo que usa la facturación electrónica real.

    skus_permitidos: si viene, TODOS los candidatos se siguen reportando (para
    que el llamador vea el panorama completo), pero solo se aplican los que
    estén en este set. Confirmado en vivo ago-2026: la corrida sin filtro
    mezcla diferencias chicas y coherentes (bajada de precio reciente) con
    otras de 2x-14x que huelen a cruce de SKU equivocado — no todo lo que
    aparece acá es seguro de aplicar en automático.
    """
    from app.services.google_services import _abrir_hoja
    from app.services.meli import _obtener_seller_id_meli
    from app.services.siigo import actualizar_precio_combo_siigo, buscar_producto_siigo_por_sku
    from app.utils import refrescar_token_meli

    resultado: dict = {"dry_run": dry_run, "candidatos": [], "aplicados": 0, "errores": []}

    token = refrescar_token_meli()
    if not token:
        resultado["error"] = "No se pudo refrescar el token de MeLi."
        return resultado

    seller_id = _obtener_seller_id_meli(token)
    if not seller_id:
        resultado["error"] = "No se pudo obtener el seller_id de MeLi."
        return resultado

    meli_data = _obtener_precios_activos_meli(token, seller_id)

    candidatos: list[dict] = []
    for item_id, info in meli_data.items():
        sku = info["sku"]
        siigo_prod = buscar_producto_siigo_por_sku(sku)
        if not siigo_prod:
            continue
        precio_siigo = float(siigo_prod.get("precio") or 0)
        precio_meli = info["price"]
        if abs(precio_meli - precio_siigo) <= umbral:
            continue
        precios = resolver_precios_multicanal(sku, precio_meli, nombre=info["title"])
        candidatos.append(
            {
                "sku": sku,
                "item_id": item_id,
                "nombre": info["title"],
                "precio_meli": precio_meli,
                "precio_siigo_antes": precio_siigo,
                "precio_nuevo": precios["lista"],
                "precio_web_nuevo": precios["web"],
            }
        )

    candidatos.sort(key=lambda c: -abs(c["precio_meli"] - c["precio_siigo_antes"]))
    resultado["candidatos"] = candidatos

    a_aplicar = (
        [c for c in candidatos if c["sku"] in skus_permitidos]
        if skus_permitidos is not None
        else candidatos
    )

    if dry_run or not a_aplicar:
        return resultado

    # 1° Siigo — facturación (precio lista = mismo que MeLi)
    skus_ok: list[str] = []
    for c in a_aplicar:
        r = actualizar_precio_combo_siigo(c["sku"], c["precio_nuevo"])
        c["siigo_resultado"] = r
        if r.get("ok"):
            resultado["aplicados"] += 1
            skus_ok.append(c["sku"])
        else:
            resultado["errores"].append({"sku": c["sku"], "canal": "siigo", "msg": r.get("msg")})

    if not skus_ok:
        return resultado

    # 2° Sheets — catálogo/PDF, mismo patrón de batch_update que
    # app/tools/sincronizar_precios.py
    try:
        ws = _abrir_hoja()
        rows = ws.get_all_values()
        header = [h.strip().upper() for h in rows[0]]
        idx_sku = next((i for i, h in enumerate(header) if "SKU" in h), 1)
        idx_prec = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)
        sku_to_row = {}
        for row_num, row in enumerate(rows[1:], start=2):
            s = row[idx_sku].strip() if len(row) > idx_sku else ""
            if s:
                sku_to_row[s.upper()] = row_num
        col_letra = chr(ord("A") + idx_prec)
        candidatos_ok = {c["sku"]: c for c in candidatos if c["sku"] in skus_ok}
        batch_data = []
        for sku, c in candidatos_ok.items():
            row_num = sku_to_row.get(sku.upper())
            if row_num:
                batch_data.append({"range": f"{col_letra}{row_num}", "values": [[int(round(c["precio_nuevo"]))]]})
        if batch_data:
            ws.batch_update(batch_data)
    except Exception as e:
        resultado["errores"].append({"sku": None, "canal": "sheets", "msg": str(e)})

    # 3° Web — UNA sola llamada para todo el lote (sin "stock" en el payload
    # solo dispara la reconstrucción del cache desde Siigo, ya actualizado
    # arriba — no hace falta ni tiene sentido llamarla una vez por SKU).
    try:
        from app.tools.sincronizar_productos_pagina_web import sincronizar_productos_pagina_web

        resultado["web_resultado"] = sincronizar_productos_pagina_web([{"sku": s} for s in skus_ok])
    except Exception as e:
        resultado["errores"].append({"sku": None, "canal": "web", "msg": str(e)})

    return resultado
