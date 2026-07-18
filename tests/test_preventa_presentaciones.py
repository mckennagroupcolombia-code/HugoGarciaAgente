"""Regresión: preventa MeLi debe poder ofrecer otras presentaciones del producto.

Caso real (jul 2026, Manteca Karite 500 Gr): el comprador preguntó "¿no tienes
pote más pequeño?" y luego "¿cómo hago para comprarla?" — el borrador IA no
ofrecía las presentaciones de 125/250 g porque el prompt solo recibía la ficha
del producto de la publicación y prohibía mencionar otros productos.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import app.services.meli_preventa as mp


def test_titulo_base_quita_presentacion_y_promos():
    assert mp._titulo_base_producto("Manteca Karite 500 Gr + Envío") == "Manteca Karite"
    assert (
        mp._titulo_base_producto("Manteca De Karité Orgánica Amarilla Sin Refinar 125 Gr ")
        == "Manteca De Karité Orgánica Amarilla Sin Refinar"
    )
    assert (
        mp._titulo_base_producto("Aceite Esencial Limon 5ml X 2 Unidades")
        == "Aceite Esencial Limon"
    )
    # El % de pureza se conserva (es parte del nombre)
    assert "100%" in mp._titulo_base_producto("Manteca Karite 100% Orgánica 500 Gr")


def _mock_multiget(bodies):
    res = MagicMock()
    res.status_code = 200
    res.json.return_value = [{"code": 200, "body": b} for b in bodies]
    return res


def test_otras_presentaciones_excluye_actual_y_lista_activas(monkeypatch):
    monkeypatch.setitem(mp._catalogo_meli_cache, "ts", 0)
    monkeypatch.setattr(
        mp,
        "_catalogo_local_meli",
        lambda: [
            {"name": "MANTECA KARITE AMARILLA 125g", "ref": "C-MANTKARAMA125g", "meli_id": "MCO111"},
            {"name": "MANTECA KARITE AMARILLA 250g", "ref": "C-MANKARAMA250g", "meli_id": "MCO222"},
            {"name": "MANTECA KARITE AMARILLA 500g", "ref": "C-MANKARAMA500g", "meli_id": "MCO500"},
            {"name": "ACEITE GIRASOL 500mL", "ref": "C-ACEGIR500mL", "meli_id": "MCO999"},
        ],
    )
    monkeypatch.setattr("app.utils.refrescar_token_meli", lambda: "tok")
    bodies = [
        {"id": "MCO111", "title": "Manteca Karité 125 Gr", "price": 31900,
         "permalink": "https://articulo.mercadolibre.com.co/MCO-111", "status": "active"},
        {"id": "MCO222", "title": "Manteca Karité 250 Gr", "price": 61900,
         "permalink": "https://articulo.mercadolibre.com.co/MCO-222", "status": "paused"},
    ]
    with patch("requests.get", return_value=_mock_multiget(bodies)) as rget:
        bloque = mp.otras_presentaciones_meli(
            "Manteca Karite 500 Gr + Envío", item_id_actual="MCO500"
        )
        ids_pedidos = rget.call_args.kwargs["params"]["ids"]

    # La publicación actual y los productos de otra familia no se consultan
    assert "MCO500" not in ids_pedidos and "MCO999" not in ids_pedidos
    # Solo las activas aparecen, con precio y enlace
    assert "125 Gr" in bloque and "31,900" in bloque and "MCO-111" in bloque
    assert "250 Gr" not in bloque  # paused


def test_otras_presentaciones_sin_candidatas_devuelve_vacio(monkeypatch):
    monkeypatch.setattr(mp, "_catalogo_local_meli", lambda: [])
    assert mp.otras_presentaciones_meli("Manteca Karite 500 Gr") == ""


def test_contexto_hilo_trae_pregunta_anterior(tmp_path, monkeypatch):
    ayer = (datetime.now() - timedelta(hours=3)).isoformat()
    viejo = (datetime.now() - timedelta(days=10)).isoformat()
    data = {"preguntas": [
        {"question_id": "1", "titulo_producto": "Manteca Karite 500 Gr + Envío",
         "pregunta": "no tienes pote mas pequeño?", "timestamp": ayer,
         "borrador_ia": "borrador previo"},
        {"question_id": "2", "titulo_producto": "Manteca Karite 500 Gr + Envío",
         "pregunta": "pregunta vieja", "timestamp": viejo},
        {"question_id": "3", "titulo_producto": "Otro Producto",
         "pregunta": "otra cosa", "timestamp": ayer},
    ]}
    p = tmp_path / "pendientes.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(mp, "PENDIENTES_PATH", str(p))

    ctx = mp.contexto_hilo_reciente("Manteca Karite 500 Gr + Envío", "99")
    assert "pote mas pequeño" in ctx
    assert "borrador previo" in ctx
    assert "pregunta vieja" not in ctx  # >3 días
    assert "otra cosa" not in ctx  # otro producto
    # La pregunta actual no se auto-incluye
    assert mp.contexto_hilo_reciente("Manteca Karite 500 Gr + Envío", "1") .count("P:") == 0 or \
        "pote mas pequeño" not in mp.contexto_hilo_reciente("Manteca Karite 500 Gr + Envío", "1")


def test_prompt_incluye_otras_presentaciones(monkeypatch):
    """generar_respuesta_con_ficha debe inyectar el bloque y la regla 7."""
    capturado = {}

    class _FakeModels:
        def generate_content(self, model, contents):
            capturado["prompt"] = contents
            r = MagicMock()
            r.text = "respuesta"
            return r

    class _FakeClient:
        def __init__(self, api_key):
            self.models = _FakeModels()

    monkeypatch.setenv("GOOGLE_API_KEY", "fake")
    monkeypatch.setattr(mp.genai, "Client", _FakeClient)
    out = mp.generar_respuesta_con_ficha(
        "Manteca Karite 500 Gr + Envío",
        "Como hago para comprarla?",
        "ficha X",
        otras_presentaciones="OTRAS PRESENTACIONES NUESTRAS DEL MISMO PRODUCTO:\n- Manteca 125 Gr — $31,900 COP — link",
        contexto_hilo="PREGUNTAS RECIENTES EN ESTA MISMA PUBLICACIÓN:\nP: hay pote pequeño?\nR: (aún sin responder)",
    )
    assert out == "respuesta"
    prompt = capturado["prompt"]
    assert "OTRAS PRESENTACIONES" in prompt
    assert "hay pote pequeño" in prompt
    assert "ofrécele también las OTRAS PRESENTACIONES" in prompt
