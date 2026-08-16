"""Empareja nombre de materia prima (COA) con PDFs de biblioteca.

Espejo de desktop/src/lib/coaBibliotecaMatch.ts — evita Eritritol→Celulosa/Eritrosina.
"""
from __future__ import annotations

import re
import unicodedata

_SINONIMOS: tuple[tuple[str, str], ...] = (
    ("eritritol", "erythritol"),
    ("celulosa", "cellulose"),
    ("niacinamida", "niacinamide"),
    ("glicerina", "glycerin"),
    ("glicerina", "glycerine"),
    ("hialuronico", "hyaluronic"),
    ("ascorbico", "ascorbic"),
    ("inulina", "inulin"),
    ("xilitol", "xylitol"),
    ("alulosa", "allulose"),
    ("alulosa", "psicose"),
    ("eritrosina", "erythrosine"),
)

_CONFLICTOS: dict[str, frozenset[str]] = {
    "eritritol": frozenset({"celulosa", "eritrosina", "xilitol", "sorbitol", "maltitol", "alulosa"}),
    "celulosa": frozenset({"eritritol", "eritrosina", "alulosa"}),
    "eritrosina": frozenset({"eritritol", "celulosa", "xilitol"}),
    "xilitol": frozenset({"eritritol", "sorbitol", "maltitol"}),
    "ascorbico": frozenset({"citrico", "citric"}),
}

_STOP = frozenset({
    "colorante", "color", "acid", "acido", "sodium", "sodico",
    "potassium", "potasico", "anhydrous", "anhidro",
})

_CANON: dict[str, str] = {}
for _a, _b in _SINONIMOS:
    root = _a if len(_a) <= len(_b) else _b
    _CANON[_a] = root
    _CANON[_b] = root

_STRIP_WORDS = re.compile(
    r"\b(ft|coa|sds|tds|completo|ficha tecnica|certificado de analisis|"
    r"hoja de datos|msds|usp|bp|nf|fcc|ep|pharma|pharmaceutical|cosmetic|"
    r"cosmetico|food|grade|grado|anhydrous|anhidro|monohydrate|monohidrato|"
    r"powder|polvo|crystal|cristales|cristal|crystalline|microcrystalline|"
    r"microcristalina|microcristalino)\b",
    re.I,
)


def _canon(t: str) -> str:
    return _CANON.get(t, t)


def normalizar_titulo(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\.(pdf|docx)$", "", s, flags=re.I)
    s = _STRIP_WORDS.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def tokens_titulo(s: str) -> list[str]:
    return [_canon(t) for t in normalizar_titulo(s).split() if len(t) > 1]


def token_sustancia_principal(tokens: list[str]) -> str | None:
    utiles = [t for t in tokens if t not in _STOP and len(t) >= 4]
    if not utiles:
        return None
    return max(utiles, key=len)


def sustancias_en_conflicto(a: str, b: str) -> bool:
    aa, bb = _canon(a), _canon(b)
    if aa == bb:
        return False
    return bb in _CONFLICTOS.get(aa, frozenset()) or aa in _CONFLICTOS.get(bb, frozenset())


def token_cerca(a: str, b: str) -> bool:
    aa, bb = _canon(a), _canon(b)
    if aa == bb:
        return True
    if sustancias_en_conflicto(aa, bb):
        return False
    short, long = (aa, bb) if len(aa) <= len(bb) else (bb, aa)
    if len(short) >= 5 and short in long and len(short) / len(long) >= 0.7:
        return True
    n = min(len(aa), len(bb))
    if n >= 6 and aa[:6] == bb[:6] and abs(len(aa) - len(bb)) <= 3:
        return True
    return False


def sustancias_compatibles(nombre_producto: str, titulo_archivo: str) -> bool:
    q_tokens = tokens_titulo(nombre_producto)
    c_tokens = tokens_titulo(titulo_archivo)
    q_primary = token_sustancia_principal(q_tokens)
    c_primary = token_sustancia_principal(c_tokens)
    if not q_primary or not c_primary:
        return False
    if sustancias_en_conflicto(q_primary, c_primary):
        return False
    if not token_cerca(q_primary, c_primary):
        return False
    for t in q_tokens:
        if sustancias_en_conflicto(t, c_primary) and not token_cerca(t, c_primary):
            return False
    return True


def validar_archivo_biblioteca(
    nombre_producto: str,
    archivo_biblioteca: str,
) -> str:
    """Devuelve el archivo solo si es la misma sustancia que nombre_producto; si no, ''."""
    archivo = (archivo_biblioteca or "").strip()
    nombre = (nombre_producto or "").strip()
    if not archivo or not nombre:
        return ""
    titulo = re.sub(r"\.(pdf|docx)$", "", archivo, flags=re.I)
    if not sustancias_compatibles(nombre, titulo):
        return ""
    return archivo
