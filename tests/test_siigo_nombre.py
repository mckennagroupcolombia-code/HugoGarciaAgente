"""Tests para normalizar_pulgadas_en_nombre y sanitizar_nombre_siigo."""
import re

import pytest

from app.services.siigo import normalizar_pulgadas_en_nombre, sanitizar_nombre_siigo
from app.tools.importar_productos_siigo import generar_codigo_producto

_SIIGO_NOMBRE_OK = re.compile(
    r'^[\w\.@\-\\%_;()\]#?¡\[/:{ } *+,$"\sñáéíóúÁÉÍÓÚüÜ\-"]+$',
    re.UNICODE,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('FLANCHE PVC 1\u201d (REF PVC 289)', 'FLANCHE PVC 1P (REF PVC 289)'),
        ('FLANCHE PVC 1\u2033 (REF PVC 289)', 'FLANCHE PVC 1P (REF PVC 289)'),
        ('FLANCHE PVC 1" (REF PVC 289)', 'FLANCHE PVC 1P (REF PVC 289)'),
        ('CODO PVC 2"', 'CODO PVC 2P'),
        ('TUBERIA 1,5"', 'TUBERIA 15P'),
        ('FLANCHE PVC 1/2"', 'FLANCHE PVC 05P'),
        ('FLANCHE PVC 1/2P (REF PVC 267)', 'FLANCHE PVC 05P (REF PVC 267)'),
        ('CODO PVC 3/4\u201d', 'CODO PVC 075P'),
        ('TEE PVC 1 1/2"', 'TEE PVC 15P'),
        ("Producto  normal   con   espacios", "Producto  normal   con   espacios"),
    ],
)
def test_normalizar_pulgadas_en_nombre(raw, expected):
    assert normalizar_pulgadas_en_nombre(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('FLANCHE PVC 1\u201d (REF PVC 289)', 'FLANCHE PVC 1P REF PVC 289'),
        ('FLANCHE PVC 1" (REF PVC 289)', 'FLANCHE PVC 1P REF PVC 289'),
        ('Nombre con «comillas» latinas', 'Nombre con comillas latinas'),
    ],
)
def test_sanitizar_nombre_siigo(raw, expected):
    out = sanitizar_nombre_siigo(raw)
    assert out == expected
    assert _SIIGO_NOMBRE_OK.match(out)
    assert '"' not in out
    assert len(out) <= 100


def test_sanitizar_nombre_siigo_trunca_a_100():
    largo = "A" * 120
    assert len(sanitizar_nombre_siigo(largo)) == 100


def test_sanitizar_nombre_siigo_vacio():
    assert sanitizar_nombre_siigo("") == ""
    assert sanitizar_nombre_siigo("   \u201d  ") == ""


def test_generar_codigo_incluye_pulgada_1p():
    nombre = normalizar_pulgadas_en_nombre('FLANCHE PVC 1\u201d (REF PVC 289)')
    codigo = generar_codigo_producto(nombre, 'Un')
    assert '1P' in codigo or codigo.startswith('FLAPV')


def test_generar_codigo_media_no_confunde_con_2p():
    """1/2″ (media) no debe volverse 2P por capturar solo el dígito antes de "."""
    for raw in ('FLANCHE PVC 1/2" (REF PVC 289)', 'FLANCHE PVC 1/2P (REF PVC 267)'):
        nombre = normalizar_pulgadas_en_nombre(raw)
        assert '05P' in nombre
        assert '1/2' not in nombre
        codigo = generar_codigo_producto(nombre, 'Un')
        assert '2P' not in codigo
        assert '05P' in codigo
