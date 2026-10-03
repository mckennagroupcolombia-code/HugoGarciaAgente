"""Entregas Flex: métricas por semana y detección de patrones, sobre una base temporal."""

from datetime import date, datetime, timedelta

import pytest

from app.services import entregas_flex as E


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "_DB_PATH", tmp_path / "flex.db")
    return tmp_path


def _envio(con, sid, compra, salida, entregado, limite, localidad="Suba", estado="delivered"):
    con.execute(
        "INSERT INTO envios_flex (shipment_id, compra, salida, entregado, limite, localidad, estado) "
        "VALUES (?,?,?,?,?,?,?)",
        (
            sid,
            compra.isoformat(),
            salida and salida.isoformat(),
            entregado and entregado.isoformat(),
            limite.isoformat(),
            localidad,
            estado,
        ),
    )


def test_bog_convierte_a_hora_de_bogota():
    # MeLi responde en -04:00: las 17:39 de allá son las 16:39 en Bogotá.
    assert E._bog("2026-09-17T17:39:33.000-04:00") == "2026-09-17T16:39:33"


def test_metricas_y_patrones(db):
    hoy = date.today()
    lunes = hoy - timedelta(days=hoy.weekday())
    n = 0
    with E._conn() as con:
        for semana in range(1, 9):
            base = lunes - timedelta(weeks=semana)
            # las 4 semanas más recientes entregan 1 h más tarde
            hora = 18 if semana <= 4 else 17
            for dia in range(5):
                d = datetime.combine(base + timedelta(days=dia), datetime.min.time())
                for k in range(3):
                    n += 1
                    compra = d.replace(hour=9)
                    _envio(con, str(n), compra, d.replace(hour=15), d.replace(hour=hora, minute=10 * k), d)

    r = E.resumen(10)
    cerradas = [s for s in r["serie"] if s["metricas"]["entregados"]]
    assert len(cerradas) == 8
    assert cerradas[0]["metricas"]["hora_mediana"] == pytest.approx(17 + 10 / 60, abs=0.01)
    assert cerradas[-1]["metricas"]["pct_mismo_dia_antes_corte"] == 100.0
    assert cerradas[-1]["metricas"]["pct_a_tiempo"] == 100.0
    alertas = " ".join(p["texto"] for p in r["patrones"] if p["tipo"] == "alerta")
    assert "Hora mediana de entrega" in alertas and "60 min más tarde" in alertas


def test_envio_abierto_con_alerta(db):
    hace_dos_dias = datetime.now() - timedelta(days=2)
    with E._conn() as con:
        _envio(con, "x1", hace_dos_dias, hace_dos_dias.replace(hour=15), None, hace_dos_dias, estado="shipped")
    r = E.resumen(4)
    assert r["abiertos"][0]["alerta"]
