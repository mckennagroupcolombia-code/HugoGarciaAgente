"""Agente de ventas WA v2 — pruebas sin LLM (cliente Claude simulado)."""

from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from app.agent.ventas_wa import catalogo as cat_mod
from app.agent.ventas_wa import entrada
from app.agent.ventas_wa import herramientas as hz
from app.agent.ventas_wa import historial as hist
from app.agent.ventas_wa import pedido as ped_mod

CACHE = {
    "sections": [
        {
            "name": "Ceras y Mantecas",
            "products": [
                {
                    "name": "Manteca Karite Amarilla",
                    "ref": "C-MANKARAMA250g",
                    "precio_num": 51810,
                    "is_family": True,
                    "cat": "Ceras y Mantecas",
                    "ficha": {"secciones": [{"titulo": "USOS", "items": ["Emoliente para cremas."]}]},
                    "combos": [
                        {"name": "MANTECA KARITE AMARILLA 250g", "ref": "C-MANKARAMA250g", "precio_num": 51810, "stock": 10},
                        {"name": "MANTECA KARITE AMARILLA 500g", "ref": "C-MANKARAMA500g", "precio_num": 107100, "stock": 0},
                        {"name": "MANTECA KARITE AMARILLA KG", "ref": "C-MANKARAMAKg", "precio_num": 167400, "stock": 1},
                    ],
                }
            ],
        },
        {
            "name": "Nutrición",
            "products": [
                {"name": "CREATINA MONOHIDRATO 500g", "ref": "C-CREMON500g", "precio_num": 41053, "stock": 6},
                {"name": "CREATINA MONOHIDRATO 1000g", "ref": "C-CREMON1000g", "precio_num": 65700, "stock": 2},
                {"name": "ALULOSA KG (COPIA)", "ref": "C-ACISORKG", "precio_num": 47610, "stock": 3},
                {"name": "VITAMINA E 30mL", "ref": "C-VITE30mL", "precio_num": 15000, "stock": 4},
                {"name": "VITAMINA C ACIDO ASCORBICO 250g", "ref": "C-VITC250g", "precio_num": 12150, "stock": 9},
            ],
        },
    ],
    "combos": [],
}


@pytest.fixture
def catalogo(monkeypatch):
    c = cat_mod.construir_desde_dict(CACHE, {"C-CREMON1000G": 5})
    monkeypatch.setattr(cat_mod, "cargar", lambda: c)
    return c


@pytest.fixture(autouse=True)
def sin_envios_reales(monkeypatch):
    """Ninguna prueba puede mandar WhatsApp de verdad (ni por :3000 ni por el supervisor :3001)."""
    import requests

    def _bloqueado(*a, **kw):
        raise AssertionError("prueba intentó una llamada HTTP real")

    monkeypatch.setattr(requests, "post", _bloqueado)
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **kw: True)


@pytest.fixture(autouse=True)
def db_temporal(tmp_path, monkeypatch):
    # Nunca tocar las bases reales, ni la activa ni la del modo sombra.
    monkeypatch.setattr(ped_mod, "_DB", str(tmp_path / "ventas_wa.db"))
    monkeypatch.setattr(ped_mod, "_DB_SOMBRA", str(tmp_path / "ventas_wa_sombra.db"))
    monkeypatch.setenv("WA_AGENTE_V2", "activo")
    monkeypatch.setenv("WA_V2_SUPERVISOR_IA", "0")  # sin llamadas reales en pruebas


# --- Catálogo -------------------------------------------------------------------------


def test_busqueda_familia_completa_y_stock_web(catalogo):
    r = catalogo.buscar("manteca de karité 250 g")
    assert [p.ref for p in r][0] == "C-MANKARAMA250g"
    assert {p.ref for p in r} == {"C-MANKARAMA250g", "C-MANKARAMA500g", "C-MANKARAMAKg"}
    assert catalogo.obtener("c-cremon1000g").stock == 5  # stock_web.json manda sobre cache.json


def test_producto_inexistente_no_devuelve_vecinos(catalogo):
    assert catalogo.buscar("aceite esencial de bergamota") == []
    assert catalogo.buscar("creatina monohidratada")  # variante morfológica sí encuentra


def test_vitamina_por_letra_y_copias_excluidas(catalogo):
    assert [p.ref for p in catalogo.buscar("vitamina e")] == ["C-VITE30mL"]
    assert catalogo.obtener("C-ACISORKG") is None


# --- Pedido ---------------------------------------------------------------------------


def test_pedido_totales_y_datos_no_se_repiten(catalogo):
    ctx = hz.ContextoTurno(jid="573000000001@c.us", display="+57 300", modo="sombra")
    out, err = hz.ejecutar(ctx, "actualizar_pedido", {"cambios": [{"ref": "C-CREMON500g", "cantidad": 2}]})
    assert not err and "$82.106" in out
    out, _ = hz.ejecutar(ctx, "actualizar_pedido", {"cambios": [{"ref": "C-MANKARAMA500g", "cantidad": 1}]})
    assert "agotado" in out.lower()
    hz.ejecutar(ctx, "guardar_datos_cliente", {"nombre": "Ana Pérez", "documento": "123", "direccion": "Cra 1 # 2-3", "ciudad": "Bogotá"})
    p = ped_mod.activo(ctx.jid)
    assert p.faltantes() == []
    assert p.envio()["costo"] > 0
    # Un pedido nuevo del mismo cliente hereda sus datos.
    p.estado = "cerrado"
    ped_mod.guardar(p)
    assert ped_mod.activo(ctx.jid).cliente["nombre"] == "Ana Pérez"


def test_handoff_no_se_duplica_y_sombra_no_envia(catalogo, monkeypatch):
    enviados = []
    monkeypatch.setattr(hz, "enviar_alerta_asesor", lambda t: enviados.append(t) or True)
    ctx = hz.ContextoTurno(jid="573000000002@c.us", display="+57 300", modo="activo")
    hz.ejecutar(ctx, "actualizar_pedido", {"cambios": [{"ref": "C-CREMON1000g", "cantidad": 1}]})
    hz.ejecutar(ctx, "pasar_a_asesor", {"tipo": "pedido_listo", "resumen_para_asesor": "listo"})
    out, _ = hz.ejecutar(ctx, "pasar_a_asesor", {"tipo": "pedido_listo", "resumen_para_asesor": "listo"})
    assert len(enviados) == 1 and "ya tiene" in out
    assert ped_mod.activo(ctx.jid).estado == "esperando_asesor"

    sombra = hz.ContextoTurno(jid="573000000003@c.us", display="x", modo="sombra")
    hz.ejecutar(sombra, "pasar_a_asesor", {"tipo": "cliente_pide_asesor", "resumen_para_asesor": "x"})
    assert len(enviados) == 1 and sombra.handoff["tipo"] == "cliente_pide_asesor"


# --- Historial y guardas --------------------------------------------------------------


def _m(i, rol, texto, hace_s=0):
    base = {"id": i, "ts": time.time() - hace_s, "texto": texto, "tiene_media": 0, "media_mime": ""}
    if rol == "cliente":
        return {**base, "direccion": "entrada", "enviado_por": "cliente"}
    return {**base, "direccion": "salida", "enviado_por": "humano" if rol == "asesor" else "bot"}


def test_pendientes_y_agrupacion(monkeypatch):
    msgs = [_m(1, "cliente", "hola", 60), _m(2, "hugo", "hola veci", 50), _m(3, "cliente", "creatina", 5), _m(4, "cliente", "precio?", 1)]
    assert [m["id"] for m in hist.pendientes_del_cliente(msgs)] == [3, 4]
    monkeypatch.setattr(hist, "id_por_wa_id", lambda w: {"a": 3, "b": 4}.get(w))
    assert not entrada._debe_responder_este(msgs, "a", None)  # llegó otro después: se agrupa
    assert entrada._debe_responder_este(msgs, "b", None)


def test_bot_se_calla_si_el_asesor_escribio(monkeypatch):
    monkeypatch.setattr("app.services.wa_jid.jids_relacionados", lambda j: {j})
    msgs = [_m(1, "cliente", "hola", 600), _m(2, "asesor", "Buen día, soy Jenniffer", 500), _m(3, "cliente", "gracias", 5)]
    assert entrada.motivo_silencio("573000000004@c.us", msgs) == "asesor_activo"
    viejo = [_m(1, "asesor", "hola", 13 * 3600), _m(2, "cliente", "hola de nuevo", 5)]
    assert entrada.motivo_silencio("573000000004@c.us", viejo) is None
    ped_mod.pausar("573000000004@c.us", 1, "manual")
    assert entrada.motivo_silencio("573000000004@c.us", viejo) == "pausa_manual"


def test_transcripcion_marca_quien_habla():
    t = hist.transcripcion([_m(1, "cliente", "hola"), _m(2, "asesor", "precio 40.500"), _m(3, "hugo", "ok")])
    assert "CLIENTE: hola" in t and "ASESOR (humano): precio 40.500" in t and "HUGO (bot): ok" in t


# --- Bucle del agente con Claude simulado ---------------------------------------------


class _ClaudeFalso:
    """Primero pide buscar_producto, luego responde con texto."""

    def __init__(self):
        self.llamadas = []
        self.messages = self

    def create(self, **kw):
        self.llamadas.append(kw)
        uso = SimpleNamespace(input_tokens=1000, output_tokens=100, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        if len(self.llamadas) == 1:
            bloque = SimpleNamespace(type="tool_use", id="t1", name="buscar_producto", input={"consulta": "creatina"})
            return SimpleNamespace(stop_reason="tool_use", content=[bloque], usage=uso)
        texto = SimpleNamespace(type="text", text="Tenemos **creatina** 500g a $41.053, veci.")
        return SimpleNamespace(stop_reason="end_turn", content=[texto], usage=uso)


def test_bucle_ejecuta_herramienta_y_limpia_formato(catalogo, monkeypatch):
    from app.agent.ventas_wa import agente

    registradas = []
    monkeypatch.setattr("app.services.llm_budget.permitir_llamada", lambda m, contexto="": (True, ""))
    monkeypatch.setattr("app.services.llm_budget.registrar_llamada", lambda m, **kw: registradas.append(kw))
    falso = _ClaudeFalso()
    res = agente.ejecutar_turno("573000000005@c.us", "+57 300", [_m(1, "cliente", "tienen creatina?")], modo="sombra", cliente=falso)
    assert res.herramientas == ["buscar_producto"]
    assert res.respuesta == "Tenemos *creatina* 500g a $41.053, veci."
    assert len(registradas) == 2  # cada llamada pasa por el presupuesto
    resultado = falso.llamadas[1]["messages"][-1]["content"][0]
    assert resultado["type"] == "tool_result" and "C-CREMON500g" in resultado["content"]


def test_sin_presupuesto_no_inventa_y_avisa(catalogo, monkeypatch):
    from app.agent.ventas_wa import agente

    monkeypatch.setattr("app.services.llm_budget.permitir_llamada", lambda m, contexto="": (False, "tope"))
    res = agente.ejecutar_turno("573000000006@c.us", "x", [_m(1, "cliente", "hola")], modo="sombra", cliente=_ClaudeFalso())
    assert "avisé al equipo" in res.respuesta and res.handoff and res.llamadas == 0


def test_filtro_quita_promesas_de_tiempo():
    from app.agent.ventas_wa.agente import limpiar_para_whatsapp

    assert limpiar_para_whatsapp("Ya le avisé a un asesor. En un momento le escriben. ¿Algo más?") == "Ya le avisé a un asesor. ¿Algo más?"
    assert limpiar_para_whatsapp("Listo, ya avisé al equipo; enseguida le confirman.") == "Listo, ya avisé al equipo."
    assert limpiar_para_whatsapp("Precio **$41.053**") == "Precio *$41.053*"


class _ClaudeGuion:
    """Devuelve respuestas de texto en orden (para probar la corrección del supervisor)."""

    def __init__(self, textos):
        self.textos = list(textos)
        self.llamadas = []
        self.messages = self

    def create(self, **kw):
        self.llamadas.append(kw)
        uso = SimpleNamespace(input_tokens=500, output_tokens=50, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=self.textos.pop(0))], usage=uso)


def test_supervisor_reglas_detecta_precio_cuenta_y_repregunta():
    from app.agent.ventas_wa import supervisor as sup

    ev = "C-CREMON500g | CREATINA MONOHIDRATO 500g | $41.053 | stock 6"
    assert sup.revisar_reglas("La creatina 500g vale $41.053, veci.", evidencia=ev, cliente={}).ok
    assert not sup.revisar_reglas("Vale $39.000.", evidencia=ev, cliente={}).ok
    assert not sup.revisar_reglas("Consigne a la cuenta de ahorros 01234567890.", evidencia=ev, cliente={}).ok
    datos = {"nombre": "Doris", "documento": "39619900", "direccion": "Cra 40", "ciudad": "Melgar"}
    assert not sup.revisar_reglas("Regáleme su nombre completo y cédula, por favor.", evidencia=ev, cliente=datos).ok
    assert sup.revisar_reglas("Su cédula 39619900 quedó guardada.", evidencia=ev, cliente=datos).ok


def test_supervisor_corrige_una_vez_y_luego_respaldo(catalogo, monkeypatch):
    from app.agent.ventas_wa import agente

    monkeypatch.setattr("app.services.llm_budget.permitir_llamada", lambda m, contexto="": (True, ""))
    monkeypatch.setattr("app.services.llm_budget.registrar_llamada", lambda m, **kw: None)
    monkeypatch.setattr(hz, "enviar_alerta_asesor", lambda t: True)
    # 1) inventa un precio, 2) corrige sin precio → se envía la corrección.
    g = _ClaudeGuion(["La creatina vale $30.000.", "Con gusto, veci. ¿Qué presentación de creatina busca?"])
    res = agente.ejecutar_turno("573000000007@c.us", "x", [_m(1, "cliente", "creatina?")], cliente=g)
    assert res.respuesta.startswith("Con gusto") and len(res.supervision) == 1 and "[SUPERVISOR" in g.llamadas[1]["messages"][-1]["content"]
    # 1) y 2) inventan → respuesta segura + aviso al equipo, nunca el precio inventado.
    g2 = _ClaudeGuion(["Vale $30.000.", "Vale $31.000."])
    res2 = agente.ejecutar_turno("573000000008@c.us", "x", [_m(1, "cliente", "creatina?")], cliente=g2)
    assert "$3" not in res2.respuesta and res2.error.startswith("supervisor") and res2.handoff


def test_web_carrito_y_continuacion_whatsapp(catalogo, monkeypatch):
    ctx = hz.ContextoTurno(jid="web:abc", display="Visitante web", canal="web")
    hz.ejecutar(ctx, "actualizar_pedido", {"cambios": [{"ref": "C-CREMON500g", "cantidad": 2}]})
    out, err = hz.ejecutar(ctx, "llevar_al_carrito", {})
    assert not err and ctx.acciones[0] == {"tipo": "carrito", "items": [{"ref": "C-CREMON500g", "cantidad": 2, "nombre": "CREATINA MONOHIDRATO 500g"}]}
    out, _ = hz.ejecutar(ctx, "continuar_por_whatsapp", {"motivo": "precio por mayor"})
    accion = ctx.acciones[1]
    assert accion["tipo"] == "whatsapp" and accion["codigo"] in accion["url"].replace("%20", " ") or "WEB-" in accion["url"]
    # El cliente llega a WhatsApp con el código: el pedido pasa a su chat.
    destino = ped_mod.adoptar_pedido_web(accion["codigo"], "573000000009@c.us")
    assert [i.ref for i in destino.items] == ["C-CREMON500g"]
    assert {d["name"] for d in hz.definiciones("web")} >= {"llevar_al_carrito", "continuar_por_whatsapp"}
    assert "pasar_a_asesor" not in {d["name"] for d in hz.definiciones("web")}


def test_modo_de_base_por_hilo_no_toca_el_entorno(monkeypatch):
    import os
    import threading

    monkeypatch.setenv("WA_AGENTE_V2", "sombra")
    visto = {}
    with ped_mod.usando_modo("activo"):
        assert ped_mod.ruta_db() == ped_mod._DB
        hilo = threading.Thread(target=lambda: visto.setdefault("otro", ped_mod.ruta_db()))
        hilo.start()
        hilo.join()
        assert os.environ["WA_AGENTE_V2"] == "sombra"
    assert visto["otro"] == ped_mod._DB_SOMBRA  # otro hilo sigue viendo el modo real
    assert ped_mod.ruta_db() == ped_mod._DB_SOMBRA


def test_alerta_sale_por_supervisor_y_respaldo_principal(monkeypatch):
    import requests

    llamadas = []

    class _R:
        ok = True

        def json(self):
            return {"status": "success"}

    monkeypatch.setenv("WA_V2_ALERTA_DESTINO", "573182432463@c.us")
    monkeypatch.setattr(requests, "post", lambda url, **kw: llamadas.append((url, kw["json"])) or _R())
    assert hz.enviar_alerta_asesor("hola")
    assert llamadas[0][0].endswith(":3001/enviar") and llamadas[0][1]["numero"] == "573182432463"

    principal = []
    monkeypatch.setattr(requests, "post", lambda *a, **kw: (_ for _ in ()).throw(OSError("caído")))
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda t, numero_destino=None: principal.append(numero_destino) or True)
    assert hz.enviar_alerta_asesor("hola") and principal  # si el supervisor cae, sale por el principal
