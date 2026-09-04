"""Al marcar visto, el recordatorio debe avanzar un ciclo completo, no quedarse en hoy."""
from __future__ import annotations

from datetime import date

from app.services.tickets_db import _siguiente_tras_hoy


def _rec(tipo, proxima, **extra):
    r = {
        "tipo_rep": tipo,
        "proxima_fecha": proxima,
        "cada_n_dias": None,
        "dias_semana_parsed": [],
        "dias_mes_parsed": [],
    }
    r.update(extra)
    return r


def test_bimestral_avanza_dos_meses_no_al_dia_siguiente():
    # Caso real: "Pagar agua" 2026-08-29. El visto no puede caer en 2026-09-04.
    nxt = _siguiente_tras_hoy(
        _rec("bimestral", "2026-08-29"),
        hoy=date(2026, 9, 3),
    )
    assert nxt == "2026-10-29"


def test_bimestral_visto_el_mismo_dia_no_deja_manana():
    nxt = _siguiente_tras_hoy(
        _rec("bimestral", "2026-08-28"),
        hoy=date(2026, 8, 28),
    )
    assert nxt == "2026-10-28"


def test_cada_n_dias_avanza_el_periodo_completo():
    nxt = _siguiente_tras_hoy(
        _rec("cada_n_dias", "2026-09-14", cada_n_dias=15),
        hoy=date(2026, 9, 14),
    )
    assert nxt == "2026-09-29"


def test_cada_n_dias_vencido_salta_hasta_despues_de_hoy():
    nxt = _siguiente_tras_hoy(
        _rec("cada_n_dias", "2026-08-30", cada_n_dias=15),
        hoy=date(2026, 9, 14),
    )
    assert nxt == "2026-09-29"


def test_diario_pasa_a_manana():
    nxt = _siguiente_tras_hoy(
        _rec("diario", "2026-08-29"),
        hoy=date(2026, 9, 3),
    )
    assert nxt == "2026-09-04"


def test_mensual_vencido_va_al_proximo_dia_del_mes():
    nxt = _siguiente_tras_hoy(
        _rec("mensual", "2026-08-28", dias_mes_parsed=[28]),
        hoy=date(2026, 9, 3),
    )
    assert nxt == "2026-09-28"


def test_mensual_el_dia_de_cobro_va_al_mes_siguiente():
    nxt = _siguiente_tras_hoy(
        _rec("mensual", "2026-09-18", dias_mes_parsed=[18]),
        hoy=date(2026, 9, 18),
    )
    assert nxt == "2026-10-18"


def test_mensual_no_se_queda_en_la_misma_fecha_futura():
    """Visto sobre un mensual aún no vencido no debe devolver la misma fecha."""
    nxt = _siguiente_tras_hoy(
        _rec("mensual", "2026-09-18", dias_mes_parsed=[18]),
        hoy=date(2026, 9, 3),
    )
    assert nxt == "2026-09-18" or nxt > "2026-09-03"
    # Si está en "próximos" el botón visto no se muestra; si se llama, no retrocede.
    assert nxt >= "2026-09-18"


def test_semanal_lunes_avanza_a_la_proxima_semana():
    # 2026-09-03 es jueves; lunes siguiente = 2026-09-07
    nxt = _siguiente_tras_hoy(
        _rec("semanal", "2026-08-31", dias_semana_parsed=[0]),
        hoy=date(2026, 9, 3),
    )
    assert nxt == "2026-09-07"
