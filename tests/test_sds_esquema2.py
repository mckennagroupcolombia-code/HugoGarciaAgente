"""Hoja de seguridad sin información repetida (esquema 2, 21-sep-2026).

Ver app/services/sds_estructura.py. Los casos salen de documentos reales: el
aceite de canela (H335 en las recomendaciones y no en la lista), el cedro (todo
en un renglón) y la celulosa (frases P de inflamable en un excipiente inerte).
"""
from __future__ import annotations

from app.services.sds_estructura import (
    frases_en_texto,
    fusionar_sds,
    normalizar_sds,
    peligros_para_documento,
    preparar_sds_documento,
    _limpiar_sugerencia,
)

CANELA = {
    "peligros": {
        "clasificacion": "Clasificación típica según el SGA/GHS (H315, H317).\nPalabra de advertencia: Atención.",
        "pictogramas": "GHS07 - Signo de exclamación\nGHS09 - Medio ambiente\n"
                       "H315: Provoca irritación cutánea.\nH317: Puede provocar una reacción alérgica en la piel.\n"
                       "P102: Mantener fuera del alcance de los niños.",
    },
    "recomendaciones": "SEÑAL DE PELIGRO: Atención\n"
                       "INDICACIONES H: H315: Provoca irritación cutánea. H335: Puede irritar las vías respiratorias.\n"
                       "PREVENCIÓN: Evitar el contacto con los ojos.\n"
                       "EPP REQUERIDO: Guantes de nitrilo y gafas.\n"
                       "Se recomienda guardar en empaques bien cerrados.",
    "manipulacion": {"almacenamiento": "Lejos de oxidantes."},
}


def test_frases_en_un_solo_renglon():
    texto = "GHS08 - Peligro para la salud GHS07 - Signo H304: Puede ser mortal. P301 + P310: En caso de ingestión."
    assert frases_en_texto(texto) == [("H304", "Puede ser mortal."), ("P301+P310", "En caso de ingestión.")]


def test_normaliza_canela_sin_perder_ni_repetir():
    sds, avisos = normalizar_sds(CANELA)
    pel = sds["peligros"]
    assert sds["esquema"] == 2
    assert pel["senal"] == "Atención"
    assert pel["pictogramas_ghs"] == ["GHS07", "GHS09"]
    # La lista explícita manda; la contradicción se avisa, no se mezcla.
    assert [f.split(":")[0] for f in pel["frases_h"]] == ["H315", "H317"]
    assert any("H335" in a for a in avisos)
    # La palabra de advertencia sale de la clasificación (tiene su campo).
    assert "advertencia" not in pel["clasificacion"].lower()
    # Prevención sin código ya tenía grupo P1xx, no P2xx → entra como consejo de prevención.
    assert "Prevención: Evitar el contacto con los ojos." in pel["frases_p"]
    # EPP va a la sección 8; el almacenamiento ya estaba en la 7 y no se pisa.
    assert sds["exposicion"] == "Guantes de nitrilo y gafas."
    assert sds["manipulacion"]["almacenamiento"] == "Lejos de oxidantes."
    # El texto corrido (de la FT) no pasa a la SDS.
    assert "recomendaciones" not in sds and "pictogramas" not in pel
    assert any("sin sección" in a for a in avisos)


def test_no_peligroso_y_frases_p_sobrantes():
    sds, avisos = normalizar_sds({"peligros": {
        "clasificacion": "No clasificado como peligroso.",
        "pictogramas": "No aplica pictogramas GHS\nNo aplica frases H\nP210: Mantener alejado del calor.",
    }})
    doc = peligros_para_documento(sds)
    assert doc["pictogramas"] == [] and doc["frases_h"] == [] and doc["senal"] == ""
    assert doc["sin_peligro"] is True
    assert any("ningún peligro clasificado" in a for a in avisos)


def test_esquema2_no_se_toca():
    ya = {"esquema": 2, "peligros": {"senal": "Peligro", "pictogramas_ghs": ["GHS02"], "frases_h": ["H226: x."]}}
    sds, avisos = normalizar_sds(ya)
    assert sds["peligros"]["frases_h"] == ["H226: x."] and avisos == []


def test_frases_p_agrupadas_y_primeros_auxilios_remite():
    sds, _ = normalizar_sds({"esquema": 2, "peligros": {"frases_p": [
        "P280: Llevar guantes.", "P302+P352: Lavar con agua.", "P501: Eliminar el contenido.", "Respuesta: Llamar al médico.",
    ]}})
    doc = peligros_para_documento(sds)
    assert [g for g, _ in doc["frases_p"]] == ["Prevención", "Respuesta", "Eliminación"]
    assert dict(doc["frases_p"])["Respuesta"] == [("P302+P352", "Lavar con agua."), ("", "Llamar al médico.")]
    assert doc["tiene_respuesta"] is True


def test_fusionar_conserva_lo_que_el_formulario_no_manda():
    guardada = {"incendios": "Espuma.", "toxicologia": "Baja.", "peligros": {"pictogramas": "viejo", "clasificacion": "x"},
                "recomendaciones": "viejas"}
    nueva = {"esquema": 2, "incendios": "CO2.", "recomendaciones": None,
             "peligros": {"clasificacion": "y", "pictogramas": None, "frases_h": []}}
    r = fusionar_sds(guardada, nueva)
    assert r["toxicologia"] == "Baja."          # no venía en el formulario: se conserva
    assert r["incendios"] == "CO2."             # venía: se reemplaza
    assert "recomendaciones" not in r           # null: se retira
    assert r["peligros"] == {"clasificacion": "y", "frases_h": []}


def test_sugerencia_se_limpia_al_esquema():
    r = _limpiar_sugerencia({
        "peligros": {"senal": "Advertencia", "pictogramas_ghs": ["GHS07", "ghs9", "GHS07"],
                     "frases_h": ["H315: Provoca irritación cutánea"], "frases_p": ["P280 Llevar guantes"]},
        "propiedades": [["Color", "blanco"], ["pH", "5-7"], ["Densidad", ""]],
    })
    assert r["peligros"]["senal"] == "Atención"
    assert r["peligros"]["pictogramas_ghs"] == ["GHS07", "GHS09"]
    assert r["peligros"]["frases_h"] == ["H315: Provoca irritación cutánea."]
    assert r["propiedades"] == [["pH", "5-7"]]  # color va en la FT; sin valor no se inventa


def test_preparar_quita_lo_que_ya_dice_la_ft():
    ft = {"propiedades": [("Apariencia", "Líquido"), ("Aroma", "Amaderado")], "conservacion": "Fresco y seco."}
    sds = {"propiedades": [("Estado físico", "Líquido"), ("Olor", "Amaderado"), ("Punto de inflamación", ">100 °C")]}
    preparar_sds_documento(ft, {"composicion": [["A", "1", ""]]}, sds)
    assert sds["propiedades_propias"] == [("Punto de inflamación", ">100 °C")]
    assert sds["propiedades_en_ft_texto"] == "Apariencia y olor"
    assert sds["ft_tiene_conservacion"] and sds["coa_tiene_composicion"]


def test_migrar_mueve_composicion_al_coa_y_recomendaciones_de_la_ft():
    from scripts.sds_migrar_esquema2 import migrar_datos

    datos = {"recomendaciones": "SEÑAL DE PELIGRO: Peligro", "_coa": {"titulo": "X"},
             "_sds": {"peligros": {"pictogramas": "GHS02 - Llama"}, "composicion": [["Etanol", "96 %", "64-17-5"]]}}
    nuevo, avisos = migrar_datos(datos)
    assert nuevo["_coa"]["composicion"] == [["Etanol", "96 %", "64-17-5"]]
    assert "composicion" not in nuevo["_sds"] and "recomendaciones" not in nuevo
    assert nuevo["_sds"]["peligros"]["senal"] == "Peligro"
    assert migrar_datos(nuevo) is None  # idempotente


# ── Nada sin diligenciar en el PDF ─────────────────────────────────────────────

def test_relleno_cuenta_como_vacio():
    from app.services.ficha_tecnica import es_relleno

    for v in ("", "  ", "-", "—", "N/A", "n.d.", "— completar —", None):
        assert es_relleno(v), v
    for v in ("No aplica", "0", "Conforme", "< 10 ppm"):
        assert not es_relleno(v), v


def test_tabla_quita_filas_y_columnas_vacias():
    from app.services.ficha_tecnica import celdas_sin_huecos, limpiar_tabla

    filas, cols = limpiar_tabla([
        ["Apariencia", "Polvo", "", ""],
        ["Humedad", "—", "", ""],          # sin valores: se quita
        ["pH", "", "6,1", ""],
    ], 4)
    assert [f[0] for f in filas] == ["Apariencia", "pH"]
    assert cols == [0, 1, 2]               # «Método» vacío en todas las filas no se dibuja
    # La celda vacía de pH se une a la de su izquierda: ningún hueco.
    assert celdas_sin_huecos(filas, cols)[1] == [("pH", 2, 0), ("6,1", 1, 2)]


def test_componente_sin_porcentaje_se_conserva():
    from app.services.ficha_tecnica import limpiar_tabla

    filas, cols = limpiar_tabla([["Parafinas", ""], ["Ceras", "-"]], 2, rotulo_basta=True)
    assert [f[0] for f in filas] == ["Parafinas", "Ceras"] and cols == [0]
