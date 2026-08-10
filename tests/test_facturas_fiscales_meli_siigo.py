from __future__ import annotations

import base64


XML_DIAN_MINIMO = b"""<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument>
  <Attachment>
    <ExternalReference>
      <Description><![CDATA[
        <Invoice>
          <ID>FE123</ID>
        </Invoice>
      ]]></Description>
    </ExternalReference>
  </Attachment>
</AttachedDocument>
"""


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def test_siigo_rechaza_xml_base64_vacio(monkeypatch):
    from app.services import siigo

    monkeypatch.setattr(siigo, "descargar_factura_pdf_siigo", lambda _id: "❌ Error")
    monkeypatch.setattr(siigo, "descargar_xml_factura_siigo", lambda _id: _b64(b"   "))

    assert siigo.obtener_documento_fiscal_siigo_para_meli("inv-1") == ("", "")


def test_siigo_acepta_xml_fiscal_valido(monkeypatch):
    from app.services import siigo

    xml_b64 = _b64(XML_DIAN_MINIMO)
    monkeypatch.setattr(siigo, "descargar_factura_pdf_siigo", lambda _id: "❌ Error")
    monkeypatch.setattr(siigo, "descargar_xml_factura_siigo", lambda _id: xml_b64)

    doc, fmt = siigo.obtener_documento_fiscal_siigo_para_meli("inv-2")

    assert fmt == "pdf"
    assert base64.b64decode(doc).lstrip().startswith(b"%PDF")


def test_meli_no_sube_xml_invalido_sin_pedir_token(monkeypatch):
    from app.services import meli

    def fail_token():
        raise AssertionError("No debe pedir token con documento fiscal invalido")

    monkeypatch.setattr(meli, "refrescar_token_meli", fail_token)

    resultado = meli.subir_factura_meli("200000000000", _b64(b"<xml></xml>"), formato="xml")

    assert "inválido" in resultado or "invalido" in resultado
