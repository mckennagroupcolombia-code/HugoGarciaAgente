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
    # Una forma inválida cae al DEFECTO, que desde 25-sep-2026 es recta (los tableros se leen mejor).
    assert (e["trazo"], e["forma"], e["fromLado"], e["toLado"]) == ("solida", col.FORMA_DEFECTO, "r", "l")
    assert col.FORMA_DEFECTO == "recta"


# ─── Contenido real de la caja (tablero de proyecto) ─────────────────────────

def test_los_campos_ricos_se_normalizan_y_se_topan(base):
    limpio = col.validar_doc({"nodes": [{
        "id": "a", "label": "Fabricar", "x": 0, "y": 0,
        "imagen": "1-foto.jpg", "tiempo_min": "90",
        "costo": {"monto": "12500", "moneda": "XX"},      # moneda inválida → COP
        "precio": {"monto": -5, "moneda": "USD"},          # negativo → se descarta
        "variables": {"como": "a mano", "quien": "x"},     # quien no es una variable
        "datos": [{"campo": "medida", "valor": "40 cm"}] * 20,   # más de 8 → se recorta
        "consecuencias": [{"si": "falta material", "entonces": "se para", "medida": "reponer"}],
        "adjuntos": [{"id": "1-f.pdf", "tipo": "raro"}, {"id": "", "tipo": "pdf"}],
    }], "edges": []})
    n = limpio["nodes"][0]
    assert n["tiempo_min"] == 90.0
    assert n["costo"] == {"monto": 12500.0, "moneda": "COP"}
    assert "precio" not in n                                # el negativo no entra
    assert n["variables"] == {"como": "a mano"}             # quien queda fuera
    assert len(n["datos"]) == 8
    assert n["consecuencias"][0]["medida"] == "reponer"
    assert n["adjuntos"] == [{"id": "1-f.pdf", "nombre": "", "tipo": "imagen"}]  # tipo inválido→imagen; el vacío se descarta
    assert "enlaceApp" not in n and "imagen" in n


def test_una_caja_sin_campos_ricos_no_los_gana(base):
    """La caja de siempre sigue siendo mínima: nada de claves vacías."""
    n = col.validar_doc(_doc("a"))["nodes"][0]
    assert set(n) == {"id", "label", "sublabel", "tipo", "carril", "x", "y"}


def test_media_solo_se_sirve_a_su_propio_diagrama(base, tmp_path, monkeypatch):
    monkeypatch.setattr(col, "_MEDIA_DIR", tmp_path / "media")
    ficha = col.guardar_media(7, b"%PDF-1.4 factura", "factura.pdf")
    assert ficha["tipo"] == "pdf" and ficha["id"].startswith("7-")
    assert col.media_de_diagrama(ficha["id"], 7) is not None
    assert col.media_de_diagrama(ficha["id"], 8) is None            # otro diagrama: no lo ve
    assert col.media_de_diagrama("../../etc/passwd", 7) is None     # nada de rutas relativas


# ─── Consenso: propuestas, votos y desempate por turno ───────────────────────

def _consenso(base):
    d = col.crear("Decidir", 8, colaborador_id=20)
    doc = {"nodes": [{"id": "c", "label": "?", "tipo": "consenso", "carril": "conjunto", "x": 0, "y": 0}], "edges": []}
    d = col.guardar(d["id"], doc, d["version"], 8)
    col.accion_consenso(d["id"], 8, "c", "proponer", texto="Bolsa")
    col.accion_consenso(d["id"], 20, "c", "proponer", texto="Caja")
    return d["id"]


def test_consenso_empate_lo_decide_el_turno_y_se_alterna(base):
    did = _consenso(base)
    col.accion_consenso(did, 8, "c", "votar", propuesta="p8")
    col.accion_consenso(did, 20, "c", "votar", propuesta="p20")
    d = col.accion_consenso(did, 8, "c", "cerrar")              # empate → turno (8 por defecto)
    assert d["doc"]["nodes"][0]["resuelto"] == {"propuesta": "p8", "modo": "turno", "por": 8}
    assert d["turno_actual"] == 20                              # el turno pasó al otro
    col.accion_consenso(did, 8, "c", "reabrir")
    d = col.accion_consenso(did, 8, "c", "cerrar")             # sigue 1-1 → ahora decide 20
    assert d["doc"]["nodes"][0]["resuelto"]["por"] == 20
    assert d["turno_actual"] == 8


def test_consenso_por_acuerdo_no_toca_el_turno(base):
    did = _consenso(base)
    col.accion_consenso(did, 8, "c", "votar", propuesta="p8")
    d = col.accion_consenso(did, 20, "c", "votar", propuesta="p8")   # convergen
    assert d["turno_actual"] is None
    d = col.accion_consenso(did, 8, "c", "cerrar")
    assert d["doc"]["nodes"][0]["resuelto"] == {"propuesta": "p8", "modo": "acuerdo"}
    assert d["turno_actual"] is None


def test_producto_y_competencia_guardan_datos_reales(base):
    limpio = col.validar_doc({"nodes": [
        {"id": "p", "label": "Collar M", "tipo": "producto", "x": 0, "y": 0, "sku": "C-COLLAR-M",
         "precio": {"monto": 45000, "moneda": "COP"}, "url": "https://tienda.co/collar",
         "empaque": {"nombre": "Bolsa kraft", "costo": {"monto": 800, "moneda": "COP"}},
         "componentes": [{"nombre": "Aros", "cantidad": "40 un", "costo": {"monto": 6000, "moneda": "COP"}},
                         {"nombre": ""}] + [{"nombre": f"x{i}"} for i in range(20)]},
        {"id": "r", "label": "Rival", "tipo": "competencia", "x": 1, "y": 0, "plataforma": "Instagram",
         "url": "javascript:alert(1)", "precio": {"monto": 52000, "moneda": "COP"}},
    ], "edges": []})
    p, r = limpio["nodes"]
    assert p["tipo"] == "producto" and p["sku"] == "C-COLLAR-M"
    assert p["empaque"] == {"nombre": "Bolsa kraft", "costo": {"monto": 800.0, "moneda": "COP"}}
    assert p["componentes"][0] == {"nombre": "Aros", "cantidad": "40 un", "costo": {"monto": 6000.0, "moneda": "COP"}}
    assert len(p["componentes"]) == col.MAX_COMPONENTES      # el vacío se descarta y se topa
    assert p["url"] == "https://tienda.co/collar"
    assert r["tipo"] == "competencia" and r["plataforma"] == "Instagram"
    assert "url" not in r                                     # un javascript: nunca llega al <a href>


def test_retirar_propuesta_borra_sus_votos(base):
    did = _consenso(base)
    col.accion_consenso(did, 8, "c", "votar", propuesta="p20")
    d = col.accion_consenso(did, 20, "c", "proponer", texto="")   # Sebastián retira la suya
    n = d["doc"]["nodes"][0]
    assert [p["id"] for p in n["propuestas"]] == ["p8"]
    assert "8" not in n.get("votos", {})                          # su voto a p20 se fue con la propuesta


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


def test_la_obra_sube_a_medida_que_el_paso_se_llena():
    """Regla de la vista Edificio (misma en colaboradores/obra.ts): los casos fijan ambas."""
    from app.services import colaboradores as c
    vacio = {"id": "a", "tipo": "accion", "label": "x"}
    assert c.etapa_obra(vacio) == 0
    assert c.etapa_obra({**vacio, "variables": {"como": "a"}}) == 1                       # 1/5
    assert c.etapa_obra({**vacio, "variables": {"como": "a", "donde": "b"}}) == 2          # 2/5
    assert c.etapa_obra({**vacio, "variables": {"como": "a", "donde": "b", "porque": "c"}}) == 2   # 3/5 = 0,6
    cuatro = {**vacio, "variables": {"como": "a", "donde": "b", "porque": "c"}, "tiempo_min": 30}
    assert c.etapa_obra(cuatro) == 3                                                         # 4/5
    assert c.etapa_obra({**cuatro, "costo": {"monto": 1, "moneda": "COP"}}) == 4            # 5/5
    # Un consenso no se termina sin decisión, aunque tenga todo lo demás.
    cons = {"id": "k", "tipo": "consenso", "asunto": "a", "propuestas": [{"id": "1"}, {"id": "2"}], "votos": {"8": "1"}}
    assert c.etapa_obra(cons) == 3
    assert c.etapa_obra({**cons, "resuelto": {"propuesta": "1"}}) == 4
    r = c.resumen_obra({"nodes": [vacio, {**cuatro, "costo": {"monto": 1, "moneda": "COP"}}]})
    assert r == {"pisos": 2, "terminados": 1, "avance": 0.5}
