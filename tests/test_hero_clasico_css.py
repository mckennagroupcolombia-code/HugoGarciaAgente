"""El hero Clásico público debe coincidir con el lienzo del Studio (no recortar el H1)."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "PAGINA_WEB" / "site" / "static" / "css" / "main.css").read_text(
    encoding="utf-8"
)


def _bloque(marcador: str, hasta: str) -> str:
    start = CSS.find(marcador)
    assert start != -1, f"no está {marcador!r}"
    end = CSS.find(hasta, start + len(marcador))
    assert end != -1, f"no cierra {marcador!r} con {hasta!r}"
    return CSS[start:end]


def test_hero_left_reparte_contenido_en_altura() -> None:
    bloque = _bloque("/* Panel izquierdo */", ".hero-left::before")
    assert "justify-content: space-between" in bloque
    assert "justify-content: flex-end" not in bloque
    assert "background-color: var(--white)" in bloque
    assert "var(--green-deep)" not in bloque


def test_lienzo_blanco_en_cuerpo_y_secciones() -> None:
    assert "background-color: var(--white)" in CSS
    assert ".cats-section {\n  background-color: var(--white)" in CSS
    assert ".page-hero {\n  background: var(--white)" in CSS
    assert ".shop-header {\n  background: var(--white)" in CSS
    assert "--white:        #ffffff" in CSS


def test_hero_title_no_es_80px() -> None:
    bloque = _bloque(".hero-title {", ".hero-title em")
    assert "80px" not in bloque
    assert "clamp(36px, 4vw, 54px)" in bloque
    assert "line-height: 1.08" in bloque


def test_hero_llena_primera_pantalla_bajo_chrome() -> None:
    bloque = _bloque(".hero {", "/* Panel izquierdo */")
    assert "min-height: calc(100dvh - 7.5rem)" in bloque
    assert "min-height: 100vh;" not in bloque


def test_hero_foto_es_objeto_visible() -> None:
    assert ".hero-foto" in CSS
    assert "object-fit: contain" in CSS
    assert ".hero-foto-fill" in CSS
    assert "object-position: center top" in CSS


def test_hero_right_visible_como_en_lienzo_hasta_tablet() -> None:
    """Bajo 1200px el lienzo sigue a 2 columnas; no esconder el kit."""
    i1200 = CSS.find("@media (max-width: 1200px)")
    i900 = CSS.find("@media (max-width: 900px)")
    assert i1200 != -1 and i900 != -1
    bloque_1200 = CSS[i1200:i900]
    assert ".hero-right {" not in bloque_1200
    assert ".hero {" not in bloque_1200
    bloque_900 = CSS[i900 : CSS.find("@media (max-width: 640px)")]
    assert ".hero { grid-template-columns: 1fr" in " ".join(bloque_900.split())
    assert ".hero-right { display: none" not in bloque_900
