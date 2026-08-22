"""Acumulador de cobertura geográfica MeLi (departamento/municipio real de
envíos ya despachados) — ver app/tools/cobertura_meli.py."""

from __future__ import annotations

import json

from app.tools import cobertura_meli as cm


def _reset(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(cm, "COBERTURA_MELI_FILE", tmp_path / "cobertura_meli.json")


def _orden(shipping_id) -> dict:
    return {"shipping": {"id": shipping_id}} if shipping_id else {"shipping": {}}


def _envio(status: str, ciudad: str, depto: str, date_shipped: str | None = None) -> dict:
    return {
        "status": status,
        "receiver_address": {"city": {"name": ciudad}, "state": {"name": depto}},
        "status_history": {"date_shipped": date_shipped},
    }


def test_solo_cuenta_envios_shipped_o_delivered(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    ordenes = [_orden("1"), _orden("2")]
    envios = {
        "1": _envio("shipped", "Medellín", "Antioquia"),
        "2": {"status": "pending", "receiver_address": {}},
    }
    import app.services.meli as meli_mod
    monkeypatch.setattr(meli_mod, "listar_ordenes_meli_por_estado", lambda *a, **k: ordenes)
    monkeypatch.setattr(meli_mod, "consultar_envio_meli", lambda sid: envios.get(sid))

    r = cm.actualizar_cobertura_meli(dias=1, limite=10)
    assert r["ordenes_revisadas"] == 2
    assert r["resueltos"] == 1
    assert r["aun_no_despachados"] == 1

    data = json.loads(cm.COBERTURA_MELI_FILE.read_text(encoding="utf-8"))
    assert data["municipios"]["Antioquia|Medellín"]["n_pedidos"] == 1
    # el pendiente NO queda marcado como visto -> se reintenta en la próxima corrida
    assert "2" not in data["shipping_ids_vistos"]
    assert "1" in data["shipping_ids_vistos"]


def test_no_vuelve_a_consultar_shipping_id_ya_visto(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    import app.services.meli as meli_mod
    ordenes = [_orden("1")]
    llamadas = []

    def _fake_consultar(sid):
        llamadas.append(sid)
        return _envio("delivered", "Cali", "Valle del Cauca")

    monkeypatch.setattr(meli_mod, "listar_ordenes_meli_por_estado", lambda *a, **k: ordenes)
    monkeypatch.setattr(meli_mod, "consultar_envio_meli", _fake_consultar)

    cm.actualizar_cobertura_meli(dias=1, limite=10)
    assert llamadas == ["1"]

    # segunda corrida: mismo shipping_id, no debería volver a consultarse
    cm.actualizar_cobertura_meli(dias=1, limite=10)
    assert llamadas == ["1"]

    data = json.loads(cm.COBERTURA_MELI_FILE.read_text(encoding="utf-8"))
    assert data["municipios"]["Valle del Cauca|Cali"]["n_pedidos"] == 1


def test_respeta_limite_por_corrida(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    import app.services.meli as meli_mod
    ordenes = [_orden(str(i)) for i in range(5)]
    llamadas = []

    def _fake_consultar(sid):
        llamadas.append(sid)
        return _envio("shipped", "Manizales", "Caldas")

    monkeypatch.setattr(meli_mod, "listar_ordenes_meli_por_estado", lambda *a, **k: ordenes)
    monkeypatch.setattr(meli_mod, "consultar_envio_meli", _fake_consultar)

    r = cm.actualizar_cobertura_meli(dias=1, limite=2)
    assert r["envios_consultados"] == 2
    assert len(llamadas) == 2


def test_estado_o_ciudad_sin_resolver_no_rompe(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    import app.services.meli as meli_mod
    ordenes = [_orden("1")]
    envio_raro = {
        "status": "delivered",
        "receiver_address": {"city": {"name": "Pueblo Fantasma"}, "state": {"name": "Narnia"}},
    }
    monkeypatch.setattr(meli_mod, "listar_ordenes_meli_por_estado", lambda *a, **k: ordenes)
    monkeypatch.setattr(meli_mod, "consultar_envio_meli", lambda sid: envio_raro)

    r = cm.actualizar_cobertura_meli(dias=1, limite=10)
    assert r["resueltos"] == 0
    assert r["sin_resolver"] == 1


def test_envios_por_fecha_usa_fecha_real_de_despacho(tmp_path, monkeypatch) -> None:
    _reset(tmp_path, monkeypatch)
    import app.services.meli as meli_mod
    ordenes = [_orden("1"), _orden("2")]
    envios = {
        "1": _envio("shipped", "Medellín", "Antioquia", date_shipped="2026-08-10T10:00:00.000-05:00"),
        "2": _envio("delivered", "Cali", "Valle del Cauca", date_shipped="2026-08-10T11:00:00.000-05:00"),
    }
    monkeypatch.setattr(meli_mod, "listar_ordenes_meli_por_estado", lambda *a, **k: ordenes)
    monkeypatch.setattr(meli_mod, "consultar_envio_meli", lambda sid: envios[sid])

    cm.actualizar_cobertura_meli(dias=1, limite=10)

    data = json.loads(cm.COBERTURA_MELI_FILE.read_text(encoding="utf-8"))
    assert data["envios_por_fecha"]["2026-08-10"] == 2
