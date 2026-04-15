"""
Agente de Conocimiento Científico — McKenna Group
══════════════════════════════════════════════════════════════════

Flujo:
  1. Buscar papers en PubMed + ArXiv sobre un ingrediente/tema
  2. Extraer texto completo con Scrapling (sitios externos)
  3. Generar contenido (por defecto Gemini 2.5-Pro vía GOOGLE_API_KEY; sin GPU local):
       - Ficha técnica enriquecida
       - Post de blog / receta / manual de uso
  4. Guardar en ChromaDB para respuestas de preventa
  5. Publicar en WordPress (mckennagroup.co) via REST API

Uso desde CLI (opción 7) o desde el agente IA:
  resultado = generar_y_publicar_contenido(
      tema       = "Ácido hialurónico cosmético",
      tipo       = "post_blog",   # o: "receta", "manual_uso", "ficha"
      publicar   = True
  )

Síntesis: por defecto `AGENTE_SYNTHESIS_PRIMARY=gemini` (solo API). Ollama es opt-in:
  `AGENTE_SYNTHESIS_PRIMARY=ollama` (primero local) o, con primario gemini,
  `AGENTE_SYNTHESIS_FALLBACK_OLLAMA=1` para intentar Ollama si Gemini falla.
  Variables Ollama: AGENTE_OLLAMA_URL (default http://127.0.0.1:11434), AGENTE_OLLAMA_MODEL.
"""

import os
import re
import json
import time
import base64
import requests
import unicodedata
from datetime import datetime
from typing import Optional


# ─────────────────────────────────────────────
#  Configuración
# ─────────────────────────────────────────────

WP_URL    = os.getenv("WC_URL", "https://mckennagroup.co")
WP_USER   = os.getenv("WP_USER", "")          # Usuario WordPress con permisos de editor
WP_PASS   = os.getenv("WP_APP_PASSWORD", "")  # Application Password (WP Settings → Users)

# IDs de categorías en WordPress (ajustar según las categorías reales del sitio)
WP_CATEGORIAS = {
    "post_blog":    1,     # Sin categoría / Blog general
    "receta":       None,  # Se crea automáticamente si no existe
    "manual_uso":   None,
    "ficha":        None,
    "novedad":      None,
}

DEFAULT_OLLAMA_SYNTHESIS_MODEL = "gemma4:latest"
DEFAULT_SYNTHESIS_PRIMARY = "gemini"

CHROMADB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'memoria_vectorial')


def _synthesis_primary() -> str:
    """gemini (default, solo API) | ollama (local, opt-in)."""
    v = (os.getenv("AGENTE_SYNTHESIS_PRIMARY") or DEFAULT_SYNTHESIS_PRIMARY).strip().lower()
    return v if v in ("gemini", "ollama") else DEFAULT_SYNTHESIS_PRIMARY


def _ollama_fallback_allowed() -> bool:
    return os.getenv("AGENTE_SYNTHESIS_FALLBACK_OLLAMA", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


# ─────────────────────────────────────────────
#  1. BÚSQUEDA CIENTÍFICA
# ─────────────────────────────────────────────

def buscar_pubmed(termino: str, max_results: int = 5) -> list[dict]:
    """
    Busca artículos en PubMed (NCBI) via E-utilities API (gratuita, sin clave).
    Retorna lista de dicts: {pmid, titulo, abstract, autores, año, url}
    """
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    # Añadir filtros relevantes para cosméticos/farmacéuticos
    query = f"{termino}[All Fields] AND (cosmetic[MeSH] OR pharmaceutical[MeSH] OR skincare OR ingredient)"
    try:
        # Paso 1: buscar IDs
        r_search = requests.get(
            f"{base}/esearch.fcgi",
            params={
                "db": "pubmed", "term": query,
                "retmax": max_results, "sort": "relevance",
                "retmode": "json",
            },
            timeout=15,
        )
        ids = r_search.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            # Intentar sin filtros de dominio
            r2 = requests.get(
                f"{base}/esearch.fcgi",
                params={"db": "pubmed", "term": termino, "retmax": max_results,
                        "sort": "relevance", "retmode": "json"},
                timeout=15,
            )
            ids = r2.json().get("esearchresult", {}).get("idlist", [])

        if not ids:
            return []

        # Paso 2: obtener abstracts
        r_fetch = requests.get(
            f"{base}/efetch.fcgi",
            params={"db": "pubmed", "id": ",".join(ids), "retmode": "xml", "rettype": "abstract"},
            timeout=20,
        )
        # Parseo simple por regex (evita dependencia de lxml)
        xml = r_fetch.text
        articulos = []
        pmids     = re.findall(r'<PMID[^>]*>(\d+)</PMID>', xml)
        titulos   = re.findall(r'<ArticleTitle>(.*?)</ArticleTitle>', xml, re.DOTALL)
        abstracts = re.findall(r'<AbstractText[^>]*>(.*?)</AbstractText>', xml, re.DOTALL)
        años      = re.findall(r'<PubDate>.*?<Year>(\d{4})</Year>', xml, re.DOTALL)

        for i, pmid in enumerate(pmids[:max_results]):
            titulo   = re.sub(r'<[^>]+>', '', titulos[i])   if i < len(titulos)   else 'Sin título'
            abstract = re.sub(r'<[^>]+>', '', abstracts[i]) if i < len(abstracts) else ''
            año      = años[i] if i < len(años) else '?'
            articulos.append({
                "pmid":     pmid,
                "titulo":   titulo.strip(),
                "abstract": abstract.strip()[:2000],
                "año":      año,
                "fuente":   "PubMed",
                "url":      f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            })
        return articulos

    except Exception as e:
        print(f"⚠️ PubMed error: {e}")
        return []


def buscar_arxiv(termino: str, max_results: int = 3) -> list[dict]:
    """
    Busca preprints en ArXiv via API Atom.
    Útil para tendencias emergentes (nanomateriales, activos innovadores).
    """
    try:
        r = requests.get(
            "https://export.arxiv.org/api/query",
            params={
                "search_query": f"all:{termino}",
                "start": 0, "max_results": max_results,
                "sortBy": "relevance", "sortOrder": "descending",
            },
            timeout=15,
        )
        articulos = []
        entradas = re.findall(r'<entry>(.*?)</entry>', r.text, re.DOTALL)
        for entrada in entradas:
            titulo  = re.sub(r'<[^>]+>', '', re.search(r'<title>(.*?)</title>', entrada, re.DOTALL).group(1) if re.search(r'<title>(.*?)</title>', entrada) else '').strip()
            summary = re.sub(r'<[^>]+>', '', re.search(r'<summary>(.*?)</summary>', entrada, re.DOTALL).group(1) if re.search(r'<summary>(.*?)</summary>', entrada) else '').strip()
            link    = re.search(r'<id>(.*?)</id>', entrada)
            año_m   = re.search(r'<published>(\d{4})', entrada)
            articulos.append({
                "titulo":   titulo,
                "abstract": summary[:2000],
                "año":      año_m.group(1) if año_m else '?',
                "fuente":   "ArXiv",
                "url":      link.group(1).strip() if link else '',
            })
        return articulos
    except Exception as e:
        print(f"⚠️ ArXiv error: {e}")
        return []


def scrape_url(url: str) -> str:
    """
    Extrae texto limpio de una URL usando Scrapling.
    Útil para fichas de proveedores, INCI, reglamentos INVIMA.
    Fallback: requests + regex básico.
    """
    try:
        from scrapling import Fetcher
        fetcher = Fetcher(auto_match=False)
        page = fetcher.get(url, timeout=20)
        # Extraer texto de párrafos principales
        parrafos = page.find_all("p") or page.find_all("div")
        texto = " ".join(p.text for p in parrafos[:30] if len(p.text) > 50)
        return texto[:4000] if texto else ""
    except ImportError:
        pass
    except Exception as e:
        print(f"⚠️ Scrapling error en {url}: {e}")

    # Fallback simple
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent": "McKennaBot/1.0"})
        texto = re.sub(r'<[^>]+>', ' ', r.text)
        texto = re.sub(r'\s+', ' ', texto).strip()
        return texto[:4000]
    except Exception:
        return ""


# ─────────────────────────────────────────────
#  2. SÍNTESIS CON GEMINI
# ─────────────────────────────────────────────

_PROMPTS = {
    "post_blog": """Eres el redactor científico de McKenna Group S.A.S. (Bogotá, Colombia),
proveedor de materias primas farmacéuticas y cosméticas.

Con base en la siguiente información científica sobre "{tema}", redacta un POST DE BLOG
para el sitio mckennagroup.co con estas secciones:

1. Introducción atractiva (2-3 frases, sin jerga excesiva)
2. ¿Qué es y cómo funciona? (mecanismo de acción en términos accesibles)
3. Aplicaciones cosméticas / farmacéuticas (con ejemplos de formulaciones)
4. Beneficios comprobados (citar hallazgos de los papers, sin inventar)
5. Cómo adquirirlo en McKenna Group (una frase de cierre + llamado a la acción)

Tono: técnico pero accesible. Lenguaje colombiano formal. Máximo 600 palabras.
NO uses frases genéricas como "en el mundo de la cosmética". Sé específico.

INFORMACIÓN CIENTÍFICA RECOPILADA:
{conocimiento}

Genera SOLO el contenido del post (en HTML básico: <h2>, <p>, <ul>), sin markdown.
PROHIBIDO: saludos, preámbulos ("Claro, aquí tienes…"), fences ```html, mencionar IA o el formato pedido.
La primera línea de tu respuesta debe ser la etiqueta HTML de apertura (p. ej. <h2>).""",

    "receta": """Eres formulador senior en McKenna Group S.A.S.

Crea una RECETA DE FORMULACIÓN cosmética o farmacéutica usando "{tema}" como ingrediente activo principal.
Basa los porcentajes y la metodología en evidencia científica real (no inventes proporciones sin respaldo).

Estructura:
1. Nombre de la formulación (atractivo y descriptivo)
2. Tipo: emulsión / sérum / crema / gel / tónico / etc.
3. Tabla de ingredientes (nombre INCI, función, % en fase)
4. Procedimiento paso a paso
5. pH objetivo y conservación recomendada
6. Propiedades y beneficios esperados
7. Nota de aplicación (cómo usarlo el consumidor final)

Formato HTML básico (<h2>, <p>, <table>, <ol>). Máximo 500 palabras.
PROHIBIDO: preámbulos, ```html, explicar que cumples instrucciones, mencionar IA.
Empieza directo con <h2> (sin documento HTML completo ni <!DOCTYPE>).

SOPORTE CIENTÍFICO:
{conocimiento}""",

    "manual_uso": """Eres el equipo técnico de McKenna Group S.A.S.

Redacta un MANUAL DE USO TÉCNICO para compradores del ingrediente "{tema}".
Público: formuladores, laboratoristas, fabricantes colombianos de cosméticos.

Secciones:
1. Descripción técnica del ingrediente (estado, solubilidad, pH de trabajo)
2. Concentraciones de uso recomendadas por aplicación
3. Compatibilidad e incompatibilidades clave
4. Instrucciones de incorporación en formulaciones
5. Condiciones de almacenamiento
6. Normativa INVIMA aplicable (si la conoces)
7. Preguntas frecuentes (3-5 Q&A)

Formato HTML (<h2>, <p>, <ul>). Máximo 500 palabras. Solo información técnica verificable.
Fragmento listo para incrustar en la web: sin <!DOCTYPE>, sin <html>/<body>, sin fences markdown.
PROHIBIDO: "Claro, aquí tienes…", "---", ```html, mencionar que eres IA o el formato solicitado.
Primera línea: <h2>…</h2>.

FUENTES CIENTÍFICAS:
{conocimiento}""",

    "ficha": """Actualiza y enriquece la ficha técnica de "{tema}" con información científica reciente.

Formato de respuesta: texto plano estructurado con las secciones:
DESCRIPCIÓN | PROPIEDADES FISICOQUÍMICAS | APLICACIONES | CONCENTRACIONES RECOMENDADAS |
PRECAUCIONES | ALMACENAMIENTO | REFERENCIAS

Máximo 400 palabras. Solo datos verificados en la literatura científica.
Sin preámbulos ni menciones a IA; empieza con la sección DESCRIPCIÓN.

LITERATURA:
{conocimiento}""",
}


def limpiar_salida_llm_html(texto: str) -> str:
    """
    Quita preámbulos tipo 'Claro, aquí tienes…', fences ```html, documentos HTML envolventes
    y deja fragmento útil para posts.json / guías (preferencia: interior de <body>).
    """
    if not texto:
        return ""
    t = texto.strip()
    for _ in range(4):
        t2 = re.sub(r"(?is)^\s*```(?:html|htm|xml)?\s*\n?", "", t)
        t2 = re.sub(r"(?is)\n?\s*```\s*$", "", t2.strip())
        if t2 == t:
            break
        t = t2
    t = re.sub(r"(?is)^\s*---+?\s*\n?", "", t)
    # Párrafos meta del modelo (es/en) antes del HTML real
    meta_open = re.compile(
        r"(?is)^\s*("
        r"Claro,?\s+aquí[^<\n]{0,400}?(\n|$)|"
        r"Aquí\s+tienes[^<\n]{0,400}?(\n|$)|"
        r"Por\s+supuesto[^<\n]{0,400}?(\n|$)|"
        r"Entendido[^<\n]{0,200}?(\n|$)|"
        r"Certainly[^<\n]{0,400}?(\n|$)|"
        r"Here\s+(is|are)[^<\n]{0,400}?(\n|$)|"
        r"As\s+an?\s+AI[^<\n]{0,400}?(\n|$)"
        r")+"
    )
    for _ in range(6):
        t2 = meta_open.sub("", t, count=1).strip()
        t2 = re.sub(r"(?is)^\s*---+?\s*\n?", "", t2)
        if t2 == t:
            break
        t = t2
    m = re.search(
        r"(?is)(<!DOCTYPE\s+html|<html[\s>]|<h[1-6]\b|<p\b|<ul\b|<ol\b|<div\b|<section\b|<article\b|<dl\b)",
        t,
    )
    if m:
        t = t[m.start() :]
    bm = re.search(r"(?is)<body[^>]*>(.*)</body>", t, re.DOTALL)
    if bm:
        t = bm.group(1).strip()
    t = re.sub(r"(?is)</html>\s*```?\s*$", "", t)
    t = re.sub(r"(?is)\s*```\s*$", "", t)
    return t.strip()


def _ollama_solo_linea(prompt: str) -> Optional[str]:
    model = (os.getenv("AGENTE_OLLAMA_MODEL") or DEFAULT_OLLAMA_SYNTHESIS_MODEL).strip()
    base = (os.getenv("AGENTE_OLLAMA_URL") or "http://127.0.0.1:11434").strip()
    url = f"{base.rstrip('/')}/api/generate"
    try:
        r = requests.post(
            url,
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": 160, "temperature": 0.35},
            },
            timeout=120,
        )
        r.raise_for_status()
        out = (r.json().get("response") or "").strip()
        if not out:
            return None
        line = out.split("\n")[0].strip()
        line = re.sub(r'^["«»\']+|["«»\']+$', "", line)
        line = re.sub(r"^(Título|Title)\s*:\s*", "", line, flags=re.I)
        return line.strip() or None
    except Exception:
        return None


def _gemini_solo_linea(prompt: str) -> Optional[str]:
    try:
        from google import genai
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        resp = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
        )
        out = (resp.text or "").strip()
        if not out:
            return None
        line = out.split("\n")[0].strip()
        line = re.sub(r'^["«»\']+|["«»\']+$', "", line)
        line = re.sub(r"^(Título|Title)\s*:\s*", "", line, flags=re.I)
        return line.strip() or None
    except Exception:
        return None


def proponer_titulo_editorial_es(tema: str, contenido: str, tipo: str) -> str:
    """
    Título en español para el sitio; el tema de búsqueda puede haber estado en inglés.
    """
    if tipo == "ficha":
        return _generar_titulo_wp(tema, tipo)
    plain = re.sub(r"<[^>]+>", " ", contenido or "")
    plain = re.sub(r"\s+", " ", plain).strip()[:950]
    rol = {
        "post_blog": "post de blog divulgativo (titular atractivo, estilo revista especializada)",
        "manual_uso": "manual técnico para formuladores (debe sonar profesional; puede empezar por 'Manual técnico:' o 'Manual de uso:')",
        "receta": "receta de formulación (puede empezar por 'Receta:' si encaja)",
        "novedad": "nota corta",
    }.get(tipo, "artículo")
    prompt = (
        f"Devuelve UNA sola línea, sin comillas.\n"
        f"Título en español para {rol} del sitio McKenna Group (Colombia, cosmética/farmacia).\n"
        f"Tema de investigación (a veces en inglés): {tema}\n"
        f"El título final debe estar en español correcto; no dejes frases en inglés sueltas "
        f'(mal: "Population Deficiency Zinc"; bien: tema nombrado en español natural).\n'
        f"No menciones IA, ChatGPT, formato, markdown ni que cumples una instrucción.\n"
        f"Máximo 95 caracteres.\n"
        f"Extracto del cuerpo: {plain}"
    )
    if _synthesis_primary() == "ollama":
        line = _ollama_solo_linea(prompt) or _gemini_solo_linea(prompt)
    else:
        line = _gemini_solo_linea(prompt)
        if not line and _ollama_fallback_allowed():
            line = _ollama_solo_linea(prompt)
    line = (line or "").strip()
    if len(line) >= 10:
        return line[:120]
    m = re.search(r"(?is)<h2[^>]*>([^<]+)</h2>", contenido or "")
    if m:
        return m.group(1).strip()[:120]
    return _generar_titulo_wp(tema, tipo)


def titulo_publicacion(
    tema_busqueda: str,
    contenido_html: str,
    tipo: str,
    titulo_override: str = "",
) -> str:
    """Título mostrado en el sitio; `titulo_override` si el operador lo escribe en español."""
    o = (titulo_override or "").strip()
    if o:
        return o[:200]
    return proponer_titulo_editorial_es(tema_busqueda, contenido_html, tipo)


def _sintetizar_con_gemini(tema: str, conocimiento: str, tipo: str = "post_blog") -> Optional[str]:
    try:
        from google import genai
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        prompt_template = _PROMPTS.get(tipo, _PROMPTS["post_blog"])
        prompt = prompt_template.format(tema=tema, conocimiento=conocimiento[:8000])
        resp = client.models.generate_content(model='gemini-2.5-pro', contents=prompt)
        t = (resp.text or "").strip()
        return t or None
    except Exception as e:
        print(f"❌ Gemini error: {e}")
        return None


def _sintetizar_con_ollama(
    tema: str,
    conocimiento: str,
    tipo: str,
    model: str,
    base_url: str,
) -> Optional[str]:
    prompt_template = _PROMPTS.get(tipo, _PROMPTS["post_blog"])
    prompt = prompt_template.format(tema=tema, conocimiento=conocimiento[:8000])
    url = f"{base_url.rstrip('/')}/api/generate"
    try:
        r = requests.post(
            url,
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": 8192, "temperature": 0.5},
            },
            timeout=600,
        )
        r.raise_for_status()
        data = r.json()
        out = (data.get("response") or "").strip()
        if not out:
            print("  ⚠️ Ollama devolvió respuesta vacía")
            return None
        return out
    except Exception as e:
        print(f"  ❌ Ollama error: {e}")
        return None


def sintetizar_contenido(tema: str, conocimiento: str, tipo: str = "post_blog") -> Optional[str]:
    """
    Por defecto: Gemini 2.5-Pro (GOOGLE_API_KEY); no contacta Ollama salvo opt-in.

    - AGENTE_SYNTHESIS_PRIMARY=gemini (default): solo API; si Gemini falla y
      AGENTE_SYNTHESIS_FALLBACK_OLLAMA=1, intenta Ollama local.
    - AGENTE_SYNTHESIS_PRIMARY=ollama: primero Ollama (AGENTE_OLLAMA_URL / AGENTE_OLLAMA_MODEL),
      respaldo Gemini.
    """
    primary = _synthesis_primary()
    model = (os.getenv("AGENTE_OLLAMA_MODEL") or DEFAULT_OLLAMA_SYNTHESIS_MODEL).strip()
    base = (os.getenv("AGENTE_OLLAMA_URL") or "http://127.0.0.1:11434").strip()

    if primary == "ollama":
        print(f"  🦙 Sintetizando con Ollama ({model}) @ {base}...")
        texto = _sintetizar_con_ollama(tema, conocimiento, tipo, model, base)
        if texto:
            return texto
        print("  🤖 Fallback: Gemini 2.5-Pro...")
        return _sintetizar_con_gemini(tema, conocimiento, tipo)

    print("  🤖 Sintetizando con Gemini 2.5-Pro...")
    texto = _sintetizar_con_gemini(tema, conocimiento, tipo)
    if texto:
        return texto
    if _ollama_fallback_allowed():
        print(f"  🦙 Fallback Ollama: {model} @ {base}")
        return _sintetizar_con_ollama(tema, conocimiento, tipo, model, base)
    return None


def sintetizar_con_gemini(tema: str, conocimiento: str, tipo: str = "post_blog") -> Optional[str]:
    """Solo Gemini (sin Ollama). Para pipeline completo usar sintetizar_contenido."""
    return _sintetizar_con_gemini(tema, conocimiento, tipo)


def _gemini_rechazo_o_meta_respuesta(contenido: str) -> bool:
    """True si el modelo declara no poder basarse en las fuentes (no publicar)."""
    c = (contenido or "").strip()
    if not c:
        return True
    if re.match(r"(?is)^\s*no puedo\b", c):
        return True
    head = c[:800].lower()
    if "no puedo generar" in head and (
        "información científica" in head or "informacion cientifica" in head
    ):
        return True
    return False


# ─────────────────────────────────────────────
#  3. ALMACENAMIENTO EN CHROMADB
# ─────────────────────────────────────────────

def guardar_en_chromadb(tema: str, contenido: str, tipo: str, metadatos: dict = None):
    """
    Guarda el conocimiento generado en ChromaDB para que el agente
    pueda recuperarlo al responder preguntas de preventa MeLi.
    """
    try:
        import chromadb
        client = chromadb.PersistentClient(path=CHROMADB_PATH)
        coleccion = client.get_or_create_collection(
            name="conocimiento_cientifico",
            metadata={"hnsw:space": "cosine"},
        )
        doc_id = f"{tipo}_{re.sub(r'[^a-z0-9]', '_', tema.lower()[:40])}_{int(time.time())}"
        coleccion.add(
            documents=[contenido[:3000]],
            metadatas=[{
                "tema":   tema,
                "tipo":   tipo,
                "fecha":  datetime.now().isoformat(),
                **(metadatos or {}),
            }],
            ids=[doc_id],
        )
        print(f"  ✅ Guardado en ChromaDB: {doc_id}")
        return True
    except Exception as e:
        print(f"  ⚠️ ChromaDB error: {e}")
        return False


def buscar_conocimiento_local(consulta: str, n_resultados: int = 3) -> list[str]:
    """
    Recupera conocimiento científico almacenado previamente para una consulta.
    Usado por el agente en respuestas de preventa.
    """
    try:
        import chromadb
        client = chromadb.PersistentClient(path=CHROMADB_PATH)
        coleccion = client.get_or_create_collection(name="conocimiento_cientifico")
        resultados = coleccion.query(query_texts=[consulta], n_results=n_resultados)
        return resultados.get("documents", [[]])[0]
    except Exception:
        return []


# ─────────────────────────────────────────────
#  4. ENRIQUECER FICHA TÉCNICA EN SHEETS
# ─────────────────────────────────────────────

def enriquecer_ficha_tecnica_sheets(nombre_producto: str, ficha_nueva: str) -> bool:
    """
    Actualiza la columna I del Google Sheet con la ficha enriquecida.
    Solo sobreescribe si la nueva ficha es más larga que la actual.
    """
    try:
        from app.services.google_services import buscar_ficha_tecnica_producto
        import gspread
        from google.oauth2.service_account import Credentials

        ficha_actual = buscar_ficha_tecnica_producto(nombre_producto)
        if ficha_actual and len(ficha_actual) >= len(ficha_nueva):
            print(f"  ℹ️  Ficha actual más completa ({len(ficha_actual)} chars) — no se sobreescribe")
            return False

        creds_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_PATH",
                               "/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json")
        scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
        creds = Credentials.from_service_account_file(creds_path, scopes=scope)
        gc    = gspread.authorize(creds)
        sheet = gc.open_by_key(os.getenv("SPREADSHEET_ID", "")).sheet1
        datos = sheet.get_all_values()

        nombre_norm = _normalizar(nombre_producto)
        for i, fila in enumerate(datos, start=1):
            if len(fila) > 1 and nombre_norm in _normalizar(str(fila[1])):
                sheet.update_cell(i, 9, ficha_nueva)  # col I = columna 9
                print(f"  ✅ Ficha técnica actualizada en Sheets: fila {i}")
                return True

        print(f"  ⚠️  Producto '{nombre_producto}' no encontrado en Sheets")
        return False
    except Exception as e:
        print(f"  ❌ Error actualizando Sheets: {e}")
        return False


def _normalizar(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


# ─────────────────────────────────────────────
#  5. PUBLICAR EN EL SITIO WEB FLASK NATIVO
#     (mckennagroup.co — PAGINA_WEB/site/)
# ─────────────────────────────────────────────

_SITIO_DATA   = os.path.join(os.path.dirname(__file__), '..', '..', 'PAGINA_WEB', 'site', 'data')
_RECETAS_JSON = os.path.join(_SITIO_DATA, 'recetas.json')
_POSTS_JSON   = os.path.join(_SITIO_DATA, 'posts.json')
_GUIAS_JSON   = os.path.join(_SITIO_DATA, 'guias.json')
_FICHAS_JSON  = os.path.join(_SITIO_DATA, 'fichas_tecnicas.json')

# Borradores generados desde CLI (opción CIENCIA) para revisión antes de publicar
_CIENCIA_BORRADORES_DIR = os.path.join(
    os.path.dirname(__file__), "..", "data", "ciencia_borradores"
)


def ruta_archivo_sitio_por_tipo(tipo: str) -> str:
    """JSON del sitio Flask donde se añade el ítem al publicar (ruta absoluta)."""
    if tipo == "receta":
        return os.path.abspath(_RECETAS_JSON)
    if tipo == "manual_uso":
        return os.path.abspath(_GUIAS_JSON)
    return os.path.abspath(_POSTS_JSON)


def guardar_borrador_local_ciencia(
    tema: str,
    tipo: str,
    contenido: str,
    fuentes: list | None = None,
) -> str:
    """
    Guarda HTML (con metadatos en comentario inicial) en app/data/ciencia_borradores/.
    Retorna ruta absoluta del archivo.
    """
    os.makedirs(_CIENCIA_BORRADORES_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = _slug(tema)[:50] or "tema"
    fname = f"{ts}_{slug}_{tipo}.html"
    path = os.path.join(_CIENCIA_BORRADORES_DIR, fname)
    tema_s = (tema or "").replace("--", "- -").replace("\n", " ")
    lines_src = "\n".join(f"  - {u}" for u in (fuentes or [])[:25])
    meta = f"""<!--
  tema: {tema_s}
  tipo: {tipo}
  iso: {datetime.now().isoformat()}
  fuentes:
{lines_src or "  (ninguna URL)"}
-->
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(meta + "\n" + contenido)
    return os.path.abspath(path)


def publicar_contenido_en_sitio(
    tema: str,
    tipo: str,
    contenido: str,
    estado_wp: str,
    referencias: list | None = None,
    titulo_sitio: str | None = None,
) -> dict:
    """
    Misma lógica que al final de generar_y_publicar_contenido(publicar=True).
    estado_wp: 'draft' | 'publish'
    """
    titulo_wp = (titulo_sitio or "").strip() or titulo_publicacion(tema, contenido, tipo, "")
    extracto = contenido[:300].replace("<", "").replace(">", "")
    publicado = estado_wp == "publish"
    return publicar_en_sitio_web(
        titulo=titulo_wp,
        contenido_html=contenido,
        tipo=tipo,
        tema=tema,
        publicado=publicado,
        extracto=extracto,
        estado=estado_wp,
        referencias=referencias or [],
    )


def _slug(texto: str) -> str:
    """Genera slug URL-friendly desde un texto."""
    s = _normalizar(texto).lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s]+', '-', s.strip())
    return s[:60]


def _leer_json(path: str, default) -> list | dict:
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return default


def _escribir_json(path: str, data) -> bool:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"  ❌ Error escribiendo {path}: {e}")
        return False


def _gemini_texto_a_receta_json(tema: str, contenido_html: str) -> dict | None:
    """
    Usa Gemini para convertir el HTML de una receta en el JSON estructurado
    que espera recetario.html (campos: title, title2, desc, cat, base, unidad,
    ings [{n, q, u, src}], pasos [str], tip, tags [str]).
    """
    try:
        from google import genai
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        prompt = f"""Convierte el siguiente contenido HTML de una receta en un JSON estructurado.

TEMA: {tema}

CONTENIDO HTML:
{contenido_html[:4000]}

Devuelve SOLO el JSON (sin markdown, sin ```json), con esta estructura exacta:
{{
  "title": "Nombre principal de la receta (máx 4 palabras)",
  "title2": "Subtítulo descriptivo (máx 3 palabras)",
  "desc": "Descripción en 1 oración.",
  "cat": "cosmetica|nutricion|perfumeria|hogar|farmaceutica",
  "base": 100,
  "unidad": "g|ml|cápsulas|und",
  "tags": ["tag1", "tag2", "tag3"],
  "ings": [
    {{"n": "Nombre ingrediente INCI", "q": 10, "u": "g", "src": "McKenna Group"}}
  ],
  "pasos": ["Paso 1.", "Paso 2."],
  "tip": "Consejo práctico de uso o conservación."
}}"""
        resp = client.models.generate_content(model='gemini-2.5-pro', contents=prompt)
        texto = resp.text.strip()
        texto = re.sub(r'^```json\s*|```\s*$', '', texto, flags=re.MULTILINE).strip()
        return json.loads(texto)
    except Exception as e:
        print(f"  ⚠️ Error convirtiendo receta a JSON: {e}")
        return None


def publicar_en_sitio_web(
    titulo: str,
    contenido_html: str,
    tipo: str = "post_blog",
    tema: str = "",
    publicado: bool = True,
    extracto: str = "",
    estado: str = "publish",
    imagen_destacada_url: str = "",
    referencias: list = None,
) -> dict:
    """
    Publica contenido directamente en el sitio Flask nativo (mckennagroup.co).

    Rutas del sitio:
      receta      → /recetario         (data/recetas.json)
      post_blog   → /blog/{slug}       (data/posts.json)
      manual_uso  → /blog/{slug}       (data/posts.json — categoría manuales)
      ficha       → fichas_tecnicas.json (enriquece las fichas del catálogo)

    Retorna dict con {ok, url, id, mensaje}
    """
    fecha    = datetime.now().strftime("%Y-%m-%d")
    slug     = _slug(titulo)
    publicado = publicado and (estado != "draft")

    # ── Receta ────────────────────────────────────────────────────────
    if tipo == "receta":
        recetas = _leer_json(_RECETAS_JSON, [])
        # Convertir HTML → JSON estructurado que espera recetario.html
        receta_json = _gemini_texto_a_receta_json(tema or titulo, contenido_html)
        if not receta_json:
            # Fallback: crear entrada mínima
            receta_json = {
                "title":  titulo,
                "title2": "Formulación McKenna",
                "desc":   f"Receta de {tema or titulo}.",
                "cat":    "cosmetica",
                "base":   100, "unidad": "g",
                "tags":   [_normalizar(tema or titulo)],
                "ings":   [],
                "pasos":  [contenido_html[:500]],
                "tip":    "",
            }
        nuevo_id = max((r.get("id", 0) for r in recetas), default=0) + 1
        receta_json["id"]     = nuevo_id
        receta_json["fecha"]  = fecha
        receta_json["slug"]   = slug
        receta_json["activa"] = publicado
        recetas.append(receta_json)
        if _escribir_json(_RECETAS_JSON, recetas):
            url = f"https://mckennagroup.co/recetario#{slug}"
            print(f"  ✅ Receta [{nuevo_id}] añadida a recetario: {titulo}")
            return {"ok": True, "id": nuevo_id, "url": url, "estado": "publicado" if publicado else "borrador"}
        return {"ok": False, "mensaje": "Error escribiendo recetas.json"}

    # ── Manual de uso → guias.json (aparece en /guias/<slug>) ────────
    if tipo == "manual_uso":
        guias = _leer_json(_GUIAS_JSON, [])
        nuevo_id = max((g.get("id", 0) for g in guias), default=0) + 1
        # Convertir HTML a secciones estructuradas (una sola sección con todo el contenido)
        # Convertir referencias (papers) a formato legible
        refs_estructuradas = []
        for r in (referencias or []):
            refs_estructuradas.append({
                "titulo":  r.get("titulo", ""),
                "fuente":  r.get("fuente", ""),
                "año":     r.get("año", ""),
                "url":     r.get("url", ""),
            })
        guias.append({
            "id":             nuevo_id,
            "slug":           slug,
            "title":          titulo,
            "title_short":    (tema or titulo)[:40],
            "desc":           extracto or re.sub(r'<[^>]+>', '', contenido_html)[:200],
            "category":       "Guías Técnicas",
            "icon":           "book-open",
            "color":          "#143D36",
            "tags":           [_normalizar(tema or titulo)[:20]],
            "products":       1,
            "fecha":          fecha,
            "publicada":      publicado,
            "meli_url":       "",
            "producto_slug":  "",
            "producto_nombre": "",
            "producto_precio": "",
            "producto_foto":  "",
            "referencias":    refs_estructuradas,
            "secciones": [{"num": "01", "titulo": titulo, "contenido": contenido_html}],
        })
        if _escribir_json(_GUIAS_JSON, guias):
            url = f"https://mckennagroup.co/guias/{slug}"
            print(f"  ✅ Guía [{nuevo_id}] añadida: {url}")
            return {"ok": True, "id": nuevo_id, "url": url, "estado": "publicado" if publicado else "borrador"}
        return {"ok": False, "mensaje": "Error escribiendo guias.json"}

    # ── Post de blog / Novedad → posts.json (/blog/<slug>) ───────────
    posts = _leer_json(_POSTS_JSON, [])
    categoria = {"post_blog": "blog", "novedad": "noticias"}.get(tipo, "blog")
    nuevo_id  = max((p.get("id", 0) for p in posts), default=0) + 1
    extracto_final = extracto or re.sub(r'<[^>]+>', '', contenido_html)[:200]
    refs_estructuradas = []
    for r in (referencias or []):
        refs_estructuradas.append({
            "titulo":  r.get("titulo", ""),
            "fuente":  r.get("fuente", ""),
            "año":     r.get("año", ""),
            "url":     r.get("url", ""),
        })
    posts.append({
        "id":          nuevo_id,
        "slug":        slug,
        "titulo":      titulo,
        "categoria":   categoria,
        "extracto":    extracto_final,
        "contenido":   contenido_html,
        "fecha":       fecha,
        "publicado":   publicado,
        "tema":        tema or titulo,
        "referencias": refs_estructuradas,
    })
    if _escribir_json(_POSTS_JSON, posts):
        url = f"https://mckennagroup.co/blog/{slug}"
        print(f"  ✅ Post [{nuevo_id}] añadido: {url}")
        # Auto-publicar en Facebook si está configurado y el post es público
        if publicado and os.getenv("FB_PAGE_ID") and os.getenv("FB_PAGE_ACCESS_TOKEN"):
            try:
                fb = publicar_en_facebook(titulo, extracto_final[:200], url, imagen_destacada_url)
                if fb.get("ok"):
                    print(f"  📘 Facebook: {fb.get('post_id')}")
            except Exception as e:
                print(f"  ⚠ Facebook auto-publish: {e}")
        return {"ok": True, "id": nuevo_id, "url": url, "estado": "publicado" if publicado else "borrador"}
    return {"ok": False, "mensaje": "Error escribiendo posts.json"}


# Alias para mantener compatibilidad con el nombre anterior
publicar_en_wordpress = publicar_en_sitio_web


# ─────────────────────────────────────────────
#  AUTO-PUBLICACIÓN EN FACEBOOK PAGE
# ─────────────────────────────────────────────

def publicar_en_facebook(titulo: str, extracto: str, url: str, imagen_url: str = "") -> dict:
    """
    Publica automáticamente un post en la página de Facebook de McKenna Group.
    Requiere en .env:
      FB_PAGE_ID           — ID numérico de la página
      FB_PAGE_ACCESS_TOKEN — Token de acceso de página (no expira si es permanent token)
    """
    page_id    = os.getenv("FB_PAGE_ID", "")
    page_token = os.getenv("FB_PAGE_ACCESS_TOKEN", "")

    if not page_id or not page_token:
        return {"ok": False, "mensaje": "FB_PAGE_ID o FB_PAGE_ACCESS_TOKEN no configurados en .env"}

    mensaje = f"📖 {titulo}\n\n{extracto}\n\n🔗 Leer completo: {url}"

    payload: dict = {
        "message": mensaje,
        "access_token": page_token,
    }

    # Si hay imagen, intentar publicar con foto primero (más engagement)
    if imagen_url and imagen_url.startswith("http"):
        try:
            r = requests.post(
                f"https://graph.facebook.com/v19.0/{page_id}/photos",
                data={**payload, "url": imagen_url, "caption": mensaje},
                timeout=15
            )
            if r.ok and r.json().get("post_id"):
                post_id = r.json()["post_id"]
                print(f"  📘 Facebook foto publicada: {post_id}")
                return {"ok": True, "post_id": post_id, "tipo": "foto"}
        except Exception as e:
            print(f"  ⚠ Facebook foto falló ({e}), intentando post de texto...")

    # Fallback: post de texto con link
    try:
        r = requests.post(
            f"https://graph.facebook.com/v19.0/{page_id}/feed",
            data={**payload, "link": url},
            timeout=15
        )
        data = r.json()
        if r.ok and data.get("id"):
            print(f"  📘 Facebook post publicado: {data['id']}")
            return {"ok": True, "post_id": data["id"], "tipo": "link"}
        return {"ok": False, "mensaje": data.get("error", {}).get("message", "Error desconocido")}
    except Exception as e:
        return {"ok": False, "mensaje": str(e)}


# ─────────────────────────────────────────────
#  FUNCIÓN PRINCIPAL — ORQUESTADOR
# ─────────────────────────────────────────────

def generar_y_publicar_contenido(
    tema: str,
    tipo: str = "post_blog",
    publicar: bool = False,
    estado_wp: str = "draft",
    enriquecer_sheets: bool = False,
    nombre_producto_sheets: str = "",
    verbose: bool = True,
    tema_titulo: str = "",
) -> dict:
    """
    Pipeline completo:
      1. Busca en PubMed + ArXiv
      2. Sintetiza (Gemini 2.5-Pro por defecto; Ollama solo si AGENTE_SYNTHESIS_PRIMARY=ollama)
      3. Guarda en ChromaDB
      4. (Opcional) Actualiza ficha en Sheets
      5. (Opcional) Publica en WordPress

    Args:
        tema:                    Nombre del ingrediente o tema a investigar
        tipo:                    "post_blog" | "receta" | "manual_uso" | "ficha"
        publicar:                True → publica en WP; False → solo genera
        estado_wp:               "draft" (borrador) o "publish" (publicado directo)
        enriquecer_sheets:       True → actualiza col I del Sheet
        nombre_producto_sheets:  Nombre exacto en Sheets (si difiere de `tema`)
        verbose:                 Imprimir progreso
        tema_titulo:             Título en español manual (vacío → propone desde el contenido)

    Retorna dict con {contenido, wp_url, wp_id, fuentes, ok}.
    Post tipo post_blog: exige ≥1 resultado PubMed; sin fuentes o rechazo del modelo → ok=False, no Chroma ni WP.
    """
    if verbose:
        print(f"\n🔬 AGENTE DE CONOCIMIENTO — {tipo.upper()}: {tema}")
        print("─" * 58)

    # ── 1. Búsqueda científica ─────────────────────────────────
    if verbose:
        print("  📚 Buscando en PubMed...")
    papers_pubmed = buscar_pubmed(tema, max_results=4)
    if verbose:
        print(f"     → {len(papers_pubmed)} artículo(s) encontrado(s)")

    if verbose:
        print("  📐 Buscando en ArXiv...")
    papers_arxiv = buscar_arxiv(tema, max_results=2)
    if verbose:
        print(f"     → {len(papers_arxiv)} paper(s) encontrado(s)")

    todos_los_papers = papers_pubmed + papers_arxiv
    fuentes = [p.get("url", "") for p in todos_los_papers if p.get("url")]

    # Compilar texto de conocimiento para el prompt
    bloques = []
    for p in todos_los_papers:
        bloques.append(
            f"[{p['fuente']} {p['año']}] {p['titulo']}\n{p['abstract']}"
        )
    conocimiento_raw = "\n\n---\n\n".join(bloques)

    if not conocimiento_raw.strip():
        if verbose:
            print("  ❌ Sin resultados en PubMed ni ArXiv. No se genera contenido.")
        return {
            "ok": False,
            "mensaje": "Sin artículos recuperados para el tema; no se genera contenido.",
            "fuentes": [],
        }

    if tipo == "post_blog" and not papers_pubmed:
        if verbose:
            print(
                "  ❌ Post blog requiere al menos un resultado en PubMed "
                "(fuentes solo ArXiv no bastan)."
            )
        return {
            "ok": False,
            "mensaje": "Post de blog requiere al menos un artículo en PubMed.",
            "fuentes": fuentes,
        }

    # ── 2. Síntesis (Gemini por defecto; ver sintetizar_contenido / AGENTE_SYNTHESIS_*) ──
    if verbose:
        print(f"  📝 Sintetizando contenido ({tipo})...")
    contenido_bruto = sintetizar_contenido(tema, conocimiento_raw, tipo)
    if not contenido_bruto:
        return {"ok": False, "mensaje": "Ningún modelo pudo generar contenido (Gemini u Ollama si aplica).", "fuentes": fuentes}
    if _gemini_rechazo_o_meta_respuesta(contenido_bruto):
        if verbose:
            print("  ❌ El modelo indicó que no puede basar el texto en las fuentes; no se guarda ni publica.")
        return {
            "ok": False,
            "mensaje": "Modelo rechazó generar desde las fuentes proporcionadas.",
            "fuentes": fuentes,
        }
    contenido = limpiar_salida_llm_html(contenido_bruto)
    texto_plano = re.sub(r"<[^>]+>", " ", contenido).strip()
    if len(texto_plano) < 50:
        return {
            "ok": False,
            "mensaje": "Contenido insuficiente tras limpiar preámbulos/markdown del modelo.",
            "fuentes": fuentes,
        }
    titulo_sitio = titulo_publicacion(tema, contenido, tipo, tema_titulo)
    if verbose:
        print(f"     → {len(contenido)} chars (salida limpia)")
        print(f"  📰 Título para el sitio: {titulo_sitio}")

    # ── 3. Guardar en ChromaDB ─────────────────────────────────
    guardar_en_chromadb(tema, contenido, tipo, {"fuentes": json.dumps(fuentes)})

    # ── 4. Enriquecer ficha en Sheets ──────────────────────────
    if enriquecer_sheets and tipo == "ficha":
        nombre_en_sheets = nombre_producto_sheets or tema
        if verbose:
            print(f"  📊 Actualizando ficha técnica en Google Sheets...")
        enriquecer_ficha_tecnica_sheets(nombre_en_sheets, contenido)

    # ── 5. Publicar en WordPress ───────────────────────────────
    wp_result = {"ok": False, "url": "", "id": ""}
    if publicar:
        if verbose:
            print(f"  🌐 Publicando en WordPress ({estado_wp})...")
        extracto  = contenido[:300].replace("<", "").replace(">", "")
        wp_result = publicar_en_wordpress(
            titulo=titulo_sitio,
            contenido_html=contenido,
            tipo=tipo,
            extracto=extracto,
            estado=estado_wp,
            referencias=todos_los_papers,
        )
        if not wp_result["ok"] and verbose:
            print(f"  ❌ WP error: {wp_result.get('mensaje')}")

    if verbose:
        print(f"\n  ✅ Pipeline completado — {len(todos_los_papers)} fuentes, {len(contenido)} chars")
        if wp_result.get("url"):
            print(f"     WordPress: {wp_result['url']}")

    return {
        "ok":       True,
        "contenido": contenido,
        "fuentes":   fuentes,
        "papers":    todos_los_papers,
        "titulo_sitio": titulo_sitio,
        "wp_url":    wp_result.get("url", ""),
        "wp_id":     wp_result.get("id", ""),
        "wp_estado": wp_result.get("estado", ""),
    }


def _generar_titulo_wp(tema: str, tipo: str) -> str:
    prefijos = {
        "post_blog":  "",
        "receta":     "Receta: ",
        "manual_uso": "Manual de Uso: ",
        "ficha":      "Ficha Técnica: ",
        "novedad":    "Novedad: ",
    }
    return f"{prefijos.get(tipo, '')}{tema}"
