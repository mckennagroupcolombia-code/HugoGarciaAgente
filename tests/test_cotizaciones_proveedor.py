"""Cotización pedida al proveedor → solicitud de pago (8-oct-2026).

Lo que protegen: que la cotización quede enlazada al pago que la salda, que
se pague una sola vez y que vuelva a quedar libre si ese pago se rechaza.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.cotizaciones_proveedor as cot
    import app.services.pagos_wizard as w
    from app.services import pagos_proveedor, tickets_db

    for mod in (cc, w, cot):
        monkeypatch.setattr(mod, "_initialized", False)
    for mod in (cc, w):
        monkeypatch.setattr(mod, "_DB_PATH", db)
    monkeypatch.setattr(cot, "DIR_COTIZACIONES", tmp_path / "cotizaciones")
    monkeypatch.setattr(cot, "_ROOT", tmp_path)
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
    otro = cc.crear_tercero({"nombre": "OTRO PROVEEDOR", "tipo": "proveedor", "identificacion": "900000001"})
    return cc, w, cot, tercero, medio, otro


ITEM = {"sku": "PROCONSUEg", "nombre": "PROTEINA SUERO", "unidad": "g"}


def _pedida(cot, t):
    return cot.crear({"tercero_id": t["id"], "items": [{**ITEM, "cantidad": 100}], "notas": "Entrega en Suba"})


def _recibida(cot, t):
    c = _pedida(cot, t)
    return cot.registrar_respuesta(
        c["id"],
        {"items": [{**ITEM, "cantidad": 100, "precio": 42_000, "iva_pct": 19}],
         "total_documento": 4_998_000, "numero_documento": "PRE0032001"},
        archivo=(b"%PDF-1.4 cotizacion", "PRE0032001.pdf"),
    )


def _pago(c, t, m):
    return {
        "categoria": "productos", "concepto": "WPC 80", "fecha": "2026-10-08",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
        "retencion_modo": "beneficiario", "total_documento": c["total_documento"],
        "items": c["items_cotizados"], "documento_tipo": "cotizacion",
        "cotizacion_proveedor_id": c["id"],
    }


def test_pedir_valida_catalogo_y_genera_pdf_y_texto(mods):
    _, _, cot, t, _, _ = mods
    with pytest.raises(ValueError, match="combo"):
        cot.crear({"tercero_id": t["id"], "items": [{"sku": "C-WPC1kg", "cantidad": 1}]})
    with pytest.raises(ValueError, match="cantidad"):
        cot.crear({"tercero_id": t["id"], "items": [{**ITEM, "cantidad": 0}]})
    c = _pedida(cot, t)
    assert c["numero"] == f"COTP-{c['id']:04d}" and c["estado"] == "solicitada"
    txt = cot.texto(c["id"])
    assert "PROTEINA SUERO — 100 g (ref. PROCONSUEg)" in txt and c["numero"] in txt
    assert "901.316.016-3" in txt
    assert cot.pdf(c["id"]).startswith(b"%PDF")


def test_respuesta_debe_cuadrar_y_traer_documento(mods):
    _, _, cot, t, _, _ = mods
    c = _pedida(cot, t)
    linea = [{**ITEM, "cantidad": 100, "precio": 42_000, "iva_pct": 19}]
    with pytest.raises(ValueError, match="suman"):
        cot.registrar_respuesta(c["id"], {"items": linea, "total_documento": 4_200_000}, archivo=(b"x", "a.pdf"))
    with pytest.raises(ValueError, match="Adjunta"):
        cot.registrar_respuesta(c["id"], {"items": linea, "total_documento": 4_998_000})
    r = _recibida(cot, t)
    assert r["estado"] == "recibida" and r["disponible"] and cot.ruta_archivo(r["id"]).exists()


def test_solicitud_de_pago_desde_la_cotizacion(mods):
    _, w, cot, t, m, otro = mods
    c = _recibida(cot, t)

    with pytest.raises(ValueError, match="no del proveedor elegido"):
        w.crear_solicitud({**_pago(c, t, m), "tercero_id": otro["id"]})
    with pytest.raises(ValueError, match="no es el de la cotización"):
        malo = _pago(c, t, m)
        malo["items"] = [{**ITEM, "cantidad": 50, "precio": 42_000, "iva_pct": 19}]
        malo["total_documento"] = 2_499_000
        w.crear_solicitud(malo)

    s = w.crear_solicitud(_pago(c, t, m))
    assert s["cotizacion_proveedor_id"] == c["id"] and s["cotizacion_numero"] == c["numero"]
    assert s["factura_numero"] == "PRE0032001" and s["factura_archivo"] == c["archivo"]
    assert s["es_anticipo"] == 1     # cotización a un obligado a facturar: anticipo, como siempre
    assert cot.obtener(c["id"])["estado"] == "usada"

    # Se paga una sola vez…
    with pytest.raises(ValueError, match="ya se está pagando"):
        w.crear_solicitud(_pago(c, t, m))
    with pytest.raises(ValueError, match="rechaza o anula"):
        cot.descartar(c["id"])
    # …y si ese pago se rechaza, la cotización vuelve a quedar disponible.
    w.rechazar(s["id"], "precio viejo")
    assert cot.obtener(c["id"])["estado"] == "recibida"
    s2 = w.crear_solicitud(_pago(c, t, m))
    assert cot.obtener(c["id"])["solicitud_pago_id"] == s2["id"]


def test_editar_el_pedido_mientras_no_se_pague(mods):
    cc, w, cot, t, m, otro = mods
    c = _pedida(cot, t)
    e = cot.editar(c["id"], {"tercero_id": otro["id"], "items": [{**ITEM, "cantidad": 250}],
                             "fecha_requerida": "2026-10-20", "notas": "Bulto de 25 kg"})
    assert e["tercero_id"] == otro["id"] and e["items"][0]["cantidad"] == 250
    assert e["notas"] == "Bulto de 25 kg" and e["fecha_requerida"] == "2026-10-20"
    assert "250" in cot.texto(c["id"])

    # Ya respondió: se corrige el pedido, pero no se cambia de proveedor.
    r = _recibida(cot, t)
    cot.editar(r["id"], {"items": [{**ITEM, "cantidad": 120}]})
    assert cot.obtener(r["id"])["items_cotizados"][0]["cantidad"] == 100
    with pytest.raises(ValueError, match="ya respondió"):
        cot.editar(r["id"], {"tercero_id": otro["id"], "items": [{**ITEM, "cantidad": 120}]})

    # Pagada o descartada: ya no se toca.
    w.crear_solicitud(_pago(r, t, m))
    with pytest.raises(ValueError, match="usada"):
        cot.editar(r["id"], {"items": [{**ITEM, "cantidad": 1}]})
    cot.descartar(c["id"], "otro precio")
    with pytest.raises(ValueError, match="descartada"):
        cot.editar(c["id"], {"items": [{**ITEM, "cantidad": 1}]})
