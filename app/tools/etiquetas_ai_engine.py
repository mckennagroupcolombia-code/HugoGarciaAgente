"""
Etiquetas McKenna desde archivos Illustrator (.ai = PDF) por producto.
Convierte con Inkscape y aplica solo reemplazos de texto + overlays dinámicos.
"""
from __future__ import annotations

import hashlib
import math
import re
import subprocess
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_AI_DIR = _REPO / "Etiquetas Modelo SVG"
_CACHE_DIR = _REPO / "app" / "data" / "etiquetas_ai_cache"

_RE_MARCO_BARRAS = re.compile(
    r"<path[^>]+d=\"[^\"]*(?:135\.95|132\.267|133\.486|142\.008|144\.47|135\.951)[^\"]*\"[^>]*/>",
    re.IGNORECASE,
)
_RE_GRUPO_PLANTILLA = re.compile(
    r'<g\s+[^>]*transform="matrix\(1\.3333[^"]*\)"',
    re.IGNORECASE,
)
_RE_TAG_G_OPEN = re.compile(r"<g\b", re.IGNORECASE)
_RE_PESO_TSPAN = re.compile(
    r"^\d[\d.,]*\s*(?:g|kg|Kg|KG|mL|ml|ML|lt|Lt|LT|l|L)$",
    re.IGNORECASE,
)
_RE_TSPAN_TEXT = re.compile(r">([^<>]{2,220})</tspan>", re.DOTALL)


def _parse_matrix_translate(matrix_raw: str) -> tuple[float, float, float, float]:
    nums = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+", matrix_raw or "")]
    if len(nums) >= 6:
        return nums[0], nums[3], nums[4], nums[5]
    if len(nums) >= 4:
        return nums[0], nums[1], nums[2], nums[3]
    return 1.0, 1.0, 0.0, 0.0


def _textos_con_posicion(svg: str) -> list[tuple[float, float, str]]:
    filas: list[tuple[float, float, str]] = []
    for m in re.finditer(r'<text\b[^>]*transform="matrix\(([^)]+)\)"', svg, re.IGNORECASE):
        sx, sy, tx, ty = _parse_matrix_translate(m.group(1))
        start = m.start()
        end = svg.find("</text>", start)
        if end < 0:
            continue
        inner = re.sub(r"<[^>]+>", " ", svg[start:end])
        inner = re.sub(r"\s+", " ", inner).strip()
        if inner:
            filas.append((tx, ty, inner))
    return filas


def _svg_tiene_legal_embebido(svg: str) -> bool:
    low = svg.lower()
    return "2674" in low or "reenvase de materia prima" in low or 'id="mckenna-bloque-legal"' in low


def _piso_visual_bloque(tx: float, ty: float, texto: str, font_size: float = 4.8) -> float:
    """Coordenada Y (SVG invertido) del borde inferior visual de un bloque de texto."""
    ancho_chars = 50 if tx <= 12 else 44
    lineas = max(1, math.ceil(len(texto) / ancho_chars))
    return ty - lineas * font_size * 1.2


def _ajustar_spec_overlays_ai(svg: str, spec: dict) -> tuple[dict, bool]:
    """Ajusta coords de lote/barras al layout real del .ai. Retorna (spec, skip_barras_nuevo)."""
    spec = dict(spec)
    skip_barras = False

    textos = _textos_con_posicion(svg)
    if textos:
        subtitulos = [t for t in textos if 3 <= t[0] <= 22 and 148 <= t[1] <= 170]
        desc_blocks = [t for t in textos if t[0] <= 22 and 28 < t[1] < 150 and len(t[2]) > 30]
        lote_cfg = dict(spec.get("lote") or {})
        lh = float(lote_cfg.get("line_height", 5.0))
        legal = spec.get("legal") or {}
        legal_y = float(legal.get("y", 7.5))
        legal_h = float(legal.get("h", 7.0))
        min_lote_y = legal_y + legal_h + 1.5

        if desc_blocks:
            piso = min(_piso_visual_bloque(t[0], t[1], t[2]) for t in desc_blocks)
            desc_top = max(t[1] for t in desc_blocks)
            lote_cfg["x"] = 3.6
            if piso - min_lote_y >= lh * 2.2:
                lote_cfg["y"] = piso - 3.0
            else:
                subs_arriba = [t for t in textos if t[0] <= 22 and t[1] > desc_top + lh]
                if subs_arriba:
                    borde_sup = min(t[1] for t in subs_arriba)
                    hueco = borde_sup - desc_top
                    if hueco >= lh * 2:
                        lote_cfg["y"] = desc_top + (hueco - lh * 2) / 2 + lh
                    else:
                        lote_cfg["y"] = desc_top + max(1.0, hueco * 0.35)
                else:
                    lote_cfg["y"] = max(min_lote_y, desc_top - lh * 2)
        elif subtitulos:
            lote_cfg["x"] = subtitulos[0][0]
            lote_cfg["y"] = subtitulos[0][1] - 8.0
        spec["lote"] = lote_cfg

    if _RE_BARCODE_EMBED.search(svg):
        skip_barras = True

    return spec, skip_barras


_RE_BARCODE_EMBED = re.compile(
    r'(<g[^>]*transform="matrix\(([0-9.]+),0,0,([0-9.]+),([0-9.]+),([0-9.]+)\)"[^>]*>\s*'
    r'<image[^>]*xlink:href=")(data:image/[^"]+)(")',
    re.IGNORECASE | re.DOTALL,
)


def _reemplazar_barcode_embebido(svg: str, b64: str) -> str:
    def _sub(m: re.Match) -> str:
        sx, sy, tx, ty = float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5))
        if sx < 8 or sy < 8:
            return m.group(0)
        return f'{m.group(1)}data:image/png;base64,{b64}{m.group(7)}'

    return _RE_BARCODE_EMBED.sub(_sub, svg, count=1)


def _bonus_nombre_ai(nombre: str, nom_ai: str, datos: dict) -> int:
    bonus = 0
    blob = f"{datos.get('subtitulo', '')} {datos.get('nombre_producto', '')}".lower()
    ai_low = nom_ai.lower()
    if "refinad" in blob and "refinad" in ai_low:
        bonus += 25
    if "amarill" in blob and "amarill" in ai_low:
        bonus += 20
    if "blanc" in blob and "blanc" in ai_low:
        bonus += 20
    if "natural" in blob and "natural" in ai_low:
        bonus += 20
    if "refinad" in blob and "natural" in ai_low:
        bonus -= 15
    if "carnaub" in blob and "carnaub" in ai_low:
        bonus += 30
    return bonus



def _norm_texto(s: str) -> str:
    raw = unicodedata.normalize("NFD", (s or "").strip())
    sin_tilde = "".join(c for c in raw if unicodedata.category(c) != "Mn")
    sin_tilde = re.sub(r"\bDE\b", " ", sin_tilde, flags=re.IGNORECASE)
    return re.sub(r"[^A-Z0-9]+", " ", sin_tilde.upper()).strip()


def _norm_formato(neto: str, unidad: str, tipo_etiqueta: str = "") -> set[str]:
    out: set[str] = set()
    nu = f"{(neto or '').strip()}{(unidad or '').strip()}".lower().replace(" ", "")
    if nu:
        out.add(nu)
        out.add(re.sub(r"(\d+)([a-z]+)", r"\1 \2", nu))
    tipo = (tipo_etiqueta or "").strip().lower().replace(" ", "")
    if tipo:
        out.add(tipo)
    if nu in {"1000g", "1kg"} or tipo in {"1kg", "kg"}:
        out.update({"kg", "1kg"})
    if nu in {"1000ml", "1l", "1lt"} or tipo in {"lt", "1l"}:
        out.update({"lt", "1l", "gl"})
    return {x.replace(" ", "") for x in out if x}


def _parse_ai_stem(stem: str) -> tuple[str, str]:
    m = re.match(
        r"^(.*?)\s+(\d+\s*(?:g|mL|ML|ml|G)|Kg|KG|kg|Lt|LT|lt|gL|GL)\s*$",
        stem,
        re.IGNORECASE,
    )
    if m:
        return _norm_texto(m.group(1)), m.group(2).lower().replace(" ", "")
    m2 = re.match(r"^(.*?)\s+(Kg|KG|kg|Lt|LT|lt|gL|GL)\s*$", stem, re.IGNORECASE)
    if m2:
        return _norm_texto(m2.group(1)), m2.group(2).lower()
    return _norm_texto(stem), ""


@lru_cache(maxsize=1)
def _indice_ai() -> list[tuple[str, str, Path]]:
    filas: list[tuple[str, str, Path]] = []
    if not _AI_DIR.is_dir():
        return filas
    for path in sorted(_AI_DIR.glob("*.ai")):
        nombre, fmt = _parse_ai_stem(path.stem)
        filas.append((nombre, fmt, path))
    return filas


def _puntuar_nombre(nombre: str, nom_ai: str) -> int:
    if not nombre or not nom_ai:
        return 0
    if nombre == nom_ai:
        return 100
    if nombre in nom_ai or nom_ai in nombre:
        return 70
    palabras = [w for w in nombre.split() if len(w) > 2]
    if palabras and all(w in nom_ai for w in palabras):
        return 45
    comunes = set(nombre.split()) & set(nom_ai.split())
    if len(comunes) >= 2:
        return 35
    if len(comunes) == 1 and len(nombre.split()) <= 2:
        return 20
    return 0


def inferir_presentacion_desde_sku(sku: str) -> dict[str, str]:
    """Extrae neto/unidad del código Siigo (ej. C-CITMAG250g → 250 g)."""
    raw = (sku or "").strip()
    if not raw:
        return {}
    m = re.search(
        r"(\d+(?:[.,]\d+)?)\s*(KG|G|ML|LT|L)\b",
        raw,
        re.IGNORECASE,
    )
    if not m:
        m = re.search(r"(\d+)(KG|G|ML|LT|L)$", raw, re.IGNORECASE)
    if not m:
        return {}
    neto = m.group(1).replace(",", ".")
    unidad = m.group(2).lower()
    if unidad == "l":
        unidad = "lt"
    if unidad == "kg" and float(neto) == 1:
        return {"contenido_neto": "1", "unidad": "Kg", "tipo_etiqueta": "1 Kg"}
    if unidad in {"lt", "gl"}:
        return {"contenido_neto": neto, "unidad": "L", "tipo_etiqueta": "50 mL"}
    if unidad == "ml":
        return {"contenido_neto": neto, "unidad": "mL", "tipo_etiqueta": f"{neto} mL"}
    return {
        "contenido_neto": neto,
        "unidad": "g",
        "tipo_etiqueta": f"{neto} g" if unidad == "g" else f"{neto} {unidad}",
    }


def _candidatos_ai(
    datos: dict,
    *,
    q: str = "",
    limite: int = 20,
    min_score: int = 15,
) -> list[dict[str, Any]]:
    nombre = _norm_texto(
        datos.get("nombre_producto") or datos.get("ingrediente") or datos.get("sku") or ""
    )
    formatos = _norm_formato(
        str(datos.get("contenido_neto") or ""),
        str(datos.get("unidad") or ""),
        str(datos.get("tipo_etiqueta") or ""),
    )
    qn = _norm_texto(q)
    out: list[dict[str, Any]] = []
    for nom_ai, fmt_ai, path in _indice_ai():
        if qn and qn not in nom_ai and qn not in path.stem.upper():
            continue
        if formatos and fmt_ai and fmt_ai not in formatos:
            continue
        score = _puntuar_nombre(nombre, nom_ai)
        score += _bonus_nombre_ai(nombre, path.stem, datos)
        if fmt_ai and formatos:
            score += 10
        if qn and qn in nom_ai:
            score += 15
        if score < min_score and not qn:
            continue
        out.append({
            "archivo": path.name,
            "nombre": nom_ai,
            "formato": fmt_ai,
            "score": score,
            "disponible": True,
        })
    out.sort(key=lambda x: (-x["score"], x["archivo"]))
    return out[:limite]


def resolver_plantilla_ai(datos: dict, *, q: str = "", limite: int = 20) -> dict[str, Any]:
    payload = dict(datos)
    inferido = inferir_presentacion_desde_sku(str(datos.get("sku") or ""))
    for k, v in inferido.items():
        if v and not str(payload.get(k) or "").strip():
            payload[k] = v

    candidatos = _candidatos_ai(payload, q=q, limite=limite)
    archivo = (payload.get("archivo_ai") or payload.get("plantilla_ai") or "").strip()
    if archivo and not archivo.lower().endswith(".ai"):
        archivo = f"{archivo}.ai"

    elegido = archivo or (candidatos[0]["archivo"] if candidatos else "")
    path = buscar_plantilla_ai({**payload, "archivo_ai": elegido}) if elegido else None
    score = 0
    if path:
        for c in candidatos:
            if c["archivo"] == path.name:
                score = c["score"]
                break
        if not score and archivo:
            score = 100

    return {
        "archivo_ai": path.name if path else (elegido or None),
        "score": score,
        "auto": bool(path and not datos.get("archivo_ai") and not datos.get("plantilla_ai")),
        "inferido": inferido or None,
        "candidatos": candidatos,
        "total_ai": len(_indice_ai()),
    }


def buscar_plantilla_ai(datos: dict) -> Path | None:
    explicito = (datos.get("archivo_ai") or datos.get("plantilla_ai") or "").strip()
    if explicito:
        p = _AI_DIR / explicito
        if p.is_file():
            return p
        p2 = _AI_DIR / f"{explicito}.ai"
        if p2.is_file():
            return p2

    nombre = _norm_texto(
        datos.get("nombre_producto") or datos.get("ingrediente") or datos.get("sku") or ""
    )
    if not nombre:
        return None
    formatos = _norm_formato(
        str(datos.get("contenido_neto") or ""),
        str(datos.get("unidad") or ""),
        str(datos.get("tipo_etiqueta") or ""),
    )
    mejor: tuple[int, Path] | None = None
    for nom_ai, fmt_ai, path in _indice_ai():
        if formatos and fmt_ai and fmt_ai not in formatos:
            continue
        score = _puntuar_nombre(nombre, nom_ai)
        if score <= 0:
            continue
        score += _bonus_nombre_ai(nombre, path.stem, datos)
        if fmt_ai and formatos:
            score += 10
        if mejor is None or score > mejor[0]:
            mejor = (score, path)
    if mejor and mejor[0] >= 20:
        return mejor[1]
    return None


def listar_plantillas_ai(limite: int = 500) -> list[dict[str, Any]]:
    out = []
    for nom, fmt, path in _indice_ai()[:limite]:
        out.append({
            "archivo": path.name,
            "nombre": nom,
            "formato": fmt,
            "disponible": True,
        })
    return out


def _cache_path(ai_path: Path) -> Path:
    st = ai_path.stat()
    key = f"{ai_path}:{st.st_mtime_ns}:{st.st_size}"
    h = hashlib.sha256(key.encode()).hexdigest()[:14]
    safe = re.sub(r"[^\w.\-]+", "_", ai_path.stem)[:48]
    return _CACHE_DIR / f"{safe}_{h}.svg"


def _ai_a_svg(ai_path: Path) -> str:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = _cache_path(ai_path)
    if cache.is_file() and cache.stat().st_mtime >= ai_path.stat().st_mtime:
        return cache.read_text(encoding="utf-8")
    tmp_out = cache.with_suffix(".tmp.svg")
    proc = subprocess.run(
        [
            "inkscape",
            str(ai_path),
            "--export-type=svg",
            f"--export-filename={tmp_out}",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0 or not tmp_out.is_file():
        err = (proc.stderr or proc.stdout or "Inkscape no pudo abrir el .ai").strip()
        raise RuntimeError(err[:500])
    svg = tmp_out.read_text(encoding="utf-8")
    tmp_out.replace(cache)
    return svg


_MARCAS_NO_TITULO = ("MCKENNA", "GROUP", "NO GHS", "®", "S.A.S")


def _reemplazos_in_place_ai(datos: dict, muestras: dict[str, str]) -> list[tuple[str, str]]:
    """Solo sustituye texto que ya existe en el .ai; no altera cajas ni posiciones."""
    from app.tools.etiquetas_svg_engine import _reemplazos_desde_datos

    pares = _reemplazos_desde_datos(datos, {"muestras": muestras})
    out: list[tuple[str, str]] = []
    for muestra, valor in pares:
        if muestra.startswith("Desarrollado por:"):
            continue
        titulo_muestra = muestras.get("titulo") or ""
        if muestra == titulo_muestra and any(m in muestra.upper() for m in _MARCAS_NO_TITULO):
            continue
        out.append((muestra, valor))
    return out


def _aplicar_lote_exp_inplace(svg: str, datos: dict) -> str:
    """Actualiza LOT/EXP solo si la plantilla ya los trae en su sitio."""
    from app.tools.etiquetas_svg_engine import _lineas_lote_vencimiento

    if datos.get("mostrar_lote_vencimiento") is False:
        return svg
    lineas = _lineas_lote_vencimiento(datos)
    if not lineas:
        return svg
    out = svg
    placeholders = [
        "LOT.___________",
        "LOT. ___________",
        "LOT:___________",
        "EXP.___________",
        "EXP. ___________",
        "EXP:___________",
    ]
    if lineas[0] and any(p in out for p in placeholders[:3]):
        for p in placeholders[:3]:
            if p in out:
                out = out.replace(p, lineas[0], 1)
                break
    if len(lineas) > 1 and lineas[1] and any(p in out for p in placeholders[3:]):
        for p in placeholders[3:]:
            if p in out:
                out = out.replace(p, lineas[1], 1)
                break
    return out


def _detectar_muestras_ai(svg: str) -> dict[str, str]:
    textos: list[str] = []
    for m in _RE_TSPAN_TEXT.finditer(svg):
        t = re.sub(r"\s+", " ", m.group(1)).strip()
        if t and t not in textos:
            textos.append(t)

    muestras: dict[str, str] = {}
    for t in textos:
        if t.startswith("# CAS:") or t.startswith("# CAS :"):
            muestras["cas_linea"] = t
        elif t.startswith("Concentración:"):
            muestras["concentracion"] = t
        elif t.startswith("Fórmula molecular:"):
            muestras["formula"] = t
        elif "Materia prima" in t or t.lower().startswith("aceite "):
            muestras.setdefault("subtitulo", t)
        elif re.match(r"^\d+\s*(g|mL|ml)$", t, re.I) or _RE_PESO_TSPAN.match(t):
            muestras["peso"] = t
        elif t.startswith("Incluye cuchara"):
            muestras["cuchara"] = t
        elif t.startswith("Desarrollado por:"):
            pass  # no reemplazar: rompe tspan/centering del Illustrator
        elif len(t) > 80 and "descripcion_inicio" not in muestras:
            muestras["descripcion_inicio"] = t[:220]

    # Título: línea corta en mayúsculas (nombre producto)
    candidatos = [
        t for t in textos
        if 4 <= len(t) <= 52
        and t == t.upper()
        and not t.startswith(("•", "#", "LOT", "EXP"))
        and not any(m in t.upper() for m in _MARCAS_NO_TITULO)
        and "MATERIA PRIMA" not in t.upper()
        and "CALIDAD:" not in t.upper()
    ]
    if candidatos:
        muestras["titulo"] = candidatos[0]

    return muestras


def _pos_cierre_desde_apertura(svg: str, apertura: int) -> int:
    depth = 1
    i = svg.find(">", apertura) + 1
    while i < len(svg) and depth > 0:
        g_open_m = _RE_TAG_G_OPEN.search(svg, i)
        g_close = svg.find("</g>", i)
        if g_close == -1:
            break
        if g_open_m and g_open_m.start() < g_close:
            depth += 1
            i = g_open_m.end()
            continue
        depth -= 1
        if depth == 0:
            return g_close
        i = g_close + 4
    return svg.rfind("</svg>")


def _pos_cierre_grupo_plantilla(svg: str, marcador: str | None = None) -> int:
    if marcador and marcador in svg:
        ultima_apertura = -1
        for m in _RE_GRUPO_PLANTILLA.finditer(svg):
            if m.start() < svg.find(marcador):
                ultima_apertura = m.start()
            else:
                break
        if ultima_apertura >= 0:
            return _pos_cierre_desde_apertura(svg, ultima_apertura)
    m = _RE_GRUPO_PLANTILLA.search(svg)
    if not m:
        return svg.rfind("</svg>")
    return _pos_cierre_desde_apertura(svg, m.start())


def _inyectar_en_grupo_plantilla(svg: str, fragmentos: list[str], marcador: str | None = None) -> str:
    if not fragmentos:
        return svg
    idx = _pos_cierre_grupo_plantilla(svg, marcador=marcador)
    bloque = "\n  " + "\n  ".join(fragmentos) + "\n  "
    return svg[:idx] + bloque + svg[idx:]


def renderizar_desde_ai(datos: dict, ai_path: Path | None = None) -> tuple[str, dict[str, Any]]:
    """
    Render conservador: respeta el layout Illustrator tal cual.
    Solo reemplaza textos/código de barras que ya existen en el .ai (in-place).
    No inyecta overlays (LOT/EXP, legal, barras) en coordenadas genéricas.
    """
    from app.tools.etiquetas_svg_engine import (
        _aplicar_reemplazos_texto,
        _barcode_png_base64,
        _codigo_barras_valor,
        _lineas_lote_vencimiento,
        _spec_para_tipo,
    )

    path = ai_path or buscar_plantilla_ai(datos)
    if not path or not path.is_file():
        raise FileNotFoundError("No hay plantilla .ai para este producto y formato")

    svg = _ai_a_svg(path)
    muestras = _detectar_muestras_ai(svg)
    tipo = (datos.get("tipo_etiqueta") or "250 g").strip()
    spec = _spec_para_tipo(tipo) or {}

    pares = _reemplazos_in_place_ai(datos, muestras)
    svg = _aplicar_reemplazos_texto(svg, pares)
    svg = _aplicar_lote_exp_inplace(svg, datos)

    barcode_reemplazado = False
    valor_cb = _codigo_barras_valor(datos)
    if valor_cb:
        try:
            b64 = _barcode_png_base64(valor_cb)
            nuevo = _reemplazar_barcode_embebido(svg, b64)
            if nuevo != svg:
                svg = nuevo
                barcode_reemplazado = True
        except Exception:
            pass

    lineas_lv = _lineas_lote_vencimiento(datos) if "LOT." in svg or "EXP." in svg else []
    meta = {
        "fuente": "ai",
        "modo": "in_place",
        "tipo_etiqueta": tipo,
        "archivo": path.name,
        "archivo_ai": path.name,
        "ancho_mm": spec.get("ancho_mm") or datos.get("ancho_mm"),
        "alto_mm": spec.get("alto_mm") or datos.get("alto_mm"),
        "reemplazos": len(pares),
        "muestras_detectadas": list(muestras.keys()),
        "overlays_inyectados": False,
        "codigo_barras": valor_cb or None,
        "codigo_barras_reemplazado": barcode_reemplazado,
        "bloque_legal": "2674" in svg or "REENVASE" in svg.upper(),
        "lote_vencimiento": lineas_lv if lineas_lv else None,
    }
    return svg, meta
