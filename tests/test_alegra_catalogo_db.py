"""Catálogo local Alegra (SQLite espejo)."""
from __future__ import annotations

import pytest


@pytest.fixture()
def catalogo_mod(monkeypatch, tmp_path):
    db = tmp_path / "contabilidad_test.db"
    import app.services.contabilidad_db as cdb
    import app.services.alegra_catalogo_db as cat

    monkeypatch.setattr(cdb, "_DB_PATH", str(db))
    monkeypatch.setattr(cdb, "_initialized", False)
    cdb.init_db()
    return cat


def test_upsert_listar_obtener_kit(catalogo_mod):
    cat = catalogo_mod
    cat.upsert_item(
        alegra_id="1",
        reference="UREAg",
        name="UREA COSMETICA g",
        tipo="product",
        unit="gram",
        unit_cost=100.0,
        precio_lista=0,
        iva=True,
    )
    cat.upsert_item(
        alegra_id="2",
        reference="C-UREA250g",
        name="UREA COSMETICA 250 g",
        tipo="kit",
        precio_lista=25000,
        iva=True,
        componentes=[
            {"reference": "UREAg", "name": "UREA COSMETICA g", "quantity": 250},
            {"codigo": "FRAS250", "nombre": "FRASCO 250", "cantidad": 1},
        ],
    )
    listed = cat.listar_items(q="UREA", limit=20)
    assert listed["total"] >= 2
    refs = {i["reference"] for i in listed["items"]}
    assert "UREAg" in refs
    assert "C-UREA250g" in refs

    kits = cat.listar_items(tipo="kit")
    assert all(i["type"] == "kit" for i in kits["items"])
    assert kits["total"] == 1

    det = cat.obtener_item("C-UREA250g")
    assert det is not None
    assert det["type"] == "kit"
    assert len(det["componentes"]) == 2
    codigos = {c["codigo"] for c in det["componentes"]}
    assert "UREAg" in codigos
    assert "FRAS250" in codigos


def test_buscar_picker_local_excluye_kits(catalogo_mod):
    cat = catalogo_mod
    cat.upsert_item(alegra_id="1", reference="AJONEGg", name="AJONJOLI NEGRO g", tipo="product")
    cat.upsert_item(
        alegra_id="2",
        reference="C-AJONEG250g",
        name="AJONJOLI NEGRO 250 g",
        tipo="kit",
        componentes=[{"reference": "AJONEGg", "quantity": 250}],
    )
    solo = cat.buscar_picker_local("AJONEG", excluir_combos=True)
    assert all(x["type"] == "Product" for x in solo)
    assert any(x["codigo"] == "AJONEGg" for x in solo)
    ambos = cat.buscar_picker_local("AJONEG", excluir_combos=False)
    assert any(x["type"] == "Combo" for x in ambos)


def test_catalogo_stale_sin_filas(catalogo_mod):
    cat = catalogo_mod
    assert cat.catalogo_stale() is True
    cat.upsert_item(alegra_id="1", reference="X", name="X", tipo="product")
    assert cat.catalogo_stale() is False


def test_borrar_y_actualizar_locales(catalogo_mod):
    cat = catalogo_mod
    cat.upsert_item(
        alegra_id="9",
        reference="TMPTEST",
        name="TMP",
        tipo="product",
        precio_lista=1000,
    )
    assert cat.obtener_item("TMPTEST") is not None
    upd = cat.actualizar_campos_locales("TMPTEST", name="TMP NUEVO", precio_lista=2500)
    assert upd is not None
    assert upd["name"] == "TMP NUEVO"
    assert upd["precio_lista"] == 2500
    assert cat.borrar_item_local("TMPTEST") is True
    assert cat.obtener_item("TMPTEST") is None


def test_listar_incluye_conteos(catalogo_mod):
    cat = catalogo_mod
    cat.upsert_item(alegra_id="1", reference="P1", name="Prod", tipo="product")
    cat.upsert_item(alegra_id="2", reference="P2", name="Prod2", tipo="product")
    cat.upsert_item(
        alegra_id="3",
        reference="C1",
        name="Combo",
        tipo="kit",
        componentes=[{"reference": "P1", "quantity": 1}],
    )
    out = cat.listar_items(tipo="product")
    assert out["conteos"]["product"] == 2
    assert out["conteos"]["kit"] == 1
    assert out["total"] == 2


def test_sync_en_hilo_no_pisa_ok(catalogo_mod, monkeypatch):
    """Al disparar en hilo, la respuesta debe llevar ok=True (no el ok=None del estado)."""
    cat = catalogo_mod

    def _fake_spawn(target, *a, **k):
        class _T:
            pass
        return _T()

    monkeypatch.setattr("app.observability.spawn_thread", _fake_spawn)
    out = cat.sincronizar_catalogo_alegra(en_hilo=True)
    assert out["ok"] is True
    assert out.get("started") is True
    assert out.get("running") is True


def test_upsert_desde_alegra_raw(catalogo_mod, monkeypatch):
    cat = catalogo_mod
    monkeypatch.setattr(
        "app.services.alegra._resolver_referencia_item_alegra",
        lambda item_id: {"reference": "COMP1", "name": "COMPONENTE 1"},
    )
    raw = {
        "id": 99,
        "reference": "C-TEST250g",
        "name": "TEST 250 g",
        "type": "kit",
        "status": "active",
        "price": [{"price": 12000}],
        "tax": [{"id": 1}],
        "inventory": {"unit": "unit"},
        "subitems": [
            {"item": {"id": "55", "name": "COMP"}, "quantity": 250},
        ],
    }
    cat.upsert_item_desde_alegra(raw)
    det = cat.obtener_item("C-TEST250g")
    assert det["precio_lista"] == 12000
    assert det["iva"] == 1
    assert det["componentes"][0]["codigo"] == "COMP1"
    assert det["componentes"][0]["cantidad"] == 250
