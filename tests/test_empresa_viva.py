"""Empresa viva (Agenda → Empresa viva): el estado del juego sale de la operación real y cada
quien ve solo lo suyo. Sin red ni base de datos: las fuentes se reemplazan por datos fijos."""
from app.services import empresa_viva as E
from app.services.tickets_db import _limpiar_avatar_empresa


def test_el_avatar_solo_acepta_modelos_y_accesorios_que_existen():
    assert _limpiar_avatar_empresa({"avatar": "character-male-e", "accesorio": "aid-glasses", "color": "#FFE14D"}) == {
        "avatar": "character-male-e", "accesorio": "aid-glasses", "color": "#FFE14D"}
    assert _limpiar_avatar_empresa({"avatar": "character-male-e"}) == {"avatar": "character-male-e", "accesorio": "", "color": ""}
    assert _limpiar_avatar_empresa({"avatar": "../../etc/passwd"}) is None
    assert _limpiar_avatar_empresa({"avatar": "character-male-e", "accesorio": "sombrero"}) is None
    assert _limpiar_avatar_empresa({"avatar": "character-male-e", "color": "red;background:url(x)"}) is None
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
