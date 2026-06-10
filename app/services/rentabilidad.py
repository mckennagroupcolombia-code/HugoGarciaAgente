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


# ─── Categorización de componentes ───────────────────────────────────────────

def _categorizar(nombre: str) -> str:
    n = nombre.lower()
    if any(k in n for k in ["etiqueta", "label", "sticker", "adhesivo"]):
        return "etiqueta"
    if any(k in n for k in ["env.", "frasco", "botero", "botella", "doypack", "caneca",
                              "tarro", "pote", "vaso", "gotero", "tubo", "sachet"]):
        return "envase"
    if any(k in n for k in ["tapa", "tapón", "tapon", "liner", "dosificadora",
                              "dispensador", "bomba", "sifon", "spray", "copa dosificadora"]):
        return "envase"
    if any(k in n for k in ["vinipel", "burbuja", "bolsa", "cinta", "flejes", "zipper"]):
        return "empaque"
    if any(k in n for k in ["operativo", "mano de obra", "m.o.", "minuto", "min "]):
        return "operativo"
    return "material"


def combo_costos_desglose(code: str) -> dict:
    """Busca el combo en Siigo, cruza componentes con costos guardados y devuelve desglose."""
    from app.services.siigo import listar_productos_combo_siigo, _precio_lista_siigo_producto
    from app.services.contabilidad_db import buscar_componente

    combos = listar_productos_combo_siigo()
    combo = next((c for c in combos if (c.get("code") or "").strip().upper() == code.upper()), None)
    if combo is None:
        return {"error": f"Combo '{code}' no encontrado en Siigo"}

    precio = _precio_lista_siigo_producto(combo)
    iva_pct = 0.0
    for tax in (combo.get("taxes") or []):
        if (tax.get("type") or "").upper() == "IVA":
            iva_pct = float(tax.get("percentage") or 0) / 100
            break
    tax_included = bool(combo.get("tax_included", False))

    totales: dict[str, float] = {
        "costo_materiales": 0.0,
        "costo_envase": 0.0,
        "costo_etiqueta": 0.0,
        "otros_costos": 0.0,
        "costo_nomina": 0.0,
    }
    sin_costo = 0
    componentes_out = []

    for comp in (combo.get("components") or []):
        nombre = (comp.get("name") or "").strip()
        cantidad = float(comp.get("quantity") or 1)
        cat = _categorizar(nombre)
        stored = buscar_componente(nombre)
        costo_unit = float(stored["costo_unitario"]) if stored else 0.0
        costo_total = costo_unit * cantidad
        conocido = stored is not None

        if not conocido:
            sin_costo += 1

        # Acumular en el campo correcto
        if cat == "material":
            totales["costo_materiales"] += costo_total
        elif cat == "envase":
            totales["costo_envase"] += costo_total
        elif cat == "etiqueta":
            totales["costo_etiqueta"] += costo_total
        elif cat == "empaque":
            totales["otros_costos"] += costo_total
        elif cat == "operativo":
            totales["costo_nomina"] += costo_total

        componentes_out.append({
            "nombre": nombre,
            "cantidad": cantidad,
            "categoria": cat,
            "costo_unit": costo_unit,
            "costo_total": round(costo_total, 2),
            "costo_conocido": conocido,
        })

    totales_rounded = {k: round(v, 2) for k, v in totales.items()}
    totales_rounded["componentes_sin_costo"] = sin_costo
    totales_rounded["componentes_total"] = len(componentes_out)

    return {
        "code": code.upper(),
        "nombre": (combo.get("name") or "").strip(),
        "precio_lista": precio,
        "iva_pct": iva_pct,
        "tax_included": tax_included,
        "componentes": componentes_out,
        "totales": totales_rounded,
    }


# ─── Recordatorios de pagos por WhatsApp ─────────────────────────────────────

def enviar_recordatorios_pagos() -> dict:
    """Envía al grupo de contabilidad recordatorios de servicios próximos a vencer."""
    import os
    from app.services.contabilidad_db import servicios_proximos_vencimiento
    from app.utils import enviar_whatsapp_reporte

    proximos = servicios_proximos_vencimiento(dias=3)
    if not proximos:
        return {"enviados": 0, "servicios": []}

    lineas = ["*Recordatorio de pagos próximos a vencer:*\n"]
    for s in proximos:
        dias = s["dias_para_vencer"]
        venc = s["fecha_vencimiento"]
        aviso = "HOY" if dias == 0 else f"en {dias} día{'s' if dias != 1 else ''} ({venc})"
        lineas.append(f"• *{s['empresa']}* ({s['tipo'].upper()}) — vence {aviso}")
        if s.get("numero_contrato"):
            lineas.append(f"  Contrato: {s['numero_contrato']}")

    mensaje = "\n".join(lineas)
    grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
    try:
        enviar_whatsapp_reporte(mensaje, grupo)
    except Exception as e:
        return {"error": str(e), "servicios": [s["empresa"] for s in proximos]}

    return {"enviados": len(proximos), "servicios": [s["empresa"] for s in proximos]}


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
