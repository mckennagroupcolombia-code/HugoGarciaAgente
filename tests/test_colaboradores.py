"""Colaboradores: diagrama compartido Armando ↔ colaborador externo, y su perfil restringido."""
from __future__ import annotations

import pytest

from app.services import colaboradores as col

ARMANDO = {"id": 8, "nombre": "Armando", "rol": {"nivel": 3}, "permisos_secciones": {}}
SEBAS = {"id": 20, "nombre": "Sebastián", "rol": {"nivel": 1},
         "permisos_secciones": {"colaborador_externo": True, "tickets": True}}
CYNTHIA = {"id": 6, "nombre": "Cynthia", "rol": {"nivel": 3}, "permisos_secciones": {}}
OTRO_COLAB = {"id": 21, "nombre": "Otra colaboradora", "rol": {"nivel": 1},
              "permisos_secciones": {"colaborador_externo": True, "tickets": True}}
VICTOR = {"id": 7, "nombre": "Victor", "rol": {"nivel": 1}, "permisos_secciones": {"tickets": True}}


@pytest.fixture()
def base(monkeypatch, tmp_path):
    monkeypatch.setattr(col, "_DB_PATH", str(tmp_path / "c.db"))
    monkeypatch.setattr(col, "_nombre", lambda uid: f"u{uid}")
    monkeypatch.setattr(col, "colaboradores_ids", lambda: [20, 21])
    return col


def _doc(*nodos, flechas=()):
    return {"nodes": [{"id": n, "label": n.upper(), "x": i * 250, "y": 0, "carril": "conjunto", "tipo": "accion"}
                      for i, n in enumerate(nodos)],
            "edges": [{"id": f"{a}-{b}", "from": a, "to": b} for a, b in flechas]}


def test_quien_entra(base):
    assert col.es_miembro(ARMANDO) and col.es_miembro(SEBAS)
    assert not col.es_miembro(CYNTHIA)          # otro admin: no es su espacio
    assert not col.es_miembro(VICTOR)


def test_guardar_sube_la_version_y_deja_historia(base):
    d = col.crear("Relación comercial", 8, colaborador_id=20)
    d2 = col.guardar(d["id"], _doc("a", "b", flechas=[("a", "b")]), d["version"], 20, resumen="primer borrador")
    assert d2["version"] == 2 and d2["nodos"] == 2 and d2["flechas"] == 1
    assert [v["version"] for v in col.versiones(d["id"])] == [2, 1]


def test_si_el_otro_guardo_primero_no_se_pisa(base):
    d = col.crear("R", 8, colaborador_id=20)
    col.guardar(d["id"], _doc("a"), 1, 8)                 # Armando guarda sobre la v1
    with pytest.raises(col.Conflicto) as c:
        col.guardar(d["id"], _doc("x"), 1, 20)            # Sebastián también editaba la v1
    assert c.value.actual["version"] == 2
    assert col.obtener(d["id"])["doc"]["nodes"][0]["id"] == "a"


def test_restaurar_crea_una_version_nueva(base):
    d = col.crear("R", 8, colaborador_id=20)
    col.guardar(d["id"], _doc("a"), 1, 8)
    col.guardar(d["id"], _doc("b"), 2, 20)
    r = col.restaurar(d["id"], 2, 3, 8)
    assert r["version"] == 4 and r["doc"]["nodes"][0]["id"] == "a"


def test_una_flecha_suelta_no_se_guarda_y_los_ids_se_validan(base):
    limpio = col.validar_doc({"nodes": [{"id": "a", "x": 0, "y": 0}], "edges": [{"id": "e", "from": "a", "to": "zz"}]})
    assert limpio["edges"] == [] and limpio["nodes"][0]["carril"] == "conjunto"
    with pytest.raises(ValueError):
        col.validar_doc({"nodes": [{"id": "a"}, {"id": "a"}], "edges": []})


def test_la_traduccion_a_archify_usa_carriles_y_columnas(base):
    d = col.crear("R", 8, colaborador_id=20, doc={
        "nodes": [{"id": "a", "label": "Propuesta", "x": 0, "y": 0, "carril": "mckenna", "tipo": "accion"},
                  {"id": "b", "label": "Precio", "x": 250, "y": 0, "carril": "sebastian", "tipo": "dinero"},
                  {"id": "c", "label": "Firma", "x": 500, "y": 80, "carril": "conjunto", "tipo": "decision"}],
        "edges": [{"id": "e1", "from": "a", "to": "b", "label": "cotiza"}, {"id": "e2", "from": "b", "to": "c"}]})
    a = col.a_archify(d)
    assert a["diagram_type"] == "workflow" and a["schema_version"] == 2
    assert [l["id"] for l in a["lanes"]] == ["mckenna", "sebastian", "conjunto"]
    assert a["lanes"][0]["label"] == "McKenna Group SAS"
    assert {n["id"]: n["col"] for n in a["nodes"]} == {"a": 0, "b": 1, "c": 2}
    assert {n["id"]: n["type"] for n in a["nodes"]}["b"] == "messagebus"
    assert a["edges"][0]["label"] == "cotiza"


# ─── El perfil del colaborador en la API ─────────────────────────────────────

@pytest.fixture()
def cliente(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_API_TOKEN", "token-sistema")
    from flask import Flask

    from app.routes import register_routes
    from app.routes_colaboradores import register_colaboradores_routes
    from app.services import tickets_db

    monkeypatch.setattr(col, "_DB_PATH", str(tmp_path / "c.db"))
    monkeypatch.setattr(col, "colaboradores_ids", lambda: [20, 21])
    usuarios = {"tok-sebas": SEBAS, "tok-cynthia": CYNTHIA, "tok-armando": ARMANDO,
                "tok-otra": OTRO_COLAB}
    monkeypatch.setattr(tickets_db, "get_usuario_by_token", lambda t: usuarios.get(t))
    app = Flask(__name__)
    register_routes(app)
    register_colaboradores_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _h(t="tok-sebas"):
    return {"Authorization": f"Bearer {t}"}


def test_el_colaborador_trabaja_el_diagrama(cliente):
    r = cliente.post("/api/colaboradores/diagramas", headers=_h(), json={"titulo": "Relación comercial"})
    assert r.status_code == 201
    did = r.get_json()["id"]
    r = cliente.put(f"/api/colaboradores/diagramas/{did}", headers=_h(), json={"doc": _doc("a"), "version": 1})
    assert r.status_code == 200 and r.get_json()["version"] == 2
    r = cliente.put(f"/api/colaboradores/diagramas/{did}", headers=_h("tok-armando"), json={"doc": _doc("b"), "version": 1})
    assert r.status_code == 409 and r.get_json()["error"] == "conflicto"


def test_otro_administrador_no_entra_a_colaboradores(cliente):
    assert cliente.get("/api/colaboradores/diagramas", headers=_h("tok-cynthia")).status_code == 403


@pytest.mark.parametrize("metodo, ruta", [
    ("get", "/api/contabilidad/cc/balance-comprobacion"),
    ("get", "/api/sync/hoy"),
    ("get", "/api/tickets/misiones/"),
    ("post", "/api/tickets/1/asignar"),
    ("post", "/api/tickets/1/participantes"),
    ("delete", "/api/tickets/1"),
])
def test_el_resto_de_la_app_no_es_para_el_colaborador(cliente, metodo, ruta):
    assert getattr(cliente, metodo)(ruta, headers=_h(), json={}).status_code == 403


def test_solo_abre_tickets_entre_el_y_armando(cliente, monkeypatch):
    from app.services import tickets_db

    filas = {1: {"creado_por": 20, "asignado_a": 8}, 2: {"creado_por": 7, "asignado_a": 8}}

    class _Con:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params):
            class _R:
                def fetchone(_s):
                    return filas.get(params[0])
            return _R()

    monkeypatch.setattr(tickets_db, "_conn", lambda: _Con())
    r_ajeno = cliente.get("/api/tickets/2", headers=_h())
    assert r_ajeno.status_code == 403 and "no es entre tú y Armando" in r_ajeno.get_json()["error"]
    assert cliente.get("/api/tickets/1/asignar", headers=_h()).status_code == 403


def test_el_colaborador_solo_ve_a_armando_y_a_si_mismo():
    """Listas de usuarios, presencia: se filtran en el origen (un after_request genérico dejó pasar todo)."""
    from app.routes_tickets import _visibles_para

    todos = [{"id": i, "nombre": f"u{i}"} for i in (1, 6, 7, 8, 12, 20)]
    assert [u["id"] for u in _visibles_para(SEBAS, todos)] == [8, 20]
    assert _visibles_para(SEBAS, [6, 7, 8, 20]) == [8, 20]
    assert _visibles_para(SEBAS, [{"usuario_nombre": "x"}], "usuario_id") == []
    assert len(_visibles_para(VICTOR, todos)) == len(todos)          # a los demás no les cambia nada


def test_empresa_y_personas_son_carriles_distintos(base):
    assert {"mckenna", "armando", "sebastian", "conjunto"} <= set(col.CARRILES)
    viejo = col.validar_doc({"nodes": [{"id": "a", "carril": "colaborador"}], "edges": []})
    assert viejo["nodes"][0]["carril"] == "sebastian"       # la primera versión decía «colaborador»


# ─── Las flechas: por dónde tocan la caja y cómo se ven ──────────────────────

def test_la_flecha_guarda_sus_extremos_y_su_estilo(base):
    limpio = col.validar_doc({
        "nodes": [{"id": "a", "x": 0, "y": 0}, {"id": "b", "x": 300, "y": 0}],
        "edges": [{"id": "e", "from": "a", "to": "b", "label": "paga", "fromLado": "b", "toLado": "t",
                   "color": "#b91c1c", "grosor": 5, "trazo": "guiones", "forma": "escalon"}]})
    assert limpio["edges"][0] == {"id": "e", "from": "a", "to": "b", "label": "paga", "fromLado": "b",
                                  "toLado": "t", "color": "#b91c1c", "grosor": 5, "trazo": "guiones",
                                  "forma": "escalon"}


def test_el_estilo_de_la_flecha_no_acepta_lo_que_no_esta_en_la_lista(base):
    """Un color libre desde el cliente es texto entrando a un atributo SVG."""
    limpio = col.validar_doc({
        "nodes": [{"id": "a", "x": 0, "y": 0}, {"id": "b", "x": 1, "y": 0}],
        "edges": [{"id": "e", "from": "a", "to": "b", "color": '"onload=alert(1) x="', "grosor": 999,
                   "trazo": "<script>", "forma": "raro", "fromLado": "zz", "toLado": None}]})
    e = limpio["edges"][0]
    assert e["color"] == col.COLORES_FLECHA[0] and e["grosor"] == col.GROSOR_MAX
    assert (e["trazo"], e["forma"], e["fromLado"], e["toLado"]) == ("solida", "curva", "r", "l")


# ─── Un diagrama es de UNA pareja ────────────────────────────────────────────

def test_el_otro_colaborador_no_ve_el_diagrama_ajeno(base):
    de_sebas = col.crear("Relación con Sebastián", 20)
    de_otra = col.crear("Relación con la otra", 21)
    assert [d["id"] for d in col.listar(SEBAS)] == [de_sebas["id"]]
    assert [d["id"] for d in col.listar(OTRO_COLAB)] == [de_otra["id"]]
    assert {d["id"] for d in col.listar(ARMANDO)} == {de_sebas["id"], de_otra["id"]}   # el anfitrión, todos
    assert col.puede_ver(de_sebas["id"], OTRO_COLAB) is False
    assert col.obtener(de_sebas["id"], OTRO_COLAB) is None


def test_la_api_esconde_el_diagrama_de_la_otra_pareja(cliente):
    did = cliente.post("/api/colaboradores/diagramas", headers=_h(), json={"titulo": "R"}).get_json()["id"]
    for metodo, ruta in [("get", f"/api/colaboradores/diagramas/{did}"),
                         ("get", f"/api/colaboradores/diagramas/{did}/versiones"),
                         ("post", f"/api/colaboradores/diagramas/{did}/archivar"),
                         ("post", f"/api/colaboradores/diagramas/{did}/archify")]:
        r = getattr(cliente, metodo)(ruta, headers=_h("tok-otra"), json={})
        assert r.status_code == 404, ruta
    r = cliente.put(f"/api/colaboradores/diagramas/{did}", headers=_h("tok-otra"),
                    json={"doc": _doc("a"), "version": 1})
    assert r.status_code == 404
    assert cliente.get("/api/colaboradores/diagramas", headers=_h("tok-otra")).get_json()["diagramas"] == []


# ─── Qué sabe el colaborador de las personas que sí ve ───────────────────────

def test_del_anfitrion_solo_ve_nombre_y_foto():
    from app.routes_tickets import _publico_para

    armando = {"id": 8, "nombre": "Armando", "email": "a@x.co", "telefono": "300", "foto": "f.png",
               "documento_identidad": "79123456", "activo": 1,
               "permisos_secciones": {"pagos": True, "libro-mayor": True}, "rol": {"nivel": 3}}
    yo = {"id": 20, "nombre": "Sebastián", "email": "s@x.co", "permisos_secciones": {"colaborador_externo": True}}
    salida = {u["id"]: u for u in _publico_para(SEBAS, [armando, yo])}
    assert salida[8]["nombre"] == "Armando" and salida[8]["foto"] == "f.png"
    assert salida[8]["email"] == "" and salida[8]["telefono"] == "" and salida[8]["documento_identidad"] == ""
    assert salida[8]["permisos_secciones"] == {}        # la lista de módulos internos no sale
    assert salida[20]["email"] == "s@x.co"              # su propio registro va completo
    assert _publico_para(VICTOR, [armando])[0]["telefono"] == "300"   # a los de la casa no les cambia


def test_el_health_check_no_le_dice_que_integraciones_hay(cliente):
    r = cliente.get("/api/status", headers=_h())
    assert r.status_code == 200 and r.get_json() == {"estado": "activo", "version": "2.0.0", "servicios": {}}
    # A un administrador sí le responde el estado real (con sus servicios).
    assert "servicios" in cliente.get("/api/status", headers=_h("tok-armando")).get_json()
