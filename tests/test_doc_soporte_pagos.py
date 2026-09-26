"""Documento soporte en adquisiciones a no obligados a facturar.

El Art. 771-2 E.T. solo acepta un costo o deducción con factura o documento
equivalente. Cuando el proveedor NO está obligado a facturar —una persona
natural que cobra con cuenta de cobro amparada en el Art. 616-2— el soporte lo
emite McKenna: documento soporte electrónico con CUDS (Res. 000167/2021).

Caso que lo motivó: la mensajería de Fidel Rocha, ~$1,93M por quincena (~$46,4M
al año), pagada y conciliada pero sin soporte fiscal.
"""
from __future__ import annotations

import pytest

import app.services.contabilidad_core as cc


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    from app.services import doc_soporte_pagos as ds

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.delenv("PAGOS_DOC_SOPORTE_ACTIVO", raising=False)
    cc._ensure()
    ds._ensure()
    return ds


def _tercero(**kw):
    base = {"nombre": "X", "tipo": "proveedor", "tipo_persona": "natural",
            "identificacion": "9385573"}
    return {**base, **kw}


def test_arranca_en_modo_sombra(libro):
    """Un documento soporte emitido YA viajó a la DIAN y consume numeración de
    la resolución: solo se corrige con nota de ajuste. No se emite por defecto."""
    assert libro.activo() is False


def test_una_persona_juridica_no_lleva_documento_soporte(libro):
    t = cc.crear_tercero(_tercero(tipo_persona="juridica", identificacion="800251569"))
    hay, motivo = libro.requiere(cc.obtener_tercero(t["id"]))
    assert hay is False
    assert "obligada a facturar" in motivo


def test_el_regimen_simple_si_esta_obligado_a_facturar(libro):
    """Art. 915 E.T. Y por eso mismo: que alguien cobre con cuenta de cobro
    amparado en el 616-2 es evidencia de que NO es del SIMPLE — las dos cosas
    son incompatibles, y si la ficha dice las dos, una está mal."""
    t = cc.crear_tercero(_tercero(identificacion="1026262496"))
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET regimen_simple=1 WHERE id=?", (t["id"],))
    hay, motivo = libro.requiere(cc.obtener_tercero(t["id"]))
    assert hay is False
    assert "915" in motivo


def test_solo_lleva_quien_esta_marcado_en_su_ficha(libro):
    """No se decide solo: equivocarse emite un documento fiscal irreversible a
    nombre de alguien real."""
    t = cc.crear_tercero(_tercero())
    assert libro.requiere(cc.obtener_tercero(t["id"]))[0] is False
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET emite_doc_soporte=1 WHERE id=?", (t["id"],))
    hay, motivo = libro.requiere(cc.obtener_tercero(t["id"]))
    assert hay is True and "no obligado a facturar" in motivo


def test_sin_tercero_no_se_emite(libro):
    assert libro.requiere(None)[0] is False


def test_no_se_emite_de_un_periodo_ya_declarado(libro, monkeypatch):
    """Antes del corte manda el contador: no se emiten documentos fiscales de un
    período que él ya declaró."""
    from app.services import pagos_wizard as pw

    monkeypatch.setattr(pw, "obtener", lambda sid: {
        "id": sid, "fecha": "2026-07-03", "movimiento_id": 1, "tercero_id": 1,
        "monto": 1_845_000, "retencion": 0, "concepto": "Mensajería julio",
    })
    r = libro.emitir_por_solicitud(1)
    assert r["status"] == "bloqueado_por_corte"


def test_no_se_emite_sobre_una_solicitud_sin_aprobar(libro, monkeypatch):
    """El documento soporta un gasto ya contabilizado, no una intención."""
    from app.services import pagos_wizard as pw

    monkeypatch.setattr(pw, "obtener", lambda sid: {
        "id": sid, "fecha": "2026-09-18", "movimiento_id": None, "tercero_id": 1,
        "monto": 100, "retencion": 0, "concepto": "x",
    })
    r = libro.emitir_por_solicitud(1)
    assert r["status"] == "no_aplica"
    assert "aprobada" in r["message"]


# ─── La retención tiene que ir DENTRO del documento ─────────────────────────

def test_la_retencion_de_transporte_esta_mapeada_en_alegra():
    """Existía en Alegra (id 13, «Transporte de carga» 1%) pero no estaba
    mapeada, así que el documento de un pago a Fidel habría salido SIN
    retención — y ya transmitido a la DIAN, solo corregible con nota de ajuste."""
    from app.services.alegra import retencion_alegra_id

    assert retencion_alegra_id("transporte_carga", 1.0) == 13


def test_todo_concepto_con_tarifa_usual_tiene_retencion_en_alegra():
    from app.services.alegra import retencion_alegra_id
    from app.services.retenciones import CONCEPTOS

    sin_mapear = [
        (c, t) for c, (td, tnd, _m, _n) in CONCEPTOS.items()
        for t in {td, tnd} if retencion_alegra_id(c, t) is None
    ]
    # `otros_ingresos` es el cajón de sastre: si un pago cae ahí, la cuenta está
    # mal elegida, y no se le inventa una retención en Alegra.
    assert all(c == "otros_ingresos" for c, _t in sin_mapear), sin_mapear


def test_la_solicitud_guarda_el_concepto_de_la_CUENTA_no_el_de_la_categoria(monkeypatch, tmp_path):
    """Guardar el de la categoría mandaba la retención a la subcuenta de 2365
    equivocada y dejaba el documento soporte sin retención, porque
    («servicios», 1%) no existe en Alegra."""
    import app.services.pagos_wizard as w
    from app.services import tickets_db

    db = str(tmp_path / "c.db")
    for mod in (cc, w):
        monkeypatch.setattr(mod, "_DB_PATH", db)
        monkeypatch.setattr(mod, "_initialized", False)
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tk.db"))
    w.init_db()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
    medio = cc.crear_medio_pago({"nombre": "Banco", "tipo": "banco", "cuenta_id": banco})
    t = cc.crear_tercero(_tercero(nombre="FIDEL ROCHA MORON"))
    s = w.crear_solicitud({
        "categoria": "servicios", "monto": 1_998_000, "concepto": "Mensajería",
        "tercero_id": t["id"], "medio_pago_id": medio["id"], "fecha": "2026-09-18",
        "cuenta_debito": "523550", "estado": "borrador",
    })
    assert w.obtener(s["id"])["retencion_concepto"] == "transporte_carga"


# ─── El pago se salda en Alegra al confirmar el giro ───────────────────────

def test_el_documento_se_salda_con_lo_girado_no_con_el_total(libro, monkeypatch):
    """La retención no se le pagó al beneficiario: se le consigna a la DIAN.
    Saldar por el total dejaría el documento sobrepagado."""
    from app.services import alegra, pagos_wizard as pw

    with cc._conn() as con:
        con.execute(
            "INSERT INTO cc_doc_soporte (solicitud_id, tercero_id, fecha, valor, alegra_id, estado)"
            " VALUES (1, 1, '2026-09-18', 2026657, '1', 'success')"
        )
    monkeypatch.setattr(pw, "obtener", lambda sid: {
        "id": sid, "girado": 1_998_000.07, "movimiento_id": 5476,
        "pagado_at": "2026-09-18", "fecha": "2026-09-18",
    })
    visto = {}
    monkeypatch.setattr(alegra, "registrar_pago_documento_soporte",
                        lambda **kw: (visto.update(kw), {"status": "success", "id": "445"})[1])
    r = libro.registrar_pago_en_alegra(1)
    assert r["status"] == "success"
    assert visto["valor"] == pytest.approx(1_998_000.07, abs=0.01)   # lo girado
    assert visto["bill_id"] == "1"


def test_sin_documento_emitido_no_hay_nada_que_saldar(libro):
    assert libro.registrar_pago_en_alegra(999)["status"] == "no_aplica"


def test_el_reteica_va_dentro_del_documento_con_su_tarifa():
    """Faltando, el «total a pagar» del documento no coincidía con lo girado:
    el DSMG1 decía $2.006.390 cuando se giraron $1.998.000 (18-sep-2026). Y con
    la retención genérica al 0% el documento oficial imprimía «(0%)»."""
    from app.services.alegra import crear_documento_soporte_alegra, retencion_ica_alegra_id

    assert retencion_ica_alegra_id(4.14) == 15      # transporte Bogotá
    assert retencion_ica_alegra_id(8.66) == 16      # asesoría técnica
    assert retencion_ica_alegra_id(9.66) == 17      # servicios en general
    r = crear_documento_soporte_alegra(
        identificacion="9385573", nombre="FIDEL ROCHA MORON", fecha="2026-09-18",
        valor=2_026_657, descripcion="Mensajería", cuenta_contable="5875",
        retencion={"concepto": "transporte_carga", "tarifa_pct": 1.0, "retencion": 20_266.57},
        retencion_ica=8_390.36, ica_por_mil=4.14, dry_run=True,
    )
    ids = {x["id"]: x["amount"] for x in r["payload"]["retentions"]}
    assert ids == {13: 20_266.57, 15: 8_390.36}
    assert round(2_026_657 - sum(ids.values()), 2) == pytest.approx(1_998_000.07, abs=0.01)


def test_una_tarifa_de_ica_sin_cuenta_propia_avisa_en_vez_de_callar():
    """Cae a la genérica: informa el monto correcto pero imprime «(0%)», y
    quien emite tiene que saberlo para crear la retención."""
    from app.services.alegra import crear_documento_soporte_alegra

    r = crear_documento_soporte_alegra(
        identificacion="9385573", nombre="X", fecha="2026-09-18", valor=1_000_000,
        descripcion="x", cuenta_contable="5875", retencion_ica=11_040, ica_por_mil=11.04,
        dry_run=True,
    )
    assert r["payload"]["retentions"][0]["id"] == 11
    assert "0%" in (r.get("aviso") or "")


# ─── 21-sep-2026: préstamos aparte y transmisión a la DIAN aparte ───────────

def test_una_cuota_de_prestamo_no_lleva_documento_por_la_cuota_entera(libro, monkeypatch):
    """La cuota es capital + intereses; el documento de los intereses es de Préstamos."""
    from app.services import pagos_wizard as pw

    monkeypatch.setattr(pw, "obtener", lambda sid: {
        "id": sid, "fecha": "2026-10-09", "movimiento_id": 9, "tercero_id": 1,
        "categoria": "cuota_prestamo", "monto": 700_000, "retencion": 0, "concepto": "Cuota 1/24",
    })
    r = libro.emitir_por_solicitud(1)
    assert r["status"] == "no_aplica"
    assert "Préstamos" in r["message"]


def test_el_sello_de_la_dian_solo_se_pide_si_se_pide():
    from app.services.alegra import crear_documento_soporte_alegra

    kw = dict(identificacion="3241821", nombre="X", fecha="2026-09-15", valor=100_000,
              descripcion="Asesoría", cuenta_contable="5849", dry_run=True)
    assert "stamp" not in crear_documento_soporte_alegra(**kw)["payload"]
    con = crear_documento_soporte_alegra(**kw, enviar_dian=True)["payload"]
    assert con["stamp"] == {"generateStamp": True}


# ─── 21-sep-2026: borrador al aprobar, emisión manual con validaciones ──────

def _sol(**kw):
    base = {"id": 7, "fecha": "2026-09-21", "movimiento_id": 99, "tercero_id": 1, "categoria": "servicios",
            "monto": 1_110_730, "retencion": 0, "retencion_ica": 10_730, "ica_por_mil": 9.66,
            "retencion_concepto": "honorarios", "cuenta_debito": "511035", "concepto": "Asesoría",
            "estado": "aprobada", "girado": 1_100_000}
    return {**base, **kw}


@pytest.fixture()
def borrador(libro, monkeypatch):
    from app.services import pagos_wizard as pw

    t = cc.crear_tercero(_tercero(nombre="Victor", identificacion="3241821"))
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET emite_doc_soporte=1 WHERE id=?", (t["id"],))
    sol = _sol(tercero_id=t["id"])
    monkeypatch.setattr(pw, "obtener", lambda sid: {**sol, "id": sid})
    monkeypatch.setattr(libro, "_cuenta_alegra", lambda c: "5849")
    monkeypatch.setenv("PAGOS_DOC_SOPORTE_ACTIVO", "1")
    return libro, sol


def _alegra_falso(monkeypatch, *, contacto_tipo="NIT", aviso=None, retenciones=None, pais="Colombia"):
    import requests

    from app.services import alegra as A

    llamadas = {"crear": [], "pagos": []}

    class _R:
        def __init__(self, data):
            self._d = data

        def json(self):
            return self._d

    def get(url, **kw):
        if "/contacts" in url:
            return _R([{"name": "Victor", "identificationObject": {"type": contacto_tipo, "dv": "5" if contacto_tipo == "NIT" else None},
                        "address": {"country": pais, "department": "Bogotá D.C.", "city": "Bogotá, D.C."}}])
        return _R({"balance": 0})

    def crear(**kw):
        if kw.get("dry_run"):
            por_defecto = ([{"id": 9, "amount": kw["retencion"]["retencion"]}] if kw.get("retencion") else [])
            ret = retenciones if retenciones is not None else por_defecto
            return {"status": "dry_run", "payload": {"retentions": ret}, "aviso": aviso}
        llamadas["crear"].append(kw)
        return {"status": "success", "id": "2", "numero": "DSMG2", "transmitido": True,
                "estado_dian": "STAMPED_AND_ACCEPTED",
                "data": {"retentions": [{"amount": kw["retencion_ica"]}], "stamp": {"cude": "abc"}}}

    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(A, "crear_documento_soporte_alegra", crear)
    monkeypatch.setattr(A, "registrar_pago_documento_soporte",
                        lambda **kw: llamadas["pagos"].append(kw) or {"status": "success", "id": "P1"})
    return llamadas


def test_aprobar_deja_un_borrador_y_no_toca_alegra(borrador, monkeypatch):
    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    r = ds.emitir_por_solicitud(7)
    assert r["status"] == "borrador"
    assert llamadas["crear"] == []
    doc = ds.obtener_por_solicitud(7)
    assert doc["estado"] == "borrador"
    assert doc["detalle"]["base"] == 1_110_730 and doc["detalle"]["retencion_ica"] == 10_730
    assert ds.emitir_por_solicitud(7)["status"] == "borrador"      # idempotente


def test_el_boton_emite_transmite_y_registra_los_pagos(borrador, monkeypatch):
    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    ds.emitir_por_solicitud(7)
    assert ds.registrar_pago_en_alegra(7)["status"] == "anotado"
    r = ds.emitir_a_dian(7, por=1)
    assert r["status"] == "success" and r["numero"] == "DSMG2"
    assert llamadas["crear"][0]["enviar_dian"] is True
    assert [p["valor"] for p in llamadas["pagos"]] == [1_100_000]
    doc = ds.obtener_por_solicitud(7)
    assert doc["estado"] == "success" and doc["numero"] == "DSMG2" and doc["cuds"] == "abc"
    assert ds.emitir_a_dian(7)["status"] == "ya_emitido"


def test_no_se_emite_si_falta_una_retencion_en_alegra(borrador, monkeypatch):
    """La lección del DSMG1: un documento sin sus retenciones deja un saldo fantasma."""
    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch, aviso="⚠️ No hay retención de ICA configurada en Alegra")
    ds.emitir_por_solicitud(7)
    r = ds.emitir_a_dian(7)
    assert r["status"] == "error" and "ICA" in r["message"]
    assert llamadas["crear"] == []


def test_no_se_emite_si_las_retenciones_no_suman_lo_esperado(borrador, monkeypatch):
    from app.services import pagos_wizard as pw

    ds, sol = borrador
    con_rte = {**sol, "monto": 1_000_000, "retencion": 40_000, "retencion_ica": 0, "retencion_concepto": "servicios"}
    monkeypatch.setattr(pw, "obtener", lambda sid: {**con_rte, "id": sid})
    llamadas = _alegra_falso(monkeypatch, retenciones=[])
    ds.emitir_por_solicitud(7)
    r = ds.emitir_a_dian(7)
    assert r["status"] == "error" and "fantasma" in r["message"]
    assert llamadas["crear"] == []


def test_no_se_emite_lo_que_no_esta_al_peso(libro, monkeypatch):
    from app.services import pagos_wizard as pw

    t = cc.crear_tercero(_tercero(identificacion="3241821"))
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET emite_doc_soporte=1 WHERE id=?", (t["id"],))
    monkeypatch.setattr(pw, "obtener", lambda sid: _sol(id=sid, tercero_id=t["id"], monto=1_110_729.65,
                                                        retencion_ica=10_729.65))
    monkeypatch.setenv("PAGOS_DOC_SOPORTE_ACTIVO", "1")
    llamadas = _alegra_falso(monkeypatch)
    libro.emitir_por_solicitud(7)
    r = libro.emitir_a_dian(7)
    assert r["status"] == "error" and "al peso" in r["message"]
    assert llamadas["crear"] == []


def test_no_se_emite_a_un_contacto_con_cedula_sin_dv(borrador, monkeypatch):
    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch, contacto_tipo="CC")
    ds.emitir_por_solicitud(7)
    r = ds.emitir_a_dian(7)
    assert r["status"] == "error" and "NIT" in r["message"]
    assert llamadas["crear"] == []


def test_con_la_emision_apagada_el_boton_no_emite(borrador, monkeypatch):
    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    ds.emitir_por_solicitud(7)
    monkeypatch.delenv("PAGOS_DOC_SOPORTE_ACTIVO")
    assert ds.emitir_a_dian(7)["status"] == "error"
    assert llamadas["crear"] == []


def test_el_listado_trae_borradores_y_no_los_complementos(borrador, monkeypatch):
    ds, _ = borrador
    _alegra_falso(monkeypatch)
    ds.emitir_por_solicitud(7)
    with cc._conn() as con:
        con.execute("INSERT INTO cc_doc_soporte (solicitud_id, tercero_id, fecha, valor, estado, incluido_en)"
                    " VALUES (8, 1, '2026-09-21', 0, 'incluido', 7)")
    docs = ds.listar()
    assert [d["solicitud_id"] for d in docs] == [7]
    assert ds.obtener_por_solicitud(8)["solicitud_id"] == 7       # el complemento lleva al principal


def test_antes_de_aprobar_se_ve_la_vista_previa_sin_guardar_nada(borrador, monkeypatch):
    ds, sol = borrador
    pendiente = {**sol, "movimiento_id": None, "estado": "pendiente"}
    vp = ds.vista_previa(pendiente)
    assert vp["estado"] == "vista_previa"
    assert vp["detalle"]["base"] == 1_110_730 and vp["detalle"]["girado"] == 1_100_000
    assert ds.obtener_por_solicitud(7) is None                 # no guardó nada
    # Y lo que se previsualiza es exactamente lo que queda al aprobar.
    ds.emitir_por_solicitud(7)
    guardado = ds.obtener_por_solicitud(7)["detalle"]
    assert {k: guardado[k] for k in ("base", "retencion", "retencion_ica", "girado", "cuenta_puc")} == \
           {k: vp["detalle"][k] for k in ("base", "retencion", "retencion_ica", "girado", "cuenta_puc")}


def test_una_cuota_de_prestamo_no_tiene_vista_previa(borrador):
    ds, sol = borrador
    assert ds.vista_previa({**sol, "categoria": "cuota_prestamo", "movimiento_id": None}) is None


def test_si_la_dian_no_responde_el_reintento_no_duplica_el_documento(borrador, monkeypatch):
    """21-sep-2026: dos clics con la DIAN caída dejaron DSMG2 y DSMG3 para William."""
    import requests

    from app.services import alegra as A

    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    creados, borrados, sellado = [], [], {"v": ""}

    def crear(**kw):
        if kw.get("dry_run"):
            return {"status": "dry_run", "payload": {"retentions": [{"id": 17, "amount": kw["retencion_ica"]}]}, "aviso": None}
        creados.append(kw)
        if len(creados) == 1:
            return {"status": "creado_sin_transmitir", "id": "2", "numero": "DSMG2", "message": "problema con DIAN"}
        return {"status": "success", "id": "2", "numero": "DSMG2", "transmitido": True, "estado_dian": "STAMPED",
                "data": {"retentions": [{"amount": kw["retencion_ica"]}], "stamp": {"cufe": "x"}}}

    get_base = requests.get

    class _R:
        def __init__(self, code, data):
            self.status_code, self._d = code, data

        def json(self):
            return self._d

    def get(url, **kw):
        if "/bills/2" in url:
            return _R(200, {"id": "2", "stamp": {"legalStatus": sellado["v"]} if sellado["v"] else None,
                            "payments": [], "numberTemplate": {"fullNumber": "DSMG2"}, "balance": 0,
                            "retentions": [{"amount": 10_730}]})
        if "/number-templates/" in url:
            return _R(200, {"nextInvoiceNumber": 5})
        return get_base(url, **kw)

    monkeypatch.setattr(A, "crear_documento_soporte_alegra", crear)
    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(requests, "delete", lambda url, **kw: borrados.append(url) or _R(204, {}))

    ds.emitir_por_solicitud(7)
    r1 = ds.emitir_a_dian(7)
    assert r1["status"] == "por_emitir"
    doc = ds.obtener_por_solicitud(7)
    assert doc["estado"] == "por_emitir" and doc["alegra_id"] == "2" and doc["numero"] == "DSMG2"

    # Reintento: el intento anterior sigue sin sello → se retira y se crea UNO nuevo.
    r2 = ds.emitir_a_dian(7)
    assert r2["status"] == "success"
    assert len(borrados) == 1 and borrados[0].endswith("/bills/2")
    assert len(creados) == 2
    assert ds.obtener_por_solicitud(7)["estado"] == "success"


def test_si_entretanto_la_dian_lo_sello_el_reintento_solo_lo_confirma(borrador, monkeypatch):
    import requests

    from app.services import alegra as A

    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    ds.emitir_por_solicitud(7)
    with cc._conn() as con:
        con.execute("UPDATE cc_doc_soporte SET estado='por_emitir', alegra_id='2', numero='DSMG2' WHERE solicitud_id=7")

    class _R:
        status_code = 200

        def json(self):
            return {"id": "2", "stamp": {"legalStatus": "STAMPED_AND_ACCEPTED"}, "payments": [],
                    "numberTemplate": {"fullNumber": "DSMG2"}, "retentions": [{"amount": 10_730}], "balance": 0}

    monkeypatch.setattr(requests, "get", lambda url, **kw: _R())
    monkeypatch.setattr(requests, "delete", lambda *a, **kw: pytest.fail("no se borra uno ya sellado"))
    r = ds.emitir_a_dian(7)
    assert r["status"] == "success" and llamadas["crear"] == []
    assert ds.obtener_por_solicitud(7)["estado"] == "success"


def test_el_giro_se_anota_tambien_en_un_documento_por_emitir(borrador, monkeypatch):
    ds, _ = borrador
    _alegra_falso(monkeypatch)
    ds.emitir_por_solicitud(7)
    with cc._conn() as con:
        con.execute("UPDATE cc_doc_soporte SET estado='por_emitir' WHERE solicitud_id=7")
    assert ds.registrar_pago_en_alegra(7)["status"] == "anotado"
    assert ds.obtener_por_solicitud(7)["detalle"]["pagos"][0]["valor"] == 1_100_000


# ─── 21-sep-2026: el ReteICA va en el PAGO, no en el documento de la DIAN ───

def test_el_reteica_no_viaja_a_la_dian_y_se_aplica_con_el_primer_pago(borrador, monkeypatch):
    """La DIAN solo contempla ReteFuente y ReteIVA en el documento soporte; con
    ReteICA adentro la transmisión fallaba (3051). El saldo queda en cero porque
    el ReteICA se aplica como retención del pago en Alegra."""
    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    ds.emitir_por_solicitud(7)
    ds.registrar_pago_en_alegra(7)
    r = ds.emitir_a_dian(7)
    assert r["status"] == "success"
    enviado = llamadas["crear"][0]
    assert enviado["retencion_ica"] == 0 and enviado["retencion"] is None
    assert enviado["valor"] == 1_110_730
    assert len(llamadas["pagos"]) == 1
    assert llamadas["pagos"][0]["valor"] == 1_100_000
    assert llamadas["pagos"][0]["retenciones"] == [{"id": 17, "amount": 10_730}]


def test_con_dos_pagos_el_reteica_se_aplica_una_sola_vez(borrador, monkeypatch):
    import json

    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    ds.emitir_por_solicitud(7)
    det = ds.obtener_por_solicitud(7)["detalle"]
    det["pagos"] = [{"fecha": "2026-09-15", "valor": 1_050_000}, {"fecha": "2026-09-16", "valor": 50_000}]
    with cc._conn() as con:
        con.execute("UPDATE cc_doc_soporte SET detalle_json=? WHERE solicitud_id=7", (json.dumps(det),))
    assert ds.emitir_a_dian(7)["status"] == "success"
    assert [p["retenciones"] for p in llamadas["pagos"]] == [[{"id": 17, "amount": 10_730}], None]


def test_no_se_emite_si_el_reteica_no_tiene_su_retencion_en_alegra(borrador, monkeypatch):
    from app.services import alegra as A

    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch)
    monkeypatch.setattr(A, "retencion_ica_alegra_id", lambda por_mil: A.ALEGRA_RETENCION_ICA_ID)
    ds.emitir_por_solicitud(7)
    r = ds.emitir_a_dian(7)
    assert r["status"] == "error" and "ReteICA" in r["message"]
    assert llamadas["crear"] == []


def test_el_pago_a_alegra_lleva_las_retenciones_en_el_documento_pagado():
    """Estructura del pago: bills[].retentions, solo si hay."""
    import requests

    from app.services import alegra as A

    enviados = []

    class _R:
        status_code = 201

        def json(self):
            return {"id": "P9"}

    orig = requests.post
    requests.post = lambda url, **kw: enviados.append(kw["json"]) or _R()
    try:
        A.registrar_pago_documento_soporte(bill_id="2", fecha="2026-09-21", valor=1_200_000,
                                           retenciones=[{"id": 16, "amount": 10_483}])
        A.registrar_pago_documento_soporte(bill_id="2", fecha="2026-09-21", valor=5)
    finally:
        requests.post = orig
    assert enviados[0]["bills"] == [{"id": "2", "amount": 1_200_000, "retentions": [{"id": 16, "amount": 10_483}]}]
    assert "retentions" not in enviados[1]["bills"][0]


def test_no_se_emite_a_un_contacto_sin_pais(borrador, monkeypatch):
    """Sin país la DIAN no recibe el documento y Alegra solo dice «problema de comunicación» (3051)."""
    ds, _ = borrador
    llamadas = _alegra_falso(monkeypatch, pais=None)
    ds.emitir_por_solicitud(7)
    r = ds.emitir_a_dian(7)
    assert r["status"] == "error" and "país" in r["message"]
    assert llamadas["crear"] == []
