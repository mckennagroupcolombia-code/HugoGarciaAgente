"""Humo del webhook MeLi (Flask :8080): respuesta inmediata sin llamar a MeLi."""

import json


def test_webhook_notifications_returns_200_immediately():
    import webhook_meli

    webhook_meli.app.config["TESTING"] = True
    with webhook_meli.app.test_client() as client:
        r = client.post(
            "/notifications",
            data=json.dumps(
                {
                    "topic": "messages",
                    "resource": "/orders/2000012000000000",
                }
            ),
            content_type="application/json",
        )
        assert r.status_code == 200
        assert r.get_json().get("status") == "ok"


def test_webhook_status_includes_request_id():
    import webhook_meli

    webhook_meli.app.config["TESTING"] = True
    with webhook_meli.app.test_client() as client:
        r = client.get("/status")
        assert r.status_code == 200
        data = r.get_json()
        assert data.get("estado") == "activo"
        assert data.get("request_id")


def test_posventa_pendientes_remove_by_pack_id(tmp_path):
    """Lógica de limpieza post-envío: quitar por clave o por pack_id (esp. si el comando usó ID largo)."""
    import json as json_lib

    state_path = tmp_path / "mensajes_posventa_pendientes.json"
    state_path.write_text(
        json_lib.dumps(
            {
                "pendientes": {
                    "7893": {
                        "pack_id": "2000012999937893",
                        "comprador": "Test",
                        "texto": "hola",
                        "msg_id": "x1",
                        "productos": "",
                        "timestamp": "2026-01-01T00:00:00",
                    }
                },
                "procesados": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    def remove_like_routes(pack_id: str, clave_pendiente):
        with open(state_path, "r", encoding="utf-8") as f:
            _state = json_lib.load(f)
        pd = _state.get("pendientes", {})
        if clave_pendiente and clave_pendiente in pd:
            pd.pop(clave_pendiente, None)
        else:
            for k, v in list(pd.items()):
                if str(v.get("pack_id")) == str(pack_id):
                    pd.pop(k, None)
                    break
        with open(state_path, "w", encoding="utf-8") as f:
            json_lib.dump(_state, f, indent=2, ensure_ascii=False)

    remove_like_routes("2000012999937893", "7893")
    data = json_lib.loads(state_path.read_text(encoding="utf-8"))
    assert data["pendientes"] == {}

    # Fallback: solo pack_id (respuesta con ID largo sin clave previa)
    state_path.write_text(
        json_lib.dumps(
            {
                "pendientes": {
                    "0793": {
                        "pack_id": "2000012000000793",
                        "comprador": "B",
                        "texto": "m",
                        "msg_id": "m2",
                        "productos": "",
                        "timestamp": "2026-01-01T00:00:00",
                    }
                },
                "procesados": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    remove_like_routes("2000012000000793", None)
    data = json_lib.loads(state_path.read_text(encoding="utf-8"))
    assert data["pendientes"] == {}
