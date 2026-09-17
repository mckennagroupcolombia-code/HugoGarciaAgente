"""Migración del libro al PUC real (Decreto 2650).

Lo que se protege: que ningún código inventado quede en uso, que mover una
cuenta no descuadre la partida doble, y sobre todo el **código reutilizado** —
`529505` deja de ser publicidad y pasa a ser comisiones, así que el orden de la
migración decide si los $105M de publicidad y los $52M de comisiones terminan
en su cuenta o revueltos en una sola.
"""

from __future__ import annotations

import pytest


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.puc_colombia as puc

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()
    # El libro real tiene 529505 con el nombre viejo («Publicidad en plataformas
    # de venta»): no lo siembra `_migrar_cuentas_v2`, lo creó a mano el script de
    # Product Ads. Sin reproducirlo acá, el caso del código reutilizado —el único
    # que puede revolver $105M con $52M— no se estaría probando.
    with cc._conn() as con:
        con.execute(
            "UPDATE cc_plan_cuentas SET nombre=? WHERE codigo='529505'",
            ("Publicidad en plataformas de venta",),
        )
    return cc, puc


def _codigo_de(cc, mov_id: int) -> list[str]:
    with cc._conn() as con:
        return [
            r["codigo"]
            for r in con.execute(
                """SELECT p.codigo FROM cc_movimiento_lineas l
                     JOIN cc_plan_cuentas p ON p.id = l.cuenta_id
                    WHERE l.movimiento_id=? ORDER BY l.orden""",
                (mov_id,),
            )
        ]


def test_el_orden_vacia_un_codigo_antes_de_reutilizarlo(libro):
    _cc, puc = libro
    orden = puc._orden_migracion()
    pos = {origen: i for i, (origen, _) in enumerate(orden)}
    # 529505 (publicidad → 523560) tiene que salir antes de que 5299 traiga las
    # comisiones a 529505. Al revés, las comisiones se irían a publicidad.
    assert pos["529505"] < pos["5299"]
    assert len(orden) == len(puc.ALIAS)


def test_publicidad_y_comisiones_no_se_revuelven(libro):
    """El caso que motivó el orden: dos cuentas que se cruzan en un mismo código."""
    cc, puc = libro
    with cc._conn() as con:
        publicidad = cc._cuenta_id_por_codigo(con, "529505")
        comisiones = cc._cuenta_id_por_codigo(con, "5299")
        banco = cc._cuenta_id_por_codigo(con, "1110")
    m_pub = cc.crear_movimiento(
        fecha="2026-08-01", concepto="Product Ads MeLi",
        lineas=[{"cuenta_id": publicidad, "debito": 105_000, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 105_000}],
    )["id"]
    m_com = cc.crear_movimiento(
        fecha="2026-08-02", concepto="Comisión de venta MeLi",
        lineas=[{"cuenta_id": comisiones, "debito": 52_000, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 52_000}],
    )["id"]

    puc.migrar(dry_run=False)

    assert _codigo_de(cc, m_pub)[0] == "523560"   # publicidad, propaganda y promoción
    assert _codigo_de(cc, m_com)[0] == "529505"   # comisiones


def test_el_codigo_reutilizado_queda_activo_y_con_el_nombre_del_decreto(libro):
    cc, puc = libro
    puc.migrar(dry_run=False)
    with cc._conn() as con:
        fila = dict(con.execute("SELECT * FROM cc_plan_cuentas WHERE codigo='529505'").fetchone())
    assert fila["activa"] == 1
    assert fila["nombre"] == "Comisiones"
    assert "publicidad" in fila["notas"].lower()


def test_el_codigo_abandonado_se_desactiva_pero_no_se_borra(libro):
    cc, puc = libro
    puc.migrar(dry_run=False)
    with cc._conn() as con:
        fila = dict(con.execute("SELECT * FROM cc_plan_cuentas WHERE codigo='2380'").fetchone())
    assert fila["activa"] == 0
    assert "2355" in fila["notas"]


def test_el_codigo_viejo_sigue_resolviendo_despues_de_migrar(libro):
    """Los ~60 call-sites que dicen "2380" no se rompen el día de la migración."""
    cc, puc = libro
    puc.migrar(dry_run=False)
    with cc._conn() as con:
        via_alias = cc._cuenta_id_por_codigo(con, "2380")
        directo = cc._cuenta_id_por_codigo(con, "2355")
        assert via_alias == directo
        assert cc._cuenta_id_por_codigo(con, "2367") == cc._cuenta_id_por_codigo(con, "2335")
        assert cc._cuenta_id_por_codigo(con, "2295") == cc._cuenta_id_por_codigo(con, "2195")


def test_migrar_no_descuadra_la_partida_doble(libro):
    cc, puc = libro
    with cc._conn() as con:
        socios = cc._cuenta_id_por_codigo(con, "2380")
        inventario = cc._cuenta_id_por_codigo(con, "1435")
    cc.crear_movimiento(
        fecha="2026-08-10", concepto="Compra del socio",
        lineas=[{"cuenta_id": inventario, "debito": 300_000, "credito": 0},
                {"cuenta_id": socios, "debito": 0, "credito": 300_000}],
    )
    antes = cc.balance_comprobacion()
    puc.migrar(dry_run=False)
    despues = cc.balance_comprobacion()

    assert antes["cuadra"] and despues["cuadra"]
    assert despues["total_debito"] == antes["total_debito"]
    assert despues["total_credito"] == antes["total_credito"]


def test_dry_run_no_escribe_nada(libro):
    cc, puc = libro
    with cc._conn() as con:
        socios = cc._cuenta_id_por_codigo(con, "2380")
        inventario = cc._cuenta_id_por_codigo(con, "1435")
    mid = cc.crear_movimiento(
        fecha="2026-08-10", concepto="Compra del socio",
        lineas=[{"cuenta_id": inventario, "debito": 300_000, "credito": 0},
                {"cuenta_id": socios, "debito": 0, "credito": 300_000}],
    )["id"]

    plan = puc.migrar(dry_run=True)
    assert plan["dry_run"] is True
    assert any(m["de"] == "2380" and m["lineas"] == 1 for m in plan["movimientos"])
    assert "2380" in _codigo_de(cc, mid)   # sigue donde estaba


def test_repetir_la_migracion_no_se_lleva_las_comisiones_a_publicidad(libro):
    """El caso que casi cuesta $52M.

    Tras la primera corrida, `529505` ya NO es publicidad: es Comisiones, y
    tiene adentro lo que vino de 5299. Volver a aplicar el alias
    `529505 → 523560` se llevaría esas comisiones a publicidad. El estado del
    plan no basta para detectarlo —la cuenta quedó activa, con otro nombre,
    idéntica a una que nunca se migró— así que la migración deja constancia de
    qué alias ya aplicó y los salta.
    """
    cc, puc = libro
    with cc._conn() as con:
        publicidad = cc._cuenta_id_por_codigo(con, "529505")
        comisiones = cc._cuenta_id_por_codigo(con, "5299")
        banco = cc._cuenta_id_por_codigo(con, "1110")
    cc.crear_movimiento(
        fecha="2026-08-01", concepto="Product Ads",
        lineas=[{"cuenta_id": publicidad, "debito": 105_000, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 105_000}],
    )
    m_com = cc.crear_movimiento(
        fecha="2026-08-02", concepto="Comisión de venta",
        lineas=[{"cuenta_id": comisiones, "debito": 52_000, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 52_000}],
    )["id"]

    puc.migrar(dry_run=False)
    assert _codigo_de(cc, m_com)[0] == "529505"
    assert "529505" in puc.alias_aplicados()

    # Segunda y tercera corrida: las comisiones se quedan donde están.
    for _ in range(2):
        r = puc.migrar(dry_run=False)
        assert r["lineas_afectadas"] == 0
        assert _codigo_de(cc, m_com)[0] == "529505"


def test_migrar_dos_veces_no_cambia_nada(libro):
    cc, puc = libro
    with cc._conn() as con:
        socios = cc._cuenta_id_por_codigo(con, "2380")
        inventario = cc._cuenta_id_por_codigo(con, "1435")
    mid = cc.crear_movimiento(
        fecha="2026-08-10", concepto="Compra del socio",
        lineas=[{"cuenta_id": inventario, "debito": 300_000, "credito": 0},
                {"cuenta_id": socios, "debito": 0, "credito": 300_000}],
    )["id"]
    puc.migrar(dry_run=False)
    primero = _codigo_de(cc, mid)
    segunda = puc.migrar(dry_run=False)

    assert _codigo_de(cc, mid) == primero == ["1435", "2355"]
    assert segunda["lineas_afectadas"] == 0


def test_la_retencion_tiene_subcuenta_por_concepto(libro):
    _cc, puc = libro
    assert puc.cuenta_retencion("servicios") == "236525"
    assert puc.cuenta_retencion("honorarios") == "236515"
    assert puc.cuenta_retencion("compras") == "236540"
    # El 7% de los préstamos de particulares. 236515 NO es esto — es honorarios.
    assert puc.cuenta_retencion("rendimientos_financieros") == "236535"
    assert puc.cuenta_retencion("lo_que_sea") == "236595"


def test_ningun_alias_apunta_a_un_codigo_que_no_este_en_el_puc(libro):
    _cc, puc = libro
    codigos = {c for c, _, _ in puc.PUC_MCKENNA}
    faltantes = [d for d in puc.ALIAS.values() if d not in codigos]
    assert faltantes == []
