"""Perfil tributario de proveedores leído de sus facturas electrónicas.

Lo que protegen: que el XML se use como **pista con evidencia** y no como
verdad. El emisor escribe sus propias responsabilidades y puede equivocarse —
DUQUE SALDARRIAGA se declara Régimen SIMPLE en 10 de sus 64 facturas y es
régimen común autorretenedor.
"""
from __future__ import annotations

import pytest

FACTURA = """<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"
                  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
 <cbc:ID>ad-1</cbc:ID>
 <cac:Attachment xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cac:ExternalReference><cbc:Description>&lt;Invoice
   xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
   xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"&gt;
   &lt;cbc:ID&gt;{numero}&lt;/cbc:ID&gt;
   &lt;cbc:IssueDate&gt;{fecha}&lt;/cbc:IssueDate&gt;
   &lt;cac:AccountingSupplierParty&gt;
    &lt;cac:Party&gt;
     &lt;cac:PartyTaxScheme&gt;
      &lt;cbc:RegistrationName&gt;{nombre}&lt;/cbc:RegistrationName&gt;
      &lt;cbc:CompanyID schemeName="31"&gt;{nit}&lt;/cbc:CompanyID&gt;
      &lt;cbc:TaxLevelCode listName="No aplica"&gt;{resp}&lt;/cbc:TaxLevelCode&gt;
     &lt;/cac:PartyTaxScheme&gt;
    &lt;/cac:Party&gt;
   &lt;/cac:AccountingSupplierParty&gt;
   &lt;cac:AccountingCustomerParty&gt;
    &lt;cac:Party&gt;&lt;cac:PartyTaxScheme&gt;
     &lt;cbc:RegistrationName&gt;MCKENNA GROUP S.A.S&lt;/cbc:RegistrationName&gt;
     &lt;cbc:CompanyID schemeName="31"&gt;901316016&lt;/cbc:CompanyID&gt;
     &lt;cbc:TaxLevelCode&gt;O-23&lt;/cbc:TaxLevelCode&gt;
    &lt;/cac:PartyTaxScheme&gt;&lt;/cac:Party&gt;
   &lt;/cac:AccountingCustomerParty&gt;
   &lt;cac:LegalMonetaryTotal&gt;&lt;cbc:PayableAmount currencyID="COP"&gt;{total}&lt;/cbc:PayableAmount&gt;&lt;/cac:LegalMonetaryTotal&gt;
  &lt;/Invoice&gt;</cbc:Description></cac:ExternalReference>
 </cac:Attachment>
</AttachedDocument>
"""


def _escribir(carpeta, nit, nombre, resp, *, numero="FE1", fecha="2026-05-01", total="100000.00"):
    ruta = carpeta / f"{nit}_{numero}.xml"
    ruta.write_text(FACTURA.format(nit=nit, nombre=nombre, resp=resp,
                                   numero=numero, fecha=fecha, total=total), encoding="utf8")
    return str(ruta)


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    from app.services import perfil_tributario_dian as ptd

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    xmls = tmp_path / "xml"
    xmls.mkdir()
    monkeypatch.setattr(ptd, "_CARPETA_XML", str(xmls))
    ptd._ensure()
    return cc, ptd, xmls


# ─── 1. Extractor ──────────────────────────────────────────────────────────

def test_lee_el_emisor_de_dentro_del_sobre(mods):
    """La factura viaja embebida y escapada dentro del AttachedDocument. Leer el
    sobre sin abrirlo devuelve los datos de la DIAN, no los del proveedor."""
    _cc, ptd, xmls = mods
    ruta = _escribir(xmls, "830062441", "ENVASAR S A S", "O-47")
    d = ptd.leer_xml(ruta)
    assert d["nit"] == "830062441"
    assert d["nombre"] == "ENVASAR S A S"
    assert d["responsabilidades"] == ["O-47"]
    assert d["total"] == pytest.approx(100000)


def test_no_confunde_al_emisor_con_mckenna(mods):
    """El XML trae DOS PartyTaxScheme: el del proveedor y el de McKenna. Tomar el
    equivocado le atribuiría al proveedor las responsabilidades de McKenna."""
    _cc, ptd, xmls = mods
    d = ptd.leer_xml(_escribir(xmls, "800251569", "INTER RAPIDISIMO S.A", "O-13;O-15"))
    assert d["nit"] == "800251569"
    assert "O-23" not in d["responsabilidades"]   # O-23 es de McKenna
    assert sorted(d["responsabilidades"]) == ["O-13", "O-15"]


def test_separa_las_responsabilidades_del_punto_y_coma(mods):
    _cc, ptd, xmls = mods
    d = ptd.leer_xml(_escribir(xmls, "900000001", "X", "O-13; O-15 ;O-23"))
    assert sorted(d["responsabilidades"]) == ["O-13", "O-15", "O-23"]


def test_el_escaneo_es_incremental(mods):
    _cc, ptd, xmls = mods
    _escribir(xmls, "900000002", "UNO", "O-15", numero="FE1")
    r1 = ptd.escanear()
    assert r1["leidos"] == 1
    _escribir(xmls, "900000002", "UNO", "O-15", numero="FE2")
    r2 = ptd.escanear()
    assert r2["leidos"] == 1 and r2["ya_conocidos"] == 1
    assert ptd.perfiles()[0]["facturas"] == 2


def test_un_archivo_que_no_es_factura_no_rompe_el_escaneo(mods):
    _cc, ptd, xmls = mods
    (xmls / "basura.xml").write_text("<hola/>", encoding="utf8")
    _escribir(xmls, "900000003", "BUENA", "O-47")
    r = ptd.escanear()
    assert r["leidos"] == 1 and r["sin_factura"] == 1


# ─── 2. Perfilador ─────────────────────────────────────────────────────────

def test_propone_con_la_proporcion_a_la_vista(mods):
    """«10 de 64» es la señal que permite dudar; «es SIMPLE» a secas, no."""
    cc, ptd, xmls = mods
    cc.crear_tercero({"nombre": "ENVASAR S A S", "tipo": "proveedor",
                      "identificacion": "830062441", "tipo_persona": "juridica"})
    for i in range(3):
        _escribir(xmls, "830062441", "ENVASAR S A S", "O-47", numero=f"A{i}")
    for i in range(7):
        _escribir(xmls, "830062441", "ENVASAR S A S", "R-99-PN", numero=f"B{i}")
    ptd.escanear()
    p = ptd.proponer()[0]
    assert p["cambios"] == {"regimen_simple": 1}
    assert "3 de 10 facturas" in p["motivo"]
    assert "DUQUE" in p["advertencia"]       # la advertencia viaja en cada propuesta


def test_no_aplica_nada_por_su_cuenta(mods):
    """El caso Duque: el XML dice SIMPLE y es falso. `proponer()` no escribe."""
    cc, ptd, xmls = mods
    t = cc.crear_tercero({"nombre": "DUQUE SALDARRIAGA Y CIA S.A.S", "tipo": "proveedor",
                          "identificacion": "860508007", "tipo_persona": "juridica"})
    _escribir(xmls, "860508007", "DUQUE SALDARRIAGA Y CIA S.A.S", "O-47")
    ptd.escanear()
    assert ptd.proponer()
    assert int(cc.obtener_tercero(t["id"])["regimen_simple"]) == 0


def test_aplicar_deja_constancia_de_quien_y_por_que(mods):
    cc, ptd, xmls = mods
    t = cc.crear_tercero({"nombre": "DUQUE SALDARRIAGA Y CIA S.A.S", "tipo": "proveedor",
                          "identificacion": "860508007", "tipo_persona": "juridica"})
    _escribir(xmls, "860508007", "DUQUE", "O-47")
    ptd.escanear()
    # Lo que el usuario confirmó NO es lo que dice el XML.
    ptd.aplicar("860508007", {"retefuente_exento": 1}, por="Armando",
                nota="régimen común autorretenedor")
    ficha = cc.obtener_tercero(t["id"])
    assert int(ficha["retefuente_exento"]) == 1
    assert int(ficha["regimen_simple"]) == 0
    assert "Armando" in ficha["notas"] and "autorretenedor" in ficha["notas"]


def test_aplicar_solo_toca_las_dos_banderas_tributarias(mods):
    cc, ptd, _x = mods
    cc.crear_tercero({"nombre": "X", "tipo": "proveedor", "identificacion": "900000009"})
    with pytest.raises(ValueError, match="solo se aceptan"):
        ptd.aplicar("900000009", {"nombre": "OTRO", "ica_por_mil": 99})


def test_avisa_cuando_la_ficha_y_el_xml_se_contradicen(mods):
    """Si la ficha dice SIMPLE y ninguna factura lo dice, una de las dos está mal.
    No se desmarca sola —el XML no es autoritativo— pero se avisa."""
    cc, ptd, xmls = mods
    t = cc.crear_tercero({"nombre": "DUDOSO SAS", "tipo": "proveedor", "identificacion": "900000004"})
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET regimen_simple=1 WHERE id=?", (t["id"],))
    for i in range(4):
        _escribir(xmls, "900000004", "DUDOSO SAS", "R-99-PN", numero=f"C{i}")
    ptd.escanear()
    p = next(x for x in ptd.proponer() if x["nit"] == "900000004")
    assert p["contradiccion"]
    assert p["cambios"] == {}                      # avisa, no desmarca


def test_quien_no_factura_electronicamente_no_aparece(mods):
    """Una cuenta de cobro del Art. 616-2 no es documento electrónico. Es el caso
    de la mensajería de Fidel Rocha: cero facturas en 2.235 XML."""
    cc, ptd, xmls = mods
    cc.crear_tercero({"nombre": "FIDEL ROCHA MORON", "tipo": "proveedor",
                      "identificacion": "9385573", "tipo_persona": "natural"})
    _escribir(xmls, "800251569", "INTER RAPIDISIMO S.A", "O-13;O-15")
    ptd.escanear()
    assert all(p["nit"] != "9385573" for p in ptd.perfiles())
    assert all(p["nit"] != "9385573" for p in ptd.proponer())


# ─── Descartes: que la lista converja ──────────────────────────────────────

def test_lo_descartado_no_vuelve_a_aparecer(mods):
    """Una lista que no converge deja de leerse, y ahí se vuelve invisible lo
    que sí importa."""
    cc, ptd, xmls = mods
    cc.crear_tercero({"nombre": "DUQUE SALDARRIAGA Y CIA S.A.S", "tipo": "proveedor",
                      "identificacion": "860508007", "tipo_persona": "juridica"})
    for i in range(3):
        _escribir(xmls, "860508007", "DUQUE", "O-47", numero=f"D{i}")
    ptd.escanear()
    assert any(p["nit"] == "860508007" for p in ptd.proponer())
    ptd.descartar("860508007", "regimen_simple", por="Armando",
                  motivo="Es régimen común autorretenedor; su O-47 es un error del emisor")
    assert all(p["nit"] != "860508007" for p in ptd.proponer())


def test_si_la_evidencia_se_duplica_la_propuesta_vuelve(mods):
    """El «no» fue sobre la evidencia de entonces, no sobre el proveedor para
    siempre: con 3 facturas es un error de digitación, con 60 es otra cosa."""
    cc, ptd, xmls = mods
    cc.crear_tercero({"nombre": "ENVASAR S A S", "tipo": "proveedor",
                      "identificacion": "830062441", "tipo_persona": "juridica"})
    for i in range(3):
        _escribir(xmls, "830062441", "ENVASAR", "O-47", numero=f"E{i}")
    ptd.escanear()
    ptd.descartar("830062441", "regimen_simple", motivo="parece error del emisor")
    assert all(p["nit"] != "830062441" for p in ptd.proponer())
    for i in range(10):
        _escribir(xmls, "830062441", "ENVASAR", "O-47", numero=f"F{i}")
    ptd.escanear()
    assert any(p["nit"] == "830062441" for p in ptd.proponer())


def test_un_descarte_sin_motivo_no_le_sirve_a_nadie(mods):
    _cc, ptd, _x = mods
    with pytest.raises(ValueError, match="motivo"):
        ptd.descartar("860508007", "regimen_simple", motivo="  ")
