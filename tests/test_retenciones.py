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
    # Con UVT 2026 cargada el mínimo se expresa en pesos del año (10 UVT desde 2026)
    c26 = next(f for f in resumen_conceptos(2026) if f["concepto"] == "compras")
    assert c26["minimo_uvt"] == 10
    assert c26["minimo_cop"] == pytest.approx(10 * 52_374, abs=1)
    # Sin UVT del año, el mínimo en pesos queda en None y no en 0
    assert all(f["minimo_cop"] is None for f in resumen_conceptos(2027))


def test_el_pago_del_350_no_resta_de_la_retencion_practicada(monkeypatch, tmp_path):
    """Pagarle a la DIAN (débito 2365 / crédito Bancos) extingue la deuda; no es
    retención "des-practicada". Contarlo dejó agosto-2026 en −$401.237 cuando se
    habían practicado $196.763."""
    import app.services.contabilidad_core as cc
    from app.services.retenciones import resumen_periodo

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "c.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()
    with cc._conn() as con:
        ids = {k: cc._cuenta_id_por_codigo(con, k) for k in ("1435", "2205", "2365", "1110")}
    t = cc.crear_tercero({"nombre": "PRODUCTOS 3A SAS", "identificacion": "800158432"})
    cc.crear_movimiento("2026-08-21", "Compra", [
        {"cuenta_id": ids["1435"], "debito": 4_020_500, "credito": 0},
        {"cuenta_id": ids["2365"], "debito": 0, "credito": 100_512, "tercero_id": t["id"],
         "descripcion": "Retención compras 2,5%"},
        {"cuenta_id": ids["2205"], "debito": 0, "credito": 3_919_988},
    ])
    cc.crear_movimiento("2026-08-20", "Pago PSE DIAN", [
        {"cuenta_id": ids["2365"], "debito": 598_000, "credito": 0},
        {"cuenta_id": ids["1110"], "debito": 0, "credito": 598_000},
    ])
    assert resumen_periodo(2026, 8)["total_retencion"] == pytest.approx(100_512)


# ── El pago a la DIAN se excluye; la retención practicada al pagar NO ───────
# El filtro descartaba el asiento COMPLETO si tocaba una cuenta 11%. Pero toda
# retención que se practica al momento de pagar acredita 2365 y el banco en el
# mismo asiento (cuota de préstamo, cualquier pago del wizard), así que se
# borraban todas y el período quedaba en cero. Con los cuatro préstamos
# vigentes eso escondía la retención desde octubre-2026 y el ticket mensual de
# la DIAN no se creaba: `crear_ticket_retenciones_mes` se gatea con ese total.


def _base_temporal(monkeypatch, tmp_path):
    import app.services.contabilidad_core as cc

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "c.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()
    with cc._conn() as con:
        return cc, {
            "banco": cc._cuenta_id_por_codigo(con, "1110"),
            "ret": cc._cuenta_id_por_codigo(con, "2365"),
            "gasto": cc._cuenta_id_por_codigo(con, "5135"),
        }


def test_retencion_practicada_al_pagar_cuenta_aunque_toque_el_banco(monkeypatch, tmp_path):
    from app.services.retenciones import resumen_periodo

    cc, ids = _base_temporal(monkeypatch, tmp_path)
    t = cc.crear_tercero({"nombre": "Quien Presta Servicios", "tipo": "otro",
                          "tipo_persona": "natural", "identificacion": "123"})
    cc.crear_movimiento(
        fecha="2026-10-15", concepto="Pago de servicios con retención",
        lineas=[
            {"cuenta_id": ids["gasto"], "debito": 1_000_000, "credito": 0, "tercero_id": t["id"],
             "descripcion": "Servicios de octubre"},
            {"cuenta_id": ids["ret"], "debito": 0, "credito": 40_000, "tercero_id": t["id"],
             "descripcion": "Retención servicios 4%"},
            {"cuenta_id": ids["banco"], "debito": 0, "credito": 960_000,
             "descripcion": "Salida vía banco"},
        ],
    )
    assert resumen_periodo(2026, 10)["total_retencion"] == 40_000


def test_el_pago_del_formulario_350_no_resta(monkeypatch, tmp_path):
    from app.services.retenciones import resumen_periodo

    cc, ids = _base_temporal(monkeypatch, tmp_path)
    t = cc.crear_tercero({"nombre": "Tercero", "tipo": "otro",
                          "tipo_persona": "natural", "identificacion": "9"})
    cc.crear_movimiento(
        fecha="2026-10-05", concepto="Retención causada en compra",
        lineas=[
            {"cuenta_id": ids["gasto"], "debito": 500_000, "credito": 0, "tercero_id": t["id"],
             "descripcion": "Compra"},
            {"cuenta_id": ids["ret"], "debito": 0, "credito": 12_500, "tercero_id": t["id"],
             "descripcion": "Retención compras"},
            {"cuenta_id": cc._cuenta_id_por_codigo.__self__ if False else ids["gasto"],
             "debito": 0, "credito": 487_500, "descripcion": "Por pagar"},
        ],
    )
    # Pagarle a la DIAN extingue la deuda; no es retención "des-practicada"
    cc.crear_movimiento(
        fecha="2026-10-20", concepto="Pago formulario 350",
        lineas=[
            {"cuenta_id": ids["ret"], "debito": 12_500, "credito": 0, "descripcion": "Pago DIAN"},
            {"cuenta_id": ids["banco"], "debito": 0, "credito": 12_500, "descripcion": "PSE"},
        ],
    )
    assert resumen_periodo(2026, 10)["total_retencion"] == 12_500


# ─── Conceptos añadidos en sep-2026 ────────────────────────────────────────

def test_transporte_de_carga_va_al_uno_por_ciento():
    """La tarifa no es una lectura nuestra de la norma: es la que el contador de
    McKenna certificó —«SERVICIOS 1.0», base $17.377.500, retención $173.775—
    en el certificado año gravable 2024 a NEXT ENVIOS S.A.S."""
    from app.services.retenciones import calcular

    r = calcular("transporte_carga", 1_998_000, anio=2026)
    assert r["aplica"] is True
    assert r["tarifa_pct"] == 1.0
    assert r["retencion"] == pytest.approx(19_980, abs=1)
    # Y reproduce el certificado.
    assert calcular("transporte_carga", 17_377_500, anio=2024)["retencion"] == pytest.approx(173_775, abs=1)


def test_transporte_de_carga_respeta_la_cuantia_minima():
    from app.services.retenciones import calcular

    # 4 UVT de 2026 = $209.496.
    assert calcular("transporte_carga", 200_000, anio=2026)["aplica"] is False
    assert calcular("transporte_carga", 250_000, anio=2026)["aplica"] is True


def test_carga_y_pasajeros_no_comparten_tarifa():
    """«Transporte es transporte» es como se aplica la tarifa equivocada."""
    from app.services.retenciones import CONCEPTOS

    assert CONCEPTOS["transporte_carga"][0] == 1.0
    assert CONCEPTOS["transporte_pasajeros"][0] == 3.5


def test_arrendamiento_distingue_inmueble_de_mueble():
    from app.services.retenciones import calcular

    # Un inmueble: 3,5% desde 27 UVT. Un mueble: 4% sin mínimo.
    assert calcular("arrendamiento_inmueble", 3_000_000, anio=2026)["tarifa_pct"] == 3.5
    assert calcular("arrendamiento_mueble", 100_000, anio=2026)["aplica"] is True
    assert calcular("arrendamiento_mueble", 100_000, anio=2026)["retencion"] == pytest.approx(4_000, abs=1)


def test_cada_concepto_tiene_su_subcuenta_de_2365():
    """El contador arma el 350 por concepto; con todo en 2365 plana lo desglosa
    a mano."""
    from app.services.puc_colombia import cuenta_retencion
    from app.services.retenciones import CONCEPTOS

    for concepto in CONCEPTOS:
        codigo = cuenta_retencion(concepto)
        assert codigo.startswith("2365") and len(codigo) == 6, concepto


# ─── Compras a 10 UVT desde 2026 (24-sep-2026) ──────────────────────────────
# Caso real: CIV2336 de COMERCIALIZADORA INTERNACIONAL C.I., base $1.120.000 —
# bajo 27 UVT pero sobre 10 — y su factura ya descontaba $28.000 de ReteRenta.

def test_compras_2026_retienen_desde_10_uvt():
    r = calcular("compras", 1_120_000, anio=2026, declarante=True)
    assert r["aplica"] is True
    assert r["retencion"] == pytest.approx(28_000, abs=1)
    assert r["minimo_uvt"] == 10
    assert r["minimo_cop"] == pytest.approx(523_740, abs=1)


def test_compras_2026_bajo_10_uvt_no_retienen():
    r = calcular("compras", 250_000, anio=2026, declarante=True)
    assert r["aplica"] is False and r["retencion"] == 0


def test_los_anios_anteriores_siguen_con_27_uvt():
    """Los certificados 2023/2024 ya expedidos se calcularon con 27 UVT."""
    r = calcular("compras", 1_120_000, anio=2025, declarante=True)
    assert r["aplica"] is False
    assert r["minimo_uvt"] == 27
