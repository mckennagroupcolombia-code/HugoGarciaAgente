"""Studio web: barra fija con Guardar/Publicar (no se debe ir al hacer scroll)."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_hub_studio_web_llena_viewport_sin_scroll_externo() -> None:
    layout = (ROOT / "desktop/src/components/Layout.tsx").read_text(encoding="utf-8")
    assert 'panel === "sitioweb"' in layout
    nav = (ROOT / "desktop/src/lib/navStructure.ts").read_text(encoding="utf-8")
    assert 'id: "studio-web"' not in nav
    assert 'panel: "sitioweb"' in nav
    assert 'id: "diseno"' in nav
    diseno = (ROOT / "desktop/src/components/nav/DisenoNavTabs.tsx").read_text(
        encoding="utf-8"
    )
    assert "Studio web" in diseno
    assert 'setPanel("sitioweb")' in diseno
    trans = (ROOT / "desktop/src/components/ui/PanelTransition.tsx").read_text(
        encoding="utf-8"
    )
    assert 'panel === "sitioweb"' in trans


def test_lienzo_tiene_botones_guardar_y_publicar() -> None:
    """Chrome con Guardar/Publicar; rail de herramientas; sin pestaña Tema."""
    layout = (ROOT / "desktop/src/components/Layout.tsx").read_text(encoding="utf-8")
    assert 'id="studio-web-chrome-top"' in layout
    assert 'id="studio-web-chrome"' in layout
    assert 'panel === "sitioweb"' in layout
    assert "mck-submenu" in layout
    assert 'panel !== "sitioweb"' in layout
    panel = (ROOT / "desktop/src/components/SitioWebPanel.tsx").read_text(encoding="utf-8")
    assert "publicarEnSitio" in panel
    assert "createPortal" in panel
    assert "studio-web-chrome-top" in panel
    assert "studio-web-chrome" in panel
    assert "ScrollableTabList" not in panel
    assert 'label: "Tema"' not in panel
    assert "panelAncho" in panel
    assert "iniciarResizePanel" in panel
    assert panel.count("Publicar") >= 1
    assert "Guardando…" in panel
    barra = (ROOT / "desktop/src/components/studio-web/StudioDesplegables.tsx").read_text(
        encoding="utf-8"
    )
    assert "onPublicar" not in barra
    assert "onGuardar" not in barra
    assert "Capítulo" not in barra
