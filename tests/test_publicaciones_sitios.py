"""Vista de cómo se muestran las publicaciones en web vs MeLi."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from app.services import publicaciones as pub


def _cache_familia() -> dict:
    return {
        "sections": [
            {
                "name": "Aceites",
                "color": "#FFA500",
                "products": [
                    {
                        "name": "Aceite de Neem",
                        "ref": "C-NEEM60",
                        "rep_sku": "C-NEEM60",
                        "slug": "aceite-de-neem",
                        "family_slug": "aceite-de-neem",
                        "precio": "Desde $10.000",
                        "precio_num": 10000,
                        "lista_num": 12000,
                        "photo": "/foto-neem.png",
                        "meli_id": "MCO111",
                        "cat": "Aceites",
                        "desc": "Aceite de neem para formulación.",
                        "buyable": True,
                        "combos": [
                            {
                                "name": "ACEITE NEEM 60mL",
                                "ref": "C-NEEM60",
                                "presentacion_label": "60mL",
                                "precio_num": 10000,
                                "lista_num": 12000,
                                "meli_id": "MCO111",
                                "slug": "c-neem60",
                                "photo": "/foto-60.png",
                                "buyable": True,
                            },
                            {
                                "name": "ACEITE NEEM 250mL",
                                "ref": "C-NEEM250",
                                "presentacion_label": "250mL",
                                "precio_num": 25000,
                                "lista_num": 28000,
                                "meli_id": "",
                                "slug": "c-neem250",
                                "photo": "",
                                "buyable": True,
                            },
                        ],
                    }
                ],
            }
        ],
        "combos": [],
    }


def test_linea_info_aceites():
    info = pub._linea_info("Aceites")
    assert info["id"] == "aceites-ceras-grasas"
    assert info["nombre"] == "Aceites, ceras y grasas"


def test_aparece_en_tienda_requiere_meli():
    assert pub._aparece_en_tienda_web("MCO111", False) is True
    assert pub._aparece_en_tienda_web("", False) is False
    assert pub._aparece_en_tienda_web("MCO111", True) is False


def test_listar_y_detalle_relacionan_web_y_meli(tmp_path: Path):
    cache = tmp_path / "cache.json"
    ov = tmp_path / "overrides.json"
    cache.write_text(json.dumps(_cache_familia()), encoding="utf-8")
    ov.write_text("{}", encoding="utf-8")

    with patch.object(pub, "_CACHE_PATH", cache), patch.object(pub, "_OVERRIDES_PATH", ov):
        lista = pub.listar_publicaciones()
        assert lista["total"] == 1
        assert lista["resumen"]["listos"] == 1
        assert lista["resumen"]["sin_meli"] == 0
        item = lista["items"][0]
        assert item["url_web"] == "https://mckennagroup.co/producto/aceite-de-neem"
        assert item["linea_id"] == "aceites-ceras-grasas"
        assert item["visible_web"] is True
        assert item["n_presentaciones"] == 2

        solo_sin_meli = pub.listar_publicaciones(canal="sin_meli")
        assert solo_sin_meli["total"] == 0
        assert solo_sin_meli["resumen"]["listos"] == 1
        ambos = pub.listar_publicaciones(canal="ambos")
        assert ambos["total"] == 1

        det = pub.obtener_publicacion("C-NEEM60", live_meli=False)
        assert det is not None
        vista = det["vista_sitios"]
        assert vista["web"]["url"].endswith("/producto/aceite-de-neem")
        assert vista["web"]["es_familia"] is True
        assert vista["web"]["n_presentaciones"] == 2
        labels = {f["web"]["label"] for f in vista["presentaciones"]}
        assert labels == {"60mL", "250mL"}
        fila_60 = next(f for f in vista["presentaciones"] if f["sku"] == "C-NEEM60")
        fila_250 = next(f for f in vista["presentaciones"] if f["sku"] == "C-NEEM250")
        assert fila_60["aparece_en_web"] is True
        assert fila_60["meli"]["item_id"] == "MCO111"
        assert fila_250["aparece_en_web"] is False
        assert fila_250["meli"]["item_id"] == ""


def test_canal_ocultos(tmp_path: Path):
    cache = tmp_path / "cache.json"
    ov = tmp_path / "overrides.json"
    cache.write_text(json.dumps(_cache_familia()), encoding="utf-8")
    ov.write_text(
        json.dumps({"C-NEEM60": {"oculto_web": True, "updated_at": "2026-01-01"}}),
        encoding="utf-8",
    )
    with patch.object(pub, "_CACHE_PATH", cache), patch.object(pub, "_OVERRIDES_PATH", ov):
        lista = pub.listar_publicaciones(canal="no_en_tienda")
        assert lista["total"] == 1
        assert lista["resumen"]["no_en_tienda"] == 1
        det = pub.obtener_publicacion("C-NEEM60")
        assert det["vista_sitios"]["web"]["vitrina"] is True
        fila_60 = next(f for f in det["vista_sitios"]["presentaciones"] if f["sku"] == "C-NEEM60")
        assert fila_60["aparece_en_web"] is False
