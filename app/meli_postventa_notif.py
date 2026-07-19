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
    meli_postventa_conversacion_cerrada,
    meli_postventa_id_mensaje,
    meli_postventa_nombre_remitente,
    meli_postventa_remitente_user_id,
    meli_postventa_texto_para_notif,
    obtener_seller_id_meli,
    refrescar_token_meli,
)

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_POSVENTA_STATE_PATH = os.path.join(_APP_DIR, "data", "mensajes_posventa_pendientes.json")

_ESTADOS_ENVIO_ES = {
    "pending": "Pendiente",
    "handling": "En preparación",
    "ready_to_ship": "Listo para enviar",
    "shipped": "En camino",
    "delivered": "Entregado",
    "not_delivered": "No entregado",
    "cancelled": "Cancelado",
}


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


def sufijo_pack_postventa(pack_id: str) -> str:
    """Últimos 3 dígitos del pack/orden — código corto para posventa {sufijo}: …"""
    digits = re.sub(r"\D", "", str(pack_id))
    return digits[-3:] if len(digits) >= 3 else digits


def _detalle_venta_orden(pack_id: str, headers: dict) -> tuple[str, str, str, str, list]:
    """
    Productos, total, fecha de compra y estado de envío de una orden MeLi.
    Un solo pack_id por llamada a procesar_postventa_meli_desde_webhook: se calcula
    una vez y se reutiliza para todos los mensajes nuevos del mismo pack (evita
    repetir GET /orders y /shipments por cada mensaje del lote).
    """
    productos_str = total_str = fecha_str = envio_str = ""
    productos_detalle: list = []
    try:
        r_ord = _requests_lib.get(
            f"https://api.mercadolibre.com/orders/{pack_id}",
            headers=headers,
            timeout=8,
        )
        if r_ord.status_code == 200:
            orden_json = r_ord.json()

            lineas = []
            for i in orden_json.get("order_items", []) or []:
                titulo = i.get("item", {}).get("title", "")
                if not titulo:
                    continue
                cantidad = i.get("quantity") or 1
                precio_unit = i.get("unit_price")
                linea = f"  • {titulo} x{cantidad}"
                if precio_unit is not None:
                    linea += f" — ${precio_unit:,.0f} c/u"
                lineas.append(linea)
                productos_detalle.append({
                    "nombre": titulo,
                    "cantidad": cantidad,
                    "precio_unitario": precio_unit,
                })
            if lineas:
                productos_str = "\n".join(lineas)

            total_amount = orden_json.get("total_amount")
            if total_amount is not None:
                estado_orden = orden_json.get("status", "")
                total_str = f"${total_amount:,.0f} COP"
                if estado_orden:
                    total_str += f" ({'pagado' if estado_orden == 'paid' else estado_orden})"

            fecha_compra = orden_json.get("date_created")
            if fecha_compra:
                try:
                    from datetime import datetime as _dt

                    fecha_str = _dt.fromisoformat(fecha_compra).strftime(
                        "%d/%m/%Y %I:%M %p"
                    )
                except Exception:
                    fecha_str = str(fecha_compra)[:10]

            shipping_id = (orden_json.get("shipping") or {}).get("id")
            if shipping_id:
                try:
                    r_ship = _requests_lib.get(
                        f"https://api.mercadolibre.com/shipments/{shipping_id}",
                        headers=headers,
                        timeout=8,
                    )
                    if r_ship.status_code == 200:
                        estado_envio = r_ship.json().get("status", "")
                        envio_str = _ESTADOS_ENVIO_ES.get(estado_envio, estado_envio)
                except Exception:
                    pass
    except Exception:
        pass
    return productos_str, total_str, fecha_str, envio_str, productos_detalle


def _sufijo_pack(pack_id: str) -> str:
    return sufijo_pack_postventa(pack_id)


def _sugerencia_ia_postventa(
    productos_detalle: list, pregunta: str, mensajes: list, seller_id
) -> str:
    """
    Borrador de respuesta con la información de la empresa que ya existe
    (ficha técnica en Sheets, otras presentaciones publicadas en MeLi, hilo de
    la conversación). El operador decide: "hugo dale ok <código>" la envía tal
    cual, o "resp <código>: ..." la reemplaza. '' si no hay base suficiente
    para sugerir sin inventar.
    """
    pregunta = (pregunta or "").strip()
    if not pregunta or pregunta.lstrip().startswith("[Solo adjunto"):
        return ""
    titulo = ""
    for p in productos_detalle or []:
        if isinstance(p, dict) and (p.get("nombre") or "").strip():
            titulo = p["nombre"].strip()
            break
    if not titulo:
        return ""
    try:
        from app.services.google_services import buscar_ficha_tecnica_producto
        from app.services.meli_preventa import (
            generar_respuesta_con_ficha,
            otras_presentaciones_meli,
        )

        ficha = ""
        try:
            ficha = buscar_ficha_tecnica_producto(titulo) or ""
        except Exception:
            ficha = ""
        otras = ""
        try:
            otras = otras_presentaciones_meli(titulo)
        except Exception:
            otras = ""
        if not ficha and not otras:
            return ""

        turnos = []
        seller_s = str(seller_id)
        for m in sorted(
            [x for x in mensajes if isinstance(x, dict)],
            key=fecha_key_mensaje_postventa,
        )[-6:]:
            txt = meli_postventa_texto_para_notif(m)
            if not txt:
                continue
            quien = (
                "Vendedor"
                if meli_postventa_remitente_user_id(m) == seller_s
                else "Comprador"
            )
            turnos.append(f"{quien}: {txt[:280]}")
        contexto_hilo = (
            "CONVERSACIÓN RECIENTE DE ESTA COMPRA (postventa — responda "
            "siguiendo el hilo):\n" + "\n".join(turnos)
            if turnos
            else ""
        )

        sugerencia = generar_respuesta_con_ficha(
            titulo,
            pregunta,
            ficha
            or "(Sin ficha técnica registrada: responda SOLO con el contexto del "
            "hilo y las otras presentaciones listadas; si el dato no está, "
            "diga que un asesor lo confirma.)",
            otras_presentaciones=otras,
            contexto_hilo=contexto_hilo,
        )
        return (sugerencia or "").strip()
    except Exception as e:
        print(f"⚠️ [POSVENTA] Sugerencia IA no disponible: {e}")
        return ""


def fecha_key_mensaje_postventa(m: dict) -> str:
    """Clave de fecha ordenable de un mensaje postventa (para sort cronológico)."""
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


def _formatear_fecha_mensaje(fecha_iso: str) -> str:
    if not fecha_iso:
        return ""
    try:
        from datetime import datetime as _dt

        return _dt.fromisoformat(fecha_iso.replace("Z", "+00:00")).strftime("%d/%m %I:%M %p")
    except Exception:
        return fecha_iso[:16]


def obtener_historial_postventa(pack_id: str, *, limite: int = 3) -> list[dict]:
    """
    Últimos N mensajes de la conversación postventa de un pack (comprador y vendedor),
    ordenados del más antiguo al más reciente. Para mostrar contexto en el panel.
    """
    token = refrescar_token_meli()
    if not token:
        return []
    seller_id = str(obtener_seller_id_meli() or "")
    headers = {"Authorization": f"Bearer {token}", "x-version": "2"}
    try:
        res = _requests_lib.get(
            f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale",
            headers=headers,
            timeout=10,
        )
        if res.status_code != 200:
            return []
        mensajes = [m for m in res.json().get("messages", []) or [] if isinstance(m, dict)]
        mensajes.sort(key=fecha_key_mensaje_postventa)
        ultimos = mensajes[-limite:] if limite else mensajes
        historial = []
        for m in ultimos:
            from_id = meli_postventa_remitente_user_id(m)
            de = "vendedor" if from_id and from_id == seller_id else "comprador"
            nombre = "Nosotros" if de == "vendedor" else meli_postventa_nombre_remitente(m, from_id)
            texto = meli_postventa_texto_para_notif(m)
            if not texto:
                continue
            historial.append({
                "de": de,
                "nombre": nombre,
                "texto": texto,
                "fecha": _formatear_fecha_mensaje(fecha_key_mensaje_postventa(m)),
            })
        return historial
    except Exception as e:
        print(f"⚠️ [POSVENTA] Error obteniendo historial pack {pack_id}: {e}")
        return []


def _pack_id_desde_payload_mensaje(msg_data: dict) -> str:
    """Extrae pack/order id desde las formas que devuelve MeLi para /messages/{id}?tag=post_sale."""
    candidatos = [msg_data]
    mensajes = msg_data.get("messages")
    if isinstance(mensajes, list):
        candidatos.extend(m for m in mensajes if isinstance(m, dict))

    for payload in candidatos:
        for mr in payload.get("message_resources", []) or []:
            if mr.get("name") in ("orders", "packs"):
                pack_id = str(mr.get("id", "")).strip()
                if pack_id:
                    return pack_id
        pack_id = str(payload.get("pack_id") or payload.get("order_id") or "").strip()
        if pack_id:
            return pack_id
    return ""


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
                f"https://api.mercadolibre.com/messages/{msg_id_directo}?tag=post_sale",
            ]:
                try:
                    res_msg = _requests_lib.get(
                        url_intento, headers=headers, timeout=10
                    )
                    print(f"   -> Intento {url_intento} -> {res_msg.status_code}")
                    if res_msg.status_code == 200:
                        msg_data = res_msg.json()
                        pack_id = _pack_id_desde_payload_mensaje(msg_data)
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
        cerrada, motivo_cierre = meli_postventa_conversacion_cerrada(conv)
        if cerrada:
            print(
                f"⏭️ [POSVENTA] Pack {pack_id} conversación cerrada ({motivo_cierre}); "
                f"no se alerta postventa."
            )
            sufijo = _sufijo_pack(pack_id)
            state["pendientes"].pop(str(pack_id), None)
            if sufijo:
                state["pendientes"].pop(sufijo, None)
            for msg in data_msg.get("messages", []) or []:
                mid = meli_postventa_id_mensaje(msg)
                if mid:
                    procesados.add(mid)
            state["procesados"] = list(procesados)[-500:]
            _guardar_state_posventa(state)
            return

        mensajes = data_msg.get("messages", [])
        nuevos = 0
        detalle_venta = None  # (productos_str, total_str, fecha_str, envio_str); lazy, 1 vez por pack
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

                # Si el vendedor ya contestó DESPUÉS de este mensaje (respuesta
                # directa en MeLi, o hilo viejo que resucita porque el state se
                # recortó), no revivir la alerta ni auto-responder: mensajes de
                # hace meses ya atendidos volvían al grupo como "nuevos".
                try:
                    ordenados = sorted(
                        [m for m in mensajes if isinstance(m, dict)],
                        key=fecha_key_mensaje_postventa,
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

                # Respuesta automática (o borrador con aprobación) FT/COA (Drive)
                # antes de molestar al grupo con la cola manual.
                try:
                    from app.postventa_documentos import (
                        intentar_respuesta_automatica_documentos,
                    )

                    # Contexto: mensajes recientes del mismo comprador en el hilo,
                    # por si el producto se mencionó antes del mensaje actual
                    # (p. ej. "¿tienen carbonato de magnesio?" ... "me pasa la ficha técnica").
                    texto_hilo_previo = " ".join(
                        meli_postventa_texto_para_notif(m)
                        for m in mensajes
                        if isinstance(m, dict)
                        and meli_postventa_remitente_user_id(m) == from_id
                        and meli_postventa_id_mensaje(m) != msg_id
                    )[-1500:]

                    resultado_docs = intentar_respuesta_automatica_documentos(
                        pack_id,
                        texto,
                        comprador_id=from_id,
                        texto_contexto_hilo=texto_hilo_previo,
                    )

                    if resultado_docs in ("auto_enviado", "borrador_pendiente"):
                        procesados.add(msg_id)
                        # Mantener el pack direccionable: si se saca de la cola,
                        # el código corto deja de resolver (el fallback por
                        # sufijo solo cubre órdenes recientes) y el grupo no
                        # puede complementar la auto-respuesta con
                        # "posventa <código>: ...".
                        entrada_auto = {
                            "pack_id": pack_id,
                            "codigo": sufijo,
                            "comprador": nombre_comprador,
                            "from_id": from_id,
                            "texto": texto,
                            "msg_id": msg_id,
                            "auto_respondida": resultado_docs,
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        }
                        state["pendientes"][str(pack_id)] = entrada_auto
                        if sufijo and sufijo != str(pack_id):
                            state["pendientes"][sufijo] = entrada_auto
                        if resultado_docs == "auto_enviado":
                            notif_auto = (
                                f"🤖 *Auto-respuesta postventa (FT/COA)*\n\n"
                                f"🔢 Código: *{sufijo}*\n"
                                f"👤 {nombre_comprador}\n"
                                f"🗣 Solicitud: {texto[:180]}{'…' if len(texto) > 180 else ''}\n\n"
                                f"_Enlaces enviados al comprador en MeLi._\n\n"
                                f"✍️ Para complementar o corregir la respuesta:\n"
                                f"*posventa {sufijo}: tu mensaje*  (o *resp {sufijo}: ...*)"
                            )
                            enviar_whatsapp_reporte(notif_auto, numero_destino=GRUPO)
                        # Si es "borrador_pendiente", la notificación de aprobación
                        # ("hugo dale ok <código>") ya se envió al grupo dentro de
                        # intentar_respuesta_automatica_documentos().
                        try:
                            incrementar_metrica("mensajes_posventa")
                        except Exception:
                            pass
                        nuevos += 1
                        continue
                except Exception as e_auto:
                    print(f"⚠️ [POSVENTA] Auto-docs falló pack {pack_id}: {e_auto}")

                if detalle_venta is None:
                    detalle_venta = _detalle_venta_orden(pack_id, headers)
                productos_str, total_str, fecha_str, envio_str, productos_detalle = detalle_venta

                # Autocompletado: borrador con datos de la empresa (ficha,
                # presentaciones, hilo). El operador aprueba o escribe el suyo.
                sugerencia_ia = _sugerencia_ia_postventa(
                    productos_detalle, texto, mensajes, seller_id
                )

                clave_pendiente = str(pack_id)
                state["pendientes"][clave_pendiente] = {
                    "pack_id": pack_id,
                    "codigo": sufijo,
                    "comprador": nombre_comprador,
                    "from_id": from_id,
                    "texto": texto,
                    "msg_id": msg_id,
                    "productos": productos_str,
                    "productos_detalle": productos_detalle,
                    "total": total_str,
                    "fecha_compra": fecha_str,
                    "envio": envio_str,
                    "sugerencia_ia": sugerencia_ia,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                }
                # Compatibilidad: comando posventa 0583: sigue resolviendo por sufijo.
                if sufijo and sufijo != clave_pendiente:
                    state["pendientes"][sufijo] = state["pendientes"][clave_pendiente]

                notif = (
                    f"💬 *MENSAJE POSTVENTA MELI*\n\n"
                    f"🔢 *Código:* *{sufijo}*\n"
                    f"👤 *Comprador:* {nombre_comprador}\n"
                )
                if productos_str:
                    notif += f"🛍 *Productos:*\n{productos_str}\n"
                if total_str:
                    notif += f"💰 *Total:* {total_str}\n"
                if fecha_str:
                    notif += f"📅 *Fecha compra:* {fecha_str}\n"
                if envio_str:
                    notif += f"🚚 *Envío:* {envio_str}\n"
                notif += f"🗣 *Mensaje:* {texto}\n\n"
                if sugerencia_ia:
                    recorte = sugerencia_ia[:600] + ("…" if len(sugerencia_ia) > 600 else "")
                    notif += (
                        f"🤖 *Sugerencia de respuesta:*\n_{recorte}_\n\n"
                        f"✅ Enviarla tal cual: *hugo dale ok {sufijo}*\n"
                        f"✍️ O tu propia respuesta: *resp {sufijo}: tu mensaje*"
                    )
                else:
                    notif += (
                        f"Para responder escribe en el grupo:\n"
                        f"*posventa {sufijo}: tu respuesta aquí*  (o *resp {sufijo}: ...*)"
                    )
                ok_wa = enviar_whatsapp_reporte(notif, numero_destino=GRUPO)
                if not ok_wa:
                    print(
                        f"❌ [POSVENTA] WhatsApp NO entregó alerta (bridge :3000 / GRUPO). "
                        f"pack={pack_id} msg_id={msg_id} grupo={GRUPO} — NO se marca procesado (reintento)"
                    )
                    state["pendientes"].pop(clave_pendiente, None)
                    if sufijo:
                        state["pendientes"].pop(sufijo, None)
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
                    continue

                procesados.add(msg_id)
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
