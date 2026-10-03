"""Ubicación de bultos: registrar, encontrar desde el texto de una solicitud, mover, agotar."""
import io

import pytest

from app.services import ubicacion_bultos as B


@pytest.fixture()
def bultos(tmp_path, monkeypatch):
    monkeypatch.setattr(B, "DB_PATH", str(tmp_path / "bultos.db"))
    monkeypatch.setattr(B, "FOTOS_DIR", tmp_path / "fotos")
    monkeypatch.setattr(B, "_listo", {})
    avisos = []
    monkeypatch.setattr(B, "_avisar_canal", lambda texto, ref: avisos.append(texto))
    catalogo = {
        "SEMQUIROJg": {"sku": "SEMQUIROJg", "nombre": "SEMILLA QUINUA ROJA DESPANIFICADA SACO X 25KG", "unidad": "gram"},
        "PSYHUSg": {"sku": "PSYHUSg", "nombre": "PSYLLIUM HUSK", "unidad": "gram"},
        "ACECOCmL": {"sku": "ACECOCmL", "nombre": "ACEITE DE COCO VIRGEN", "unidad": "mililiter"},
    }

    def _producto(sku):
        if sku not in catalogo:
            raise ValueError("no es un producto de inventario")
        return catalogo[sku]

    monkeypatch.setattr(B, "_producto", _producto)
    return avisos


def _jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 150, 90)).save(buf, "JPEG")
    return buf.getvalue()


USUARIO = {"id": None, "nombre": "Stella"}


@pytest.mark.parametrize("nombre,texto,esperado", [
    ("SEMILLA QUINUA ROJA DESPANIFICADA SACO X 25KG", "Empacar quinua roja de 500g", True),
    ("PSYLLIUM HUSK", "Empacar PSYLLUM 500GR", True),              # error de tipeo
    ("ACEITE DE COCO VIRGEN", "envasar aceite de coco 1 litro", True),
    ("ACEITE DE COCO VIRGEN", "coco rallado 250", False),         # una palabra corta no basta
    ("ACIDO HIALURONICO", "Empacar acido citrico 1kg", False),    # solo la genérica coincide
    ("SAL ROSADA DEL HIMALAYA", "sal marina 1kg", False),
])
def test_emparejamiento_por_nombre(nombre, texto, esperado):
    assert bool(B.puntaje_nombre(nombre, "X", texto)) is esperado


def test_sku_escrito_gana():
    assert B.puntaje_nombre("CUALQUIER COSA", "PSYHUSg", "traer psyhusg a empaque") == 100


def test_registrar_y_encontrar_desde_solicitud(bultos):
    b = B.crear(USUARIO, sku="SEMQUIROJg", sede="Sede Sur", ubicacion="Estante B,  nivel 2",
                cantidad="25000", foto=_jpeg())
    assert b["codigo"] == "B-0001"
    assert b["ubicacion"] == "Estante B, nivel 2"
    assert b["fotos"] and B.ruta_foto(b["fotos"][0]["archivo"])
    assert "Estante B, nivel 2" in bultos[0]

    encontrados = B.en_texto("Empacar quinua roja de 500g")
    assert [p["sku"] for p in encontrados] == ["SEMQUIROJg"]
    assert encontrados[0]["bultos"][0]["sede"] == "Sede Sur"
    assert B.en_texto("Empacar aceite de coco") == []


def test_sin_foto_o_sin_lugar_no_se_registra(bultos):
    with pytest.raises(ValueError, match="foto"):
        B.crear(USUARIO, sku="PSYHUSg", ubicacion="Piso")
    with pytest.raises(ValueError, match="ubicación"):
        B.crear(USUARIO, sku="PSYHUSg", ubicacion="  ", foto=_jpeg())
    with pytest.raises(ValueError, match="inventario"):
        B.crear(USUARIO, sku="C-COMBO500g", ubicacion="Piso", foto=_jpeg())


def test_mover_deja_rastro_y_agotado_sale_de_las_solicitudes(bultos):
    b = B.crear(USUARIO, sku="PSYHUSg", ubicacion="Piso", foto=_jpeg())
    m = B.mover(b["id"], USUARIO, sede="Principal", ubicacion="Estante A")
    assert m["ubicacion"] == "Estante A"
    assert any("Piso" in x["detalle"] and "Estante A" in x["detalle"] for x in m["movimientos"])
    B.actualizar(b["id"], USUARIO, estado="agotado")
    assert B.en_texto("empacar psyllium") == []
    assert B.listar() == [] and len(B.listar(incluir_agotados=True)) == 1


def test_bandeja_foto_identificada_o_descartada_no_vuelve(bultos, monkeypatch, tmp_path):
    foto = tmp_path / "grupo.jpg"
    foto.write_bytes(_jpeg())
    monkeypatch.setattr(B, "_ruta_origen", lambda origen, ref: str(foto) if ref == "7" else None)
    b = B.crear(USUARIO, sku="PSYHUSg", ubicacion="Estante C", foto_origen="canal", foto_ref="7")
    assert b["fotos"][0]["origen"] == "canal"
    B.descartar("canal", "8", USUARIO)
    with B._conn() as c:
        revisadas = {(r["origen_ref"], r["decision"]) for r in c.execute("SELECT * FROM fotos_revisadas")}
    assert revisadas == {("7", "bulto"), ("8", "descartada")}
    with pytest.raises(ValueError, match="ya no está"):
        B.crear(USUARIO, sku="PSYHUSg", ubicacion="X", foto_origen="canal", foto_ref="99")
