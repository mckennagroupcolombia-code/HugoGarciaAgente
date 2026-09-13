#!/usr/bin/env python3
"""
Genera artículos del blog científico de mckennagroup.co a partir de literatura
real y verificable (sep-2026).

**Fuentes.** Solo PubMed vía E-utilities de la NCBI (API pública, gratuita, sin
clave). Cada cita se verifica contra `esummary` antes de escribirla: título,
revista, año, autores y DOI salen de la respuesta oficial, no del modelo. Si el
modelo menciona un estudio que no está en esa lista, el artículo se descarta.
Así ninguna bibliografía puede quedar inventada.

No se usan repositorios que redistribuyen artículos de pago sin licencia
(Sci-Hub y los asistentes construidos sobre él): el contenido publicado cita
enlaces que el lector puede abrir de forma legítima.

**Presupuesto.** Toda llamada pasa por `app/services/llm_budget.py`
(`permitir_llamada` antes, `registrar_llamada` después con tokens reales). Un
lote de más de ~25 llamadas o US$1 exige `--autorizar-gasto-usd N`, según la
regla del repositorio.

**Enlaces internos.** Cada artículo cierra con el producto en la tienda y su
guía viva cuando existe (mismo cruce por palabras clave que usa la ficha de
producto), para que el blog lleve al catálogo y no sea contenido suelto.

Uso:
  python3 scripts/generar_articulos_blog.py --listar
  python3 scripts/generar_articulos_blog.py --tema glicerina          # prueba, no escribe
  python3 scripts/generar_articulos_blog.py --tema glicerina --confirmar
  python3 scripts/generar_articulos_blog.py --todos --autorizar-gasto-usd 0.5 --confirmar
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
import unicodedata
from datetime import date, datetime
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parents[1]
SITE = REPO / "PAGINA_WEB" / "site"
POSTS_JSON = SITE / "data" / "posts.json"
for p in (str(REPO), str(SITE)):
    if p not in sys.path:
        sys.path.insert(0, p)

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def _ncbi(endpoint: str, params: dict, intentos: int = 3):
    """GET a E-utilities con reintento: la NCBI corta conexiones sin aviso y una
    consulta perdida dejaba el tema entero sin evidencia."""
    ultimo = None
    for i in range(intentos):
        try:
            r = requests.get(f"{EUTILS}/{endpoint}", params=params, timeout=30)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"NCBI {endpoint} sin respuesta: {ultimo}")
MODELO = "gemini-2.5-pro"
CONTEXTO_LLM = "blog_articulos"

# Temas: (slug, tema visible, consulta PubMed, producto de la tienda para enlazar).
# Elegidos por hueco real: productos que se venden y que aún no tienen artículo.
TEMAS: list[dict] = [
    {"slug": "glicerina-vegetal-humectante-concentracion", "tema": "Glicerina vegetal",
     "query": "glycerol humectant stratum corneum hydration concentration skin",
     "producto": "Glicerina vegetal",
     "angulo": "por qué la concentración cambia el efecto: humectante por debajo del 10 %, sensación pegajosa y efecto osmótico por encima"},
    {"slug": "conservantes-cosmeticos-sistema-amplio-espectro", "tema": "Conservación cosmética",
     "query": "cosmetic preservative challenge test efficacy",
     "producto": "Sharomix 705",
     "angulo": "qué exige un sistema conservante de amplio espectro y por qué el pH decide si funciona"},
    {"slug": "citrato-de-potasio-electrolitos-evidencia", "tema": "Citrato de potasio",
     "query": "potassium citrate supplementation urinary citrate randomized",
     "producto": "Citrato de potasio",
     "angulo": "qué respalda la evidencia sobre citrato de potasio y qué no"},
    {"slug": "lanolina-barrera-cutanea-evidencia", "tema": "Lanolina",
     "query": "lanolin skin",
     "producto": "Lanolina",
     "angulo": "oclusión frente a emoliencia y el mito de la alergia a la lanolina"},
    {"slug": "dexpantenol-reparacion-cutanea", "tema": "D-Pantenol",
     "query": "dexpanthenol skin",
     "producto": "D Pantenol",
     "angulo": "qué muestran los ensayos sobre reparación de barrera y a qué concentración"},
    {"slug": "manteca-karite-composicion-insaponificable", "tema": "Manteca de karité",
     "query": "shea butter skin",
     "producto": "Manteca Karite",
     "angulo": "la fracción insaponificable y por qué el refinado cambia el producto"},
    {"slug": "aceite-arbol-te-actividad-antimicrobiana", "tema": "Aceite esencial de árbol de té",
     "query": "tea tree oil acne",
     "producto": "Aceite esencial de árbol de té",
     "angulo": "terpinen-4-ol, concentraciones seguras y el problema de la oxidación"},
    {"slug": "acido-citrico-ajuste-ph-formulacion", "tema": "Ácido cítrico",
     "query": "citric acid alpha hydroxy acid skin",
     "producto": "Ácido cítrico",
     "angulo": "ajustar el pH sin romper la fórmula: quelación, sistema tampón y compatibilidad"},
]

PROMPT = """Eres el redactor científico de McKenna Group S.A.S., proveedor colombiano de materias primas
farmacéuticas y cosméticas. Escribe un artículo en español para su blog técnico.

TEMA: {tema}
ÁNGULO: {angulo}

Debes apoyarte ÚNICAMENTE en estos estudios reales de PubMed. No inventes ni menciones ningún otro
estudio, autor, cifra o revista que no aparezca aquí:

{evidencia}

REGLAS ESTRICTAS
1. Cita los estudios por el apellido del primer autor y el año, exactamente como figuran arriba.
   Si un dato no está en los resúmenes, no lo escribas.
2. Público: formuladores, laboratorios pequeños y emprendedores cosméticos de Colombia. Tono técnico,
   claro y directo, sin adornos ni frases de relleno.
3. McKenna vende MATERIA PRIMA reenvasada, no productos terminados ni suplementos. Está PROHIBIDO
   afirmar que algo cura, trata, previene o diagnostica enfermedades. Nada de lenguaje terapéutico ni
   de promesas de resultados.
4. Cuando la evidencia sea débil, contradictoria o preliminar, dilo con esas palabras.
5. Extensión: entre 700 y 900 palabras.

FORMATO DE SALIDA: solo HTML, sin ```html, sin <html> ni <body>. Usa exactamente esta estructura:
<h2>{titulo_sugerido}</h2>
<p>entrada de 2 o 3 frases que plantee la pregunta práctica</p>
<h2>Qué dice la evidencia</h2>
<p>...</p>
<h2>Lo que significa al formular</h2>
<p>...</p>
<ul><li>recomendaciones concretas de uso, concentración o compatibilidad</li></ul>
<h2>Lo que todavía no está resuelto</h2>
<p>...</p>
"""


# ── utilidades ──────────────────────────────────────────────────────────────

def norm(t: str) -> str:
    t = "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]", " ", t.lower())


def texto(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


# ── PubMed con citas verificadas ────────────────────────────────────────────

def buscar_evidencia(query: str, n: int = 5) -> list[dict]:
    """PMIDs por relevancia, resumen de cada uno y metadatos verificados contra
    `esummary` (título, revista, año, primer autor, DOI). Devuelve solo los que
    traen resumen: sin resumen no hay nada que sintetizar."""
    r = _ncbi("esearch.fcgi", {
        "db": "pubmed", "term": query, "retmax": n * 3, "sort": "relevance", "retmode": "json"})
    ids = r.json().get("esearchresult", {}).get("idlist", [])
    if not ids:
        return []
    time.sleep(0.4)  # NCBI: 3 peticiones/segundo sin clave
    xml = _ncbi("efetch.fcgi", {
        "db": "pubmed", "id": ",".join(ids), "retmode": "xml", "rettype": "abstract"}).text
    time.sleep(0.4)
    resumen = _ncbi("esummary.fcgi", {
        "db": "pubmed", "id": ",".join(ids), "retmode": "json"}).json().get("result", {})

    abstracts: dict[str, str] = {}
    for bloque in re.findall(r"<PubmedArticle>(.*?)</PubmedArticle>", xml, re.S):
        m = re.search(r"<PMID[^>]*>(\d+)</PMID>", bloque)
        if not m:
            continue
        partes = re.findall(r"<AbstractText[^>]*>(.*?)</AbstractText>", bloque, re.S)
        abstracts[m.group(1)] = texto(" ".join(partes))

    out: list[dict] = []
    for pmid in ids:
        meta = resumen.get(pmid) or {}
        ab = abstracts.get(pmid, "")
        if not meta or len(ab) < 220:
            continue
        autores = meta.get("authors") or []
        primero = (autores[0].get("name") if autores else "") or "Autores varios"
        apellido = primero.split()[0] if primero else "Autores"
        doi = ""
        for aid in meta.get("articleids") or []:
            if aid.get("idtype") == "doi":
                doi = aid.get("value") or ""
        out.append({
            "pmid": pmid,
            "titulo": (meta.get("title") or "").rstrip("."),
            "revista": meta.get("fulljournalname") or meta.get("source") or "",
            "anio": (meta.get("pubdate") or "")[:4],
            "autor": apellido,
            "doi": doi,
            "abstract": ab[:1600],
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        })
        if len(out) >= n:
            break
    return out


def bloque_evidencia(refs: list[dict]) -> str:
    return "\n\n".join(
        f"[{i}] {r['autor']} et al. ({r['anio']}), {r['revista']}\n"
        f"Título: {r['titulo']}\nResumen: {r['abstract']}"
        for i, r in enumerate(refs, 1)
    )


def citas_inventadas(html: str, refs: list[dict]) -> list[str]:
    """Apellido + año citados en el texto que no estén en la evidencia real.
    Acepta apellidos compuestos: PubMed devuelve "Hara-Chikuma" y el modelo
    puede citar "Chikuma"; ambas partes valen para el mismo año."""
    validos: set[tuple[str, str]] = set()
    for r in refs:
        for parte in re.split(r"[-\s]+", r["autor"]):
            if len(parte) > 2:
                validos.add((parte.lower(), r["anio"]))
    fuera = []
    for apellido, anio in re.findall(r"([A-ZÁÉÍÓÚÑ][a-záéíóúñ-]{2,})\s+(?:et\s+al\.?|y\s+cols\.?)[^()]{0,12}\((\d{4})\)", texto(html)):
        clave = apellido.lower().rstrip("-")
        if not any((p, anio) in validos for p in re.split(r"-", clave) + [clave]):
            fuera.append(f"{apellido} ({anio})")
    return sorted(set(fuera))


# ── enlaces internos ────────────────────────────────────────────────────────

def enlaces_internos(producto: str) -> dict:
    """Producto de la tienda y guía viva, con el mismo cruce por palabras clave
    que usa la ficha de producto (website.buscar_contenido_relacionado)."""
    import website

    salida = {"producto": None, "guia": None}
    claves = [w for w in norm(producto).split() if len(w) > 3]
    familia = None
    for p in website.get_all_products():
        if not claves or not all(w in norm(p.get("name") or "") for w in claves):
            continue
        if p.get("is_family"):
            # la ficha de familia muestra todas las presentaciones: sirve igual
            familia = familia or p
            continue
        if p.get("buyable", True):
            salida["producto"] = {"name": p.get("name"), "slug": p.get("slug"), "precio": p.get("precio")}
            break
    if not salida["producto"] and familia:
        salida["producto"] = {"name": familia.get("name"), "slug": familia.get("slug"),
                              "precio": familia.get("precio")}
    rel = website.buscar_contenido_relacionado(producto)
    if rel["guias"]:
        salida["guia"] = rel["guias"][0]
    return salida


def html_final(cuerpo: str, refs: list[dict], enl: dict, producto: str) -> str:
    partes = [cuerpo.strip()]
    if enl.get("producto") or enl.get("guia"):
        li = []
        if enl.get("producto"):
            pr = enl["producto"]
            li.append(f'<li><a href="/producto/{pr["slug"]}">{pr["name"]}</a> en la tienda'
                      + (f' · {pr["precio"]}' if pr.get("precio") else "") + "</li>")
        if enl.get("guia"):
            li.append(f'<li><a href="{enl["guia"]["url"]}">Guía viva de {enl["guia"]["titulo"]}</a>'
                      " con dosificador, pH de trabajo y compatibilidad</li>")
        partes.append("<h2>Dónde seguir</h2>\n<ul>\n" + "\n".join(li) + "\n</ul>")
    bib = "\n".join(
        f'<li>{r["autor"]} et al. ({r["anio"]}). <em>{r["titulo"]}</em>. {r["revista"]}. '
        f'<a href="{r["url"]}" target="_blank" rel="noopener">PubMed {r["pmid"]}</a>'
        + (f' · <a href="https://doi.org/{r["doi"]}" target="_blank" rel="noopener">DOI</a>' if r["doi"] else "")
        + "</li>"
        for r in refs
    )
    partes.append("<h2>Bibliografía</h2>\n<ol>\n" + bib + "\n</ol>")
    partes.append('<p class="post-nota"><small>McKenna Group S.A.S. suministra materias primas. '
                  "Este artículo es información técnica para formuladores y no constituye consejo médico "
                  "ni afirma que el ingrediente cure, trate o prevenga enfermedad alguna.</small></p>")
    return "\n\n".join(partes)


# ── generación ──────────────────────────────────────────────────────────────

def generar(t: dict, *, verbose: bool = True) -> dict:
    from app.services import llm_budget as lb

    refs = buscar_evidencia(t["query"])
    if len(refs) < 3:
        return {"ok": False, "slug": t["slug"],
                "motivo": f"solo {len(refs)} estudios con resumen en PubMed "
                          f"(revisar la consulta: «{t['query']}»)"}
    if verbose:
        for r in refs:
            print(f"    · {r['autor']} ({r['anio']}) {r['titulo'][:62]}")

    ok, motivo = lb.permitir_llamada(MODELO, contexto=CONTEXTO_LLM)
    if not ok:
        return {"ok": False, "motivo": f"presupuesto: {motivo}", "slug": t["slug"]}

    from google import genai

    import os
    cliente = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    prompt = PROMPT.format(tema=t["tema"], angulo=t["angulo"],
                           evidencia=bloque_evidencia(refs), titulo_sugerido=t["tema"])
    t0 = time.time()
    resp = cliente.models.generate_content(model=MODELO, contents=prompt)
    ent, sal = lb.usage_gemini(resp)
    lb.registrar_llamada(MODELO, ent, sal, contexto=CONTEXTO_LLM)
    cuerpo = re.sub(r"^```(?:html)?|```$", "", (resp.text or "").strip(), flags=re.M).strip()
    if verbose:
        print(f"    LLM {time.time() - t0:.0f}s · {ent}+{sal} tokens · US$ {lb.costo_usd(MODELO, ent, sal):.4f}")

    palabras = len(texto(cuerpo).split())
    if palabras < 450:
        return {"ok": False, "motivo": f"texto corto ({palabras} palabras)", "slug": t["slug"]}
    inventadas = citas_inventadas(cuerpo, refs)
    if inventadas:
        return {"ok": False, "motivo": f"citas fuera de la evidencia: {', '.join(inventadas)}", "slug": t["slug"]}

    enl = enlaces_internos(t["producto"])
    contenido = html_final(cuerpo, refs, enl, t["producto"])
    m = re.search(r"<h2[^>]*>(.*?)</h2>", cuerpo, re.S)
    titulo = texto(m.group(1)) if m else t["tema"]
    cuerpo_txt = texto(cuerpo)
    extracto = cuerpo_txt[len(titulo):].lstrip(" :.-–") if cuerpo_txt.startswith(titulo) else cuerpo_txt
    return {
        "ok": True, "slug": t["slug"], "titulo": titulo[:120], "tema": t["tema"],
        "extracto": extracto[:220], "contenido": contenido, "refs": refs,
        "enlaces": enl, "palabras": palabras,
    }


def guardar(articulos: list[dict]) -> int:
    posts = json.loads(POSTS_JSON.read_text(encoding="utf-8"))
    por_slug = {p["slug"]: p for p in posts}
    siguiente = max((int(p.get("id") or 0) for p in posts), default=0) + 1
    hoy = date.today().isoformat()
    nuevos = 0
    for a in articulos:
        if not a.get("ok"):
            continue
        entrada = {
            "id": por_slug[a["slug"]]["id"] if a["slug"] in por_slug else siguiente,
            "slug": a["slug"], "titulo": a["titulo"], "categoria": "blog",
            "fecha": hoy, "tema": a["tema"], "extracto": a["extracto"],
            "contenido": a["contenido"], "publicado": True,
        }
        if a["slug"] in por_slug:
            posts[posts.index(por_slug[a["slug"]])] = entrada
        else:
            posts.append(entrada)
            siguiente += 1
        nuevos += 1
    bak = POSTS_JSON.with_suffix(f".json.bak_{datetime.now():%Y%m%d%H%M%S}")
    shutil.copy2(POSTS_JSON, bak)
    POSTS_JSON.write_text(json.dumps(posts, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nEscritos {nuevos} artículos en {POSTS_JSON.name} (copia previa: {bak.name})")
    return nuevos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tema", help="genera solo el tema cuyo slug o nombre contenga este texto")
    ap.add_argument("--todos", action="store_true", help="genera todos los temas pendientes")
    ap.add_argument("--listar", action="store_true", help="muestra los temas y si ya tienen artículo")
    ap.add_argument("--confirmar", action="store_true", help="escribe en posts.json (por defecto no escribe)")
    ap.add_argument("--autorizar-gasto-usd", type=float, default=0.0, help="autoriza el lote hasta N dólares")
    a = ap.parse_args()

    existentes = {p["slug"] for p in json.loads(POSTS_JSON.read_text(encoding="utf-8"))}
    if a.listar:
        for t in TEMAS:
            print(f"  [{'ya publicado' if t['slug'] in existentes else '  pendiente '}] {t['tema']:34s} · {t['slug']}")
        return 0

    if a.tema:
        clave = norm(a.tema)
        pendientes = [t for t in TEMAS if clave in norm(t["slug"]) or clave in norm(t["tema"])]
    elif a.todos:
        pendientes = [t for t in TEMAS if t["slug"] not in existentes]
    else:
        ap.error("indica --tema, --todos o --listar")

    if not pendientes:
        print("No hay temas pendientes.")
        return 0

    from app.services import llm_budget as lb

    estimado = len(pendientes) * lb.costo_usd(MODELO, 2400, 4200)  # medido: ~2,2k entrada / ~4,1k salida
    print(f"Temas: {len(pendientes)} · 1 llamada a {MODELO} por artículo · estimado US$ {estimado:.2f}")
    if a.autorizar_gasto_usd > 0:
        lb.autorizar_lote(a.autorizar_gasto_usd, f"blog: {len(pendientes)} artículos")
        print(f"Lote autorizado hasta US$ {a.autorizar_gasto_usd:.2f}")

    resultados = []
    for t in pendientes:
        print(f"\n── {t['tema']} ({t['slug']})")
        try:
            r = generar(t)
        except Exception as e:  # noqa: BLE001
            r = {"ok": False, "slug": t["slug"], "motivo": f"{type(e).__name__}: {e}"}
        resultados.append(r)
        if r.get("ok"):
            enl = r["enlaces"]
            print(f"    ✓ «{r['titulo'][:60]}» · {r['palabras']} palabras · {len(r['refs'])} fuentes")
            print(f"      producto: {(enl.get('producto') or {}).get('name', '—')} | guía: {(enl.get('guia') or {}).get('titulo', '—')}")
        else:
            print(f"    ✗ {r['motivo']}")

    buenos = [r for r in resultados if r.get("ok")]
    # El borrador se guarda siempre: así se puede revisar (o repetir el reporte)
    # sin volver a gastar una llamada al modelo.
    if buenos:
        borradores = REPO / "PAGINA_WEB" / "site" / "data" / "borradores_blog"
        borradores.mkdir(exist_ok=True)
        for r in buenos:
            (borradores / f"{r['slug']}.html").write_text(
                f"<!-- {r['titulo']} · {r['palabras']} palabras · {len(r['refs'])} fuentes -->\n" + r["contenido"],
                encoding="utf-8")
        print(f"Borradores en {borradores.relative_to(REPO)}/")
    print(f"\nGenerados {len(buenos)} de {len(pendientes)}. Gasto del día: US$ {lb.gasto_hoy()['gasto_usd']:.4f}")
    if not a.confirmar:
        print("Modo prueba: no se escribió nada. Agrega --confirmar para publicar.")
        return 0
    guardar(buenos)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
