"""Asiento de la compra que un socio hace con su tarjeta personal.

El socio compra en Amazon u otros comercios de EEUU con su tarjeta, la mercancía
llega **a su nombre como persona natural** y él se la entrega a McKenna para que
pueda venderla. La empresa le reintegra después.

Lo que estos tests fijan: **el banco de McKenna NO se mueve al comprar**. Se mueve
al reintegrarle. Hasta sep-2026 el auto-post generaba `Débito 1436 / Crédito 1110`,
lo que (a) acreditaba un banco que no se había movido, (b) no dejaba registro de a
qué socio se le debía, (c) clasificaba mercancía de EEUU como materia prima de
cacao y (d) perdía la cuota de manejo. Ver
`docs/agentic/modules/relaciones-socios-terceros.md`.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.contabilidad_autopost as ap

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()
    socio = cc.crear_tercero({
        "nombre": "Armando Garcia", "tipo": "socio", "tipo_persona": "natural",
        "identificacion": "1013630698", "usuario_id": 8,
    })
    return cc, ap, socio


def _cuentas(cc):
    return {c["codigo"]: c["id"] for c in cc.listar_plan_cuentas(solo_activas=False)}


def _fila(monto=182_537.0, cuota=13_429.0, usuario_id=8, nombre="Armando Garcia"):
    return {
        "fecha": "2026-09-02", "tipo": "egreso", "fuente": "compra_exterior",
        "concepto": "Compra exterior (USD)", "monto": monto, "referencia": "34",
        "extra": {
            "emisor_usuario_id": usuario_id, "emisor_nombre": nombre,
            "cuota_manejo_pct": 10.0, "cuota_manejo_cop": cuota,
        },
    }


def test_la_compra_no_acredita_el_banco(mods):
    """El núcleo del arreglo: la plata la puso el socio con su tarjeta."""
    cc, ap, _socio = mods
    cuentas = _cuentas(cc)
    lineas = ap._lineas_compra_socio(_fila(), cuentas)
    codigos = {c: i for i, c in cuentas.items()}
    usadas = {codigos[l["cuenta_id"]] for l in lineas}
    assert "1110" not in usadas, "no debe tocar Bancos: el banco se mueve al reintegrar"
    assert usadas == {"1435", "2380"}


def test_la_mercancia_va_a_1435_no_a_materia_prima_de_cacao(mods):
    cc, ap, _socio = mods
    cuentas = _cuentas(cc)
    codigos = {c: i for i, c in cuentas.items()}
    debito = next(l for l in ap._lineas_compra_socio(_fila(), cuentas) if l["debito"] > 0)
    assert codigos[debito["cuenta_id"]] == "1435"


def test_la_cuota_de_manejo_entra_al_costo(mods):
    # Antes no se registraba en ninguna parte: se emitía el PDF y ahí moría.
    cc, ap, _socio = mods
    cuentas = _cuentas(cc)
    lineas = ap._lineas_compra_socio(_fila(monto=182_537.0, cuota=13_429.0), cuentas)
    assert sum(l["debito"] for l in lineas) == pytest.approx(195_966, abs=1)
    assert sum(l["credito"] for l in lineas) == pytest.approx(195_966, abs=1)


def test_usa_la_cuota_liquidada_y_no_el_porcentaje_sobre_el_total(mods):
    """La cuota se cobra sobre la MERCANCÍA; `monto` incluye además el flete.
    Recalcular por porcentaje sobre `monto` inflaría la cuota."""
    cc, ap, _socio = mods
    cuentas = _cuentas(cc)
    lineas = ap._lineas_compra_socio(_fila(monto=200_000.0, cuota=5_000.0), cuentas)
    total = sum(l["debito"] for l in lineas)
    assert total == pytest.approx(205_000, abs=1)       # 200.000 + cuota liquidada
    assert total != pytest.approx(220_000, abs=1)       # NO 200.000 + 10%


def test_sin_cuota_liquidada_cae_al_porcentaje(mods):
    cc, ap, _socio = mods
    cuentas = _cuentas(cc)
    fila = _fila(monto=100_000.0)
    fila["extra"]["cuota_manejo_cop"] = None
    lineas = ap._lineas_compra_socio(fila, cuentas)
    assert sum(l["debito"] for l in lineas) == pytest.approx(110_000, abs=1)


def test_el_pasivo_queda_a_nombre_del_socio(mods):
    # Sin tercero no se sabe a quién se le debe, que era el otro defecto.
    cc, ap, socio = mods
    cuentas = _cuentas(cc)
    codigos = {c: i for i, c in cuentas.items()}
    credito = next(l for l in ap._lineas_compra_socio(_fila(), cuentas) if l["credito"] > 0)
    assert codigos[credito["cuenta_id"]] == "2380"
    assert credito["tercero_id"] == socio["id"]


def test_socio_no_enlazado_no_rompe_el_asiento(mods):
    """Si el usuario del panel no está enlazado a un tercero, el asiento se hace
    igual sin tercero — perder la contabilidad sería peor que perder el detalle,
    y queda visible que falta enlazarlo."""
    cc, ap, _socio = mods
    cuentas = _cuentas(cc)
    lineas = ap._lineas_compra_socio(_fila(usuario_id=999, nombre="Desconocido"), cuentas)
    credito = next(l for l in lineas if l["credito"] > 0)
    assert credito["tercero_id"] is None
    assert sum(l["debito"] for l in lineas) == pytest.approx(sum(l["credito"] for l in lineas))


def test_el_asiento_cuadra_y_se_puede_crear(mods):
    cc, ap, _socio = mods
    cuentas = _cuentas(cc)
    mov = cc.crear_movimiento(
        fecha="2026-09-02", concepto="Compra exterior (USD)",
        lineas=ap._lineas_compra_socio(_fila(), cuentas),
        referencia="auto:test", tipo_origen="auto_compra_exterior",
    )
    assert mov["id"]
    assert cc.balance_comprobacion()["cuadra"]


def test_compra_exterior_sigue_siendo_fuente_soportada(mods):
    # Si saliera de FUENTES_SOPORTADAS, el auto-post la reportaría como "sin
    # mapeo" y dejaría de contabilizarse en silencio.
    _cc, ap, _socio = mods
    assert "compra_exterior" in ap.FUENTES_ESPECIALES
    assert "compra_exterior" in ap.FUENTES_SOPORTADAS
