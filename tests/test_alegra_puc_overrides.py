"""El flete de ventas empareja con su propia cuenta en Alegra, no con el administrativo."""
from app.services import alegra_puc


def test_el_flete_de_ventas_no_se_fuerza_al_administrativo():
    assert "523550" not in alegra_puc.OVERRIDES


def test_con_523550_en_alegra_empareja_por_codigo_exacto(monkeypatch):
    plano = {
        "513550": {"id": "5875", "nombre": "Transporte, fletes y acarreos", "movimiento": True},
        "523550": {"id": "6296", "nombre": "Transporte, fletes y acarreos", "movimiento": True},
        "5235": {"id": "6287", "nombre": "Servicios", "movimiento": False},
        "523560": {"id": "6289", "nombre": "Publicidad", "movimiento": True},
    }
    monkeypatch.setattr(alegra_puc, "catalogo", lambda refrescar=False: plano)
    mapa = alegra_puc.construir_mapa()["mapa"]
    assert mapa["523550"] == "6296"
    assert mapa["513550"] == "5875"
