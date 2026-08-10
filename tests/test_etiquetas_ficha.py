"""Tests generación descripción etiqueta alternativa desde ficha."""

from app.tools.etiquetas_ficha import generar_descripcion_desde_ficha

FICHA_CITRATO = """
CITRATO DE MAGNESIO
DESCRIPCIÓN
Es una sal hidratada con relación 3:2 de magnesio a citrato.
El citrato se usa en alimentos y bebidas. El magnesio apoya la salud ósea y puede causar calambres si falta.
APLICACIONES
Puede ser usado como suplemento dietario y nutriente. Uso farmacéutico en el corazón.
Nota: El producto cumple con el estándar USP 32.
"""


def test_generar_descripcion_estructurada_citrato():
    out = generar_descripcion_desde_ficha(FICHA_CITRATO, nombre="Citrato de Magnesio")
    low = out.lower()
    assert "descripción general" in low
    assert "aplicaciones y usos industriales" in low
    assert "información técnica y regulatoria" in low
    assert "3:2" in low
    assert "usp 32" in low
    assert "resolución 2674" in low
    assert "calambres" not in low
    assert "laxante" not in low
    assert "industria de bebidas" in low


def test_generar_descripcion_generica_sin_health_claims():
    ficha = """
DESCRIPCIÓN
Polvo cristalino para uso en formulación de alimentos.
APLICACIONES
En la elaboración de bebidas y productos de panadería industrial.
"""
    out = generar_descripcion_desde_ficha(ficha, nombre="Ácido cítrico")
    assert "descripción general" in out.lower()
    assert "aplicaciones" in out.lower()
