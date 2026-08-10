from __future__ import annotations

from flask import Flask

from app import routes


def _build_client(monkeypatch):
    app = Flask(__name__)
    app.config["TESTING"] = True

    procesados: list[tuple[str, str]] = []

    monkeypatch.setattr(
        routes, "spawn_thread", lambda fn, args=(), daemon=True: fn(*args)
    )
    monkeypatch.setattr(routes, "enviar_whatsapp_reporte", lambda *args, **kwargs: None)
    monkeypatch.setattr(routes, "_remote_es_grupo_web_pedido", lambda _jid: False)
    monkeypatch.setattr(
        routes,
        "encontrar_question_id_por_sufijo",
        lambda sufijo: "13603337774" if sufijo == "774" else None,
    )
    import app.services.meli_preventa as meli_preventa

    monkeypatch.setattr(
        meli_preventa,
        "obtener_borrador_ia",
        lambda _qid: "Respuesta IA de prueba para MeLi.",
    )

    def _capturar(qid: str, respuesta: str):
        procesados.append((qid, respuesta))

    monkeypatch.setattr(routes, "_procesar_respuesta_preventa", _capturar)

    routes.register_routes(app)
    return app.test_client(), procesados


def test_ok_preventa_con_negritas_sin_grupo_correcto(monkeypatch):
    client, procesados = _build_client(monkeypatch)

    resp = client.post(
        "/whatsapp",
        json={
            "sender": "573001112233@c.us",
            "remoteJid": "573001112233@c.us",
            "mensaje": "*ok 774*",
            "hasMedia": False,
        },
    )
    data = resp.get_json()

    assert resp.status_code == 200
    assert data["status"] == "ok"
    assert procesados == [("13603337774", "Respuesta IA de prueba para MeLi.")]


def test_ok_preventa_no_interfiere_con_pago_sin_pendiente(monkeypatch):
    app = Flask(__name__)
    app.config["TESTING"] = True

    monkeypatch.setattr(
        routes, "spawn_thread", lambda fn, args=(), daemon=True: fn(*args)
    )
    monkeypatch.setattr(routes, "enviar_whatsapp_reporte", lambda *args, **kwargs: None)
    monkeypatch.setattr(routes, "_remote_es_grupo_web_pedido", lambda _jid: False)
    monkeypatch.setattr(routes, "encontrar_question_id_por_sufijo", lambda _s: None)
    monkeypatch.setattr(routes, "cargar_modos_atencion", lambda: {"numeros_en_humano": []})
    monkeypatch.setattr(
        routes,
        "procesar_confirmacion_pago_async",
        lambda num: None,
    )

    confirmados: list[str] = []

    def _confirmar(num):
        confirmados.append(num)

    monkeypatch.setattr(routes, "procesar_confirmacion_pago_async", _confirmar)
    monkeypatch.setattr(
        routes,
        "_buscar_pago_por_sufijo",
        lambda sufijo: "573004630000@c.us" if sufijo == "463" else None,
    )

    routes.register_routes(app)
    client = app.test_client()

    resp = client.post(
        "/whatsapp",
        json={
            "sender": "120363408323873426@g.us",
            "remoteJid": "120363408323873426@g.us",
            "mensaje": "ok 463",
            "es_grupo_contabilidad": True,
            "hasMedia": False,
        },
    )

    assert resp.status_code == 200
    assert confirmados == ["573004630000@c.us"]
