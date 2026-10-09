"""Empresa viva (Agenda → Empresa viva): el estado del juego sale de la operación real y cada
quien ve solo lo suyo. Sin red ni base de datos: las fuentes se reemplazan por datos fijos."""
from app.services import empresa_viva as E
from app.services.tickets_db import _limpiar_avatar_empresa


_AVATAR = {"cuerpo": "mujer", "piel": "amber", "ojos": "brown", "pelo": "cola", "color_pelo": "chestnut", "barba": "",
           "torso": "polo", "color_torso": "rose", "piernas": "leggins", "color_piernas": "black", "zapatos": "tenis",
           "color_zapatos": "white", "delantal": "", "color_delantal": "tan", "gafas": "redondas"}


def test_el_avatar_solo_acepta_piezas_y_colores_del_catalogo():
    assert _limpiar_avatar_empresa({"pixel": _AVATAR, "color": "#FFE14D"}) == {"pixel": _AVATAR, "color": "#FFE14D"}
    assert _limpiar_avatar_empresa({"pixel": {**_AVATAR, "pelo": "../../etc/passwd"}}) is None
    assert _limpiar_avatar_empresa({"pixel": {**_AVATAR, "gafas": "monoculo"}}) is None
    assert _limpiar_avatar_empresa({"pixel": {**_AVATAR, "color_torso": "#ff0000"}}) is None   # solo paletas con nombre
    assert _limpiar_avatar_empresa({"pixel": _AVATAR, "color": "red;background:url(x)"}) is None
    # El del barrio 3D (avatar + accesorio) ya no se acepta: el juego ahora es en pixel art.
    assert _limpiar_avatar_empresa({"avatar": "character-male-e", "accesorio": "aid-glasses"}) is None
    assert _limpiar_avatar_empresa("character-male-e") is None


def test_los_paquetes_se_clasifican_por_el_estado_del_envio():
    assert E._clasificar("ready_to_ship", "ready_to_print", False) == "por_alistar"
    assert E._clasificar("ready_to_ship", "ready_to_print", True) == "alistado"   # foto de empaque
    assert E._clasificar("ready_to_ship", "printed", False) == "alistado"
    assert E._clasificar("shipped", "", False) == "en_ruta"
    assert E._clasificar("delivered", "", True) is None


def _foto(interacciones):
    return {"personas": [], "visitantes": [], "paquetes": [], "proveedores": [], "bodega": None,
            "interacciones": interacciones, "eventos": [], "sin_senal": [], "generado": ""}


def test_lo_que_se_dicen_solo_lo_leen_quienes_participan(monkeypatch):
    inter = [
        {"id": "t1", "tipo": "pregunta", "de": 8, "para": [10], "ts": 1, "texto": "¿Salió la factura?", "privado": True},
        {"id": "m2", "tipo": "idea", "de": 6, "para": [8], "todos": False, "canal": "Armando · Cynthia", "canal_id": 4,
         "ts": 2, "texto": "Idea: kit labial", "privado": False},
        {"id": "m3", "tipo": "grupo", "de": 10, "para": [], "todos": True, "canal": "Equipo", "canal_id": 8,
         "ts": 3, "texto": "Ya llegó el camión", "privado": False},
    ]
    monkeypatch.setattr(E, "foto", lambda refrescar=False: _foto([]))
    monkeypatch.setattr(E, "vivo", lambda refrescar=False: {"personas": [], "tareas": {}, "interacciones": inter,
                                                            "acciones": [], "sin_senal": []})
    monkeypatch.setattr(E, "casas", lambda: {"usuarios": {}})
    from app.services import mapa_app
    monkeypatch.setattr(mapa_app, "urgencias_para", lambda u: {"por_etapa": {}})

    stella = {"id": 9, "permisos_secciones": {"empaque": True}, "rol": {"nivel": 1}}
    vistas = {i["id"]: i for i in E.estado_para(stella)["interacciones"]}
    # El avioncito lo ve todo el equipo; el contenido, no.
    assert set(vistas) == {"t1", "m2", "m3"}
    assert vistas["t1"]["texto"] == "" and vistas["m2"]["texto"] == "" and vistas["m2"]["canal"] == ""
    # Un grupo sin miembros es de todo el equipo: ese sí se lee.
    assert vistas["m3"]["texto"] == "Ya llegó el camión"

    jenniffer = {"id": 10, "permisos_secciones": {"facturacion": True}, "rol": {"nivel": 1}}
    vistas = {i["id"]: i for i in E.estado_para(jenniffer)["interacciones"]}
    assert vistas["t1"]["texto"] == "¿Salió la factura?"     # a ella le preguntaron
    assert vistas["m2"]["texto"] == ""                        # no es miembro de ese grupo


def test_el_juego_no_es_para_el_contador_ni_el_colaborador_externo():
    assert E.puede_ver_juego({"id": 9, "permisos_secciones": {"empaque": True}})
    assert not E.puede_ver_juego({"id": 12, "permisos_secciones": {"contador": True}})
    assert not E.puede_ver_juego({"id": 13, "permisos_secciones": {"colaborador_externo": True}})
    assert not E.puede_ver_juego(None)


def test_la_tarea_ajena_se_ve_por_su_funcion_no_por_su_titulo(monkeypatch):
    tarea = {"funcion": "almuerzo", "hace": "Hace el almuerzo del equipo", "titulo": "Almuerzo: arroz con pollo",
             "ticket_id": 1, "desde": ""}
    vivo = {"personas": [{"id": 7, "nombre": "Victor", "username": "vitor", "en_linea": False, "panel": "", "via": "",
                          "avatar": None, "funciones": [], "tarea": tarea, "presente": True}],
            "tareas": {7: tarea}, "interacciones": [],
            "acciones": [{"id": "a1", "tipo": "comento", "de": 10, "ts": 1, "ticket_id": 5, "titulo": "Factura glicerina",
                          "partes": [8, 10]}], "sin_senal": []}
    monkeypatch.setattr(E, "foto", lambda refrescar=False: _foto([]))
    monkeypatch.setattr(E, "vivo", lambda refrescar=False: vivo)
    monkeypatch.setattr(E, "casas", lambda: {"usuarios": {}})
    from app.services import mapa_app
    monkeypatch.setattr(mapa_app, "urgencias_para", lambda u: {"por_etapa": {}})
    stella = {"id": 9, "permisos_secciones": {"empaque": True}, "rol": {"nivel": 1}}
    e = E.estado_para(stella)
    assert e["personas"][0]["tarea"]["hace"] == "Hace el almuerzo del equipo"
    assert e["personas"][0]["tarea"]["titulo"] == ""
    assert e["acciones"][0]["titulo"] == ""                 # no es parte de esa solicitud
    armando = {"id": 8, "permisos_secciones": {}, "rol": {"nivel": 1}}
    assert E.estado_para(armando)["acciones"][0]["titulo"] == "Factura glicerina"


def test_con_clientes_en_la_tienda_y_un_administrador(monkeypatch):
    """8-oct: `v` (lo vivo) quedaba pisado por el ciclo de visitantes y daba 500 con clientes en la tienda."""
    foto = _foto([])
    foto["visitantes"] = [{"id": "q1", "tipo": "preventa", "desde": "", "producto": "Glicerina", "texto": "¿Envían?",
                           "panel": "preventa"}]
    monkeypatch.setattr(E, "foto", lambda refrescar=False: foto)
    monkeypatch.setattr(E, "vivo", lambda refrescar=False: {"personas": [], "tareas": {}, "interacciones": [],
                                                            "acciones": [], "sin_senal": []})
    monkeypatch.setattr(E, "casas", lambda: {"usuarios": {}})
    from app.services import mapa_app
    monkeypatch.setattr(mapa_app, "urgencias_para", lambda u: {"por_etapa": {}})
    admin = {"id": 8, "permisos_secciones": {}, "rol": {"nivel": 3}}
    e = E.estado_para(admin)
    assert e["visitantes"][0]["texto"] == "¿Envían?" and e["sin_senal"] == []


def _limpiar_juego():
    E._jugadores.clear()


def test_quien_juega_ve_a_los_demas_y_no_a_si_mismo():
    _limpiar_juego()
    armando, jenni = {"id": 8}, {"id": 10}
    assert E.jugador(armando, {"x": 100, "y": 200, "dir": "abajo", "pose": "camina"})["jugadores"] == []
    r = E.jugador(jenni, {"x": 300, "y": 210, "dir": "nada", "pose": "vuela"})
    assert [j["id"] for j in r["jugadores"]] == [8]
    otro = E.jugador(armando, {})["jugadores"][0]
    assert otro["id"] == 10 and otro["dir"] == "abajo" and otro["pose"] == "quieto"   # lo raro se vuelve lo de siempre
    # Posiciones basura no se anotan
    assert E._limpiar_posicion({"x": "a", "y": 1}) is None
    assert E._limpiar_posicion({"x": -5, "y": 1}) is None
    assert E._limpiar_posicion({"x": 10**6, "y": 1}) is None


def test_quien_deja_de_jugar_desaparece(monkeypatch):
    _limpiar_juego()
    t = [1000.0]
    monkeypatch.setattr(E.time, "time", lambda: t[0])
    E.jugador({"id": 8}, {"x": 1, "y": 1})
    t[0] += E._VIDA_JUGADOR_S + 1
    assert E.jugador({"id": 10}, {"x": 2, "y": 2})["jugadores"] == []


def test_el_chat_de_dos_no_lo_ve_nadie_mas(monkeypatch):
    """Hablar con alguien en el juego = chat directo: ni el avioncito lo ven los demás."""
    inter = [{"id": "m1", "tipo": "chat", "de": 8, "para": [10], "canal_id": 4, "ts": 1, "texto": "¿Ya facturaste?",
              "privado": True}]
    monkeypatch.setattr(E, "foto", lambda refrescar=False: _foto([]))
    monkeypatch.setattr(E, "vivo", lambda refrescar=False: {"personas": [], "tareas": {}, "interacciones": inter,
                                                            "acciones": [], "sin_senal": []})
    monkeypatch.setattr(E, "casas", lambda: {"usuarios": {}})
    from app.services import mapa_app
    monkeypatch.setattr(mapa_app, "urgencias_para", lambda u: {"por_etapa": {}})
    assert E.estado_para({"id": 10, "permisos_secciones": {}, "rol": {"nivel": 1}})["interacciones"][0]["texto"] == "¿Ya facturaste?"
    assert E.estado_para({"id": 9, "permisos_secciones": {}, "rol": {"nivel": 1}})["interacciones"] == []
    assert E.estado_para({"id": 1, "permisos_secciones": {}, "rol": {"nivel": 3}, "es_admin": True})["interacciones"] == []


def test_las_rutas_del_juego_exigen_a_la_persona(monkeypatch):
    """Sin token personal no hay a quién mover; el contador no juega."""
    from flask import Flask

    from app import routes_mapa_sistema
    from app.services import tickets_db

    app = Flask(__name__)
    routes_mapa_sistema.register_mapa_sistema_routes(app)
    c = app.test_client()
    assert c.post("/api/empresa-viva/jugador", json={"x": 1, "y": 1}).status_code == 401
    usuarios = {"tok-stella": {"id": 9, "permisos_secciones": {"empaque": True}},
                "tok-contador": {"id": 12, "permisos_secciones": {"contador": True}}}
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda tok: usuarios.get(tok))
    monkeypatch.setattr(tickets_db, "aplicar_privilegios_admin_cynthia", lambda u: u)
    _limpiar_juego()
    assert c.post("/api/empresa-viva/jugador", json={}, headers={"Authorization": "Bearer tok-contador"}).status_code == 403
    r = c.post("/api/empresa-viva/jugador", json={"x": 40, "y": 50, "dir": "arriba", "pose": "camina"},
               headers={"Authorization": "Bearer tok-stella"})
    assert r.status_code == 200 and r.get_json()["jugadores"] == []
    assert E._jugadores[9]["dir"] == "arriba"
    assert c.post("/api/empresa-viva/decir", json={"para": 10, "texto": "hola"}).status_code == 404   # ya no existe


# ─── Ajedrez en la mesa del parque (empresa_viva_ajedrez) ────────────────────

def _ajedrez(monkeypatch, tmp_path):
    from app.services import empresa_viva_ajedrez as A
    from app.services import tickets_db

    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    equipo = {8: {"id": 8, "permisos_secciones": {}}, 6: {"id": 6, "permisos_secciones": {}},
              9: {"id": 9, "permisos_secciones": {}}, 12: {"id": 12, "permisos_secciones": {"contador": True}}}
    monkeypatch.setattr(tickets_db, "get_usuario_by_id", lambda i: equipo.get(int(i)))
    return A, equipo


def test_ajedrez_reto_aceptar_y_turnos(monkeypatch, tmp_path):
    import pytest

    A, eq = _ajedrez(monkeypatch, tmp_path)
    p = A.retar(eq[8], 6)
    assert p["estado"] == "invitada" and {p["blancas"], p["negras"]} == {8, 6} and p["reta"] == 8
    with pytest.raises(ValueError):
        A.retar(eq[6], 8)                       # ya tienen una abierta
    with pytest.raises(ValueError):
        A.retar(eq[8], 12)                      # el contador no juega
    with pytest.raises(ValueError):
        A.responder(eq[8], p["id"], True)       # quien retó no se acepta a sí mismo
    with pytest.raises(PermissionError):
        A.responder(eq[9], p["id"], True)       # ni alguien de afuera
    p = A.responder(eq[6], p["id"], True)
    assert p["estado"] == "jugando" and p["turno"] == "blancas"
    blancas, negras = eq[p["blancas"]], eq[p["negras"]]
    with pytest.raises(ValueError):
        A.jugar(negras, p["id"], "e7e5", 0)     # no es su turno
    with pytest.raises(ValueError):
        A.jugar(blancas, p["id"], "e2-e4", 0)   # no es UCI
    p = A.jugar(blancas, p["id"], "e2e4", 0)
    assert p["jugadas"] == ["e2e4"] and p["turno"] == "negras"
    with pytest.raises(ValueError):
        A.jugar(blancas, p["id"], "d2d4", 0)    # el tablero cambió (n viejo) y además no le toca
    with pytest.raises(PermissionError):
        A.jugar(eq[9], p["id"], "e7e5", 1)      # quien mira no mueve
    # Jaque mate del pastor: el resultado lo pone el servidor (gana quien movió).
    for uci, quien in (("e7e5", negras), ("f1c4", blancas), ("b8c6", negras), ("d1h5", blancas), ("g8f6", negras)):
        p = A.jugar(quien, p["id"], uci, len(p["jugadas"]))
    p = A.jugar(blancas, p["id"], "h5f7", 6, fin="jaque mate")
    assert p["estado"] == "terminada" and p["resultado"] == ("1-0" if p["blancas"] == blancas["id"] else "0-1")
    assert p["motivo"] == "jaque mate"
    with pytest.raises(ValueError):
        A.jugar(negras, p["id"], "a7a6", 7)     # ya terminó


def test_ajedrez_tablas_rendicion_y_quien_mira(monkeypatch, tmp_path):
    import pytest

    A, eq = _ajedrez(monkeypatch, tmp_path)
    p = A.responder(eq[6], A.retar(eq[8], 6)["id"], True)
    with pytest.raises(ValueError):
        A.tablas(eq[8], p["id"], "aceptar")     # nadie las ofreció
    A.tablas(eq[8], p["id"], "ofrecer")
    with pytest.raises(ValueError):
        A.tablas(eq[8], p["id"], "aceptar")     # no se aceptan las propias
    p = A.tablas(eq[6], p["id"], "aceptar")
    assert p["estado"] == "terminada" and p["resultado"] == "1/2-1/2"

    q = A.responder(eq[9], A.retar(eq[8], 9)["id"], True)
    vista = A.listar(eq[6])
    assert [x["id"] for x in vista["en_curso"]] == [q["id"]]          # Cynthia puede mirar la de Armando y Stella
    assert [x["id"] for x in vista["mias"]] == [p["id"]]              # y ve su partida recién terminada
    q = A.rendirse(eq[9], q["id"])
    assert q["resultado"] == ("1-0" if q["blancas"] == 8 else "0-1") and q["motivo"] == "rendición"

    r = A.retar(eq[6], 9)
    assert A.responder(eq[6], r["id"], False)["estado"] == "cancelada"   # retirar el reto
    r = A.retar(eq[6], 9)
    assert A.responder(eq[9], r["id"], False)["estado"] == "rechazada"


def test_ajedrez_rutas(monkeypatch, tmp_path):
    from flask import Flask

    from app import routes_mapa_sistema
    from app.services import tickets_db

    A, eq = _ajedrez(monkeypatch, tmp_path)
    app = Flask(__name__)
    routes_mapa_sistema.register_mapa_sistema_routes(app)
    c = app.test_client()
    usuarios = {"tok-armando": eq[8], "tok-cynthia": eq[6], "tok-contador": eq[12]}
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda tok: usuarios.get(tok))
    monkeypatch.setattr(tickets_db, "aplicar_privilegios_admin_cynthia", lambda u: u)
    h = lambda tok: {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/empresa-viva/ajedrez").status_code == 401
    assert c.get("/api/empresa-viva/ajedrez", headers=h("tok-contador")).status_code == 403
    r = c.post("/api/empresa-viva/ajedrez", json={"a": 6}, headers=h("tok-armando"))
    assert r.status_code == 200
    pid = r.get_json()["id"]
    assert c.post(f"/api/empresa-viva/ajedrez/{pid}/aceptar", headers=h("tok-armando")).status_code == 400
    assert c.post(f"/api/empresa-viva/ajedrez/{pid}/aceptar", headers=h("tok-cynthia")).get_json()["estado"] == "jugando"
    assert c.post(f"/api/empresa-viva/ajedrez/{pid}/volar", headers=h("tok-cynthia")).status_code == 404
    assert c.get("/api/empresa-viva/ajedrez/999", headers=h("tok-cynthia")).status_code == 404
    p = c.get(f"/api/empresa-viva/ajedrez/{pid}", headers=h("tok-armando")).get_json()
    quien = "tok-armando" if p["blancas"] == 8 else "tok-cynthia"
    r = c.post(f"/api/empresa-viva/ajedrez/{pid}/jugada", json={"uci": "e2e4", "n": 0}, headers=h(quien))
    assert r.status_code == 200 and r.get_json()["jugadas"] == ["e2e4"]
    assert c.post(f"/api/empresa-viva/ajedrez/{pid}/jugada", json={"uci": "e7e5", "n": "x"}, headers=h(quien)).status_code == 400


def test_ajedrez_trofeos_de_quien_gana(monkeypatch, tmp_path):
    """Oro por jaque mate, plata si el rival se rinde, nada por tablas; uno por partida."""
    import sqlite3

    A, eq = _ajedrez(monkeypatch, tmp_path)
    p = A.responder(eq[6], A.retar(eq[8], 6)["id"], True)
    bl, ng = eq[p["blancas"]], eq[p["negras"]]
    for uci, quien in (("e2e4", bl), ("e7e5", ng), ("f1c4", bl), ("b8c6", ng), ("d1h5", bl), ("g8f6", ng)):
        p = A.jugar(quien, p["id"], uci, len(p["jugadas"]))
    A.jugar(bl, p["id"], "h5f7", 6, fin="jaque mate")
    q = A.responder(eq[9], A.retar(eq[8], 9)["id"], True)
    A.rendirse(eq[9], q["id"])                                   # Stella se rinde: plata para Armando
    t = A.responder(eq[9], A.retar(eq[6], 9)["id"], True)
    A.tablas(eq[6], t["id"], "ofrecer")
    A.tablas(eq[9], t["id"], "aceptar")                          # tablas: sin trofeo
    trofeos = A.listar(eq[9])["trofeos"]
    assert [(x["usuario"], x["rival"], x["medalla"]) for x in trofeos] == [(bl["id"], ng["id"], "oro"), (8, 9, "plata")]
    assert trofeos[0]["motivo"] == "jaque mate" and trofeos[0]["jugadas"] == 7

    # Una partida ganada antes de que existieran los trofeos también deja el suyo (una sola vez).
    c = sqlite3.connect(A.tickets_db.DB_PATH)
    c.execute("DELETE FROM ev_trofeos")
    c.commit()
    c.close()
    A._listo.clear()
    assert len(A.trofeos()) == 2
    A._listo.clear()
    assert len(A.trofeos()) == 2


def test_tenis_en_equipo_conteo_y_trofeos(monkeypatch, tmp_path):
    """Sala → equipos → el anfitrión anota con el conteo de tenis → trofeo a cada ganador."""
    import pytest

    from app.services import empresa_viva_tenis as T

    A, eq = _ajedrez(monkeypatch, tmp_path)
    T._partidas.clear()
    p = T.crear(eq[8])
    with pytest.raises(ValueError):
        T.crear(eq[8])                                  # ya está en uno
    with pytest.raises(ValueError):
        T.empezar(eq[8], p["id"])                       # falta el otro equipo
    T.unirse(eq[6], p["id"], "A")
    T.unirse(eq[9], p["id"], "B")
    with pytest.raises(PermissionError):
        T.empezar(eq[9], p["id"])                       # lo empieza quien lo armó
    p = T.empezar(eq[8], p["id"])
    assert p["estado"] == "jugando" and p["host"] == 8 and p["equipos"] == {"A": [8, 6], "B": [9]}
    # Stella no es anfitriona: su «punto» no cuenta; su raqueta sí llega
    p = T.estado(eq[9], p["id"], {"raqueta": {"x": 0.9, "y": 7}, "punto": "B", "punto_seq": 1})
    assert p["puntos"] == {"A": 0, "B": 0} and p["raquetas"]["9"]["y"] == 1
    seq = 0
    def punto(equipo):
        nonlocal seq
        seq += 1
        return T.estado(eq[8], p["id"], {"raqueta": {"x": 0.1, "y": 0.5}, "punto": equipo, "punto_seq": seq})
    for e in "AAAB":
        p = punto(e)
    assert p["puntos"] == {"A": 3, "B": 1}
    p = T.estado(eq[8], p["id"], {"punto": "A", "punto_seq": seq})   # reenvío: no cuenta dos veces
    assert p["puntos"]["A"] == 3
    p = punto("A")
    assert p["juegos"] == {"A": 1, "B": 0} and p["puntos"] == {"A": 0, "B": 0} and p["saca"] == "B"
    for e in "ABABABAA":                                # iguales, ventaja… y juego
        p = punto(e)
    assert p["estado"] == "terminada" and p["ganador"] == "A"
    tenis = [t for t in A.trofeos() if t["juego"] == "tenis"]
    assert sorted(t["usuario"] for t in tenis) == [6, 8]
    assert tenis[0]["detalle"]["rivales"] == [9] and tenis[0]["detalle"]["marcador"] == "2-0"
    T._partidas.clear()


def test_tenis_invitar_al_hablarle(monkeypatch, tmp_path):
    """«Jugar tenis» al hablarle a alguien: el partido nace con esa persona invitada."""
    import pytest

    from app.services import empresa_viva_tenis as T

    _, eq = _ajedrez(monkeypatch, tmp_path)
    T._partidas.clear()
    p = T.crear(eq[8], invitar=[6, "x", 8])
    assert p["invitados"] == [6]                        # ni basura ni uno mismo
    p = T.invitar(eq[8], p["id"], [9])
    assert p["invitados"] == [6, 9]
    with pytest.raises(PermissionError):
        T.invitar(eq[6], p["id"], [12])                 # solo invita quien está en el partido
    T._partidas.clear()


# ─── Vecindario: terreno → casa → decorar, con monedas del mes ───────────────

def test_vecindario_terreno_casa_y_decorar(monkeypatch, tmp_path):
    import pytest

    from app.services import empresa_viva_vecindario as V

    _, eq = _ajedrez(monkeypatch, tmp_path)
    V._listo.clear()
    lotes = V.lotes()
    assert len(lotes) == 16 and {l["frente"] for l in lotes.values()} == {"abajo", "arriba"}
    e = V.estado(eq[8])
    assert e["billetera"]["saldo"] == 1000
    with pytest.raises(ValueError):
        V.construir(eq[8], "ladrillo")                       # sin terreno no hay casa
    with pytest.raises(LookupError):
        V.comprar_terreno(eq[8], "L99")
    e = V.comprar_terreno(eq[8], "L01")                      # 400
    with pytest.raises(ValueError):
        V.comprar_terreno(eq[8], "L02")                      # uno por persona
    with pytest.raises(ValueError):
        V.comprar_terreno(eq[6], "L01")                      # ya tiene dueño
    with pytest.raises(ValueError):
        V.poner_item(eq[8], "flor_roja", 0, 7)                # sin casa no se decora
    e = V.construir(eq[8], "colonial")                       # 400
    assert e["billetera"]["saldo"] == 200
    lote = next(l for l in e["lotes"] if l["id"] == "L01")
    assert lote["dueno"] == 8 and lote["casa"] == {"modelo": "colonial", "nivel": 1}
    # L01 mira al sur: casa en x 2..5, y 1..4; la fila 1 es el muro; la puerta y el camino en x 3-4
    with pytest.raises(ValueError):
        V.poner_item(eq[8], "cama", 3, 3)                     # tapa la entrada de la puerta (fila 4)
    with pytest.raises(ValueError):
        V.poner_item(eq[8], "flor_roja", 3, 6)                # en el camino a la puerta
    with pytest.raises(ValueError):
        V.poner_item(eq[8], "cama", 2, 0)                     # la cama va adentro
    e = V.poner_item(eq[8], "cama", 2, 2)
    e = V.poner_item(eq[8], "alfombra_azul", 4, 2)           # alfombra (capa suelo)…
    e = V.poner_item(eq[8], "lampara", 4, 2)                  # …y encima un mueble: se puede
    with pytest.raises(ValueError):
        V.poner_item(eq[8], "silla", 2, 3)                    # encima de la cama: no
    e = V.poner_item(eq[8], "flor_roja", 0, 7)
    assert e["billetera"]["saldo"] == 200 - 80 - 30 - 20 - 5
    with pytest.raises(ValueError):
        V.poner_item(eq[8], "fuente", 6, 6)                   # 120: no alcanza (quedan 65)
    # Quitar devuelve la mitad
    cama = next(i for i in next(l for l in e["lotes"] if l["id"] == "L01")["items"] if i["item"] == "cama")
    e = V.quitar_item(eq[8], cama["id"])
    assert e["billetera"]["saldo"] == 65 + 40
    with pytest.raises(LookupError):
        V.quitar_item(eq[6], cama["id"])                      # no es de Cynthia
    # Mover: la flor a otra celda del jardín
    flor = next(i for i in next(l for l in e["lotes"] if l["id"] == "L01")["items"] if i["item"] == "flor_roja")
    e = V.mover_item(eq[8], flor["id"], 7, 7)
    with pytest.raises(ValueError):
        V.mover_item(eq[8], flor["id"], 3, 3)                 # adentro de la casa: no es su sitio


def test_vecindario_mes_nuevo_y_ampliacion(monkeypatch, tmp_path):
    """Cada mes llega la asignación (y la de los meses sin entrar); ampliar pide mover lo que estorba."""
    import pytest

    from app.services import empresa_viva_vecindario as V

    _, eq = _ajedrez(monkeypatch, tmp_path)
    V._listo.clear()
    monkeypatch.setattr(V, "_mes", lambda ahora=None: "2026-10")
    V.comprar_terreno(eq[6], "L09")                           # fila de abajo: mira al norte (320)
    V.construir(eq[6], "moderna")
    # L09 mira al norte: casa x 2..5, y 3..6 (nivel 1); el jardín de los lados queda libre
    V.poner_item(eq[6], "maceta", 1, 4)                       # donde llega la ampliación (x 1)
    monkeypatch.setattr(V, "_mes", lambda ahora=None: "2026-12")
    e = V.estado(eq[6])
    assert e["billetera"]["saldo"] == 1000 - 320 - 400 - 15 + 2000   # noviembre y diciembre
    with pytest.raises(ValueError):
        V.ampliar(eq[6])                                      # la matera estorba
    m = next(i for l in e["lotes"] if l["id"] == "L09" for i in l["items"])
    V.mover_item(eq[6], m["id"], 0, 4)
    e = V.ampliar(eq[6])
    assert next(l for l in e["lotes"] if l["id"] == "L09")["casa"]["nivel"] == 2


def test_vecindario_rutas(monkeypatch, tmp_path):
    from flask import Flask

    from app import routes_mapa_sistema
    from app.services import empresa_viva_vecindario as V
    from app.services import tickets_db

    _, eq = _ajedrez(monkeypatch, tmp_path)
    V._listo.clear()
    app = Flask(__name__)
    routes_mapa_sistema.register_mapa_sistema_routes(app)
    c = app.test_client()
    usuarios = {"tok-armando": eq[8], "tok-contador": eq[12]}
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda tok: usuarios.get(tok))
    monkeypatch.setattr(tickets_db, "aplicar_privilegios_admin_cynthia", lambda u: u)
    h = lambda tok: {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/empresa-viva/vecindario").status_code == 401
    assert c.get("/api/empresa-viva/vecindario", headers=h("tok-contador")).status_code == 403
    r = c.get("/api/empresa-viva/vecindario", headers=h("tok-armando")).get_json()
    assert r["billetera"]["saldo"] == 1000 and len(r["lotes"]) == 16
    assert c.post("/api/empresa-viva/vecindario/terreno", json={"lote": "L03"}, headers=h("tok-armando")).status_code == 200
    assert c.post("/api/empresa-viva/vecindario/poner", json={"item": "sofa", "cx": "x", "cy": 1},
                  headers=h("tok-armando")).status_code == 400
    assert c.post("/api/empresa-viva/vecindario/volar", headers=h("tok-armando")).status_code == 404
