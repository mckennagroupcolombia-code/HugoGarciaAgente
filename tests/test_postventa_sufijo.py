from __future__ import annotations

import json

from app.routes import (
    _diagnosticar_sufijo_postventa,
    _ejecutar_respuesta_postventa,
    _omitir_pendiente_postventa,
    _pendientes_postventa_por_sufijo,
    _resolver_entrada_postventa,
)
from app.meli_postventa_notif import sufijo_pack_postventa


def test_sufijo_pack_postventa_tres_digitos():
    assert sufijo_pack_postventa("2000016700990404") == "404"
    assert sufijo_pack_postventa("2000016700990583") == "583"


def test_pendientes_por_sufijo_tres_digitos(monkeypatch, tmp_path):
    state = {
        "pendientes": {
            "2000016700990404": {
                "pack_id": "2000016700990404",
                "codigo": "0404",
                "comprador": "Cliente",
                "texto": "Hola",
            },
            "0404": {
                "pack_id": "2000016700990404",
                "codigo": "0404",
                "comprador": "Cliente",
                "texto": "Hola",
            },
        }
    }
    p = tmp_path / "mensajes_posventa_pendientes.json"
    p.write_text(__import__("json").dumps(state), encoding="utf-8")
    monkeypatch.setattr("app.routes._POSVENTA_STATE_PATH", str(p))

    matches = _pendientes_postventa_por_sufijo("404")
    assert len(matches) == 1
    assert matches[0]["pack_id"] == "2000016700990404"

    entrada, _clave = _resolver_entrada_postventa("404")
    assert entrada is not None
    assert entrada["pack_id"] == "2000016700990404"


def test_sufijo_ambiguo_postventa(monkeypatch, tmp_path):
    state = {
        "pendientes": {
            "pack1": {
                "pack_id": "2000016700990404",
                "codigo": "404",
                "comprador": "A",
                "texto": "1",
            },
            "pack2": {
                "pack_id": "2000016700991404",
                "codigo": "404",
                "comprador": "B",
                "texto": "2",
            },
        }
    }
    p = tmp_path / "mensajes_posventa_pendientes.json"
    p.write_text(__import__("json").dumps(state), encoding="utf-8")
    monkeypatch.setattr("app.routes._POSVENTA_STATE_PATH", str(p))

    diag = _diagnosticar_sufijo_postventa("404")
    assert diag["count"] == 2
    entrada, _ = _resolver_entrada_postventa("404")
    assert entrada is None


def test_ejecutar_respuesta_ambiguo_notifica(monkeypatch, tmp_path):
    state = {
        "pendientes": {
            "pack1": {
                "pack_id": "2000016700990404",
                "codigo": "404",
                "comprador": "A",
                "texto": "1",
            },
            "pack2": {
                "pack_id": "2000016700991404",
                "codigo": "404",
                "comprador": "B",
                "texto": "2",
            },
        }
    }
    p = tmp_path / "mensajes_posventa_pendientes.json"
    p.write_text(__import__("json").dumps(state), encoding="utf-8")
    monkeypatch.setattr("app.routes._POSVENTA_STATE_PATH", str(p))

    msgs: list[str] = []
    monkeypatch.setattr(
        "app.routes.enviar_whatsapp_reporte",
        lambda msg, **kwargs: msgs.append(msg) or True,
    )
    monkeypatch.setattr("app.routes.responder_mensaje_posventa", lambda *_a, **_k: True)

    res = _ejecutar_respuesta_postventa("404", "Hola veci", notificar_grupo=True)
    assert res["ok"] is False
    assert "ambiguo" in res["error"].lower()
    assert any("ambiguo" in m.lower() for m in msgs)


def test_omitir_pendiente_postventa_quita_cola_y_marca_procesado(monkeypatch, tmp_path):
    entrada = {
        "pack_id": "2000016700990404",
        "codigo": "404",
        "comprador": "Cliente",
        "texto": "¿Ya salió?",
        "msg_id": "msg-omitir-1",
    }
    state = {
        "pendientes": {
            "2000016700990404": entrada,
            "404": entrada,
        },
        "procesados": [],
    }
    p = tmp_path / "mensajes_posventa_pendientes.json"
    p.write_text(json.dumps(state), encoding="utf-8")
    monkeypatch.setattr("app.routes._POSVENTA_STATE_PATH", str(p))

    res = _omitir_pendiente_postventa("404")
    assert res["ok"] is True
    assert res["omitido"] is True
    assert res["pack_id"] == "2000016700990404"

    guardado = json.loads(p.read_text(encoding="utf-8"))
    assert guardado["pendientes"] == {}
    assert "msg-omitir-1" in guardado["procesados"]
    assert _resolver_entrada_postventa("404")[0] is None


def test_omitir_pendiente_postventa_inexistente(monkeypatch, tmp_path):
    p = tmp_path / "mensajes_posventa_pendientes.json"
    p.write_text(json.dumps({"pendientes": {}, "procesados": []}), encoding="utf-8")
    monkeypatch.setattr("app.routes._POSVENTA_STATE_PATH", str(p))

    res = _omitir_pendiente_postventa("999")
    assert res["ok"] is False
    assert "no hay mensaje" in res["error"].lower()
