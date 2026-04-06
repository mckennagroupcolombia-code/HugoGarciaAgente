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

Crea el contenido para una {tarea} para Facebook/Instagram.

INFORMACIÓN:
{instruccion}

MARCA: McKenna Group S.A.S. · Paleta: verde oscuro #143D36, verde medio #2E8B7A, dorado #F5C842, blanco
TONO: Técnico pero accesible, colombiano, confiable
URL: {url_ref}

Responde SOLO con JSON válido, sin markdown:
{{
  "titulo_principal": "título llamativo máx 8 palabras",
  "subtitulo": "subtítulo técnico máx 12 palabras",
  "puntos_clave": ["punto 1 máx 6 palabras", "punto 2", "punto 3", "punto 4"],
  "dato_destacado": "estadística o dato impactante máx 10 palabras",
  "cta": "llamada a la acción máx 6 palabras",
  "prompt_imagen": "descripción en inglés para Ideogram de una infografía profesional con fondo verde oscuro #143D36, tipografía moderna, paleta McKenna Group. Debe incluir: el título '{nombre}' en grande, los puntos clave como viñetas, un badge dorado, logo McKenna Group abajo. Estilo: diseño editorial farmacéutico profesional, limpio, moderno. Resolución 16:9. Texto en español.",
  "narracion": "narración en español colombiano natural para leer en 8 segundos. Máx 35 palabras. Cálida, profesional. Menciona McKenna Group al final.",
  "prompt_video": "descripción en inglés del movimiento sutil para el video: cámara lenta acercándose, partículas brillantes, transición de texto. Profesional, elegante.",
  "caption_facebook": "texto del post para Facebook. 3-4 líneas. Emoji al inicio. Termina con la URL {url_ref} y un CTA.",
  "hashtags": ["#McKennaGroup", "#MateriaPrima", "#Cosmética", "#Colombia", "#Formulación"]
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
# PASO 2 — IDEOGRAM: GENERA LA IMAGEN
# ═══════════════════════════════════════════════════════════════════════════════

def generar_imagen_ideogram(copy: dict, nombre: str) -> tuple[bytes, str]:
    """Genera imagen 16:9 con Ideogram v2. Devuelve (bytes, url)."""
    if not IDEOGRAM_KEY:
        raise ValueError("IDEOGRAM_API_KEY no configurada en .env")

    puntos = " | ".join(copy.get("puntos_clave", [])[:4])
    prompt_base = copy.get("prompt_imagen", "")
    prompt_completo = (
        f"{prompt_base}. "
        f"Title text: '{copy.get('titulo_principal', nombre)}'. "
        f"Subtitle: '{copy.get('subtitulo', '')}'. "
        f"Key points: {puntos}. "
        f"Bottom badge: '{copy.get('dato_destacado', '')}'. "
        f"Bottom text: 'McKenna Group S.A.S · mckennagroup.co'. "
        f"Style: professional pharmaceutical cosmetic infographic, dark green background #143D36, "
        f"golden accents #F5C842, clean modern editorial design, high contrast, legible typography."
    )

    r = requests.post(
        "https://api.ideogram.ai/generate",
        headers={"Api-Key": IDEOGRAM_KEY, "Content-Type": "application/json"},
        json={
            "image_request": {
                "prompt": prompt_completo[:2000],
                "aspect_ratio": "ASPECT_16_9",
                "model": "V_2",
                "style_type": "DESIGN",
                "negative_prompt": "blurry, low quality, cluttered, unprofessional, watermark",
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

def generar_video_ken_burns(imagen_bytes: bytes, duracion: int = 12) -> bytes:
    """
    Crea video con efecto Ken Burns (zoom lento) usando ffmpeg.
    Gratis, rápido, sin APIs externas. Resultado profesional.
    """
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as fi:
        fi.write(imagen_bytes)
        tmp_img = fi.name

    tmp_out = tmp_img.replace(".jpg", "_video.mp4")

    try:
        # Zoom suave desde 1.0 hasta 1.08 en 12 segundos (elegante, no mareante)
        fps = 25
        frames = duracion * fps
        zoom_speed = 0.0003  # muy suave

        vf = (
            f"scale=2400:-1,"
            f"zoompan=z='min(zoom+{zoom_speed},{1 + zoom_speed*frames})'"
            f":d={frames}"
            f":x='iw/2-(iw/zoom/2)'"
            f":y='ih/2-(ih/zoom/2)'"
            f":s=1920x1080,"
            f"format=yuv420p"
        )

        cmd = [
            "ffmpeg", "-y",
            "-loop", "1",
            "-i", tmp_img,
            "-vf", vf,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-t", str(duracion),
            "-r", str(fps),
            tmp_out
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return Path(tmp_out).read_bytes()
    finally:
        for f in [tmp_img, tmp_out]:
            try: os.unlink(f)
            except: pass


def generar_video_kling(imagen_url: str, prompt_video: str) -> bytes:
    """
    Genera video con IA via fal.ai/Kling (requiere saldo en fal.ai).
    Fallback a Ken Burns si no hay saldo o FAL_KEY.
    """
    if not FAL_KEY or not FAL_KEY.strip():
        raise ValueError("FAL_KEY no configurada")

    fal_key = FAL_KEY.strip()
    prompt_final = (
        f"{prompt_video}. Slow elegant camera zoom in. "
        "Subtle particle light effects. Professional cosmetic brand. "
        "Dark green tones. High quality."
    )

    r = requests.post(
        "https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video",
        headers={"Authorization": f"Key {fal_key}", "Content-Type": "application/json"},
        json={"image_url": imagen_url, "prompt": prompt_final[:500], "duration": "5", "aspect_ratio": "16:9"},
        timeout=30
    )
    data = r.json()
    if "request_id" not in data:
        raise ValueError(f"fal.ai error: {data.get('detail', data)}")

    request_id = data["request_id"]
    result_url  = f"https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/{request_id}"
    status_url  = result_url + "/status"

    print("     Esperando video Kling (hasta 120s)...")
    for i in range(24):
        time.sleep(5)
        estado = requests.get(status_url, headers={"Authorization": f"Key {fal_key}"}, timeout=15).json().get("status","")
        print(f"     [{(i+1)*5}s] {estado}")
        if estado == "COMPLETED": break
        if estado in ("FAILED","ERROR"): raise ValueError(f"Kling falló: {estado}")

    result = requests.get(result_url, headers={"Authorization": f"Key {fal_key}"}, timeout=30).json()
    video_url = result.get("video", {}).get("url","")
    if not video_url:
        raise ValueError(f"Sin URL de video: {result}")

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

    # ── Paso 2: Imagen ────────────────────────────────────────────────────────
    print("  [2/5] Generando imagen con Ideogram...")
    imagen_bytes, imagen_url = generar_imagen_ideogram(copy, nombre)
    print(f"       Imagen: {len(imagen_bytes)//1024} KB")

    slug = re.sub(r'[^a-z0-9]', '-', nombre.lower())[:30]
    if guardar_dir:
        Path(guardar_dir).mkdir(parents=True, exist_ok=True)
        (Path(guardar_dir) / f"{tipo}_{slug}.jpg").write_bytes(imagen_bytes)
        print(f"       Guardada: {guardar_dir}/{tipo}_{slug}.jpg")

    # ── Paso 3: Narración ─────────────────────────────────────────────────────
    print("  [3/5] Generando narración con ElevenLabs...")
    audio_bytes = generar_narracion(copy.get("narracion",""))
    print(f"       Audio: {len(audio_bytes)//1024} KB")

    if guardar_dir:
        (Path(guardar_dir) / f"{tipo}_{slug}.mp3").write_bytes(audio_bytes)

    # ── Paso 4: Video ─────────────────────────────────────────────────────────
    usar_kling = bool(FAL_KEY and FAL_KEY.strip())
    if usar_kling:
        print("  [4/5] Generando video con fal.ai/Kling (IA)...")
        try:
            video_bytes = generar_video_kling(imagen_url, copy.get("prompt_video",""))
        except Exception as e:
            print(f"       Kling falló ({e}) — usando Ken Burns con ffmpeg")
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
                "info_extra": secs[:600]
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
                    "info_extra": secs[:600]
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
