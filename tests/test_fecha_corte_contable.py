"""Lo anterior al corte contable es territorio del contador y no se toca.

Hasta agosto de 2026 la contabilidad la llevó él: discriminaba los impuestos con
un mecanismo propio que no conocemos y sobre eso presentó las declaraciones (el
350 del período 8 se presentó el 16-sep-2026). El libro propio nació después y
no puede pretender explicar ese pasado — los saldos iniciales los va a fijar él,
por la migración de Siigo a Alegra.

No es una precaución teórica: el 18-sep-2026 aparecieron asientos de IVA
generado de julio, agosto y un septiembre **sin terminar**, y los pagos a Fidel
de julio/agosto —hechos con el tratamiento viejo, contra 513550 y sin
retención— estaban listos para espejarse a Alegra.
"""
from __future__ import annotations

import pytest

import app.services.contabilidad_core as cc


@pytest.fixture(autouse=True)
def corte_por_defecto(monkeypatch):
    monkeypatch.delenv("CONTABILIDAD_FECHA_CORTE", raising=False)


def test_el_corte_por_defecto_es_septiembre_2026():
    """Agosto fue el último período declarado por el contador."""
    assert cc.fecha_corte() == "2026-09-01"


@pytest.mark.parametrize("fecha, antes", [
    ("2026-07-03", True),    # pago a Fidel, ya declarado
    ("2026-08-31", True),    # último día declarado
    ("2026-09-01", False),   # el corte mismo ya es nuestro
    ("2026-09-18", False),
])
def test_que_queda_de_cada_lado(fecha, antes):
    assert cc.antes_del_corte(fecha) is antes


def test_el_corte_se_puede_mover_por_entorno(monkeypatch):
    """Lo fija el contador cuando entregue los saldos iniciales."""
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-10-01")
    assert cc.fecha_corte() == "2026-10-01"
    assert cc.antes_del_corte("2026-09-18") is True


def test_el_motivo_dice_que_hacer():
    """Quien lo lee tiene que entender por qué y cómo cambiarlo, sin ir al código."""
    m = cc.motivo_corte("2026-07-03")
    assert "2026-07-03" in m and "2026-09-01" in m
    assert "contador" in m
    assert "CONTABILIDAD_FECHA_CORTE" in m


def test_una_fecha_vacia_no_bloquea():
    assert cc.antes_del_corte("") is False
    assert cc.antes_del_corte(None) is False


# ─── El auto-posteo recorta, no revienta ───────────────────────────────────

def test_el_autopost_no_postea_un_periodo_ya_declarado(monkeypatch):
    from app.services import contabilidad_autopost as ap

    llamado = {"n": 0}
    monkeypatch.setattr(ap, "armar_libro", lambda *a, **k: llamado.__setitem__("n", 1))
    r = ap.auto_postear_periodo("2026-07-01", "2026-07-31", dry_run=True)
    assert r["bloqueado_por_corte"] is True
    assert r["creados"] == 0
    assert llamado["n"] == 0          # ni siquiera arma el libro
    assert "contador" in r["avisos"][-1]


def test_un_rango_que_cruza_el_corte_se_recorta(monkeypatch):
    """Un backfill que empiece antes sigue sirviendo para lo que sí es nuestro:
    rechazarlo entero obligaría a adivinar la fecha exacta."""
    from app.services import contabilidad_autopost as ap

    visto = {}
    def _falso(desde, hasta, **k):
        visto["desde"], visto["hasta"] = desde, hasta
        return {"movimientos": [], "avisos": [], "desde": desde, "hasta": hasta}
    monkeypatch.setattr(ap, "armar_libro", _falso)
    r = ap.auto_postear_periodo("2026-08-15", "2026-09-05", dry_run=True)
    assert visto["desde"] == "2026-09-01"        # recortado
    assert visto["hasta"] == "2026-09-05"
    assert any("recortó" in a for a in r["avisos"])


# ─── El espejo a Alegra tampoco pasa el corte ───────────────────────────────

def test_el_espejo_no_manda_a_alegra_un_periodo_declarado(monkeypatch, tmp_path):
    """Meter a Alegra un asiento de julio le desordena al contador lo que ya
    presentó: él arma las declaraciones con lo que ve ahí."""
    from app.services import alegra_espejo as ae

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    cc._ensure()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        gasto = cc._cuenta_id_por_codigo(con, "513550")
    mov = cc.crear_movimiento(
        fecha="2026-07-03", concepto="Mensajería julio",
        lineas=[{"cuenta_id": gasto, "debito": 1_845_000, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 1_845_000}],
    )
    # `forzar` autoriza postear con el asiento a la vista; NO reescribir un
    # período cerrado. Por eso también queda bloqueado.
    r = ae.espejar_movimiento(mov["id"], forzar=True)
    assert r["status"] == "bloqueado_por_corte"
    assert "contador" in r["message"]


def test_despues_del_corte_el_espejo_sigue_su_curso(monkeypatch, tmp_path):
    """La guarda no puede volverse un freno general: lo de septiembre en
    adelante es del libro propio y tiene que llegar a Alegra."""
    from app.services import alegra_espejo as ae

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "t2.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    cc._ensure()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        gasto = cc._cuenta_id_por_codigo(con, "513550")
    mov = cc.crear_movimiento(
        fecha="2026-09-18", concepto="Mensajería septiembre",
        lineas=[{"cuenta_id": gasto, "debito": 100_000, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 100_000}],
    )
    monkeypatch.setattr(ae, "tipos_comprobante", lambda **k: ([], "sin conexión"))
    r = ae.espejar_movimiento(mov["id"], forzar=True)
    # Falla por otra razón (no hay red en el test), pero NO por el corte.
    assert r["status"] != "bloqueado_por_corte"
