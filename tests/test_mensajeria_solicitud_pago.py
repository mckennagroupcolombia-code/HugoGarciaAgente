"""El lote de mensajería usa el MISMO flujo de pago que todo lo demás.

Antes este pago vivía aparte: ticket de texto libre para aprobarlo y asiento
solo cuando alguien marcaba el lote como pagado. Lo que estos tests protegen es
que al unificarlo (a) el lote quede amarrado a su solicitud, (b) confirmar el
giro cierre el lote solo, y (c) el gasto NO quede contabilizado dos veces.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.contabilidad_db as cdb
    import app.services.mensajeria_pagos as mp
    import app.services.pagos_wizard as w
    from app.services import tickets_db

    # `mensajeria_pagos` no tiene DB propia: usa el `_conn()` de
    # contabilidad_db. Sin parchear ESE módulo, el test escribe en la base de
    # producción — y `guardar_envio` machaca por (transportadora, fecha) el día
    # real que coincida.
    for mod in (cc, w, cdb):
        monkeypatch.setattr(mod, "_DB_PATH", db)
        monkeypatch.setattr(mod, "_initialized", False)
    assert not hasattr(mp, "_DB_PATH"), "mensajeria_pagos ahora tiene DB propia: parchéala aquí"
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    monkeypatch.setattr(mp, "_COMPROBANTES_DIR", str(tmp_path / "comprobantes"))
    w.init_db()
    mp.ensure_mensajeria_tables()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
    cc.crear_medio_pago({"nombre": "Bancolombia ahorros", "tipo": "banco", "cuenta_id": banco})
    tercero = cc.crear_tercero({
        "nombre": "INTER RAPIDISIMO S.A", "tipo": "proveedor",
        "tipo_persona": "juridica", "identificacion": "800251569",
    })
    envio = mp.guardar_envio({"fecha": "2026-09-01", "cantidad": 12, "valor": 180_000})
    lote = mp.crear_lote([envio["id"]])
    return cc, w, mp, tercero, lote


def test_el_lote_entra_al_flujo_unico_de_pagos(mods):
    _cc, w, mp, t, lote = mods
    r = mp.solicitar_pago_wizard(lote["id"], tercero_id=t["id"])
    sol = w.obtener(r["solicitud_id"])
    assert sol["categoria"] == "flete_transporte"      # flete, no el saco de «servicios»
    assert sol["monto"] == 180_000
    assert sol["tercero_id"] == t["id"]
    assert mp.obtener_lote(lote["id"])["solicitud_pago_id"] == sol["id"]


def test_sin_tercero_no_se_manda_a_pagos(mods):
    _cc, _w, mp, _t, lote = mods
    with pytest.raises(ValueError):
        mp.solicitar_pago_wizard(lote["id"])


def test_confirmar_el_giro_cierra_el_lote_solo(mods):
    _cc, w, mp, t, lote = mods
    sid = mp.solicitar_pago_wizard(lote["id"], tercero_id=t["id"])["solicitud_id"]
    w.aprobar(sid, espejar=False)
    w.montar_en_banco(sid)
    w.confirmar_pago(sid, comprobante=(b"%PDF-1.4 soporte", "banco.pdf"))
    cerrado = mp.obtener_lote(lote["id"])
    assert cerrado["estado"] == "pagado"
    assert cerrado["soporte_path"]          # el soporte también queda donde lo busca despachos


def test_el_gasto_no_queda_dos_veces(mods, monkeypatch):
    """El asiento lo hace la solicitud; el lote ya no se postea por su cuenta."""
    _cc, w, mp, t, lote = mods
    sid = mp.solicitar_pago_wizard(lote["id"], tercero_id=t["id"])["solicitud_id"]
    w.aprobar(sid, espejar=False)
    w.confirmar_pago(sid, comprobante=(b"x", "b.pdf"))

    import app.services.contabilidad_ledger as led

    monkeypatch.setattr(mp, "pagos_en_rango", lambda d, h: [mp.obtener_lote(lote["id"])])
    assert led._egresos_mensajeria("2026-09-01", "2026-09-30") == []
