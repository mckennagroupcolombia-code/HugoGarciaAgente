"""
Programador de Web Push Notifications para la alarma de acciones.
Usa pywebpush + VAPID para enviar notificaciones incluso con pantalla bloqueada.

Las suscripciones se persisten en la tabla push_subscriptions de la DB de tickets
para sobrevivir reinicios del servidor.
"""
import json, os, threading, time, logging
from datetime import datetime

log = logging.getLogger(__name__)

_VAPID_EMAIL   = os.getenv("VAPID_EMAIL", "mailto:admin@mckennagroup.co")
_VAPID_PUBLIC  = os.getenv("VAPID_PUBLIC_KEY", "")
_VAPID_PEM_RAW = os.getenv("VAPID_PRIVATE_PEM", "")

# La clave privada viene en .env con \n literales; convertir a saltos de línea reales
_VAPID_PEM = _VAPID_PEM_RAW.replace("\\n", "\n") if _VAPID_PEM_RAW else ""

# ─── schedules: endpoint → { subscription, minutes, next_ts, active } ─────────
_schedules: dict[str, dict] = {}
_lock = threading.Lock()
_db_ready = False


# ─── Persistencia en DB ───────────────────────────────────────────────────────

def _get_conn():
    from app.services.tickets_db import _conn
    return _conn()


def _ensure_table():
    global _db_ready
    if _db_ready:
        return
    try:
        with _get_conn() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    endpoint TEXT PRIMARY KEY,
                    subscription_json TEXT NOT NULL,
                    minutes INTEGER NOT NULL DEFAULT 5,
                    actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            db.commit()
        _db_ready = True
    except Exception as exc:
        log.warning("[Push] No se pudo crear tabla push_subscriptions: %s", exc)


def _db_upsert(endpoint: str, subscription: dict, minutes: int):
    try:
        _ensure_table()
        with _get_conn() as db:
            db.execute(
                """INSERT INTO push_subscriptions (endpoint, subscription_json, minutes, actualizado_en)
                   VALUES (?, ?, ?, datetime('now'))
                   ON CONFLICT(endpoint) DO UPDATE SET
                     subscription_json=excluded.subscription_json,
                     minutes=excluded.minutes,
                     actualizado_en=excluded.actualizado_en""",
                (endpoint, json.dumps(subscription, ensure_ascii=False), minutes),
            )
            db.commit()
    except Exception as exc:
        log.warning("[Push] db_upsert error: %s", exc)


def _db_delete(endpoint: str):
    try:
        with _get_conn() as db:
            db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint,))
            db.commit()
    except Exception as exc:
        log.warning("[Push] db_delete error: %s", exc)


def _cargar_desde_db():
    """Carga suscripciones persistidas y las añade al scheduler en memoria."""
    try:
        _ensure_table()
        with _get_conn() as db:
            rows = db.execute(
                "SELECT endpoint, subscription_json, minutes FROM push_subscriptions"
            ).fetchall()
        now = time.time()
        loaded = 0
        with _lock:
            for row in rows:
                ep = row["endpoint"]
                try:
                    sub = json.loads(row["subscription_json"])
                    mins = int(row["minutes"]) or 5
                except Exception:
                    continue
                _schedules[ep] = {
                    "subscription": sub,
                    "minutes":      mins,
                    "next_ts":      now + mins * 60,  # primera vuelta tras reinicio
                    "active":       True,
                }
                loaded += 1
        if loaded:
            log.info("[Push] %d suscripción(es) restauradas desde DB", loaded)
    except Exception as exc:
        log.warning("[Push] No se pudo cargar suscripciones desde DB: %s", exc)


# ─── API pública ──────────────────────────────────────────────────────────────

def _enviar_push(subscription: dict) -> bool:
    """Envía un push. Devuelve True si tuvo éxito."""
    try:
        from pywebpush import webpush, WebPushException
        webpush(
            subscription_info=subscription,
            data=json.dumps({"type": "alarm-notification"}),
            vapid_private_key=_VAPID_PEM,
            vapid_claims={"sub": _VAPID_EMAIL},
        )
        return True
    except Exception as exc:
        msg = str(exc)
        log.warning("[Push] error: %s", msg[:120])
        # 410 Gone / 404 → suscripción caducada; eliminar
        return "410" not in msg and "404" not in msg


def set_schedule(endpoint: str, subscription: dict, minutes: int, active: bool):
    """Registrar o actualizar programación de alarma para una suscripción."""
    with _lock:
        if not active or minutes <= 0:
            _schedules.pop(endpoint, None)
            threading.Thread(target=_db_delete, args=(endpoint,), daemon=True).start()
            return
        _schedules[endpoint] = {
            "subscription": subscription,
            "minutes":      minutes,
            "next_ts":      time.time() + minutes * 60,
            "active":       True,
        }
    threading.Thread(target=_db_upsert, args=(endpoint, subscription, minutes), daemon=True).start()


def get_vapid_public_key() -> str:
    return _VAPID_PUBLIC


def push_disponible() -> bool:
    return bool(_VAPID_PEM and _VAPID_PUBLIC)


def _en_horario_silencio() -> bool:
    """No enviar pushes entre 22:00 y 07:00 hora local del servidor (Colombia UTC-5)."""
    hora = datetime.now().hour
    return hora >= 22 or hora < 7


# ─── Hilo daemon que dispara pushes a tiempo ──────────────────────────────────
def _loop():
    # Esperar a que la app esté lista antes de cargar desde DB
    time.sleep(5)
    _cargar_desde_db()

    while True:
        time.sleep(20)          # revisar cada 20 s (margen vs interval mínimo de 1 min)
        now = time.time()
        with _lock:
            stale = []
            for ep, sched in _schedules.items():
                if not sched["active"] or now < sched["next_ts"]:
                    continue
                if _en_horario_silencio():
                    # Posponer al horario laboral: no molestar de 22:00 a 07:00
                    continue
                ok = _enviar_push(sched["subscription"])
                if ok:
                    sched["next_ts"] = now + sched["minutes"] * 60
                else:
                    stale.append(ep)   # suscripción caducada
            for ep in stale:
                del _schedules[ep]
        if stale:
            for ep in stale:
                threading.Thread(target=_db_delete, args=(ep,), daemon=True).start()


_daemon = threading.Thread(target=_loop, daemon=True, name="push-scheduler")
_daemon.start()
