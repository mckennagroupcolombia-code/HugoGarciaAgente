#!/usr/bin/env python3
"""
Generación masiva de Posts de Blog — McKenna Group
═══════════════════════════════════════════════════
Genera entradas de blog estilo "hallazgo científico" con contraste de estudios,
gráficas inline CSS/SVG y bibliografía PubMed.

Uso:
    source venv/bin/activate
    python3 generar_posts_masivos.py
"""

import os, sys, re, json, time, requests
from datetime import datetime, timedelta
from pathlib import Path

BASE      = Path(__file__).parent
POSTS_JSON = BASE / "PAGINA_WEB/site/data/posts.json"
DOTENV    = BASE / ".env"

for line in DOTENV.read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

from google import genai as google_genai
_client = google_genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

# ─── Temas a generar ──────────────────────────────────────────────────────────
# (slug, titulo, tema_busqueda_pubmed, descripcion)
POSTS_PLAN = [
    (
        "niacinamida-vs-clindamicina-acne",
        "Niacinamida vs Clindamicina: ¿Qué dice la ciencia sobre el acné?",
        "niacinamide acne clindamycin clinical trial",
        "niacinamida, acné, comparativa"
    ),
    (
        "acido-hialuronico-bajo-vs-alto-peso-molecular",
        "Ácido Hialurónico: La batalla del peso molecular que cambia todo",
        "hyaluronic acid low high molecular weight skin penetration",
        "ácido hialurónico, peso molecular, hidratación"
    ),
    (
        "retinol-concentraciones-eficacia",
        "Retinol: ¿Más concentración significa más resultados? La ciencia responde",
        "retinol concentration efficacy skin aging randomized",
        "retinol, antienvejecimiento, concentración"
    ),
    (
        "creatina-mas-alla-del-deporte",
        "Creatina Monohidratada: Nuevos hallazgos van mucho más allá del músculo",
        "creatine supplementation cognitive brain function",
        "creatina, cognición, músculo, cerebro"
    ),
    (
        "alfa-arbutina-vs-acido-kojico-despigmentacion",
        "Alfa-Arbutina vs Ácido Kójico: El duelo de los despigmentantes",
        "alpha arbutin kojic acid skin lightening tyrosinase inhibition",
        "alfa-arbutina, ácido kójico, manchas, despigmentación"
    ),
    (
        "oxido-zinc-vs-filtros-quimicos",
        "Óxido de Zinc contra filtros químicos: ¿Quién protege mejor la piel?",
        "zinc oxide sunscreen chemical filter efficacy safety",
        "óxido de zinc, protector solar, filtros químicos"
    ),
    (
        "colageno-hidrolizado-evidencia-real",
        "Colágeno Hidrolizado: ¿Qué dicen realmente los estudios clínicos?",
        "hydrolyzed collagen skin elasticity randomized placebo",
        "colágeno hidrolizado, piel, articulaciones"
    ),
    (
        "acido-glicolico-vs-lactico",
        "Ácido Glicólico vs Ácido Láctico: Dos AHAs, resultados distintos",
        "glycolic acid lactic acid exfoliation skin comparison",
        "ácido glicólico, ácido láctico, exfoliación"
    ),
    (
        "magnesio-sueno-recuperacion",
        "Citrato de Magnesio y el sueño: La evidencia que sorprende a los científicos",
        "magnesium citrate sleep quality insomnia supplementation",
        "magnesio, sueño, recuperación muscular"
    ),
    (
        "aceite-rosa-mosqueta-cicatrizacion",
        "Aceite de Rosa Mosqueta: Lo que los ensayos clínicos revelan sobre cicatrices",
        "rosehip oil scars skin regeneration clinical",
        "aceite de rosa mosqueta, cicatrización, regeneración"
    ),
    (
        "vitamina-c-estabilizada-eficacia",
        "Vitamina C en cosmética: El problema de la estabilidad que pocos explican",
        "ascorbic acid vitamin C stability cosmetic formulation",
        "vitamina C, ácido ascórbico, estabilidad"
    ),
    (
        "dmso-potenciador-transdermico",
        "DMSO: El vehículo transdérmico más potente y más controversial de la ciencia",
        "DMSO dimethyl sulfoxide transdermal penetration enhancer",
        "DMSO, penetración transdérmica, activos"
    ),
    (
        "acido-salicilico-acne-comedonal",
        "Ácido Salicílico al 2%: 30 años de estudios siguen confirmando su eficacia",
        "salicylic acid 2% acne comedonal treatment study",
        "ácido salicílico, acné, comedones"
    ),
    (
        "l-glutamina-intestino-atletas",
        "L-Glutamina y el intestino permeable: Hallazgos que cambian la suplementación deportiva",
        "glutamine gut permeability athletes leaky gut",
        "L-glutamina, intestino, rendimiento deportivo"
    ),
    (
        "aloe-vera-evidencia-vs-mitos",
        "Aloe Vera: Lo que dice la ciencia versus lo que se cree popularmente",
        "aloe vera clinical evidence wound healing skin",
        "aloe vera, evidencia clínica, quemaduras"
    ),
    (
        "cafeina-topica-celulitis",
        "Cafeína Tópica y Celulitis: ¿Moda pasajera o respaldo científico real?",
        "topical caffeine cellulite adipose tissue fat",
        "cafeína, celulitis, lipolisis"
    ),
    (
        "urea-cosmetica-concentraciones",
        "Urea Cosmética: Qué concentración usar y para qué — la guía de la evidencia",
        "urea cosmetic skin moisturizer concentration keratolytic",
        "urea cosmética, hidratación, queratolítico"
    ),
    (
        "l-arginina-rendimiento-cardiovascular",
        "L-Arginina y el sistema cardiovascular: Meta-análisis que reescribe las recomendaciones",
        "l-arginine nitric oxide cardiovascular blood pressure meta-analysis",
        "L-arginina, óxido nítrico, presión arterial"
    ),
    (
        "acido-azelaico-acne-rosacea",
        "Ácido Azelaico: Un activo que trata acné y rosácea a la vez — ¿cómo es posible?",
        "azelaic acid acne rosacea mechanism clinical",
        "ácido azelaico, acné, rosácea"
    ),
    (
        "aceite-neem-antimicrobiano",
        "Aceite de Neem: La ciencia detrás del insecticida natural más estudiado del mundo",
        "neem oil azadirachtin antimicrobial antifungal",
        "aceite de neem, antimicrobiano, azadiractina"
    ),
    (
        "mentol-cristal-mecanismo-analgesico",
        "Mentol Cristal: Cómo un cristal simple engaña al cerebro para aliviar el dolor",
        "menthol crystal TRPM8 analgesic cooling pain",
        "mentol cristal, analgésico, receptor TRPM8"
    ),
    (
        "betaina-coco-vs-sls-irritacion",
        "Betaína de Coco vs SLS: La diferencia que los formuladores necesitan conocer",
        "cocamidopropyl betaine SLS irritation skin surfactant comparison",
        "betaína de coco, SLS, irritación, tensioactivos"
    ),
    (
        "aceite-ricino-cabello-mito-ciencia",
        "Aceite de Ricino y el cabello: Separando el mito de la evidencia científica real",
        "castor oil hair growth ricinoleic acid scalp",
        "aceite de ricino, cabello, crecimiento"
    ),
    (
        "vitamina-e-antioxidante-piel",
        "Vitamina E: Más que un antioxidante — su rol oculto en la absorción de activos",
        "vitamin E tocopherol skin antioxidant transdermal absorption",
        "vitamina E, tocoferol, antioxidante, piel"
    ),
    (
        "acido-lactico-microbioma-piel",
        "Ácido Láctico y el Microbioma Cutáneo: Un hallazgo que redefine la exfoliación",
        "lactic acid skin microbiome pH barrier exfoliation",
        "ácido láctico, microbioma, barrera cutánea"
    ),
]

PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

def buscar_pubmed(query: str, max_results: int = 4) -> list[dict]:
    try:
        r = requests.get(f"{PUBMED_BASE}/esearch.fcgi", params={
            "db": "pubmed", "term": query, "retmax": max_results,
            "sort": "relevance", "retmode": "json"
        }, timeout=10)
        ids = r.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return []
        r2 = requests.get(f"{PUBMED_BASE}/efetch.fcgi", params={
            "db": "pubmed", "id": ",".join(ids),
            "rettype": "abstract", "retmode": "text"
        }, timeout=15)
        texto = r2.text
        papers = []
        for pmid in ids:
            papers.append({"pmid": pmid, "texto": texto[:3000]})
        return papers
    except Exception:
        return []


PROMPT_TEMPLATE = """Eres un periodista científico de McKenna Group S.A.S. (Colombia), especialista en ingredientes cosméticos y nutricionales.

Escribe un artículo de blog estilo "hallazgo científico" sobre: {titulo}
Palabras clave: {keywords}

ESTRUCTURA OBLIGATORIA del artículo (HTML semántico):
1. Párrafo introductorio llamativo con dato sorprendente del estudio (máx 3 líneas)
2. Sección "¿Qué encontraron los investigadores?" — hallazgos principales con datos numéricos
3. Sección "Estudios que se contrastan" — al menos 2 estudios con resultados diferentes y explicación de por qué difieren
4. UNA gráfica inline en HTML/CSS mostrando datos comparativos de los estudios (barras o tabla visual)
5. Sección "Implicaciones para la formulación" — cómo aplicar esto en productos con materias primas McKenna Group
6. Sección "Lo que aún se debate" — limitaciones, controversias pendientes en la literatura

REGLAS:
- Usa h2 para secciones, h3 para subsecciones
- Incluye cifras reales de estudios (porcentajes, semanas, concentraciones)
- La gráfica debe ser HTML puro con CSS inline — usa divs con style="width:X%;background:#2E8B7A" para barras
- Tono: riguroso pero accesible, sin ser condescendiente
- Menciona el ingrediente de McKenna Group naturalmente al final
- Artículo: 600-800 palabras de contenido real (no contar HTML)
- NO uses markdown, solo HTML

Conocimiento científico disponible:
{conocimiento}

Devuelve SOLO un JSON con esta estructura exacta (sin markdown):
{{
  "titulo": "título atractivo del post",
  "extracto": "resumen de 1-2 oraciones sin HTML, máx 180 caracteres",
  "contenido": "<h2>...</h2><p>...</p>...(HTML completo del artículo)",
  "referencias": [
    {{"titulo": "título del paper", "fuente": "PubMed", "año": "2023", "url": "https://pubmed.ncbi.nlm.nih.gov/PMID/"}}
  ]
}}"""


def generar_post(slug: str, titulo: str, query: str, keywords: str) -> dict | None:
    papers = buscar_pubmed(query, max_results=4)
    conocimiento = ""
    refs_base = []
    for p in papers:
        conocimiento += p["texto"][:600] + "\n\n"
        refs_base.append({
            "titulo": f"PubMed PMID {p['pmid']}",
            "fuente": "PubMed",
            "año": str(datetime.now().year),
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{p['pmid']}/"
        })

    if not conocimiento:
        conocimiento = f"Usa tu conocimiento científico sobre {titulo}. Incluye datos reales de estudios publicados con años y porcentajes específicos."

    prompt = PROMPT_TEMPLATE.format(
        titulo=titulo,
        keywords=keywords,
        conocimiento=conocimiento[:2500]
    )

    try:
        resp = _client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config={"temperature": 0.6, "max_output_tokens": 8192}
        )
        raw = resp.text.strip()
        if raw.startswith("```"):
            raw = re.sub(r'^```json?\s*|```\s*$', '', raw, flags=re.MULTILINE).strip()
        data = json.loads(raw)

        # Enriquecer referencias con las de PubMed si las devueltas son genéricas
        if refs_base and len(data.get("referencias", [])) < 2:
            data["referencias"] = refs_base + data.get("referencias", [])

        # Ajustar URLs de PubMed a las reales
        for r in data.get("referencias", []):
            if "PMID" in r.get("titulo", "") and refs_base:
                pmid = r["titulo"].split("PMID ")[-1].strip()
                r["url"] = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"

        return data
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return None


def slugify(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    return re.sub(r"[\s_-]+", "-", s)


def main():
    if POSTS_JSON.exists():
        posts = json.loads(POSTS_JSON.read_text(encoding="utf-8"))
    else:
        posts = []

    slugs_existentes = {p["slug"] for p in posts}
    next_id = max((p["id"] for p in posts), default=0) + 1

    pendientes = [p for p in POSTS_PLAN if p[0] not in slugs_existentes]

    print("\n" + "═" * 60)
    print("  GENERACIÓN MASIVA DE POSTS — McKenna Group")
    print(f"  {len(pendientes)} posts en cola")
    print("═" * 60)
    print(f"\n  Ya publicados: {len(posts)}")
    print(f"  Pendientes:    {len(pendientes)}\n")

    # Fecha base: un post por día hacia atrás desde hoy
    fecha_base = datetime.today()

    for idx, (slug, titulo, query, keywords) in enumerate(pendientes, 1):
        print(f"[{idx}/{len(pendientes)}] {titulo[:60]}...")
        print(f"  slug: {slug}")
        print(f"  📚 PubMed '{query[:40]}'...", end=" ", flush=True)

        data = generar_post(slug, titulo, query, keywords)
        if not data:
            print("  ⚠ Saltando...")
            time.sleep(5)
            continue

        # Calcular fecha (un post cada 3 días hacia atrás)
        fecha = (fecha_base - timedelta(days=idx * 3)).strftime("%Y-%m-%d")

        post = {
            "id": next_id,
            "slug": slug,
            "titulo": data.get("titulo", titulo),
            "tema": keywords.split(",")[0].strip(),
            "categoria": "blog",
            "fecha": fecha,
            "extracto": data.get("extracto", "")[:200],
            "contenido": data.get("contenido", ""),
            "publicado": True,
            "referencias": data.get("referencias", [])
        }

        posts.append(post)
        next_id += 1

        POSTS_JSON.write_text(
            json.dumps(posts, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

        n_refs = len(post.get("referencias", []))
        print(f"✅ {len(post['contenido'])} chars, {n_refs} refs")
        print(f"  💾 Guardado (id={post['id']}, fecha={fecha})")

        if idx < len(pendientes):
            print(f"  ⏳ Esperando 10s...")
            time.sleep(10)

    print("\n" + "═" * 60)
    total_blog = len([p for p in posts if p.get("categoria") == "blog"])
    print(f"  ✅ COMPLETADO — {len(posts)} posts totales ({total_blog} de blog)")
    print("═" * 60 + "\n")


if __name__ == "__main__":
    main()
