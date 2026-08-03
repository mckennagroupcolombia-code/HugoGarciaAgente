"""Regresión: 'hugo dale ok <código>' debe disparar la respuesta postventa
incluso cuando llega desde el propio grupo POSTVENTA (bug: el catch-all de
`es_any_grupo_admin` en routes.py lo descartaba antes de llegar al manejador)."""
from __future__ import annotations

from flask import Flask

from app import routes
from app.utils import jid_grupo_postventa_wa


def _build_client(monkeypatch):
    app = Flask(__name__)
    app.config["TESTING"] = True

    monkeypatch.setattr(
        routes, "spawn_thread", lambda fn, args=(), daemon=True: fn(*args)
    )
    monkeypatch.setattr(routes, "enviar_whatsapp_reporte", lambda *args, **kwargs: None)
    monkeypatch.setattr(routes, "chat_api_token_matches_request", lambda: True)
    monkeypatch.setattr(routes, "_remote_es_grupo_web_pedido", lambda _jid: False)
    monkeypatch.setattr(routes, "cargar_modos_atencion", lambda: {"numeros_en_humano": []})

    routes.register_routes(app)
    return app.test_client()


def test_hugo_dale_ok_desde_grupo_postventa_envia_borrador(monkeypatch):
    client = _build_client(monkeypatch)
    routes.borradores_aprobacion.clear()
    routes.borradores_aprobacion["mock-pack-398"] = "Respuesta sugerida por la IA"

    monkeypatch.setattr(
        "app.meli_postventa_notif.sufijo_pack_postventa", lambda pack_id: "398"
    )
    enviados = []
    monkeypatch.setattr(
        routes,
        "responder_mensaje_posventa",
        lambda pack_id, msg, comprador_id=None: enviados.append((pack_id, msg)) or True,
    )

    resp = client.post(
        "/whatsapp",
        json={
            "sender": "573000000000@c.us",
            "remoteJid": jid_grupo_postventa_wa(),
            "mensaje": "hugo dale ok 398",
            "hasMedia": False,
        },
    )
    data = resp.get_json()

    assert resp.status_code == 200
    assert data["status"] == "sent"
    assert enviados == [("mock-pack-398", "Respuesta sugerida por la IA")]
    assert "mock-pack-398" not in routes.borradores_aprobacion


def test_hugo_dale_ok_sin_borrador_pendiente_responde_error(monkeypatch):
    client = _build_client(monkeypatch)
    routes.borradores_aprobacion.clear()
    monkeypatch.setattr(
        routes, "_resolver_entrada_postventa", lambda token: (None, None)
    )

    resp = client.post(
        "/whatsapp",
        json={
            "sender": "573000000000@c.us",
            "remoteJid": jid_grupo_postventa_wa(),
            "mensaje": "hugo dale ok 999",
            "hasMedia": False,
        },
    )
    data = resp.get_json()

    assert resp.status_code == 200
    assert data["status"] == "error"
    assert "999" in data["respuesta"]
