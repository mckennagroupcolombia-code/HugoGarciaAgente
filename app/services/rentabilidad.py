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

def _cache_costos_valido(cache: dict) -> bool:
    """Un caché vacío (fallo de Siigo) no debe bloquear reconstrucciones posteriores."""
    return bool(cache.get("nombre_a_codigo")) and int(cache.get("productos_total") or 0) > 0


def indice_codigo_a_nombre(catalogo: dict | None) -> dict[str, str]:
    """
    Índice código → nombre desde el caché de costos.

    Une codigo_a_nombre + codigo_a_producto + nombre_a_codigo: caches viejos o
    parcialmente escritos a veces dejan codigo_a_nombre casi vacío aunque haya
    miles de productos en codigo_a_producto.
    """
    cat = catalogo or {}
    out: dict[str, str] = {}
    for code, name in (cat.get("codigo_a_nombre") or {}).items():
        code_s = str(code or "").strip()
        if code_s:
            out[code_s] = str(name or "").strip() or code_s
    for code, meta in (cat.get("codigo_a_producto") or {}).items():
        code_s = str(code or "").strip()
        if not code_s:
            continue
        if isinstance(meta, dict):
            nombre = (meta.get("nombre") or "").strip()
        else:
            nombre = str(meta or "").strip()
        if code_s not in out or (nombre and not out[code_s]):
            out[code_s] = nombre or code_s
    for norm_name, code in (cat.get("nombre_a_codigo") or {}).items():
        code_s = str(code or "").strip()
        if code_s and code_s not in out:
            out[code_s] = str(norm_name or "").strip() or code_s
    return out


def _reparar_codigo_a_nombre_cache(cache: dict) -> dict:
    """Rellena codigo_a_nombre si está incompleto respecto al resto del índice."""
    merged = indice_codigo_a_nombre(cache)
    prev = cache.get("codigo_a_nombre") or {}
    if len(merged) > len(prev):
        cache = dict(cache)
        cache["codigo_a_nombre"] = merged
        # Persistir reparación para no repetir el merge en cada request
        try:
            _guardar_cache_costos(cache)
        except Exception:
            pass
    return cache


def _cargar_cache_costos() -> dict | None:
    try:
        with open(_CACHE_PATH, encoding="utf-8") as f:
            cache = json.load(f)
        if time.time() - float(cache.get("ts", 0)) < _CACHE_TTL and _cache_costos_valido(cache):
            return _reparar_codigo_a_nombre_cache(cache)
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        pass
    return None


def _guardar_cache_costos(cache: dict) -> None:
    cache["ts"] = time.time()
    os.makedirs(os.path.dirname(os.path.abspath(_CACHE_PATH)), exist_ok=True)
    with open(_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


def registrar_producto_en_cache_costos(
    codigo: str,
    nombre: str,
    *,
    unit_cost: float = 0.0,
    precio_lista: float = 0.0,
) -> None:
    """
    Inserta/actualiza un producto en el caché de costos sin rebuild completo.
    Permite que pickers y rentabilidad vean altas recién hechas en Siigo.
    """
    code = (codigo or "").strip()
    name = (nombre or "").strip()
    if not code:
        return
    cache = _cargar_cache_costos()
    if not cache:
        # Caché vacío/vencido: no forzar rebuild (caro); crear stub mínimo
        cache = {
            "nombre_a_codigo": {},
            "por_nombre": {},
            "por_codigo": {},
            "codigo_a_producto": {},
            "codigo_a_nombre": {},
            "productos_total": 0,
            "con_precio_compra": 0,
        }
    nombre_a_codigo = dict(cache.get("nombre_a_codigo") or {})
    codigo_a_nombre = dict(cache.get("codigo_a_nombre") or {})
    codigo_a_producto = dict(cache.get("codigo_a_producto") or {})
    if name:
        nombre_a_codigo[_norm(name)] = code
        codigo_a_nombre[code] = name
    else:
        codigo_a_nombre.setdefault(code, code)
    prev = codigo_a_producto.get(code) if isinstance(codigo_a_producto.get(code), dict) else {}
    codigo_a_producto[code] = {
        "nombre": name or prev.get("nombre") or code,
        "unit_cost": float(unit_cost or prev.get("unit_cost") or 0),
        "precio_lista": float(precio_lista or prev.get("precio_lista") or 0),
    }
    cache["nombre_a_codigo"] = nombre_a_codigo
    cache["codigo_a_nombre"] = codigo_a_nombre
    cache["codigo_a_producto"] = codigo_a_producto
    cache["productos_total"] = max(int(cache.get("productos_total") or 0), len(codigo_a_producto))
    try:
        _guardar_cache_costos(cache)
    except OSError:
        # El proceso del panel a veces no puede escribir el JSON (dueño systemd).
        # La búsqueda viva en Siigo igual cubre productos recién creados.
        pass


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

    from app.services.siigo import _siigo_get

    # ── Paso 1: catálogo completo de productos → nombre_norm → code ──────────
    nombre_a_codigo: dict[str, str] = {}
    codigo_a_nombre: dict[str, str] = {}
    codigo_a_producto: dict[str, dict] = {}

    for page in range(1, 300):
        res = _siigo_get(
            "https://api.siigo.com/v1/products",
            params={"page": page, "page_size": 100, "active": "true"},
        )
        if res is None or res.status_code != 200:
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
        res = _siigo_get(
            "https://api.siigo.com/v1/purchases",
            params={"date_start": fecha_inicio, "page": page, "page_size": 100},
        )
        if res is None or res.status_code != 200:
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
    if _cache_costos_valido(cache):
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
        valido = _cache_costos_valido(cache)
        return {
            "existe": True,
            "productos_total": cache.get("productos_total", 0),
            "con_precio_compra": cache.get("con_precio_compra", 0),
            "edad_horas": round(edad_h, 1),
            "vigente": valido and edad_h < 24,
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

# Envase primario / cierre / dosificación (producto)
_ENVASE_KW = (
    "farma",
    "pastillero",
    "frasco",
    "gotero",
    "envase",
    "env.",
    "valvula",
    "válvula",
    "dosificador",
    "dosificadora",
    "tapa",
    "tapon",
    "tapón",
    "bolsa",
    "banda",
    "botero",
    "botella",
    "doypack",
    "caneca",
    "tarro",
    "pote",
    "tubo",
    "sachet",
    "blister",
    "liner",
    "dispensador",
    "bomba",
    "sifon",
    "sifón",
    "spray",
    "copa dosificadora",
)

# Embalaje de despacho / protección
_EMBALAJE_KW = (
    "embalaje",
    "empaque",
    "vinipel",
    "papel",
    "burbuja",
    "sobre seguridad",
    "sobre",
    "portaguia",
    "porta guia",
    "cinta",
    "flejes",
    "termocontraible",
    "caja carton",
    "caja cartón",
    "carton",
    "cartón",
    "zipper",
)

# Unidad mínima típica de materia prima (g / mL)
_RE_UNIDAD_MATERIA_PRIMA = re.compile(
    r"(?:"
    r"m\.?l\.?\s*$"                          # …mL / …ml al final (incl. pegado al nombre)
    r"|"
    r"\b\d+(?:[.,]\d+)?\s*m\.?l\.?\b"        # 5mL, 180 ml
    r"|"
    r"\bg\b"                                  # token g (UREA g, g mL)
    r"|"
    r"\b\d+(?:[.,]\d+)?\s*g\b"                # 5g, 30 g
    r"|"
    r"\bg\s*l\b"                              # gL
    r")",
    re.IGNORECASE,
)


def _categorizar(nombre: str) -> str:
    """
    Categorías de costo en rentabilidad:
      - etiqueta: etiquetas / labels
      - envase: farma, pastillero, frasco, gotero, envase, válvula, dosificador, tapa, bolsa…
      - embalaje: papel, sobre de seguridad, vinipel, burbuja, cinta…
      - material: materia prima con unidad mínima g / mL
      - operativo: mano de obra
    """
    n = nombre.lower()
    if any(k in n for k in ("etiqueta", "label", "sticker")):
        return "etiqueta"
    if any(k in n for k in _ENVASE_KW):
        return "envase"
    if any(k in n for k in _EMBALAJE_KW):
        return "embalaje"
    if any(k in n for k in ("operativo", "mano de obra", "m.o.")):
        return "operativo"
    if re.search(r"\bminutos?\b|\bmin\b", n):
        return "operativo"
    if _RE_UNIDAD_MATERIA_PRIMA.search(nombre):
        return "material"
    return "material"


def reclasificar_categorias_componentes() -> dict:
    """Reaplica `_categorizar` a componentes ya guardados."""
    from app.services.contabilidad_db import listar_componentes, upsert_componente

    actualizados = []
    for row in listar_componentes():
        nombre = row.get("nombre_original") or ""
        cat_nueva = _categorizar(nombre)
        cat_actual = (row.get("categoria") or "material").strip()
        if cat_nueva == cat_actual:
            continue
        upsert_componente(
            nombre,
            float(row.get("costo_unitario") or 0),
            cat_nueva,
            bool(row.get("iva_incluido")),
        )
        actualizados.append({"nombre": nombre, "antes": cat_actual, "despues": cat_nueva})
    return {"actualizados": len(actualizados), "detalle": actualizados}


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
        elif cat in ("embalaje", "empaque"):
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


def costos_todos_resumen(refresh: bool = False) -> dict:
    """
    Devuelve {code: {costo_total, sin_costo}} para todos los combos en una sola pasada.
    Construye el catálogo y carga los combos una sola vez.
    Con refresh=True fuerza reconstrucción del catálogo Siigo y limpia caché de combos/excel.
    """
    from app.services.siigo import listar_productos_combo_siigo
    from app.services.contabilidad_db import buscar_componente

    if refresh:
        invalidar_cache_excel()
        try:
            import app.services.siigo as _siigo
            _siigo._combos_cache = []
            _siigo._combos_cache_ts = 0.0
        except Exception:
            pass

    try:
        catalogo = construir_catalogo_costos(forzar=refresh)
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


# ─── Cobros MeLi (cargo por venta / envío MeLi “pagarás”) ─────────────────────

_COBROS_MELI_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "meli_cobros_cache.json")
_COBROS_MELI_TTL = 3600  # 1 hora
_RELACION_CODIGOS_CACHE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "relacion_codigos_cache.json"
)
_WEB_CACHE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "PAGINA_WEB", "site", "data", "cache.json"
)


def _sku_canonico_desde_relacion() -> dict[str, dict]:
    """meli_id → {sku, nombre} desde relacion_codigos (vínculo panel Stock)."""
    out: dict[str, dict] = {}
    try:
        if not os.path.isfile(_RELACION_CODIGOS_CACHE_PATH):
            return out
        with open(_RELACION_CODIGOS_CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        for it in data.get("items") or []:
            mid = (it.get("meli_id") or "").strip().upper()
            if not mid or mid in out:
                continue
            sku = (it.get("sku_meli") or it.get("codigo_siigo") or "").strip()
            if not sku:
                continue
            nombre = (
                (it.get("nombre_siigo") or "").strip()
                or (it.get("titulo") or "").strip()
                or sku
            )
            out[mid] = {"sku": sku, "nombre": nombre}
    except Exception:
        return {}
    return out


def _catalogo_publicaciones_meli() -> list[dict]:
    """Publicaciones con meli_id (sku, nombre, meli_id).

    Une relacion_codigos + cobros MeLi + cache web. El cache web a veces:
      - omite un SKU,
      - o asigna el mismo meli_id a dos códigos (ej. C-SORPOTKg y C-SORPOT100g).
    En colisión de meli_id se prefiere el SKU de relacion_codigos (vínculo real),
    luego cobros, luego prefijo C-.
    """
    cache_path = _WEB_CACHE_PATH
    out: list[dict] = []
    mid_index: dict[str, int] = {}
    seen_sku: set[str] = set()
    relacion_por_mid = _sku_canonico_desde_relacion()
    cobros_sku_por_mid: dict[str, str] = {}

    def _rank(sku: str, mid: str) -> tuple:
        s = (sku or "").strip()
        su = s.upper()
        mid_u = (mid or "").strip().upper()
        preferido_rel = (relacion_por_mid.get(mid_u) or {}).get("sku", "").upper()
        preferido_cobros = cobros_sku_por_mid.get(mid_u, "").upper()
        return (
            3 if preferido_rel and su == preferido_rel else 0,
            2 if preferido_cobros and su == preferido_cobros else 0,
            1 if su.startswith("C-") else 0,
            len(s),
        )

    def _add(sku: str, nombre: str, mid: str) -> None:
        sku_clean = (sku or "").strip()
        mid_u = (mid or "").strip().upper()
        sku_u = sku_clean.upper()
        if not sku_u or not mid_u:
            return
        if sku_u in seen_sku:
            return
        entry = {
            "sku": sku_clean,
            "nombre": (nombre or sku_clean).strip(),
            "meli_id": mid_u,
        }
        if mid_u in mid_index:
            idx = mid_index[mid_u]
            actual = out[idx]
            if _rank(sku_clean, mid_u) > _rank(actual["sku"], mid_u):
                seen_sku.discard((actual.get("sku") or "").strip().upper())
                out[idx] = entry
                seen_sku.add(sku_u)
            return
        mid_index[mid_u] = len(out)
        seen_sku.add(sku_u)
        out.append(entry)

    # 1) Relación MeLi↔Siigo (fuente de verdad del vínculo / panel Stock).
    # Si un SKU tiene varios MCO, preferir el que ya esté en cobros (tiene precio/cargos).
    cobros_mids: set[str] = set()
    try:
        if os.path.isfile(_COBROS_MELI_CACHE_PATH):
            with open(_COBROS_MELI_CACHE_PATH, encoding="utf-8") as f:
                cobros_preload = json.load(f)
            for i in cobros_preload.get("items") or []:
                mid = (i.get("meli_id") or "").strip().upper()
                if mid:
                    cobros_mids.add(mid)
    except Exception:
        pass

    rel_ordenado = sorted(
        relacion_por_mid.items(),
        key=lambda kv: (0 if kv[0] in cobros_mids else 1, kv[0]),
    )
    for mid, info in rel_ordenado:
        _add(info.get("sku") or "", info.get("nombre") or "", mid)

    # 2) Cobros (precios/cargos); SKU cede ante relación
    try:
        if os.path.isfile(_COBROS_MELI_CACHE_PATH):
            with open(_COBROS_MELI_CACHE_PATH, encoding="utf-8") as f:
                cobros = json.load(f)
            for i in cobros.get("items") or []:
                mid = (i.get("meli_id") or "").strip().upper()
                sku = (i.get("sku") or "").strip()
                if mid and sku and mid not in cobros_sku_por_mid:
                    cobros_sku_por_mid[mid] = sku
                _add(sku, (i.get("nombre") or sku), mid)
    except Exception:
        pass

    # 3) Catálogo web
    try:
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
        for p in cache.get("combos") or []:
            mid = (p.get("meli_id") or "").strip().upper()
            sku = (p.get("ref") or p.get("rep_sku") or "").strip()
            _add(sku, (p.get("name") or sku), mid)
    except Exception:
        pass

    return out


def _alinear_skus_con_cobros(items_out: list[dict], cache_items: dict) -> None:
    """Asegura SKU/nombre canónicos: relacion_codigos > cobros > fila actual."""
    relacion_por_mid = _sku_canonico_desde_relacion()
    for row in items_out:
        mid = (row.get("meli_id") or "").strip().upper()
        if not mid:
            continue
        rel = relacion_por_mid.get(mid)
        if rel and rel.get("sku"):
            row["sku"] = rel["sku"]
            if rel.get("nombre"):
                row["nombre"] = rel["nombre"]
            continue
        cached = (cache_items or {}).get(mid)
        if not cached:
            continue
        cob_sku = (cached.get("sku") or "").strip()
        web_sku = (row.get("sku") or "").strip()
        if not cob_sku or cob_sku.upper() == web_sku.upper():
            continue
        cob_u, web_u = cob_sku.upper(), web_sku.upper()
        if cob_u.startswith("C-") and not web_u.startswith("C-"):
            row["sku"] = cob_sku
            if cached.get("nombre"):
                row["nombre"] = cached["nombre"]
        elif web_u.startswith("C-") and not cob_u.startswith("C-"):
            continue
        elif cob_u.startswith("C-"):
            row["sku"] = cob_sku
            if cached.get("nombre"):
                row["nombre"] = cached["nombre"]


def _parchear_skus_cobros_cache_desde_relacion() -> int:
    """Corrige SKUs erróneos en meli_cobros_cache.json según relacion_codigos."""
    relacion_por_mid = _sku_canonico_desde_relacion()
    if not relacion_por_mid or not os.path.isfile(_COBROS_MELI_CACHE_PATH):
        return 0
    try:
        with open(_COBROS_MELI_CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return 0
    changed = 0
    for row in data.get("items") or []:
        mid = (row.get("meli_id") or "").strip().upper()
        rel = relacion_por_mid.get(mid)
        if not rel or not rel.get("sku"):
            continue
        if (row.get("sku") or "").strip().upper() != rel["sku"].upper():
            row["sku"] = rel["sku"]
            changed += 1
        if rel.get("nombre") and (row.get("nombre") or "").strip() != rel["nombre"]:
            row["nombre"] = rel["nombre"]
    if not changed:
        return 0
    try:
        tmp = _COBROS_MELI_CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, _COBROS_MELI_CACHE_PATH)
    except Exception:
        return 0
    return changed


def _incorporar_cobros_huerfanos(items_out: list[dict], cache_items: dict) -> int:
    """Reincorpora publicaciones de la caché de cobros omitidas por el catálogo web."""
    relacion_por_mid = _sku_canonico_desde_relacion()
    present_mids = {(r.get("meli_id") or "").strip().upper() for r in items_out}
    present_skus = {(r.get("sku") or "").strip().upper() for r in items_out}
    added = 0
    for mid, cached in (cache_items or {}).items():
        mid_u = (mid or "").strip().upper()
        if not mid_u or mid_u in present_mids:
            continue
        row = dict(cached)
        rel = relacion_por_mid.get(mid_u)
        if rel and rel.get("sku"):
            row["sku"] = rel["sku"]
            if rel.get("nombre"):
                row["nombre"] = rel["nombre"]
        sku_u = (row.get("sku") or "").strip().upper()
        if not sku_u:
            continue
        # Evita duplicar el mismo SKU con otro meli_id si ya está listado
        if sku_u in present_skus:
            continue
        items_out.append(row)
        present_mids.add(mid_u)
        present_skus.add(sku_u)
        added += 1
    return added


def parchear_precio_en_cobros_cache(sku: str, nuevo_precio: float) -> bool:
    """Actualiza precio_meli (y neto) en la caché de cobros tras editar precio en panel."""
    code = (sku or "").strip().upper()
    try:
        precio = float(nuevo_precio)
    except (TypeError, ValueError):
        return False
    if not code or precio <= 0:
        return False
    if not os.path.isfile(_COBROS_MELI_CACHE_PATH):
        return False
    try:
        with open(_COBROS_MELI_CACHE_PATH, encoding="utf-8") as f:
            cache = json.load(f)
    except Exception:
        return False

    items = list(cache.get("items") or [])
    changed = False
    for row in items:
        if (row.get("sku") or "").strip().upper() != code:
            continue
        old = row.get("precio_meli")
        row["precio_meli"] = round(precio, 2)
        # Aproxima cargo por venta si era proporcional al precio anterior
        try:
            old_f = float(old) if old is not None else 0.0
            cv = row.get("cargo_venta")
            if old_f > 0 and cv is not None:
                row["cargo_venta"] = round(float(cv) * (precio / old_f), 2)
                row["pct_venta"] = round(float(row["cargo_venta"]) / precio, 4) if precio else row.get("pct_venta")
        except (TypeError, ValueError):
            pass
        cv2 = row.get("cargo_venta")
        ce2 = row.get("cargo_envio")
        try:
            row["neto_estimado"] = round(
                precio - float(cv2 or 0) - float(ce2 or 0), 2
            )
        except (TypeError, ValueError):
            row["neto_estimado"] = None
        changed = True

    if not changed:
        return False

    cache["items"] = items
    cache["actualizado_en"] = datetime.now().isoformat(timespec="seconds")
    try:
        tmp = _COBROS_MELI_CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, _COBROS_MELI_CACHE_PATH)
        return True
    except Exception:
        return False


def parchear_sku_en_cobros_cache(meli_id: str, nuevo_sku: str) -> bool:
    """Actualiza el SKU de una publicación en meli_cobros_cache tras editarlo en Stock."""
    mid = (meli_id or "").strip().upper()
    sku = (nuevo_sku or "").strip()
    if not mid or not sku or not os.path.isfile(_COBROS_MELI_CACHE_PATH):
        return False
    try:
        with open(_COBROS_MELI_CACHE_PATH, encoding="utf-8") as f:
            cache = json.load(f)
    except Exception:
        return False
    changed = False
    for row in cache.get("items") or []:
        if (row.get("meli_id") or "").strip().upper() != mid:
            continue
        if (row.get("sku") or "").strip() != sku:
            row["sku"] = sku
            changed = True
        break
    if not changed:
        return False
    cache["actualizado_en"] = datetime.now().isoformat(timespec="seconds")
    try:
        tmp = _COBROS_MELI_CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, _COBROS_MELI_CACHE_PATH)
        return True
    except Exception:
        return False


def parse_cobros_listing_prices(payload, listing_type_id: str | None = None) -> dict:
    """
    Cargo por venta = sale_fee_amount de /sites/MCO/listing_prices
    (mismo monto que “Pagarás $X por venta” en el panel MeLi).
    """
    rows = payload if isinstance(payload, list) else ([payload] if isinstance(payload, dict) else [])
    want = (listing_type_id or "").lower().strip()
    best = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        fee = row.get("sale_fee_amount")
        if fee is None:
            fee = row.get("selling_fee_amount")
        if fee is None:
            continue
        try:
            fee_f = float(fee)
        except (TypeError, ValueError):
            continue
        lt = (row.get("listing_type_id") or "").lower()
        pct = None
        details = row.get("sale_fee_details") or {}
        if isinstance(details, dict) and details.get("percentage_fee") is not None:
            try:
                pct = float(details["percentage_fee"]) / 100.0
            except (TypeError, ValueError):
                pct = None
        if want and lt == want:
            score = 3
        elif lt in ("gold_special", "gold_pro"):
            score = 2
        else:
            score = 1
        if best is None or score > best[0]:
            best = (score, fee_f, pct, row)
    if not best:
        return {"cargo_venta": None, "pct_venta_api": None, "fuente_venta": "listing_prices"}
    return {
        "cargo_venta": best[1],
        "pct_venta_api": best[2],
        "fuente_venta": "listing_prices",
    }


def parse_shipping_options_free(payload: dict | None) -> float | None:
    """
    Costo que el vendedor paga por Envíos Mercado Libre (`list_cost`).
    Coincide con “Envíos en Mercado Libre: pagarás $X” del panel del vendedor.
    """
    data = payload or {}
    coverage = data.get("coverage") or {}
    all_country = coverage.get("all_country") or {}
    list_cost = all_country.get("list_cost")
    if list_cost is None:
        return None
    try:
        return float(list_cost)
    except (TypeError, ValueError):
        return None


def _meli_user_id(token: str) -> int | None:
    import requests as _req
    try:
        res = _req.get(
            "https://api.mercadolibre.com/users/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )
        if res.status_code != 200:
            return None
        uid = (res.json() or {}).get("id")
        return int(uid) if uid is not None else None
    except Exception:
        return None


def _fetch_cobros_un_item(meli_id: str, token: str, user_id: int | None = None) -> dict:
    """
    Cobros como en el panel de publicaciones MeLi:
      - cargo_venta: listing_prices.sale_fee_amount (“Pagarás $X por venta”)
      - cargo_envio: users/.../shipping_options/free list_cost
        (“Envíos en Mercado Libre: pagarás $X”), según free_shipping actual del ítem.
    """
    import requests as _req

    headers = {"Authorization": f"Bearer {token}"}
    mid = meli_id.strip().upper()
    try:
        item_res = _req.get(
            f"https://api.mercadolibre.com/items/{mid}",
            headers=headers,
            timeout=12,
        )
        if item_res.status_code != 200:
            return {
                "precio_meli": None,
                "cargo_venta": None,
                "cargo_envio": None,
                "fuente": "error",
                "error": f"item {item_res.status_code}",
            }
        item = item_res.json() or {}
        price = item.get("price")
        cat = item.get("category_id") or ""
        lt = item.get("listing_type_id") or "gold_special"
        ship = item.get("shipping") or {}
        free_shipping = bool(ship.get("free_shipping"))
        mode = ship.get("mode") or "me2"
        logistic_type = ship.get("logistic_type") or "cross_docking"
        condition = item.get("condition") or "new"

        precio_f = None
        if price is not None:
            try:
                precio_f = float(price)
            except (TypeError, ValueError):
                precio_f = None

        # Cargo por venta
        cargo_venta = None
        pct_api = None
        lp = _req.get(
            "https://api.mercadolibre.com/sites/MCO/listing_prices",
            params={"price": price, "category_id": cat, "listing_type_id": lt},
            headers=headers,
            timeout=12,
        )
        if lp.status_code == 200:
            parsed_lp = parse_cobros_listing_prices(lp.json(), listing_type_id=lt)
            cargo_venta = parsed_lp.get("cargo_venta")
            pct_api = parsed_lp.get("pct_venta_api")

        # Envíos Mercado Libre — pagarás (según configuración actual del ítem)
        cargo_envio = None
        uid = user_id or _meli_user_id(token)
        if uid and precio_f is not None:
            sh = _req.get(
                f"https://api.mercadolibre.com/users/{uid}/shipping_options/free",
                params={
                    "item_id": mid,
                    "verbose": "true",
                    "free_shipping": "true" if free_shipping else "false",
                    "item_price": precio_f,
                    "listing_type_id": lt,
                    "mode": mode,
                    "condition": condition,
                    "logistic_type": logistic_type,
                },
                headers=headers,
                timeout=12,
            )
            if sh.status_code == 200:
                cargo_envio = parse_shipping_options_free(sh.json())

        return {
            "precio_meli": precio_f,
            "cargo_venta": cargo_venta,
            "cargo_envio": cargo_envio,
            "pct_venta_api": pct_api,
            "free_shipping": free_shipping,
            "envio_a_cargo_comprador": not free_shipping,
            "estado_meli": item.get("status"),
            "fuente": "listing_prices+shipping_options",
        }
    except Exception as e:
        return {
            "precio_meli": None,
            "cargo_venta": None,
            "cargo_envio": None,
            "fuente": "error",
            "error": str(e),
        }


def listar_cobros_meli(buscar: str = "", refresh: bool = False) -> dict:
    """
    Lista publicaciones activas con cargo por venta y cargo por envío (API MeLi).
    Cachea resultados ~1 h en app/data/meli_cobros_cache.json.
    """
    # Corrige SKUs desfasados (ej. C-SORPOTKg vs C-SORPOT100g en el mismo MCO).
    try:
        _parchear_skus_cobros_cache_desde_relacion()
    except Exception:
        pass

    q = (buscar or "").strip().lower()
    now = time.time()
    cache: dict = {}
    if not refresh and os.path.isfile(_COBROS_MELI_CACHE_PATH):
        try:
            with open(_COBROS_MELI_CACHE_PATH, encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            cache = {}

    cache_ts = float(cache.get("ts") or 0)
    cache_ver = int(cache.get("version") or 0)
    cache_items = {str(i.get("meli_id") or "").upper(): i for i in (cache.get("items") or []) if i.get("meli_id")}
    # v2 = listing_prices + shipping_options/free (Envíos MeLi “pagarás”)
    cache_ok = (
        cache_ver >= 2
        and (now - cache_ts) < _COBROS_MELI_TTL
        and bool(cache_items)
    )

    catalogo = _catalogo_publicaciones_meli()
    if not catalogo:
        # Último recurso: devolver cobros cacheados aunque no haya catálogo web
        if cache_items:
            items_fb = list(cache_items.values())
            if q:
                items_fb = [
                    i for i in items_fb
                    if q in (i.get("sku") or "").lower()
                    or q in (i.get("nombre") or "").lower()
                    or q in (i.get("meli_id") or "").lower()
                ]
            items_fb.sort(key=lambda i: (i.get("nombre") or "").lower())
            return {
                "items": items_fb,
                "totales": _totales_cobros(items_fb),
                "actualizado_en": cache.get("actualizado_en"),
                "fuente": "cobros_cache_sin_catalogo_web",
                "total": len(items_fb),
                "cache_hit": True,
                "aviso": "Catálogo web (cache.json) no disponible; mostrando cobros MeLi en caché.",
            }
        return {
            "items": [],
            "totales": {"cargo_venta": 0.0, "cargo_envio": 0.0, "precio": 0.0},
            "actualizado_en": None,
            "fuente": "cache_vacio",
            "total": 0,
        }

    from app.utils import refrescar_token_meli
    token = refrescar_token_meli() if (refresh or not cache_ok) else None

    items_out: list[dict] = []
    need_fetch = []
    for pub in catalogo:
        mid = pub["meli_id"]
        if cache_ok and mid in cache_items and not refresh:
            row = dict(cache_items[mid])
            row["sku"] = pub["sku"]
            row["nombre"] = pub["nombre"]
            items_out.append(row)
        else:
            need_fetch.append(pub)

    if need_fetch:
        if not token:
            token = refrescar_token_meli()
        if not token:
            _incorporar_cobros_huerfanos(items_out, cache_items)
            return {
                "items": items_out,
                "totales": _totales_cobros(items_out),
                "actualizado_en": cache.get("actualizado_en"),
                "fuente": "sin_token",
                "error": "No se pudo refrescar token MeLi",
                "total": len(items_out),
            }

        from concurrent.futures import ThreadPoolExecutor, as_completed

        user_id = _meli_user_id(token)

        def _uno(pub: dict) -> dict:
            cobros = _fetch_cobros_un_item(pub["meli_id"], token, user_id=user_id)
            precio = cobros.get("precio_meli")
            cv = cobros.get("cargo_venta")
            ce = cobros.get("cargo_envio")
            pct = cobros.get("pct_venta_api")
            if pct is None and precio and cv is not None and float(precio) > 0:
                pct = round(float(cv) / float(precio), 4)
            neto = None
            if precio is not None:
                neto = round(float(precio) - float(cv or 0) - float(ce or 0), 2)
            return {
                "sku": pub["sku"],
                "nombre": pub["nombre"],
                "meli_id": pub["meli_id"],
                "precio_meli": precio,
                "cargo_venta": cv,
                "cargo_envio": ce,
                "pct_venta": pct,
                "neto_estimado": neto,
                "free_shipping": cobros.get("free_shipping"),
                "envio_a_cargo_comprador": cobros.get("envio_a_cargo_comprador"),
                "estado_meli": cobros.get("estado_meli"),
                "fuente": cobros.get("fuente"),
                "error": cobros.get("error"),
            }

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_uno, pub): pub for pub in need_fetch}
            for fut in as_completed(futures):
                try:
                    row = fut.result()
                except Exception as e:
                    pub = futures[fut]
                    row = {
                        "sku": pub["sku"],
                        "nombre": pub["nombre"],
                        "meli_id": pub["meli_id"],
                        "precio_meli": None,
                        "cargo_venta": None,
                        "cargo_envio": None,
                        "pct_venta": None,
                        "neto_estimado": None,
                        "fuente": "error",
                        "error": str(e),
                    }
                items_out.append(row)
                cache_items[row["meli_id"]] = row

        # Persistir caché completa del catálogo
        try:
            all_rows = list(cache_items.values())
            payload = {
                "version": 2,
                "ts": now,
                "actualizado_en": datetime.now().isoformat(timespec="seconds"),
                "items": all_rows,
            }
            tmp = _COBROS_MELI_CACHE_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            os.replace(tmp, _COBROS_MELI_CACHE_PATH)
            cache = payload
        except Exception:
            pass

    # Publicaciones que el catálogo web dejó fuera (meli_id distinto/colisionado)
    _alinear_skus_con_cobros(items_out, cache_items)
    _incorporar_cobros_huerfanos(items_out, cache_items)

    if q:
        items_out = [
            i for i in items_out
            if q in (i.get("sku") or "").lower()
            or q in (i.get("nombre") or "").lower()
            or q in (i.get("meli_id") or "").lower()
        ]

    items_out.sort(key=lambda i: (i.get("nombre") or "").lower())
    return {
        "items": items_out,
        "totales": _totales_cobros(items_out),
        "actualizado_en": cache.get("actualizado_en") or (datetime.now().isoformat(timespec="seconds") if need_fetch else None),
        "fuente": "meli",
        "total": len(items_out),
        "cache_hit": cache_ok and not refresh and not need_fetch,
    }


def _totales_cobros(items: list[dict]) -> dict:
    tv = te = tp = 0.0
    for i in items:
        if i.get("cargo_venta") is not None:
            tv += float(i["cargo_venta"])
        if i.get("cargo_envio") is not None:
            te += float(i["cargo_envio"])
        if i.get("precio_meli") is not None:
            tp += float(i["precio_meli"])
    return {
        "cargo_venta": round(tv, 2),
        "cargo_envio": round(te, 2),
        "precio": round(tp, 2),
    }


def listar_ganancia_meli(buscar: str = "", refresh: bool = False) -> dict:
    """
    Ganancia por publicación:
      ganancia = precio_venta − costo_real_producto − (cargo_venta + cargo_envio MeLi)
    Une costos Siigo (costos_todos_resumen) + cobros MeLi (caché/API).
    Con refresh=True fuerza cobros/precios MeLi + reconstrucción de costos Siigo.
    """
    cobros = listar_cobros_meli(buscar="", refresh=refresh)
    costos = costos_todos_resumen(refresh=refresh)

    q = (buscar or "").strip().lower()
    items_out: list[dict] = []
    sum_precio = sum_costo = sum_cobros = sum_ganancia = 0.0
    n_con_ganancia = 0

    for c in cobros.get("items") or []:
        sku = (c.get("sku") or "").strip()
        nombre = (c.get("nombre") or sku).strip()
        mid = (c.get("meli_id") or "").strip()
        if q and not (
            q in sku.lower() or q in nombre.lower() or q in mid.lower()
        ):
            continue

        precio = c.get("precio_meli")
        cv = c.get("cargo_venta")
        ce = c.get("cargo_envio")
        cobros_total = None
        if cv is not None or ce is not None:
            cobros_total = round(float(cv or 0) + float(ce or 0), 2)

        cost_info = costos.get(sku.upper()) or costos.get(sku) or {}
        costo_real = cost_info.get("costo_total")
        sin_costo = int(cost_info.get("sin_costo") or 0) if cost_info else None

        ganancia = None
        margen_pct = None
        if precio is not None and costo_real is not None and cobros_total is not None:
            ganancia = round(float(precio) - float(costo_real) - float(cobros_total), 2)
            if float(precio) > 0:
                margen_pct = round(ganancia / float(precio), 4)

        if precio is not None:
            sum_precio += float(precio)
        if costo_real is not None:
            sum_costo += float(costo_real)
        if cobros_total is not None:
            sum_cobros += float(cobros_total)
        if ganancia is not None:
            sum_ganancia += float(ganancia)
            n_con_ganancia += 1

        items_out.append({
            "sku": sku,
            "nombre": nombre,
            "meli_id": mid,
            "precio_venta": precio,
            "costo_real": costo_real,
            "sin_costo": sin_costo,
            "cargo_venta": cv,
            "cargo_envio": ce,
            "cobros_meli": cobros_total,
            "ganancia": ganancia,
            "margen_pct": margen_pct,
            "free_shipping": c.get("free_shipping"),
        })

    items_out.sort(key=lambda i: (i.get("nombre") or "").lower())
    return {
        "items": items_out,
        "total": len(items_out),
        "con_ganancia": n_con_ganancia,
        "actualizado_en": cobros.get("actualizado_en"),
        "cache_hit": cobros.get("cache_hit"),
        "totales": {
            "precio_venta": round(sum_precio, 2),
            "costo_real": round(sum_costo, 2),
            "cobros_meli": round(sum_cobros, 2),
            "ganancia": round(sum_ganancia, 2),
        },
    }


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
