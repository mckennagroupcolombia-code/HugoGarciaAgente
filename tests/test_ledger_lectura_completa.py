"""Que una lectura incompleta se note, y que el lote pueda leer completo.

Los topes de `armar_libro` están calibrados para el PANEL, donde alguien espera
la pantalla y vale más una cifra parcial rápida que una exacta lenta. Un
backfill es lo contrario: un período posteado a medias queda **cuadrado**, se ve
completo y nadie vuelve a mirarlo. Estos tests fijan las dos piezas que lo
evitan: topes configurables y el aviso que viaja hasta quien corre el lote.
"""

from __future__ import annotations

import os

import pytest


def test_los_topes_suben_por_variable_de_entorno(monkeypatch):
    from app.services import contabilidad_ledger as cl

    monkeypatch.delenv("CONTABILIDAD_LEDGER_BUDGET_S", raising=False)
    monkeypatch.delenv("CONTABILIDAD_LEDGER_MAX_PAGINAS", raising=False)
    monkeypatch.delenv("CONTABILIDAD_LEDGER_MAX_PAGINAS_MELI", raising=False)
    panel = (cl._remote_budget_s(), cl._max_paginas_facturas(), cl._max_paginas_meli())

    monkeypatch.setenv("CONTABILIDAD_LEDGER_BUDGET_S", "900")
    monkeypatch.setenv("CONTABILIDAD_LEDGER_MAX_PAGINAS", "500")
    monkeypatch.setenv("CONTABILIDAD_LEDGER_MAX_PAGINAS_MELI", "300")
    lote = (cl._remote_budget_s(), cl._max_paginas_facturas(), cl._max_paginas_meli())

    assert lote == (900.0, 500, 300)
    assert all(l > p for l, p in zip(lote, panel))


def test_un_valor_basura_no_deja_el_tope_en_cero(monkeypatch):
    """Un tope en 0 no leería nada y el período entraría vacío sin avisar."""
    from app.services import contabilidad_ledger as cl

    monkeypatch.setenv("CONTABILIDAD_LEDGER_BUDGET_S", "no-es-un-numero")
    monkeypatch.setenv("CONTABILIDAD_LEDGER_MAX_PAGINAS", "0")
    assert cl._remote_budget_s() >= 5.0
    assert cl._max_paginas_facturas() >= 10


def test_una_pagina_lenta_no_aborta_la_lectura_entera(monkeypatch):
    """Antes, un solo timeout hacía `break` y devolvía lo que llevara."""
    import requests

    from app.services import contabilidad_ledger as cl

    llamadas = {"n": 0}

    class _Res:
        status_code = 200

        def __init__(self, data):
            self._data = data

        def json(self):
            return self._data

    def _get(url, headers=None, params=None, timeout=None):
        llamadas["n"] += 1
        # La primera petición de la página 0 se cuelga; la siguiente responde.
        if llamadas["n"] == 1:
            raise requests.Timeout("simulado")
        if params.get("start", 0) == 0:
            return _Res([{"id": str(i), "date": "2026-07-05", "total": 1000} for i in range(30)])
        return _Res([])

    monkeypatch.setattr(cl, "_segundos_restantes", lambda *a, **k: 5.0)
    monkeypatch.setattr("app.services.alegra._alegra_headers", lambda: {})
    monkeypatch.setattr(requests, "get", _get)
    monkeypatch.setattr("time.sleep", lambda *_: None)

    import time as _t

    facturas, aviso = cl._facturas_alegra_rapido(
        "2026-07-01", "2026-07-31", deadline=_t.monotonic() + 600
    )
    assert len(facturas) == 30      # se reintentó y trajo la página
    assert aviso is None            # y no se declaró truncada


def test_si_la_pagina_nunca_responde_se_avisa_y_no_se_finge_completo(monkeypatch):
    import requests

    from app.services import contabilidad_ledger as cl

    def _get(*a, **k):
        raise requests.Timeout("siempre lenta")

    monkeypatch.setattr(cl, "_segundos_restantes", lambda *a, **k: 1.0)
    monkeypatch.setattr("app.services.alegra._alegra_headers", lambda: {})
    monkeypatch.setattr(requests, "get", _get)
    monkeypatch.setattr("time.sleep", lambda *_: None)

    import time as _t

    facturas, aviso = cl._facturas_alegra_rapido(
        "2026-07-01", "2026-07-31", deadline=_t.monotonic() + 600
    )
    assert facturas == []
    assert aviso and "no respondió" in aviso


def test_el_autopost_propaga_el_aviso_de_lectura_truncada(monkeypatch):
    """Sin esto el backfill decía «1.300 creados» y nada más."""
    from app.services import contabilidad_autopost as ap

    monkeypatch.setattr(ap, "armar_libro", lambda *a, **k: {
        "desde": "2026-07-01", "hasta": "2026-07-31",
        "movimientos": [],
        "avisos": ["MeLi: resultado parcial (1249 ventas)"],
    })
    r = ap.auto_postear_periodo("2026-07-01", "2026-07-31", dry_run=True)

    assert r["avisos"] == ["MeLi: resultado parcial (1249 ventas)"]
    assert r["montos_por_fuente"] == {}


def test_el_autopost_informa_cuanto_postea_por_fuente(monkeypatch):
    """«1.300 asientos» no permite contrastar contra la facturación; «$46M» sí."""
    from app.services import contabilidad_autopost as ap

    monkeypatch.setattr(ap, "armar_libro", lambda *a, **k: {
        "desde": "2026-07-01", "hasta": "2026-07-31",
        "avisos": [],
        "movimientos": [
            {"fuente": "meli_venta", "monto": 1000, "tipo": "ingreso", "fecha": "2026-07-02",
             "concepto": "Venta MeLi", "referencia": "a", "id": "a"},
            {"fuente": "meli_venta", "monto": 500, "tipo": "ingreso", "fecha": "2026-07-03",
             "concepto": "Venta MeLi", "referencia": "b", "id": "b"},
            {"fuente": "web_venta", "monto": 250, "tipo": "ingreso", "fecha": "2026-07-04",
             "concepto": "Venta web", "referencia": "c", "id": "c"},
        ],
    })
    r = ap.auto_postear_periodo("2026-07-01", "2026-07-31", dry_run=True)
    assert r["montos_por_fuente"] == {"meli_venta": 1500.0, "web_venta": 250.0}


def test_no_le_pide_a_alegra_un_rango_invertido(monkeypatch):
    """Alegra solo existe desde la migración (2026-09-02).

    Para julio, `max(desde, corte)` da 2026-09-02 y `hasta` es 2026-07-31: se le
    pedía «desde septiembre hasta julio». La API no responde, se agotan los
    reintentos y el backfill se declara truncado por un motivo inexistente —
    empujando a subir presupuestos que no eran el problema.
    """
    from app.services import contabilidad_ledger as cl

    monkeypatch.setattr(cl, "_facturas_siigo_solo_rapido", lambda d, h, deadline: ([], None))

    def _no_llamar(*a, **k):
        raise AssertionError("no debe consultarse Alegra para un período anterior al corte")

    monkeypatch.setattr(cl, "_facturas_alegra_rapido", _no_llamar)

    import time as _t

    facturas, aviso = cl._facturas_siigo_rapido(
        "2026-07-01", "2026-07-31", deadline=_t.monotonic() + 60
    )
    assert facturas == []
    assert aviso is None      # y sin aviso falso de truncamiento


def test_un_periodo_posterior_al_corte_si_consulta_alegra(monkeypatch):
    from app.services import contabilidad_ledger as cl

    llamado = {"n": 0}

    def _alegra(desde, hasta, deadline):
        llamado["n"] += 1
        assert desde <= hasta
        return [{"id": "1"}], None

    monkeypatch.setattr(cl, "_facturas_alegra_rapido", _alegra)

    import time as _t

    facturas, _ = cl._facturas_siigo_rapido(
        "2026-09-05", "2026-09-30", deadline=_t.monotonic() + 60
    )
    assert llamado["n"] == 1 and len(facturas) == 1


def test_el_dedup_no_se_reporta_como_lectura_incompleta():
    """Una alarma que suena en cada corrida deja de mirarse.

    El conteo de facturas omitidas por el dedup es el camino normal; mezclarlo
    con los avisos de truncamiento hacía que el backfill gritara «LA LECTURA NO
    FUE COMPLETA» siempre, justo hasta que la advertencia de verdad apareciera.
    """
    avisos = [
        "info: 1137 facturas omitidas por venir de un canal ya contado (MeLi/web)",
        "MeLi: resultado parcial (1249 ventas)",
    ]
    reales = [a for a in avisos if not a.lstrip().startswith("info:")]
    assert reales == ["MeLi: resultado parcial (1249 ventas)"]


def test_anteponer_la_fuente_no_tapa_el_marcador_informativo():
    """`f"Alegra: {msg}"` convertía «info: …» en «Alegra: info: …», que ya no
    empieza por `info:` — y el backfill volvía a gritar en cada corrida."""
    from app.services.contabilidad_ledger import _con_fuente

    r = _con_fuente("Alegra", "info: 1137 facturas omitidas")
    assert r.startswith("info:")
    assert "Alegra" in r and "1137" in r

    # Un aviso real sí se prefija, y no se prefija dos veces.
    assert _con_fuente("Alegra", "timeout; 0 parciales").startswith("Alegra: ")
    assert _con_fuente("Alegra", "Alegra: timeout") == "Alegra: timeout"
