"""El contrato que recibe el prestamista: firmado, explicado y con su cronograma.

La primera versión enviada a un prestamista real salió sin firma y con seis
cláusulas de lenguaje jurídico donde lo que la persona necesita saber —cuánto
pone, cuánto recibe y por qué le descuentan— quedaba enterrado. Se devolvió.
Estas pruebas fijan lo que se corrigió.
"""
from __future__ import annotations

import subprocess

import pytest

from app.services import empresa
from app.services.prestamos import calcular_cronograma
from app.tools import prestamos_pdf

CAPITAL = 10_000_000


def _prestamo_demo() -> dict:
    calc = calcular_cronograma(CAPITAL)
    t = calc["totales"]
    return {
        "id": 1,
        "capital": CAPITAL,
        "fecha_desembolso": "2026-08-09",
        "plazo_meses": 24,
        "tasa_ea": 0.25,
        "retencion_pct": 0.07,
        "dia_pago": 9,
        "gross_up": 0,
        "tercero": {"nombre": "Antonio Ruiz", "identificacion": "19477735"},
        "cuotas": [dict(c, fecha_vencimiento=c.get("fecha_vencimiento", "2026-09-09")) for c in calc["cuotas"]],
        "resumen": {
            "cuotas": 24,
            "cuotas_pagadas": 0,
            "interes_total": t["interes_bruto"],
            "retencion_total": t["retencion"],
            "rendimiento_bruto_pct": t["rendimiento_bruto_pct"],
            "tasa_mensual_pct": t.get("tasa_mensual_pct", 1.8769),
        },
    }


def _texto(ruta: str) -> str:
    salida = subprocess.run(["pdftotext", "-layout", ruta, "-"], capture_output=True, text=True)
    if salida.returncode != 0:
        pytest.skip("pdftotext no disponible")
    # pdftotext parte las frases en los saltos de línea del PDF; para buscar
    # texto hay que volver a juntarlas.
    return " ".join(salida.stdout.split())


def test_contrato_sale_firmado_por_el_representante(tmp_path):
    ruta = prestamos_pdf.generar_pdf_contrato(_prestamo_demo(), destino=str(tmp_path / "c.pdf"))
    texto = _texto(ruta)
    rep = empresa.representante_legal()
    assert rep["nombre"] in texto
    assert rep["cedula"] in texto
    # La firma vive fuera del repo: si falta, el PDF lo advierte en vez de
    # hacerse pasar por firmado.
    if rep.get("firma_path"):
        assert "sin la firma" not in texto
    else:
        assert "sin la firma" in texto


def test_contrato_explica_la_retencion_sin_jerga(tmp_path):
    ruta = prestamos_pdf.generar_pdf_contrato(_prestamo_demo(), destino=str(tmp_path / "c.pdf"))
    texto = _texto(ruta)
    assert "anticipo de su impuesto de renta" in texto
    assert "Art. 395" in texto
    assert "MUTUANTE" not in texto  # el contrato ya no habla en tercera persona jurídica


def test_contrato_abre_con_lo_que_el_prestamista_recibe(tmp_path):
    ruta = prestamos_pdf.generar_pdf_contrato(_prestamo_demo(), destino=str(tmp_path / "c.pdf"))
    texto = _texto(ruta)
    assert "Usted presta" in texto
    assert "Usted recibe en total" in texto
    # El cronograma completo va en la segunda página, no en la primera.
    assert "Cronograma de pagos" in texto
    assert texto.index("Usted presta") < texto.index("Cronograma de pagos")
