"""
Detector de mensajes postventa MeLi no capturados (huecos).

El supervisor de colas solo ve entradas en mensajes_posventa_pendientes.json.
Si el webhook falló y el mensaje nunca entró a `procesados`, este escaneo
consulta hilos recientes en MeLi y dispara la alerta normal.
"""

from __future__ import annotations

import os
import time
from datetime import datetime

import requests as _requests_lib

from app.meli_postventa_notif import (
    _cargar_state_posventa,
    procesar_postventa_meli_desde_webhook,
)
from app.utils import (
    meli_postventa_conversacion_cerrada,
    meli_postventa_id_mensaje,
    meli_postventa_remitente_user_id,
    meli_postventa_texto_para_notif,
    obtener_seller_id_meli,
    refrescar_token_meli,
)


def _sort_key_meli_msg(m: dict) -> str:
    msg_date = m.get("message_date")
    if isinstance(msg_date, dict):
        return str(
            msg_date.get("created")
            or msg_date.get("received")
            or msg_date.get("available")
            or msg_date.get("notified")
            or ""
        )
    return str(
        m.get("date")
        or m.get("date_created")
        or m.get("message_date")
        or m.get("timestamp")
        or ""
    )


def _edad_minutos_mensaje(msg: dict) -> int:
    msg_date = msg.get("message_date")
    raw = ""
    if isinstance(msg_date, dict):
        raw = str(
            msg_date.get("created")
            or msg_date.get("received")
            or msg_date.get("available")
            or ""
        )
    if not raw:
        raw = str(msg.get("date") or msg.get("date_created") or "")
    if not raw:
        return 0
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if ts.tzinfo:
            ts = ts.replace(tzinfo=None)
        return int(max(0, (datetime.now() - ts).total_seconds() / 60))
    except Exception:
        return 0


def escanear_hilos_postventa_sin_captura() -> int:
    """
    Revisa órdenes recientes; si el último mensaje del comprador no tiene
    respuesta del vendedor y no está en procesados, fuerza procesamiento del pack.
    Retorna cantidad de packs re-procesados.
    """
    umbral_min = int(os.getenv("POSTVENTA_HUECOS_UMBRAL_MIN", "12"))
    limite = int(os.getenv("POSTVENTA_HUECOS_ORDENES_LIMIT", "60"))

    token = refrescar_token_meli()
    seller_id = obtener_seller_id_meli()
    if not token or not seller_id:
        return 0

    headers = {"Authorization": f"Bearer {token}", "x-version": "2"}
    state = _cargar_state_posventa()
    procesados = set(state.get("procesados", []))
    sid_s = str(seller_id)
    reprocesados = 0

    try:
        r = _requests_lib.get(
            f"https://api.mercadolibre.com/orders/search?seller={seller_id}&sort=date_desc&limit={limite}",
            headers=headers,
            timeout=15,
        )
        if r.status_code != 200:
            print(f"⚠️ [POSTVENTA-HUECOS] orders/search HTTP {r.status_code}")
            return 0

        for orden in r.json().get("results", []) or []:
            pack_id = str(orden.get("pack_id") or orden.get("id") or "").strip()
            if not pack_id:
                continue

            r_m = _requests_lib.get(
                f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale",
                headers=headers,
                timeout=10,
            )
            if r_m.status_code != 200:
                continue

            data_m = r_m.json()
            conv = data_m.get("conversation_status") or {}
            if meli_postventa_conversacion_cerrada(conv)[0]:
                continue

            msgs = sorted(
                [m for m in (data_m.get("messages") or []) if isinstance(m, dict)],
                key=_sort_key_meli_msg,
            )
            if not msgs:
                continue

            last = msgs[-1]
            if meli_postventa_remitente_user_id(last) == sid_s:
                continue

            msg_id = meli_postventa_id_mensaje(last)
            if not msg_id or msg_id in procesados:
                continue

            if not meli_postventa_texto_para_notif(last):
                continue

            mins = _edad_minutos_mensaje(last)
            if mins < umbral_min:
                continue

            print(
                f"🔎 [POSTVENTA-HUECOS] Pack {pack_id}: comprador sin respuesta "
                f"({mins} min), msg_id={msg_id[:16]}… — reprocesando"
            )
            procesar_postventa_meli_desde_webhook(
                f"/messages/packs/{pack_id}",
                reconciliar_existentes=False,
            )
            reprocesados += 1
            time.sleep(0.35)
    except Exception as e:
        print(f"❌ [POSTVENTA-HUECOS] Error escaneo: {e}")

    if reprocesados:
        print(f"✅ [POSTVENTA-HUECOS] {reprocesados} pack(s) re-procesados por hueco detectado.")
    return reprocesados
