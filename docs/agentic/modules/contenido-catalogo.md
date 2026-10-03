# Contenido catalogo

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

## Generación de Catálogo PDF

```python
# scripts/generar_catalogo.py - flujo:
1. leer_productos_sheets() → lee Sheets, extrae meli_id_to_sku de col A
2. fetch_meli_photos(token, meli_id_to_sku) → descarga 1ª foto por item_id
3. Inyecta photo_path en cada producto
4. draw_cover() → portada con logo + caja info
5. draw_interior_pages() → 2 columnas, tarjetas por categoría
6. draw_closing() → página final
7. enviar_whatsapp_archivo(OUT_PDF) → envía al grupo

# Diseño tarjeta (CARD_H = 82pt):
┌────────────────────────────────────────┐
│ [FOTO 58x58] NOMBRE DEL PRODUCTO       │
│              Ref: SKU                   │
│              MeLi: $XX.XXX ~~tachado~~ │
│              $XX.XXX COP  Ahorras 10%  │
└────────────────────────────────────────┘

# Clave: fotos se obtienen por meli_id (col A de Sheets), NO por seller_custom_field.
# El seller_custom_field de MeLi usa formato "AS-XX" diferente a los SKUs del catálogo.
```

---

## CLI Menu (app/cli.py)

El servidor lanza un hilo con menú interactivo de **8 opciones** con submenús:

```
1  → Chat directo con Hugo García
2  → Facturas MeLi ↔ Siigo  [submenú: inteligente / 24h / N días / fecha / pack ID]
3  → Stock e inventario      [submenú: reporte completo / verificar SKUs / Sincronizar Web]
4  → Consultar producto en Google Sheets
5  → Forzar aprendizaje IA desde Q&A MeLi
6  → Registrar facturas de compra en SIIGO (desde Gmail)
7  → Generar contenido científico y publicar en WordPress
8  → Salir
```

---

## Pipeline de Contenido Multimedia (scripts de consola)

Capacidades de generación de contenido ya integradas. **No forman parte del CLI del agente** — se ejecutan directamente desde la terminal con `source venv/bin/activate` y el script correspondiente.

### Flujo del pipeline completo

```
Gemini (copy + prompts)
  └─ Ideogram (imagen de fondo con IA)
       └─ PIL (composición: texto, logo, paleta de marca)
            └─ ElevenLabs (narración TTS en español colombiano)
                 └─ fal.ai / Kling v1.6 (video desde imagen o texto)
                      └─ Facebook Graph API (publicación en página)
```

### Scripts

| Script | Uso | Descripción |
|--------|-----|-------------|
| `app/tools/pipeline_contenido_facebook.py` | `python3 -m app.tools.pipeline_contenido_facebook --tipo ficha --slug acido-ascorbico` | Pipeline completo Copy→Imagen→Voz→Video→Facebook. `--auto` elige el contenido automáticamente |
| `generar_infografias_facebook.py` | `python3 generar_infografias_facebook.py --tipo receta --n 3` | Infografías estáticas con PIL sin video ni audio |
| `sincronizar_facebook.py` | `python3 sincronizar_facebook.py` | Borra y republica la página con productos, guías y blog posts actuales |

### Tipos de contenido

- `ficha` — Ingrediente: beneficios, concentración, compatibilidad
- `receta` — Fórmula paso a paso con ingredientes
- `comparativa` — Dos ingredientes frente a frente
- `tip` — Consejo profesional de formulación

### Fallback de video

Si fal.ai no tiene saldo, `generar_video_ken_burns()` genera el video localmente con **ffmpeg** (efecto zoom cinematográfico sobre la imagen).

---

## Generación de Contenido Científico y Web

Scripts de investigación científica automatizada y publicación en WordPress. **No forman parte del CLI del agente** — se ejecutan directamente desde la terminal o desde la opción 7 del CLI.

### Módulo principal: knowledge_agent.py

```python
# app/tools/knowledge_agent.py — flujo:
1. buscar_pubmed(termino, max_results=5)
     → NCBI E-utilities API (gratuita, sin key)
     → Endpoints: esearch.fcgi + efetch.fcgi
     → Extrae: PMID, título, abstract, autores, año, URL
     → Query con filtros MeSH: cosmetic[MeSH] OR pharmaceutical[MeSH]
     → Fallback sin filtros si no retorna resultados

2. buscar_arxiv(termino, max_results=3)
     → ArXiv API Atom (gratuita, sin key)
     → URL: https://export.arxiv.org/api/query
     → Parsea XML: <entry>, <title>, <summary>, <published>
     → Útil para nanomateriales y tendencias emergentes

3. scrape_url(url)
     → scrapling (librería especializada de web scraping)
     → Fallback: requests + regex sobre <p> y <div>
     → Límite: 4000 caracteres por URL

4. generar_y_publicar_contenido(tema, tipo, publicar=True)
     → Tipos: "post_blog", "receta", "manual_uso", "ficha"
     → Síntesis por defecto **Gemini 2.5-Pro** (API); Ollama local solo con `AGENTE_SYNTHESIS_PRIMARY=ollama` o fallback explícito (ver `.env.example`)
     → Enriquece con referencias PubMed + ArXiv
     → Almacena embeddings en ChromaDB (para respuestas preventa)
     → Publica en WordPress vía REST API si publicar=True

5. publicar_en_wordpress(titulo, contenido, categoria_id)
     → Endpoint: https://mckennagroup.co/wp-json/wp/v2/posts
     → Auth: Base64(WP_USER:WP_APP_PASSWORD)
     → Variables: WP_USER, WP_APP_PASSWORD
```

### Scripts de generación masiva

| Script | Descripción | Output |
|--------|-------------|--------|
| `app/tools/generar_guias_masivas.py` | 62 ingredientes farmacéuticos/cosméticos. Cada guía tiene 7 secciones HTML: descripción, concentraciones (tabla), compatibilidad, incorporación, almacenamiento, normativa INVIMA, FAQ. Integra PubMed. | `/PAGINA_WEB/site/data/guias.json` |
| `generar_posts_masivos.py` | 20+ posts comparativos (ej: Niacinamida vs Clindamicina). Cada post incluye hallazgos contrastados, gráficas SVG/CSS inline, bibliografía. Usa PubMed con filtros MeSH. | `/PAGINA_WEB/site/data/posts.json` |
| `generar_recetas_masivas.py` | 40+ recetas de formulación en 4 categorías: cosmética, nutrición, perfumería, hogar. Genera ingredientes, cantidades, modo de preparación, precauciones con Gemini. | `/PAGINA_WEB/site/data/recetas.json` |

### Uso desde consola

```bash
# Knowledge agent (artículo específico)
source venv/bin/activate
python3 -c "
from app.tools.knowledge_agent import generar_y_publicar_contenido
generar_y_publicar_contenido('Niacinamida cosmética', 'post_blog', publicar=True)
"

# Guías masivas (62 ingredientes)
python3 -m app.tools.generar_guias_masivas

# Posts comparativos
python3 generar_posts_masivos.py

# Recetas de formulación
python3 generar_recetas_masivas.py
```

### Variables de entorno requeridas

```env
WP_USER            # Usuario WordPress con permisos de editor
WP_APP_PASSWORD    # Application Password (WP → Usuarios → Contraseñas de aplicación)
WC_URL             # https://mckennagroup.co (también usado como WP_URL base)
```

---
