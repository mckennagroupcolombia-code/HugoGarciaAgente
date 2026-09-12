"""
Catálogo de venta del agente WA: precios de la página web (decisión del negocio).

Fuente: PAGINA_WEB/site/data/cache.json (lo que ve el cliente en la tienda) +
PAGINA_WEB/site/data/stock_web.json (stock más reciente por ref). No se consulta
Siigo: sus combos y la web no siempre coinciden (ej. sorbitol 500 mL) y el
cliente compara contra la web.
"""

from __future__ import annotations

import json
import os
import re
import threading
import unicodedata
from dataclasses import dataclass

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
RUTA_CACHE = os.getenv(
    "WA_V2_CATALOGO_PATH", os.path.join(_BASE, "PAGINA_WEB", "site", "data", "cache.json")
)
RUTA_STOCK = os.getenv(
    "WA_V2_STOCK_PATH", os.path.join(_BASE, "PAGINA_WEB", "site", "data", "stock_web.json")
)


@dataclass(frozen=True)
class Presentacion:
    ref: str
    nombre: str
    familia: str
    presentacion: str
    precio: int
    stock: int | None
    comprable: bool
    categoria: str

    @property
    def disponible(self) -> bool:
        return self.comprable and (self.stock is None or self.stock > 0)

    def linea(self) -> str:
        if self.stock is not None and self.stock <= 0:
            estado = "AGOTADO"
        elif not self.comprable:
            estado = "no disponible para venta"
        elif self.stock is None:
            estado = "disponible"
        else:
            estado = f"stock {self.stock}"
        return f"{self.ref} | {self.nombre} | ${_miles(self.precio)} | {estado}"


def _miles(n: int | float) -> str:
    return f"{int(round(n)):,}".replace(",", ".")


def normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFKD", str(texto or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"(\d)\s*(g|gr|grs|gramos|ml|l|lt|kg|kilo|kilos)\b", r"\1\2", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


_STOPWORDS = frozenset(
    """
    de del la las el los un una unos unas y o a al en con por para x que se me mi su sus
    lo le les es son hay tiene tienen tienes tiene manejan manejas maneja venden vende
    precio precios cuanto cuánto vale valor cuesta costo quiero quisiera necesito busco
    hola buenas buenos dias tardes noches favor porfa gracias veci ese esa este esta
    presentacion presentaciones unidad unidades cual cuales como donde sirve
    """.split()
)

# Términos que el cliente usa distinto a como está escrito en la web.
_SINONIMOS = {
    "vit c": "vitamina c",
    "ascorbico": "vitamina c acido ascorbico",
    "whey": "proteina suero leche",
    "suero de leche": "suero leche",
    "karite": "karite",
    "shea": "karite",
    "pantenol": "pantenol",
    "d pantenol": "pantenol",
    "hialuronico": "hialuronico",
    "glicerina": "glicerina",
    "colageno": "colageno",
}

_PAT_UNIDAD = re.compile(r"^(\d+(?:[.,]\d+)?)(g|gr|grs|gramos|ml|l|lt|kg|kilo|kilos)$")


def _con_vitamina(t: str) -> str:
    """'vitamina e' → agrega 'vite': la letra sola no sobrevive al filtro de tokens."""
    return re.sub(r"\bvitamina ([a-z])\b", r"vitamina \1 vit\1", t)


def _tokens(texto: str) -> list[str]:
    t = _con_vitamina(normalizar(texto))
    for k, v in _SINONIMOS.items():
        if re.search(rf"\b{re.escape(k)}\b", t):
            t = f"{t} {v}"
    return [w for w in t.split() if w not in _STOPWORDS]


def _unidad(tok: str) -> str | None:
    """'250g' → '250g', '1kg'/'kilo' → '1000g', '500ml' → '500ml'."""
    if tok in ("kg", "kilo", "kilos"):
        return "1000g"
    if tok in ("libra", "libras"):
        return "500g"
    m = _PAT_UNIDAD.match(tok)
    if not m:
        return None
    num = float(m.group(1).replace(",", "."))
    u = m.group(2)
    if u in ("kg", "kilo", "kilos"):
        return f"{int(num * 1000)}g"
    if u in ("l", "lt"):
        return f"{int(num * 1000)}ml"
    if u in ("g", "gr", "grs", "gramos"):
        return f"{int(num)}g"
    return f"{int(num)}ml"


def _unidad_de_nombre(nombre: str) -> str | None:
    for tok in normalizar(nombre).split()[::-1]:
        u = _unidad(tok)
        if u:
            return u
    return None


class Catalogo:
    def __init__(self, presentaciones: list[Presentacion], fichas: dict[str, str] | None = None):
        self.presentaciones = presentaciones
        self._fichas = {k.upper(): v for k, v in (fichas or {}).items()}
        self._por_ref = {p.ref.upper(): p for p in presentaciones}
        self._tokens = {
            p.ref: set(_con_vitamina(normalizar(f"{p.familia} {p.nombre}")).split())
            for p in presentaciones
        }
        self._vocab = set().union(*self._tokens.values()) if self._tokens else set()

    def obtener(self, ref: str) -> Presentacion | None:
        return self._por_ref.get(str(ref or "").strip().upper())

    def ficha(self, ref: str) -> str:
        return self._fichas.get(str(ref or "").strip().upper(), "")

    @staticmethod
    def _coincide(w: str, nt: set[str]) -> float:
        if w in nt:
            return 1.0
        # hidrolizado ~ hidrolizada, monohidratada ~ monohidrato
        if len(w) >= 5 and any(x.startswith(w[:5]) for x in nt if len(x) >= 5):
            return 0.7
        return 0.0

    def buscar(self, consulta: str, limite: int = 12) -> list[Presentacion]:
        toks = _tokens(consulta)
        unidades = {u for u in (_unidad(t) for t in toks) if u}
        palabras = [t for t in toks if not _unidad(t) and len(t) >= 3 and not t.isdigit()]
        if not palabras:
            return []
        # Consultas cortas ("aceite de coco", "aceite esencial de bergamota"): deben
        # coincidir TODAS las palabras. Devolver vecinos ("otros aceites") invita al
        # agente a ofrecer algo que el cliente no pidió. Frases largas (el cliente
        # pegó su mensaje entero) toleran palabras de relleno.
        minimo = len(palabras) if len(palabras) <= 3 else max(2, -(-len(palabras) // 2))
        puntuados: list[tuple[float, Presentacion]] = []
        for p in self.presentaciones:
            nt = self._tokens[p.ref]
            coincidencias = [self._coincide(w, nt) for w in palabras]
            if sum(1 for x in coincidencias if x) < minimo:
                continue
            score = sum(coincidencias) / len(palabras)
            if unidades and _unidad_de_nombre(p.nombre) in unidades:
                score += 0.3
            puntuados.append((score, p))
        puntuados.sort(key=lambda x: (-x[0], x[1].familia, x[1].precio))
        if not puntuados:
            return []
        mejor = puntuados[0][0]
        # Familia completa de los mejores: si pide "karité 250g" y hay 125/500/kg,
        # el agente debe ver todas las presentaciones para ofrecer la correcta.
        familias = {p.familia for s, p in puntuados if s >= mejor - 0.25}
        out = [p for s, p in puntuados if p.familia in familias or s >= mejor - 0.25]
        return out[:limite]


_lock = threading.Lock()
_cache: dict = {"firma": None, "catalogo": None}


def _firma() -> tuple:
    out = []
    for ruta in (RUTA_CACHE, RUTA_STOCK):
        try:
            st = os.stat(ruta)
            out.append((ruta, st.st_mtime_ns, st.st_size))
        except OSError:
            out.append((ruta, None, None))
    return tuple(out)


def _leer_stock() -> dict[str, int]:
    try:
        with open(RUTA_STOCK, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    out = {}
    for ref, v in (data or {}).items():
        try:
            out[str(ref).upper()] = int((v or {}).get("stock"))
        except (TypeError, ValueError):
            continue
    return out


def _stock_int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _ficha_texto(item: dict) -> str:
    f = item.get("ficha") or {}
    if not isinstance(f, dict):
        return ""
    partes = [str(f.get("descripcion") or item.get("desc") or "").strip()]
    for sec in f.get("secciones") or []:
        items = [str(x).strip() for x in (sec.get("items") or []) if str(x).strip()]
        if items:
            partes.append(f"{sec.get('titulo', '')}: " + " ".join(items))
    return "\n".join(p for p in partes if p)[:3000]


def construir_desde_dict(data: dict, stock: dict[str, int] | None = None) -> Catalogo:
    stock = stock or {}
    vistos: dict[str, Presentacion] = {}
    fichas: dict[str, str] = {}

    def agregar(item: dict, familia: str, categoria: str) -> None:
        ref = str(item.get("ref") or "").strip()
        nombre = str(item.get("name") or "").strip()
        if not ref or not nombre or "(COPIA)" in nombre.upper():
            return
        try:
            precio = int(round(float(item.get("precio_num") or 0)))
        except (TypeError, ValueError):
            precio = 0
        if precio <= 0:
            return
        st = stock.get(ref.upper(), _stock_int(item.get("stock")))
        vistos.setdefault(
            ref.upper(),
            Presentacion(
                ref=ref,
                nombre=nombre,
                familia=familia or nombre,
                presentacion=str(item.get("presentacion_label") or _unidad_de_nombre(nombre) or ""),
                precio=precio,
                stock=st,
                comprable=item.get("buyable", True) is not False,
                categoria=categoria,
            ),
        )

    for sec in data.get("sections") or []:
        for p in sec.get("products") or []:
            cat = str(p.get("cat") or sec.get("name") or "")
            ficha = _ficha_texto(p)
            if p.get("is_family") and p.get("combos"):
                for c in p["combos"]:
                    agregar(c, str(p.get("name") or ""), cat)
                    if ficha:
                        fichas.setdefault(str(c.get("ref") or ""), ficha)
            else:
                agregar(p, str(p.get("meli_title") or p.get("name") or ""), cat)
                if ficha:
                    fichas.setdefault(str(p.get("ref") or ""), ficha)
    for c in data.get("combos") or []:
        agregar(c, str(c.get("meli_title") or c.get("name") or ""), str(c.get("cat") or ""))
        f = _ficha_texto(c)
        if f:
            fichas.setdefault(str(c.get("ref") or ""), f)
    return Catalogo(sorted(vistos.values(), key=lambda p: (p.familia, p.precio)), fichas)


def cargar() -> Catalogo:
    """Catálogo vigente; se recarga solo cuando cambian cache.json o stock_web.json."""
    firma = _firma()
    with _lock:
        if _cache["catalogo"] is not None and _cache["firma"] == firma:
            return _cache["catalogo"]
        try:
            with open(RUTA_CACHE, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        cat = construir_desde_dict(data, _leer_stock())
        _cache.update(firma=firma, catalogo=cat)
        return cat
