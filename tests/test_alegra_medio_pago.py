"""
El medio de pago que se declara a la DIAN no puede volver a ser "efectivo".

Contexto: las 150 facturas electrónicas emitidas hasta el 2026-09-12 salieron
con `paymentMethod: "CASH"` porque era un literal en el payload, cuando el 100%
del cobro de McKenna es digital (Mercado Pago, PSE, botón Bancolombia, tarjeta).
"""
import pytest

from app.services import alegra


@pytest.mark.parametrize(
    "pasarela,esperado",
    [
        ("account_money", "CREDIT_TRANSFER"),   # saldo Mercado Pago (caso de FE357)
        ("pse", "DEBIT_TRANSFER"),
        ("boton_bancolombia", "DEBIT_TRANSFER"),
        ("visa", "CREDIT_CARD"),
        ("debmaster", "DEBIT_CARD"),
        ("efecty", "CASH"),                     # esto SÍ es efectivo
    ],
)
def test_medio_pago_por_pasarela(pasarela, esperado):
    assert alegra.medio_pago_alegra(pasarela) == esperado


def test_desconocido_no_cae_en_efectivo():
    """Un medio que no reconocemos se declara como transferencia, nunca efectivo:
    equivocarse hacia 'efectivo' es justo el error que se está corrigiendo."""
    for entrada in ("", None, "pasarela_nueva_2027"):
        assert alegra.medio_pago_alegra(entrada) != "CASH"
        assert alegra.medio_pago_alegra(entrada) == alegra.MEDIO_PAGO_ALEGRA_DEFECTO


def test_medio_pago_desde_orden_meli():
    orden = {"payments": [{"payment_type": "account_money", "status": "approved"}]}
    assert alegra.medio_pago_meli_desde_orden(orden) == "CREDIT_TRANSFER"
    orden_tarjeta = {"payments": [{"payment_type": "credit_card", "payment_method_id": "visa"}]}
    assert alegra.medio_pago_meli_desde_orden(orden_tarjeta) == "CREDIT_CARD"
    assert alegra.medio_pago_meli_desde_orden({}) == alegra.MEDIO_PAGO_ALEGRA_DEFECTO


def test_codigo_dian_explicito_se_respeta():
    assert alegra.medio_pago_alegra("DEBIT_CARD") == "DEBIT_CARD"
