#!/usr/bin/env python3
"""
Migra PAGINA_WEB/site/data/recetas.json al modelo v2 que usa el recetario en
"modo laboratorio" (/recetario/<slug>):

  - `slug`            URL propia por receta (antes solo abrían en un modal).
  - `pasos[]`         cada paso pasa de texto plano a objeto:
                        {"texto", "accion", "min"}
                      `accion` se infiere del verbo con el que empieza el paso
                      (verter, disolver, mezclar, calentar, enfriar, reposar,
                      envasar, pesar) y decide que pictograma anima el wizard.
                      `min` solo se llena si el texto trae un tiempo explicito
                      ("durante 5 minutos", "10 min"); nunca se inventa.
  - `ings[].slug`     enlace al producto de la tienda cuando TODAS las palabras
                      clave del ingrediente aparecen en el nombre de un producto
                      de data/cache.json (mismo criterio conservador que usa
                      /verificar en website.py::buscar_contenido_relacionado).
                      Si hay varias presentaciones, se elige la mas pequena
                      comprable. Lo que no cruza queda sin slug y el wizard lo
                      muestra sin boton de compra.
  - `ings[].propio`   True cuando la fuente dice "uso propio" (agua, etc.).

Es idempotente: una receta ya migrada se vuelve a normalizar sin duplicar
nada, y los campos que un humano corrija a mano (`slug` de ingrediente,
`accion`, `min`) se respetan si vienen marcados con `"manual": true`.

Sin IA. Por defecto corre en `--dry-run` y solo imprime el reporte; para
escribir hay que pasar `--confirmar` (deja copia .bak con fecha).

Uso:
  python3 scripts/migrar_recetas_v2.py
  python3 scripts/migrar_recetas_v2.py --confirmar
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

SITE_DATA = REPO / "PAGINA_WEB" / "site" / "data"
RECETAS_JSON = SITE_DATA / "recetas.json"
CACHE_JSON = SITE_DATA / "cache.json"

ACCIONES_VALIDAS = (
    "verter", "disolver", "mezclar", "calentar", "enfriar", "reposar", "envasar", "pesar",
)

# Verbo (sin tilde, en minusculas) -> accion. Se evalua sobre las primeras
# palabras del paso; el primer verbo que aparezca gana.
_VERBOS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(pesa|pesar|medir|mide|dosifica|dosificar)\b"), "pesar"),
    (re.compile(r"\b(calienta|calentar|calentando|derrite|derretir|fundir|funde|hervir|hierve|bano maria)\b"), "calentar"),
    (re.compile(r"\b(enfria|enfriar|enfriamiento|deja enfriar|dejar enfriar|templar|entibiar)\b"), "enfriar"),
    (re.compile(r"\b(reposa|reposar|deja reposar|dejar reposar|macera|macerar|espera|esperar|deja actuar)\b"), "reposar"),
    (re.compile(r"\b(envasa|envasar|transfiere|transferir|vierte en (el|un) (frasco|envase)|guarda|guardar|almacena|almacenar|cierra|cerrar|etiqueta|etiquetar)\b"), "envasar"),
    (re.compile(r"\b(disuelve|disolver|disolviendo|hidrata|hidratar|dispersa|dispersar)\b"), "disolver"),
    (re.compile(r"\b(vierte|verter|agrega|agregar|anade|anadir|adiciona|adicionar|adicion|incorpora|incorporar|combina|combinar|une|unir)\b"), "verter"),
    (re.compile(r"\b(mezcla|mezclar|agita|agitar|bate|batir|homogeneiza|homogeneizar|emulsiona|emulsionar|emulsion|remueve|remover|revuelve)\b"), "mezclar"),
]

# Un paso de "verter" que ademas dice "mezclando" / "hasta disolver" se
# reclasifica: lo que se anima es el resultado, no el primer verbo.
_REFINAR: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"hasta (que se )?disolver|hasta disolucion|disuelv|en polvo"), "disolver"),
    (re.compile(r"mientras (mezclas|agitas|bates|revuelves)|agitando|batiendo|mezclando|homogen|emulsion"), "mezclar"),
]

_RE_MIN = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:a|-|–)?\s*(\d+(?:[.,]\d+)?)?\s*(min(?:uto)?s?|h(?:ora)?s?)\b")

_IGNORAR = frozenset({
    "de", "del", "la", "el", "los", "las", "en", "con", "para", "por", "puro", "pura",
    "natural", "cosmetica", "cosmetico", "grado", "polvo", "liquido", "liquida", "vegetal",
    "uso", "propio", "mckenna", "group", "ml", "gr", "g", "kg", "l", "oz", "und", "unidad",
})


def sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn"
    )


def normalizar(texto: str) -> str:
    texto = sin_tildes(texto).lower()
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    texto = re.sub(r"(?<=[a-z])(?=\d)", " ", texto)  # "DIPROPILENGLICOL500mL" -> "dipropilenglicol 500ml"
    return re.sub(r"\s+", " ", texto).strip()


def slugify(*partes: str) -> str:
    base = normalizar(" ".join(p for p in partes if p))
    return re.sub(r"\s+", "-", base).strip("-")


# Como lo escribe la receta -> como lo escribe el catalogo (ya normalizado).
_SINONIMOS = {
    "xanthan": "xantana", "anhidra": "", "anhidro": "",
    "sorbato k": "sorbato potasio", "benzoato na": "benzoato sodio",
    "citrato mg": "citrato magnesio", "vit b12": "vitamina b12", "vit ": "vitamina ",
    "monohidratada": "monohidrato", "acido ascorbico": "ascorbico",
    "aloe vera gel": "aloe vera", "aceite esencial arbol te": "aceite esencial arbol de te",
}


def _variantes(nombre: str) -> list[str]:
    """Nombre principal y, si hay parentesis, tambien lo de adentro:
    'Glucosa (Dextrosa)' -> ['glucosa', 'dextrosa']."""
    principal = re.sub(r"\(.*?\)", " ", nombre or "")
    principal = re.split(r"\s+o\s+|/", principal)[0]  # "Miel o stevia" -> "Miel"
    variantes = [principal]
    for dentro in re.findall(r"\(([^)]*)\)", nombre or ""):
        for alt in re.split(r"\s+o\s+|/|,", dentro):
            if alt.strip():
                variantes.append(alt)
    return variantes


def palabras_clave(nombre: str) -> list[str]:
    texto = normalizar(nombre)
    for de, a in _SINONIMOS.items():
        texto = texto.replace(de, a)
    out = []
    for p in texto.split():
        # Las letras sueltas se conservan: "vitamina c" y "vitamina e" solo se
        # distinguen por ellas (sin esto, Vitamina C cruzaba con Vitamina E).
        if p in _IGNORAR:
            continue
        # "90%" ya perdio el %, queda "90": los numeros de concentracion no
        # sirven para cruzar (el producto puede decir 99%).
        if p.isdigit():
            continue
        out.append(p)
    return out


def inferir_accion(texto: str) -> str:
    """Verbo que aparece primero en el TEXTO (no en la tabla) decide la accion."""
    t = normalizar(texto)
    candidatos: list[tuple[int, int, str]] = []
    for prioridad, (patron, nombre) in enumerate(_VERBOS):
        m = patron.search(t)
        if m:
            candidatos.append((m.start(), prioridad, nombre))
    accion = sorted(candidatos)[0][2] if candidatos else ""
    if accion in ("verter", ""):
        for patron, nombre in _REFINAR:
            if patron.search(t):
                return nombre
    return accion or "mezclar"


def extraer_minutos(texto: str) -> int | None:
    t = normalizar(texto)
    m = _RE_MIN.search(t)
    if not m:
        return None
    try:
        a = float(m.group(1).replace(",", "."))
        b = float(m.group(2).replace(",", ".")) if m.group(2) else None
    except ValueError:
        return None
    valor = b if b else a  # en rangos ("5 a 10 min") se toma el mayor
    if m.group(3).startswith("h"):
        valor *= 60
    valor = int(round(valor))
    return valor if 0 < valor <= 24 * 60 else None


def cargar_catalogo() -> list[dict]:
    """Productos de la tienda: familias (sections) y presentaciones (combos).
    Una familia no se puede meter al carrito (website.py::carrito_agregar
    exige elegir presentacion), por eso el cruce prefiere la presentacion
    comprable mas pequena y solo cae a la familia si no hay otra."""
    try:
        cache = json.loads(CACHE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return []
    if isinstance(cache, dict):
        crudos = [p for s in cache.get("sections", []) or [] for p in s.get("products", []) or []]
        crudos += list(cache.get("combos", []) or [])
    else:
        crudos = [p for s in cache or [] for p in s.get("products", []) or []]
    productos, vistos = [], set()
    for p in crudos:
        slug = (p.get("slug") or "").strip().lower()
        if not slug or not p.get("name") or slug in vistos:
            continue
        vistos.add(slug)
        productos.append({
            "slug": slug,
            "name": p["name"],
            "claves": set(normalizar(p["name"]).split()),
            "buyable": p.get("buyable") is not False,
            "is_family": bool(p.get("is_family", False)),
            "precio_num": float(p.get("precio_num") or 0),
        })
    return productos


def _tamano(nombre: str) -> float:
    """Tamano de la presentacion en gramos/ml para elegir la mas pequena."""
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|lt)\b", nombre.lower())
    if not m:
        return 10**9
    n = float(m.group(1).replace(",", "."))
    u = m.group(2)
    if u in ("kg", "l", "lt"):
        n *= 1000
    return n


def cruzar_ingrediente(nombre: str, catalogo: list[dict]) -> dict | None:
    for variante in _variantes(nombre):
        claves = palabras_clave(variante)
        if not claves:
            continue
        candidatos = [
            p for p in catalogo
            if all(c in p["claves"] for c in claves) and "+" not in p["name"]  # sin kits/combos
        ]
        if not candidatos:
            continue

        def orden(p: dict) -> tuple:
            # primero el nombre con menos palabras de sobra ("aceite esencial
            # arbol de te" antes que "arbol de te + jojoba"), luego el mas pequeno
            sobrantes = len(p["claves"] - set(claves))
            return (sobrantes, _tamano(p["name"]), p["precio_num"])

        presentaciones = [p for p in candidatos if not p["is_family"] and p["buyable"]]
        if presentaciones:
            return sorted(presentaciones, key=orden)[0]
        familias = [p for p in candidatos if p["is_family"]]
        if familias:
            return sorted(familias, key=orden)[0]
        return sorted(candidatos, key=orden)[0]
    return None


def migrar_receta(r: dict, catalogo: list[dict], slugs_usados: set[str]) -> tuple[dict, list[str]]:
    avisos: list[str] = []
    out = dict(r)

    slug = r.get("slug") or slugify(r.get("title", ""), r.get("title2", ""))
    base_slug, n = slug, 2
    while slug in slugs_usados:
        slug = f"{base_slug}-{n}"
        n += 1
    slugs_usados.add(slug)
    out["slug"] = slug

    ings = []
    for ing in r.get("ings", []) or []:
        i = dict(ing)
        src = normalizar(str(i.get("src", "")))
        i["propio"] = bool(i.get("propio")) or "propio" in src
        if not i.get("manual"):
            if i["propio"]:
                i.pop("slug", None)
            else:
                match = cruzar_ingrediente(i.get("n", ""), catalogo)
                if match:
                    i["slug"] = match["slug"]
                    i["producto"] = match["name"]
                    if match["is_family"]:
                        i["familia"] = True   # elegir presentacion en la ficha
                    else:
                        i.pop("familia", None)
                else:
                    i.pop("slug", None)
                    i.pop("producto", None)
                    i.pop("familia", None)
                    avisos.append(f"sin producto: {i.get('n', '')!r}")
        ings.append(i)
    out["ings"] = ings

    pasos = []
    for p in r.get("pasos", []) or []:
        if isinstance(p, str):
            paso = {"texto": p}
        else:
            paso = dict(p)
        if not paso.get("manual"):
            paso["accion"] = inferir_accion(paso.get("texto", ""))
            minutos = extraer_minutos(paso.get("texto", ""))
            if minutos:
                paso["min"] = minutos
            else:
                paso.pop("min", None)
        if paso.get("accion") not in ACCIONES_VALIDAS:
            avisos.append(f"accion invalida {paso.get('accion')!r} en paso {paso.get('texto', '')[:40]!r}")
            paso["accion"] = "mezclar"
        pasos.append(paso)
    out["pasos"] = pasos
    return out, avisos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--confirmar", action="store_true", help="escribe recetas.json (por defecto solo reporta)")
    ap.add_argument("--json", action="store_true", help="imprime el reporte como JSON")
    args = ap.parse_args()

    recetas = json.loads(RECETAS_JSON.read_text(encoding="utf-8"))
    catalogo = cargar_catalogo()
    if not catalogo:
        print("AVISO: no se pudo leer data/cache.json; los ingredientes quedaran sin producto.", file=sys.stderr)

    slugs: set[str] = set()
    migradas, reporte = [], []
    total_ings = con_slug = propios = 0
    acciones: dict[str, int] = {}
    for r in recetas:
        nueva, avisos = migrar_receta(r, catalogo, slugs)
        migradas.append(nueva)
        for i in nueva["ings"]:
            total_ings += 1
            if i.get("propio"):
                propios += 1
            elif i.get("slug"):
                con_slug += 1
        for p in nueva["pasos"]:
            acciones[p["accion"]] = acciones.get(p["accion"], 0) + 1
        reporte.append({"slug": nueva["slug"], "avisos": avisos})

    resumen = {
        "recetas": len(migradas),
        "ingredientes": total_ings,
        "con_producto": con_slug,
        "uso_propio": propios,
        "sin_producto": total_ings - con_slug - propios,
        "acciones": acciones,
    }
    if args.json:
        print(json.dumps({"resumen": resumen, "detalle": reporte}, ensure_ascii=False, indent=1))
    else:
        print("Recetas: %(recetas)d | ingredientes: %(ingredientes)d | con producto: %(con_producto)d | "
              "uso propio: %(uso_propio)d | sin producto: %(sin_producto)d" % resumen)
        print("Acciones por paso:", ", ".join(f"{k}={v}" for k, v in sorted(acciones.items())))
        for item in reporte:
            for a in item["avisos"]:
                print(f"  [{item['slug']}] {a}")

    if not args.confirmar:
        print("\nModo simulacion: no se escribio nada. Usa --confirmar para guardar.")
        return 0

    bak = RECETAS_JSON.with_suffix(f".json.bak_{datetime.now():%Y%m%d%H%M%S}")
    shutil.copy2(RECETAS_JSON, bak)
    RECETAS_JSON.write_text(json.dumps(migradas, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nEscrito {RECETAS_JSON} (copia previa en {bak.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
