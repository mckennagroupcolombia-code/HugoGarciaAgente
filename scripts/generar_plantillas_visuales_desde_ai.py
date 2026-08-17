#!/usr/bin/env python3
"""
Genera plantillas del Studio Visual (plantillas_visuales.json) a partir de los
archivos Illustrator históricos de "Etiquetas Modelo SVG" (.ai = PDF).

Por cada .ai:
  1. Lee el tamaño físico de página (pdfinfo) y lo mapea a un formato del
     Studio que tenga plantilla "ideal" (master).
  2. Extrae los textos con posición (pdftotext -bbox): título, subtítulo,
     fórmula/origen, descripción, CAS, concentración, cuchara, peso,
     advertencias.
  3. Decodifica el código de barras EAN-13 renderizando el .ai (pdftoppm +
     pyzbar) y genera el SVG de barras con el MISMO layout que ean13.ts.
  4. Clona la plantilla master del formato conservando posición/estilo de
     todos los elementos y reemplaza solo los contenidos.
  5. Ajusta tamaños de fuente para que cada texto QUEPA en su caja (mismas
     métricas Montserrat que usa el editor DOM) y renderiza un PNG de
     verificación de alta fidelidad.

Uso:
  python3 scripts/generar_plantillas_visuales_desde_ai.py --dry-run --limite 5
  python3 scripts/generar_plantillas_visuales_desde_ai.py --guardar
  python3 scripts/generar_plantillas_visuales_desde_ai.py --guardar --solo "ACIDO"
"""
from __future__ import annotations

import argparse
import base64
import copy
import html
import io
import json
import re
import subprocess
import sys
import unicodedata
import uuid
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

_AI_DIR = _REPO / "Etiquetas Modelo SVG"
_RECURSOS_PNG = Path.home() / "Documentos" / "Etiquetas McKenna" / "Recursos PNG"

# ── Masters aprobados (los 26 del apartado Imprimir + PLANTILLA base) ──────
# Por formato físico (mm) y color de acento. "roles" completa los textRole
# que los masters retocados a mano perdieron ("__vaciar__" = texto específico
# del producto master que no debe heredarse).
PALETA = {
    "azul": "#0396f1",
    "amarillo": "#ffa040",
    "cafe": "#865e3c",
    "morado": "#813d9c",
    "gris": "#77767b",
    "teal": "#0e7490",
}
# Anclas RGB extra por color: tonos históricos usados en los .ai viejos.
ANCLAS_COLOR = {
    "azul": ["#0396f1", "#0072bc", "#1b75bb", "#27aae1"],
    "amarillo": ["#ffa040", "#ffa944", "#f7941d", "#fbb040"],
    "cafe": ["#865e3c", "#6b4a2f", "#a97c50", "#754c29"],
    "morado": ["#813d9c", "#5e2590", "#8d198f", "#662d91"],
    "gris": ["#77767b", "#939598", "#58595b"],
    "teal": ["#0e7490", "#0891b2", "#00a79d"],
    "verde": ["#39b54a", "#006838", "#8dc63f"],
    "rojo": ["#ed1c24", "#be1e2d"],
}
LOGOS = {
    "azul": "logo azul  _ isotipo.png",
    "amarillo": "LOGO AMARILLO.png",
    "cafe": "LOGO CAFE.png",
    "morado": "LOGO MORADO.png",
    "gris": "LOGO GRIS.png",
}
MASTERS = {
    (76, 66): {
        "azul": {"id": "6163b923-b0a"},
        "amarillo": {"id": "211deae3-270", "acento": "#ffa040"},
        "morado": {"id": "b53d18f9a3d2", "acento": "#813d9c",
                   "roles": {"4bc1b2e8-ae8": "advertencias"}},
    },
    (69, 51): {
        "azul": {"id": "ef750bb7-997"},
        "cafe": {"id": "e9400a48-66e", "acento": "#865e3c"},
        "morado": {"id": "d563f4d84e4e", "acento": "#813d9c"},
    },
    (102, 38): {
        "azul": {"id": "e4681c0b-8f8"},
        "morado": {"id": "7f003bd1-550", "acento": "#813d9c",
                   "roles": {"f25cf8a6-b05": "subtitulo", "4056b8a3-e05": "advertencias"}},
        "amarillo": {"id": "c7c01eb2-55a", "acento": "#ffa944",
                     "roles": {"13ef18f6-9e7": "subtitulo", "1538b186-b1d": "advertencias"}},
    },
    # (55, 55) y (70, 70) son etiquetas CIRCULARES con texto en arco
    # (VASELINA / KARITE): no se clonan automáticamente — hacerlas en el Studio.
    (42, 50): {
        "teal": {"id": "27e43f44-d0f", "acento": "#0e7490",
                 "roles": {"feed383b-ba5": "titulo", "9b1d53a9-568": "subtitulo",
                           "61d8a017-cfb": "descripcion", "729449c5-ad8": "advertencias"}},
    },
    (50, 42): {
        "gris": {"id": "50357517-81f", "acento": "#77767b"},
    },
}
# Color base preferido al recolorear cuando el formato no tiene el color pedido
COLOR_BASE_PREFERIDO = ["azul", "amarillo", "morado", "cafe", "gris", "teal"]

# Ids de las plantillas modelo del apartado Imprimir: NUNCA se sobreescriben.
APROBADOS_IDS = {
    "50f4cb70-4e3", "7f003bd1-550", "ed3003bc-7c9", "5f3566c7-f28", "2986d72c-8d3",
    "5aa2d79e-dfe", "80162852-b37", "8e92c4ce-c18", "6a0ee6e3-4d9", "cb205719-736",
    "f6c0d834a29f", "c7c01eb2-55a", "c85eac37-d3d", "d3b2c9f2-7a4", "3e5ddd4d-7f0",
    "27e43f44-d0f", "2bbaf0f2-d27", "d563f4d84e4e", "fc896337-e5a", "ac795e52-e2c",
    "c6cbce4910c5", "b53d18f9a3d2", "1331e435-a3b", "51dc23cd-ed5", "50357517-81f",
    "6163b923-b0a", "211deae3-270", "ef750bb7-997", "e9400a48-66e", "e4681c0b-8f8",
}

# Página máxima aceptada como etiqueta individual (descarta A4 / pliegos)
LADO_MAX_MM = 130
TOLERANCIA_MM = 2
# Diferencia máxima de proporción al escalar un master a un formato sin modelo
MAX_DIF_ASPECTO = 0.30
# Raíz del Studio (sin carpeta). Antes era "Generadas AI"; se dejó de agrupar
# ahí para que las etiquetas generadas se vean junto al resto en la raíz.
CARPETA_DESTINO = ""
# Marca para --reemplazar / scripts de mantenimiento (carpeta ya no distingue).
ORIGEN_AI = True

FONTS_DIR = Path("/usr/share/fonts/truetype/montserrat")
_FONT_FILES = {
    "400": "Montserrat-Regular.ttf",
    "500": "Montserrat-Medium.ttf",
    "600": "Montserrat-SemiBold.ttf",
    "700": "Montserrat-Bold.ttf",
}
_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _font(weight: str, px: float, escala: int = 1) -> ImageFont.FreeTypeFont:
    w = str(weight or "400")
    if w in ("bold",):
        w = "700"
    if w not in _FONT_FILES:
        w = "500" if w not in ("100", "200", "300") else "400"
    size = max(4, int(round(px * escala)))
    key = (w, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(str(FONTS_DIR / _FONT_FILES[w]), size)
    return _font_cache[key]


# ══════════════════════════════════════════════════════════════════════════
#  1 · Lectura del .ai (PDF): tamaño, textos con posición, código de barras
# ══════════════════════════════════════════════════════════════════════════

_LIGADURAS = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "­": ""}


def _limpiar(t: str) -> str:
    t = html.unescape(t)
    for k, v in _LIGADURAS.items():
        t = t.replace(k, v)
    return re.sub(r"\s+", " ", t).strip()


def tam_pagina_mm(path: Path) -> tuple[float, float] | None:
    out = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True, timeout=30).stdout
    m = re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", out)
    if not m:
        return None
    return float(m.group(1)) / 72 * 25.4, float(m.group(2)) / 72 * 25.4


def _tipos_impresion() -> list[dict]:
    try:
        data = json.loads((_REPO / "app" / "data" / "etiquetas_tipos.json").read_text())
        return data.get("tipos") or []
    except Exception:
        return []


def nombre_tipo_para(w_mm: float, h_mm: float) -> str:
    """Nombre del formato de impresión configurado más cercano (±3 mm)."""
    for t in _tipos_impresion():
        tw, th = float(t.get("ancho_mm") or 0), float(t.get("alto_mm") or 0)
        if (abs(w_mm - tw) <= 3 and abs(h_mm - th) <= 3) or \
           (abs(w_mm - th) <= 3 and abs(h_mm - tw) <= 3):
            return str(t.get("nombre"))
    return f"{w_mm:.0f}x{h_mm:.0f} mm"


def resolver_formato(path: Path) -> tuple[tuple[int, int] | None, bool, tuple[float, float] | None]:
    """(clave de MASTERS, rotada, tamaño_destino_mm).

    tamaño_destino_mm es None cuando el .ai coincide con el master (±2 mm);
    si no, es el tamaño real del .ai al que hay que ESCALAR el master de
    proporción más parecida (misma orientación; los .ai rotados se generan
    en la orientación del master y se rotan al imprimir).
    """
    t = tam_pagina_mm(path)
    if not t:
        return None, False, None
    w, h = t
    if max(w, h) > LADO_MAX_MM:
        return None, False, None
    if abs(w - h) <= 3 and 50 <= min(w, h) <= 75:
        return None, False, None  # circular (texto en arco): diseño manual
    # Las etiquetas "50 g" (.ai a 102x32) se trabajan en lienzo 102x38, igual
    # que las 50 g aprobadas del Studio (ALGINATO/CLORURO/LACTATO DE CALCIO).
    if abs(w - 102) <= 2 and abs(h - 32) <= 2:
        return (102, 38), False, None
    if abs(h - 102) <= 2 and abs(w - 32) <= 2:
        return (102, 38), True, None
    for mw, mh in MASTERS:
        if abs(w - mw) <= TOLERANCIA_MM and abs(h - mh) <= TOLERANCIA_MM:
            return (mw, mh), False, None
    for mw, mh in MASTERS:
        if abs(w - mh) <= TOLERANCIA_MM and abs(h - mw) <= TOLERANCIA_MM:
            return (mw, mh), True, None
    mejor = None  # (dif penalizada, clave, rotada, destino)
    for mw, mh in MASTERS:
        for aw, ah, rot in ((w, h, False), (h, w, True)):
            if mw != mh and aw != ah and (mw >= mh) != (aw >= ah):
                continue  # orientación distinta
            dif = abs((aw / ah) - (mw / mh)) / (mw / mh)
            if dif > MAX_DIF_ASPECTO:
                continue
            pen = dif + (0.03 if rot else 0.0)  # preferir no rotar
            if mejor is None or pen < mejor[0]:
                mejor = (pen, (mw, mh), rot, (aw, ah))
    if mejor:
        return mejor[1], mejor[2], mejor[3]
    return None, False, None


_RE_WORD = re.compile(
    r'<word xMin="([\d.\-]+)" yMin="([\d.\-]+)" xMax="([\d.\-]+)" yMax="([\d.\-]+)">(.*?)</word>',
    re.S,
)
_RE_PESO = re.compile(r"^\d[\d.,]*\s*(?:g|kg|mL|ml|Lt|lt|L)(?:\s*/\s*g)?\.?$", re.IGNORECASE)


def _palabras(path: Path) -> tuple[list[dict], float, float]:
    out = subprocess.run(
        ["pdftotext", "-bbox", "-f", "1", "-l", "1", str(path), "-"],
        capture_output=True, text=True, timeout=60,
    ).stdout
    pm = re.search(r'<page width="([\d.]+)" height="([\d.]+)"', out)
    pw, ph = (float(pm.group(1)), float(pm.group(2))) if pm else (1.0, 1.0)
    words = []
    for m in _RE_WORD.finditer(out):
        x0, y0, x1, y1 = (float(m.group(i)) for i in range(1, 5))
        txt = _limpiar(m.group(5))
        if txt:
            words.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "t": txt})
    return words, pw, ph


def _en_lineas(words: list[dict]) -> list[dict]:
    """Agrupa palabras en líneas por LÍNEA BASE (yMax) con tolerancia fija.

    Los .ai de Illustrator traen renglones muy juntos; agrupar por bandas que
    crecen mezcla el título con el subtítulo y entrelaza renglones de párrafos
    justificados. La línea base es estable dentro de un mismo renglón.
    """
    lineas: list[dict] = []
    for w in sorted(words, key=lambda a: (a["y1"], a["x0"])):
        elegido = None
        for ln in lineas:
            if abs(w["y1"] - ln["base"]) <= 2.0:
                elegido = ln
                break
        if elegido:
            elegido["w"].append(w)
        else:
            lineas.append({"base": w["y1"], "w": [w]})
    for ln in lineas:
        ln["w"].sort(key=lambda a: a["x0"])
        ln["x0"] = ln["w"][0]["x0"]
        ln["x1"] = max(a["x1"] for a in ln["w"])
        ln["y0"] = min(a["y0"] for a in ln["w"])
        ln["y1"] = max(a["y1"] for a in ln["w"])
        ln["t"] = " ".join(a["t"] for a in ln["w"])
        ln["h"] = ln["y1"] - ln["y0"]
    lineas.sort(key=lambda a: a["y0"])
    return lineas


_RE_ANCLA_DER = re.compile(
    r"^(concentraci[óo]n|#?\s*cas\b|• ?puede causar|puede causar|desarrollado por|• ?revise|• ?evite|• ?no es comedog)",
    re.IGNORECASE,
)
_RE_RUIDO = re.compile(
    r"mckennagroup\.co|901316016|^nit\.|^bogotá|^desarrollado por|^descarga ficha|^técnica en:?$|^www\."
    r"|^lot\.?\s*\d*$|^exp\.?\s*\d*$",
    re.IGNORECASE,
)
_RE_ADVERTENCIA = re.compile(
    r"puede causar|reacci[óo]n al[ée]rgica|problemas digestivos|comedog[ée]nico"
    r"|revise que el (empaque|envase)|perfectas condiciones|antes de abrirlo"
    r"|mantenga (el envase|bien|el empaque)|bien cerrado|lugar fresco"
    r"|alejado de la luz|el calor y la humedad",
    re.IGNORECASE,
)


_RE_RUIDO_INLINE = re.compile(
    r"(mckenna group s\.?\s*a\.?\s*s\.?|bogot[áa]\s*[–\-—]?\s*colombia"
    r"|nit\.?\s*901316016(-\d)?|desarrollado por:?|descarga ficha t[ée]cnica en:?"
    r"|www\.mckennagroup\.co|mckennagroup\.\s*co|rsn\s*\d[\d\s]*\w*)",
    re.IGNORECASE,
)


def _quitar_ruido_inline(t: str) -> str:
    """Texto de la esquina corporativa que se cuela dentro de párrafos cuando
    las columnas del .ai están demasiado juntas (etiquetas pequeñas)."""
    return _RE_RUIDO_INLINE.sub(" ", t)


def _limpiar_parrafo(t: str) -> str:
    t = re.sub(r"(\w)-\s+(\w)", r"\1\2", t)  # cortes con guión al final de renglón
    # Palabras con tracking de Illustrator extraídas letra a letra: "p e r f e c t a s"
    t = re.sub(
        r"\b((?:[a-záéíóúñ] ){3,}[a-záéíóúñ])\b",
        lambda m: m.group(1).replace(" ", ""),
        t,
    )
    t = re.sub(r"\s+([.,;:%)])", r"\1", t)
    t = re.sub(r"\(\s+", "(", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def extraer_campos(path: Path) -> dict:
    """Transcribe los campos de la etiqueta .ai."""
    words, pw, ph = _palabras(path)
    campos: dict = {
        "titulo": "", "subtitulo": "", "formula": "", "origen": "",
        "cas": "", "concentracion": "", "cuchara": "", "peso": "",
        "descripcion": "", "advertencias": "", "tiene_no_ghs": False,
        "avisos": [],
    }
    if not words:
        campos["avisos"].append("sin texto extraíble")
        return campos

    todo = " ".join(w["t"] for w in words)
    if re.search(r"\bNO\s+GHS\b|\bGHS\s+NO\b", todo):
        campos["tiene_no_ghs"] = True

    # Quitar las palabras del rombo "NO GHS": son pares NO/GHS apilados
    # verticalmente que contaminan los renglones vecinos.
    diamante: set[int] = set()
    for i, w in enumerate(words):
        if w["t"] not in ("NO", "GHS"):
            continue
        for j, v in enumerate(words):
            if i != j and v["t"] in ("NO", "GHS") and v["t"] != w["t"] \
               and abs(v["x0"] - w["x0"]) < 12 and abs(v["y0"] - w["y0"]) < 14:
                diamante.update((i, j))
    if diamante:
        campos["tiene_no_ghs"] = True
        words = [w for i, w in enumerate(words) if i not in diamante]

    lineas = _en_lineas(words)
    alto_max = max(ln["h"] for ln in lineas)

    # Frontera de referencia: donde empiezan bloques típicos de columna derecha
    anclas = [
        ln["x0"] for ln in lineas
        if ln["x0"] > pw * 0.45 and _RE_ANCLA_DER.match(ln["t"])
    ]
    frontera = (min(anclas) - 3) if anclas else pw * 0.62

    desc_lineas: list[str] = []
    adv_segs: list[tuple[float, float, str]] = []
    titulo_listo = False
    subtitulo_corto = ""   # línea corta bajo el título (p. ej. "Aceite vegetal puro")
    espera_formula = False  # "Fórmula molecular:" sin valor; el valor viene en el siguiente renglón
    ult_adv: tuple[float, float] | None = None  # (x0, y1) de la última advertencia

    # Umbral de hueco entre segmentos proporcional al ancho de página:
    # en etiquetas pequeñas las columnas están mucho más juntas.
    umbral_gap = max(4.0, pw * 0.025)

    for ln in lineas:
        # Segmentos: corridas de palabras separadas por huecos horizontales
        segs: list[list[dict]] = []
        cur = [ln["w"][0]]
        for a, b in zip(ln["w"], ln["w"][1:]):
            if b["x0"] - a["x1"] > umbral_gap:
                segs.append(cur)
                cur = [b]
            else:
                cur.append(b)
        segs.append(cur)

        for seg in segs:
            t = " ".join(w["t"] for w in seg).strip()
            tl = t.lower()
            if not t or t == "®":
                continue
            x0 = seg[0]["x0"]
            h = max(w["y1"] - w["y0"] for w in seg)
            if "mckenna group" in tl and len(t) < 32:
                continue
            if _RE_RUIDO.search(tl):
                continue
            if re.fullmatch(r"(NO|GHS|NO GHS|GHS NO)", t):
                continue
            # Título: segmentos grandes y en mayúsculas, arriba a la izquierda
            if (
                not titulo_listo and ln["y0"] < ph * 0.30 and x0 < pw * 0.6
                and h >= alto_max * 0.65
                and sum(c.isupper() for c in t if c.isalpha()) >= 0.8 * max(1, sum(c.isalpha() for c in t))
            ):
                campos["titulo"] = (campos["titulo"] + " " + t).strip()
                continue
            if campos["titulo"]:
                titulo_listo = True
            if re.match(r"f[óo]rmula\s+molecular", tl):
                campos["formula"] = t
                espera_formula = t.rstrip().endswith(":")
                continue
            if espera_formula and x0 < frontera and re.fullmatch(r"[A-Za-z0-9().·\- ]{2,30}", t) \
               and any(c.isdigit() for c in t):
                campos["formula"] = campos["formula"].rstrip() + " " + t
                espera_formula = False
                continue
            if tl.startswith("origen:") or tl.startswith("fuente:"):
                campos["origen"] = t
                continue
            # Subtítulo real: línea corta tipo banda ("Materia prima grado…");
            # el tope de longitud evita capturar renglones de la descripción
            # que empiezan con las mismas palabras.
            if not campos["subtitulo"] and ln["y0"] < ph * 0.45 and len(t) <= 65 \
               and re.search(r"^(.{0,14})?(materia prima|insumo (alimentario|cosm|de uso)"
                             r"|aceite (100%\s*)?esencial puro|aceite vegetal puro)", tl) \
               and not t.rstrip().endswith((",", ";")):
                campos["subtitulo"] = t
                continue
            if re.match(r"concentraci[óo]n\s*:", tl):
                campos["concentracion"] = re.sub(r"\s*:\s*", ": ", t)
                continue
            if re.match(r"#?\s*CAS[:\s]+N/?A", t, re.IGNORECASE):
                continue  # sin CAS declarado; la casilla queda en blanco
            m = re.match(r"#?\s*CAS[:\s]+([0-9][0-9\-]+)", t, re.IGNORECASE)
            if m:
                campos["cas"] = m.group(1).strip("-")
                continue
            if tl.startswith("incluye"):
                campos["cuchara"] = t
                continue
            if _RE_PESO.match(t):
                # el peso "oficial" es el de abajo; uno suelto arriba (5 mL)
                # también cuenta y nunca debe caer en la descripción
                if not campos["peso"] or ln["y0"] > ph * 0.65:
                    campos["peso"] = t
                continue
            # Línea corta justo bajo el título: candidata a subtítulo
            if (
                not subtitulo_corto and not desc_lineas and ln["y0"] < ph * 0.25
                and h < alto_max * 0.6 and len(t.split()) <= 6 and x0 < pw * 0.6
            ):
                subtitulo_corto = t
                continue
            # Advertencias por contenido (funciona en cualquier columna)
            es_adv = bool(_RE_ADVERTENCIA.search(tl))
            if not es_adv and ult_adv is not None:
                # continuación de un bullet partido en varios renglones
                if abs(x0 - ult_adv[0]) < 30 and 0 <= ln["y0"] - ult_adv[1] < 10 and t.startswith("•") is False \
                   and len(t.split()) <= 10 and x0 > pw * 0.15:
                    es_adv = True
            if es_adv or x0 >= frontera:
                adv_segs.append((x0, ln["y0"], t))
                ult_adv = (x0, ln["y1"])
                continue
            desc_lineas.append(t)

    desc = _limpiar_parrafo(_quitar_ruido_inline(" ".join(desc_lineas)))
    # Campos que quedaron incrustados en el párrafo cuando el hueco entre
    # columnas es menor que el umbral de segmentación: capturar y retirar.
    m = re.search(r"#?\s*CAS:?\s*([0-9][0-9\-]{4,})", desc)
    if m:
        if not campos["cas"]:
            campos["cas"] = m.group(1).strip("-")
        desc = desc.replace(m.group(0), " ")
    m = re.search(r"Concentraci[óo]n:?\s*([\d.,]+\s*%)", desc, re.IGNORECASE)
    if m:
        if not campos["concentracion"]:
            campos["concentracion"] = f"Concentración: {m.group(1)}"
        desc = desc.replace(m.group(0), " ")
    desc = re.sub(r"\bNO\s+GHS\b", " ", desc)
    desc = _limpiar_parrafo(desc)
    # Frases finales que son fragmentos de advertencias colados de la otra columna
    frases = re.split(r"(?<=\.)\s+", desc)
    while frases and _RE_ADVERTENCIA.search(frases[-1]):
        frases.pop()
    desc = " ".join(frases)
    # Bullets y encabezados tipo "Propiedades:" en su propio renglón
    desc = re.sub(r"\s*•\s*", "\n• ", desc)
    desc = re.sub(r"\s+(Propiedades:)\s*", r"\n\1", desc)
    campos["descripcion"] = desc.strip()

    if not campos["titulo"]:
        campos["titulo"] = titulo_desde_archivo(path.stem)
        campos["avisos"].append("título vectorizado en el .ai: tomado del nombre de archivo")
    # Línea corta que repite (parte de) el título: no es subtítulo ni origen
    if subtitulo_corto and subtitulo_corto.casefold() in campos["titulo"].casefold():
        subtitulo_corto = ""

    # Resolución del subtítulo: la línea tipo "Materia prima / Insumo…" manda;
    # la línea corta bajo el título (si además hubo banda) va a la descripción.
    if not campos["subtitulo"] and subtitulo_corto:
        campos["subtitulo"] = subtitulo_corto
    elif campos["subtitulo"] and subtitulo_corto and not campos["origen"]:
        campos["origen"] = subtitulo_corto
    if not campos["subtitulo"]:
        campos["avisos"].append("subtítulo no encontrado en el .ai (queda el del master)")

    # Subtítulo contaminado con campos vecinos de la misma línea
    if campos["subtitulo"]:
        st = campos["subtitulo"]
        m = re.search(r"\s*Concentraci[óo]n:?\s*[\d.,]+\s*%\s*$", st, re.IGNORECASE)
        if m:
            if not campos["concentracion"]:
                campos["concentracion"] = "Concentración: " + re.sub(r"[^\d.,%]", "", m.group(0))
            st = st[: m.start()]
        st = re.sub(r"\s*#?\s*CAS:?\s*[0-9][0-9\-]{4,}\s*$", "", st, flags=re.IGNORECASE)
        campos["subtitulo"] = st.strip()

    # Advertencias: reordenar por columnas (los .ai viejos ponen los bullets
    # en 2 columnas al pie; leerlas por renglón entrelaza los textos)
    adv_orden: list[str] = []
    if adv_segs:
        cols: list[dict] = []
        for seg in sorted(adv_segs, key=lambda s: s[0]):
            if cols and seg[0] - cols[-1]["x1"] <= pw * 0.08:
                cols[-1]["items"].append(seg)
                cols[-1]["x1"] = max(cols[-1]["x1"], seg[0])
            else:
                cols.append({"x1": seg[0], "items": [seg]})
        for col in cols:
            adv_orden += [t for _, _, t in sorted(col["items"], key=lambda s: (s[1], s[0]))]
    adv = _limpiar_parrafo(_quitar_ruido_inline(" ".join(adv_orden)))
    adv = re.sub(r"\bNO\s+GHS\b|\bGHS\b|\bH\d{3}\b", " ", adv)
    adv = re.sub(r"\s+", " ", adv)
    bullets = [b.strip(" .") for b in adv.split("•") if b.strip(" .")]
    if len(bullets) >= 2:
        campos["advertencias"] = "\n".join("• " + b + ("." if not b.endswith(".") else "") for b in bullets)
    return campos


def decodificar_ean(path: Path, tmp_dir: Path) -> str | None:
    """Renderiza el .ai y decodifica el EAN-13 impreso."""
    from pyzbar.pyzbar import decode

    tmp_dir.mkdir(parents=True, exist_ok=True)
    stem = tmp_dir / ("bc_" + re.sub(r"[^\w]+", "_", path.stem)[:60])
    for dpi in (300, 500):
        try:
            subprocess.run(
                ["pdftoppm", "-r", str(dpi), "-png", "-f", "1", "-l", "1", str(path), str(stem)],
                capture_output=True, timeout=90, check=True,
            )
        except Exception:
            return None
        png = Path(str(stem) + "-1.png")
        if not png.exists():
            candidatos = list(tmp_dir.glob(stem.name + "-*.png"))
            if not candidatos:
                continue
            png = candidatos[0]
        try:
            for r in decode(Image.open(png)):
                if r.type == "EAN13":
                    return r.data.decode()
        finally:
            png.unlink(missing_ok=True)
    return None


# ══════════════════════════════════════════════════════════════════════════
#  1b · Color de acento del .ai, recoloreo y escalado del master
# ══════════════════════════════════════════════════════════════════════════

def _hex2rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


_ANCLAS_RGB = [(color, _hex2rgb(h)) for color, hxs in ANCLAS_COLOR.items() for h in hxs]


def detectar_color_ai(path: Path, tmp_dir: Path) -> tuple[str, str | None]:
    """Color de acento dominante del .ai → (color de PALETA, aviso|None).

    El texto del cuerpo siempre puntúa como "gris"; el acento real es el
    bucket NO gris dominante. Solo si no hay ninguno, la etiqueta es gris.
    """
    tmp_dir.mkdir(parents=True, exist_ok=True)
    stem = tmp_dir / ("cl_" + re.sub(r"[^\w]+", "_", path.stem)[:60])
    try:
        subprocess.run(
            ["pdftoppm", "-r", "40", "-png", "-f", "1", "-l", "1", str(path), str(stem)],
            capture_output=True, timeout=60, check=True,
        )
    except Exception:
        return "azul", "no se pudo renderizar para detectar color: usa azul"
    pngs = sorted(tmp_dir.glob(stem.name + "*.png"))
    if not pngs:
        return "azul", "sin render para detectar color: usa azul"
    try:
        img = Image.open(pngs[0]).convert("RGB")
        img.thumbnail((220, 220))
        conteo = {c: 0 for c in ANCLAS_COLOR}
        muestreados = 0
        for r, g, b in img.getdata():
            mx, mn = max(r, g, b), min(r, g, b)
            if mx > 235 and mn > 225:
                continue  # blanco
            if mx - mn < 18 and not (60 < mx < 200):
                continue  # negro / casi negro (los grises medios sí cuentan)
            muestreados += 1
            mejor, mejor_d = None, 10**9
            for color, (ar, ag, ab) in _ANCLAS_RGB:
                d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2
                if d < mejor_d:
                    mejor_d, mejor = d, color
            if mejor_d < 75 ** 2:
                conteo[mejor] += 1
    finally:
        for p in pngs:
            p.unlink(missing_ok=True)
    con_color = {c: n for c, n in conteo.items() if c != "gris" and n > 0}
    if con_color:
        color = max(con_color, key=con_color.get)
        # exigir presencia mínima para no reaccionar a antialias suelto
        if con_color[color] >= max(30, muestreados * 0.01):
            return color, None
    if conteo.get("gris", 0) >= max(30, muestreados * 0.01):
        return "gris", None
    return "azul", "color de acento no identificado: usa azul"


_NEUTROS_RECOLOR = {
    "#0f172a", "#5e5c64", "#241f31", "#ffffff", "#f6f5f4", "#000000",
    "#171717", "#181918", "#231f20", "", "transparent", "none",
}


def recolorear_master(p: dict, acento_base: str, color_destino: str) -> None:
    """Sustituye el color de acento del master y su logo por los del destino."""
    destino = PALETA[color_destino]
    base = acento_base.lower()
    for el in p.get("elementos", []):
        t = el.get("type")
        if t == "text" and str(el.get("color") or "").lower() == base:
            el["color"] = destino
        elif t == "line" and str(el.get("stroke") or "").lower() == base:
            el["stroke"] = destino
        elif t == "rect":
            for k in ("stroke", "fill"):
                if str(el.get(k) or "").lower() == base:
                    el[k] = destino
        elif t == "image":
            src = el.get("src") or ""
            m = re.match(r"^(/(?:app/)?api/etiquetas/recursos-png/archivo/)(.+)$", src)
            if m and "logo" in m.group(2).lower() and color_destino in LOGOS:
                from urllib.parse import quote
                el["src"] = m.group(1) + quote(LOGOS[color_destino])


def resolver_master(masters_cache: dict, fmt_key: tuple[int, int], color: str) -> tuple[dict, str, list[str]]:
    """(deepcopy del master listo, color final usado, avisos). Recolorea si
    el formato no tiene master aprobado en el color detectado."""
    avisos: list[str] = []
    variantes = masters_cache[fmt_key]
    if color in variantes:
        return copy.deepcopy(variantes[color]), color, avisos
    base_color = next((c for c in COLOR_BASE_PREFERIDO if c in variantes), None)
    if base_color is None:
        base_color = next(iter(variantes))
    spec = MASTERS[fmt_key][base_color]
    p = copy.deepcopy(variantes[base_color])
    acento_base = spec.get("acento") or PALETA[base_color]
    recolorear_master(p, acento_base, color)
    avisos.append(f"master {base_color} recoloreado a {color}")
    return p, base_color, avisos


def escalar_plantilla(p: dict, destino_mm: tuple[float, float]) -> None:
    """Escala todo el master (posiciones, cajas, fuentes, trazos) al tamaño
    real del .ai conservando las proporciones internas del diseño."""
    fmt = p.get("formato") or {}
    w0, h0 = float(fmt.get("ancho_mm") or 1), float(fmt.get("alto_mm") or 1)
    w1, h1 = destino_mm
    sx, sy = w1 / w0, h1 / h0
    sf = min(sx, sy)
    for el in p.get("elementos", []):
        for k, s in (("x", sx), ("y", sy), ("width", sx), ("height", sy), ("x2", sx), ("y2", sy)):
            if el.get(k) is not None:
                el[k] = round(float(el[k]) * s, 2)
        if el.get("fontSize") is not None:
            el["fontSize"] = round(float(el["fontSize"]) * sf, 2)
        if el.get("strokeWidth") is not None:
            el["strokeWidth"] = round(float(el["strokeWidth"]) * sf, 2)
    nombre_tipo = nombre_tipo_para(w1, h1)
    p["formato"] = {
        "id": f"etiquetas-{nombre_tipo}",
        "nombre": nombre_tipo,
        "tipo_etiqueta": nombre_tipo,
        "ancho_mm": round(w1, 1),
        "alto_mm": round(h1, 1),
        "ancho_px": int(round(w1 / 25.4 * 96)),
        "alto_px": int(round(h1 / 25.4 * 96)),
        "dpi": 96,
    }


# ══════════════════════════════════════════════════════════════════════════
#  2 · EAN-13 → SVG (mismo layout que desktop/src/lib/ean13.ts)
# ══════════════════════════════════════════════════════════════════════════

_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]
_GUARD = {0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94}


def ean13_svg_data_uri(digits: str) -> str:
    digits = re.sub(r"\D", "", digits)
    assert len(digits) == 13, digits
    parity = _PARITY[int(digits[0])]
    bits = "101"
    for i in range(6):
        d = int(digits[i + 1])
        bits += _L[d] if parity[i] == "L" else _G[d]
    bits += "01010"
    for i in range(6):
        bits += _R[int(digits[i + 7])]
    bits += "101"

    mw, qzL, qzR, dataH, gExt, textH, padTop = 3, 11, 7, 80, 12, 20, 2
    totalW = (qzL + 95 + qzR) * mw
    totalH = padTop + dataH + gExt + textH
    bars = []
    for i, b in enumerate(bits):
        if b == "1":
            h = dataH + gExt if i in _GUARD else dataH
            bars.append(f'<rect x="{(qzL + i) * mw}" y="{padTop}" width="{mw}" height="{h}" fill="black"/>')
    textY = padTop + dataH + gExt + textH - 2
    xD1 = (qzL - 1) * mw
    xLeft = (qzL + 3 + 21) * mw
    xRight = (qzL + 50 + 21) * mw
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{totalW}" height="{totalH}">'
        f'<rect width="{totalW}" height="{totalH}" fill="white"/>' + "".join(bars) +
        f'<text x="{xD1}" y="{textY}" text-anchor="middle" font-family="monospace" font-size="17" fill="black">{digits[0]}</text>'
        f'<text x="{xLeft}" y="{textY}" text-anchor="middle" font-family="monospace" font-size="17" fill="black">{digits[1:7]}</text>'
        f'<text x="{xRight}" y="{textY}" text-anchor="middle" font-family="monospace" font-size="17" fill="black">{digits[7:]}</text>'
        f"</svg>"
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


# ══════════════════════════════════════════════════════════════════════════
#  3 · Métricas de texto (idénticas al DOM: Montserrat, line-height 1.2)
# ══════════════════════════════════════════════════════════════════════════

_MEDIDOR = ImageDraw.Draw(Image.new("RGB", (8, 8)))
# Para DECIDIR tamaños de fuente usamos una caja 5% más angosta que la real:
# el browser (motor del editor) mide apenas distinto que PIL y ese colchón
# garantiza que lo que aquí cabe, en el editor también.
_COLCHON_AJUSTE = 1.05


def _ancho_texto(t: str, weight: str, px: float) -> float:
    return _MEDIDOR.textlength(t, font=_font(weight, px, 8)) / 8


def envolver(texto: str, weight: str, px: float, ancho_caja: float) -> list[str]:
    """Word-wrap como el DOM (rompe en espacios, respeta \\n)."""
    lineas: list[str] = []
    for parrafo in (texto or "").split("\n"):
        palabras = parrafo.split(" ")
        actual = ""
        for p in palabras:
            cand = (actual + " " + p).strip()
            if actual and _ancho_texto(cand, weight, px) > ancho_caja:
                lineas.append(actual)
                actual = p
            else:
                actual = cand
        lineas.append(actual)
    return lineas


def alto_texto(texto: str, weight: str, px: float, ancho_caja: float, lh: float = 1.2) -> float:
    return len(envolver(texto, weight, px, ancho_caja)) * px * lh


def ajustar_multilinea(el: dict, texto: str, min_px: float = 3.6, alto_util: float | None = None) -> tuple[float, str, bool]:
    """(fontSize final, texto final, truncado). Reduce fuente y por último recorta frases."""
    px = float(el.get("fontSize") or 6)
    w = float(el["width"]) / _COLCHON_AJUSTE
    h = float(alto_util if alto_util is not None else el["height"])
    weight = str(el.get("fontWeight") or "500")
    lh = float(el.get("lineHeight") or 1.2)
    while px >= min_px:
        if alto_texto(texto, weight, px, w, lh) <= h:
            return px, texto, False
        px = round(px - 0.25, 2)
    px = min_px
    frases = re.split(r"(?<=\.)\s+", texto)
    while len(frases) > 1:
        frases.pop()
        cand = " ".join(frases)
        if alto_texto(cand, weight, px, w, lh) <= h:
            return px, cand, True
    return px, texto, True


def ajustar_una_linea(el: dict, texto: str, min_px: float = 4.0) -> float:
    px = float(el.get("fontSize") or 6)
    w = float(el["width"]) / _COLCHON_AJUSTE
    weight = str(el.get("fontWeight") or "500")
    while px > min_px and _ancho_texto(texto, weight, px) > w:
        px = round(px - 0.25, 2)
    return px


# ══════════════════════════════════════════════════════════════════════════
#  4 · Clonado del master con contenidos nuevos
# ══════════════════════════════════════════════════════════════════════════

def _clasificar_elemento(el: dict) -> str:
    """Rol semántico de cada elemento del master (por textRole o contenido)."""
    rol = el.get("textRole")
    if rol in ("titulo", "subtitulo", "descripcion"):
        return rol
    if el.get("type") != "text":
        src = el.get("src") or ""
        if src.startswith("data:image/svg+xml"):
            try:
                svg = base64.b64decode(src.split(",", 1)[1]).decode("utf-8", "replace")
            except Exception:
                svg = ""
            if "NO" in svg and "GHS" in svg:
                return "ghs"
            if svg.count("<rect") > 20:
                return "barcode"
        return "otro"
    t = (el.get("content") or "").strip().lower()
    if t.startswith("incluye"):
        return "cuchara"
    if t.startswith("cas"):
        return "cas"
    if t.startswith("concentracion") or t.startswith("concentración"):
        return "concentracion"
    if "puede causar" in t or "revise que" in t or "verifique que" in t or t.startswith("• no utilice"):
        return "advertencias"
    if "desarrollado por" in t:
        return "desarrollado"
    if _RE_PESO.match((el.get("content") or "").strip()):
        return "peso"
    return "otro"


_RE_PESO_NOMBRE = re.compile(r"(\d[\d.,]*)\s*(g|kg|mL|ml|Lt|lt|L)\b", re.IGNORECASE)


def ajustar_titulo(el: dict, texto: str) -> float:
    """Título en 1 línea; si a 9px sigue sin caber y la caja da para 2 líneas,
    envuelve en 2 líneas (masters circulares). Devuelve el fontSize final."""
    px = ajustar_una_linea(el, texto, min_px=9.0)
    if _ancho_texto(texto, str(el.get("fontWeight") or "500"), px) <= float(el["width"]) / _COLCHON_AJUSTE:
        return px
    px0 = float(el.get("fontSize") or 6)
    lh = float(el.get("lineHeight") or 1.2)
    if float(el["height"]) >= 2 * px0 * lh * 0.9:
        px2, _, _ = ajustar_multilinea(el, texto, min_px=7.0, alto_util=2 * px0 * lh)
        return px2
    return ajustar_una_linea(el, texto, min_px=6.0)


def construir_plantilla(master: dict, campos: dict, ean: str | None, nombre: str,
                        roles_extra: dict[str, str] | None = None) -> tuple[dict, list[str], set[str]]:
    avisos: list[str] = list(campos.get("avisos") or [])
    modificados: set[str] = set()
    roles_extra = roles_extra or {}
    p = copy.deepcopy(master)
    p["id"] = uuid.uuid4().hex[:12]
    p["nombre"] = nombre
    p["carpeta"] = CARPETA_DESTINO
    p["origen_ai"] = ORIGEN_AI
    p.pop("created_at", None)
    p.pop("updated_at", None)

    if not campos.get("peso"):
        m = _RE_PESO_NOMBRE.search(nombre)
        if m:
            campos["peso"] = f"{m.group(1)} {m.group(2)}"

    # Altura útil de advertencias: sin invadir bloques que estén debajo
    # en la misma columna (p. ej. "Desarrollado por").
    def _rol(el: dict) -> str:
        eid = el.get("id") or ""
        return roles_extra.get(eid) or _clasificar_elemento(el)

    W_px = float((p.get("formato") or master.get("formato") or {}).get("ancho_px") or 0)

    def _encajar_en_lienzo(el: dict) -> None:
        """La caja del master puede ser más ancha que el lienzo: el texto de
        una línea no debe salirse por el borde derecho."""
        if not W_px:
            return
        x = float(el.get("x") or 0)
        w = float(el.get("width") or 0)
        if (el.get("align") or "left") == "center":
            centro = x + w / 2
            if centro <= 4 or centro >= W_px - 4:
                return
            disponible = (2 * min(centro, W_px - centro) - 4) / _COLCHON_AJUSTE
        elif x < 0:
            return
        else:
            disponible = (W_px - x - 2) / _COLCHON_AJUSTE
        peso_f = str(el.get("fontWeight") or "500")
        px = float(el.get("fontSize") or 6)
        while px > 4.0 and _ancho_texto(str(el.get("content") or ""), peso_f, px) > disponible:
            px = round(px - 0.25, 2)
        el["fontSize"] = px

    roles = {(el.get("id") or ""): _rol(el) for el in p.get("elementos", [])}
    alto_adv: float | None = None
    adv_el = next((e for e in p["elementos"] if roles[e.get("id") or ""] == "advertencias"), None)
    if adv_el:
        tope = float(adv_el["y"]) + float(adv_el["height"])
        ax0, ax1 = float(adv_el["x"]), float(adv_el["x"]) + float(adv_el["width"])
        for otro in p["elementos"]:
            if otro is adv_el or otro.get("type") not in ("text", "image"):
                continue
            ox0 = float(otro["x"])
            ox1 = ox0 + float(otro.get("width") or 0)
            solape = min(ax1, ox1) - max(ax0, ox0)
            if solape > 0.3 * (ax1 - ax0) and float(adv_el["y"]) < float(otro["y"]) < tope:
                tope = float(otro["y"])
        alto_adv = tope - float(adv_el["y"]) - 4

    descripcion = campos["descripcion"]
    prefijo = []
    if campos.get("formula"):
        prefijo.append(campos["formula"])
    if campos.get("origen"):
        prefijo.append(campos["origen"])
    if prefijo:
        descripcion = "\n".join(prefijo) + "\n" + descripcion

    for el in p.get("elementos", []):
        rol = _rol(el)
        eid = el.get("id") or ""
        if rol == "__vaciar__":
            el["content"] = ""
            modificados.add(eid)
        elif rol == "titulo":
            el["content"] = campos["titulo"] or nombre
            el["fontSize"] = ajustar_titulo(el, el["content"])
            _encajar_en_lienzo(el)
            modificados.add(eid)
        elif rol == "subtitulo":
            if campos["subtitulo"]:
                el["content"] = campos["subtitulo"]
                el["fontSize"] = ajustar_una_linea(el, el["content"], min_px=4.0)
                _encajar_en_lienzo(el)
                modificados.add(eid)
            else:
                # sin subtítulo en el .ai: usar el descriptor del perfil del
                # producto (mismo criterio que sanear_plantillas_compliance)
                try:
                    from sanear_plantillas_compliance import SUBTITULOS, perfil_de
                    el["content"] = SUBTITULOS[perfil_de(nombre)]
                    el["fontSize"] = ajustar_una_linea(el, el["content"], min_px=4.0)
                    modificados.add(eid)
                except Exception:
                    pass
        elif rol == "descripcion":
            px, texto, truncado = ajustar_multilinea(el, descripcion)
            el["fontSize"] = px
            el["content"] = texto
            modificados.add(eid)
            if truncado:
                avisos.append("descripción recortada para caber")
        elif rol == "cas":
            # Nunca dejar el CAS del master (sería el de otro producto)
            el["content"] = f"CAS: {campos['cas']}" if campos["cas"] else ""
            if campos["cas"]:
                el["fontSize"] = ajustar_una_linea(el, el["content"])
            else:
                avisos.append("sin CAS en el .ai: casilla en blanco")
            modificados.add(eid)
        elif rol == "concentracion":
            if campos["concentracion"]:
                el["content"] = campos["concentracion"].replace(" %", "%")
                el["fontSize"] = ajustar_una_linea(el, el["content"])
                modificados.add(eid)
        elif rol == "cuchara":
            el["content"] = campos["cuchara"]
            if campos["cuchara"]:
                el["fontSize"] = ajustar_una_linea(el, el["content"])
            modificados.add(eid)
        elif rol == "peso":
            el["content"] = campos["peso"] or ""
            modificados.add(eid)
            if not campos["peso"]:
                avisos.append("sin peso legible en el .ai")
        elif rol == "advertencias":
            if campos["advertencias"]:
                px, texto, trunc = ajustar_multilinea(el, campos["advertencias"], min_px=3.2, alto_util=alto_adv)
                el["fontSize"] = px
                el["content"] = texto
                if alto_adv and alto_adv > float(el["height"]):
                    el["height"] = alto_adv
                modificados.add(eid)
                if trunc:
                    avisos.append("advertencias recortadas")
        elif rol == "barcode":
            if ean:
                el["src"] = ean13_svg_data_uri(ean)
                el["visible"] = True
            else:
                el["visible"] = False
                avisos.append("EAN no decodificado: barras ocultas")
        elif rol == "ghs":
            if not campos.get("tiene_no_ghs"):
                avisos.append("revisar pictogramas GHS (el .ai no dice 'NO GHS')")
    return p, avisos, modificados


# ══════════════════════════════════════════════════════════════════════════
#  4b · Verificación estricta de solapamientos entre elementos de contenido
# ══════════════════════════════════════════════════════════════════════════

def _caja_render_elemento(el: dict) -> tuple[float, float, float, float] | None:
    """Caja realmente ocupada por un elemento de contenido (texto envuelto
    con métricas reales; imágenes por su caja). None si no pinta nada."""
    if el.get("visible") is False:
        return None
    if float(el.get("rotation") or 0):
        return None  # caja no alineada a ejes: fuera del chequeo
    t = el.get("type")
    x, y = float(el.get("x") or 0), float(el.get("y") or 0)
    w, h = float(el.get("width") or 0), float(el.get("height") or 0)
    if t == "image":
        return (x, y, x + w, y + h)
    if t == "text":
        contenido = str(el.get("content") or "")
        if not contenido.strip():
            return None
        px = float(el.get("fontSize") or 6)
        weight = str(el.get("fontWeight") or "400")
        lh = float(el.get("lineHeight") or 1.2)
        lineas = envolver(contenido, weight, px, w)
        anchos = [_ancho_texto(ln, weight, px) for ln in lineas if ln]
        if not anchos:
            return None
        aw = max(anchos)
        align = el.get("align") or "left"
        if align == "center":
            x0 = x + (w - aw) / 2
        elif align == "right":
            x0 = x + w - aw
        else:
            x0 = x
        return (x0, y, x0 + aw, y + len(lineas) * px * lh)
    return None


def pares_solapados(p: dict) -> set[frozenset]:
    """Pares de ids de elementos cuyo contenido renderizado se solapa."""
    cajas: list[tuple[str, tuple[float, float, float, float]]] = []
    for el in p.get("elementos", []):
        c = _caja_render_elemento(el)
        if c:
            cajas.append((el.get("id") or "", c))
    pares: set[frozenset] = set()
    for i in range(len(cajas)):
        for j in range(i + 1, len(cajas)):
            id1, (ax0, ay0, ax1, ay1) = cajas[i]
            id2, (bx0, by0, bx1, by1) = cajas[j]
            iw = min(ax1, bx1) - max(ax0, bx0)
            ih = min(ay1, by1) - max(ay0, by0)
            if iw <= 0 or ih <= 0:
                continue
            inter = iw * ih
            a_min = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
            # texto contra texto: umbral estricto (cualquier roce se nota)
            if inter > 0.02 * a_min and inter > 4:
                pares.add(frozenset((id1, id2)))
    return pares


def corregir_solapes(p: dict, base_pares: set[frozenset], modificados: set[str]) -> list[str]:
    """Encoge la fuente de los textos modificados que crean solapes NUEVOS
    respecto al master aprobado. Devuelve los solapes que no pudo resolver."""
    idx = {el.get("id") or "": el for el in p.get("elementos", [])}

    def _nuevos() -> set[frozenset]:
        return {
            par for par in (pares_solapados(p) - base_pares)
            if any(e in modificados for e in par)
        }

    for _ in range(16):
        pendientes = _nuevos()
        if not pendientes:
            return []
        progreso = False
        for par in pendientes:
            for eid in sorted(par):
                el = idx.get(eid)
                if el is not None and el.get("type") == "text" and eid in modificados \
                   and float(el.get("fontSize") or 0) > 3.2:
                    el["fontSize"] = round(float(el["fontSize"]) - 0.25, 2)
                    progreso = True
                    break
        if not progreso:
            break

    problemas = []
    for par in _nuevos():
        etiquetas = []
        for eid in sorted(par):
            el = idx.get(eid) or {}
            desc = (str(el.get("content") or "")[:22] or el.get("type") or "?")
            etiquetas.append(f"{eid[:8]}·{desc}")
        problemas.append("solape nuevo: " + " ⇄ ".join(etiquetas))
    return problemas


# ══════════════════════════════════════════════════════════════════════════
#  5 · Render de verificación (alta fidelidad) + chequeos
# ══════════════════════════════════════════════════════════════════════════

def _cargar_imagen(src: str, w: int, h: int) -> Image.Image | None:
    try:
        if src.startswith("data:image/svg+xml"):
            import cairosvg
            svg = base64.b64decode(src.split(",", 1)[1])
            png = cairosvg.svg2png(bytestring=svg, output_width=max(1, w), output_height=max(1, h))
            return Image.open(io.BytesIO(png)).convert("RGBA")
        if src.startswith("data:"):
            return Image.open(io.BytesIO(base64.b64decode(src.split(",", 1)[1]))).convert("RGBA")
        m = re.match(r"^/(?:app/)?api/etiquetas/recursos-png/archivo/(.+)$", src)
        if m:
            from urllib.parse import unquote
            nombre = unquote(m.group(1))
            for cand in [_RECURSOS_PNG / nombre, *_RECURSOS_PNG.rglob(nombre)]:
                if cand.is_file():
                    return Image.open(cand).convert("RGBA")
        m = re.match(r"^/(?:app/)?api/plantillas-visuales/assets/(.+)$", src)
        if m:
            from app.tools.plantillas_visuales import ruta_asset
            pth = ruta_asset(m.group(1))
            if pth:
                return Image.open(pth).convert("RGBA")
    except Exception:
        return None
    return None


def render_verificacion(p: dict, out_png: Path, escala: int = 3, revisar_ids: set[str] | None = None) -> list[str]:
    """Renderiza como el DOM (Montserrat + wrap + line-height 1.2) y devuelve problemas.

    Los chequeos de desborde solo aplican a `revisar_ids` (elementos cuyo
    contenido cambió); los heredados del master se consideran aprobados.
    """
    problemas: list[str] = []
    fmt = p.get("formato") or {}
    W, H = int(fmt.get("ancho_px") or 800), int(fmt.get("alto_px") or 600)
    img = Image.new("RGB", (W * escala, H * escala), p.get("fondo") or "#ffffff")
    draw = ImageDraw.Draw(img)

    for el in sorted(p.get("elementos", []), key=lambda e: int(e.get("zIndex") or 0)):
        if el.get("visible") is False:
            continue
        tipo = el.get("type")
        x, y = float(el.get("x") or 0), float(el.get("y") or 0)
        w, h = float(el.get("width") or 0), float(el.get("height") or 0)

        revisar = revisar_ids is None or (el.get("id") or "") in revisar_ids
        if revisar and tipo in ("image", "rect") and (x < -3 or y < -3 or x + w > W + 3 or y + h > H + 3):
            problemas.append(f"elemento {el.get('id', '?')[:8]} ({tipo}) fuera del lienzo")

        if tipo == "rect":
            fill = el.get("fill")
            stroke = el.get("stroke")
            sw = float(el.get("strokeWidth") or 0)
            kw = {}
            if fill and str(fill).lower() not in ("transparent", "none"):
                kw["fill"] = fill
            if stroke and sw > 0:
                kw.update(outline=stroke, width=max(1, int(round(sw * escala))))
            if kw:
                draw.rectangle([x * escala, y * escala, (x + w) * escala, (y + h) * escala], **kw)

        elif tipo == "line":
            x2 = float(el.get("x2") or x)
            y2 = float(el.get("y2") or y)
            draw.line(
                [x * escala, y * escala, x2 * escala, y2 * escala],
                fill=el.get("stroke") or "#000",
                width=max(1, int(float(el.get("strokeWidth") or 1) * escala)),
            )

        elif tipo == "text":
            contenido = str(el.get("content") or "")
            if not contenido:
                continue
            px = float(el.get("fontSize") or 6)
            weight = str(el.get("fontWeight") or "400")
            lh = float(el.get("lineHeight") or 1.2)
            align = el.get("align") or "left"
            fnt = _font(weight, px, escala)
            lineas = envolver(contenido, weight, px, w)
            alto = len(lineas) * px * lh
            if revisar and alto > h + px * 0.6:
                problemas.append(
                    f"texto '{contenido[:26]}…' desborda su caja ({alto:.0f}px > {h:.0f}px)"
                )
            cy = y
            for ln in lineas:
                ancho_ln = _ancho_texto(ln, weight, px)
                if align == "center":
                    cx = x + (w - ancho_ln) / 2
                elif align == "right":
                    cx = x + w - ancho_ln
                else:
                    cx = x
                if revisar and (cx < -2 or cx + ancho_ln > W + 2 or cy + px * lh > H + 3):
                    problemas.append(f"texto '{ln[:26]}…' se sale del lienzo")
                draw.text((cx * escala, cy * escala), ln, fill=el.get("color") or "#000", font=fnt)
                cy += px * lh

        elif tipo == "image":
            bw, bh = max(1, int(w * escala)), max(1, int(h * escala))
            piece = _cargar_imagen((el.get("src") or "").strip(), bw, bh)
            if piece is None:
                problemas.append(f"imagen no cargable: {(el.get('src') or '')[:50]}")
                continue
            fit = (el.get("objectFit") or "contain").lower()
            if fit == "fill":
                piece = piece.resize((bw, bh))
                ox, oy = 0, 0
            else:  # contain (default del editor): conserva proporción, centrado
                ratio = min(bw / piece.width, bh / piece.height)
                nw, nh = max(1, int(piece.width * ratio)), max(1, int(piece.height * ratio))
                piece = piece.resize((nw, nh))
                ox, oy = (bw - nw) // 2, (bh - nh) // 2
            img.paste(piece, (int(x * escala) + ox, int(y * escala) + oy), piece)

    out_png.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_png, "PNG")
    return problemas


# ══════════════════════════════════════════════════════════════════════════
#  6 · Orquestación
# ══════════════════════════════════════════════════════════════════════════

def _norm_nombre(n: str) -> str:
    n = unicodedata.normalize("NFKD", n)
    n = "".join(c for c in n if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", n).strip().casefold()


_RE_SUFIJO_ARCHIVO = re.compile(
    r"\b(\d[\d.,]*\s*(?:g|gr|kg|mg|ml|l|lt)\b\.?|kg|lt|gl|a4"
    r"|x?\s*crear\s+codigo(\s+de\s+barras)?|falta\s+codigo.*)\s*$",
    re.IGNORECASE,
)


def titulo_desde_archivo(stem: str) -> str:
    """Título de respaldo cuando el .ai trae el título vectorizado (curvas)."""
    t = re.sub(r"\s+", " ", stem).strip()
    while True:
        t2 = _RE_SUFIJO_ARCHIVO.sub("", t).strip(" -_·")
        if t2 == t or not t2:
            break
        t = t2
    return (t or stem).upper()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--guardar", action="store_true", help="Persistir en plantillas_visuales.json")
    ap.add_argument("--dry-run", action="store_true", help="Solo parsear y renderizar verificación")
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--solo", default="", help="Filtrar archivos por subcadena")
    ap.add_argument("--pngs", default=str(_REPO / "app" / "data" / "verificacion_plantillas_ai"))
    ap.add_argument("--incluir-pdf-dir", action="store_true", help="Incluir PDFs de la subcarpeta PDF/")
    ap.add_argument("--reemplazar", action="store_true",
                    help="Regenerar plantillas ya existentes en la carpeta destino (conserva su id)")
    args = ap.parse_args()

    from app.tools.plantillas_visuales import (
        guardar_plantilla,
        listar_plantillas,
        obtener_plantilla,
    )

    masters_cache: dict[tuple[int, int], dict[str, dict]] = {}
    for fmt_key, variantes in MASTERS.items():
        masters_cache[fmt_key] = {}
        for color, spec in variantes.items():
            m = obtener_plantilla(spec["id"])
            if not m:
                print(f"FALTA master {fmt_key} {color} ({spec['id']})", file=sys.stderr)
                return 1
            masters_cache[fmt_key][color] = m

    todas_previas = listar_plantillas()
    existentes = {_norm_nombre(p["nombre"]) for p in todas_previas}
    # Con --reemplazar, las generadas por este pipeline se regeneran conservando
    # su id — EXCEPTO las plantillas modelo aprobadas del apartado Imprimir.
    # Criterio: marca origen_ai o carpeta legacy "Generadas AI".
    reemplazables: dict[str, str] = {}
    if args.reemplazar:
        for prev in todas_previas:
            es_ai = bool(prev.get("origen_ai")) or (prev.get("carpeta") or "") == "Generadas AI"
            if es_ai and prev["id"] not in APROBADOS_IDS:
                clave = _norm_nombre(prev["nombre"])
                reemplazables[clave] = prev["id"]
                existentes.discard(clave)

    fuentes: list[Path] = sorted(_AI_DIR.glob("*.ai"))
    if args.incluir_pdf_dir:
        ai_stems = {_norm_nombre(f.stem) for f in fuentes}
        fuentes += sorted(
            f for f in (_AI_DIR / "PDF").glob("*.pdf") if _norm_nombre(f.stem) not in ai_stems
        )
    if args.solo:
        fuentes = [f for f in fuentes if args.solo.lower() in f.name.lower()]

    out_dir = Path(args.pngs)
    tmp_dir = out_dir / "_tmp"
    reporte = {"generadas": [], "omitidas": [], "con_avisos": []}
    n_ok = 0

    for f in fuentes:
        nombre = re.sub(r"\s+", " ", f.stem).strip()
        if _norm_nombre(nombre) in existentes:
            motivo = "ya existe plantilla con ese nombre"
            if args.reemplazar:
                motivo = "plantilla modelo aprobada (Imprimir) o no marcada origen_ai: no se toca"
            reporte["omitidas"].append({"archivo": f.name, "motivo": motivo})
            continue
        fmt_key, rotada, destino = resolver_formato(f)
        if not fmt_key:
            t = tam_pagina_mm(f)
            if t and abs(t[0] - t[1]) <= 3 and 50 <= min(t) <= 75:
                motivo = (f"etiqueta circular {t[0]:.0f}x{t[1]:.0f} mm (texto en arco): "
                          "diseñarla a mano en el Studio")
            elif t:
                motivo = f"tamaño {t[0]:.0f}x{t[1]:.0f} mm sin master ni escala afín"
            else:
                motivo = "sin tamaño legible"
            reporte["omitidas"].append({"archivo": f.name, "motivo": motivo})
            continue

        try:
            campos = extraer_campos(f)
            if len(campos["descripcion"]) < 60:
                reporte["omitidas"].append({
                    "archivo": f.name,
                    "motivo": f"extracción pobre (desc={len(campos['descripcion'])} chars)",
                })
                continue

            # Familia fragancias (master 42x50): título = esencia, subtítulo =
            # tipo, como en los modelos LAVANDA / PIÑA aprobados.
            m_frag = re.match(r"fragancia\s+(hidro\w*|lipo\w*)\s+(.+?)(\s+\d.*)?$", nombre, re.I)
            if fmt_key == (42, 50) and m_frag:
                tipo_frag = "HIDROSOLUBLE" if m_frag.group(1).lower().startswith("hidro") else "LIPOSOLUBLE"
                if campos["subtitulo"] and len(campos["subtitulo"]) > 40:
                    campos["descripcion"] = campos["subtitulo"] + " " + campos["descripcion"]
                campos["subtitulo"] = f"FRAGANCIA {tipo_frag}"
                campos["titulo"] = m_frag.group(2).upper()

            color, aviso_color = detectar_color_ai(f, tmp_dir)
            if color not in PALETA:
                # verde/rojo: sin identidad en el Studio — teal si el formato
                # ya lo trae (fragancias); si no, azul corporativo
                sustituto = "teal" if color == "verde" and "teal" in masters_cache[fmt_key] else "azul"
                if aviso_color is None:
                    aviso_color = f"acento {color} sin master en paleta: usa {sustituto}"
                color = sustituto
            master_prep, color_usado, avisos_master = resolver_master(masters_cache, fmt_key, color)
            if aviso_color:
                avisos_master.append(aviso_color)
            if destino:
                escalar_plantilla(master_prep, destino)
                avisos_master.append(
                    f"master {fmt_key[0]}x{fmt_key[1]} escalado a {destino[0]:.0f}x{destino[1]:.0f} mm"
                )
            base_pares = pares_solapados(master_prep)
            roles_extra = MASTERS[fmt_key][color_usado].get("roles") or {}

            ean = decodificar_ean(f, tmp_dir)
            plantilla, avisos, modificados = construir_plantilla(
                master_prep, campos, ean, nombre, roles_extra
            )
            avisos = avisos_master + avisos
            if _norm_nombre(nombre) in reemplazables:
                plantilla["id"] = reemplazables[_norm_nombre(nombre)]
            if rotada:
                avisos.append("el .ai estaba rotado respecto al formato")

            avisos += corregir_solapes(plantilla, base_pares, modificados)

            fmt_dir = f"{plantilla.get('formato', {}).get('ancho_mm', fmt_key[0])}x" \
                      f"{plantilla.get('formato', {}).get('alto_mm', fmt_key[1])}"
            png = out_dir / fmt_dir / (re.sub(r"[^\w\- ]", "_", nombre) + ".png")
            problemas = render_verificacion(plantilla, png, revisar_ids=modificados)
            if problemas:
                avisos += problemas

            if args.guardar and not args.dry_run:
                guardar_plantilla(plantilla)
                existentes.add(_norm_nombre(nombre))

            n_ok += 1
            item = {
                "archivo": f.name, "nombre": nombre,
                "formato": fmt_dir, "color": color,
                "ean": ean or "", "png": str(png), "avisos": avisos,
            }
            reporte["generadas"].append(item)
            if avisos:
                reporte["con_avisos"].append(item)
            print(f"[OK] {nombre}  ({fmt_dir} · {color})  EAN={ean or '—'}  {'⚠ ' + '; '.join(avisos) if avisos else ''}")
        except Exception as e:
            reporte["omitidas"].append({"archivo": f.name, "motivo": f"error: {e}"})
            print(f"[ERR] {f.name}: {e}", file=sys.stderr)

        if args.limite and n_ok >= args.limite:
            break

    # EANs repetidos entre etiquetas generadas: casi seguro un error del .ai original
    from collections import Counter
    conteo_ean = Counter(i["ean"] for i in reporte["generadas"] if i["ean"])
    for item in reporte["generadas"]:
        if item["ean"] and conteo_ean[item["ean"]] > 1:
            aviso = f"EAN {item['ean']} repetido en {conteo_ean[item['ean']]} etiquetas"
            item["avisos"].append(aviso)
            if item not in reporte["con_avisos"]:
                reporte["con_avisos"].append(item)

    out_dir.mkdir(parents=True, exist_ok=True)
    rep_path = out_dir / "reporte.json"
    rep_path.write_text(json.dumps(reporte, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"\nGeneradas: {len(reporte['generadas'])}  ·  Con avisos: {len(reporte['con_avisos'])}"
        f"  ·  Omitidas: {len(reporte['omitidas'])}\nReporte: {rep_path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
