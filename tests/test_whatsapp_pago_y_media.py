from __future__ import annotations

from flask import Flask

from app import routes
from app.core import _mensaje_amigable_badrequest
from app.services.gemini_vision import AnalisisImagenPago


def _build_client(monkeypatch):
    app = Flask(__name__)
    app.config["TESTING"] = True

    # Evita hilos y llamadas externas en tests.
    monkeypatch.setattr(
        routes, "spawn_thread", lambda fn, args=(), daemon=True: fn(*args)
    )
    monkeypatch.setattr(routes, "enviar_whatsapp_reporte", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        routes, "obtener_respuesta_ia", lambda _msg, _sender, **_kw: ("respuesta mock", [])
    )
    monkeypatch.setattr(routes, "chat_api_token_matches_request", lambda: True)
    monkeypatch.setattr(routes, "_remote_es_grupo_web_pedido", lambda _jid: False)
    monkeypatch.setattr(routes, "cargar_modos_atencion", lambda: {"numeros_en_humano": []})
    monkeypatch.setattr(
        routes,
        "analizar_imagen_pago",
        lambda *_args, **_kwargs: AnalisisImagenPago(
            es_comprobante=False,
            confianza=0.9,
            descripcion="foto de producto",
        ),
    )

    routes.register_routes(app)
    return app.test_client()


def test_imagen_sin_contexto_pago_va_a_ia(monkeypatch):
    client = _build_client(monkeypatch)
    resp = client.post(
        "/whatsapp",
        json={
            "sender": "573001112233@c.us",
            "mensaje": "",
            "hasMedia": True,
            "mediaType": "image",
            "mediaPath": "/tmp/foto.jpg",
        },
    )
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "success"
    assert data["respuesta"] == "respuesta mock"


def test_texto_pago_sin_imagen_retorna_missing_image(monkeypatch):
    client = _build_client(monkeypatch)
    resp = client.post(
        "/whatsapp",
        json={
            "sender": "573001112233@c.us",
            "mensaje": "Ya pagué, te envío comprobante",
            "hasMedia": False,
        },
    )
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "missing_image"
    assert "imagen adjunta" in data["respuesta"]


def test_imagen_con_contexto_pago_activa_validacion(monkeypatch):
    client = _build_client(monkeypatch)
    monkeypatch.setattr(
        routes,
        "analizar_imagen_pago",
        lambda *_args, **_kwargs: AnalisisImagenPago(
            es_comprobante=True,
            confianza=0.93,
            monto="50000",
            moneda="COP",
            referencia="ABC123",
        ),
    )
    sender = "573001112233@c.us"

    # Paso 1: texto de pago crea contexto.
    r1 = client.post(
        "/whatsapp",
        json={"sender": sender, "mensaje": "ya pagué por transferencia", "hasMedia": False},
    )
    assert r1.status_code == 200
    assert r1.get_json()["status"] == "missing_image"

    # Paso 2: imagen subsecuente entra a flujo comprobante.
    r2 = client.post(
        "/whatsapp",
        json={
            "sender": sender,
            "mensaje": "",
            "hasMedia": True,
            "mediaType": "image",
            "mediaPath": "/tmp/comprobante.jpg",
        },
    )
    data = r2.get_json()
    assert r2.status_code == 200
    assert data["status"] == "waiting_for_payment_approval"
    assert "recibí su comprobante" in data["respuesta"].lower()


def test_imagen_con_contexto_pago_no_comprobante_va_a_ia(monkeypatch):
    client = _build_client(monkeypatch)
    sender = "573001112235@c.us"

    client.post(
        "/whatsapp",
        json={"sender": sender, "mensaje": "ya pagué por transferencia", "hasMedia": False},
    )
    resp = client.post(
        "/whatsapp",
        json={
            "sender": sender,
            "mensaje": "",
            "hasMedia": True,
            "mediaType": "image",
            "mediaPath": "/tmp/no-comprobante.jpg",
        },
    )
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "success"
    assert data["respuesta"] == "respuesta mock"


def test_texto_consulta_pago_no_dispara_missing_image(monkeypatch):
    client = _build_client(monkeypatch)
    resp = client.post(
        "/whatsapp",
        json={
            "sender": "573001112244@c.us",
            "mensaje": "¿Cómo pago por nequi?",
            "hasMedia": False,
        },
    )
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "success"


def test_mensaje_autoresponder_pausa_anti_loop(monkeypatch):
    client = _build_client(monkeypatch)

    def fail_ia(_msg, _sender):
        raise AssertionError("No debe llamar IA ante autoresponder")

    monkeypatch.setattr(routes, "obtener_respuesta_ia", fail_ia)
    resp = client.post(
        "/whatsapp",
        json={
            "sender": "573009990000@c.us",
            "mensaje": "Mensaje automático: por favor digita 1 para ventas o 2 para soporte.",
            "hasMedia": False,
        },
    )
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "bot_loop_paused"
    assert data["respuesta"] is None


def test_rafaga_repetida_pausa_anti_loop(monkeypatch):
    monkeypatch.setattr(routes, "UMBRAL_RAFAGA_ANTI_BOT", 10)
    routes.mensajes_recientes_clientes.clear()
    client = _build_client(monkeypatch)
    sender = "573009990001@c.us"

    def fail_ia(_msg, _sender):
        raise AssertionError("No debe llamar IA en mensaje repetido")

    # Dos primeros pasan a IA; el tercero igual activa protección por repetición.
    for _ in range(2):
        r = client.post(
            "/whatsapp",
            json={"sender": sender, "mensaje": "hola", "hasMedia": False},
        )
        assert r.status_code == 200

    monkeypatch.setattr(routes, "obtener_respuesta_ia", fail_ia)
    resp = client.post(
        "/whatsapp",
        json={"sender": sender, "mensaje": "hola", "hasMedia": False},
    )
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "bot_loop_paused"


def test_badrequest_credito_bajo_da_mensaje_mantenimiento():
    msg = _mensaje_amigable_badrequest(
        "Error code: 400 - Your credit balance is too low to access the Anthropic API."
    )
    assert "mantenimiento temporal" in msg


def test_badrequest_tokens_largos_da_mensaje_partir():
    msg = _mensaje_amigable_badrequest("prompt is too long")
    assert "muy largo" in msg
