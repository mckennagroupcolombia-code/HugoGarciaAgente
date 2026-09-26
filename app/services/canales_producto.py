# -*- coding: utf-8 -*-
"""Canales del producto — el orquestador visual por SKU de venta.

Responde la pregunta que ningún panel contestaba junta: **¿dónde vive cada SKU y
dónde se rompe?** Un producto nace en el inventario de Alegra, se arma como combo,
recibe EAN/documento/etiqueta, se publica en MeLi y en la web, y al venderse debe
poder facturarse. Cada canal tiene su propio almacén y su propia llave; cuando un
código existe en un canal y no en otro, la venta sale pero la factura falla con
«no existe en Alegra», o los canales muestran cosas distintas sin que nadie lo vea.

Solo lectura y **solo diagnóstico**: no crea vías de escritura nuevas — cada
problema lleva (vía el panel) al apartado que ya existe. Cero llamadas vivas a
Alegra o MeLi en la tabla; todo sale de caches locales:

  * Copia local del catálogo Alegra (`alegra_catalogo_db`, con `status` fiable
    desde que el sync marca inactivos) — y los alias de venta
    (`app/data/alegra_sku_alias_venta.json`), la misma regla que usa la
    facturación (`alegra.resolver_producto_venta_alegra`).
  * Publicaciones MeLi: `app/data/relacion_codigos_cache.json` (relación de
    códigos, TTL 30 min; el refresco lo hace su endpoint de siempre).
  * Tienda web: `PAGINA_WEB/site/data/cache.json`.
  * EAN: `ean_alegra.enlaces()`. Combo/documento/etiqueta:
    `mapa_producto.anatomia_combos()`.

La única llamada viva es `verificar_en_vivo(sku)`, por botón y por SKU.

Una fuente que falle se omite y se anuncia en `sin_senal` (patrón mapa_app): un
mapa que se cae por un módulo esconde justo lo que debe mostrar.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
_ALIAS_JSON = REPO / "app" / "data" / "alegra_sku_alias_venta.json"
_RELACION_JSON = REPO / "app" / "data" / "relacion_codigos_cache.json"
_CACHE_WEB = REPO / "PAGINA_WEB" / "site" / "data" / "cache.json"
_STOCK_WEB_JSON = REPO / "PAGINA_WEB" / "site" / "data" / "stock_web.json"
_PAUSA_GLOBAL_JSON = REPO / "app" / "data" / "meli_pausa_global.json"

_TTL_S = 90
_lock = threading.Lock()
_memo: dict[str, Any] = {"t": 0.0, "data": None}

# Orden de gravedad de las clasificaciones (la primera que aplique gana).
CLASIFICACIONES = (
    "vendible_no_facturable",
    "inactivo_publicado",
    "inactivo_con_alias",
    "pausado_no_facturable",
    "discrepancia_canales",
    "incompleto",
    "suelto",
    "completo",
)


def invalidar() -> None:
    with _lock:
        _memo["t"] = 0.0
        _memo["data"] = None


def _leer_json(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        return defecto


def _u(s: Any) -> str:
    return str(s or "").strip().upper()


# ── Fuentes (cada una puede faltar sin tumbar la tabla) ──────────────────────

def _fuente_alegra() -> dict[str, dict]:
    """{REF_UPPER: {ref, nombre, tipo, status}} — todo el espejo local, activos e inactivos."""
    from app.services import alegra_catalogo_db as ac

    out: dict[str, dict] = {}
    offset = 0
    while True:
        lote = ac.listar_items(limit=500, offset=offset, solo_activos=False)
        items = lote.get("items") or []
        for it in items:
            ref = str(it.get("reference") or "").strip()
            if not ref:
                continue
            out[_u(ref)] = {
                "ref": ref,
                "nombre": it.get("name") or ref,
                "tipo": it.get("type") or "product",
                "status": (it.get("status") or "active").strip().lower(),
            }
        offset += len(items)
        if not items or offset >= int(lote.get("total") or 0):
            break
    return out


def _fuente_alias() -> dict[str, str]:
    """{SKU_VENTA_UPPER: reference en Alegra} — mismo formato que lee alegra.py."""
    data = _leer_json(_ALIAS_JSON, {}) or {}
    return {
        _u(k): str(v).strip()
        for k, v in (data.get("alias") or {}).items()
        if str(v or "").strip()
    }


def _pausadas_por_cese() -> set[str]:
    """Publicaciones que estaban ACTIVAS y pausó el cese de actividades global.

    Mientras dure el cese, MeLi las reporta «paused», pero su estado real de
    negocio es activo: vuelven solas al levantarlo (scripts/pausa_global_meli.py)."""
    data = _leer_json(_PAUSA_GLOBAL_JSON, {}) or {}
    if not data.get("activa"):
        return set()
    return {_u(x) for x in data.get("items_pausados") or []}


def _fuente_meli() -> dict[str, list[dict]]:
    """{SKU_UPPER: [publicaciones]} desde relacion_codigos_cache.json."""
    data = _leer_json(_RELACION_JSON, {}) or {}
    por_cese = _pausadas_por_cese()
    out: dict[str, list[dict]] = {}
    for it in data.get("items") or []:
        sku = _u(it.get("sku_meli") or it.get("codigo_siigo"))
        if not sku:
            continue
        estado = (it.get("estado_meli") or "").strip().lower()
        cese = estado == "paused" and _u(it.get("meli_id")) in por_cese
        out.setdefault(sku, []).append({
            "meli_id": it.get("meli_id") or "",
            "titulo": it.get("titulo") or "",
            "estado_meli": "active" if cese else estado,
            "pausada_por_cese": cese,
            "relacion": it.get("estado") or "",
            "permalink": it.get("permalink") or "",
            "en_siigo": bool(it.get("en_siigo")),
        })
    return out


def _fuente_web() -> dict[str, dict]:
    """{REF_UPPER: {nombre, cat, buyable, stock}} desde cache.json de la tienda."""
    cache = _leer_json(_CACHE_WEB, {}) or {}
    stock = _leer_json(_STOCK_WEB_JSON, {}) or {}
    out: dict[str, dict] = {}

    def _add(p: dict, cat: str) -> None:
        ref = _u(p.get("ref"))
        if not ref:
            return
        st = (stock.get(ref) or {}).get("stock") if isinstance(stock.get(ref), dict) else None
        out[ref] = {
            "nombre": p.get("name") or "",
            "cat": p.get("cat") or cat or "",
            "buyable": bool(p.get("buyable", True)) and not p.get("solo_vitrina"),
            "stock": st if st is not None else p.get("stock"),
        }

    for s in cache.get("sections") or []:
        for p in s.get("products") or []:
            _add(p, s.get("name") or "")
            for c in p.get("combos") or []:
                _add(c, s.get("name") or "")
    for c in cache.get("combos") or []:
        _add(c, "")
    return out


def _fuente_ean() -> dict[str, dict]:
    """{SKU_UPPER: {estado, codigo}} desde el catálogo de códigos EAN."""
    from app.services import ean_alegra

    out: dict[str, dict] = {}
    for e in ean_alegra.enlaces():
        sku = _u(e.get("sku"))
        if sku:
            out[sku] = {"estado": e.get("estado") or "", "codigo": e.get("codigo") or ""}
    return out


def _fuente_combos() -> dict[str, dict]:
    """{REF_UPPER: eslabones del taller} — documento/etiqueta/receta por combo."""
    from app.services import mapa_producto

    out: dict[str, dict] = {}
    for c in mapa_producto.anatomia_combos().get("combos") or []:
        ref = _u(c.get("ref"))
        if not ref:
            continue
        esl = c.get("eslabones") or {}
        out[ref] = {
            "receta": (esl.get("receta") or {}).get("estado"),
            "documento": (esl.get("documento") or {}).get("estado"),
            "etiqueta": (esl.get("etiqueta") or {}).get("estado"),
            "ean": (esl.get("ean") or {}).get("estado"),
            "nombre": c.get("nombre") or "",
        }
    return out


# ── Facturabilidad (misma regla que alegra.resolver_producto_venta_alegra,
#    pero contra la copia local: cero llamadas vivas) ─────────────────────────

def _facturable(sku_u: str, alegra: dict[str, dict], alias: dict[str, str]) -> dict:
    item = alegra.get(sku_u)
    ref_alias = alias.get(sku_u)
    destino_alias = alegra.get(_u(ref_alias)) if ref_alias else None
    inactivo = bool(item) and item.get("status") != "active"
    if item and not inactivo:
        return {"estado": "si", "alias_destino": ""}
    if item and inactivo and destino_alias and destino_alias.get("status") == "active":
        return {"estado": "alias", "alias_destino": ref_alias}
    if item and inactivo:
        # La factura saldría contra un ítem inactivo (después no se puede anular).
        return {"estado": "inactivo", "alias_destino": ""}
    if destino_alias and destino_alias.get("status") == "active":
        return {"estado": "alias", "alias_destino": ref_alias}
    return {"estado": "no", "alias_destino": ref_alias or ""}


def _clasificar(fila: dict) -> tuple[str, list[str]]:
    """La primera clasificación (por gravedad) que aplique, con sus motivos."""
    motivos: list[str] = []
    can = fila["canales"]
    # «Se vende» = publicación activa (o activa pausada solo por el cese) o visible en la web.
    publicado = can["meli"]["estado"] == "publicado" or can["web"]["estado"] == "publicado"
    fact = can["facturable"]["estado"]
    alegra_estado = can["alegra"]["estado"]

    if publicado and fact == "no":
        motivos.append("Se vende (MeLi/web) con un código que no existe en Alegra ni tiene alias: la factura falla.")
        return "vendible_no_facturable", motivos
    if publicado and fact == "inactivo":
        motivos.append("El código existe en Alegra pero está INACTIVO y sin alias: la factura saldría contra un ítem inactivo.")
        return "inactivo_publicado", motivos
    if can["meli"]["estado"] == "pausado" and fact in ("no", "inactivo"):
        motivos.append("Publicación pausada con un código que Alegra no factura: si se reactiva, sus ventas no se podrán facturar.")
        return "pausado_no_facturable", motivos
    if fact == "alias" and alegra_estado in ("inactivo", "falta"):
        motivos.append(f"Se factura por su alias «{can['facturable']['alias_destino']}»; el código propio no sirve directo.")
        return "inactivo_con_alias", motivos
    if can["meli"]["relacion"] == "sku_divergente":
        motivos.append("El SKU de la publicación MeLi no coincide con el código de Alegra (relación de códigos).")
        return "discrepancia_canales", motivos
    if can["web"]["estado"] == "publicado" and can["meli"]["estado"] == "falta":
        motivos.append("Está en la tienda web sin publicación MeLi conocida (la web nace de MeLi: revisar el vínculo).")
        return "discrepancia_canales", motivos
    if can["meli"]["estado"] == "publicado" and can["web"]["estado"] == "falta" and alegra_estado == "ok" and fila.get("es_kit"):
        motivos.append("Publicado en MeLi pero la tienda web no lo muestra (sin precio de lista o sin vínculo).")
        return "discrepancia_canales", motivos
    if not fila.get("es_kit") and alegra_estado == "ok" and publicado:
        motivos.append("Se vende como producto simple, sin combo: no descuenta empaque ni etiqueta, y la tienda web no lo puede mostrar.")
        return "incompleto", motivos
    if fila.get("es_kit") and any(
        can[k]["estado"] in ("falta", "aviso") for k in ("documento", "ean", "etiqueta")
    ):
        faltan = [k for k in ("documento", "ean", "etiqueta") if can[k]["estado"] in ("falta", "aviso")]
        motivos.append("Le falta o tiene a medias: " + ", ".join(faltan) + ".")
        return "incompleto", motivos
    if alegra_estado == "ok" and fila.get("es_kit") and can["meli"]["estado"] == "falta" and can["web"]["estado"] == "falta":
        motivos.append("Combo de venta en Alegra sin publicación en ningún canal.")
        return "suelto", motivos
    return "completo", motivos


def _saltos(fila: dict) -> list[dict]:
    """A qué apartado existente lleva cada problema (solo navegación, sin escritura)."""
    out: list[dict] = []
    can = fila["canales"]
    cls = fila["clasificacion"]
    sku = fila["sku"]
    if cls in ("vendible_no_facturable", "inactivo_publicado", "pausado_no_facturable"):
        out.append({"panel": "catalogo-alegra", "motivo": "Ver o crear el código en el catálogo Alegra", "buscar": sku})
        out.append({"panel": "stock", "motivo": "Relación de códigos MeLi ↔ Alegra (vincular)", "buscar": sku})
    if cls == "discrepancia_canales":
        out.append({"panel": "stock", "motivo": "Relación de códigos MeLi ↔ Alegra", "buscar": sku})
        out.append({"panel": "publicaciones", "motivo": "Cómo se ve en la web y en MeLi", "buscar": sku})
    if cls == "incompleto" and fila.get("es_kit"):
        out.append({"panel": "combos", "motivo": "Completar las piezas en el taller de combos", "buscar": sku})
    if cls == "incompleto" and not fila.get("es_kit"):
        out.append({"panel": "catalogo-alegra", "motivo": "Armar su combo de venta en el catálogo Alegra", "buscar": sku})
    if cls == "suelto":
        out.append({"panel": "publicaciones", "motivo": "Publicarlo en los canales", "buscar": sku})
    if can["ean"]["estado"] in ("falta", "aviso") and fila.get("es_kit") and not any(s["panel"] == "combos" for s in out):
        out.append({"panel": "combos", "motivo": "Código de barras (pieza EAN del taller)", "buscar": sku})
    return out


# ── API pública ──────────────────────────────────────────────────────────────

def tabla_maestra(refrescar: bool = False) -> dict:
    with _lock:
        if not refrescar and _memo["data"] is not None and time.time() - _memo["t"] < _TTL_S:
            return _memo["data"]

    sin_senal: list[dict] = []

    def _carga(nombre: str, fn, defecto):
        try:
            return fn()
        except Exception as exc:
            sin_senal.append({"fuente": nombre, "error": str(exc)[:160]})
            return defecto

    alegra = _carga("catálogo Alegra (copia local)", _fuente_alegra, {})
    alias = _carga("alias de venta", _fuente_alias, {})
    meli = _carga("relación de códigos MeLi", _fuente_meli, {})
    web = _carga("tienda web (cache.json)", _fuente_web, {})
    ean = _carga("códigos EAN", _fuente_ean, {})
    combos = _carga("taller de combos", _fuente_combos, {})

    # Universo: SKUs de VENTA — kits de Alegra ∪ lo publicado en MeLi ∪ lo de la
    # web ∪ las claves de alias. Los productos simples (materia prima) no son SKU
    # de venta y solo entran si algún canal los referencia.
    universo: dict[str, str] = {}  # upper → SKU para mostrar

    def _agrega(sku: str) -> None:
        u = _u(sku)
        if u and u not in universo:
            universo[u] = str(sku).strip()

    for it in alegra.values():
        if it.get("tipo") == "kit":
            _agrega(it["ref"])
    for u in list(meli.keys()) + list(web.keys()) + list(alias.keys()):
        _agrega(u)

    filas: list[dict] = []
    for u, sku in sorted(universo.items()):
        it_alegra = alegra.get(u)
        pubs = meli.get(u) or []
        pub_activa = next((p for p in pubs if p["estado_meli"] == "active"), None)
        pub = pub_activa or (pubs[0] if pubs else None)
        w = web.get(u)
        esl = combos.get(u) or {}
        nombre = (
            (it_alegra or {}).get("nombre")
            or (w or {}).get("nombre")
            or (pub or {}).get("titulo")
            or sku
        )
        estado_meli = "falta"
        if pub:
            estado_meli = "publicado" if (pub_activa or pub["estado_meli"] == "active") else "pausado"
        fila = {
            "sku": sku,
            "nombre": nombre,
            "es_kit": bool(it_alegra and it_alegra.get("tipo") == "kit"),
            "canales": {
                "alegra": {
                    "estado": (
                        "ok" if it_alegra and it_alegra.get("status") == "active"
                        else ("inactivo" if it_alegra else "falta")
                    ),
                    "tipo": (it_alegra or {}).get("tipo") or "",
                },
                "combo": {"estado": esl.get("receta") or ("na" if not it_alegra else "falta")},
                "documento": {"estado": esl.get("documento") or "na"},
                "ean": {
                    "estado": (
                        "ok" if (ean.get(u) or {}).get("estado") in ("enlazado", "aproximado")
                        else ("aviso" if u in ean else (esl.get("ean") or "na"))
                    ),
                    "codigo": (ean.get(u) or {}).get("codigo") or "",
                },
                "etiqueta": {"estado": esl.get("etiqueta") or "na"},
                "meli": {
                    "estado": estado_meli,
                    "pausada_por_cese": bool((pub or {}).get("pausada_por_cese")),
                    "n_publicaciones": len(pubs),
                    "meli_id": (pub or {}).get("meli_id") or "",
                    "permalink": (pub or {}).get("permalink") or "",
                    "relacion": (pub or {}).get("relacion") or "",
                },
                "web": {
                    "estado": "publicado" if w else "falta",
                    "cat": (w or {}).get("cat") or "",
                    "buyable": bool((w or {}).get("buyable")) if w else False,
                    "stock": (w or {}).get("stock") if w else None,
                },
                "facturable": _facturable(u, alegra, alias),
            },
        }
        fila["clasificacion"], fila["motivos"] = _clasificar(fila)
        fila["saltos"] = _saltos(fila)
        filas.append(fila)

    resumen = {c: 0 for c in CLASIFICACIONES}
    for f in filas:
        resumen[f["clasificacion"]] = resumen.get(f["clasificacion"], 0) + 1

    data = {
        "filas": filas,
        "total": len(filas),
        "resumen": resumen,
        "sin_senal": sin_senal,
        "fuentes": _frescura_fuentes(),
        "generado": datetime.now().isoformat(timespec="seconds"),
    }
    with _lock:
        _memo["t"] = time.time()
        _memo["data"] = data
    return data


def _frescura_fuentes() -> dict:
    """Edad de cada cache, para que el panel diga con qué datos está hablando."""
    out: dict[str, Any] = {}
    try:
        from app.services import alegra_catalogo_db as ac

        out["alegra"] = {"synced_at": ac.ultima_sync_at(), "stale": ac.catalogo_stale()}
    except Exception:
        out["alegra"] = None
    rel = _leer_json(_RELACION_JSON, {}) or {}
    out["relacion_meli"] = {
        "actualizado_en": rel.get("actualizado_en"),
        "edad_s": int(time.time() - float(rel.get("ts") or 0)) if rel.get("ts") else None,
    }
    try:
        out["web_cache"] = {
            "mtime": datetime.fromtimestamp(_CACHE_WEB.stat().st_mtime).isoformat(timespec="seconds")
        }
    except Exception:
        out["web_cache"] = None
    return out


def categorias_por_producto(refrescar: bool = False) -> dict:
    """Las tres taxonomías lado a lado por SKU de venta.

    MeLi no guarda `category_id` en ningún cache local: sale «sin dato local» a
    propósito (agregarlo al refresco de relación de códigos es una mejora aparte).
    """
    tabla = tabla_maestra(refrescar=refrescar)
    try:
        from app.tools.etiquetas_categorias import detectar_categoria, listar_categorias

        cats = listar_categorias()
    except Exception:
        detectar_categoria = None  # type: ignore[assignment]
        cats = []
    filas = []
    for f in tabla["filas"]:
        cat_etq = ""
        if detectar_categoria is not None:
            try:
                cat_etq = detectar_categoria(f["nombre"], cats)
            except Exception:
                cat_etq = ""
        filas.append({
            "sku": f["sku"],
            "nombre": f["nombre"],
            "clasificacion": f["clasificacion"],
            "cat_etiquetas": cat_etq,
            "cat_web": f["canales"]["web"]["cat"],
            "cat_meli": None,  # sin dato local (v1)
        })
    # Cuántas web-cat distintas caen en cada categoría de etiquetas (desalineación).
    return {
        "filas": filas,
        "total": len(filas),
        "generado": tabla["generado"],
        "sin_senal": tabla["sin_senal"],
    }


def verificar_en_vivo(sku: str) -> dict:
    """La única llamada viva: qué diría HOY la facturación de este SKU."""
    from app.services.alegra import resolver_producto_venta_alegra

    try:
        prod = resolver_producto_venta_alegra(sku)
    except Exception as exc:
        return {"ok": False, "sku": sku, "error": str(exc)[:200]}
    if not prod:
        return {
            "ok": True, "sku": sku, "facturable": False,
            "mensaje": f"«{sku}» no existe en Alegra ni tiene alias: la factura fallaría.",
        }
    return {
        "ok": True,
        "sku": sku,
        "facturable": True,
        "reference": prod.get("reference") or prod.get("alias_de") or sku,
        "alias_de": prod.get("alias_de") or "",
        "nombre": prod.get("name") or "",
        "status": prod.get("status") or "",
        "mensaje": (
            f"Se facturaría como «{prod.get('alias_de')}» (alias)."
            if prod.get("alias_de")
            else "Se factura con su propio código."
        ),
    }


def resumen_bloqueos() -> list[dict]:
    """Bloqueos para el mapa de la app (etapa «publicar»)."""
    r = tabla_maestra().get("resumen") or {}
    out = []
    n = int(r.get("vendible_no_facturable") or 0) + int(r.get("inactivo_publicado") or 0)
    if n:
        out.append({
            "etapa": "publicar", "id": "skus_no_facturables", "n": n,
            "texto": "SKUs publicados cuya venta no se puede facturar",
            "panel": "canales-producto", "severidad": "alta",
        })
    d = int(r.get("discrepancia_canales") or 0)
    if d:
        out.append({
            "etapa": "publicar", "id": "skus_discrepancia_canales", "n": d,
            "texto": "SKUs con discrepancia entre MeLi, la web y Alegra",
            "panel": "canales-producto", "severidad": "media",
        })
    return out
