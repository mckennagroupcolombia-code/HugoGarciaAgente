"""Documentos técnicos completos (FT + COA + SDS) para la ficha pública del sitio.

Fuente: YAML `_tipo=completo` en `fichas_word/datos/` + PDF en `fichas_word/completo/`.
Solo se publican los que ya tienen COA y SDS diligenciados (los mismos que
la biblioteca marca como Ficha Técnica completa).
"""

from __future__ import annotations

import os
import re
import io
import time
import unicodedata
from pathlib import Path
from typing import Any

from app.services.ficha_tecnica import (
    DATOS_DIR,
    cargar_datos_desde_archivo,
    nombre_archivo_desde_titulo,
    ruta_archivo_biblioteca_segura,
    _coa_diligenciado,
    _contexto_coa,
    _contexto_html,
    _contexto_sds,
    _sds_diligenciado,
)

_TTL_SEC = int(os.getenv("DOCS_WEB_TTL_SEC", "60"))
_CACHE: dict[str, Any] = {"ts": 0.0, "docs": None, "epoch": None, "omitidos": []}
_EPOCH_FILE = DATOS_DIR / ".docs_web_epoch"


def _epoch_mtime() -> float:
    try:
        return _EPOCH_FILE.stat().st_mtime
    except OSError:
        return 0.0


def invalidar_indice_documentos_web() -> None:
    """Marca el índice público como obsoleto (panel :8081 y tienda :8083)."""
    _CACHE["docs"] = None
    _CACHE["ts"] = 0.0
    _CACHE["epoch"] = None
    _CACHE["omitidos"] = []
    try:
        DATOS_DIR.mkdir(parents=True, exist_ok=True)
        _EPOCH_FILE.write_text(str(time.time()), encoding="utf-8")
    except OSError:
        pass


def _sitio_documentos_url() -> str:
    return (os.getenv("WEB_SITE_INTERNAL_URL") or "http://localhost:8083").rstrip("/")


def avisar_sitio_documentos_web(*, timeout: float = 25) -> dict:
    """Pide a website.py que reconstruya el índice de FT/COA/SDS."""
    import requests

    url = f"{_sitio_documentos_url()}/api/documentos/refresh"
    token = (
        (os.getenv("ADMIN_TOKEN") or "").strip()
        or (os.getenv("WEB_ADMIN_TOKEN") or "").strip()
        or (os.getenv("WEB_API_KEY") or "").strip()
    )
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        r = requests.post(url, headers=headers, timeout=timeout)
        if r.status_code == 200:
            body = r.json() if r.content else {}
            return {"ok": True, "total": body.get("total"), "url": url}
        return {"ok": False, "error": f"HTTP {r.status_code}: {(r.text or '')[:240]}", "url": url}
    except Exception as e:
        return {"ok": False, "error": str(e), "url": url}


def resumen_documentos_web(docs: list[dict] | None = None) -> dict:
    lista = docs if docs is not None else listar_documentos_completos_web()
    omitidos = list(_CACHE.get("omitidos") or [])
    return {
        "ok": True,
        "total": len(lista),
        "con_coa": sum(1 for d in lista if d.get("coa")),
        "con_sds": sum(1 for d in lista if d.get("sds")),
        "titulos": [d.get("titulo") or "" for d in lista],
        "omitidos_incompletos": len(omitidos),
        "omitidos_titulos": omitidos[:40],
    }


def publicar_documentos_en_web(*, avisar_sitio: bool = True) -> dict:
    """Reconstruye el índice público y avisa a la tienda para mostrar cambios ya."""
    invalidar_indice_documentos_web()
    docs = listar_documentos_completos_web(forzar=True)
    out = resumen_documentos_web(docs)
    if avisar_sitio:
        out["sitio"] = avisar_sitio_documentos_web()
    else:
        out["sitio"] = {"ok": True, "omitido": True}
    return out


_STOP = {
    "de", "del", "la", "el", "los", "las", "un", "una", "para", "con", "en",
    "y", "o", "grado", "usp", "bp", "nf", "fcc", "ep",
}


def _norm(texto: str) -> str:
    t = unicodedata.normalize("NFD", (texto or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def nombre_base_producto_web(nombre: str) -> str:
    n = _norm(nombre)
    n = re.sub(r"\s+\d+(?:[.,]\d+)?\s*(?:g|gr|kg|ml|l|lb|oz)\b", "", n)
    n = re.sub(r"\s+\d+\s*x\s*\d+.*$", "", n)
    return n.strip()


def _palabras_clave(nombre: str) -> list[str]:
    return [p for p in nombre_base_producto_web(nombre).split() if p not in _STOP and len(p) >= 2]


def _pdf_nombre_desde_titulo(titulo: str) -> str:
    nombre = nombre_archivo_desde_titulo(titulo).replace(".docx", ".pdf")
    nombre = re.sub(r"^FT\s+", "", nombre, flags=re.I)
    return f"FT COA SDS {nombre}"


def _formula_html(val: str) -> str:
    texto = re.sub(r"&", "&amp;", str(val or ""))
    texto = texto.replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"(\d+)", r"<sub>\1</sub>", texto)


def _contexto_publico(datos: dict) -> dict | None:
    if (datos.get("_tipo") or "").strip() != "completo":
        return None
    ft = _contexto_html(datos, datos.get("_cabezote_id"), incluir_cabezote=True)
    titulo = (ft.get("titulo") or "").strip()
    if not titulo:
        return None
    pdf_nombre = _pdf_nombre_desde_titulo(titulo)
    pdf_path = ruta_archivo_biblioteca_segura(pdf_nombre)
    if not pdf_path:
        return None

    coa = _contexto_coa(datos.get("_coa") or {})
    if not coa or not _coa_diligenciado(coa):
        return None
    sds = _contexto_sds(datos.get("_sds") or {})
    if not sds or not _sds_diligenciado(sds):
        return None

    recs_ft = list(ft.get("recomendaciones") or [])
    ft["recomendaciones"] = []
    if recs_ft and not (sds.get("recomendaciones") or []):
        sds["recomendaciones"] = recs_ft

    if coa.get("formula"):
        coa["formula_html"] = _formula_html(coa["formula"])
    if sds.get("formula"):
        sds["formula_html"] = _formula_html(sds["formula"])
    return {
        "titulo": titulo,
        "referencia": (ft.get("referencia") or "").strip(),
        "color_acento": ft.get("color_acento") or "#069DC2",
        "clave": _norm(titulo),
        "palabras": _palabras_clave(titulo),
        "pdf_nombre": pdf_nombre,
        "ft": ft,
        "coa": coa,
        "sds": sds,
    }


def _cargar_indice(*, forzar: bool = False) -> list[dict]:
    now = time.time()
    epoch = _epoch_mtime()
    if (
        not forzar
        and _CACHE.get("docs") is not None
        and _CACHE.get("epoch") == epoch
        and now - float(_CACHE.get("ts") or 0) < _TTL_SEC
    ):
        return _CACHE["docs"]

    docs: list[dict] = []
    omitidos: list[str] = []
    vistos: set[str] = set()
    if DATOS_DIR.is_dir():
        archivos = sorted(DATOS_DIR.glob("ft_coa_sds_*.yaml")) + [
            p for p in DATOS_DIR.glob("*.yaml")
            if not p.name.startswith("ft_coa_sds_")
            and not p.name.startswith("coa_")
            and not p.name.startswith("sds_")
            and "plantilla" not in p.name
        ]
        for path in archivos:
            try:
                datos = cargar_datos_desde_archivo(path) or {}
            except Exception:
                continue
            ctx = _contexto_publico(datos)
            if not ctx:
                if (datos.get("_tipo") or "").strip() == "completo":
                    titulo = str(
                        datos.get("titulo") or datos.get("nombre_producto") or path.stem
                    ).strip()
                    if titulo:
                        omitidos.append(titulo)
                continue
            clave = ctx["clave"]
            if clave in vistos:
                continue
            vistos.add(clave)
            docs.append(ctx)

    _CACHE["ts"] = now
    _CACHE["docs"] = docs
    _CACHE["epoch"] = epoch
    _CACHE["omitidos"] = omitidos
    return docs


def listar_documentos_completos_web(*, forzar: bool = False) -> list[dict]:
    return list(_cargar_indice(forzar=forzar))


def _score_match(doc: dict, nombre_norm: str, palabras_prod: list[str], ref_u: str) -> int:
    clave = doc.get("clave") or ""
    palabras_doc = doc.get("palabras") or []
    ref_doc = (doc.get("referencia") or "").upper().replace("-", "")
    score = 0
    if ref_u and ref_doc and (ref_u == ref_doc or ref_u in ref_doc or ref_doc in ref_u):
        score += 1000
    if clave and clave == nombre_norm:
        score += 800
    if clave and clave in nombre_norm:
        score += 400 + len(clave)
    if palabras_doc and set(palabras_doc).issubset(set(palabras_prod)):
        score += 200 + (10 * len(palabras_doc))
    if len(palabras_doc) >= 2 and set(palabras_doc[:2]).issubset(set(palabras_prod)):
        score += 80
    return score


def buscar_documento_por_pdf_nombre(nombre_pdf: str) -> dict | None:
    """Documento completo indexado por nombre de archivo PDF en biblioteca."""
    nombre = os.path.basename((nombre_pdf or "").strip())
    if not nombre:
        return None
    for doc in _cargar_indice():
        if doc.get("pdf_nombre") == nombre:
            return doc
    return None


def generar_pdf_seccion_web(doc: dict, seccion: str) -> bytes:
    """Genera PDF de una sección (ft/coa/sds) desde el contexto web."""
    from jinja2 import Environment, FileSystemLoader
    from weasyprint import HTML

    seccion = (seccion or "").strip().lower()
    if seccion not in ("ft", "coa", "sds"):
        raise ValueError(f"Sección no soportada: {seccion}")

    ft = doc.get("ft") or {}
    coa = doc.get("coa") if seccion == "coa" else None
    sds = doc.get("sds") if seccion == "sds" else None
    if seccion == "coa" and not coa:
        raise ValueError("COA no disponible")
    if seccion == "sds" and not sds:
        raise ValueError("SDS no disponible")

    titulo = (doc.get("titulo") or ft.get("titulo") or "").strip()
    color_acento = doc.get("color_acento") or ft.get("color_acento") or "#069DC2"

    from app.services.formula_molecular import formula_a_html_sub

    tpl_dir = Path(__file__).resolve().parents[1] / "templates"
    env = Environment(loader=FileSystemLoader(str(tpl_dir)), autoescape=True)
    env.filters["formula_sub"] = formula_a_html_sub
    tpl = env.get_template("documento_completo_pdf.html")
    html_str = tpl.render(
        titulo=titulo,
        color_acento=color_acento,
        cabezote_src=ft.get("cabezote_src"),
        cabezote_w_cm=ft.get("cabezote_w_cm"),
        cabezote_h_cm=ft.get("cabezote_h_cm"),
        logo_pie_src=ft.get("logo_pie_src"),
        ft=ft,
        coa=coa,
        sds=sds,
        seccion_sola=seccion,
    )

    buf = io.BytesIO()
    HTML(string=html_str, base_url=str(tpl_dir)).write_pdf(buf)
    return buf.getvalue()


def buscar_documento_completo_web(nombre: str, ref: str = "") -> dict | None:
    """Mejor documento completo de la biblioteca para un producto de la tienda."""
    docs = _cargar_indice()
    if not docs:
        return None
    nombre_norm = nombre_base_producto_web(nombre)
    palabras_prod = _palabras_clave(nombre)
    ref_u = (ref or "").upper().replace("-", "")
    mejor: dict | None = None
    mejor_score = 0
    for doc in docs:
        score = _score_match(doc, nombre_norm, palabras_prod, ref_u)
        if score > mejor_score:
            mejor, mejor_score = doc, score
    if mejor_score < 80:
        return None
    return mejor
