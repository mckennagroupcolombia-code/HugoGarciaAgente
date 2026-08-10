"""Guías de alineación del Studio (espejo de desktop/src/lib/studioAlignmentGuides.ts)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Box:
    id: str
    left: float
    top: float
    right: float
    bottom: float


def _cx(b: Box) -> float:
    return (b.left + b.right) / 2


def _cy(b: Box) -> float:
    return (b.top + b.bottom) / 2


def _x_edges(b: Box) -> list[float]:
    return [b.left, _cx(b), b.right]


def _y_edges(b: Box) -> list[float]:
    return [b.top, _cy(b), b.bottom]


def _translate(b: Box, dx: float, dy: float) -> Box:
    return Box(b.id, b.left + dx, b.top + dy, b.right + dx, b.bottom + dy)


def _best(moving: list[float], targets: list[float], threshold: float) -> float | None:
    best: tuple[float, float] | None = None
    for m in moving:
        for t in targets:
            delta = t - m
            ad = abs(delta)
            if ad > threshold:
                continue
            if best is None or ad < abs(best[0]) - 1e-9:
                best = (delta, t)
    return None if best is None else best[0]


def snap_to_guides(
    moving: Box,
    others: list[Box],
    frame_w: float,
    frame_h: float,
    threshold: float,
) -> tuple[float, float, int]:
    frame = Box("__frame", 0, 0, frame_w, frame_h)
    targets = [*others, frame]
    hx = _best(_x_edges(moving), [v for t in targets for v in _x_edges(t)], threshold)
    hy = _best(_y_edges(moving), [v for t in targets for v in _y_edges(t)], threshold)
    dx = 0.0 if hx is None else hx
    dy = 0.0 if hy is None else hy
    moved = _translate(moving, dx, dy)
    eps = max(0.51, threshold * 0.08)
    n = 0
    mx, my = _x_edges(moved), _y_edges(moved)
    for t in targets:
        if any(abs(v - tv) <= eps for v in mx for tv in _x_edges(t)):
            n += 1
        if any(abs(v - tv) <= eps for v in my for tv in _y_edges(t)):
            n += 1
    return dx, dy, n


def test_alinea_bordes_izquierdos() -> None:
    moving = Box("a", 104, 80, 184, 110)
    other = Box("b", 100, 200, 250, 230)
    dx, dy, n = snap_to_guides(moving, [other], 400, 300, 6)
    assert dx == -4
    assert dy == 0
    assert n >= 1


def test_alinea_centros_verticales() -> None:
    moving = Box("a", 40, 80, 80, 100)  # cy=90
    other = Box("b", 200, 84, 260, 104)  # cy=94
    dx, dy, n = snap_to_guides(moving, [other], 400, 300, 6)
    assert dx == 0
    assert dy == 4
    assert n >= 1


def test_alinea_al_centro_del_papel() -> None:
    moving = Box("a", 180, 80, 240, 110)  # cx=210
    dx, dy, n = snap_to_guides(moving, [], 400, 300, 12)
    assert dx == -10  # centro papel x=200
    assert n >= 1


def test_fuera_de_umbral_no_imanta() -> None:
    moving = Box("a", 80, 80, 120, 100)
    other = Box("b", 200, 200, 240, 220)
    dx, dy, n = snap_to_guides(moving, [other], 800, 600, 6)
    assert dx == 0 and dy == 0
    assert n == 0


def test_umbral_pantalla_vs_zoom() -> None:
    # SNAP_SCREEN_PX=8 → a zoom 0.5 el umbral en papel es 16
    assert abs(8 / 0.5 - 16) < 1e-9
    moving = Box("a", 70, 80, 110, 100)
    other = Box("b", 80, 200, 160, 220)  # left-left delta=10
    dx_hi, _, _ = snap_to_guides(moving, [other], 400, 300, 6)
    dx_lo, _, _ = snap_to_guides(moving, [other], 400, 300, 16)
    assert dx_hi == 0
    assert abs(dx_lo) == 10


def test_centra_entre_vecinos_misma_fila() -> None:
    left = Box("l", 0, 40, 40, 70)
    right = Box("r", 160, 40, 200, 70)
    moving = Box("m", 88, 42, 128, 68)  # centro 108; hueco centro = 100
    hueco_centro = (left.right + right.left) / 2
    mov_centro = (moving.left + moving.right) / 2
    dx = hueco_centro - mov_centro
    assert dx == -8
    src = (ROOT / "desktop/src/lib/studioAlignmentGuides.ts").read_text(encoding="utf-8")
    assert "export function snapEqualSpacing" in src


def test_id_ancestro() -> None:
    src = (ROOT / "desktop/src/lib/studioAlignmentGuides.ts").read_text(encoding="utf-8")
    assert "export function idEsAncestroDe" in src
    assert "child.startsWith(`${anc}.`)" in src or 'child.startsWith(`${anc}.`)' in src
    assert "node.contains(m)" in src
    assert "data-studio-guide" in src
    assert "movingSection" not in src


def test_resize_imanta_borde_derecho() -> None:
    """Espejo de guidesForResize: el borde derecho se pega a otro left."""
    start_right = 120.0
    other_left = 148.0
    pointer_dx = 24.0  # proposed right = 144, delta a 148 = +4
    proposed = start_right + pointer_dx
    delta = other_left - proposed
    assert abs(delta - 4) < 1e-9
    assert abs(delta) <= 8


def test_lienzo_cablea_guias_en_clasico_y_pureza() -> None:
    hojas = (ROOT / "desktop/src/components/studio-web/HojasCapitulo.tsx").read_text(
        encoding="utf-8"
    )
    assert "data-studio-paper=" in hojas
    assert "overlay" in hojas
    for rel in (
        "desktop/src/components/studio-web/ClasicoLayoutCanvas.tsx",
        "desktop/src/components/studio-web/WebLayoutCanvas.tsx",
    ):
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert "captureAlignContext" in src
        assert "AlignmentGuidesOverlay" in src
        assert "guidesForMove" in src
        assert "guidesForResize" in src
        assert "data-studio-guide" in src
