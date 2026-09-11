"""Calendario tributario: vencimientos de retención en la fuente.

La tabla está transcrita a mano del calendario CIJUF (DUR 1625 de 2016, Arts.
1.6.1.13.2.33. y 1.2.6.6.). Estos tests son la red contra un error de
transcripción — sobre todo el de fin de semana, que es el que se cuela sin que
nadie lo note hasta que alguien declara tarde.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.services.calendario_tributario import (
    ANIOS_CARGADOS,
    _RETENCION_MENSUAL,
    fecha_limite_certificado_retenciones,
    info_vencimiento_retencion,
    ultimo_digito_nit,
    vencimiento_retencion,
)

# Verificado contra GET /company de Alegra (2026-09-10): 901316016, dv 3.
NIT_MCKENNA = "901.316.016-3"


@pytest.mark.parametrize(
    "nit, esperado",
    [
        ("901.316.016-3", 6),   # el DV es 3, el dígito del calendario es el 6
        ("901316016-3", 6),
        ("901316016 - 3", 6),
        ("9013160163", 6),      # 10 dígitos corridos = base(9) + DV
        ("901316016", 6),
        ("79123456", 6),        # cédula, sin DV
        ("", None),
        ("sin números", None),
    ],
)
def test_ultimo_digito_ignora_el_digito_de_verificacion(nit, esperado):
    assert ultimo_digito_nit(nit) == esperado


def test_ninguna_fecha_del_calendario_cae_en_fin_de_semana():
    # La DIAN no fija vencimientos en sábado ni domingo: si alguno cae ahí, la
    # tabla está mal transcrita.
    for anio, tabla in _RETENCION_MENSUAL.items():
        for digito in tabla:
            for mes in range(1, 13):
                f = vencimiento_retencion(anio, mes, f"90000000{digito}")
                assert f is not None
                assert f.weekday() < 5, f"{anio}-{mes:02d} dígito {digito} → {f} cae en fin de semana"


def test_cada_digito_tiene_los_doce_meses():
    for anio, tabla in _RETENCION_MENSUAL.items():
        assert set(tabla) == set(range(10)), f"faltan dígitos en {anio}"
        for digito, dias in tabla.items():
            assert len(dias) == 12, f"{anio} dígito {digito} no tiene 12 meses"
            assert all(1 <= d <= 31 for d in dias)


def test_el_orden_de_los_digitos_es_creciente_dentro_del_mes():
    # El calendario reparte por dígito en orden: 1 declara antes que 9, y el 0
    # de último. Un salto fuera de orden delata una fila corrida al transcribir.
    for anio, tabla in _RETENCION_MENSUAL.items():
        for mes in range(12):
            secuencia = [tabla[d][mes] for d in (1, 2, 3, 4, 5, 6, 7, 8, 9, 0)]
            assert secuencia == sorted(secuencia), f"{anio} mes {mes + 1}: {secuencia} fuera de orden"


def test_se_presenta_el_mes_siguiente_al_periodo():
    f = vencimiento_retencion(2026, 1, NIT_MCKENNA)
    assert (f.year, f.month) == (2026, 2)
    # Diciembre se declara en enero del año siguiente
    f12 = vencimiento_retencion(2026, 12, NIT_MCKENNA)
    assert (f12.year, f12.month) == (2027, 1)


def test_vencimientos_2026_de_mckenna():
    # Dígito 6 (NIT 901.316.016-3). Valores del calendario publicado.
    esperados = {
        1: date(2026, 2, 17), 2: date(2026, 3, 17), 3: date(2026, 4, 21),
        4: date(2026, 5, 20), 5: date(2026, 6, 18), 6: date(2026, 7, 16),
        7: date(2026, 8, 20), 8: date(2026, 9, 16), 9: date(2026, 10, 19),
        10: date(2026, 11, 19), 11: date(2026, 12, 17), 12: date(2027, 1, 20),
    }
    for mes, esperado in esperados.items():
        assert vencimiento_retencion(2026, mes, NIT_MCKENNA) == esperado


def test_no_inventa_fechas_para_anios_sin_calendario():
    # Regla dura del módulo: el calendario cambia por decreto cada año.
    assert 2027 not in ANIOS_CARGADOS
    assert vencimiento_retencion(2027, 1, NIT_MCKENNA) is None
    assert vencimiento_retencion(2030, 6, NIT_MCKENNA) is None

    info = info_vencimiento_retencion(2027, 1)
    assert info["conocido"] is False
    assert info["estado"] == "desconocido"
    assert "contador" in info["motivo"]


def test_nit_ilegible_no_produce_fecha():
    assert vencimiento_retencion(2026, 1, "") is None
    assert info_vencimiento_retencion(2026, 1, nit="")["conocido"] is False


def test_mes_invalido_se_rechaza():
    for mes in (0, 13, -1):
        with pytest.raises(ValueError):
            vencimiento_retencion(2026, mes, NIT_MCKENNA)


def test_estado_refleja_cercania_al_vencimiento():
    info = info_vencimiento_retencion(2026, 10)
    assert info["conocido"] is True
    assert info["ultimo_digito"] == 6
    assert info["estado"] in ("vencido", "hoy", "proximo", "a_tiempo")
    assert info["fecha"] == "2026-11-19"


def test_certificado_es_el_ultimo_dia_habil_de_marzo():
    # DUR 1625/2016 Art. 1.6.1.13.2.40, mod. D.R. 2229 de 2023.
    f = fecha_limite_certificado_retenciones(2026)
    assert (f.year, f.month) == (2027, 3)
    assert f.weekday() < 5
    assert f == date(2027, 3, 31)  # miércoles
    # 31/03/2024 fue domingo -> debe retroceder al viernes 29
    assert fecha_limite_certificado_retenciones(2023) == date(2024, 3, 29)


def test_el_nit_por_defecto_es_el_verificado_contra_alegra():
    """Red contra volver a meter un NIT equivocado.

    El default salió mal una vez tomándolo de `cuenta_cobro_cuota_manejo`
    (901.952.087-1, incorrecto). El bueno, confirmado en GET /company de
    Alegra, es 901316016 con dv 3.
    """
    from app.services.calendario_tributario import NIT_MCKENNA_DEFAULT, nit_empresa

    assert NIT_MCKENNA_DEFAULT == "901.316.016-3"
    assert ultimo_digito_nit(nit_empresa()) == 6
