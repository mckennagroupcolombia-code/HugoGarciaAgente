"""Smoke tests sin credenciales externas (solo Flask y utilidades locales)."""

from flask import Flask


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
