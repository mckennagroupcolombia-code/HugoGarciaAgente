"""
Servicio de Rentabilidad: cálculos de costos reales y márgenes por producto.

Fuentes de datos:
  - Siigo combos: lista de componentes (materias primas, envases, etiquetas, operativos)
  - Siigo facturas de venta: ingresos reales por período
  - Configuración manual por producto: costos guardados localmente
"""

import json
import os
from datetime import datetime

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "rentabilidad_config.json")

COMISION_MELI_DEFAULT = 0.165
IVA_DEFAULT = 0.19


# ─── Persistencia de configuración de costos ────────────────────────────────

def _cargar_configs() -> dict:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _guardar_configs(configs: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(_CONFIG_PATH)), exist_ok=True)
    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(configs, f, ensure_ascii=False, indent=2)


def guardar_config_producto(codigo: str, config: dict) -> None:
    configs = _cargar_configs()
    configs[codigo.strip().upper()] = {**config, "updated_at": datetime.now().isoformat()}
    _guardar_configs(configs)


def cargar_config_producto(codigo: str) -> dict | None:
    return _cargar_configs().get(codigo.strip().upper())


# ─── Productos ───────────────────────────────────────────────────────────────

def listar_productos_rentabilidad() -> tuple[list, str | None]:
    """Devuelve combos Siigo con componentes, precios e IVA para la calculadora."""
    from app.services.siigo import listar_productos_combo_siigo, _precio_lista_siigo_producto

    try:
        combos = listar_productos_combo_siigo()
    except Exception as e:
        return [], str(e)

    configs = _cargar_configs()
    result = []

    for c in combos:
        code = (c.get("code") or "").strip()
        if not code:
            continue

        precio = _precio_lista_siigo_producto(c)

        iva_pct = 0.0
        for tax in (c.get("taxes") or []):
            if (tax.get("type") or "").upper() == "IVA":
                iva_pct = float(tax.get("percentage") or 0) / 100
                break

        tax_included = bool(c.get("tax_included", False))

        components = [
            {
                "id": comp.get("id"),
                "name": (comp.get("name") or "").strip(),
                "quantity": float(comp.get("quantity") or 1),
            }
            for comp in (c.get("components") or [])
        ]

        saved = configs.get(code.upper(), {})

        result.append({
            "code": code,
            "name": (c.get("name") or "").strip(),
            "precio_lista": precio,
            "iva_pct": iva_pct,
            "tax_included": tax_included,
            "components": components,
            "config_guardada": bool(saved),
            "costos": saved if saved else None,
        })

    result.sort(key=lambda x: x["name"])
    return result, None


# ─── Calculadora ─────────────────────────────────────────────────────────────

def calcular_rentabilidad(
    precio_lista: float,
    iva_pct: float,
    tax_included: bool,
    costo_materiales: float,
    costo_nomina: float,
    costo_envase: float,
    costo_etiqueta: float,
    otros_costos: float,
    comision_pct: float = COMISION_MELI_DEFAULT,
    margen_objetivo_pct: float | None = None,
) -> dict:
    """Calcula márgenes y utilidades para un producto dado sus costos."""

    # Precio base sin IVA
    if tax_included and iva_pct > 0:
        precio_sin_iva = precio_lista / (1 + iva_pct)
    else:
        precio_sin_iva = precio_lista

    iva_valor = precio_lista - precio_sin_iva

    # Costos
    costo_total = costo_materiales + costo_nomina + costo_envase + costo_etiqueta + otros_costos

    # Ingreso tras comisión
    comision_valor = precio_sin_iva * comision_pct
    ingreso_neto = precio_sin_iva - comision_valor

    # Utilidades
    utilidad_bruta = precio_sin_iva - costo_total
    utilidad_neta = ingreso_neto - costo_total

    # Márgenes
    margen_bruto = (utilidad_bruta / precio_sin_iva * 100) if precio_sin_iva > 0 else 0.0
    margen_neto = (utilidad_neta / ingreso_neto * 100) if ingreso_neto > 0 else 0.0

    # Precio sugerido para el margen objetivo
    precio_sugerido = None
    if margen_objetivo_pct is not None and 0 < margen_objetivo_pct < 100:
        # ingreso_neto_sug * (1 - margen_obj) = costo_total
        # precio_sin_iva_sug * (1 - comision) = ingreso_neto_sug
        margen_frac = margen_objetivo_pct / 100
        ingreso_neto_sug = costo_total / (1 - margen_frac)
        precio_sin_iva_sug = ingreso_neto_sug / (1 - comision_pct)
        precio_sugerido = precio_sin_iva_sug * (1 + iva_pct) if (tax_included and iva_pct > 0) else precio_sin_iva_sug

    return {
        "precio_lista": round(precio_lista, 2),
        "precio_sin_iva": round(precio_sin_iva, 2),
        "iva_valor": round(iva_valor, 2),
        "comision_valor": round(comision_valor, 2),
        "comision_pct": comision_pct,
        "ingreso_neto": round(ingreso_neto, 2),
        "costo_materiales": round(costo_materiales, 2),
        "costo_nomina": round(costo_nomina, 2),
        "costo_envase": round(costo_envase, 2),
        "costo_etiqueta": round(costo_etiqueta, 2),
        "otros_costos": round(otros_costos, 2),
        "costo_total": round(costo_total, 2),
        "utilidad_bruta": round(utilidad_bruta, 2),
        "utilidad_neta": round(utilidad_neta, 2),
        "margen_bruto_pct": round(margen_bruto, 2),
        "margen_neto_pct": round(margen_neto, 2),
        "es_rentable": utilidad_neta > 0,
        "precio_sugerido": round(precio_sugerido, 0) if precio_sugerido is not None else None,
    }


# ─── Análisis de período ─────────────────────────────────────────────────────

def resumen_periodo(fecha_inicio: str, fecha_fin: str | None = None) -> dict:
    """
    Agrega facturas de venta Siigo en el rango dado.
    Devuelve ingresos totales, conteos y top productos por facturación.
    """
    from app.services.siigo import obtener_facturas_siigo_paginadas

    try:
        facturas = obtener_facturas_siigo_paginadas(fecha_inicio)
    except Exception as e:
        return {"error": str(e)}

    fin = fecha_fin or datetime.now().strftime("%Y-%m-%d")

    facturas_rango = [
        f for f in facturas
        if fecha_inicio <= (f.get("date") or "")[:10] <= fin
    ]

    total_con_iva = sum(float(f.get("total") or 0) for f in facturas_rango)

    # IVA total sumando los valores de impuesto por ítem
    total_iva = 0.0
    for f in facturas_rango:
        for item in (f.get("items") or []):
            for tax in (item.get("taxes") or []):
                total_iva += float(tax.get("value") or 0)

    total_sin_iva = total_con_iva - total_iva

    # Agregado por producto
    productos: dict[str, dict] = {}
    for f in facturas_rango:
        for item in (f.get("items") or []):
            code = (item.get("code") or "").strip()
            if not code:
                continue
            name = (item.get("description") or code).strip()
            qty = float(item.get("quantity") or 0)
            total_item = float(item.get("total") or 0)
            if code not in productos:
                productos[code] = {"code": code, "name": name, "qty": 0.0, "total": 0.0}
            productos[code]["qty"] += qty
            productos[code]["total"] += total_item

    top_productos = sorted(productos.values(), key=lambda x: x["total"], reverse=True)[:20]

    # Enriquecer top con margen si hay config guardada
    configs = _cargar_configs()
    for p in top_productos:
        cfg = configs.get(p["code"].upper())
        if cfg:
            costo_t = (
                float(cfg.get("costo_materiales") or 0)
                + float(cfg.get("costo_nomina") or 0)
                + float(cfg.get("costo_envase") or 0)
                + float(cfg.get("costo_etiqueta") or 0)
                + float(cfg.get("otros_costos") or 0)
            )
            if costo_t > 0:
                p["costo_unitario"] = costo_t
                p["costo_total"] = round(costo_t * p["qty"], 2)
                p["utilidad_estimada"] = round(p["total"] - p["costo_total"], 2)

    promedio = total_con_iva / len(facturas_rango) if facturas_rango else 0.0

    return {
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fin,
        "num_facturas": len(facturas_rango),
        "total_con_iva": round(total_con_iva, 2),
        "total_sin_iva": round(total_sin_iva, 2),
        "total_iva": round(total_iva, 2),
        "promedio_por_factura": round(promedio, 2),
        "top_productos": top_productos,
    }
