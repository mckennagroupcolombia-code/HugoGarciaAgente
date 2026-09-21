"""Mapa del sistema / anatomía de combos: forma de los datos y reglas de los eslabones.

Lee la copia local del catálogo y los archivos reales (solo lectura), igual que
scripts/auditar_catalogo_combos.py. No llama a Alegra, MeLi ni a ningún LLM.
"""
import pytest

from app.services import mapa_producto as M
A = M._auditoria()  # las reglas compartidas de scripts/auditar_catalogo_combos.py

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
    with pytest.raises(ValueError, match="otro producto activo"):
        M.fijar_sku_documento("doc.yaml", "OTROg")
    assert M.fijar_sku_documento("doc.yaml", "PROCALg").get("sin_cambios")


def test_fijar_sku_corrige_una_referencia_que_ya_no_es_un_producto(docs_tmp):
    """`ALUg` en el documento cuando el producto es `ALUALLg`: era un enlace roto, no una decisión.
    Antes se rechazaba y el taller no dejaba unir ese documento (2026-09-21)."""
    (docs_tmp / "doc.yaml").write_text(YAML_DOC.replace("referencia: ''", "referencia: VIEJOg"), encoding="utf-8")
    r = M.fijar_sku_documento("doc.yaml", "PROCALg")
    assert r["modo"] == "reemplazar" and r["antes"] == "VIEJOg"
    assert (docs_tmp / "doc.yaml").read_text(encoding="utf-8") == YAML_DOC.replace("referencia: ''", "referencia: PROCALg")
    # el código de un combo en `referencia` también es un enlace roto
    (docs_tmp / "doc.yaml").write_text(YAML_DOC.replace("referencia: ''", "referencia: C-PROCAL500g"), encoding="utf-8")
    assert M.fijar_sku_documento("doc.yaml", "PROCALg")["modo"] == "reemplazar"


def test_un_documento_se_comparte_solo_si_se_pide(docs_tmp):
    import yaml

    M.fijar_sku_documento("doc.yaml", "PROCALg")
    r = M.fijar_sku_documento("doc.yaml", "OTROg", compartir=True)
    assert r["modo"] == "compartir"
    d = yaml.safe_load((docs_tmp / "doc.yaml").read_text(encoding="utf-8"))
    assert d["referencia"] == "PROCALg" and d["referencias_equivalentes"] == ["OTROg"]
    assert "# comentario que un yaml.dump borraría" in (docs_tmp / "doc.yaml").read_text(encoding="utf-8")
    assert M.fijar_sku_documento("doc.yaml", "OTROg").get("sin_cambios")


def test_el_documento_compartido_se_encuentra_por_cualquiera_de_sus_skus():
    docs = [{"archivo": "a.yaml", "titulo": "ALULOSA", "toks": {"ALULOSA"}, "estado": "TDS", "referencia": "ALUg", "equivalentes": ["ALUALLg"]}]
    assert A.mejor_documento("ALUALLg", "NOMBRE QUE NO SE PARECE", docs)["archivo"] == "a.yaml"
    assert A.mejor_documento("OTROg", "NOMBRE QUE NO SE PARECE", docs) is None


def test_un_componente_sin_nombre_no_cuenta_como_materia_prima():
    """Hay recetas cuyos componentes llegan sin nombre en la copia de Alegra: sin nombre nada parecía
    empaque, el kit quedaba con diez «materias primas» y el combo no podía unir su documento."""
    assert A.es_empaque("COPA DOSIFICADORA NATU 30 mL") and A.es_empaque("BOLSA SEGURIDAD BLANCA")
    d = M.anatomia_combos()
    if not d["combos"]:
        pytest.skip("sin copia local del catálogo de Alegra")
    for c in d["combos"]:
        sin_nombre = [x["codigo"] for x in c["componentes"] if x["existe"] and not x["nombre"].strip()]
        assert not sin_nombre, f"{c['ref']}: componentes sin nombre {sin_nombre}"


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


# ─── Mapa de la aplicación: todo panel tiene un lugar en la secuencia, y solo uno ───

def _paneles_de(ruta, patron):
    import re
    from pathlib import Path

    return re.findall(patron, (Path(__file__).resolve().parents[1] / ruta).read_text(encoding="utf-8"))


def test_todo_panel_tiene_un_lugar_en_el_flujo_de_la_app():
    """Un panel nuevo que no se ubique en lib/flujoApp.ts queda invisible en el mapa:
    justo el aislamiento que el mapa vino a quitar."""
    import collections

    registrados = set(_paneles_de("desktop/src/lib/panelInfo.ts", r'\n  "?([a-z0-9-]+)"?: \{\n\s*emoji'))
    ubicados = _paneles_de("desktop/src/lib/flujoApp.ts", r'panel: "([a-z0-9-]+)"')
    repetidos = [p for p, n in collections.Counter(ubicados).items() if n > 1]
    assert not repetidos, f"panel en dos lugares del flujo: {repetidos}"
    assert registrados - set(ubicados) == set(), f"paneles sin lugar en el flujo: {sorted(registrados - set(ubicados))}"
    assert set(ubicados) - registrados == set(), f"el flujo nombra paneles que no existen: {sorted(set(ubicados) - registrados)}"


def test_los_bloqueos_apuntan_a_paneles_y_etapas_que_existen():
    from app.services import mapa_app

    etapas = set(_paneles_de("desktop/src/lib/flujoApp.ts", r'\n    id: "([a-z]+)"'))
    paneles = set(_paneles_de("desktop/src/lib/flujoApp.ts", r'panel: "([a-z0-9-]+)"'))
    r = mapa_app.bloqueos(refrescar=True)
    for etapa, e in r["por_etapa"].items():
        assert etapa in etapas, etapa
        for b in e["items"]:
            assert b["panel"] in paneles, b
            assert b["n"] > 0 and b["severidad"] in ("alta", "media")
    for etapa, panel, _ in mapa_app._CHECKLIST.values():
        assert etapa in etapas and panel in paneles


def test_matriz_de_productos_cuadra():
    m = M.matriz_productos()
    if not m["total"]:
        pytest.skip("sin copia local del catálogo de Alegra")
    assert m["embudo"][0][1] == m["total"] and m["embudo"][-1][1] == m["completos"]
    assert [v for _, v in m["embudo"]] == sorted((v for _, v in m["embudo"]), reverse=True), "un embudo solo baja"
    for f in m["filas"]:
        if f["combo"] == "falta":
            assert f["ean"] == f["etiqueta"] == f["meli"] == f["web"] == "na", f["ref"]


def test_toda_piel_del_panel_se_puede_guardar_en_el_servidor():
    """Una piel que existe en el panel pero no en la lista del backend se ve bien y no se guarda:
    el PUT de preferencias responde 400 en silencio. Pasó con «flujo» el 21-sep-2026."""
    import re
    from pathlib import Path

    REPO = Path(__file__).resolve().parents[1]
    ts = (REPO / "desktop" / "src" / "theme" / "presets.ts").read_text(encoding="utf-8")
    m = re.search(r"const SKINS = new Set<UiSkin>\(\[([^\]]+)\]\)", ts)
    assert m, "no se encontró la lista SKINS en presets.ts"
    del_panel = set(re.findall(r'"([a-z]+)"', m.group(1)))
    py = (REPO / "app" / "services" / "tickets_db.py").read_text(encoding="utf-8")
    m = re.search(r"if skin not in \(([^)]+)\):", py)
    assert m, "no se encontró la validación de skin en tickets_db.py"
    del_servidor = set(re.findall(r'"([a-z]+)"', m.group(1)))
    assert del_panel <= del_servidor, f"pieles que el servidor rechazaría: {sorted(del_panel - del_servidor)}"
    assert "flujo" in del_panel


def test_la_agenda_es_el_origen_y_cada_tramo_describe_sus_variables():
    """La Agenda es lo primero que ve cada persona: va como ORIGEN del flujo, no enterrada como
    un panel más de una etapa. Y un tramo sin variables deja al mapa sin decir qué se maneja ahí."""
    import re
    from pathlib import Path

    ts = (Path(__file__).resolve().parents[1] / "desktop" / "src" / "lib" / "flujoApp.ts").read_text(encoding="utf-8")
    origen, etapas = ts.split("export const ETAPAS_APP", 1)
    assert 'panel: "hugo"' in origen and 'panel: "hugo"' not in etapas
    etapas = etapas.split("export const FUERA_DEL_FLUJO", 1)[0]
    tramos = re.findall(r'titulo: "([^"]+)",\s*datos: \[([^\]]*)\]', etapas)
    sin_datos = [t for t, d in tramos if not d.strip()]
    assert not sin_datos, f"tramos sin variables: {sin_datos}"
    # todo bloque con `pasos:` es un tramo y debe traer `datos`
    assert len(tramos) == len(re.findall(r"\bpasos: \[", etapas)), "hay un tramo sin `datos`"


def test_las_reglas_de_la_agenda_llevan_a_etapas_y_paneles_que_existen():
    """La Agenda sugiere a qué etapa pertenece cada ticket (lib/flujoTickets.ts). Una regla que
    apunte a un panel que ya no está en esa etapa mandaría a la gente al lugar equivocado."""
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "desktop" / "src" / "lib"
    flujo = (src / "flujoApp.ts").read_text(encoding="utf-8")
    panel_en_etapa = {}
    for bloque in re.split(r"\n  \{\n    id: \"", flujo)[1:]:
        etapa = bloque.split('"', 1)[0]
        for panel in re.findall(r'panel: "([a-z0-9-]+)"', bloque.split("export const FUERA_DEL_FLUJO")[0]):
            panel_en_etapa[panel] = etapa
    reglas = re.findall(r'etapa: "([a-z]+)", panel: "([a-z0-9-]+)"', (src / "flujoTickets.ts").read_text(encoding="utf-8"))
    assert len(reglas) >= 15
    for etapa, panel in reglas:
        assert panel_en_etapa.get(panel) == etapa, f"la regla manda «{panel}» a «{etapa}», pero vive en «{panel_en_etapa.get(panel)}»"


def test_editar_una_etiqueta_cambia_solo_lo_pedido(tmp_path, monkeypatch):
    """El taller de combos corrige un texto o el tamaño de una etiqueta. `guardar_ficha` reemplaza
    la ficha entera, así que la edición parcial tiene que conservar todo lo demás (logo incluido)."""
    import json

    from app.tools import etiquetas_fichas as EF

    ruta = tmp_path / "etiquetas_fichas.json"
    ruta.write_text(json.dumps({"fichas": [
        {"id": "plant1", "nombre": "Plantilla X", "data": {"productName": "X"}, "es_plantilla_categoria": True, "tipo_nombre": "100 g"},
        {"id": "f1", "nombre": "CREMOR 500g", "tipo_nombre": "100 g", "categoria": "aditivos", "plantilla_id": "plant1",
         "data": {"productName": "CREMOR", "barcode": "", "logoUrl": "data:image/png;base64,AAAA", "accentColor": "#123"},
         "text_styles": {"es_productName": {"size": 9}}},
    ]}), encoding="utf-8")
    monkeypatch.setattr(EF, "_DATA_PATH", ruta)
    monkeypatch.setattr(EF, "_cache", {"mtime": None, "items": None}, raising=False)

    EF.actualizar_campos_ficha("f1", {"barcode": "7701515002642"}, tipo_nombre="250 / 500 g")
    f = EF.obtener_ficha("f1")
    assert f["data"]["barcode"] == "7701515002642" and f["tipo_nombre"] == "250 / 500 g"
    assert f["data"]["logoUrl"].startswith("data:image") and f["data"]["accentColor"] == "#123"
    assert f["plantilla_id"] == "plant1" and f["text_styles"] == {"es_productName": {"size": 9}}
    assert "logoUrl" not in EF.ficha_ligera("f1")["data"]

    for malo in ({"campos": {"logoUrl": "x"}}, {"campos": {"barcode": 123}}, {"plantilla_id": "no-existe"}, {}):
        with pytest.raises(ValueError):
            EF.actualizar_campos_ficha("f1", malo.get("campos"), plantilla_id=malo.get("plantilla_id"))
    with pytest.raises(ValueError):  # la plantilla de una categoría no se edita desde un producto
        EF.actualizar_campos_ficha("plant1", {"productName": "otra"})
