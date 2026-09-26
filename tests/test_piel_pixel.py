"""Piel «pixel»: la traducción de colores está al día con el código y todo texto se lee.

La piel redefine los tokens del tema, pero los paneles escriben ~750 clases de color a mano
que no pasan por ellos; desktop/scripts/pixel/paleta_pixel.py las traduce a la paleta pixel
en theme/skin-pixel-paleta.css. Si alguien agrega una clase de color nueva y no regenera, ese
panel vuelve a verse con dos estilos mezclados (pasó con Pedidos Web el 25-sep-2026).
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("paleta_pixel", REPO / "desktop" / "scripts" / "pixel" / "paleta_pixel.py")
paleta = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(paleta)


def test_la_traduccion_de_colores_esta_al_dia_con_el_codigo():
    actual = paleta.SALIDA.read_text(encoding="utf-8")
    assert paleta.generar() == actual, (
        "Hay clases de color en desktop/src sin traducir a la piel pixel. "
        "Corre: python3 desktop/scripts/pixel/paleta_pixel.py --escribir")


def test_todo_texto_traducido_se_lee():
    """WCAG AA (4.5:1) para cada texto traducido, sobre el papel y sobre su propio fondo pálido
    (el patrón de las insignias: bg-emerald-50 + text-emerald-700), en claro y en oscuro."""
    bajos = [(d, round(paleta.contraste(t, f), 2)) for d, t, f in paleta.pares_de_texto()
             if paleta.contraste(t, f) < 4.5]
    assert not bajos, f"textos que no se leen: {bajos}"


def test_los_tokens_que_se_usan_como_texto_se_leen_sobre_el_papel():
    """text-accent-leaf, text-danger… salen de los tokens de la piel, no de la traducción.
    El 25-sep-2026 quedaban en 3,9–4,4:1 (verde y rojo PICO puros) y la auditoría lo encontró."""
    import re

    css = (REPO / "desktop" / "src" / "theme" / "skin-pixel.css").read_text(encoding="utf-8")
    claro = css.split(':not(.dark) {', 1)[1].split("}", 1)[0]
    tokens = dict(re.findall(r"--mck-([a-z-]+): (\d+ \d+ \d+);", claro))
    papel = "#" + "".join(f"{int(x):02X}" for x in tokens["surface"].split())
    bajos = []
    for nombre in ("accent-sun", "accent-leaf", "accent-sky", "accent-rose", "accent-plum", "success", "danger", "warning",
                   "ink-muted", "muted"):
        hexa = "#" + "".join(f"{int(x):02X}" for x in tokens[nombre].split())
        if paleta.contraste(hexa, papel) < 4.5:
            bajos.append((nombre, hexa, round(paleta.contraste(hexa, papel), 2)))
    assert not bajos, f"tokens que no se leen como texto sobre el papel: {bajos}"


def test_los_colores_para_fondo_oscuro_se_oscurecen_sobre_el_papel():
    """Pedidos Web usaba text-emerald-400 / text-red-300, pensados para fondo oscuro:
    sobre el crema se veían lavados. En claro deben salir en su tono legible."""
    for clase in ("text-emerald-400", "text-red-300", "text-blue-400"):
        regla = paleta.regla(clase, oscuro=False)
        color = regla.split("color: ")[1].rstrip("; }")
        assert paleta.contraste(color, paleta.FONDO_CLARO) >= 4.5, (clase, color)


def test_las_etiquetas_imprimibles_no_usan_clases_que_la_piel_cambia():
    """El PNG de una etiqueta se captura del DOM (html-to-image): si su dibujo usara una clase
    que la piel traduce o redondea, la piel se imprimiría. Los dibujos van con CSS propio."""
    dibujos = [p for d in ("etiqueta-30ml", "etiqueta-5ml", "etiqueta-capsulas", "etiqueta-simple", "etiqueta-vertical")
               for p in (REPO / "desktop" / "src" / "components" / d).glob("*.tsx")]
    # Los controles del editor (campos, botones) viven en otros archivos de la misma carpeta.
    controles = {"CenterProductPanel.tsx"}
    culpables = [(p.name, m.group(0)) for p in dibujos if p.name not in controles
                 for m in paleta.CLASE.finditer(p.read_text(encoding="utf-8"))]
    assert not culpables, f"clases de color de Tailwind dentro de un dibujo de etiqueta: {culpables}"
