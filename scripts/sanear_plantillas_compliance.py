#!/usr/bin/env python3
"""
Sanea las plantillas del Studio Visual (app/data/plantillas_visuales.json) para
cumplir COMPLIANCE_MELI.md y el rotulado de materias primas (Res. 5109/2005):

  1. Reemplaza el subtítulo "Materia prima grado farmacológico Ph. Eur. JPC. USP; COA"
     por el descriptor del perfil (alimentario / cosmético / técnico).
  2. Elimina "Fórmula molecular …" y frases con claims de salud de las descripciones,
     y borra los tokens farmacológicos (Ph. Eur., USP, JPC, grado farmacológico).
  3. Añade el pie legal obligatorio ("No es medicamento ni suplemento…", Res. 2674/2013
     Art. 37-3 según perfil) y el bloque LOT./EXP. donde falten.
  4. Verifica desbordes con las mismas métricas del editor (Montserrat + wrap) y ajusta
     la caja o la fuente; deja PNG de verificación cuando queda algún aviso.

Uso:
  python3 scripts/sanear_plantillas_compliance.py            # dry-run (no escribe)
  python3 scripts/sanear_plantillas_compliance.py --guardar
  python3 scripts/sanear_plantillas_compliance.py --guardar --solo "CITRATO"
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

_REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO))
sys.path.insert(0, str(_REPO / "scripts"))

from generar_plantillas_visuales_desde_ai import envolver, render_verificacion  # noqa: E402

PLANTILLAS_PATH = _REPO / "app" / "data" / "plantillas_visuales.json"
OUT_DIR = _REPO / "app" / "data" / "verificacion_plantillas_compliance"

SUBTITULOS = {
    "alimentaria": "Insumo alimentario 100% puro · Res. 2674/2013 Art. 37-3",
    "cosmetico": "Insumo cosmético · Materia prima para formulación",
    "tecnico": "Materia prima técnica para uso industrial",
}
PIES = {
    "alimentaria": "No es medicamento ni suplemento dietario terminado · Uso en formulación",
    "cosmetico": "No es medicamento · Uso exclusivo en formulación cosmética",
    "tecnico": "No es medicamento · Uso industrial, no consumo humano",
}
LINEA_LOTE = "LOT. __________   EXP. __________"

# Palabras que fuerzan perfil (sobre el nombre de la plantilla, normalizado)
KW_TECNICO = [
    "glutaraldehido", "azul de metileno", "verde malaquita", "violeta de genciana",
    "silica", "sulfato de cobre", "sulfato de hierro", "borax", "agua destilada",
    "azufre", "carbon activado",
]
KW_COSMETICO = [
    "arcilla", "btms", "cetilico", "ceto estearilico", "betaina", "lanette",
    "trietanolamina", "vaselina", "salicilico", "azelaico", "tranexamico",
    "arbutina", "mandelico", "kojico", "hialuronico", "alantoina", "niacinamida",
    "pantenol", "urea", "oxido de zinc", "dioxido de titanio", "arbol de te",
    "gusano de seda", "embrion de pato", "sharomix", "melatonina", "mentol",
    "glicerina", "alumbre", "karite", "semilla de uva", "ricino", "neem",
    "agua de rosas", "cera de abejas", "glicolico", "acido lactico", "cocoamida",
    "tensoactivo", "cera carnauba", "aceite esencial",
]

# Señales farmacológicas a borrar como token (sin eliminar la línea completa)
RX_TOKENS = re.compile(
    r"(materia prima\s+)?(vegetal\s+)?grado farmacol[oó]gico|Ph\.?\s*Eur\.?|"
    r"\bUSP\b|\bJPC\b|;?\s*COA\b",
    re.IGNORECASE,
)
RX_FORMULA = re.compile(r"f[oó]rmula molecular", re.IGNORECASE)

# Claims de salud: la frase u oración que los contenga se elimina completa
CLAIMS = [
    "laxante", "estrenimiento", "salud osea", "salud muscular", "cardiovascular",
    "acne", "melasma", "lentigo", "arrugas", "antienvejecimiento", "despigmentante",
    "antiinflamator", "suplemento diet", "dosis recomendada", "porcion diaria",
    "absorbido por el organismo", "absorcion intestinal", "ciclo de krebs",
    "organismo humano", "dialisis", "exfoliante", "magnesio elemental",
    "calcio elemental", "zinc elemental", "potasio elemental", "hierro elemental",
]
# "tratamiento" solo cuenta como claim en contexto corporal
KW_CUERPO = ["piel", "cabello", "capilar", "manchas", "dolor", "hongos", "infecc", "estetic"]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def perfil_de(nombre: str) -> str:
    n = norm(nombre)
    if any(k in n for k in KW_TECNICO):
        return "tecnico"
    if any(k in n for k in KW_COSMETICO):
        return "cosmetico"
    # activos en gotero / frascos pequeños → cosmético
    if re.search(r"\b(5|10|30|60|120)\s*m?l\b", n) and "vinagre" not in n:
        return "cosmetico"
    return "alimentaria"


def _es_claim(texto: str) -> bool:
    t = norm(texto)
    if any(c in t for c in CLAIMS):
        return True
    if "tratamiento" in t and any(k in t for k in KW_CUERPO):
        return True
    return False


def _limpiar_linea(linea: str) -> str | None:
    """Devuelve la línea saneada, o None si debe eliminarse completa."""
    if RX_FORMULA.search(linea):
        # eliminar solo la porción "Fórmula molecular: XxYy" si comparte línea
        resto = re.sub(r"f[oó]rmula molecular\s*:?[^.\n]*\.?", "", linea, flags=re.IGNORECASE).strip()
        if not resto:
            return None
        linea = resto
    es_bullet = bool(re.match(r"^\s*[•·\-\*✔✓]", linea))
    if _es_claim(linea):
        if es_bullet:
            return None
        # frase por frase
        frases = re.split(r"(?<=[.;])\s+", linea)
        buenas = [f for f in frases if f.strip() and not _es_claim(f)]
        if not buenas:
            return None
        linea = " ".join(buenas)
    linea = RX_TOKENS.sub("", linea)
    linea = re.sub(r"\s{2,}", " ", linea)
    linea = re.sub(r"^[\s.;,:]+$", "", linea)
    return linea.rstrip()


def limpiar_contenido(contenido: str) -> str:
    lineas_out: list[str] = []
    for linea in contenido.split("\n"):
        if not linea.strip():
            lineas_out.append("")
            continue
        nueva = _limpiar_linea(linea)
        if nueva is None or not nueva.strip():
            continue
        lineas_out.append(nueva)
    # encabezados huérfanos ("Propiedades:" sin bullets debajo)
    depurado: list[str] = []
    for i, ln in enumerate(lineas_out):
        if re.match(r"^\s*(propiedades|beneficios)\s*:?\s*$", norm(ln)):
            resto = [x for x in lineas_out[i + 1:] if x.strip()]
            if not resto or not re.match(r"^\s*[•·\-\*✔✓]", resto[0]):
                continue
        depurado.append(ln)
    texto = "\n".join(depurado)
    return re.sub(r"\n{3,}", "\n\n", texto).strip()


def _fuente_para_encajar(el: dict, contenido: str, max_reduccion: float = 0.0) -> float | None:
    """Tamaño de fuente (actual o reducido hasta `max_reduccion`) con el que
    `contenido` cabe en la caja ACTUAL del elemento — así el texto nunca invade
    elementos vecinos. None si no cabe."""
    w = float(el.get("width") or 0)
    h = float(el.get("height") or 0)
    lh = float(el.get("lineHeight") or 1.2)
    weight = str(el.get("fontWeight") or "400")
    px_orig = float(el.get("fontSize") or 6)
    px = px_orig
    while px >= px_orig - max_reduccion - 1e-9:
        alto = len(envolver(contenido, weight, px, w)) * px * lh
        if alto <= h + px * 0.5:
            return px
        px -= 0.25
    return None


def procesar(p: dict) -> tuple[list[str], list[str]]:
    """Sanea una plantilla in place. Retorna (ids_cambiados, avisos)."""
    perfil = perfil_de(p.get("nombre") or "")
    fmt = p.get("formato") or {}
    W, H = float(fmt.get("ancho_px") or 800), float(fmt.get("alto_px") or 600)
    cambiados: list[str] = []
    avisos: list[str] = []

    blob = norm("\n".join(
        str(e.get("content") or "") for e in p.get("elementos", []) if e.get("type") == "text"
    ))
    tiene_pie_legal = bool(re.search(r"no es (un )?(medicamento|suplemento)", blob))
    tiene_lote = bool(re.search(r"\blot\b|\bexp\b|venc", blob))

    desc_target: dict | None = None
    mckenna_target: dict | None = None
    for el in p.get("elementos", []):
        if el.get("type") != "text":
            continue
        contenido = str(el.get("content") or "")
        n = norm(contenido)

        if el.get("textRole") == "subtitulo" and ("grado farmacologico" in n or RX_TOKENS.search(contenido)):
            el["content"] = SUBTITULOS[perfil]
            cambiados.append(el.get("id") or "")
            continue

        nuevo = limpiar_contenido(contenido)
        if nuevo != contenido.strip() and nuevo != contenido:
            el["content"] = nuevo
            cambiados.append(el.get("id") or "")

        # candidatos a recibir el pie legal: caja sana (sin rotación, dentro del lienzo)
        x0, w0 = float(el.get("x") or 0), float(el.get("width") or 0)
        y0, h0 = float(el.get("y") or 0), float(el.get("height") or 0)
        caja_sana = (
            not float(el.get("rotation") or 0)
            and x0 >= -2 and x0 + w0 <= W + 2 and y0 + h0 <= H + 2
        )
        if not caja_sana:
            continue
        if el.get("textRole") == "descripcion" and (
            desc_target is None or w0 * h0 > float(desc_target.get("width") or 0) * float(desc_target.get("height") or 0)
        ):
            desc_target = el
        if ("mckenna" in n or "nit" in n) and (
            mckenna_target is None or y0 > float(mckenna_target.get("y") or 0)
        ):
            mckenna_target = el

    pendiente: list[str] = []
    if not tiene_pie_legal:
        pendiente.append(PIES[perfil])
    if not tiene_lote:
        pendiente.append(LINEA_LOTE)

    if pendiente:
        colocado = False
        # 1º dentro de la descripción (permite reducir fuente hasta 0.75pt),
        # 2º bloque McKenna (sin tocar fuente) — solo si cabe en la caja actual
        for target, reduccion in ((desc_target, 0.75), (mckenna_target, 0.0)):
            if target is None:
                continue
            contenido_nuevo = (str(target.get("content") or "").rstrip() + "\n\n" + "\n".join(pendiente)).strip()
            fs = _fuente_para_encajar(target, contenido_nuevo, reduccion)
            if fs is not None:
                target["content"] = contenido_nuevo
                target["fontSize"] = fs
                cambiados.append(target.get("id") or "")
                colocado = True
                break
        if not colocado:
            # No hay sitio limpio: NO se agrega nada (una etiqueta solapada es peor).
            # Queda registrada para añadir el pie legal a mano en el Studio.
            avisos.append(
                f"'{p.get('nombre')}': sin espacio para pie legal/LOT — añadir a mano en el Studio"
            )

    return [c for c in cambiados if c], avisos


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--guardar", action="store_true", help="escribe plantillas_visuales.json (con backup)")
    ap.add_argument("--solo", default="", help="filtra plantillas por subcadena del nombre")
    ap.add_argument("--sin-png", action="store_true", help="no genera PNGs de verificación")
    args = ap.parse_args()

    data = json.loads(PLANTILLAS_PATH.read_text())
    plantillas = data.get("plantillas", [])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    tocadas = 0
    todos_avisos: list[str] = []
    problemas_render: dict[str, list[str]] = {}
    for p in plantillas:
        if args.solo and norm(args.solo) not in norm(p.get("nombre") or ""):
            continue
        if norm(p.get("nombre") or "").startswith("copia de"):
            continue  # borradores del Studio: no tocar
        cambiados, avisos = procesar(p)
        if not cambiados:
            continue
        tocadas += 1
        todos_avisos.extend(avisos)
        if not args.sin_png:
            out_png = OUT_DIR / f"{re.sub(r'[^A-Za-z0-9_-]+', '_', p.get('nombre') or p.get('id'))}.png"
            problemas = render_verificacion(p, out_png, revisar_ids=set(cambiados))
            if problemas:
                problemas_render[p.get("nombre") or p.get("id")] = problemas
            elif not avisos:
                out_png.unlink(missing_ok=True)

    print(f"Plantillas saneadas: {tocadas}/{len(plantillas)}")
    if todos_avisos:
        print(f"\nAvisos ({len(todos_avisos)}):")
        for a in todos_avisos:
            print(f"  - {a}")
    if problemas_render:
        print(f"\nDesbordes tras el saneo ({len(problemas_render)} plantillas, PNG en {OUT_DIR}):")
        for nombre, probs in problemas_render.items():
            print(f"  - {nombre}: {probs}")

    reporte = {
        "fecha": datetime.now().isoformat(timespec="seconds"),
        "saneadas": tocadas,
        "avisos": todos_avisos,
        "desbordes": problemas_render,
    }
    (OUT_DIR / "reporte.json").write_text(json.dumps(reporte, ensure_ascii=False, indent=1))

    if args.guardar:
        backup = PLANTILLAS_PATH.with_name(
            f"plantillas_visuales.pre_compliance_{datetime.now():%Y%m%d_%H%M}.json"
        )
        shutil.copy2(PLANTILLAS_PATH, backup)
        PLANTILLAS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        print(f"\n💾 Guardado. Backup: {backup.name}")
    else:
        print("\n(dry-run: no se escribió nada; usa --guardar)")


if __name__ == "__main__":
    main()
