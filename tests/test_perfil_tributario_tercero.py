"""El perfil tributario vive en el tercero y se arrastra solo.

Lo que se protege: que «a esta persona se le paga sin retención de renta, con
ICA 9,66 por mil y 4x1000» sea una propiedad de la persona y no algo que alguien
deba acordarse de marcar cada quincena. Marcarlo bien doce veces al año y
olvidarlo una es lo que produjo los $164.542 de retención practicada de más en
septiembre de 2026.
"""

from __future__ import annotations

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
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    w.init_db()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": banco})
    persona = cc.crear_tercero({
        "nombre": "Victor Hugo Garcia", "tipo": "otro",
        "tipo_persona": "natural", "identificacion": "3241821",
    })
    return cc, w, persona, medio


def _pago(persona, medio, **extra):
    return {"categoria": "servicios", "monto": 1_000_000, "concepto": "Quincena",
            "tercero_id": persona["id"], "medio_pago_id": medio["id"],
            "fecha": "2026-09-30", **extra}


def _perfil(cc, tercero_id: int) -> dict:
    t = cc.obtener_tercero(tercero_id)
    return {k: t[k] for k in
            ("retefuente_exento", "ica_por_mil", "gmf_por_defecto", "cuenta_gasto_default")}


def test_sin_perfil_el_pago_se_comporta_como_siempre(mods):
    _cc, w, persona, medio = mods
    prev = w.previsualizar(_pago(persona, medio))
    assert prev["retencion"] > 0          # servicios 4% / 6%
    assert prev["retencion_ica"] == 0
    assert prev["gmf"] == 0


def test_el_perfil_del_tercero_deja_las_casillas_puestas(mods):
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("""UPDATE cc_terceros SET retefuente_exento=1, ica_por_mil=9.66,
                              gmf_por_defecto=1, cuenta_gasto_default='511095' WHERE id=?""",
                    (persona["id"],))

    # El pago no dice NADA de impuestos: todo sale de la ficha.
    prev = w.previsualizar(_pago(persona, medio))

    assert prev["retencion"] == 0                       # exento de renta
    assert prev["retencion_ica"] == pytest.approx(9_660, abs=1)   # 9,66 por mil
    assert prev["gmf"] > 0                              # 4x1000
    assert prev["lineas"][0]["cuenta_codigo"] == "511095"


def test_el_ica_no_se_cae_junto_con_la_retencion_de_renta(mods):
    """Son dos impuestos distintos: quedar exento de renta no exime del ICA."""
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET retefuente_exento=1, ica_por_mil=9.66 WHERE id=?",
                    (persona["id"],))
    prev = w.previsualizar(_pago(persona, medio))
    assert prev["retencion"] == 0
    assert prev["retencion_ica"] > 0
    assert any(l["cuenta_codigo"] == "2368" for l in prev["lineas"])


def test_lo_que_el_operador_define_queda_guardado_para_la_proxima(mods):
    cc, w, persona, medio = mods
    assert _perfil(cc, persona["id"])["ica_por_mil"] == 0

    w.crear_solicitud(_pago(persona, medio, ica_por_mil=9.66, gmf=True,
                            retencion_modo="ninguna", cuenta_debito="511095"))

    # La exención de renta NO se aprende del pago (cambio del 18-sep-2026): al
    # dejar de preguntarle el modo al operador, «ninguna» pasó a ser una
    # consecuencia de la CUENTA —un servicio público no retiene— y no una
    # afirmación sobre el tercero. Aprender de ahí desmarcaría a los
    # autorretenedores de verdad en cuanto se les pagara por una cuenta que sí
    # retiene. Se cambia en la ficha del tercero, que es donde se sabe.
    assert _perfil(cc, persona["id"]) == {
        "retefuente_exento": 0, "ica_por_mil": 9.66,
        "gmf_por_defecto": 1, "cuenta_gasto_default": "511095",
    }
    # Lo que sí se arrastra: el ICA y el 4x1000 no hay que volver a marcarlos.
    prev = w.previsualizar(_pago(persona, medio))
    assert prev["retencion_ica"] > 0 and prev["gmf"] > 0


def test_lo_que_el_pago_no_menciona_no_se_sobreescribe(mods):
    """Si el operador no tocó el ICA, no hay nada nuevo que aprender de ese pago."""
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET ica_por_mil=9.66, gmf_por_defecto=1 WHERE id=?",
                    (persona["id"],))
    w.crear_solicitud(_pago(persona, medio, retencion_modo="ninguna"))
    perfil = _perfil(cc, persona["id"])
    assert perfil["ica_por_mil"] == 9.66     # sigue ahí
    assert perfil["gmf_por_defecto"] == 1
    # Y la exención tampoco se toca desde el pago, en ningún sentido.
    assert perfil["retefuente_exento"] == 0


def test_a_un_regimen_simple_no_se_le_aprende_nada(mods):
    """Su exención es el Art. 911 ET, no una preferencia que un pago pueda cambiar."""
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET regimen_simple=1 WHERE id=?", (persona["id"],))
    w.crear_solicitud(_pago(persona, medio, retencion_modo="beneficiario", ica_por_mil=9.66))
    assert _perfil(cc, persona["id"])["retefuente_exento"] == 0
    assert _perfil(cc, persona["id"])["ica_por_mil"] == 0


def test_decir_que_nadie_retiene_no_apaga_el_ica(mods):
    """El bug que se habría llevado el ICA de todas estas quincenas.

    «Nadie — no se practica retención» habla de la retención de RENTA. El ICA es
    otro impuesto, con otra base legal y otro destinatario (el municipio, no la
    DIAN). Como el perfil de estas personas selecciona justo esa opción, apagar
    los dos juntos significaba que a quienes el contador mandó practicarles ICA
    no se les practicaba nunca.
    """
    _cc, w, persona, medio = mods
    prev = w.previsualizar(_pago(persona, medio, retencion_modo="ninguna", ica_por_mil=9.66))

    assert prev["retencion"] == 0                                  # renta: no
    assert prev["retencion_ica"] == pytest.approx(9_660, abs=1)     # ICA: sí
    assert any(l["cuenta_codigo"] == "2368" for l in prev["lineas"])


def test_girar_un_saldo_pendiente_no_vuelve_a_causar_impuestos(mods):
    """Ahí el gasto y sus impuestos ya se causaron: cobrarlos otra vez es cobrar dos veces."""
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET ica_por_mil=9.66 WHERE id=?", (persona["id"],))
    # Primero se causa el servicio dejando un saldo.
    w.crear_solicitud(_pago(persona, medio, monto=3_000_000, pagado_ahora=1_000_000,
                            retencion_modo="ninguna"))
    prev = w.previsualizar({
        "categoria": "saldo_por_pagar", "monto": 500_000, "concepto": "Saldo",
        "tercero_id": persona["id"], "medio_pago_id": medio["id"], "fecha": "2026-10-05",
    })
    assert prev["retencion"] == 0
    assert prev["retencion_ica"] == 0


def test_salario_de_socio_esta_oculta_pero_no_borrada(mods):
    """Las solicitudes históricas con esa categoría tienen que poder abrirse."""
    _cc, w, _p, _m = mods
    assert w.CATEGORIAS["salario_socio"]["oculta"] is True
    assert w.CATEGORIAS["salario_socio"]["cuenta_debito"]   # sigue completa


def test_servicios_cubre_lo_que_hacia_salario_de_socio(mods):
    """Incluye el pago parcial, que era la razón de tener un botón aparte."""
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET tipo='socio', cuenta_gasto_default='511095' WHERE id=?",
                    (persona["id"],))
    prev = w.previsualizar(_pago(persona, medio, monto=3_000_000, pagado_ahora=1_000_000))

    assert prev["lineas"][0]["cuenta_codigo"] == "511095"
    assert prev["saldo_pendiente"] > 0
    assert prev["cuenta_saldo"] == "2355"   # deudas con socios
    assert prev["cuadra"] is True


def test_las_cuentas_t_dicen_como_queda_cada_cuenta(mods):
    """«$3.000.000 al débito de 511095» no dice nada hasta ver el saldo resultante."""
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET cuenta_gasto_default='511095' WHERE id=?",
                    (persona["id"],))
    prev = w.previsualizar(_pago(persona, medio, monto=1_000_000, retencion_modo="ninguna"))
    por_codigo = {t["cuenta_codigo"]: t for t in prev["cuentas_t"]}

    gasto = por_codigo["511095"]
    assert gasto["naturaleza"] == "debito"
    assert gasto["debito"] == 1_000_000
    assert gasto["saldo_despues"] == gasto["saldo_antes"] + 1_000_000

    # Un crédito a Bancos BAJA el saldo: el efecto se calcula por naturaleza,
    # no tratando todo crédito como una resta (ni como una suma).
    banco = por_codigo["1110"]
    assert banco["naturaleza"] == "debito"
    assert banco["credito"] == 1_000_000
    assert banco["saldo_despues"] == banco["saldo_antes"] - 1_000_000


def test_en_una_cuenta_de_credito_el_haber_suma(mods):
    cc, w, persona, medio = mods
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET ica_por_mil=9.66 WHERE id=?", (persona["id"],))
    prev = w.previsualizar(_pago(persona, medio, retencion_modo="ninguna"))
    ica = next(t for t in prev["cuentas_t"] if t["cuenta_codigo"] == "2368")

    assert ica["naturaleza"] == "credito"
    assert ica["credito"] > 0
    assert ica["saldo_despues"] == ica["saldo_antes"] + ica["credito"]


def test_las_cuentas_t_cuadran_con_el_asiento(mods):
    _cc, w, persona, medio = mods
    prev = w.previsualizar(_pago(persona, medio))
    assert round(sum(t["debito"] for t in prev["cuentas_t"]), 2) == \
           round(sum(l["debito"] for l in prev["lineas"]), 2)
    assert round(sum(t["credito"] for t in prev["cuentas_t"]), 2) == \
           round(sum(l["credito"] for l in prev["lineas"]), 2)


# ─── Pago de impuestos: lo retenido a terceros vs. lo que McKenna debe ──────

def test_pagar_un_impuesto_baja_la_cuenta_de_ESE_impuesto(mods):
    """El error que esto evita: pagar el IVA bajando la 2365.

    Las 23xx son lo que McKenna RETUVO a terceros y consigna a nombre de ellos;
    las 24xx son lo que debe como contribuyente. Saldar una con el pago de la
    otra deja el impuesto real todavía como pasivo y la retención en negativo.
    """
    cc, w, _p, medio = mods
    with cc._conn() as con:
        iva = cc._cuenta_id_por_codigo(con, "2408")
        ventas = cc._cuenta_id_por_codigo(con, "4135")
    cc.crear_movimiento(
        fecha="2026-09-30", concepto="IVA generado del bimestre",
        lineas=[{"cuenta_id": ventas, "debito": 500_000, "credito": 0},
                {"cuenta_id": iva, "debito": 0, "credito": 500_000}],
    )

    prev = w.previsualizar({
        "categoria": "impuestos", "cuenta_debito": "2408", "monto": 500_000,
        "concepto": "Declaración de IVA", "fecha": "2026-10-15", "medio_pago_id": medio["id"],
    })
    assert prev["lineas"][0]["cuenta_codigo"] == "2408"
    assert prev["lineas"][0]["debito"] == 500_000
    assert prev["cuadra"] is True


def test_no_se_puede_pagar_un_impuesto_contra_una_cuenta_cualquiera(mods):
    _cc, w, _p, medio = mods
    with pytest.raises(ValueError, match="no es una cuenta de impuestos"):
        w.previsualizar({
            "categoria": "impuestos", "cuenta_debito": "511095", "monto": 100_000,
            "concepto": "x", "fecha": "2026-10-15", "medio_pago_id": medio["id"],
        })


def test_solo_se_ofrecen_los_impuestos_que_de_verdad_se_deben(mods):
    cc, w, _p, _m = mods
    assert w.opciones("impuestos")["opciones"] == []   # libro vacío: nada que pagar

    with cc._conn() as con:
        ica = cc._cuenta_id_por_codigo(con, "2412")
        gasto = cc._cuenta_id_por_codigo(con, "5115")
    cc.crear_movimiento(
        fecha="2026-09-30", concepto="ICA causado",
        lineas=[{"cuenta_id": gasto, "debito": 80_000, "credito": 0},
                {"cuenta_id": ica, "debito": 0, "credito": 80_000}],
    )
    ops = w.opciones("impuestos")["opciones"]
    assert [o["cuenta"] for o in ops] == ["2412"]
    assert ops[0]["monto_sugerido"] == 80_000


def test_2367_volvio_a_significar_iva_retenido(mods):
    """La migración al PUC la había desactivado por el mal uso que tenía antes."""
    cc, _w, _p, _m = mods
    from app.services.puc_colombia import resolver

    assert resolver("2367") == "2367"          # ya no redirige a 2335
    with cc._conn() as con:
        fila = con.execute("SELECT * FROM cc_plan_cuentas WHERE codigo='2367'").fetchone()
    assert fila["activa"] == 1
    assert "ventas retenido" in fila["nombre"].lower()
