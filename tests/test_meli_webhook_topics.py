"""Tópicos webhook MeLi: aliases marketplace_* y filtro actions."""

from app.meli_webhook_topics import (
    meli_webhook_es_envio,
    meli_webhook_es_mensajes_postventa,
    meli_webhook_es_preventa,
    meli_webhook_ignorar_messages_sin_created,
    meli_webhook_ignorar_order_pasiva,
    meli_webhook_question_id_desde_resource,
    meli_webhook_evaluar_despacho,
)


def test_preventa_topics():
    assert meli_webhook_es_preventa("questions")
    assert meli_webhook_es_preventa("marketplace_questions")
    assert meli_webhook_es_preventa("MARKETPLACE_QUESTIONS")
    assert not meli_webhook_es_preventa("items")
    assert not meli_webhook_es_preventa(None)


def test_postventa_topics():
    assert meli_webhook_es_mensajes_postventa("messages")
    assert meli_webhook_es_mensajes_postventa("marketplace_messages")
    assert meli_webhook_es_mensajes_postventa("messages_v2")
    assert not meli_webhook_es_mensajes_postventa("marketplace_questions")
    assert not meli_webhook_es_mensajes_postventa(None)


def test_question_id_from_resource():
    assert meli_webhook_question_id_desde_resource("/marketplace/questions/139876") == "139876"
    assert meli_webhook_question_id_desde_resource("/questions/999") == "999"


def test_ignore_messages_without_created():
    assert not meli_webhook_ignorar_messages_sin_created({})
    assert not meli_webhook_ignorar_messages_sin_created({"actions": []})
    assert not meli_webhook_ignorar_messages_sin_created({"actions": ["created"]})
    assert meli_webhook_ignorar_messages_sin_created({"actions": ["read"]})
    assert not meli_webhook_ignorar_messages_sin_created({"actions": ["read", "created"]})


def test_ignore_orders_new_tag_events():
    payload = {"actions": ["action:new_tag", "channel:marketplace", "payments"]}

    assert meli_webhook_ignorar_order_pasiva(payload)
    assert meli_webhook_evaluar_despacho(
        "orders_v2",
        "/orders/2000016339341868",
        payload,
    )["tipo"] == "orden_omitir_accion_pasiva"


def test_dispatch_orders_without_passive_tag():
    assert meli_webhook_evaluar_despacho(
        "orders_v2",
        "/orders/2000016339341868",
        {"actions": ["payments", "order_items"]},
    ) == {
        "tipo": "orden",
        "order_id": "2000016339341868",
        "topic": "orders_v2",
    }


def test_envio_topics():
    assert meli_webhook_es_envio("shipments")
    assert meli_webhook_es_envio("marketplace_shipments")
    assert meli_webhook_es_envio("SHIPMENTS")
    assert not meli_webhook_es_envio("orders_v2")
    assert not meli_webhook_es_envio(None)


def test_dispatch_envio_con_resource():
    assert meli_webhook_evaluar_despacho(
        "shipments",
        "/shipments/45100010297",
        {"resource": "/shipments/45100010297"},
    ) == {
        "tipo": "envio",
        "shipping_id": "45100010297",
        "topic": "shipments",
    }


def test_dispatch_envio_sin_resource():
    assert meli_webhook_evaluar_despacho("shipments", "", {"topic": "shipments"})[
        "tipo"
    ] == "envio_sin_resource"


def test_dispatch_topic_no_manejado_sigue_intacto():
    plan = meli_webhook_evaluar_despacho("payments", "/payments/123", {"x": 1})
    assert plan["tipo"] == "topic_no_manejado"
