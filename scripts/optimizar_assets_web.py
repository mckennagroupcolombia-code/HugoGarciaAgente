#!/usr/bin/env python3
"""
Optimiza los recursos estáticos más pesados de la web pública
(Fase B del plan de portada, sep-2026). Reproducible: se puede volver a
correr cuando cambie el logo, las fuentes o la ilustración del hero.

Qué hace (cada paso se puede saltar con --sin-<paso>):

  logo     static/img/isotipo.png (1200x894, 584 KB) -> static/img/isotipo-web.png
           a 320 px de ancho con paleta de 128 colores (~15 KB).
           El original NO se toca: lo usan los PDF, el correo y los pipelines
           de Facebook, que necesitan resolución completa.
  fuentes  Cada Montserrat-*.ttf (280 KB) -> .woff2 con subconjunto latino
           (español completo, ¿¡, €, comillas, guiones, ≤ ≥ °) de ~25 KB.
           Reescribe static/css/fonts-montserrat.css para servir woff2 con
           el ttf de respaldo.
  hero     La ilustración configurada en tema_web.json (nodos hero.foto_izq
           .backgroundImage, PNG de 230 KB) -> .webp sin pérdida a 1000 px y
           64 colores (~54 KB; es dibujo de línea) y actualiza la referencia
           en tema_web.json. El PNG se conserva.
  iconos   Deja en static/vendor/phosphor/regular solo style.css + Phosphor.woff2
           (antes se cargaban desde unpkg.com: un origen externo más y 3 MB de
           .svg/.ttf/.woff que ningún navegador moderno usa) y genera
           phosphor-subset.css + Phosphor-subset.woff2 solo con los iconos que
           el sitio usa (~90 de 1.530): de 143 KB a unos pocos KB. Si agregas
           un icono nuevo, vuelve a correr el script.

Uso:
  python3 scripts/optimizar_assets_web.py            # todo
  python3 scripts/optimizar_assets_web.py --sin-fuentes
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SITE = REPO / "PAGINA_WEB" / "site"
STATIC = SITE / "static"
VENV_PY = REPO / "venv" / "bin" / "python"

# Rango "latin" de Google Fonts + lo que usa la web (≤ ≥ ° · – —).
UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,"
    "U+2264,U+2265,U+2248,U+00B7,U+FEFF,U+FFFD"
)


def kb(p: Path) -> int:
    return p.stat().st_size // 1024 if p.exists() else 0


def paso_logo() -> None:
    from PIL import Image

    src = STATIC / "img" / "isotipo.png"
    im = Image.open(src).convert("RGBA")
    w = 320
    h = round(im.height * w / im.width)
    chico = im.resize((w, h), Image.LANCZOS)
    png = STATIC / "img" / "isotipo-web.png"
    chico.quantize(colors=128, method=Image.Quantize.FASTOCTREE).save(png, optimize=True)
    print(f"logo: {kb(src)} KB -> {png.name} {kb(png)} KB (el WebP salía más pesado que este PNG de 128 colores)")


def paso_fuentes() -> None:
    carpeta = STATIC / "fonts" / "montserrat"
    ttfs = sorted(carpeta.glob("Montserrat-*.ttf"))
    if not ttfs:
        print("fuentes: no hay TTF, se salta")
        return
    for ttf in ttfs:
        out = ttf.with_suffix(".woff2")
        subprocess.run(
            [str(VENV_PY), "-m", "fontTools.subset", str(ttf),
             f"--unicodes={UNICODES}", "--flavor=woff2", "--layout-features=*",
             "--no-hinting", "--desubroutinize", f"--output-file={out}"],
            check=True, capture_output=True,
        )
        print(f"fuente: {ttf.name} {kb(ttf)} KB -> {out.name} {kb(out)} KB")
    css = STATIC / "css" / "fonts-montserrat.css"
    s = css.read_text(encoding="utf-8")
    s2, n = re.subn(
        r"src:\s*url\('\.\./fonts/montserrat/(Montserrat-[A-Za-z]+)\.ttf'\)\s*format\('truetype'\);",
        r"src: url('../fonts/montserrat/\1.woff2') format('woff2'),\n       url('../fonts/montserrat/\1.ttf') format('truetype');",
        s,
    )
    if n:
        s2 = s2.replace(
            "/* ============================================================\n   Montserrat — familia completa autoalojada",
            "/* ============================================================\n   Montserrat — familia completa autoalojada\n   woff2 con subconjunto latino (scripts/optimizar_assets_web.py); el ttf\n   queda solo de respaldo y ningún navegador moderno lo descarga.",
            1,
        )
        css.write_text(s2, encoding="utf-8")
    print(f"fonts-montserrat.css: {n} @font-face reescritas a woff2")


def paso_hero() -> None:
    from PIL import Image

    cfg_path = SITE / "data" / "tema_web.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    cambios = 0
    for layout_key in ("layout_clasico", "layout"):
        nodos = (cfg.get(layout_key) or {}).get("nodos") or {}
        for nid, nodo in nodos.items():
            ruta = str(nodo.get("backgroundImage") or "")
            if not ruta.startswith("/static/") or not ruta.lower().endswith((".png", ".webp")):
                continue
            # si ya apunta al .webp (corrida anterior), se regenera desde el .png original
            ruta = ruta[:-5] + ".png" if ruta.lower().endswith(".webp") else ruta
            png = SITE / ruta.lstrip("/")
            if not png.exists():
                continue
            webp = png.with_suffix(".webp")
            im = Image.open(png).convert("RGBA")
            if im.width > 1000:  # la ilustración se muestra a menos de 500 px; 1000 cubre pantallas 2x
                im = im.resize((1000, round(im.height * 1000 / im.width)), Image.LANCZOS)
            # Es dibujo de línea: 64 colores + WebP sin pérdida pesa menos que el
            # WebP con pérdida (54 KB vs 144 KB) y no ensucia los trazos.
            im.quantize(colors=64, method=Image.Quantize.FASTOCTREE).convert("RGBA").save(
                webp, "WEBP", lossless=True, quality=100, method=6
            )
            nodo["backgroundImage"] = ruta[:-4] + ".webp"
            cambios += 1
            print(f"hero {nid}: {png.name} {kb(png)} KB -> {webp.name} {kb(webp)} KB")
    if cambios:
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"tema_web.json: {cambios} imagen(es) apuntando a webp")


def paso_iconos() -> None:
    carpeta = STATIC / "vendor" / "phosphor" / "regular"
    css = carpeta / "style.css"
    if not css.exists():
        print("iconos: falta static/vendor/phosphor/regular/style.css (descargar de unpkg @phosphor-icons/web@2.1.1)")
        return
    for sobrante in ("Phosphor.svg", "Phosphor.ttf", "Phosphor.woff"):
        p = carpeta / sobrante
        if p.exists():
            p.unlink()
    s = css.read_text(encoding="utf-8")
    s = re.sub(
        r"src:\s*url\(\"\./Phosphor\.ttf\?[^\"]*\"\)[^;]*;",
        'src: url("./Phosphor.woff2") format("woff2");',
        s, flags=re.S,
    )
    # variante sin query string
    s = re.sub(
        r"src:\s*url\(\"\./Phosphor\.(ttf|woff|svg)[^;]*;",
        'src: url("./Phosphor.woff2") format("woff2");',
        s, flags=re.S,
    )
    css.write_text(s, encoding="utf-8")
    print(f"iconos: style.css {kb(css)} KB + Phosphor.woff2 {kb(carpeta / 'Phosphor.woff2')} KB, solo woff2")


def _iconos_usados() -> set[str]:
    """Nombres ph-* que aparecen en plantillas, JS, Python y en los JSON de
    datos (icon/icono): guías, tema, líneas de proveedores, categorías."""
    import glob

    nombres: set[str] = set()
    patrones = (
        str(SITE / "templates" / "**" / "*.html"), str(SITE / "static" / "js" / "*.js"), str(SITE / "website.py"),
        str(REPO / "app" / "tools" / "*.py"), str(REPO / "app" / "services" / "*.py"),
    )
    for pat in patrones:
        for f in glob.glob(pat, recursive=True):
            try:
                t = Path(f).read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            nombres |= set(re.findall(r"ph-([a-z0-9]+(?:-[a-z0-9]+)*)", t))
            # nombres sueltos entre comillas ('bowl-food' en un dict de Jinja, CAT_ICONS
            # en JS, iconos de líneas en Python): se filtran después contra el mapa
            # real de Phosphor, así que incluir de más no cuesta nada
            nombres |= set(re.findall(r"""['"]([a-z][a-z0-9-]{1,30})['"]""", t))

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ("icon", "icono") and isinstance(v, str):
                    nombres.add(v)
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for f in glob.glob(str(SITE / "data" / "*.json")):
        try:
            walk(json.loads(Path(f).read_text(encoding="utf-8")))
        except Exception:
            pass
    return nombres - {"fill", "bold", "duotone", "light", "thin", "regular"}


def paso_iconos_subset() -> None:
    """style.css (1.530 iconos, 76 KB) + Phosphor.woff2 (143 KB) ->
    phosphor-subset.css + Phosphor-subset.woff2 solo con los iconos usados.
    Un icono que se agregue después a una plantilla exige volver a correr
    este paso (tests/test_assets_web.py lo detecta)."""
    carpeta = STATIC / "vendor" / "phosphor" / "regular"
    css_full = carpeta / "style.css"
    woff_full = carpeta / "Phosphor.woff2"
    if not css_full.exists() or not woff_full.exists():
        print("iconos-subset: falta style.css o Phosphor.woff2")
        return
    s = css_full.read_text(encoding="utf-8")
    mapa = dict(re.findall(r"\.ph\.ph-([a-z0-9-]+):before\s*\{\s*content:\s*\"\\([0-9a-f]+)\";", s))
    usados = sorted(n for n in _iconos_usados() if n in mapa)
    codepoints = ",".join(f"U+{mapa[n].upper()}" for n in usados)
    out_woff = carpeta / "Phosphor-subset.woff2"
    subprocess.run(
        [str(VENV_PY), "-m", "fontTools.subset", str(woff_full), f"--unicodes={codepoints}",
         "--flavor=woff2", "--no-hinting", f"--output-file={out_woff}"],
        check=True, capture_output=True,
    )
    base = s.split(".ph.ph-")[0].replace('url("./Phosphor.woff2")', 'url("./Phosphor-subset.woff2")')
    reglas = "\n".join(f'.ph.ph-{n}:before {{ content: "\\{mapa[n]}"; }}' for n in usados)
    cabecera = ("/* Subconjunto de Phosphor 2.1.1 con los iconos que usa el sitio "
                f"({len(usados)} de {len(mapa)}). Generado por scripts/optimizar_assets_web.py; "
                "si agregas un icono nuevo, vuelve a correrlo. */\n")
    (carpeta / "phosphor-subset.css").write_text(cabecera + base + reglas + "\n", encoding="utf-8")
    print(f"iconos-subset: {len(usados)} iconos -> Phosphor-subset.woff2 {kb(out_woff)} KB, phosphor-subset.css {kb(carpeta / 'phosphor-subset.css')} KB")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for paso in ("logo", "fuentes", "hero", "iconos"):
        ap.add_argument(f"--sin-{paso}", action="store_true")
    a = ap.parse_args()
    if not a.sin_logo:
        paso_logo()
    if not a.sin_fuentes:
        paso_fuentes()
    if not a.sin_hero:
        paso_hero()
    if not a.sin_iconos:
        paso_iconos()
        paso_iconos_subset()
    return 0


if __name__ == "__main__":
    sys.exit(main())
