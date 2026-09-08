"""
Tests del módulo de Resolución de Anulaciones (RA).

Todo lo de aquí es PURO: no toca red, no llama a Alegra ni a MeLi. La base de
datos se apunta a un archivo temporal, nunca a `app/data/contabilidad.db`.

Cubre las tres cosas que si se rompen dejan un caso perdido en silencio:
la clasificación de la matriz de situaciones, la política de autonomía y la
máquina de estados del expediente. Más el bug concreto que motivó el módulo:
el tópico `post_purchase` del webhook.
"""

from __future__ import annotations

import importlib
import os
import tempfile

import pytest

from app.meli_webhook_topics import (
    meli_webhook_es_reclamo_devolucion,
    meli_webhook_evaluar_despacho,
)


@pytest.fixture()
def adb(monkeypatch):
    """`anulaciones_db` apuntando a una base temporal."""
    from app.services import anulaciones_db as _adb

    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setattr(_adb, "_DB_PATH", tmp.name)
    monkeypatch.setattr(_adb, "_initialized", False)
    _adb.init_db()
    yield _adb
    os.unlink(tmp.name)


# ── El bug que motivó el módulo ───────────────────────────────────────────────


def test_post_purchase_es_reclamo():
    """MeLi notifica los reclamos con el tópico `post_purchase`. Que no
    estuviera en la lista hizo que 38 notificaciones de 7 reclamos distintos se
    descartaran entre el 4 y el 8 de septiembre de 2026, sin un solo ticket."""
    assert meli_webhook_es_reclamo_devolucion("post_purchase")
    assert meli_webhook_es_reclamo_devolucion("marketplace_post_purchase")
    # Los nombres viejos siguen reconociéndose.
    for t in ("claims", "returns", "mediations", "marketplace_claims"):
        assert meli_webhook_es_reclamo_devolucion(t)
    assert not meli_webhook_es_reclamo_devolucion("orders_v2")


def test_despacho_de_resource_real_post_purchase():
    """Resource real observado en `webhook_meli_incidents.jsonl`."""
    plan = meli_webhook_evaluar_despacho(
        "post_purchase",
        "/post-purchase/v1/claims/5572649029",
        {"topic": "post_purchase", "resource": "/post-purchase/v1/claims/5572649029"},
    )
    assert plan["tipo"] == "reclamo", f"cayó en {plan['tipo']!r} — se descartaría en silencio"


# ── 1. Detección: el reintegro, no el estado de la orden ──────────────────────


def test_reintegro_desde_payments_en_orden_pagada():
    """El caso que rompió todo: la orden sigue PAGADA (devolución), así que
    mirar `status == cancelled` la deja fuera."""
    from app.services import anulaciones_motor as motor

    orden = {
        "status": "paid",
        "total_amount": 77494,
        "payments": [{"status": "refunded", "transaction_amount": 77494,
                      "date_last_modified": "2026-09-05T10:00:00.000-05:00"}],
    }
    r = motor.reintegro_de_orden(orden)
    assert r["hubo"] and r["monto"] == 77494 and r["fuente"] == "payments"


def test_sin_reintegro_no_hay_hecho_contable():
    from app.services import anulaciones_motor as motor

    orden = {"status": "paid", "total_amount": 50000,
             "payments": [{"status": "approved", "transaction_amount": 50000}]}
    assert motor.reintegro_de_orden(orden)["hubo"] is False


def test_cancelada_sin_payments_usa_fecha_real_de_cancelacion():
    """`date_closed` es de cuando la orden se cerró, no de cuando se canceló:
    usarlo adelanta el margen de seguridad."""
    from app.services import anulaciones_motor as motor

    orden = {
        "status": "cancelled", "total_amount": 30000, "payments": [],
        "date_closed": "2026-08-01T10:00:00.000-05:00",
        "cancel_detail": {"date": "2026-09-07T10:00:00.000-05:00"},
    }
    r = motor.reintegro_de_orden(orden)
    assert r["hubo"] and r["fecha"].startswith("2026-09-07")


# ── 2. Clasificación: la matriz de situaciones ────────────────────────────────


def test_reclamo_a_favor_del_vendedor_no_emite_nc():
    """La trampa del flujo viejo: pedía anular la factura al ABRIR el reclamo.
    Sin reintegro y con el vendedor beneficiado, la venta sigue viva."""
    from app.services import anulaciones_motor as motor

    clas = motor.clasificar(
        {"status": "paid", "total_amount": 50000, "payments": []},
        {"hubo": False, "monto": 0, "fecha": None, "fuente": ""},
        claim={"resolution": {"benefited": "seller"}},
    )
    assert clas["emite_nc"] is False


def test_devolucion_parcial_no_es_anulacion_total():
    from app.services import anulaciones_motor as motor

    clas = motor.clasificar(
        {"status": "paid", "total_amount": 100000, "payments": []},
        {"hubo": True, "monto": 40000, "fecha": None, "fuente": "payments"},
    )
    assert clas["motivo"] == "devolucion_parcial" and clas["alcance"] == "parcial"


def test_reembolso_a_cargo_de_meli_se_marca_pero_igual_emite():
    """La venta al comprador se anula igual; la compensación de MeLi es un
    ingreso aparte, no la venta original sobreviviendo."""
    from app.services import anulaciones_motor as motor

    clas = motor.clasificar(
        {"status": "paid", "total_amount": 60000, "payments": []},
        {"hubo": True, "monto": 60000, "fecha": None, "fuente": "payments"},
        claim={"player_responsible": "meli"},
    )
    assert clas["motivo"] == "reembolso_meli" and clas["financia"] == "meli"
    assert clas["emite_nc"] is True


def test_cancelacion_pre_despacho_no_reingresa_producto():
    from app.services import anulaciones_motor as motor

    clas = motor.clasificar(
        {"status": "cancelled", "total_amount": 20000, "payments": [],
         "shipping": {"status": "pending"}},
        {"hubo": True, "monto": 20000, "fecha": None, "fuente": "status_cancelled"},
    )
    assert clas["motivo"] == "cancelacion_pre_despacho" and clas["producto_retorna"] == 0


# ── 3. Autonomía: determinista, no criterio del modelo ────────────────────────


def test_caso_limpio_es_automatico(monkeypatch):
    from app.services import anulaciones_motor as motor

    monkeypatch.setenv("RA_UMBRAL_AUTONOMIA", "300000")
    caso = {"motivo": "devolucion_producto", "alcance": "total", "financia": "vendedor",
            "factura_proveedor": "alegra", "monto_reintegrado": 77494, "cliente_doc": ""}
    assert motor.evaluar_autonomia(caso)["autonomia"] == "automatica"


@pytest.mark.parametrize(
    "cambio",
    [
        {"factura_proveedor": "siigo"},          # NC sin referencia: decisión del contador
        {"financia": "meli"},                    # tratamiento del ingreso por compensación
        {"alcance": "parcial"},                  # NC por líneas, no por el total
        {"monto_reintegrado": 999_999},          # supera el umbral
        {"cliente_doc": "1020304050"},           # cliente real, no consumidor final
        {"motivo": "cambio_producto"},           # fuera de la lista blanca
    ],
)
def test_casos_sensibles_exigen_decision_humana(monkeypatch, cambio):
    from app.services import anulaciones_motor as motor

    monkeypatch.setenv("RA_UMBRAL_AUTONOMIA", "300000")
    monkeypatch.setenv("SIIGO_MELI_NIT_CONSUMIDOR_FINAL", "222222222222")
    caso = {"motivo": "devolucion_producto", "alcance": "total", "financia": "vendedor",
            "factura_proveedor": "alegra", "monto_reintegrado": 77494, "cliente_doc": ""}
    caso.update(cambio)
    resultado = motor.evaluar_autonomia(caso)
    assert resultado["autonomia"] == "manual" and resultado["motivos"]


# ── 4. Expediente: idempotencia y máquina de estados ──────────────────────────


def test_abrir_expediente_es_idempotente_y_no_pisa_lo_conocido(adb):
    ref = adb.referencia_meli("2000014813807951")
    a = adb.abrir_expediente(referencia=ref, origen="meli_reclamo",
                             factura_numero="FV-2-71288", pack_id="2000014813807951")
    b = adb.abrir_expediente(referencia=ref, origen="meli_reclamo",
                             factura_numero="OTRA-COSA", factura_cufe="9f3a")
    assert a["id"] == b["id"]
    assert b["factura_numero"] == "FV-2-71288", "un webhook posterior no puede pisar lo ya resuelto"
    assert b["factura_cufe"] == "9f3a", "pero sí debe rellenar lo que faltaba"


def test_transicion_invalida_falla_en_vez_de_escribir(adb):
    caso = adb.abrir_expediente(referencia="meli:pack:1", origen="meli_cancelacion")
    with pytest.raises(ValueError):
        adb.transicionar(caso["id"], "cerrada", resumen="atajo")
    assert adb.obtener(caso["id"])["estado"] == "detectada"


def test_bloqueada_puede_volver_al_ruedo(adb):
    """El `read_only` de Siigo se resuelve reactivando la cuenta: un caso
    bloqueado no puede quedar muerto."""
    caso = adb.abrir_expediente(referencia="meli:pack:2", origen="meli_cancelacion")
    adb.transicionar(caso["id"], "lista", resumen="lista")
    adb.transicionar(caso["id"], "emitiendo", resumen="emitiendo")
    adb.transicionar(caso["id"], "bloqueada", resumen="Siigo read_only",
                     bloqueo_motivo="proveedor_read_only")
    reabierto = adb.transicionar(caso["id"], "lista", resumen="Siigo reactivado")
    assert reabierto["estado"] == "lista"


def test_eventos_son_append_only_y_deduplicables(adb):
    caso = adb.abrir_expediente(referencia="meli:pack:3", origen="web")
    for _ in range(3):
        adb.registrar_evento(caso["id"], tipo="fallo", resumen="mismo error", dedupe=True)
    tipos = [e["tipo"] for e in adb.eventos(caso["id"])]
    assert tipos.count("fallo") == 1, "un reintento repetido no debe llenar el expediente de ruido"
    assert tipos[0] == "detectado", "la apertura siempre queda registrada"


def test_evento_sin_resumen_legible_se_rechaza(adb):
    caso = adb.abrir_expediente(referencia="meli:pack:4", origen="manual")
    with pytest.raises(ValueError):
        adb.registrar_evento(caso["id"], tipo="nota", resumen="   ")


def test_deuda_abierta_cuenta_lo_pendiente(adb):
    a = adb.abrir_expediente(referencia="meli:pack:5", origen="meli_cancelacion", factura_total=50000)
    adb.abrir_expediente(referencia="meli:pack:6", origen="meli_cancelacion", factura_total=30000)
    deuda = adb.deuda_abierta()
    assert deuda["abiertas"] == 2 and deuda["monto"] == 80000
    adb.transicionar(a["id"], "descartada", resumen="reclamo a favor del vendedor")
    assert adb.deuda_abierta()["abiertas"] == 1


def test_resolver_acepta_cualquier_identificador(adb):
    caso = adb.abrir_expediente(referencia=adb.referencia_meli("200099"), origen="meli_reclamo",
                                pack_id="200099", factura_numero="FV-2-71288")
    for ident in (caso["codigo"], "meli:pack:200099", "200099", "FV-2-71288"):
        assert adb.resolver(ident)["id"] == caso["id"], f"no resolvió por {ident!r}"


def test_buscar_precedentes(adb):
    adb.abrir_expediente(referencia="meli:pack:7", origen="meli_reclamo",
                         motivo="reembolso_sin_devolucion", relato="devolucion de colageno sin retorno")
    assert adb.buscar("colageno devolucion")
    assert adb.buscar("importaciones china") == []


# ── 5. El relato: lo único que el contador ve en Alegra ───────────────────────


def test_relato_cabe_en_observations_y_no_se_corta_a_la_mitad():
    from app.services import anulaciones_motor as motor

    caso = {
        "codigo": "RA-2026-0142", "pack_id": "2000014813807951", "claim_id": "5572649029",
        "motivo": "devolucion_producto", "factura_numero": "FV-2-71288",
        "factura_proveedor": "siigo", "factura_cufe": "9f3a" * 20, "factura_fecha": "2026-09-01",
        "factura_total": 77494, "monto_reintegrado": 77494, "financia": "vendedor",
        "producto_retorna": 1, "autonomia": "automatica",
    }
    texto = motor.relato_para_observaciones(caso, limite=500)
    assert len(texto) <= 500
    assert "RA-2026-0142" in texto, "el código del expediente es el hilo hacia todo lo demás"
    assert texto.count("\n") >= 1


def test_relato_lleva_el_cufe_de_la_factura_siigo():
    """Es el único hilo que queda entre los dos sistemas cuando la nota crédito
    se emite en Alegra sin referencia."""
    from app.services import anulaciones_motor as motor

    caso = {"codigo": "RA-2026-0001", "motivo": "devolucion_producto",
            "factura_numero": "FV-2-71288", "factura_proveedor": "siigo",
            "factura_cufe": "abc123", "factura_total": 77494, "pack_id": "2000014813807951"}
    assert "abc123" in motor.relato_para_observaciones(caso)
    assert "FV-2-71288" in motor.relato_para_observaciones(caso)
