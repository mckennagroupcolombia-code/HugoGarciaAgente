"""Identidad fiscal de McKenna: una sola fuente para razón social, NIT y ciudad.

Existe por un incidente real: el NIT estaba escrito a mano en cuatro sitios y en
dos estaba mal ("901.952.087-1"), con lo que 41 cuentas de cobro se emitieron con
un NIT que no es el de la empresa. Estos tests son la red para que no vuelva a
bifurcarse.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.services import empresa

REPO = Path(__file__).resolve().parents[1]
NIT_CORRECTO = "901.316.016-3"
NIT_ERRONEO = "901.952.087"


def test_nit_es_el_verificado_contra_alegra():
    # GET /company de Alegra (2026-09-10): identification 901316016, dv 3.
    assert empresa.NIT_DEFAULT == NIT_CORRECTO
    assert empresa.nit() == NIT_CORRECTO
    assert empresa.nit_sin_dv() == "901316016"


def test_todos_los_modulos_usan_el_mismo_nit():
    from app.services.calendario_tributario import nit_empresa
    from app.services.cuenta_cobro_cuota_manejo import datos_pagador
    from app.tools.prestamos_pdf import MCKENNA_NIT

    assert {empresa.nit(), nit_empresa(), datos_pagador()["nit"], MCKENNA_NIT} == {NIT_CORRECTO}


def _strings_de_codigo_python(ruta: Path) -> list[tuple[int, str]]:
    """Literales de cadena que son CÓDIGO, excluyendo docstrings.

    La distinción importa: el NIT viejo debe poder mencionarse en la
    documentación del incidente, pero nunca volver a usarse como valor.
    """
    import ast

    try:
        arbol = ast.parse(ruta.read_text(encoding="utf-8", errors="ignore"))
    except SyntaxError:
        return []
    docstrings = set()
    for nodo in ast.walk(arbol):
        if isinstance(nodo, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            cuerpo = getattr(nodo, "body", None)
            if cuerpo and isinstance(cuerpo[0], ast.Expr) and isinstance(cuerpo[0].value, ast.Constant):
                if isinstance(cuerpo[0].value.value, str):
                    docstrings.add(id(cuerpo[0].value))
    return [
        (nodo.lineno, nodo.value)
        for nodo in ast.walk(arbol)
        if isinstance(nodo, ast.Constant) and isinstance(nodo.value, str) and id(nodo) not in docstrings
    ]


def test_el_nit_erroneo_no_quedo_en_ningun_lado():
    """Ningún archivo puede volver a traer el NIT viejo como valor en uso.

    Se permite mencionarlo en docstrings y comentarios —ahí queda la historia
    del incidente— pero no como literal que el código pueda emitir.
    """
    patron = re.compile(r"901[.\s]?952[.\s]?087")
    ofensores = []
    for carpeta in ("app", "desktop/src", "scripts"):
        raiz = REPO / carpeta
        if not raiz.exists():
            continue
        for ruta in raiz.rglob("*"):
            if "node_modules" in ruta.parts:
                continue
            if ruta.suffix == ".py":
                ofensores += [
                    f"{ruta.relative_to(REPO)}:{n}"
                    for n, texto in _strings_de_codigo_python(ruta)
                    if patron.search(texto)
                ]
            elif ruta.suffix in (".ts", ".tsx"):
                # Quita bloques /* */ y comentarios de línea antes de buscar
                crudo = ruta.read_text(encoding="utf-8", errors="ignore")
                sin_bloques = re.sub(r"/\*.*?\*/", "", crudo, flags=re.S)
                for n, linea in enumerate(sin_bloques.splitlines(), 1):
                    if linea.strip().startswith("//"):
                        continue
                    if patron.search(re.sub(r"//.*$", "", linea)):
                        ofensores.append(f"{ruta.relative_to(REPO)}:{n}")
    assert not ofensores, "NIT incorrecto en uso: " + ", ".join(ofensores)


@pytest.mark.parametrize(
    "override, valor, espera",
    [("EMPRESA_NIT", "800.111.222-3", "800.111.222-3"),
     ("CUOTA_MANEJO_PAGADOR_NIT", "700.999.888-1", "700.999.888-1")],
)
def test_se_puede_sobreescribir_por_entorno(monkeypatch, override, valor, espera):
    monkeypatch.setenv(override, valor)
    assert empresa.nit(override if override != "EMPRESA_NIT" else "") == espera


@pytest.mark.parametrize(
    "crudo, base",
    [("901.316.016-3", "901316016"), ("901316016", "901316016"),
     ("9013160163", "901316016"), ("901316016-3", "901316016")],
)
def test_nit_sin_dv_maneja_los_formatos_del_repo(monkeypatch, crudo, base):
    # 10 dígitos corridos = base(9) + DV; con guion, la base es lo de antes.
    monkeypatch.setenv("EMPRESA_NIT", crudo)
    assert empresa.nit_sin_dv() == base
