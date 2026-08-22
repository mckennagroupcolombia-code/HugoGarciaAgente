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


def _png_bytes() -> bytes:
    from io import BytesIO
    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (40, 40), (220, 40, 40)).save(buf, format="PNG")
    return buf.getvalue()


def test_adjuntar_imagenes_desde_galeria_copia_a_otro_sku(tmp_path: Path):
    img_dir = tmp_path / "imgs"
    img_dir.mkdir()
    src = img_dir / "C-NEEM60.png"
    src.write_bytes(_png_bytes())
    ov = tmp_path / "overrides.json"
    ov.write_text("{}", encoding="utf-8")
    siigo = tmp_path / "siigo_fotos.json"
    siigo.write_text("{}", encoding="utf-8")

    with (
        patch.object(pub, "_IMAGENES_DIR", img_dir),
        patch.object(pub, "_OVERRIDES_PATH", ov),
        patch.object(pub, "_SIIGO_FOTOS_FILE", siigo),
    ):
        ya = pub.adjuntar_imagenes_desde_galeria(
            "C-NEEM60", filenames=["C-NEEM60.png"], targets=["web"]
        )
        assert ya["ok"]
        assert ya["archivos"][0]["web"]["skipped"] is True

        res = pub.adjuntar_imagenes_desde_galeria(
            "C-NEEM250", filenames=["C-NEEM60.png"], targets=["web"]
        )
        assert res["ok"] is True
        assert res["copiadas"] == 1
        assert res["archivos"][0]["web"]["ok"] is True
        nuevo = res["archivos"][0]["web"]["filename"]
        assert nuevo.startswith("C-NEEM250")
        assert (img_dir / nuevo).is_file()
        assert src.is_file()  # origen intacto

        vacio = pub.adjuntar_imagenes_desde_galeria("C-NEEM250", filenames=[], targets=["web"])
        assert vacio["ok"] is False


def test_eliminar_imagen_web_quita_archivo_y_deja_de_listarse(tmp_path: Path):
    img_dir = tmp_path / "imgs"
    img_dir.mkdir()
    foto = img_dir / "C-NEEM60.png"
    foto.write_bytes(_png_bytes())
    ov = tmp_path / "overrides.json"
    ov.write_text("{}", encoding="utf-8")
    siigo = tmp_path / "siigo_fotos.json"
    siigo.write_text("{}", encoding="utf-8")

    with (
        patch.object(pub, "_IMAGENES_DIR", img_dir),
        patch.object(pub, "_OVERRIDES_PATH", ov),
        patch.object(pub, "_SIIGO_FOTOS_FILE", siigo),
    ):
        assert len(pub.escanear_imagenes_web("C-NEEM60")) == 1
        res = pub.eliminar_imagen_web("C-NEEM60", "C-NEEM60.png")
        assert res["ok"] is True
        assert res["borrado"] is True
        assert not foto.exists()
        assert pub.escanear_imagenes_web("C-NEEM60") == []


def test_eliminar_imagen_meli_acepta_sku_y_quita_picture():
    pics = [
        {"id": "AAA", "url": "https://x/a.jpg", "principal": True},
        {"id": "BBB", "url": "https://x/b.jpg", "principal": False},
    ]
    with (
        patch.object(pub, "_meli_get_pictures", return_value=(pics, "")),
        patch.object(pub, "_meli_set_pictures", return_value={"ok": True, "total_pictures": 1}) as setter,
    ):
        res = pub.eliminar_imagen_meli("MCO111", "BBB", sku="C-NEEM60")
        assert res["ok"] is True
        setter.assert_called_once_with("MCO111", ["AAA"])

