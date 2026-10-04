"""Simulador de precios de Colaboradores: entradas saneadas, historial, acuerdos y acceso por proyecto."""
from __future__ import annotations

import pytest

from app.services import colab_precios as cp
from app.services import colaboradores as col
from tests.test_colaboradores import _h, cliente  # noqa: F401  (fixture de la API)


@pytest.fixture()
def proyecto(monkeypatch, tmp_path):
    monkeypatch.setattr(col, "_DB_PATH", str(tmp_path / "c.db"))
    monkeypatch.setattr(col, "_MEDIA_DIR", tmp_path / "media")
    monkeypatch.setattr(col, "_nombre", lambda uid: f"u{uid}")
    monkeypatch.setattr(col, "colaboradores_ids", lambda: [20, 21])
    return col.crear("Collar persa", 8, colaborador_id=20)["id"]


def test_crear_sanea_y_toma_al_colaborador_como_proveedor(proyecto):
    p = cp.crear(proyecto, 8, {"nombre": "Collar L", "precio_publicacion": "58500", "comision_pct": 250,
                               "envio": -5, "iva_modo": "raro", "proveedor_id": 999,
                               "costos": [{"nombre": "Aros", "monto": 12727}, {"nombre": "", "monto": 0}, "x"]})
    assert p["precio_publicacion"] == 58500 and p["comision_pct"] == 100 and p["envio"] == 0
    assert p["iva_modo"] == "incluido" and p["costos"] == [{"nombre": "Aros", "monto": 12727.0}]
    assert p["proveedor_id"] is None          # 999 no es miembro: no se acepta
    q = cp.crear(proyecto, 8, {"nombre": "Collar M"})
    assert q["proveedor_id"] == 20
    with pytest.raises(ValueError):
        cp.crear(proyecto, 8, {"nombre": "  "})


def test_editar_deja_historial_y_reinicia_el_acuerdo(proyecto):
    p = cp.crear(proyecto, 8, {"nombre": "Collar L", "precio_compra": 35425})
    cp.acordar(proyecto, p["id"], 8, True)
    p = cp.acordar(proyecto, p["id"], 20, True)
    assert set(p["acuerdos"]) == {"8", "20"}
    # Cambiar la nota no toca lo acordado; cambiar el precio sí.
    assert set(cp.editar(proyecto, p["id"], 20, {"nota": "talla L"})["acuerdos"]) == {"8", "20"}
    p = cp.editar(proyecto, p["id"], 8, {"precio_compra": 29310, "nota": "talla L"})
    assert p["precio_compra"] == 29310 and p["acuerdos"] == {}
    cambios = cp.listar(proyecto)["cambios"]
    compra = [c for c in cambios if c["campo"] == "precio de compra"]
    assert compra and compra[0]["antes"] == "35.425" and compra[0]["despues"] == "29.310" and compra[0]["usuario_id"] == 8
    # Guardar lo mismo no deja ruido en el historial.
    n = len(cp.listar(proyecto)["cambios"])
    cp.editar(proyecto, p["id"], 8, {"precio_compra": 29310})
    assert len(cp.listar(proyecto)["cambios"]) == n


def test_acuerdo_solo_de_miembros_y_borrar(proyecto):
    p = cp.crear(proyecto, 8, {"nombre": "Collar M"})
    assert cp.acordar(proyecto, p["id"], 77, True)["acuerdos"] == {}
    cp.borrar(proyecto, p["id"], 20)
    assert cp.listar(proyecto)["productos"] == []
    with pytest.raises(ValueError):
        cp.editar(proyecto, p["id"], 8, {"precio_compra": 1})


def test_producto_de_otro_proyecto_no_se_toca(proyecto):
    otro = col.crear("Otro", 8, colaborador_id=20)["id"]
    p = cp.crear(otro, 8, {"nombre": "Ajeno"})
    with pytest.raises(ValueError):
        cp.editar(proyecto, p["id"], 8, {"precio_compra": 1})


def test_api_precios(cliente):  # noqa: F811
    did = cliente.post("/api/colaboradores/diagramas", headers=_h(), json={"titulo": "Collar"}).get_json()["id"]
    r = cliente.post(f"/api/colaboradores/diagramas/{did}/precios", json={"nombre": "Collar L"}, headers=_h("tok-armando"))
    assert r.status_code == 201
    pid = r.get_json()["id"]
    r = cliente.patch(f"/api/colaboradores/diagramas/{did}/precios/{pid}", json={"precio_publicacion": 58500}, headers=_h())
    assert r.status_code == 200 and r.get_json()["precio_publicacion"] == 58500
    d = cliente.get(f"/api/colaboradores/diagramas/{did}/precios", headers=_h()).get_json()
    assert [x["nombre"] for x in d["productos"]] == ["Collar L"] and set(d["participantes"]) == {"8", "20"}
    assert d["proveedor_defecto"] == 20
    r = cliente.post(f"/api/colaboradores/diagramas/{did}/precios/{pid}/acuerdo", json={"de_acuerdo": True}, headers=_h())
    assert r.get_json()["acuerdos"].keys() == {"20"}
    # Otra colaboradora, que no es miembro del proyecto, no lo ve ni lo toca.
    for metodo, ruta in [("get", f"/api/colaboradores/diagramas/{did}/precios"),
                         ("post", f"/api/colaboradores/diagramas/{did}/precios"),
                         ("patch", f"/api/colaboradores/diagramas/{did}/precios/{pid}"),
                         ("post", f"/api/colaboradores/diagramas/{did}/precios/{pid}/acuerdo")]:
        assert getattr(cliente, metodo)(ruta, headers=_h("tok-otra"), json={"nombre": "x"}).status_code == 404
