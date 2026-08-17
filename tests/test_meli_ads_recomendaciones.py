"""Tests del motor de recomendaciones de publicidad MeLi (pausar/revisar)."""
from __future__ import annotations

from app.services import meli_ads_recomendaciones as R


def _item(item_id, *, costo=100_000.0, unidades=0, acos=200.0, status="active", campaign_id=1):
    return {
        "item_id": item_id,
        "titulo": f"Producto {item_id}",
        "marca": "Mckenna Group",
        "dominio": "MCO-SUPPLEMENTS",
        "status": status,
        "permalink": f"https://x/{item_id}",
        "campaign_id": campaign_id,
        "costo": costo,
        "ventas": 0.0,
        "clicks": 10,
        "prints": 1000,
        "unidades": unidades,
        "acos": acos,
    }


def _mockear(monkeypatch, items):
    monkeypatch.setattr(
        R, "listar_items_publicidad_completo",
        lambda dias=30, refresh=False: {"campanas": [{"id": 1, "nombre": "Alta Rotacion"}], "items": items},
    )
    monkeypatch.setattr(R, "obtener_ventas_meli_por_item", lambda dias=30, refresh=False: {"por_item": {}})
    monkeypatch.setattr(R, "obtener_margenes_reales", lambda dias=30, refresh=False: {"con_margen": []})


def test_marca_pero_no_excluye_inactivos_de_campana_vigente(monkeypatch):
    """
    ago-2026: anuncios "idle"/"hold"/"paused" DENTRO de una campaña que sigue
    vigente (el operador ya los pausó manualmente) se estaban EXCLUYENDO de
    pausar/revisar — pero el operador pidió verlos igual en la lista, con el
    estado real marcado (`activo_en_meli`), para no tener que ir a Mercado
    Ads a chequear uno por uno si ya están pausados.
    """
    items = [
        _item("A", status="active", acos=200.0),
        _item("B", status="idle", acos=200.0),
        _item("C", status="hold", acos=200.0),
        _item("D", status="paused", acos=200.0),
    ]
    _mockear(monkeypatch, items)

    r = R.calcular_recomendaciones_publicidad(dias=30)

    filas = {f["item_id"]: f for f in r["pausar"] + r["revisar"]}
    assert set(filas) == {"A", "B", "C", "D"}
    assert filas["A"]["activo_en_meli"] is True
    assert filas["B"]["activo_en_meli"] is False
    assert filas["C"]["activo_en_meli"] is False
    assert filas["D"]["activo_en_meli"] is False
    assert r["resumen"]["no_activos"] == 3
    assert r["resumen"]["campana_inexistente"] == 0


def test_excluye_del_todo_items_de_campana_que_ya_no_existe(monkeypatch):
    """
    Regresión ago-2026: ~56 anuncios traían `campaign_id` de una campaña que
    ya no aparece en /campaigns/search (vieja/eliminada) y aun así se colaban
    en pausar/revisar — a diferencia de un anuncio pausado dentro de una
    campaña vigente, este no tiene ningún lugar real donde verificarlo, así
    que se excluye del todo (no solo se marca).
    """
    items = [
        _item("vigente", status="active", acos=200.0, campaign_id=1),
        _item("campana_vieja", status="idle", acos=200.0, campaign_id=999),
    ]
    _mockear(monkeypatch, items)

    r = R.calcular_recomendaciones_publicidad(dias=30)

    ids_reportados = {f["item_id"] for f in r["pausar"] + r["revisar"]}
    assert ids_reportados == {"vigente"}
    assert r["resumen"]["campana_inexistente"] == 1
    assert r["resumen"]["no_activos"] == 0


def test_items_activos_ordenan_antes_que_los_ya_inactivos(monkeypatch):
    """Lo que sigue activo (necesita un clic real) va primero en la lista."""
    items = [
        _item("inactivo", status="idle", acos=500.0, costo=900_000.0),
        _item("activo", status="active", acos=200.0, costo=100_000.0),
    ]
    _mockear(monkeypatch, items)

    r = R.calcular_recomendaciones_publicidad(dias=30)

    ids_en_orden = [f["item_id"] for f in r["pausar"]]
    assert ids_en_orden[0] == "activo"  # aunque gaste menos, va antes por seguir activo
    assert ids_en_orden[1] == "inactivo"


def test_items_sin_gasto_no_cuentan_como_no_activos(monkeypatch):
    """Un item sin gasto en el período se salta por costo, no entra a ninguna lista ni cuenta."""
    items = [_item("A", status="idle", costo=0.0)]
    _mockear(monkeypatch, items)

    r = R.calcular_recomendaciones_publicidad(dias=30)

    assert r["resumen"]["no_activos"] == 0
    assert r["pausar"] == []
    assert r["revisar"] == []
