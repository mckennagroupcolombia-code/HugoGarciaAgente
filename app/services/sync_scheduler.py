"""
Programación automática de sincronizaciones MeLi ↔ Siigo.

- Diario 05:00: sync del día, inteligente y completo (reporte stock).
- Cada 30 días (05:00): sync profunda (últimos 10 días de facturas).
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta

_STATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "sync_schedule_state.json"
)
_lock = threading.Lock()

DAILY_HOUR = int(os.getenv("SYNC_SCHEDULE_DAILY_HOUR", "5"))
DEEP_INTERVAL_DAYS = int(os.getenv("SYNC_SCHEDULE_DEEP_DAYS", "30"))
DEEP_LOOKBACK_DAYS = int(os.getenv("SYNC_SCHEDULE_DEEP_LOOKBACK", "10"))

SCHEDULED_JOBS = [
    {
        "id": "daily",
        "label": "Sync diaria",
        "description": "Facturas MeLi del último día",
        "cadence": f"Todos los días a las {DAILY_HOUR:02d}:00",
        "automated": True,
    },
    {
        "id": "inteligente",
        "label": "Sync inteligente",
        "description": "Cruce MeLi vs Siigo",
        "cadence": f"Todos los días a las {DAILY_HOUR:02d}:00",
        "automated": True,
    },
    {
        "id": "completo",
        "label": "Sync completo",
        "description": "Reporte de stock por WhatsApp",
        "cadence": f"Todos los días a las {DAILY_HOUR:02d}:00",
        "automated": True,
    },
    {
        "id": "profunda",
        "label": "Sync profunda",
        "description": f"Facturas de los últimos {DEEP_LOOKBACK_DAYS} días",
        "cadence": f"Cada {DEEP_INTERVAL_DAYS} días a las {DAILY_HOUR:02d}:00",
        "automated": True,
    },
]


def _default_state() -> dict:
    return {
        "last_daily_run": None,
        "last_deep_run": None,
        "last_daily_date": None,
        "last_deep_date": None,
        "history": [],
    }


def _load_state() -> dict:
    try:
        with open(_STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        base = _default_state()
        base.update(data if isinstance(data, dict) else {})
        return base
    except Exception:
        return _default_state()


def _save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(_STATE_PATH), exist_ok=True)
    with open(_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def _append_history(state: dict, kind: str, ok: bool, detail: str = "") -> None:
    entry = {
        "kind": kind,
        "at": datetime.now().isoformat(timespec="seconds"),
        "ok": ok,
        "detail": (detail or "")[:500],
    }
    hist = state.get("history") or []
    hist.append(entry)
    state["history"] = hist[-40:]


def _next_daily_run(now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    candidate = now.replace(hour=DAILY_HOUR, minute=0, second=0, microsecond=0)
    if now >= candidate:
        candidate += timedelta(days=1)
    return candidate


def _next_deep_run(state: dict, now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    last = state.get("last_deep_run")
    if last:
        try:
            last_dt = datetime.fromisoformat(str(last))
            due = last_dt + timedelta(days=DEEP_INTERVAL_DAYS)
            due = due.replace(hour=DAILY_HOUR, minute=0, second=0, microsecond=0)
            if due > now:
                return due
        except Exception:
            pass
    nxt = _next_daily_run(now)
    return nxt


def get_schedule_status() -> dict:
    state = _load_state()
    now = datetime.now()
    return {
        "enabled": True,
        "timezone": "local",
        "daily_hour": DAILY_HOUR,
        "deep_interval_days": DEEP_INTERVAL_DAYS,
        "deep_lookback_days": DEEP_LOOKBACK_DAYS,
        "jobs": SCHEDULED_JOBS,
        "last_daily_run": state.get("last_daily_run"),
        "last_deep_run": state.get("last_deep_run"),
        "next_daily_run": _next_daily_run(now).isoformat(timespec="seconds"),
        "next_deep_run": _next_deep_run(state, now).isoformat(timespec="seconds"),
        "history": list(reversed(state.get("history") or []))[:10],
    }


def _run_daily_batch() -> None:
    from app.panel_activity import run_logged_job
    from app.sync import (
        ejecutar_sincronizacion_y_reporte_stock,
        sincronizar_facturas_recientes,
        sincronizar_inteligente,
    )

    run_logged_job("auto_sync_diaria", sincronizar_facturas_recientes, (1,))
    run_logged_job("auto_sync_inteligente", sincronizar_inteligente, ())
    run_logged_job("auto_sync_completo", ejecutar_sincronizacion_y_reporte_stock, ())


def _run_deep_sync() -> None:
    from app.panel_activity import run_logged_job
    from app.sync import sincronizar_facturas_recientes

    run_logged_job(
        "auto_sync_profunda",
        sincronizar_facturas_recientes,
        (DEEP_LOOKBACK_DAYS,),
    )


def _execute_scheduled(now: datetime) -> None:
    state = _load_state()
    today = now.strftime("%Y-%m-%d")
    ran_daily = False
    ran_deep = False

    if state.get("last_daily_date") != today:
        try:
            _run_daily_batch()
            state["last_daily_run"] = now.isoformat(timespec="seconds")
            state["last_daily_date"] = today
            _append_history(state, "daily_batch", True)
            ran_daily = True
        except Exception as e:
            _append_history(state, "daily_batch", False, str(e))
            print(f"❌ [SYNC-SCHED] Lote diario falló: {e}")

    last_deep = state.get("last_deep_run")
    due_deep = True
    if last_deep:
        try:
            last_dt = datetime.fromisoformat(str(last_deep))
            due_deep = (now - last_dt).days >= DEEP_INTERVAL_DAYS
        except Exception:
            due_deep = True

    if due_deep and state.get("last_deep_date") != today:
        try:
            _run_deep_sync()
            state["last_deep_run"] = now.isoformat(timespec="seconds")
            state["last_deep_date"] = today
            _append_history(state, "deep_sync", True)
            ran_deep = True
        except Exception as e:
            _append_history(state, "deep_sync", False, str(e))
            print(f"❌ [SYNC-SCHED] Sync profunda falló: {e}")

    _save_state(state)
    if ran_daily or ran_deep:
        print(
            f"✅ [SYNC-SCHED] Ejecutado a las {now:%H:%M} — "
            f"diario={'sí' if ran_daily else 'no'}, profundo={'sí' if ran_deep else 'no'}"
        )


def tick(now: datetime | None = None) -> None:
    """Llamar desde monitor_loop cuando hour == DAILY_HOUR (una vez al día)."""
    now = now or datetime.now()
    if now.hour != DAILY_HOUR:
        return
    state = _load_state()
    marker = now.strftime("%Y-%m-%d")
    if state.get("last_tick_date") == marker:
        return
    with _lock:
        state = _load_state()
        if state.get("last_tick_date") == marker:
            return
        state["last_tick_date"] = marker
        _save_state(state)
    threading.Thread(
        target=_execute_scheduled,
        args=(now,),
        daemon=True,
        name="sync-scheduler-run",
    ).start()
