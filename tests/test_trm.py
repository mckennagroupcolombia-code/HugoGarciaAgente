"""Tests TRM BanRep (mock HTTP) y normalización de fechas."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.services.trm import (
    _yahoo_serie,
    normalizar_fecha,
    obtener_dolar_hora,
    obtener_trm,
    obtener_trm_historico,
    reset_dolar_cache,
    trm_para_usd,
)


def test_normalizar_fecha_iso():
    assert normalizar_fecha("2026-08-01") == "2026-08-01"
    assert normalizar_fecha("2026-08-01T15:30:00") == "2026-08-01"
    assert normalizar_fecha("01-08-2026") == "2026-08-01"
    assert normalizar_fecha("") is None
    assert normalizar_fecha("no-fecha") is None


def test_obtener_trm_por_vigencia():
    fake = [
        {
            "valor": "3144.14",
            "unidad": "COP",
            "vigenciadesde": "2026-08-01T00:00:00.000",
            "vigenciahasta": "2026-08-03T00:00:00.000",
        }
    ]
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = fake

    with patch("requests.get", return_value=mock_resp) as get:
        out = obtener_trm("2026-08-02")
        assert out["valor"] == 3144.14
        assert out["fuente"] == "banrep"
        assert out["fecha"] == "2026-08-02"
        assert "error" not in out
        assert get.called


def test_obtener_trm_fallback_ultima():
    empty = MagicMock()
    empty.raise_for_status = MagicMock()
    empty.json.return_value = []
    last = MagicMock()
    last.raise_for_status = MagicMock()
    last.json.return_value = [
        {
            "valor": "4000.50",
            "unidad": "COP",
            "vigenciadesde": "2026-07-01T00:00:00.000",
            "vigenciahasta": "2026-07-01T00:00:00.000",
        }
    ]

    with patch("requests.get", side_effect=[empty, last]):
        out = obtener_trm("2026-07-15")
        assert out["valor"] == 4000.5
        assert out.get("aproximada") is True


def test_trm_para_usd():
    with patch(
        "app.services.trm.obtener_trm",
        return_value={"valor": 3100.0, "fuente": "banrep"},
    ):
        assert trm_para_usd("2026-08-01") == 3100.0
    with patch(
        "app.services.trm.obtener_trm",
        return_value={"error": "fail"},
    ):
        assert trm_para_usd("2026-08-01") is None


def test_obtener_trm_historico():
    fake = [
        {
            "valor": "4010.00",
            "unidad": "COP",
            "vigenciadesde": "2026-08-18T00:00:00.000",
            "vigenciahasta": "2026-08-18T00:00:00.000",
        },
        {
            "valor": "4000.00",
            "unidad": "COP",
            "vigenciadesde": "2026-08-17T00:00:00.000",
            "vigenciahasta": "2026-08-17T00:00:00.000",
        },
    ]
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = fake
    with patch("requests.get", return_value=mock_resp):
        out = obtener_trm_historico(limit=10)
    assert [p["t"] for p in out] == ["2026-08-17", "2026-08-18"]
    assert out[0]["v"] == 4000.0


def test_yahoo_serie_parsea_cierres():
    fake = MagicMock()
    fake.raise_for_status = MagicMock()
    fake.json.return_value = {
        "chart": {
            "result": [
                {
                    "meta": {"regularMarketPrice": 4125.5, "chartPreviousClose": 4100.0},
                    "timestamp": [1755514800, 1755518400],
                    "indicators": {"quote": [{"close": [4110.0, 4125.5]}]},
                }
            ]
        }
    }
    with patch("requests.get", return_value=fake):
        out = _yahoo_serie("1h", "5d", timeout_s=5)
    assert out is not None
    assert out["precio"] == 4125.5
    assert len(out["puntos"]) == 2
    assert out["puntos"][-1]["v"] == 4125.5


def test_obtener_dolar_hora_mercado():
    reset_dolar_cache()
    yahoo = {
        "puntos": [
            {"t": "2026-08-18T10:00:00-05:00", "v": 4100.0, "ts": 1},
            {"t": "2026-08-18T11:00:00-05:00", "v": 4125.5, "ts": 2},
        ],
        "precio": 4125.5,
        "previo": 4100.0,
    }
    with (
        patch("app.services.trm._yahoo_serie", return_value=yahoo),
        patch(
            "app.services.trm.obtener_trm",
            return_value={"valor": 4000.0, "fecha": "2026-08-18", "fuente": "banrep"},
        ),
        patch(
            "app.services.trm.obtener_trm_historico",
            return_value=[{"t": "2026-08-17", "v": 3990.0}, {"t": "2026-08-18", "v": 4000.0}],
        ),
    ):
        out = obtener_dolar_hora(force=True)
    assert out["valor"] == 4125.5
    assert out["fuente"] == "yahoo"
    assert out["trm_oficial"] == 4000.0
    assert len(out["serie_hora"]) == 2
    assert out["cambio_abs"] == 25.5


def test_obtener_dolar_hora_fallback_banrep():
    reset_dolar_cache()
    with (
        patch("app.services.trm._yahoo_serie", return_value=None),
        patch(
            "app.services.trm.obtener_trm",
            return_value={"valor": 4010.25, "fecha": "2026-08-18"},
        ),
        patch(
            "app.services.trm.obtener_trm_historico",
            return_value=[{"t": "2026-08-17", "v": 4000.0}, {"t": "2026-08-18", "v": 4010.25}],
        ),
    ):
        out = obtener_dolar_hora(force=True)
    assert out["fuente"] == "banrep"
    assert out["valor"] == 4010.25
    assert out["cambio_abs"] == 10.25
    assert out["serie_hora"] == []


def test_obtener_dolar_hora_usa_cache():
    reset_dolar_cache()
    yahoo = {
        "puntos": [{"t": "2026-08-18T11:00:00-05:00", "v": 4100.0, "ts": 1}],
        "precio": 4100.0,
        "previo": 4090.0,
    }
    with (
        patch("app.services.trm._yahoo_serie", return_value=yahoo) as y,
        patch(
            "app.services.trm.obtener_trm",
            return_value={"valor": 4000.0, "fecha": "2026-08-18"},
        ),
        patch("app.services.trm.obtener_trm_historico", return_value=[]),
    ):
        a = obtener_dolar_hora(force=True)
        b = obtener_dolar_hora()
    assert a["valor"] == b["valor"] == 4100.0
    assert y.call_count == 1

