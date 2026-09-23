"""Revisión de facturación MeLi por venta (21-sep-2026).

- «Revisado» y «Pedir intervención» viven en la venta, sin ticket global.
- Un duplicado con la factura de Alegra ya anulada no vuelve a alertar.
- El margen de 48h se mide desde la ENTREGA, nunca desde la creación del envío.
- El histórico sabe qué filas tienen la foto vieja.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta

import pytest


@pytest.fixture()
def dbs(tmp_path, monkeypatch):
    from app.services import facturacion_ventas_cache as cache
    from app.services import tickets_db

    monkeypatch.setattr(cache, "DB_PATH", str(tmp_path / "ventas.db"))
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets.db"))
    tickets_db.init_db()
    with sqlite3.connect(tickets_db.DB_PATH) as db:
        ids = [r[0] for r in db.execute("SELECT id FROM usuarios ORDER BY id")]
        if len(ids) < 2:
            rol = db.execute("SELECT id FROM roles ORDER BY id LIMIT 1").fetchone()
            for nombre in ("Ana Prueba", "Beto Prueba"):
                db.execute(
                    "INSERT INTO usuarios (username, nombre, password_hash, rol_id, activo) VALUES (?,?,?,?,1)",
                    (nombre.split()[0].lower(), nombre, "x", rol[0] if rol else None),
                )
            ids = [r[0] for r in db.execute("SELECT id FROM usuarios ORDER BY id")]
    for fn in ("notificar_ticket_creado", "notificar_comentario_agregado"):
        monkeypatch.setattr(f"app.services.tickets_notificaciones.{fn}", lambda *a, **k: None, raising=False)
    return cache, ids


def _venta(**kw):
    base = {
        "order_id": "2000000000000001",
        "pack_id": "2000000000000009",
        "ordenes_ids": ["2000000000000001"],
        "es_meli": True,
        "es_cancelada": False,
        "fecha": "2026-09-15T10:00:00.000-04:00",
        "total": 50000,
        "estado_facturacion": "sin_facturar",
        "facturas": [],
        "factura_legado": None,
        "posible_duplicado": False,
    }
    base.update(kw)
    return base


def test_fecha_entrega_no_usa_creacion_del_envio():
    from app.services.facturacion_ventas_unificado import _fecha_entrega_envio

    envio = {"date_created": "2026-09-10T08:00:00-04:00", "last_updated": "2026-09-20T15:00:00-04:00",
             "status_history": {}}
    assert _fecha_entrega_envio(envio) == "2026-09-20T15:00:00-04:00"
    envio["status_history"]["date_delivered"] = "2026-09-19T12:00:00-04:00"
    assert _fecha_entrega_envio(envio) == "2026-09-19T12:00:00-04:00"
    assert _fecha_entrega_envio({"date_created": "2026-09-10"}) is None
    assert _fecha_entrega_envio(None) is None


def test_problema_de_venta():
    from app.services.facturacion_ventas_unificado import problema_de_venta

    assert problema_de_venta(_venta())[0] == "sin_facturar"
    assert problema_de_venta(_venta(estado_facturacion="en_transito"))[0] is None
    assert problema_de_venta(_venta(estado_facturacion="en_margen_entrega"))[0] is None
    dup = _venta(estado_facturacion="facturada_completa", posible_duplicado=True,
                 factura_legado={"factura_numero": "FV-2-1", "integracion": "astroselling"})
    tipo, motivo = problema_de_venta(dup)
    assert tipo == "posible_duplicado" and "FV-2-1" in motivo


def test_revisado_sin_ticket_y_anotado_al_leer(dbs):
    cache, _ = dbs
    from app.services.facturacion_ventas_unificado import anotar_filas

    cache.guardar_ventas([_venta()])
    fila = cache.listar_historial(segmento="todas")["ventas"][0]
    assert anotar_filas([fila])[0]["revisado"] is False

    cache.marcar_revisado("2000000000000001", pack_id="2000000000000009", notas="ya facturada por fuera")
    # La foto guardada no cambió, pero al servirla se ve revisada.
    fila = cache.listar_historial(segmento="todas")["ventas"][0]
    anotada = anotar_filas([fila])[0]
    assert anotada["revisado"] is True
    assert anotada["revisado_notas"] == "ya facturada por fuera"


def test_intervencion_una_por_venta(dbs):
    _, ids = dbs
    from app.services.facturacion_ventas_unificado import anotar_filas
    from app.tools.revision_facturacion import intervenciones_map, pedir_intervencion

    venta = _venta()
    ok, iv = pedir_intervencion(venta, asignado_a=ids[1], creador_id=ids[0], problema="error_al_facturar",
                                mensaje="Alegra dice que falta el SKU")
    assert ok, iv
    assert iv["asignado_a"] == ids[1] and iv["abierta"]

    # Segunda vez: no crea otro ticket, comenta en el abierto.
    ok, iv2 = pedir_intervencion(venta, asignado_a=ids[1], creador_id=ids[0], problema="otro", mensaje="¿novedades?")
    assert ok and iv2["ya_existia"] and iv2["ticket_id"] == iv["ticket_id"]
    assert list(intervenciones_map()) == ["2000000000000009"]

    fila = anotar_filas([_venta()])[0]
    assert fila["intervencion"]["ticket_id"] == iv["ticket_id"]


def test_filas_para_revalidar_prioriza_accionables(dbs):
    cache, _ = dbs
    cache.guardar_ventas([
        _venta(order_id="1", pack_id="1", estado_facturacion="en_transito"),
        _venta(order_id="2", pack_id="2", estado_facturacion="sin_facturar"),
        _venta(order_id="3", pack_id="3", estado_facturacion="facturada_completa"),
        _venta(order_id="4", pack_id="4", estado_facturacion="facturada_completa", posible_duplicado=True),
    ])
    viejo = (datetime.now() - timedelta(hours=2)).isoformat(timespec="seconds")
    with sqlite3.connect(cache.DB_PATH) as con:
        con.execute("UPDATE ventas_cache SET actualizado_en = ?", (viejo,))
    ids = cache.filas_para_revalidar(max_filas=10, edad_minima_min=20)
    assert "3" not in ids  # facturada sin duda: no cambia sola
    assert set(ids[:2]) == {"2", "4"} and ids[2] == "1"
    # Recién consultadas: nada que revalidar.
    with sqlite3.connect(cache.DB_PATH) as con:
        con.execute("UPDATE ventas_cache SET actualizado_en = ?", (datetime.now().isoformat(timespec="seconds"),))
    assert cache.filas_para_revalidar(max_filas=10, edad_minima_min=20) == []


def test_payload_duplicado_se_detecta_en_sql(dbs):
    """filas_para_revalidar busca el texto del JSON: si cambia el formato de
    json.dumps, deja de encontrar los duplicados."""
    assert '"posible_duplicado": true' in json.dumps({"posible_duplicado": True})


def test_indice_legado_de_alegra_no_es_duplicado():
    """21-sep-2026: FE463 emitida contra el pack aparecía como doble de sí misma
    porque el índice legado la guarda como {'factura_id': '463', número vacío}."""
    from app.services.facturacion_ventas_unificado import _sin_autorreferencia

    alegra = {"factura_id": "463", "factura_numero": "", "integracion": "mckenna", "total": 65695}
    assert _sin_autorreferencia(alegra, []) is None
    assert _sin_autorreferencia({"factura_id": "90", "factura_numero": "FE90"}, []) is None
    siigo = {"factura_id": "d76fcd3d-92c0-4dfe-a9f2-91dc2d703307", "factura_numero": "FV-2-71416",
             "integracion": "astroselling"}
    assert _sin_autorreferencia(siigo, [{"factura_id": "56"}]) == siigo


def test_facturar_ahora_no_emite_dos_veces(monkeypatch):
    """21-sep-2026: 22 facturas de más por peticiones simultáneas sobre la misma venta."""
    import threading
    import time

    from app.tools import meli_autofactura_entrega as m

    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda oid, **k: {"id": oid, "pack_id": "P1"})
    monkeypatch.setattr(m, "consultar_pack_meli", lambda pid, **k: {"orders": [{"id": "O1"}, {"id": "O2"}]})
    emitidas: list[str] = []

    def lento(oid):
        time.sleep(0.3)
        emitidas.append(oid)
        return {"ok": True}

    monkeypatch.setattr(m, "_facturar_pack_meli_manual_sin_candado", lento)
    monkeypatch.setattr(m, "_facturas_alegra_existentes", lambda claves, paginas=2: [])
    res: list[dict] = []
    hilos = [threading.Thread(target=lambda o=o: res.append(m.facturar_pack_meli_manual(o))) for o in ("O1", "O2", "O1")]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert len(emitidas) == 1
    assert sum(1 for r in res if r.get("en_curso")) == 2

    # Ya existe en Alegra → no emite.
    monkeypatch.setattr(m, "_facturas_alegra_existentes",
                        lambda claves, paginas=2: [{"id": 9, "numberTemplate": {"fullNumber": "FE9"}}])
    r = m.facturar_pack_meli_manual("O1")
    assert r["ok"] is False and r["ya_facturada"] and "FE9" in r["error"]
    assert len(emitidas) == 1


def test_no_factura_si_meli_reembolso(monkeypatch):
    """2000018509202610: MeLi devolvió una de dos unidades; facturar el total estaría mal."""
    from app.tools import meli_autofactura_entrega as m

    orden = {"id": "O1", "status": "partially_refunded", "total_amount": 28730, "paid_amount": 14365,
             "payments": [{"transaction_amount_refunded": 14365}]}
    motivo = m._venta_no_cuadra(orden, {"O1"})
    assert motivo and "14,365" in motivo
    limpia = {"id": "O2", "status": "paid", "total_amount": 100, "payments": [{"transaction_amount_refunded": 0}]}
    assert m._venta_no_cuadra(limpia, {"O2"}) is None
    assert "cancelada" in m._venta_no_cuadra({**limpia, "status": "cancelled"}, {"O2"})


def test_plan_anular_sobrantes(monkeypatch):
    from app.services import facturacion_resolucion as r

    monkeypatch.setattr(r, "_horas_facturas_alegra",
                        lambda ids: {"533": "2026-09-21 16:24:58", "532": "2026-09-21 16:24:50"})
    doble = _venta(duplicado_alegra=True, facturas=[
        {"factura_id": "533", "numero": "FE533", "total": 44973, "notas_credito": []},
        {"factura_id": "532", "numero": "FE532", "total": 44973, "notas_credito": []},
    ])
    plan = r.plan_anular_sobrantes(doble)
    assert plan["conservar"].startswith("FE532") and [a["numero"] for a in plan["anular"]] == ["FE533"]

    siigo = _venta(factura_legado={"factura_numero": "FV-2-71416", "integracion": "astroselling"},
                   facturas=[{"factura_id": "56", "numero": "FE56", "total": 16600, "notas_credito": []}])
    plan = r.plan_anular_sobrantes(siigo)
    assert "FV-2-71416" in plan["conservar"] and [a["numero"] for a in plan["anular"]] == ["FE56"]

    assert r.plan_anular_sobrantes(_venta())["ok"] is False


def test_contacto_consumidor_final_no_se_sobrescribe(monkeypatch):
    """22-sep-2026: FE486 renombró el contacto genérico a «Jaiver Quintero pinzon» (NIT)."""
    from app.services import alegra as a

    monkeypatch.setattr(a, "_alegra_headers", lambda: {})
    a._contacto_cache.clear()

    class R:
        status_code = 200
        def json(self): return [{"id": 1}]

    puts: list = []
    monkeypatch.setattr(a.requests, "get", lambda *x, **k: R())
    monkeypatch.setattr(a.requests, "put", lambda *x, **k: puts.append(k))
    cid, err = a._resolver_o_crear_contacto_alegra(nombre="Jaiver Quintero", identificacion="222222222222", tipo_documento="NIT")
    assert cid == "1" and not err and puts == []
    a._contacto_cache.clear()
    a._resolver_o_crear_contacto_alegra(nombre="Ana Real", identificacion="52378053", tipo_documento="CC")
    assert len(puts) == 1 and puts[0]["json"]["name"] == "Ana Real"
    a._contacto_cache.clear()


def test_facturar_ahora_en_segundo_plano(monkeypatch):
    """22-sep-2026: el POST esperaba 30-210 s y Cloudflare devolvía 504 a los 100 s."""
    import time

    from flask import Flask

    from app.tools import meli_autofactura_entrega as m

    monkeypatch.setenv("CHAT_API_TOKEN", "tok-fact")
    llamadas: list[str] = []

    def lento(oid):
        llamadas.append(oid)
        time.sleep(0.4)
        return {"ok": True, "mensaje": "Factura FE999 creada"}

    monkeypatch.setattr(m, "facturar_pack_meli_manual", lento)
    monkeypatch.setattr("app.services.facturacion_ventas_unificado.consultar_venta_individual", lambda oid: None)
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    hdr = {"Authorization": "Bearer tok-fact"}
    with app.test_client() as c:
        t0 = time.time()
        r = c.post("/api/facturacion/ventas-unificadas/facturar-ahora", json={"order_id": "777"}, headers=hdr)
        assert r.status_code == 202 and r.get_json()["en_curso"] and time.time() - t0 < 0.3
        r2 = c.post("/api/facturacion/ventas-unificadas/facturar-ahora", json={"order_id": "777"}, headers=hdr)
        assert r2.get_json().get("ya_estaba") is True
        for _ in range(20):
            e = c.get("/api/facturacion/ventas-unificadas/facturar-ahora/estado/777", headers=hdr).get_json()
            if e["estado"] == "terminado":
                break
            time.sleep(0.1)
        assert e["estado"] == "terminado" and e["resultado"]["ok"]
        assert llamadas == ["777"]
        assert c.get("/api/facturacion/ventas-unificadas/facturar-ahora/estado/nada", headers=hdr).get_json()["estado"] == "desconocido"
