"""El rótulo de envío: qué debe llevar impreso y qué no.

El PDF se revisa con `pdftotext` (poppler); si no está instalado, esas pruebas
se saltan en vez de fallar — pero las reglas de `normalizar_datos` se verifican
siempre, porque ahí es donde se descartan contenido y valor declarado.
"""
import shutil
import subprocess
import tempfile

import pytest

from app.tools import guias_envio as ge

PEDIDO = {
    "canal": "web",
    "pedido_id": "MCKG-000250",
    "nombre": "María Fernanda Rodríguez",
    "telefono": "310 842 55 71",
    "direccion": "Calle 128 B # 58 A - 21",
    "ciudad": "Bogotá",
    "departamento": "Cundinamarca",
    "contenido": ["Ácido ascórbico 500 g x2"],
    "valor_declarado": 189000,
    "piezas": 1,
}


def test_normalizar_descarta_contenido_y_valor():
    # Van por fuera de la caja, a la vista de cualquiera: no se imprimen.
    d = ge.normalizar_datos(PEDIDO)
    assert "contenido" not in d
    assert "valor_declarado" not in d
    assert d["ciudad"] == "Bogotá"


def test_normalizar_exige_destino():
    with pytest.raises(ValueError):
        ge.normalizar_datos({**PEDIDO, "direccion": ""})


def _texto_pdf(pdf: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(pdf)
        f.flush()
        return subprocess.run(
            ["pdftotext", f.name, "-"], capture_output=True, text=True, check=True
        ).stdout


@pytest.mark.skipif(not shutil.which("pdftotext"), reason="poppler no instalado")
def test_pdf_lleva_remitente_y_lema_y_no_el_valor():
    texto = _texto_pdf(ge.generar_pdf([PEDIDO]))
    assert "MCKENNA GROUP S.A.S." in texto
    assert "901.316.016-3" in texto
    assert "319 518 35 96" in texto
    assert "www.mckennagroup.co" in texto
    assert ge.LEMA in texto
    assert "189" not in texto.replace("MCKG-000250", "")  # ni rastro del valor
    assert "ascórbico" not in texto


@pytest.mark.skipif(not shutil.which("pdftotext"), reason="poppler no instalado")
def test_pdf_en_todos_los_tamanos():
    for tam in ge.TAMANOS:
        texto = _texto_pdf(ge.generar_pdf([PEDIDO], tamano=tam))
        assert "BOGOTÁ" in texto.upper(), tam
