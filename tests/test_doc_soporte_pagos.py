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
