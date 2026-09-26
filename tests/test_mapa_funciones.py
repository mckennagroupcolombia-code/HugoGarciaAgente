"""Mapa de funciones (RRHH): equivalente de mercado en honorarios y configuración fuera de git."""

from __future__ import annotations

import pytest

from app.services import mapa_funciones as MF


@pytest.fixture(autouse=True)
def _aislado(tmp_path, monkeypatch):
    monkeypatch.setattr(MF, "_RUTA", str(tmp_path / "rrhh_valoracion.json"))


def test_honorario_equivalente_en_el_minimo():
    # salario mínimo 2026 + prestaciones + auxilio, dividido por lo que le queda al contratista tras la PILA
    eq = MF.honorario_equivalente(MF.SMMLV_2026)
    paquete = MF.SMMLV_2026 * (0.92 + 0.2183) + MF.AUXILIO_2026
    assert eq == pytest.approx(paquete / (1 - 0.40 * 0.29022), rel=1e-6)
    assert 2_500_000 < eq < 2_600_000
    # por debajo del mínimo no existe salario legal: se usa el piso
    assert MF.honorario_equivalente(1_000_000) == eq
    # por encima de 2 SMMLV no hay auxilio de transporte
    alto = 2 * MF.SMMLV_2026 + 1
    assert MF.honorario_equivalente(alto) == pytest.approx(alto * 1.1383 / (1 - 0.40 * 0.29022), rel=1e-4)


def test_configuracion_y_extras():
    MF.actualizar_persona(5, {"pago_hoy": 2_500_000, "propuesta": 2_600_000, "mercado": {"cargo": "X", "min": 1_750_905, "max": 2_000_000}})
    with pytest.raises(ValueError):
        MF.actualizar_persona(5, {"mercado": {"min": 3, "max": 2}})
    e = MF.agregar_extra(5, "Atiende proveedores por teléfono", 3, 3, etapa="abastecer")
    assert e["etapa"] == "abastecer" and MF.cargar()["extras"][0]["funcion"].startswith("Atiende")
    with pytest.raises(ValueError):
        MF.agregar_extra(5, "", 3, 3)
    assert MF.quitar_extra(e["id"]) and not MF.cargar()["extras"]
    assert MF.etapa_de("modulo_empaque") == "dirigir" and MF.etapa_de("guias") == "entregar"
