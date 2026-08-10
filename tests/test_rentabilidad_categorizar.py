"""Clasificación de componentes en rentabilidad."""

from app.services.rentabilidad import _categorizar


def test_envase_keywords():
    assert _categorizar("PASTILLERO BLANCO 180mL") == "envase"
    assert _categorizar("Envase PET 500ml") == "envase"
    assert _categorizar("FRASCO AMBAR 30ML") == "envase"
    assert _categorizar("FARMA AMBAR 5mL") == "envase"
    assert _categorizar("BOLSA VACIO 8X12") == "envase"
    assert _categorizar("TAPA 38MM SENCILLA BLANCA") == "envase"
    assert _categorizar("Tapa dosificadora") == "envase"
    assert _categorizar("gotero ámbar") == "envase"
    assert _categorizar("valvula spray") == "envase"
    assert _categorizar("banda de seguridad") == "envase"
    assert _categorizar("ENVASE BOTERO 250cc") == "envase"
    assert _categorizar("COPA DOSIFICADORA NATU") == "envase"


def test_embalaje():
    assert _categorizar("VINIPEL 20 CMS") == "embalaje"
    assert _categorizar("Papel Burbuja 10cm") == "embalaje"
    assert _categorizar("SOBRE SEGURIDAD PORTAGUIA 23X28Cms") == "embalaje"
    assert _categorizar("Cinta Adhesiva 200 metros") == "embalaje"
    assert _categorizar("CAJA CARTON 5mL") == "embalaje"


def test_etiqueta():
    assert _categorizar("Etiqueta producto") == "etiqueta"
    assert _categorizar("ETIQUETA TERMICA 10 X 15") == "etiqueta"


def test_materia_prima_por_unidad():
    assert _categorizar("UREA g") == "material"
    assert _categorizar("ACEITE NEEM mL") == "material"
    assert _categorizar("AMINOACIDO L ARGININA g") == "material"
    assert _categorizar("ACEITE ESENCIAL JAZMIN mL") == "material"
    assert _categorizar("ACEESEALBmL") == "material"
    assert _categorizar("Agua Destilada gL") == "material"


def test_operativo():
    assert _categorizar("Operativos Minimos 1 min") == "operativo"
