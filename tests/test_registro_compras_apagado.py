"""El registro de facturas de compra quedó apagado (18-sep-2026).

Una compra se contabiliza **antes** de pagarla, desde Contabilidad →
Solicitudes de pago → Productos, con la cotización del proveedor. Registrarla
otra vez cuando llega la factura la contaría dos veces, y es el orden al revés:
el documento llega después de que la plata ya se comprometió.

Lo que estos tests protegen sobre todo es la parte que NO se apagó.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def apagado(monkeypatch):
    monkeypatch.delenv("FACTURAS_COMPRA_REGISTRO_ACTIVO", raising=False)


def test_el_registro_esta_apagado_por_defecto():
    from app.tools.sincronizar_facturas_de_compra_siigo import registro_compras_activo

    assert registro_compras_activo() is False


@pytest.mark.parametrize("valor, espera", [("1", True), ("true", True), ("0", False), ("", False)])
def test_la_bandera_lo_vuelve_a_encender(monkeypatch, valor, espera):
    from app.tools.sincronizar_facturas_de_compra_siigo import registro_compras_activo

    monkeypatch.setenv("FACTURAS_COMPRA_REGISTRO_ACTIVO", valor)
    assert registro_compras_activo() is espera


def test_no_registra_pero_SI_descarga_los_xml(monkeypatch):
    """La mitad que sigue viva, y no es opcional: esos XML son la fuente de
    `perfil_tributario_dian`, que saca de `cbc:TaxLevelCode` quién es
    autorretenedor (O-15) y quién está en el Régimen SIMPLE (O-47) — el dato
    que decide cuánto se le retiene a cada proveedor. Apagar el módulo entero
    habría dejado ese perfil congelado sin que nadie lo notara.
    """
    import app.tools.sincronizar_facturas_de_compra_siigo as m

    llamadas = {"descarga": 0, "registro": 0}
    monkeypatch.setattr(m, "descargar_xml_facturas_compra",
                        lambda **kw: (llamadas.__setitem__("descarga", llamadas["descarga"] + 1),
                                      {"descargados": 3, "revisados": 5})[1])
    monkeypatch.setattr(m, "crear_factura_compra_siigo",
                        lambda *a, **k: llamadas.__setitem__("registro", llamadas["registro"] + 1))

    r = m.sincronizar_facturas_de_compra_siigo()
    assert r["status"] == "desactivado"
    assert llamadas["descarga"] == 1
    assert llamadas["registro"] == 0
    assert r["descargados"] == 3


def test_los_comandos_inv_de_whatsapp_no_registran():
    from app.tools.importar_productos_siigo import procesar_respuesta_factura_compra

    for comando in ("ok", "inventario", "gasto"):
        r = procesar_respuesta_factura_compra(comando, "1234")
        assert "apagado" in r.lower(), comando
        assert "Solicitudes de pago" in r


def test_inv_skip_sigue_vivo_para_limpiar_la_cola(monkeypatch):
    """Quedaron facturas encoladas de antes. Si `skip` también se bloqueara, la
    cola no se podría vaciar nunca y seguiría avisando por WhatsApp."""
    import app.tools.importar_productos_siigo as m

    r = m.procesar_respuesta_factura_compra("skip", "no-existe-1234")
    assert "apagado" not in r.lower()
