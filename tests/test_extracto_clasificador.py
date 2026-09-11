"""Clasificación de las líneas de banco que nadie registró.

En jul-ago 2026 el 56% del extracto (200 de 358 líneas) no tenía contrapartida
en el libro. Estas pruebas fijan las decisiones que se tomaron para no volver a
clasificar mal lo que cuesta caro: los traslados entre cuentas propias, los
pagos a personas que el banco rotula como «proveedor», y el emparejamiento
contra nombres que el banco trunca.
"""
from __future__ import annotations

import pytest

from app.services import extracto_clasificador as ec


def _linea(desc, monto=100_000, tipo="debito", id_=1):
    return {"id": id_, "fecha": "2026-08-15", "descripcion": desc, "monto": monto, "tipo": tipo}


@pytest.mark.parametrize(
    "banco, razon_social",
    [
        ("PAGO A PROVE FACTORES Y MERC", "FACTORES Y MERCADEO S.A."),
        # El banco mete espacios donde la razón social no los tiene y corta
        # 'SAS' a media palabra: por eso no se comparan palabras sueltas.
        ("PAGO A PROVE PRODUCTOS 3 A S", "PRODUCTOS 3A SAS"),
        ("PAGO A PROVE QUIMICA INTERKR", "QUIMICA INTERKROL LIMITADA"),
        ("PAGO A PROVE DISOLVENTES Y SO", "DISOLVENTES Y SOLUCIONES QUIMICAS S.A.S"),
    ],
)
def test_empareja_nombres_truncados_por_el_banco(banco, razon_social):
    terceros = [(ec._norm(razon_social), {"id": 1, "nombre": razon_social, "tipo_persona": "juridica"})]
    assert ec._buscar_tercero(banco, terceros)["nombre"] == razon_social


def test_no_inventa_un_tercero_cuando_no_esta():
    terceros = [(ec._norm("FACTORES Y MERCADEO S.A."),
                 {"id": 1, "nombre": "FACTORES Y MERCADEO S.A.", "tipo_persona": "juridica"})]
    assert ec._buscar_tercero("PAGO A PROVE BANCO LA P S A S", terceros) is None


def test_nombre_demasiado_corto_no_casa_con_medio_directorio():
    terceros = [(ec._norm("D1 S A S"), {"id": 1, "nombre": "D1 S A S", "tipo_persona": "juridica"})]
    assert ec._buscar_tercero("PAGO A PROVE D1", terceros) is None


def test_mercadopago_nunca_se_aplica_solo():
    """$40,7M entre cuentas propias: como ingreso infla ventas, como gasto infla costos."""
    for desc in ("PAGO INTERBANC MERCAOPAGO SA", "PAGO PSE Mercadopago Colombi"):
        for tipo in ("credito", "debito"):
            p = ec.clasificar(_linea(desc, 11_000_000, tipo), terceros=[])
            assert p["confianza"] == ec.REVISAR
            assert p["cuenta"] is None
            assert "MercadoPago" in p["concepto"]


def test_pago_a_persona_natural_es_servicio_no_proveedor():
    """El banco rotula «PAGO A PROVE» la quincena de quien presta servicios."""
    stella = {"id": 35, "nombre": "Gloria Stella Velandia Cobos", "tipo_persona": "natural"}
    p = ec.clasificar(_linea("PAGO A PROVE GLORIA STELLA VE", 2_500_000),
                      terceros=[(ec._norm(stella["nombre"]), stella)])
    assert p["cuenta"] == "5135"          # no 2205
    assert p["confianza"] == ec.REVISAR   # lleva retención y cuenta de cobro
    assert p["tercero"]["id"] == 35


def test_pago_a_socio_no_se_aplica_sin_partirlo():
    """Un giro a un socio mezcla reintegro de compras con pago de servicios."""
    armando = {"id": 2, "nombre": "Armando Garcia", "tipo_persona": "natural",
               "tipo": "socio", "usuario_id": 3}
    p = ec.clasificar(_linea("PAGO A PROVE ARMANDO GARCIA", 5_000_000),
                      terceros=[(ec._norm(armando["nombre"]), armando)])
    assert p["cuenta"] == "2380"
    assert p["confianza"] == ec.REVISAR


def test_empresa_con_factura_si_va_a_proveedores():
    prov = {"id": 5, "nombre": "FACTORES Y MERCADEO S.A.", "tipo_persona": "juridica"}
    p = ec.clasificar(_linea("PAGO A PROVE FACTORES Y MERC", 5_895_482),
                      terceros=[(ec._norm(prov["nombre"]), prov)])
    assert p["cuenta"] == "2205"
    assert p["confianza"] == ec.ALTA


@pytest.mark.parametrize(
    "desc, tipo, cuenta",
    [
        ("COBRO IVA PAGOS AUTOMATICOS", "debito", "5305"),
        ("SERVICIO PAGO A TERCEROS", "debito", "5305"),
        ("IMPTO GOBIERNO 4X1000", "debito", "5305"),
        ("ABONO INTERESES AHORROS", "credito", "4295"),
        ("PAGO PSE DIAN", "debito", "2365"),
    ],
)
def test_costos_bancarios_e_intereses_se_clasifican_solos(desc, tipo, cuenta):
    p = ec.clasificar(_linea(desc, 1_000, tipo), terceros=[])
    assert p["cuenta"] == cuenta
    assert p["confianza"] == ec.ALTA


def test_entrada_sin_identificar_no_se_marca_como_venta():
    """Las ventas ya entran por el auto-posteo; clasificarlas acá las duplicaría."""
    p = ec.clasificar(_linea("CONSIG LOCAL CAJ ATM MF PLAZA", 9_200_000, "credito"), terceros=[])
    assert p["cuenta"] is None
    assert p["confianza"] == ec.REVISAR


def test_descripcion_desconocida_no_se_fuerza_a_ninguna_cuenta():
    p = ec.clasificar(_linea("ALGO QUE EL BANCO NUNCA HABIA MANDADO"), terceros=[])
    assert p["cuenta"] is None
    assert p["confianza"] == ec.REVISAR
