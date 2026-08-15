"""Bucketing de fechas, cruce de costos/comisiones y score de salud del negocio."""

from datetime import date

from app.services import salud_negocio as S


# ─── Bucketing ─────────────────────────────────────────────────────────────

def test_rangos_semanas_cubre_lunes_a_domingo():
    rangos = S._rangos_semanas(3)
    assert len(rangos) == 3
    for r in rangos:
        inicio = date.fromisoformat(r["inicio"])
        assert inicio.weekday() == 0  # lunes
    # buckets consecutivos, sin huecos
    for a, b in zip(rangos, rangos[1:]):
        assert date.fromisoformat(b["inicio"]) - date.fromisoformat(a["inicio"]) == __import__("datetime").timedelta(days=7)


def test_rangos_meses_cubre_mes_calendario_completo():
    rangos = S._rangos_meses(2)
    assert len(rangos) == 2
    r = rangos[0]
    inicio = date.fromisoformat(r["inicio"])
    assert inicio.day == 1


# ─── Score ─────────────────────────────────────────────────────────────────

def test_score_margen_alto_sin_ads_sin_tendencia_es_excelente():
    salud = S._score_bucket(margen_pct=30.0, acos_pct=None, margen_pct_anterior=None)
    assert salud["score"] >= 85
    assert salud["calificacion"] == "excelente"


def test_score_margen_negativo_es_riesgo():
    salud = S._score_bucket(margen_pct=-5.0, acos_pct=None, margen_pct_anterior=None)
    assert salud["score"] < 50
    assert salud["calificacion"] == "riesgo"


def test_score_acos_extremo_penaliza():
    con_ads_sanos = S._score_bucket(margen_pct=20.0, acos_pct=30.0, margen_pct_anterior=None)
    con_ads_perdida = S._score_bucket(margen_pct=20.0, acos_pct=150.0, margen_pct_anterior=None)
    assert con_ads_perdida["score"] < con_ads_sanos["score"]
    assert con_ads_perdida["componentes"]["eficiencia_ads"] == 0.0


def test_score_tendencia_positiva_sube_score():
    subiendo = S._score_bucket(margen_pct=15.0, acos_pct=None, margen_pct_anterior=5.0)
    bajando = S._score_bucket(margen_pct=15.0, acos_pct=None, margen_pct_anterior=25.0)
    assert subiendo["score"] > bajando["score"]


def test_calificacion_usa_los_mismos_cortes_que_el_frontend():
    assert S._calificacion(85) == "excelente"
    assert S._calificacion(70) == "bueno"
    assert S._calificacion(50) == "regular"
    assert S._calificacion(49.9) == "riesgo"


# ─── Cruce de costos/comisiones por orden ──────────────────────────────────

def test_acumular_orden_meli_suma_costo_y_comisiones_por_sku():
    orden = {
        "total_amount": 20900,
        "order_items": [
            {"item": {"id": "mco1"}, "quantity": 2},
        ],
    }
    acc = {"ingresos": 0.0, "costo_producto": 0.0, "comisiones_meli": 0.0}
    relacion_por_mid = {"MCO1": {"sku": "C-TEST", "nombre": "Producto test"}}
    costos = {"C-TEST": {"costo_total": 5000.0, "sin_costo": 0}}
    cobros_por_sku = {"C-TEST": {"cargo_venta": 3448.0, "cargo_envio": 2700.0}}

    S._acumular_orden_meli(orden, acc, relacion_por_mid, costos, cobros_por_sku)

    assert acc["ingresos"] == 20900
    assert acc["costo_producto"] == 10000.0  # 5000 * 2 unidades
    assert acc["comisiones_meli"] == (3448.0 + 2700.0) * 2


def test_acumular_orden_meli_ignora_item_sin_relacion_sku():
    orden = {"total_amount": 1000, "order_items": [{"item": {"id": "MCO999"}, "quantity": 1}]}
    acc = {"ingresos": 0.0, "costo_producto": 0.0, "comisiones_meli": 0.0}
    S._acumular_orden_meli(orden, acc, {}, {}, {})
    assert acc["costo_producto"] == 0.0
    assert acc["comisiones_meli"] == 0.0
    assert acc["ingresos"] == 1000  # el ingreso sí se cuenta aunque no se resuelva el SKU


def test_costo_producto_web_suma_por_sku():
    items = [{"sku": "C-TEST", "qty": 3}, {"sku": "SIN-COSTO", "qty": 1}]
    costos = {"C-TEST": {"costo_total": 1000.0}}
    assert S._costo_producto_web(items, costos) == 3000.0


# ─── Orquestador (mockeado end-to-end) ─────────────────────────────────────

def test_salud_negocio_resumen_cruza_todas_las_fuentes(monkeypatch):
    rango_actual = S._rangos_semanas(1)[0]
    fecha_orden = rango_actual["inicio"]

    orden_meli = {
        "total_amount": 20900.0,
        "date_created": f"{fecha_orden}T10:00:00.000-05:00",
        "order_items": [{"item": {"id": "MCO1"}, "quantity": 1}],
    }
    monkeypatch.setattr(S, "_ventas_meli_crudas", lambda dias_atras: [orden_meli])
    monkeypatch.setattr(
        S,
        "_ventas_web_en_rango",
        lambda fi, ff: {"ingresos": 50000.0, "items": [{"sku": "C-TEST", "qty": 1}]},
    )

    monkeypatch.setattr(
        "app.services.rentabilidad._sku_canonico_desde_relacion",
        lambda: {"MCO1": {"sku": "C-TEST", "nombre": "Producto test"}},
    )
    monkeypatch.setattr(
        "app.services.rentabilidad.costos_todos_resumen",
        lambda refresh=False: {"C-TEST": {"costo_total": 5000.0, "sin_costo": 0}},
    )
    monkeypatch.setattr(
        "app.services.rentabilidad.listar_cobros_meli",
        lambda refresh=False: {"items": [{"sku": "C-TEST", "cargo_venta": 3000.0, "cargo_envio": 2000.0}]},
    )
    monkeypatch.setattr(
        "app.services.meli_ads.gasto_ads_por_rango",
        lambda date_from, date_to: {"costo": 1000.0, "ventas_atribuidas": 5000.0, "acos": 20.0},
    )
    monkeypatch.setattr(
        "app.services.contabilidad_db.resumen_nomina",
        lambda: {"total_mensual": 3_100_000.0, "activos": 1},
    )
    monkeypatch.setattr(
        "app.services.contabilidad_db.pagos_servicios_en_rango",
        lambda fi, ff: [{"monto": 50000.0}],
    )

    resultado = S.salud_negocio_resumen(periodicidad="semana", n=1)

    assert len(resultado["buckets"]) == 1
    fila = resultado["buckets"][0]
    assert fila["ingresos_meli"] == 20900.0
    assert fila["ingresos_web"] == 50000.0
    assert fila["ingresos_total"] == 70900.0
    assert fila["costo_producto"] == 5000.0 + 5000.0  # 1 unidad MeLi + 1 unidad web
    assert fila["comisiones_meli"] == 5000.0
    assert fila["gasto_ads"] == 1000.0
    assert fila["costos_admin"]["servicios"] == 50000.0
    assert fila["costos_admin"]["nomina"] > 0
    utilidad_esperada = 70900.0 - 10000.0 - 5000.0 - 1000.0 - fila["costos_admin"]["total"]
    assert fila["utilidad_neta"] == round(utilidad_esperada, 2)
    assert "score" in fila and "calificacion" in fila
    assert resultado["actual"] == fila
