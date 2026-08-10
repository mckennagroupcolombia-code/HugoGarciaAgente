"""Inventario de papel de etiquetas: datos en disco y acceso con token admin."""

from __future__ import annotations

import json
from pathlib import Path

INV_PATH = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "data"
    / "etiquetas_inventario_consumibles.json"
)


def test_inventario_papel_en_disco_tiene_rollos():
    data = json.loads(INV_PATH.read_text(encoding="utf-8"))
    items = data.get("items") or []
    papeles = [it for it in items if (it.get("tipo") or "").lower() == "papel"]
    assert len(papeles) >= 8, f"Se esperaban rollos persistidos; hay {len(papeles)}"
    refs = {str(it.get("ref") or "") for it in papeles}
    assert "PASTILLERO" in refs
    assert "250 / 500 g" in refs
    for it in papeles:
        assert "rollos" in it
        assert float(it.get("ancho_mm") or 0) > 0
        assert float(it.get("alto_mm") or 0) > 0


def test_es_cynthia_etiquetas_acepta_id_string():
    from app.services.tickets_db import es_cynthia_etiquetas

    assert es_cynthia_etiquetas({"id": 6, "username": "x"})
    assert es_cynthia_etiquetas({"id": "6", "username": "x"})
    assert es_cynthia_etiquetas({"id": 1, "username": "cynthia"})
    assert not es_cynthia_etiquetas(None)
    assert not es_cynthia_etiquetas({"id": 1, "username": "hugo", "email": "hugo@x.com"})
