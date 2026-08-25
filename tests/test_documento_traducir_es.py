"""Traducción EN→ES al extraer documentos técnicos (pantallazo/PDF)."""
from app.services.documento_traducir_es import (
    espanolizar_campos_documento,
    traducir_fecha_meses,
    traducir_parametros,
    traducir_texto_tecnico,
)


def test_parametros_coa_ingles_a_espanol() -> None:
    crudo = (
        "Appearance|White crystalline powder|Conforms\n"
        "Assay|N.M.T. 0.001 %|Passes\n"
        "Loss on Drying|Not more than 1.0%|0.4%\n"
        "Heavy Metals|NMT 10 ppm|Not detected"
    )
    out = traducir_parametros(crudo)
    assert "Aspecto|Polvo cristalino blanco|Cumple" in out
    assert "Valoración|No más de 0.001 %|Cumple" in out
    assert "Pérdida por secado|No más de 1.0%|0.4%" in out
    assert "Metales pesados|" in out
    assert "No detectado" in out
    assert "Appearance" not in out
    assert "Conforms" not in out


def test_apariencia_y_almacenamiento() -> None:
    assert traducir_texto_tecnico("White crystalline powder") == "Polvo cristalino blanco"
    alm = traducir_texto_tecnico("Store in a cool dry place. Protect from light.")
    assert "Almacenar en un lugar fresco y seco" in alm
    assert "Proteger de la luz" in alm
    assert "Store" not in alm


def test_acido_citrico_y_capsulas() -> None:
    assert "Ácido cítrico anhidro" in traducir_texto_tecnico("Citric Acid Anhydrous")
    assert "Ácido ascórbico" in traducir_texto_tecnico("Ascorbic Acid")
    assert "Cápsulas vacías de gelatina dura" in traducir_texto_tecnico(
        "EMPTY HARD GELATIN CAPSULES"
    )


def test_no_traduce_cas_lote_formula_fabricante() -> None:
    campos = espanolizar_campos_documento(
        {
            "cas": "77-92-9",
            "lote": "202512002",
            "formula_quimica": "C6H8O7",
            "fabricante": "GLOBALQUIMIA LTDA",
            "inci": "Citric Acid",
            "apariencia": "White powder",
            "nombre_producto": "Citric Acid Anhydrous",
        }
    )
    assert campos["cas"] == "77-92-9"
    assert campos["lote"] == "202512002"
    assert campos["formula_quimica"] == "C6H8O7"
    assert campos["fabricante"] == "GLOBALQUIMIA LTDA"
    assert campos["inci"] == "Citric Acid"
    assert campos["apariencia"] == "Polvo blanco"
    assert "Ácido cítrico anhidro" in campos["nombre_producto"]


def test_fecha_mes_ingles() -> None:
    assert traducir_fecha_meses("DEC.2025").lower().startswith("dic")
    assert traducir_fecha_meses("2025-12-01") == "2025-12-01"


def test_espanolizar_es_idempotente() -> None:
    una = espanolizar_campos_documento(
        {
            "parametros": "Appearance|White powder|Conforms",
            "almacenamiento": "Keep tightly closed. Protect from moisture.",
        }
    )
    dos = espanolizar_campos_documento(una)
    assert dos["parametros"] == una["parametros"]
    assert dos["almacenamiento"] == una["almacenamiento"]
    assert "Aspecto|" in dos["parametros"]
    assert "Cumple" in dos["parametros"]


def test_coa_coco_deshidratado_hilo_largo() -> None:
    campos = espanolizar_campos_documento(
        {
            "nombre_producto": "DESICCATED COCONUT FULL FAT LONG THREAD",
            "lote": "EV25029-HILOS",
            "parametros": (
                "Color|White Snow color|\n"
                "Sabor|Characteristic of coconut taste|\n"
                "Olor|Characteristic of coconut aroma|\n"
                "Textura|Long Thread 2-6cm|\n"
                "Humedad|3.0 %|\n"
                "Grasa total|60 to 65 %|\n"
                "SO₂|100 max|\n"
                "Acidos grasos libres|0.15 %|\n"
                "pH|5.5 to 7.0|\n"
                "Fibra cruda|2%"
            ),
        }
    )
    assert campos["lote"] == "EV25029-HILOS"
    assert "Coco deshidratado" in campos["nombre_producto"]
    assert "hilo largo" in campos["nombre_producto"].lower()
    params = campos["parametros"]
    assert "color blanco nieve" in params.lower()
    assert "sabor característico a coco" in params.lower()
    assert "aroma característico a coco" in params.lower()
    assert "hilo largo" in params.lower()
    assert "60 a 65" in params
    assert "5.5 a 7.0" in params
    assert "100 máx" in params
    assert "White Snow" not in params
    assert "Characteristic of" not in params
    assert " to " not in params
