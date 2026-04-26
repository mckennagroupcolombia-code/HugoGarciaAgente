"""Smoke tests sin credenciales externas (solo Flask y utilidades locales)."""

from __future__ import annotations

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
