"""
Rentabilidad: costos reales desde facturas de compra Siigo + cálculos de margen.

Flujo de costos por componente:
  1. Catálogo de productos Siigo  → normalized_name → code
  2. Facturas de compra Siigo     → code → precio_unitario_más_reciente
  3. Combo components             → nombre → precio_unitario × cantidad
  4. Fallback: registro manual en contabilidad.db
"""

import json
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "rentabilidad_config.json")
_CACHE_PATH  = os.path.join(os.path.dirname(__file__), "..", "data", "siigo_costos_cache.json")
_CACHE_TTL   = 24 * 3600  # 24 horas

_EXCEL_FOLDER = os.path.join(os.path.dirname(__file__), "..", "..", "importaciones_productos")
_excel_cache: dict = {}          # {code: {precio, nombre, archivo}}
_excel_cache_ts: float = 0.0
_EXCEL_TTL = 3600  # 1 hora

COMISION_MELI_DEFAULT = 0.165
IVA_DEFAULT = 0.19


# ─── Excel importaciones → índice de costos ──────────────────────────────────

def _cargar_costos_excel() -> dict:
    """
    Lee todos los .xlsx de importaciones_productos/ y devuelve un dict
    {code_siigo: {precio, nombre, archivo}} con el precio más reciente
    por código (ordenado por mtime del archivo).
    Resultado cacheado en memoria 1 hora.
    """
    global _excel_cache, _excel_cache_ts
    if time.time() - _excel_cache_ts < _EXCEL_TTL and _excel_cache:
        return _excel_cache

    if not os.path.isdir(_EXCEL_FOLDER):
        return {}

    try:
        import openpyxl
    except ImportError:
        return {}

    index: dict = {}
    archivos = sorted(
        (f for f in os.listdir(_EXCEL_FOLDER) if f.endswith(".xlsx")),
        key=lambda f: os.path.getmtime(os.path.join(_EXCEL_FOLDER, f)),
    )
    for fname in archivos:
        path = os.path.join(_EXCEL_FOLDER, fname)
        mtime = os.path.getmtime(path)
        try:
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            ws = wb.active
            for row in ws.iter_rows(min_row=2, values_only=True):
                if not row or not row[2]:
                    continue
                code = str(row[2]).strip()
                nombre = str(row[3]).strip() if row[3] else ""
                try:
                    precio = float(row[6]) if row[6] else 0.0
                except (ValueError, TypeError):
                    precio = 0.0
                if not code or precio <= 0:
                    continue
                # El archivo más reciente (mayor mtime) sobreescribe
                index[code] = {
                    "precio": precio,
                    "nombre": nombre,
                    "archivo": fname,
                    "mtime": mtime,
                }
            wb.close()
        except Exception:
            pass

    _excel_cache = index
    _excel_cache_ts = time.time()
    return index


def invalidar_cache_excel() -> None:
    global _excel_cache_ts
    _excel_cache_ts = 0.0


# ─── Normalización de nombres ─────────────────────────────────────────────────

def _norm(texto: str) -> str:
    t = (texto or "").strip().lower()
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9\s\.]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ─── Configuración manual por combo ──────────────────────────────────────────

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


# ─── Catálogo de costos (productos + facturas de compra Siigo) ────────────────

def _cargar_cache_costos() -> dict | None:
    try:
        with open(_CACHE_PATH, encoding="utf-8") as f:
            cache = json.load(f)
        if time.time() - float(cache.get("ts", 0)) < _CACHE_TTL:
            return cache
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        pass
    return None


def _guardar_cache_costos(cache: dict) -> None:
    cache["ts"] = time.time()
    os.makedirs(os.path.dirname(os.path.abspath(_CACHE_PATH)), exist_ok=True)
    with open(_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


def construir_catalogo_costos(forzar: bool = False) -> dict:
    """
    Construye (y cachea 24 h) un índice de costos por componente cruzando:
      - Catálogo de productos Siigo: normalized_name → code
      - Facturas de compra Siigo:    code → {precio, fecha, descripcion}
    """
    if not forzar:
        cache = _cargar_cache_costos()
        if cache:
            return cache

    from app.services.siigo import autenticar_siigo, PARTNER_ID
    import requests

    token = autenticar_siigo()
    if not token:
        return {}

    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}

    # ── Paso 1: catálogo completo de productos → nombre_norm → code ──────────
    nombre_a_codigo: dict[str, str] = {}
    codigo_a_nombre: dict[str, str] = {}
    codigo_a_producto: dict[str, dict] = {}

    for page in range(1, 300):
        try:
            res = requests.get(
                "https://api.siigo.com/v1/products",
                params={"page": page, "page_size": 100, "active": "true"},
                headers=headers, timeout=25,
            )
        except requests.RequestException:
            break
        if res.status_code != 200:
            break
        data = res.json()
        results = data.get("results") or []
        if not results:
            break
        for p in results:
            code = (p.get("code") or "").strip()
            name = (p.get("name") or "").strip()
            if code and name:
                nombre_a_codigo[_norm(name)] = code
                codigo_a_nombre[code] = name
                unit_cost = 0.0
                for wh in (p.get("warehouses") or []):
                    uc = wh.get("unit_cost")
                    if uc is not None and float(uc) > 0:
                        unit_cost = float(uc)
                        break
                from app.services.siigo import _precio_lista_siigo_producto
                codigo_a_producto[code] = {
                    "nombre": name,
                    "unit_cost": unit_cost,
                    "precio_lista": _precio_lista_siigo_producto(p),
                }
        pag = data.get("pagination") or {}
        total = int(pag.get("total_results") or 0)
        if total and page * 100 >= total:
            break
        if len(results) < 100:
            break

    # ── Paso 2: facturas de compra → code → precio más reciente ──────────────
    fecha_inicio = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
    codigo_a_precio: dict[str, dict] = {}

    for page in range(1, 200):
        try:
            res = requests.get(
                "https://api.siigo.com/v1/purchases",
                params={"date_start": fecha_inicio, "page": page, "page_size": 100},
                headers=headers, timeout=25,
            )
        except requests.RequestException:
            break
        if res.status_code != 200:
            break
        data = res.json()
        results = data.get("results") or []
        if not results:
            break
        for factura in results:
            fecha_f = (factura.get("date") or "")[:10]
            for item in (factura.get("items") or []):
                if item.get("type") != "Product":
                    continue
                code = (item.get("code") or "").strip()
                precio = float(item.get("price") or 0)
                if not code or precio <= 0:
                    continue
                existente = codigo_a_precio.get(code)
                if not existente or fecha_f > existente["fecha"]:
                    codigo_a_precio[code] = {
                        "precio": precio,
                        "fecha": fecha_f,
                        "descripcion": (item.get("description") or "").strip(),
                    }
        pag = data.get("pagination") or {}
        total = int(pag.get("total_results") or 0)
        if total and page * 100 >= total:
            break
        if len(results) < 100:
            break

    # ── Paso 3: construir índice final ────────────────────────────────────────
    por_nombre: dict[str, dict] = {}
    por_codigo: dict[str, dict] = {}

    for code, precio_data in codigo_a_precio.items():
        nombre = codigo_a_nombre.get(code, precio_data.get("descripcion", ""))
        norm_name = _norm(nombre)
        entry = {
            "code": code,
            "nombre": nombre,
            "precio_compra": precio_data["precio"],
            "fecha_compra": precio_data["fecha"],
        }
        if norm_name:
            por_nombre[norm_name] = entry
        por_codigo[code] = entry

    cache = {
        "nombre_a_codigo": nombre_a_codigo,
        "por_nombre": por_nombre,
        "por_codigo": por_codigo,
        "codigo_a_producto": codigo_a_producto,
        "productos_total": len(nombre_a_codigo),
        "con_precio_compra": len(por_codigo),
    }
    _guardar_cache_costos(cache)
    return cache


def _buscar_precio_componente(nombre: str, catalogo: dict) -> dict | None:
    """
    Busca el precio de compra de un componente en el catálogo.
    Estrategia: exact → code-lookup → prefix-4-words.
    """
    norm_name = _norm(nombre)
    por_nombre = catalogo.get("por_nombre", {})
    nombre_a_codigo = catalogo.get("nombre_a_codigo", {})
    por_codigo = catalogo.get("por_codigo", {})

    # 1. Exact normalized match
    if norm_name in por_nombre:
        return por_nombre[norm_name]

    # 2. Name → code → precio
    code = nombre_a_codigo.get(norm_name)
    if code and code in por_codigo:
        return por_codigo[code]

    # 3. Prefix match (4 primeras palabras significativas)
    palabras = [w for w in norm_name.split() if len(w) >= 2]
    if len(palabras) >= 3:
        prefijo = " ".join(palabras[:4])
        for n, entry in por_nombre.items():
            if n.startswith(prefijo):
                return entry

    return None


def estado_catalogo() -> dict:
    """Devuelve metadatos del caché actual sin reconstruirlo."""
    try:
        with open(_CACHE_PATH, encoding="utf-8") as f:
            cache = json.load(f)
        ts = float(cache.get("ts", 0))
        edad_h = (time.time() - ts) / 3600
        return {
            "existe": True,
            "productos_total": cache.get("productos_total", 0),
            "con_precio_compra": cache.get("con_precio_compra", 0),
            "edad_horas": round(edad_h, 1),
            "vigente": edad_h < 24,
            "actualizado": datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else None,
        }
    except (FileNotFoundError, json.JSONDecodeError):
        return {"existe": False, "vigente": False}


def _componente_tiene_costo(nombre: str, catalogo: dict) -> bool:
    from app.services.contabilidad_db import buscar_componente

    if _buscar_precio_componente(nombre, catalogo):
        return True
    stored = buscar_componente(nombre)
    return bool(stored and float(stored.get("costo_unitario") or 0) > 0)


def _buscar_precio_autofill(nombre: str, catalogo: dict) -> dict | None:
    """
    Fuentes alternativas para componentes de combo (insumos/compras) sin factura de compra:
      1. unit_cost en bodega Siigo
      2. precio de lista Siigo (último recurso)
    """
    code = catalogo.get("nombre_a_codigo", {}).get(_norm(nombre))
    if not code:
        return None
    meta = catalogo.get("codigo_a_producto", {}).get(code, {})
    unit_cost = float(meta.get("unit_cost") or 0)
    if unit_cost > 0:
        return {"precio": unit_cost, "fuente": "siigo_unit_cost", "code": code}
    precio_lista = float(meta.get("precio_lista") or 0)
    if precio_lista > 0:
        return {"precio": precio_lista, "fuente": "siigo_lista", "code": code}
    return None


def escanear_componentes_sin_costo() -> dict:
    """
    Recorre todos los combos (productos de venta) y lista componentes únicos
    (insumos/compras) que aún no tienen costo asignado.
    """
    from app.services.siigo import listar_productos_combo_siigo

    try:
        catalogo = construir_catalogo_costos()
    except Exception:
        catalogo = {}

    combos = listar_productos_combo_siigo()
    faltantes: dict[str, dict] = {}

    for combo in combos:
        code_combo = (combo.get("code") or "").strip()
        for comp in (combo.get("components") or []):
            nombre = (comp.get("name") or "").strip()
            if not nombre or _componente_tiene_costo(nombre, catalogo):
                continue
            norm = _norm(nombre)
            if norm not in faltantes:
                propuesta = _buscar_precio_autofill(nombre, catalogo)
                faltantes[norm] = {
                    "nombre": nombre,
                    "code_siigo": catalogo.get("nombre_a_codigo", {}).get(norm),
                    "categoria": _categorizar(nombre),
                    "combos_afectados": 0,
                    "propuesta_costo": propuesta["precio"] if propuesta else None,
                    "propuesta_fuente": propuesta["fuente"] if propuesta else None,
                }
            faltantes[norm]["combos_afectados"] += 1

    items = sorted(faltantes.values(), key=lambda x: (-x["combos_afectados"], x["nombre"]))
    con_propuesta = [i for i in items if i.get("propuesta_costo")]
    return {
        "total_combos": len(combos),
        "componentes_sin_costo": len(items),
        "con_propuesta_autofill": len(con_propuesta),
        "sin_propuesta": len(items) - len(con_propuesta),
        "componentes": items,
    }


def autocompletar_costos_componentes(dry_run: bool = False) -> dict:
    """
    Asigna masivamente costos a componentes de combo sin precio.
    Guarda en componente_costos (aplica a todos los combos que usen ese insumo).
    """
    from app.services.contabilidad_db import upsert_componente

    escaneo = escanear_componentes_sin_costo()
    asignados: list[dict] = []
    sin_propuesta: list[str] = []

    for item in escaneo["componentes"]:
        costo = item.get("propuesta_costo")
        if not costo or float(costo) <= 0:
            sin_propuesta.append(item["nombre"])
            continue
        registro = {
            "nombre": item["nombre"],
            "costo_unitario": round(float(costo), 4),
            "categoria": item["categoria"],
            "fuente": item["propuesta_fuente"],
            "code_siigo": item.get("code_siigo"),
            "combos_afectados": item["combos_afectados"],
            "aplicado": False,
        }
        if not dry_run:
            upsert_componente(item["nombre"], registro["costo_unitario"], item["categoria"])
            registro["aplicado"] = True
        asignados.append(registro)

    return {
        "dry_run": dry_run,
        "asignados": len(asignados),
        "sin_propuesta": len(sin_propuesta),
        "detalle_asignados": asignados,
        "detalle_sin_propuesta": sin_propuesta[:80],
        "escaneo": {
            "total_combos": escaneo["total_combos"],
            "componentes_sin_costo": escaneo["componentes_sin_costo"],
        },
    }


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


# ─── Desglose de costos por combo ─────────────────────────────────────────────

def combo_costos_desglose(code: str) -> dict:
    """
    Cruza los componentes del combo con:
      1. Catálogo de costos Siigo (facturas de compra)
      2. Registro manual en contabilidad_db (fallback)
    Devuelve desglose detallado + totales por categoría.
    """
    from app.services.siigo import listar_productos_combo_siigo, _precio_lista_siigo_producto
    from app.services.contabilidad_db import buscar_componente

    # Intentar cargar el catálogo de costos (usa caché si está vigente)
    try:
        catalogo = construir_catalogo_costos()
    except Exception:
        catalogo = {}

    combos = listar_productos_combo_siigo()
    combo = next(
        (c for c in combos if (c.get("code") or "").strip().upper() == code.upper()),
        None,
    )
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

        # Código Siigo del componente (desde catálogo de productos)
        code_siigo = catalogo.get("nombre_a_codigo", {}).get(_norm(nombre)) if catalogo else None

        fuente: str | None = None
        fecha_compra: str | None = None

        # Fuente 1: override manual — prioridad absoluta si el usuario lo ingresó
        stored = buscar_componente(nombre)
        costo_unit = float(stored["costo_unitario"]) if stored and float(stored.get("costo_unitario") or 0) > 0 else 0.0
        if costo_unit > 0:
            fuente = "manual"

        # Fuente 2: Excel de importaciones (código exacto de Siigo)
        if costo_unit == 0 and code_siigo:
            excel_idx = _cargar_costos_excel()
            excel_entry = excel_idx.get(code_siigo)
            if excel_entry and float(excel_entry.get("precio") or 0) > 0:
                costo_unit = float(excel_entry["precio"])
                fuente = "excel"

        # Fuente 3: facturas de compra Siigo (API, caché 24 h)
        if costo_unit == 0:
            siigo_entry = _buscar_precio_componente(nombre, catalogo) if catalogo else None
            if siigo_entry:
                costo_unit = float(siigo_entry["precio_compra"])
                fuente = "siigo"
                fecha_compra = siigo_entry.get("fecha_compra")

        costo_total = costo_unit * cantidad
        conocido = costo_unit > 0

        if not conocido:
            sin_costo += 1

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
            "code_siigo": code_siigo,
            "costo_unit": round(costo_unit, 4),
            "costo_total": round(costo_total, 2),
            "costo_conocido": conocido,
            "fuente": fuente,
            "fecha_compra": fecha_compra,
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
        "catalogo_vigente": bool(catalogo),
    }


def costos_todos_resumen() -> dict:
    """
    Devuelve {code: {costo_total, sin_costo}} para todos los combos en una sola pasada.
    Construye el catálogo y carga los combos una sola vez.
    """
    from app.services.siigo import listar_productos_combo_siigo
    from app.services.contabilidad_db import buscar_componente

    try:
        catalogo = construir_catalogo_costos()
    except Exception:
        catalogo = {}

    try:
        combos = listar_productos_combo_siigo()
    except Exception:
        return {}

    resultado: dict[str, dict] = {}

    for combo in combos:
        code = (combo.get("code") or "").strip()
        if not code:
            continue

        costo_total = 0.0
        sin_costo = 0

        for comp in (combo.get("components") or []):
            nombre = (comp.get("name") or "").strip()
            cantidad = float(comp.get("quantity") or 1)

            stored = buscar_componente(nombre)
            costo_unit = float(stored["costo_unitario"]) if stored and float(stored.get("costo_unitario") or 0) > 0 else 0.0

            if costo_unit == 0:
                code_siigo = catalogo.get("nombre_a_codigo", {}).get(_norm(nombre)) if catalogo else None
                if code_siigo:
                    excel_idx = _cargar_costos_excel()
                    excel_entry = excel_idx.get(code_siigo)
                    if excel_entry and float(excel_entry.get("precio") or 0) > 0:
                        costo_unit = float(excel_entry["precio"])

            if costo_unit == 0:
                siigo_entry = _buscar_precio_componente(nombre, catalogo) if catalogo else None
                if siigo_entry:
                    costo_unit = float(siigo_entry["precio_compra"])

            if costo_unit > 0:
                costo_total += costo_unit * cantidad
            else:
                sin_costo += 1

        resultado[code.upper()] = {
            "costo_total": round(costo_total, 2),
            "sin_costo": sin_costo,
        }

    return resultado


def precios_reales_meli() -> dict:
    """
    Devuelve {sku: precio_meli} con los precios publicados actualmente en MercadoLibre.
    Lee los meli_id del cache.json y hace batch fetches a la API de MeLi (20 por llamada).
    """
    import json as _json
    import os as _os
    import requests as _req

    _CACHE = _os.path.join(_os.path.dirname(__file__), "..", "..", "PAGINA_WEB", "site", "data", "cache.json")
    try:
        cache = _json.load(open(_CACHE))
    except Exception:
        return {}

    combos = cache.get("combos", [])

    # Construir mapa meli_id → sku
    id_to_sku: dict[str, str] = {}
    for p in combos:
        mid = (p.get("meli_id") or "").strip()
        sku = (p.get("ref") or p.get("rep_sku") or "").strip()
        if mid and sku:
            id_to_sku[mid] = sku

    if not id_to_sku:
        return {}

    from app.utils import refrescar_token_meli
    token = refrescar_token_meli()
    if not token:
        return {}

    headers = {"Authorization": f"Bearer {token}"}
    resultado: dict[str, float] = {}

    ids = list(id_to_sku.keys())
    for i in range(0, len(ids), 20):
        batch = ids[i:i + 20]
        try:
            res = _req.get(
                "https://api.mercadolibre.com/items",
                params={"ids": ",".join(batch), "attributes": "id,price"},
                headers=headers,
                timeout=15,
            )
            if res.status_code != 200:
                continue
            for entry in res.json():
                item = entry.get("body") or {}
                mid = str(item.get("id") or "").strip()
                price = item.get("price")
                if mid and price is not None and mid in id_to_sku:
                    sku = id_to_sku[mid]
                    resultado[sku.upper()] = float(price)
        except Exception:
            continue

    return resultado


# ─── Recordatorios de pagos por WhatsApp ─────────────────────────────────────

def enviar_recordatorios_pagos() -> dict:
    """Envía al grupo de contabilidad recordatorios de servicios próximos a vencer."""
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
    if tax_included and iva_pct > 0:
        precio_sin_iva = precio_lista / (1 + iva_pct)
    else:
        precio_sin_iva = precio_lista

    iva_valor = precio_lista - precio_sin_iva
    costo_total = costo_materiales + costo_nomina + costo_envase + costo_etiqueta + otros_costos
    comision_valor = precio_sin_iva * comision_pct
    ingreso_neto = precio_sin_iva - comision_valor
    utilidad_bruta = precio_sin_iva - costo_total
    utilidad_neta = ingreso_neto - costo_total
    margen_bruto = (utilidad_bruta / precio_sin_iva * 100) if precio_sin_iva > 0 else 0.0
    margen_neto = (utilidad_neta / ingreso_neto * 100) if ingreso_neto > 0 else 0.0

    precio_sugerido = None
    if margen_objetivo_pct is not None and 0 < margen_objetivo_pct < 100:
        margen_frac = margen_objetivo_pct / 100
        ingreso_neto_sug = costo_total / (1 - margen_frac)
        precio_sin_iva_sug = ingreso_neto_sug / (1 - comision_pct)
        precio_sugerido = (
            precio_sin_iva_sug * (1 + iva_pct) if (tax_included and iva_pct > 0) else precio_sin_iva_sug
        )

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
    """Agrega facturas de venta Siigo en el rango dado."""
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
    total_iva = 0.0
    for f in facturas_rango:
        for item in (f.get("items") or []):
            for tax in (item.get("taxes") or []):
                total_iva += float(tax.get("value") or 0)

    total_sin_iva = total_con_iva - total_iva
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

    configs = _cargar_configs()
    for p in top_productos:
        cfg = configs.get(p["code"].upper())
        if cfg:
            costo_t = sum(
                float(cfg.get(k) or 0)
                for k in ("costo_materiales", "costo_nomina", "costo_envase", "costo_etiqueta", "otros_costos")
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
