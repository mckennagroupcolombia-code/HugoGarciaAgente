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
    assert "flujo" in del_panel and "pixel" in del_panel

    # Lo mismo con las fuentes: el backend las valida en DOS sitios (el tema activo y los
    # temas guardados por la persona). «DotGothic16» (piel pixel, 25-sep-2026) casi cae aquí.
    tipos = (REPO / "desktop" / "src" / "theme" / "types.ts").read_text(encoding="utf-8")
    m = re.search(r"export type FontChoice =([^;]+);", tipos)
    assert m, "no se encontró FontChoice en types.ts"
    fuentes_panel = set(re.findall(r'"([^"]+)"', m.group(1)))
    lista_temas = re.search(r"fonts = \{([^}]+)\}", py)
    lista_activo = re.search(r'font not in \(([^)]+)\):', py)
    assert lista_temas and lista_activo, "no se encontraron las listas de fuentes en tickets_db.py"
    for nombre, bloque in (("temas guardados", lista_temas), ("tema activo", lista_activo)):
        del_servidor = set(re.findall(r'"([^"]+)"', bloque.group(1)))
        assert fuentes_panel <= del_servidor, f"fuentes que el servidor rechazaría ({nombre}): {sorted(fuentes_panel - del_servidor)}"


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


def test_presentaciones_fotos_y_datos_de_inventario_por_componente():
    """El taller muestra las otras presentaciones del mismo producto, sus fotos y las existencias
    de cada componente. Un kit de varias materias primas no es «otra presentación» de ninguna."""
    d = M.anatomia_combos()
    if not d["combos"]:
        pytest.skip("sin copia local del catálogo de Alegra")
    for c in d["combos"]:
        mp = [x for x in c["componentes"] if x["casilla"] == "materia_prima"]
        assert isinstance(c["fotos"], list) and all(isinstance(f, str) for f in c["fotos"])
        if len(mp) > 1:
            assert c["familia"] != mp[0]["codigo"], c["ref"]
        for x in c["componentes"]:
            assert "costo" in x and "existencias" in x
            assert x["existencias"] is None or isinstance(x["existencias"], (int, float))


def test_todo_emoji_mapeado_apunta_a_un_icono_que_existe():
    """`<Ico e="📦" />` dibuja el icono lineal que diga icons/emojiMap.ts. Si el mapa nombra un icono
    que no está en el set, `Icon` devuelve null y el botón queda SIN icono y sin aviso."""
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "desktop" / "src" / "icons"
    disponibles = set(re.findall(r"^  ([A-Za-z0-9]+): ", (src / "mck" / "paths" / "ui.tsx").read_text(encoding="utf-8"), flags=re.M))
    mapa = (src / "emojiMap.ts").read_text(encoding="utf-8").split("export const TOPIC_ICON_PRESETS")[0]
    usados = dict(re.findall(r'^\s*"([^"]+)":\s*"([A-Za-z0-9]+)"', mapa, flags=re.M))
    assert len(usados) > 150 and len(disponibles) > 100
    faltan = {e: n for e, n in usados.items() if n not in disponibles}
    assert not faltan, f"emojis que apuntan a un icono inexistente: {faltan}"
    tipos = set(re.findall(r'\| "([A-Za-z0-9]+)"', (src / "types.ts").read_text(encoding="utf-8")))
    assert not (set(usados.values()) - tipos), "icono usado en el mapa que no está en UiIconName"


def test_revisar_documento_organiza_sus_partes_y_no_escribe(tmp_path, monkeypatch):
    """El taller muestra el documento en un emergente. La lectura debe traer sus partes, contar lo
    vacío, explicar por qué no está listo y NO tocar el archivo ni devolver imágenes embebidas."""
    import json

    from app.services import ficha_tecnica as ft

    doc = tmp_path / "vacio_doc.yaml"
    doc.write_text('''titulo: ACEITE X
referencia: ACEXg
cas: ''
descripcion: Un aceite de prueba que se describe en una frase suficientemente larga para ser un párrafo y no una fila.
caracteristicas_fisicas:
  apariencia: Líquido
  ph: ''
propiedades_lista:
  - Hidratante|Ayuda a mantener la piel
_estado: vacio
_vacio_motivo: Falta la clasificación GHS
_vacio_pendientes:
  - Pedir la SDS al proveedor
_coa:
  identificacion:
    nombre_comercial: ACEITE X
  parametros:
    - [Propiedad, Estándar, Resultado]
    - [Densidad, '0,9', '']
  firma:
    nombre: Alguien
    imagen_b64: data:image/png;base64,AAAA
_fuentes:
  - Ficha del proveedor
''', encoding="utf-8")
    antes = doc.read_text(encoding="utf-8")
    monkeypatch.setattr(ft, "DATOS_DIR", tmp_path)
    monkeypatch.setattr(M, "_datos", lambda refrescar=False: {"documentos": [{"archivo": "vacio_doc.yaml", "estado": "vacía", "referencia": "ACEXg", "equivalentes": []}]})

    r = M.revisar_documento("vacio_doc.yaml")
    assert r["titulo"] == "ACEITE X" and r["estado"] == "vacía" and r["referencia"] == "ACEXg"
    por_id = {s["id"]: s for s in r["secciones"]}
    assert por_id["tds"]["existe"] and por_id["tds"]["vacios"] == 2          # cas y pH
    assert por_id["coa"]["existe"] and por_id["coa"]["firmado"] and not por_id["sds"]["existe"]
    assert any(b["tipo"] == "tabla" for b in por_id["coa"]["bloques"])
    assert [p["titulo"] for p in r["pendientes"]][0].startswith("Por qué") and r["fuentes"] == ["Ficha del proveedor"]
    assert "base64" not in json.dumps(r), "la firma embebida no debe viajar al navegador"
    assert doc.read_text(encoding="utf-8") == antes
    for malo in ("../x.yaml", "no_existe.yaml", "doc.txt"):
        with pytest.raises(ValueError):
            M.revisar_documento(malo)


def test_editar_documento_cambia_solo_lo_pedido_y_deja_rastro(tmp_path, monkeypatch):
    """El emergente del taller corrige valores del documento. Debe tocar SOLO las rutas pedidas, respaldar,
    dejar rastro, no dejar mover el enlace con la materia prima y pedir confirmación si está publicado."""
    import yaml

    from app.services import ficha_tecnica as ft

    monkeypatch.setattr(ft, "DATOS_DIR", tmp_path)
    monkeypatch.setattr(ft, "normalizar_datos_ficha", lambda d: dict(d))
    base = {"titulo": "ACEITE X", "referencia": "ACEXg", "cas": "", "descripcion": "Texto viejo",
            "caracteristicas_fisicas": {"ph": "", "olor": "Suave"}, "aplicaciones": ["Uno", "Dos"],
            "_borrador": True, "_tipo": "completo",
            "_coa": {"parametros": [["Propiedad", "Estándar", "Resultado"], ["Densidad", "0,9", ""]], "firma": {"imagen_b64": "data:AAAA"}}}
    doc = tmp_path / "borrador_x.yaml"
    doc.write_text(yaml.dump(base, allow_unicode=True, sort_keys=False), encoding="utf-8")

    r = M.editar_documento("borrador_x.yaml", [
        {"ruta": ["cas"], "valor": "111-22-3"},
        {"ruta": ["caracteristicas_fisicas", "ph"], "valor": "7,0"},
        {"ruta": ["aplicaciones", 1], "valor": "Dos corregido"},
        {"ruta": ["_coa", "parametros", 1, 2], "valor": "0,91"},
        {"ruta": ["descripcion"], "valor": "Texto viejo"},            # igual: no cuenta
    ], usuario="Armando")
    assert r["ok"] and r["cambiados"] == ["cas", "caracteristicas_fisicas.ph", "aplicaciones.1", "_coa.parametros.1.2"]
    d = yaml.safe_load(doc.read_text(encoding="utf-8"))
    assert d["cas"] == "111-22-3" and d["caracteristicas_fisicas"] == {"ph": "7,0", "olor": "Suave"}
    assert d["aplicaciones"] == ["Uno", "Dos corregido"] and d["_coa"]["parametros"][1] == ["Densidad", "0,9", "0,91"]
    assert d["referencia"] == "ACEXg" and d["_coa"]["firma"]["imagen_b64"] == "data:AAAA" and d["descripcion"] == "Texto viejo"
    assert d["_ediciones"][-1]["quien"] == "Armando" and d["_ediciones"][-1]["desde"] == "taller de combos"
    assert len(list((tmp_path / "_respaldo_edicion").glob("borrador_x.*.yaml"))) == 1

    for malo in ([{"ruta": ["referencia"], "valor": "OTROg"}], [{"ruta": ["_coa", "firma", "imagen_b64"], "valor": "x"}],
                 [{"ruta": ["_borrador"], "valor": "no"}], [{"ruta": ["no_existe"], "valor": "x"}],
                 [{"ruta": ["caracteristicas_fisicas"], "valor": "x"}], [{"ruta": ["cas"], "valor": 5}], []):
        with pytest.raises(ValueError):
            M.editar_documento("borrador_x.yaml", malo)

    # publicado: sin confirmación no se toca
    pub = tmp_path / "ft_coa_sds_y.yaml"
    pub.write_text(yaml.dump({"titulo": "Y", "cas": "1", "_tipo": "completo"}, allow_unicode=True), encoding="utf-8")
    with pytest.raises(ValueError, match="publicado"):
        M.editar_documento("ft_coa_sds_y.yaml", [{"ruta": ["cas"], "valor": "2"}])
    assert yaml.safe_load(pub.read_text(encoding="utf-8"))["cas"] == "1"
    assert M.editar_documento("ft_coa_sds_y.yaml", [{"ruta": ["cas"], "valor": "2"}], confirmar_publicado=True)["publicado"]


def test_estado_de_la_foto_del_combo():
    """El taller hace parpadear la foto del centro cuando el combo se completa y su foto no está al día."""
    f = M._estado_foto
    assert f(None, None)[0] == "sin_foto" and f({"photo": ""}, None)[0] == "sin_foto"
    meli = "https://http2.mlstatic.com/D_794179-MCO54788904486_042023-O.jpg"
    assert f({"photo": meli, "photo_match_type": "identity"}, None)[:2] == ("prestada", "2023-04")
    assert f({"photo": meli, "photo_match_type": "sku"}, {"actualizado": "2026-09-20T16:44:31"})[0] == "anterior_a_etiqueta"
    assert f({"photo": meli, "photo_match_type": "sku"}, {"actualizado": "2023-03-01"})[0] == "ok"
    assert f({"photo": meli, "photo_match_type": "sku"}, None)[0] == "ok"
    assert f({"photo": "/imagenes-productos-catalogo/C-X.png", "photo_match_type": "siigo"}, {"actualizado": "2026-09-20"}) == ("ok", "", "")
    d = M.anatomia_combos()
    for c in d["combos"]:
        assert c["foto_estado"] in ("sin_foto", "prestada", "anterior_a_etiqueta", "ok")
        assert (c["foto_estado"] == "ok") == (c["foto_motivo"] == "")


def test_marcar_no_requiere_documento_completa_la_pieza(tmp_path, monkeypatch):
    monkeypatch.setattr(M, "_DOC_NO_REQUERIDO_JSON", tmp_path / "exentos.json")
    M.invalidar()
    c = next(x for x in M._datos()["combos"] if x["eslabones"]["documento"]["estado"] != "ok")
    M.marcar_documento_no_requerido(c["ref"], True, motivo="envase vacío", usuario="prueba")
    d = next(x for x in M._datos()["combos"] if x["ref"] == c["ref"])["eslabones"]["documento"]
    assert d["estado"] == "ok" and d["no_requiere"]["motivo"] == "envase vacío" and "accion" not in d
    M.marcar_documento_no_requerido(c["ref"], False)
    d = next(x for x in M._datos()["combos"] if x["ref"] == c["ref"])["eslabones"]["documento"]
    assert d["estado"] != "ok" and not d.get("no_requiere")
    with pytest.raises(ValueError):
        M.marcar_documento_no_requerido("NO-EXISTE-XYZ", True)
    M.invalidar()
