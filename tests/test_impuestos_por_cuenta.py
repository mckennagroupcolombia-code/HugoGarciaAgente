"""El perfil tributario de una cuenta del PUC.

Existe porque hasta sep-2026 el wizard preguntaba dos veces lo mismo: una
«categoría» con botón propio (Transporte, Servicios públicos…) y aparte la
cuenta contable. Podían contradecirse —«Servicios» traía el 4% aunque el gasto
fuera a 513550 Transporte, donde la tarifa es el 1%— y entonces el botón
decidía el impuesto y la cuenta decidía el balance.
"""
from __future__ import annotations

import pytest

from app.services import impuestos_por_cuenta as ipc


@pytest.mark.parametrize(
    "cuenta, concepto",
    [
        ("1435", "compras"),
        ("513550", "transporte_carga"),
        ("5135", "servicios"),
        ("511095", "servicios"),      # prestación de servicios, NO honorarios
        ("5110", "honorarios"),
        ("529505", "comisiones"),
        ("530520", "rendimientos_financieros"),
        ("5120", "arrendamiento_inmueble"),
    ],
)
def test_cada_cuenta_sabe_que_retencion_lleva(cuenta, concepto):
    assert ipc.perfil(cuenta)["concepto_retencion"] == concepto


@pytest.mark.parametrize("cuenta", ["513525", "513530", "513535", "513555"])
def test_los_servicios_publicos_no_llevan_retencion(cuenta):
    p = ipc.perfil(cuenta)
    assert p["concepto_retencion"] is None
    assert p["conocida"] is True          # es una decisión, no un «no sé»
    assert "autorretened" in p["nota"]


def test_511095_no_es_honorarios_aunque_la_cuenta_se_llame_asi():
    """La quincena de quien presta servicios vive en 511095 «Honorarios — otros»
    pero lleva retención de SERVICIOS (4%/6%). Aplicarle el 10% de honorarios le
    recorta la quincena a una persona real."""
    p = ipc.perfil("511095")
    assert p["concepto_retencion"] == "servicios"
    assert "honorarios" in p["nota"].lower()


def test_transporte_advierte_de_los_autorretenedores():
    """Retener a una transportadora autorretenedora es un reclamo; no retener a
    un mensajero persona natural es una deuda silenciosa del Art. 370 E.T. El
    default retiene y la advertencia es la que permite apagarlo a tiempo."""
    p = ipc.perfil("513550")
    assert p["concepto_retencion"] == "transporte_carga"
    assert "autorretenedora" in p["advertencia"]


def test_una_cuenta_desconocida_no_inventa_retencion():
    p = ipc.perfil("999999")
    assert p["conocida"] is False
    assert p["concepto_retencion"] is None
    assert p["ica_por_mil"] == 0


def test_una_subcuenta_nueva_hereda_de_su_grupo():
    # Alguien agrega 513560 al plan: mejor heredar de 5135 que quedarse sin
    # propuesta. Una casilla vacía se aprueba igual de rápido que una llena.
    p = ipc.perfil("513560")
    assert p["concepto_retencion"] == "servicios"
    assert p["heredado_de"] == "5135"


def test_el_prefijo_mas_especifico_gana():
    # 513550 no puede caer en el genérico 5135: son 1% y 4%.
    assert ipc.perfil("513550")["concepto_retencion"] == "transporte_carga"


def test_describir_resuelve_tarifa_y_minimo():
    d = ipc.describir("513550", anio=2026, base=1_998_000)
    assert d["tarifa_pct"] == 1.0
    assert d["retencion_estimada"] == pytest.approx(19_980, abs=1)
    assert d["minimo_cop"] == pytest.approx(4 * 52_374, abs=1)


def test_todo_concepto_propuesto_existe_en_retenciones():
    """Si un perfil nombra un concepto que la tabla de tarifas no tiene, el
    wizard revienta al previsualizar — con el operador mirando."""
    from app.services.retenciones import CONCEPTOS

    for cuenta in ipc._PERFILES:
        c = ipc.perfil(cuenta)["concepto_retencion"]
        assert c is None or c in CONCEPTOS, cuenta


# ─── Transporte: las dos cuentas y las dos tarifas (18-sep-2026) ───────────

@pytest.mark.parametrize("cuenta", ["513550", "523550"])
def test_las_dos_cuentas_de_transporte_llevan_1_por_ciento_y_ica_4_14(cuenta):
    """El flete de la mercancía que sale al cliente es gasto de VENTAS (523550) y
    el administrativo se queda en 513550. Distinto renglón del resultado, mismo
    tratamiento tributario."""
    p = ipc.perfil(cuenta)
    assert p["concepto_retencion"] == "transporte_carga"
    assert p["ica_por_mil"] == 4.14


def test_las_tarifas_de_transporte_reproducen_el_certificado_del_contador():
    """No son una lectura nuestra de la norma: el contador certificó a NEXT
    ENVIOS por 2024 sobre base $17.377.500 exactamente $173.775 de renta y
    $71.943 de ICA."""
    d = ipc.describir("523550", anio=2024, base=17_377_500)
    assert d["retencion_estimada"] == pytest.approx(173_775, abs=1)
    assert round(17_377_500 * d["ica_por_mil"] / 1000) == pytest.approx(71_943, abs=1)


def test_el_transporte_no_cae_en_el_saco_de_servicios_de_ventas():
    """523550 debe ganarle a 5235: son 1% y 4%, y el ICA 4,14 contra 9,66."""
    assert ipc.perfil("5235")["concepto_retencion"] == "servicios"
    assert ipc.perfil("523550")["concepto_retencion"] == "transporte_carga"
