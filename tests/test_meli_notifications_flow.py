"""
Flujo lógico notificaciones MeLi (sin red ni Flask pesado).

`meli_webhook_evaluar_despacho` debe coincidir con /notifications en webhook_meli y routes.
"""

import json
from pathlib import Path

import pytest

from app.meli_webhook_incidents import registrar_meli_webhook_incidente
from app.meli_postventa_notif import _pack_id_desde_payload_mensaje
from app.meli_webhook_topics import meli_webhook_evaluar_despacho


@pytest.mark.parametrize(
    "topic,resource,actions,expected_tipo,extra",
    [
        ("questions", "/questions/999", None, "preventa", {"question_id": "999"}),
        (
            "marketplace_questions",
            "/marketplace/questions/139876",
            None,
            "preventa",
            {"question_id": "139876"},
        ),
        ("orders_v2", "/orders/2000123", None, "orden", {"order_id": "2000123"}),
        (
            "marketplace_messages",
            "/marketplace/messages/abc123def",
            ["created"],
            "postventa",
            {"resource": "/marketplace/messages/abc123def"},
        ),
        ("messages", "uuid-solo", ["created"], "postventa", {"resource": "uuid-solo"}),
        (
            "messages",
            "/messages/packs/55/sellers/1",
            ["created"],
            "postventa",
            {"resource": "/messages/packs/55/sellers/1"},
        ),
        (
            "messages",
            "/x",
            ["read"],
            "postventa_omitir_lectura",
            None,
        ),
        ("items", "/items/MCO1", None, "topic_no_manejado", None),
        ("questions", "", None, "preventa_sin_resource", None),
    ],
)
def test_evaluar_despacho(topic, resource, actions, expected_tipo, extra):
    data = {"topic": topic, "resource": resource}
    if actions is not None:
        data["actions"] = actions
    plan = meli_webhook_evaluar_despacho(topic, resource, data)
    assert plan["tipo"] == expected_tipo
    if extra:
        for k, v in extra.items():
            assert plan.get(k) == v


def test_evaluar_body_invalido():
    assert meli_webhook_evaluar_despacho("questions", "/q/1", None)["tipo"] == "invalido"


def test_incidents_jsonl_append(monkeypatch, tmp_path: Path):
    import app.meli_webhook_incidents as inc

    p = tmp_path / "t.jsonl"
    monkeypatch.setattr(inc, "INCIDENTS_PATH", str(p))
    registrar_meli_webhook_incidente("test_evento", foo=1)
    registrar_meli_webhook_incidente("test_evento", foo=2)
    lines = p.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    r0 = json.loads(lines[0])
    assert r0["event"] == "test_evento"
    assert r0["foo"] == 1


def test_contar_incidentes(monkeypatch, tmp_path: Path):
    import app.meli_webhook_incidents as inc

    p = tmp_path / "c.jsonl"
    monkeypatch.setattr(inc, "INCIDENTS_PATH", str(p))
    for _ in range(3):
        registrar_meli_webhook_incidente("alpha")
    registrar_meli_webhook_incidente("beta")
    c = inc.contar_incidentes_por_evento()
    assert c.get("alpha") == 3
    assert c.get("beta") == 1


def test_pack_id_desde_messages_post_sale_payload():
    payload = {
        "paging": None,
        "conversation_status": None,
        "messages": [
            {
                "id": "019e1851c1857f1ab04e3a6b41a7a8de",
                "message_resources": [
                    {"id": "2000012893180613", "name": "packs"},
                    {"id": "432439187", "name": "sellers"},
                ],
            }
        ],
    }

    assert _pack_id_desde_payload_mensaje(payload) == "2000012893180613"
