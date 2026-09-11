"""Solicitudes de pago con asiento automático.

Lo que estos tests protegen: que **el asiento nazca del acto de pagar** y no de
un paso posterior. Hasta sep-2026 los pagos se aprobaban como tickets de texto
libre y el asiento dependía de que alguien se acordara — no se hacía, y por eso
el Libro Mayor tenía las compras pero no los pagos.
"""
from __future__ import annotations

import sqlite3

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.pagos_wizard as w

    for mod in (cc, w):
        monkeypatch.setattr(mod, "_DB_PATH", db)
        monkeypatch.setattr(mod, "_initialized", False)
    w.init_db()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": banco})
    tercero = cc.crear_tercero({
        "nombre": "INTER RAPIDISIMO S.A", "tipo": "proveedor",
        "tipo_persona": "juridica", "identificacion": "800251569",
    })
    return cc, w, tercero, medio, db


def _pago(tercero, medio, **extra):
    return {"categoria": "flete_transporte", "monto": 850_000, "concepto": "Guías agosto",
            "tercero_id": tercero["id"], "medio_pago_id": medio["id"],
            "fecha": "2026-09-10", **extra}


def test_el_flete_va_a_su_cuenta_y_no_al_saco_de_servicios(mods):
    # Antes TODO gasto caía en 5135 "Servicios": luz, contador y fletes juntos.
    _cc, w, t, m, _ = mods
    prev = w.previsualizar(_pago(t, m))
    assert prev["lineas"][0]["cuenta_codigo"] == "513550"
    assert "Transporte" in prev["lineas"][0]["cuenta_nombre"]
    assert prev["cuadra"] is True


@pytest.mark.parametrize(
    "tipo, cuenta",
    [("luz", "513530"), ("agua", "513525"), ("gas", "513555"),
     ("internet", "513535"), ("saas", "513560"), ("desconocido", "513595")],
)
def test_cada_servicio_publico_a_su_cuenta(mods, tipo, cuenta):
    _cc, w, _t, m, _ = mods
    prev = w.previsualizar({"categoria": "servicio_publico", "monto": 100_000,
                            "concepto": "x", "medio_pago_id": m["id"],
                            "tipo_servicio": tipo, "fecha": "2026-09-10"})
    assert prev["lineas"][0]["cuenta_codigo"] == cuenta


def test_honorarios_calculan_retencion_solos(mods):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({"categoria": "honorarios", "monto": 2_500_000,
                            "concepto": "Contador", "tercero_id": t["id"],
                            "medio_pago_id": m["id"], "fecha": "2026-09-10"})
    assert prev["retencion"] == pytest.approx(250_000, abs=1)   # 10% declarante
    assert prev["girado"] == pytest.approx(2_250_000, abs=1)
    assert any(l["cuenta_codigo"] == "2365" for l in prev["lineas"])
    assert prev["cuadra"] is True


def test_crear_solicitud_NO_crea_asiento(mods):
    # El asiento nace al aprobar: una solicitud rechazada no debe dejar rastro.
    _cc, w, t, m, db = mods
    w.crear_solicitud(_pago(t, m))
    n = sqlite3.connect(db).execute("SELECT COUNT(*) FROM cc_movimientos").fetchone()[0]
    assert n == 0


def test_aprobar_crea_el_asiento_y_cuadra(mods):
    cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    r = w.aprobar(s["id"], espejar=False)
    assert r["estado"] == "aprobada"
    assert r["movimiento"]["id"]
    por_cuenta = {l["cuenta_codigo"]: l for l in r["movimiento"]["lineas"]}
    assert por_cuenta["513550"]["debito"] == pytest.approx(850_000, abs=1)
    assert por_cuenta["1110"]["credito"] == pytest.approx(850_000, abs=1)
    assert cc.balance_comprobacion()["cuadra"]


def test_rechazar_no_deja_rastro_contable(mods):
    _cc, w, t, m, db = mods
    s = w.crear_solicitud(_pago(t, m))
    w.rechazar(s["id"], "no corresponde")
    assert w.obtener(s["id"])["estado"] == "rechazada"
    assert sqlite3.connect(db).execute("SELECT COUNT(*) FROM cc_movimientos").fetchone()[0] == 0


def test_no_se_puede_aprobar_algo_rechazado(mods):
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    w.rechazar(s["id"])
    with pytest.raises(ValueError, match="rechazada"):
        w.aprobar(s["id"], espejar=False)


def test_doble_aprobacion_no_duplica_el_asiento(mods):
    # Un asiento duplicado en contabilidad no se deshace: hay que anularlo.
    _cc, w, t, m, db = mods
    s = w.crear_solicitud(_pago(t, m))
    w.aprobar(s["id"], espejar=False)
    r2 = w.aprobar(s["id"], espejar=False)
    assert r2.get("ya_aprobada") is True
    assert sqlite3.connect(db).execute("SELECT COUNT(*) FROM cc_movimientos").fetchone()[0] == 1


def test_categoria_que_exige_tercero_lo_reclama(mods):
    _cc, w, _t, m, _ = mods
    p = _pago({"id": None}, m)
    p["tercero_id"] = None
    with pytest.raises(ValueError, match="tercero"):
        w.previsualizar(p)


def test_falta_medio_de_pago_se_rechaza(mods):
    _cc, w, t, _m, _ = mods
    with pytest.raises(ValueError, match="medio de pago"):
        w.previsualizar({"categoria": "flete_transporte", "monto": 1000,
                         "concepto": "x", "tercero_id": t["id"], "fecha": "2026-09-10"})


def test_monto_invalido_se_rechaza(mods):
    _cc, w, t, m, _ = mods
    for monto in (0, -5000):
        with pytest.raises(ValueError, match="monto"):
            w.previsualizar(_pago(t, m, monto=monto))


def test_categoria_otro_exige_elegir_cuenta(mods):
    _cc, w, _t, m, _ = mods
    with pytest.raises(ValueError, match="cuenta contable"):
        w.previsualizar({"categoria": "otro", "monto": 50_000, "concepto": "x",
                         "medio_pago_id": m["id"], "fecha": "2026-09-10"})
    ok = w.previsualizar({"categoria": "otro", "monto": 50_000, "concepto": "x",
                          "medio_pago_id": m["id"], "cuenta_debito": "5195",
                          "fecha": "2026-09-10"})
    assert ok["lineas"][0]["cuenta_codigo"] == "5195"


def test_categoria_desconocida_se_rechaza(mods):
    _cc, w, _t, _m, _ = mods
    with pytest.raises(ValueError, match="Categoría desconocida"):
        w.previsualizar({"categoria": "inventada", "monto": 1000})


def test_el_asiento_aprobado_usa_lo_guardado_no_lo_que_llegue_despues(mods):
    """Se rearma desde la solicitud, no desde el frontend: lo que se contabiliza
    es lo que se aprobó."""
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    with w._conn() as con:   # alguien altera el monto por fuera
        con.execute("UPDATE cc_solicitudes_pago SET monto=1 WHERE id=?", (s["id"],))
    r = w.aprobar(s["id"], espejar=False)
    total = sum(l["debito"] for l in r["movimiento"]["lineas"])
    assert total == pytest.approx(1, abs=0.01)   # usa el valor guardado, no el original


# ─── Registro directo (socios que aprueban sus propios pagos) ───────────────

ADMIN = {"id": 8, "nombre": "Armando Garcia", "rol": {"nivel": 3}}
CYNTHIA = {"id": 6, "nombre": "Cynthia Ruiz", "rol": {"nivel": 3}}
OPERARIO = {"id": 10, "nombre": "Jenniffer Garcia", "rol": {"nivel": 1}}


@pytest.mark.parametrize(
    "usuario, espera",
    [(ADMIN, True), (CYNTHIA, True), (OPERARIO, False), (None, False),
     ({"id": 1, "nombre": "Supervisor", "rol": {"nivel": 2}}, False)],
)
def test_solo_administradores_registran_sin_aprobacion(mods, usuario, espera):
    _cc, w, _t, _m, _ = mods
    assert w.puede_registrar_directo(usuario) is espera


def test_operario_no_puede_saltarse_la_aprobacion(mods):
    _cc, w, t, m, db = mods
    with pytest.raises(ValueError, match="Solo un administrador"):
        w.registrar_pago_directo(_pago(t, m), OPERARIO)
    assert sqlite3.connect(db).execute("SELECT COUNT(*) FROM cc_movimientos").fetchone()[0] == 0


def test_el_socio_registra_y_contabiliza_en_un_paso(mods):
    cc, w, t, m, _ = mods
    r = w.registrar_pago_directo(_pago(t, m), ADMIN, espejar=False)
    assert r["estado"] == "aprobada"
    assert r["autoaprobada"] is True
    assert r["movimiento"]["id"]
    assert cc.balance_comprobacion()["cuadra"]


def test_el_registro_directo_no_abre_ticket_de_aprobacion(mods):
    # Un ticket que nace resuelto es ruido en la bandeja de alguien.
    _cc, w, t, m, _ = mods
    r = w.registrar_pago_directo(_pago(t, m), CYNTHIA, espejar=False)
    assert r["ticket_id"] is None


def test_queda_anotado_quien_lo_registro(mods):
    # Saltarse el control es válido; ocultarlo no. En una revisión hay que poder
    # distinguir un pago auto-aprobado de uno que pasó por otro par de ojos.
    _cc, w, t, m, _ = mods
    r = w.registrar_pago_directo(_pago(t, m), CYNTHIA, espejar=False)
    assert "Registrado directamente por Cynthia Ruiz" in r["notas"]


def test_el_asiento_directo_es_identico_al_del_flujo_con_aprobacion(mods):
    """Mismo motor por los dos caminos: si divergieran, un mismo pago quedaría
    contabilizado distinto según quién lo registre."""
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    con_aprobacion = w.aprobar(s["id"], espejar=False)["movimiento"]
    directo = w.registrar_pago_directo(_pago(t, m), ADMIN, espejar=False)["movimiento"]

    def firma(mov):
        return sorted((l["cuenta_codigo"], l["debito"], l["credito"]) for l in mov["lineas"])

    assert firma(con_aprobacion) == firma(directo)


def test_el_registro_directo_tambien_calcula_retencion(mods):
    _cc, w, t, m, _ = mods
    r = w.registrar_pago_directo(
        {"categoria": "honorarios", "monto": 2_500_000, "concepto": "Contador",
         "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-10"},
        ADMIN, espejar=False,
    )
    assert r["retencion"] == pytest.approx(250_000, abs=1)
    assert any(l["cuenta_codigo"] == "2365" for l in r["movimiento"]["lineas"])


def test_prestacion_servicios_no_usa_la_tarifa_de_honorarios(mods):
    """Quien presta servicios no es un honorario: 4-6%, no 10-11%.

    Sin categoría propia, el pago quincenal de una persona de calidad o empaque
    solo podía entrar como «Honorarios» (5110, 10-11%) o como «Otro» — y una
    tarifa de retención equivocada sale del bolsillo de una persona real.
    """
    _cc, w, _t, _m, _ = mods
    servicios = w.CATEGORIAS["prestacion_servicios"]
    assert servicios["cuenta_debito"] == "5135"
    assert servicios["concepto_retencion"] == "servicios"
    assert w.CATEGORIAS["honorarios"]["cuenta_debito"] == "5110"
    assert servicios["requiere_tercero"] is True


def test_pago_de_servicios_arma_gasto_retencion_y_banco(mods):
    """El asiento completo: gasto bruto, retención practicada y giro neto."""
    cc, w, _t, m, _ = mods
    persona = cc.crear_tercero({
        "nombre": "Gloria Stella Velandia Cobos", "tipo": "otro",
        "tipo_persona": "natural", "identificacion": "21102893", "declarante": 1,
    })
    prev = w.previsualizar({
        "categoria": "prestacion_servicios", "monto": 1_250_000,
        "concepto": "Prestación de servicios", "tercero_id": persona["id"],
        "medio_pago_id": m["id"], "fecha": "2026-09-15",
    })
    por_cuenta = {l["cuenta_codigo"]: l for l in prev["lineas"]}
    assert por_cuenta["5135"]["debito"] == 1_250_000
    assert por_cuenta["2365"]["credito"] == 50_000   # 4% declarante
    assert por_cuenta["1110"]["credito"] == 1_200_000
    assert prev["cuadra"] is True
