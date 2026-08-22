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
    assert len(docs) >= 30
    assert all(d.get("pdf_nombre") for d in docs)
    assert all(ruta_archivo_biblioteca_segura(d["pdf_nombre"]) for d in docs)
    assert all(d.get("coa") and d.get("sds") for d in docs)
    lactato = next(d for d in docs if "lactato" in d["clave"] and "calcio" in d["clave"])
    assert lactato["coa"]["parametros"]
    assert lactato["sds"]["clasificacion"]
    assert lactato["ft"]["descripcion"]
    titulos = {d["titulo"] for d in docs}
    assert "CAOLIN USP" in titulos
    assert not any("HIDROLIZADODROLIZADO" in t for t in titulos)


def test_busca_por_nombre_de_tienda_y_sku() -> None:
    por_nombre = buscar_documento_completo_web("Lactato de Calcio 500 g")
    assert por_nombre is not None
    assert por_nombre["titulo"] == "LACTATO DE CALCIO"
    por_sku = buscar_documento_completo_web("Otro nombre", "LACCALg")
    assert por_sku is not None
    assert por_sku["titulo"] == "LACTATO DE CALCIO"


def test_no_publica_si_falta_coa_o_sds(monkeypatch, tmp_path) -> None:
    from app.services import documentos_web as dw

    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(dw, "ruta_archivo_biblioteca_segura", lambda _n: pdf)

    base = {"_tipo": "completo", "titulo": "TEST INCOMPLETO WEB", "nombre_producto": "TEST INCOMPLETO WEB"}
    assert dw._contexto_publico(base) is None
    solo_coa = {**base, "_coa": {"parametros": [["pH", "5-7", "6.0"]]}}
    assert dw._contexto_publico(solo_coa) is None
    solo_sds = {**base, "_sds": {"peligros": {"clasificacion": "No clasificado"}}}
    assert dw._contexto_publico(solo_sds) is None
    completo = {
        **base,
        "_coa": {"parametros": [["pH", "5-7", "6.0"]]},
        "_sds": {"peligros": {"clasificacion": "No clasificado"}},
    }
    ctx = dw._contexto_publico(completo)
    assert ctx is not None
    assert ctx["coa"]["parametros"]
    assert ctx["sds"]["clasificacion"]


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
    assert "Ficha técnica" in html
    assert "Certificado de análisis" in html
    assert "documentos-tecnicos/" in html
    assert "seccion=coa" in html


def test_invalidar_indice_rompe_cache_en_memoria() -> None:
    import time

    from app.services import documentos_web as dw

    docs = dw.listar_documentos_completos_web(forzar=True)
    assert docs
    dw._CACHE["docs"] = [{"titulo": "SENTINEL_CACHE"}]
    dw._CACHE["ts"] = time.time()
    dw._CACHE["epoch"] = dw._epoch_mtime()
    assert dw.listar_documentos_completos_web()[0]["titulo"] == "SENTINEL_CACHE"
    dw.invalidar_indice_documentos_web()
    fresh = dw.listar_documentos_completos_web()
    assert fresh[0]["titulo"] != "SENTINEL_CACHE"
    assert len(fresh) == len(docs)


def test_publicar_documentos_sin_avisar_sitio() -> None:
    from app.services.documentos_web import publicar_documentos_en_web

    out = publicar_documentos_en_web(avisar_sitio=False)
    assert out["ok"] is True
    assert out["total"] >= 30
    assert out["total"] == out["con_coa"] == out["con_sds"]
    assert out["sitio"].get("omitido") is True
    assert "LACTATO DE CALCIO" in out["titulos"]


def test_web_documentos_refresh_requiere_auth(monkeypatch) -> None:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))
    import website

    monkeypatch.setenv("ADMIN_TOKEN", "secret-docs-admin")
    monkeypatch.delenv("WEB_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("WEB_API_KEY", raising=False)
    c = website.app.test_client()
    assert c.post("/api/documentos/refresh").status_code == 403
    ok = c.post(
        "/api/documentos/refresh",
        headers={"Authorization": "Bearer secret-docs-admin"},
    )
    assert ok.status_code == 200
    body = ok.get_json()
    assert body["ok"] is True
    assert body["total"] >= 30


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
