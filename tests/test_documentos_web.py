"""Documentos técnicos completos de la biblioteca en la ficha pública."""

from __future__ import annotations

from pathlib import Path

from app.services.documentos_web import (
    buscar_documento_completo_web,
    listar_documentos_completos_web,
    nombre_base_producto_web,
)
from app.services.ficha_tecnica import ruta_archivo_biblioteca_segura


def test_nombre_base_quita_presentacion() -> None:
    assert nombre_base_producto_web("Lactato de Calcio 250 g") == "lactato de calcio"
    assert nombre_base_producto_web("Ácido Salicílico 100g") == "acido salicilico"


def test_lista_documentos_completos_exige_pdf_en_biblioteca() -> None:
    docs = listar_documentos_completos_web(forzar=True)
    assert len(docs) >= 40
    assert all(d.get("pdf_nombre") for d in docs)
    assert all(ruta_archivo_biblioteca_segura(d["pdf_nombre"]) for d in docs)
    lactato = next(d for d in docs if "lactato" in d["clave"] and "calcio" in d["clave"])
    assert lactato["coa"]["parametros"]
    assert lactato["sds"]["clasificacion"]
    assert lactato["ft"]["descripcion"]
    titulos = {d["titulo"] for d in docs}
    assert "ACEITE ARGAN" in titulos
    assert not any("HIDROLIZADODROLIZADO" in t for t in titulos)


def test_busca_por_nombre_de_tienda_y_sku() -> None:
    por_nombre = buscar_documento_completo_web("Lactato de Calcio 500 g")
    assert por_nombre is not None
    assert por_nombre["titulo"] == "LACTATO DE CALCIO"
    por_sku = buscar_documento_completo_web("Otro nombre", "LACCALg")
    assert por_sku is not None
    assert por_sku["titulo"] == "LACTATO DE CALCIO"


def test_no_publica_producto_sin_documento_completo() -> None:
    assert buscar_documento_completo_web("Producto Inexistente XYZ 250g") is None


def test_pagina_producto_renderiza_estetica_protocolo(monkeypatch) -> None:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))
    import website

    doc = buscar_documento_completo_web("Lactato de Calcio")
    assert doc is not None
    monkeypatch.setattr(website, "find_product", lambda slug: {
        "name": "Lactato de Calcio",
        "ref": "LACCALg",
        "slug": slug,
        "cat": "Sales Minerales",
        "precio": "$12.500",
        "precio_meli": "$14.000",
        "stock": None,
        "ficha": None,
        "is_combo": True,
        "buyable": True,
        "photo": "",
        "desc": "",
    })
    monkeypatch.setattr(website, "get_catalog", lambda: [])
    monkeypatch.setattr(website, "_fotos_de_producto", lambda _p: [])
    c = website.app.test_client()
    r = c.get("/producto/lactato-de-calcio")
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    assert "Documentación técnica" in html
    assert "Ficha Técnica" in html
    assert "protocol-title" in html
    assert "LACTATO DE CALCIO" in html
    assert "Certificado de Análisis" in html
    assert "documentos-tecnicos/" in html


def test_pdf_completo_se_sirve_y_bloquea_path_traversal() -> None:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))
    import website

    doc = buscar_documento_completo_web("Lactato de Calcio")
    assert doc and doc["pdf_nombre"]
    c = website.app.test_client()
    ok = c.get(f"/documentos-tecnicos/{doc['pdf_nombre']}")
    assert ok.status_code == 200
    assert ok.mimetype == "application/pdf"
    bad = c.get("/documentos-tecnicos/../website.py")
    assert bad.status_code == 404
