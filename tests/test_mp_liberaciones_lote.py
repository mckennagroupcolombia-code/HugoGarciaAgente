"""Cruce del lote de MercadoPago detrás de un retiro (Taller de conciliación).

Caso real del 7-sep-2026 (retiro de $9.500.000): el taller mostraba el envío
47902696032 como una «orden sin factura» y sumaba como liberación los $11,7M que
McKenna le pagó a MeLi. Aquí se fija que cada pago se entienda como lo que es.
"""

import json

from app.services import mp_liberaciones as mp


def _pago(**kw):
    base = {"payment_id": "1", "collector_id": 432439187, "order_id": "", "referencia": "", "fecha_pago": "2026-08-31",
            "fecha_liberacion": "2026-09-01", "bruto": 0.0, "comision": 0.0, "neto": 0.0, "descripcion": "", "estado_liberacion": "released"}
    base.update(kw)
    return base


def test_clases_de_pago():
    propio = 432439187
    assert mp._clase_pago(_pago(order_id="2000018217773952", descripcion="Glicerina"), propio) == "venta"
    assert mp._clase_pago(_pago(order_id="47902696032", descripcion="marketplace_shipment"), propio) == "envio"
    assert mp._clase_pago(_pago(descripcion="bonificaciones_flex_fc"), propio) == "bonificacion"
    assert mp._clase_pago(_pago(referencia="MCKG-BA99C314DF"), propio) == "venta_web"
    assert mp._clase_pago(_pago(collector_id=None, descripcion="Facturas con cargos por operar"), propio) == "pago_a_meli"


def test_factura_por_registro_propio_con_numero():
    entregas = {"2000018217773952": {"shipping_id": "47902696032", "estado": "facturada", "siigo_invoice_number": "FE196"}}
    indice = {"2000018217773952": {"factura_id": "196", "factura_numero": "", "factura_fecha": "2026-09-09", "total": 8925}}
    f = mp._factura_de_orden("2000018217773952", "2000014803882255", indice, entregas)
    assert f["numero"] == "FE196" and f["total"] == 8925
    # Solo en el índice (sin número): se muestra el id, no queda en blanco.
    assert mp._factura_de_orden("2000018217773952", "", indice, {})["numero"] == "#196"
    # Por pack, cuando la factura cita el pack (vía Siigo / astroselling).
    assert mp._factura_de_orden("999", "P1", {"P1": {"factura_numero": "FV-1"}}, {})["numero"] == "FV-1"
    assert mp._factura_de_orden("999", "", {}, {}) is None


def test_lote_envio_y_pago_a_meli(tmp_path, monkeypatch):
    entregas = tmp_path / "entregas.json"
    entregas.write_text(json.dumps({"procesadas": {"2000018217773952": {
        "shipping_id": "47902696032", "estado": "facturada", "siigo_invoice_number": "FE196"}}}))
    indice = tmp_path / "indice.json"
    indice.write_text(json.dumps({"indice": {}}))
    monkeypatch.setattr(mp, "_ENTREGAS", str(entregas))
    monkeypatch.setattr(mp, "_INDICE_FACTURAS", str(indice))
    monkeypatch.setattr(mp, "_retiros_en_banco", lambda hasta, tercero_id=None: [
        {"id": 1, "fecha": "2026-08-31", "monto": 9000000.0}, {"id": 2, "fecha": "2026-09-07", "monto": 100.0}])
    monkeypatch.setattr(mp, "_asientos_meli_por_orden", lambda ids: {
        "2000018217773952": {"movimiento_id": 651, "fecha": "2026-08-31", "monto": 8925, "pack": "2000014803882255"}})
    monkeypatch.setattr(mp, "_saldo_cuenta", lambda codigo: 0.0)
    pagos = [
        _pago(payment_id="a", order_id="47902696032", descripcion="marketplace_shipment", bruto=12200.0, neto=11754.02),
        _pago(payment_id="b", order_id="2000018217773952", descripcion="Glicerina", bruto=8925.0, comision=1205.0, neto=7393.75),
        _pago(payment_id="c", collector_id=None, descripcion="Facturas con cargos por operar", bruto=11750770.0, neto=11750770.0),
    ]
    r = mp.lote_de_retiro(2, _pagos=lambda d, h: [dict(p) for p in pagos])
    por_id = {p["payment_id"]: p for p in r["pagos"]}
    assert por_id["a"]["clase"] == "envio" and por_id["a"]["order_id"] == "" and por_id["a"]["factura"] is None
    assert por_id["a"]["orden_del_envio"] == "2000018217773952"
    assert por_id["b"]["factura"]["numero"] == "FE196"
    assert r["n_ventas"] == 1 and r["n_con_factura"] == 1
    assert r["pagado_a_meli"] == 11750770.0
    assert r["liberado_neto"] == round(11754.02 + 7393.75, 2)
