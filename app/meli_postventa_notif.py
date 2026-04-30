"""
Postventa MeLi: resolver pack desde resource de webhook y alertar WhatsApp.

Una sola implementación usada por webhook_meli (:8080) y app/routes (:8081 legacy).
La versión anterior en webhook_meli no hacía GET a /messages/{id} ni
https://api.mercadolibre.com/{resource} antes del escaneo de órdenes, y fallaba
con resources tipo marketplace/messages/… .
"""

from __future__ import annotations

import json
import os
import re
import time

import requests as _requests_lib

from app.utils import (
    enviar_whatsapp_reporte,
    jid_grupo_postventa_wa,
    meli_postventa_id_mensaje,
    meli_postventa_nombre_remitente,
    meli_postventa_remitente_user_id,
    meli_postventa_texto_para_notif,
    obtener_seller_id_meli,
    refrescar_token_meli,
)

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_POSVENTA_STATE_PATH = os.path.join(_APP_DIR, "data", "mensajes_posventa_pendientes.json")


def _cargar_state_posventa() -> dict:
    try:
        if os.path.exists(_POSVENTA_STATE_PATH):
            with open(_POSVENTA_STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {"pendientes": {}, "procesados": []}


def _guardar_state_posventa(data: dict) -> None:
    os.makedirs(os.path.dirname(_POSVENTA_STATE_PATH), exist_ok=True)
    with open(_POSVENTA_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _sufijo_pack(pack_id: str) -> str:
    digits = re.sub(r"\D", "", str(pack_id))
    return digits[-4:] if len(digits) >= 4 else digits


def procesar_postventa_meli_desde_webhook(resource: str, *, reconciliar_existentes: bool = False) -> None:
    """
    Recibe resource del webhook (path o id). Si hay mensaje nuevo del comprador, alerta WA.
    """
    GRUPO = jid_grupo_postventa_wa()
    try:
        from app.monitor import incrementar_metrica

        token = refrescar_token_meli()
        if not token:
            print("❌ [POSVENTA] Sin token MeLi (refrescar_token_meli); no se puede notificar.")
            try:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente(
                    "postventa_sin_token_meli", resource=str(resource)[:300]
                )
            except Exception:
                pass
            return

        seller_id = obtener_seller_id_meli()
        headers = {"Authorization": f"Bearer {token}", "x-version": "2"}

        partes = resource.strip("/").split("/")
        pack_id = None
        for i, p in enumerate(partes):
            if p == "packs" and i + 1 < len(partes):
                pack_id = partes[i + 1]
                break

        if not pack_id and partes and partes[0] == "orders" and len(partes) >= 2:
            pack_id = partes[1]

        if not pack_id:
            msg_id_directo = resource.strip("/")
            print(
                f"🔍 [POSVENTA] Resource sin pack_id explícito: '{msg_id_directo}'. Intentando resolver..."
            )

            for url_intento in [
                f"https://api.mercadolibre.com/{msg_id_directo}",
                f"https://api.mercadolibre.com/messages/{msg_id_directo}",
            ]:
                try:
                    res_msg = _requests_lib.get(
                        url_intento, headers=headers, timeout=10
                    )
                    print(f"   -> Intento {url_intento} -> {res_msg.status_code}")
                    if res_msg.status_code == 200:
                        msg_data = res_msg.json()
                        for mr in msg_data.get("message_resources", []):
                            if mr.get("name") in ("orders", "packs"):
                                pack_id = str(mr.get("id", ""))
                                break
                        if not pack_id:
                            pack_id = str(
                                msg_data.get("pack_id", "")
                                or msg_data.get("order_id", "")
                                or ""
                            )
                        if pack_id:
                            print(f"✅ [POSVENTA] pack_id resuelto: {pack_id}")
                            break
                except Exception as e_url:
                    print(f"   -> Error: {e_url}")

            if not pack_id:
                try:
                    print("🔍 [POSVENTA] Buscando en órdenes recientes del vendedor...")
                    res_orders = _requests_lib.get(
                        f"https://api.mercadolibre.com/orders/search?seller={seller_id}&sort=date_desc&limit=10",
                        headers=headers,
                        timeout=10,
                    )
                    if res_orders.status_code == 200:
                        for orden in res_orders.json().get("results", []):
                            oid = str(orden.get("id", ""))
                            res_msgs = _requests_lib.get(
                                f"https://api.mercadolibre.com/messages/packs/{oid}/sellers/{seller_id}?tag=post_sale",
                                headers=headers,
                                timeout=8,
                            )
                            if res_msgs.status_code == 200:
                                msgs = res_msgs.json().get("messages", [])
                                for m in msgs:
                                    if str(m.get("id", "")) == msg_id_directo:
                                        pack_id = oid
                                        print(
                                            f"✅ [POSVENTA] pack_id encontrado por búsqueda: {pack_id}"
                                        )
                                        break
                            if pack_id:
                                break
                except Exception as e_search:
                    print(f"⚠️ [POSVENTA] Error buscando en órdenes: {e_search}")

            if not pack_id:
                print(
                    f"⚠️ [POSVENTA] No se pudo resolver pack_id para resource: {resource}"
                )
                try:
                    from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                    registrar_meli_webhook_incidente(
                        "postventa_pack_irresoluble",
                        resource=str(resource)[:500],
                    )
                except Exception:
                    pass
                return

        res = _requests_lib.get(
            f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale",
            headers=headers,
            timeout=10,
        )
        if res.status_code != 200:
            print(
                f"⚠️ [POSVENTA] Error obteniendo mensajes del pack {pack_id}: {res.status_code}"
            )
            try:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente(
                    "postventa_api_mensajes_fallo",
                    pack_id=str(pack_id),
                    http_status=res.status_code,
                )
            except Exception:
                pass
            return

        state = _cargar_state_posventa()
        procesados = set(state.get("procesados", []))

        data_msg = res.json()
        conv = data_msg.get("conversation_status") or {}
        if conv.get("status") == "blocked" and conv.get("substatus") == "blocked_by_cancelled_order":
            print(
                f"⏭️ [POSVENTA] Pack {pack_id} cancelado/bloqueado; no se alerta postventa."
            )
            return

        mensajes = data_msg.get("messages", [])
        nuevos = 0
        for msg in mensajes:
            if not isinstance(msg, dict):
                continue
            try:
                from_id = meli_postventa_remitente_user_id(msg)
                if from_id and from_id == str(seller_id):
                    continue

                msg_id = meli_postventa_id_mensaje(msg)
                if not msg_id or msg_id in procesados:
                    continue

                texto = meli_postventa_texto_para_notif(msg)
                if not texto:
                    print(
                        f"⏭️ [POSVENTA] Mensaje {msg_id} sin texto ni adjuntos reconocibles, omitiendo"
                    )
                    continue

                nombre_comprador = meli_postventa_nombre_remitente(msg, from_id)
                sufijo = _sufijo_pack(pack_id)

                print(
                    f"📨 [POSVENTA] Nuevo mensaje de {nombre_comprador} en pack {pack_id}: {texto[:60]}"
                )

                # Polling/reconciliación: si el vendedor ya contestó después de este mensaje,
                # solo registrar como procesado; no revivir una alerta vieja.
                if reconciliar_existentes:
                    try:
                        def _k(m: dict) -> str:
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

                        ordenados = sorted(
                            [m for m in mensajes if isinstance(m, dict)],
                            key=_k,
                        )
                        idx = next(
                            (
                                i
                                for i, m in enumerate(ordenados)
                                if meli_postventa_id_mensaje(m) == msg_id
                            ),
                            -1,
                        )
                        if idx >= 0:
                            seller_s = str(seller_id)
                            ya_respondido = any(
                                meli_postventa_remitente_user_id(m2) == seller_s
                                for m2 in ordenados[idx + 1 :]
                            )
                            if ya_respondido:
                                procesados.add(msg_id)
                                print(
                                    f"✅ [POSVENTA] Mensaje {msg_id} ya tenía respuesta posterior del vendedor; no se alerta."
                                )
                                continue
                    except Exception as e_rec:
                        print(f"⚠️ [POSVENTA] No pude reconciliar hilo {pack_id}: {e_rec}")

                productos_str = ""
                try:
                    r_ord = _requests_lib.get(
                        f"https://api.mercadolibre.com/orders/{pack_id}",
                        headers=headers,
                        timeout=8,
                    )
                    if r_ord.status_code == 200:
                        prods = [
                            i.get("item", {}).get("title", "")
                            for i in r_ord.json().get("order_items", [])
                            if i.get("item", {}).get("title")
                        ]
                        if prods:
                            productos_str = "\n".join(f"  • {p}" for p in prods)
                except Exception:
                    pass

                state["pendientes"][sufijo] = {
                    "pack_id": pack_id,
                    "comprador": nombre_comprador,
                    "from_id": from_id,
                    "texto": texto,
                    "msg_id": msg_id,
                    "productos": productos_str,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                }
                procesados.add(msg_id)

                notif = (
                    f"💬 *MENSAJE POSTVENTA MELI*\n\n"
                    f"📦 *Pack:* `{pack_id}`  _(código: *{sufijo}*)_\n"
                    f"👤 *Comprador:* {nombre_comprador}\n"
                )
                if productos_str:
                    notif += f"🛍 *Productos:*\n{productos_str}\n"
                notif += (
                    f"🗣 *Mensaje:* {texto}\n\n"
                    f"Para responder escribe en el grupo:\n"
                    f"*posventa {sufijo}: tu respuesta aquí*"
                )
                ok_wa = enviar_whatsapp_reporte(notif, numero_destino=GRUPO)
                if not ok_wa:
                    print(
                        f"❌ [POSVENTA] WhatsApp NO entregó alerta (bridge :3000 / GRUPO). "
                        f"pack={pack_id} msg_id={msg_id} grupo={GRUPO}"
                    )
                    try:
                        from app.meli_webhook_incidents import (
                            registrar_meli_webhook_incidente,
                        )

                        registrar_meli_webhook_incidente(
                            "postventa_whatsapp_no_entregado",
                            pack_id=str(pack_id),
                            msg_id=str(msg_id),
                        )
                    except Exception:
                        pass
                try:
                    incrementar_metrica("mensajes_posventa")
                except Exception:
                    pass
                nuevos += 1
            except Exception as e_msg:
                print(
                    f"⚠️ [POSVENTA] Error en un mensaje del pack {pack_id} (se sigue con el resto): {e_msg}"
                )
                continue

        state["procesados"] = list(procesados)[-500:]
        _guardar_state_posventa(state)

        if nuevos:
            print(f"✅ [POSVENTA] {nuevos} mensaje(s) nuevos notificados al grupo.")

    except Exception as e:
        print(f"❌ [POSVENTA] Error procesando mensaje: {e}")
