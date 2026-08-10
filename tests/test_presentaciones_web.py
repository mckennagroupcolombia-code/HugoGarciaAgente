"""Agrupación de presentaciones en el catálogo web."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))

import website as web  # noqa: E402


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
