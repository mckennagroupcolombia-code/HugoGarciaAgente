"""Studio web: barra fija con Guardar/Publicar (no se debe ir al hacer scroll)."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_hub_studio_web_llena_viewport_sin_scroll_externo() -> None:
    layout = (ROOT / "desktop/src/components/Layout.tsx").read_text(encoding="utf-8")
    assert 'sectionId === "studio-web"' in layout
    trans = (ROOT / "desktop/src/components/ui/PanelTransition.tsx").read_text(
        encoding="utf-8"
    )
    assert 'panel === "sitioweb"' in trans


def test_lienzo_tiene_botones_guardar_y_publicar() -> None:
    """Título del hub + acciones en una sola barra; Guardar/Publicar no se duplican."""
    layout = (ROOT / "desktop/src/components/Layout.tsx").read_text(encoding="utf-8")
    assert 'id="studio-web-chrome"' in layout
    panel = (ROOT / "desktop/src/components/SitioWebPanel.tsx").read_text(encoding="utf-8")
    assert "publicarEnSitio" in panel
    assert "createPortal" in panel
    assert "studio-web-chrome" in panel
    assert panel.count("Publicar") >= 1
    assert "Guardando…" in panel
    assert "Tema en el sitio:" not in panel
    assert "Editando tema publicado:" not in panel
    barra = (ROOT / "desktop/src/components/studio-web/StudioDesplegables.tsx").read_text(
        encoding="utf-8"
    )
    assert "onPublicar" not in barra
    assert "onGuardar" not in barra
    assert "Capítulo" not in barra
