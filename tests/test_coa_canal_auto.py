"""COA por foto en el grupo de documentos técnicos: armado de páginas y resumen (sin LLM)."""
from app.services import coa_canal_auto as auto


def _lec(mid, nombre="", lote="", filas=None):
    return {"mensaje_id": mid, "campos": {"nombre_producto": nombre, "lote": lote, "filas": filas or []}}


def test_filas_descarta_encabezado_y_metodo():
    t = "Propiedades|Estándar|Resultados\nPureza|98-102|99.9|USP<621>\nPureza|x|y\nColor|Blanco|Conforme"
    assert auto._filas(t) == [["Pureza", "98-102", "99.9"], ["Color", "Blanco", "Conforme"]]


def test_pagina_dos_con_nombre_y_sin_lote_se_une():
    g = auto._agrupar([
        _lec(1, "Creatina Monohidrato", "D20260406C", [["Pureza", "99.5", "100.3"]]),
        _lec(2, "CREATINA MONOHIDRATO", "", [["E. Coli", "Negativo", "No detectado"]]),
        _lec(3, "SORBITOL POLVO", "2026050948", [["pH", "3.5-7", "5.53"]]),
    ])
    assert [x["mensajes"] for x in g] == [[1, 2], [3]]
    assert len(g[0]["campos"]["filas"]) == 2


def test_foto_sin_nada_no_es_coa():
    lecturas = [_lec(1)]
    assert auto._agrupar(lecturas) == []
    assert lecturas[0]["no_coa"]


def test_resumen_separa_actualizados_al_dia_y_revisar():
    texto = auto.resumen([
        {"estado": "actualizado", "titulo": "AGAR AGAR", "lote": "L1", "lote_anterior": "", "filas": 26, "vence": "2027-12-03"},
        {"estado": "al_dia", "titulo": "D PANTENOL", "lote": "L2"},
        {"estado": "sin_documento", "producto_coa": "X", "candidatos": ["A", "B"]},
    ])
    assert "✅" in texto and "03/12/2027" in texto and "☑️" in texto and "¿A / B?" in texto


def _doc(**cf):
    return {"tipo_insumo": cf.pop("tipo", "definida"), "concentracion": cf.pop("concentracion", "99%"),
            "presentacion": "", "ins": "", "caracteristicas_fisicas": {"ph": "", "olor": "Neutro", "apariencia": "", **cf},
            "_coa": {"identificacion": {"grado": "Alimentos", "ins": ""}}}


def test_coa_llena_vacias_y_corrige_lo_que_lo_contradice():
    campos = {"tamano_lote": "20700 kg", "parametros": "Cumple con FCC/JECFA/E-406",
              "filas": [["Pureza, %", "91.0 – 100.5", "98.62"], ["pH", "3.5 – 7.0", "5.53"], ["Olor", "Inodoro", "Cumple"]]}
    cs = {c["ruta"]: c for c in auto.cambios_desde_coa(_doc(), campos)}
    assert cs["concentracion"]["despues"] == "98.62 %" and cs["concentracion"]["tipo"] == "corregido"
    assert cs["caracteristicas_fisicas.ph"]["despues"] == "3.5 – 7.0" and cs["caracteristicas_fisicas.ph"]["tipo"] == "llenado"
    assert cs["caracteristicas_fisicas.olor"]["despues"] == "Inodoro"
    assert cs["presentacion"]["despues"] == "20700 kg"
    assert cs["ins"]["despues"] == "INS 406"


def test_grasa_no_es_concentracion_y_no_pisa_lo_que_coincide():
    campos = {"filas": [["Proteína (base seca)", "≥ 90%", "90.7 %"], ["Contenido de grasa", "< 0.5 %", "0.4%"],
                        ["pH", "7.5 ± 0.5", "7.96"]]}
    cs = {c["ruta"]: c for c in auto.cambios_desde_coa(_doc(concentracion="90.7 %", ph="7.5 ± 0.5", olor="Normal"), campos)}
    assert "concentracion" not in cs and "caracteristicas_fisicas.ph" not in cs and "caracteristicas_fisicas.olor" not in cs


def test_deducibles_respetan_tipo_y_nunca_modo_de_uso():
    rutas = [r for r, _ in auto._deducibles({"tipo_insumo": "natural", "sinonimos": "", "modo_uso": "",
                                              "caracteristicas_fisicas": {"formula_quimica": "", "sabor": ""},
                                              "_coa": {"identificacion": {"grado": "Alimentos"}}})]
    assert "caracteristicas_fisicas.formula_quimica" not in rutas and "modo_uso" not in rutas
    assert "alergenos" in rutas and "sinonimos" in rutas
