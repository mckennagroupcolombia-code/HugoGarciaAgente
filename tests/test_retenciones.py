"""Motor de retención en la fuente: tarifas, cuantías mínimas y UVT.

Lo que más se equivoca en la práctica es la **cuantía mínima**: retener por
debajo del tope es tan incorrecto como no retener por encima. Estos tests fijan
ambos bordes.
"""
from __future__ import annotations

import pytest

from app.services.retenciones import (
    ANIOS_UVT_CARGADOS,
    CONCEPTOS,
    calcular,
    resumen_conceptos,
    uvt,
)


def test_uvt_conocida_y_no_extrapolada():
    assert uvt(2024) == 47_065.0
    assert uvt(2025) == 49_799.0
    # Resolución DIAN 000238 del 15-dic-2025 (IPC 5,17%)
    assert uvt(2026) == 52_374.0
    # El año siguiente lo fija una resolución que todavía no existe: no se inventa
    assert 2027 not in ANIOS_UVT_CARGADOS
    assert uvt(2027) is None


def test_la_uvt_cargada_es_coherente_con_el_ipc_del_ano_anterior():
    """Red contra un error de digitación al cargar el año nuevo: la UVT sube
    con el IPC, así que un salto fuera del rango 0-15% delata un dedazo."""
    anios = sorted(ANIOS_UVT_CARGADOS)
    for previo, actual in zip(anios, anios[1:]):
        if actual - previo != 1:
            continue
        variacion = (uvt(actual) - uvt(previo)) / uvt(previo)
        assert 0 < variacion < 0.15, f"UVT {actual} varía {variacion:.1%} sobre {previo}"


def test_uvt_se_puede_cargar_por_entorno(monkeypatch):
    # Para adelantarse a la resolución del año siguiente sin tocar código.
    monkeypatch.setenv("UVT_2027", "55.000")
    assert uvt(2027) == 55_000.0
    monkeypatch.setenv("UVT_2027", "55000")
    assert uvt(2027) == 55_000.0


def test_ano_sin_uvt_no_inventa_retencion():
    # Sin UVT no se sabe si se superó la cuantía mínima: se dice, no se asume.
    r = calcular("compras", 5_000_000, anio=2027)
    assert r["aplica"] is False
    assert r["indeterminado"] is True
    assert r["retencion"] == 0
    assert "No hay UVT cargada" in r["motivo"] and "2027" in r["motivo"]


def test_compra_por_debajo_de_27_uvt_no_lleva_retencion():
    # Caso real de McKenna: las compras del socio rondan $200.000 y el mínimo
    # de compras es 27 UVT (~$1,34M en 2025).
    r = calcular("compras", 195_966, anio=2025, declarante=True)
    assert r["aplica"] is False
    assert r["retencion"] == 0
    assert r["minimo_cop"] == pytest.approx(1_344_573, abs=1)
    assert "por debajo de la cuantía mínima" in r["motivo"]


def test_compra_por_encima_del_minimo_si_retiene():
    r = calcular("compras", 2_000_000, anio=2025, declarante=True)
    assert r["aplica"] is True
    assert r["retencion"] == pytest.approx(50_000, abs=1)  # 2,5%
    assert r["tarifa_pct"] == 2.5


def test_no_declarante_paga_tarifa_mayor():
    dec = calcular("compras", 2_000_000, anio=2025, declarante=True)
    no_dec = calcular("compras", 2_000_000, anio=2025, declarante=False)
    assert dec["tarifa_pct"] == 2.5 and no_dec["tarifa_pct"] == 3.5
    assert no_dec["retencion"] > dec["retencion"]


def test_cuota_de_manejo_como_servicio_tambien_queda_bajo_el_minimo():
    # Las cuotas reales van de $7.590 a $15.181; el mínimo de servicios es
    # 4 UVT (~$199.196 en 2025).
    for cuota in (7_590, 12_208, 13_429, 15_181):
        r = calcular("servicios", cuota, anio=2025, declarante=True)
        assert r["aplica"] is False, f"{cuota} no debería llevar retención"
    assert calcular("servicios", 300_000, anio=2025)["aplica"] is True


def test_rendimientos_financieros_no_tienen_cuantia_minima():
    # Un interés de $10.949 (cuota 24 de un préstamo) sí lleva retención.
    r = calcular("rendimientos_financieros", 10_949, anio=2025)
    assert r["aplica"] is True
    assert r["tarifa_pct"] == 7.0
    assert r["retencion"] == pytest.approx(766, abs=1)


def test_rendimientos_financieros_misma_tarifa_sea_o_no_declarante():
    a = calcular("rendimientos_financieros", 100_000, anio=2025, declarante=True)
    b = calcular("rendimientos_financieros", 100_000, anio=2025, declarante=False)
    assert a["retencion"] == b["retencion"] == pytest.approx(7_000, abs=1)


def test_base_cero_no_retiene():
    r = calcular("compras", 0, anio=2025)
    assert r["aplica"] is False and r["retencion"] == 0


def test_concepto_desconocido_se_rechaza():
    with pytest.raises(ValueError, match="Concepto de retención desconocido"):
        calcular("inventado", 1_000_000, anio=2025)


def test_siempre_explica_por_que():
    # El panel y los tickets tienen que poder responder "¿por qué me retuvieron?"
    for concepto in CONCEPTOS:
        for base in (1_000, 5_000_000):
            r = calcular(concepto, base, anio=2025)
            assert r["motivo"], f"{concepto}/{base} sin explicación"
            assert r["norma"]


def test_resumen_para_el_panel():
    filas = resumen_conceptos(2025)
    assert {f["concepto"] for f in filas} == set(CONCEPTOS)
    compras = next(f for f in filas if f["concepto"] == "compras")
    assert compras["minimo_cop"] == pytest.approx(1_344_573, abs=1)
    # Con UVT 2026 cargada el mínimo se expresa en pesos del año
    c26 = next(f for f in resumen_conceptos(2026) if f["concepto"] == "compras")
    assert c26["minimo_cop"] == pytest.approx(27 * 52_374, abs=1)
    # Sin UVT del año, el mínimo en pesos queda en None y no en 0
    assert all(f["minimo_cop"] is None for f in resumen_conceptos(2027))
