"""Base de clientes de WhatsApp (app/services/clientes_wa.py) — sin LLM ni red."""

from __future__ import annotations

import pytest

from app.services import clientes_wa as cw


@pytest.fixture(autouse=True)
def db_temporal(tmp_path, monkeypatch):
    monkeypatch.setattr(cw, "_DB", str(tmp_path / "clientes.db"))


def test_upsert_no_pisa_con_vacio_y_registra_fuentes():
    jid = "573001112233@c.us"
    cambios = cw.upsert_cliente(jid, {"nombre": "Ana Pérez", "documento": "52.123.456", "ciudad": "Bogotá"}, fuente="bot_v2")
    assert cambios["nombre"] == "Ana Pérez" and cambios["documento"] == "52123456"
    cw.upsert_cliente(jid, {"nombre": "", "correo": "ana@x.co"}, fuente="chat_humano")
    f = cw.ficha(jid)
    assert f["nombre"] == "Ana Pérez" and f["correo"] == "ana@x.co" and f["tipo_documento"] == "CC"
    assert f["telefono"] == "573001112233" and set(f["fuentes"]) == {"bot_v2", "chat_humano"}


def test_nit_con_dv_invalido_avisa_pero_guarda():
    from app.services.empresa import digito_verificacion

    base = "901316016"
    dv_ok = digito_verificacion(base)
    dv_mal = (dv_ok + 1) % 10
    res = cw.upsert_cliente("573009998877@c.us", {"nombre": "Lab X SAS", "documento": f"{base}-{dv_mal}"}, fuente="bot_v2")
    assert res.get("aviso") and cw.ficha("573009998877@c.us")["documento_valido"] == 0
    res = cw.upsert_cliente("573009998866@c.us", {"nombre": "Lab Y SAS", "documento": f"{base}-{dv_ok}"}, fuente="bot_v2")
    assert "aviso" not in res and cw.ficha("573009998866@c.us")["tipo_documento"] == "NIT"


def test_plantilla_con_etiquetas_y_sin_etiquetas():
    con = cw.extraer_datos_plantilla(
        "**Nombre:** Laura Vanessa Lancheros Barreto\n**CC:** 1000620207\n**Correo:** d.tm@gmail.com\n"
        "**Dirección:** Calle 122 #15A-34, Santa Bárbara, Bogotá D.C.\n**Celular:** 3203116030"
    )
    assert con["nombre"] == "Laura Vanessa Lancheros Barreto" and con["documento"] == "1000620207"
    assert con["correo"] == "d.tm@gmail.com" and con["telefono"] == "3203116030" and "Calle 122" in con["direccion"]

    sin = cw.extraer_datos_plantilla("Angel Quintero \nCra 2A # 55A-38 centauros 1 torre 2 apto 301 \nbarrio los Naranjos \nCel 3192247757\nBucaramanga")
    assert sin["nombre"] == "Angel Quintero" and sin["telefono"] == "3192247757" and sin["direccion"].startswith("Cra 2A")
    assert sin["ciudad"] == "Bucaramanga"

    cc_suelta = cw.extraer_datos_plantilla("Juan Camilo Hincapie \n98648479\nCallé 74 # 50B-56\nMedellín \n3053205135\nLab.biogest@gmail.com")
    assert cc_suelta["documento"] == "98648479" and cc_suelta["correo"] == "Lab.biogest@gmail.com" and cc_suelta["ciudad"] == "Medellín"

    # Un mensaje cualquiera no es una plantilla.
    assert cw.extraer_datos_plantilla("Hola buenas tardes, quisiera saber si tienen creatina de 500 gramos") == {}
    assert cw.extraer_datos_plantilla("Cc 91.541.803") == {}


def test_interes_compra_e_intencion():
    jid = "573005556677@c.us"
    cw.registrar_interes(jid, ["c-cremon500g", "C-VITE30mL"], fuente="bot_v2")
    cw.registrar_interes(jid, ["C-VITE30mL"], fuente="bot_v2")
    assert cw.ficha(jid)["productos_interes"] == ["C-VITE30ML", "C-CREMON500G"]
    cw.registrar_compra(jid, plataforma="whatsapp", total=82106, order_id="463")
    f = cw.ficha(jid)
    assert f["total_compras"] == 1 and f["valor_total"] == 82106 and f["compras"][0]["order_id"] == "463"
    assert cw.intencion_de_turno(["buscar_producto", "actualizar_pedido"], None) == "cotizacion"
    assert cw.intencion_de_turno(["buscar_producto", "pasar_a_asesor"], "pedido_listo") == "pedido_listo"
    assert cw.intencion_de_turno([], None, "Hola buenas tardes") == "saludo"
    assert cw.intencion_de_turno([], None, "por dónde viene mi guía?") == "seguimiento"
    cw.registrar_interaccion(jid, canal="whatsapp", intencion="cotizacion", productos=["C-CREMON500G"])
    assert cw.ficha(jid)["interacciones"][0]["intencion"] == "cotizacion"
    assert cw.listar(q="5556677")[0]["numero_wa"] == "573005556677"
