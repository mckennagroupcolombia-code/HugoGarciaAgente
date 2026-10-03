"""
Cese de actividades global: un solo interruptor para dejar de vender por todos los canales
mientras se reestructura (control de inventario, cambios operativos). Nació el 23-sep-2026.

Estado en ``app/data/cese_actividades.json`` (``"activa": true``). Lo leen:
  - ``/whatsapp`` (app/routes.py): a un cliente 1:1 le contesta ``mensaje_whatsapp`` (una vez
    cada ``HORAS_ENTRE_AVISOS`` por chat) y no pasa el mensaje ni al bot ni a modo humano.
  - el puente Node (bot-mckenna/server.js): ``/enviar``, ``/enviar-archivo`` y ``/enviar-ptt``
    rechazan (423) todo destino que no sea un grupo ni esté en ``numeros_internos``. Así ningún
    envío del panel ni automático (confirmaciones de pago, asesor desde /app) llega a un cliente.
    Lo que se escribe directamente desde el teléfono NO se puede frenar desde aquí.
  - la web: ``scripts/cese_actividades.py`` crea ``PAGINA_WEB/site/data/MANTENIMIENTO`` con el
    contenido ``cese`` y website.py sirve ``mantenimiento/cese.html``.
  - MeLi: ``scripts/pausa_global_meli.py`` (lista de lo pausado en meli_pausa_global.json).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time

ARCHIVO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cese_actividades.json")
HORAS_ENTRE_AVISOS = 6

MENSAJE_DEFAULT = (
    "Hola, gracias por escribir a McKenna Group. Tendremos un mantenimiento para seguir "
    "mejorando tu experiencia; mientras tanto no estamos recibiendo pedidos nuevos. "
    "Te avisaremos por este medio cuando retomemos. ¡Gracias por tu paciencia!"
)

_ultimo_aviso: dict[str, float] = {}
_lock = threading.Lock()


def estado() -> dict:
    try:
        with open(ARCHIVO, encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, ValueError):
        return {}


def activo() -> bool:
    return bool(estado().get("activa"))


def mensaje_whatsapp() -> str:
    return str(estado().get("mensaje_whatsapp") or MENSAJE_DEFAULT)


def _digitos(jid: str) -> str:
    return re.sub(r"\D", "", str(jid or "").split("@")[0])


def es_interno(*jids: str) -> bool:
    internos = {_digitos(n) for n in (estado().get("numeros_internos") or []) if _digitos(n)}
    return any(_digitos(j) in internos for j in jids if j)


def aviso_para(sender_id: str) -> str | None:
    """Texto a responder a este cliente, o None si ya se le avisó hace poco."""
    ahora = time.time()
    with _lock:
        previo = _ultimo_aviso.get(sender_id, 0.0)
        if ahora - previo < HORAS_ENTRE_AVISOS * 3600:
            return None
        _ultimo_aviso[sender_id] = ahora
    return mensaje_whatsapp()
