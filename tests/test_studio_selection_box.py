"""Coordenadas del marco Studio: pantalla → px del papel (sin zoom)."""


def medir_caja_en_papel(
    host_left: float,
    host_top: float,
    host_w: float,
    host_h: float,
    paper_left: float,
    paper_top: float,
    paper_w_screen: float,
    paper_w_css: float,
) -> dict[str, float]:
    s = paper_w_screen / max(paper_w_css, 1)
    if s <= 0.01:
        s = 1.0
    return {
        "left": (host_left - paper_left) / s,
        "top": (host_top - paper_top) / s,
        "width": host_w / s,
        "height": host_h / s,
    }


def test_medir_caja_sin_zoom() -> None:
    b = medir_caja_en_papel(120, 80, 200, 40, 20, 10, 1200, 1200)
    assert b["left"] == 100
    assert b["top"] == 70
    assert b["width"] == 200
    assert b["height"] == 40


def test_medir_caja_con_scale_050() -> None:
    # Capítulo al 50%: getBoundingClientRect ya viene escalado.
    b = medir_caja_en_papel(70, 35, 100, 20, 20, 10, 600, 1200)
    assert b["left"] == 100
    assert b["top"] == 50
    assert b["width"] == 200
    assert b["height"] == 40
