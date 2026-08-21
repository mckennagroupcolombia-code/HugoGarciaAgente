from app.services.formula_molecular import formatear_formula_molecular, formula_a_html_sub


def test_formatear_formula_molecular_basica() -> None:
    assert formatear_formula_molecular("C6H12O6") == "C₆H₁₂O₆"
    assert formatear_formula_molecular("H2SO4") == "H₂SO₄"
    assert formatear_formula_molecular("Ca(OH)2") == "Ca(OH)₂"


def test_formatear_formula_coeficientes_y_hidratos() -> None:
    assert formatear_formula_molecular("2H2O") == "2H₂O"
    assert formatear_formula_molecular("CuSO4·5H2O") == "CuSO₄·5H₂O"


def test_formatear_formula_idempotente() -> None:
    ya = "C₆H₁₂O₆"
    assert formatear_formula_molecular(ya) == ya
    assert formatear_formula_molecular("") == ""


def test_formula_html_sub() -> None:
    assert str(formula_a_html_sub("C6H12O6")) == "C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>"
    assert str(formula_a_html_sub("C₆H₁₂O₆")) == "C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>"
    assert str(formula_a_html_sub("2H2O")) == "2H<sub>2</sub>O"
    html = str(formula_a_html_sub("<C6>"))
    assert "&lt;" in html
    assert "<sub>6</sub>" in html
