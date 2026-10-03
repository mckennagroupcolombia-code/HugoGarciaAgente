"""Mensaje automático al comprador por SKU vendido (app/meli_mensaje_venta_sku.py)."""

from __future__ import annotations

import json
import sys
import types

import pytest

import app.meli_mensaje_venta_sku as mod


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    cfg = tmp_path / "mensajes_venta_sku.json"
    cfg.write_text(
        json.dumps(
            {
                "C-FRBSGL120mL": {"texto": "Hola! ¿Qué aroma deseas?", "activo": True},
                "C-INACTIVO": {"texto": "no debe salir", "activo": False},
                "C-VACIO": {"texto": "   "},
            }
        ),
        encoding="utf-8",
    )
    enviados = tmp_path / "enviados.json"

    envios: list[tuple[str, str]] = []
    fake_posventa = types.ModuleType("modulo_posventa")

    def responder_mensaje_posventa(order_id, texto, comprador_id=None, attachments=None):
        envios.append((str(order_id), texto))
        return True

    fake_posventa.responder_mensaje_posventa = responder_mensaje_posventa
    monkeypatch.setitem(sys.modules, "modulo_posventa", fake_posventa)

    avisos: list[str] = []
    monkeypatch.setattr(
        "app.utils.enviar_whatsapp_reporte",
        lambda texto, numero_destino=None: avisos.append(texto),
    )
    monkeypatch.setattr("app.utils.jid_grupo_postventa_wa", lambda: "grupo@g.us")
    monkeypatch.delenv("MELI_MENSAJE_VENTA_SKU_ACTIVO", raising=False)

    return types.SimpleNamespace(
        cfg=str(cfg), enviados=str(enviados), envios=envios, avisos=avisos
    )


def test_config_solo_activos_y_normaliza(entorno):
    m = mod.cargar_mensajes_por_sku(entorno.cfg)
    assert m == {"C-FRBSGL120ML": "Hola! ¿Qué aroma deseas?"}
    assert mod.mensaje_para_sku(" c-frbsgl120ml ", entorno.cfg) == "Hola! ¿Qué aroma deseas?"
    assert mod.mensaje_para_sku("C-INACTIVO", entorno.cfg) is None
    assert mod.mensaje_para_sku("", entorno.cfg) is None


def test_config_inexistente_no_rompe(tmp_path):
    assert mod.cargar_mensajes_por_sku(str(tmp_path / "nada.json")) == {}


def test_envia_una_sola_vez_por_orden(entorno):
    kw = dict(config_path=entorno.cfg, enviados_path=entorno.enviados)
    assert mod.procesar_mensaje_venta_sku("2000011", "C-FRBSGL120mL", nombre_producto="Fragancia", **kw) == "enviado"
    # MeLi repite orders_v2 por la misma orden: no se repite el mensaje.
    assert mod.procesar_mensaje_venta_sku("2000011", "C-FRBSGL120mL", **kw) == "ya_enviado"
    assert mod.procesar_mensaje_venta_sku("2000011", "c-frbsgl120ml", **kw) == "ya_enviado"
    # Otra orden con el mismo SKU sí recibe su mensaje.
    assert mod.procesar_mensaje_venta_sku("2000012", "C-FRBSGL120mL", **kw) == "enviado"
    assert entorno.envios == [
        ("2000011", "Hola! ¿Qué aroma deseas?"),
        ("2000012", "Hola! ¿Qué aroma deseas?"),
    ]
    assert len(entorno.avisos) == 2
    assert "Fragancia" in entorno.avisos[0]
    registro = json.loads(open(entorno.enviados, encoding="utf-8").read())
    assert registro["2000011:C-FRBSGL120ML"]["estado"] == "enviado"


def test_sku_sin_configurar_no_envia(entorno):
    r = mod.procesar_mensaje_venta_sku(
        "2000013", "C-ACISAL500g", config_path=entorno.cfg, enviados_path=entorno.enviados
    )
    assert r == "sin_match"
    assert entorno.envios == []


def test_fallo_de_meli_libera_para_reintento(entorno, monkeypatch):
    intentos = []

    def fallo(order_id, texto, comprador_id=None, attachments=None):
        intentos.append(order_id)
        return len(intentos) > 1

    monkeypatch.setattr(sys.modules["modulo_posventa"], "responder_mensaje_posventa", fallo)
    kw = dict(config_path=entorno.cfg, enviados_path=entorno.enviados)
    assert mod.procesar_mensaje_venta_sku("2000014", "C-FRBSGL120mL", **kw) == "fallo"
    assert entorno.avisos == []
    assert mod.procesar_mensaje_venta_sku("2000014", "C-FRBSGL120mL", **kw) == "enviado"
    assert len(entorno.avisos) == 1


def test_apagado_por_entorno(entorno, monkeypatch):
    monkeypatch.setenv("MELI_MENSAJE_VENTA_SKU_ACTIVO", "0")
    r = mod.procesar_mensaje_venta_sku(
        "2000015", "C-FRBSGL120mL", config_path=entorno.cfg, enviados_path=entorno.enviados
    )
    assert r == "inactivo"
    assert entorno.envios == []
