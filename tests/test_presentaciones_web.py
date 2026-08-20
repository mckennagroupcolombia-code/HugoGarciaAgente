"""Agrupación de presentaciones en el catálogo web."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))

import website as web  # noqa: E402


def test_presentation_family_key_arbol_de_te_sinonimos():
    assert web._presentation_family_key("ACEITE ARBOL DE TE 5 mL") == "aceite arbol de te"
    assert web._presentation_family_key("ACEITE ARBOL TE 30mL") == "aceite arbol de te"
    assert web._presentation_family_key("ACEITE DE ARBOL DE TE mL") == "aceite arbol de te"
    assert web._presentation_family_key("ESENCIAL ARBOL DE TE 5mL") == "aceite arbol de te"


def test_presentation_family_key_strips_size_keeps_concentration():
    assert web._presentation_family_key("ACEITE NEEM 250mL") == "aceite neem"
    assert web._presentation_family_key("ACEITE NEEM 60mL") == "aceite neem"
    assert web._presentation_family_key("ACIDO LACTICO 85% 30mL") == "acido lactico 85%"
    assert web._presentation_family_key("RETINOL 5% 30 mL") == "retinol 5%"
    assert web._presentation_family_key("DEXTROSA Kg") == "dextrosa"
    assert "magnesio" in web._presentation_family_key("CITRATO POTASIO 250g MAGNESIO 250g")
    assert web._presentation_family_key("CITRATO POTASIO 250g") == "citrato potasio"
    assert web._presentation_family_key("ACIDO ASCORBICO 100g") == "acido ascorbico"
    assert web._presentation_family_key("VITAMINA C ACIDO ASCORBICO 250g") == "acido ascorbico"
    assert web._presentation_family_key("VITAMINA C 30% 30mL") == "acido ascorbico 30%"


def test_presentation_label():
    assert web._presentation_label("ACEITE NEEM 250mL") == "250mL"
    assert "pH" in web._presentation_label("AGUA DESTILADA 250 mL + pH")
    assert web._presentation_label("DEXTROSA Kg") == "Kg"


def test_agrupar_combos_crea_familia():
    combos = [
        {
            "name": "ACEITE NEEM 60mL",
            "ref": "C-NEEM60",
            "slug": "c-neem60",
            "precio": "$10.000",
            "precio_meli": "$12.000",
            "precio_num": 10000,
            "lista_num": 12000,
            "ahorro": "$2.000",
            "ahorro_num": 2000,
            "stock": 5,
            "buyable": True,
            "cat": "Aceites",
            "cat_color": "#2E8B7A",
            "photo": "",
            "meli_id": "",
            "desc": "",
            "ficha": None,
            "is_combo": True,
        },
        {
            "name": "ACEITE NEEM 250mL",
            "ref": "C-NEEM250",
            "slug": "c-neem250",
            "precio": "$25.000",
            "precio_meli": "$30.000",
            "precio_num": 25000,
            "lista_num": 30000,
            "ahorro": "$5.000",
            "ahorro_num": 5000,
            "stock": 3,
            "buyable": True,
            "cat": "Aceites",
            "cat_color": "#2E8B7A",
            "photo": "/foto.jpg",
            "meli_id": "MCO1",
            "desc": "",
            "ficha": None,
            "is_combo": True,
        },
        {
            "name": "UREA COSMETICA 250g",
            "ref": "C-UREA250",
            "slug": "c-urea250",
            "precio": "$15.000",
            "precio_meli": "$18.000",
            "precio_num": 15000,
            "lista_num": 18000,
            "ahorro": "$3.000",
            "ahorro_num": 3000,
            "stock": 10,
            "buyable": True,
            "cat": "Activos",
            "cat_color": "#2E8B7A",
            "photo": "",
            "meli_id": "",
            "desc": "",
            "ficha": None,
            "is_combo": True,
        },
    ]
    used = {c["slug"] for c in combos}
    cards = web._agrupar_combos_por_presentacion(combos, used)
    assert len(cards) == 2
    fam = next(c for c in cards if c.get("is_family"))
    single = next(c for c in cards if not c.get("is_family"))
    assert fam["n_presentaciones"] == 2
    assert len(fam["combos"]) == 2
    assert "neem" in fam["name"].lower() or "neem" in fam["slug"]
    assert fam["precio"].startswith("Desde")
    assert {c["ref"] for c in fam["combos"]} == {"C-NEEM60", "C-NEEM250"}
    assert single["ref"] == "C-UREA250"
    assert combos[0]["has_siblings"] is True
    assert combos[0]["family_slug"] == fam["slug"]


def _combo(name, ref, slug, precio_num, **extra):
    d = {
        "name": name,
        "ref": ref,
        "slug": slug,
        "precio": f"${precio_num:,}".replace(",", "."),
        "precio_meli": f"${int(precio_num * 1.2):,}".replace(",", "."),
        "precio_num": precio_num,
        "lista_num": precio_num * 1.2,
        "ahorro": "$1.000",
        "ahorro_num": 1000,
        "stock": 5,
        "buyable": True,
        "cat": "Suplementarios",
        "cat_color": "#2E8B7A",
        "photo": "",
        "meli_id": "",
        "desc": "",
        "ficha": None,
        "is_combo": True,
    }
    d.update(extra)
    return d


def test_dedupe_misma_presentacion_prefiere_sku_combo():
    combos = [
        _combo("CREATINA MONOHIDRATO 100g", "CREMON100g", "cremon100g", 10000),
        _combo("CREATINA MONOHIDRATO 100g", "C-CREMON100g", "c-cremon100g", 10000, photo="/a.jpg"),
        _combo("CREATINA MONOHIDRATO 250g", "C-CREMON250g", "c-cremon250g", 20000),
        _combo("CREATINA MONOHIDRATO 250g", "CREMON250g", "cremon250g", 20000),
    ]
    used = {c["slug"] for c in combos}
    cards = web._agrupar_combos_por_presentacion(combos, used)
    assert len(cards) == 1
    fam = cards[0]
    assert fam["is_family"] is True
    assert fam["n_presentaciones"] == 2
    refs = {c["ref"] for c in fam["combos"]}
    assert refs == {"C-CREMON100g", "C-CREMON250g"}
    assert combos[0]["canonical_pres_slug"] == "c-cremon100g"
    assert combos[0]["family_slug"] == fam["slug"]


def test_ascorbico_y_vitamina_c_misma_familia():
    combos = [
        _combo("ACIDO ASCORBICO 100g", "C-VITCACIASC100g", "c-vitc100", 8000, cat="Ácidos"),
        _combo("VITAMINA C ACIDO ASCORBICO 250g", "C-VITCACIASC250g", "c-vitc250", 15000, cat="Ácidos"),
        _combo("VITAMINA C ACIDO ASCORBICO 500g", "C-VITCACIASC500g", "c-vitc500", 25000, cat="Ácidos"),
        _combo("VITAMINA C 30% 30mL", "C-VITC30P30mL", "c-vitc30", 12000, cat="Ácidos"),
    ]
    used = {c["slug"] for c in combos}
    cards = web._agrupar_combos_por_presentacion(combos, used)
    fam = next(c for c in cards if c.get("is_family"))
    singles = [c for c in cards if not c.get("is_family")]
    assert fam["n_presentaciones"] == 3
    assert {x["ref"] for x in fam["combos"]} == {
        "C-VITCACIASC100g",
        "C-VITCACIASC250g",
        "C-VITCACIASC500g",
    }
    assert len(singles) == 1
    assert singles[0]["ref"] == "C-VITC30P30mL"


def test_agrupar_arbol_de_te_misma_familia():
    combos = [
        _combo("ACEITE ARBOL DE TE 5 mL", "C-ACEITEATRE5mL", "c-aceiteatre5ml", 14500, cat="Aceites"),
        _combo("ACEITE ARBOL TE 30mL", "C-ACETEATRE30mL", "c-aceteatre30ml", 28000, cat="Aceites"),
    ]
    used = {c["slug"] for c in combos}
    cards = web._agrupar_combos_por_presentacion(combos, used)
    assert len(cards) == 1
    fam = cards[0]
    assert fam["is_family"] is True
    assert fam["n_presentaciones"] == 2
    assert {c["ref"] for c in fam["combos"]} == {"C-ACEITEATRE5mL", "C-ACETEATRE30mL"}
    assert "árbol" in fam["name"].lower() or "arbol" in fam["name"].lower()


def test_variante_color_no_comparte_titulo_canonico():
    combos = [
        _combo("MANTECA KARITE AMARILLA 250g", "C-MANKARAMA250g", "c-mankara250", 15000, cat="Ceras y Mantecas"),
        _combo("MANTECA KARITE AMARILLA 500g", "C-MANKARAMA500g", "c-mankara500", 25000, cat="Ceras y Mantecas"),
        _combo("MANTECA KARITE BLANCA 125g", "C-MANKARBLA125g", "c-mankarbla125", 12000, cat="Ceras y Mantecas"),
        _combo("MANTECA KARITE BLANCA 500g", "C-MANKARBLA500g", "c-mankarbla500", 24000, cat="Ceras y Mantecas"),
    ]
    used = {c["slug"] for c in combos}
    cards = web._agrupar_combos_por_presentacion(combos, used)
    assert len(cards) == 2
    names = sorted(c["name"].lower() for c in cards)
    assert any("amarilla" in n for n in names)
    assert any("blanca" in n for n in names)


def test_dedupe_solo_alias_no_crea_familia():
    combos = [
        _combo("DEXTROSA Kg", "DEXKg", "dexkg", 8000),
        _combo("DEXTROSA Kg", "C-DEXKg", "c-dexkg", 8000),
    ]
    used = {c["slug"] for c in combos}
    cards = web._agrupar_combos_por_presentacion(combos, used)
    assert len(cards) == 1
    only = cards[0]
    assert only.get("is_family") is False
    assert only["ref"] == "C-DEXKg"
    assert combos[0]["canonical_pres_slug"] == "c-dexkg"
    assert combos[0]["has_siblings"] is False


def test_catalog_tiene_fichas():
    assert web._catalog_tiene_fichas([]) is False
    assert web._catalog_tiene_fichas([{"name": "X", "products": []}]) is False
    assert web._catalog_tiene_fichas([{"name": "X", "products": [{"ref": "A"}]}]) is True


def test_aplicar_stock_en_familia():
    fam = {
        "is_family": True,
        "ref": "C-NEEM250",
        "rep_sku": "C-NEEM250",
        "stock": 3,
        "buyable": True,
        "combos": [
            {"ref": "C-NEEM60", "stock": 5, "buyable": True},
            {"ref": "C-NEEM250", "stock": 3, "buyable": True},
        ],
    }
    assert web._aplicar_stock_en_item(fam, "C-NEEM60", 0) is True
    assert fam["combos"][0]["buyable"] is False
    assert fam["combos"][1]["buyable"] is True
    assert fam["buyable"] is True
    web._aplicar_stock_en_item(fam, "C-NEEM250", 0)
    assert fam["buyable"] is False


def test_categoria_publicacion_web_materia_prima():
    assert web.categoria_publicacion_web("C-ACEESEMEN5mL", "Aceite Esencial De Menta") == "Aceites Esenciales"
    assert web.categoria_publicacion_web("C-CERCARNKg", "Cera Carnauba Kg") == "Ceras y Mantecas"
    assert web.categoria_publicacion_web("C-TEGBET500ML", "Betaina De Coco 500ml") == "Emulsionantes y Surfactantes"
    assert web.categoria_publicacion_web("C-SUC100g", "Sucralosa 100gr") == "Edulcorantes"
    assert web.categoria_publicacion_web("KTBKRLAB", "Kit Vasos Laboratorio Beakers") == "Equipos y Materiales"


def test_categoria_publicacion_web_excluye_ferreteria():
    assert web.categoria_publicacion_web("DSCVDR", "Disco De Corte De Diamante") is None
    assert web.categoria_publicacion_web("EXTELC5MTS", "Extensión Eléctrica Profesional") is None
    assert web.categoria_publicacion_web("PERR", "Perilla De Palanca De Cambios") is None
    assert web.categoria_publicacion_web("OILBMBVC", "Aceite Para Bomba De Vacío Premium") is None
    assert web.categoria_publicacion_web("KTEXTART18PZS", "Repuestos Extrusor Artillery") is None


def test_meli_item_para_combo_no_cruza_por_nombre():
    limon = {"id": "MCO1", "_seller_sku": "C-ACEESELIM5mL", "title": "Aceite Esencial De Limon", "_price": 21900}
    jen = {"id": "MCO2", "_seller_sku": "C-ACEESEJEN5mL", "title": "Aceite Esencial De Jengibre", "_price": 17500}
    by_sku, by_c = web._indice_meli_por_sku([limon, jen])
    item, kind = web._meli_item_para_combo("C-ACEESELIM5mL", by_sku, by_c, "ACEITE ESENCIAL LIMON 5mL")
    assert kind == "sku"
    assert item["id"] == "MCO1"
    item2, _ = web._meli_item_para_combo("C-ACEESEJEN5mL", by_sku, by_c, "ACEITE ESENCIAL JENGIBRE 5mL")
    assert item2["id"] == "MCO2"


def test_identidad_esencial_no_mezcla_jazmin_limon():
    j = web._identidad_nombre_catalogo("ACEITE ESENCIAL JAZMIN 5mL")
    l = web._identidad_nombre_catalogo("Aceite Esencial De Limon")
    assert "jazmin" in j
    assert "limon" in l
    assert j != l


def test_sku_meli_cruzado_se_descarta_si_el_titulo_es_otro_aceite():
    jen = {"id": "MCO2", "_seller_sku": "C-ACEESELIM5mL", "title": "Aceite Esencial De Jengibre", "_price": 17500}
    lim = {"id": "MCO3", "_seller_sku": "C-ACEESENLIM5mL", "title": "Aceite Esencial De Limon", "_price": 21900}
    by_sku, by_c = web._indice_meli_por_sku([jen, lim])
    item, kind = web._meli_item_para_combo("C-ACEESELIM5mL", by_sku, by_c, "ACEITE ESENCIAL LIMON 5mL")
    assert item is None
    assert kind == ""


def test_titulo_vacio_no_toma_precio_de_otro_sku():
    ghost = {"id": "MCO9", "_seller_sku": "OILESNLMN5ML", "title": "", "_price": 19000, "status": "active"}
    by_sku, by_c = web._indice_meli_por_sku([ghost])
    item, kind = web._meli_item_para_combo("OILESNLMN5mL", by_sku, by_c, "Aceite Esencial Limon 5 mL")
    assert item is None
    assert kind == ""


def test_identidad_unica_no_usa_publicacion_de_otro_aceite():
    jazmin = {
        "id": "MCOJ",
        "_seller_sku": "OILESNLMN5ML",
        "title": "Aceite Esencial De Jazmin",
        "_price": 19000,
        "status": "active",
    }
    item, kind = web._meli_item_por_identidad_unica("ACEITE ESENCIAL LIMON 5mL", [jazmin])
    assert item is None
    limon = {
        "id": "MCOL",
        "_seller_sku": "C-ACEESENLIM5mL",
        "title": "Aceite Esencial De Limon",
        "_price": 21900,
        "status": "paused",
    }
    item, kind = web._meli_item_por_identidad_unica("ACEITE ESENCIAL LIMON 5mL", [jazmin, limon])
    assert kind == "identity"
    assert item["id"] == "MCOL"


def test_aplicar_precio_maestro_meli_10pct():
    combo = {"ref": "C-ACEESELIM5mL", "name": "ACEITE ESENCIAL LIMON 5mL"}
    web._aplicar_precio_maestro_meli(combo, 21900)
    assert combo["lista_num"] == 21900
    assert combo["precio_meli_num"] == 21900
    assert combo["precio_num"] == 19710
    assert combo["ahorro_num"] == 2190


def test_combo_publicado_en_meli_requiere_mco():
    assert web._combo_publicado_en_meli({"meli_id": "MCO123"})
    assert web._combo_publicado_en_meli({"meli_id": "mco999"})
    assert not web._combo_publicado_en_meli({"meli_id": ""})
    assert not web._combo_publicado_en_meli({"meli_id": "MLA123"})
    assert not web._combo_publicado_en_meli({})


def test_catalogo_web_solo_publicaciones_meli():
    combos = [
        _combo("ACEITE NEEM 60mL", "C-NEEM60", "c-neem60", 10000, cat="Aceites"),
        _combo(
            "ACEITE NEEM 250mL",
            "C-NEEM250",
            "c-neem250",
            25000,
            cat="Aceites",
            meli_id="MCO1",
            photo="https://a.jpg",
        ),
        _combo("UREA COSMETICA 250g", "C-UREA250", "c-urea250", 15000),
    ]
    sections = web._catalog_sections_from_combos(combos)
    refs = []
    for s in sections:
        for p in s["products"]:
            if p.get("is_family"):
                refs.extend(c["ref"] for c in p["combos"])
            else:
                refs.append(p["ref"])
    assert refs == ["C-NEEM250"]
    assert len(sections) == 1
    assert not sections[0]["products"][0].get("is_family")


def test_meli_item_photos_todas_las_urls():
    item = {
        "pictures": [
            {"secure_url": "https://a.jpg"},
            {"url": "http://b.jpg"},
            {"secure_url": "https://a.jpg"},
            {},
            {"secure_url": "https://c.jpg"},
        ]
    }
    assert web._meli_item_photos(item) == ["https://a.jpg", "http://b.jpg", "https://c.jpg"]
    assert web._meli_item_photo(item) == "https://a.jpg"


def test_fotos_de_producto_usa_galeria_completa():
    p = {
        "ref": "C-TESTGALERIA999",
        "photo": "https://a.jpg",
        "photos": ["https://a.jpg", "https://b.jpg", "https://c.jpg"],
    }
    assert web._fotos_de_producto(p) == ["https://a.jpg", "https://b.jpg", "https://c.jpg"]


def test_fotos_de_producto_fallback_foto_unica():
    assert web._fotos_de_producto({"ref": "C-TESTGALERIA998", "photo": "https://a.jpg"}) == ["https://a.jpg"]
    assert web._fotos_de_producto({"ref": "C-TESTGALERIA997"}) == []


def test_fotos_de_producto_override_panel(tmp_path, monkeypatch):
    import json

    f = tmp_path / "ov.json"
    f.write_text(
        json.dumps({"C-TESTGALERIA996": {"imagenes_web": ["local1.png", "local2.png"]}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(web, "PUB_OVERRIDES_FILE", f)
    p = {"ref": "C-TESTGALERIA996", "photos": ["https://a.jpg"]}
    assert web._fotos_de_producto(p) == [
        "/imagenes-productos-catalogo/local1.png",
        "/imagenes-productos-catalogo/local2.png",
    ]


def test_familia_copia_galeria_en_presentaciones():
    combos = [
        _combo(
            "ACEITE NEEM 60mL",
            "C-NEEM60",
            "c-neem60",
            10000,
            cat="Aceites",
            photo="https://a.jpg",
            photos=["https://a.jpg", "https://b.jpg"],
        ),
        _combo(
            "ACEITE NEEM 250mL",
            "C-NEEM250",
            "c-neem250",
            25000,
            cat="Aceites",
            photo="https://c.jpg",
            photos=["https://c.jpg", "https://d.jpg"],
        ),
    ]
    used = {c["slug"] for c in combos}
    cards = web._agrupar_combos_por_presentacion(combos, used)
    fam = cards[0]
    by_ref = {c["ref"]: c for c in fam["combos"]}
    assert by_ref["C-NEEM60"]["photos"] == ["https://a.jpg", "https://b.jpg"]
    assert by_ref["C-NEEM250"]["photos"] == ["https://c.jpg", "https://d.jpg"]


def test_enriquecer_galeria_meli_rellena_photos(monkeypatch):
    combos = [
        {"ref": "C-X", "meli_id": "MCO1", "photo": "https://a.jpg"},
        {"ref": "C-Y", "meli_id": "MCO2", "photos": ["https://ya.jpg"]},
        {"ref": "C-Z", "meli_id": "", "photo": ""},
    ]
    monkeypatch.setattr(
        web,
        "_fetch_meli_pictures_by_ids",
        lambda token, ids: {"MCO1": ["https://a.jpg", "https://b.jpg", "https://c.jpg"]},
    )
    monkeypatch.setattr(web, "get_meli_token", lambda: "tok")
    n = web._enriquecer_galeria_meli_en_combos(combos)
    assert n == 1
    assert combos[0]["photos"] == ["https://a.jpg", "https://b.jpg", "https://c.jpg"]
    assert combos[1]["photos"] == ["https://ya.jpg"]


def test_aplicar_precios_copia_photos_meli():
    combo = {"ref": "C-TESTPX", "name": "Producto test", "photo_match_type": ""}
    photo_map = {
        "C-TESTPX": {
            "match_type": "sku",
            "photo": "https://a.jpg",
            "photos": ["https://a.jpg", "https://b.jpg"],
            "meli_id": "MCO1",
            "title": "Producto test",
            "price": 10000,
            "score": 100,
        }
    }
    web.aplicar_precios_meli_a_combos([combo], photo_map)
    assert combo["photos"] == ["https://a.jpg", "https://b.jpg"]
    assert combo["photo"] == "https://a.jpg"
    assert combo["meli_id"] == "MCO1"


