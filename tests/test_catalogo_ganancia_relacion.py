"""Catálogo Ganancia: SKU canónico desde relacion_codigos."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from app.services.rentabilidad import _catalogo_publicaciones_meli


def test_catalogo_prefiere_sku_relacion_sobre_cobros_erroneo(tmp_path: Path):
    """C-SORPOT100g (relación) gana a C-SORPOTKg (cobros) en el mismo MCO."""
    cobros = tmp_path / "meli_cobros_cache.json"
    rel = tmp_path / "relacion_codigos_cache.json"
    web = tmp_path / "cache.json"

    cobros.write_text(
        json.dumps(
            {
                "items": [
                    {
                        "meli_id": "MCO918784392",
                        "sku": "C-SORPOTKg",
                        "nombre": "SORBATO POTASIO Kg",
                        "precio_meli": 46000,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    rel.write_text(
        json.dumps(
            {
                "items": [
                    {
                        "meli_id": "MCO918784392",
                        "sku_meli": "C-SORPOT100g",
                        "codigo_siigo": "C-SORPOT100g",
                        "nombre_siigo": "SORBATO POTASIO 100g",
                        "titulo": "Sorbato",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    web.write_text(
        json.dumps(
            {
                "combos": [
                    {
                        "ref": "C-SORPOTKg",
                        "meli_id": "MCO918784392",
                        "name": "SORBATO POTASIO Kg",
                    },
                    {
                        "ref": "C-SORPOT100g",
                        "meli_id": "MCO918784392",
                        "name": "SORBATO POTASIO 100g",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    with (
        patch("app.services.rentabilidad._COBROS_MELI_CACHE_PATH", str(cobros)),
        patch("app.services.rentabilidad._RELACION_CODIGOS_CACHE_PATH", str(rel)),
        patch("app.services.rentabilidad._WEB_CACHE_PATH", str(web)),
    ):
        cat = _catalogo_publicaciones_meli()

    assert len(cat) == 1
    assert cat[0]["sku"] == "C-SORPOT100g"
    assert cat[0]["meli_id"] == "MCO918784392"
    assert "100g" in cat[0]["nombre"]
