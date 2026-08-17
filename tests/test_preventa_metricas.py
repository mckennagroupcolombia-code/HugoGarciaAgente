"""Conversión de preventa MeLi: cruce preguntas ↔ compras (sin API)."""

from datetime import datetime, timedelta, timezone

from app.services.preventa_metricas import cruzar_preguntas_con_compras


def _dt(days_ago: float, hours_ago: float = 0) -> datetime:
    return datetime(2026, 8, 16, 18, 0, tzinfo=timezone.utc) - timedelta(
        days=days_ago, hours=hours_ago
    )


AHORA = datetime(2026, 8, 16, 18, 0, tzinfo=timezone.utc)


def _preg(**kw):
    base = {
        "question_id": "1",
        "buyer_id": "100",
        "item_id": "MCO1",
        "titulo": "Urea Cosmética 250g",
        "fecha": _dt(10),
        "status": "ANSWERED",
    }
    base.update(kw)
    return base


def _orden(**kw):
    base = {
        "id": "9001",
        "buyer_id": "100",
        "fecha": _dt(8),
        "item_ids": ["MCO1"],
        "total_amount": 45000,
        "order_items": [{"item": {"id": "MCO1", "title": "Urea Cosmética 250g"}}],
    }
    base.update(kw)
    return base


def test_compra_mismo_item_despues_cuenta():
    out = cruzar_preguntas_con_compras(
        [_preg()],
        [_orden()],
        ahora=AHORA,
        desde=_dt(30),
        margen_horas=48,
    )
    r = out["resumen"]
    assert r["oportunidades"] == 1
    assert r["compraron_mismo_item"] == 1
    assert r["tasa_compra_pct"] == 100.0


def test_compra_antes_de_preguntar_no_cuenta():
    out = cruzar_preguntas_con_compras(
        [_preg(fecha=_dt(5))],
        [_orden(fecha=_dt(10))],
        ahora=AHORA,
        desde=_dt(30),
    )
    assert out["resumen"]["compraron_mismo_item"] == 0
    assert out["resumen"]["tasa_compra_pct"] == 0.0


def test_compra_otro_item_es_tienda_no_mismo():
    out = cruzar_preguntas_con_compras(
        [_preg()],
        [_orden(item_ids=["MCO9"], order_items=[{"item": {"id": "MCO9", "title": "Otro"}}])],
        ahora=AHORA,
        desde=_dt(30),
    )
    r = out["resumen"]
    assert r["compraron_mismo_item"] == 0
    assert r["compraron_cualquier_item"] == 1
    assert r["tasa_compra_tienda_pct"] == 100.0
    assert r["tasa_compra_pct"] == 0.0


def test_dos_preguntas_mismo_par_son_una_oportunidad():
    out = cruzar_preguntas_con_compras(
        [
            _preg(question_id="1", fecha=_dt(12)),
            _preg(question_id="2", fecha=_dt(10)),
        ],
        [_orden(fecha=_dt(8))],
        ahora=AHORA,
        desde=_dt(30),
    )
    assert out["preguntas_en_periodo"] == 2
    assert out["resumen"]["oportunidades"] == 1
    assert out["resumen"]["compraron_mismo_item"] == 1


def test_pregunta_reciente_queda_en_espera():
    out = cruzar_preguntas_con_compras(
        [_preg(fecha=_dt(0, hours_ago=6))],
        [],
        ahora=AHORA,
        desde=_dt(30),
        margen_horas=48,
    )
    assert out["resumen"]["oportunidades"] == 0
    assert out["oportunidades_en_espera"] == 1


def test_respondida_vs_sin_responder():
    out = cruzar_preguntas_con_compras(
        [
            _preg(question_id="1", buyer_id="100", status="ANSWERED"),
            _preg(question_id="2", buyer_id="200", item_id="MCO2", status="UNANSWERED"),
        ],
        [_orden(buyer_id="100")],
        ahora=AHORA,
        desde=_dt(30),
    )
    resp = out["por_respuesta"]["respondidas"]
    sin = out["por_respuesta"]["sin_responder"]
    assert resp["oportunidades"] == 1
    assert resp["tasa_compra_pct"] == 100.0
    assert sin["oportunidades"] == 1
    assert sin["tasa_compra_pct"] == 0.0


def test_por_producto_ordena_por_volumen():
    out = cruzar_preguntas_con_compras(
        [
            _preg(question_id="1", buyer_id="1", item_id="MCO1", titulo="Urea"),
            _preg(question_id="2", buyer_id="2", item_id="MCO1", titulo="Urea"),
            _preg(question_id="3", buyer_id="3", item_id="MCO2", titulo="Glicerina"),
        ],
        [_orden(buyer_id="1"), _orden(id="9002", buyer_id="2")],
        ahora=AHORA,
        desde=_dt(30),
    )
    prods = out["por_producto"]
    assert prods[0]["item_id"] == "MCO1"
    assert prods[0]["tasa_compra_pct"] == 100.0
    assert prods[1]["item_id"] == "MCO2"
    assert prods[1]["tasa_compra_pct"] == 0.0


def test_acepta_forma_cruda_meli():
    preguntas = [
        {
            "id": 111,
            "item_id": "MCO1",
            "from": {"id": 555},
            "date_created": "2026-08-06T10:00:00.000-05:00",
            "status": "ANSWERED",
        }
    ]
    ordenes = [
        {
            "id": 77,
            "buyer": {"id": 555},
            "date_created": "2026-08-08T12:00:00.000-05:00",
            "order_items": [{"item": {"id": "MCO1", "title": "Urea"}}],
            "total_amount": 1000,
        }
    ]
    out = cruzar_preguntas_con_compras(
        preguntas, ordenes, ahora=AHORA, desde=_dt(30)
    )
    assert out["resumen"]["compraron_mismo_item"] == 1
    assert "Urea" in out["por_producto"][0]["titulo"]


def test_sin_preguntas_tasa_cero():
    out = cruzar_preguntas_con_compras([], [], ahora=AHORA, desde=_dt(30))
    assert out["resumen"]["tasa_compra_pct"] == 0.0
    assert out["resumen"]["oportunidades"] == 0
    assert out["por_producto"] == []
