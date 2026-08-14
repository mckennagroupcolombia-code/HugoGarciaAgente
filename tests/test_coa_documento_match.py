"""Match heurístico COA → nombre de PDF (espejo de desktop CoaDocumentosScanner)."""
from __future__ import annotations

import re
import unicodedata


def _normalizar(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\.(pdf|docx)$", "", s, flags=re.I)
    s = re.sub(
        r"\b(ft|coa|sds|tds|completo|ficha tecnica|certificado de analisis|"
        r"hoja de datos|msds|usp|bp|nf|fcc|ep|pharma|pharmaceutical|cosmetic|"
        r"cosmetico|food|grade|grado|anhydrous|anhidro|monohydrate|monohidrato|"
        r"powder|polvo|crystal|cristales)\b",
        " ",
        s,
        flags=re.I,
    )
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def _tokens(s: str) -> list[str]:
    return [t for t in _normalizar(s).split() if len(t) > 1]


def _token_cerca(a: str, b: str) -> bool:
    if a == b or a in b or b in a:
        return True
    # Variantes EN/ES frecuentes (niacinamide/niacinamida, glycerin/glicerina)
    n = min(len(a), len(b))
    if n >= 5 and a[:5] == b[:5]:
        return True
    return False


def encontrar_documento(archivos: list[dict], nombre: str) -> dict | None:
    query = _normalizar(nombre)
    q_tokens = _tokens(nombre)
    if not query or not q_tokens:
        return None
    best = None
    best_score = -1
    for a in archivos:
        nom = a["nombre"]
        if not nom.lower().endswith(".pdf"):
            continue
        titulo = re.sub(r"\.(pdf|docx)$", "", nom, flags=re.I)
        cand = _normalizar(titulo)
        if not cand:
            continue
        if cand == query:
            score = 100
        elif cand in query or query in cand:
            score = 88
        else:
            c_tokens = _tokens(titulo)
            if not c_tokens:
                continue
            overlap = sum(
                1 for t in q_tokens if any(_token_cerca(t, c) for c in c_tokens)
            )
            score = round((overlap / max(len(q_tokens), 1)) * 80)
            if overlap >= min(len(q_tokens), 2) and overlap / len(q_tokens) >= 0.6:
                score = max(score, 55)
            elif overlap >= 1 and len(q_tokens) == 1:
                score = max(score, 50)
        if a.get("categoria") == "completo":
            score += 3
        if score > best_score:
            best_score = score
            best = {"archivo": a, "score": score}
    if not best or best["score"] < 35:
        return None
    return best


def test_encuentra_acido_citrico():
    archivos = [
        {"nombre": "FT COA SDS Acido Citrico Anhidro.pdf", "categoria": "completo"},
        {"nombre": "Niacinamida.pdf", "categoria": "ft"},
    ]
    hit = encontrar_documento(archivos, "Ácido Cítrico Anhydrous")
    assert hit is not None
    assert "Citrico" in hit["archivo"]["nombre"]
    assert hit["score"] >= 35


def test_encuentra_niacinamida():
    archivos = [
        {"nombre": "Niacinamida.pdf", "categoria": "ft"},
        {"nombre": "FT COA SDS Glicerina USP.pdf", "categoria": "completo"},
    ]
    hit = encontrar_documento(archivos, "Niacinamide USP")
    assert hit is not None
    assert hit["archivo"]["nombre"].startswith("Niacinamida")


def test_sin_falso_positivo():
    archivos = [{"nombre": "Niacinamida.pdf", "categoria": "ft"}]
    assert encontrar_documento(archivos, "xyz desconocido total 123") is None
