"""Un carrito de MeLi con varias órdenes deja un asiento por orden.

En MeLi la `referencia` de la fila es el pack (el carrito). El cerrojo por
documento comparaba esa referencia, así que del 22 al 30-sep-2026 solo se
posteó la primera orden de cada carrito: el retiro de MercadoPago del 29-sep
llegó con 21 ventas liberadas sin asiento.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    import app.services.contabilidad_core as cc
    import app.services.contabilidad_autopost as ap

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "contabilidad_test.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-09-01")
    cc.init_db()
    return cc, ap


def _fila(fuente: str, order_id: str, monto: float):
    from app.services.contabilidad_ledger import _row

    return _row(fecha="2026-09-22", tipo="ingreso" if fuente == "meli_venta" else "egreso", fuente=fuente,
                concepto="Venta MeLi" if fuente == "meli_venta" else "Comisión MeLi", monto=monto,
                referencia="2000015164727299", contraparte="CLIENTE", extra={"order_id": order_id})


@pytest.mark.parametrize("fuente", ["meli_venta", "meli_cobro"])
def test_cada_orden_del_carrito_tiene_su_asiento(mods, fuente):
    _cc, ap = mods
    a = ap.postear_fila(_fila(fuente, "2000018598636484", 32_300))
    b = ap.postear_fila(_fila(fuente, "2000018598633050", 61_456))
    assert a["creado"] and b["creado"]
    # La misma orden vista otra vez (otro formato, otro hash) sigue sin duplicarse.
    otra_vez = _fila(fuente, "2000018598633050", 61_456)
    otra_vez["contraparte"] = "cliente"
    assert ap.postear_fila(otra_vez)["omitido"]


def test_fuera_de_meli_el_documento_sigue_siendo_la_referencia(mods):
    from app.services.contabilidad_ledger import _row

    _cc, ap = mods
    f = _row(fecha="2026-09-22", tipo="ingreso", fuente="web_venta", concepto="Venta web", monto=50_000,
             referencia="W-100", contraparte="X", extra={})
    assert ap.postear_fila(f)["creado"]
    f2 = dict(f, contraparte="otra forma")
    assert ap.postear_fila(f2)["omitido"]


def test_la_comision_sale_de_sale_fee_por_unidad(monkeypatch):
    """x-version 2: `marketplace_fee` llega en None; la comisión es sale_fee × quantity."""
    from app.services import contabilidad_ledger as led
    import app.utils as utils

    class _Resp:
        def __init__(self, data):
            self.status_code, self._data = 200, data

        def json(self):
            return self._data

    orden = {"id": 2000018598633050, "pack_id": 2000015164727299, "date_closed": "2026-09-22T20:55:00.000-05:00",
             "total_amount": 61_456.0, "marketplace_fee": None, "buyer": {"nickname": "X"},
             "payments": [{"marketplace_fee": None}],
             "order_items": [{"sale_fee": 8_402.0, "quantity": 2}]}

    def fake_get(url, **_k):
        if "users/me" in url:
            return _Resp({"id": 1})
        return _Resp({"results": [orden], "paging": {"total": 1}})

    monkeypatch.setattr(utils, "refrescar_token_meli", lambda: "t")
    monkeypatch.setattr("requests.get", fake_get)
    ing, egr, aviso = led._meli_ordenes_rango("2026-09-22", "2026-09-22")
    assert aviso is None and len(ing) == 1
    assert [(e["fuente"], e["monto"], e["extra"]["order_id"]) for e in egr] == [("meli_cobro", 16_804.0, "2000018598633050")]
