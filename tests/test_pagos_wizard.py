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
    from app.services import tickets_db

    for mod in (cc, w):
        monkeypatch.setattr(mod, "_DB_PATH", db)
        monkeypatch.setattr(mod, "_initialized", False)
    # `crear_solicitud` abre un ticket de aprobación. Sin esto, cada corrida de
    # la suite dejaba ~10 tickets «Aprobar pago — Flete o transporte: $850.000»
    # en la bandeja REAL de Armando (69 el 11-sep-2026), apuntando a solicitudes
    # que solo existían en la base temporal del test.
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
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
     ("internet", "513535"), ("saas", "513520"), ("desconocido", "513595")],
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
    # Honorarios acreditan su propia subcuenta del PUC (236515), no la 2365 plana:
    # es lo que le permite al contador armar el 350 por concepto sin desglosar a mano.
    assert any(l["cuenta_codigo"] == "236515" for l in prev["lineas"])
    assert prev["cuadra"] is True


def test_crear_solicitud_NO_crea_asiento(mods):
    # El asiento nace al aprobar: una solicitud rechazada no debe dejar rastro.
    _cc, w, t, m, db = mods
    w.crear_solicitud(_pago(t, m))
    n = sqlite3.connect(db).execute("SELECT COUNT(*) FROM cc_movimientos").fetchone()[0]
    assert n == 0


def test_la_suite_no_abre_tickets_en_la_base_real(mods):
    import os
    import uuid

    from app.services import tickets_db

    _cc, w, t, m, _ = mods
    marca = f"test-{uuid.uuid4().hex}"
    w.crear_solicitud(_pago(t, m, concepto=marca))

    real = os.path.join(os.path.dirname(tickets_db.__file__), "..", "data", "tickets.db")
    if not os.path.isfile(real):
        return
    con = sqlite3.connect(f"file:{real}?mode=ro", uri=True)
    try:
        n = con.execute("SELECT COUNT(*) FROM tickets WHERE descripcion LIKE ?",
                        (f"%{marca}%",)).fetchone()[0]
    finally:
        con.close()
    assert n == 0


def test_aprobar_deja_constancia_en_el_ticket(mods):
    """Quien gira se entera por el ticket, con el valor exacto que verá el extracto."""
    from app.services import tickets_db

    _cc, w, t, m, _ = mods
    tickets_db.init_db()   # una sola pasada: init_db ya migra después de crear
    with tickets_db._conn() as db:
        db.execute("INSERT OR IGNORE INTO roles (id, nombre, nivel) VALUES (1,'Admin',3)")
        db.execute("INSERT INTO usuarios (id, username, nombre, password_hash, rol_id, activo)"
                   " VALUES (8,'armando','Armando','x',1,1)")
        db.execute("INSERT INTO tickets (id, numero, titulo, descripcion, categoria, estado, creado_por)"
                   " VALUES (1,'TKT-T-0001','PAGO','PAGO','logistica','pendiente',8)")
        db.commit()
    s = w.crear_solicitud({**_pago(t, m), "_sin_ticket": True})
    with w._conn() as con:
        con.execute("UPDATE cc_solicitudes_pago SET ticket_id=1 WHERE id=?", (s["id"],))
    w.aprobar(s["id"], aprobada_por=8, espejar=False)
    with tickets_db._conn() as db:
        textos = [r["texto"] for r in db.execute("SELECT texto FROM comentarios_tickets WHERE ticket_id=1")]
    assert any("aprobado" in x and "$850.000" in x for x in textos)


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
    assert por_cuenta["236525"]["credito"] == 50_000  # 4% declarante, a la subcuenta de servicios
    assert por_cuenta["1110"]["credito"] == 1_200_000
    assert prev["cuadra"] is True


# ── Borradores del sistema y plantillas recurrentes (sep-2026) ──────────────
# Nacen del caso TKT-2026-1252: el cron escribía las cifras dentro del texto
# del ticket, el cronograma cambió y el ticket siguió pidiendo girar un valor
# que ya no existía. Ahora el cron deja un borrador y los montos se leen del
# origen cada vez que se abre.


def test_borrador_no_abre_ticket_ni_contabiliza(mods):
    _cc, w, t, m, _ = mods
    sol = w.crear_solicitud(_pago(t, m, estado="borrador"))
    assert sol["estado"] == "borrador"
    assert not sol["ticket_id"]
    assert not sol["movimiento_id"]


def test_borrador_del_sistema_no_se_duplica(mods):
    # El cron puede correr dos veces, o pueden correr dos crons: la idempotencia
    # vive en el índice único de origen_ref, no en la buena suerte del cron.
    _cc, w, t, m, _ = mods
    uno = w.crear_borrador_idempotente(_pago(t, m, origen_ref="prestamo:7:cuota:3"))
    dos = w.crear_borrador_idempotente(_pago(t, m, origen_ref="prestamo:7:cuota:3"))
    assert dos["id"] == uno["id"]
    assert dos.get("ya_existia")
    assert len([s for s in w.listar() if s["origen_ref"] == "prestamo:7:cuota:3"]) == 1


def test_enviar_a_aprobacion_abre_el_ticket_y_el_asiento_nace_al_aprobar(mods, monkeypatch):
    cc, w, t, m, _ = mods
    # El ticket se verifica espiando la llamada, no contra la BD de tickets: en
    # una base nueva el CHECK de `categoria` todavía no incluye 'contabilidad'
    # y `crear_ticket` falla en silencio, que es un problema aparte del wizard.
    llamadas = []
    monkeypatch.setattr(
        w, "_abrir_ticket", lambda sid, prev, cb: llamadas.append((sid, prev)) or 99
    )
    sol = w.crear_solicitud(_pago(t, m, estado="borrador"))
    assert llamadas == []                    # un borrador no molesta al aprobador

    enviado = w.enviar_a_aprobacion(sol["id"])
    assert enviado["estado"] == "pendiente"
    assert enviado["ticket_id"] == 99
    assert len(llamadas) == 1
    # El aprobador ve el asiento que va a quedar, no solo el monto
    assert llamadas[0][1]["lineas"]
    assert not enviado["movimiento_id"]      # todavía no

    aprobada = w.aprobar(sol["id"], espejar=False)
    assert aprobada["movimiento_id"]
    assert cc.balance_comprobacion()["cuadra"]


def test_no_se_envia_dos_veces_ni_se_envia_lo_ya_aprobado(mods):
    _cc, w, t, m, _ = mods
    sol = w.crear_solicitud(_pago(t, m, estado="borrador"))
    w.enviar_a_aprobacion(sol["id"])
    with pytest.raises(ValueError, match="pendiente"):
        w.enviar_a_aprobacion(sol["id"])


def test_el_operador_puede_corregir_el_monto_al_enviar(mods):
    # Es el trabajo del operador: cotejar contra el documento real. Si el
    # sistema propuso 850.000 y la factura dice 910.000, manda lo que dice la
    # factura, no lo que adivinó el cron.
    _cc, w, t, m, _ = mods
    sol = w.crear_solicitud(_pago(t, m, estado="borrador"))
    enviado = w.enviar_a_aprobacion(sol["id"], {"monto": 910_000, "referencia": "FV-77"})
    assert enviado["monto"] == 910_000
    assert enviado["referencia"] == "FV-77"


def test_plantilla_recurrente_se_instancia_una_vez_por_periodo(mods):
    _cc, w, t, m, _ = mods
    plan = w.crear_solicitud(_pago(t, m, es_plantilla=True, frecuencia="mensual",
                                   concepto="Guías Interrapidísimo"))
    assert plan["es_plantilla"] == 1
    assert plan["estado"] == "borrador"     # una plantilla no es un pago
    assert not plan["ticket_id"]
    assert [p["id"] for p in w.listar_plantillas()] == [plan["id"]]

    oct1 = w.instanciar_plantilla(plan["id"], "2026-10")
    oct2 = w.instanciar_plantilla(plan["id"], "2026-10")
    nov = w.instanciar_plantilla(plan["id"], "2026-11")
    assert oct2["id"] == oct1["id"] and oct2.get("ya_existia")
    assert nov["id"] != oct1["id"]
    assert oct1["estado"] == "borrador" and oct1["plantilla_id"] == plan["id"]
    assert oct1["concepto"] == "Guías Interrapidísimo"


def test_una_plantilla_no_se_manda_a_aprobacion(mods):
    # Aprobar la plantilla giraría un pago que nadie pidió, todos los meses.
    _cc, w, t, m, _ = mods
    plan = w.crear_solicitud(_pago(t, m, es_plantilla=True, frecuencia="mensual"))
    with pytest.raises(ValueError, match="plantilla"):
        w.enviar_a_aprobacion(plan["id"])


def test_plantillas_se_filtran_e_instancian_por_origen(mods):
    # El cron de la quincena no sabe a quién se le paga: eso vive en las
    # plantillas, que un humano creó una vez. Agregar a alguien no es un
    # cambio de código.
    _cc, w, t, m, _ = mods
    quincena = w.crear_solicitud(_pago(t, m, es_plantilla=True, frecuencia="quincenal",
                                       origen_sistema="nomina", concepto="Servicios — Persona A"))
    otra = w.crear_solicitud(_pago(t, m, es_plantilla=True, frecuencia="mensual",
                                   origen_sistema="contador", concepto="Honorarios"))
    assert [p["id"] for p in w.listar_plantillas("nomina")] == [quincena["id"]]
    assert [p["id"] for p in w.listar_plantillas("contador")] == [otra["id"]]
    assert len(w.listar_plantillas()) == 2

    creados = w.instanciar_plantillas_de("nomina", "2026-10-Q1")
    assert len(creados) == 1
    assert creados[0]["estado"] == "borrador"
    assert creados[0]["plantilla_id"] == quincena["id"]
    # Volver a correr el cron no duplica la quincena
    assert w.instanciar_plantillas_de("nomina", "2026-10-Q1")[0]["id"] == creados[0]["id"]


def test_la_categoria_nomina_advierte_que_no_hay_contrato_laboral(mods):
    # McKenna no tiene trabajadores formales: lo que se paga cada quincena es
    # prestación de servicios. 5105 afirmaría una relación laboral que no existe.
    _cc, w, _t, _m, _ = mods
    ayuda = w.CATEGORIAS["nomina"]["ayuda"].lower()
    assert "no tiene trabajadores formales" in ayuda
    assert "prestación de servicios" in ayuda
    assert w.CATEGORIAS["prestacion_servicios"]["cuenta_debito"] == "5135"
    assert w.CATEGORIAS["prestacion_servicios"]["concepto_retencion"] == "servicios"


# ─── Pactado «libre de retención» ───────────────────────────────────────────
#
# A un prestador de servicios se le dice «te pago 1.100.000 libres de
# retención»: ese valor es lo que RECIBE, no la base gravable. Tomarlo como
# base le giraba 1.056.000 y el reclamo llegaba después.

def test_valor_libre_de_retencion_gira_exactamente_lo_pactado(mods):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_100_000, "concepto": "Quincena",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-10",
        "valor_es_neto": True,
    })
    assert prev["girado"] == 1_100_000          # lo pactado, exacto
    assert prev["retencion"] > 0                 # se retiene igual: es obligatorio
    assert prev["monto"] == round(1_100_000 + prev["retencion"], 2)
    assert prev["cuadra"] is True
    assert prev["valor_es_neto"] is True


def test_sin_la_bandera_el_valor_sigue_siendo_el_total_facturado(mods):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_100_000, "concepto": "Factura",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-10",
    })
    assert prev["monto"] == 1_100_000
    assert prev["girado"] == round(1_100_000 - prev["retencion"], 2)


# ─── El ciclo del giro: aprobar no es girar ─────────────────────────────────

def test_el_ciclo_del_giro_cierra_con_comprobante(mods):
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    w.aprobar(s["id"], espejar=False)

    # Montar en el banco solo tiene sentido después de aprobar.
    montada = w.montar_en_banco(s["id"], referencia="TRX-9001")
    assert montada["estado"] == "en_banco"
    assert montada["montado_ref"] == "TRX-9001"

    # Sin comprobante el ciclo NO cierra: es lo que después nadie concilia.
    with pytest.raises(ValueError):
        w.confirmar_pago(s["id"])

    pagada = w.confirmar_pago(s["id"], comprobante=(b"%PDF-1.4 comprobante", "banco.pdf"))
    assert pagada["estado"] == "pagada"
    assert pagada["comprobante_archivo"]


def test_no_se_monta_en_el_banco_lo_que_no_esta_aprobado(mods):
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    with pytest.raises(ValueError):
        w.montar_en_banco(s["id"])


# ─── Dos personas, dos pasos ────────────────────────────────────────────────
#
# Los dos tokens de la Sucursal son dos pares de ojos. Si la misma persona
# aprueba, prepara y confirma, el control es decorativo.

def test_prepara_el_pago_quien_lo_aprobo(mods):
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    w.aprobar(s["id"], aprobada_por=11, espejar=False)
    with pytest.raises(ValueError, match="le toca a esa persona"):
        w.montar_en_banco(s["id"], por=22)
    assert w.montar_en_banco(s["id"], por=11)["estado"] == "en_banco"


def test_el_segundo_visto_bueno_lo_da_el_otro(mods):
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    w.aprobar(s["id"], aprobada_por=11, espejar=False)
    w.montar_en_banco(s["id"], por=11)
    with pytest.raises(ValueError, match="la otra persona"):
        w.confirmar_pago(s["id"], por=11, comprobante=(b"x", "captura.png"))
    cerrada = w.confirmar_pago(s["id"], por=22, comprobante=(b"x", "captura.png"))
    assert cerrada["estado"] == "pagada"
    assert cerrada["pagado_por"] == 22
    assert cerrada["firmas"]["aprobada_por"] is not None


# ─── Quién retiene y qué otros impuestos lleva ──────────────────────────────

def _servicio(t, m, **extra):
    return {"categoria": "servicios", "monto": 1_250_000, "concepto": "Quincena",
            "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-16", **extra}


def test_ica_se_le_descuenta_al_beneficiario_y_va_a_2368(mods):
    _cc, w, t, m, _ = mods
    p = w.previsualizar(_servicio(t, m, retencion_modo="beneficiario", ica_por_mil=9.66))
    assert p["retencion_ica"] == 12_075.0
    assert p["girado"] == round(1_250_000 - p["retencion"] - 12_075, 2)
    assert any(l["cuenta_codigo"] == "2368" for l in p["lineas"])
    assert p["cuadra"]


def test_libre_de_retencion_gross_up_incluye_el_ica(mods):
    _cc, w, t, m, _ = mods
    p = w.previsualizar(_servicio(t, m, retencion_modo="mckenna", ica_por_mil=9.66))
    assert p["girado"] == 1_250_000        # recibe lo pactado, completo
    assert p["retencion"] > 0 and p["retencion_ica"] > 0
    assert p["monto"] == round(1_250_000 + p["retencion"] + p["retencion_ica"], 2)
    assert p["cuadra"]


def test_gmf_lo_paga_mckenna_no_el_beneficiario(mods):
    _cc, w, t, m, _ = mods
    p = w.previsualizar(_servicio(t, m, retencion_modo="ninguna", gmf=True))
    assert p["retencion"] == 0
    assert p["girado"] == 1_250_000                      # el 4x1000 no se le descuenta
    assert p["gmf"] == 5_000.0                           # 0,4% de lo que sale
    banco = [l for l in p["lineas"] if l["cuenta_codigo"] == "1110"][0]
    assert banco["credito"] == 1_255_000.0               # del banco sale el pago + el gravamen
    assert p["cuadra"]


def test_el_asiento_aprobado_conserva_ica_y_gmf(mods):
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_servicio(t, m, retencion_modo="beneficiario", ica_por_mil=9.66, gmf=True))
    assert s["retencion_ica"] == 12_075.0 and s["gmf"] > 0
    aprobada = w.aprobar(s["id"], espejar=False)
    assert aprobada["movimiento_id"]
    import app.services.contabilidad_core as cc
    mov = cc.obtener_movimiento(aprobada["movimiento_id"])
    codigos = {l["cuenta_codigo"] for l in mov["lineas"]}
    assert {"2365", "2368", "530595"} <= codigos


def test_aprobar_dos_veces_no_crea_otro_asiento(mods):
    """Una solicitud se contabiliza una sola vez, esté en el estado que esté.

    El estado no bastaba como guarda: una ya girada («pagada») pasaba de largo y
    un segundo clic habría duplicado el gasto y la retención.
    """
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    primera = w.aprobar(s["id"], espejar=False)
    w.montar_en_banco(s["id"], por=11)
    w.confirmar_pago(s["id"], por=22, comprobante=(b"x", "captura.png"))

    repetida = w.aprobar(s["id"], espejar=False)
    assert repetida.get("ya_aprobada") is True
    assert repetida["movimiento_id"] == primera["movimiento_id"]

    import app.services.contabilidad_core as cc
    iguales = [mv for mv in cc.listar_movimientos(limit=100) if mv["referencia"] == f"pago:{s['id']}"]
    assert len(iguales) == 1
