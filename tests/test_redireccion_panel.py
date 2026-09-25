"""Redirigir al panel desde los grupos de WhatsApp: reglas, freno y apagado."""
from __future__ import annotations

import json
from pathlib import Path

from app.services import redireccion_panel as RP

JID = "120363000000000001@g.us"


def _cfg(activo=True):
    cfg = json.loads((Path(__file__).resolve().parents[1] / "app/data/redireccion_panel.json").read_text(encoding="utf-8"))
    cfg["activo"] = activo
    return cfg


def setup_function(_):
    RP._ultimo.clear()


def test_apagado_no_escribe():
    assert RP.aviso_para(JID, "Llegó la mercancía del proveedor", config=_cfg(False)) is None


def test_llegada_lleva_a_recepcion_con_enlace():
    a = RP.aviso_para(JID, "Llegaron 3 cajas del proveedor", config=_cfg(), ahora=1000)
    assert a and "?panel=recepcion-mercancia" in a


def test_tildes_y_mayusculas_no_importan():
    assert RP.aviso_para(JID, "SE DAÑÓ la selladora", config=_cfg(), ahora=1000)


def test_freno_por_regla_y_grupo():
    cfg = _cfg()
    assert RP.aviso_para(JID, "llegó el pedido", config=cfg, ahora=1000)
    assert RP.aviso_para(JID, "llegó otro pedido", config=cfg, ahora=1000 + 60) is None
    # Otro grupo sí recibe su aviso.
    assert RP.aviso_para("999@g.us", "llegó el pedido", config=cfg, ahora=1000 + 60)
    # Pasada la ventana, vuelve a avisar.
    assert RP.aviso_para(JID, "llegó el pedido", config=cfg, ahora=1000 + 121 * 60)


def test_chat_normal_no_dispara_y_1a1_nunca():
    cfg = _cfg()
    assert RP.aviso_para(JID, "buenos días equipo", config=cfg) is None
    assert RP.aviso_para("573001112233@c.us", "llegó el pedido", config=cfg) is None


def test_patrones_del_archivo_compilan():
    import re

    for r in _cfg()["reglas"]:
        re.compile(r["patron"])
        assert "{url}" in r["texto"] and r["panel"]
