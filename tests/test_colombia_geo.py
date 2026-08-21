"""Resolución departamento/municipio (DIVIPOLA) usada por el checkout web y por
la cobertura real del inicio."""

from __future__ import annotations

from app.tools import colombia_geo as cg


def test_resolver_municipio_exacto() -> None:
    assert cg.resolver_departamento_municipio("Medellín") == ("Antioquia", "Medellín")


def test_resolver_municipio_sin_tildes_ni_mayusculas() -> None:
    assert cg.resolver_departamento_municipio("medellin") == ("Antioquia", "Medellín")
    assert cg.resolver_departamento_municipio("  BOGOTÁ D.C.  ") == ("Bogotá D.C.", "Bogotá D.C.")


def test_resolver_municipio_alias() -> None:
    assert cg.resolver_departamento_municipio("Bogota") == ("Bogotá D.C.", "Bogotá D.C.")
    assert cg.resolver_departamento_municipio("Cartagena de Indias") == ("Bolívar", "Cartagena")


def test_resolver_municipio_desconocido_devuelve_none() -> None:
    assert cg.resolver_departamento_municipio("Ciudad Que No Existe") is None
    assert cg.resolver_departamento_municipio("") is None
    assert cg.resolver_departamento_municipio(None) is None


def test_resolver_departamento_por_nombre_libre() -> None:
    assert cg.resolver_departamento("cundinamarca") == "Cundinamarca"
    assert cg.resolver_departamento("VALLE DEL CAUCA") == "Valle del Cauca"
    assert cg.resolver_departamento("Departamento Inventado") is None


def test_totales_consistentes_con_colombia_data() -> None:
    assert cg.TOTAL_DEPARTAMENTOS == len(cg.COLOMBIA_DATA)
    assert cg.TOTAL_MUNICIPIOS == sum(len(v) for v in cg.COLOMBIA_DATA.values())
