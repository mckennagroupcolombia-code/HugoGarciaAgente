"""Mapa del sistema / anatomía de combos: forma de los datos y reglas de los eslabones.

Lee la copia local del catálogo y los archivos reales (solo lectura), igual que
scripts/auditar_catalogo_combos.py. No llama a Alegra, MeLi ni a ningún LLM.
"""
import pytest

from app.services import mapa_producto as M

ESLABONES = {"receta", "etiqueta_fisica", "documento", "ean", "etiqueta", "publicacion"}


@pytest.fixture(scope="module")
def combos():
    r = M.anatomia_combos()
    if not r["total"]:
        pytest.skip("sin copia local del catálogo de Alegra en este entorno")
    return r


def test_cada_combo_trae_todos_los_eslabones(combos):
    for c in combos["combos"]:
        assert set(c["eslabones"]) == ESLABONES, c["ref"]
        assert all(e["estado"] in {"ok", "aviso", "falta"} for e in c["eslabones"].values())
        assert c["ok"] + c["avisos"] + c["faltas"] == len(ESLABONES)


def test_combo_sin_materia_prima_es_falta_no_aviso(combos):
    """Un combo que solo descuenta empaque vende producto sin bajarlo del inventario."""
    for c in combos["combos"]:
        if c["componentes"] and not any(x["casilla"] == "materia_prima" for x in c["componentes"]):
            assert c["eslabones"]["receta"]["estado"] == "falta", c["ref"]


def test_sin_ean_no_puede_haber_etiqueta_por_codigo(combos):
    for c in combos["combos"]:
        if c["eslabones"]["ean"]["estado"] == "falta":
            assert "código de barras" not in c["eslabones"]["etiqueta"]["detalle"], c["ref"]


def test_filtros_coinciden_con_el_conteo(combos):
    for filtro in ("rotos", "sanos", "sin_etiqueta", "sin_documento", "sin_ean"):
        assert len(M.anatomia_combos(filtro=filtro)["combos"]) == combos["conteo"][filtro]


def test_la_unidad_de_un_empaque_no_es_materia_prima(combos):
    """ETQ30mL o FARAZU30mL son piezas: nunca deben caer en la casilla de materia prima."""
    for c in combos["combos"]:
        for x in c["componentes"]:
            if x["nombre"].upper().startswith(("ETIQUETA", "BOLSA", "ENVASE", "TAPA")):
                assert x["casilla"] != "materia_prima", (c["ref"], x["nombre"])


def test_mapa_suma_el_total_en_cada_tramo(combos):
    m = M.mapa_sistema()
    for t in m["producto"]:
        assert t["ok"] + t["aviso"] + t["falta"] == t["total"] == combos["total"]
    assert [p["id"] for p in m["ciclo_pago"]] == ["borrador", "pendiente", "aprobada", "en_banco", "pagada"]


def test_documento_huerfano_no_esta_usado_por_ningun_combo(combos):
    m = M.mapa_sistema()
    usados = {c["eslabones"]["documento"].get("archivo") for c in combos["combos"]}
    assert not ({h["archivo"] for h in m["docs_huerfanos"]} & usados)


# ─── Fijar el SKU de un documento: edita UNA línea, sobre una copia temporal ───

YAML_DOC = """titulo: PROPIONATO DE CALCIO
nombre_producto: PROPIONATO DE CALCIO
referencia: ''
sinonimos: Dipropanoato de calcio; CALCIUM PROPIONATE
# comentario que un yaml.dump borraría
descripcion: El propionato de calcio es la sal cálcica del ácido propiónico, un ácido
  carboxílico de cadena corta.
caracteristicas_fisicas:
  ph: 7,5 - 10,5 (solución acuosa al 10 %)
"""


@pytest.fixture
def docs_tmp(tmp_path, monkeypatch):
    from app.services import alegra_catalogo_db as ac
    from app.services import ficha_tecnica as ft

    monkeypatch.setattr(ft, "DATOS_DIR", tmp_path)
    monkeypatch.setattr(ac, "obtener_item", lambda ref: (
        {"reference": ref, "type": "kit"} if ref.upper().startswith("C-") else
        {"reference": ref, "type": "product"} if ref in ("PROCALg", "OTROg") else None))
    (tmp_path / "doc.yaml").write_text(YAML_DOC, encoding="utf-8")
    return tmp_path


def test_fijar_sku_cambia_solo_la_linea_de_referencia(docs_tmp):
    r = M.fijar_sku_documento("doc.yaml", "PROCALg")
    assert r["ok"]
    nuevo = (docs_tmp / "doc.yaml").read_text(encoding="utf-8")
    assert nuevo == YAML_DOC.replace("referencia: ''", "referencia: PROCALg")
    assert "# comentario que un yaml.dump borraría" in nuevo
    assert len(list((docs_tmp / "_respaldo_referencia").glob("doc.*.yaml"))) == 1


def test_fijar_sku_no_pisa_una_referencia_existente(docs_tmp):
    M.fijar_sku_documento("doc.yaml", "PROCALg")
    with pytest.raises(ValueError, match="no se pisa"):
        M.fijar_sku_documento("doc.yaml", "OTROg")
    assert M.fijar_sku_documento("doc.yaml", "PROCALg").get("sin_cambios")


def test_fijar_sku_rechaza_un_combo_y_un_sku_inexistente(docs_tmp):
    """La referencia es la materia prima: un `C-…` (kit) o un código que no existe no entran."""
    for malo in ("C-PROCAL500g", "NOEXISTEg"):
        with pytest.raises(ValueError, match="no es un producto de inventario"):
            M.fijar_sku_documento("doc.yaml", malo)
    assert (docs_tmp / "doc.yaml").read_text(encoding="utf-8") == YAML_DOC


def test_fijar_sku_no_sale_de_la_carpeta(docs_tmp):
    for malo in ("../doc.yaml", "sub/doc.yaml", "doc.txt", ""):
        with pytest.raises(ValueError):
            M.fijar_sku_documento(malo, "PROCALg")


def test_fijar_sku_inserta_la_linea_si_el_documento_no_la_trae(docs_tmp):
    (docs_tmp / "sin.yaml").write_text(YAML_DOC.replace("referencia: ''\n", ""), encoding="utf-8")
    M.fijar_sku_documento("sin.yaml", "PROCALg")
    import yaml

    d = yaml.safe_load((docs_tmp / "sin.yaml").read_text(encoding="utf-8"))
    assert d["referencia"] == "PROCALg" and d["titulo"] == "PROPIONATO DE CALCIO"


def test_no_se_ofrece_generar_ean_a_un_combo_con_la_receta_rota(combos):
    for c in combos["combos"]:
        if c["eslabones"]["receta"]["estado"] == "falta":
            assert "accion" not in c["eslabones"]["ean"] or c["eslabones"]["ean"]["accion"]["tipo"] != "generar_ean", c["ref"]


# ─── Diagramas de Archify: el índice del panel y las fuentes no se pueden desincronizar ───

def test_indice_de_diagramas_y_fuentes_coinciden():
    import json
    from pathlib import Path

    d = Path(__file__).resolve().parents[1] / "docs" / "arquitectura"
    tipos = {"workflow", "dataflow", "architecture", "sequence", "lifecycle"}
    fuentes = {p.name.split(".")[0] for p in d.glob("*.json") if len(p.name.split(".")) == 3 and p.name.split(".")[1] in tipos}
    indice = [x["nombre"] for x in json.loads((d / "indice.json").read_text(encoding="utf-8"))["diagramas"]]
    assert len(indice) == len(set(indice)), "diagrama repetido en el índice"
    assert set(indice) == fuentes, f"sin fuente: {set(indice) - fuentes} · sin entrada en el índice: {fuentes - set(indice)}"


def test_los_flujos_respetan_los_limites_de_archify_workflow():
    """6 columnas (0..5) y etiquetas de arista cortas: una etiqueta larga vuelve la ruta imposible."""
    import json
    from pathlib import Path

    for p in (Path(__file__).resolve().parents[1] / "docs" / "arquitectura").glob("*.workflow.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        ids = {n["id"] for n in d["nodes"]}
        carriles = {c["id"] for c in d["lanes"]}
        for n in d["nodes"]:
            assert 0 <= n["col"] <= 5, (p.name, n["id"])
            assert n["lane"] in carriles, (p.name, n["id"])
        for e in d["edges"]:
            assert e["from"] in ids and e["to"] in ids, (p.name, e["id"])
            assert len(e.get("label") or "") <= 20, (p.name, e["id"], e.get("label"))
