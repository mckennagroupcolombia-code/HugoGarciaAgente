"""Match COA → PDF biblioteca (espejo de app/services/coa_biblioteca_match.py)."""
from __future__ import annotations

from app.services.coa_biblioteca_match import (
    sustancias_compatibles,
    validar_archivo_biblioteca,
)


def test_eritritol_no_es_celulosa():
    assert not sustancias_compatibles("Erythritol Crystal", "FT CELULOSA MICROCRISTALINA")
    assert not sustancias_compatibles("Eritritol", "FT COLORANTE ERITROSINA")
    assert sustancias_compatibles("Erythritol Crystal", "FT COA SDS ERITRITOL")
    assert sustancias_compatibles("Eritritol", "Erythritol Crystal powder")


def test_validar_archivo_rechaza_cruzado():
    assert (
        validar_archivo_biblioteca("Erythritol Crystal", "FT CELULOSA MICROCRISTALINA.pdf")
        == ""
    )
    assert (
        validar_archivo_biblioteca("Erythritol Crystal", "FT COA SDS ERITRITOL.pdf")
        == "FT COA SDS ERITRITOL.pdf"
    )


def test_celulosa_ok_consigo():
    assert sustancias_compatibles(
        "Celulosa microcristalina",
        "FT CELULOSA MICROCRISTALINA",
    )


def test_ascorbico_no_es_citrico():
    assert not sustancias_compatibles("Ácido Ascórbico", "Acido Citrico Anhidro")
