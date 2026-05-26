"""
Programador de Web Push Notifications para la alarma de acciones.
Usa pywebpush + VAPID para enviar notificaciones incluso con pantalla bloqueada.
"""
import json, os, threading, time, logging

log = logging.getLogger(__name__)

_VAPID_EMAIL   = os.getenv("VAPID_EMAIL", "mailto:admin@mckennagroup.co")
_VAPID_PUBLIC  = os.getenv("VAPID_PUBLIC_KEY", "")
_VAPID_PEM_RAW = os.getenv("VAPID_PRIVATE_PEM", "")

# La clave privada viene en .env con \n literales; convertir a saltos de línea reales
_VAPID_PEM = _VAPID_PEM_RAW.replace("\\n", "\n") if _VAPID_PEM_RAW else ""

# ─── schedules: endpoint → { subscription, minutes, next_ts, active } ─────────
_schedules: dict[str, dict] = {}
_lock = threading.Lock()


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
            return
        _schedules[endpoint] = {
            "subscription": subscription,
            "minutes":      minutes,
            "next_ts":      time.time() + minutes * 60,
            "active":       True,
        }


def get_vapid_public_key() -> str:
    return _VAPID_PUBLIC


def push_disponible() -> bool:
    return bool(_VAPID_PEM and _VAPID_PUBLIC)


# ─── Hilo daemon que dispara pushes a tiempo ──────────────────────────────────
def _loop():
    while True:
        time.sleep(20)          # revisar cada 20 s (margen vs interval mínimo de 1 min)
        now = time.time()
        with _lock:
            stale = []
            for ep, sched in _schedules.items():
                if not sched["active"] or now < sched["next_ts"]:
                    continue
                ok = _enviar_push(sched["subscription"])
                if ok:
                    sched["next_ts"] = now + sched["minutes"] * 60
                else:
                    stale.append(ep)   # suscripción caducada
            for ep in stale:
                del _schedules[ep]


_daemon = threading.Thread(target=_loop, daemon=True, name="push-scheduler")
_daemon.start()
