"""Canales internos del panel, espejo con WhatsApp y campana de notificaciones."""
from __future__ import annotations

import pytest

from app.services import tickets_db


@pytest.fixture()
def entorno(monkeypatch, tmp_path):
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    monkeypatch.setattr(tickets_db, "UPLOADS_DIR", str(tmp_path / "uploads"))
    tickets_db.init_db()
    from app.services import canales_internos as CI

    eventos: list = []
    monkeypatch.setattr(
        "app.services.panel_presencia.registrar_evento_panel",
        lambda uid, tipo, **kw: eventos.append((uid, tipo, kw)),
    )
    reenvios: list = []
    monkeypatch.setattr(CI, "_reenviar_a_wa", lambda jid, txt: reenvios.append((jid, txt)))
    monkeypatch.setattr("app.services.pagos_clientes.usuario_por_telefono",
                        lambda tel: (2, "Stella") if str(tel).endswith("3001112233") else (None, ""))
    return CI, eventos, reenvios


ANA = {"id": 1, "nombre": "Ana", "username": "ana", "rol": {"nivel": 2}}
BETO = {"id": 2, "nombre": "Beto", "username": "beto", "rol": {"nivel": 1}}
CARLA = {"id": 3, "nombre": "Carla", "username": "carla", "rol": {"nivel": 1}}
JID = "120363000000000001@g.us"


def test_crear_enviar_leer_y_no_leidos(entorno):
    CI, eventos, _ = entorno
    canal = CI.crear_canal(ANA, "Bodega")
    m = CI.enviar_mensaje(canal["id"], ANA, "Llegaron 3 cajas")
    assert m["autor_nombre"] == "Ana" and m["origen"] == "panel"
    # Cuenta como actividad (control de horas).
    assert eventos and eventos[0][0] == 1 and eventos[0][1] == "canal_mensaje"
    # El autor no tiene no-leídos; Beto sí.
    assert CI.no_leidos_total(ANA) == 0
    assert CI.no_leidos_total(BETO) == 1
    CI.marcar_leido(canal["id"], BETO)
    assert CI.no_leidos_total(BETO) == 0
    assert [x["texto"] for x in CI.listar_mensajes(canal["id"], BETO)] == ["Llegaron 3 cajas"]


def test_canal_con_miembros_es_privado(entorno):
    CI, _, _ = entorno
    canal = CI.crear_canal(ANA, "Compras", miembros=[1, 2])
    assert CI.listar_mensajes(canal["id"], CARLA) is None
    with pytest.raises(PermissionError):
        CI.enviar_mensaje(canal["id"], CARLA, "hola")
    assert all(c["id"] != canal["id"] for c in CI.listar_canales(CARLA))


def test_solo_supervision_administra(entorno):
    CI, _, _ = entorno
    assert CI.puede_administrar(ANA) is True
    assert CI.puede_administrar(BETO) is False


def test_espejo_entrada_desde_grupo_enlazado(entorno):
    CI, _, _ = entorno
    canal = CI.crear_canal(ANA, "Inventario", wa_jid=JID)
    assert CI.espejar_desde_wa(jid=JID, wa_id="W1", texto="Llegó el aceite", from_me=False,
                               autor="573001112233", ts=1.0) is True
    # Duplicado por wa_id: no entra dos veces.
    assert CI.espejar_desde_wa(jid=JID, wa_id="W1", texto="Llegó el aceite", from_me=False,
                               autor="573001112233", ts=1.0) is False
    # Grupo no enlazado: no entra.
    assert CI.espejar_desde_wa(jid="999@g.us", wa_id="W2", texto="x", from_me=False, autor="1", ts=1.0) is False
    msgs = CI.listar_mensajes(canal["id"], ANA)
    assert len(msgs) == 1
    assert msgs[0]["origen"] == "wa" and msgs[0]["autor_nombre"] == "Stella" and msgs[0]["usuario_id"] == 2


def test_espejo_salida_y_anti_eco(entorno):
    CI, _, reenvios = entorno
    canal = CI.crear_canal(ANA, "Inventario", wa_jid=JID, espejo_salida=True)
    CI.enviar_mensaje(canal["id"], ANA, "Revisé las cajas")
    assert len(reenvios) == 1 and reenvios[0][0] == JID and "Ana" in reenvios[0][1]
    texto_wa = reenvios[0][1]
    # El puente devuelve el mismo texto como from_me: es el eco, no un mensaje nuevo.
    assert CI.espejar_desde_wa(jid=JID, wa_id="ECO1", texto=texto_wa, from_me=True, autor="", ts=2.0) is False
    assert len(CI.listar_mensajes(canal["id"], ANA)) == 1
    # Algo escrito DESDE el teléfono del negocio sí entra.
    assert CI.espejar_desde_wa(jid=JID, wa_id="TEL1", texto="Escrito en el celular", from_me=True, autor="", ts=3.0)
    assert len(CI.listar_mensajes(canal["id"], ANA)) == 2


def test_sin_espejo_salida_no_reenvia(entorno):
    CI, _, reenvios = entorno
    canal = CI.crear_canal(ANA, "Inventario", wa_jid=JID, espejo_salida=False)
    CI.enviar_mensaje(canal["id"], ANA, "Solo en el panel")
    assert reenvios == []


def test_un_grupo_no_se_enlaza_dos_veces(entorno):
    CI, _, _ = entorno
    CI.crear_canal(ANA, "A", wa_jid=JID)
    with pytest.raises(ValueError):
        CI.crear_canal(ANA, "B", wa_jid=JID)
    with pytest.raises(ValueError):
        CI.crear_canal(ANA, "C", wa_jid="573001112233@c.us")


def test_eliminar_solo_autor_y_solo_panel(entorno):
    CI, _, _ = entorno
    canal = CI.crear_canal(ANA, "X", wa_jid=JID)
    m = CI.enviar_mensaje(canal["id"], ANA, "borrar")
    assert CI.eliminar_mensaje(m["id"], BETO) is False
    assert CI.eliminar_mensaje(m["id"], ANA) is True
    CI.espejar_desde_wa(jid=JID, wa_id="W9", texto="de wa", from_me=False, autor="1", ts=1.0)
    wa = CI.listar_mensajes(canal["id"], ANA)[0]
    assert CI.eliminar_mensaje(wa["id"], ANA) is False


def test_asegurar_canal_es_idempotente(entorno):
    CI, _, _ = entorno
    a = CI.asegurar_canal("inventario", "Inventario")
    b = CI.asegurar_canal("inventario", "Inventario")
    assert a == b


# ── Campana ──────────────────────────────────────────────────────────────────

def test_notificaciones_y_preferencia(entorno, monkeypatch):
    from app.services import notificaciones_panel as NP
    from app.services import tickets_notificaciones as TN

    with tickets_db._conn() as db:
        db.execute("INSERT INTO usuarios (id, nombre, username, password_hash, activo, telefono) "
                   "VALUES (50,'Oper','oper','x',1,'3001112233')")
    enviados: list = []
    monkeypatch.setattr("app.utils.enviar_texto_supervisor", lambda n, t: enviados.append((n, t)) or True)

    # Por defecto ('ambos'): queda en la campana Y sale por WhatsApp.
    assert TN.enviar_texto_operador(50, "*Nueva tarea*\nRevisar bodega") is True
    assert NP.contar_no_leidas(50) == 1 and len(enviados) == 1
    n = NP.listar(50)[0]
    assert n["titulo"] == "Nueva tarea" and n["cuerpo"] == "Revisar bodega"

    # Solo en el panel: ya no sale WhatsApp.
    NP.fijar_preferencia(50, "inapp")
    assert TN.enviar_texto_operador(50, "Otra") is True
    assert NP.contar_no_leidas(50) == 2 and len(enviados) == 1

    assert NP.marcar_leidas(50) == 2 and NP.contar_no_leidas(50) == 0
    with pytest.raises(ValueError):
        NP.fijar_preferencia(50, "correo")


def test_responder_a_un_mensaje(entorno):
    CI, _, _ = entorno
    canal = CI.crear_canal(ANA, "Bodega")
    otro = CI.crear_canal(ANA, "Otro")
    m = CI.enviar_mensaje(canal["id"], ANA, "¿Llegó el pedido?")
    r = CI.enviar_mensaje(canal["id"], BETO, "Sí, esta mañana", responde_a=m["id"])
    assert r["responde_a"] == m["id"]
    assert r["cita"]["autor_nombre"] == "Ana" and r["cita"]["texto"] == "¿Llegó el pedido?"
    listado = CI.listar_mensajes(canal["id"], ANA)
    assert listado[0]["cita"] is None and listado[1]["cita"]["id"] == m["id"]
    # Solo se responde a mensajes del mismo grupo.
    with pytest.raises(ValueError):
        CI.enviar_mensaje(otro["id"], ANA, "x", responde_a=m["id"])
    # Si el original se borra, la cita queda como «eliminado».
    CI.eliminar_mensaje(m["id"], ANA)
    cita = CI.listar_mensajes(canal["id"], ANA)[0]["cita"]
    assert cita["eliminado"] is True and cita["texto"] == ""


def test_respuesta_espejada_a_wa_lleva_la_cita(entorno):
    CI, _, reenvios = entorno
    canal = CI.crear_canal(ANA, "X", wa_jid=JID, espejo_salida=True)
    m = CI.enviar_mensaje(canal["id"], ANA, "Hola")
    CI.enviar_mensaje(canal["id"], BETO, "Respuesta", responde_a=m["id"])
    assert "respondiendo a Ana" in reenvios[-1][1] and "> Hola" in reenvios[-1][1]


# ── Alertas sonoras (6-oct-2026) ──────────────────────────────────────────────

def test_solicitudes_para_mi_solo_las_que_pidio_otra_persona(entorno):
    CI, _, _ = entorno
    yo = tickets_db.crear_usuario("Yo Prueba", "yo.prueba", 3, password="clave-segura-1")[0]["id"]
    otro = tickets_db.crear_usuario("Otra Prueba", "otra.prueba", 3, password="clave-segura-1")[0]["id"]
    with tickets_db._conn() as db:
        for n, (creador, asignado, estado) in enumerate([(otro, yo, "pendiente"), (yo, yo, "pendiente"),
                                                         (otro, yo, "resuelto"), (otro, otro, "pendiente")]):
            db.execute("INSERT INTO tickets (numero, titulo, descripcion, estado, creado_por, asignado_a) VALUES (?,?,?,?,?,?)",
                       (f"TKT-T-{n}", f"t{n}", "d", estado, creador, asignado))
        db.commit()
    out = CI.solicitudes_para_mi(yo)
    assert [x["titulo"] for x in out] == ["t0"]
    assert out[0]["creado_por"] == otro and "creado_por_nombre" in out[0]


def test_preferencias_sonidos_se_validan_y_se_guardan(entorno):
    limpio = tickets_db._limpiar_alertas_sonido(
        {"activo": True, "volumen": 140, "general": "dh_ladrido", "personas": {"8": "cc_circo"}, "canales": {"3": "silencio"}})
    assert limpio == {"activo": True, "volumen": 100, "tono_por_grupo": True, "general": "dh_ladrido",
                      "personas": {"8": "cc_circo"}, "canales": {"3": "silencio"}}
    # Cada grupo con su tono propio (7-oct): se puede apagar y queda guardado.
    assert tickets_db._limpiar_alertas_sonido({"tono_por_grupo": False})["tono_por_grupo"] is False
    assert tickets_db._limpiar_alertas_sonido({"general": "<script>"}) is None
    assert tickets_db._limpiar_alertas_sonido({"personas": {"ana": "dh_risa"}}) is None
    assert tickets_db._limpiar_alertas_sonido({"volumen": True}) is None
    with tickets_db._conn() as db:
        uid = db.execute("SELECT id FROM usuarios WHERE activo=1 LIMIT 1").fetchone()["id"]
    ok, _, merged = tickets_db.actualizar_preferencias_ui(uid, {"panel": {"mode": "dark"}})
    assert ok
    ok, _, merged = tickets_db.actualizar_preferencias_ui(uid, {"sonidos": {"general": "cc_tropiezo"}})
    assert ok and merged["sonidos"]["general"] == "cc_tropiezo" and merged["panel"]["mode"] == "dark"


# ── Menciones con @ (7-oct-2026) ─────────────────────────────────────────────

def _usuarios(*filas):
    from app.services import canales_internos as CI

    with CI._conn() as c:
        for uid, nombre, usuario in filas:
            c.execute("INSERT OR REPLACE INTO usuarios (id, nombre, username, password_hash, activo) VALUES (?,?,?,?,1)",
                      (uid, nombre, usuario, "x"))


def test_mencion_por_nombre_usuario_y_sin_tilde(entorno):
    CI, _, _ = entorno
    _usuarios((1, "Ana Ruiz", "ana"), (2, "Sebastián García", "sebas"), (3, "Carla Díaz", "carla"))
    canal = CI.crear_canal(ANA, "Bodega")
    m = CI.enviar_mensaje(canal["id"], ANA, "@sebastian revisa esto y @carla.diaz no, @Carla Díaz sí")
    assert {x["id"] for x in m["menciones"]} == {2, 3}
    # Con correo no es mención; el autor no se menciona a sí mismo.
    assert CI.enviar_mensaje(canal["id"], ANA, "escribe a ana@mckenna.co o @Ana")["menciones"] == []


def test_nombre_repetido_pide_el_completo(entorno):
    CI, _, _ = entorno
    _usuarios((1, "Ana Ruiz", "ana"), (2, "Victor Garcia", "victor"), (3, "Victor Gómez", "vgomez"))
    canal = CI.crear_canal(ANA, "Sede")
    assert [x["id"] for x in CI.enviar_mensaje(canal["id"], ANA, "@victor ven")["menciones"]] == [2]  # por usuario
    assert [x["id"] for x in CI.enviar_mensaje(canal["id"], ANA, "@Victor Gómez ven")["menciones"]] == [3]


def test_mencion_pendiente_hasta_leer_y_todos(entorno):
    CI, _, _ = entorno
    _usuarios((1, "Ana", "ana"), (2, "Beto", "beto"), (3, "Carla", "carla"))
    canal = CI.crear_canal(ANA, "Compras", miembros=[1, 2, 3])
    CI.enviar_mensaje(canal["id"], ANA, "@Beto ¿llegó la factura?")
    assert CI.obtener_canal(canal["id"], BETO)["menciones"] == 1
    assert CI.obtener_canal(canal["id"], CARLA)["menciones"] == 0
    assert CI.menciones_pendientes(BETO) == 1
    CI.marcar_leido(canal["id"], BETO)
    assert CI.menciones_pendientes(BETO) == 0
    CI.enviar_mensaje(canal["id"], ANA, "@todos reunión a las 3")
    assert CI.menciones_pendientes(BETO) == 1 and CI.menciones_pendientes(CARLA) == 1
    assert CI.menciones_pendientes(ANA) == 0


def test_mencion_desde_whatsapp_por_telefono(entorno):
    CI, _, _ = entorno
    _usuarios((1, "Ana", "ana"), (2, "Stella", "stella"))
    canal = CI.crear_canal(ANA, "Despachos", wa_jid=JID)
    assert CI.espejar_desde_wa(jid=JID, wa_id="w1", texto="@573001112233 ya salió", from_me=True, autor="", ts=0)
    assert CI.obtener_canal(canal["id"], BETO)["menciones"] == 1


def test_mencionables_son_los_miembros_menos_yo(entorno):
    CI, _, _ = entorno
    _usuarios((1, "Ana", "ana"), (2, "Beto", "beto"), (3, "Carla", "carla"))
    canal = CI.crear_canal(ANA, "Privado", miembros=[1, 2])
    assert [p["id"] for p in CI.mencionables(canal["id"], ANA)] == [2]
    assert CI.mencionables(canal["id"], CARLA) is None


def test_cuentas_tecnicas_no_se_nombran_y_username_con_arroba(entorno):
    CI, _, _ = entorno
    _usuarios((1, "Ana", "ana"), (2, "Hugo IA", "hugo_ia_bot"), (3, "Cynthia Ruiz", "@cynthia"))
    canal = CI.crear_canal(ANA, "Equipo")
    assert [p["id"] for p in CI.mencionables(canal["id"], ANA)] == [3]
    assert [x["id"] for x in CI.enviar_mensaje(canal["id"], ANA, "@Hugo @cynthia mira")["menciones"]] == [3]
