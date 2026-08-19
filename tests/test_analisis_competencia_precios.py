"""Tests puros del agente de competencia de precios (sin API MeLi)."""
from __future__ import annotations

import app.tools.analisis_competencia_precios as ac


def test_titulo_base_y_tokens():
    assert ac.titulo_base_producto("Urea Cosmética 250 Gr + Envío") == "Urea Cosmética"
    toks = ac.tokens_significativos("Urea Cosmética 250 Gr + Envío")
    assert toks[:2] == ["urea", "cosmetica"]
    assert "envio" not in toks


def test_query_incluye_presentacion():
    q = ac.query_busqueda("Citrato de Magnesio 500 Gr")
    assert "citrato" in q and "magnesio" in q
    assert "500g" in q


def test_titulos_relacionados_nucleo():
    ok, score = ac.titulos_relacionados(
        "Urea Cosmética 250 Gr",
        "Urea Cosmetica Pura 250g Grado Farmacéutico Envío Gratis",
    )
    assert ok is True
    assert score > 0

    ok_no, _ = ac.titulos_relacionados(
        "Urea Cosmética 250 Gr",
        "Urea Agrícola Prilled Fertilizante 25kg",
    )
    # 'cosmetica' no está → no es el mismo producto
    assert ok_no is False

    ok_karite, _ = ac.titulos_relacionados(
        "Manteca de Karité 500 Gr",
        "Manteca Karite Sin Refinar 500g Pote",
    )
    assert ok_karite is True


def test_presentacion_y_precio_unitario():
    p = ac.extraer_presentacion("Ácido Hialurónico 10g")
    assert p is not None and p["cantidad"] == 10 and p["canonica"] == "g"
    kg = ac.extraer_presentacion("Citrato Magnesio 1kg")
    assert kg is not None and kg["cantidad"] == 1000
    ml = ac.extraer_presentacion("Aceite de Jojoba 250 ml")
    assert ml is not None and ml["canonica"] == "ml" and ml["cantidad"] == 250
    assert ac.precio_por_100(45000, p) == 450000.0
    assert ac.presentacion_texto(kg) == "1kg"


def test_clasificar_vs_min():
    assert ac.clasificar_vs_min(100, 80) == "mas_caro"
    assert ac.clasificar_vs_min(100, 120) == "mas_barato"
    assert ac.clasificar_vs_min(100, 98) == "similar"
    assert ac.clasificar_vs_min(100, None) == "sin_competencia"


def test_buscar_no_consulta_marketplace(monkeypatch):
    """Regla de cuenta: jamás pegar search/listado/ítems ajenos."""
    def boom(*_a, **_k):
        raise AssertionError("no debe haber requests a MeLi marketplace")

    monkeypatch.setattr(ac.requests, "get", boom)
    raw, metodo = ac.buscar_publicaciones_meli("citrato magnesio 500g")
    assert raw == []
    assert metodo == "meli_no_permite"


def test_competidores_filtra_nosotros_y_titulo(monkeypatch):
    nuestro = {
        "item_id": "MCO111",
        "titulo": "Urea Cosmética 250 Gr",
        "precio": 45000,
        "query": "urea cosmetica 250g",
        "presentacion": ac.extraer_presentacion("Urea Cosmética 250 Gr"),
        "precio_por_100": ac.precio_por_100(45000, ac.extraer_presentacion("Urea Cosmética 250 Gr")),
    }
    raw = [
        {
            "id": "MCO111",
            "title": "Urea Cosmética 250 Gr",
            "price": 45000,
            "seller": {"id": "999", "nickname": "MCKENNA"},
            "permalink": "https://x/1",
            "shipping": {},
        },
        {
            "id": "MCO222",
            "title": "Urea Cosmetica 250g Pura",
            "price": 38000,
            "seller": {"id": "888", "nickname": "OTROLAB"},
            "permalink": "https://x/2",
            "sold_quantity": 40,
            "shipping": {"free_shipping": True},
        },
        {
            "id": "MCO333",
            "title": "Niacinamida 100g Cosmética",
            "price": 20000,
            "seller": {"id": "777", "nickname": "NIACINA"},
            "permalink": "https://x/3",
            "shipping": {},
        },
        {
            "id": "MCO444",
            "title": "Urea Cosmetica 250 Gr",
            "price": 40000,
            "seller": {"id": "999", "nickname": "MCKENNA"},
            "permalink": "https://x/4",
            "shipping": {},
        },
    ]
    monkeypatch.setattr(ac, "buscar_publicaciones_meli", lambda *a, **k: (raw, "publico"))
    comps, metodo = ac.competidores_de_publicacion(nuestro, seller_id_nuestro="999")
    assert metodo == "publico"
    ids = {c["item_id"] for c in comps}
    assert ids == {"MCO222"}
    assert comps[0]["misma_presentacion"] is True
    assert comps[0]["seller_nickname"] == "OTROLAB"


def test_veredicto_mas_caro():
    pres = ac.extraer_presentacion("Urea 250g")
    nuestro = {"precio": 45000, "precio_por_100": ac.precio_por_100(45000, pres)}
    comps = [{
        "misma_presentacion": True,
        "precio": 38000,
        "precio_por_100": ac.precio_por_100(38000, pres),
    }]
    v, minimo, delta = ac._veredicto_producto(nuestro, comps)
    assert v == "mas_caro"
    assert minimo == ac.precio_por_100(38000, pres)
    assert delta is not None and delta > 0


def test_reporte_texto_compacto():
    analisis = {
        "ok": True,
        "generado_en": "2026-08-18T12:00:00",
        "dias": 30,
        "top_n": 2,
        "consulta": "",
        "metodo_busqueda": "publico",
        "resumen": {
            "productos": 2,
            "con_competencia": 1,
            "nosotros_mas_caros": 1,
            "nosotros_mas_baratos": 0,
            "similares": 0,
        },
        "productos": [
            {
                "titulo": "Urea Cosmética 250 Gr",
                "precio": 45000,
                "unidades_periodo": 40,
                "veredicto": "mas_caro",
                "delta_pct_vs_min": 15.5,
                "observaciones_manual": [{
                    "vendedor": "OTROLAB",
                    "precio": 38000,
                    "permalink": "https://articulo.mercadolibre.com.co/MCO-x",
                }],
            },
            {
                "titulo": "Niacinamida 100g",
                "precio": 22000,
                "unidades_periodo": 8,
                "veredicto": "sin_competencia",
                "competidores": [],
            },
        ],
    }
    txt = ac.formatear_reporte_texto(analisis)
    assert "REVISAR PRECIO" in txt
    assert "Urea Cosmética" in txt
    assert "OTROLAB" in txt
    assert "Niacinamida" in txt


def test_cache_fresco(tmp_path, monkeypatch):
    from datetime import datetime, timedelta

    monkeypatch.setattr(ac, "_CACHE_PATH", tmp_path / "c.json")
    data = {
        "version": 1,
        "generado_en": datetime.now().isoformat(timespec="seconds"),
        "dias": 30,
        "top_n": 12,
        "consulta": "",
        "ok": True,
        "productos": [],
        "resumen": {},
    }
    ac._guardar_cache(data)
    cached = ac._cargar_cache()
    assert cached and ac._cache_fresco(cached, 30, 12, "")
    viejo = dict(data)
    viejo["generado_en"] = (datetime.now() - timedelta(hours=8)).isoformat(timespec="seconds")
    assert not ac._cache_fresco(viejo, 30, 12, "")


def test_ejecutar_usa_mas_vendidos_mock(monkeypatch, tmp_path):
    monkeypatch.setattr(ac, "_CACHE_PATH", tmp_path / "c.json")
    monkeypatch.setattr(ac, "_OBS_PATH", tmp_path / "o.json")
    pres = ac.extraer_presentacion("Urea Cosmética 250 Gr")
    item = {
        "item_id": "MCO111",
        "titulo": "Urea Cosmética 250 Gr",
        "sku": "C-UREA250",
        "precio": 45000,
        "permalink": "https://articulo.mercadolibre.com.co/MCO-111",
        "presentacion": pres,
        "precio_por_100": ac.precio_por_100(45000, pres),
        "query": "urea cosmetica 250g",
        "unidades_periodo": 20,
        "ordenes_periodo": 12,
        "monto_periodo": 900000,
        "nivel": "alta",
        "sold_quantity": 80,
        "category_id": "MCO1",
    }
    monkeypatch.setattr(
        ac,
        "nuestros_mas_vendidos",
        lambda **kw: {"ok": True, "seller_id": "999", "fuente_ventas": "cache", "items": [item]},
    )
    out = ac.ejecutar_analisis_competencia(top_n=1, dias=30, usar_cache=False, pause_s=0)
    assert out["ok"] is True
    assert out["productos"][0]["veredicto"] == "sin_competencia"
    assert "listado.mercadolibre.com.co" in out["productos"][0]["url_busqueda_meli"]
    txt = ac.analizar_competencia_precios(top_n=1, dias=30, usar_cache=True)
    assert "Urea" in txt


def test_whatsapp_solo_si_hay_mas_caros(monkeypatch):
    monkeypatch.setattr(
        "app.utils.enviar_whatsapp_reporte",
        lambda *a, **k: None,
    )
    analisis = {
        "ok": True,
        "consulta": "",
        "resumen": {"nosotros_mas_caros": 0},
        "productos": [],
        "dias": 30,
        "top_n": 1,
        "metodo_busqueda": "publico",
        "generado_en": "x",
    }
    r = ac.enviar_reporte_whatsapp(analisis)
    assert r["enviado"] is False
    assert r["motivo"] == "nada_que_alertar"


def test_job_cron_registrado():
    from app.services.cron_scheduler import JOBS

    assert "competencia_precios" in JOBS
    assert JOBS["competencia_precios"]["script"].endswith("analisis_competencia_precios_cron.py")


def test_url_busqueda_y_precio_cop():
    url = ac.url_busqueda_meli_navegador("citrato magnesio 500g")
    assert url.startswith("https://listado.mercadolibre.com.co/")
    assert "citrato" in url.lower()
    assert ac.parsear_precio_cop("$24.900") == 24900
    assert ac.parsear_precio_cop("24900") == 24900.0
    assert ac.permalink_meli_seguro("https://evil.example/x") == ""
    assert ac.permalink_meli_seguro(
        "https://articulo.mercadolibre.com.co/MCO-1-urea"
    ).startswith("https://articulo.mercadolibre.com.co/")


def test_observacion_manual_marca_mas_caro(tmp_path, monkeypatch):
    monkeypatch.setattr(ac, "_CACHE_PATH", tmp_path / "c.json")
    monkeypatch.setattr(ac, "_OBS_PATH", tmp_path / "o.json")
    ac._guardar_cache({
        "version": 1,
        "generado_en": "2026-08-18T12:00:00",
        "dias": 30,
        "top_n": 1,
        "consulta": "",
        "productos": [{
            "item_id": "MCO111",
            "titulo": "Urea 250g",
            "precio": 45000,
            "query": "urea 250g",
            "unidades_periodo": 10,
        }],
        "resumen": {},
    })
    out = ac.registrar_observacion_manual("MCO111", "$38.000", vendedor="Banquete")
    assert out["ok"] is True
    p = out["productos"][0]
    assert p["veredicto"] == "mas_caro"
    assert p["observaciones_manual"][0]["vendedor"] == "Banquete"
    oid = p["observaciones_manual"][0]["id"]
    ac.eliminar_observacion_manual(oid)
    p2 = ac.obtener_ultimo_analisis_competencia()["productos"][0]
    assert p2["veredicto"] == "sin_competencia"
    assert p2["observaciones_manual"] == []
