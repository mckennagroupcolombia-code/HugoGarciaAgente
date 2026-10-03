"""Tablero del proyecto de Colaboradores: tarjetas, turno, acuerdos, ritmo y lectura del chat."""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timedelta

import pytest

from app.services import colab_tablero as tb
from app.services import colaboradores as col
from tests.test_colaboradores import _h, cliente  # noqa: F401  (fixture de la API)


@pytest.fixture()
def proyecto(monkeypatch, tmp_path):
    monkeypatch.setattr(col, "_DB_PATH", str(tmp_path / "c.db"))
    monkeypatch.setattr(col, "_MEDIA_DIR", tmp_path / "media")
    monkeypatch.setattr(col, "_nombre", lambda uid: f"u{uid}")
    monkeypatch.setattr(col, "colaboradores_ids", lambda: [20, 21])
    return col.crear("Collar persa", 8, colaborador_id=20)["id"]


def test_la_jugada_queda_en_la_cancha_del_otro(proyecto):
    t = tb.crear(proyecto, 8, {"tipo": "obstaculo", "titulo": "El broche se abre"})
    assert t["turno_de"] == 20 and t["turno_desde"] and t["estado"] == "abierto"
    r = tb.crear(proyecto, 20, {"tipo": "resultado", "titulo": "Primera venta", "fecha_hecho": "2026-10-03"})
    assert r["turno_de"] is None and r["fecha_hecho"] == "2026-10-03"
    # Resolverlo la saca de la cancha de todos.
    assert tb.editar(proyecto, t["id"], 20, {"estado": "hecho"})["turno_de"] is None


def test_turno_solo_entre_la_pareja_y_campos_saneados(proyecto):
    t = tb.crear(proyecto, 8, {"tipo": "tarea", "titulo": "x" * 500, "turno_de": 999,
                               "fecha_hecho": "ayer", "fuente": {"autor": "S", "texto": "  "}})
    assert len(t["titulo"]) == 200 and t["turno_de"] is None and t["fecha_hecho"] is None and t["fuente"] is None
    with pytest.raises(ValueError):
        tb.crear(proyecto, 8, {"tipo": "piso", "titulo": "a"})
    with pytest.raises(ValueError):
        tb.crear(proyecto, 8, {"tipo": "idea"})


def test_enlaces_solo_a_tarjetas_del_proyecto_y_se_caen_al_borrar(proyecto):
    a = tb.crear(proyecto, 8, {"tipo": "obstaculo", "titulo": "Broche"})
    b = tb.crear(proyecto, 20, {"tipo": "decision", "titulo": "Venderlo decorativo",
                                "enlaces": [{"a": a["id"], "rel": "resuelve"}, {"a": 9999, "rel": "resuelve"},
                                            {"a": a["id"], "rel": "otra"}]})
    assert b["enlaces"] == [{"a": a["id"], "rel": "resuelve"}]
    assert tb.editar(proyecto, b["id"], 8, {"enlaces": [{"a": b["id"], "rel": "bloquea"}]})["enlaces"] == []
    tb.editar(proyecto, b["id"], 8, {"enlaces": [{"a": a["id"], "rel": "resuelve"}]})
    tb.borrar(proyecto, a["id"], 8)
    assert [t["enlaces"] for t in tb.listar(proyecto)] == [[]]


def test_la_decision_se_toma_con_los_dos_y_editarla_reinicia_el_acuerdo(proyecto):
    d = tb.crear(proyecto, 8, {"tipo": "decision", "titulo": "Precio L a 75.000"})
    d = tb.acordar(proyecto, d["id"], 8, True)
    assert set(d["acuerdos"]) == {"8"} and d["estado"] == "abierto"
    d = tb.acordar(proyecto, d["id"], 20, True)
    assert d["estado"] == "hecho" and d["turno_de"] is None
    d = tb.editar(proyecto, d["id"], 20, {"titulo": "Precio L a 80.000"})
    assert d["acuerdos"] == {}


def test_media_ajena_no_entra_a_la_tarjeta(proyecto, tmp_path):
    otro = col.crear("Otro", 8, colaborador_id=20)["id"]
    (tmp_path / "media").mkdir()
    (tmp_path / "media" / f"{otro}-abc.jpg").write_bytes(b"x")
    (tmp_path / "media" / f"{proyecto}-def.jpg").write_bytes(b"x")
    t = tb.crear(proyecto, 8, {"tipo": "resultado", "titulo": "Foto",
                               "adjuntos": [{"id": f"{otro}-abc.jpg"}, {"id": f"{proyecto}-def.jpg"}]})
    assert [a["id"] for a in t["adjuntos"]] == [f"{proyecto}-def.jpg"]


def test_ritmo_ver_y_responder():
    t0 = datetime(2026, 10, 1, 10, 0)
    ev = [(8, "escribio", t0),
          (20, "visto", t0 + timedelta(minutes=30)),       # tardó 30 min en verlo
          (20, "escribio", t0 + timedelta(minutes=40)),    # y 10 min en responder
          (8, "escribio", t0 + timedelta(minutes=41)),     # Armando respondió sin «visto» propio
          (20, "escribio", t0 + timedelta(hours=5))]       # Sebastián, sin «visto»: lo vio al responder
    r = tb.calcular_ritmo(ev, [8, 20], ahora=t0 + timedelta(hours=6))
    s = r["20"]
    assert s["en_ver"]["n"] == 2 and s["en_ver"]["mediana_min"] == pytest.approx((30 + 259) / 2)
    assert s["en_responder"]["mediana_min"] == pytest.approx(5)          # (10 + 0) / 2
    assert r["8"]["total"]["n"] == 1 and r["8"]["total"]["mediana_min"] == pytest.approx(1)
    assert r["8"]["esperando_desde"] == "2026-10-01 15:00:00" and r["8"]["espera_min"] == pytest.approx(60)
    assert r["20"]["esperando_desde"] is None


def test_visto_solo_si_hay_algo_nuevo_del_otro(proyecto):
    assert tb.marcar_visto(proyecto, 20) is False          # nada del otro todavía
    tb.crear(proyecto, 8, {"tipo": "idea", "titulo": "Chapa con el nombre"})
    assert tb.marcar_visto(proyecto, 20) is True
    assert tb.marcar_visto(proyecto, 20) is False          # ya lo vio
    assert tb.marcar_visto(proyecto, 8) is False           # lo propio no se «ve»


CHAT_IOS = (
    "[8/7/26, 11:28:25 AM] Sebastian 🤓: Hola tio\n"
    "[8/7/26, 11:30:25 AM] Tú: Hola\nsegunda línea\n"
    "[8/7/26, 1:30:25 PM] Sebastian 🤓: ‎<imagen omitida> la foto\n"
)


def test_lee_el_chat_de_ios_y_de_android():
    m = tb.leer_chat(CHAT_IOS)
    assert [x["autor"] for x in m] == ["Sebastian 🤓", "Tú", "Sebastian 🤓"]
    assert m[1]["texto"] == "Hola\nsegunda línea" and m[2]["fecha"] == "2026-08-07 13:30:25"
    a = tb.leer_chat("25/09/2026, 2:05 p. m. - Ana: hola\n25/09/2026, 14:07 - Beto: qué más")
    assert [x["fecha"] for x in a] == ["2026-09-25 14:05:00", "2026-09-25 14:07:00"]


def test_lee_el_zip_exportado():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("chat.txt", CHAT_IOS)
        z.writestr("chat.md", "no")
    assert len(tb.leer_chat(buf.getvalue(), "Sebastian.zip")) == 3


def test_ritmo_del_chat_solo_numeros():
    r = tb.ritmo_chat(tb.leer_chat(CHAT_IOS), {"Tú": 8, "Sebastian 🤓": 20})
    assert r["personas"]["8"]["mediana_min"] == 2.0 and r["personas"]["20"]["mediana_min"] == 120.0
    assert "texto" not in json.dumps(r)


def test_api_del_tablero_para_la_pareja(cliente):  # noqa: F811
    did = cliente.post("/api/colaboradores/diagramas", headers=_h(), json={"titulo": "Collar"}).get_json()["id"]
    r = cliente.post(f"/api/colaboradores/diagramas/{did}/tarjetas", headers=_h("tok-armando"),
                     json={"tipo": "meta", "titulo": "10 ventas"})
    assert r.status_code == 201
    tid = r.get_json()["id"]
    t = cliente.get(f"/api/colaboradores/diagramas/{did}/tablero", headers=_h()).get_json()
    assert [x["titulo"] for x in t["tarjetas"]] == ["10 ventas"] and set(t["participantes"]) == {"8", "20"}
    assert cliente.post(f"/api/colaboradores/diagramas/{did}/tablero/visto", headers=_h()).get_json()["registrado"]
    assert cliente.patch(f"/api/colaboradores/diagramas/{did}/tarjetas/{tid}", headers=_h(),
                         json={"texto": "antes de diciembre"}).status_code == 200
    r = cliente.post(f"/api/colaboradores/diagramas/{did}/chat", headers=_h(),
                     json={"texto": CHAT_IOS, "autores": {"Tú": 20, "Sebastian 🤓": 8}, "guardar_ritmo": True})
    assert r.status_code == 200 and len(r.get_json()["mensajes"]) == 3
    guardado = cliente.get(f"/api/colaboradores/diagramas/{did}/tablero", headers=_h()).get_json()["ritmo"]["chat"]
    assert guardado["mensajes"] == 3 and "Hola" not in json.dumps(guardado)
    # La otra pareja no ve ni toca este tablero.
    for metodo, ruta in [("get", f"/api/colaboradores/diagramas/{did}/tablero"),
                         ("post", f"/api/colaboradores/diagramas/{did}/tarjetas"),
                         ("patch", f"/api/colaboradores/diagramas/{did}/tarjetas/{tid}"),
                         ("post", f"/api/colaboradores/diagramas/{did}/chat")]:
        assert getattr(cliente, metodo)(ruta, headers=_h("tok-otra"), json={"tipo": "idea", "titulo": "x"}).status_code == 404
    assert cliente.delete(f"/api/colaboradores/diagramas/{did}/tarjetas/{tid}", headers=_h()).status_code == 200


# ─── El mapa: cladograma por linaje (3-oct-2026) ────────────────────────────

def test_cada_tarjeta_cuelga_de_una_y_no_hay_ciclos(proyecto):
    a = tb.crear(proyecto, 8, {"tipo": "origen", "titulo": "Collares de Armando"})
    b = tb.crear(proyecto, 20, {"tipo": "resultado", "titulo": "Primeros tejidos", "padre_id": a["id"]})
    c = tb.crear(proyecto, 8, {"tipo": "obstaculo", "titulo": "Aros grandes", "padre_id": b["id"]})
    assert (b["padre_id"], c["padre_id"]) == (a["id"], b["id"])
    with pytest.raises(ValueError):
        tb.editar(proyecto, a["id"], 8, {"padre_id": c["id"]})        # a saldría de su propia rama
    with pytest.raises(ValueError):
        tb.editar(proyecto, a["id"], 8, {"padre_id": a["id"]})
    with pytest.raises(ValueError):
        tb.crear(proyecto, 8, {"tipo": "idea", "titulo": "x", "padre_id": 99999})
    assert tb.editar(proyecto, c["id"], 8, {"padre_id": None})["padre_id"] is None


def test_al_borrar_sus_ramas_suben_al_abuelo(proyecto):
    a = tb.crear(proyecto, 8, {"tipo": "origen", "titulo": "A"})
    b = tb.crear(proyecto, 8, {"tipo": "resultado", "titulo": "B", "padre_id": a["id"]})
    c = tb.crear(proyecto, 8, {"tipo": "idea", "titulo": "C", "padre_id": b["id"]})
    tb.borrar(proyecto, b["id"], 8)
    assert next(t for t in tb.listar(proyecto) if t["id"] == c["id"])["padre_id"] == a["id"]


def test_el_padre_es_del_mismo_proyecto(proyecto):
    otro = col.crear("Otro", 8, colaborador_id=20)["id"]
    ajena = tb.crear(otro, 8, {"tipo": "idea", "titulo": "ajena"})
    with pytest.raises(ValueError):
        tb.crear(proyecto, 8, {"tipo": "idea", "titulo": "x", "padre_id": ajena["id"]})


def test_absorber_el_edificio_una_sola_vez(proyecto):
    doc = {"nodes": [
        {"id": "a", "label": "Comprar aros", "sublabel": "Telas y herrajes", "x": 0, "y": 0, "carril": "sebastian",
         "tipo": "accion", "variables": {"como": "en moto"}, "tiempo_min": 120},
        {"id": "b", "label": "Collar M", "x": 0, "y": 0, "carril": "sebastian", "tipo": "producto", "sku": "C-1",
         "precio": {"monto": 65000, "moneda": "COP"}},
        {"id": "c", "label": "Nuevo paso", "x": 0, "y": 0, "carril": "conjunto", "tipo": "accion"},
        {"id": "d", "label": "¿Qué decidimos?", "x": 0, "y": 0, "carril": "conjunto", "tipo": "consenso"}],
        "edges": []}
    col.guardar(proyecto, doc, 1, 8)
    r = tb.absorber_edificio(proyecto, 8)
    assert r["traidas"] == 2 and r["saltadas"] == 2
    ts = tb.listar(proyecto)
    grupo = next(t for t in ts if t["titulo"].startswith("Proceso"))
    hijos = [t for t in ts if t["padre_id"] == grupo["id"]]
    assert {t["titulo"] for t in hijos} == {"Comprar aros", "Collar M"}
    aros = next(t for t in hijos if t["titulo"] == "Comprar aros")
    assert "Cómo: en moto" in aros["texto"] and "Tiempo: 120 min" in aros["texto"] and aros["turno_de"] is None
    assert "Precio: 65.000 COP" in next(t for t in hijos if t["titulo"] == "Collar M")["texto"]
    assert tb.absorber_edificio(proyecto, 8)["traidas"] == 0          # idempotente
    assert len(tb.listar(proyecto)) == 3
