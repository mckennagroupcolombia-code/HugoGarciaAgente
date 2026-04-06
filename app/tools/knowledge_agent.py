"""
Agente de Conocimiento Científico — McKenna Group
══════════════════════════════════════════════════════════════════

Flujo:
  1. Buscar papers en PubMed + ArXiv sobre un ingrediente/tema
  2. Extraer texto completo con Scrapling (sitios externos)
  3. Generar contenido con Gemini:
       - Ficha técnica enriquecida
       - Post de blog / receta / manual de uso
  4. Guardar en ChromaDB para respuestas de preventa
  5. Publicar en WordPress (mckennagroup.co) via REST API

Uso desde CLI (opción 14) o desde el agente IA:
  resultado = generar_y_publicar_contenido(
      tema       = "Ácido hialurónico cosmético",
      tipo       = "post_blog",   # o: "receta", "manual_uso", "ficha"
      publicar   = True
  )
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

CHROMADB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'memoria_vectorial')


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

Genera SOLO el contenido del post (en HTML básico: <h2>, <p>, <ul>), sin markdown.""",

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

FUENTES CIENTÍFICAS:
{conocimiento}""",

    "ficha": """Actualiza y enriquece la ficha técnica de "{tema}" con información científica reciente.

Formato de respuesta: texto plano estructurado con las secciones:
DESCRIPCIÓN | PROPIEDADES FISICOQUÍMICAS | APLICACIONES | CONCENTRACIONES RECOMENDADAS |
PRECAUCIONES | ALMACENAMIENTO | REFERENCIAS

Máximo 400 palabras. Solo datos verificados en la literatura científica.

LITERATURA:
{conocimiento}""",
}


def sintetizar_con_gemini(tema: str, conocimiento: str, tipo: str = "post_blog") -> Optional[str]:
    """
    Usa Gemini 2.5-Pro para generar contenido basado en los resultados científicos.
    """
    try:
        from google import genai
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        prompt_template = _PROMPTS.get(tipo, _PROMPTS["post_blog"])
        prompt = prompt_template.format(tema=tema, conocimiento=conocimiento[:8000])
        resp = client.models.generate_content(model='gemini-2.5-pro', contents=prompt)
        return resp.text.strip()
    except Exception as e:
        print(f"❌ Gemini error: {e}")
        return None


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
) -> dict:
    """
    Pipeline completo:
      1. Busca en PubMed + ArXiv
      2. Sintetiza con Gemini
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

    Retorna dict con {contenido, wp_url, wp_id, fuentes, ok}
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
            print("  ⚠️  Sin resultados científicos — generando desde conocimiento general de Gemini")
        conocimiento_raw = f"Información general sobre {tema} (sin papers recuperados)"

    # ── 2. Síntesis con Gemini ─────────────────────────────────
    if verbose:
        print(f"  🤖 Sintetizando contenido ({tipo}) con Gemini...")
    contenido = sintetizar_con_gemini(tema, conocimiento_raw, tipo)
    if not contenido:
        return {"ok": False, "mensaje": "Gemini no pudo generar contenido", "fuentes": fuentes}
    if verbose:
        print(f"     → {len(contenido)} chars generados")

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
        titulo_wp = _generar_titulo_wp(tema, tipo)
        extracto  = contenido[:300].replace("<", "").replace(">", "")
        wp_result = publicar_en_wordpress(
            titulo=titulo_wp,
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
