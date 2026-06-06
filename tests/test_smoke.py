"""Smoke tests sin credenciales externas (solo Flask y utilidades locales)."""

from __future__ import annotations

import json
from pathlib import Path

from flask import Flask


def test_script_manifest_compiles() -> None:
    from app.tools.script_audit import ejecutar_auditoria_dict

    result = ejecutar_auditoria_dict()

    assert "error" not in result
    failures = [item for item in result.get("detalle", []) if not item.get("ok")]
    assert failures == []
    assert result.get("detalle")


def test_file_tool_guard_restricts_mutations(monkeypatch) -> None:
    from app.tools import system_tools

    monkeypatch.setenv("AGENTE_RESTRICT_FILE_TOOLS", "1")
    monkeypatch.setenv("AGENTE_FILE_TOOL_PREFIXES", "scripts/,app/tools/,tests/")

    assert system_tools._guard_mutable_path("tests/test_smoke.py") is None
    blocked = system_tools._guard_mutable_path("app/routes.py")

    assert blocked is not None
    assert "Herramienta de archivos restringida" in blocked


def test_canales_cliente_flujo_sin_tools_api() -> None:
    from app.services.canales_config import es_canal_cliente, listar_canales

    assert es_canal_cliente("whatsapp")
    assert es_canal_cliente("web_chat")
    assert not es_canal_cliente("meli_preventa")

    by_id = {c["id"]: c for c in listar_canales()}
    assert by_id["whatsapp"]["flujo"] == "cliente_texto"
    assert by_id["whatsapp"]["es_cliente"] is True
    assert "ollama" in (by_id["whatsapp"].get("categorias_modelo") or [])
    assert by_id["web_chat"]["modelo_id"] == "gemma4:e4b"


def test_meli_webhook_dispatch_contracts() -> None:
    from app.meli_webhook_topics import meli_webhook_evaluar_despacho

    assert meli_webhook_evaluar_despacho(
        "questions",
        "/questions/123",
        {"topic": "questions"},
    ) == {"tipo": "preventa", "question_id": "123", "topic": "questions"}

    assert meli_webhook_evaluar_despacho(
        "orders_v2",
        "/orders/456",
        {"topic": "orders_v2"},
    ) == {"tipo": "orden", "order_id": "456", "topic": "orders_v2"}

    assert meli_webhook_evaluar_despacho(
        "messages",
        "/messages/packs/789",
        {"topic": "messages", "actions": ["read"]},
    )["tipo"] == "postventa_omitir_lectura"

    assert meli_webhook_evaluar_despacho(
        "messages",
        "/messages/packs/789",
        {"topic": "messages", "actions": ["message_created"]},
    ) == {
        "tipo": "postventa",
        "resource": "/messages/packs/789",
        "topic": "messages",
    }

    assert meli_webhook_evaluar_despacho(
        "messages",
        "/messages/packs/789",
        {"topic": "messages", "actions": ["read", "delivered"]},
    )["tipo"] == "postventa_omitir_lectura"

    assert meli_webhook_evaluar_despacho(
        "messages",
        "/messages/packs/789",
        {"topic": "messages", "actions": ["created"]},
    ) == {
        "tipo": "postventa",
        "resource": "/messages/packs/789",
        "topic": "messages",
    }


def test_agentic_docs_exist() -> None:
    root = Path(__file__).resolve().parents[1]
    expected = [
        "docs/agentic/INDEX.md",
        "docs/agentic/ORCHESTRATION.md",
        "docs/agentic/MEMORY.md",
        "docs/agentic/SKILLS.md",
        "docs/agentic/CHECKLIST.md",
        "docs/agentic/CONTRACTS.md",
        "docs/agentic/DECISIONS.md",
        "docs/agentic/ECOSYSTEM.md",
        "docs/agentic/learned_context.md",
        "docs/agentic/modules/webhook-meli.md",
        "docs/agentic/modules/whatsapp-routes.md",
        "docs/agentic/modules/core-tools.md",
        "docs/agentic/modules/sync-stock.md",
        "docs/agentic/modules/desktop-panel.md",
        "docs/agentic/modules/ops-systemd.md",
        "docs/agentic/modules/backend-qa.md",
        "docs/agentic/modules/guardian-review.md",
    ]

    missing = [path for path in expected if not (root / path).is_file()]
    assert missing == []


def test_parse_adjuntos_chat_accepts_png():
    import base64

    from app.core import _parse_adjuntos_chat

    b64 = base64.b64encode(b"\x00\x01\x02" * 20).decode("ascii")
    out = _parse_adjuntos_chat([{"media_type": "image/png", "data_base64": b64}])
    assert len(out) == 1
    assert out[0][0] == "image/png"
    assert len(out[0][1]) == 60


def test_parse_adjuntos_chat_rejects_bad_mime():
    import base64

    from app.core import _parse_adjuntos_chat

    b64 = base64.b64encode(b"x").decode("ascii")
    try:
        _parse_adjuntos_chat([{"media_type": "video/mp4", "data_base64": b64}])
    except ValueError as e:
        assert "no soportado" in str(e).lower() or "soportado" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_status_includes_request_id():
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as client:
        r = client.get("/status")
        assert r.status_code == 200
        data = r.get_json()
        assert data.get("estado") == "activo"
        assert data.get("request_id")


def test_panel_logs_requires_auth():
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        assert c.get("/api/panel/logs").status_code == 401


def test_grupo_inventario_jid_strips_inline_comment(monkeypatch):
    monkeypatch.setenv(
        "GRUPO_INVENTARIO_WA",
        "120363407538342427@g.us  # Sincronizacion_Inventario",
    )
    from app.utils import jid_grupo_inventario_wa

    assert jid_grupo_inventario_wa() == "120363407538342427@g.us"


def test_panel_logs_get_and_clear(monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", "secretpanel")
    from app.panel_activity import clear_lines, log_line
    from app.routes import register_routes

    clear_lines()
    log_line("linea_prueba_smoke")
    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer secretpanel"}
    with app.test_client() as c:
        r = c.get("/api/panel/logs", headers=hdr)
        assert r.status_code == 200
        lines = r.get_json().get("lines", [])
        assert any("linea_prueba_smoke" in ln for ln in lines)
        assert c.delete("/api/panel/logs", headers=hdr).status_code == 200
        r2 = c.get("/api/panel/logs", headers=hdr)
        assert r2.get_json().get("lines") == []


def test_web_chat_accepts_tickets_session_bearer(monkeypatch):
    """Operarios con login Google usan JWT de tickets, no CHAT_API_TOKEN."""
    monkeypatch.setenv("CHAT_API_TOKEN", "solo-admin-chat")
    fake_user = {
        "id": 99,
        "nombre": "Operario Test",
        "rol": {"nivel": 2},
        "permisos_secciones": {"webchat": True, "pedidos": True},
    }

    def _fake_by_token(tok):
        return fake_user if tok == "jwt-operario-test" else None

    monkeypatch.setattr(
        "app.services.tickets_db.get_usuario_by_token",
        _fake_by_token,
    )

    def _fake_payload(limit=40, only_unreviewed=False):
        return {
            "summary": {
                "today_interactions": 1,
                "unreviewed_count": 0,
                "active_last_24h": 1,
            },
            "sessions": [],
            "total_sessions": 0,
        }

    monkeypatch.setattr(
        "app.web_chat_activity.get_panel_payload",
        _fake_payload,
    )

    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer jwt-operario-test"}
    with app.test_client() as c:
        r = c.get("/api/web-chat", headers=hdr)
        assert r.status_code == 200
        assert r.get_json().get("total_sessions") == 0
        r_bad = c.get("/api/web-chat", headers={"Authorization": "Bearer invalido"})
        assert r_bad.status_code == 401


def test_wa_jid_lid_y_modo_relacionado() -> None:
    from app.services import wa_jid as wj

    wj.registrar_alias_lid("73031707820119@lid", "573182432463@c.us")
    assert wj.jid_canonico("73031707820119@lid") == "573182432463@c.us"
    assert "73031707820119@lid" in wj.jids_relacionados("573182432463@c.us")
    modos = {
        "numeros_en_humano": [],
        "numeros_silenciados": [],
        "timestamps": {},
        "bot_auto_pausados": {},
    }
    wj.aplicar_modo_en_relacionados(modos, "73031707820119@lid", agregar_humano=True)
    assert wj.en_lista_modo("573182432463@c.us", modos["numeros_en_humano"])
    assert wj.modo_para_jid("73031707820119@lid", modos["numeros_en_humano"], []) == "humano"


def test_normalizar_numero_wa_acepta_lid() -> None:
    from app.routes import _normalizar_numero_wa

    assert _normalizar_numero_wa("73031707820119@lid") == "73031707820119@lid"
    assert _normalizar_numero_wa("3182432463") == "573182432463@c.us"


def test_web_chat_respuestas_rapidas_crud(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok-chat")
    data_file = tmp_path / "web_chat_respuestas_rapidas.json"
    monkeypatch.setattr(
        "app.services.web_chat_respuestas_rapidas._DATA_PATH",
        str(data_file),
    )

    fake_user = {
        "id": 10,
        "nombre": "Jenniffer Garcia",
        "rol": {"nivel": 1},
        "permisos_secciones": {"webchat": True},
    }

    def _fake_by_token(tok):
        return fake_user if tok == "jwt-jenniffer" else None

    monkeypatch.setattr(
        "app.services.tickets_db.get_usuario_by_token",
        _fake_by_token,
    )

    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer jwt-jenniffer", "Content-Type": "application/json"}

    with app.test_client() as c:
        r0 = c.get("/api/web-chat/respuestas-rapidas", headers=hdr)
        assert r0.status_code == 200
        assert r0.get_json()["mine"] == []

        r1 = c.post(
            "/api/web-chat/respuestas-rapidas",
            headers=hdr,
            json={
                "titulo": "Saludo Jenniffer",
                "texto": (
                    "Hola Buenas tardes, Soy Jenniffer su asesora comercial. "
                    "Cuente en que le puedo servir veci."
                ),
            },
        )
        assert r1.status_code == 200
        item_id = r1.get_json()["item"]["id"]

        r2 = c.get("/api/web-chat/respuestas-rapidas", headers=hdr)
        assert len(r2.get_json()["mine"]) == 1

        r3 = c.delete(
            f"/api/web-chat/respuestas-rapidas/{item_id}",
            headers=hdr,
        )
        assert r3.status_code == 200
        assert c.get("/api/web-chat/respuestas-rapidas", headers=hdr).get_json()["mine"] == []


def test_bot_bridge_endpoints_require_auth():
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        assert c.get("/api/bot/bridge/status").status_code == 401
        assert c.post("/api/bot/bridge/desvincular").status_code == 401


def test_bot_bridge_status_with_mock_bridge(monkeypatch):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok_bridge")
    import subprocess

    def _fake_systemctl(cmd, **kwargs):
        class _R:
            stdout = "active\n"
            returncode = 0

        return _R()

    monkeypatch.setattr(subprocess, "run", _fake_systemctl)

    class _Resp:
        def __init__(self, payload, code=200):
            self.status_code = code
            self._payload = payload

        def json(self):
            return self._payload

    def _fake_get(url, **kwargs):
        if url.endswith("/session/status"):
            return _Resp(
                {
                    "waSesionOperativa": False,
                    "sistemaListo": False,
                    "qrPendiente": True,
                    "numero": None,
                    "pushname": None,
                }
            )
        if url.endswith("/session/qr"):
            return _Resp({"qrRaw": "2@TESTQR", "qrGeneradoEn": "2026-01-01T12:00:00"})
        return _Resp({}, 404)

    import requests as req_mod

    monkeypatch.setattr(req_mod, "get", _fake_get)

    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok_bridge"}
    with app.test_client() as c:
        r = c.get("/api/bot/bridge/status", headers=hdr)
        assert r.status_code == 200
        data = r.get_json()
        assert data["bridge_activo"] is True
        assert data["sesion"]["qr_pendiente"] is True
        assert data["sesion"]["qr_data_url"] and data["sesion"]["qr_data_url"].startswith(
            "data:image/png;base64,"
        )


def test_auditar_scripts_runs():
    from app.tools.script_audit import auditar_scripts, ejecutar_auditoria_dict

    out = auditar_scripts("")
    assert "detalle" in out
    assert "resumen" in out
    data = ejecutar_auditoria_dict("")
    assert "error" not in data
    assert all(r.get("ok") for r in data.get("detalle", []))


def test_file_tool_guard_dev_unrestricted():
    """Sin AGENTE_RESTRICT_FILE_TOOLS, rutas bajo repo no bloquean por prefijo."""
    import os

    from app.tools import system_tools as st

    old = os.environ.pop("AGENTE_RESTRICT_FILE_TOOLS", None)
    old_flask = os.environ.pop("FLASK_ENV", None)
    try:
        assert st._guard_mutable_path("app/core.py") is None
    finally:
        if old is not None:
            os.environ["AGENTE_RESTRICT_FILE_TOOLS"] = old
        if old_flask is not None:
            os.environ["FLASK_ENV"] = old_flask


def test_api_5s_workspace_requires_auth():
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        assert c.get("/api/5s/workspace").status_code == 401
        assert c.get("/app/api/5s/workspace").status_code == 401


def test_api_5s_workspace_post_not_allowed():
    """POST no está permitido en workspace (solo GET/PUT): Flask responde 405."""
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        assert c.post("/api/5s/workspace").status_code == 405
        assert c.post("/app/api/5s/workspace").status_code == 405


def test_api_5s_project_delete_via_post(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s", "Content-Type": "application/json"}
    body = {
        "name": "Borrar",
        "tags": [],
        "preflight": [],
        "tasks": ["x"],
        "ritual_notes": "",
        "also_save_template": False,
    }
    with app.test_client() as c:
        r = c.post("/api/5s/project/routine", headers=hdr, json=body)
        assert r.status_code == 200
        pid = r.get_json()["project"]["id"]
        r2 = c.post(f"/api/5s/project/{pid}/delete", headers=hdr, json={})
        assert r2.status_code == 200
        assert all(p["id"] != pid for p in r2.get_json()["workspace"]["projects"])
        r3 = c.post(f"/app/api/5s/project/{pid}/delete", headers=hdr, json={})
        assert r3.status_code == 404


def test_app_api_5s_routine_post(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s", "Content-Type": "application/json"}
    body = {
        "name": "Via app prefix",
        "tags": ["cocina"],
        "preflight": [],
        "tasks": ["Un paso"],
        "ritual_notes": "",
        "also_save_template": False,
    }
    with app.test_client() as c:
        r = c.post("/app/api/5s/project/routine", headers=hdr, json=body)
        assert r.status_code == 200
        assert r.get_json()["project"]["name"] == "Via app prefix"


def test_serve_spa_rejects_post():
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        # POST must not fall through to index.html (evita 405 confundido con SPA).
        assert c.post("/app", follow_redirects=False).status_code == 405


def test_api_5s_workspace_get_put_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s"}
    with app.test_client() as c:
        r = c.get("/api/5s/workspace", headers=hdr)
        assert r.status_code == 200
        ws = r.get_json()
        assert "categories" in ws and len(ws["categories"]) >= 1
        ws["categories"][0]["name"] = "CatTest"
        r2 = c.put("/api/5s/workspace", headers=hdr, json=ws)
        assert r2.status_code == 200
        assert r2.get_json()["categories"][0]["name"] == "CatTest"


def test_asistente_5s_ollama_mock(monkeypatch):
    from unittest import mock

    monkeypatch.setenv("AGENTE_5S_LLM", "ollama")

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"message": {"role": "assistant", "content": "  Paso 1: ordená el banco.  "}}

    with mock.patch("app.services.cinco_s.requests.post", return_value=FakeResp()):
        from app.services import cinco_s

        out = cinco_s.asistente_5s_detailed("¿Qué hago?", {"proyecto": "Test"})
    assert out["provider"] == "ollama"
    assert "Paso 1" in out["reply"]


def test_api_5s_project_delete(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s", "Content-Type": "application/json"}
    with app.test_client() as c:
        ws = c.get("/api/5s/workspace", headers=hdr).get_json()
        tpl = ws["templates"][0]["id"]
        pid = c.post("/api/5s/project", headers=hdr, json={"template_id": tpl, "name": "Borrar"}).get_json()["project"][
            "id"
        ]
        r = c.delete(f"/api/5s/project/{pid}", headers=hdr)
        assert r.status_code == 200
        assert not any(p.get("id") == pid for p in r.get_json()["workspace"]["projects"])


def test_api_5s_audio_get_rejects_bad_name():
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        assert c.get("/api/5s/audio/nothex.wav").status_code == 404
        assert c.get("/api/5s/audio/" + "a" * 32 + ".wav").status_code == 404


def test_api_5s_template_delete(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s", "Content-Type": "application/json"}
    with app.test_client() as c:
        ws = c.get("/api/5s/workspace", headers=hdr).get_json()
        tid = ws["templates"][0]["id"]
        r = c.delete(f"/api/5s/template/{tid}", headers=hdr)
        assert r.status_code == 200
        ws2 = r.get_json()["workspace"]
        assert not any(t.get("id") == tid for t in ws2.get("templates", []))


def test_api_5s_routine_create_with_supplies(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s", "Content-Type": "application/json"}
    body = {
        "name": "Desayuno test",
        "tags": ["cocina", "alimentacion"],
        "preflight": ["Mesa limpia"],
        "tasks": ["Servir"],
        "ritual_notes": "",
        "also_save_template": False,
        "supplies": [
            {
                "name": "Granola",
                "prep_action": "Hornear tanda",
                "initial_qty": 1,
                "reorder_below": 0.3,
                "priority": 2,
                "unit": "g",
            },
            {
                "name": "Kefir",
                "prep_action": "Elaborar fermentación",
                "initial_qty": 0.5,
                "reorder_below": 0.2,
                "priority": 1,
                "unit": "ml",
            },
        ],
    }
    with app.test_client() as c:
        r = c.post("/api/5s/project/routine", headers=hdr, json=body)
        assert r.status_code == 200
        proj = r.get_json()["project"]
        assert len(proj["pantry"]) == 2
        assert proj["pantry"][0]["unit"] == "g"
        assert proj["pantry"][1]["unit"] == "ml"
        assert any(t.get("scope") == "prep" for t in proj["tasks"])
        assert any(t.get("scope") == "main" for t in proj["tasks"])
        assert len(proj["preflight"]) >= 3
        r2 = c.post("/api/5s/routine", headers=hdr, json=body | {"name": "Otro"})
        assert r2.status_code == 200


def test_api_5s_routine_create(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s", "Content-Type": "application/json"}
    body = {
        "name": "Rutina guiada test",
        "tags": ["cocina"],
        "preflight": ["Mesón limpio"],
        "tasks": ["Paso uno", "Paso dos"],
        "ritual_notes": "Cerrar con checklist",
        "also_save_template": True,
    }
    with app.test_client() as c:
        r = c.post("/api/5s/routine", headers=hdr, json=body)
        assert r.status_code == 200
        out = r.get_json()
        assert out["project"]["name"] == "Rutina guiada test"
        assert out["project"]["tags"] == ["cocina"]
        tpls = out["workspace"]["templates"]
        assert any("Patrón:" in (t.get("name") or "") for t in tpls)


def test_suggest_routine_json_mock(monkeypatch):
    from unittest import mock

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "message": {
                    "content": '{"tags":["cocina","hogar"],"preflight":["Lavar manos"],"tasks":["A","B","C"],'
                    '"ritual_notes":"Siempre igual"}'
                }
            }

    with mock.patch("app.services.cinco_s.requests.post", return_value=FakeResp()):
        from app.services import cinco_s

        sug, err = cinco_s.suggest_routine_json("preparar almuerzo")
    assert not err
    assert sug and len(sug["tasks"]) == 3
    assert "cocina" in sug["tags"]


def test_api_5s_project_create(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "tok5s")
    from app.services import cinco_s as m5

    monkeypatch.setattr(m5, "WORKSPACE_PATH", str(tmp_path / "ws.json"))
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    hdr = {"Authorization": "Bearer tok5s", "Content-Type": "application/json"}
    with app.test_client() as c:
        ws = c.get("/api/5s/workspace", headers=hdr).get_json()
        tpl = ws["templates"][0]["id"]
        cat_alim = next(c["id"] for c in ws["categories"] if "aliment" in c["name"].lower())
        r = c.post(
            "/api/5s/project",
            headers=hdr,
            json={"template_id": tpl, "name": "P1", "category_id": cat_alim},
        )
        assert r.status_code == 200
        body = r.get_json()
        assert body["project"]["name"] == "P1"
        assert body["project"]["category_id"] == cat_alim
        assert any(p["name"] == "P1" for p in body["workspace"]["projects"])


def test_file_tool_guard_restricted_blocks_core():
    import os

    from app.tools import system_tools as st

    old = os.environ.get("AGENTE_RESTRICT_FILE_TOOLS")
    old_flask = os.environ.get("FLASK_ENV")
    try:
        os.environ["AGENTE_RESTRICT_FILE_TOOLS"] = "1"
        os.environ.pop("FLASK_ENV", None)
        msg = st._guard_mutable_path("app/core.py")
        assert msg is not None
        assert "restringida" in msg
    finally:
        if old is None:
            os.environ.pop("AGENTE_RESTRICT_FILE_TOOLS", None)
        else:
            os.environ["AGENTE_RESTRICT_FILE_TOOLS"] = old
        if old_flask is not None:
            os.environ["FLASK_ENV"] = old_flask


def _insert_web_order_for_siigo_test(
    db_path: Path, *, reference: str = "MCKG-ABC12336E", items_json: dict | None = None
) -> None:
    import json
    import sqlite3

    from app.tools import web_pedidos as wp

    wp.migrate_orders_table()
    data = items_json or {
        "items": [
            {"name": "Acido Lactico", "ref": "C-ACDLAC85P30ML", "price": 10000, "qty": 2}
        ],
        "cedula": "1012381852",
        "address": "Carrera 107 #58-42 sur",
        "shipping": 8500,
        "billing": {
            "name": "Angie Silva",
            "nit": "1012381852",
            "address": "Carrera 107 #58-42 sur",
            "email": "cliente@example.com",
        },
    }
    con = sqlite3.connect(db_path)
    con.execute(
        """INSERT INTO orders
           (reference, buyer_name, buyer_email, buyer_phone, buyer_city,
            items_json, total, status, payu_ref, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            reference,
            "Angie Silva",
            "cliente@example.com",
            "3102023819",
            "Bogota",
            json.dumps(data),
            28500,
            "approved",
            "156872784393",
            "2026-05-04T14:00:00",
        ),
    )
    con.commit()
    con.close()


def _siigo_invoice_row_for_test(db_path: Path, reference: str = "MCKG-ABC12336E"):
    import sqlite3

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT * FROM orders WHERE reference = ?",
        (reference,),
    ).fetchone()
    con.close()
    assert row is not None
    return row


def test_emitir_factura_siigo_pedido_web_success(monkeypatch, tmp_path):
    from app.services import siigo
    from app.tools import web_pedidos as wp

    db_path = tmp_path / "orders.db"
    monkeypatch.setattr(wp, "ORDERS_DB", db_path)
    monkeypatch.delenv("WEB_SIIGO_SHIPPING_CODE", raising=False)
    monkeypatch.delenv("WEB_SIIGO_SHIPPING_CODE_8500", raising=False)
    _insert_web_order_for_siigo_test(db_path)

    monkeypatch.setattr(siigo, "buscar_producto_siigo_por_sku", lambda sku: {"sku": sku})
    captured = {}

    def fake_crear_factura_venta_siigo(**kwargs):
        captured.update(kwargs)
        return {
            "ok": True,
            "invoice_id": "inv-123",
            "number": "FE-123",
            "status": "Accepted",
            "cufe": "CUFE123",
            "stamp": {"status": "Accepted", "cufe": "CUFE123"},
            "url": "https://siigo.test/inv-123",
        }

    monkeypatch.setattr(siigo, "crear_factura_venta_siigo", fake_crear_factura_venta_siigo)

    ok, msg = wp.emitir_factura_siigo_pedido_web("MCKG-ABC12336E")

    assert ok is True
    assert "FE-123" in msg
    assert captured["purchase_order"] == "MCKG-ABC12336E"
    assert captured["identificacion"] == "1012381852"
    assert captured["total"] == 28500
    assert [p["codigo"] for p in captured["productos"]] == [
        "C-ACDLAC85P30ML",
        "WEB-ENVIO-8500",
    ]
    row = _siigo_invoice_row_for_test(db_path)
    assert row["siigo_invoice_id"] == "inv-123"
    assert row["siigo_invoice_number"] == "FE-123"
    assert row["siigo_invoice_status"] == "Accepted"
    assert row["siigo_invoice_cufe"] == "CUFE123"
    assert row["siigo_invoice_emitted_at"]


def test_emitir_factura_siigo_pedido_web_no_duplica(monkeypatch, tmp_path):
    import sqlite3

    from app.services import siigo
    from app.tools import web_pedidos as wp

    db_path = tmp_path / "orders.db"
    monkeypatch.setattr(wp, "ORDERS_DB", db_path)
    _insert_web_order_for_siigo_test(db_path)
    con = sqlite3.connect(db_path)
    con.execute(
        """UPDATE orders
           SET siigo_invoice_id = 'inv-prev',
               siigo_invoice_number = 'FE-PREV',
               siigo_invoice_status = 'Accepted'
           WHERE reference = 'MCKG-ABC12336E'"""
    )
    con.commit()
    con.close()

    def fail_if_called(**_kwargs):
        raise AssertionError("No debe crear otra factura")

    monkeypatch.setattr(siigo, "crear_factura_venta_siigo", fail_if_called)

    ok, msg = wp.emitir_factura_siigo_pedido_web("MCKG-ABC12336E")

    assert ok is True
    assert "ya tiene factura" in msg
    assert "FE-PREV" in msg


def test_emitir_factura_siigo_pedido_web_rechaza_envio_sin_codigo(monkeypatch, tmp_path):
    from app.services import siigo
    from app.tools import web_pedidos as wp

    db_path = tmp_path / "orders.db"
    monkeypatch.setattr(wp, "ORDERS_DB", db_path)
    monkeypatch.delenv("WEB_SIIGO_SHIPPING_CODE", raising=False)
    monkeypatch.delenv("WEB_SIIGO_SHIPPING_CODE_8500", raising=False)
    _insert_web_order_for_siigo_test(db_path)

    def fake_buscar_producto(sku):
        if sku == "WEB-ENVIO-8500":
            return None
        return {"sku": sku}

    monkeypatch.setattr(siigo, "buscar_producto_siigo_por_sku", fake_buscar_producto)

    def fail_if_called(**_kwargs):
        raise AssertionError("No debe crear factura sin SKU de envio")

    monkeypatch.setattr(siigo, "crear_factura_venta_siigo", fail_if_called)

    ok, msg = wp.emitir_factura_siigo_pedido_web("MCKG-ABC12336E")

    assert ok is False
    assert "WEB-ENVIO-8500" in msg
    row = _siigo_invoice_row_for_test(db_path)
    assert row["siigo_invoice_status"] == "error"
    assert "WEB-ENVIO-8500" in row["siigo_invoice_error"]


def test_marcar_solicitud_facturacion_reintenta(monkeypatch, tmp_path):
    import sqlite3

    from app.services import siigo
    from app.tools import web_pedidos as wp

    db_path = tmp_path / "orders.db"
    monkeypatch.setattr(wp, "ORDERS_DB", db_path)
    monkeypatch.delenv("WEB_SIIGO_SHIPPING_CODE", raising=False)
    monkeypatch.delenv("WEB_SIIGO_SHIPPING_CODE_8500", raising=False)
    _insert_web_order_for_siigo_test(db_path)
    con = sqlite3.connect(db_path)
    con.execute(
        """UPDATE orders
           SET siigo_invoice_status = 'error',
               siigo_invoice_error = 'fallo anterior'
           WHERE reference = 'MCKG-ABC12336E'"""
    )
    con.commit()
    con.close()

    monkeypatch.setattr(siigo, "buscar_producto_siigo_por_sku", lambda sku: {"sku": sku})
    monkeypatch.setattr(
        siigo,
        "crear_factura_venta_siigo",
        lambda **_kwargs: {
            "ok": True,
            "invoice_id": "inv-retry",
            "number": "FE-RETRY",
            "status": "Accepted",
            "cufe": "CUFERETRY",
            "stamp": {"status": "Accepted", "cufe": "CUFERETRY"},
            "url": "https://siigo.test/inv-retry",
        },
    )

    ok, msg = wp.marcar_solicitud_facturacion("MCKG-ABC12336E")

    assert ok is True
    assert "FE-RETRY" in msg
    row = _siigo_invoice_row_for_test(db_path)
    assert row["invoice_requested_at"]
    assert row["siigo_invoice_error"] is None


def test_web_chat_escalacion_pago_pedido(tmp_path, monkeypatch) -> None:
    from app import web_chat_intents as wci

    modos = tmp_path / "modos_atencion.json"
    modos.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(wci, "_MODOS_PATH", str(modos))

    assert wci.clasificar_escalacion_web("Necesito concluir el pago de un pedido") == "pago_pedido"
    assert wci.clasificar_escalacion_web("¿Me envían el link de pago?") == "pago_pedido"
    assert wci.clasificar_escalacion_web("Quiero hablar con un asesor humano") == "humano"
    assert wci.clasificar_escalacion_web("¿Cuánto cuesta la urea 250g?") is None

    msg = wci.manejar_escalacion_web(
        session_id="web-test-escalacion",
        user_message="Necesito los datos de cuenta para pagar",
        historial=[],
    )
    assert msg is not None
    assert "wa.me" in msg
    assert "comprobante" in msg.lower()


def test_postventa_pendientes_api_dedup(monkeypatch, tmp_path) -> None:
    import app.routes as routes

    state_path = tmp_path / "mensajes_posventa_pendientes.json"
    entrada = {
        "pack_id": "2000012345678901",
        "codigo": "8901",
        "comprador": "Juan Test",
        "texto": "¿Cuándo llega mi pedido?",
        "productos": "  • Jabón\n  • Urea",
        "timestamp": "2026-05-27T10:00:00",
        "msg_id": "msg-abc",
    }
    state_path.write_text(
        json.dumps(
            {
                "pendientes": {
                    "2000012345678901": entrada,
                    "8901": entrada,
                },
                "procesados": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(routes, "_POSVENTA_STATE_PATH", str(state_path))
    items = routes._listar_postventa_pendientes_api()
    assert len(items) == 1
    assert items[0]["codigo"] == "8901"
    assert items[0]["pack_id"] == "2000012345678901"
    assert items[0]["productos"] == ["Jabón", "Urea"]


def test_postventa_pendiente_visible_aunque_msg_en_procesados(
    monkeypatch, tmp_path
) -> None:
    """Tras alertar WA el msg_id va a procesados; la cola debe seguir resolviendo el código."""
    import app.routes as routes

    state_path = tmp_path / "mensajes_posventa_pendientes.json"
    entrada = {
        "pack_id": "2000016648492174",
        "codigo": "2174",
        "comprador": "Comprador Test",
        "texto": "¿Cuándo llega?",
        "msg_id": "msg-postventa-1",
        "timestamp": "2026-05-28T16:53:00",
    }
    state_path.write_text(
        json.dumps(
            {
                "pendientes": {"2174": entrada, "2000016648492174": entrada},
                "procesados": ["msg-postventa-1"],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(routes, "_POSVENTA_STATE_PATH", str(state_path))
    found, clave = routes._resolver_entrada_postventa("2174")
    assert found is not None
    assert found["pack_id"] == "2000016648492174"
    assert clave in ("2174", "2000016648492174")


def test_postventa_resolver_sufijo_meli_fallback(monkeypatch, tmp_path) -> None:
    import app.routes as routes

    state_path = tmp_path / "mensajes_posventa_pendientes.json"
    state_path.write_text(
        json.dumps({"pendientes": {}, "procesados": []}),
        encoding="utf-8",
    )
    monkeypatch.setattr(routes, "_POSVENTA_STATE_PATH", str(state_path))
    monkeypatch.setattr(
        routes,
        "_resolver_pack_por_sufijo_en_meli",
        lambda c: {
            "pack_id": "2000016648492174",
            "codigo": "2174",
            "comprador": "Comprador Test",
            "from_id": "324970252",
        }
        if c == "2174"
        else None,
    )
    found, _ = routes._resolver_entrada_postventa("2174")
    assert found is not None
    assert found["pack_id"] == "2000016648492174"


def test_wa_chats_ingest_y_revoke(tmp_path, monkeypatch) -> None:
    db = tmp_path / "wa_chats.db"
    monkeypatch.setenv("WA_CHATS_DB", str(db))
    import importlib

    import app.services.wa_chats as wc

    importlib.reload(wc)

    stats = wc.ingestar_desde_whatsapp(
        [
            {
                "wa_id": "true_573001234567@c.us_ABC",
                "jid": "573001234567@c.us",
                "ts": 1_700_000_000,
                "from_me": False,
                "texto": "Hola desde cliente",
            },
            {
                "wa_id": "true_573001234567@c.us_DEF",
                "jid": "573001234567@c.us",
                "ts": 1_700_000_100,
                "from_me": True,
                "texto": "Respuesta desde celular",
                "enviado_por": "humano",
            },
        ]
    )
    assert stats["insertados"] == 2
    msgs = wc.listar_mensajes("573001234567@c.us", limit=10)
    assert len(msgs) == 2
    assert msgs[1]["texto"] == "Respuesta desde celular"
    assert msgs[1]["enviado_por"] == "humano"

    n = wc.marcar_eliminado_por_wa_id("true_573001234567@c.us_ABC")
    assert n == 1
    msgs2 = wc.listar_mensajes("573001234567@c.us", limit=10)
    assert len(msgs2) == 1
    assert msgs2[0]["texto"] == "Respuesta desde celular"


def test_web_chat_cotizacion_producto_no_escala_pago() -> None:
    from app.web_chat_intents import clasificar_escalacion_web

    msg = (
        "me interesaria la cotización de cada uno de ellos por presentación de 1kg "
        "ya que trabajamos con productos con alto grado de pureza"
    )
    assert clasificar_escalacion_web(msg) is None


def test_web_chat_cotizacion_formal_si_escala() -> None:
    from app.web_chat_intents import clasificar_escalacion_web

    assert clasificar_escalacion_web("necesito el link de pago de mi cotización") == "pago_pedido"


def test_web_chat_documentos_detecta_coa() -> None:
    from app.web_chat_documentos import (
        extraer_nombres_productos_documento,
        mensaje_pide_documentacion_web,
    )

    msg = (
        "Buenas noches, podria facilitarme el certificado COA y la ficha de seguridad "
        "de la taurina e inulina"
    )
    assert mensaje_pide_documentacion_web(msg)
    nombres = extraer_nombres_productos_documento(msg)
    assert any("taurina" in n.lower() for n in nombres)
    assert any("inulina" in n.lower() for n in nombres)


def test_web_chat_numero_whatsapp_directo() -> None:
    from app.web_chat_intents import manejar_pregunta_contacto_web

    r = manejar_pregunta_contacto_web("a que numero de whatsapp")
    assert r is not None
    assert "wa.me" in r
    assert "319" in r


def test_wa_chats_media_path_y_humano_marca_leido(tmp_path, monkeypatch) -> None:
    db = tmp_path / "wa_chats.db"
    monkeypatch.setenv("WA_CHATS_DB", str(db))
    import importlib
    import app.services.wa_chats as wc

    importlib.reload(wc)
    wc.guardar(
        "573001111111@c.us",
        "entrada",
        "hola",
        enviado_por="cliente",
        wa_id="in1",
    )
    assert wc.total_no_leidos() == 1
    wc.guardar(
        "573001111111@c.us",
        "salida",
        "respuesta operador",
        enviado_por="humano",
        wa_id="out1",
    )
    assert wc.total_no_leidos() == 0
    rel = wc.normalizar_media_path_panel("/home/x/mi-agente/comprobantes/foto.jpg")
    assert rel == "comprobantes/foto.jpg"


def test_web_chat_lista_tras_pedir_fichas() -> None:
    from app.web_chat_documentos import extraer_nombres_productos_documento, manejar_documentos_web

    hist = "necesito la ficha técnica de varios productos para formulación"
    lista = "taurina, inulina, niacinamida, papaina, alantoina y ornitina"
    assert len(extraer_nombres_productos_documento(lista)) >= 3
    # Drive puede no estar en CI; solo verificamos que el handler no devuelve None por clasificación
    out = manejar_documentos_web(user_message=lista, historial_texto=hist)
    assert out is not None
    assert "correo" in out.lower() or "documentación" in out.lower() or "Ficha" in out


def test_web_chat_saludo_no_dispara_documentos() -> None:
    from app.core import _contexto_historial_usuario_web, _mensaje_parece_consulta_tecnica_web
    from app.web_chat_documentos import manejar_documentos_web

    hist = [
        {"role": "user", "content": "Usuario_web-x: Buenos días"},
        {
            "role": "assistant",
            "content": (
                "Hola veci, puede consultarme precios, disponibilidad, ficha técnica o uso."
            ),
        },
    ]
    msg = (
        "Me gustaría saber si ácido hialurónico o vitamina c son adecuados "
        "para usarse directamente en la piel"
    )
    assert _mensaje_parece_consulta_tecnica_web(msg)
    hu = _contexto_historial_usuario_web(hist)
    assert manejar_documentos_web(user_message=msg, historial_usuario=hu) is None


def test_web_chat_invima_sin_basura_historial() -> None:
    from app.core import _contexto_historial_usuario_web
    from app.web_chat_documentos import manejar_documentos_web

    hist = [
        {
            "role": "user",
            "content": "Usuario_web-abc: Necesito el registro invima del citrato de calcio",
        },
        {"role": "assistant", "content": "Veci, no localicé el PDF en este momento."},
    ]
    out = manejar_documentos_web(
        user_message="Necesito ver un registro invima.",
        historial_usuario=_contexto_historial_usuario_web(hist),
    )
    assert out is not None
    assert "Usuario_web" not in out
    assert out.lower().count("no localicé el pdf") <= 1
    assert "materias primas" in out.lower() or "marco regulatorio" in out.lower()


def test_web_chat_nota_regulatoria_invima() -> None:
    from app.web_chat_mensajes import nota_regulatoria_materias_primas_invima

    txt = nota_regulatoria_materias_primas_invima()
    assert "materias primas" in txt.lower()
    assert "ficha técnica" in txt.lower()
    assert "coa" in txt.lower()


def test_web_chat_lote_no_es_catalogo() -> None:
    from app.core import _mensaje_parece_consulta_catalogo_web

    msg = "Holaa para preguntar cuando vence el conservante sharomix 705 de Lot. 042026"
    assert _mensaje_parece_consulta_catalogo_web(msg) is False


def test_web_chat_fallback_queja_precios() -> None:
    import importlib.util
    from pathlib import Path

    site_path = Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site" / "website.py"
    spec = importlib.util.spec_from_file_location("website_chat_test", site_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = mod._chat_fallback_contextual("Estani muy altos los precios para elaborar un producto")
    assert out is not None
    assert "PARAFINA" not in out
    assert "wa.me" in out


def test_coa_generacion_docx() -> None:
    from app.services.coa import PLANTILLA_DEFAULT, generar_desde_datos, plantilla_datos_ejemplo

    assert PLANTILLA_DEFAULT.is_file()
    datos = plantilla_datos_ejemplo()
    datos["titulo"] = "SMOKE COA TEST"
    res = generar_desde_datos(datos, generar_pdf=False, subir_drive=False)
    assert res["ok"] is True
    assert res["docx_nombre"].startswith("COA-")


def test_sds_generacion_docx() -> None:
    from app.services.sds import PLANTILLA_DEFAULT, PLANTILLA_REF_PDF, generar_desde_datos, plantilla_datos_ejemplo

    assert PLANTILLA_DEFAULT.is_file()
    assert PLANTILLA_REF_PDF.is_file()
    datos = plantilla_datos_ejemplo()
    datos["titulo"] = "SMOKE SDS TEST"
    res = generar_desde_datos(datos, generar_pdf=False, subir_drive=False)
    assert res["ok"] is True
    assert res["docx_nombre"].startswith("SDS-")


def test_documentos_catalogo_asociar_y_coincidencia(tmp_path, monkeypatch) -> None:
    from app.services import documentos_catalogo as dc

    map_path = tmp_path / "documentos_producto.json"
    monkeypatch.setattr(dc, "MAP_PATH", map_path)

    entry = dc.asociar_documento(
        "C-TEST250",
        "coa",
        web_view_link="https://drive.google.com/file/d/abc123/view",
        nombre_archivo="COA-TEST.pdf",
        nombre_producto="Producto Test 250 g",
    )
    assert entry["webViewLink"].endswith("/view")
    data = json.loads(map_path.read_text(encoding="utf-8"))
    assert data["productos"]["C-TEST250"]["coa"]["nombre_archivo"] == "COA-TEST.pdf"

    assert dc.nombre_base_producto("Urea Cosmética 250 g") == "Urea Cosmética"
    assert dc._coincide_archivo("Urea Cosmética", "C-UREA250", "COA-UREA-COSMETICA.pdf")


def test_documentos_preview_coa_docx() -> None:
    from app.services.coa import generar_desde_datos, plantilla_datos_ejemplo

    datos = plantilla_datos_ejemplo()
    datos["titulo"] = "SMOKE PREVIEW COA"
    res = generar_desde_datos(datos, generar_pdf=False, subir_drive=False)
    assert res["ok"] is True
    assert res["docx_nombre"].startswith("COA-")


def test_formatear_reporte_sync_facturas_secciones() -> None:
    from app.sync import (
        SYNC_FACTURA_CAT_FALLO_SUBIDA,
        SYNC_FACTURA_CAT_SIN_CRUCE,
        SYNC_FACTURA_CAT_TIMBRADO,
        _formatear_reporte_sync_facturas,
    )

    categorias = {
        SYNC_FACTURA_CAT_SIN_CRUCE: ["111"],
        SYNC_FACTURA_CAT_TIMBRADO: ["222"],
        SYNC_FACTURA_CAT_FALLO_SUBIDA: [],
    }
    reporte = _formatear_reporte_sync_facturas([], categorias)
    assert "ALERTA DE FACTURACIÓN" in reporte
    assert "Sin cruce en Siigo" in reporte
    assert "Esperando timbrado DIAN" in reporte
    assert "- 111" in reporte
    assert "- 222" in reporte

    solo_timbrado = {SYNC_FACTURA_CAT_TIMBRADO: ["333"]}
    for k in categorias:
        if k != SYNC_FACTURA_CAT_TIMBRADO:
            solo_timbrado.setdefault(k, [])
    reporte_info = _formatear_reporte_sync_facturas(["ok1"], solo_timbrado)
    assert "ℹ️" in reporte_info
    assert "timbrado" in reporte_info.lower()


def test_procesar_packs_sync_siigo_categorias(monkeypatch) -> None:
    from app.sync import (
        SYNC_FACTURA_CAT_FALLO_SUBIDA,
        SYNC_FACTURA_CAT_SIN_CRUCE,
        SYNC_FACTURA_CAT_TIMBRADO,
        _procesar_packs_sync_siigo,
    )

    facturas = [
        {"id": "fac-t", "observations": "pack timbrado 100", "purchase_order": ""},
        {"id": "fac-ok", "observations": "pack ok 200", "purchase_order": ""},
    ]

    def fake_timbrado(fac):
        return str(fac.get("id")) == "fac-t"

    def fake_doc(sid):
        if sid == "fac-ok":
            return ("BASE64DOC", "pdf")
        return (None, "pdf")

    def fake_subir(pack_id, doc, formato="pdf"):
        if pack_id == "200":
            return "✅"
        return "❌ error MeLi"

    monkeypatch.setattr("app.sync.siigo_omitir_pdf_mientras_timbrado", fake_timbrado)
    monkeypatch.setattr(
        "app.sync.obtener_documento_fiscal_siigo_para_meli", fake_doc
    )
    monkeypatch.setattr("app.sync.subir_factura_meli", fake_subir)

    res = _procesar_packs_sync_siigo(
        ["100", "200", "300"],
        facturas,
    )
    cats = res["categorias"]
    assert res["exitosas"] == ["200"]
    assert "100" in cats[SYNC_FACTURA_CAT_TIMBRADO]
    assert "300" in cats[SYNC_FACTURA_CAT_SIN_CRUCE]


def test_meli_pack_tiene_documento_fiscal(monkeypatch) -> None:
    from app.services import meli as meli_svc

    class FakeResp:
        def __init__(self, status_code: int, docs: list | None = None) -> None:
            self.status_code = status_code
            self._docs = docs

        def json(self) -> dict:
            return {"fiscal_documents": self._docs or []}

    def fake_get(url, headers=None, timeout=None):
        if "packs/111" in url:
            return FakeResp(200, [{"id": "doc-1"}])
        if "packs/222" in url:
            return FakeResp(200, [])
        return FakeResp(404)

    monkeypatch.setattr(meli_svc.requests, "get", fake_get)
    assert meli_svc.meli_pack_tiene_documento_fiscal("111", token="tok") is True
    assert meli_svc.meli_pack_tiene_documento_fiscal("222", token="tok") is False
    assert meli_svc.meli_pack_tiene_documento_fiscal("333", token="tok") is False


def test_wa_jid_telefono_colombia_valido(tmp_path, monkeypatch) -> None:
    import app.services.wa_jid as wj_mod

    monkeypatch.setattr(wj_mod, "_ALIASES_PATH", str(tmp_path / "wa_aliases_test.json"))
    wj_mod._ALIASES_LIMPIOS = False

    from app.services.wa_jid import (
        es_alias_telefono_falso,
        es_jid_cus_falso,
        es_telefono_jid_valido,
        es_telefono_negocio,
        info_contacto_jid,
        jid_canonico,
        lid_desde_jid_cus_falso,
        normalizar_jid_almacenamiento,
        registrar_alias_lid,
        telefono_desde_jid,
    )

    ok = "573012345678@c.us"
    assert es_telefono_jid_valido(ok) is True
    assert telefono_desde_jid(ok) == "+57 301 234 5678"
    assert info_contacto_jid(ok)["display"] == "+57 301 234 5678"

    lid = "73031707820119@lid"
    falso = "5773031707820119@c.us"
    assert es_telefono_jid_valido(falso) is False
    assert es_jid_cus_falso(falso) is True
    assert lid_desde_jid_cus_falso(falso) == lid
    assert jid_canonico(falso) == lid
    assert normalizar_jid_almacenamiento(falso) == lid
    assert info_contacto_jid(falso)["display"].startswith("Contacto WA")
    assert es_alias_telefono_falso(lid, falso) is True
    registrar_alias_lid(lid, falso)
    assert info_contacto_jid(lid)["telefono"] is None

    registrar_alias_lid(lid, ok)
    assert jid_canonico(lid) == ok
    assert info_contacto_jid(falso)["telefono"] == "+57 301 234 5678"

    negocio = "573195183596@c.us"
    assert es_telefono_negocio(negocio) is True
    registrar_alias_lid("99999999999999@lid", negocio)
    assert "99999999999999@lid" not in wj_mod._load_aliases()
    assert jid_canonico("99999999999999@lid") == "99999999999999@lid"

    from app.services.wa_jid import es_jid_conversacion_cliente, lid_desde_wa_id

    assert lid_desde_wa_id("true_39818893471872@lid_ABC") == "39818893471872@lid"
    assert es_jid_conversacion_cliente(negocio) is False
    assert es_jid_conversacion_cliente(lid) is True


def test_wa_bot_detect_parece_respuesta_bot() -> None:
    from app.services.wa_bot_detect import parece_respuesta_bot

    assert parece_respuesta_bot("Hola Soy hugo Garcia de mckenna Group") is True
    assert parece_respuesta_bot("Buenos días") is False
    assert parece_respuesta_bot("Para que ciudad es") is False
    assert parece_respuesta_bot("Veci, " + "x" * 120) is True


def test_wa_chats_no_degrada_bot_a_humano(tmp_path, monkeypatch) -> None:
    import app.services.wa_chats as wc

    db = tmp_path / "wa_test.db"
    monkeypatch.setattr(wc, "_DB", str(db))
    wc._init()

    jid = "573001112233@c.us"
    wc.guardar(jid, "salida", texto="respuesta bot", enviado_por="bot", wa_id="wa-bot-1")
    wc.guardar(jid, "salida", texto="respuesta bot", enviado_por="humano", wa_id="wa-bot-1")

    msgs = wc.listar_mensajes(jid, limit=5)
    assert len(msgs) == 1
    assert msgs[0]["enviado_por"] == "bot"


def test_bot_debe_responder_ignora_horario() -> None:
    from app.routes import _bot_debe_responder_global, _bot_en_horario_servicio

    modos = {
        "bot_global_activo": True,
        "horario_bot": {
            "habilitado": True,
            "hora_inicio": "18:00",
            "hora_fin": "07:00",
            "dias": [1, 2, 3, 4, 5, 6, 7],
        },
    }
    assert _bot_debe_responder_global(modos) is True
    assert _bot_en_horario_servicio(modos) in (True, False)

    modos["bot_global_activo"] = False
    assert _bot_debe_responder_global(modos) is False


def test_wa_metricas_calcular(tmp_path, monkeypatch) -> None:
    import sqlite3

    import app.services.wa_metricas as wm

    db = tmp_path / "wa_metricas.db"
    conn = sqlite3.connect(db)
    conn.execute(
        """
        CREATE TABLE mensajes (
            id INTEGER PRIMARY KEY, ts REAL, jid TEXT, direccion TEXT,
            texto TEXT, enviado_por TEXT, eliminado INTEGER DEFAULT 0,
            tiene_media INTEGER DEFAULT 0
        )
        """
    )
    base = 1_700_000_000.0
    conn.execute(
        "INSERT INTO mensajes VALUES (1, ?, '573001112233@c.us', 'entrada', ?, 'cliente', 0, 0)",
        (base, "¿Precio de la urea cosmética 250g?"),
    )
    conn.execute(
        "INSERT INTO mensajes VALUES (2, ?, '573001112233@c.us', 'salida', ?, 'humano', 0, 0)",
        (base + 300, "Hola veci, la urea 250g está a $45.000"),
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(wm, "_DB", str(db))
    out = wm.calcular_metricas(dias=0)
    assert out["tiempos"]["primera_respuesta_humana"]["n"] == 1
    assert out["tiempos"]["primera_respuesta_humana"]["mediana_min"] == 5.0
    assert out["calificacion"]["humano"]["nota"] >= 0
    assert out["ventas"]["embudo"]
    assert out["glosario"]

