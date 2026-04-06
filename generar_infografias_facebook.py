#!/usr/bin/env python3
"""
Generador de Infografías Facebook — McKenna Group
══════════════════════════════════════════════════
Genera 4 tipos de infografías visuales usando las guías técnicas y recetas
del sitio web, y las publica automáticamente en Facebook.

Tipos de infografía:
  1. Ficha de Ingrediente  — beneficios, concentración, compatibilidad
  2. Receta Paso a Paso    — ingredientes + pasos visuales
  3. Comparativa           — 2 ingredientes frente a frente
  4. Tip de Formulación    — consejo profesional con contexto técnico

Uso:
    source venv/bin/activate
    python3 generar_infografias_facebook.py           # publica todo
    python3 generar_infografias_facebook.py --dry-run # solo genera imágenes, no publica
    python3 generar_infografias_facebook.py --tipo ficha --n 3
"""

import os, sys, json, re, io, time, random, textwrap, argparse
from pathlib import Path
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).parent

# ── Cargar .env ───────────────────────────────────────────────────────────────
for line in (BASE / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

PAGE_ID = os.getenv("FB_PAGE_ID", "")
TOKEN   = os.getenv("FB_PAGE_ACCESS_TOKEN", "")
SITE    = "https://mckennagroup.co"

# ── Paleta visual McKenna ─────────────────────────────────────────────────────
C_DEEP   = (20,  61,  54)    # #143D36 verde oscuro
C_GREEN  = (46, 139, 122)    # #2E8B7A verde medio
C_TEAL   = (32, 110,  95)    # intermedio
C_LIGHT  = (232, 245, 243)   # #E8F5F3 casi blanco
C_ACCENT = (255, 200,  60)   # dorado/ámbar para acentos
C_WHITE  = (255, 255, 255)
C_DARK   = ( 15,  40,  35)   # casi negro
C_MUTED  = (160, 200, 190)
C_PANEL  = ( 28,  78,  68)   # panel oscuro
W, H     = 1200, 630

# ── Fuentes ───────────────────────────────────────────────────────────────────
_BOLD_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]
_REG_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
]

def _font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def fb(size): return _font(_BOLD_PATHS, size)
def fr(size): return _font(_REG_PATHS, size)


# ── Helpers de dibujo ─────────────────────────────────────────────────────────

def _gradiente(draw, w=W, h=H, c1=C_DEEP, c2=C_TEAL):
    for y in range(h):
        t = y / h
        r = int(c1[0] + (c2[0]-c1[0]) * t * 0.5)
        g = int(c1[1] + (c2[1]-c1[1]) * t * 0.5)
        b = int(c1[2] + (c2[2]-c1[2]) * t * 0.5)
        draw.line([(0,y),(w,y)], fill=(r,g,b))


def _logo(img, x=40, y=None, size=60):
    logo_path = BASE / "PAGINA_WEB/site/static/img/isotipo.png"
    if logo_path.exists():
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo = logo.resize((size, size), Image.LANCZOS)
            yy = H - size - 18 if y is None else y
            img.paste(logo, (x, yy), logo)
            return x + size + 12
        except Exception:
            pass
    return x


def _pie(draw, img):
    """Barra inferior con marca."""
    draw.rectangle([0, H-50, W, H], fill=C_DARK)
    _logo(img, x=20, y=H-46, size=38)
    draw.text((70, H-34), "McKenna Group S.A.S", font=fb(16), fill=C_MUTED)
    draw.text((W//2 - 80, H-34), SITE, font=fr(15), fill=C_MUTED)
    draw.text((W-230, H-34), "Materias primas Colombia", font=fr(14), fill=C_MUTED)


def _badge(draw, x, y, texto, bg=C_GREEN, fg=C_WHITE, radio=10):
    f = fb(16)
    bbox = draw.textbbox((0,0), texto, font=f)
    tw = bbox[2] - bbox[0]
    draw.rounded_rectangle([x, y, x+tw+24, y+30], radius=radio, fill=bg)
    draw.text((x+12, y+5), texto, font=f, fill=fg)
    return x + tw + 24 + 10


def _wrap(draw, texto, font, x, y, max_w, line_h, color, max_lines=10):
    words = texto.split()
    lines, current = [], ""
    for w in words:
        test = (current + " " + w).strip()
        bbox = draw.textbbox((0,0), test, font=font)
        if bbox[2]-bbox[0] <= max_w:
            current = test
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    lines = lines[:max_lines]
    for i, line in enumerate(lines):
        draw.text((x, y + i*line_h), line, font=font, fill=color)
    return y + len(lines)*line_h


def _strip_html(txt):
    return re.sub(r'<[^>]+>', '', txt or '').strip()


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 1 — FICHA DE INGREDIENTE
# ═══════════════════════════════════════════════════════════════════════════════

def _generar_copy_ficha(guia: dict) -> dict:
    """Usa Gemini para extraer copy estructurado de la guía."""
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY",""))

    nombre = guia.get("title_short", guia.get("title",""))
    categoria = guia.get("category","")
    tags = guia.get("tags", [])
    desc = guia.get("desc","")

    # Extraer texto de secciones
    secciones_txt = ""
    for sec in guia.get("secciones", [])[:4]:
        contenido = _strip_html(sec.get("contenido",""))[:400]
        secciones_txt += f"\n{sec.get('titulo','')}: {contenido}"

    prompt = f"""Eres experto en materias primas cosméticas y farmacéuticas de McKenna Group Colombia.
Basándote en esta información del ingrediente, genera el copy para una infografía de Facebook.

INGREDIENTE: {nombre}
CATEGORÍA: {categoria}
TAGS: {', '.join(tags)}
DESCRIPCIÓN: {desc}
CONTENIDO TÉCNICO: {secciones_txt[:800]}

Responde SOLO con JSON válido, sin markdown:
{{
  "nombre": "nombre corto del ingrediente (máx 25 chars)",
  "categoria_badge": "categoría corta (máx 20 chars)",
  "tagline": "frase de impacto (máx 50 chars)",
  "beneficios": ["beneficio 1 (máx 45 chars)", "beneficio 2", "beneficio 3", "beneficio 4"],
  "concentracion": "rango recomendado ej: 1-5% en emulsiones",
  "ph_optimo": "ej: 4.0 - 5.5",
  "compatible_con": "2-3 ingredientes compatibles",
  "evitar_con": "1-2 incompatibilidades clave",
  "dato_clave": "dato científico impactante (máx 80 chars)"
}}"""

    try:
        model = genai.GenerativeModel("gemini-2.5-flash-lite")
        resp = model.generate_content(prompt)
        txt = resp.text.strip()
        txt = re.sub(r'^```json\s*', '', txt)
        txt = re.sub(r'\s*```$', '', txt)
        return json.loads(txt)
    except Exception as e:
        print(f"  ⚠ Gemini copy ficha: {e}")
        return {
            "nombre": nombre[:25],
            "categoria_badge": categoria[:20],
            "tagline": desc[:50],
            "beneficios": tags[:4] if tags else ["Activo de alta pureza"],
            "concentracion": "Consultar ficha técnica",
            "ph_optimo": "Depende de la formulación",
            "compatible_con": "Consultar guía",
            "evitar_con": "Ver incompatibilidades",
            "dato_clave": "Ingrediente certificado McKenna Group"
        }


def infografia_ficha(guia: dict) -> bytes:
    """Template 1: Ficha visual del ingrediente."""
    copy = _generar_copy_ficha(guia)

    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)

    # Fondo gradiente
    _gradiente(draw)

    # Panel derecho claro
    draw.rectangle([720, 0, W, H-50], fill=C_PANEL)
    draw.rectangle([720, 0, 724, H-50], fill=C_GREEN)  # separador

    # ── LADO IZQUIERDO ──────────────────────────────────────────────────────
    # Acento lateral
    draw.rectangle([0, 0, 8, H], fill=C_ACCENT)

    # Badge categoría
    _badge(draw, 28, 30, copy.get("categoria_badge","Activo").upper(), bg=C_ACCENT, fg=C_DARK)

    # Nombre del ingrediente
    nombre = copy.get("nombre","Ingrediente")
    _wrap(draw, nombre, fb(68), 28, 75, 680, 72, C_WHITE, max_lines=2)

    # Línea decorativa
    draw.rectangle([28, 210, 340, 214], fill=C_GREEN)

    # Tagline
    _wrap(draw, copy.get("tagline",""), fr(22), 28, 226, 680, 30, C_MUTED, max_lines=2)

    # Beneficios
    draw.text((28, 290), "BENEFICIOS PRINCIPALES", font=fb(14), fill=C_ACCENT)
    beneficios = copy.get("beneficios", [])[:4]
    icons = ["◆", "◆", "◆", "◆"]
    for i, b in enumerate(beneficios):
        y_b = 315 + i*52
        # Círculo ícono
        draw.ellipse([28, y_b+2, 48, y_b+22], fill=C_GREEN)
        draw.text((33, y_b+3), icons[i], font=fb(12), fill=C_WHITE)
        draw.text((58, y_b), b[:48], font=fr(20), fill=C_WHITE)

    # ── LADO DERECHO ─────────────────────────────────────────────────────────
    x_r = 745

    draw.text((x_r, 28), "DATOS TÉCNICOS", font=fb(16), fill=C_ACCENT)
    draw.rectangle([x_r, 52, W-28, 54], fill=C_GREEN)

    # Concentración
    draw.text((x_r, 68), "Concentración recomendada", font=fr(15), fill=C_MUTED)
    _wrap(draw, copy.get("concentracion",""), fb(20), x_r, 90, 430, 26, C_WHITE, max_lines=2)

    # pH
    draw.text((x_r, 148), "pH óptimo", font=fr(15), fill=C_MUTED)
    _wrap(draw, copy.get("ph_optimo",""), fb(20), x_r, 168, 430, 26, C_WHITE, max_lines=1)

    # Compatible con
    draw.rectangle([x_r, 208, W-28, 210], fill=C_TEAL)
    draw.text((x_r, 218), "Compatible con", font=fr(15), fill=C_MUTED)
    _wrap(draw, copy.get("compatible_con",""), fb(18), x_r, 238, 430, 26, C_LIGHT, max_lines=2)

    # Evitar con
    draw.text((x_r, 296), "Evitar combinar con", font=fr(15), fill=C_MUTED)
    _wrap(draw, copy.get("evitar_con",""), fb(18), x_r, 316, 430, 26, (255,180,180), max_lines=2)

    # Dato clave — caja destacada
    draw.rounded_rectangle([x_r, 370, W-28, 470], radius=12, fill=C_DEEP)
    draw.rounded_rectangle([x_r, 370, W-28, 474], radius=12, outline=C_ACCENT, width=2)
    draw.text((x_r+14, 382), "DATO CLAVE", font=fb(13), fill=C_ACCENT)
    _wrap(draw, copy.get("dato_clave",""), fr(18), x_r+14, 404, 410, 28, C_WHITE, max_lines=3)

    # CTA
    draw.rounded_rectangle([x_r, 488, W-28, 528], radius=8, fill=C_GREEN)
    draw.text((x_r+14, 498), f"Ver guía completa → {SITE}/guias", font=fb(16), fill=C_WHITE)

    # Pie
    _pie(draw, img)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 2 — RECETA PASO A PASO
# ═══════════════════════════════════════════════════════════════════════════════

def infografia_receta(receta: dict) -> bytes:
    """Template 2: Receta visual paso a paso."""

    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    _gradiente(draw, c2=C_GREEN)

    # Acento lateral
    draw.rectangle([0, 0, 8, H], fill=C_ACCENT)

    # Header
    cat_labels = {"cosmetica":"COSMÉTICA","nutricion":"NUTRICIÓN","perfumeria":"PERFUMERÍA","hogar":"HOGAR"}
    cat = cat_labels.get(receta.get("cat",""), receta.get("cat","").upper())
    _badge(draw, 28, 22, cat, bg=C_ACCENT, fg=C_DARK)
    _badge(draw, 28+len(cat)*11+40, 22, f"Base {receta.get('base',100)}{receta.get('unidad','ml')}", bg=C_PANEL, fg=C_WHITE)

    # Título
    titulo = f"{receta.get('title','')} {receta.get('title2','')}".strip()
    _wrap(draw, titulo, fb(58), 28, 68, 700, 64, C_WHITE, max_lines=2)

    # Línea
    draw.rectangle([28, 198, 380, 202], fill=C_ACCENT)

    # Desc
    _wrap(draw, receta.get("desc",""), fr(19), 28, 212, 700, 28, C_MUTED, max_lines=2)

    # ── Ingredientes (top 4) ──────────────────────────────────────────────────
    draw.text((28, 268), "INGREDIENTES CLAVE", font=fb(14), fill=C_ACCENT)
    ings = receta.get("ings", [])[:4]
    for i, ing in enumerate(ings):
        x_i = 28 + i * 170
        # Caja
        draw.rounded_rectangle([x_i, 290, x_i+158, 360], radius=10, fill=C_PANEL)
        draw.rounded_rectangle([x_i, 290, x_i+158, 296], radius=10, fill=C_GREEN)
        qty = f"{ing.get('q','')}{ing.get('u','')}"
        draw.text((x_i+8, 298), qty, font=fb(18), fill=C_ACCENT)
        _wrap(draw, ing.get("n",""), fr(14), x_i+8, 322, 148, 18, C_LIGHT, max_lines=2)

    # ── Pasos ──────────────────────────────────────────────────────────────────
    draw.text((28, 378), "PREPARACIÓN", font=fb(14), fill=C_ACCENT)
    pasos = receta.get("pasos", [])[:3]
    for i, paso in enumerate(pasos):
        y_p = 400 + i * 62
        # Número círculo
        draw.ellipse([28, y_p, 54, y_p+26], fill=C_GREEN)
        draw.text((36, y_p+3), str(i+1), font=fb(16), fill=C_WHITE)
        paso_txt = _strip_html(str(paso))[:90]
        _wrap(draw, paso_txt, fr(18), 64, y_p+2, 640, 24, C_WHITE, max_lines=2)

    # ── Tip (panel derecho) ───────────────────────────────────────────────────
    draw.rounded_rectangle([740, 22, W-22, 528], radius=14, fill=C_PANEL)
    draw.rounded_rectangle([740, 22, W-22, 28], radius=14, fill=C_ACCENT)
    draw.text((760, 36), "TIP DE FORMULACIÓN", font=fb(15), fill=C_ACCENT)
    draw.rectangle([760, 60, 1165, 63], fill=C_GREEN)
    tip = receta.get("tip","") or "Sigue las concentraciones exactas para mejores resultados."
    _wrap(draw, tip, fr(19), 760, 78, 390, 28, C_WHITE, max_lines=6)

    # Tags
    tags = receta.get("tags", [])[:3]
    y_tag = 310
    for tag in tags:
        _badge(draw, 760, y_tag, f"#{tag}", bg=C_GREEN, fg=C_WHITE, radio=8)
        y_tag += 44

    # Separador
    draw.rectangle([760, 430, 1165, 432], fill=C_TEAL)
    draw.text((760, 442), "Ingredientes disponibles en:", font=fr(16), fill=C_MUTED)
    draw.text((760, 466), SITE + "/catalogo", font=fb(18), fill=C_ACCENT)

    _pie(draw, img)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 3 — COMPARATIVA DE INGREDIENTES
# ═══════════════════════════════════════════════════════════════════════════════

def _generar_copy_comparativa(guia_a: dict, guia_b: dict) -> dict:
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY",""))

    nombre_a = guia_a.get("title_short", "")
    nombre_b = guia_b.get("title_short", "")
    cat_a = guia_a.get("category","")
    cat_b = guia_b.get("category","")

    prompt = f"""Compara estos dos ingredientes cosméticos/farmacéuticos de McKenna Group para una infografía de Facebook.
A: {nombre_a} ({cat_a})
B: {nombre_b} ({cat_b})

Responde SOLO con JSON válido:
{{
  "titulo": "titulo comparativa atractivo (máx 55 chars)",
  "a_ventajas": ["ventaja 1 (máx 40 chars)", "ventaja 2", "ventaja 3"],
  "b_ventajas": ["ventaja 1 (máx 40 chars)", "ventaja 2", "ventaja 3"],
  "a_uso_ideal": "cuándo usar A (máx 50 chars)",
  "b_uso_ideal": "cuándo usar B (máx 50 chars)",
  "conclusion": "cuál elegir según el objetivo (máx 90 chars)"
}}"""

    try:
        model = genai.GenerativeModel("gemini-2.5-flash-lite")
        resp = model.generate_content(prompt)
        txt = resp.text.strip()
        txt = re.sub(r'^```json\s*', '', txt)
        txt = re.sub(r'\s*```$', '', txt)
        return json.loads(txt)
    except Exception as e:
        print(f"  ⚠ Gemini comparativa: {e}")
        return {
            "titulo": f"{nombre_a} vs {nombre_b}",
            "a_ventajas": ["Alta eficacia", "Bien estudiado", "Versatil"],
            "b_ventajas": ["Alta eficacia", "Bien estudiado", "Versatil"],
            "a_uso_ideal": "Consultar guía técnica",
            "b_uso_ideal": "Consultar guía técnica",
            "conclusion": "Depende del objetivo de tu formulación"
        }


def infografia_comparativa(guia_a: dict, guia_b: dict) -> bytes:
    """Template 3: Comparativa visual de dos ingredientes."""
    copy = _generar_copy_comparativa(guia_a, guia_b)

    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)

    nombre_a = guia_a.get("title_short","A")
    nombre_b = guia_b.get("title_short","B")

    # Fondo split: izquierda oscura, derecha más teal
    for y in range(H-50):
        t = y / (H-50)
        left  = tuple(int(C_DEEP[i]+(C_TEAL[i]-C_DEEP[i])*t*0.3) for i in range(3))
        right = tuple(int(C_TEAL[i]+(C_GREEN[i]-C_TEAL[i])*t*0.3) for i in range(3))
        draw.line([(0,y),(W//2-2,y)], fill=left)
        draw.line([(W//2+2,y),(W,y)], fill=right)

    # Separador central
    draw.rectangle([W//2-3, 0, W//2+3, H-50], fill=C_ACCENT)
    draw.text((W//2-18, H//2-20), "VS", font=fb(28), fill=C_DARK)
    draw.ellipse([W//2-30, H//2-30, W//2+30, H//2+30], outline=C_ACCENT, width=3)

    # Acento superior
    draw.rectangle([0, 0, W, 8], fill=C_ACCENT)

    # Título
    _wrap(draw, copy.get("titulo",""), fb(38), 28, 18, W-56, 44, C_WHITE, max_lines=1)

    # ── LADO A ────────────────────────────────────────────────────────────────
    draw.text((30, 72), nombre_a.upper(), font=fb(42), fill=C_WHITE)
    draw.rectangle([30, 122, 280, 125], fill=C_ACCENT)

    draw.text((30, 136), "VENTAJAS", font=fb(14), fill=C_MUTED)
    for i, v in enumerate(copy.get("a_ventajas",[])[:3]):
        y_v = 160 + i * 50
        draw.ellipse([30, y_v+4, 48, y_v+22], fill=C_ACCENT)
        draw.text((34, y_v+4), "✓", font=fb(14), fill=C_DARK)
        draw.text((56, y_v), v[:42], font=fr(19), fill=C_WHITE)

    draw.text((30, 320), "IDEAL PARA:", font=fb(14), fill=C_MUTED)
    _wrap(draw, copy.get("a_uso_ideal",""), fb(19), 30, 342, 530, 26, C_LIGHT, max_lines=2)

    # ── LADO B ────────────────────────────────────────────────────────────────
    x_b = W//2 + 20
    draw.text((x_b, 72), nombre_b.upper(), font=fb(42), fill=C_WHITE)
    draw.rectangle([x_b, 122, x_b+250, 125], fill=C_ACCENT)

    draw.text((x_b, 136), "VENTAJAS", font=fb(14), fill=C_MUTED)
    for i, v in enumerate(copy.get("b_ventajas",[])[:3]):
        y_v = 160 + i * 50
        draw.ellipse([x_b, y_v+4, x_b+18, y_v+22], fill=C_GREEN)
        draw.text((x_b+4, y_v+4), "✓", font=fb(14), fill=C_WHITE)
        draw.text((x_b+26, y_v), v[:42], font=fr(19), fill=C_WHITE)

    draw.text((x_b, 320), "IDEAL PARA:", font=fb(14), fill=C_MUTED)
    _wrap(draw, copy.get("b_uso_ideal",""), fb(19), x_b, 342, 530, 26, C_LIGHT, max_lines=2)

    # ── Conclusión ────────────────────────────────────────────────────────────
    draw.rounded_rectangle([28, 410, W-28, 485], radius=12, fill=C_DARK)
    draw.rounded_rectangle([28, 410, W-28, 487], radius=12, outline=C_ACCENT, width=2)
    draw.text((48, 420), "CONCLUSIÓN", font=fb(14), fill=C_ACCENT)
    _wrap(draw, copy.get("conclusion",""), fr(20), 48, 444, W-96, 28, C_WHITE, max_lines=2)

    _pie(draw, img)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATE 4 — TIP DE FORMULACIÓN
# ═══════════════════════════════════════════════════════════════════════════════

def _generar_copy_tip(guia: dict) -> dict:
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY",""))

    nombre = guia.get("title_short","")
    secciones_txt = ""
    for sec in guia.get("secciones",[])[:5]:
        secciones_txt += _strip_html(sec.get("contenido",""))[:300] + " "

    prompt = f"""Eres formulador experto de McKenna Group Colombia.
Extrae el tip de formulación más valioso y no obvio sobre {nombre}.

Contenido técnico disponible: {secciones_txt[:800]}

Responde SOLO con JSON válido:
{{
  "titulo_tip": "Tip corto y llamativo (máx 55 chars)",
  "ingrediente": "{nombre}",
  "tip_principal": "el consejo más valioso, concreto y técnico (máx 120 chars)",
  "por_que": "explicación del porqué (máx 100 chars)",
  "error_comun": "error que cometen los formuladores (máx 90 chars)",
  "pro_tip": "consejo avanzado extra (máx 80 chars)",
  "aplicaciones": ["aplicación 1 (máx 30 chars)", "aplicación 2", "aplicación 3"]
}}"""

    try:
        model = genai.GenerativeModel("gemini-2.5-flash-lite")
        resp = model.generate_content(prompt)
        txt = resp.text.strip()
        txt = re.sub(r'^```json\s*', '', txt)
        txt = re.sub(r'\s*```$', '', txt)
        return json.loads(txt)
    except Exception as e:
        print(f"  ⚠ Gemini tip: {e}")
        return {
            "titulo_tip": f"Tip de formulación: {nombre}",
            "ingrediente": nombre,
            "tip_principal": "Respetar la concentración recomendada es clave para la eficacia.",
            "por_que": "Las concentraciones muy altas pueden causar irritación.",
            "error_comun": "No ajustar el pH antes de agregar el activo.",
            "pro_tip": "Siempre hacer prueba de estabilidad a 40°C por 30 días.",
            "aplicaciones": ["Emulsiones", "Serums", "Cremas"]
        }


def infografia_tip(guia: dict) -> bytes:
    """Template 4: Tip de formulación profesional."""
    copy = _generar_copy_tip(guia)

    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    _gradiente(draw)

    # Acento lateral grueso
    draw.rectangle([0, 0, 12, H], fill=C_ACCENT)

    # Header badge
    draw.rounded_rectangle([28, 18, 160, 52], radius=8, fill=C_ACCENT)
    draw.text((42, 26), "TIP PRO", font=fb(20), fill=C_DARK)

    draw.text((175, 24), copy.get("ingrediente","").upper(), font=fb(22), fill=C_MUTED)

    # Título
    _wrap(draw, copy.get("titulo_tip",""), fb(52), 28, 64, 700, 58, C_WHITE, max_lines=2)
    draw.rectangle([28, 186, 450, 190], fill=C_GREEN)

    # Tip principal — caja grande
    draw.rounded_rectangle([28, 204, 710, 316], radius=12, fill=C_PANEL)
    draw.rounded_rectangle([28, 204, 36, 316], radius=4, fill=C_ACCENT)
    draw.text((50, 214), "EL CONSEJO", font=fb(13), fill=C_ACCENT)
    _wrap(draw, copy.get("tip_principal",""), fr(21), 50, 236, 650, 30, C_WHITE, max_lines=3)

    # Por qué
    draw.text((28, 330), "¿POR QUÉ?", font=fb(14), fill=C_MUTED)
    _wrap(draw, copy.get("por_que",""), fr(19), 28, 352, 700, 28, C_LIGHT, max_lines=2)

    # Error común
    draw.rounded_rectangle([28, 400, 710, 464], radius=8, fill=(60,20,20))
    draw.rounded_rectangle([28, 400, 36, 464], radius=4, fill=(220,80,80))
    draw.text((50, 410), "⚠  ERROR COMÚN", font=fb(14), fill=(255,140,140))
    _wrap(draw, copy.get("error_comun",""), fr(18), 50, 432, 650, 26, (255,200,200), max_lines=2)

    # ── Panel derecho ─────────────────────────────────────────────────────────
    x_r = 740
    draw.rounded_rectangle([x_r, 18, W-22, 528], radius=14, fill=C_PANEL)

    # PRO TIP box
    draw.rounded_rectangle([x_r+14, 30, W-36, 130], radius=10, fill=C_DEEP)
    draw.rounded_rectangle([x_r+14, 30, W-36, 40], radius=10, fill=C_GREEN)
    draw.text((x_r+28, 44), "PRO TIP", font=fb(14), fill=C_ACCENT)
    _wrap(draw, copy.get("pro_tip",""), fr(18), x_r+28, 66, 390, 28, C_WHITE, max_lines=3)

    # Aplicaciones
    draw.text((x_r+14, 148), "APLICACIONES", font=fb(14), fill=C_ACCENT)
    draw.rectangle([x_r+14, 170, W-36, 172], fill=C_GREEN)
    apps = copy.get("aplicaciones",[])[:3]
    for i, app in enumerate(apps):
        y_a = 182 + i * 52
        draw.rounded_rectangle([x_r+14, y_a, W-36, y_a+40], radius=8, fill=C_TEAL)
        draw.text((x_r+28, y_a+10), f"◆  {app[:30]}", font=fb(17), fill=C_WHITE)

    # CTA
    draw.rounded_rectangle([x_r+14, 358, W-36, 410], radius=10, fill=C_GREEN)
    draw.text((x_r+28, 368), "Ver guía técnica completa", font=fb(16), fill=C_WHITE)
    draw.text((x_r+28, 390), f"{SITE}/guias", font=fr(14), fill=C_LIGHT)

    # Stock badge
    draw.rounded_rectangle([x_r+14, 424, W-36, 470], radius=10, fill=C_ACCENT)
    draw.text((x_r+28, 436), "✓  Disponible en stock", font=fb(16), fill=C_DARK)
    draw.text((x_r+28, 456), "Entregas a todo Colombia", font=fr(14), fill=C_DARK)

    _pie(draw, img)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════════════════════════
# FACEBOOK API
# ═══════════════════════════════════════════════════════════════════════════════

def fb_publicar_foto(imagen_bytes: bytes, caption: str) -> dict:
    import requests as req
    r = req.post(
        f"https://graph.facebook.com/v19.0/{PAGE_ID}/photos",
        files={"source": ("infografia.jpg", imagen_bytes, "image/jpeg")},
        data={"caption": caption, "access_token": TOKEN},
        timeout=30
    )
    return r.json()


# ═══════════════════════════════════════════════════════════════════════════════
# CARGAR DATOS
# ═══════════════════════════════════════════════════════════════════════════════

def cargar_guias() -> list:
    path = BASE / "PAGINA_WEB/site/data/guias.json"
    guias = json.loads(path.read_text())
    # Solo guías publicadas con secciones
    return [g for g in guias if g.get("publicada") and g.get("secciones")]


def cargar_recetas() -> list:
    path = BASE / "PAGINA_WEB/site/data/recetas.json"
    return json.loads(path.read_text())


# ═══════════════════════════════════════════════════════════════════════════════
# REGISTRO DE LO YA PUBLICADO
# ═══════════════════════════════════════════════════════════════════════════════

REGISTRO_PATH = BASE / "app/data/infografias_publicadas.json"

def cargar_registro() -> dict:
    if REGISTRO_PATH.exists():
        return json.loads(REGISTRO_PATH.read_text())
    return {"fichas":[], "recetas":[], "comparativas":[], "tips":[]}


def guardar_registro(reg: dict):
    REGISTRO_PATH.write_text(json.dumps(reg, ensure_ascii=False, indent=2))


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Solo genera imágenes, no publica")
    parser.add_argument("--tipo", choices=["ficha","receta","comparativa","tip","todas"], default="todas")
    parser.add_argument("--n", type=int, default=2, help="Cantidad por tipo")
    parser.add_argument("--guardar-dir", default="", help="Directorio para guardar imágenes localmente")
    args = parser.parse_args()

    print("═"*60)
    print("  INFOGRAFÍAS FACEBOOK — McKenna Group")
    print("═"*60)

    guias   = cargar_guias()
    recetas = cargar_recetas()
    reg     = cargar_registro()

    random.shuffle(guias)
    random.shuffle(recetas)

    publicados = 0
    guardados  = 0
    save_dir   = Path(args.guardar_dir) if args.guardar_dir else None
    if save_dir:
        save_dir.mkdir(parents=True, exist_ok=True)

    # ── FICHAS DE INGREDIENTE ────────────────────────────────────────────────
    if args.tipo in ("ficha","todas"):
        print(f"\n🧪 FICHAS DE INGREDIENTE (máx {args.n})")
        count = 0
        for guia in guias:
            if count >= args.n:
                break
            slug = guia["slug"]
            if slug in reg["fichas"]:
                continue
            nombre = guia.get("title_short", guia["title"])
            print(f"  → Generando ficha: {nombre}")
            try:
                img_bytes = infografia_ficha(guia)

                if save_dir:
                    fname = save_dir / f"ficha_{slug}.jpg"
                    fname.write_bytes(img_bytes)
                    print(f"     Guardada: {fname}")
                    guardados += 1

                if not args.dry_run:
                    caption = (
                        f"🧪 {nombre} — Todo lo que necesitas saber\n\n"
                        f"{guia.get('desc','')[:200]}\n\n"
                        f"📋 Guía técnica completa: {SITE}/guias/{slug}\n"
                        f"🛒 Disponible en stock · Entregas a todo Colombia\n"
                        f"💬 Cotiza por WhatsApp"
                    )
                    r = fb_publicar_foto(img_bytes, caption)
                    if r.get("id") or r.get("post_id"):
                        print(f"     ✅ Publicado en Facebook")
                        reg["fichas"].append(slug)
                        guardar_registro(reg)
                        publicados += 1
                    else:
                        print(f"     ⚠ {r.get('error',{}).get('message','error')[:70]}")
                    time.sleep(6)
                else:
                    reg["fichas"].append(slug)
                count += 1
            except Exception as e:
                print(f"     ❌ {e}")

    # ── RECETAS ───────────────────────────────────────────────────────────────
    if args.tipo in ("receta","todas"):
        print(f"\n🧴 RECETAS PASO A PASO (máx {args.n})")
        count = 0
        for receta in recetas:
            if count >= args.n:
                break
            rid = str(receta.get("id",""))
            if rid in reg["recetas"]:
                continue
            nombre = f"{receta.get('title','')} {receta.get('title2','')}".strip()
            print(f"  → Generando receta: {nombre}")
            try:
                img_bytes = infografia_receta(receta)

                if save_dir:
                    fname = save_dir / f"receta_{rid}.jpg"
                    fname.write_bytes(img_bytes)
                    print(f"     Guardada: {fname}")
                    guardados += 1

                if not args.dry_run:
                    ings_str = " · ".join(i["n"] for i in receta.get("ings",[])[:3])
                    caption = (
                        f"🧴 Receta: {nombre}\n\n"
                        f"{receta.get('desc','')}\n\n"
                        f"Ingredientes principales: {ings_str}\n\n"
                        f"🔗 Receta completa: {SITE}/recetario\n"
                        f"🛒 Todos los ingredientes disponibles en McKenna Group"
                    )
                    r = fb_publicar_foto(img_bytes, caption)
                    if r.get("id") or r.get("post_id"):
                        print(f"     ✅ Publicado en Facebook")
                        reg["recetas"].append(rid)
                        guardar_registro(reg)
                        publicados += 1
                    else:
                        print(f"     ⚠ {r.get('error',{}).get('message','error')[:70]}")
                    time.sleep(6)
                else:
                    reg["recetas"].append(rid)
                count += 1
            except Exception as e:
                print(f"     ❌ {e}")

    # ── COMPARATIVAS ──────────────────────────────────────────────────────────
    if args.tipo in ("comparativa","todas"):
        print(f"\n⚖️  COMPARATIVAS (máx {args.n})")
        # Pares naturales de ingredientes similares
        pares_sugeridos = [
            ("alfa-arbutina","acido-kojico"),
            ("acido-glicolico","acido-lactico"),
            ("retinol","niacinamida"),
            ("acido-hialuronico","colageno-hidrolizado"),
            ("oxido-de-zinc","dioxido-de-titanio"),
        ]
        slugs = {g["slug"]: g for g in guias}
        count = 0
        for slug_a, slug_b in pares_sugeridos:
            if count >= args.n:
                break
            par_key = f"{slug_a}_{slug_b}"
            if par_key in reg["comparativas"]:
                continue
            guia_a = slugs.get(slug_a)
            guia_b = slugs.get(slug_b)
            if not guia_a or not guia_b:
                continue
            nombre_a = guia_a.get("title_short","")
            nombre_b = guia_b.get("title_short","")
            print(f"  → Comparativa: {nombre_a} vs {nombre_b}")
            try:
                img_bytes = infografia_comparativa(guia_a, guia_b)

                if save_dir:
                    fname = save_dir / f"comparativa_{slug_a}_vs_{slug_b}.jpg"
                    fname.write_bytes(img_bytes)
                    print(f"     Guardada: {fname}")
                    guardados += 1

                if not args.dry_run:
                    caption = (
                        f"⚖️ {nombre_a} vs {nombre_b}: ¿Cuál elegir para tu formulación?\n\n"
                        f"Dos de los activos más populares en cosmética. "
                        f"¿Sabes cuándo usar cada uno?\n\n"
                        f"📋 Guías técnicas: {SITE}/guias\n"
                        f"🛒 Ambos disponibles en McKenna Group"
                    )
                    r = fb_publicar_foto(img_bytes, caption)
                    if r.get("id") or r.get("post_id"):
                        print(f"     ✅ Publicado en Facebook")
                        reg["comparativas"].append(par_key)
                        guardar_registro(reg)
                        publicados += 1
                    else:
                        print(f"     ⚠ {r.get('error',{}).get('message','error')[:70]}")
                    time.sleep(6)
                else:
                    reg["comparativas"].append(par_key)
                count += 1
            except Exception as e:
                print(f"     ❌ {e}")

    # ── TIPS ──────────────────────────────────────────────────────────────────
    if args.tipo in ("tip","todas"):
        print(f"\n💡 TIPS DE FORMULACIÓN (máx {args.n})")
        count = 0
        for guia in guias:
            if count >= args.n:
                break
            slug = guia["slug"]
            if slug in reg["tips"]:
                continue
            nombre = guia.get("title_short", guia["title"])
            print(f"  → Generando tip: {nombre}")
            try:
                img_bytes = infografia_tip(guia)

                if save_dir:
                    fname = save_dir / f"tip_{slug}.jpg"
                    fname.write_bytes(img_bytes)
                    print(f"     Guardada: {fname}")
                    guardados += 1

                if not args.dry_run:
                    caption = (
                        f"💡 Tip de formulación: {nombre}\n\n"
                        f"Este consejo puede marcar la diferencia en tu próxima formulación.\n\n"
                        f"📋 Guía técnica completa: {SITE}/guias/{slug}\n"
                        f"🛒 {nombre} disponible en McKenna Group · Envíos a todo Colombia"
                    )
                    r = fb_publicar_foto(img_bytes, caption)
                    if r.get("id") or r.get("post_id"):
                        print(f"     ✅ Publicado en Facebook")
                        reg["tips"].append(slug)
                        guardar_registro(reg)
                        publicados += 1
                    else:
                        print(f"     ⚠ {r.get('error',{}).get('message','error')[:70]}")
                    time.sleep(6)
                else:
                    reg["tips"].append(slug)
                count += 1
            except Exception as e:
                print(f"     ❌ {e}")

    print("\n" + "═"*60)
    if args.dry_run:
        print(f"  DRY-RUN — Imágenes generadas: {guardados}")
    else:
        print(f"  ✅ COMPLETADO — {publicados} infografías publicadas en Facebook")
    print("═"*60)


if __name__ == "__main__":
    main()
