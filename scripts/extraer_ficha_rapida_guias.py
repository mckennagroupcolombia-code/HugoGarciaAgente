#!/usr/bin/env python3
"""
Extrae, SIN IA, los datos estructurados que la "guia viva" (Fase 2 del plan
UX de sep-2026) necesita para sus modulos interactivos, a partir del HTML de
las secciones de PAGINA_WEB/site/data/guias.json. Escribe el resultado en el
campo `viva` de cada guia:

  viva.concentraciones[]   filas de la tabla "Concentraciones de uso":
                           {aplicacion, min_pct, max_pct, tipo}
  viva.conc_max_pct        el mayor max_pct de la tabla (tope del dosificador)
  viva.conc_nota           parrafo debajo de la tabla (limite legal, fuente)
  viva.ph                  {min, max} solo si el texto dice un rango de pH
  viva.temp_max_c          temperatura que la guia pide no superar
  viva.datos               pares "Estado / Solubilidad / INCI / ..." de la
                           descripcion tecnica
  viva.compatibles[]       {n, nota}   } de "Compatibilidad e incompatibilidades"
  viva.incompatibles[]     {n, nota}   } (lista o prosa, segun venga)
  viva.compat_texto        prosa de compatibilidad cuando no es lista
  viva.incorporacion[]     {n, texto, temp_c?, fase?} de la lista ordenada
  viva.almacenamiento      {temp_min_c?, temp_max_c?, luz, hermetico, humedad, texto}
  viva.faq[]               {q, a}
  viva.normativa           parrafo de normativa (texto plano)
  viva.faltan[]            que no se pudo extraer (la plantilla omite ese modulo)
  viva.extraido            fecha ISO de la corrida

Regla: si un dato no aparece de forma explicita, NO se inventa; el modulo
correspondiente simplemente no se muestra y el texto original sigue abajo.
Lo que un humano corrija a mano se conserva si `viva.manual` es true.

Por defecto `--dry-run` (solo reporte). `--confirmar` escribe guias.json y
deja copia .bak con fecha.

Uso:
  python3 scripts/extraer_ficha_rapida_guias.py
  python3 scripts/extraer_ficha_rapida_guias.py --confirmar
  python3 scripts/extraer_ficha_rapida_guias.py --slug acido-kojico --json
"""

from __future__ import annotations

import argparse
import html as htmlmod
import json
import re
import shutil
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GUIAS_JSON = REPO / "PAGINA_WEB" / "site" / "data" / "guias.json"

NUM = r"(\d+(?:[.,]\d+)?)"
RANGO = re.compile(NUM + r"\s*%?\s*(?:[–—-]|a|hasta)\s*" + NUM + r"\s*%")
UNICO = re.compile(r"(?:≤|<=|hasta|max(?:imo)?\.?|maximo)\s*" + NUM + r"\s*%|" + NUM + r"\s*%")
TEMP = re.compile(NUM + r"\s*°?\s*C\b")


def sin_tildes(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn")


def texto_plano(h: str) -> str:
    """HTML -> texto (conserva saltos entre bloques para poder partir)."""
    h = re.sub(r"</(p|li|tr|div|h\d)>", "\n", h or "")
    h = re.sub(r"<br\s*/?>", "\n", h)
    h = re.sub(r"<[^>]+>", " ", h)
    h = htmlmod.unescape(h)
    h = h.replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", h).strip()


def num(s: str) -> float:
    return float(s.replace(",", "."))


def seccion(g: dict, clave: str) -> str:
    for s in g.get("secciones") or []:
        if clave in sin_tildes(s.get("titulo", "")).lower():
            return s.get("contenido") or ""
    return ""


# ── Concentraciones ─────────────────────────────────────────────────────────

def parse_concentraciones(h: str) -> tuple[list[dict], str]:
    filas = []
    for tr in re.findall(r"<tr>(.*?)</tr>", h, re.S):
        celdas = [texto_plano(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(celdas) < 2:
            continue
        aplicacion, conc = celdas[0], celdas[1]
        tipo = celdas[2] if len(celdas) > 2 else ""
        c = sin_tildes(conc).lower().replace("hasta", "-")
        m = RANGO.search(c)
        if m:
            lo, hi = num(m.group(1)), num(m.group(2))
        else:
            todos = re.findall(NUM + r"\s*%", c)
            if not todos:
                continue
            vals = [num(v) for v in todos]
            lo, hi = min(vals), max(vals)
        if hi > 100 or lo > hi:
            continue
        filas.append({"aplicacion": aplicacion, "min_pct": lo, "max_pct": hi, "tipo": tipo})
    # nota: parrafos fuera de la tabla
    sin_tabla = re.sub(r"<table.*?</table>", " ", h, flags=re.S)
    nota = texto_plano(sin_tabla)
    return filas, nota


# ── pH / temperatura ────────────────────────────────────────────────────────

def parse_ph(texto: str) -> dict | None:
    t = sin_tildes(texto)
    m = re.search(r"pH[^.\n]{0,40}?" + NUM + r"\s*(?:[–—-]|a|y)\s*" + NUM, t)
    if not m:
        return None
    lo, hi = num(m.group(1)), num(m.group(2))
    if 0 <= lo < hi <= 14:
        return {"min": lo, "max": hi}
    return None


def parse_temp_max(texto: str) -> int | None:
    t = sin_tildes(texto)
    pats = [
        r"temperaturas?\s*(?:>|superiores? a|mayores? a|por encima de)\s*" + NUM + r"\s*°?\s*C",
        r"no (?:superar|exceder)\s*(?:los\s*)?" + NUM + r"\s*°?\s*C",
        r"(?:≤|<=|inferior a|por debajo de|maximo de)\s*" + NUM + r"\s*°?\s*C",
    ]
    for p in pats:
        m = re.search(p, t, re.I)
        if m:
            v = int(round(num(m.group(1))))
            if 20 <= v <= 120:
                return v
    return None


# ── Descripcion: pares clave/valor ──────────────────────────────────────────

def parse_datos(h: str) -> list[dict]:
    datos = []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", h, re.S):
        m = re.match(r"\s*<strong>(.*?)</strong>\s*:?\s*(.*)", li, re.S)
        if not m:
            continue
        k = texto_plano(m.group(1)).rstrip(":").strip()
        v = texto_plano(m.group(2)).strip()
        if k and v and len(k) <= 40:
            datos.append({"k": k, "v": v})
    return datos[:8]


# ── Compatibilidad ──────────────────────────────────────────────────────────

def _lista_de(texto: str) -> list[dict]:
    """'a, b (nota), c y d.' -> [{n, nota}]"""
    texto = texto.strip().rstrip(".")
    # Se parte por comas y por " y " solo cuando lo que sigue es una palabra
    # completa (no un simbolo quimico como "Cu" ni algo entre parentesis):
    # "iones de Fe y Cu (catalizan...)" es UN item, "luz UV y temperaturas" son dos.
    partes = re.split(r",\s*|\s+y\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}\b)(?![^(]*\))", texto)
    out = []
    for p in partes:
        p = p.strip(" .;")
        if not p or len(p) > 90:
            continue
        m = re.match(r"(.*?)\s*\((.*?)\)\s*$", p)
        if m:
            out.append({"n": m.group(1).strip(), "nota": m.group(2).strip()})
        else:
            out.append({"n": p, "nota": ""})
    return out


def parse_compat(h: str) -> tuple[list[dict], list[dict], str]:
    comp, incomp, prosa = [], [], ""
    # Patron A: "Compatible con: a, b, c." / "Incompatible con: x, y."
    t = texto_plano(h)
    mA = re.search(r"Compatible con:\s*(.+)", t)
    mB = re.search(r"Incompatible con:\s*(.+)", t)
    if mA:
        comp = _lista_de(mA.group(1).split("\n")[0])
    if mB:
        incomp = _lista_de(mB.group(1).split("\n")[0])
    # Patron B: "<strong>Incompatibilidades:</strong><ul><li><strong>X:</strong> desc</li>"
    if not incomp:
        bloque = re.split(r"Incompatibilidad", h, maxsplit=1)
        if len(bloque) == 2:
            for li in re.findall(r"<li[^>]*>(.*?)</li>", bloque[1], re.S):
                m = re.match(r"\s*<strong>(.*?)</strong>\s*:?\s*(.*)", li, re.S)
                if m:
                    incomp.append({"n": texto_plano(m.group(1)).rstrip(":"), "nota": texto_plano(m.group(2))[:160]})
                else:
                    tx = texto_plano(li)
                    if tx:
                        incomp.append({"n": tx[:80], "nota": ""})
            if not incomp:
                # prosa de incompatibilidad: primera oracion
                tx = texto_plano(bloque[1])
                tx = re.sub(r"^[^:]{0,30}:\s*", "", tx)
                if tx:
                    incomp = [{"n": s.strip(), "nota": ""} for s in re.split(r"\.\s+", tx)[:4] if 8 < len(s.strip()) < 140]
    if not comp:
        m = re.search(r"Compatibilidad:\s*(.+)", t)
        if m:
            prosa = m.group(1).split("\n")[0].strip()
    return comp, incomp, prosa


# ── Incorporacion ───────────────────────────────────────────────────────────

def parse_incorporacion(h: str) -> list[dict]:
    pasos = []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", h, re.S):
        m = re.match(r"\s*<strong>(.*?)</strong>\s*:?\s*(.*)", li, re.S)
        if m and len(texto_plano(m.group(1))) <= 40:
            n, texto = texto_plano(m.group(1)).rstrip(":"), texto_plano(m.group(2))
        else:
            texto = texto_plano(li)
            palabras = texto.split()
            # titulo corto: el verbo con el que empieza ("Disolver", "Verificar");
            # dos palabras solo si la primera es muy corta ("Pre-disolver el" no, "Ir a" si)
            n = " ".join(palabras[:1] if palabras and len(palabras[0]) > 3 else palabras[:2]).rstrip(",.;:")
        if not texto:
            continue
        paso = {"n": n[:40], "texto": texto}
        mt = TEMP.search(sin_tildes(texto))
        if mt:
            v = num(mt.group(1))
            if 0 < v <= 150:
                paso["temp_c"] = int(round(v))
        mf = re.search(r"fase\s+(acuosa|oleosa|grasa|final|de enfriamiento|activa)", sin_tildes(texto), re.I)
        if mf:
            paso["fase"] = mf.group(1).lower()
        pasos.append(paso)
    return pasos[:8]


# ── Almacenamiento ──────────────────────────────────────────────────────────

def parse_almacenamiento(h: str) -> dict:
    texto = texto_plano(h)
    t = sin_tildes(texto).lower()
    out: dict = {"texto": texto}
    m = re.search(NUM + r"\s*°?\s*c?\s*(?:[–—-]|a|y)\s*" + NUM + r"\s*°\s*c", t)
    if m:
        out["temp_min_c"], out["temp_max_c"] = int(round(num(m.group(1)))), int(round(num(m.group(2))))
    else:
        m = re.search(r"(?:inferior a|por debajo de|maximo|no superior a|menor a)\s*(?:los\s*)?" + NUM + r"\s*°\s*c", t)
        if m:
            out["temp_max_c"] = int(round(num(m.group(1))))
    out["luz"] = bool(re.search(r"luz|oscuro|opaco", t))
    out["hermetico"] = bool(re.search(r"hermetic|bien cerrado", t))
    out["humedad"] = bool(re.search(r"humedad|higroscop|seco", t))
    return out


# ── FAQ ─────────────────────────────────────────────────────────────────────

def parse_faq(h: str) -> list[dict]:
    faq = []
    for item in re.findall(r"<div class=['\"]faq-item['\"][^>]*>(.*?)</div>", h, re.S):
        mq = re.search(r"<strong>(.*?)</strong>", item, re.S)
        ma = re.search(r"<p[^>]*>(.*?)</p>", item, re.S)
        if mq and ma:
            faq.append({"q": texto_plano(mq.group(1)), "a": texto_plano(ma.group(1))})
    return faq[:8]


# ── Guia completa ───────────────────────────────────────────────────────────

def extraer(g: dict) -> dict:
    todo = " ".join(texto_plano(s.get("contenido", "")) for s in g.get("secciones") or [])
    filas, nota = parse_concentraciones(seccion(g, "concentr"))
    comp, incomp, prosa = parse_compat(seccion(g, "compat"))
    viva: dict = {
        "extraido": datetime.now().strftime("%Y-%m-%d"),
        "concentraciones": filas,
        "conc_max_pct": max((f["max_pct"] for f in filas), default=None),
        "conc_nota": nota[:400],
        "ph": parse_ph(todo),
        "temp_max_c": parse_temp_max(texto_plano(seccion(g, "compat")) + " " + texto_plano(seccion(g, "incorpor"))),
        "datos": parse_datos(seccion(g, "descrip")),
        "compatibles": comp,
        "incompatibles": incomp,
        "compat_texto": prosa[:500],
        "incorporacion": parse_incorporacion(seccion(g, "incorpor")),
        "almacenamiento": parse_almacenamiento(seccion(g, "almacen")),
        "faq": parse_faq(seccion(g, "frecuentes")),
        "normativa": texto_plano(seccion(g, "normativa"))[:600],
    }
    faltan = []
    if not viva["concentraciones"]:
        faltan.append("concentraciones")
    if not viva["ph"]:
        faltan.append("ph")
    if not viva["temp_max_c"]:
        faltan.append("temp_max_c")
    if not viva["compatibles"] and not viva["compat_texto"]:
        faltan.append("compatibles")
    if not viva["incompatibles"]:
        faltan.append("incompatibles")
    if not viva["incorporacion"]:
        faltan.append("incorporacion")
    if not viva["faq"]:
        faltan.append("faq")
    viva["faltan"] = faltan
    return viva


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--confirmar", action="store_true", help="escribe guias.json (por defecto solo reporta)")
    ap.add_argument("--slug", help="solo esta guia")
    ap.add_argument("--json", action="store_true", help="imprime el resultado en JSON")
    args = ap.parse_args()

    guias = json.loads(GUIAS_JSON.read_text(encoding="utf-8"))
    cobertura: dict[str, int] = {}
    salida = []
    for g in guias:
        if args.slug and g.get("slug") != args.slug:
            continue
        previo = g.get("viva") or {}
        if previo.get("manual"):
            viva = previo
        else:
            viva = extraer(g)
        g["viva"] = viva
        for k in ("concentraciones", "ph", "temp_max_c", "compatibles", "incompatibles", "incorporacion", "faq"):
            if k not in viva.get("faltan", []):
                cobertura[k] = cobertura.get(k, 0) + 1
        salida.append({"slug": g.get("slug"), "faltan": viva.get("faltan", []), "conc_max_pct": viva.get("conc_max_pct"), "ph": viva.get("ph"), "temp_max_c": viva.get("temp_max_c")})

    n = len(salida)
    if args.json:
        print(json.dumps(salida if not args.slug else [g for g in guias if g.get("slug") == args.slug][0]["viva"], ensure_ascii=False, indent=1))
    else:
        print(f"Guias procesadas: {n}")
        for k, v in cobertura.items():
            print(f"  {k:16s} {v:3d}/{n}")
        for s in salida:
            if s["faltan"]:
                print(f"  [{s['slug']}] faltan: {', '.join(s['faltan'])}")

    if not args.confirmar:
        print("\nModo simulacion: no se escribio nada. Usa --confirmar para guardar.")
        return 0
    bak = GUIAS_JSON.with_suffix(f".json.bak_{datetime.now():%Y%m%d%H%M%S}")
    shutil.copy2(GUIAS_JSON, bak)
    GUIAS_JSON.write_text(json.dumps(guias, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nEscrito {GUIAS_JSON} (copia previa en {bak.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
