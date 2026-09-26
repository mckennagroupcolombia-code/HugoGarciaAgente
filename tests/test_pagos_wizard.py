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
    # El catálogo de Alegra de mentira: toda referencia existe como producto
    # activo salvo las que el test usa a propósito para lo contrario. La copia
    # local real cambia todos los días y no es asunto de esta suite.
    from app.services import pagos_proveedor

    _falsos = {"NOEXISTE": None,
               "KITVENTA": {"type": "kit", "status": "active"},
               "VIEJOg": {"type": "product", "status": "inactive"}}
    monkeypatch.setattr(
        pagos_proveedor, "_item_catalogo",
        lambda sku: _falsos[sku] if sku in _falsos else {"type": "product", "status": "active"},
    )
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
    # El valor del comentario es lo que se GIRA ($850.000 menos el 1% de
    # transporte), que es el que quien monta la transferencia va a teclear y el
    # que después aparece en el extracto — no el bruto causado.
    assert any("aprobado" in x and "$841.500" in x for x in textos)


def test_aprobar_crea_el_asiento_y_cuadra(mods):
    cc, w, t, m, _ = mods
    s = w.crear_solicitud(_pago(t, m))
    r = w.aprobar(s["id"], espejar=False)
    assert r["estado"] == "aprobada"
    assert r["movimiento"]["id"]
    por_cuenta = {l["cuenta_codigo"]: l for l in r["movimiento"]["lineas"]}
    assert por_cuenta["513550"]["debito"] == pytest.approx(850_000, abs=1)
    # Desde sep-2026 el transporte de carga lleva el 1% (Art. 392 E.T.), así que
    # lo que sale del banco es el neto. La tarifa no es una lectura nuestra de
    # la norma: es la que el contador de McKenna certificó en 2024.
    assert por_cuenta["236525"]["credito"] == pytest.approx(8_500, abs=1)
    assert por_cuenta["1110"]["credito"] == pytest.approx(841_500, abs=1)
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
        # También la retención: un monto de $1 con la retención del original
        # sería una solicitud incoherente (giraría negativo), y lo que se está
        # probando es de dónde saca los datos, no que tolere basura.
        con.execute("UPDATE cc_solicitudes_pago SET monto=1, retencion=0 WHERE id=?", (s["id"],))
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
    # A su subcuenta por concepto (honorarios → 236515): es como el contador
    # arma el 350. Con todo en «2365» plana tiene que desglosarlo a mano.
    assert any(l["cuenta_codigo"] == "236515" for l in r["movimiento"]["lineas"])


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
    cc, w, t, m, _ = mods
    # Desde sep-2026 el gross-up hay que PACTARLO en la ficha del tercero; ya no
    # se activa desde el pago.
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET retencion_asume_mckenna=1 WHERE id=?", (t["id"],))
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
    cc, w, t, m, _ = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET retencion_asume_mckenna=1 WHERE id=?", (t["id"],))
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
    assert {"236525", "2368", "530595"} <= codigos


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


# ─── La cuenta del PUC decide los impuestos (sep-2026) ──────────────────────
#
# Antes había un botón por concepto (Productos, Servicios, Transporte,
# Servicios públicos) Y un selector de cuenta PUC: la misma pregunta hecha dos
# veces, y podían contradecirse. El botón fijaba el impuesto y la cuenta fijaba
# el balance. Ahora manda la cuenta, que es el dato que el contador mira.

@pytest.mark.parametrize(
    "cuenta, concepto, tarifa",
    [
        ("513550", "transporte_carga", 1.0),    # transporte de carga
        ("5135",   "servicios", 4.0),           # servicios generales
        ("511095", "servicios", 4.0),           # prestación de servicios, NO honorarios
        ("5110",   "honorarios", 10.0),
        ("1435",   "compras", 2.5),
        ("529505", "comisiones", 10.0),
    ],
)
def test_la_cuenta_elegida_manda_sobre_el_impuesto(mods, cuenta, concepto, tarifa):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 10_000_000, "concepto": "prueba",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-16",
        "cuenta_debito": cuenta, "retencion_modo": "beneficiario",
    })
    assert prev["lineas"][0]["cuenta_codigo"] == cuenta
    assert prev["concepto_retencion"] == concepto
    assert prev["retencion"] == pytest.approx(10_000_000 * tarifa / 100, abs=1)


def test_un_servicio_publico_no_lleva_retencion(mods):
    # Las ESP son autorretenedoras. Antes esto dependía de oprimir el botón
    # «Servicios públicos»; ahora es una consecuencia de la cuenta, que es donde
    # de verdad estaba escrito.
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 900_000, "concepto": "Enel agosto",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-16",
        "cuenta_debito": "513530", "retencion_modo": "beneficiario",
    })
    assert prev["retencion"] == 0
    assert prev["lineas"][0]["cuenta_codigo"] == "513530"


def test_regimen_simple_no_lleva_ni_renta_ni_ica(mods):
    """Art. 911 E.T. — y el ICA va consolidado dentro del SIMPLE (Art. 907).

    La exención del SIMPLE es por QUIÉN recibe, no por el concepto: da igual si
    el pago es de honorarios, de servicios o de transporte. Hasta sep-2026
    `regimen_simple` apagaba solo la renta y el ICA se seguía calculando, así
    que a un tercero del SIMPLE con tarifa de ICA en su ficha se le retenía un
    impuesto que ya está pagando dentro del SIMPLE.
    """
    cc, w, _t, m, _ = mods
    fidel = cc.crear_tercero({
        "nombre": "FIDEL ROCHA MORON", "tipo": "proveedor",
        "tipo_persona": "natural", "identificacion": "9385573",
    })
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET regimen_simple=1, ica_por_mil=9.66 WHERE id=?", (fidel["id"],))
    for cuenta in ("513550", "5110", "5135"):
        prev = w.previsualizar({
            "categoria": "servicios", "monto": 1_998_000, "concepto": "Mensajería quincena",
            "tercero_id": fidel["id"], "medio_pago_id": m["id"], "fecha": "2026-09-16",
            "cuenta_debito": cuenta, "retencion_modo": "beneficiario", "ica_por_mil": 9.66,
        })
        assert prev["retencion"] == 0, cuenta
        assert prev["retencion_ica"] == 0, cuenta
        assert prev["girado"] == pytest.approx(1_998_000, abs=1), cuenta
        assert "SIMPLE" in prev["retencion_motivo"]


def test_exento_de_renta_sigue_sujeto_a_ica(mods):
    """La excepción del SIMPLE no se contagia al resto.

    A Víctor, Stella y Jenniffer el contador pidió no practicarles renta pero SÍ
    ICA: son sujetos de ICA, solo que exentos de retefuente. Apagar los dos
    juntos es lo que hacía que justo a quienes había que practicárselo no se les
    practicara nunca.
    """
    cc, w, _t, m, _ = mods
    p = cc.crear_tercero({"nombre": "Victor Hugo Garcia", "tipo": "otro",
                          "tipo_persona": "natural", "identificacion": "79000001"})
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET retefuente_exento=1, ica_por_mil=9.66 WHERE id=?", (p["id"],))
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_000_000, "concepto": "Quincena",
        "tercero_id": p["id"], "medio_pago_id": m["id"], "fecha": "2026-09-16",
        "cuenta_debito": "511095", "retencion_modo": "beneficiario",
    })
    assert prev["retencion"] == 0
    assert prev["retencion_ica"] == pytest.approx(9_660, abs=1)


def test_se_recuerda_de_que_cuenta_se_le_paga_a_cada_tercero(mods):
    # Volver a elegir lo mismo cada mes es donde se equivoca uno.
    cc, w, t, m, _ = mods
    w.crear_solicitud({
        "categoria": "servicios", "monto": 500_000, "concepto": "Guías",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-16",
        "cuenta_debito": "513550",
    })
    ficha = cc.obtener_tercero(t["id"])
    assert ficha["cuenta_gasto_default"] == "513550"
    assert int(ficha["medio_pago_default"]) == m["id"]


def test_la_mensajeria_sale_completa_con_solo_escribir_el_valor(mods):
    """El caso de Fidel Rocha tal como lo pidió el contador (18-sep-2026): gasto
    523550 transporte de ventas, retefuente 1% y ReteICA 4,14 por mil.

    Lo que se prueba es que el operador **no tiene que elegir nada más**: la
    cuenta y el ICA vienen de la ficha del tercero y la retención de la cuenta.
    Lo que hay que recordar cada quincena es lo que se olvida una quincena.
    """
    cc, w, _t, m, _ = mods
    fidel = cc.crear_tercero({"nombre": "FIDEL ROCHA MORON", "tipo": "proveedor",
                              "tipo_persona": "natural", "identificacion": "9385573"})
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET ica_por_mil=4.14, cuenta_gasto_default='523550'"
                    " WHERE id=?", (fidel["id"],))
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_998_000, "concepto": "Mensajería quincena",
        "tercero_id": fidel["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "retencion_modo": "beneficiario",
    })
    por_cuenta = {l["cuenta_codigo"]: l for l in prev["lineas"]}
    assert por_cuenta["523550"]["debito"] == pytest.approx(1_998_000, abs=1)
    assert por_cuenta["236525"]["credito"] == pytest.approx(19_980, abs=1)   # 1%
    assert por_cuenta["2368"]["credito"] == pytest.approx(8_271.72, abs=1)   # 4,14 x mil
    assert por_cuenta["1110"]["credito"] == pytest.approx(1_969_748.28, abs=1)
    assert prev["concepto_retencion"] == "transporte_carga"
    assert prev["cuadra"] is True


# ─── Los impuestos se informan, no se preguntan (18-sep-2026) ───────────────

def test_sin_contestar_nada_los_impuestos_ya_salen(mods):
    """El wizard no pregunta «¿lleva retención?»: la cuenta del PUC y la ficha
    del tercero ya lo dicen. Contestar bien doce veces al año y olvidarlo una es
    lo que produjo los $164.542 retenidos de más en septiembre."""
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 5_000_000, "concepto": "Servicio",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "5135",
        # sin retencion_modo, sin ica_por_mil, sin gmf
    })
    assert prev["retencion"] == pytest.approx(200_000, abs=1)     # servicios 4%
    assert prev["concepto_retencion"] == "servicios"
    assert prev["retencion_modo"] == "beneficiario"


def test_la_previsualizacion_explica_la_cuenta_elegida(mods):
    """Lo que el panel muestra en vez de las preguntas."""
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_000_000, "concepto": "x",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "523550",
    })
    perfil = prev["perfil_cuenta"]
    assert perfil["conocida"] is True
    assert "1%" in perfil["nota"] and "4,14" in perfil["nota"]
    assert "autorretenedora" in perfil["advertencia"]
    assert prev["perfil_cuenta"]["cuenta_nombre"].startswith("Transporte")


def test_el_gross_up_sigue_siendo_posible_porque_el_puc_no_lo_sabe(mods):
    """«Te pago libre de retención» es un acuerdo comercial: ninguna cuenta del
    PUC puede deducirlo. Por eso sigue existiendo — pero pactado en la ficha."""
    cc, w, t, m, _ = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET retencion_asume_mckenna=1 WHERE id=?", (t["id"],))
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_000_000, "concepto": "Quincena",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "511095", "retencion_modo": "mckenna",
    })
    assert prev["girado"] == pytest.approx(1_000_000, abs=1)   # recibe lo pactado
    assert prev["monto"] > 1_000_000                            # la base sube
    assert prev["valor_es_neto"] is True


# ─── El gross-up se pacta, no se elige (18-sep-2026) ───────────────────────

def test_no_se_puede_hacer_que_mckenna_asuma_la_retencion_desde_el_pago(mods):
    """Mientras fue un radio del wizard, cualquiera podía hacer que McKenna
    pagara los impuestos de un tercero con un clic: sobre la quincena de
    mensajería son $28.657 que salen del banco de más, cada quincena, sin que
    nadie lo pactara. Se valida en el backend porque esconder un radio no es un
    control, es una sugerencia."""
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_998_000, "concepto": "Mensajería",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "523550", "retencion_modo": "mckenna",
    })
    assert prev["retencion_modo"] == "beneficiario"
    # 1.998.000 menos el 1% de transporte: sale el neto, no el bruto.
    assert prev["girado"] == pytest.approx(1_978_020, abs=1)
    assert "no está pactado" in prev["aviso_gross_up"]


def test_el_otro_camino_al_gross_up_tambien_queda_cerrado(mods):
    """`valor_es_neto` llegaba a lo mismo por la puerta de atrás."""
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_998_000, "concepto": "Mensajería",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "523550", "valor_es_neto": True,
    })
    assert prev["retencion_modo"] == "beneficiario"
    assert prev["valor_es_neto"] is False


def test_con_quien_si_se_pacto_el_gross_up_sigue_funcionando(mods):
    cc, w, t, m, _ = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET retencion_asume_mckenna=1 WHERE id=?", (t["id"],))
    prev = w.previsualizar({
        "categoria": "servicios", "monto": 1_000_000, "concepto": "Quincena pactada neta",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "511095", "retencion_modo": "mckenna",
    })
    assert prev["valor_es_neto"] is True
    assert prev["girado"] == pytest.approx(1_000_000, abs=1)
    assert not prev["aviso_gross_up"]


def test_pagar_un_servicio_publico_no_marca_exento_al_tercero(mods):
    """Al dejar de preguntar, `retencion_modo` pasó a ser consecuencia de la
    cuenta: 513530 manda «ninguna» porque la energía no lleva retención.
    Aprender de ahí marcaba exento a cualquiera al que se le pagara un recibo."""
    cc, w, t, m, _ = mods
    w.crear_solicitud({
        "categoria": "servicios", "monto": 300_000, "concepto": "Energía",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "513530", "retencion_modo": "ninguna",
    })
    assert int(cc.obtener_tercero(t["id"])["retefuente_exento"]) == 0


def test_pagarle_a_un_autorretenedor_no_le_quita_la_exencion(mods):
    """El daño inverso y peor: Interrapidísimo manda «beneficiario» porque
    513550 sí retiene, y eso desmarcaba su exención — al siguiente pago se le
    habría retenido indebidamente."""
    cc, w, t, m, _ = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET retefuente_exento=1 WHERE id=?", (t["id"],))
    w.crear_solicitud({
        "categoria": "servicios", "monto": 850_000, "concepto": "Guías",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "cuenta_debito": "513550", "retencion_modo": "beneficiario",
    })
    assert int(cc.obtener_tercero(t["id"])["retefuente_exento"]) == 1


# ─── La compra se contabiliza con la cotización (18-sep-2026) ───────────────
#
# El objetivo: que al solicitar el pago la compra quede contabilizada renglón
# por renglón, para no tener que volver a registrarla cuando llegue la factura.

def _items():
    # Dos materias primas: una EXCLUIDA de IVA (Art. 424) y otra gravada. El
    # catálogo de McKenna tiene 254 excluidas de 316, así que suponer 19% a
    # todo inventa un IVA descontable que no existe.
    return [
        {"sku": "CITCALg", "nombre": "CITRATO DE CALCIO", "cantidad": 50_000,
         "precio": 9, "unidad": "g", "iva_pct": 0},
        {"sku": "GLIVEGg", "nombre": "GLICERINA VEGETAL G", "cantidad": 20_000,
         "precio": 11, "unidad": "g", "iva_pct": 19},
    ]


def test_cada_producto_de_la_cotizacion_es_una_linea_del_asiento(mods):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "productos", "concepto": "Cotización 4471", "fecha": "2026-09-18",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "items": _items(), "monto": 0,
    })
    inventario = [l for l in prev["lineas"] if l["cuenta_codigo"] == "1435"]
    assert len(inventario) == 2
    assert inventario[0]["debito"] == pytest.approx(450_000, abs=1)
    assert "CITCALg" in inventario[0]["descripcion"]
    assert "50000 g" in inventario[0]["descripcion"]
    assert prev["cuadra"] is True


def test_el_iva_no_se_carga_a_inventario(mods):
    """Antes el asiento debitaba a 1435 el total CON IVA: inflaba el inventario
    con un impuesto que no es costo de la mercancía —es un crédito contra la
    DIAN— y dejaba el formulario 300 imposible de armar leyendo el libro."""
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "productos", "concepto": "Compra", "fecha": "2026-09-18",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "items": _items(), "monto": 0,
    })
    iva = [l for l in prev["lineas"] if l["cuenta_codigo"] == "240810"]
    assert len(iva) == 1
    assert iva[0]["debito"] == pytest.approx(41_800, abs=1)      # solo la gravada
    assert sum(l["debito"] for l in prev["lineas"] if l["cuenta_codigo"] == "1435") \
        == pytest.approx(670_000, abs=1)                          # base, sin IVA


def test_una_materia_prima_excluida_no_genera_iva_descontable(mods):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "productos", "concepto": "Compra", "fecha": "2026-09-18",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
        "items": [{"sku": "CITCALg", "nombre": "CITRATO DE CALCIO", "cantidad": 50_000,
                   "precio": 9, "iva_pct": 0}],
    })
    assert all(l["cuenta_codigo"] != "240810" for l in prev["lineas"])
    assert prev["monto"] == pytest.approx(450_000, abs=1)


def test_al_aprobar_no_se_pierde_ningun_producto(mods):
    """La reconstrucción del asiento tomaba `lineas[0]`: con cinco productos
    habría contabilizado uno y descuadrado el asiento."""
    cc, w, t, m, _ = mods
    s = w.crear_solicitud({
        "categoria": "productos", "concepto": "Cotización 4471", "fecha": "2026-09-18",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "items": _items(), "monto": 0,
        "total_documento": 711_800,
    })
    r = w.aprobar(s["id"], espejar=False)
    mov = cc.obtener_movimiento(r["movimiento_id"])
    inventario = [l for l in mov["lineas"] if l["cuenta_codigo"] == "1435"]
    assert len(inventario) == 2
    assert sum(l["debito"] for l in inventario) == pytest.approx(670_000, abs=1)
    assert cc.balance_comprobacion()["cuadra"]


# ─── La solicitud es copia fiel de la cotización (24-sep-2026) ──────────────
#
# Reemplaza la regla del 18-sep («Productos» sin lista obligatoria y renglones
# sin referencia): la solicitud de pago ES el registro de la compra, así que no
# se pide pagar nada que no esté como producto en Alegra, y la lista tiene que
# ser la del documento, completa y cuadrada al peso. La #47 (bolsas ziploc de
# COMERCIALIZADORA INTERNACIONAL) pasó con las reglas viejas y hubo que
# descontabilizarla.

def _compra(t, m, items, **extra):
    return {"categoria": "productos", "concepto": "Cotización", "fecha": "2026-09-24",
            "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
            "items": items, **extra}


def test_productos_sin_lista_no_se_solicitan(mods):
    _cc, w, t, m, _ = mods
    with pytest.raises(ValueError, match="Agrega los productos"):
        w.crear_solicitud({
            "categoria": "productos", "monto": 300_000, "concepto": "Insumo suelto",
            "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        })


def test_un_borrador_sin_lista_se_guarda_pero_no_se_envia(mods):
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud({
        "categoria": "productos", "monto": 300_000, "concepto": "Insumo suelto",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "estado": "borrador",
    })
    with pytest.raises(ValueError, match="Agrega los productos"):
        w.enviar_a_aprobacion(s["id"])
    assert w.obtener(s["id"])["estado"] == "borrador"


@pytest.mark.parametrize("sku,motivo", [
    ("", "no tiene SKU"),
    ("NOEXISTE", "no existe en el catálogo"),
    ("KITVENTA", "combo de venta"),
    ("C-BOLSA500g", "combo de venta"),
    ("VIEJOg", "inactivo"),
])
def test_solo_productos_registrados_en_alegra(mods, sku, motivo):
    _cc, w, t, m, _ = mods
    items = [{"sku": sku, "nombre": "BOLSA 15 X 21", "cantidad": 10, "precio": 100, "iva_pct": 19}]
    with pytest.raises(ValueError, match=motivo):
        w.crear_solicitud(_compra(t, m, items, total_documento=1_190))


def test_un_renglon_malo_frena_toda_la_compra(mods):
    _cc, w, t, m, _ = mods
    items = _items() + [{"sku": "NOEXISTE", "nombre": "X", "cantidad": 1, "precio": 1, "iva_pct": 0}]
    with pytest.raises(ValueError, match="Renglón 3"):
        w.crear_solicitud(_compra(t, m, items, total_documento=711_801))


def test_sin_total_del_documento_no_se_solicita(mods):
    _cc, w, t, m, _ = mods
    with pytest.raises(ValueError, match="total con IVA"):
        w.crear_solicitud(_compra(t, m, _items()))


def test_si_falta_un_renglon_no_cuadra(mods):
    """La cotización trae dos productos y se capturó uno: el total lo delata."""
    _cc, w, t, m, _ = mods
    with pytest.raises(ValueError, match="faltan"):
        w.crear_solicitud(_compra(t, m, _items()[:1], total_documento=711_800))


def test_un_solo_producto_es_un_solo_renglon(mods):
    _cc, w, t, m, _ = mods
    items = [{"sku": "BOLTRA15X21ZIP", "nombre": "BOLSA", "cantidad": 2900, "precio": 254, "iva_pct": 19}]
    s = w.crear_solicitud(_compra(t, m, items, total_documento=876_554))
    assert s["estado"] == "pendiente" and len(s["items"]) == 1


def test_aprobar_frena_una_compra_vieja_sin_lista(mods):
    """Una solicitud que quedó pendiente con las reglas anteriores no se
    contabiliza: se rechaza y se vuelve a montar."""
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud({
        "categoria": "productos", "monto": 300_000, "concepto": "Vieja",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-09-18",
        "estado": "borrador",
    })
    with w._conn() as con:
        con.execute("UPDATE cc_solicitudes_pago SET estado='pendiente' WHERE id=?", (s["id"],))
    with pytest.raises(ValueError, match="Agrega los productos"):
        w.aprobar(s["id"], espejar=False)
    assert not w.obtener(s["id"])["movimiento_id"]


def test_pactado_libre_se_respeta_aunque_el_pago_diga_ninguna(mods):
    """Exento de renta + ICA pactado libre: el ICA lo asume McKenna, no él.

    El panel manda `retencion_modo="ninguna"` cuando el tercero está marcado
    exento de RENTA. Pero el ICA es otro impuesto y sigue corriendo: si la ficha
    dice que se pactó pagar libre, el gross-up tiene que hacerse igual. Antes la
    ficha solo servía de veto (impedía el gross-up sin acuerdo) y no de mandato,
    así que a William Novoa —exento por el Art. 383, con ICA 8,66 pactado
    libre— se le terminaba descontando el ICA en cada pago.
    """
    cc, w, t, m, _ = mods
    with cc._conn() as con:
        con.execute(
            "UPDATE cc_terceros SET retencion_asume_mckenna=1, retefuente_exento=1, ica_por_mil=8.66 WHERE id=?",
            (t["id"],),
        )
    prev = w.previsualizar({
        "categoria": "honorarios", "monto": 1_200_000, "concepto": "Honorarios contables",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "fecha": "2026-10-05",
        "retencion_modo": "ninguna",
    })
    assert prev["girado"] == 1_200_000            # recibe lo pactado, exacto
    assert prev["retencion"] == 0                 # exento de renta: Art. 383 E.T.
    assert prev["retencion_ica"] > 0              # pero el ICA sí se practica
    assert prev["monto"] == round(1_200_000 + prev["retencion_ica"], 2)
    assert prev["valor_es_neto"] is True
    assert prev["cuadra"] is True


def test_los_honorarios_profesionales_llevan_ica_de_consultoria(mods):
    """8,66 por mil, no 9,66: la contabilidad es consultoría profesional.

    Verificado contra los documentos del contador — su cuenta de cobro liquida
    $5.659 sobre $653.470 y su certificado anual $50.310 sobre $5.809.492.
    El 9,66 es el de «las demás actividades de servicios» y debe quedarse en
    5135, donde entra la prestación de servicios.
    """
    from app.services.impuestos_por_cuenta import perfil

    for cuenta in ("5110", "511025", "511030", "511035"):
        assert perfil(cuenta)["ica_por_mil"] == 8.66, cuenta
    for cuenta in ("5135", "511095"):
        assert perfil(cuenta)["ica_por_mil"] == 9.66, cuenta


# ─── La réplica tiene que cuadrar con el documento (18-sep-2026) ────────────
#
# Prueba real: cotización PRE0031580 de FACTORES Y MERCADEO, 14 materias primas,
# $4.531.500 de mercancía + $619.115 de IVA − $113.287,50 de retención =
# $5.037.327,50 girados. El IVA que trae el catálogo de Alegra para los insumos
# **no es confiable**: la misma sustancia está marcada 19% como combo (lo que
# McKenna vende) y 0% como `product` (la materia prima) —alulosa, gelatina e
# inulina—, y el reparto 80/20 es un espejo entre los dos tipos: nunca se curó.
# Con él, esa cotización daba $0 de IVA en vez de $619.115.

COTIZACION = [
    ("CLOMAGHEXg", 5800, 25, 19), ("ALAg", 38000, 2, 19), ("PROB80g", 42000, 20, 19),
    ("VITETOC99Pg", 192000, 2, 0), ("VITCACIASCg", 14500, 25, 0),
    ("GELSINSABg", 25000, 25, 19), ("ALUALLg", 16000, 25, 19), ("GOMXANg", 14600, 25, 19),
    ("INU90Pg", 20000, 20, 19), ("DEXMONg", 4800, 25, 19), ("AMILARGBASg", 75000, 2, 19),
    ("DPANg", 82000, 2, 0), ("UREAUSPg", 14500, 25, 0), ("MALM15MALg", 5500, 25, 19),
]
TOTAL_DOCUMENTO = 5_150_615


def _cotizacion(iva_del_catalogo=False):
    return [{"sku": s, "nombre": s, "cantidad": c, "precio": p, "unidad": "KG",
             "iva_pct": 0 if iva_del_catalogo else i} for s, p, c, i in COTIZACION]


def test_la_cotizacion_real_reproduce_el_documento_al_centavo(mods):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "productos", "concepto": "PRE0031580", "fecha": "2026-09-10",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
        "items": _cotizacion(), "total_documento": TOTAL_DOCUMENTO,
    })
    assert prev["base_sin_iva"] == pytest.approx(4_531_500, abs=1)
    assert prev["iva_items"] == pytest.approx(619_115, abs=1)
    assert prev["monto"] == pytest.approx(5_150_615, abs=1)
    assert prev["retencion"] == pytest.approx(113_287.50, abs=1)
    # El «Total General» del documento: lo que de verdad sale del banco.
    assert prev["girado"] == pytest.approx(5_037_327.50, abs=1)
    assert prev["aviso_documento"] == ""
    assert prev["cuadra"] is True
    assert len([l for l in prev["lineas"] if l["cuenta_codigo"] == "1435"]) == 14


def test_el_iva_del_catalogo_no_cuadra_y_se_avisa(mods):
    _cc, w, t, m, _ = mods
    prev = w.previsualizar({
        "categoria": "productos", "concepto": "PRE0031580", "fecha": "2026-09-10",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
        "items": _cotizacion(iva_del_catalogo=True), "total_documento": TOTAL_DOCUMENTO,
    })
    assert prev["iva_items"] == 0
    assert prev["diferencia_documento"] == pytest.approx(-619_115, abs=1)
    assert "faltan" in prev["aviso_documento"]
    assert "IVA" in prev["aviso_documento"]


def test_un_descuadre_no_llega_a_aprobacion(mods):
    """Se puede guardar el borrador a medias, pero no se aprueba un asiento que
    dice algo distinto de la factura que lo sustenta."""
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud({
        "categoria": "productos", "concepto": "PRE0031580", "fecha": "2026-09-10",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0, "estado": "borrador",
        "items": _cotizacion(iva_del_catalogo=True), "total_documento": TOTAL_DOCUMENTO,
    })
    assert w.obtener(s["id"])["estado"] == "borrador"       # guardar sí
    with pytest.raises(ValueError, match="documento dice"):
        w.enviar_a_aprobacion(s["id"])


# ─── Buscar el insumo como lo nombra el proveedor (18-sep-2026) ─────────────
#
# Probando la cotización PRE0031580, tres de catorce insumos parecían «no estar
# en el catálogo» y los tres estaban. Creer que falta un producto que sí existe
# es peor que un par de resultados de sobra: lleva a crearlo duplicado.

def test_las_preposiciones_no_estorban():
    """«CLORURO DE MAGNESIO» debe encontrar «CLORURO MAGNESIO HEXAHIDRATADO»:
    el proveedor y el catálogo nunca escriben igual."""
    from app.services.pagos_proveedor import productos

    assert any(p["sku"] == "CLOMAGHEXg" for p in productos("cloruro de magnesio"))


def test_encuentra_la_misma_sustancia_con_otra_grafia():
    """El proveedor escribe «GOMA XANTHAN» y el catálogo «GOMA XANTANA»."""
    from app.services.pagos_proveedor import productos

    assert any(p["sku"] == "GOMXANg" for p in productos("goma xanthan"))


def test_ningun_combo_se_cuela_en_una_compra():
    """El prefijo `C-` manda sobre el campo `type`: los 231 `kit` lo llevan, pero
    además hay 14 combos guardados como `product` —`C-VITCACIASC100g`,
    `C-ARCVRT250g`, `C-KITACIHIA30mL`…— que solo la referencia delata. Comprar
    contra uno asienta como materia prima algo que McKenna arma y vende: el
    inventario queda a precio de venta y el IVA sale del combo, no de la
    factura."""
    from app.services.pagos_proveedor import productos

    for q in ("vitamina c", "arcilla", "triptofano", "citrato", "aceite esencial", "gelatina"):
        assert not [p for p in productos(q, limit=8) if p["sku"].upper().startswith("C-")], q
    assert productos("vitamina c acido")[0]["sku"] == "VITCACIASCg"


def test_una_ficha_incompleta_no_le_gana_a_la_buena():
    """`UREA250` («Urea cosmética») no tiene unidad ni precio y le ganaba a
    `UREg`, que es la urea por gramo."""
    from app.services.pagos_proveedor import productos

    r = productos("urea")
    assert r and r[0]["sku"] == "UREg"


# ─── 21-sep-2026: con documento soporte, el asiento no se espeja a Alegra ────

def _aprobar_con(mods, monkeypatch, estado_doc):
    import app.services.alegra_espejo as esp
    from app.services import doc_soporte_pagos as ds

    _cc, w, t, m, _ = mods
    espejados = []
    monkeypatch.setattr(esp, "espejar_movimiento",
                        lambda mid, **kw: espejados.append(mid) or {"status": "success", "id": "J1"})
    monkeypatch.setattr(ds, "emitir_por_solicitud",
                        lambda sid, **kw: {"status": estado_doc, "numero": "DSMG9", "id": "9"})
    s = w.crear_solicitud(_pago(t, m))
    return w.aprobar(s["id"]), espejados


@pytest.mark.parametrize("estado_doc", ["success", "borrador"])
def test_con_documento_soporte_el_asiento_no_se_espeja(mods, monkeypatch, estado_doc):
    """El documento ya lleva a Alegra el gasto y las retenciones; espejar además
    el asiento lo duplicaba (DSMG1 + comprobante 134 de Fidel, 18-sep-2026)."""
    r, espejados = _aprobar_con(mods, monkeypatch, estado_doc)
    assert espejados == []
    assert r["alegra"]["status"] == "cubierto_por_doc_soporte"
    assert r["movimiento"]["id"]          # el Libro Mayor sí lleva su asiento


def test_sin_documento_soporte_el_asiento_se_espeja_como_siempre(mods, monkeypatch):
    r, espejados = _aprobar_con(mods, monkeypatch, "no_aplica")
    assert espejados == [r["movimiento"]["id"]]
    assert r["alegra"]["status"] == "success"


def test_si_el_documento_falla_el_asiento_igual_llega_a_alegra(mods, monkeypatch):
    """Un error del documento no puede dejar el pago invisible en Alegra."""
    r, espejados = _aprobar_con(mods, monkeypatch, "error")
    assert espejados == [r["movimiento"]["id"]]


# ─── 21-sep-2026: todo al peso, para que el libro y Alegra cuadren exacto ───

def test_el_reteica_asumido_da_una_base_entera_y_el_neto_exacto(mods):
    """Pactado libre de retención con ReteICA 9,66 por mil: base, ICA y giro en pesos enteros."""
    cc, w, _t, m, _ = mods
    t = cc.crear_tercero({"nombre": "Victor", "tipo": "otro", "tipo_persona": "natural",
                          "identificacion": "3241821"})
    cc.actualizar_tercero(t["id"], {"retefuente_exento": 1, "ica_por_mil": 9.66,
                                    "retencion_asume_mckenna": 1})
    for neto in (1_100_000, 1_250_000, 1_599_000, 2_500_000):
        prev = w.previsualizar({"categoria": "servicios", "cuenta_debito": "511035",
                                "monto": neto, "concepto": "Asesoría", "tercero_id": t["id"],
                                "medio_pago_id": m["id"], "fecha": "2026-09-21",
                                "retencion_modo": "mckenna"})
        assert prev["retencion_ica"] > 0
        assert prev["monto"] == int(prev["monto"])
        assert prev["retencion_ica"] == int(prev["retencion_ica"])
        assert prev["girado"] == neto
        assert prev["cuadra"] is True


def test_pesos_redondea_la_mitad_hacia_arriba():
    from app.services.pagos_wizard import _pesos

    assert _pesos(10_729.65) == 10_730
    assert _pesos(24_385.5) == 24_386      # round() de Python daría 24_386 aquí…
    assert _pesos(12_192.5) == 12_193      # …pero 12_192 aquí: por eso no se usa


def test_rearmar_una_solicitud_guardada_no_repite_el_gross_up(mods):
    """Lo guardado ya es la base bruta: recalcularla como neto la inflaba otra vez."""
    cc, w, _t, m, _ = mods
    t = cc.crear_tercero({"nombre": "William", "tipo": "proveedor", "tipo_persona": "natural",
                          "identificacion": "1022349819"})
    cc.actualizar_tercero(t["id"], {"retefuente_exento": 1, "ica_por_mil": 8.66,
                                    "retencion_asume_mckenna": 1})
    s = w.crear_solicitud({"categoria": "servicios", "cuenta_debito": "511035", "monto": 1_200_000,
                           "concepto": "Contabilidad", "tercero_id": t["id"],
                           "medio_pago_id": m["id"], "fecha": "2026-09-21"})
    assert s["monto"] == 1_210_483 and s["retencion_ica"] == 10_483 and s["girado"] == 1_200_000
    prev = w.previsualizacion_de(s["id"])
    assert prev["monto"] == 1_210_483 and prev["girado"] == 1_200_000
    assert not prev["difiere_de_lo_guardado"]
    r = w.aprobar(s["id"], espejar=False)
    por_cuenta = {l["cuenta_codigo"]: l for l in r["movimiento"]["lineas"]}
    assert por_cuenta["511035"]["debito"] == 1_210_483
    assert por_cuenta["2368"]["credito"] == 10_483
    assert por_cuenta["1110"]["credito"] == 1_200_000


def test_un_pago_de_mas_se_aprueba_con_lo_que_salio_del_banco(mods):
    """Se giró la cotización completa ($876.554) sin descontar la retención
    ($18.415): el asiento saca del banco lo que salió y la diferencia queda
    como anticipo a favor con el proveedor (133005), no se pierde."""
    cc, w, t, m, _ = mods
    s = w.crear_solicitud({
        "categoria": "productos", "concepto": "Bolsas", "fecha": "2026-09-24",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
        "retencion_modo": "beneficiario", "total_documento": 876_554,
        "items": [{"sku": "BOLTRA15X21ZIP", "nombre": "BOLSA", "cantidad": 2900,
                   "precio": 254, "iva_pct": 19}],
        "pagado_ahora": 876_554,
    })
    mov = cc.obtener_movimiento(w.aprobar(s["id"], espejar=False)["movimiento_id"])
    por = {l["cuenta_codigo"]: (l["debito"], l["credito"]) for l in mov["lineas"]}
    assert por["1110"] == (0, 876_554)
    assert por["133005"] == (18_415, 0)
    assert por["236540"] == (0, 18_415)
    assert cc.balance_comprobacion()["cuadra"]


def test_la_vista_de_una_compra_guardada_respeta_sus_productos(mods):
    """El panel recalcula la solicitud al abrirla. Sin los productos, la #48
    salía con el IVA en inventario y la retención sobre el total con IVA."""
    _cc, w, t, m, _ = mods
    s = w.crear_solicitud({
        "categoria": "productos", "concepto": "Bolsas", "fecha": "2026-09-24",
        "tercero_id": t["id"], "medio_pago_id": m["id"], "monto": 0,
        "retencion_modo": "beneficiario", "total_documento": 876_554,
        "items": [{"sku": "BOLTRA15X21ZIP", "nombre": "BOLSA", "cantidad": 2900,
                   "precio": 254, "iva_pct": 19}],
        "pagado_ahora": 876_554,
    })
    p = w.previsualizacion_de(s["id"])
    por = {l["cuenta_codigo"]: (l["debito"], l["credito"]) for l in p["lineas"]}
    assert por["1435"] == (736_600, 0)
    assert por["240810"] == (139_954, 0)
    assert p["retencion"] == 18_415
    assert p["difiere_de_lo_guardado"] is False
