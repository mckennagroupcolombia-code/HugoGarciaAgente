"""Recepción de mercancía: abrir, contar, fotos, cerrar con/sin diferencias y aviso al canal."""
from __future__ import annotations

import pytest

from app.services import tickets_db


@pytest.fixture()
def R(monkeypatch, tmp_path):
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets.db"))
    monkeypatch.setattr(tickets_db, "UPLOADS_DIR", str(tmp_path / "up"))
    tickets_db.init_db()
    from app.services import recepcion_mercancia as mod

    monkeypatch.setattr(mod, "DB_PATH", str(tmp_path / "recepciones.db"))
    monkeypatch.setattr(mod, "UPLOADS_DIR", str(tmp_path / "fotos"))
    monkeypatch.setattr("app.services.panel_presencia.registrar_evento_panel", lambda *a, **k: None)
    from app.services import canales_internos as CI

    monkeypatch.setattr(CI, "_reenviar_a_wa", lambda *a: None)
    return mod


YO = {"id": 1, "nombre": "Víctor", "username": "victor", "rol": {"nivel": 1}}


def _avisos():
    from app.services import canales_internos as CI

    cid = CI.canal_por_clave("inventario")["id"]
    return [m["texto"] for m in CI.listar_mensajes(cid, {"id": 99, "rol": {"nivel": 3}, "permisos_secciones": {}}) or []]


def test_recepcion_completa_sin_diferencias(R):
    r = R.crear(YO, proveedor="Global Trading", referencia="FEA1",
                items=[{"sku": "NUEPECg", "descripcion": "Nuez pecán", "unidad": "g", "cantidad_esperada": 13600}])
    assert r["estado"] == "abierta" and r["recibido_por_nombre"] == "Víctor"
    it = r["items"][0]
    r = R.contar_item(r["id"], it["id"], YO, cantidad_recibida=13600)
    assert r["items"][0]["estado_item"] == "ok"
    r = R.cerrar(r["id"], YO)
    assert r["estado"] == "verificada"
    avisos = _avisos()
    assert any("Llegó mercancía de Global Trading" in a for a in avisos)
    assert any("verificada" in a for a in avisos)


def test_faltante_y_danado_cierran_con_diferencias(R):
    r = R.crear(YO, proveedor="Interkrol", items=[
        {"descripcion": "Aceite de coco", "cantidad_esperada": 10, "unidad": "kg"},
        {"descripcion": "Frascos", "cantidad_esperada": 100},
    ])
    a, b = r["items"]
    r = R.contar_item(r["id"], a["id"], YO, cantidad_recibida=8)
    assert [i for i in r["items"] if i["id"] == a["id"]][0]["estado_item"] == "faltante"
    # Cerrar con algo sin contar: no deja.
    with pytest.raises(ValueError):
        R.cerrar(r["id"], YO)
    R.contar_item(r["id"], b["id"], YO, estado_item="danado", observacion="caja mojada")
    r = R.cerrar(r["id"], YO)
    assert r["estado"] == "con_diferencias" and r["resumen"]["diferencias"] == 2
    assert any("CON DIFERENCIAS" in a and "esperado 10, llegó 8" in a for a in _avisos())
    # Cerrada ya no se toca.
    with pytest.raises(ValueError):
        R.contar_item(r["id"], a["id"], YO, cantidad_recibida=10)


def test_sin_proveedor_no_abre(R):
    with pytest.raises(ValueError):
        R.crear(YO, proveedor="  ")


def test_precarga_desde_solicitud_de_compra(R, monkeypatch):
    fake = {
        "id": 45, "concepto": "GLOBAL TRADING — factura FEA18834", "factura_numero": "FEA18834",
        "tercero": {"nombre": "GLOBAL TRADING DE COLOMBIA S.A.S"},
        "items": [{"sku": "NUEPECg", "nombre": "NUEZ DE PECAN", "cantidad": 13600.0, "unidad": "g"}],
    }
    monkeypatch.setattr("app.services.pagos_wizard.obtener", lambda sid: fake if sid == 45 else None)
    monkeypatch.setattr("app.services.pagos_wizard.listar", lambda limit=200: [
        {"id": 45, "categoria": "compra_proveedor", "estado": "aprobada", "concepto": "x", "es_plantilla": 0},
        {"id": 46, "categoria": "servicios", "estado": "aprobada", "concepto": "y", "es_plantilla": 0},
    ])
    assert [c["id"] for c in R.compras_por_recibir()] == [45]
    r = R.crear(YO, solicitud_pago_id=45)
    assert r["origen"] == "solicitud_pago" and r["referencia"] == "FEA18834"
    assert r["proveedor"] == "GLOBAL TRADING DE COLOMBIA S.A.S"
    assert r["items"][0]["cantidad_esperada"] == 13600.0
    # Ya tiene recepción: sale de la lista de compras por recibir.
    assert R.compras_por_recibir() == []


def test_fotos_y_listado(R):
    r = R.crear(YO, proveedor="Cadiep", items=[{"descripcion": "Cera"}])
    R.agregar_foto(r["id"], YO, "r1_x.jpg", "caja.jpg")
    lst = R.listar()
    assert lst[0]["resumen"]["fotos"] == 1 and lst[0]["resumen"]["total"] == 1
