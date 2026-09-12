"""La factura mensual de MercadoLibre traducida al PUC.

Dos cosas costaron caro descubrirlas y estas pruebas las fijan:

1. Los códigos que empiezan por «B» son anulaciones y **restan**, aunque la API
   los manda con importe positivo y sin marcarlos como CREDIT. Sumándolos en
   positivo, ago-2026 daba $46.013.088 contra los $44.175.672 que MeLi factura:
   sobraba exactamente 2× el valor de las anulaciones.
2. La factura se cobra contra el saldo de MercadoPago (111010), no contra el
   banco. Ese débito nunca existió en el extracto.
"""
from __future__ import annotations

import pytest

from app.services import meli_facturacion as mf


@pytest.mark.parametrize("cod", ["BV", "BXD", "BFF", "bv"])
def test_los_codigos_b_son_anulaciones(cod):
    assert mf.es_anulacion(cod) is True


@pytest.mark.parametrize("cod", ["CV", "CXD", "PADS", "CFF", "CESM", ""])
def test_los_demas_son_cargos(cod):
    assert mf.es_anulacion(cod) is False


def test_la_publicidad_tiene_cuenta_propia():
    """PADS no puede caer en 5299 junto con las comisiones: son $24M/mes que se
    deciden por ACOS, no un costo inevitable de vender."""
    assert mf.MAPA_PUC["PADS"] == "529505"
    assert mf.MAPA_PUC["CV"] == "5299"
    assert mf.MAPA_PUC["PADS"] != mf.MAPA_PUC["CV"]


@pytest.mark.parametrize("anulacion, cargo", [("BV", "CV"), ("BXD", "CXD"), ("BFF", "CFF")])
def test_la_anulacion_va_a_la_misma_cuenta_que_el_cargo_que_anula(anulacion, cargo):
    """MeLi nombra los pares de forma regular: la B se cambia por C.

    Sin esto, tres conceptos de la factura de agosto quedaban sin cuenta y el
    asiento no se podía armar, aunque el total cuadrara.
    """
    assert mf.cuenta_para(anulacion) == mf.MAPA_PUC[cargo]


def test_un_concepto_nuevo_de_meli_no_se_inventa():
    assert mf.cuenta_para("XXDESCONOCIDO") is None
    assert mf.cuenta_para("BXXDESCONOCIDO") is None


def test_los_envios_van_a_fletes():
    for cod in ("CXD", "CFF", "CFCB"):
        assert mf.MAPA_PUC[cod] == "513550"


def _desglose_falso(monkeypatch, conceptos, total_meli):
    monkeypatch.setattr(mf, "desglose_periodo", lambda key, grupo="ML", **kw: {
        "key": key, "conceptos": conceptos, "total_meli": total_meli,
        "total_calculado": round(sum(c["monto"] for c in conceptos), 2),
        "cuadra": abs(sum(c["monto"] for c in conceptos) - total_meli) < 1.0,
    })


def test_el_asiento_se_carga_contra_mercadopago_no_contra_bancos(monkeypatch):
    _desglose_falso(monkeypatch, [
        {"codigo": "PADS", "descripcion": "Publicidad", "cuenta_puc": "529505", "monto": 23_853_390.0},
        {"codigo": "CV", "descripcion": "Comisión", "cuenta_puc": "5299", "monto": 12_072_988.0},
    ], 35_926_378.0)

    lineas = mf.lineas_asiento("2026-08-01")
    contrapartida = [l for l in lineas if l["cuenta"] == "111010"]
    assert len(contrapartida) == 1
    assert contrapartida[0]["credito"] == 35_926_378.0
    assert not [l for l in lineas if l["cuenta"] == "1110"]   # el banco no se toca
    assert round(sum(l["debito"] for l in lineas)) == round(sum(l["credito"] for l in lineas))


def test_una_anulacion_entra_como_credito(monkeypatch):
    _desglose_falso(monkeypatch, [
        {"codigo": "CV", "descripcion": "Comisión", "cuenta_puc": "5299", "monto": 1_000_000.0},
        {"codigo": "BV", "descripcion": "Anulación", "cuenta_puc": "5299", "monto": -100_000.0},
    ], 900_000.0)

    lineas = mf.lineas_asiento("2026-08-01")
    anul = [l for l in lineas if "Anulación" in l["descripcion"]][0]
    assert anul["credito"] == 100_000.0 and anul["debito"] == 0


def test_no_arma_asiento_si_no_cuadra_con_la_factura(monkeypatch):
    """Contabilizar una cifra distinta a la que el proveedor va a cobrar es peor
    que no contabilizar: descuadra y nadie se entera hasta la conciliación."""
    _desglose_falso(monkeypatch, [
        {"codigo": "CV", "descripcion": "Comisión", "cuenta_puc": "5299", "monto": 1_000_000.0},
    ], 900_000.0)

    with pytest.raises(ValueError, match="No se arma el asiento"):
        mf.lineas_asiento("2026-08-01")


def test_no_arma_asiento_con_un_concepto_desconocido(monkeypatch):
    """Si MeLi estrena un cargo, se avisa en vez de meterlo en cualquier cuenta."""
    _desglose_falso(monkeypatch, [
        {"codigo": "XXNUEVO", "descripcion": "Cargo nuevo", "cuenta_puc": None, "monto": 500_000.0},
    ], 500_000.0)

    with pytest.raises(ValueError, match="sin cuenta PUC"):
        mf.lineas_asiento("2026-08-01")
