import io

import pytest
from PIL import Image

from app.services import fotos_producto as F


def _png(color=(200, 30, 30), fmt="PNG", size=(40, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, fmt)
    return buf.getvalue()


@pytest.fixture
def aislado(tmp_path, monkeypatch):
    raiz = tmp_path / "Recursos PNG"
    raiz.mkdir()
    monkeypatch.setattr(F, "_raiz_png", lambda: raiz)
    monkeypatch.setattr(F, "_REGISTRO", tmp_path / "fotos_producto.json")
    F._miniaturas.clear()
    return raiz


def test_guardar_listar_y_resumen(aislado):
    fila = F.guardar("c-eri500g", "meli", _png(), por="@armando")
    assert fila["archivo"].startswith("C-ERI500G_")
    assert (aislado / "FOTOS PRODUCTO" / "MERCADO LIBRE" / fila["archivo"]).is_file()
    F.guardar("C-ERI500g", "web", _png(fmt="JPEG"))

    lista = F.listar("C-ERI500g")
    assert len(lista["canales"]["meli"]) == 1 and len(lista["canales"]["web"]) == 1
    assert lista["canales"]["meli"][0]["miniatura"]
    assert lista["canales"]["web"][0]["archivo"].endswith(".jpg")
    assert F.resumen() == {"C-ERI500G": {"meli": 1, "web": 1}}


def test_webp_se_convierte_a_png(aislado):
    fila = F.guardar("C-CAF100g", "web", _png(fmt="WEBP"))
    assert fila["archivo"].endswith(".png")
    assert Image.open(aislado / "FOTOS PRODUCTO" / "PAGINA WEB" / fila["archivo"]).format == "PNG"


def test_retirar_va_a_papelera_y_sale_del_resumen(aislado):
    fila = F.guardar("C-CAF100g", "meli", _png())
    F.retirar("C-CAF100g", "meli", fila["archivo"])
    assert F.resumen() == {}
    assert list((aislado.parent / ".papelera_fotos_producto").iterdir())
    with pytest.raises(ValueError):
        F.retirar("C-CAF100g", "meli", fila["archivo"])


def test_rechaza_lo_que_no_es_imagen_ni_canal_ni_sku(aislado):
    with pytest.raises(ValueError):
        F.guardar("C-CAF100g", "meli", b"hola")
    with pytest.raises(ValueError):
        F.guardar("C-CAF100g", "tiktok", _png())
    with pytest.raises(ValueError):
        F.guardar("../../etc", "meli", _png())


def test_ruta_archivo_solo_de_fotos_registradas(aislado):
    fila = F.guardar("C-CAF100g", "meli", _png())
    assert F.ruta_archivo("C-CAF100g", "meli", fila["archivo"]).is_file()
    assert F.ruta_archivo("C-CAF100g", "meli", "../../../.env") is None
    assert F.ruta_archivo("C-OTRO", "meli", fila["archivo"]) is None
