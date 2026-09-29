"""Sistemas → Conexiones: un chequeo roto no tumba el panel y la caché evita golpear las APIs."""

from __future__ import annotations

from app.services import conexiones as C


def _falsas(monkeypatch, llamadas):
    def ok():
        llamadas.append("ok")
        return C._r("ok", "bien")

    def roto():
        raise RuntimeError("se cayó la red")

    monkeypatch.setattr(C, "CONEXIONES", [
        {"id": "a", "nombre": "A", "grupo": "G", "check": ok, "que_se_cae": [], "reconexion": {"tipo": "guia"}, "pasos": []},
        {"id": "b", "nombre": "B", "grupo": "G", "check": roto, "que_se_cae": [], "reconexion": {"tipo": "guia"}, "pasos": []},
    ])
    monkeypatch.setattr(C, "_POR_ID", {c["id"]: c for c in C.CONEXIONES})
    monkeypatch.setattr(C, "_cache", {})


def test_chequeo_roto_queda_en_alerta_y_no_expone_la_funcion(monkeypatch):
    llamadas: list[str] = []
    _falsas(monkeypatch, llamadas)
    r = C.estado_conexiones()
    por_id = {i["id"]: i for i in r["items"]}
    assert por_id["a"]["estado"] == "ok"
    assert por_id["b"]["estado"] == "alerta" and "se cayó la red" in por_id["b"]["detalle"]
    assert all("check" not in i and "_ts" not in i for i in r["items"])
    assert r["resumen"] == {"ok": 1, "alerta": 1, "caido": 0, "sin_configurar": 0}


def test_cache_y_forzar_una_sola(monkeypatch):
    llamadas: list[str] = []
    _falsas(monkeypatch, llamadas)
    C.estado_conexiones()
    C.estado_conexiones()
    assert llamadas == ["ok"]  # la segunda vino de la caché
    r = C.estado_conexiones(forzar=True, solo="a")
    assert llamadas == ["ok", "ok"] and [i["id"] for i in r["items"]] == ["a"]


def test_catalogo_completo():
    for c in C.CONEXIONES:
        assert c["pasos"] and c["que_se_cae"] and c["reconexion"]["tipo"] in ("qr", "oauth_gmail", "oauth_meli", "guia")
