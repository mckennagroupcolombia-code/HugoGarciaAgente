"""Revisión global de pesos, medidas y empaques (2-oct-2026). MeLi y Alegra simulados."""
from __future__ import annotations

import pytest

ADMIN = {"id": 8, "nombre": "Armando"}
JENNI = {"id": 10, "nombre": "Jenniffer"}
OTRO = {"id": 99, "nombre": "Otro"}

ITEMS = {
    "C-POL500g": {"name": "POLVO 500g", "status": "active"},
    "C-POL250g": {"name": "POLVO 250g", "status": "active"},
    "C-OTRO500g": {"name": "OTRO POLVO 500g", "status": "active"},
    "C-LIQ500mL": {"name": "LIQUIDO 500mL", "status": "active"},
    "C-SUERO30mL": {"name": "SUERO 30mL", "status": "active"},
    "C-RARO": {"name": "PRODUCTO SIN ENVASE", "status": "active"},
    "C-VIEJO": {"name": "COMBO INACTIVO", "status": "inactive"},
    "BLS13X21": {"name": "BOLSA 13 X 21 CMS"},
    "BOLSEGBLAUn": {"name": "BOLSA DE SEGURIDAD BLANCA"},
    "ENVBTR500cc": {"name": "ENV. BOTERO 500CC"},
    "FARAZU30mL": {"name": "FRASCO AZUL 30 ML"},
    "BOX11X4X4": {"name": "CAJA 11 X 4 X 4"},
    "ETQ": {"name": "ETIQUETA 3 X 2"},
    "POLg": {"name": "POLVO G"},
    "OTROg": {"name": "OTRO G"},
    "LIQmL": {"name": "LIQUIDO ML"},
    "SUEmL": {"name": "SUERO ML"},
    "BTMS50g": {"name": "BTMS 50 G"},
}
RECETAS = {
    "C-POL500g": [("POLg", 500), ("BLS13X21", 1), ("BOLSEGBLAUn", 1), ("ETQ", 1)],
    "C-POL250g": [("POLg", 250), ("BLS13X21", 1), ("BOLSEGBLAUn", 1)],
    "C-OTRO500g": [("OTROg", 500), ("BLS13X21", 1), ("BOLSEGBLAUn", 1)],
    "C-LIQ500mL": [("LIQmL", 500), ("ENVBTR500cc", 1), ("BOLSEGBLAUn", 1)],
    "C-SUERO30mL": [("SUEmL", 30), ("FARAZU30mL", 1), ("BOX11X4X4", 1)],
    "C-RARO": [("BTMS50g", 125), ("ETQ", 1)],
    "C-VIEJO": [("POLg", 100), ("BLS13X21", 1)],
}


def _pub(id_, peso=None, medidas=(None, None, None)):
    return {"id": id_, "status": "active", "titulo": id_, "thumbnail": "", "peso_g": peso,
            "largo_cm": medidas[0], "ancho_cm": medidas[1], "alto_cm": medidas[2]}


MELI = {
    "C-POL500G": [_pub("MCO1", 2900, (10, 10, 10))],
    "C-OTRO500G": [_pub("MCO2", 630, (21, 17, 6))],
    "C-LIQ500ML": [_pub("MCO3", 900, (22, 13, 9)), _pub("MCO4", 900, (22, 13, 9))],
}


@pytest.fixture()
def R(monkeypatch, tmp_path):
    from app.services import insumos, revision_empaque, tickets_db

    monkeypatch.setattr(revision_empaque, "DB_PATH", str(tmp_path / "rev.db"))
    monkeypatch.setattr(insumos, "_catalogo", lambda: (ITEMS, RECETAS))
    monkeypatch.setattr(revision_empaque, "_token", lambda: "tok")
    monkeypatch.setattr(revision_empaque, "_publicaciones_por_sku", lambda token: MELI)
    monkeypatch.setattr(tickets_db, "es_admin_efectivo", lambda u: (u or {}).get("id") == 8)
    yield revision_empaque


def test_grupos_por_tipo_de_empaque(R):
    combos = {c["sku"]: c for c in R._combos_activos()}
    assert "C-VIEJO" not in combos
    # La misma bolsa con distinto contenido no mide igual: se separa por presentación.
    assert combos["C-POL500g"]["grupo_clave"] == combos["C-OTRO500g"]["grupo_clave"] == "BLS13X21 · 500 g"
    assert combos["C-POL250g"]["grupo_clave"] == "BLS13X21 · 250 g"
    # Envase rígido: no depende del contenido. La bolsa de seguridad no distingue empaques.
    assert combos["C-LIQ500mL"]["grupo_clave"] == "ENVBTR500cc"
    assert combos["C-SUERO30mL"]["grupo_clave"] == "FARAZU30mL + BOX11X4X4"
    assert combos["C-RARO"]["grupo_clave"] == "solo:C-RARO"


def test_presentacion_sale_de_la_receta_no_del_sku(R):
    combos = {c["sku"]: c for c in R._combos_activos()}
    assert combos["C-RARO"]["presentacion"] == "125 g"
    assert combos["C-LIQ500mL"]["presentacion"] == "500 mL"
    assert R.presentacion("C-X", [("Pg", 1000, "otro")]) == "1 kg"


def test_flujo_completo_y_diferencia_contra_meli(R):
    rid = R.crear_revision(ADMIN, asignado_id=10)
    est = R.estado(rid, JENNI)
    assert est["progreso"]["total"] == 6
    assert not est["puede_aprobar"]

    R.guardar_producto(rid, "C-POL500g", {"peso_g": "630", "empaque_ok": ["BLS13X21", "NO-ESTA"], "caja": "ninguna"}, JENNI)
    R.guardar_producto(rid, "C-OTRO500g", {"peso_g": 632}, JENNI)
    R.guardar_grupo(rid, "BLS13X21 · 500 g", {"largo_cm": 21, "ancho_cm": "16,5", "alto_cm": 6}, JENNI)

    est = R.estado(rid, ADMIN)
    prod = {p["sku"]: p for p in est["productos"]}
    assert prod["C-POL500g"]["empaque_ok"] == ["BLS13X21"]  # lo que no está en la receta se descarta
    assert prod["C-POL500g"]["listo"] and prod["C-POL500g"]["diferencia"]  # 2900 g y 10×10×10 en MeLi
    # 632 g vs 630 g y 16,5 → 17 cm: dentro de la tolerancia.
    assert prod["C-OTRO500g"]["listo"] and not prod["C-OTRO500g"]["diferencia"]
    assert est["progreso"]["grupos_medidos"] == 1
    assert est["puede_aprobar"]


def test_medidas_propias_mandan_sobre_las_del_grupo(R):
    rid = R.crear_revision(ADMIN, asignado_id=10)
    R.guardar_grupo(rid, "BLS13X21 · 500 g", {"largo_cm": 21, "ancho_cm": 17, "alto_cm": 6}, JENNI)
    R.guardar_producto(rid, "C-POL500g", {"peso_g": 640, "largo_cm": 23, "ancho_cm": 18, "alto_cm": 7}, JENNI)
    p = next(x for x in R.estado(rid, JENNI)["productos"] if x["sku"] == "C-POL500g")
    assert p["medidas_finales"] == [23, 18, 7]


def test_validaciones(R):
    rid = R.crear_revision(ADMIN, asignado_id=10)
    with pytest.raises(ValueError):
        R.guardar_producto(rid, "C-POL500g", {"peso_g": ""}, JENNI)
    with pytest.raises(ValueError):
        R.guardar_producto(rid, "C-POL500g", {"peso_g": 60000}, JENNI)
    with pytest.raises(ValueError):
        R.guardar_producto(rid, "C-POL500g", {"peso_g": 600, "largo_cm": 20}, JENNI)  # medidas incompletas
    with pytest.raises(ValueError):
        R.guardar_producto(rid, "C-POL500g", {"peso_g": 600, "caja": "otra"}, JENNI)  # sin decir cuál
    with pytest.raises(ValueError):
        R.guardar_producto(rid, "C-POL500g", {"omitido": True}, JENNI)  # sin motivo
    with pytest.raises(ValueError):
        R.guardar_grupo(rid, "BLS13X21 · 500 g", {"largo_cm": 21, "ancho_cm": 17}, JENNI)
    with pytest.raises(LookupError):
        R.guardar_producto(rid, "C-NO-EXISTE", {"peso_g": 100}, JENNI)
    R.guardar_producto(rid, "C-POL250g", {"omitido": True, "motivo_omitido": "no hay en bodega"}, JENNI)
    assert R.estado(rid, JENNI)["progreso"]["omitidos"] == 1


def test_permisos(R):
    rid = R.crear_revision(ADMIN, asignado_id=10)
    with pytest.raises(PermissionError):
        R.estado(rid, OTRO)
    with pytest.raises(PermissionError):
        R.guardar_producto(rid, "C-POL500g", {"peso_g": 600}, OTRO)
    with pytest.raises(PermissionError):
        R.aplicar_meli(rid, ["C-POL500g"], JENNI)
    with pytest.raises(PermissionError):
        R.refrescar_meli(rid, JENNI)


def test_atributos_meli_redondean_medidas_hacia_arriba():
    from app.services.revision_empaque import atributos_meli

    a = {x["id"]: x["value_name"] for x in atributos_meli(629.6, (20.1, 16.5, 6.0))}
    assert a == {"SELLER_PACKAGE_WEIGHT": "630 g", "SELLER_PACKAGE_LENGTH": "21 cm",
                 "SELLER_PACKAGE_WIDTH": "17 cm", "SELLER_PACKAGE_HEIGHT": "6 cm"}


def test_aplicar_relee_y_no_toca_publicaciones_de_otro_sku(R, monkeypatch):
    rid = R.crear_revision(ADMIN, asignado_id=10)
    R.guardar_producto(rid, "C-LIQ500mL", {"peso_g": 930}, JENNI)
    R.guardar_grupo(rid, "ENVBTR500cc", {"largo_cm": 22, "ancho_cm": 13, "alto_cm": 9}, JENNI)

    escritos = []

    class Resp:
        def __init__(self, ok=True, body=None):
            self.ok, self._body, self.status_code, self.text = ok, body or {}, 200 if ok else 400, ""

        def json(self):
            return self._body

    def get(url, **kw):
        id_ = url.rsplit("/", 1)[-1]
        sku = "C-LIQ500mL" if id_ == "MCO3" else "C-OTRA-COSA"
        return Resp(body={"id": id_, "status": "active", "attributes": [{"id": "SELLER_SKU", "value_name": sku}]})

    def put(url, json=None, **kw):
        escritos.append((url.rsplit("/", 1)[-1], json))
        return Resp()

    monkeypatch.setattr(R.requests, "get", get)
    monkeypatch.setattr(R.requests, "put", put)
    r = R.aplicar_meli(rid, ["C-LIQ500mL"], ADMIN)["resultados"][0]
    assert [e[0] for e in escritos] == ["MCO3"]          # MCO4 ya tiene otro SKU: no se toca
    assert not r["ok"]                                    # queda pendiente para revisarlo
    mco4 = next(p for p in r["publicaciones"] if p["id"] == "MCO4")
    assert not mco4["ok"] and "C-OTRA-COSA" in mco4["error"]


def test_entregar_solo_cambia_estado_si_esta_abierta(R, monkeypatch):
    from app.services import tickets_db

    rid = R.crear_revision(ADMIN, asignado_id=10, ticket_id=500)
    estados = {"actual": "en_proceso"}
    llamadas = []
    monkeypatch.setattr(tickets_db, "agregar_comentario", lambda *a, **k: llamadas.append("comentario"))
    monkeypatch.setattr(tickets_db, "get_ticket", lambda tid, u: {"id": tid, "estado": estados["actual"]})

    def cambiar(tid, nuevo, usuario, motivo="", **kw):
        llamadas.append(nuevo)
        estados["actual"] = "esperando_aprobacion"
        return True, None

    monkeypatch.setattr(tickets_db, "cambiar_estado", cambiar)
    assert "Revisión entregada" in R.entregar(rid, JENNI)["mensaje"]
    R.entregar(rid, JENNI)  # ya está esperando aprobación: solo comenta
    assert llamadas == ["comentario", "resuelto", "comentario"]
    assert R.estado(rid, JENNI)["revision"]["entregada_en"]
