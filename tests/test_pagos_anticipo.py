"""Pago anticipado contra cotización y su legalización con la factura (6-oct-2026).

Lo que protegen: que girarle a un proveedor la COTIZACIÓN no dé por recibida la
mercancía. Antes el giro entraba directo a 1435 + 240810 (asiento #7965,
Factores; #7964, Comercializadora) y cuando la factura vino por otra cosa no
había contra qué cruzarla. Ahora el giro es un anticipo (133005) y la compra
nace con lo FACTURADO.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.pagos_wizard as w
    from app.services import pagos_proveedor, tickets_db

    for mod in (cc, w):
        monkeypatch.setattr(mod, "_DB_PATH", db)
        monkeypatch.setattr(mod, "_initialized", False)
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    monkeypatch.setattr(pagos_proveedor, "_item_catalogo", lambda sku: {"type": "product", "status": "active"})
    monkeypatch.setattr(pagos_proveedor, "aprender_iva_compra", lambda *a, **k: 0)
    w.init_db()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": banco})
    tercero = cc.crear_tercero({
        "nombre": "FACTORES Y MERCADEO S.A.", "tipo": "proveedor",
        "tipo_persona": "juridica", "identificacion": "800077828",
    })
    return cc, w, tercero, medio


COTIZACION = {"origen": "pdf", "tipo_documento": "cotizacion", "fiel": True, "numero_documento": "PRE0032001"}
FACTURA = {"origen": "xml", "tipo_documento": "factura", "fiel": True, "nit_ok": True,
           "numero_documento": "FEE106001", "fecha_documento": "2026-10-03"}


def _compra(t, m, *, verificacion=COTIZACION, cantidad=100, precio=42_000, iva=19):
    total = round(cantidad * precio * (1 + iva / 100))
    return {
        "categoria": "productos", "concepto": "WPC 80", "fecha": "2026-10-01",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
        "retencion_modo": "beneficiario", "total_documento": total,
        "items": [{"sku": "PROCONSUEg", "nombre": "PROTEINA SUERO", "cantidad": cantidad,
                   "precio": precio, "iva_pct": iva}],
        "verificacion": verificacion,
    }


def _por_cuenta(mov):
    out: dict[str, list[float]] = {}
    for l in mov["lineas"]:
        d = out.setdefault(l["cuenta_codigo"], [0.0, 0.0])
        d[0] += l["debito"]
        d[1] += l["credito"]
    return {k: tuple(round(x, 2) for x in v) for k, v in out.items()}


def test_cotizacion_a_obligado_a_facturar_es_anticipo(mods):
    cc, w, t, m = mods
    prev = w.previsualizar(_compra(t, m))
    assert prev["es_anticipo"] is True
    cods = {l["cuenta_codigo"] for l in prev["lineas"]}
    assert "1435" not in cods and "240810" not in cods       # sin factura no hay inventario ni IVA
    assert prev["lineas"][0]["cuenta_codigo"] == "133005"
    assert prev["retencion"] == 105_000                       # se practica al girar
    assert prev["cuadra"]

    s = w.crear_solicitud(_compra(t, m))
    assert s["es_anticipo"] == 1 and s["cuenta_debito"] == "1435"
    mov = cc.obtener_movimiento(w.aprobar(s["id"], espejar=False)["movimiento_id"])
    por = _por_cuenta(mov)
    assert por["133005"] == (4_998_000, 0)
    assert por["236540"] == (0, 105_000)
    assert por["1110"] == (0, 4_893_000)
    assert "1435" not in por
    assert w.obtener(s["id"])["falta_legalizar"] is True
    assert [a["id"] for a in w.anticipos_por_legalizar()] == [s["id"]]


def test_con_factura_electronica_se_causa_como_siempre(mods):
    _cc, w, t, m = mods
    prev = w.previsualizar(_compra(t, m, verificacion=FACTURA))
    assert prev["es_anticipo"] is False
    assert prev["lineas"][0]["cuenta_codigo"] == "1435"


def test_no_obligado_a_facturar_no_es_anticipo(mods):
    cc, w, _t, m = mods
    natural = cc.crear_tercero({"nombre": "Pedro Pérez", "tipo": "proveedor", "tipo_persona": "natural",
                                "identificacion": "79000111"})
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET emite_doc_soporte=1 WHERE id=?", (natural["id"],))
    natural = cc.obtener_tercero(natural["id"])
    assert w.previsualizar(_compra(natural, m))["es_anticipo"] is False


def _anticipo_aprobado(cc, w, t, m):
    s = w.crear_solicitud(_compra(t, m))
    w.aprobar(s["id"], espejar=False)
    return s["id"]


def _factura(cantidad, precio=42_000, iva=19):
    return {"items": [{"sku": "PROCONSUEg", "nombre": "PROTEINA SUERO", "cantidad": cantidad,
                       "precio": precio, "iva_pct": iva}],
            "total_documento": round(cantidad * precio * (1 + iva / 100)),
            "verificacion": FACTURA}


def test_legalizar_con_factura_igual_deja_el_anticipo_en_cero(mods):
    cc, w, t, m = mods
    sid = _anticipo_aprobado(cc, w, t, m)
    r = w.legalizar_anticipo(sid, _factura(100))
    por = _por_cuenta(cc.obtener_movimiento(r["legalizacion_movimiento_id"]))
    assert por["1435"] == (4_200_000, 0)
    assert por["240810"] == (798_000, 0)
    assert por["133005"] == (0, 4_998_000)
    assert "236540" not in por and "2205" not in por
    assert w.saldos_cruce(t["id"]) == {"anticipo": 0, "por_pagar": 0}
    assert cc.balance_comprobacion()["cuadra"]
    assert r["falta_legalizar"] is False
    with pytest.raises(ValueError, match="Ya se legalizó"):
        w.legalizar_anticipo(sid, _factura(100))


def test_facturo_menos_queda_a_favor_y_se_devuelve_retencion(mods):
    # Facturó 80 de las 100 unidades pagadas.
    cc, w, t, m = mods
    sid = _anticipo_aprobado(cc, w, t, m)
    prev = w.previsualizar_legalizacion(sid, _factura(80))
    assert prev["facturado"]["retencion"] == 84_000
    assert prev["ajuste_retencion"] == -21_000
    r = w.legalizar_anticipo(sid, _factura(80))
    por = _por_cuenta(cc.obtener_movimiento(r["legalizacion_movimiento_id"]))
    assert por["1435"] == (3_360_000, 0)
    assert por["236540"] == (21_000, 0)                   # se reversa la retención de más
    # Plata girada de más: 4.893.000 − (3.998.400 − 84.000) = 978.600
    assert w.saldos_cruce(t["id"])["anticipo"] == 978_600
    assert r["legalizacion"]["queda_a_favor"] == 978_600


def test_facturo_mas_queda_por_pagar(mods):
    cc, w, t, m = mods
    sid = _anticipo_aprobado(cc, w, t, m)
    r = w.legalizar_anticipo(sid, _factura(110))
    por = _por_cuenta(cc.obtener_movimiento(r["legalizacion_movimiento_id"]))
    assert por["236540"] == (0, 10_500)
    # Se le debe: (5.497.800 − 115.500) − 4.893.000 = 489.300
    assert por["2205"] == (0, 489_300)
    assert w.saldos_cruce(t["id"]) == {"anticipo": 0, "por_pagar": 489_300}
    assert cc.balance_comprobacion()["cuadra"]


def test_no_se_legaliza_con_otra_cotizacion(mods):
    cc, w, t, m = mods
    sid = _anticipo_aprobado(cc, w, t, m)
    with pytest.raises(ValueError, match="no es una factura electrónica"):
        w.legalizar_anticipo(sid, {**_factura(100), "verificacion": COTIZACION})


def test_una_compra_causada_no_se_legaliza(mods):
    cc, w, t, m = mods
    s = w.crear_solicitud(_compra(t, m, verificacion=FACTURA))
    w.aprobar(s["id"], espejar=False)
    with pytest.raises(ValueError, match="no es un anticipo"):
        w.legalizar_anticipo(s["id"], _factura(100))


def test_tipo_de_documento_por_cufe():
    from app.services.pagos_proveedor import tipo_documento

    assert tipo_documento("FACTURA ELECTRÓNICA DE VENTA FEE1 CUFE: 3a9f…", None) == "factura"
    assert tipo_documento("COTIZACIÓN PRE0031580 válida 8 días", None) == "cotizacion"
    assert tipo_documento("", {"numero": "X"}) == "factura"


def test_wizard_simple_declara_el_documento(mods):
    _cc, w, t, m = mods
    base = {k: v for k, v in _compra(t, m).items() if k != "verificacion"}
    assert w.previsualizar({**base, "documento_tipo": "cotizacion"})["es_anticipo"] is True
    assert w.previsualizar({**base, "documento_tipo": "factura"})["es_anticipo"] is False
    assert w.previsualizar(base)["es_anticipo"] is False     # sin decir nada, como hasta hoy


def test_asiento_por_arreglar_queda_en_la_bandeja_hasta_cerrarlo(mods):
    _cc, w, t, m = mods
    s = w.crear_solicitud(_compra(t, m))
    with pytest.raises(ValueError):
        w.marcar_por_arreglar(s["id"], "corto")
    w.marcar_por_arreglar(s["id"], "Libro dice 525.455 y el extracto 425.455")
    assert [x["id"] for x in w.por_arreglar()] == [s["id"]]
    with pytest.raises(ValueError):
        w.marcar_arreglado(s["id"], "")
    w.marcar_arreglado(s["id"], "Ajuste en el asiento #9999")
    assert w.por_arreglar() == []
