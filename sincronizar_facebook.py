#!/usr/bin/env python3
"""
Sincronización Facebook — McKenna Group
════════════════════════════════════════
1. Elimina todos los posts y fotos existentes de la página
2. Genera imágenes branded con PIL (paleta del sitio web)
3. Publica nuevo contenido: productos, guías y blog posts

Uso:
    source venv/bin/activate
    python3 sincronizar_facebook.py
"""

import os, json, time, io, re, textwrap, requests
from pathlib import Path
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).parent

# ─── Cargar .env ──────────────────────────────────────────────────────────────
for line in (BASE / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

PAGE_ID = os.getenv("FB_PAGE_ID", "")
TOKEN   = os.getenv("FB_PAGE_ACCESS_TOKEN", "")
SITE    = "https://mckennagroup.co"

# ─── Paleta visual McKenna ────────────────────────────────────────────────────
C_DEEP   = (20,  61,  54)   # #143D36
C_GREEN  = (46, 139, 122)   # #2E8B7A
C_LIGHT  = (232, 245, 243)  # #E8F5F3
C_WHITE  = (255, 255, 255)
C_TEXT   = (240, 240, 240)
C_MUTED  = (160, 200, 190)
W, H     = 1200, 630

# ─── Fuentes ──────────────────────────────────────────────────────────────────
FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]
FONT_PATHS_REG = [
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


# ─── Generador de imágenes ───────────────────────────────────────────────────

def _fondo_gradiente(draw, w=W, h=H):
    for y in range(h):
        r = int(C_DEEP[0] + (C_GREEN[0]-C_DEEP[0]) * (y/h) * 0.45)
        g = int(C_DEEP[1] + (C_GREEN[1]-C_DEEP[1]) * (y/h) * 0.45)
        b = int(C_DEEP[2] + (C_GREEN[2]-C_DEEP[2]) * (y/h) * 0.45)
        draw.line([(0,y),(w,y)], fill=(r,g,b))


def _barra_lateral(draw, h=H):
    draw.rectangle([0, 0, 10, h], fill=C_GREEN)


def _logo(img):
    logo_path = BASE / "PAGINA_WEB/site/static/img/isotipo.png"
    if logo_path.exists():
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo = logo.resize((80, 80), Image.LANCZOS)
            img.paste(logo, (50, 42), logo)
        except Exception:
            pass


def _marca(draw):
    f_bold = _font(FONT_PATHS, 22)
    f_reg  = _font(FONT_PATHS_REG, 11)
    draw.text((145, 52), "McKenna Group S.A.S.", font=f_bold, fill=C_WHITE)
    draw.text((145, 80), "MATERIAS PRIMAS FARMACÉUTICAS Y COSMÉTICAS", font=f_reg, fill=C_MUTED)


def _pie(draw):
    f = _font(FONT_PATHS_REG, 18)
    draw.text((50, H-42), "mckennagroup.co  ·  Bogotá, Colombia", font=f, fill=C_MUTED)


def _wrap_text(draw, text, font, x, y, max_width, line_height, color=C_WHITE, max_lines=4):
    words = text.split()
    lines, line = [], []
    for w in words:
        test = " ".join(line + [w])
        bb = font.getbbox(test)
        if bb[2] - bb[0] <= max_width:
            line.append(w)
        else:
            if line:
                lines.append(" ".join(line))
            line = [w]
        if len(lines) >= max_lines:
            break
    if line and len(lines) < max_lines:
        lines.append(" ".join(line))
    for i, l in enumerate(lines):
        draw.text((x, y + i*line_height), l, font=font, fill=color)
    return y + len(lines)*line_height


def generar_imagen_producto(nombre, categoria, precio, foto_url=None) -> bytes:
    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    _fondo_gradiente(draw)
    _barra_lateral(draw)

    # Foto del producto (lado derecho)
    if foto_url:
        try:
            r = requests.get(foto_url, timeout=8)
            prod_img = Image.open(io.BytesIO(r.content)).convert("RGBA")
            prod_img.thumbnail((360, 360), Image.LANCZOS)
            # Círculo de fondo blanco semitransparente
            mask = Image.new("L", (400, 400), 0)
            ImageDraw.Draw(mask).ellipse([0,0,400,400], fill=200)
            circle_bg = Image.new("RGBA", (400, 400), (255,255,255,80))
            img.paste(circle_bg, (760, 115), mask)
            px = 760 + (400 - prod_img.width)  // 2
            py = 115 + (400 - prod_img.height) // 2
            img.paste(prod_img, (px, py), prod_img)
        except Exception:
            pass

    _logo(img)
    _marca(draw)

    # Categoría badge
    f_cat  = _font(FONT_PATHS, 15)
    f_nom  = _font(FONT_PATHS, 54)
    f_prec = _font(FONT_PATHS, 36)
    f_cta  = _font(FONT_PATHS, 20)
    f_reg  = _font(FONT_PATHS_REG, 20)

    draw.rounded_rectangle([50, 145, 50 + len(categoria)*10 + 24, 178], radius=12, fill=C_GREEN)
    draw.text((62, 150), categoria.upper(), font=f_cat, fill=C_WHITE)

    _wrap_text(draw, nombre, f_nom, 50, 196, 680, 62, C_WHITE, max_lines=3)

    if precio:
        draw.text((50, 395), precio, font=f_prec, fill=(138, 210, 196))

    draw.rectangle([50, 448, 340, 452], fill=C_GREEN)

    draw.rounded_rectangle([50, 470, 320, 510], radius=8, fill=C_GREEN)
    draw.text((90, 480), "Ver en nuestra tienda →", font=f_cta, fill=C_WHITE)

    _pie(draw)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def generar_imagen_blog(titulo, extracto, categoria="Blog Científico") -> bytes:
    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    _fondo_gradiente(draw)
    _barra_lateral(draw)

    # Acento decorativo
    draw.rectangle([50, 145, W-50, 148], fill=C_GREEN)

    _logo(img)
    _marca(draw)

    f_cat  = _font(FONT_PATHS, 16)
    f_tit  = _font(FONT_PATHS, 48)
    f_ext  = _font(FONT_PATHS_REG, 24)
    f_cta  = _font(FONT_PATHS, 20)

    draw.rounded_rectangle([50, 162, 50 + len(categoria)*10 + 24, 196], radius=12, fill=C_GREEN)
    draw.text((62, 167), categoria.upper(), font=f_cat, fill=C_WHITE)

    y = _wrap_text(draw, titulo, f_tit, 50, 216, 1100, 58, C_WHITE, max_lines=3)
    _wrap_text(draw, extracto, f_ext, 50, y + 24, 1100, 36, C_MUTED, max_lines=3)

    draw.rounded_rectangle([50, 540, 280, 580], radius=8, fill=C_GREEN)
    draw.text((74, 550), "Leer artículo completo →", font=f_cta, fill=C_WHITE)

    _pie(draw)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def generar_imagen_guia(titulo, desc) -> bytes:
    img  = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    _fondo_gradiente(draw)
    _barra_lateral(draw)

    draw.rectangle([50, 145, 700, 148], fill=C_GREEN)

    _logo(img)
    _marca(draw)

    f_badge = _font(FONT_PATHS, 16)
    f_tit   = _font(FONT_PATHS, 50)
    f_desc  = _font(FONT_PATHS_REG, 22)
    f_cta   = _font(FONT_PATHS, 20)

    draw.rounded_rectangle([50, 162, 290, 197], radius=12, fill=C_GREEN)
    draw.text((62, 167), "GUÍA TÉCNICA DE USO", font=f_badge, fill=C_WHITE)

    y = _wrap_text(draw, titulo, f_tit, 50, 216, 1100, 60, C_WHITE, max_lines=3)
    _wrap_text(draw, desc, f_desc, 50, y + 20, 1100, 34, C_MUTED, max_lines=3)

    draw.rounded_rectangle([50, 540, 280, 580], radius=8, fill=C_GREEN)
    draw.text((74, 550), "Ver guía completa →", font=f_cta, fill=C_WHITE)

    _pie(draw)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


# ─── Facebook API ─────────────────────────────────────────────────────────────

def fb_get_all_posts() -> list:
    posts = []
    url = f"https://graph.facebook.com/v19.0/{PAGE_ID}/posts"
    params = {"fields": "id", "limit": 100, "access_token": TOKEN}
    while url:
        r = requests.get(url, params=params, timeout=15)
        d = r.json()
        posts += [p["id"] for p in d.get("data", [])]
        url = d.get("paging", {}).get("next")
        params = {}
    return posts


def fb_get_all_photos() -> list:
    photos = []
    url = f"https://graph.facebook.com/v19.0/{PAGE_ID}/photos"
    params = {"fields": "id", "type": "uploaded", "limit": 100, "access_token": TOKEN}
    while url:
        r = requests.get(url, params=params, timeout=15)
        d = r.json()
        photos += [p["id"] for p in d.get("data", [])]
        url = d.get("paging", {}).get("next")
        params = {}
    return photos


def fb_delete(obj_id: str) -> bool:
    r = requests.delete(
        f"https://graph.facebook.com/v19.0/{obj_id}",
        params={"access_token": TOKEN}, timeout=10
    )
    return r.ok and r.json().get("success", False)


def fb_publicar_foto(imagen_bytes: bytes, caption: str) -> dict:
    r = requests.post(
        f"https://graph.facebook.com/v19.0/{PAGE_ID}/photos",
        files={"source": ("image.jpg", imagen_bytes, "image/jpeg")},
        data={"caption": caption, "access_token": TOKEN},
        timeout=30
    )
    return r.json()


def fb_publicar_post(mensaje: str, link: str = "") -> dict:
    data = {"message": mensaje, "access_token": TOKEN}
    if link:
        data["link"] = link
    r = requests.post(
        f"https://graph.facebook.com/v19.0/{PAGE_ID}/feed",
        data=data, timeout=15
    )
    return r.json()


# ─── Contenido a publicar ─────────────────────────────────────────────────────

def cargar_productos(n=10) -> list:
    try:
        raw = json.loads((BASE / "PAGINA_WEB/site/data/cache.json").read_text(encoding="utf-8"))
        cache = raw["sections"] if isinstance(raw, dict) and "sections" in raw else raw
        prods = []
        for cat in cache:
            for p in cat.get("products", []):
                if p.get("name") and p.get("photo"):
                    prods.append({
                        "nombre":    p["name"],
                        "categoria": cat["name"],
                        "precio":    p.get("precio", ""),
                        "foto":      p.get("photo", ""),
                        "slug":      p.get("slug", ""),
                        "ref":       p.get("ref", ""),
                    })
        # Diversificar: 1 por categoría
        vistos = set()
        seleccion = []
        for p in prods:
            cat = p["categoria"]
            if cat not in vistos:
                vistos.add(cat)
                seleccion.append(p)
            if len(seleccion) >= n:
                break
        return seleccion
    except Exception as e:
        print(f"  ⚠ productos: {e}")
        return []


def cargar_posts_blog(n=8) -> list:
    try:
        posts = json.loads((BASE / "PAGINA_WEB/site/data/posts.json").read_text(encoding="utf-8"))
        blog = [p for p in posts if p.get("publicado") and p.get("categoria") == "blog"]
        return blog[:n]
    except Exception:
        return []


def cargar_guias(n=6) -> list:
    try:
        guias = json.loads((BASE / "PAGINA_WEB/site/data/guias.json").read_text(encoding="utf-8"))
        return [g for g in guias if g.get("publicada", True)][:n]
    except Exception:
        return []


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "═"*60)
    print("  SINCRONIZACIÓN FACEBOOK — McKenna Group")
    print("═"*60)

    # ── PASO 1: Eliminar contenido antiguo ────────────────────────
    print("\n📦 PASO 1 — Limpiando contenido antiguo...")

    posts_ids  = fb_get_all_posts()
    photos_ids = fb_get_all_photos()
    print(f"  Posts encontrados: {len(posts_ids)}")
    print(f"  Fotos encontradas: {len(photos_ids)}")

    eliminados = 0
    for pid in posts_ids:
        if fb_delete(pid):
            eliminados += 1
        else:
            print(f"  ⚠ No se pudo eliminar post {pid}")
        time.sleep(0.3)

    for fid in photos_ids:
        if fb_delete(fid):
            eliminados += 1
        time.sleep(0.3)

    print(f"  ✅ Eliminados: {eliminados}/{len(posts_ids)+len(photos_ids)}")

    time.sleep(3)

    # ── PASO 2: Publicar contenido nuevo ──────────────────────────
    print("\n📤 PASO 2 — Publicando contenido nuevo...")

    publicados = 0

    # Post de bienvenida / presentación
    print("\n  [0] Post de presentación...")
    bienvenida = (
        "🌿 Somos McKenna Group S.A.S. — tu proveedor de materias primas "
        "farmacéuticas y cosméticas en Colombia.\n\n"
        "Más de 15 años al servicio de formuladores, laboratorios y emprendedores "
        "que crean productos de calidad certificada.\n\n"
        "📦 +230 referencias disponibles\n"
        "🚚 Despachos a todo el país\n"
        "🔬 Grado cosmético, farmacéutico e industrial\n\n"
        f"🔗 Visita nuestro catálogo: {SITE}/catalogo"
    )
    r = fb_publicar_post(bienvenida)
    if r.get("id"):
        print(f"  ✅ id={r['id']}")
        publicados += 1
    else:
        print(f"  ⚠ {r.get('error',{}).get('message','error')}")
    time.sleep(4)

    # Productos destacados
    print("\n  Productos destacados...")
    productos = cargar_productos(10)
    for i, p in enumerate(productos, 1):
        print(f"  [{i}] {p['nombre'][:45]}...")
        try:
            img_bytes = generar_imagen_producto(
                p["nombre"], p["categoria"], p["precio"], p["foto"]
            )
            caption = (
                f"✨ {p['nombre']}\n\n"
                f"Materia prima de grado {p['categoria'].lower()} disponible en McKenna Group.\n"
                f"📦 Envíos a todo Colombia · Mín. desde 50g\n\n"
                f"🛒 {SITE}/catalogo\n"
                f"💬 Cotiza por WhatsApp"
            )
            r = fb_publicar_foto(img_bytes, caption)
            if r.get("id") or r.get("post_id"):
                print(f"  ✅ publicado")
                publicados += 1
            else:
                print(f"  ⚠ {r.get('error',{}).get('message','error')[:60]}")
        except Exception as e:
            print(f"  ❌ {e}")
        time.sleep(5)

    # Posts de blog
    print("\n  Posts del blog científico...")
    blog_posts = cargar_posts_blog(8)
    for i, post in enumerate(blog_posts, 1):
        print(f"  [{i}] {post['titulo'][:50]}...")
        try:
            img_bytes = generar_imagen_blog(post["titulo"], post.get("extracto","")[:150])
            url = f"{SITE}/blog/{post['slug']}"
            caption = (
                f"🔬 {post['titulo']}\n\n"
                f"{post.get('extracto','')[:200]}\n\n"
                f"📖 Leer el artículo completo: {url}"
            )
            r = fb_publicar_foto(img_bytes, caption)
            if r.get("id") or r.get("post_id"):
                print(f"  ✅ publicado")
                publicados += 1
            else:
                print(f"  ⚠ {r.get('error',{}).get('message','error')[:60]}")
        except Exception as e:
            print(f"  ❌ {e}")
        time.sleep(5)

    # Guías de uso
    print("\n  Guías técnicas de uso...")
    guias = cargar_guias(6)
    for i, g in enumerate(guias, 1):
        print(f"  [{i}] {g['title'][:50]}...")
        try:
            img_bytes = generar_imagen_guia(g["title"], g.get("desc","")[:160])
            url = f"{SITE}/guias/{g['slug']}"
            caption = (
                f"📋 {g['title']}\n\n"
                f"{g.get('desc','')[:200]}\n\n"
                f"🔗 Ver guía completa: {url}"
            )
            r = fb_publicar_foto(img_bytes, caption)
            if r.get("id") or r.get("post_id"):
                print(f"  ✅ publicado")
                publicados += 1
            else:
                print(f"  ⚠ {r.get('error',{}).get('message','error')[:60]}")
        except Exception as e:
            print(f"  ❌ {e}")
        time.sleep(5)

    print("\n" + "═"*60)
    print(f"  ✅ COMPLETADO — {publicados} publicaciones en Facebook")
    print("═"*60 + "\n")


if __name__ == "__main__":
    main()
