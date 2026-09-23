"""Respuesta automática a la cuenta de cobro del contador (cuenta_cobro_contador.py)."""
from __future__ import annotations

import pytest

from app.services import cuenta_cobro_contador as ccc

COBRO = {
    "proveedor": "william",
    "periodo": "2026-09",
    "monto": 1210483.0,
    "email_date": "2026-10-03",
    "subject": "CUENTA DE COBRO SEPTIEMBRE",
    "filename": "CUENTA DE COBRO SEPTIEMBRE 2026.pdf",
    "from": "William Fernando Novoa Molano <williamfer94@hotmail.com>",
    "message_id": "<abc@outlook.com>",
}


def _sol(id_, estado="pagada", monto=1210483.0, periodo="", origen_ref="", pagado_at="2026-10-04 10:00:00",
         movimiento_id=None, retencion_ica=10483.0):
    return {"id": id_, "estado": estado, "monto": monto, "fecha": pagado_at[:10], "periodo": periodo,
            "retencion": 0.0, "retencion_ica": retencion_ica,
            "origen_ref": origen_ref, "categoria": "servicios", "cuenta_debito": "511035",
            "medio_pago_id": 3, "pagado_at": pagado_at if estado == "pagada" else None,
            "movimiento_id": movimiento_id}


def test_pago_por_periodo_manda_sobre_el_valor():
    sols = [_sol(1, monto=1210483.0), _sol(2, monto=999.0, periodo="2026-09")]
    assert ccc.buscar_pago(COBRO, sols, set())["id"] == 2


def test_pago_por_origen_ref_del_borrador():
    sols = [_sol(5, monto=1.0, origen_ref="contador:2026-09")]
    assert ccc.buscar_pago(COBRO, sols, set())["id"] == 5


def test_pago_anticipado_cuenta():
    """A William se le pagó el 21-sep, antes de que mandara la cuenta de cobro."""
    anticipado = _sol(38, pagado_at="2026-09-21 21:20:55")
    assert ccc.buscar_pago(COBRO, [anticipado], set())["id"] == 38


def test_cuenta_de_cobro_por_lo_girado_libre_es_el_mismo_pago():
    """Se le giran $1.200.000 libres; el documento soporte sale por $1.210.483 (ReteICA asumido)."""
    pago = _sol(38, pagado_at="2026-09-21 21:20:55")
    assert ccc.buscar_pago({**COBRO, "monto": 1200000.0}, [pago], set())["id"] == 38
    assert ccc.buscar_pago({**COBRO, "monto": 1210483.0}, [pago], set())["id"] == 38
    assert ccc.buscar_pago({**COBRO, "monto": 1150000.0}, [pago], set()) is None


def test_borrador_se_monta_por_lo_girado_no_por_el_bruto():
    """El asistente suma el ReteICA encima: con el bruto lo contaría dos veces ($1.221.057)."""
    ultimo = _sol(38)
    assert ccc.monto_a_girar({**COBRO, "monto": 1210483.0}, ultimo) == 1200000.0
    assert ccc.monto_a_girar({**COBRO, "monto": 1200000.0}, ultimo) == 1200000.0
    assert ccc.monto_a_girar({**COBRO, "monto": 1300000.0}, None) == 1300000.0


def test_pago_por_valor_solo_si_es_reciente_y_no_usado():
    viejo = _sol(1, pagado_at="2026-07-01 10:00:00")
    assert ccc.buscar_pago(COBRO, [viejo], set()) is None
    reciente = _sol(2)
    assert ccc.buscar_pago(COBRO, [reciente], set())["id"] == 2
    assert ccc.buscar_pago(COBRO, [reciente], {2}) is None


def test_pago_de_otro_periodo_no_cuenta_aunque_valga_lo_mismo():
    assert ccc.buscar_pago(COBRO, [_sol(3, periodo="2026-10")], set()) is None


def test_solicitud_sin_pagar_no_es_pago():
    assert ccc.buscar_pago(COBRO, [_sol(4, estado="aprobada", periodo="2026-09")], set()) is None


@pytest.fixture
def entorno(monkeypatch, tmp_path):
    monkeypatch.setattr(ccc, "ESTADO_PATH", tmp_path / "estado.json")
    monkeypatch.setattr(ccc, "_LOCK_PATH", tmp_path / "procesar.lock")
    monkeypatch.setenv("CONTADOR_COBRO_RESPUESTA_DESDE", "2026-09-23")
    monkeypatch.setenv("CONTADOR_COBRO_RESPUESTA_ACTIVO", "1")
    import app.services.cuentas_cobro_correo as correo

    viejo = {**COBRO, "periodo": "2026-08", "email_date": "2026-09-04", "message_id": "<viejo@x>"}
    monkeypatch.setattr(correo, "cargar_cobros", lambda: [viejo, COBRO])
    monkeypatch.setattr(ccc, "tercero_contador", lambda: {"id": 50, "nombre": "WILLIAM FERNANDO NOVOA MOLANO"})
    enviados, tickets = [], []
    monkeypatch.setattr(ccc, "_enviar_respuesta", lambda cobro, *a: enviados.append((cobro, a)))
    monkeypatch.setattr(ccc, "_montar_borrador", lambda *a: 77)
    monkeypatch.setattr(ccc, "_crear_ticket", lambda cobro, b, e: tickets.append((cobro, b, e)) or 900)
    bill = {"numberTemplate": {"fullNumber": "DSMG9"}, "total": 1210483, "stamp": {},
            "retentions": [{"name": "ReteICA", "amount": 10483}],
            "payments": [{"date": "2026-10-04", "amount": 1200000}], "provider": {}}
    monkeypatch.setattr(ccc, "_bill_alegra", lambda _id: (bill, b"<?xml version='1.0'?><x/>"))
    return {"enviados": enviados, "tickets": tickets}


def test_sin_pagar_crea_ticket_una_vez_y_luego_responde(entorno, monkeypatch):
    sols: list[dict] = []
    monkeypatch.setattr(ccc, "_solicitudes_del_contador", lambda _t: sols)
    monkeypatch.setattr(ccc, "_documento_emitido", lambda _sid: {"alegra_id": "9", "numero": "DSMG9"})

    r = ccc.procesar(releer_gmail=False)
    assert [a["accion"] for a in r] == ["ticket_creado"]      # la de agosto es anterior a DESDE
    assert entorno["tickets"][0][1] == 77

    r = ccc.procesar(releer_gmail=False)
    assert [a["accion"] for a in r] == ["sin_pagar_con_ticket"]
    assert len(entorno["tickets"]) == 1

    sols.append(_sol(12, origen_ref="contador:2026-09"))
    r = ccc.procesar(releer_gmail=False)
    assert [a["accion"] for a in r] == ["soporte_enviado"]
    cobro, (asunto, texto, _html, adjuntos, _captura) = entorno["enviados"][0]
    assert cobro["message_id"] == "<abc@outlook.com>"
    assert asunto == "RE: CUENTA DE COBRO SEPTIEMBRE"
    assert "$1.200.000" in texto and "DSMG9" in texto
    assert "le giramos $1.200.000 libres" in texto and "no tiene campo para" in texto
    assert [n for n, _m, _d in adjuntos] == ["Documento_soporte_DSMG9.pdf", "Documento_soporte_DSMG9.xml"]
    assert adjuntos[0][2].startswith(b"%PDF")

    assert ccc.procesar(releer_gmail=False) == []             # ya respondida: no se repite
    assert len(entorno["enviados"]) == 1


def test_pagado_sin_documento_emitido_espera(entorno, monkeypatch):
    monkeypatch.setattr(ccc, "_solicitudes_del_contador", lambda _t: [_sol(12, periodo="2026-09")])
    monkeypatch.setattr(ccc, "_documento_emitido", lambda _sid: None)
    r = ccc.procesar(releer_gmail=False)
    assert [a["accion"] for a in r] == ["esperando_documento"]
    assert entorno["enviados"] == [] and entorno["tickets"] == []


def test_apagado_solo_informa(entorno, monkeypatch):
    monkeypatch.setenv("CONTADOR_COBRO_RESPUESTA_ACTIVO", "0")
    monkeypatch.setattr(ccc, "_solicitudes_del_contador", lambda _t: [])
    r = ccc.procesar(releer_gmail=False)
    assert [a["accion"] for a in r] == ["crearia_ticket"]
    assert entorno["tickets"] == [] and not ccc.ESTADO_PATH.exists()


def test_con_asiento_va_un_solo_expediente_y_sus_paginas_en_el_cuerpo(entorno, monkeypatch):
    from app.tools import comprobante_contable as cc_pdf
    from app.tools import expediente_pago

    monkeypatch.setattr(ccc, "_solicitudes_del_contador",
                        lambda _t: [_sol(38, pagado_at="2026-09-21 21:20:55", movimiento_id=5590)])
    monkeypatch.setattr(ccc, "_documento_emitido", lambda _sid: {"alegra_id": "2", "numero": "DSMG2"})
    monkeypatch.setattr(expediente_pago, "generar", lambda **kw: b"%PDF-expediente")
    monkeypatch.setattr(cc_pdf, "pdf_a_png", lambda pdf, pagina=1: f"PNG{pagina}".encode())
    r = ccc.procesar(releer_gmail=False)
    assert [a["accion"] for a in r] == ["soporte_enviado"]
    _cobro, (_asunto, texto, html, adjuntos, capturas) = entorno["enviados"][0]
    assert capturas == [b"PNG1", b"PNG2"]
    assert 'src="cid:comprobante-contable-1"' in html and 'src="cid:comprobante-contable-2"' in html
    assert "asiento N.º 5590" in texto and "Alegra" in texto and "DIAN" in texto
    assert [n for n, _m, _d in adjuntos] == ["Soporte_pago_honorarios_2026-09.pdf", "Documento_soporte_DSMG9.xml"]


def test_dian_se_lee_del_xml_sin_retenciones():
    """El documento soporte no discrimina el ICA: la DIAN solo ve el valor total."""
    from app.tools.expediente_pago import datos_dian

    xml = (b'<?xml version="1.0"?><Invoice><cbc:IssueDate>2026-09-21</cbc:IssueDate>'
           b'<cbc:PayableAmount currencyID="COP">1210483.00</cbc:PayableAmount></Invoice>')
    d = datos_dian(xml, {"stamp": {"cude": "abc", "legalStatus": "STAMPED_AND_ACCEPTED"}})
    assert d["valor"] == 1210483.0 and d["retenciones"] == 0 and d["cuds"] == "abc"


def test_dos_corridas_a_la_vez_no_responden_dos_veces(entorno, monkeypatch, tmp_path):
    import fcntl

    monkeypatch.setattr(ccc, "_LOCK_PATH", tmp_path / "lock")
    with open(tmp_path / "lock", "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        assert ccc.procesar(releer_gmail=False)[0]["accion"] == "ocupado"
    assert entorno["enviados"] == [] and entorno["tickets"] == []


def test_efecto_neto_alegra_deja_la_cuenta_por_pagar_en_cero():
    """Alegra causa contra 22050501 y el egreso la cancela: el neto es el asiento del Libro Mayor."""
    from app.tools import comprobante_contable as cc_pdf
    from app.tools.expediente_pago import efecto_neto_alegra

    al = {"numero": "DSMG2", "fecha": "2026-09-21", "total": 1210483.0, "proveedor": "WILLIAM",
          "cxp": {"code": "22050501", "name": "Cuentas por pagar a proveedores nacionales"},
          "gasto": [{"code": "511035", "name": "Asesoría técnica", "valor": 1210483.0}],
          "retenciones": [{"name": "ReteICA 8,66", "valor": 10483.0}],
          "pagos": [{"fecha": "2026-09-21", "valor": 1200000.0, "banco": "Banco 1"}]}
    partes = efecto_neto_alegra(al, None, cc_pdf.estilos(), 500)
    tabla = partes[2]
    codigos = [str(fila[0].text) for fila in tabla._cellvalues[1:-1]]
    assert "22050501" not in codigos                      # el puente no aparece en el neto
    nota = partes[-1].text
    assert "el mismo día" in nota and "Saldo $0" in nota

    parcial = {**al, "pagos": [{"fecha": "2026-09-25", "valor": 700000.0, "banco": "Banco 1"}]}
    nota = efecto_neto_alegra(parcial, None, cc_pdf.estilos(), 500)[-1].text
    assert "Queda un saldo de $500.000" in nota
