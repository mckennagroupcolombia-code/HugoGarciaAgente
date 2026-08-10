"""Paso de flechas del Studio web (espejo de deltaFlecha / nudge en TS)."""

from __future__ import annotations


def delta_flecha(key: str, shift: bool = False) -> tuple[int, int] | None:
    paso = 10 if shift else 1
    if key == "ArrowLeft":
        return -paso, 0
    if key == "ArrowRight":
        return paso, 0
    if key == "ArrowUp":
        return 0, -paso
    if key == "ArrowDown":
        return 0, paso
    return None


def nudge(dx: int, dy: int, ddx: int, ddy: int, lim: int = 3999) -> tuple[int, int]:
    return (
        max(-lim, min(lim, round(dx + ddx))),
        max(-lim, min(lim, round(dy + ddy))),
    )


def test_delta_flecha_paso_y_shift() -> None:
    assert delta_flecha("ArrowLeft") == (-1, 0)
    assert delta_flecha("ArrowRight", True) == (10, 0)
    assert delta_flecha("ArrowUp", True) == (0, -10)
    assert delta_flecha("ArrowDown") == (0, 1)
    assert delta_flecha("Enter") is None


def test_nudge_acumula_y_recorta() -> None:
    assert nudge(4, 2, -1, 0) == (3, 2)
    assert nudge(3995, 0, 10, 0) == (3999, 0)
    assert nudge(-3995, 0, -10, 0) == (-3999, 0)
