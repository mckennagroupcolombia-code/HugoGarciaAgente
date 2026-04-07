#!/usr/bin/env python3
"""
Pipeline de Contenido Visual — McKenna Group
═════════════════════════════════════════════
Copy (Gemini) → Imagen (Ideogram) → Voz (ElevenLabs) → Video (fal.ai/Kling) → Facebook

Uso:
    python3 pipeline_contenido_facebook.py --tipo ficha --slug acido-ascorbico
    python3 pipeline_contenido_facebook.py --tipo receta --id 1
    python3 pipeline_contenido_facebook.py --tipo comparativa --slugs acido-kojico alfa-arbutina
    python3 pipeline_contenido_facebook.py --tipo tip --slug niacinamida
    python3 pipeline_contenido_facebook.py --auto           # elige contenido nuevo automáticamente
    python3 pipeline_contenido_facebook.py --dry-run --tipo ficha --slug acido-ascorbico
"""

import os, sys, json, re, time, tempfile, subprocess, argparse, random
from pathlib import Path
import requests

BASE = Path(__file__).parent

# ── Cargar .env ───────────────────────────────────────────────────────────────
for line in (BASE / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

# ── Config ────────────────────────────────────────────────────────────────────
GOOGLE_KEY      = os.getenv("GOOGLE_API_KEY", "")
IDEOGRAM_KEY    = os.getenv("IDEOGRAM_API_KEY", "")
ELEVENLABS_KEY  = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE= os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9")  # Liam (multilingual)
FAL_KEY         = os.getenv("FAL_KEY", "")
FB_PAGE_ID      = os.getenv("FB_PAGE_ID", "")
FB_TOKEN        = os.getenv("FB_PAGE_ACCESS_TOKEN", "")
SITE            = "https://mckennagroup.co"

REGISTRO_PATH   = BASE / "app/data/pipeline_publicados.json"
TEMP_DIR        = BASE / "pipeline_temp"
TEMP_DIR.mkdir(exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 0 — CARGAR DATOS
# ═══════════════════════════════════════════════════════════════════════════════

def cargar_guias() -> list:
    data = json.loads((BASE / "PAGINA_WEB/site/data/guias.json").read_text())
    return [g for g in data if g.get("publicada") and g.get("secciones")]

def cargar_recetas() -> list:
    return json.loads((BASE / "PAGINA_WEB/site/data/recetas.json").read_text())

def cargar_registro() -> dict:
    if REGISTRO_PATH.exists():
        return json.loads(REGISTRO_PATH.read_text())
    return {"fichas":[], "recetas":[], "comparativas":[], "tips":[]}

def guardar_registro(reg: dict):
    REGISTRO_PATH.write_text(json.dumps(reg, ensure_ascii=False, indent=2))

def strip_html(txt: str) -> str:
    return re.sub(r'<[^>]+>', '', txt or '').strip()


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 1 — GEMINI: GENERA EL COPY COMPLETO
# ═══════════════════════════════════════════════════════════════════════════════

def generar_copy(tipo: str, datos: dict) -> dict:
    """
    Devuelve:
      - prompt_imagen: descripción detallada para Ideogram
      - narracion: texto para ElevenLabs (25-40 palabras, español colombiano natural)
      - prompt_video: descripción del movimiento para Kling
      - caption_facebook: texto del post
      - hashtags: lista de hashtags
    """
    from google import genai
    client = genai.Client(api_key=GOOGLE_KEY)

    nombre = datos.get("nombre", "")
    desc   = datos.get("desc", "")
    info   = datos.get("info_extra", "")

    if tipo == "ficha":
        instruccion = f"""
Ingrediente: {nombre}
Categoría: {datos.get('categoria','')}
Tags: {', '.join(datos.get('tags',[]))}
Descripción: {desc}
Info técnica: {info[:600]}
"""
        tarea = "infografía profesional de ingrediente cosmético/farmacéutico"
        url_ref = f"{SITE}/guias/{datos.get('slug','')}"

    elif tipo == "receta":
        ings = ", ".join(f"{i['n']} {i['q']}{i['u']}" for i in datos.get("ings",[])[:4])
        instruccion = f"""
Receta: {nombre}
Categoría: {datos.get('cat','')}
Descripción: {desc}
Ingredientes principales: {ings}
Tip: {datos.get('tip','')}
"""
        tarea = "infografía de receta cosmética paso a paso"
        url_ref = f"{SITE}/recetario"

    elif tipo == "comparativa":
        instruccion = f"""
Ingrediente A: {datos.get('nombre_a','')}
Ingrediente B: {datos.get('nombre_b','')}
Contexto: {desc}
"""
        tarea = "infografía comparativa de dos ingredientes cosméticos"
        url_ref = f"{SITE}/guias"

    else:  # tip
        instruccion = f"""
Ingrediente: {nombre}
Tip técnico basado en: {info[:600]}
"""
        tarea = "infografía de tip profesional de formulación cosmética"
        url_ref = f"{SITE}/guias/{datos.get('slug','')}"

    prompt = f"""Eres el director creativo de McKenna Group S.A.S., empresa colombiana de materias primas cosméticas y farmacéuticas.

Crea el contenido para una {tarea} para Facebook.

INFORMACIÓN:
{instruccion}

REGLAS IMPORTANTES:
- NO menciones INVIMA (las materias primas solo requieren visto bueno de importación, no certificación INVIMA)
- NO menciones la página web ni URLs en la narración
- NO uses la palabra "Reels"
- La narración debe sonar natural, como si fuera un formulador hablando a otro formulador
- Los puntos clave deben ser beneficios técnicos reales y concretos

MARCA: McKenna Group S.A.S. · Paleta verde oscuro #143D36, dorado #F5C842
TONO: Técnico, directo, colombiano, entre colegas formuladores

Responde SOLO con JSON válido, sin markdown:
{{
  "titulo_principal": "título impactante máx 7 palabras",
  "subtitulo": "dato técnico concreto máx 10 palabras",
  "puntos_clave": ["beneficio técnico concreto máx 6 palabras", "punto 2", "punto 3", "punto 4"],
  "dato_destacado": "dato científico sorprendente máx 10 palabras",
  "cta": "llamada a la acción corta máx 5 palabras",
  "narracion": "narración en español colombiano profesional, 30-38 palabras. Tono de experto técnico: directo, claro, sin jerga ni coloquialismos. PROHIBIDO usar: Parce, Colega, Veci, Amigo, Chévere. Menciona McKenna Group al final de forma natural.",
  "escenas_video": [
    "escena 1 en inglés (10s): female scientist with glasses and white lab coat in a modern cosmetics laboratory, examining glass samples on stainless steel workbench, professional warm lighting, slow cinematic dolly camera, ultra realistic 4K, no text",
    "escena 2 en inglés (10s): extreme close-up macro shot of a glass beaker on stainless steel lab bench filled with the ingredient liquid or substance, the material shimmers under laboratory lighting, slow cinematic camera pull-back revealing full beaker and lab tools, ultra realistic 4K, no text"
  ],
  "caption_facebook": "texto del post. 2-3 líneas directas. Emoji técnico al inicio. Sin URLs largas. CTA al final invitando a cotizar por WhatsApp o comentar.",
  "hashtags": ["#McKennaGroup", "#MateriaPrima", "#Formulación", "#Cosmética", "#Colombia", "#Laboratorio"]
}}"""

    resp = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=prompt,
        config={"temperature": 0.8, "max_output_tokens": 2048}
    )
    txt = resp.text.strip()
    txt = re.sub(r'^```json\s*', '', txt)
    txt = re.sub(r'\s*```$', '', txt)
    return json.loads(txt)


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 2A — IDEOGRAM: GENERA EL FONDO VISUAL (sin texto)
# ═══════════════════════════════════════════════════════════════════════════════

# Prompts de fondo por categoría de ingrediente
_FONDOS = {
    "despigmentantes": "abstract macro photography of luminous skin cells and melanin pigment crystals, dark emerald green background, golden bioluminescent particles, ultra HD, no text, no words",
    "acidos":          "abstract chemical molecular structures floating in dark green fluid, golden light refractions, laboratory aesthetic, macro photography, bokeh, no text, no words",
    "aceites":         "luxury botanical oils droplets on dark green velvet surface, golden light, macro photography, cosmetic brand aesthetic, no text, no words",
    "humectantes":     "abstract water droplets and hyaluronic acid gel texture on deep green background, golden reflections, macro photography, no text, no words",
    "emulsionantes":   "abstract cream emulsion texture swirls on dark green background, golden particles, luxury cosmetic aesthetic, macro photography, no text, no words",
    "conservantes":    "abstract molecular protection shield concept, dark green background, golden geometric patterns, scientific aesthetic, no text, no words",
    "vitaminas":       "glowing vitamin capsule crystals on dark emerald surface, golden bioluminescence, macro photography, luxury pharmaceutical aesthetic, no text, no words",
    "minerales":       "abstract mineral crystal formations on dark green background, golden metallic sheen, macro photography, no text, no words",
    "perfumeria":      "luxury fragrance molecules floating in dark green mist, golden light particles, artistic macro photography, no text, no words",
    "nutricion":       "abstract superfood particles and botanical extracts on dark green background, golden light, macro photography, no text, no words",
    "default":         "abstract luxury cosmetic ingredient concept on deep dark green background #143D36, golden bioluminescent particles, botanical elements, macro photography, ultra HD, no text, no letters, no words",
}

def _prompt_fondo(categoria: str, nombre: str) -> str:
    cat = categoria.lower()
    for key, prompt in _FONDOS.items():
        if key in cat:
            return prompt
    # Prompt personalizado por nombre de ingrediente
    return (
        f"abstract macro photography of {nombre.lower()} cosmetic ingredient, "
        f"deep dark green background #143D36, golden bioluminescent light particles, "
        f"luxury pharmaceutical brand aesthetic, ultra HD bokeh, "
        f"no text, no letters, no words, no labels"
    )


def generar_fondo_ideogram(nombre: str, categoria: str = "") -> tuple[bytes, str]:
    """Genera SOLO el fondo visual con Ideogram — sin texto, sin palabras."""
    if not IDEOGRAM_KEY:
        raise ValueError("IDEOGRAM_API_KEY no configurada en .env")

    prompt = _prompt_fondo(categoria, nombre)

    r = requests.post(
        "https://api.ideogram.ai/generate",
        headers={"Api-Key": IDEOGRAM_KEY.strip(), "Content-Type": "application/json"},
        json={
            "image_request": {
                "prompt": prompt,
                "aspect_ratio": "ASPECT_16_9",
                "model": "V_2",
                "style_type": "REALISTIC",
                "negative_prompt": "text, words, letters, typography, watermark, logo, blurry, low quality, cartoon",
                "num_images": 1
            }
        },
        timeout=60
    )

    data = r.json()
    if "data" not in data or not data["data"]:
        raise ValueError(f"Ideogram error: {data}")

    img_url = data["data"][0]["url"]
    img_bytes = requests.get(img_url, timeout=30).content
    return img_bytes, img_url


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 2B — PIL: SUPERPONE EL TEXTO SOBRE EL FONDO
# ═══════════════════════════════════════════════════════════════════════════════

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import io as _io

_BOLD_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
_REG_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]

def _f(paths, size):
    for p in paths:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except: pass
    return ImageFont.load_default()

def fb(s): return _f(_BOLD_PATHS, s)
def fr(s): return _f(_REG_PATHS, s)

C_DEEP   = (20,  61,  54,  230)   # verde oscuro semitransparente
C_GREEN  = (46, 139, 122, 255)
C_GOLD   = (245, 200,  66, 255)
C_WHITE  = (255, 255, 255, 255)
C_MUTED  = (200, 230, 225, 200)
C_DARK   = ( 10,  30,  25, 220)
W, H     = 1920, 1080

def _wrap_pil(draw, texto, font, x, y, max_w, line_h, color, max_lines=10):
    words = texto.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=font) <= max_w:
            cur = test
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    for i, line in enumerate(lines[:max_lines]):
        draw.text((x, y + i*line_h), line, font=font, fill=color)
    return y + len(lines[:max_lines]) * line_h

def _panel(img_rgba, x, y, w, h, color_rgba):
    overlay = Image.new("RGBA", img_rgba.size, (0,0,0,0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle([x, y, x+w, y+h], radius=16, fill=color_rgba)
    return Image.alpha_composite(img_rgba, overlay)

def _logo_pil(img_rgba, x=40, y=None, size=70):
    logo_path = BASE / "PAGINA_WEB/site/static/img/isotipo.png"
    if logo_path.exists():
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo = logo.resize((size, size), Image.LANCZOS)
            yy = H - size - 20 if y is None else y
            img_rgba.paste(logo, (x, yy), logo)
        except: pass


def componer_infografia(fondo_bytes: bytes, copy: dict, tipo: str) -> bytes:
    """Superpone el copy sobre el fondo generado por Ideogram con PIL."""

    # Abrir fondo y convertir a RGBA
    fondo = Image.open(_io.BytesIO(fondo_bytes)).convert("RGBA").resize((W, H), Image.LANCZOS)

    # Oscurecer levemente el fondo para contraste
    oscuro = Image.new("RGBA", (W, H), (0, 0, 0, 120))
    img = Image.alpha_composite(fondo, oscuro)

    # Panel izquierdo semitransparente (zona de texto)
    img = _panel(img, 0, 0, 780, H, (15, 45, 38, 210))

    # Barra lateral dorada
    overlay = Image.new("RGBA", (W, H), (0,0,0,0))
    d_ov = ImageDraw.Draw(overlay)
    d_ov.rectangle([0, 0, 10, H], fill=C_GOLD)
    img = Image.alpha_composite(img, overlay)

    draw = ImageDraw.Draw(img)

    titulo    = copy.get("titulo_principal", "")
    subtitulo = copy.get("subtitulo", "")
    puntos    = copy.get("puntos_clave", [])[:4]
    dato      = copy.get("dato_destacado", "")
    cta       = copy.get("cta", "Ver más en mckennagroup.co")

    # Badge tipo
    tipo_labels = {"ficha":"INGREDIENTE","receta":"RECETA","comparativa":"COMPARATIVA","tip":"TIP PRO"}
    badge_txt = tipo_labels.get(tipo, tipo.upper())
    bw = int(draw.textlength(badge_txt, font=fb(18))) + 28
    overlay2 = Image.new("RGBA", (W, H), (0,0,0,0))
    d2 = ImageDraw.Draw(overlay2)
    d2.rounded_rectangle([28, 28, 28+bw, 62], radius=10, fill=C_GOLD)
    img = Image.alpha_composite(img, overlay2)
    draw = ImageDraw.Draw(img)
    draw.text((42, 34), badge_txt, font=fb(18), fill=(15,40,30,255))

    # Título grande
    y = _wrap_pil(draw, titulo, fb(72), 28, 80, 730, 80, C_WHITE, max_lines=2)

    # Línea dorada decorativa
    draw.rectangle([28, y+10, 500, y+14], fill=C_GOLD)

    # Subtítulo
    y = _wrap_pil(draw, subtitulo, fr(26), 28, y+28, 730, 34, C_MUTED, max_lines=2)
    y += 20

    # Beneficios / puntos clave
    draw.text((28, y), "─" * 28, font=fr(14), fill=(46,139,122,180))
    y += 24
    for punto in puntos:
        overlay3 = Image.new("RGBA", (W, H), (0,0,0,0))
        d3 = ImageDraw.Draw(overlay3)
        d3.ellipse([28, y+6, 52, y+30], fill=C_GREEN)
        img = Image.alpha_composite(img, overlay3)
        draw = ImageDraw.Draw(img)
        draw.text((36, y+8), "✓", font=fb(16), fill=C_WHITE)
        _wrap_pil(draw, punto, fr(24), 62, y+4, 668, 30, C_WHITE, max_lines=1)
        y += 48

    # Dato destacado — caja dorada
    if dato:
        y += 10
        overlay4 = Image.new("RGBA", (W, H), (0,0,0,0))
        d4 = ImageDraw.Draw(overlay4)
        d4.rounded_rectangle([28, y, 750, y+70], radius=12, fill=(245,200,66,40))
        d4.rounded_rectangle([28, y, 750, y+72], radius=12, outline=C_GOLD, width=2)
        img = Image.alpha_composite(img, overlay4)
        draw = ImageDraw.Draw(img)
        draw.text((44, y+10), "★", font=fb(18), fill=C_GOLD)
        _wrap_pil(draw, dato, fr(22), 74, y+12, 660, 28, C_WHITE, max_lines=2)
        y += 80

    # CTA
    overlay5 = Image.new("RGBA", (W, H), (0,0,0,0))
    d5 = ImageDraw.Draw(overlay5)
    d5.rounded_rectangle([28, H-100, 740, H-52], radius=10, fill=C_GREEN)
    img = Image.alpha_composite(img, overlay5)
    draw = ImageDraw.Draw(img)
    draw.text((44, H-90), f"→  {cta}", font=fb(22), fill=C_WHITE)

    # Pie: logo + marca + URL
    overlay6 = Image.new("RGBA", (W, H), (0,0,0,0))
    d6 = ImageDraw.Draw(overlay6)
    d6.rectangle([0, H-46, W, H], fill=(10, 30, 25, 220))
    img = Image.alpha_composite(img, overlay6)
    draw = ImageDraw.Draw(img)
    _logo_pil(img, x=20, y=H-42, size=36)
    draw.text((66, H-34), "McKenna Group S.A.S", font=fb(18), fill=C_MUTED)
    draw.text((W//2 - 130, H-34), "mckennagroup.co", font=fr(17), fill=C_MUTED)
    draw.text((W-320, H-34), "Materias primas Colombia", font=fr(16), fill=C_MUTED)

    # Convertir a JPEG
    final = img.convert("RGB")
    buf = _io.BytesIO()
    final.save(buf, format="JPEG", quality=93)
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 3 — ELEVENLABS: GENERA LA NARRACIÓN
# ═══════════════════════════════════════════════════════════════════════════════

def generar_narracion(texto: str) -> bytes:
    """Genera audio MP3 con ElevenLabs."""
    if not ELEVENLABS_KEY:
        raise ValueError("ELEVENLABS_API_KEY no configurada en .env")

    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE}",
        headers={
            "xi-api-key": ELEVENLABS_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
        },
        json={
            "text": texto,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.8,
                "style": 0.3,
                "use_speaker_boost": True
            }
        },
        timeout=30
    )

    if r.status_code != 200:
        raise ValueError(f"ElevenLabs error {r.status_code}: {r.text[:200]}")

    return r.content


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 4 — FAL.AI / KLING: GENERA EL VIDEO
# ═══════════════════════════════════════════════════════════════════════════════

def generar_video_ken_burns(imagen_bytes: bytes, duracion: int = 20) -> bytes:
    """Fallback: zoom cinematográfico con ffmpeg cuando fal.ai no tiene saldo."""
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as fi:
        fi.write(imagen_bytes)
        tmp_img = fi.name
    tmp_out = tmp_img.replace(".jpg", "_video.mp4")
    try:
        fps, frames = 25, duracion * 25
        vf = (
            f"scale=2400:-1,"
            f"zoompan=z='min(zoom+0.0002,1.06)':d={frames}"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,"
            f"format=yuv420p"
        )
        subprocess.run(
            ["ffmpeg","-y","-loop","1","-i",tmp_img,"-vf",vf,
             "-c:v","libx264","-preset","fast","-crf","23","-t",str(duracion),"-r",str(fps),tmp_out],
            check=True, capture_output=True
        )
        return Path(tmp_out).read_bytes()
    finally:
        for f in [tmp_img, tmp_out]:
            try: os.unlink(f)
            except: pass


def concatenar_clips(clips_bytes: list) -> bytes:
    """Une múltiples clips MP4 en un solo video con ffmpeg."""
    tmp_files = []
    for i, clip in enumerate(clips_bytes):
        with tempfile.NamedTemporaryFile(suffix=f"_clip{i}.mp4", delete=False) as f:
            f.write(clip)
            tmp_files.append(f.name)

    list_file = tempfile.mktemp(suffix="_list.txt")
    with open(list_file, "w") as f:
        for path in tmp_files:
            f.write(f"file '{path}'\n")

    tmp_out = tempfile.mktemp(suffix="_concat.mp4")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
             "-i", list_file, "-c:v", "libx264", "-preset", "fast", "-crf", "23",
             "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,format=yuv420p",
             tmp_out],
            check=True, capture_output=True
        )
        return Path(tmp_out).read_bytes()
    finally:
        for f in tmp_files + [list_file, tmp_out]:
            try: os.unlink(f)
            except: pass


def _fal_queue(modelo: str, payload: dict, timeout_s: int = 180) -> dict:
    """Encola y espera resultado en fal.ai REST API usando las URLs que devuelve la respuesta."""
    fal_key = FAL_KEY.strip()
    headers = {"Authorization": f"Key {fal_key}", "Content-Type": "application/json"}

    r = requests.post(f"https://queue.fal.run/{modelo}", headers=headers, json=payload, timeout=30)
    if not r.content:
        raise ValueError("fal.ai devolvió respuesta vacía")
    data = r.json()
    if "request_id" not in data:
        raise ValueError(f"fal.ai error: {data.get('detail', data)}")

    # Usar las URLs exactas que devuelve fal.ai (no construirlas manualmente)
    status_url = data["status_url"]
    result_url = data["response_url"]

    for i in range(timeout_s // 5):
        time.sleep(5)
        sr = requests.get(status_url, headers=headers, timeout=15)
        estado = sr.json().get("status","") if sr.content else "UNKNOWN"
        print(f"     [{(i+1)*5}s] {estado}")
        if estado == "COMPLETED":
            rr = requests.get(result_url, headers=headers, timeout=30)
            return rr.json()
        if estado in ("FAILED","ERROR","CANCELLED"):
            raise ValueError(f"fal.ai falló: {estado}")

    raise TimeoutError("fal.ai no respondió a tiempo")


def _kling_text_to_video(prompt: str, duracion: str = "10") -> bytes:
    """Genera un clip de video desde texto con Kling text-to-video."""
    import fal_client
    os.environ["FAL_KEY"] = FAL_KEY.strip()

    result = fal_client.subscribe(
        "fal-ai/kling-video/v1.6/standard/text-to-video",
        arguments={
            "prompt": prompt,
            "duration": duracion,
            "aspect_ratio": "16:9",
        }
    )
    video_url = result.get("video", {}).get("url", "")
    if not video_url:
        raise ValueError(f"Sin URL: {result}")
    return requests.get(video_url, timeout=60).content


def generar_video_ia(ideogram_url: str, prompt_lab: str, nombre: str,
                     prompts_escenas: list = None) -> bytes:
    """
    Genera video de laboratorio profesional con múltiples escenas.
    Si prompts_escenas está definido, genera cada escena por separado y las concatena.
    Duración total = len(escenas) × 10 segundos.
    """
    if not FAL_KEY or not FAL_KEY.strip():
        raise ValueError("FAL_KEY no configurada")

    import fal_client
    os.environ["FAL_KEY"] = FAL_KEY.strip()

    if prompts_escenas:
        # Multi-escena: genera cada clip y concatena
        clips = []
        for i, prompt in enumerate(prompts_escenas, 1):
            print(f"     Escena {i}/{len(prompts_escenas)} ({10}s)...")
            clip = _kling_text_to_video(prompt, duracion="10")
            clips.append(clip)
            print(f"     Escena {i} lista ({len(clip)//1024} KB)")
            if i < len(prompts_escenas):
                time.sleep(3)

        print(f"     Concatenando {len(clips)} escenas...")
        return concatenar_clips(clips)

    else:
        # Single clip image-to-video (fallback legacy)
        prompt_final = (
            f"{prompt_lab} "
            f"Professional cosmetics laboratory, stainless steel workbench, "
            f"scientist with glasses and lab coat examining {nombre}, "
            f"glass beakers on bench, cinematic slow camera, ultra realistic 4K, no text."
        )[:700]
        print("     Generando clip único Kling 10s...")
        result = fal_client.subscribe(
            "fal-ai/kling-video/v1.6/standard/image-to-video",
            arguments={"image_url": ideogram_url, "prompt": prompt_final,
                       "duration": "10", "aspect_ratio": "16:9"}
        )
        video_url = result.get("video", {}).get("url", "")
        if not video_url:
            raise ValueError(f"Sin URL: {result}")
        return requests.get(video_url, timeout=60).content


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 5 — FFMPEG: MEZCLA VIDEO + AUDIO
# ═══════════════════════════════════════════════════════════════════════════════

def mezclar_video_audio(video_bytes: bytes, audio_bytes: bytes) -> bytes:
    """Une el video de Kling con la narración de ElevenLabs."""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as fv:
        fv.write(video_bytes)
        tmp_video = fv.name

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as fa:
        fa.write(audio_bytes)
        tmp_audio = fa.name

    tmp_out = tmp_video.replace(".mp4", "_final.mp4")

    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", tmp_video,
            "-i", tmp_audio,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",           # duración = el más corto (video = 5s)
            "-map", "0:v:0",
            "-map", "1:a:0",
            tmp_out
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return Path(tmp_out).read_bytes()
    finally:
        for f in [tmp_video, tmp_audio, tmp_out]:
            try: os.unlink(f)
            except: pass


# ═══════════════════════════════════════════════════════════════════════════════
# PASO 6 — FACEBOOK: PUBLICA EL VIDEO
# ═══════════════════════════════════════════════════════════════════════════════

def publicar_video_facebook(video_bytes: bytes, copy: dict, url_ref: str) -> dict:
    """Sube el video como Reel a la página de Facebook."""
    caption_raw = copy.get("caption_facebook", "")
    hashtags    = " ".join(copy.get("hashtags", [])[:6])
    caption     = f"{caption_raw}\n\n{hashtags}"

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(video_bytes)
        tmp_video = f.name

    try:
        r = requests.post(
            f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/videos",
            files={"source": ("contenido.mp4", open(tmp_video, "rb"), "video/mp4")},
            data={
                "description": caption,
                "title": copy.get("titulo_principal", "McKenna Group"),
                "access_token": FB_TOKEN,
            },
            timeout=120
        )
        return r.json()
    finally:
        os.unlink(tmp_video)


def publicar_imagen_facebook(imagen_bytes: bytes, copy: dict, url_ref: str) -> dict:
    """Fallback: publica solo la imagen si el video falla."""
    caption_raw = copy.get("caption_facebook", "")
    hashtags    = " ".join(copy.get("hashtags", [])[:6])
    caption     = f"{caption_raw}\n\n{hashtags}"

    r = requests.post(
        f"https://graph.facebook.com/v19.0/{FB_PAGE_ID}/photos",
        files={"source": ("imagen.jpg", imagen_bytes, "image/jpeg")},
        data={"caption": caption, "access_token": FB_TOKEN},
        timeout=30
    )
    return r.json()


# ═══════════════════════════════════════════════════════════════════════════════
# ORCHESTRADOR PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

def correr_pipeline(tipo: str, datos: dict, url_ref: str, dry_run=False, guardar_dir=None):
    nombre = datos.get("nombre", "contenido")
    print(f"\n{'─'*56}")
    print(f"  {nombre}")
    print(f"{'─'*56}")

    # ── Paso 1: Copy ──────────────────────────────────────────────────────────
    print("  [1/5] Generando copy con Gemini...")
    copy = generar_copy(tipo, datos)
    print(f"       Título: {copy.get('titulo_principal','')}")
    print(f"       Narración: {copy.get('narracion','')[:60]}...")

    # ── Paso 2: Fondo Ideogram + texto PIL ───────────────────────────────────
    slug = re.sub(r'[^a-z0-9]', '-', nombre.lower())[:30]
    if guardar_dir:
        Path(guardar_dir).mkdir(parents=True, exist_ok=True)

    print("  [2/5] Generando fondo visual con Ideogram (sin texto)...")
    categoria = datos.get("categoria", datos.get("cat", ""))
    fondo_bytes, imagen_url = generar_fondo_ideogram(nombre, categoria)
    print(f"       Fondo: {len(fondo_bytes)//1024} KB")

    print("       Componiendo infografía con PIL...")
    imagen_bytes = componer_infografia(fondo_bytes, copy, tipo)
    print(f"       Infografía final: {len(imagen_bytes)//1024} KB")

    if guardar_dir:
        (Path(guardar_dir) / f"fondo_{slug}.jpg").write_bytes(fondo_bytes)
        (Path(guardar_dir) / f"{tipo}_{slug}.jpg").write_bytes(imagen_bytes)
        print(f"       Guardada: {guardar_dir}/{tipo}_{slug}.jpg")

    # ── Paso 3: Narración ─────────────────────────────────────────────────────
    print("  [3/5] Generando narración con ElevenLabs...")
    audio_bytes = generar_narracion(copy.get("narracion",""))
    print(f"       Audio: {len(audio_bytes)//1024} KB")

    if guardar_dir:
        (Path(guardar_dir) / f"{tipo}_{slug}.mp3").write_bytes(audio_bytes)

    # ── Paso 4: Video ─────────────────────────────────────────────────────────
    usar_fal = bool(FAL_KEY and FAL_KEY.strip())

    if usar_fal:
        print("  [4/5] Generando video de laboratorio con Kling IA (multi-escena)...")
        try:
            escenas = copy.get("escenas_video", [])
            if not escenas:
                escenas = None  # usa fallback single-clip
            video_bytes = generar_video_ia(imagen_url, "", nombre, prompts_escenas=escenas)
            print(f"       Video IA total: {len(video_bytes)//1024} KB")
        except Exception as e:
            print(f"       fal.ai falló ({str(e)[:80]}) — fallback a Ken Burns")
            video_bytes = generar_video_ken_burns(imagen_bytes)
    else:
        print("  [4/5] Generando video con ffmpeg (Ken Burns)...")
        video_bytes = generar_video_ken_burns(imagen_bytes)
    print(f"       Video raw: {len(video_bytes)//1024} KB")

    # ── Paso 5: Mezclar ───────────────────────────────────────────────────────
    print("  [5/5] Mezclando video + audio con ffmpeg...")
    video_final = mezclar_video_audio(video_bytes, audio_bytes)
    print(f"       Video final: {len(video_final)//1024} KB")

    if guardar_dir:
        (Path(guardar_dir) / f"{tipo}_{slug}_final.mp4").write_bytes(video_final)
        print(f"       Video guardado: {guardar_dir}/{tipo}_{slug}_final.mp4")

    # ── Publicar ──────────────────────────────────────────────────────────────
    if dry_run:
        print("  ✅ DRY-RUN completado — no publicado")
        return True

    print("  📤 Publicando en Facebook...")
    result = publicar_video_facebook(video_final, copy, url_ref)

    if result.get("id"):
        print(f"  ✅ Publicado · id={result['id']}")
        return True
    else:
        err = result.get("error",{}).get("message","")
        print(f"  ⚠ Video falló ({err[:60]}), publicando imagen...")
        r2 = publicar_imagen_facebook(imagen_bytes, copy, url_ref)
        if r2.get("id") or r2.get("post_id"):
            print(f"  ✅ Imagen publicada como fallback")
            return True
        else:
            print(f"  ❌ Error: {r2}")
            return False


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tipo",    choices=["ficha","receta","comparativa","tip"], default="ficha")
    parser.add_argument("--slug",    default="", help="Slug de la guía")
    parser.add_argument("--id",      default="", help="ID de la receta")
    parser.add_argument("--slugs",   nargs=2, default=[], help="Dos slugs para comparativa")
    parser.add_argument("--auto",    action="store_true", help="Elige contenido nuevo automáticamente")
    parser.add_argument("--n",       type=int, default=1, help="Cantidad (solo con --auto)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--guardar-dir", default="pipeline_temp", help="Dir para guardar archivos")
    args = parser.parse_args()

    # Verificar keys necesarias
    faltantes = []
    if not GOOGLE_KEY:     faltantes.append("GOOGLE_API_KEY")
    if not IDEOGRAM_KEY:   faltantes.append("IDEOGRAM_API_KEY")
    if not ELEVENLABS_KEY: faltantes.append("ELEVENLABS_API_KEY")
    if not FAL_KEY:        faltantes.append("FAL_KEY")

    if faltantes:
        print(f"❌ Faltan estas keys en .env: {', '.join(faltantes)}")
        sys.exit(1)

    print("═"*60)
    print("  PIPELINE DE CONTENIDO — McKenna Group")
    print("  Copy → Imagen → Voz → Video → Facebook")
    print("═"*60)

    guias   = cargar_guias()
    recetas = cargar_recetas()
    reg     = cargar_registro()
    slugs_map = {g["slug"]: g for g in guias}
    ok_total  = 0

    def _run(tipo, datos, url_ref, clave_reg, id_reg):
        nonlocal ok_total
        ok = correr_pipeline(tipo, datos, url_ref, dry_run=args.dry_run, guardar_dir=args.guardar_dir)
        if ok and not args.dry_run:
            reg.setdefault(clave_reg, []).append(id_reg)
            guardar_registro(reg)
            ok_total += 1
        elif ok:
            ok_total += 1

    # ── Modo manual ───────────────────────────────────────────────────────────
    if not args.auto:
        if args.tipo == "ficha":
            guia = slugs_map.get(args.slug)
            if not guia:
                print(f"❌ Slug '{args.slug}' no encontrado.")
                sys.exit(1)
            secs = " ".join(strip_html(s.get("contenido","")) for s in guia.get("secciones",[])[:3])
            datos = {
                "nombre": guia.get("title_short", guia["title"]),
                "slug": guia["slug"],
                "categoria": guia.get("category",""),
                "tags": guia.get("tags",[]),
                "desc": guia.get("desc",""),
                "info_extra": secs[:600],
                "producto_foto": guia.get("producto_foto",""),
            }
            _run("ficha", datos, f"{SITE}/guias/{guia['slug']}", "fichas", guia["slug"])

        elif args.tipo == "receta":
            receta = next((r for r in recetas if str(r.get("id","")) == args.id), None)
            if not receta:
                print(f"❌ Receta id '{args.id}' no encontrada.")
                sys.exit(1)
            ings_str = " ".join(f"{i['n']} {i['q']}{i['u']}" for i in receta.get("ings",[])[:4])
            datos = {
                "nombre": f"{receta.get('title','')} {receta.get('title2','')}".strip(),
                "cat": receta.get("cat",""),
                "desc": receta.get("desc",""),
                "ings": receta.get("ings",[]),
                "tip": receta.get("tip",""),
                "info_extra": ings_str
            }
            _run("receta", datos, f"{SITE}/recetario", "recetas", str(receta["id"]))

        elif args.tipo == "comparativa":
            if len(args.slugs) < 2:
                print("❌ Usa --slugs slug-a slug-b")
                sys.exit(1)
            ga = slugs_map.get(args.slugs[0])
            gb = slugs_map.get(args.slugs[1])
            if not ga or not gb:
                print(f"❌ Slugs no encontrados: {args.slugs}")
                sys.exit(1)
            datos = {
                "nombre": f"{ga.get('title_short','')} vs {gb.get('title_short','')}",
                "nombre_a": ga.get("title_short",""),
                "nombre_b": gb.get("title_short",""),
                "desc": f"{ga.get('desc','')} | {gb.get('desc','')}",
                "info_extra": ""
            }
            clave = f"{args.slugs[0]}_{args.slugs[1]}"
            _run("comparativa", datos, f"{SITE}/guias", "comparativas", clave)

        elif args.tipo == "tip":
            guia = slugs_map.get(args.slug)
            if not guia:
                print(f"❌ Slug '{args.slug}' no encontrado.")
                sys.exit(1)
            secs = " ".join(strip_html(s.get("contenido","")) for s in guia.get("secciones",[])[:4])
            datos = {
                "nombre": guia.get("title_short", guia["title"]),
                "slug": guia["slug"],
                "desc": guia.get("desc",""),
                "info_extra": secs[:700]
            }
            _run("tip", datos, f"{SITE}/guias/{guia['slug']}", "tips", guia["slug"])

    # ── Modo auto ─────────────────────────────────────────────────────────────
    else:
        tipos_rotativos = ["ficha", "receta", "comparativa", "tip"]
        pares_comparativa = [
            ("alfa-arbutina","acido-kojico"),
            ("acido-glicolico","acido-lactico"),
            ("niacinamida","retinol"),
            ("acido-hialuronico","colageno-hidrolizado"),
        ]
        count = 0
        tipo_idx = 0

        while count < args.n:
            tipo = tipos_rotativos[tipo_idx % len(tipos_rotativos)]
            tipo_idx += 1

            if tipo == "ficha":
                candidatos = [g for g in guias if g["slug"] not in reg.get("fichas",[])]
                if not candidatos: continue
                guia = random.choice(candidatos)
                secs = " ".join(strip_html(s.get("contenido","")) for s in guia.get("secciones",[])[:3])
                datos = {
                    "nombre": guia.get("title_short", guia["title"]),
                    "slug": guia["slug"],
                    "categoria": guia.get("category",""),
                    "tags": guia.get("tags",[]),
                    "desc": guia.get("desc",""),
                    "info_extra": secs[:600],
                    "producto_foto": guia.get("producto_foto",""),
                }
                _run("ficha", datos, f"{SITE}/guias/{guia['slug']}", "fichas", guia["slug"])

            elif tipo == "receta":
                candidatos = [r for r in recetas if str(r.get("id","")) not in reg.get("recetas",[])]
                if not candidatos: continue
                receta = random.choice(candidatos)
                datos = {
                    "nombre": f"{receta.get('title','')} {receta.get('title2','')}".strip(),
                    "cat": receta.get("cat",""),
                    "desc": receta.get("desc",""),
                    "ings": receta.get("ings",[]),
                    "tip": receta.get("tip",""),
                    "info_extra": ""
                }
                _run("receta", datos, f"{SITE}/recetario", "recetas", str(receta["id"]))

            elif tipo == "comparativa":
                candidatos = [(a,b) for a,b in pares_comparativa
                              if f"{a}_{b}" not in reg.get("comparativas",[])]
                if not candidatos: continue
                sa, sb = random.choice(candidatos)
                ga, gb = slugs_map.get(sa), slugs_map.get(sb)
                if not ga or not gb: continue
                datos = {
                    "nombre": f"{ga.get('title_short','')} vs {gb.get('title_short','')}",
                    "nombre_a": ga.get("title_short",""),
                    "nombre_b": gb.get("title_short",""),
                    "desc": f"{ga.get('desc','')} | {gb.get('desc','')}",
                    "info_extra": ""
                }
                _run("comparativa", datos, f"{SITE}/guias", "comparativas", f"{sa}_{sb}")

            elif tipo == "tip":
                candidatos = [g for g in guias if g["slug"] not in reg.get("tips",[])]
                if not candidatos: continue
                guia = random.choice(candidatos)
                secs = " ".join(strip_html(s.get("contenido","")) for s in guia.get("secciones",[])[:4])
                datos = {
                    "nombre": guia.get("title_short", guia["title"]),
                    "slug": guia["slug"],
                    "desc": guia.get("desc",""),
                    "info_extra": secs[:700]
                }
                _run("tip", datos, f"{SITE}/guias/{guia['slug']}", "tips", guia["slug"])

            count += 1
            if count < args.n:
                time.sleep(8)

    print("\n" + "═"*60)
    print(f"  ✅ PIPELINE COMPLETADO — {ok_total} pieza(s) {'generadas' if args.dry_run else 'publicadas'}")
    print("═"*60)


if __name__ == "__main__":
    main()
