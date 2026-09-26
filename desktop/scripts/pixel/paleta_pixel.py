#!/usr/bin/env python3
"""
Traducción de colores de la piel «pixel» — genera desktop/src/theme/skin-pixel-paleta.css.

Por qué: la piel pixel (theme/skin-pixel.css) redefine los TOKENS del tema, pero los
paneles escriben ~750 clases de color a mano (bg-white, text-emerald-400, bg-red-500/15…)
que no pasan por los tokens. Sin esta capa, al abrir un panel se mezclaban dos estilos
(25-sep-2026: Pedidos Web, pensado para fondo oscuro, se veía lavado sobre el crema).

Cómo: cada clase de color que el código USA de verdad se lleva a una de seis familias
(rojo, verde, ámbar, azul, violeta, neutro) y, según su intensidad y transparencia, a un
papel — texto legible, fondo pálido, fondo suave, color fuerte, fondo hondo, borde — con
un valor para claro y otro para oscuro. Nada se escribe a mano en el CSS generado.

    python3 desktop/scripts/pixel/paleta_pixel.py            # ensayo: dice qué cambiaría
    python3 desktop/scripts/pixel/paleta_pixel.py --escribir # regenera el CSS

tests/test_piel_pixel.py falla si el CSS no está al día con el código (una clase de color
nueva sin traducir) o si algún texto traducido queda por debajo del contraste legible.
Sin LLM, sin red.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]            # desktop/
SRC = RAIZ / "src"
SALIDA = SRC / "theme" / "skin-pixel-paleta.css"

FAMILIA = {
    **{f: "rojo" for f in ("red", "rose", "pink")},
    **{f: "verde" for f in ("green", "emerald", "lime", "teal")},
    **{f: "ambar" for f in ("amber", "orange", "yellow")},
    **{f: "azul" for f in ("sky", "blue", "cyan", "indigo")},
    **{f: "violeta" for f in ("violet", "purple", "fuchsia")},
    **{f: "neutro" for f in ("gray", "slate", "zinc", "neutral", "stone")},
}

# Paleta PICO-8, más tonos derivados para que el texto se lea sobre el papel crema.
CLARO = {
    #          texto     fuerte     palido     suave      hondo      claro (texto sobre fondo oscuro)
    "rojo":    ("#B00035", "#FF004D", "#FFE3EA", "#FFB8C9", "#7E0027", "#FFD1DC"),
    "verde":   ("#006B3F", "#008751", "#DDF5E6", "#AEE8C4", "#004D2E", "#C9F5D9"),
    "ambar":   ("#8F4500", "#FFA300", "#FFF0CF", "#FFD98A", "#7A3E00", "#FFE7A8"),
    "azul":    ("#0B5CA8", "#29ADFF", "#DCEFFF", "#A9DBFF", "#0B3D6B", "#CFEAFF"),
    "violeta": ("#7E2553", "#83769C", "#F3E3F0", "#DCC2E0", "#4A1731", "#EBD5EE"),
}
# Neutros: texto apagado (300–500), tinta (600+), papel y tinta del tema.
NEUTRO_CLARO = dict(apagado="#665C53", tinta="#000000", palido="#FBE9DA", suave="#EFD7C3",
                    medio="#C2C3C7", hondo="#1D2B53", borde_suave="#D9C1AB", borde="#000000", claro="#FFF1E8")
OSCURO = {
    #          texto (brillante)  fuerte
    "rojo":    ("#FF6B8B", "#FF004D"),
    "verde":   ("#00E436", "#008751"),
    "ambar":   ("#FFA300", "#FFA300"),
    "azul":    ("#29ADFF", "#29ADFF"),
    "violeta": ("#C9A7FF", "#83769C"),
}
NEUTRO_OSCURO = dict(apagado="#C2C3C7", tinta="#FFF1E8", palido="#1D2B53", suave="#2D3C6E",
                     medio="#5F574F", hondo="#0D1126", borde_suave="#3E4A78", borde="#83769C", claro="#FFF1E8")
FONDO_CLARO, FONDO_OSCURO = "#FFF1E8", "#1D2B53"      # contra qué se mide el contraste

PROPIEDADES = {"bg": "background-color", "text": "color", "border": "border-color",
               "ring": "--tw-ring-color", "outline": "outline-color", "fill": "fill",
               "stroke": "stroke", "divide": "border-color", "from": "--mck-plano"}
# Variantes que se traducen (las demás —file:, group-hover:…— se dejan como están).
VARIANTES = {"hover": ":hover", "focus": ":focus", "active": ":active", "placeholder": "::placeholder"}

CLASE = re.compile(
    r'(?<![\w\-:/\[])((?:(?:dark|hover|focus|active|placeholder):)*)'
    r'(bg|text|border|ring|outline|fill|stroke|divide|from)-'
    r'(white|' + "|".join(FAMILIA) + r')(?:-(50|[1-9]00|950))?(?:/(\d{1,3}))?(?![\w\-\[])'
)


def rgba(hexa: str, alfa: float) -> str:
    r, g, b = (int(hexa[i:i + 2], 16) for i in (1, 3, 5))
    return f"rgb({r} {g} {b} / {alfa:.2f})"


def color(prop: str, fam: str, tono: int | None, opac: int | None, oscuro: bool) -> str | None:
    """El color pixel de una clase. None = no se traduce (se deja la de Tailwind)."""
    t = tono if tono is not None else 500
    tenue = opac is not None and opac <= 30              # bg-red-500/15: un velo, no el color
    medio = opac is not None and 30 < opac <= 60
    if fam == "white":
        if prop == "bg" and opac is None:
            return "rgb(var(--mck-surface-panel))"
        return None                                       # text-white, velos blancos: tal cual
    if fam == "neutro":
        n = NEUTRO_OSCURO if oscuro else NEUTRO_CLARO
        if prop == "text" or prop in ("fill", "stroke"):
            return n["claro"] if t <= 200 else n["apagado"] if t <= 500 else n["tinta"]
        if prop in ("border", "divide", "ring", "outline"):
            return n["borde_suave"] if (t <= 300 or tenue) else n["borde"]
        if tenue or t <= 100:
            return n["palido"]
        if medio or t <= 300:
            return n["suave"]
        return n["medio"] if t <= 500 else n["hondo"]
    if oscuro:
        brillo, fuerte = OSCURO[fam]
        if prop == "text" or prop in ("fill", "stroke"):
            return CLARO[fam][5] if t <= 200 else brillo
        if prop in ("border", "divide", "ring", "outline"):
            return rgba(fuerte, 0.45) if (t <= 200 or tenue) else fuerte
        if tenue or t <= 100:
            return rgba(fuerte, 0.18)
        if medio or t <= 300:
            return rgba(fuerte, 0.32)
        return fuerte if t <= 600 else rgba(fuerte, 0.55)
    texto, fuerte, palido, suave, hondo, claro = CLARO[fam]
    if prop == "text" or prop in ("fill", "stroke"):
        # 50–200 suele ir sobre un fondo fuerte u oscuro: se queda claro. Desde 300 se lee sobre papel.
        return claro if t <= 200 else texto
    if prop in ("border", "divide", "ring", "outline"):
        return suave if (t <= 200 or tenue) else fuerte
    if tenue or t <= 100:
        return palido
    if medio or t <= 300:
        return suave
    return fuerte if t <= 600 else hondo


def escapar(clase: str) -> str:
    return re.sub(r"([:/.\[\]])", r"\\\1", clase)


def clases_usadas() -> list[str]:
    vistas: set[str] = set()
    for f in sorted(SRC.rglob("*.ts*")):
        vistas.update(m.group(0) for m in CLASE.finditer(f.read_text(encoding="utf-8")))
    return sorted(vistas)


def regla(clase: str, oscuro: bool) -> str | None:
    m = CLASE.fullmatch(clase)
    if not m:
        return None
    variantes = [v for v in m.group(1).split(":") if v]
    prop, fam_tw, tono, opac = m.group(2), m.group(3), m.group(4), m.group(5)
    fam = "white" if fam_tw == "white" else FAMILIA[fam_tw]
    if "dark" in variantes and not oscuro:
        return None                                       # dark:… solo vale en oscuro
    c = color(prop, fam, int(tono) if tono else None, int(opac) if opac else None, oscuro)
    if c is None:
        return None
    pseudo = "".join(VARIANTES[v] for v in variantes if v in VARIANTES)
    # El Mapa y Colaboradores (.colab-pixel) son una ISLA CLARA: su papel crema no cambia en modo
    # oscuro. Dentro de ella rige siempre la traducción clara; la oscura la excluye. Sin esto, en
    # oscuro las piezas de la Agenda dentro de «Tu día» quedaban con texto oscuro sobre azul marino.
    if oscuro:
        raiz, isla = 'html[data-mck-skin="pixel"].dark', ":not(.colab-pixel *)"
    else:
        raiz, isla = ':is(html[data-mck-skin="pixel"]:not(.dark), html[data-mck-skin="pixel"].dark .colab-pixel)', ""
    # ::placeholder es un pseudo-elemento: va al final, después del :not().
    sel = f"{raiz} .{escapar(clase)}{isla}{pseudo}"
    if prop == "divide":
        sel += " > :not([hidden]) ~ :not([hidden])"
    return f"{sel} {{ {PROPIEDADES[prop]}: {c}; }}"


def generar() -> str:
    clases = clases_usadas()
    lineas = [
        "/*",
        " * GENERADO por desktop/scripts/pixel/paleta_pixel.py — NO EDITAR A MANO.",
        " * Traduce a la paleta pixel cada clase de color escrita a mano en los paneles.",
        " * Regenerar: python3 desktop/scripts/pixel/paleta_pixel.py --escribir",
        f" * {len(clases)} clases de color encontradas en desktop/src.",
        " */",
        "",
        "/* Degradados: el pixel art es plano. Queda el color de inicio (from-*). */",
        'html[data-mck-skin="pixel"] [class*="bg-gradient-to-"] {',
        "  background-image: none !important;",
        "  background-color: var(--mck-plano, rgb(var(--mck-surface-panel)));",
        "}",
        "",
        "/* ─── Claro ─── */",
    ]
    base = [c for c in clases if not c.startswith("dark:")]
    oscuras = [c for c in clases if c.startswith("dark:")]
    lineas += [r for c in base if (r := regla(c, oscuro=False))]
    lineas += ["", "/* ─── Oscuro: primero las clases base, después las dark: (ganan a igual peso) ─── */"]
    lineas += [r for c in base if (r := regla(c, oscuro=True))]
    lineas += [r for c in oscuras if (r := regla(c, oscuro=True))]
    return "\n".join(lineas) + "\n"


# ─── Contraste (WCAG) — lo usa el test ───────────────────────────────────────

def luminancia(hexa: str) -> float:
    def canal(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hexa[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)


def contraste(a: str, b: str) -> float:
    la, lb = sorted((luminancia(a), luminancia(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def pares_de_texto() -> list[tuple[str, str, str]]:
    """(descripción, color de texto, fondo) de cada texto traducido que debe leerse."""
    pares = []
    for fam, (texto, _f, palido, _s, _h, _c) in CLARO.items():
        pares += [(f"{fam} sobre papel", texto, FONDO_CLARO), (f"{fam} sobre su pálido", texto, palido)]
    pares += [("neutro apagado sobre papel", NEUTRO_CLARO["apagado"], FONDO_CLARO),
              ("neutro apagado sobre pálido", NEUTRO_CLARO["apagado"], NEUTRO_CLARO["palido"])]
    for fam, (brillo, _f) in OSCURO.items():
        pares.append((f"{fam} (oscuro) sobre panel", brillo, FONDO_OSCURO))
    pares.append(("neutro apagado (oscuro) sobre panel", NEUTRO_OSCURO["apagado"], FONDO_OSCURO))
    return pares


if __name__ == "__main__":
    nuevo = generar()
    actual = SALIDA.read_text(encoding="utf-8") if SALIDA.exists() else ""
    n = nuevo.count("{ ")
    if "--escribir" in sys.argv:
        SALIDA.write_text(nuevo, encoding="utf-8")
        print(f"escrito {SALIDA.relative_to(RAIZ.parent)}: {n} reglas")
    else:
        print(f"{'al día' if nuevo == actual else 'DESACTUALIZADO'}: {n} reglas (ensayo; --escribir para guardar)")
    bajos = [(d, round(contraste(t, f), 2)) for d, t, f in pares_de_texto() if contraste(t, f) < 4.5]
    print("contraste bajo 4.5:", bajos or "ninguno")
