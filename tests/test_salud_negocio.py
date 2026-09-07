"""Bucketing de fechas, cruce de costos/comisiones y score de salud del negocio."""

import json
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


def test_rangos_dias_un_bucket_por_dia_terminando_hoy():
    rangos = S._rangos_dias(5)
    assert len(rangos) == 5
    hoy = date.today()
    assert rangos[-1]["inicio"] == rangos[-1]["fin"] == hoy.strftime("%Y-%m-%d")
    for r in rangos:
        assert r["inicio"] == r["fin"]
        assert r["dias"] == 1
    fechas = [date.fromisoformat(r["inicio"]) for r in rangos]
    assert fechas == sorted(fechas)
    assert len(set(fechas)) == 5


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


# ─── Otras ventas (aproximación por descarte: ni MeLi ni web) ─────────────

def test_clasificar_canal_factura_reconoce_meli_por_pack_id():
    factura = {"observations": "Venta Mercado Libre #2000014481818717 - Facturado desde astroselling.com"}
    assert S._clasificar_canal_factura_siigo(factura) == "meli"


def test_clasificar_canal_factura_reconoce_web_por_referencia_mckg():
    # La referencia web va en `observations` como texto — `purchase_order`
    # nunca viene poblado en el listado de Siigo (ver comentario en
    # `_clasificar_canal_factura_siigo`), así que NO hay que depender de él.
    factura = {"observations": "Pedido web MCKG-F09BC12250. Mercado Pago: N/A."}
    assert S._clasificar_canal_factura_siigo(factura) == "web"


def test_clasificar_canal_factura_sin_ninguna_marca_cae_en_otro():
    factura = {"observations": "", "purchase_order": ""}
    assert S._clasificar_canal_factura_siigo(factura) == "otro"


def test_clasificar_canal_factura_venta_directa_whatsapp_cae_en_otro():
    factura = {"observations": "Venta directa WhatsApp (agente IA)"}
    assert S._clasificar_canal_factura_siigo(factura) == "otro"


def test_ventas_otras_por_bucket_excluye_meli_y_web_suma_el_resto(monkeypatch):
    rango = {"inicio": "2026-08-01", "fin": "2026-08-15", "label": "ago 2026", "dias": 15}
    facturas = [
        {"date": "2026-08-05", "total": 100000.0, "observations": "Venta Mercado Libre #123456789", "items": []},
        {"date": "2026-08-06", "total": 50000.0, "observations": "Pedido web MCKG-ABCDEF1234. Mercado Pago: N/A.", "items": []},
        {
            "date": "2026-08-07", "total": 30000.0, "observations": "Venta directa WhatsApp (agente IA)",
            "items": [{"code": "C-TEST", "quantity": 2}],
        },
        {"date": "2026-08-08", "total": 15000.0, "observations": "", "items": []},  # factura manual sin marcador
    ]
    monkeypatch.setattr(
        "app.services.alegra.obtener_facturas_hibridas",
        lambda fecha_inicio, fecha_fin=None, estricto=False: facturas,
    )
    costos = {"C-TEST": {"costo_total": 4000.0}}

    resultado = S._ventas_otras_por_bucket([rango], costos)

    acc = resultado[rango["inicio"]]
    assert acc["ingresos"] == 30000.0 + 15000.0  # excluye MeLi (100000) y web (50000)
    assert acc["facturas"] == 2
    assert acc["con_marcador_wa"] == 1
    assert acc["costo_producto"] == 4000.0 * 2
    assert acc["unidades"] == 2


def test_calcular_bucket_suma_otras_ventas_a_ingresos_y_costo(monkeypatch):
    monkeypatch.setattr(S, "_ventas_web_en_rango", lambda fi, ff: {"ingresos": 0.0, "items": []})
    rango = {"inicio": "2026-08-01", "fin": "2026-08-15", "label": "ago 2026", "dias": 15}
    otras = {"ingresos": 30000.0, "costo_producto": 8000.0, "unidades": 2.0, "facturas": 1, "con_marcador_wa": 1}
    ads_vacio = {"costo": 0.0, "acos": 0.0}
    fila = S._calcular_bucket(rango, [], {}, {}, {}, 0.0, None, ads_precalculado=ads_vacio, otras_ventas=otras)
    assert fila["ingresos_otros_canales"] == 30000.0
    assert fila["ingresos_total"] == 30000.0
    assert fila["costo_producto"] == 8000.0
    assert fila["unidades_vendidas"] == 2
    assert fila["otros_canales_facturas"] == 1
    assert fila["otros_canales_con_marcador_wa"] == 1


# ─── Nómina real: RRHH → Compensaciones, no la tabla vacía de contabilidad ──

def test_total_mensual_nomina_suma_devengado_de_rrhh(tmp_path, monkeypatch):
    ruta = tmp_path / "rrhh_compensaciones.json"
    ruta.write_text(
        '{"nomina": ['
        '{"persona": "A", "devengado": 2500000}, '
        '{"persona": "B", "devengado": 2200000}, '
        '{"persona": "Informal", "devengado": 0}'
        ']}',
        encoding="utf-8",
    )
    monkeypatch.setattr(S, "_RRHH_COMPENSACIONES_PATH", str(ruta))
    total, fuente = S._total_mensual_nomina()
    assert total == 4_700_000.0
    assert fuente == "rrhh_compensaciones"


def test_total_mensual_nomina_cae_a_contabilidad_si_rrhh_vacio(tmp_path, monkeypatch):
    ruta = tmp_path / "rrhh_compensaciones.json"
    ruta.write_text('{"nomina": []}', encoding="utf-8")
    monkeypatch.setattr(S, "_RRHH_COMPENSACIONES_PATH", str(ruta))
    monkeypatch.setattr(
        "app.services.contabilidad_db.resumen_nomina",
        lambda: {"total_mensual": 8_000_000.0, "activos": 3},
    )
    total, fuente = S._total_mensual_nomina()
    assert total == 8_000_000.0
    assert fuente == "contabilidad_empleados"


def test_total_mensual_nomina_sin_datos_en_ninguna_fuente(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_RRHH_COMPENSACIONES_PATH", str(tmp_path / "no_existe.json"))
    monkeypatch.setattr(
        "app.services.contabilidad_db.resumen_nomina",
        lambda: {"total_mensual": 0.0, "activos": 0},
    )
    total, fuente = S._total_mensual_nomina()
    assert total == 0.0
    assert fuente == "sin_datos"


# ─── Gasto en ads fuera de la ventana de 90 días de MeLi ───────────────────
# Bug real: MeLi rechaza (400) pedir métricas de ads con más de 90 días de
# antigüedad. `gasto_ads_por_rango` devuelve costo=0 + "error" en ese caso —
# `_calcular_bucket` NO debe leer eso como "no hubo gasto en ads".

def test_calcular_bucket_marca_ads_no_disponible_si_meli_rechaza_el_rango(monkeypatch):
    rango = {"inicio": "2025-09-01", "fin": "2025-09-30", "label": "sep 2025", "dias": 30}
    monkeypatch.setattr(
        "app.services.meli_ads.gasto_ads_por_rango",
        lambda date_from, date_to: {
            "costo": 0.0, "ventas_atribuidas": 0.0, "acos": 0.0,
            "error": "MeLi campaigns/search HTTP 400: date greater than 90 days",
        },
    )
    fila = S._calcular_bucket(rango, [], {}, {}, {}, 0.0, None)
    assert fila["ads_disponible"] is False
    assert fila["gasto_ads"] == 0.0  # no hay mejor número disponible, pero...
    assert fila["acos_ads"] is None  # ...el ACOS no se inventa como 0%


def test_calcular_bucket_ads_disponible_cuando_meli_responde_ok(monkeypatch):
    rango = {"inicio": "2026-08-01", "fin": "2026-08-15", "label": "ago 2026", "dias": 15}
    monkeypatch.setattr(
        "app.services.meli_ads.gasto_ads_por_rango",
        lambda date_from, date_to: {"costo": 1000.0, "ventas_atribuidas": 2000.0, "acos": 50.0},
    )
    fila = S._calcular_bucket(rango, [], {}, {}, {}, 0.0, None)
    assert fila["ads_disponible"] is True
    assert fila["acos_ads"] == 50.0


def test_calcular_bucket_gasto_sin_ventas_atribuidas_no_puntua_como_perfecto(monkeypatch):
    """
    Campaña recién creada (o recién reestructurada): gastó plata pero MeLi
    aún no atribuyó ninguna venta. `acos=None` con costo>0 es el PEOR caso
    (ACOS indefinido/altísimo), no un 0% de eficiencia perfecta.
    """
    rango = {"inicio": "2026-08-15", "fin": "2026-08-15", "label": "15 ago", "dias": 1}
    monkeypatch.setattr(
        "app.services.meli_ads.gasto_ads_por_rango",
        lambda date_from, date_to: {"costo": 5000.0, "ventas_atribuidas": 0.0, "acos": None},
    )
    fila = S._calcular_bucket(rango, [], {}, {}, {}, 0.0, None)
    assert fila["acos_ads"] is None  # se muestra "sin dato", no "0%"
    assert fila["componentes"]["eficiencia_ads"] == 0.0  # pero puntúa como el peor caso, no el mejor


def test_calcular_bucket_sin_gasto_en_ads_si_puntua_neutral(monkeypatch):
    """Sin gasto real (costo=0), la eficiencia de ads no debe penalizar ni premiar — 100 neutral."""
    rango = {"inicio": "2026-08-15", "fin": "2026-08-15", "label": "15 ago", "dias": 1}
    monkeypatch.setattr(
        "app.services.meli_ads.gasto_ads_por_rango",
        lambda date_from, date_to: {"costo": 0.0, "ventas_atribuidas": 0.0, "acos": 0.0},
    )
    fila = S._calcular_bucket(rango, [], {}, {}, {}, 0.0, None)
    assert fila["componentes"]["eficiencia_ads"] == 100.0


def test_calcular_bucket_suma_unidades_vendidas_meli_y_web(monkeypatch):
    rango = {"inicio": "2026-08-01", "fin": "2026-08-15", "label": "ago 2026", "dias": 15}
    orden = {
        "total_amount": 1000.0,
        "date_created": "2026-08-05T10:00:00.000-05:00",
        "order_items": [{"item": {"id": "MCO1"}, "quantity": 3}],
    }
    monkeypatch.setattr(
        S, "_ventas_web_en_rango", lambda fi, ff: {"ingresos": 500.0, "items": [{"sku": "C-TEST", "qty": 2}]}
    )
    monkeypatch.setattr("app.services.meli_ads.gasto_ads_por_rango", lambda date_from, date_to: {"costo": 0.0, "acos": 0.0})
    fila = S._calcular_bucket(rango, [orden], {"MCO1": {"sku": "C-TEST"}}, {}, {}, 0.0, None)
    assert fila["unidades_vendidas"] == 5  # 3 MeLi + 2 web


def test_calcular_bucket_usa_ads_archivado_sin_llamar_a_meli(monkeypatch):
    rango = {"inicio": "2025-09-01", "fin": "2025-09-30", "label": "sep 2025", "dias": 30}
    llamadas = []
    monkeypatch.setattr(
        "app.services.meli_ads.gasto_ads_por_rango",
        lambda date_from, date_to: llamadas.append((date_from, date_to)) or {"costo": 0.0, "acos": 0.0, "error": "no debería llamarse"},
    )
    fila = S._calcular_bucket(rango, [], {}, {}, {}, 0.0, None, ads_precalculado={"costo": 5000.0, "acos": 40.0})
    assert fila["ads_disponible"] is True
    assert fila["gasto_ads"] == 5000.0
    assert fila["acos_ads"] == 40.0
    assert llamadas == []  # no se pidió nada a MeLi — ya lo teníamos archivado


def test_buscar_ads_archivado_encuentra_bajo_version_de_cache_vieja():
    rango = {"inicio": "2025-09-01", "fin": "2025-09-30", "label": "sep 2025", "dias": 30}
    cache_disco = {
        "v3:mes:2025-09-01": {"gasto_ads": 12345.0, "acos_ads": 48.0, "ads_disponible": True},
        "v3:mes:2025-10-01": {"gasto_ads": 999.0, "acos_ads": 10.0, "ads_disponible": True},
    }
    archivado = S._buscar_ads_archivado(cache_disco, "mes", rango)
    assert archivado == {"costo": 12345.0, "acos": 48.0}


def test_buscar_ads_archivado_ignora_entradas_sin_ads_disponible():
    rango = {"inicio": "2025-09-01", "fin": "2025-09-30", "label": "sep 2025", "dias": 30}
    cache_disco = {"v2:mes:2025-09-01": {"gasto_ads": 0.0, "acos_ads": None, "ads_disponible": False}}
    assert S._buscar_ads_archivado(cache_disco, "mes", rango) is None


def test_salud_negocio_resumen_preserva_ads_archivado_tras_bump_de_version(tmp_path, monkeypatch):
    """
    Simula el escenario real: un bucket quedó cacheado con ads reales bajo
    una versión de caché vieja; sube `_CACHE_VERSION` (como ya pasó 4 veces
    en este módulo); el bucket ya está fuera de la ventana de 90 días. Sin
    el archivo, se perdería el dato para siempre.
    """
    ruta_cache = tmp_path / "salud_negocio_cache.json"
    monkeypatch.setattr(S, "_CACHE_PATH", str(ruta_cache))
    monkeypatch.setattr(S, "_ventas_web_en_rango", lambda fi, ff: {"ingresos": 0.0, "items": []})
    monkeypatch.setattr("app.services.rentabilidad._sku_canonico_desde_relacion", lambda: {})
    monkeypatch.setattr("app.services.rentabilidad.costos_todos_resumen", lambda refresh=False: {})
    monkeypatch.setattr("app.services.rentabilidad.listar_cobros_meli", lambda refresh=False: {"items": []})
    monkeypatch.setattr(S, "_total_mensual_nomina", lambda: (0.0, "sin_datos"))
    monkeypatch.setattr("app.services.contabilidad_db.pagos_servicios_en_rango", lambda fi, ff: [])
    monkeypatch.setattr(S, "_ventas_meli_en_rango", lambda fi, ff: [])

    rango_viejo = S._rangos_meses(2)[0]  # mes anterior, ya cerrado
    ruta_cache.write_text(
        json.dumps({
            f"v1:mes:{rango_viejo['inicio']}": {
                **rango_viejo, "ingresos_meli": 0.0, "ingresos_web": 0.0, "ingresos_total": 100000.0,
                "costo_producto": 0.0, "comisiones_meli": 0.0, "gasto_ads": 30000.0, "ads_disponible": True,
                "acos_ads": 45.0, "costos_admin": {"nomina": 0.0, "servicios": 0.0, "total": 0.0},
                "utilidad_neta": 70000.0, "margen_pct": 70.0, "score": 90, "calificacion": "excelente",
                "componentes": {"margen": 100.0, "eficiencia_ads": 100.0, "tendencia": 50.0},
            }
        }),
        encoding="utf-8",
    )

    def _ads_rechazado(date_from, date_to):
        return {"costo": 0.0, "acos": 0.0, "error": "date greater than 90 days"}

    monkeypatch.setattr("app.services.meli_ads.gasto_ads_por_rango", _ads_rechazado)
    monkeypatch.setattr("app.services.siigo.obtener_facturas_siigo_paginadas", lambda fecha_inicio, estricto=False: [])
    monkeypatch.setattr(
        "app.services.alegra.obtener_facturas_hibridas",
        lambda fecha_inicio, fecha_fin=None, estricto=False: [],
    )
    monkeypatch.setattr(
        "app.services.meli_ads_recomendaciones.calcular_recomendaciones_publicidad",
        lambda dias=30, refresh=False: {
            "resumen": {"pausar": 0, "revisar": 0, "costo_pausar": 0.0, "costo_revisar": 0.0}
        },
    )
    monkeypatch.setattr("app.services.extracto_bancario.saldo_bancario_mas_reciente", lambda: None)
    monkeypatch.setattr(S, "_RESUMEN_MEM", {})
    monkeypatch.setattr(S, "_RESUMEN_MEM_TTL_S", 0)
    monkeypatch.setattr(S, "_RESUMEN_MEM_STALE_MAX_S", 0)
    monkeypatch.setattr(S, "_OTRAS_FACTURAS_MEM", {})
    monkeypatch.setattr(S, "_RESUMEN_INFLIGHT", {})
    monkeypatch.setattr(S, "_RESUMEN_BG_RUNNING", set())

    resultado = S.salud_negocio_resumen(periodicidad="mes", n=2)  # nueva _CACHE_VERSION -> clave vieja no matchea

    fila_vieja = resultado["buckets"][0]
    assert fila_vieja["fuente"] == "calculado"  # se recalculó (la clave versionada cambió)
    assert fila_vieja["ads_disponible"] is True  # pero el gasto en ads se rescató del archivo
    assert fila_vieja["gasto_ads"] == 30000.0


# ─── Orquestador (mockeado end-to-end) ─────────────────────────────────────

def test_salud_negocio_resumen_cruza_todas_las_fuentes(monkeypatch):
    rango_actual = S._rangos_semanas(1)[0]
    fecha_orden = rango_actual["inicio"]

    orden_meli = {
        "total_amount": 20900.0,
        "date_created": f"{fecha_orden}T10:00:00.000-05:00",
        "order_items": [{"item": {"id": "MCO1"}, "quantity": 1}],
    }
    monkeypatch.setattr(S, "_ventas_meli_en_rango", lambda fi, ff: [orden_meli])
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
        lambda buscar="", refresh=False: {"items": [{"sku": "C-TEST", "cargo_venta": 3000.0, "cargo_envio": 2000.0}]},
    )
    monkeypatch.setattr(
        "app.services.meli_ads.gasto_ads_por_rango",
        lambda date_from, date_to: {"costo": 1000.0, "ventas_atribuidas": 5000.0, "acos": 20.0},
    )
    monkeypatch.setattr(S, "_total_mensual_nomina", lambda: (3_100_000.0, "rrhh_compensaciones"))
    monkeypatch.setattr(
        "app.services.contabilidad_db.pagos_servicios_en_rango",
        lambda fi, ff: [{"monto": 50000.0}],
    )
    monkeypatch.setattr(
        "app.services.alegra.obtener_facturas_hibridas",
        lambda fecha_inicio, fecha_fin=None, estricto=False: [],
    )
    monkeypatch.setattr(
        "app.services.meli_ads_recomendaciones.calcular_recomendaciones_publicidad",
        lambda dias=30, refresh=False: {
            "resumen": {"pausar": 2, "revisar": 3, "costo_pausar": 400000.0, "costo_revisar": 150000.0}
        },
    )
    monkeypatch.setattr(
        "app.services.extracto_bancario.saldo_bancario_mas_reciente",
        lambda: {"saldo": 6604054.59, "fecha": "2026-07-31", "banco": "", "cuenta": "", "extracto_id": 4, "extracto_nombre": "x"},
    )
    monkeypatch.setattr(S, "_RESUMEN_MEM", {})
    monkeypatch.setattr(S, "_RESUMEN_MEM_TTL_S", 0)
    monkeypatch.setattr(S, "_RESUMEN_MEM_STALE_MAX_S", 0)
    monkeypatch.setattr(S, "_ORDENES_MELI_MEM", {})
    monkeypatch.setattr(S, "_OTRAS_FACTURAS_MEM", {})
    monkeypatch.setattr(S, "_RESUMEN_INFLIGHT", {})
    monkeypatch.setattr(S, "_RESUMEN_BG_RUNNING", set())

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
    assert resultado["actual"]["inicio"] == fila["inicio"]
    assert resultado["actual"]["utilidad_neta"] == fila["utilidad_neta"]
    assert resultado["ads_recomendaciones"] == {
        "pausar": 2, "revisar": 3, "costo_pausar": 400000.0, "costo_revisar": 150000.0,
    }
    assert resultado["saldo_bancario"]["saldo"] == 6604054.59
    assert resultado["saldo_bancario"]["fecha"] == "2026-07-31"


def test_resumen_ads_recomendaciones_none_si_publicidad_falla(monkeypatch):
    def _falla(dias=30, refresh=False):
        raise RuntimeError("MeLi Ads caído")

    monkeypatch.setattr("app.services.meli_ads_recomendaciones.calcular_recomendaciones_publicidad", _falla)
    assert S._resumen_ads_recomendaciones() is None


def test_saldo_bancario_none_si_extracto_bancario_falla(monkeypatch):
    def _falla():
        raise RuntimeError("DB de contabilidad no disponible")

    monkeypatch.setattr("app.services.extracto_bancario.saldo_bancario_mas_reciente", _falla)
    assert S._saldo_bancario() is None


# ─── Caché en disco de buckets cerrados ────────────────────────────────────

def _mockear_fuentes_minimas(monkeypatch):
    """Fuentes vacías/neutras — solo interesa contar cuántas veces se piden, no el P&L."""
    # Sin esto, la caché en memoria del resumen hace que la 2ª llamada del
    # test ni siquiera toque MeLi/ads y rompa los asserts de conteo.
    monkeypatch.setattr(S, "_RESUMEN_MEM", {})
    monkeypatch.setattr(S, "_RESUMEN_MEM_TTL_S", 0)
    monkeypatch.setattr(S, "_RESUMEN_MEM_STALE_MAX_S", 0)
    monkeypatch.setattr(S, "_ORDENES_MELI_MEM", {})
    monkeypatch.setattr(S, "_OTRAS_FACTURAS_MEM", {})
    monkeypatch.setattr(S, "_RESUMEN_INFLIGHT", {})
    monkeypatch.setattr(S, "_RESUMEN_BG_RUNNING", set())
    monkeypatch.setattr(S, "_ventas_web_en_rango", lambda fi, ff: {"ingresos": 0.0, "items": []})
    monkeypatch.setattr("app.services.rentabilidad._sku_canonico_desde_relacion", lambda: {})
    monkeypatch.setattr("app.services.rentabilidad.costos_todos_resumen", lambda refresh=False: {})
    monkeypatch.setattr("app.services.rentabilidad.listar_cobros_meli", lambda buscar="", refresh=False: {"items": []})
    monkeypatch.setattr(S, "_total_mensual_nomina", lambda: (0.0, "sin_datos"))
    monkeypatch.setattr("app.services.contabilidad_db.pagos_servicios_en_rango", lambda fi, ff: [])
    monkeypatch.setattr(
        "app.services.alegra.obtener_facturas_hibridas",
        lambda fecha_inicio, fecha_fin=None, estricto=False: [],
    )
    monkeypatch.setattr(
        "app.services.meli_ads_recomendaciones.calcular_recomendaciones_publicidad",
        lambda dias=30, refresh=False: {
            "resumen": {"pausar": 0, "revisar": 0, "costo_pausar": 0.0, "costo_revisar": 0.0}
        },
    )
    monkeypatch.setattr("app.services.extracto_bancario.saldo_bancario_mas_reciente", lambda: None)


def test_salud_negocio_resumen_acepta_periodicidad_dia(monkeypatch, tmp_path):
    monkeypatch.setattr(S, "_CACHE_PATH", str(tmp_path / "salud_negocio_cache.json"))
    _mockear_fuentes_minimas(monkeypatch)
    monkeypatch.setattr(S, "_ventas_meli_en_rango", lambda fi, ff: [])
    monkeypatch.setattr("app.services.meli_ads.gasto_ads_por_rango", lambda date_from, date_to: {"costo": 0.0, "acos": 0.0})

    resultado = S.salud_negocio_resumen(periodicidad="dia", n=7)

    assert resultado["periodicidad"] == "dia"
    assert len(resultado["buckets"]) == 7
    for b in resultado["buckets"]:
        assert b["inicio"] == b["fin"]  # cada bucket es un solo día


def test_bucket_cerrado_se_sirve_desde_cache_en_llamadas_siguientes(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_CACHE_PATH", str(tmp_path / "salud_negocio_cache.json"))
    _mockear_fuentes_minimas(monkeypatch)

    llamadas_meli: list[tuple[str, str]] = []
    monkeypatch.setattr(S, "_ventas_meli_en_rango", lambda fi, ff: (llamadas_meli.append((fi, ff)), [])[1])

    llamadas_ads: list[tuple[str, str]] = []

    def _ads_falso(date_from, date_to):
        llamadas_ads.append((date_from, date_to))
        return {"costo": 100.0, "ventas_atribuidas": 1000.0, "acos": 10.0}

    monkeypatch.setattr("app.services.meli_ads.gasto_ads_por_rango", _ads_falso)

    # 1ª llamada: nada en caché — se calculan los 2 meses (anterior + actual)
    r1 = S.salud_negocio_resumen(periodicidad="mes", n=2)
    assert len(llamadas_ads) == 2
    assert len(llamadas_meli) == 2  # una consulta a MeLi POR bucket, no una para todo el rango
    assert all(f["fuente"] == "calculado" for f in r1["buckets"])
    mes_anterior_v1 = r1["buckets"][0]

    # 2ª llamada: el mes anterior ya cerró y quedó cacheado — no debería
    # volver a pedirse ni a la API de ads ni a la de órdenes MeLi.
    llamadas_ads.clear()
    llamadas_meli.clear()
    r2 = S.salud_negocio_resumen(periodicidad="mes", n=2)

    assert len(llamadas_ads) == 1  # solo el mes en curso volvió a pedirse
    assert len(llamadas_meli) == 1
    assert r2["buckets"][0]["fuente"] == "cache"
    assert r2["buckets"][1]["fuente"] == "calculado"
    assert r2["buckets"][0]["utilidad_neta"] == mes_anterior_v1["utilidad_neta"]
    # El mes anterior ya cerró; el actual (último bucket) sigue en curso —
    # el panel usa esto para no graficar una "vela" que todavía no cerró.
    assert r1["buckets"][0]["cerrado"] is True
    assert r1["buckets"][1]["cerrado"] is False


def test_refresh_solo_recalcula_periodo_abierto(tmp_path, monkeypatch):
    """Actualizar no debe re-paginar MeLi para buckets ya cerrados (eso colgaba el panel)."""
    monkeypatch.setattr(S, "_CACHE_PATH", str(tmp_path / "salud_negocio_cache.json"))
    _mockear_fuentes_minimas(monkeypatch)
    monkeypatch.setattr(S, "_ventas_meli_en_rango", lambda fi, ff: [])

    llamadas_ads: list[tuple[str, str]] = []

    def _ads_falso(date_from, date_to):
        llamadas_ads.append((date_from, date_to))
        return {"costo": 100.0, "ventas_atribuidas": 1000.0, "acos": 10.0}

    monkeypatch.setattr("app.services.meli_ads.gasto_ads_por_rango", _ads_falso)

    S.salud_negocio_resumen(periodicidad="mes", n=2)
    llamadas_ads.clear()

    resultado = S.salud_negocio_resumen(periodicidad="mes", n=2, refresh=True)

    # Solo el mes en curso pide ads/MeLi de nuevo; el cerrado sigue en disco.
    assert len(llamadas_ads) == 1
    assert resultado["buckets"][0]["fuente"] == "cache"
    assert resultado["buckets"][1]["fuente"] == "calculado"
    assert resultado["buckets"][0]["ads_disponible"] is True
    assert resultado["buckets"][0]["gasto_ads"] == 100.0
