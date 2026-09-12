"""Bloque C (sep-2026): la tarifa de envío deja de estar hardcodeada en el prompt.

Los canales de cliente (whatsapp, web_chat) responden SIN tool-use, así que la
regla "SIEMPRE usa consultar_tarifa_envio" no era aplicable ahí: el LLM solo
tenía las cifras escritas a mano en el prompt, divergentes de la tabla real.
    Cali 3 kg -> el bot decía ~$22.000; la tabla da $28.400
    Chía 1 kg -> el bot decía $18.000; es regional, $12.500
    Leticia   -> el bot decía $18.000; difícil acceso, $20.900
"""

from __future__ import annotations

import pytest


def test_bloque_tarifa_usa_la_tabla_real() -> None:
    from app import core
    from app.services.tarifas_envio import cotizar_envio

    bloque = core._preflight_tarifa_envio("cuanto vale el envio a cali", [])
    assert bloque and "TARIFA DE ENVÍO" in bloque
    assert "Nacional 1" in bloque
    # Las cifras del bloque tienen que salir de la tabla, no del prompt viejo
    for kg in (1, 2, 3, 5):
        esperado = cotizar_envio("cali", "", float(kg))["costo"]
        assert f"{esperado:,.0f}".replace(",", ".") in bloque, (kg, esperado)
    # La tarifa plana que el bot recitaba ya no aparece
    assert "18.000" not in bloque


def test_zonas_distintas_dan_tarifas_distintas() -> None:
    from app import core

    bogota = core._preflight_tarifa_envio("hacen domicilio en bogota?", [])
    chia = core._preflight_tarifa_envio("el envio a chia cuanto sale", [])
    leticia = core._preflight_tarifa_envio("envian a leticia?", [])

    assert "8.800" in bogota and "mismo día" in bogota.lower()
    assert "12.500" in chia and "Regional" in chia
    assert "20.900" in leticia and "Difícil acceso" in leticia


def test_sin_ciudad_pide_la_ciudad_y_no_da_cifra_nacional() -> None:
    from app import core

    bloque = core._preflight_tarifa_envio("cuanto cuesta el envio", [])
    assert "PIDA LA CIUDAD" in bloque
    # Bogotá es el único ancla seguro; ninguna cifra de otra zona puede aparecer
    assert "18.500" not in bloque
    assert "12.500" not in bloque


def test_ciudad_tomada_del_historial_del_cliente() -> None:
    from app import core

    historial = [
        {"role": "user", "content": "Soy de Bucaramanga"},
        {"role": "assistant", "content": "Con gusto veci, ¿qué producto necesita?"},
    ]
    bloque = core._preflight_tarifa_envio("y el envío cuánto sale?", historial)
    assert bloque and "Bucaramanga" in bloque


def test_ciudad_dicha_por_el_bot_no_se_toma_como_destino() -> None:
    """Solo cuenta lo que dijo el cliente: si el bot mencionó una ciudad en una
    respuesta anterior, no es el destino de este pedido."""
    from app import core

    historial = [
        {"role": "assistant", "content": "Ese producto lo despachamos desde Medellín."},
    ]
    bloque = core._preflight_tarifa_envio("cuanto vale el envio?", historial)
    assert "PIDA LA CIUDAD" in bloque


def test_no_dispara_en_preguntas_que_no_son_de_envio() -> None:
    from app import core

    # "contraentrega" es medio de pago, lo responden las reglas de pago
    assert core._preflight_tarifa_envio("manejan contraentrega?", []) is None
    assert core._preflight_tarifa_envio("cuanto vale la creatina", []) is None


def test_prompts_de_cliente_no_traen_tarifas_hardcodeadas() -> None:
    """La regresión que originó el bloque: cifras de envío escritas en el prompt
    que envejecen sin que nadie las note."""
    from pathlib import Path

    for ruta in ("app/agent/cliente_chat.py",):
        texto = Path(ruta).read_text(encoding="utf-8")
        # el prompt del canal cliente no puede afirmar una tarifa nacional plana
        assert "$18.000 hasta 1 kg" not in texto, ruta
        assert "suman $2.000" not in texto, ruta


def test_bloque_llega_al_prompt_del_canal_cliente(monkeypatch) -> None:
    """El dato calculado tiene que viajar hasta el LLM, no quedarse en el helper."""
    from app import core
    from app.agent import cliente_chat

    capturado: dict = {}

    def _fake_responder(**kwargs):
        capturado.update(kwargs)
        return ("respuesta mock", "mock")

    monkeypatch.setattr(cliente_chat, "responder_canal_cliente", _fake_responder)
    monkeypatch.setattr(core, "cliente_ia", object())
    monkeypatch.setattr(core, "cliente_gemini", None)
    monkeypatch.setattr(core, "_guardar_historial_persistente", lambda *a, **k: None)

    core.obtener_respuesta_ia(
        "cuanto vale el envio a cali", "573009999999@c.us", canal="whatsapp"
    )
    extra = capturado.get("extra_sistema", "")
    assert "TARIFA DE ENVÍO" in extra
    assert "28.400" in extra  # Cali 3 kg, el caso que el bot cotizaba en ~$22.000


def test_herramienta_consultar_tarifa_envio_respeta_el_peso() -> None:
    """La herramienta que sí usan los canales con tool-use leía la clave legacy
    `ciudades` del JSON, que solo trae la tarifa de 1 kg: para 3 kg a Cali
    devolvía $18.500 cuando la tabla cobra $28.400."""
    from app.tools.system_tools import consultar_tarifa_envio
    from app.services.tarifas_envio import cotizar_envio

    for ciudad, kg in (("Cali", 3), ("Medellín", 2), ("Chía", 1), ("Leticia", 1)):
        res = consultar_tarifa_envio(ciudad, kg)
        assert res["tarifa"]["precio_calculado"] == cotizar_envio(ciudad, "", float(kg))["costo"]
        assert res["tarifa"]["peso_kg"] == kg
        assert res["tarifa"]["zona"]

    # El peso cambia el resultado (antes era plano)
    assert (
        consultar_tarifa_envio("Cali", 3)["tarifa"]["precio_calculado"]
        > consultar_tarifa_envio("Cali", 1)["tarifa"]["precio_calculado"]
    )
    # `precio_base` conserva su significado histórico: tarifa de 1 kg de la zona
    assert consultar_tarifa_envio("Cali", 3)["tarifa"]["precio_base"] == 18500


def test_tarifa_envio_no_inventa_cifra_si_falla_la_tabla(monkeypatch) -> None:
    """El fallback hardcodeaba $18.000; ahora avisa en vez de cotizar mal."""
    from app.tools import system_tools
    from app.services import tarifas_envio

    def _boom(*_a, **_k):
        raise RuntimeError("tabla ilegible")

    monkeypatch.setattr(tarifas_envio, "cotizar_envio", _boom)
    res = system_tools.consultar_tarifa_envio("Cali", 3)
    assert res["tarifa"] is None
    assert "asesor" in res["error"].lower()
