"""Tests TRM BanRep (mock HTTP) y normalización de fechas."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.services.trm import normalizar_fecha, obtener_trm, trm_para_usd


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
