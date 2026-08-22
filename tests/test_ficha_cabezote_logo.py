"""Logo/cabezote de fichas técnicas: completo y del color que corresponde."""

from app.services.ficha_tecnica import (
    CABEZOTES_DIR,
    _logo_por_color_acento,
    _medida_cabezote_cm,
    _path_logo_correspondiente,
    _contexto_html,
)


def test_logo_por_color_acento_elige_variante() -> None:
    morado = _logo_por_color_acento("#6A1B9A")
    assert morado is not None
    assert morado.name == "logo_morado.png"
    azul = _logo_por_color_acento("#069DC2")
    assert azul is not None
    assert azul.name == "logo_azul.png"


def test_medida_cabezote_no_recorte_y_cabe_en_caja() -> None:
    path = CABEZOTES_DIR / "logo_azul.png"
    assert path.is_file()
    w, h = _medida_cabezote_cm(path, max_w_cm=5.6, max_h_cm=2.6)
    assert w <= 5.6 + 1e-6
    assert h <= 2.6 + 1e-6
    from PIL import Image

    with Image.open(path) as im:
        ratio = im.size[1] / im.size[0]
    assert abs((h / w) - ratio) < 0.02


def test_sin_cabezote_usa_logo_del_color() -> None:
    path = _path_logo_correspondiente("default", "#6A1B9A")
    assert path is not None
    assert path.name == "logo_morado.png"


def test_contexto_html_incluye_logo_completo() -> None:
    ctx = _contexto_html(
        {"titulo": "Prueba logo", "color_acento": "#6A1B9A"},
        cabezote_id="default",
        incluir_cabezote=True,
    )
    assert ctx["cabezote_src"]
    assert ctx["cabezote_src"].startswith("data:image/")
    assert ctx["cabezote_w_cm"] > 0
    assert ctx["cabezote_h_cm"] > 0
    assert ctx["cabezote_w_cm"] <= 5.6
    assert ctx["cabezote_h_cm"] <= 2.6
