"""
Categorías de producto para las etiquetas (aceites, frutos secos, conservantes…).

Es el primer nivel de organización de Diseño → Studio visual: cada categoría tiene
su plantilla y agrupa las etiquetas hechas con ella. La lista nació fija en el panel
(desktop/src/lib/categoriasEtiqueta.ts) y se movió aquí para que el operador pueda
crear categorías nuevas.

`claves` son las palabras que se buscan en el nombre del producto para deducir su
categoría; se recorren EN ORDEN, así que lo específico ("aceite esencial") va antes
que lo genérico ("aceite").

Ojo con el precedente de `_load_etiquetas_tipos` en app/routes.py: allí los valores de
fábrica se reinyectaban en cada lectura y por eso era imposible borrar uno. Aquí la
semilla solo se usa cuando el archivo todavía no existe; después manda el JSON tal
cual quedó.
"""
from __future__ import annotations

import copy
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_DATA_PATH = _REPO / "app" / "data" / "etiquetas_categorias.json"

CATEGORIA_OTROS = "otros"

#: Semilla del catálogo — solo se escribe si el archivo no existe todavía.
CATEGORIAS_SEMILLA: list[dict] = [
    {"id": "fragancias", "etiqueta": "Fragancias", "claves": ["fragancia", "perfume", "aroma lipo", "aroma hidro"]},
    {"id": "aceites-esenciales", "etiqueta": "Aceites esenciales", "claves": ["aceite esencial", "esencial ", "esencia de", "oleorresina"]},
    {"id": "aceites", "etiqueta": "Aceites y grasas", "claves": ["aceite", "oleo", "grasa vegetal", "trigliceridos"]},
    {"id": "ceras-mantecas", "etiqueta": "Ceras y mantecas", "claves": ["cera ", "manteca", "karite", "butter", "parafina", "vaselina", "lanolina", "cetilico", "cetearilico", "estearilico", "alcohol graso"]},
    {"id": "extractos", "etiqueta": "Extractos vegetales", "claves": ["extracto", "tintura", "polvo de hoja", "hidrolato", "agua de "]},
    {"id": "frutos-secos", "etiqueta": "Frutos secos", "claves": ["mani", "almendra", "nuez", "marañon", "maranon", "pistacho", "avellana", "uva pasa", "ciruela", "arandano"]},
    {"id": "deshidratados", "etiqueta": "Deshidratados y hongos", "claves": ["deshidratad", "orellana", "flor de jamaica", "hongo", "champinon", "seco", "seca"]},
    {"id": "semillas", "etiqueta": "Semillas", "claves": ["semilla", "chia", "linaza", "ajonjoli", "sesamo", "quinua", "amapola", "girasol"]},
    {"id": "cereales-harinas", "etiqueta": "Cereales y harinas", "claves": ["harina", "avena", "salvado", "almidon", "fecula", "maiz", "arroz"]},
    {"id": "vitaminas", "etiqueta": "Vitaminas y suplementos", "claves": ["vitamina", "ascorbico", "tocoferol", "retinol", "niacinamida", "biotina", "acido folico", "cianocobalamina", "colecalciferol", "pantenol", "melatonina"]},
    {"id": "sales-minerales", "etiqueta": "Sales minerales", "claves": ["citrato", "gluconato", "bisglicinato", "quelato", "lactato de", "sulfato de magnesio", "cloruro de magnesio", "carbonato de calcio", "oxido de zinc", "oxido de magnesio", "mineral"]},
    {"id": "sales", "etiqueta": "Sales y ácidos inorgánicos", "claves": ["bicarbonato", "carbonato", "cloruro", "sulfato", "fosfato", "nitrato", "hidroxido", "soda caustica", "alumbre", "molibdato", "cremor tartaro", "azufre", "lactato", "sal "]},
    {"id": "acidos", "etiqueta": "Ácidos orgánicos", "claves": ["acido citrico", "acido lactico", "acido malico", "acido tartarico", "acido salicilico", "acido glicolico", "acido"]},
    {"id": "aminoacidos-proteinas", "etiqueta": "Aminoácidos y proteínas", "claves": ["colageno", "proteina", "arginina", "glicina", "lisina", "creatina", "taurina", "glutamina", "carnitina", "citrulina", "fenilalanina", "ornitina", "prolina", "teanina", "triptofano", "metionina", "aminoacido", "peptido", "keratina", "queratina", "elastina"]},
    {"id": "enzimas", "etiqueta": "Enzimas y fermentos", "claves": ["enzima", "papaina", "bromelina", "amilasa", "proteasa", "lipasa", "lactasa", "probiotico", "fermento", "levadura"]},
    {"id": "conservantes", "etiqueta": "Conservantes", "claves": ["conservante", "sharomix", "benzoato", "sorbato", "fenoxietanol", "parabeno", "geogard", "cosgard", "propionato", "glutaraldehido"]},
    {"id": "aditivos", "etiqueta": "Aditivos alimentarios", "claves": ["aditivo", "antiaglomerante", "antioxidante", "acidulante", "regulador de acidez", "potenciador", "saborizante", "colorante", "edulcorante", "estevia", "sucralosa", "eritritol", "sorbitol", "xilitol", "maltitol"]},
    {"id": "gelificantes", "etiqueta": "Gelificantes y espesantes", "claves": ["goma", "xantan", "xantana", "guar", "carragenina", "pectina", "gelatina", "agar", "carbomer", "carbopol", "espesante", "gelificante", "alginato", "celulosa", "inulina", "fibra"]},
    {"id": "emulsificantes", "etiqueta": "Emulsificantes", "claves": ["emulsificante", "emulsionante", "polawax", "cera autoemulsionante", "lecitina", "polisorbato", "tween", "span ", "monoestearato", "olivem"]},
    {"id": "tensoactivos", "etiqueta": "Tensoactivos", "claves": ["tensoactivo", "tensosil", "betaina", "lauril", "laureth", "coco glucosido", "cocamidopropil", "cocoamida", "btms", "sci ", "isetionato", "nonilfenol", "jabon", "sles", "sls"]},
    {"id": "solventes", "etiqueta": "Solventes", "claves": ["solvente", "alcohol", "etanol", "isopropilico", "glicerina", "propilenglicol", "butilenglicol", "acetona", "thinner", "varsol", "dpg", "agua destilada", "agua destilda", "dmso"]},
    {"id": "arcillas", "etiqueta": "Arcillas y minerales", "claves": ["arcilla", "bentonita", "caolin", "kaolin", "talco", "silice", "silica", "diatomea", "zeolita", "carbon activado"]},
    {"id": "excipientes", "etiqueta": "Excipientes y cápsulas", "claves": ["capsula", "excipiente", "estearato de magnesio", "dioxido de silicio", "celulosa microcristalina", "aglutinante", "desintegrante", "pastillero"]},
    {"id": "colorantes-reactivos", "etiqueta": "Colorantes y reactivos", "claves": ["azul de metileno", "verde malaquita", "violeta de genciana", "fucsina", "reactivo", "indicador"]},
    {"id": "activos-cosmeticos", "etiqueta": "Activos cosméticos", "claves": ["hialuronico", "retinal", "peptidos", "coenzima", "argireline", "matrixyl", "urea", "alantoina", "aloe", "bisabolol", "arbutina", "cafeina", "mentol", "embrion", "gusano de seda", "baba de caracol"]},
    {"id": "quimicos-industriales", "etiqueta": "Químicos industriales", "claves": ["resina", "epoxi", "poliuretano", "catalizador", "endurecedor", "pigmento industrial"]},
    {"id": "otros", "etiqueta": "Otros", "claves": []},
]

_cache: dict[str, Any] = {"mtime": None, "items": None}


def _normalizar(texto: str) -> str:
    """minúsculas, sin tildes, espacios colapsados."""
    base = unicodedata.normalize("NFD", texto or "")
    base = "".join(c for c in base if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", base.lower()).strip()


def _normalizar_item(item: Any) -> dict | None:
    if not isinstance(item, dict):
        return None
    cid = (item.get("id") or "").strip()
    etiqueta = (item.get("etiqueta") or "").strip()
    if not cid or not etiqueta:
        return None
    claves = item.get("claves")
    claves = [c.strip() for c in claves if isinstance(c, str) and c.strip()] if isinstance(claves, list) else []
    return {"id": cid, "etiqueta": etiqueta, "claves": claves}


def _escribir(items: list[dict]) -> None:
    _DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump({"categorias": items}, f, ensure_ascii=False, indent=2)
    try:
        _cache["mtime"] = _DATA_PATH.stat().st_mtime
    except OSError:
        _cache["mtime"] = None
    _cache["items"] = copy.deepcopy(items)


def listar_categorias() -> list[dict]:
    try:
        mtime = _DATA_PATH.stat().st_mtime
    except OSError:
        # Primer arranque: se siembra una vez y a partir de ahí manda el archivo.
        _escribir(copy.deepcopy(CATEGORIAS_SEMILLA))
        return copy.deepcopy(CATEGORIAS_SEMILLA)
    if _cache["items"] is None or _cache["mtime"] != mtime:
        try:
            with open(_DATA_PATH, encoding="utf-8") as f:
                raw = json.load(f)
        except Exception:
            raw = {}
        crudas = raw.get("categorias") if isinstance(raw, dict) else None
        items = []
        vistos = set()
        for it in crudas if isinstance(crudas, list) else []:
            norm = _normalizar_item(it)
            if norm and norm["id"] not in vistos:
                vistos.add(norm["id"])
                items.append(norm)
        _cache["items"] = items
        _cache["mtime"] = mtime
    return copy.deepcopy(_cache["items"])


def guardar_categorias(items: Any) -> list[dict]:
    """Reemplaza el catálogo completo con lo que mande el panel.

    Lo que no venga en la lista queda eliminado — incluidas las de la semilla, que
    NO se vuelven a inyectar en la siguiente lectura.
    """
    if not isinstance(items, list):
        raise ValueError("Envía una lista en «categorias»")
    limpias: list[dict] = []
    vistos = set()
    for it in items:
        norm = _normalizar_item(it)
        if not norm or norm["id"] in vistos:
            continue
        vistos.add(norm["id"])
        limpias.append(norm)
    if not limpias:
        raise ValueError("Envía al menos una categoría con id y etiqueta")
    _escribir(limpias)
    return limpias


def id_categoria_desde_nombre(nombre: str) -> str:
    """Id legible a partir del nombre escrito por el operador ("Sales de baño" → "sales-de-bano")."""
    base = _normalizar(nombre)
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return base or CATEGORIA_OTROS


def detectar_categoria(nombre_producto: str, categorias: list[dict] | None = None) -> str:
    """Misma regla que detectarCategoriaEtiqueta() en el panel: primera clave que
    aparezca en el nombre, y `otros` si ninguna coincide (nunca adivina)."""
    texto = f" {_normalizar(nombre_producto)} "
    if not texto.strip():
        return CATEGORIA_OTROS
    for cat in categorias if categorias is not None else listar_categorias():
        for clave in cat.get("claves") or []:
            if _normalizar(clave) in texto:
                return cat["id"]
    return CATEGORIA_OTROS
