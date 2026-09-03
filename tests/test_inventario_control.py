"""Control de Inventario: caché SWR del resumen (sin APIs externas)."""

from __future__ import annotations

import pytest


@pytest.fixture
def ic(monkeypatch, tmp_path):
    import app.services.inventario_control as mod

    monkeypatch.setattr(mod, "_RESUMEN_CACHE_PATH", str(tmp_path / "resumen.json"))
    monkeypatch.setattr(mod, "_MEM_CACHE", None)
    monkeypatch.setattr(mod, "_REFRESHING", False)
    monkeypatch.setattr(mod, "_LAST_FAIL", None)
    return mod


def _snapshot(**over):
    base = {
        "items": [
            {
                "meli_id": "MCO1",
                "sku": "U-250",
                "nombre": "Urea Cosmética 250g",
                "stock_meli": 0,
                "stock_siigo": 12,
                "estado": "agotado",
                "divergencia": True,
                "rotacion": "alta",
                "revisado_en": None,
                "revisado_por": None,
                "dias_sin_revisar": None,
                "proveedor": "",
                "notas_proveedor": "",
            }
        ],
        "total": 1,
        "actualizado_en": "2026-09-02T12:00:00",
        "umbral_bajo_stock": 5,
        "umbral_divergencia_siigo": 3,
        "cargando": False,
        "desde_cache": False,
        "stale": False,
    }
    base.update(over)
    return base


def test_sin_cache_devuelve_cargando_y_dispara_fondo(ic, monkeypatch):
    llamados = []
    monkeypatch.setattr(ic, "_refrescar_en_fondo", lambda refresh=False: llamados.append(refresh))
    out = ic.resumen_control_inventario()
    assert out["cargando"] is True
    assert out["items"] == []
    assert llamados == [False]


def test_cache_fresco_no_refresca(ic, monkeypatch):
    ic._cache_put(_snapshot())
    llamados = []
    monkeypatch.setattr(ic, "_refrescar_en_fondo", lambda *a, **k: llamados.append(1))
    out = ic.resumen_control_inventario()
    assert out["desde_cache"] is True
    assert out["stale"] is False
    assert out["total"] == 1
    assert out["items"][0]["meli_id"] == "MCO1"
    assert llamados == []


def test_cache_stale_sirve_y_refresca_fondo(ic, monkeypatch):
    ic._cache_put(_snapshot())
    ts, payload = ic._MEM_CACHE
    ic._MEM_CACHE = (ts - ic._RESUMEN_CACHE_TTL_S - 5, payload)
    llamados = []
    monkeypatch.setattr(ic, "_refrescar_en_fondo", lambda refresh=False: llamados.append(refresh))
    out = ic.resumen_control_inventario()
    assert out["stale"] is True
    assert out["total"] == 1
    assert llamados == [False]


def test_refresh_falla_devuelve_stale_con_error(ic, monkeypatch):
    ic._cache_put(_snapshot())

    def boom(refresh=False):
        raise RuntimeError("Connection reset by peer")

    monkeypatch.setattr(ic, "_resumen_vivo", boom)
    out = ic.resumen_control_inventario(refresh=True)
    assert out["stale"] is True
    assert out["total"] == 1
    assert "Connection reset" in (out.get("error") or "")


def test_marcar_revisado_parchea_snapshot(ic, monkeypatch, tmp_path):
    monkeypatch.setattr(ic, "_REVISIONES_PATH", str(tmp_path / "rev.json"))
    ic._cache_put(_snapshot())
    entrada = ic.marcar_revisado("MCO1", "Ana")
    assert entrada["revisado_por"] == "Ana"
    fila = ic._cache_get()[1]["items"][0]
    assert fila["revisado_por"] == "Ana"
    assert fila["dias_sin_revisar"] == 0
