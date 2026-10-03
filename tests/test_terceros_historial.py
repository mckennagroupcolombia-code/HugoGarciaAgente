"""Historial por tercero: el porqué, no solo el estado.

La ficha guarda que alguien está exento o es del SIMPLE; el historial guarda
**cómo se llegó ahí y qué le ha pasado**, que es lo que hace falta cuando
alguien abre un tercero seis meses después y tiene que decidir si lo que ve
sigue vigente. Hasta ahora esa memoria vivía en el campo `notas`, en las tablas
de cada módulo y en la cabeza de quien estuvo.
"""
from __future__ import annotations

import pytest

import app.services.contabilidad_core as cc


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    from app.services import terceros_historial as th

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    cc._ensure()
    th._ensure()
    t = cc.crear_tercero({"nombre": "FIDEL ROCHA MORON", "tipo": "proveedor",
                          "tipo_persona": "natural", "identificacion": "9385573"})
    return th, t["id"]


def test_registra_y_devuelve_en_orden(libro):
    th, tid = libro
    th.registrar(tid, fecha="2024-05-01", tipo="fiscal", titulo="Deja de facturar como S.A.S")
    th.registrar(tid, fecha="2026-09-18", tipo="contador", titulo="El contador fija 523550 + 1%")
    h = th.historial(tid)
    titulos = [e["titulo"] for e in h["eventos"]]
    assert titulos[0].startswith("El contador")     # lo más reciente primero
    assert len(titulos) == 2


def test_el_mismo_hecho_no_se_registra_dos_veces(libro):
    """Si un cron o un reintento vuelve a pasar, el historial no se llena de
    duplicados que después nadie sabe si fueron dos hechos o dos registros."""
    th, tid = libro
    for _ in range(3):
        th.registrar(tid, fecha="2026-09-18", titulo="El DSMG1 salió sin retenciones")
    assert th.historial(tid)["total_eventos"] == 1


def test_un_evento_sin_titulo_no_sirve(libro):
    th, tid = libro
    with pytest.raises(ValueError, match="título"):
        th.registrar(tid, fecha="2026-09-18", titulo="   ")


def test_un_tipo_inventado_se_rechaza(libro):
    th, tid = libro
    with pytest.raises(ValueError, match="tipo inválido"):
        th.registrar(tid, fecha="2026-09-18", titulo="x", tipo="loquesea")


def test_el_perfil_tributario_se_explica_en_palabras(libro):
    """«regimen_simple = 1» no le dice nada a quien abre la ficha; hay que
    decirle qué significa y con qué norma."""
    th, tid = libro
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET emite_doc_soporte=1, ica_por_mil=4.14,"
                    " cuenta_gasto_default='523550' WHERE id=?", (tid,))
    p = " ".join(th.historial(tid)["perfil_tributario"])
    assert "4.14 por mil" in p
    assert "documento soporte" in p and "771-2" in p
    assert "523550" in p


def test_el_simple_se_explica_con_su_articulo(libro):
    th, tid = libro
    with cc._conn() as con:
        con.execute("UPDATE cc_terceros SET regimen_simple=1 WHERE id=?", (tid,))
    p = " ".join(th.historial(tid)["perfil_tributario"])
    assert "911" in p and "ni de ICA" in p


def test_trae_los_documentos_soporte_sin_copiarlos(libro):
    """Se leen de `cc_doc_soporte` en vez de duplicarse: una copia se
    desactualiza y entonces hay dos versiones de lo que pasó."""
    th, tid = libro
    from app.services import doc_soporte_pagos as ds

    ds._ensure()
    with cc._conn() as con:
        con.execute(
            "INSERT INTO cc_doc_soporte (solicitud_id, tercero_id, fecha, valor, alegra_id,"
            " numero, estado) VALUES (19, ?, '2026-09-18', 2026657, '1', 'DSMG1', 'success')",
            (tid,),
        )
    ev = [e for e in th.historial(tid)["eventos"] if e["origen"] == "doc_soporte"]
    assert len(ev) == 1
    assert "DSMG1" in ev[0]["titulo"]
    assert ev[0]["monto"] == pytest.approx(2_026_657, abs=1)


def test_un_tercero_que_no_existe_da_error_claro(libro):
    th, _tid = libro
    with pytest.raises(ValueError, match="no encontrado"):
        th.historial(99999)
