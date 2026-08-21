from app.services.documento_cientifico import (
    _CAMPOS_PERMITIDOS,
    normalizar_filas_parametros_coa,
)


def test_coa_parametros_es_campo_permitido() -> None:
    assert "coa_parametros" in _CAMPOS_PERMITIDOS


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
