"""NIT, documento y soporte por asiento: la llave con la que el contador cruza contra la DIAN.

27-sep-2026: los CSV del Libro Mayor no traían ni NIT ni número de factura en columna propia
(estaban enterrados en `referencia`) y solo 30 de 1.574 asientos de septiembre tenían el
soporte adjunto. Ver app/services/contabilidad_documentos.py.
"""
from __future__ import annotations

import pytest
from flask import Flask

from app import spa_sesion
from app.services import contabilidad_documentos as cd


def test_compra_con_nit_y_numero_en_la_referencia():
    d = cd.documento_de_asiento({"referencia": "compra:901567417:FECC1129", "concepto": "x"})
    assert (d["nit"], d["documento"]) == ("901567417", "FECC1129")


def test_el_nit_del_tercero_manda_sobre_el_de_la_referencia():
    d = cd.documento_de_asiento({"referencia": "compra:901567417:FECC1129",
                                 "tercero_identificacion": "1023877541"})
    assert d["nit"] == "1023877541"


def test_recibos_de_impuestos():
    assert cd.documento_de_asiento({"referencia": "dian:490:4911173603268"})["documento"] == "Recibo 490 4911173603268"


def test_un_uuid_no_es_un_numero_de_factura():
    d = cd.documento_de_asiento({
        "referencia": "auto:1ce679eac6e1569ab30d",
        "plantilla_datos_json": '{"fuente": "siigo_venta", "referencia": "a2cfae5c-9b5c-48e9-89cd-61e433673bb3"}',
    })
    assert d["documento"] == ""


def test_consumidor_final_no_es_un_nit():
    d = cd.documento_de_asiento({"plantilla_datos_json": '{"fuente": "siigo_venta", "referencia": "FV-2-1", "contraparte": "222222222"}'})
    assert d == {"nit": "", "documento": "FV-2-1", "cufe": ""}


def test_la_factura_de_una_solicitud_de_pago():
    d = cd.documento_de_asiento(
        {"plantilla_datos_json": '{"solicitud_id": 7}'},
        solicitudes={7: {"factura_numero": "", "referencia": "compra:800077828:FEE104568"}},
    )
    assert d["documento"] == "FEE104568"


def test_factura_escrita_en_el_concepto():
    d = cd.documento_de_asiento({"concepto": "Pago a proveedor — QUIMICA INTERKROL factura FA272993"})
    assert d["documento"] == "FA272993"


def test_la_venta_meli_toma_la_factura_del_cache(monkeypatch):
    monkeypatch.setattr(cd, "_facturas_de_ventas", lambda: {"2000018601588606": {"numero": "FE887", "cufe": "abc"}})
    d = cd.documento_de_asiento({"plantilla_datos_json":
                                 '{"fuente": "meli_venta", "referencia": "2000015167717787", "extra": {"order_id": "2000018601588606"}}'})
    assert (d["documento"], d["cufe"]) == ("FE887", "abc")


def test_pack_facturado_en_partes_usa_el_primer_soporte_que_exista(tmp_path, monkeypatch):
    monkeypatch.setattr(cd, "_FACTURAS_DIR", tmp_path)
    (tmp_path / "Factura_FE88.pdf").write_bytes(b"%PDF")
    assert cd.soporte_para("", "FE52, FE88").name == "Factura_FE88.pdf"


def test_el_csv_trae_nit_documento_y_soporte():
    from app.services.contabilidad_mayor import extracto_csv

    csv = extracto_csv({
        "cuenta": {"codigo": "519595", "nombre": "Diversos"}, "saldo_inicial": 0,
        "total_debito": 1, "total_credito": 0, "saldo_final": 1,
        "movimientos": [{"fecha": "2026-09-17", "movimiento_id": 5975, "concepto": "c",
                         "tercero_nombre": "P", "nit": "901567417", "documento": "FECC1129",
                         "referencia": "r", "contrapartida": [], "debito": 1, "credito": 0,
                         "saldo": 1, "soporte_url": "https://x/5975"}],
    })
    assert "NIT;Documento" in csv and "901567417;FECC1129" in csv and "https://x/5975" in csv


# ─── El enlace «Soporte» se abre desde Excel con la sesión del navegador ────

CONTADOR = {"id": 9001, "nombre": "Contador", "rol": {"nivel": 1}, "permisos_secciones": {"contador": True}}
VENTAS = {"id": 9002, "nombre": "Ventas", "rol": {"nivel": 1}, "permisos_secciones": {"ventas": True}}


@pytest.fixture()
def cliente(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-sistema")
    from app.routes import register_routes
    from app.services import contabilidad_core, tickets_db

    usuarios = {"s-contador": CONTADOR, "s-ventas": VENTAS}
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda t: usuarios.get(t))
    monkeypatch.setattr(tickets_db, "es_admin_efectivo", lambda u: False, raising=False)
    pdf = tmp_path / "f.pdf"
    pdf.write_bytes(b"%PDF-1.4 prueba")
    monkeypatch.setattr(contabilidad_core, "ruta_comprobante",
                        lambda mid: (str(pdf), "application/pdf", "FECC1129.pdf"))
    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


URL = "/app/api/contabilidad/cc/movimientos/5975/comprobante"


def test_sin_sesion_pide_ingresar(cliente):
    r = cliente.get(URL)
    assert r.status_code == 401 and b"%PDF" not in r.data


def test_el_contador_lo_abre_con_su_sesion(cliente):
    cliente.set_cookie(spa_sesion.COOKIE, "s-contador", path="/app")
    r = cliente.get(URL)
    assert r.status_code == 200 and r.data.startswith(b"%PDF")


def test_quien_no_ve_contabilidad_no_lo_abre(cliente):
    cliente.set_cookie(spa_sesion.COOKIE, "s-ventas", path="/app")
    assert cliente.get(URL).status_code == 403


# ─── 28-sep-2026: bajar de Alegra los PDF que faltan ───────────────────────

def test_la_anulacion_usa_la_nota_credito_no_el_expediente():
    d = cd.documento_de_asiento({"referencia": "ra:RA-2026-0030",
                                 "plantilla_datos_json": '{"expediente": "RA-2026-0030", "nc": "NC145"}'})
    assert d["documento"] == "NC145"


def test_la_nota_credito_se_encuentra_en_disco(tmp_path, monkeypatch):
    monkeypatch.setattr(cd, "_FACTURAS_DIR", tmp_path)
    (tmp_path / "NotaCredito_NC145.pdf").write_bytes(b"%PDF")
    assert cd.soporte_para("", "NC145").name == "NotaCredito_NC145.pdf"


class _Resp:
    def __init__(self, status=200, datos=None, contenido=b""):
        self.status_code, self._d, self.content = status, datos, contenido

    def json(self):
        return self._d


def _alegra_falso(monkeypatch, respuestas):
    import requests

    from app.services import alegra

    monkeypatch.setattr(alegra, "_alegra_headers", lambda: {})
    llamadas = []

    def get(url, **kw):
        llamadas.append(url)
        return respuestas(url, kw)

    monkeypatch.setattr(requests, "get", get)
    return llamadas


def test_no_guarda_el_pdf_si_el_id_es_otro_documento(monkeypatch):
    _alegra_falso(monkeypatch, lambda url, kw: _Resp(datos={
        "numberTemplate": {"prefix": "FE", "number": "311"}, "pdf": "https://cdn/x.pdf"}))
    pdf, motivo = cd._pdf_alegra("invoices", 310, "FE")
    assert pdf is None and "FE311" in motivo


def test_la_nota_credito_se_busca_por_numero_no_por_id(monkeypatch):
    def respuestas(url, kw):
        if url.endswith("/credit-notes"):
            return _Resp(datos=[{"id": "119", "numberTemplate": {"prefix": "NC", "number": "2"}},
                                {"id": "118", "numberTemplate": {"prefix": "NC", "number": "145"}}])
        if url.endswith("/credit-notes/118"):
            return _Resp(datos={"numberTemplate": {"prefix": "NC", "number": "145"}, "pdf": "https://cdn/nc.pdf"})
        return _Resp(contenido=b"%PDF-1.4 nc")

    llamadas = _alegra_falso(monkeypatch, respuestas)
    pdf, _ = cd._pdf_alegra("credit-notes", 145, "NC")
    assert pdf.startswith(b"%PDF") and any(u.endswith("/credit-notes/118") for u in llamadas)
    assert not any(u.endswith("/credit-notes/145") for u in llamadas)
