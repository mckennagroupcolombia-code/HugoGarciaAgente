from app.services.documento_cientifico import (
    _CAMPOS_PERMITIDOS,
    normalizar_filas_parametros_coa,
    plantilla_parametros_coa,
    sugerir_parametros_coa,
)


def test_coa_parametros_es_campo_permitido() -> None:
    assert "coa_parametros" in _CAMPOS_PERMITIDOS


def test_plantilla_parametros_coa_nunca_vacia() -> None:
    out = plantilla_parametros_coa()
    assert "Aspecto|" in out
    assert out.count("|Conforme") >= 8
    assert "Escherichia coli" in out


def test_normalizar_filas_parametros_coa() -> None:
    crudo = """
| Parámetro | Especificación | Resultado |
|-----------|----------------|-----------|
Aspecto|Polvo blanco|Conforme
Pureza|≥ 99.0 %
# comentario
no es una fila
"""
    out = normalizar_filas_parametros_coa(crudo)
    lineas = out.split("\n")
    assert lineas[0] == "Aspecto|Polvo blanco|Conforme"
    assert lineas[1] == "Pureza|≥ 99.0 %|Conforme"
    assert "Parámetro" not in out
    assert "comentario" not in out
    assert "no es una fila" not in out


def test_normalizar_filas_vinetas_y_dos_puntos() -> None:
    crudo = """
- Aspecto: Polvo blanco
1. pH | 4.5-6.5 | Conforme
"""
    out = normalizar_filas_parametros_coa(crudo)
    assert "Aspecto|Polvo blanco|Conforme" in out
    assert "pH|4.5-6.5|Conforme" in out


def test_sugerir_parametros_coa_fallback_sin_gemini(monkeypatch) -> None:
    import app.services.documento_cientifico as m

    def _boom(_prompt: str) -> str:
        raise RuntimeError("sin red")

    monkeypatch.setattr(m, "_sintetizar_texto", _boom)
    r = sugerir_parametros_coa("Ácido cítrico")
    assert r["ok"] is True
    assert r["origen"] == "plantilla"
    assert "Aspecto|" in r["valor"]

