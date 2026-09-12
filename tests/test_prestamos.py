"""Cronograma de préstamos recibidos: tasa, reparto de capital y retención.

Los números de referencia son los del producto pactado en sep-2026 (ver
docs/agentic/modules/prestamos.md): $10.000.000 al 25% E.A., 24 cuotas,
capital 30% el primer año y 70% el segundo, retención del 7% a cargo del
prestamista.
"""
from __future__ import annotations

import pytest

from app.services.prestamos import (
    calcular_cronograma,
    ea_desde_tasa_mensual,
    tasa_mensual_desde_ea,
)

CAPITAL = 10_000_000


def test_tasa_mensual_es_equivalente_efectiva_no_nominal():
    # 25% E.A. -> 1,8769% mensual. Si alguien "simplifica" a tasa_ea/12
    # (2,0833%) estaría cobrando 28% E.A., tres puntos de más.
    i = tasa_mensual_desde_ea(0.25)
    assert round(i * 100, 4) == 1.8769
    assert i < 0.25 / 12
    assert ea_desde_tasa_mensual(i) == pytest.approx(0.25, abs=1e-12)


def test_cronograma_pactado_reproduce_las_cifras_del_contrato():
    r = calcular_cronograma(CAPITAL)
    t = r["totales"]
    assert t["interes_bruto"] == pytest.approx(2_796_620, abs=1)
    assert t["retencion"] == pytest.approx(195_763, abs=1)
    assert t["interes_girado"] == pytest.approx(2_600_857, abs=1)
    assert t["total_causado"] == pytest.approx(12_796_620, abs=1)
    # Las tres cifras que van al documento, y que no deben confundirse
    assert t["rendimiento_bruto_pct"] == pytest.approx(27.97, abs=0.01)
    assert t["rendimiento_neto_pct"] == pytest.approx(26.01, abs=0.01)
    assert t["costo_real_ea_pct"] == pytest.approx(25.0, abs=0.01)


def test_primera_cuota_separa_capital_interes_y_retencion():
    c = calcular_cronograma(CAPITAL)["cuotas"][0]
    assert c["saldo_inicial"] == CAPITAL
    assert c["abono_capital"] == pytest.approx(250_000, abs=1)
    assert c["interes_bruto"] == pytest.approx(187_693, abs=1)
    assert c["retencion"] == pytest.approx(13_138, abs=1)
    # Lo que sale del banco es el neto; el gasto de McKenna es el bruto
    assert c["cuota_girada"] == pytest.approx(424_554, abs=1)
    assert c["cuota_causada"] == pytest.approx(437_693, abs=1)
    assert c["cuota_causada"] - c["cuota_girada"] == pytest.approx(c["retencion"], abs=1)


def test_el_saldo_cierra_exacto_en_cero():
    # El redondeo se absorbe en la última cuota: un préstamo no puede quedar
    # con $3 de saldo vivo después de la cuota 24.
    for capital in (10_000_000, 7_333_333, 1_250_000.55, 999):
        r = calcular_cronograma(capital)
        assert r["cuotas"][-1]["saldo_final"] == 0
        assert sum(c["abono_capital"] for c in r["cuotas"]) == pytest.approx(capital, abs=0.01)


@pytest.mark.parametrize(
    "pct_tramo1, bruto_esperado",
    [(0.0, 34.72), (0.15, 31.34), (0.30, 27.97), (0.50, 23.46)],
)
def test_devolver_capital_mas_tarde_sube_el_rendimiento(pct_tramo1, bruto_esperado):
    r = calcular_cronograma(CAPITAL, pct_capital_tramo1=pct_tramo1)
    assert r["totales"]["rendimiento_bruto_pct"] == pytest.approx(bruto_esperado, abs=0.01)


def test_el_reparto_no_cambia_el_costo_efectivo_anual():
    # Tesis del diseño: la E.A. mide precio por peso-año, no total pagado. Sea
    # cual sea el reparto, McKenna paga 25% E.A. — lo que cambia es cuánto
    # capital tuvo trabajando, y por eso cuánto recibe el prestamista.
    for pct in (0.0, 0.15, 0.30, 0.50):
        r = calcular_cronograma(CAPITAL, pct_capital_tramo1=pct)
        assert r["totales"]["costo_real_ea_pct"] == pytest.approx(25.0, abs=0.01)


def test_reparto_mitad_mitad_equivale_a_amortizacion_recta():
    r = calcular_cronograma(CAPITAL, pct_capital_tramo1=0.5)
    for c in r["cuotas"]:
        assert c["abono_capital"] == pytest.approx(CAPITAL / 24, abs=1)


def test_gross_up_encarece_el_prestamo_para_mckenna():
    # Sin gross-up la retención la asume el prestamista (recibe el neto).
    # Con gross-up McKenna gira el bruto y pone el 7% de su bolsillo.
    base = calcular_cronograma(CAPITAL)
    gu = calcular_cronograma(CAPITAL, gross_up=True)
    assert base["totales"]["costo_real_ea_pct"] == pytest.approx(25.0, abs=0.01)
    assert gu["totales"]["costo_real_ea_pct"] == pytest.approx(26.95, abs=0.05)
    assert gu["totales"]["rendimiento_neto_pct"] == gu["totales"]["rendimiento_bruto_pct"]
    assert gu["totales"]["total_girado"] > base["totales"]["total_girado"]


def test_dia_pago_fija_todas_las_cuotas_el_mismo_dia():
    # Habilita el recordatorio único mensual a despachos: si cada préstamo
    # venciera en su propia fecha, harían falta N tickets al mes.
    r = calcular_cronograma(CAPITAL, fecha_desembolso="2026-09-15", dia_pago=5)
    assert {c["fecha"][-2:] for c in r["cuotas"]} == {"05"}
    assert r["cuotas"][0]["fecha"] == "2026-10-05"
    assert r["cuotas"][23]["fecha"] == "2028-09-05"


def test_dia_pago_se_recorta_en_meses_cortos():
    r = calcular_cronograma(CAPITAL, fecha_desembolso="2027-01-31", dia_pago=31)
    assert r["cuotas"][0]["fecha"] == "2027-02-28"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"pct_capital_tramo1": 1.5},
        {"pct_capital_tramo1": -0.1},
        {"meses_tramo1": 24, "pct_capital_tramo1": 0.3},
        {"meses_tramo1": 30},
        {"plazo_meses": 0},
    ],
)
def test_parametros_invalidos_se_rechazan(kwargs):
    with pytest.raises(ValueError):
        calcular_cronograma(CAPITAL, **kwargs)


def test_capital_no_positivo_se_rechaza():
    with pytest.raises(ValueError):
        calcular_cronograma(0)


# ─── Integración: persistencia + asientos ───────────────────────────────────

@pytest.fixture()
def mods(monkeypatch, tmp_path):
    """Base temporal compartida por contabilidad_core y prestamos (misma db)."""
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.prestamos as pr

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setattr(pr, "_DB_PATH", db)
    monkeypatch.setattr(pr, "_initialized", False)
    pr.init_db()

    tercero = cc.crear_tercero(
        {
            "nombre": "Juan Pérez",
            "tipo": "otro",
            "tipo_persona": "natural",
            "identificacion": "79123456",
            "email": "juan@ejemplo.com",
        }
    )
    with cc._conn() as con:
        cuenta_banco = cc._cuenta_id_por_codigo(con, "1110")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": cuenta_banco})
    return cc, pr, tercero, medio


def _crear(pr, tercero, medio, **extra):
    return pr.crear_prestamo(
        {
            "tercero_id": tercero["id"],
            "capital": CAPITAL,
            "medio_pago_id": medio["id"],
            "fecha_desembolso": "2026-09-15",
            "dia_pago": 5,
            **extra,
        }
    )


def test_crear_prestamo_genera_cronograma_y_asiento_de_desembolso(mods):
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    assert len(p["cuotas"]) == 24
    assert p["estado"] == "vigente"
    assert p["movimiento_desembolso_id"]
    assert p["resumen"]["rendimiento_bruto_pct"] == pytest.approx(27.97, abs=0.01)
    assert cc.balance_comprobacion()["cuadra"]


def test_tercero_sin_cedula_o_correo_no_puede_recibir_prestamo(mods):
    # El documento que se le emite necesita ambos: descubrirlo con la plata ya
    # girada es peor que bloquearlo al crear.
    cc, pr, _tercero, medio = mods
    incompleto = cc.crear_tercero({"nombre": "Sin Correo", "tipo": "otro", "identificacion": "999"})
    with pytest.raises(ValueError, match="correo"):
        pr.crear_prestamo(
            {
                "tercero_id": incompleto["id"],
                "capital": 1_000_000,
                "medio_pago_id": medio["id"],
                "fecha_desembolso": "2026-09-15",
            }
        )


def test_pago_de_cuota_separa_capital_interes_y_retencion(mods):
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    pr.registrar_pago_cuota(p["id"], 1, {"referencia": "TRF-1"})

    mov = next(m for m in cc.listar_movimientos(limit=50) if m["referencia"] == "TRF-1")
    por_cuenta = {l["cuenta_codigo"]: l for l in mov["lineas"]}
    assert por_cuenta["2295"]["debito"] == pytest.approx(250_000, abs=1)
    assert por_cuenta["5305"]["debito"] == pytest.approx(187_693, abs=1)   # gasto = interés bruto
    assert por_cuenta["2365"]["credito"] == pytest.approx(13_138, abs=1)   # deuda con la DIAN
    assert por_cuenta["1110"]["credito"] == pytest.approx(424_554, abs=1)  # lo que sale al banco
    assert cc.balance_comprobacion()["cuadra"]


def test_gross_up_lleva_la_retencion_al_gasto_financiero(mods):
    # Con gross-up McKenna gira el bruto y pone el 7%: el gasto sube y el banco
    # entrega más, pero la obligación con la DIAN se registra igual.
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio, gross_up=True)
    pr.registrar_pago_cuota(p["id"], 1, {"referencia": "GU-1"})
    mov = next(m for m in cc.listar_movimientos(limit=50) if m["referencia"] == "GU-1")
    por_cuenta = {l["cuenta_codigo"]: l for l in mov["lineas"]}
    assert por_cuenta["5305"]["debito"] == pytest.approx(187_693 + 13_138, abs=2)
    assert por_cuenta["1110"]["credito"] == pytest.approx(437_693, abs=2)
    assert por_cuenta["2365"]["credito"] == pytest.approx(13_138, abs=1)
    assert cc.balance_comprobacion()["cuadra"]


def test_las_cuotas_se_pagan_en_orden_y_una_sola_vez(mods):
    _cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    with pytest.raises(ValueError, match="orden"):
        pr.registrar_pago_cuota(p["id"], 5)
    pr.registrar_pago_cuota(p["id"], 1)
    with pytest.raises(ValueError, match="ya está pagada"):
        pr.registrar_pago_cuota(p["id"], 1)


def test_pagar_todas_las_cuotas_cierra_el_prestamo_y_el_pasivo(mods):
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    for n in range(1, 25):
        pr.registrar_pago_cuota(p["id"], n)
    final = pr.obtener_prestamo(p["id"])
    assert final["estado"] == "pagado"
    assert final["resumen"]["capital_pendiente"] == 0

    balance = cc.balance_comprobacion()
    assert balance["cuadra"]
    saldos = {c["codigo"]: c["saldo_final"] for c in balance["cuentas"]}
    assert saldos["2295"] == pytest.approx(0, abs=1)  # pasivo extinguido
    assert saldos["5305"] == pytest.approx(2_796_620, abs=2)  # gasto = interés bruto total
    assert saldos["2365"] == pytest.approx(195_763, abs=2)  # pendiente de girar a la DIAN


def test_cuotas_del_mes_reune_todos_los_prestamos_vigentes(mods):
    # Base del recordatorio único mensual a despachos.
    cc, pr, tercero, medio = mods
    otro = cc.crear_tercero(
        {"nombre": "Ana Gómez", "tipo": "otro", "identificacion": "52987654", "email": "ana@ejemplo.com"}
    )
    _crear(pr, tercero, medio)
    _crear(pr, otro, medio, capital=5_000_000)

    del_mes = pr.cuotas_del_mes(2026, 10)
    assert len(del_mes) == 2
    assert {c["tercero_nombre"] for c in del_mes} == {"Juan Pérez", "Ana Gómez"}
    assert all(c["fecha_vencimiento"] == "2026-10-05" for c in del_mes)

    # Una vez pagada, deja de aparecer como pendiente del mes
    p = pr.listar_prestamos()[0]
    pr.registrar_pago_cuota(p["id"], 1)
    assert len(pr.cuotas_del_mes(2026, 10)) == 1


# ─── Documento soporte a la DIAN (Concepto 000112 int 7 de 2024) ───────────

def test_capital_no_genera_documento_soporte(mods):
    """El mutuo no es venta de bienes ni servicios: por el desembolso y por los
    abonos a capital NO se emite documento soporte. Solo por los intereses."""
    _cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    llamadas: list[dict] = []
    import app.services.alegra as alegra

    original = alegra.crear_documento_soporte_alegra
    alegra.crear_documento_soporte_alegra = lambda **kw: (
        llamadas.append(kw) or {"status": "dry_run", "payload": {}}
    )
    try:
        pr.registrar_pago_cuota(p["id"], 1)
    finally:
        alegra.crear_documento_soporte_alegra = original

    assert len(llamadas) == 1
    # El valor es el interés BRUTO, no la cuota ni el capital
    assert llamadas[0]["valor"] == pytest.approx(187_693, abs=1)
    assert llamadas[0]["valor"] != pytest.approx(250_000, abs=1)


@pytest.mark.parametrize(
    "tipo_persona, obligado, espera",
    [
        ("natural", 0, True),    # no obligado a facturar → McKenna emite
        ("natural", 1, False),   # obligado → la factura la expide él
        ("juridica", 0, False),  # persona jurídica → factura electrónica suya
        ("", 0, False),          # sin definir → no se arriesga
    ],
)
def test_solo_emite_a_persona_natural_no_obligada_a_facturar(mods, tipo_persona, obligado, espera):
    _cc, pr, _t, _m = mods
    requiere, motivo = pr.requiere_documento_soporte(
        {"tipo_persona": tipo_persona, "obligado_a_facturar": str(obligado)}
    )
    assert requiere is espera
    assert motivo  # siempre trazable por qué sí o por qué no


def test_prestamista_juridico_marca_la_cuota_como_no_aplica(mods):
    cc, pr, _t, medio = mods
    juridico = cc.crear_tercero({
        "nombre": "Inversiones XYZ S.A.S.", "tipo": "otro", "tipo_persona": "juridica",
        "identificacion": "900123456", "email": "xyz@ejemplo.com",
    })
    p = _crear(pr, juridico, medio)
    r = pr.emitir_documento_soporte_cuota(p["id"], 1)
    assert r["status"] == "no_aplica"
    assert "jurídica" in r["motivo"]
    cuota = pr.obtener_prestamo(p["id"])["cuotas"][0]
    assert cuota["doc_soporte_estado"] == "no_aplica"


def test_modo_sombra_no_emite_nada_a_la_dian(mods, monkeypatch):
    # Por defecto (PRESTAMOS_DOC_SOPORTE_ACTIVO != "1") solo se simula: un
    # documento soporte emitido ya viajó a la DIAN y solo se corrige con nota
    # de ajuste.
    _cc, pr, tercero, medio = mods
    monkeypatch.delenv("PRESTAMOS_DOC_SOPORTE_ACTIVO", raising=False)
    assert pr._doc_soporte_activo() is False
    p = _crear(pr, tercero, medio)

    import app.services.alegra as alegra

    vistos: list[bool] = []
    original = alegra.crear_documento_soporte_alegra
    alegra.crear_documento_soporte_alegra = lambda **kw: (
        vistos.append(kw["dry_run"]) or {"status": "dry_run", "payload": {}}
    )
    try:
        pr.emitir_documento_soporte_cuota(p["id"], 1)
    finally:
        alegra.crear_documento_soporte_alegra = original
    assert vistos == [True]

    monkeypatch.setenv("PRESTAMOS_DOC_SOPORTE_ACTIVO", "1")
    assert pr._doc_soporte_activo() is True


def test_no_se_emite_dos_veces_para_la_misma_cuota(mods):
    _cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    import app.services.alegra as alegra

    n = {"veces": 0}
    original = alegra.crear_documento_soporte_alegra

    def fake(**kw):
        n["veces"] += 1
        return {"status": "success", "id": "DS-99", "numero": "DS-1"}

    alegra.crear_documento_soporte_alegra = fake
    try:
        pr.emitir_documento_soporte_cuota(p["id"], 1)
        r2 = pr.emitir_documento_soporte_cuota(p["id"], 1)
    finally:
        alegra.crear_documento_soporte_alegra = original
    assert n["veces"] == 1
    assert r2["status"] == "ya_emitido" and r2["id"] == "DS-99"


def test_un_fallo_de_alegra_no_tumba_el_pago_ni_el_asiento(mods):
    # El asiento es la verdad contable y ya quedó; el documento se reintenta.
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    import app.services.alegra as alegra

    original = alegra.crear_documento_soporte_alegra

    def explota(**kw):
        raise RuntimeError("Alegra caído")

    alegra.crear_documento_soporte_alegra = explota
    try:
        res = pr.registrar_pago_cuota(p["id"], 1)
    finally:
        alegra.crear_documento_soporte_alegra = original

    assert res["resumen"]["cuotas_pagadas"] == 1
    assert cc.balance_comprobacion()["cuadra"]


# ─── Declaración mensual de retención en la fuente ─────────────────────────

def _pagar_primera_cuota(pr, cc, tercero, medio, capital=CAPITAL):
    p = pr.crear_prestamo({
        "tercero_id": tercero["id"], "capital": capital, "medio_pago_id": medio["id"],
        "fecha_desembolso": "2026-09-15", "dia_pago": 5,
    })
    pr.registrar_pago_cuota(p["id"], 1)  # vence y se paga el 2026-10-05
    return p


def test_resumen_retenciones_agrupa_por_tercero(mods):
    cc, pr, tercero, medio = mods
    otro = cc.crear_tercero({
        "nombre": "Ana Gómez", "tipo": "otro", "tipo_persona": "natural",
        "identificacion": "52987654", "email": "ana@ejemplo.com",
    })
    _pagar_primera_cuota(pr, cc, tercero, medio)
    _pagar_primera_cuota(pr, cc, otro, medio, capital=5_000_000)

    r = pr.resumen_retenciones_mes(2026, 10)
    assert r["periodo"] == "2026-10"
    assert r["pagos"] == 2
    assert len(r["terceros"]) == 2
    # 7% sobre $187.693 + $93.846 de intereses brutos
    assert r["base_total"] == pytest.approx(281_539, abs=2)
    assert r["total_retencion"] == pytest.approx(19_708, abs=2)


def test_resumen_retenciones_cuadra_con_la_cuenta_2365(mods):
    # Cifra de control: si el libro y los préstamos no coinciden hay retenciones
    # de otro origen o un asiento manual, y hay que mirarlo ANTES de declarar.
    cc, pr, tercero, medio = mods
    _pagar_primera_cuota(pr, cc, tercero, medio)
    r = pr.resumen_retenciones_mes(2026, 10)
    assert r["control_2365"] == pytest.approx(r["total_retencion"], abs=1)
    assert r["cuadra_con_libro"] is True


def test_resumen_solo_cuenta_el_mes_pedido(mods):
    cc, pr, tercero, medio = mods
    _pagar_primera_cuota(pr, cc, tercero, medio)
    assert pr.resumen_retenciones_mes(2026, 10)["pagos"] == 1
    assert pr.resumen_retenciones_mes(2026, 11)["pagos"] == 0
    assert pr.resumen_retenciones_mes(2026, 9)["pagos"] == 0


def test_ticket_retenciones_lleva_base_total_y_detalle(mods):
    cc, pr, tercero, medio = mods
    _pagar_primera_cuota(pr, cc, tercero, medio)
    r = pr.crear_ticket_retenciones_mes(2026, 10, dry_run=True)
    d = r["descripcion"]
    assert "$13.138" in d              # retención practicada
    assert "$187.693" in d             # base (interés bruto)
    assert "79123456" in d             # identificación del tercero
    assert "formulario 350" in d
    assert "rendimientos financieros" in d
    # Desde que se cargó el calendario 2026 (DUR 1625) el ticket da la fecha
    # exacta según el último dígito del NIT de McKenna (7), no pide adivinarla.
    assert "2026-11-19" in d
    assert "último dígito 6" in d


def test_ticket_retenciones_avisa_documentos_soporte_pendientes(mods):
    # En modo sombra los documentos no llegaron a la DIAN; declarar la retención
    # sin ellos deja el gasto expuesto.
    cc, pr, tercero, medio = mods
    _pagar_primera_cuota(pr, cc, tercero, medio)
    r = pr.crear_ticket_retenciones_mes(2026, 10, dry_run=True)
    assert r["resumen"]["documentos_soporte_pendientes"] == 1
    assert "documento(s) soporte sin emitir" in r["descripcion"]


def test_mes_sin_retenciones_no_crea_ticket(mods):
    # Un ticket vacío cada mes entrena a la gente a ignorar la bandeja.
    _cc, pr, _t, _m = mods
    r = pr.crear_ticket_retenciones_mes(2026, 12)
    assert r["creado"] is False
    assert r["motivo"] == "sin retenciones practicadas"


def test_las_dos_marcas_de_ticket_no_se_pisan(mods):
    # Pagos y retenciones son tickets distintos del mismo mes: si compartieran
    # marca, crear uno bloquearía el otro.
    cc, pr, tercero, medio = mods
    assert pr.MARCA_TICKET != pr.MARCA_TICKET_RETENCIONES
    _pagar_primera_cuota(pr, cc, tercero, medio)
    pagos = pr.crear_recordatorio_pagos_mes(2026, 11, dry_run=True)
    retens = pr.crear_ticket_retenciones_mes(2026, 10, dry_run=True)
    assert pr.MARCA_TICKET in pagos["descripcion"]
    assert pr.MARCA_TICKET_RETENCIONES in retens["descripcion"]
    assert pr.MARCA_TICKET_RETENCIONES not in pagos["descripcion"]


def test_ticket_retenciones_marca_urgencia_si_esta_por_vencer(mods, monkeypatch):
    """El ticket sube a prioridad crítica cuando el vencimiento está encima.

    Un ticket de retención que llega en 'alta' junto a otros veinte se pierde;
    vencido significa sanción por extemporaneidad e intereses de mora.
    """
    cc, pr, tercero, medio = mods
    _pagar_primera_cuota(pr, cc, tercero, medio)

    import app.services.calendario_tributario as cal

    for estado, dias, espera_critica in (
        ("a_tiempo", 71, False),
        ("proximo", 3, True),
        ("hoy", 0, True),
        ("vencido", -4, True),
    ):
        monkeypatch.setattr(
            cal, "info_vencimiento_retencion",
            lambda *a, _e=estado, _d=dias, **k: {
                "conocido": True, "nit": "901.316.016-3", "ultimo_digito": 6,
                "fecha": "2026-11-19", "dias_restantes": _d, "estado": _e, "fuente": "DUR 1625",
            },
        )
        r = pr.crear_ticket_retenciones_mes(2026, 10, dry_run=True)
        assert r["resumen"]["vencimiento"]["estado"] == estado
        if espera_critica:
            assert "VENC" in r["descripcion"] or "Quedan" in r["descripcion"]


def test_ticket_avisa_cuando_no_hay_calendario_del_anio(mods, monkeypatch):
    # No callar: quien lee el ticket debe saber que la fecha no está confirmada.
    cc, pr, tercero, medio = mods
    _pagar_primera_cuota(pr, cc, tercero, medio)
    import app.services.calendario_tributario as cal

    monkeypatch.setattr(
        cal, "info_vencimiento_retencion",
        lambda *a, **k: {"conocido": False, "estado": "desconocido",
                         "motivo": "No hay calendario cargado para el año gravable 2029."},
    )
    r = pr.crear_ticket_retenciones_mes(2026, 10, dry_run=True)
    assert "no confirmada" in r["descripcion"]
    assert "2029" in r["descripcion"]


# ─── Alta de prestamistas ──────────────────────────────────────────────────

def _prestamista_valido(**extra):
    return {
        "nombre": "Carlos Rojas", "identificacion": "80123456", "tipo_persona": "natural",
        "email": "carlos@ejemplo.com", "telefono": "3001234567",
        "cuenta_bancaria": "Bancolombia ahorros 9988", **extra,
    }


def test_alta_de_prestamista_guarda_todos_los_datos(mods):
    _cc, pr, _t, _m = mods
    r = pr.crear_prestamista(_prestamista_valido(), inscribir_en_alegra=False)
    t = r["tercero"]
    assert r["reutilizado"] is False
    assert t["nombre"] == "Carlos Rojas"
    assert t["identificacion"] == "80123456"
    assert t["email"] == "carlos@ejemplo.com"
    assert t["telefono"] == "3001234567"
    assert t["cuenta_bancaria"] == "Bancolombia ahorros 9988"
    assert t["tipo_persona"] == "natural"
    # Y ya se sabe qué pasa con el documento soporte antes de desembolsar nada
    assert r["documento_soporte"]["requiere"] is True


@pytest.mark.parametrize(
    "quita, mensaje",
    [
        ("nombre", "nombre"),
        ("identificacion", "cédula"),
        ("email", "correo"),
        ("tipo_persona", "natural o jurídica"),
    ],
)
def test_faltan_datos_obligatorios(mods, quita, mensaje):
    # Se valida al dar de alta, no cuando ya hay plata girada.
    _cc, pr, _t, _m = mods
    datos = _prestamista_valido()
    datos[quita] = ""
    with pytest.raises(ValueError, match=mensaje):
        pr.crear_prestamista(datos, inscribir_en_alegra=False)


def test_correo_evidentemente_invalido_se_rechaza(mods):
    _cc, pr, _t, _m = mods
    for malo in ("no-es-correo", "falta@dominio", "@vacio.com"):
        with pytest.raises(ValueError, match="correo"):
            pr.crear_prestamista(_prestamista_valido(email=malo), inscribir_en_alegra=False)


def test_no_duplica_un_tercero_con_la_misma_cedula(mods):
    # Duplicar parte el histórico de saldos por tercero.
    _cc, pr, _t, _m = mods
    pr.crear_prestamista(_prestamista_valido(), inscribir_en_alegra=False)
    r2 = pr.crear_prestamista(
        _prestamista_valido(identificacion="80.123.456", telefono="3009999999"),
        inscribir_en_alegra=False,
    )
    assert r2["reutilizado"] is True
    assert r2["tercero"]["telefono"] == "3009999999"  # completa lo que faltaba
    assert len([t for t in _cc.listar_terceros() if t["identificacion"].replace(".", "") == "80123456"]) == 1


def test_marcar_obligado_a_facturar_cambia_el_documento_soporte(mods):
    _cc, pr, _t, _m = mods
    r = pr.crear_prestamista(
        _prestamista_valido(obligado_a_facturar=True), inscribir_en_alegra=False
    )
    assert r["documento_soporte"]["requiere"] is False
    assert "obligado a facturar" in r["documento_soporte"]["motivo"]

    r2 = pr.actualizar_prestamista(r["tercero"]["id"], {"obligado_a_facturar": False})
    assert r2["documento_soporte"]["requiere"] is True


def test_un_fallo_de_alegra_no_pierde_el_tercero(mods, monkeypatch):
    # El tercero ya quedó creado; inscribirlo en Alegra se reintenta aparte.
    _cc, pr, _t, _m = mods

    def explota(*a, **k):
        raise RuntimeError("Alegra caído")

    monkeypatch.setattr(pr, "sincronizar_prestamista_alegra", explota)
    r = pr.crear_prestamista(_prestamista_valido(), inscribir_en_alegra=True)
    assert r["ok"] is True
    assert r["tercero"]["id"]
    assert r["alegra"]["ok"] is False
    assert "Alegra caído" in r["alegra"]["error"]


def test_actualizar_prestamista_edita_solo_lo_que_llega(mods):
    _cc, pr, _t, _m = mods
    r = pr.crear_prestamista(_prestamista_valido(), inscribir_en_alegra=False)
    tid = r["tercero"]["id"]
    pr.actualizar_prestamista(tid, {"cuenta_bancaria": "Davivienda corriente 111"})
    t = pr.obtener_prestamo.__globals__["cc"].obtener_tercero(tid) if False else None
    import app.services.contabilidad_core as cc

    t = cc.obtener_tercero(tid)
    assert t["cuenta_bancaria"] == "Davivienda corriente 111"
    assert t["email"] == "carlos@ejemplo.com"  # intacto


def test_reporte_mensual_requiere_movimiento_en_el_mes(mods):
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    pr.registrar_pago_cuota(p["id"], 1)  # 2026-10-05
    r = pr.enviar_reporte_mensual(p["id"], 2026, 11)
    assert r["enviado"] is False
    assert "No hubo desembolsos" in r["motivo"]


# ── Desembolso que no entró por el banco de la empresa ────────────────────────
# El prestamista le giró a un socio y el socio repone después (caso real
# sep-2026). El préstamo debe nacer completo en la fecha pactada, porque es
# desde ahí que corren los intereses, y la reposición se concilia aparte:
# `extracto_vinculos.movimiento_id` es UNIQUE, así que un asiento de $20M no
# puede vincularse a tres abonos.


def _contrapartida(cc):
    with cc._conn() as con:
        return cc._cuenta_id_por_codigo(con, "1355")


def test_desembolso_contra_cuenta_por_cobrar_a_socio(mods):
    cc, pr, tercero, _medio = mods
    socio = cc.crear_tercero(
        {"nombre": "Socio Que Recibió", "tipo": "socio", "identificacion": "123", "email": "s@e.com"}
    )
    cuenta = _contrapartida(cc)
    p = pr.crear_prestamo(
        {
            "tercero_id": tercero["id"],
            "capital": CAPITAL,
            "cuenta_contrapartida_id": cuenta,
            "tercero_contrapartida_id": socio["id"],
            "fecha_desembolso": "2026-08-19",
        }
    )
    assert p["medio_pago_id"] is None
    assert len(p["cuotas"]) == 24
    assert cc.balance_comprobacion()["cuadra"]

    mov = cc.obtener_movimiento(p["movimiento_desembolso_id"])
    debitos = [l for l in mov["lineas"] if l["debito"]]
    assert len(debitos) == 1
    # El débito NO toca bancos: la plata no entró a la cuenta de la empresa.
    assert debitos[0]["cuenta_id"] == cuenta
    assert debitos[0]["tercero_id"] == socio["id"]
    assert debitos[0]["debito"] == pytest.approx(CAPITAL)


def test_contrapartida_y_medio_de_pago_son_excluyentes(mods):
    cc, pr, tercero, medio = mods
    base = {
        "tercero_id": tercero["id"],
        "capital": CAPITAL,
        "fecha_desembolso": "2026-08-19",
    }
    with pytest.raises(ValueError, match="pero no ambos"):
        pr.crear_prestamo({**base, "medio_pago_id": medio["id"], "cuenta_contrapartida_id": _contrapartida(cc)})
    with pytest.raises(ValueError, match="pero no ambos"):
        pr.crear_prestamo(base)


def test_cuota_de_prestamo_sin_medio_de_pago_exige_uno_al_pagar(mods):
    # El desembolso no tocó el banco, pero la cuota sí se gira: el panel tiene
    # que pedir la cuenta en vez de heredar un medio de pago inexistente.
    cc, pr, tercero, medio = mods
    p = pr.crear_prestamo(
        {
            "tercero_id": tercero["id"],
            "capital": CAPITAL,
            "cuenta_contrapartida_id": _contrapartida(cc),
            "fecha_desembolso": "2026-08-19",
        }
    )
    with pytest.raises(ValueError, match="medio_pago_id"):
        pr.registrar_pago_cuota(p["id"], 1)
    pr.registrar_pago_cuota(p["id"], 1, {"medio_pago_id": medio["id"]})
    assert cc.balance_comprobacion()["cuadra"]


# ── Mes de gracia (decisión del 11-sep-2026) ─────────────────────────────────
# Gracia TOTAL: el primer mes no causa interés y no hay cuota. El cronograma es
# el mismo corrido un mes; el prestamista deja de ganar ese mes (no se
# capitaliza ni se difiere), así que reduce lo pactado.


def test_gracia_corre_las_fechas_sin_cambiar_los_montos():
    sin = calcular_cronograma(20_000_000, fecha_desembolso="2026-08-19")
    con = calcular_cronograma(20_000_000, fecha_desembolso="2026-08-19", meses_gracia=1)
    assert sin["cuotas"][0]["fecha"] == "2026-09-19"
    assert con["cuotas"][0]["fecha"] == "2026-10-19"
    # La última cuota vence a los 25 meses, no a los 24: el plazo no se recorta.
    assert con["cuotas"][-1]["fecha"] == "2028-09-19"
    for a, b in zip(sin["cuotas"], con["cuotas"]):
        assert a["cuota_girada"] == b["cuota_girada"]
        assert a["interes_bruto"] == b["interes_bruto"]


def test_gracia_total_le_quita_un_mes_de_interes_al_prestamista():
    # Es la consecuencia que hay que poder mostrarle al familiar antes de que
    # acepte: con gracia total recibe menos que lo pactado sin ella.
    sin = calcular_cronograma(20_000_000, fecha_desembolso="2026-08-19")
    con = calcular_cronograma(20_000_000, fecha_desembolso="2026-08-19", meses_gracia=1)
    assert con["totales"]["total_girado"] == sin["totales"]["total_girado"]
    # El total es el mismo, pero llega un mes más tarde: eso es lo que abarata
    # la operación para McKenna por debajo de la tasa pactada.
    assert con["totales"]["costo_real_ea_pct"] < sin["totales"]["costo_real_ea_pct"]
    assert con["totales"]["costo_real_ea_pct"] == pytest.approx(23.00, abs=0.05)


def test_gracia_negativa_se_rechaza():
    with pytest.raises(ValueError, match="meses_gracia"):
        calcular_cronograma(1_000_000, meses_gracia=-1)


def test_prestamo_con_gracia_guarda_el_parametro(mods):
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio, meses_gracia=1, fecha_desembolso="2026-08-19", dia_pago=None)
    assert p["meses_gracia"] == 1
    assert p["cuotas"][0]["fecha_vencimiento"] == "2026-10-19"
    assert cc.balance_comprobacion()["cuadra"]


def test_aplicar_gracia_corre_las_cuotas_de_un_prestamo_existente(mods):
    cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio, fecha_desembolso="2026-08-19", dia_pago=None)
    assert p["cuotas"][0]["fecha_vencimiento"] == "2026-09-19"
    mov_antes = p["movimiento_desembolso_id"]

    con_gracia = pr.aplicar_meses_gracia(p["id"], 1)
    assert con_gracia["meses_gracia"] == 1
    assert con_gracia["cuotas"][0]["fecha_vencimiento"] == "2026-10-19"
    assert con_gracia["cuotas"][-1]["fecha_vencimiento"] == "2028-09-19"
    # El asiento de desembolso no se toca: la plata se movió el 19-ago.
    assert con_gracia["movimiento_desembolso_id"] == mov_antes
    assert cc.balance_comprobacion()["cuadra"]
    # Los montos son los mismos, solo corridos.
    assert [c["cuota_girada"] for c in con_gracia["cuotas"]] == [
        c["cuota_girada"] for c in p["cuotas"]
    ]


def test_no_se_recalcula_un_cronograma_con_cuotas_ya_pagadas(mods):
    _cc, pr, tercero, medio = mods
    p = _crear(pr, tercero, medio)
    pr.registrar_pago_cuota(p["id"], 1)
    with pytest.raises(ValueError, match="pagada"):
        pr.aplicar_meses_gracia(p["id"], 1)


def test_ampliar_capital_mantiene_un_solo_cronograma(mods):
    # Caso Antonio Ruiz: prestó 16M pero consignó una parte a la empresa y le
    # giró el resto a una socia. Es un préstamo, no dos.
    cc, pr, tercero, medio = mods
    socia = cc.crear_tercero(
        {"nombre": "Socia", "tipo": "socio", "identificacion": "77", "email": "c@e.com"}
    )
    p = _crear(
        pr, tercero, medio,
        capital=9_200_000, fecha_desembolso="2026-08-09", dia_pago=None, meses_gracia=1,
    )
    with cc._conn() as con:
        c1355 = cc._cuenta_id_por_codigo(con, "1355")

    ampliado = pr.ampliar_capital(
        p["id"],
        {
            "monto": 6_800_000,
            "fecha": "2026-08-09",
            "cuenta_contrapartida_id": c1355,
            "tercero_contrapartida_id": socia["id"],
        },
    )
    assert ampliado["capital"] == 16_000_000
    assert len(ampliado["cuotas"]) == 24
    assert ampliado["cuotas"][0]["saldo_inicial"] == 16_000_000
    assert ampliado["cuotas"][-1]["saldo_final"] == 0
    # La gracia se conserva al recalcular
    assert ampliado["cuotas"][0]["fecha_vencimiento"] == "2026-10-09"
    # Dos asientos distintos: uno por cada vía de entrada, cada uno conciliable
    assert ampliado["movimiento_ampliacion_id"] != ampliado["movimiento_desembolso_id"]
    assert cc.balance_comprobacion()["cuadra"]
