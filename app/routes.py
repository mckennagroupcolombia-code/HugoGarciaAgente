from flask import request, jsonify, render_template, send_from_directory, make_response
import os
import json
import re
import hmac
import hashlib
import base64
import tempfile
from datetime import datetime as _dt
import requests as _requests_lib

_ROUTES_DIR = os.path.dirname(os.path.abspath(__file__))
PENDIENTES_PATH = os.path.join(_ROUTES_DIR, "data", "preguntas_pendientes_preventa.json")


def _normalizar_comando_grupo(texto: str) -> str:
    """Normaliza comandos que WhatsApp puede entregar con markdown o espacios raros."""
    t = (texto or "").replace("\u00a0", " ").strip()
    t = re.sub(r"[*_~`]+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def encontrar_question_id_por_sufijo(sufijo: str):
    """Busca en pendientes el question_id único que termina con `sufijo`."""
    try:
        with open(PENDIENTES_PATH) as f:
            data = json.load(f)
        matches = []
        for p in data.get("preguntas", []):
            if not p.get("respondida"):
                if str(p["question_id"]).endswith(sufijo):
                    matches.append(str(p["question_id"]))
        if len(matches) == 1:
            return matches[0]
    except Exception:
        pass
    return None


def diagnosticar_sufijo_preventa(sufijo: str):
    """
    Diagnostica sufijo en pendientes no respondidas.
    Retorna {"matches": [...], "count": n}.
    """
    try:
        with open(PENDIENTES_PATH) as f:
            data = json.load(f)
        matches = [
            str(p.get("question_id"))
            for p in data.get("preguntas", [])
            if not p.get("respondida") and str(p.get("question_id", "")).endswith(sufijo)
        ]
        return {"matches": matches, "count": len(matches)}
    except Exception:
        return {"matches": [], "count": 0}


def detectar_comando_preventa(texto: str):
    """
    Detecta comandos de respuesta preventa en dos formatos:
      - Completo:  resp preventa 13553975455: mensaje
      - Abreviado: resp 455: mensaje  (últimos 3+ dígitos del question_id)
    Acepta con o sin llaves, mayúsculas/minúsculas.
    Retorna (question_id_completo, respuesta) o (None, None).
    """
    texto = _normalizar_comando_grupo(texto)

    # Formato completo: resp preventa <digits>: <respuesta>
    patrones_completo = [
        r"resp\s+preventa\s+(\d+):\s*\{(.+?)\}\s*$",
        r"resp\s+preventa\s+(\d+):\s*(.+)",
    ]
    for patron in patrones_completo:
        m = re.search(patron, texto.strip(), re.IGNORECASE | re.DOTALL)
        if m:
            qid = m.group(1).strip()
            resp = m.group(2).strip().strip("{}").strip()
            if len(qid) < 8:
                qid_completo = encontrar_question_id_por_sufijo(qid)
                if qid_completo:
                    qid = qid_completo
            return qid, resp

    # Formato abreviado: resp <3+dígitos>: <respuesta>
    patrones_corto = [
        r"^resp\s+(\d{2,}?):\s*\{(.+?)\}\s*$",
        r"^resp\s+(\d{2,}?):\s*(.+)",
    ]
    for patron in patrones_corto:
        m = re.search(patron, texto.strip(), re.IGNORECASE | re.DOTALL)
        if m:
            sufijo = m.group(1).strip()
            resp = m.group(2).strip().strip("{}").strip()
            qid_completo = encontrar_question_id_por_sufijo(sufijo)
            # Modificación: si no lo encontramos como preventa, tal vez no estaba en pendientes
            # pero no queremos que falle silenciosamente si el usuario usó el comando de preventa.
            if qid_completo:
                return qid_completo, resp
            else:
                # Si el usuario explicitamente usó "resp preventa 155:"
                if "preventa" in texto.lower():
                    # Tratar de encontrarlo aunque esté respondida, para no confundir
                    pass
            # Si no se encuentra en pendientes, no procesar
            return None, None

    return None, None


_POSVENTA_STATE_PATH = os.path.join(
    _ROUTES_DIR, "data", "mensajes_posventa_pendientes.json"
)


def _resolver_pack_por_sufijo_en_meli(codigo: str) -> dict | None:
    """
    Último recurso si la cola JSON quedó vacía: busca pack reciente por sufijo (ej. 2174).
    """
    digits = re.sub(r"\D", "", (codigo or "").strip())
    if len(digits) < 3:
        return None
    try:
        from app.utils import refrescar_token_meli, obtener_seller_id_meli

        token = refrescar_token_meli()
        seller_id = obtener_seller_id_meli()
        if not token or not seller_id:
            return None
        limite = min(51, int(os.getenv("POSTVENTA_SUFIJO_ORDENES_LIMIT", "51")))
        r = _requests_lib.get(
            f"https://api.mercadolibre.com/orders/search?seller={seller_id}&sort=date_desc&limit={limite}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )
        if r.status_code != 200:
            return None
        codigo_stripped = (codigo or "").strip()
        for orden in r.json().get("results", []) or []:
            pack_id = str(orden.get("pack_id") or orden.get("id") or "").strip()
            if not pack_id:
                continue
            pack_digits = re.sub(r"\D", "", pack_id)
            sufijo = pack_digits[-4:] if len(pack_digits) >= 4 else pack_digits
            if (
                pack_id == codigo_stripped
                or pack_id.endswith(digits)
                or sufijo == digits
            ):
                buyer = orden.get("buyer") or {}
                comprador = str(buyer.get("nickname") or buyer.get("first_name") or "")
                return {
                    "pack_id": pack_id,
                    "codigo": sufijo,
                    "comprador": comprador,
                    "from_id": str(buyer.get("id") or "") or None,
                }
    except Exception as _e:
        print(f"⚠️ [POSVENTA] Error buscando pack por sufijo {codigo}: {_e}")
    return None


def _resolver_entrada_postventa(codigo: str):
    """
    Busca entrada pendiente por código corto, pack_id o clave en JSON.
    Retorna (entrada dict|None, clave_pendiente str|None).
    """
    codigo = (codigo or "").strip()
    if not codigo:
        return None, None
    try:
        with open(_POSVENTA_STATE_PATH, "r", encoding="utf-8") as _f:
            _state = json.load(_f)
        pendientes = _state.get("pendientes", {})
        entrada = None
        clave_pendiente = None
        for candidato in (codigo, codigo.upper(), codigo.lower()):
            entrada = pendientes.get(candidato)
            if entrada:
                clave_pendiente = candidato
                break
        if not entrada:
            sufijo_busqueda = codigo.upper()
            for k, v in pendientes.items():
                if not isinstance(v, dict):
                    continue
                cod = str(v.get("codigo", "")).upper()
                pid = str(v.get("pack_id", ""))
                if (
                    k.endswith(sufijo_busqueda)
                    or sufijo_busqueda.endswith(k)
                    or cod == sufijo_busqueda
                    or pid.endswith(codigo)
                    or pid == codigo
                ):
                    entrada = v
                    clave_pendiente = k
                    break
        if not entrada:
            entrada = _resolver_pack_por_sufijo_en_meli(codigo)
            if entrada:
                clave_pendiente = str(entrada.get("pack_id") or codigo)
        return entrada, clave_pendiente
    except Exception as _e:
        print(f"⚠️ [POSVENTA] Error leyendo state: {_e}")
        return None, None


def _quitar_pendiente_postventa(pack_id: str, clave_pendiente: str | None = None) -> None:
    try:
        with open(_POSVENTA_STATE_PATH, "r", encoding="utf-8") as _f:
            _state = json.load(_f)
        pd = _state.get("pendientes", {})
        if clave_pendiente and clave_pendiente in pd:
            ref = pd.pop(clave_pendiente, None)
            if isinstance(ref, dict):
                cod = str(ref.get("codigo") or "")
                if cod and cod in pd and pd.get(cod) is ref:
                    pd.pop(cod, None)
        for k, v in list(pd.items()):
            if isinstance(v, dict) and str(v.get("pack_id")) == str(pack_id):
                pd.pop(k, None)
        with open(_POSVENTA_STATE_PATH, "w", encoding="utf-8") as _f:
            json.dump(_state, _f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def _listar_postventa_pendientes_api() -> list[dict]:
    """Lista pendientes deduplicados por pack_id (el JSON guarda clave pack + sufijo)."""
    try:
        with open(_POSVENTA_STATE_PATH, "r", encoding="utf-8") as _f:
            pendientes = json.load(_f).get("pendientes", {})
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"⚠️ [POSVENTA-API] Error leyendo pendientes: {e}")
        return []

    vistos: set[str] = set()
    items: list[dict] = []
    for v in pendientes.values():
        if not isinstance(v, dict):
            continue
        pack_id = str(v.get("pack_id") or "").strip()
        if not pack_id or pack_id in vistos:
            continue
        vistos.add(pack_id)
        codigo = str(v.get("codigo") or "").strip()
        if not codigo:
            digits = re.sub(r"\D", "", pack_id)
            codigo = digits[-4:] if len(digits) >= 4 else pack_id
        productos = v.get("productos") or ""
        if isinstance(productos, str):
            productos_lista = [
                ln.strip().lstrip("•").strip()
                for ln in productos.splitlines()
                if ln.strip()
            ]
        else:
            productos_lista = list(productos) if productos else []
        items.append(
            {
                "codigo": codigo,
                "pack_id": pack_id,
                "comprador": v.get("comprador") or "",
                "texto": v.get("texto") or "",
                "productos": productos_lista,
                "timestamp": v.get("timestamp") or "",
                "msg_id": v.get("msg_id") or "",
            }
        )
    items.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return items


def _ejecutar_respuesta_postventa(
    codigo: str,
    respuesta: str,
    *,
    notificar_grupo: bool = True,
) -> dict:
    """
    Envía respuesta postventa a MeLi. Usado por WhatsApp (posventa …) y panel /api.
    Retorna {ok, error?, pack_id?, comprador?, cerrada_en_meli?}.
    """
    from app.utils import (
        refrescar_token_meli,
        obtener_seller_id_meli,
        meli_postventa_conversacion_cerrada,
    )

    grupo_posventa = jid_grupo_postventa_wa()
    codigo = (codigo or "").strip()
    respuesta = (respuesta or "").strip()
    if not codigo or not respuesta:
        err = "Faltan código o respuesta"
        if notificar_grupo:
            enviar_whatsapp_reporte(
                "⚠️ Formato: *posventa <código>: tu respuesta*",
                numero_destino=grupo_posventa,
            )
        return {"ok": False, "error": err}

    entrada, clave_pendiente = _resolver_entrada_postventa(codigo)
    pack_id = None
    comprador = ""
    comprador_id = None
    if entrada:
        pack_id = entrada.get("pack_id")
        comprador = entrada.get("comprador", "")
        comprador_id = entrada.get("from_id")

    if not pack_id:
        if codigo.isdigit() and len(codigo) > 8:
            pack_id = codigo
        else:
            err = f"No hay mensaje postventa pendiente con código {codigo}"
            if notificar_grupo:
                enviar_whatsapp_reporte(
                    f"⚠️ No encontré mensaje postventa pendiente con código *{codigo}*.\n"
                    f"Verifica el código en la alerta original o responde directo en MeLi.",
                    numero_destino=grupo_posventa,
                )
            return {"ok": False, "error": err}

    exito = responder_mensaje_posventa(pack_id, respuesta, comprador_id)
    if exito:
        _quitar_pendiente_postventa(str(pack_id), clave_pendiente)
        if notificar_grupo:
            enviar_whatsapp_reporte(
                f"✅ *Respuesta postventa enviada*\n"
                f"👤 Comprador: {comprador or pack_id}\n"
                f"📦 Pack: {pack_id}\n"
                f"💬 Respuesta: {respuesta[:120]}{'…' if len(respuesta) > 120 else ''}",
                numero_destino=grupo_posventa,
            )
        return {"ok": True, "pack_id": str(pack_id), "comprador": comprador}

    try:
        tok = refrescar_token_meli()
        sid = obtener_seller_id_meli()
        r_m = _requests_lib.get(
            f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{sid}?tag=post_sale",
            headers={"Authorization": f"Bearer {tok}", "x-version": "2"},
            timeout=10,
        )
        if r_m.status_code == 200:
            conv = r_m.json().get("conversation_status") or {}
            cerrada, motivo = meli_postventa_conversacion_cerrada(conv)
            if cerrada:
                _quitar_pendiente_postventa(str(pack_id), clave_pendiente)
                if notificar_grupo:
                    enviar_whatsapp_reporte(
                        f"✅ *Postventa cerrada en MeLi*\n"
                        f"📦 Pack: {pack_id}\n"
                        f"🧹 Conversación no admite más mensajes ({motivo}). "
                        f"Si hay reclamo, gestiónalo en el panel de MeLi.",
                        numero_destino=grupo_posventa,
                    )
                return {
                    "ok": True,
                    "pack_id": str(pack_id),
                    "comprador": comprador,
                    "cerrada_en_meli": True,
                    "motivo": motivo,
                }
    except Exception as e_cancel:
        print(f"⚠️ [POSVENTA] No pude verificar cancelación {pack_id}: {e_cancel}")

    err = "Error enviando respuesta a MeLi"
    if notificar_grupo:
        enviar_whatsapp_reporte(
            f"❌ *Error enviando respuesta postventa* al pack {pack_id}.\n"
            f"Intenta responder directamente en MeLi.",
            numero_destino=grupo_posventa,
        )
    return {"ok": False, "error": err, "pack_id": str(pack_id)}


def _procesar_comando_posventa_wa(texto_cmd: str) -> None:
    """
    Envía respuesta postventa a MeLi por comando WhatsApp:
    posventa <código>: <texto>
    """
    texto_cmd = _normalizar_comando_grupo(texto_cmd)
    m = re.match(
        r"^posventa\s+(\S+):\s*(.+)",
        texto_cmd.strip(),
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        enviar_whatsapp_reporte(
            "⚠️ Formato: *posventa <código>: tu respuesta*\n"
            "Ejemplo: posventa 3240: Hola, su pedido ya fue despachado.",
            numero_destino=jid_grupo_postventa_wa(),
        )
        return
    _ejecutar_respuesta_postventa(
        m.group(1).strip(),
        m.group(2).strip(),
        notificar_grupo=True,
    )


# --- Dependencias de Lógica de Negocio ---
# Estas son las funciones que nuestra ruta necesita para operar.
# TODO: Eventualmente, estas dependencias se deben limpiar y organizar.
from app.core import obtener_respuesta_ia
from modulo_posventa import responder_mensaje_posventa
from app.services.gemini_vision import analizar_imagen_pago, AnalisisImagenPago
from app.utils import (
    enviar_whatsapp_reporte,
    jid_grupo_inventario_wa,
    jid_grupo_preventa_wa,
    jid_grupo_postventa_wa,
)


def _jid_limpio(s: str) -> str:
    if not s:
        return ""
    return s.split("#")[0].strip()


def _grupos_web_pedido_cmd() -> set[str]:
    """Solo el grupo de pedidos web (Guias_Envios pagina web). Ver app/data/grupos_whatsapp_oficiales.json.

    Opcional: GRUPOS_WEB_PEDIDO_CMD_WA=coma,separada (solo si en el futuro se requiere más de un JID).
    """
    raw = os.getenv("GRUPOS_WEB_PEDIDO_CMD_WA", "").strip()
    if raw:
        return {j for p in raw.split(",") if (j := _jid_limpio(p))}
    solo = _jid_limpio(
        os.getenv("GRUPO_PEDIDOS_WEB_WA", "120363391665421264@g.us")
    )
    return {solo} if solo else set()


def _remote_es_grupo_web_pedido(remote_jid: str) -> bool:
    return _jid_limpio(remote_jid) in _grupos_web_pedido_cmd()


def _normalizar_texto_comando_wa(texto: str) -> str:
    """Quita negritas/cursivas típicas de WhatsApp y colapsa espacios."""
    t = (texto or "").strip()
    t = re.sub(r"[*_~`]+", "", t)
    t = " ".join(t.split())
    return t.strip()


def _token_tras_facturar(texto: str) -> str | None:
    t = _normalizar_texto_comando_wa(texto)
    m = re.search(r"\bfacturar\s+(\S+)", t, re.IGNORECASE)
    return m.group(1).strip() if m else None


from app.sync import (
    sincronizar_stock_todas_las_plataformas,
    sincronizar_facturas_recientes,
)


def _procesar_respuesta_preventa(question_id: str, respuesta_humana: str):
    """
    Procesa "resp preventa {question_id}: {respuesta}":
    1. Busca la pregunta pendiente
    2. Responde en MeLi
    3. Guarda el caso como few-shot
    4. Confirma al grupo
    """
    try:
        from app.services.meli_preventa import (
            obtener_pregunta_pendiente,
            guardar_caso_preventa,
            marcar_pregunta_respondida,
        )
        from app.utils import refrescar_token_meli

        pendiente = obtener_pregunta_pendiente(question_id)
        if not pendiente:
            enviar_whatsapp_reporte(
                f"⚠️ No encontré pregunta pendiente con ID {question_id}",
                numero_destino=jid_grupo_preventa_wa(),
            )
            return

        # Responder en MeLi. Si alguien ya contestó desde la UI de MeLi,
        # cerramos el pendiente local para cortar recordatorios en bucle.
        token = refrescar_token_meli()
        if token:
            import requests as req

            try:
                r_check = req.get(
                    f"https://api.mercadolibre.com/questions/{question_id}?api_version=4",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if r_check.status_code == 200:
                    q_status = str(r_check.json().get("status", "")).upper()
                    if q_status and q_status != "UNANSWERED":
                        marcar_pregunta_respondida(question_id)
                        enviar_whatsapp_reporte(
                            f"✅ *Preventa ya estaba respondida en MeLi*\n"
                            f"📦 Producto: {pendiente.get('titulo_producto', '')}\n"
                            f"🧾 Estado MeLi: {q_status}\n"
                            f"🧹 Cerré el pendiente local para detener recordatorios.",
                            numero_destino=jid_grupo_preventa_wa(),
                        )
                        print(
                            f"✅ Preventa: question_id {question_id} ya estaba {q_status}; cerrado localmente."
                        )
                        return
            except Exception as e_check:
                print(f"⚠️ Preventa: no pude verificar estado antes de responder {question_id}: {e_check}")

            res = req.post(
                "https://api.mercadolibre.com/answers",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"question_id": int(question_id), "text": respuesta_humana},
                timeout=15,
            )
            exito = res.status_code in (200, 201)
            if not exito:
                print(f"❌ Preventa: MeLi API falló con {res.status_code} - {res.text}")
                if res.status_code == 400 and "not_unanswered" in (res.text or "").lower():
                    marcar_pregunta_respondida(question_id)
                    enviar_whatsapp_reporte(
                        f"✅ *Preventa ya estaba respondida en MeLi*\n"
                        f"📦 Producto: {pendiente.get('titulo_producto', '')}\n"
                        f"🧹 MeLi rechazó duplicado (`not_unanswered`); cerré el pendiente local.",
                        numero_destino=jid_grupo_preventa_wa(),
                    )
                    return
        else:
            exito = False

        if exito:
            # Cerrar pendiente solo tras envío confirmado a MeLi.
            marcar_pregunta_respondida(question_id)
            # Guardar como caso de entrenamiento
            guardar_caso_preventa(
                producto=pendiente.get("titulo_producto", ""),
                pregunta=pendiente.get("pregunta", ""),
                respuesta=respuesta_humana,
            )

        # Confirmar al grupo preventa
        grupo_prev = jid_grupo_preventa_wa()
        emoji = "✅" if exito else "❌"
        enviar_whatsapp_reporte(
            f"{emoji} *Respuesta preventa {'enviada' if exito else 'FALLÓ'} al cliente*\n"
            f"📦 Producto: {pendiente.get('titulo_producto', '')}\n"
            f"💬 Respuesta: {respuesta_humana[:120]}{'...' if len(respuesta_humana) > 120 else ''}\n"
            f"{'📚 Guardada como caso de entrenamiento.' if exito else '🧾 La pregunta sigue pendiente para reintento.'}",
            numero_destino=grupo_prev,
        )
        print(f"✅ Preventa: respuesta humana procesada para question_id {question_id}")

    except Exception as e:
        print(f"❌ Preventa: error procesando respuesta humana: {e}")


def cargar_modos_atencion():
    try:
        with open("app/data/modos_atencion.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {}
    data.setdefault("numeros_en_humano", [])
    data.setdefault("numeros_silenciados", [])
    data.setdefault("timestamps", {})
    data.setdefault("bot_auto_pausados", {})
    try:
        from app.services.wa_jid import limpiar_jids_falsos_en_modos

        if limpiar_jids_falsos_en_modos(data):
            with open("app/data/modos_atencion.json", "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
    except Exception:
        pass
    return data


def _wa_en_modo_humano(modos: dict, jid: str) -> bool:
    from app.services.wa_jid import en_lista_modo

    return en_lista_modo(jid, modos.get("numeros_en_humano", []))


def _wa_en_silenciado(modos: dict, jid: str) -> bool:
    from app.services.wa_jid import en_lista_modo

    return en_lista_modo(jid, modos.get("numeros_silenciados", []))


def guardar_modos_atencion(data):
    data.setdefault("numeros_en_humano", [])
    data.setdefault("numeros_silenciados", [])
    data.setdefault("timestamps", {})
    data.setdefault("bot_auto_pausados", {})
    with open("app/data/modos_atencion.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _bot_debe_responder_global(modos=None) -> bool:
    """False si el bot está pausado manualmente o fuera del horario configurado."""
    from datetime import timedelta
    if modos is None:
        modos = cargar_modos_atencion()
    if not modos.get("bot_global_activo", True):
        return False
    horario = modos.get("horario_bot", {})
    if not horario.get("habilitado", False):
        return True
    # Colombia siempre UTC-5 (sin cambio de horario)
    now_col = _dt.utcnow() - timedelta(hours=5)
    iso_day = now_col.isoweekday()  # 1=Lun … 7=Dom
    dias_activos = horario.get("dias", [1, 2, 3, 4, 5])
    if iso_day not in dias_activos:
        return False
    hora_actual = now_col.strftime("%H:%M")
    h_ini = horario.get("hora_inicio", "08:00")
    h_fin = horario.get("hora_fin", "18:00")
    return h_ini <= hora_actual < h_fin


def _normalizar_numero_wa(numero: str) -> str | None:
    """Convierte número colombiano a JID WhatsApp (573XXXXXXXXXX@c.us). Acepta @lid tal cual."""
    numero = numero.strip()
    if numero.endswith("@lid"):
        return numero
    if numero.endswith("@c.us") or numero.endswith("@g.us"):
        return numero
    digits = re.sub(r"\D", "", numero)
    if len(digits) == 10 and digits.startswith("3"):
        return f"57{digits}@c.us"
    if len(digits) == 12 and digits.startswith("573"):
        return f"{digits}@c.us"
    if len(digits) > 5:
        return f"{digits}@c.us"
    return None


import time

from app.observability import bind_flask_request, log_json, spawn_thread
from app.api_auth import chat_api_token_matches_request
from app.services.autocorrector import (
    estado_autocorrector,
    manejar_incidente_autocorreccion,
)


def _normalizar_respuesta_cliente(texto: str) -> str:
    """Evita enviar mensajes legacy/confusos al cliente final."""
    if not texto:
        return texto
    legacy = "Veci, hubo un error en el formato del mensaje. Por favor inténtelo de nuevo 🙏"
    if legacy in texto:
        return (
            "Veci, tuvimos un problema técnico temporal. "
            "¿Me reenvía su mensaje, por favor? 🙏"
        )
    return texto


# --- Estado Temporal ---
# TODO: Este diccionario en memoria se pierde si el servidor se reinicia.
# Se debe reemplazar por una solución persistente como Redis o una DB.
borradores_aprobacion = {}

pagos_pendientes_confirmacion = {}
contexto_pago_clientes = {}
VENTANA_CONTEXTO_PAGO_SEGUNDOS = int(os.getenv("VENTANA_CONTEXTO_PAGO_SEGUNDOS", "3600"))
mensajes_recientes_clientes = {}
VENTANA_ANTI_BOT_SEGUNDOS = int(os.getenv("VENTANA_ANTI_BOT_SEGUNDOS", "120"))
UMBRAL_RAFAGA_ANTI_BOT = int(os.getenv("UMBRAL_RAFAGA_ANTI_BOT", "6"))


def _normalizar_texto_anti_bot(texto: str) -> str:
    t = (texto or "").lower()
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"[^a-záéíóúñü0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _detectar_mensaje_de_bot(texto: str) -> str | None:
    """Señales fuertes de autoresponder para cortar bucles bot↔bot."""
    t = _normalizar_texto_anti_bot(texto)
    if not t:
        return None

    patrones = [
        (r"\b(mensaje|respuesta)\s+autom[aá]tic[ao]\b", "mensaje automático"),
        (r"\bsoy\s+(un\s+)?(bot|asistente\s+virtual|asistente\s+digital)\b", "se identifica como bot"),
        (r"\b(no\s+responda|no\s+responder)\s+(a\s+)?este\s+mensaje\b", "pide no responder"),
        (r"\b(en|por)\s+favor\s+(digita|escribe|responde|marca)\s+\d\b", "menú automático"),
        (r"\b(digita|escribe|responde|marca)\s+\d\s+(para|si)\b", "menú automático"),
        (r"\bselecciona\s+(una\s+)?opci[oó]n\b", "menú automático"),
        (r"\bmen[uú]\s+(principal|de\s+opciones)\b", "menú automático"),
        (r"\bopci[oó]n\s+\d\b", "menú automático"),
        (r"\bnuestro\s+horario\s+de\s+atenci[oó]n\b.*\b(es|ser[aá])\b", "fuera de horario automático"),
        (r"\bgracias\s+por\s+(comunicarte|contactarte|contactarnos)\b", "saludo automático"),
    ]
    for patron, razon in patrones:
        if re.search(patron, t, re.IGNORECASE):
            return razon
    return None


def _detectar_rafaga_automatica(sender_id: str, texto: str) -> str | None:
    ahora = time.time()
    ventana = max(10, VENTANA_ANTI_BOT_SEGUNDOS)
    norm = _normalizar_texto_anti_bot(texto)
    recientes = [
        item
        for item in mensajes_recientes_clientes.get(sender_id, [])
        if ahora - item["ts"] <= ventana
    ]
    recientes.append({"ts": ahora, "texto": norm})
    mensajes_recientes_clientes[sender_id] = recientes[-12:]

    if len(recientes) >= UMBRAL_RAFAGA_ANTI_BOT:
        return f"ráfaga de {len(recientes)} mensajes en {ventana}s"
    if norm and sum(1 for item in recientes if item["texto"] == norm) >= 3:
        return "mensaje repetido por posible bot"
    return None


def _detectar_solicitud_humano(texto: str) -> str | None:
    """
    Detecta cuando el cliente pide explícitamente atención humana.
    Retorna una razón corta o None.
    """
    t = (texto or "").strip().lower()
    if not t:
        return None
    # Normalización suave
    t = re.sub(r"\s+", " ", t)
    patrones = [
        r"\b(asesor|agente)\s+humano\b",
        r"\bpersona\b",
        r"\bhumano\b",
        r"\bhablar\s+con\s+(un|una)\s+(asesor|agente|persona)\b",
        r"\bquiero\s+hablar\s+con\s+(un|una)\s+(asesor|agente|persona)\b",
        r"\b(atenci[oó]n|soporte)\s+humana\b",
        r"\bme\s+atiende\s+(alguien|una\s+persona)\b",
    ]
    if any(re.search(p, t, re.IGNORECASE) for p in patrones):
        return "cliente solicitó humano"
    return None


def _pausar_por_bot(sender_id: str, razon: str, texto: str, grupo_destino: str):
    from app.services.wa_jid import aplicar_modo_en_relacionados

    modos = cargar_modos_atencion()
    aplicar_modo_en_relacionados(
        modos,
        sender_id,
        agregar_humano=True,
        razon=razon,
        ts=time.time(),
    )
    for j in list(modos.get("bot_auto_pausados", {})):
        if j in modos.get("numeros_en_humano", []):
            modos["bot_auto_pausados"][j]["ultimo_mensaje"] = (texto or "")[:500]
    guardar_modos_atencion(modos)
    from app.services.wa_logs import registrar as _wa_log
    _wa_log("bot_pausado_auto", sender_id, razon)

    aviso = (
        "🛑 *Anti-loop WhatsApp activado*\n"
        f"Cliente/contacto: `{sender_id}`\n"
        f"Razón: {razon}\n"
        "Hugo quedó en silencio para este chat. Un humano puede responder o usar "
        f"`activar {sender_id}` para reactivar la IA.\n\n"
        f"Último mensaje: {(texto or '[sin texto]')[:700]}"
    )
    spawn_thread(enviar_whatsapp_reporte, args=(aviso, grupo_destino))


def _sufijo_pago(numero: str) -> str:
    """Últimos 3 dígitos del número, para comando corto 'ok 463'."""
    digits = re.sub(r"\D", "", numero)
    return digits[-3:] if len(digits) >= 3 else digits


def _buscar_pago_por_sufijo(sufijo: str) -> str:
    """Retorna el número completo cuyo sufijo coincida y esté sin confirmar."""
    for num, datos in pagos_pendientes_confirmacion.items():
        if _sufijo_pago(num) == sufijo and not datos.get("confirmado"):
            return num
    return None


def _marcar_contexto_pago(numero_cliente: str):
    """Guarda una señal reciente de que el cliente está en flujo de pago."""
    if numero_cliente:
        contexto_pago_clientes[numero_cliente] = time.time()


def _tiene_contexto_pago_reciente(numero_cliente: str) -> bool:
    """Retorna True si el cliente tuvo señales de pago dentro de la ventana."""
    ts = contexto_pago_clientes.get(numero_cliente)
    if not ts:
        return False
    if time.time() - ts <= VENTANA_CONTEXTO_PAGO_SEGUNDOS:
        return True
    # Limpieza perezosa para no acumular contexto viejo en memoria.
    contexto_pago_clientes.pop(numero_cliente, None)
    return False


def _mensaje_sugiere_pago(texto: str) -> bool:
    """
    Heurística conservadora para evitar tratar cualquier imagen como comprobante.
    Solo marca pago cuando texto menciona señales claras de transferencia/comprobante.
    """
    if not texto:
        return False

    t = texto.lower().strip()
    if not t:
        return False

    claves_pago = (
        "comprobante",
        "soporte de pago",
        "soporte pago",
        "transferencia",
        "transferi",
        "transferí",
        "consign",
        "ya pague",
        "ya pagué",
        "pago realizado",
        "te pague",
        "te pagué",
    )
    claves_consulta = (
        "como pago",
        "cómo pago",
        "forma de pago",
        "metodo de pago",
        "método de pago",
        "datos de pago",
        "cuanto pago",
        "cuánto pago",
        "soporte tecnico",
        "soporte técnico",
    )

    if any(k in t for k in claves_consulta):
        return False
    return any(k in t for k in claves_pago)


def _resumen_analisis_pago(analisis: AnalisisImagenPago) -> str:
    partes = []
    if analisis.monto:
        partes.append(f"💵 Valor detectado: {analisis.monto} {analisis.moneda or 'COP'}")
    if analisis.titular:
        partes.append(f"👤 Titular / nombre visible: {analisis.titular}")
    if analisis.banco_origen or analisis.banco_destino:
        bancos = " → ".join(
            b for b in (analisis.banco_origen, analisis.banco_destino) if b
        )
        partes.append(f"🏦 Banco/cuenta: {bancos}")
    if analisis.referencia:
        partes.append(f"🔢 Referencia: {analisis.referencia}")
    if analisis.fecha:
        partes.append(f"📅 Fecha visible: {analisis.fecha}")
    if analisis.items:
        partes.append("🧾 Items visibles: " + ", ".join(analisis.items[:8]))
    if analisis.razon:
        partes.append(f"🤖 Lectura Gemini: {analisis.razon}")
    if analisis.texto_extraido:
        partes.append(f"📝 Texto visible: {analisis.texto_extraido[:500]}")
    return "\n".join(partes)


def _mensaje_imagen_para_ia(
    texto_original: str,
    analisis: AnalisisImagenPago | None,
    media_path: str,
) -> str:
    base = (texto_original or "").strip()
    partes = []
    if base:
        partes.append(base)
    partes.append("El cliente envió una imagen por WhatsApp.")
    if analisis:
        if analisis.error:
            partes.append(f"No pude analizar visualmente la imagen: {analisis.error}.")
        else:
            partes.append(
                "Análisis visual Gemini: "
                f"{'comprobante de pago' if analisis.es_comprobante else 'no parece comprobante de pago'} "
                f"(confianza {analisis.confianza:.2f})."
            )
            if analisis.descripcion:
                partes.append(f"Descripción: {analisis.descripcion}")
            if analisis.texto_extraido:
                partes.append(f"Texto visible: {analisis.texto_extraido[:700]}")
            if analisis.items:
                partes.append("Items/productos visibles: " + ", ".join(analisis.items[:10]))
            if analisis.razon:
                partes.append(f"Razón: {analisis.razon}")
    else:
        partes.append(f"Ruta interna de imagen: {media_path}")
    return "\n".join(partes)


def transcribir_audio_whatsapp(media_path: str, message_id: str = "") -> str | None:
    """Descarga y transcribe un audio de WhatsApp usando OpenAI Whisper."""
    try:
        import openai

        openai_key = os.getenv("OPENAI_API_KEY", "")
        if not openai_key:
            print("⚠ Whisper: OPENAI_API_KEY no configurada")
            return None

        ev_url = os.getenv("EVOLUTION_API_URL", "http://localhost:5000")
        ev_key = os.getenv("EVOLUTION_API_KEY", "")
        inst = os.getenv("INSTANCE_NAME", "Mckenna Group")

        audio_bytes = None

        # Intento 1: descargar via Evolution API getBase64FromMediaMessage
        if message_id:
            try:
                r = _requests_lib.post(
                    f"{ev_url}/chat/getBase64FromMediaMessage/{inst}",
                    headers={"apikey": ev_key, "Content-Type": "application/json"},
                    json={
                        "message": {"key": {"id": message_id}},
                        "convertToMp4": False,
                    },
                    timeout=15,
                )
                if r.ok:
                    b64 = r.json().get("base64", "")
                    if b64:
                        audio_bytes = base64.b64decode(b64)
            except Exception as e:
                print(f"⚠ Whisper getBase64: {e}")

        # Intento 2: leer del path local si existe
        if not audio_bytes and media_path and os.path.exists(media_path):
            with open(media_path, "rb") as f:
                audio_bytes = f.read()

        if not audio_bytes:
            return None

        # Guardar en temp y transcribir
        suffix = ".ogg"
        if media_path and "." in media_path:
            suffix = "." + media_path.rsplit(".", 1)[-1]
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        client = openai.OpenAI(api_key=openai_key)
        with open(tmp_path, "rb") as af:
            result = client.audio.transcriptions.create(
                model="whisper-1", file=af, language="es"
            )
        os.unlink(tmp_path)
        return result.text.strip()
    except Exception as e:
        print(f"❌ Whisper error: {e}")
        return None


def procesar_confirmacion_pago_async(numero_cliente):
    # Aquí podríamos añadir lógica extra asíncrona si se requiere
    # por ahora solo enviamos el mensaje sin bloquear la respuesta de flask
    try:
        if numero_cliente in pagos_pendientes_confirmacion:
            pagos_pendientes_confirmacion[numero_cliente]["confirmado"] = True
            mensaje_cliente = "Veci, le confirmamos que su pago ha sido recibido ✅ Estamos alistando su pedido y le avisamos cuando despachemos."
            enviar_whatsapp_reporte(mensaje_cliente, numero_destino=numero_cliente)
            del pagos_pendientes_confirmacion[numero_cliente]
            contexto_pago_clientes.pop(numero_cliente, None)
    except Exception as e:
        print(f"Error procesando confirmación de pago: {e}")


# --- Lógica de MercadoLibre (Migrada de webhook_meli.py) ---
import time
from preventa_meli import procesar_nueva_pregunta
from app.meli_postventa_notif import procesar_postventa_meli_desde_webhook
from app.meli_reclamos import crear_accion_anular_factura_por_reclamo
from app.meli_webhook_topics import meli_webhook_evaluar_despacho
from app.utils import refrescar_token_meli

# Memoria para deduplicación de preguntas
preguntas_procesadas = {}


def limpiar_preguntas_antiguas():
    """Elimina del registro las preguntas procesadas hace más de 5 minutos."""
    ahora = time.time()
    # 300 segundos = 5 minutos
    para_borrar = [
        q_id
        for q_id, timestamp in preguntas_procesadas.items()
        if ahora - timestamp > 300
    ]
    for q_id in para_borrar:
        del preguntas_procesadas[q_id]


def _procesar_orden_meli(order_id: str):
    """
    Obtiene los detalles de una orden de MeLi y descuenta el stock en WooCommerce
    por cada ítem vendido.
    """
    print(f"📦 [MELI-ORDER] Procesando orden {order_id} para sync de stock...")
    try:
        token = refrescar_token_meli()
        if not token:
            print(f"❌ [MELI-ORDER] No se pudo obtener token para orden {order_id}")
            return

        res = requests.get(
            f"https://api.mercadolibre.com/orders/{order_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if res.status_code != 200:
            print(
                f"⚠️ [MELI-ORDER] Error obteniendo orden {order_id}: {res.status_code}"
            )
            return

        orden = res.json()
        if orden.get("status") not in ["paid", "partially_paid"]:
            print(
                f"⏭️ [MELI-ORDER] Orden {order_id} con estado '{orden.get('status')}' — ignorada."
            )
            return

        for item in orden.get("order_items", []):
            item_info = item.get("item", {})
            item_id = item_info.get("id", "")
            cantidad_vendida = item.get("quantity", 0)

            # Obtener SKU y stock post-venta del ítem desde MeLi
            # MeLi ya autodecrementó su available_quantity al procesar la orden.
            try:
                res_item = requests.get(
                    f"https://api.mercadolibre.com/items/{item_id}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if res_item.status_code == 200:
                    item_data = res_item.json()
                    sku = item_data.get("seller_custom_field", "")
                    stock_post_venta = item_data.get("available_quantity")
                else:
                    sku = ""
                    stock_post_venta = None
            except Exception:
                sku = ""
                stock_post_venta = None

            if not sku:
                print(
                    f"⚠️ [MELI-ORDER] Ítem {item_id} sin SKU — no se puede sincronizar stock."
                )
                continue

            if stock_post_venta is None:
                print(
                    f"⚠️ [MELI-ORDER] No se pudo obtener el stock post-venta para el SKU {sku}"
                )
                continue

            # Aquí iría la nueva lógica para sincronizar con la página web
            print(f"   └──> SKU {sku} | Stock MeLi post-venta: {stock_post_venta}")

    except Exception as e:
        print(f"❌ [MELI-ORDER] Error procesando orden {order_id}: {e}")


_ACCESO_RED_CFG = os.path.join(_ROUTES_DIR, "data", "acceso_red.json")

# ── Panel multi-modelo ─────────────────────────────────────────────────────

_MODELOS_API_FIJOS = [
    {"id": "claude-sonnet-4-6",        "nombre": "Claude Sonnet 4.6", "categoria": "claude",  "proveedor": "Anthropic API"},
    {"id": "claude-haiku-4-5-20251001", "nombre": "Claude Haiku 4.5",  "categoria": "claude",  "proveedor": "Anthropic API"},
    {"id": "gemini-2.5-pro",            "nombre": "Gemini 2.5 Pro",     "categoria": "gemini",  "proveedor": "Google API"},
    {"id": "gemini-2.5-flash",           "nombre": "Gemini 2.5 Flash",   "categoria": "gemini",  "proveedor": "Google API"},
]

_panel_histories: dict = {}  # key: "{session_id}:{modelo_id}" → list[dict]

_SYSTEM_OLLAMA_HUGO = (
    "Eres Hugo García, asesor ejecutivo de McKenna Group S.A.S. (Bogotá, Colombia). "
    "Responde siempre en español colombiano, directo y sin rodeos."
)
_SYSTEM_OLLAMA_DEV = (
    "Eres un asistente de desarrollo para McKenna Group. "
    "Especialidad: Python, Flask, React, TypeScript. "
    "IMPORTANTE: NUNCA inventes IDs, JIDs, tokens, rutas ni valores. "
    "Si no tienes el dato en el contexto adjunto, dilo explícitamente. "
    "Revisas bugs, rutinas y código. Respondes en español."
)
_SYSTEM_OLLAMA_SUPERVISOR = (
    "Eres el Supervisor Técnico del proyecto McKenna Group (Bogotá, Colombia). "
    "REGLA CRÍTICA: SOLO puedes usar los datos del contexto [Código fuente relevante] que se te adjunta. "
    "NUNCA inventes IDs, JIDs, tokens, rutas, nombres de funciones ni valores numéricos. "
    "Si el dato no aparece en el contexto adjunto, responde exactamente: "
    "'No tengo ese dato en el índice actual. Usa /api/supervisor/index para re-indexar.' "
    "Stack: Python/Flask (:8081), React 19+TypeScript (desktop/), WhatsApp bot (bot-mckenna/ :3000), "
    "MercadoLibre API, Siigo ERP, ChromaDB, SQLite. "
    "Al responder: cita siempre el archivo y línea de donde sacaste la información. "
    "Responde en español. Sé directo y preciso."
)
_SYSTEM_PANEL_CLAUDE = (
    "Eres Hugo García, asesor ejecutivo de McKenna Group S.A.S. "
    "Panel interno de pruebas. Responde en español colombiano."
)


def _panel_chat_claude(modelo_id: str, historial: list, mensaje: str) -> str:
    from app.core import cliente_ia
    if not cliente_ia:
        raise RuntimeError("Cliente Anthropic no inicializado — verifica ANTHROPIC_API_KEY en .env")
    msgs = historial + [{"role": "user", "content": mensaje}]
    response = cliente_ia.messages.create(
        model=modelo_id,
        max_tokens=2048,
        system=_SYSTEM_PANEL_CLAUDE,
        messages=msgs,
    )
    return response.content[0].text


def _panel_chat_gemini(modelo_id: str, historial: list, mensaje: str) -> str:
    from app.core import cliente_gemini
    if not cliente_gemini:
        raise RuntimeError("Cliente Gemini no inicializado — verifica GOOGLE_API_KEY en .env")
    contents = []
    for m in historial:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    contents.append({"role": "user", "parts": [{"text": mensaje}]})
    resp = cliente_gemini.models.generate_content(
        model=modelo_id,
        contents=contents,
        config={"system_instruction": "Eres Hugo García, asesor de McKenna Group. Responde en español colombiano."},
    )
    return resp.text


# ── Voz IA: cola de notificaciones en memoria ─────────────────────────────
_voz_notificaciones: list = []  # list[{id, texto, nivel, timestamp}]

def _panel_chat_ollama(modelo_id: str, historial: list, mensaje: str) -> str:
    import requests as _req

    es_supervisor = "gemma4" in modelo_id
    _repo_root = os.path.normpath(os.path.join(_ROUTES_DIR, ".."))
    _msg_lower = mensaje.lower()
    _respuesta_directa: str | None = None

    # ── Comandos de automatización (con o sin prefijo "Hugo") ────────────────
    # Se intenta siempre: interpretar_comando devuelve None si no hay match,
    # así que no hay falsos positivos para preguntas normales.
    try:
        from app.tools.supervisor_actions import interpretar_comando, ejecutar_accion
        _msg_para_cmd = mensaje if _msg_lower.startswith("hugo") else f"Hugo {mensaje}"
        cmd = interpretar_comando(_msg_para_cmd)
        if cmd is not None:
            return ejecutar_accion(cmd)
    except Exception as _sa_exc:
        return f"Error en supervisor_actions: {_sa_exc}"

    # ── Inyección directa por palabras clave (bypassa embedding) ─────────────
    # Para datos exactos (JIDs, IDs, rutas) el embedding semántico falla;
    # mapeamos keywords → archivo a leer directamente.
    _KEYWORD_FILES: list[tuple[list[str], str]] = [
        (["grupo", "whatsapp", "jid"],          "app/data/grupos_whatsapp_oficiales.json"),
        (["grupo", "whatsapp", "id"],            "app/data/grupos_whatsapp_oficiales.json"),
        (["grupos", "whatsapp"],                 "app/data/grupos_whatsapp_oficiales.json"),
        (["grupos_whatsapp", "oficiales"],        "app/data/grupos_whatsapp_oficiales.json"),
        (["tarifas", "interrapidisimo"],         "app/data/tarifas_interrapidisimo.json"),
        (["modos", "atencion"],                  "app/data/modos_atencion.json"),
        (["metricas", "diarias"],                "app/data/metricas_diarias.json"),
    ]

    # Posición ordinal en casos_preventa: última=0, penúltima=1, antepenúltima=2
    _ORDINAL_INDEX = 0
    if any(w in _msg_lower for w in ("antepenultima", "antepenúltima", "ante penultima", "ante penúltima")):
        _ORDINAL_INDEX = 2
    elif any(w in _msg_lower for w in ("penultima", "penúltima")):
        _ORDINAL_INDEX = 1

    _ORDINAL_LABEL = ["última", "penúltima", "antepenúltima"][_ORDINAL_INDEX]

    # Consultas de "último/a" o "reciente" — requieren orden cronológico, no semántico
    _PREVENTA_KEYWORDS = (
        "preventa", "pregunta", "caso", "meli", "mercadolibre", "mercado libre",
        "resuelta", "resuelto", "respondida", "respondido",
    )
    _is_preventa_query = (
        any(w in _msg_lower for w in ("ultima", "último", "penultima", "penúltima",
                                       "antepenultima", "antepenúltima", "reciente"))
        and any(w in _msg_lower for w in _PREVENTA_KEYWORDS)
    )
    _is_pendientes_query = (
        ("pendiente" in _msg_lower or "sin responder" in _msg_lower)
        and any(w in _msg_lower for w in ("preventa", "pregunta", "meli"))
    )

    if _is_preventa_query or _is_pendientes_query:
        try:
            if _is_pendientes_query:
                full_path = os.path.join(_repo_root, "app/data/preguntas_pendientes_preventa.json")
                raw = json.load(open(full_path, encoding="utf-8"))
                pendientes = [p for p in raw.get("preguntas", []) if not p.get("respondida")]
                if not pendientes:
                    _respuesta_directa = "No hay preguntas de preventa pendientes en este momento."
                else:
                    lines = [f"**Preguntas de preventa pendientes ({len(pendientes)}):**\n"]
                    for p in pendientes[:10]:
                        ts = (p.get("timestamp","")[:16]).replace("T"," ")
                        lines.append(f"- [{ts}] **{p.get('titulo_producto','')}** — {p.get('pregunta','')[:120]}")
                    _respuesta_directa = "\n".join(lines)
            else:
                full_path = os.path.join(_repo_root, "app/training/casos_preventa.json")
                raw = json.load(open(full_path, encoding="utf-8"))
                casos = sorted(raw.get("casos", []), key=lambda c: c.get("timestamp",""), reverse=True)
                if len(casos) <= _ORDINAL_INDEX:
                    _respuesta_directa = f"No hay suficientes casos registrados para mostrar la {_ORDINAL_LABEL}."
                else:
                    n = casos[_ORDINAL_INDEX]
                    ts = n.get("timestamp","")[:16].replace("T"," ")
                    lines = [
                        f"**{_ORDINAL_LABEL.capitalize()} pregunta de preventa resuelta** "
                        f"(#{_ORDINAL_INDEX + 1} más reciente · fuente: `app/training/casos_preventa.json`)\n",
                        f"**Fecha:** {ts}",
                        f"**Producto:** {n.get('producto','(sin producto)')}",
                        f"**Pregunta del cliente:** {n.get('pregunta','')}",
                        f"**Respuesta enviada:**\n{n.get('respuesta','')}",
                    ]
                    _respuesta_directa = "\n".join(lines)
        except Exception as exc:
            _respuesta_directa = f"Error leyendo casos_preventa.json: {exc}"

    # ── Búsqueda por producto/contenido en casos_preventa ─────────────────────
    # Detecta preguntas como "qué respondió la IA para X", "respuesta al caso de Y"
    _buscar_en_casos = (
        _respuesta_directa is None
        and any(w in _msg_lower for w in ("respondio", "respondió", "que dijo", "qué dijo",
                                           "respuesta para", "respuesta al", "respuesta de la ia",
                                           "respondio la ia", "respondió la ia"))
        and any(w in _msg_lower for w in ("preventa", "pregunta", "caso", "producto",
                                           "cliente", "meli", "vitamina", "acido", "ácido",
                                           "urea", "niacinamida", "retinol", "colageno",
                                           "colágeno", "glicerina"))
    )
    if not _buscar_en_casos and _respuesta_directa is None:
        # Fallback: si mencionan un producto específico y "respondió" o "respuesta"
        _buscar_en_casos = (
            any(w in _msg_lower for w in ("respondio", "respondió", "que dijo", "qué dijo"))
            and len(mensaje) > 30
        )
    if _buscar_en_casos:
        try:
            full_path = os.path.join(_repo_root, "app/training/casos_preventa.json")
            raw = json.load(open(full_path, encoding="utf-8"))
            casos = raw.get("casos", [])
            # Buscar coincidencias por palabras del mensaje en producto + pregunta
            palabras = [w for w in _msg_lower.split() if len(w) > 3
                        and w not in {"cual", "cuál", "como", "cómo", "para", "este", "esta",
                                      "respondio", "respondió", "pregunta", "respuesta", "producto"}]
            def _score(c: dict) -> int:
                texto = (c.get("producto","") + " " + c.get("pregunta","")).lower()
                return sum(1 for p in palabras if p in texto)
            matches = sorted(casos, key=_score, reverse=True)
            best = [m for m in matches if _score(m) > 0][:3]
            if not best:
                _respuesta_directa = "No encontré un caso en preventa que coincida con esa búsqueda."
            else:
                lines = [f"**{len(best)} caso(s) de preventa que coinciden** (fuente: `casos_preventa.json`)\n"]
                for i, n in enumerate(best, 1):
                    ts = n.get("timestamp","")[:16].replace("T"," ")
                    lines.append(f"### Caso {i} — {ts}")
                    lines.append(f"**Producto:** {n.get('producto','')}")
                    lines.append(f"**Pregunta del cliente:** {n.get('pregunta','')}")
                    lines.append(f"**Respuesta enviada:**\n{n.get('respuesta','')}\n")
                _respuesta_directa = "\n".join(lines)
        except Exception as exc:
            _respuesta_directa = f"Error buscando en casos_preventa.json: {exc}"

    fragmentos_directos: list[str] = []
    for keywords, filepath in _KEYWORD_FILES:
        if all(k in _msg_lower for k in keywords):
            try:
                full_path = os.path.join(_repo_root, filepath)
                raw = json.load(open(full_path, encoding="utf-8"))
                if "grupos_whatsapp" in filepath:
                    # Para datos exactos (JIDs) retornamos directamente sin pasar por el modelo
                    lines = [f"Grupos WhatsApp McKenna Group (fuente: `{filepath}`)\n"]
                    excl = raw.get("pedidos_web_exclusivo", {})
                    if excl:
                        lines.append(f"**{excl.get('nombre')}** ← exclusivo pedidos web")
                        lines.append(f"  JID: `{excl.get('jid')}` · env: `{excl.get('env')}`")
                        lines.append(f"  Uso: {excl.get('uso')}\n")
                    lines.append("**Todos los grupos:**")
                    for g in raw.get("grupos", []):
                        env = f" · env: `{g['env_sugerido']}`" if g.get("env_sugerido") else ""
                        lines.append(f"- **{g.get('nombre')}** — JID: `{g.get('jid')}`{env}")
                    _respuesta_directa = "\n".join(lines)
                else:
                    content = json.dumps(raw, ensure_ascii=False, indent=2)
                    fragmentos_directos.append(f"[{filepath} — lectura directa]\n{content}")
            except Exception:
                pass
            break  # solo el primer match

    # Si hay respuesta directa (datos exactos), retornar sin llamar al modelo
    if _respuesta_directa is not None:
        return _respuesta_directa

    # ── Consultar memoria vectorial para contexto ─────────────────────────
    contexto = ""
    try:
        import chromadb as _chroma
        _chroma_path = os.path.join(_ROUTES_DIR, "..", "memoria_vectorial")
        _cc = _chroma.PersistentClient(path=os.path.normpath(_chroma_path))
        fragmentos = list(fragmentos_directos)  # directos van primero

        # Código fuente por embedding (supervisor)
        if es_supervisor and not fragmentos_directos:
            try:
                col = _cc.get_collection("proyecto_codigo")
                res = col.query(query_texts=[mensaje], n_results=6)
                docs = res.get("documents", [[]])[0]
                metas = res.get("metadatas", [[]])[0]
                for doc, meta in zip(docs, metas):
                    if doc and len(doc) > 30:
                        fragmentos.append(f"[{meta.get('file','')} L{meta.get('lines','')}]\n{doc}")
            except Exception:
                pass

        # Memoria conversacional
        for col_name in ("mckenna_brain", "mckenna_debug_memory", "conocimiento_cientifico"):
            try:
                col = _cc.get_collection(col_name)
                res = col.query(query_texts=[mensaje], n_results=2)
                docs = res.get("documents", [[]])[0]
                fragmentos.extend(d for d in docs if d and len(d) > 20)
            except Exception:
                pass

        if fragmentos:
            contexto = "\n---\n".join(fragmentos[:6])
    except Exception:
        pass

    if es_supervisor:
        base_system = _SYSTEM_OLLAMA_SUPERVISOR
    elif modelo_id.startswith("hugo-garcia"):
        base_system = _SYSTEM_OLLAMA_HUGO
    else:
        base_system = _SYSTEM_OLLAMA_DEV

    # Inyectar contexto RAG dentro del mensaje del usuario (no en el system),
    # así el modelo lo ve justo antes de generar la respuesta y no lo ignora.
    if contexto and es_supervisor:
        mensaje_con_ctx = (
            f"<contexto_del_proyecto>\n{contexto}\n</contexto_del_proyecto>\n\n"
            f"Usando SOLO los datos del contexto anterior, responde:\n{mensaje}"
        )
    elif contexto:
        mensaje_con_ctx = f"[Contexto relevante]:\n{contexto}\n\nPregunta: {mensaje}"
    else:
        mensaje_con_ctx = mensaje

    messages = [{"role": "system", "content": base_system}] + historial + [{"role": "user", "content": mensaje_con_ctx}]
    r = _req.post(
        "http://localhost:11434/api/chat",
        json={"model": modelo_id, "messages": messages, "stream": False},
        timeout=180,
    )
    r.raise_for_status()
    return r.json()["message"]["content"]


def _guardar_en_memoria_panel(mensaje: str, respuesta: str, modelo_id: str) -> None:
    """Guarda el Q&A del panel en ChromaDB para contexto futuro."""
    try:
        import chromadb as _chroma, uuid as _uuid
        from datetime import datetime as _dt2
        _chroma_path = os.path.join(_ROUTES_DIR, "..", "memoria_vectorial")
        _cc = _chroma.PersistentClient(path=os.path.normpath(_chroma_path))
        col = _cc.get_or_create_collection("mckenna_brain")
        col.add(
            documents=[f"Pregunta: {mensaje}\nRespuesta: {respuesta}"],
            ids=[_uuid.uuid4().hex],
            metadatas=[{"modelo": modelo_id, "fecha": _dt2.now().isoformat(), "origen": "panel_chat"}],
        )
    except Exception:
        pass


def _leer_acceso_red() -> bool:
    try:
        with open(_ACCESO_RED_CFG) as _f:
            return bool(json.load(_f).get("habilitado", True))
    except (FileNotFoundError, json.JSONDecodeError):
        return True


def _escribir_acceso_red(habilitado: bool) -> None:
    with open(_ACCESO_RED_CFG, "w") as _f:
        json.dump({"habilitado": habilitado}, _f)


def _ip_lan_local() -> str | None:
    import socket as _socket
    try:
        with _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM) as _s:
            _s.connect(("8.8.8.8", 80))
            _ip = _s.getsockname()[0]
            if _ip and not _ip.startswith("127."):
                return _ip
    except OSError:
        pass
    try:
        _ip = _socket.gethostbyname(_socket.gethostname())
        if _ip and not _ip.startswith("127."):
            return _ip
    except OSError:
        pass
    return None


def register_routes(app):
    @app.before_request
    def _mckenna_bind_request_id():
        bind_flask_request(request)

    @app.before_request
    def _check_acceso_red():
        remote = request.remote_addr
        if remote in ("127.0.0.1", "::1") or (remote or "").startswith("127."):
            return
        if request.method == "OPTIONS":
            return
        if not _leer_acceso_red():
            from flask import Response as _R
            return _R(
                "<html><body style='font-family:sans-serif;padding:2rem'>"
                "<h2>Acceso restringido</h2>"
                "<p>El panel solo está disponible desde el equipo local.</p>"
                "<p>Activa el acceso desde red local en Ajustes.</p>"
                "</body></html>",
                status=403,
                content_type="text/html; charset=utf-8",
            )

    @app.route("/notifications", methods=["POST"])
    def notifications():
        """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
        data = request.get_json(force=True, silent=True)

        topic = data.get("topic") if data else None
        resource = (data or {}).get("resource", "")

        print(
            f"📬 [NOTIF] topic={topic!r} resource={resource!r}"
            f" payload={json.dumps(data, default=str)[:400] if data else '(vacío)'}"
        )
        log_json(
            "meli_notification_received",
            topic=topic,
            resource=resource,
        )

        if not data:
            print("⚠️ [NOTIF] Body vacío o JSON inválido — ignorado.")
            try:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente("notif_body_invalido", source="routes")
            except Exception:
                pass
            return jsonify({"status": "ok"}), 200

        from app.monitor import incrementar_metrica
        from app.meli_webhook_incidents import registrar_meli_webhook_incidente

        plan = meli_webhook_evaluar_despacho(topic, resource, data)
        t = plan["tipo"]

        if t == "preventa":
            question_id = plan["question_id"]
            limpiar_preguntas_antiguas()
            if question_id in preguntas_procesadas:
                print(f"⏭️ [PREVENTA] Pregunta {question_id} ya procesada (dedup).")
            else:
                preguntas_procesadas[question_id] = time.time()
                print(f"❓ [PREVENTA] Despachando pregunta {question_id}")
                spawn_thread(procesar_nueva_pregunta, args=(question_id,))
                try:
                    incrementar_metrica("preguntas_meli")
                except Exception:
                    pass
        elif t == "orden":
            order_id = plan["order_id"]
            print(f"🛒 [MELI-ORDER] Nueva orden: {order_id}")
            spawn_thread(_procesar_orden_meli, args=(order_id,))
            try:
                incrementar_metrica("ordenes_meli")
            except Exception:
                pass
        elif t == "postventa":
            print(f"📩 [MELI-MSG] Posventa topic={topic!r} resource={resource!r}")
            registrar_meli_webhook_incidente(
                "postventa_webhook_recibido",
                topic=topic,
                resource=(resource or "")[:500],
                source="routes",
            )
            spawn_thread(
                procesar_postventa_meli_desde_webhook,
                args=(plan["resource"],),
                daemon=True,
            )
        elif t == "postventa_omitir_lectura":
            print(
                f"⏭️ [POSVENTA] Sin action 'created' — omitida. "
                f"actions={data.get('actions')!r}"
            )
        elif t == "reclamo":
            print(f"⚠️ [MELI-CLAIM] Reclamo/devolución topic={topic!r} resource={resource!r}")
            spawn_thread(
                crear_accion_anular_factura_por_reclamo,
                args=(plan["resource"],),
                kwargs={"topic": plan.get("topic")},
                daemon=True,
            )
        else:
            _noop_msgs = {
                "preventa_sin_resource": "⚠️ [PREVENTA] resource vacío, ignorado.",
                "preventa_sin_question_id": "⚠️ [PREVENTA] resource sin id de pregunta, ignorado.",
                "orden_sin_resource": "⚠️ [MELI-ORDER] orders_v2 sin resource, ignorado.",
                "orden_omitir_accion_pasiva": (
                    f"⏭️ [MELI-ORDER] Evento pasivo omitido. "
                    f"actions={data.get('actions')!r}"
                ),
                "postventa_sin_resource": "⚠️ [POSVENTA] messages sin resource, ignorado.",
                "reclamo_sin_resource": "⚠️ [MELI-CLAIM] Reclamo sin resource, ignorado.",
                "topic_no_manejado": f"ℹ️ [NOTIF] topic={topic!r} no manejado (se ignora).",
            }
            print(_noop_msgs.get(t, f"ℹ️ [NOTIF] tipo plan={t!r}"))
            registrar_meli_webhook_incidente(
                "notif_sin_efecto_util",
                tipo=t,
                topic=topic,
                resource=(resource or "")[:500],
                source="routes",
            )

        return jsonify({"status": "ok"}), 200

    """
    Registra todas las rutas de la aplicación en la instancia de Flask.
    Esto sigue el patrón de "Application Factory" para una mejor organización.
    """

    @app.route("/whatsapp", methods=["POST"])
    def whatsapp_endpoint():
        """
        Endpoint principal que recibe los webhooks de WhatsApp.
        Procesa los mensajes, gestiona un flujo de aprobación para posventa y responde.
        """
        data = request.json
        if not data:
            return jsonify(
                {
                    "status": "error",
                    "respuesta": "Request inválido, no se recibió JSON.",
                }
            ), 400

        log_json(
            "whatsapp_webhook",
            sender_preview=str(data.get("sender", ""))[-24:],
            has_message=bool((data.get("mensaje") or "").strip()),
        )

        try:
            from app.monitor import incrementar_metrica

            incrementar_metrica("mensajes_whatsapp")
        except Exception:
            pass

        sender_raw = str(data.get("sender", "desconocido") or "").strip()
        sender_lid = str(data.get("sender_lid") or "").strip()
        sender_phone = str(data.get("sender_phone") or "").strip()
        try:
            from app.services.wa_jid import jid_canonico, registrar_alias_lid

            if sender_lid and sender_phone:
                registrar_alias_lid(sender_lid, sender_phone)
            sender_id = jid_canonico(sender_raw) if sender_raw else sender_raw
        except Exception:
            sender_id = sender_raw
        reply_to_wa = str(data.get("reply_to") or sender_raw or sender_id).strip()
        message_text = data.get("mensaje", "").strip()
        is_after_sale = data.get("es_postventa", False)
        order_id = data.get("order_id", sender_id)

        # Adaptación para aceptar hasMedia o has_media según venga del node o de otro lado
        has_media = data.get("hasMedia", data.get("has_media", False))
        media_type = data.get("mediaType", data.get("media_type", ""))
        media_path = data.get("mediaPath", "")
        es_grupo_contabilidad = data.get("es_grupo_contabilidad", False)

        # IDs de los grupos por área
        grupo_compras = os.getenv(
            "GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us"
        )
        grupo_preventa = jid_grupo_preventa_wa()
        grupo_posventa = jid_grupo_postventa_wa()
        grupo_inventario = jid_grupo_inventario_wa()

        # Detectar de qué grupo proviene el mensaje (por flag explícito o por remoteJid/sender)
        remote_jid = _jid_limpio(data.get("remoteJid") or data.get("grupo_id", ""))
        if not remote_jid and "@g.us" in sender_id:
            remote_jid = _jid_limpio(sender_id)

        grupo_compras_norm = _jid_limpio(grupo_compras)
        grupo_preventa_norm = _jid_limpio(grupo_preventa)
        grupo_posventa_norm = _jid_limpio(grupo_posventa)

        es_grupo_compras = es_grupo_contabilidad or (bool(grupo_compras_norm) and remote_jid == grupo_compras_norm)
        es_grupo_preventa_cmd = bool(grupo_preventa_norm) and remote_jid == grupo_preventa_norm
        es_grupo_posventa_cmd = bool(grupo_posventa_norm) and remote_jid == grupo_posventa_norm
        es_any_grupo_admin = (
            es_grupo_compras or es_grupo_preventa_cmd or es_grupo_posventa_cmd
        )

        grupo_sede_sur = _jid_limpio(
            os.getenv("GRUPO_SEDE_SUR_WA", "120363023555909043@g.us")
        )
        es_grupo_sede_sur = bool(grupo_sede_sur) and remote_jid == grupo_sede_sur

        # Alias para compatibilidad con código existente
        grupo_contabilidad = grupo_compras

        # Comandos MeLi operativos: aceptar aunque lleguen por chat 1:1 al número del negocio
        # (a veces el operador escribe ahí en vez del grupo Postventa_Meli).
        _msg_norm = _normalizar_comando_grupo(message_text)
        if _msg_norm.lower().startswith("posventa "):
            spawn_thread(_procesar_comando_posventa_wa, args=(_msg_norm,))
            return jsonify({"status": "ok", "respuesta": None})

        # --- Comandos pedidos web: facturar / envio (varios grupos operativos) ---
        if _remote_es_grupo_web_pedido(remote_jid) and message_text:
            tn = _normalizar_texto_comando_wa(message_text)
            destino_grupo = _jid_limpio(remote_jid)

            if re.search(r"\bfacturar\b", tn, re.IGNORECASE):

                def _wa_pedido_facturar(texto_norm: str, destino: str):
                    from app.tools import web_pedidos as wp

                    tok = _token_tras_facturar(texto_norm)
                    if not tok:
                        enviar_whatsapp_reporte(
                            "⚠️ Usa: *facturar 250* (últimos 3) o *facturar MCKG-…*",
                            numero_destino=destino,
                        )
                        return
                    ref_cmd, err = wp.resolver_referencia_desde_token(tok)
                    if err:
                        enviar_whatsapp_reporte(err, numero_destino=destino)
                        return
                    _ok, out = wp.marcar_solicitud_facturacion(ref_cmd)
                    enviar_whatsapp_reporte(out, numero_destino=destino)

                spawn_thread(
                    _wa_pedido_facturar,
                    args=(tn, destino_grupo),
                    daemon=True,
                )
                return jsonify({"status": "ok", "respuesta": None})

            if tn.lower().startswith("envio "):

                def _wa_pedido_envio(texto_norm: str, destino: str):
                    from app.tools import web_pedidos as wp

                    partes = texto_norm.split()
                    if len(partes) < 3:
                        enviar_whatsapp_reporte(
                            "⚠️ *envio 250 NUM_GUIA* [transportadora]\n"
                            "Ej: *envio 250 7005753156 Interrapidísimo*\n"
                            "Mismo día sin guía: *envio 250 flex*",
                            numero_destino=destino,
                        )
                        return
                    ref, err = wp.resolver_referencia_desde_token(partes[1].strip())
                    if err:
                        enviar_whatsapp_reporte(err, numero_destino=destino)
                        return
                    guia = partes[2].strip()
                    carrier = (
                        " ".join(partes[3:]).strip()
                        if len(partes) > 3
                        else ""
                    )
                    ok, out = wp.registrar_envio_y_notificar(ref, guia, carrier)
                    enviar_whatsapp_reporte(
                        f"{'✅' if ok else '❌'} {out}", numero_destino=destino
                    )

                spawn_thread(
                    _wa_pedido_envio,
                    args=(tn, destino_grupo),
                    daemon=True,
                )
                return jsonify({"status": "ok", "respuesta": None})

        # --- COMANDOS DE GRUPOS ADMIN ---
        if es_any_grupo_admin:
            modos = cargar_modos_atencion()
            msg_lower = message_text.lower()

            # Rechazo corto: "no 463"
            if re.match(r"^no\s+\d{3}$", msg_lower):
                sufijo = msg_lower.split()[1]
                target_num = _buscar_pago_por_sufijo(sufijo)
                if target_num:
                    pagos_pendientes_confirmacion.pop(target_num, None)
                    borradores_aprobacion.pop(target_num, None)
                    contexto_pago_clientes.pop(target_num, None)
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            "Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida.",
                            target_num,
                        ),
                    )
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"❌ Pago rechazado para ...{sufijo}",
                            grupo_contabilidad,
                        ),
                    )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"⚠️ No encontré pago pendiente con código {sufijo}.",
                            grupo_contabilidad,
                        ),
                    )
                return jsonify({"status": "ok", "respuesta": None})

            # Formato corto: "ok 463" (últimos 3 dígitos del número)
            if re.match(r"^ok\s+\d{3}$", msg_lower):
                sufijo = msg_lower.split()[1]
                target_num = _buscar_pago_por_sufijo(sufijo)
                if target_num:
                    spawn_thread(
                        procesar_confirmacion_pago_async, args=(target_num,)
                    )
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"✅ Pago confirmado al cliente ...{sufijo}",
                            grupo_contabilidad,
                        ),
                    )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"⚠️ No encontré pago pendiente con código {sufijo}.",
                            grupo_contabilidad,
                        ),
                    )
                return jsonify({"status": "ok", "respuesta": None})

            if msg_lower.startswith("ok confirmado"):
                partes = message_text.split(" ", 2)
                if len(partes) >= 3 and partes[2].strip():
                    # Formato completo: "ok confirmado {numero}"
                    target_num = partes[2].strip()
                else:
                    # Sin número: buscar el único pago pendiente
                    pendientes = [
                        k
                        for k, v in pagos_pendientes_confirmacion.items()
                        if not v.get("confirmado")
                    ]
                    if len(pendientes) == 1:
                        target_num = pendientes[0]
                    else:
                        cantidad = len(pendientes)
                        msg_error = (
                            f"⚠️ Hay {cantidad} pagos pendientes. Usa: ok <últimos 3 dígitos>"
                            if cantidad > 1
                            else "⚠️ No hay pagos pendientes por confirmar."
                        )
                        spawn_thread(
                            enviar_whatsapp_reporte,
                            args=(msg_error, grupo_contabilidad),
                        )
                        return jsonify({"status": "ok", "respuesta": None})
                spawn_thread(
                    procesar_confirmacion_pago_async, args=(target_num,)
                )
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(
                        f"✅ Confirmación enviada al cliente {target_num}",
                        grupo_contabilidad,
                    ),
                )
                return jsonify({"status": "ok", "respuesta": None})

            # "OK" o "ok" a solas → aprueba factura de compra pendiente (si la hay)
            elif msg_lower.strip() == "ok":
                from app import shared_state

                if shared_state.eventos_aprobacion_facturas:
                    factura_key = next(iter(shared_state.eventos_aprobacion_facturas))
                    entrada = shared_state.eventos_aprobacion_facturas.get(factura_key)
                    if entrada:
                        entrada["aprobado"] = True
                        entrada["event"].set()
                        spawn_thread(
                            enviar_whatsapp_reporte,
                            args=(
                                f"✅ Factura *{factura_key}* aprobada. Creando en SIIGO...",
                                grupo_contabilidad,
                            ),
                        )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            "⚠️ No hay facturas pendientes de aprobación en este momento.",
                            grupo_contabilidad,
                        ),
                    )
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("pausar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num not in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].append(target_num)
                modos["timestamps"][target_num] = time.time()
                guardar_modos_atencion(modos)
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(
                        "En este momento te va a atender Jennifer García del área de ventas 🙏",
                        target_num,
                    ),
                )
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("activar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].remove(target_num)
                modos.get("timestamps", {}).pop(target_num, None)
                modos.get("bot_auto_pausados", {}).pop(target_num, None)
                guardar_modos_atencion(modos)
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(
                        "Hola veci, soy Hugo García nuevamente, ¿en qué le puedo ayudar?",
                        target_num,
                    ),
                )
                return jsonify({"status": "ok", "respuesta": None})

            # ── Comandos de facturas de compra: solo gasto/skip/lista desde WA ──
            elif msg_lower.startswith("inv "):

                def _manejar_inv(texto):
                    from app.tools.importar_productos_siigo import (
                        procesar_respuesta_factura_compra,
                        listar_facturas_pendientes,
                    )

                    partes = texto.split()
                    if len(partes) >= 2 and partes[1].lower() == "lista":
                        resultado = listar_facturas_pendientes()
                    elif len(partes) >= 3:
                        cmd = partes[1].lower()
                        sufijo = partes[2].upper()
                        if cmd in ("inventario", "ok"):
                            resultado = (
                                f"ℹ️ La clasificación como *inventario* se hace desde el "
                                f"Panel de Operaciones para revisar y aprobar cada producto individualmente.\n\n"
                                f"Comandos disponibles aquí:\n"
                                f"  *inv gasto {sufijo}*  → registrar como gasto en SIIGO\n"
                                f"  *inv skip {sufijo}*   → omitir esta factura"
                            )
                        else:
                            resultado = procesar_respuesta_factura_compra(cmd, sufijo)
                    else:
                        resultado = (
                            "ℹ️ Comandos de facturas de compra:\n"
                            "  *inv gasto <código>*   → registrar como gasto en SIIGO\n"
                            "  *inv skip <código>*    → omitir factura\n"
                            "  *inv lista*            → ver pendientes\n\n"
                            "_Para inventariar productos: usar el Panel de Operaciones_"
                        )
                    enviar_whatsapp_reporte(
                        resultado, numero_destino=grupo_contabilidad
                    )

                spawn_thread(_manejar_inv, args=(message_text,))
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("resp preventa "):
                print(f"📨 Comando preventa recibido del grupo: {message_text[:120]}")
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                print(
                    f"🔍 Detectado — ID: {question_id} | Respuesta: {str(respuesta_humana)[:60]}"
                )
                if question_id and respuesta_humana:
                    spawn_thread(
                        _procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana),
                    )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            "⚠️ Formato inválido. Escribe así (sin llaves):\n"
                            f"resp preventa {question_id or '<ID>'}: tu respuesta va aquí",
                            grupo_preventa,
                        ),
                    )
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("resp "):
                # Intentar primero como comando preventa (formato corto: resp 497: ...)
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                if question_id and respuesta_humana:
                    print(
                        f"📨 Preventa (formato corto) — ID: {question_id} | Resp: {respuesta_humana[:60]}"
                    )
                    spawn_thread(
                        _procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana),
                    )
                    return jsonify({"status": "ok", "respuesta": None})

                # Si no es preventa, tratar como respuesta directa: resp <numero>: <mensaje>
                partes = message_text.split(" ", 1)[1].split(":", 1)
                if len(partes) == 2 and partes[1].strip():
                    target_num = partes[0].strip()
                    resp_msg = partes[1].strip()
                    # Evita desviar errores de preventa a WA directo (ej: "resp 997: ...")
                    if target_num.isdigit() and len(target_num) <= 6:
                        diag = diagnosticar_sufijo_preventa(target_num)
                        if diag["count"] > 1:
                            ids = ", ".join(diag["matches"][:5])
                            extra = " ..." if diag["count"] > 5 else ""
                            msg_error = (
                                "⚠️ Código corto ambiguo en preventa.\n"
                                f"Hay {diag['count']} preguntas que terminan en *{target_num}* "
                                f"({ids}{extra}).\n"
                                "Usa formato completo: "
                                "`resp preventa <question_id>: tu respuesta`."
                            )
                        elif diag["count"] == 0:
                            msg_error = (
                                "⚠️ No pude resolver ese código corto como preventa pendiente.\n"
                                "Usa `resp preventa <question_id>: ...` o verifica el código activo en la alerta."
                            )
                        else:
                            # Si hay 1 match y llegó aquí, hubo problema de formato.
                            msg_error = (
                                "⚠️ Detecté un pendiente con ese código, pero el formato no se pudo procesar.\n"
                                "Usa: `resp preventa <question_id>: tu respuesta`."
                            )
                        spawn_thread(
                            enviar_whatsapp_reporte,
                            args=(
                                msg_error,
                                grupo_preventa,
                            ),
                        )
                        return jsonify({"status": "ok", "respuesta": None})
                    spawn_thread(
                        enviar_whatsapp_reporte, args=(resp_msg, target_num)
                    )
                    return jsonify({"status": "ok", "respuesta": None})
                # Sin mensaje o sin formato completo → ignorar silenciosamente

            return jsonify({"status": "ok", "respuesta": None})

        if not es_any_grupo_admin:
            razon_bot = _detectar_mensaje_de_bot(message_text)
            if not razon_bot:
                razon_bot = _detectar_rafaga_automatica(sender_id, message_text)
            if razon_bot:
                _pausar_por_bot(sender_id, razon_bot, message_text, grupo_contabilidad)
                return jsonify({"status": "bot_loop_paused", "respuesta": None})

        # --- Guardar mensaje entrante en historial de chats ---
        if not es_any_grupo_admin and not es_grupo_sede_sur and (message_text or has_media):
            try:
                from app.services.wa_chats import guardar as _wa_chat_guardar
                _tiene_media = bool(has_media) if "has_media" in dir() else False
                _wa_ts = data.get("ts")
                try:
                    _wa_ts = float(_wa_ts) if _wa_ts is not None else None
                except (TypeError, ValueError):
                    _wa_ts = None
                _wa_chat_guardar(
                    sender_id,
                    "entrada",
                    message_text or "",
                    _tiene_media,
                    "",
                    "cliente",
                    wa_id=str(data.get("wa_id") or "").strip() or None,
                    ts=_wa_ts,
                )
            except Exception:
                pass

        # --- Números silenciados (spam / no clientes) ---
        if not es_any_grupo_admin and not es_grupo_sede_sur:
            _modos_sil = cargar_modos_atencion()
            if _wa_en_silenciado(_modos_sil, sender_id) or (
                sender_lid and _wa_en_silenciado(_modos_sil, sender_lid)
            ):
                from app.services.wa_logs import registrar as _wa_log
                _wa_log("silenciado_ignorado", sender_id, (message_text or "")[:200])
                return jsonify({"status": "silenciado", "respuesta": None})

        # --- Solicitud explícita de humano ---
        if not es_any_grupo_admin and not es_grupo_sede_sur:
            razon_h = _detectar_solicitud_humano(message_text)
            if razon_h:
                from app.services.wa_jid import aplicar_modo_en_relacionados

                modos = cargar_modos_atencion()
                aplicar_modo_en_relacionados(
                    modos,
                    sender_id,
                    agregar_humano=True,
                    razon=razon_h,
                    ts=time.time(),
                )
                for j in modos.get("bot_auto_pausados", {}):
                    if j in modos.get("numeros_en_humano", []):
                        modos["bot_auto_pausados"][j]["ultimo_mensaje"] = (
                            message_text or ""
                        )[:500]
                guardar_modos_atencion(modos)
                from app.services.wa_logs import registrar as _wa_log
                _wa_log("handoff_humano", sender_id, razon_h)

                # Avisar al cliente (una sola vez; luego queda en humano y se reenvía al grupo)
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(
                        "Listo veci 🙏 A continuación sigue la conversación con un asesor humano.",
                        reply_to_wa,
                    ),
                    daemon=True,
                )
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(f"🧑‍💼 *Handoff a humano*\nCliente {sender_id} pidió asesor.\nMensaje: {message_text[:700]}", grupo_compras),
                    daemon=True,
                )
                return jsonify({"status": "human_handoff", "respuesta": None})

        # --- SWITCH IA/HUMANO ---
        if not es_any_grupo_admin and not es_grupo_sede_sur:
            modos = cargar_modos_atencion()
            if _wa_en_modo_humano(modos, sender_id) or (
                sender_lid and _wa_en_modo_humano(modos, sender_lid)
            ):
                from app.services.wa_logs import registrar as _wa_log
                from app.services.wa_jid import formato_display

                _wa_log("modo_humano", sender_id, (message_text or "")[:200])
                # Reenviar al grupo de compras (atención general) y no procesar IA
                etiqueta = formato_display(sender_id)
                mensaje_reenvio = f"💬 CLIENTE {etiqueta} ({sender_id}): {message_text}"
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(mensaje_reenvio, grupo_compras),
                )
                return jsonify({"status": "human_mode", "respuesta": None})
            # --- CONTROL GLOBAL DEL BOT (manual o por horario) ---
            if not _bot_debe_responder_global(modos):
                from app.services.wa_logs import registrar as _wa_log
                _wa_log("bot_pausado_global", sender_id, (message_text or "")[:200])
                return jsonify({"status": "bot_paused_global", "respuesta": None})

        # --- Flujo de Aprobación para Comprobantes de Pago (legacy) ---
        if message_text.lower().startswith("pago no"):
            target_sender = message_text.split()[-1]
            if target_sender in borradores_aprobacion:
                borradores_aprobacion.pop(target_sender)
                return jsonify(
                    {
                        "status": "success",
                        "respuesta": f"Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida.",
                    }
                )
            else:
                return jsonify(
                    {
                        "status": "error",
                        "respuesta": f"No encontré un comprobante pendiente para el número '{target_sender}'.",
                    }
                )

        # --- Notas de Voz: transcripción con Whisper ----------------------
        message_id = data.get("messageId", data.get("message_id", ""))
        if has_media and media_type in ("audio", "ptt", "voice"):
            transcripcion = transcribir_audio_whatsapp(media_path, message_id)
            if transcripcion:
                print(f"🎙 Whisper transcribió: {transcripcion[:80]}...")
                message_text = transcripcion
            else:
                return jsonify(
                    {
                        "status": "ok",
                        "respuesta": "Veci, recibí tu nota de voz pero no pude escucharla bien. ¿Puedes escribirme tu consulta? 🙏",
                    }
                )

        # --- MCKG SEDE SUR: equipo interno con Ollama local ---
        if es_grupo_sede_sur and message_text:
            from app.tools.sede_sur import procesar_accion_sede_sur
            texto_agente, accion, activar_ia = procesar_accion_sede_sur(message_text)

            respuesta_inmediata = None

            if accion is not None:
                # Confirmación de ticket: síncrona, sin Ollama
                if accion.get("ok") and "ticket_numero" in accion:
                    respuesta_inmediata = (
                        f"✅ {accion['ticket_numero']} creado para {accion['asignado_a']}: "
                        f"{accion['titulo']} "
                        f"(Prioridad: {accion['prioridad']}, categoria: {accion['categoria']})"
                    )
                elif accion.get("ok") and "resuelto_por" in accion:
                    quién = accion.get("resuelto_por", "equipo")
                    sufijo = f" por {quién}" if quién != "equipo" else ""
                    respuesta_inmediata = (
                        f"✅ {accion['ticket_numero']} resuelto{sufijo}: {accion.get('titulo', '')}"
                    )
                elif not accion.get("ok"):
                    respuesta_inmediata = f"⚠️ {accion.get('error', 'Error desconocido')}"

            elif activar_ia:
                # Pregunta libre: Ollama en background
                def _responder_sede_sur(texto: str, sid: str, destino: str) -> None:
                    respuesta, _ = obtener_respuesta_ia(texto, sid, canal="sede_sur")
                    enviar_whatsapp_reporte(respuesta, numero_destino=destino)

                spawn_thread(
                    _responder_sede_sur,
                    args=(texto_agente, sender_id, remote_jid),
                    daemon=True,
                )

            return jsonify({"status": "ok", "respuesta": respuesta_inmediata})

        # --- Detección de Comprobantes de Pago ---
        is_payment_keyword_sin_img = _mensaje_sugiere_pago(message_text)

        if is_payment_keyword_sin_img:
            _marcar_contexto_pago(sender_id)

        if has_media and media_type == "image":
            tiene_contexto_pago = _tiene_contexto_pago_reciente(sender_id)
            ya_tiene_pago_pendiente = (
                sender_id in pagos_pendientes_confirmacion
                and not pagos_pendientes_confirmacion[sender_id].get("confirmado")
            )
            analisis_imagen = analizar_imagen_pago(
                media_path,
                mensaje=message_text,
                contexto_pago=(
                    is_payment_keyword_sin_img
                    or tiene_contexto_pago
                    or ya_tiene_pago_pendiente
                ),
            )
            parece_comprobante = (
                analisis_imagen.es_comprobante and analisis_imagen.confianza >= 0.55
            )

            # Si el texto actual dice explícitamente "comprobante" pero Gemini
            # falla, no perdemos el caso; para imágenes mudas se exige lectura visual.
            if (
                not parece_comprobante
                and is_payment_keyword_sin_img
                and analisis_imagen.error
            ):
                parece_comprobante = True

            if analisis_imagen.error:
                print(f"⚠️ Gemini Vision no pudo analizar imagen: {analisis_imagen.error}")
            else:
                print(
                    "👁️ Gemini Vision imagen WhatsApp: "
                    f"comprobante={analisis_imagen.es_comprobante} "
                    f"confianza={analisis_imagen.confianza:.2f}"
                )

            if not parece_comprobante and (
                tiene_contexto_pago or ya_tiene_pago_pendiente
            ):
                contexto_pago_clientes.pop(sender_id, None)

            if not parece_comprobante and not analisis_imagen.error:
                is_payment_keyword_sin_img = False
                message_text = _mensaje_imagen_para_ia(
                    message_text,
                    analisis_imagen,
                    media_path,
                )
            elif not parece_comprobante and not message_text:
                message_text = _mensaje_imagen_para_ia(
                    message_text,
                    analisis_imagen,
                    media_path,
                )

            if parece_comprobante:
                _marcar_contexto_pago(sender_id)
                borradores_aprobacion[sender_id] = {
                    "estado": "esperando_validacion_pago",
                    "ruta_imagen": media_path,
                    "analisis_imagen": analisis_imagen.__dict__,
                }

                codigo = _sufijo_pago(sender_id)
                num_corto = sender_id.replace("@c.us", "")[
                    -7:
                ]  # últimos 7 dígitos para mostrar
                mensaje_aprobacion = (
                    f"🔔 *ALERTA DE PAGO*\n"
                    f"Cliente *...{num_corto}* envió un comprobante de pago.\n"
                    f"Confianza Gemini: *{analisis_imagen.confianza:.0%}*\n\n"
                    f"✅ *Para CONFIRMAR:*\n"
                    f"   Escribe: *ok {codigo}*\n\n"
                    f"❌ *Para RECHAZAR:*\n"
                    f"   Escribe: *no {codigo}*\n\n"
                    f"📎 Comprobante: {media_path}"
                )
                resumen_pago = _resumen_analisis_pago(analisis_imagen)
                if resumen_pago:
                    mensaje_aprobacion += f"\n\n{resumen_pago}"

                pagos_pendientes_confirmacion[sender_id] = {
                    "timestamp": time.time(),
                    "mensaje": mensaje_aprobacion,
                    "confirmado": False,
                    "codigo": codigo,
                    "analisis_imagen": analisis_imagen.__dict__,
                }

                spawn_thread(
                    enviar_whatsapp_reporte, args=(mensaje_aprobacion, grupo_compras)
                )

                return jsonify(
                    {
                        "status": "waiting_for_payment_approval",
                        "respuesta": "Veci, recibí su comprobante. En un momento nuestro equipo de contabilidad lo verifica y le confirmamos. ¡Gracias por su compra!",
                    }
                )
        elif is_payment_keyword_sin_img and not has_media:
            return jsonify(
                {
                    "status": "missing_image",
                    "respuesta": "Veci, parece que el mensaje llegó sin la imagen adjunta. ¿Puede intentar enviarla de nuevo? 📎",
                }
            )

        # --- Flujo de Aprobación para Mensajes de Posventa ---
        if message_text.lower().startswith("hugo dale ok"):
            target_order_id = message_text.split()[-1]
            if target_order_id in borradores_aprobacion:
                message_to_send = borradores_aprobacion.pop(target_order_id)

                # Delegar el envío real a la función correspondiente.
                resultado_envio = responder_mensaje_posventa(
                    target_order_id, message_to_send
                )
                print(f"Resultado del envío a posventa: {resultado_envio}")

                return jsonify(
                    {
                        "status": "sent",
                        "respuesta": f"¡Listo! Mensaje enviado para la orden {target_order_id}.",
                    }
                )
            else:
                return jsonify(
                    {
                        "status": "error",
                        "respuesta": f"No encontré un borrador pendiente de aprobación para la orden '{target_order_id}'.",
                    }
                )

        # --- Control para Evitar Duplicados ---
        if is_after_sale and order_id in borradores_aprobacion:
            return jsonify(
                {
                    "status": "already_waiting",
                    "respuesta": f"Ya existe una respuesta pendiente de aprobación para la orden {order_id}.",
                }
            )

        # --- Escalación al Grupo ---
        keywords_escalacion = [
            "quiero hablar con una persona",
            "hablar con alguien",
            "asesor",
            "agente humano",
            "devolución",
            "reclamo",
            "garantía",
            "descuento",
            "precio especial",
            "más barato",
            "mas barato",
        ]
        if any(keyword in message_text.lower() for keyword in keywords_escalacion):
            mensaje_aprobacion = (
                f"❓ CONSULTA IA - Cliente {sender_id} preguntó: {message_text}\n"
                f"Responder con: 'resp {sender_id}: {{respuesta}}'"
            )
            enviar_whatsapp_reporte(
                mensaje_aprobacion, numero_destino=grupo_contabilidad
            )
            return jsonify(
                {
                    "status": "escalated",
                    "respuesta": "Veci, déjame consultar esa información con mi equipo y le confirmo en un momento 🙏",
                }
            )

        # --- Procesamiento del Mensaje por la IA ---
        respuesta_ia, _ = obtener_respuesta_ia(
            message_text, sender_id, canal="whatsapp"
        )
        respuesta_ia = _normalizar_respuesta_cliente(respuesta_ia)

        incertidumbre_ia = ["no tengo información", "no puedo", "no estoy seguro"]
        if any(frase in respuesta_ia.lower() for frase in incertidumbre_ia):
            mensaje_aprobacion = (
                f"❓ CONSULTA IA - Cliente {sender_id} preguntó: {message_text}\n"
                f"Responder con: 'resp {sender_id}: {{respuesta}}'"
            )
            enviar_whatsapp_reporte(
                mensaje_aprobacion, numero_destino=grupo_contabilidad
            )
            return jsonify(
                {
                    "status": "escalated",
                    "respuesta": "Veci, déjame consultar esa información con mi equipo y le confirmo en un momento 🙏",
                }
            )

        # --- Gestión de la Respuesta ---
        if is_after_sale:
            # Si es posventa, no respondemos de inmediato. Guardamos como borrador.
            borradores_aprobacion[order_id] = respuesta_ia

            # Notificar al canal de control para que un humano apruebe.
            mensaje_aprobacion = (
                f"🔔 *RESPUESTA PENDIENTE DE APROBACIÓN*\n"
                f"📦 Orden: `{order_id}`\n"
                f"🤖 Mensaje propuesto: _{respuesta_ia}_\n\n"
                f"Para enviar, responde al bot: `hugo dale ok {order_id}`"
            )
            enviar_whatsapp_reporte(mensaje_aprobacion, numero_destino=grupo_posventa)

            return jsonify(
                {
                    "status": "waiting_for_approval",
                    "respuesta": "La respuesta del agente ha sido generada y está pendiente de aprobación.",
                }
            )
        else:
            # Historial salida del bot: lo registra el bridge al enviar (wa_id único).
            return jsonify({"status": "success", "respuesta": respuesta_ia})

    @app.route("/status", methods=["GET"])
    def status():
        import os
        from datetime import datetime

        from app.observability import get_request_id

        return jsonify(
            {
                "estado": "activo",
                "timestamp": datetime.now().isoformat(),
                "request_id": get_request_id(),
                "servicios": {
                    "mercadolibre": os.path.exists("credenciales_meli.json"),
                    "google": os.path.exists("credenciales_google.json"),
                    "siigo": os.path.exists("credenciales_SIIGO.json"),
                },
                "version": "1.0.0",
            }
        )

    @app.route("/chat", methods=["POST"])
    def chat():
        import os
        from datetime import datetime
        from app.web_chat_activity import record_interaction

        if not chat_api_token_matches_request():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON requerido"}), 400
        mensaje = (data.get("mensaje") or "").strip()
        adjuntos = data.get("adjuntos") or data.get("attachments")
        if not mensaje and not adjuntos:
            return jsonify({"error": "Campo 'mensaje' o adjuntos requerido"}), 400
        log_json(
            "http_chat",
            session_preview=str(
                (data.get("session_id") or data.get("usuario_id") or "")[:40]
            ),
        )
        session_id = (data.get("session_id") or data.get("usuario_id") or "").strip()
        origen = (data.get("origen") or "").strip().lower()
        page_url = (data.get("page_url") or "").strip()
        es_web_chat = origen == "web_chat" or session_id.startswith("web-")
        if not session_id:
            return (
                jsonify(
                    {
                        "error": "Campo 'session_id' (o 'usuario_id') requerido para aislar el historial del chat.",
                        "status": "error",
                    }
                ),
                400,
            )
        try:
            respuesta, _ = obtener_respuesta_ia(
                mensaje,
                session_id,
                adjuntos_payload=adjuntos,
                canal="web_chat" if es_web_chat else "",
                page_url=page_url,
            )
            if es_web_chat and respuesta:
                try:
                    record_interaction(
                        session_id=session_id,
                        user_message=mensaje,
                        agent_reply=respuesta,
                        attachments_count=len(adjuntos) if isinstance(adjuntos, list) else 0,
                        source="agent",
                        page_url=page_url,
                        user_agent=(data.get("user_agent") or request.headers.get("User-Agent", "")),
                    )
                except Exception:
                    pass
            return jsonify(
                {
                    "respuesta": respuesta,
                    "timestamp": datetime.now().isoformat(),
                    "status": "ok",
                    "source": "agent",
                }
            )
        except Exception as e:
            spawn_thread(
                manejar_incidente_autocorreccion,
                kwargs={
                    "error": f"/chat exception: {e}",
                    "contexto": f"session_id={session_id} mensaje={(mensaje or '')[:400]}",
                    "origen": "routes_chat",
                },
                daemon=True,
            )
            return jsonify({"error": str(e), "status": "error"}), 500

    @app.route("/panel")
    def panel():
        import json as _json
        from app.services.meli_preventa import obtener_preguntas_pendientes

        # Métricas del día
        metricas = {}
        try:
            with open("app/data/metricas_diarias.json") as f:
                metricas = _json.load(f)
        except Exception:
            pass

        # Preguntas preventa pendientes
        preguntas = []
        try:
            preguntas = [
                p for p in obtener_preguntas_pendientes() if not p.get("respondida")
            ]
        except Exception:
            pass

        # Casos IA aprendidos
        casos_ia = 0
        try:
            with open("app/training/casos_preventa.json") as f:
                casos_ia = len(_json.load(f).get("casos", []))
        except Exception:
            pass

        # Tasa automatización preventa (respondidas automáticamente vs total)
        tasa_preventa = 0
        try:
            with open(PENDIENTES_PATH) as f:
                todas = _json.load(f).get("preguntas", [])
            respondidas_auto = sum(
                1
                for p in todas
                if p.get("respondida") and not p.get("respuesta_humana")
            )
            total_preg = len(todas)
            tasa_preventa = (
                round((respondidas_auto / total_preg) * 100) if total_preg > 0 else 0
            )
        except Exception:
            pass

        integraciones = [
            ("Gemini 2.5-Pro", "🤖", "Motor IA conversacional"),
            ("MercadoLibre", "🛒", "Preventa · Posventa · Stock"),
            ("SIIGO ERP", "📊", "Facturación electrónica DIAN"),
            ("Google Sheets", "📋", "Catálogo y fichas técnicas"),
            ("Gmail API", "📧", "Facturas de proveedores"),
            ("WhatsApp WA", "💬", "Evolution API · Node.js"),
            ("Cloudflare", "☁️", "Túnel HTTPS seguro"),
        ]

        return render_template(
            "panel.html",
            metricas=metricas,
            preguntas_pendientes=preguntas,
            casos_ia=casos_ia,
            tasa_preventa=tasa_preventa,
            uptime="99.8%",
            integraciones=integraciones,
            facturas=[],
            log_actividad=[],
        )

    @app.route("/api/metricas")
    def api_metricas():
        import json as _json

        try:
            with open("app/data/metricas_diarias.json") as f:
                data = _json.load(f)
            # Verificar token MeLi
            try:
                from app.utils import refrescar_token_meli

                data["token_meli"] = bool(refrescar_token_meli())
            except Exception:
                data["token_meli"] = False
            try:
                from app.web_chat_activity import get_summary as _get_web_chat_summary

                web_chat_summary = _get_web_chat_summary()
                data["web_chat_interacciones_hoy"] = web_chat_summary.get("today_interactions", 0)
                data["web_chat_sin_revisar"] = web_chat_summary.get("unreviewed_count", 0)
                data["web_chat_activas_24h"] = web_chat_summary.get("active_last_24h", 0)
            except Exception:
                data["web_chat_interacciones_hoy"] = 0
                data["web_chat_sin_revisar"] = 0
                data["web_chat_activas_24h"] = 0
            return jsonify(data)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/responder-preventa", methods=["POST"])
    def api_responder_preventa():
        data = request.get_json()
        question_id = str(data.get("question_id", ""))
        respuesta = data.get("respuesta", "").strip()
        if not question_id or not respuesta:
            return jsonify({"ok": False, "error": "Faltan campos"}), 400
        spawn_thread(
            _procesar_respuesta_preventa,
            args=(question_id, respuesta),
            daemon=True,
        )
        return jsonify({"ok": True})

    # ── Guías de productos (HTML standalone, sin wrapper del tema) ────────────
    _GUIAS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "PAGINA_WEB")

    @app.route("/guia/<nombre_guia>")
    def servir_guia(nombre_guia):
        """
        Sirve archivos HTML de guías de productos desde PAGINA_WEB/.
        URL: /guia/kit-acidos  → PAGINA_WEB/guia-kit-acidos.html
        """
        from flask import abort

        import re as _re

        if not _re.match(r"^[a-zA-Z0-9\-]+$", nombre_guia):
            abort(404)
        nombre_archivo = f"guia-{nombre_guia}.html"
        ruta_completa = os.path.join(_GUIAS_DIR, nombre_archivo)
        if not os.path.isfile(ruta_completa):
            abort(404)
        return send_from_directory(_GUIAS_DIR, nombre_archivo)

    # ══════════════════════════════════════════════════════════════════════════
    #  CORS middleware (manual) — permits requests from Vite dev & Tauri
    # ══════════════════════════════════════════════════════════════════════════
    _CORS_ORIGINS = {
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "https://tauri.localhost",
    }

    @app.after_request
    def _cors_headers(response):
        origin = request.headers.get("Origin", "")
        if origin in _CORS_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

    @app.before_request
    def _cors_preflight():
        """Preflight CORS sin registrar OPTIONS en cada URL (evita 405 en rutas nuevas)."""
        if request.method != "OPTIONS" or not request.path.startswith("/api/"):
            return None
        origin = request.headers.get("Origin", "")
        if origin not in _CORS_ORIGINS:
            return None
        resp = make_response("", 204)
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    # ══════════════════════════════════════════════════════════════════════════
    #  API endpoints — unified on :8081 for React SPA
    # ══════════════════════════════════════════════════════════════════════════

    def _api_token_valido():
        if chat_api_token_matches_request():
            return True
        # Acepta también el JWT de sesión de tickets (operadores con login Google)
        try:
            from app.services.tickets_db import get_usuario_by_token as _gut
            from app.api_auth import bearer_token_from_request as _btr
            tok = _btr()
            if tok:
                return _gut(tok) is not None
        except Exception:
            pass
        return False

    def _panel_tickets_usuario():
        """Usuario de tickets asociado al Bearer (None si solo CHAT_API_TOKEN)."""
        if chat_api_token_matches_request():
            return None
        try:
            from app.services.tickets_db import get_usuario_by_token as _gut
            from app.api_auth import bearer_token_from_request as _btr

            tok = _btr()
            if tok:
                return _gut(tok)
        except Exception:
            pass
        return None

    def _api_lanzar_en_hilo(fn, *args, job: str | None = None):
        """Ejecuta fn(*args) en hilo daemon y registra resultado en panel_activity."""
        from app.panel_activity import run_logged_job

        label = job or getattr(fn, "__name__", "job")

        def _wrapped():
            run_logged_job(label, fn, args)

        spawn_thread(_wrapped, daemon=True)

    # -- Sync imports (same as webhook_meli.py) --
    from app.sync import (
        sincronizar_inteligente as _sync_inteligente,
        sincronizar_facturas_recientes as _sync_facturas_recientes,
        ejecutar_sincronizacion_y_reporte_stock as _sync_stock_reporte,
        sincronizar_manual_por_id as _sync_manual_id,
        sincronizar_por_dia_especifico as _sync_por_dia,
    )
    from app.services.google_services import leer_datos_hoja as _leer_hoja
    from app.services.meli import aprender_de_interacciones_meli as _aprender_meli

    @app.route("/api/status")
    def api_status():
        from app.observability import get_request_id
        return jsonify({
            "estado": "activo",
            "timestamp": _dt.now().isoformat(),
            "request_id": get_request_id(),
            "servicios": {
                "mercadolibre": os.path.exists("credenciales_meli.json"),
                "google": os.path.exists("credenciales_google.json"),
                "siigo": os.path.exists("credenciales_SIIGO.json"),
            },
            "version": "2.0.0",
        })

    @app.route("/api/autocorrect/status")
    def api_autocorrect_status():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        return jsonify(estado_autocorrector())

    @app.route("/api/preventa/pendientes")
    def api_preventa_pendientes():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            with open(PENDIENTES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            pendientes = [
                p for p in data.get("preguntas", []) if not p.get("respondida")
            ]
            return jsonify({"preguntas": pendientes, "total": len(pendientes)})
        except FileNotFoundError:
            return jsonify({"preguntas": [], "total": 0})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/preventa/casos")
    def api_preventa_casos():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            ruta = os.path.join(_ROUTES_DIR, "..", "app", "training", "casos_preventa.json")
            ruta_abs = os.path.join(os.path.dirname(_ROUTES_DIR), "training", "casos_preventa.json")
            with open(ruta_abs, "r", encoding="utf-8") as f:
                data = json.load(f)
            casos = data.get("casos", [])
            return jsonify({"casos": casos[-50:], "total": len(casos)})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/postventa/pendientes")
    def api_postventa_pendientes():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        mensajes = _listar_postventa_pendientes_api()
        return jsonify({"mensajes": mensajes, "total": len(mensajes)})

    @app.route("/api/responder-postventa", methods=["POST"])
    def api_responder_postventa():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(silent=True) or {}
        codigo = str(data.get("codigo") or data.get("pack_id") or "").strip()
        respuesta = str(data.get("respuesta") or "").strip()
        if not codigo or not respuesta:
            return jsonify({"ok": False, "error": "Faltan campos"}), 400
        resultado = _ejecutar_respuesta_postventa(
            codigo,
            respuesta,
            notificar_grupo=True,
        )
        return jsonify(resultado)

    @app.route("/api/sync/hoy", methods=["POST"])
    def api_sync_hoy():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_facturas_recientes, 1, job="sync_facturas_1d")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync ultimo dia iniciado en segundo plano.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/10dias", methods=["POST"])
    def api_sync_10dias():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_facturas_recientes, 10, job="sync_facturas_10d")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync ultimos 10 dias iniciado en segundo plano.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/completo", methods=["POST"])
    def api_sync_completo():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_stock_reporte, job="sync_completo_reporte_stock")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync completo + reporte de stock iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/inteligente", methods=["POST"])
    def api_sync_inteligente():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_inteligente, job="sync_inteligente")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync inteligente (MeLi vs Siigo) iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/pack", methods=["POST"])
    def api_sync_pack():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json() or {}
        pack_id = str(data.get("pack_id", "")).strip()
        if not pack_id:
            return jsonify({"error": "Campo 'pack_id' requerido"}), 400
        _api_lanzar_en_hilo(_sync_manual_id, pack_id, job=f"sync_pack_{pack_id}")
        return jsonify({
            "status": "iniciado",
            "mensaje": f"Sync por Pack ID {pack_id} iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/fecha", methods=["POST"])
    def api_sync_fecha():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json() or {}
        fecha = str(data.get("fecha", "")).strip()
        if not fecha:
            return jsonify({"error": "Campo 'fecha' requerido (AAAA-MM-DD)"}), 400
        _api_lanzar_en_hilo(_sync_por_dia, fecha, job=f"sync_fecha_{fecha}")
        return jsonify({
            "status": "iniciado",
            "mensaje": f"Sync por fecha {fecha} iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/stock", methods=["POST"])
    def api_sync_stock():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_stock_reporte, job="reporte_stock_whatsapp")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Reporte de stock iniciado. Revisa Actividad del servidor y WhatsApp grupo inventario.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/aprendizaje", methods=["POST"])
    def api_sync_aprendizaje():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_aprender_meli, job="aprendizaje_meli")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Aprendizaje IA iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/gmail", methods=["POST"])
    def api_sync_gmail():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.tools.importar_productos_siigo import procesar_facturas_para_importar_productos
            from app.tools.sincronizar_facturas_de_compra_siigo import sincronizar_facturas_de_compra_siigo
            body = request.get_json(silent=True) or {}
            solo_nit = body.get("nit")
            if solo_nit:
                sn = str(solo_nit).strip()
                _api_lanzar_en_hilo(
                    sincronizar_facturas_de_compra_siigo,
                    sn,
                    job=f"gmail_compra_nit_{sn}",
                )
            else:
                _api_lanzar_en_hilo(
                    procesar_facturas_para_importar_productos,
                    job="gmail_importar_xml",
                )
            return jsonify({
                "status": "iniciado",
                "mensaje": "Escaneo facturas de compra Gmail iniciado.",
                "timestamp": _dt.now().isoformat(),
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/sync/stop", methods=["POST"])
    def api_sync_stop():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.panel_activity import cancel_active_job, get_active_job
        job = get_active_job()
        if not job:
            return jsonify({"status": "idle", "mensaje": "No hay ningún job en ejecución."})
        mensaje = cancel_active_job()
        return jsonify({
            "status": "cancelado",
            "job": job.get("name"),
            "mensaje": mensaje,
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/skus-meli", methods=["POST"])
    def api_sync_skus_meli():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.sync_skus import sincronizar_skus_meli_sheets
        _api_lanzar_en_hilo(sincronizar_skus_meli_sheets, job="sync_skus_meli_sheets")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sincronización de SKUs MeLi → Sheets iniciada en segundo plano.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/reporte-skus-pendientes", methods=["POST"])
    def api_reporte_skus_pendientes():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.sync_skus import reporte_skus_pendientes_wa
        _api_lanzar_en_hilo(reporte_skus_pendientes_wa, job="reporte_skus_pendientes_wa")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Generando reporte de SKUs pendientes. Se enviará a Sincronizacion_Inventario.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/consultar/producto")
    def api_consultar_producto():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        nombre = request.args.get("nombre", "").strip()
        if not nombre:
            return jsonify({"error": "Parametro 'nombre' requerido"}), 400
        try:
            from app.panel_activity import log_line

            log_line(f"HTTP consultar_producto: {nombre[:120]!r}")
            resultado = _leer_hoja(nombre)
            if isinstance(resultado, str) and resultado.strip().startswith("❌"):
                log_line(f"✖ consultar_producto: {resultado[:600]}")
            else:
                log_line("✔ consultar_producto: consulta Sheets OK")
            return jsonify({"status": "ok", "resultado": resultado})
        except Exception as e:
            from app.panel_activity import log_line

            log_line(f"✖ consultar_producto excepción: {e!r}")
            return jsonify({"error": str(e)}), 500

    @app.route("/api/panel/logs", methods=["GET", "DELETE"])
    def api_panel_logs():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.panel_activity import clear_lines, get_lines_with_count

        if request.method == "DELETE":
            clear_lines()
            return jsonify({"ok": True})
        limit = request.args.get("limit", default=300, type=int) or 300
        lines, count = get_lines_with_count(limit)
        return jsonify({"lines": lines, "count": count})

    # ── Fichas técnicas (generación DOCX/PDF + Drive) ─────────────────────────

    @app.route("/api/fichas/config", methods=["GET"])
    def api_fichas_config():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.ficha_tecnica import configuracion_drive, PLANTILLA_DEFAULT

        cfg = configuracion_drive()
        cfg["plantilla_ok"] = PLANTILLA_DEFAULT.is_file()
        cfg["plantilla"] = str(PLANTILLA_DEFAULT)
        return jsonify(cfg)

    @app.route("/api/fichas/datos", methods=["GET"])
    def api_fichas_datos_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.ficha_tecnica import listar_yaml_datos

        return jsonify({"items": listar_yaml_datos()})

    @app.route("/api/fichas/datos/<slug>", methods=["GET"])
    def api_fichas_datos_get(slug: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.ficha_tecnica import DATOS_DIR, cargar_datos_desde_archivo
        import yaml

        slug_safe = re.sub(r"[^a-zA-Z0-9_-]", "", slug)
        for ext in (".yaml", ".yml"):
            path = DATOS_DIR / f"{slug_safe}{ext}"
            if path.is_file():
                datos = cargar_datos_desde_archivo(path)
                return jsonify({
                    "id": slug_safe,
                    "archivo": path.name,
                    "datos": datos,
                    "yaml": yaml.dump(datos, allow_unicode=True, sort_keys=False),
                })
        return jsonify({"error": "No encontrado"}), 404

    @app.route("/api/fichas/plantilla", methods=["GET"])
    def api_fichas_plantilla():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.ficha_tecnica import plantilla_datos_ejemplo
        import yaml

        datos = plantilla_datos_ejemplo()
        return jsonify({
            "datos": datos,
            "yaml": yaml.dump(datos, allow_unicode=True, sort_keys=False),
        })

    @app.route("/api/fichas/generar", methods=["POST"])
    def api_fichas_generar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import yaml as _yaml

        body = request.get_json(silent=True) or {}
        datos = body.get("datos")
        yaml_raw = body.get("yaml")
        if yaml_raw and isinstance(yaml_raw, str):
            try:
                datos = _yaml.safe_load(yaml_raw) or {}
            except Exception as exc:
                return jsonify({"error": f"YAML inválido: {exc}"}), 400
        if not isinstance(datos, dict) or not (datos.get("titulo") or "").strip():
            return jsonify({"error": "Se requiere 'datos' o 'yaml' con al menos 'titulo'"}), 400
        generar_pdf = bool(body.get("generar_pdf", True))
        subir_drive = bool(body.get("subir_drive", False))
        guardar_yaml = body.get("guardar_yaml")
        slug_yaml = body.get("slug_yaml")
        try:
            from app.panel_activity import log_line
            from app.services.ficha_tecnica import generar_desde_datos

            titulo = (datos.get("titulo") or "").strip()
            log_line(f"HTTP fichas/generar: {titulo[:80]!r} pdf={generar_pdf} drive={subir_drive}")
            resultado = generar_desde_datos(
                datos,
                generar_pdf=generar_pdf,
                subir_drive=subir_drive,
                guardar_yaml=slug_yaml if guardar_yaml else None,
            )
            log_line(f"✔ ficha generada: {resultado.get('docx_nombre')}")
            return jsonify(resultado)
        except Exception as e:
            from app.panel_activity import log_line

            log_line(f"✖ fichas/generar: {e!r}")
            return jsonify({"error": str(e)}), 500

    @app.route("/api/fichas/descargar")
    def api_fichas_descargar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.ficha_tecnica import ruta_descarga_segura

        nombre = request.args.get("archivo", "").strip()
        path = ruta_descarga_segura(nombre)
        if not path:
            return jsonify({"error": "Archivo no permitido"}), 404
        from flask import send_file

        return send_file(path, as_attachment=True, download_name=path.name)

    @app.route("/api/web-chat")
    def api_web_chat():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.web_chat_activity import get_panel_payload

            limit = request.args.get("limit", default=40, type=int) or 40
            only_unreviewed = request.args.get("only_unreviewed", default=0, type=int) == 1
            payload = get_panel_payload(limit=limit, only_unreviewed=only_unreviewed)
            try:
                from app.services.web_chat_notify import get_web_chat_notify_state

                payload["notify_to_group"] = get_web_chat_notify_state()
            except Exception:
                payload["notify_to_group"] = {"enabled": True, "source": "unknown"}
            return jsonify(payload)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/web-chat/notify", methods=["GET", "POST"])
    def api_web_chat_notify():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.services.web_chat_notify import (
                get_web_chat_notify_state,
                set_web_chat_notify_enabled,
            )

            if request.method == "GET":
                return jsonify(get_web_chat_notify_state())

            body = request.get_json(silent=True) or {}
            enabled_raw = body.get("enabled")
            enabled = str(enabled_raw).strip().lower() in ("1", "true", "yes", "on")
            return jsonify(set_web_chat_notify_enabled(enabled=enabled, updated_by="panel"))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/web-chat/<session_id>/review", methods=["POST"])
    def api_web_chat_review(session_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.web_chat_activity import get_summary, mark_session_reviewed

            changed = mark_session_reviewed(session_id)
            return jsonify({"ok": True, "changed": changed, "summary": get_summary()})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/web-chat/review-all", methods=["POST"])
    def api_web_chat_review_all():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.web_chat_activity import get_summary, mark_all_reviewed

            reviewed = mark_all_reviewed()
            return jsonify({"ok": True, "reviewed": reviewed, "summary": get_summary()})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/web-chat/respuestas-rapidas", methods=["GET"])
    def api_web_chat_respuestas_rapidas_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.web_chat_respuestas_rapidas import listar_para_usuario

        u = _panel_tickets_usuario()
        uid = int(u["id"]) if u else None
        payload = listar_para_usuario(uid)
        return jsonify({**payload, "usuario_id": uid})

    @app.route("/api/web-chat/respuestas-rapidas", methods=["POST"])
    def api_web_chat_respuestas_rapidas_post():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.web_chat_respuestas_rapidas import agregar

        body = request.get_json(silent=True) or {}
        u = _panel_tickets_usuario()
        uid = int(u["id"]) if u else None
        nivel = int((u.get("rol") or {}).get("nivel") or 0) if u else 0
        scope = str(body.get("scope") or "mine").strip().lower()
        if scope == "global" and nivel < 3:
            return jsonify({"error": "Solo administradores pueden crear respuestas globales"}), 403
        item, err = agregar(
            usuario_id=uid,
            texto=str(body.get("texto") or ""),
            titulo=str(body.get("titulo") or ""),
            scope=scope,
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True, "item": item})

    @app.route("/api/web-chat/respuestas-rapidas/<item_id>", methods=["DELETE"])
    def api_web_chat_respuestas_rapidas_delete(item_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.web_chat_respuestas_rapidas import eliminar

        u = _panel_tickets_usuario()
        uid = int(u["id"]) if u else None
        nivel = int((u.get("rol") or {}).get("nivel") or 0) if u else 0
        scope = str(request.args.get("scope") or "mine").strip().lower()
        ok, err = eliminar(
            item_id=item_id,
            usuario_id=uid,
            scope=scope,
            es_admin=nivel >= 3 or chat_api_token_matches_request(),
        )
        if err:
            return jsonify({"error": err}), 400 if "Solo" in err or "Sesión" in err else 404
        return jsonify({"ok": ok})

    # ── Facturas de compra (clasificación desde panel) ─────────────────────

    @app.route("/api/facturas/pendientes", methods=["GET"])
    def api_facturas_pendientes():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            facturas_path = os.path.join(_ROUTES_DIR, "data", "facturas_compra_pendientes.json")
            with open(facturas_path, encoding="utf-8") as _f:
                state = json.load(_f)
            pendientes = state.get("pendientes", {})
            items = []
            for sufijo, e in pendientes.items():
                items.append({
                    "sufijo": sufijo,
                    "numero_factura": e.get("numero_factura", ""),
                    "proveedor": e.get("proveedor", ""),
                    "nit": e.get("nit", ""),
                    "es_nuevo_proveedor": e.get("es_nuevo_proveedor", False),
                    "items_count": e.get("items_count", 0),
                    "total": e.get("total", 0),
                    "estado": e.get("estado", ""),
                })
            return jsonify({"pendientes": items, "total": len(items)})
        except FileNotFoundError:
            return jsonify({"pendientes": [], "total": 0})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/facturas/clasificar", methods=["POST"])
    def api_facturas_clasificar():
        """Acción rápida: solo gasto o skip (sin revisión de ítems)."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.tools.importar_productos_siigo import procesar_respuesta_factura_compra
            from app.panel_activity import log_line
            body = request.get_json(silent=True) or {}
            cmd = body.get("cmd", "").strip().lower()
            sufijo = body.get("sufijo", "").strip().upper()
            if not cmd or not sufijo:
                return jsonify({"error": "Parámetros 'cmd' y 'sufijo' requeridos"}), 400
            if cmd not in ("skip", "gasto"):
                return jsonify({"error": "cmd debe ser: gasto | skip  (inventario usa /procesar)"}), 400
            log_line(f"▶ clasificar_factura {sufijo} → {cmd}")
            resultado = procesar_respuesta_factura_compra(cmd, sufijo)
            icon = "✔" if any(c in resultado for c in ("✅", "⏭️")) else "⚠️"
            log_line(f"{icon} {resultado[:300]}")
            return jsonify({"ok": True, "mensaje": resultado})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/facturas/<sufijo>/detalle", methods=["GET"])
    def api_factura_detalle(sufijo):
        """Retorna la factura con todos los ítems computados (código McKenna, unidades, precios)."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.tools.importar_productos_siigo import obtener_detalle_factura
            from app.panel_activity import log_line
            log_line(f"▶ detalle_factura {sufijo.upper()}")
            detalle = obtener_detalle_factura(sufijo.upper())
            if detalle is None:
                return jsonify({"error": f"Factura {sufijo} no encontrada"}), 404
            log_line(f"✔ detalle_factura {sufijo.upper()} — {len(detalle.get('items', []))} ítems")
            return jsonify(detalle)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/facturas/codigo/check", methods=["POST"])
    def api_factura_codigo_check():
        """Valida un código SIIGO manual y retorna si ya existe."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.tools.importar_productos_siigo import revisar_codigo_producto_siigo
            body = request.get_json(silent=True) or {}
            codigo = str(body.get("codigo", "")).strip()
            if not codigo:
                return jsonify({"error": "Parámetro 'codigo' requerido"}), 400
            return jsonify(revisar_codigo_producto_siigo(codigo))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/facturas/<sufijo>/procesar", methods=["POST"])
    def api_factura_procesar(sufijo):
        """Procesa ítems seleccionados como inventario: genera Excel + XML, envía reporte WA."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.tools.importar_productos_siigo import (
                procesar_items_inventario,
                cargar_proveedores_especiales,
            )
            from app.panel_activity import log_line, run_logged_job
            body = request.get_json(silent=True) or {}
            indices = body.get("indices", [])
            codigos_manual = body.get("codigos_manual", {})
            agregar_proveedor = body.get("agregar_proveedor", False)
            if not isinstance(indices, list):
                return jsonify({"error": "'indices' debe ser una lista"}), 400
            if not isinstance(codigos_manual, dict):
                return jsonify({"error": "'codigos_manual' debe ser un objeto"}), 400

            # Si el usuario marcó que quiere agregar el proveedor a la lista especial
            if agregar_proveedor:
                from app.tools.importar_productos_siigo import (
                    obtener_detalle_factura,
                    _RUTA_PROVEEDORES,
                )
                detalle_tmp = obtener_detalle_factura(sufijo.upper())
                if detalle_tmp:
                    nit = re.sub(r'\D', '', detalle_tmp.get('nit') or '')
                    proveedor = detalle_tmp.get('proveedor', '')
                    data_prov = cargar_proveedores_especiales()
                    ya_existe = any(
                        re.sub(r'\D', '', p.get('nit', '')) == nit
                        for p in data_prov.get('proveedores', [])
                        if nit
                    )
                    if not ya_existe and nit:
                        data_prov['proveedores'].append({
                            'nit':    detalle_tmp.get('nit', ''),
                            'nombre': proveedor,
                            'activo': True,
                            'nota':   f'Agregado desde el panel el {_dt.now().strftime("%Y-%m-%d")}',
                        })
                        with open(_RUTA_PROVEEDORES, 'w', encoding='utf-8') as _f:
                            json.dump(data_prov, _f, indent=2, ensure_ascii=False)
                        log_line(f"📋 Proveedor agregado: {proveedor} ({nit})")

            log_line(f"▶ procesar_inventario {sufijo.upper()} — {len(indices)} ítems seleccionados")

            def _job():
                return procesar_items_inventario(sufijo.upper(), indices, codigos_manual)

            resultado = None
            import threading as _thr
            ev = _thr.Event()
            res_holder = {}

            def _run():
                try:
                    res_holder['r'] = procesar_items_inventario(sufijo.upper(), indices, codigos_manual)
                except Exception as ex:
                    res_holder['r'] = {'ok': False, 'error': str(ex)}
                finally:
                    ev.set()

            _thr.Thread(target=_run, daemon=True).start()
            ev.wait(timeout=120)
            resultado = res_holder.get('r', {'ok': False, 'error': 'timeout'})

            if resultado.get('ok'):
                log_line(f"✔ inventario {sufijo.upper()} — {resultado.get('nuevos',0)} nuevos, {resultado.get('duplicados',0)} duplicados")
            else:
                log_line(f"✖ inventario {sufijo.upper()} — {resultado.get('error','')}")
            return jsonify(resultado)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Pedidos tienda web ──────────────────────────────────────────────────

    @app.route("/api/pedidos/web")
    def api_pedidos_web():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import sqlite3 as _sqlite3
        db_path = os.path.join(_ROUTES_DIR, "..", "PAGINA_WEB", "site", "data", "orders.db")
        db_path = os.path.normpath(db_path)
        if not os.path.exists(db_path):
            return jsonify({"orders": [], "total": 0, "page": 1, "per_page": 50})
        search = (request.args.get("q") or "").strip()
        status_filter = (request.args.get("status") or "").strip()
        page = max(1, int(request.args.get("page", 1) or 1))
        per_page = 50
        try:
            con = _sqlite3.connect(db_path)
            con.row_factory = _sqlite3.Row
            where, params = ["1=1"], []
            if search:
                where.append(
                    "(lower(reference) LIKE ? OR lower(buyer_email) LIKE ? OR lower(buyer_name) LIKE ?)"
                )
                s = f"%{search.lower()}%"
                params += [s, s, s]
            if status_filter:
                where.append("status = ?")
                params.append(status_filter)
            w = " AND ".join(where)
            total = con.execute(f"SELECT COUNT(*) FROM orders WHERE {w}", params).fetchone()[0]
            offset = (page - 1) * per_page
            rows = con.execute(
                f"SELECT * FROM orders WHERE {w} ORDER BY id DESC LIMIT ? OFFSET ?",
                params + [per_page, offset],
            ).fetchall()
            orders = []
            for row in rows:
                d = dict(row)
                try:
                    raw = json.loads(d.get("items_json") or "{}")
                    if isinstance(raw, dict):
                        d["items"] = raw.get("items", [])
                        d["shipping_cost"] = raw.get("shipping", 0)
                        d["buyer_address"] = raw.get("address", "")
                        d["buyer_dept"] = raw.get("dept", "")
                        d["buyer_notes"] = raw.get("notes", "")
                        d["billing"] = raw.get("billing", {})
                        d["buyer_cedula"] = raw.get("cedula", "")
                    elif isinstance(raw, list):
                        d["items"] = raw
                    else:
                        d["items"] = []
                except Exception:
                    d["items"] = []
                del d["items_json"]
                orders.append(d)
            con.close()
            return jsonify({"orders": orders, "total": total, "page": page, "per_page": per_page})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/app/api/pedidos/web/facturar", methods=["POST"])
    @app.route("/api/pedidos/web/facturar", methods=["POST"])
    def api_pedidos_web_facturar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        reference = (body.get("reference") or body.get("ref") or "").strip().upper()
        if not reference:
            return jsonify({"ok": False, "message": "Falta la referencia del pedido."}), 400
        try:
            from app.tools.web_pedidos import marcar_solicitud_facturacion

            ok, message = marcar_solicitud_facturacion(reference)
            payload = {"ok": ok, "message": message, "reference": reference}
            if not ok:
                payload["error"] = message
            return jsonify(payload), (200 if ok else 400)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e), "message": str(e)}), 500

    @app.route("/api/pedidos/web/stats")
    def api_pedidos_web_stats():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import sqlite3 as _sqlite3
        db_path = os.path.normpath(
            os.path.join(_ROUTES_DIR, "..", "PAGINA_WEB", "site", "data", "orders.db")
        )
        if not os.path.exists(db_path):
            return jsonify({"total": 0, "by_status": {}, "by_shipping": {}})
        try:
            con = _sqlite3.connect(db_path)
            con.row_factory = _sqlite3.Row
            by_status = {
                r["status"]: r["c"]
                for r in con.execute(
                    "SELECT status, COUNT(*) as c FROM orders GROUP BY status"
                ).fetchall()
            }
            by_ship = {
                r["shipping_status"]: r["c"]
                for r in con.execute(
                    "SELECT shipping_status, COUNT(*) as c FROM orders GROUP BY shipping_status"
                ).fetchall()
            }
            total = sum(by_status.values())
            con.close()
            return jsonify({"total": total, "by_status": by_status, "by_shipping": by_ship})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Sistema: servicios y repositorio ───────────────────────────────────

    _SERVICIOS = {
        "agente-pro":              "Agente Pro (Flask :8081)",
        "webhook-meli":            "Webhook MeLi (Flask :8080)",
        "mckenna-whatsapp-bridge": "Puente WhatsApp (Node :3000)",
        "admin-panel":             "Panel Admin",
    }

    @app.route("/api/sistema/servicios")
    def api_sistema_servicios():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import subprocess as _sp
        resultado = []
        for name, label in _SERVICIOS.items():
            try:
                r = _sp.run(
                    ["systemctl", "is-active", name],
                    capture_output=True, text=True, timeout=5,
                )
                estado = r.stdout.strip()
            except Exception:
                estado = "unknown"
            resultado.append({"id": name, "label": label, "estado": estado})
        return jsonify({"servicios": resultado})

    @app.route("/api/sistema/reiniciar", methods=["POST"])
    def api_sistema_reiniciar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        servicio = str(body.get("servicio", "")).strip()
        if servicio not in _SERVICIOS:
            return jsonify({"error": f"Servicio no permitido: {servicio!r}"}), 400
        import subprocess as _sp
        from app.panel_activity import run_logged_job

        label = _SERVICIOS[servicio]

        def _do_restart():
            print(f"🔄 Reiniciando {label}…")
            # --no-block: no esperar a que el unit termine stop/start (p.ej. bridge WA >30s).
            r = _sp.run(
                ["sudo", "systemctl", "--no-block", "restart", servicio],
                capture_output=True, text=True, timeout=15,
            )
            if r.returncode == 0:
                print(
                    f"✅ Reinicio de {label} encolado en systemd "
                    f"(sigue en segundo plano; el unit puede tardar 1–2 min)."
                )
            else:
                err = (r.stderr or r.stdout).strip()
                print(f"❌ Error al reiniciar {label}: {err or '(sin detalle)'}")

        spawn_thread(lambda: run_logged_job(f"reiniciar_{servicio}", _do_restart), daemon=True)
        return jsonify({
            "status": "iniciado",
            "mensaje": f"Reiniciando {label}…",
            "aviso": "Si reinicias agente-pro el panel perderá conexión brevemente (±15 s).",
        })

    @app.route("/api/sistema/git-status")
    def api_sistema_git_status():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import subprocess as _sp
        repo_dir = os.path.normpath(os.path.join(_ROUTES_DIR, ".."))
        try:
            branch = _sp.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, timeout=5, cwd=repo_dir,
            ).stdout.strip()
            last_commit = _sp.run(
                ["git", "log", "-1", "--format=%h %s (%ar)"],
                capture_output=True, text=True, timeout=5, cwd=repo_dir,
            ).stdout.strip()
            short_status = _sp.run(
                ["git", "status", "--short"],
                capture_output=True, text=True, timeout=5, cwd=repo_dir,
            ).stdout.strip()
            modified = len([l for l in short_status.splitlines() if l.strip()])
            # Commits behind remote
            _sp.run(["git", "fetch", "--dry-run"], capture_output=True, timeout=10, cwd=repo_dir)
            behind_out = _sp.run(
                ["git", "rev-list", "--count", "HEAD..@{u}"],
                capture_output=True, text=True, timeout=5, cwd=repo_dir,
            ).stdout.strip()
            behind = int(behind_out) if behind_out.isdigit() else 0
            return jsonify({
                "branch": branch,
                "last_commit": last_commit,
                "modified_files": modified,
                "commits_behind": behind,
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/sistema/git-pull", methods=["POST"])
    def api_sistema_git_pull():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import subprocess as _sp
        from app.panel_activity import run_logged_job
        repo_dir = os.path.normpath(os.path.join(_ROUTES_DIR, ".."))
        body = request.get_json(silent=True) or {}
        rebuild_frontend = bool(body.get("rebuild_frontend", False))

        def _do_pull():
            print(f"📥 Actualizando repositorio desde GitHub…")
            r = _sp.run(
                ["git", "pull", "--rebase", "--autostash", "origin", "master"],
                capture_output=True, text=True, timeout=120, cwd=repo_dir,
            )
            for line in (r.stdout + r.stderr).splitlines():
                if line.strip():
                    print(line)
            if r.returncode != 0:
                print(f"❌ git pull falló (código {r.returncode})")
                return
            print("✅ Repositorio actualizado")
            if rebuild_frontend:
                print("🔨 Compilando panel React…")
                rb = _sp.run(
                    ["npm", "run", "build"],
                    capture_output=True, text=True, timeout=120,
                    cwd=os.path.join(repo_dir, "desktop"),
                )
                for line in (rb.stdout + rb.stderr).splitlines():
                    if line.strip():
                        print(line)
                if rb.returncode == 0:
                    print("✅ Panel React compilado")
                else:
                    print(f"❌ Error compilando React (código {rb.returncode})")

        spawn_thread(lambda: run_logged_job("git_pull", _do_pull), daemon=True)
        return jsonify({"status": "iniciado", "mensaje": "Git pull iniciado…"})

    @app.route("/api/supervisor/index", methods=["POST"])
    def api_supervisor_index():
        """Re-indexa el código fuente del proyecto en ChromaDB (colección proyecto_codigo)."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401

        def _run():
            from app.tools.project_indexer import indexar_proyecto
            stats = indexar_proyecto(verbose=False)
            print(f"[supervisor] índice actualizado — {stats['archivos']} archivos, {stats['chunks']} chunks", flush=True)

        spawn_thread(_run, daemon=True)
        return jsonify({"status": "iniciado", "mensaje": "Indexando código fuente del proyecto en segundo plano…"})

    @app.route("/api/supervisor/status")
    def api_supervisor_status():
        """Retorna cuántos chunks de código están indexados."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            import chromadb as _chroma
            _cc = _chroma.PersistentClient(path=os.path.normpath(os.path.join(_ROUTES_DIR, "..", "memoria_vectorial")))
            col = _cc.get_or_create_collection("proyecto_codigo")
            count = col.count()
            return jsonify({"status": "ok", "chunks_indexados": count, "coleccion": "proyecto_codigo"})
        except Exception as exc:
            return jsonify({"status": "error", "error": str(exc)}), 500

    @app.route("/api/sistema/modelos")
    def api_sistema_modelos():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import requests as _req
        ollama_models = []
        try:
            r = _req.get("http://localhost:11434/api/tags", timeout=3)
            if r.ok:
                for m in r.json().get("models", []):
                    ollama_models.append({
                        "id": m["name"],
                        "nombre": m["name"],
                        "categoria": "ollama",
                        "proveedor": "Local (Ollama)",
                        "size_mb": m.get("size", 0) // 1024 // 1024,
                    })
        except Exception:
            pass
        return jsonify({"modelos": _MODELOS_API_FIJOS + ollama_models})

    @app.route("/api/chat-panel", methods=["POST"])
    def api_chat_panel():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        mensaje = (body.get("mensaje") or "").strip()
        modelo_id = (body.get("modelo_id") or "claude-sonnet-4-6").strip()
        session_id = (body.get("session_id") or "panel").strip()
        reset = bool(body.get("reset", False))
        if not mensaje:
            return jsonify({"error": "mensaje requerido"}), 400

        key = f"{session_id}:{modelo_id}"
        if reset:
            _panel_histories.pop(key, None)
        historial = list(_panel_histories.get(key, []))

        try:
            if modelo_id.startswith("claude-"):
                respuesta = _panel_chat_claude(modelo_id, historial, mensaje)
            elif modelo_id.startswith("gemini-"):
                respuesta = _panel_chat_gemini(modelo_id, historial, mensaje)
            else:
                respuesta = _panel_chat_ollama(modelo_id, historial, mensaje)

            historial = historial + [
                {"role": "user",      "content": mensaje},
                {"role": "assistant", "content": respuesta},
            ]
            if len(historial) > 40:
                historial = historial[-40:]
            _panel_histories[key] = historial

            # Guardar en ChromaDB en hilo daemon (no bloquea la respuesta)
            spawn_thread(
                lambda m=mensaje, r=respuesta, mid=modelo_id: _guardar_en_memoria_panel(m, r, mid),
                daemon=True,
            )

            return jsonify({
                "respuesta": respuesta,
                "modelo_id": modelo_id,
                "timestamp": _dt.now().isoformat(),
                "status": "ok",
            })
        except Exception as exc:
            return jsonify({"error": str(exc), "status": "error"}), 500

    # ── Canales ──────────────────────────────────────────────────────────────

    @app.route("/api/sistema/canales")
    def api_sistema_canales():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.canales_config import listar_canales

        eleven_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
        from app.services.tts_qwen3 import qwen3_disponible
        qwen3_ok = qwen3_disponible()
        return jsonify({
            "canales": listar_canales(),
            "tts_disponible": {
                "elevenlabs": bool(eleven_key),
                "qwen3_local": qwen3_ok,
                "browser": True,
            },
        })

    @app.route("/api/sistema/canales/<canal_id>", methods=["PUT"])
    def api_sistema_canales_asignar(canal_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.canales_config import (
            asignar_modelo_canal,
            modelo_valido_para_canal,
        )

        body = request.get_json(silent=True) or {}
        modelo_id = (body.get("modelo_id") or "").strip()
        if not modelo_id:
            return jsonify({"error": "modelo_id requerido"}), 400
        if not modelo_valido_para_canal(canal_id, modelo_id):
            return jsonify(
                {
                    "error": "Modelo no permitido para este canal",
                    "canal_id": canal_id,
                    "modelo_id": modelo_id,
                }
            ), 400
        canal = asignar_modelo_canal(canal_id, modelo_id)
        if not canal:
            return jsonify({"error": "Canal no editable o desconocido"}), 404
        return jsonify({"ok": True, "canal": canal})

    # ── Voz IA ───────────────────────────────────────────────────────────────

    @app.route("/api/voz/status")
    def api_voz_status():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.tts_qwen3 import qwen3_disponible
        from app.services.tts_voicebox import voicebox_disponible
        from app.services.voz_config import leer_config
        eleven_key   = os.getenv("ELEVENLABS_API_KEY", "").strip()
        eleven_voice = os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9").strip()
        qwen3_ok    = qwen3_disponible()
        voicebox_ok = voicebox_disponible()
        cfg         = leer_config()
        engine      = cfg["engine"]
        if engine == "qwen3" and qwen3_ok:
            motor = "qwen3-clone" if cfg.get("clone_enabled") else "qwen3"
        elif engine == "voicebox" and voicebox_ok:
            motor = "voicebox-clone" if cfg.get("voicebox_profile") else "voicebox"
        elif engine == "elevenlabs" and eleven_key:
            motor = "elevenlabs"
        elif voicebox_ok:
            motor = "voicebox"
        elif qwen3_ok:
            motor = "qwen3"
        elif eleven_key:
            motor = "elevenlabs"
        else:
            motor = "browser"
        return jsonify({
            "elevenlabs": bool(eleven_key),
            "elevenlabs_voice_id": eleven_voice if eleven_key else None,
            "qwen3_local": qwen3_ok,
            "qwen3_voces": ["ryan","aiden","serena","vivian","uncle_fu","dylan","eric","ono_anna","sohee"],
            "voicebox_local": voicebox_ok,
            "browser_tts": True,
            "motor_activo": motor,
            "config": cfg,
        })

    def _qwen3_soporta_clonacion() -> bool:
        """Qwen3-TTS-*-CustomVoice no soporta generate_voice_clone; solo los modelos Base lo hacen."""
        model_id = os.getenv("QWEN3_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice").lower()
        return "customvoice" not in model_id and "custom_voice" not in model_id

    @app.route("/api/voz/config", methods=["GET"])
    def api_voz_config_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.voz_config import leer_config
        from app.services.tts_qwen3 import qwen3_disponible
        from app.services.tts_voicebox import voicebox_disponible, listar_perfiles_voicebox
        cfg = leer_config()
        qwen3_ok    = qwen3_disponible()
        voicebox_ok = voicebox_disponible()
        return jsonify({
            **cfg,
            "qwen3_disponible":    qwen3_ok,
            "qwen3_clonacion":     _qwen3_soporta_clonacion() if qwen3_ok else False,
            "qwen3_voces":         ["ryan","aiden","serena","vivian","uncle_fu","dylan","eric","ono_anna","sohee"],
            "idiomas":             ["Spanish","English","Chinese","Japanese","Korean","German","French","Italian","Russian"],
            "voicebox_disponible": voicebox_ok,
            "voicebox_perfiles":   listar_perfiles_voicebox() if voicebox_ok else [],
            "voicebox_engines":    ["qwen3","qwen3-0.6b","chatterbox","kokoro"],
        })

    @app.route("/api/voz/config", methods=["POST"])
    def api_voz_config_post():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.voz_config import guardar_config
        body = request.get_json(force=True, silent=True) or {}
        cfg = guardar_config(
            engine=body.get("engine"),
            language=body.get("language"),
            speaker=body.get("speaker"),
            ref_text=body.get("ref_text"),
            wake_word=body.get("wake_word"),
            listen_memory=body.get("listen_memory"),
            voicebox_profile=body.get("voicebox_profile"),
            voicebox_engine=body.get("voicebox_engine"),
        )
        return jsonify({"ok": True, "config": cfg})

    @app.route("/api/voz/config/referencia", methods=["POST"])
    def api_voz_config_referencia_upload():
        """Sube un audio WAV/MP3 como voz de referencia para clonación."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.voz_config import guardar_audio_referencia
        audio = request.files.get("audio")
        if not audio:
            return jsonify({"error": "campo 'audio' requerido (multipart/form-data)"}), 400
        ref_text = (request.form.get("ref_text") or "").strip()
        audio_bytes = audio.read()
        if not audio_bytes:
            return jsonify({"error": "audio vacío"}), 400
        cfg = guardar_audio_referencia(audio_bytes, ref_text=ref_text)
        return jsonify({"ok": True, "config": cfg})

    @app.route("/api/voz/config/referencia", methods=["DELETE"])
    def api_voz_config_referencia_delete():
        """Elimina el audio de referencia y desactiva la clonación."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.voz_config import eliminar_audio_referencia
        cfg = eliminar_audio_referencia()
        return jsonify({"ok": True, "config": cfg})

    @app.route("/api/voz/config/referencia/preview", methods=["GET"])
    def api_voz_config_referencia_preview():
        """Devuelve el audio de referencia guardado para preescucha."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.voz_config import leer_audio_referencia
        from flask import Response as _R
        data = leer_audio_referencia()
        if not data:
            return jsonify({"error": "Sin audio de referencia"}), 404
        return _R(data, content_type="audio/wav")

    @app.route("/api/voz/sintetizar", methods=["POST"])
    def api_voz_sintetizar():
        autenticado = _api_token_valido()
        if not autenticado:
            try:
                from app.api_auth import bearer_token_from_request as _btfr
                from app.services.tickets_db import get_usuario_by_token as _get_tu
                _tok = _btfr()
                autenticado = bool(_tok and _get_tu(_tok))
            except Exception:
                pass
        if not autenticado:
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(force=True, silent=True) or {}
        texto = (body.get("texto") or "").strip()[:1200]
        motor_forzado = (body.get("motor") or "").strip()   # fuerza un motor ignorando config
        if not texto:
            return jsonify({"error": "texto requerido"}), 400

        from app.services.voz_config import leer_config, leer_audio_referencia
        from app.services.tts_qwen3 import qwen3_disponible, sintetizar_qwen3, clonar_voz_qwen3
        from flask import Response as _R

        cfg      = leer_config()
        engine   = motor_forzado or cfg["engine"]
        language = body.get("language") or cfg["language"]
        speaker  = body.get("speaker")  or cfg["speaker"]
        clone_on = cfg.get("clone_enabled", False)
        ref_text = cfg.get("ref_text", "")

        from app.services.voz_config import resolver_voicebox_profile, voicebox_language_code
        voicebox_profile = resolver_voicebox_profile(body, cfg)
        voicebox_engine  = body.get("voicebox_engine") or cfg.get("voicebox_engine", "qwen3")
        voz_lang = voicebox_language_code(body.get("language") or cfg.get("language"))

        # ── Motor 1: Voicebox (Qwen3-TTS-Base — mejor clonación) ──────────
        from app.services.tts_voicebox import voicebox_disponible, sintetizar_voicebox
        if engine == "voicebox":
            if not voicebox_disponible():
                if motor_forzado == "voicebox":
                    return jsonify({"error": "Voicebox no disponible"}), 503
            else:
                try:
                    audio = sintetizar_voicebox(
                        texto,
                        profile_id=voicebox_profile,
                        engine=voicebox_engine,
                        language=voz_lang,
                    )
                    return _R(
                        audio,
                        content_type="audio/wav",
                        headers={
                            "X-TTS-Motor": "voicebox-clone",
                            "X-TTS-Profile": voicebox_profile,
                        },
                    )
                except Exception as exc:
                    print(f"[Voz] Voicebox falló ({voicebox_profile}): {exc}")
                    if motor_forzado == "voicebox":
                        return jsonify({"error": f"Voicebox: {exc}"}), 500

        # ── Motor 2: Qwen3 TTS local (GPU) ────────────────────────────────
        if engine in ("qwen3", "auto") and qwen3_disponible():
            try:
                if clone_on:
                    ref_bytes = leer_audio_referencia()
                    if ref_bytes and ref_text:
                        try:
                            audio = clonar_voz_qwen3(texto, ref_bytes, ref_text, language)
                            return _R(audio, content_type="audio/wav",
                                      headers={"X-TTS-Motor": "qwen3-clone"})
                        except Exception as clone_exc:
                            print(f"[Voz] Qwen3 clone no soportado ({clone_exc}), usando voz predefinida")
                audio = sintetizar_qwen3(texto, speaker=speaker, language=language)
                return _R(audio, content_type="audio/wav",
                          headers={"X-TTS-Motor": "qwen3"})
            except Exception as exc:
                print(f"[Voz] Qwen3 falló: {exc}")

        # ── Motor 3: ElevenLabs API ────────────────────────────────────────
        eleven_key   = os.getenv("ELEVENLABS_API_KEY", "").strip()
        eleven_voice = os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9").strip()
        if eleven_key and engine not in ("qwen3", "voicebox"):
            import requests as _req
            try:
                r = _req.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{eleven_voice}",
                    headers={"xi-api-key": eleven_key, "Content-Type": "application/json"},
                    json={
                        "text": texto,
                        "model_id": "eleven_multilingual_v2",
                        "voice_settings": {"stability": 0.45, "similarity_boost": 0.80},
                    },
                    timeout=30,
                )
                r.raise_for_status()
                return _R(r.content, content_type="audio/mpeg",
                          headers={"X-TTS-Motor": "elevenlabs"})
            except Exception as exc:
                print(f"[Voz] ElevenLabs falló: {exc}")

        # ── Fallback: sin audio desde servidor (browser SpeechSynthesis) ──
        return jsonify({"error": "Sin motor TTS disponible", "fallback": "browser"}), 503

    @app.route("/api/voz/memoria", methods=["POST"])
    def api_voz_memoria():
        """Agrega texto escuchado en modo escucha continua a la memoria vectorial."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body   = request.get_json(silent=True) or {}
        texto  = (body.get("texto") or "").strip()
        fuente = (body.get("fuente") or "voz_escucha").strip()
        if not texto or len(texto) < 5:
            return jsonify({"error": "texto muy corto"}), 400
        try:
            import chromadb as _chroma
            import uuid as _uuid
            _chroma_path = os.path.join(_ROUTES_DIR, "..", "memoria_vectorial")
            _cc  = _chroma.PersistentClient(path=os.path.normpath(_chroma_path))
            col  = _cc.get_or_create_collection("mckenna_brain")
            col.add(
                documents=[texto],
                ids=[f"voz_{_uuid.uuid4().hex[:12]}"],
                metadatas=[{"fuente": fuente, "timestamp": datetime.now().isoformat()}],
            )
            return jsonify({"ok": True, "chars": len(texto)})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/voz/voicebox/perfiles", methods=["GET"])
    def api_voz_voicebox_perfiles():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.tts_voicebox import listar_perfiles_voicebox
        return jsonify({"perfiles": listar_perfiles_voicebox()})

    @app.route("/api/voz/voicebox/perfiles", methods=["POST"])
    def api_voz_voicebox_crear_perfil():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.tts_voicebox import crear_perfil_voicebox
        body = request.get_json(silent=True) or {}
        nombre = (body.get("nombre") or body.get("name") or "Mi voz").strip()
        try:
            perfil = crear_perfil_voicebox(nombre)
            return jsonify({"ok": True, "perfil": perfil})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/voz/voicebox/perfiles/<profile_id>/muestras", methods=["POST"])
    def api_voz_voicebox_subir_muestra(profile_id: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.tts_voicebox import agregar_muestra_voicebox
        audio = request.files.get("audio")
        if not audio:
            return jsonify({"error": "campo 'audio' requerido"}), 400
        ref_text     = (request.form.get("ref_text") or "").strip()
        audio_bytes  = audio.read()
        content_type = audio.content_type or audio.mimetype or ""
        filename     = audio.filename or "sample.wav"
        try:
            result = agregar_muestra_voicebox(profile_id, audio_bytes, ref_text, filename, content_type)
            return jsonify({"ok": True, "result": result})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/voz/notificaciones")
    def api_voz_notificaciones_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.voz_notif import leer_notificaciones
        notifs = leer_notificaciones()
        return jsonify({"notificaciones": notifs, "total": len(notifs)})

    @app.route("/api/voz/notificaciones/marcar", methods=["POST"])
    def api_voz_notificaciones_marcar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.voz_notif import marcar_leidas
        body = request.get_json(silent=True) or {}
        ids = body.get("ids")   # None = marcar todas
        eliminadas = marcar_leidas(ids)
        from app.services.voz_notif import leer_notificaciones
        return jsonify({"ok": True, "eliminadas": eliminadas, "restantes": len(leer_notificaciones())})

    # ── Web Push (VAPID) — alarma con pantalla bloqueada ──────────────────────

    def _voz_auth_ok():
        """Acepta CHAT_API_TOKEN O JWT de tickets válido."""
        if _api_token_valido():
            return True
        try:
            from app.api_auth import bearer_token_from_request as _btfr
            from app.services.tickets_db import get_usuario_by_token as _gtu
            tok = _btfr()
            return bool(tok and _gtu(tok))
        except Exception:
            return False

    @app.route("/api/voz/push/vapid-key", methods=["GET"])
    def api_push_vapid_key():
        from app.services.push_scheduler import get_vapid_public_key, push_disponible
        return jsonify({
            "publicKey":   get_vapid_public_key(),
            "disponible":  push_disponible(),
        })

    @app.route("/api/voz/push/subscribe", methods=["POST"])
    def api_push_subscribe():
        if not _voz_auth_ok():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.push_scheduler import set_schedule, push_disponible
        if not push_disponible():
            return jsonify({"error": "VAPID no configurado"}), 503
        body = request.get_json(silent=True) or {}
        subscription = body.get("subscription")
        minutes      = max(1, min(60, int(body.get("minutes", 5))))
        active       = bool(body.get("active", True))
        if not subscription or not subscription.get("endpoint"):
            return jsonify({"error": "subscription requerida"}), 400
        set_schedule(subscription["endpoint"], subscription, minutes, active)
        return jsonify({"ok": True, "minutes": minutes, "active": active})

    @app.route("/api/voz/transcribir", methods=["POST"])
    def api_voz_transcribir():
        if not _voz_auth_ok():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.whisper_stt import whisper_disponible, transcribir as _transcribir
        if not whisper_disponible():
            return jsonify({"error": "faster-whisper no instalado"}), 503
        audio = request.files.get("audio")
        if not audio:
            return jsonify({"error": "campo 'audio' requerido (multipart/form-data)"}), 400
        audio_bytes = audio.read()
        if not audio_bytes:
            return jsonify({"error": "audio vacío"}), 400
        try:
            texto = _transcribir(audio_bytes, filename=audio.filename or "audio.webm")
            return jsonify({"texto": texto, "motor": "faster-whisper"})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    # ── Build APK Android ─────────────────────────────────────────────────────

    _TWA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "android-twa")
    _APK_SRC  = os.path.join(_TWA_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk")
    _APK_DEST = os.path.join(_TWA_DIR, "McKenna_Group_latest.apk")

    _apk_state: dict = {
        "status":   "success" if os.path.exists(os.path.join(_TWA_DIR, "McKenna_Group_latest.apk")) else "idle",
        "log":      [],
        "version":  "1.0.0",
        "error":    None,
        "built_at": None,
    }

    def _apk_build_worker(version: str):
        import subprocess as _sp
        import json as _json
        import shutil as _shutil
        import time as _time

        _apk_state["status"] = "building"
        _apk_state["log"] = [f"▶ Iniciando build v{version}…"]
        _apk_state["error"] = None

        env = os.environ.copy()
        env["ANDROID_HOME"] = os.path.expanduser("~/Android/Sdk")
        env["JAVA_HOME"]    = "/usr/lib/jvm/java-21-openjdk-amd64"

        # Actualizar versionName y versionCode en twa-manifest.json
        try:
            manifest_path = os.path.join(_TWA_DIR, "twa-manifest.json")
            with open(manifest_path) as f:
                mf = _json.load(f)
            old_code = int(mf.get("appVersionCode", 1))
            mf["appVersionName"] = version
            mf["appVersion"]     = version
            mf["appVersionCode"] = old_code + 1
            with open(manifest_path, "w") as f:
                _json.dump(mf, f, indent=2)
            _apk_state["log"].append(f"📝 twa-manifest.json: versionCode={old_code + 1}")
        except Exception as ex:
            _apk_state["log"].append(f"⚠ No se pudo actualizar twa-manifest.json: {ex}")

        cmd = [
            os.path.join(_TWA_DIR, "gradlew"),
            "assembleRelease",
            f"-Pandroid.injected.signing.store.file={os.path.join(_TWA_DIR, 'mckenna.keystore')}",
            "-Pandroid.injected.signing.store.password=mckenna2024",
            "-Pandroid.injected.signing.key.alias=mckenna",
            "-Pandroid.injected.signing.key.password=mckenna2024",
            "--no-daemon",
        ]
        try:
            proc = _sp.Popen(
                cmd, cwd=_TWA_DIR, env=env,
                stdout=_sp.PIPE, stderr=_sp.STDOUT, text=True, bufsize=1,
            )
            for line in proc.stdout:
                stripped = line.rstrip()
                if stripped:
                    # Solo líneas relevantes de Gradle
                    if any(k in stripped for k in ("> Task", "BUILD", "FAILED", "ERROR", "Warning", "error:")):
                        _apk_state["log"].append(stripped)
            proc.wait()
            if proc.returncode != 0:
                raise RuntimeError(f"Gradle exit code {proc.returncode}")
        except Exception as ex:
            _apk_state["status"] = "error"
            _apk_state["error"] = str(ex)
            _apk_state["log"].append(f"✖ Error: {ex}")
            return

        # Copiar APK a destino estable
        try:
            _shutil.copy2(_APK_SRC, _APK_DEST)
            size_kb = os.path.getsize(_APK_DEST) // 1024
            _apk_state["log"].append(f"✔ APK listo: {size_kb} KB")
            _apk_state["status"] = "success"
            _apk_state["version"] = version
            _apk_state["built_at"] = _time.strftime("%Y-%m-%d %H:%M:%S")
        except Exception as ex:
            _apk_state["status"] = "error"
            _apk_state["error"] = str(ex)
            _apk_state["log"].append(f"✖ No se pudo copiar el APK: {ex}")

    @app.route("/api/build-apk", methods=["POST"])
    def api_build_apk_start():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        if _apk_state["status"] == "building":
            return jsonify({"error": "Ya hay un build en curso"}), 409
        if not os.path.isdir(_TWA_DIR):
            return jsonify({"error": f"Directorio TWA no encontrado: {_TWA_DIR}"}), 500
        body = request.get_json(silent=True) or {}
        version = str(body.get("version", "1.0.0")).strip() or "1.0.0"
        import threading as _th
        t = _th.Thread(target=_apk_build_worker, args=(version,), daemon=True)
        t.start()
        return jsonify({"ok": True, "version": version})

    @app.route("/api/build-apk/status", methods=["GET"])
    def api_build_apk_status():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        return jsonify({
            "status":   _apk_state["status"],
            "log":      _apk_state["log"][-80:],
            "version":  _apk_state["version"],
            "error":    _apk_state["error"],
            "built_at": _apk_state["built_at"],
            "apk_size_kb": (os.path.getsize(_APK_DEST) // 1024) if os.path.exists(_APK_DEST) else None,
        })

    @app.route("/api/build-apk/download", methods=["GET"])
    def api_build_apk_download():
        from app.api_auth import chat_api_token_expected, normalize_api_token
        expected = chat_api_token_expected()
        # Acepta Bearer header o ?token= query param (para window.location.href)
        tok_query = normalize_api_token(request.args.get("token", ""))
        from app.api_auth import bearer_token_from_request
        if bearer_token_from_request() != expected and tok_query != expected:
            return jsonify({"error": "No autorizado"}), 401
        if not os.path.exists(_APK_DEST):
            return jsonify({"error": "APK no disponible — genera uno primero"}), 404
        from flask import send_file as _send_file
        version = _apk_state.get("version") or "latest"
        dl_name = f"McKenna_Group_v{version}.apk"
        return _send_file(_APK_DEST, as_attachment=True, download_name=dl_name, mimetype="application/vnd.android.package-archive")

    # ── Acceso red ────────────────────────────────────────────────────────────

    @app.route("/api/sistema/acceso-red", methods=["GET"])
    def api_acceso_red_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        puerto = int(os.getenv("AGENTE_PORT", "8081"))
        ip_lan = _ip_lan_local()
        habilitado = _leer_acceso_red()
        url = f"http://{ip_lan}:{puerto}/app" if (habilitado and ip_lan) else None
        return jsonify({"habilitado": habilitado, "ip_lan": ip_lan, "puerto": puerto, "url": url})

    @app.route("/api/sistema/acceso-red", methods=["POST"])
    def api_acceso_red_post():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        habilitado = bool(body.get("habilitado", True))
        _escribir_acceso_red(habilitado)
        puerto = int(os.getenv("AGENTE_PORT", "8081"))
        ip_lan = _ip_lan_local()
        url = f"http://{ip_lan}:{puerto}/app" if (habilitado and ip_lan) else None
        return jsonify({"habilitado": habilitado, "ip_lan": ip_lan, "puerto": puerto, "url": url})

    # ── Puente WhatsApp (Node :3000) — sesión / QR desde panel Agente WA ─────

    def _whatsapp_bridge_base_url():
        explicit = os.getenv("WHATSAPP_BRIDGE_URL", "").strip().rstrip("/")
        if explicit:
            return explicit
        enviar = os.getenv("URL_API_WHATSAPP", "http://127.0.0.1:3000/enviar").strip()
        if "/enviar" in enviar:
            return enviar.rsplit("/", 1)[0]
        return "http://127.0.0.1:3000"

    def _whatsapp_bridge_headers():
        tok = os.getenv("WHATSAPP_BRIDGE_INTERNAL_TOKEN", "").strip()
        if tok:
            return {"X-Bridge-Token": tok}
        return {}

    def _whatsapp_bridge_json(method: str, path: str, timeout=8, **kwargs):
        import requests as _req

        url = f"{_whatsapp_bridge_base_url()}{path}"
        fn = getattr(_req, method.lower())
        return fn(url, headers=_whatsapp_bridge_headers(), timeout=timeout, **kwargs)

    def _wa_qr_raw_to_data_url(qr_text: str | None) -> str | None:
        if not qr_text:
            return None
        try:
            import base64
            import io

            import qrcode as qr_mod

            img = qr_mod.make(str(qr_text), box_size=8, border=2)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/png;base64,{b64}"
        except Exception as ex:
            print(f"⚠️ No se pudo generar imagen QR para panel: {ex}")
            return None

    def _systemctl_is_active(unit: str) -> str:
        import subprocess as _sp

        try:
            r = _sp.run(
                ["systemctl", "is-active", unit],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return (r.stdout or "").strip() or "unknown"
        except Exception:
            return "unknown"

    def _bot_bridge_status_payload():
        unit = "mckenna-whatsapp-bridge"
        bridge_unit = _systemctl_is_active(unit)
        sesion = {
            "conectado": False,
            "sistema_listo": False,
            "numero": None,
            "pushname": None,
            "qr_pendiente": False,
            "qr_data_url": None,
            "qr_generado_en": None,
            "sesion_reseteando": False,
            "mensaje": "",
            "bridge_responde": False,
        }
        try:
            r = _whatsapp_bridge_json("get", "/session/status", timeout=6)
            if r.status_code == 200:
                d = r.json()
                sesion["bridge_responde"] = True
                sesion["conectado"] = bool(d.get("waSesionOperativa") or d.get("conectado"))
                sesion["sistema_listo"] = bool(d.get("sistemaListo"))
                sesion["numero"] = d.get("numero")
                sesion["pushname"] = d.get("pushname")
                sesion["qr_pendiente"] = bool(d.get("qrPendiente"))
                sesion["sesion_reseteando"] = bool(d.get("sesionReseteando"))
                sesion["qr_generado_en"] = d.get("qrGeneradoEn")
                if sesion["conectado"]:
                    sesion["mensaje"] = "Sesión WhatsApp activa."
                elif sesion["qr_pendiente"]:
                    sesion["mensaje"] = "Escanea el QR con el teléfono de la línea operativa."
                elif sesion["sesion_reseteando"]:
                    sesion["mensaje"] = "Cambiando cuenta…"
                else:
                    sesion["mensaje"] = "Puente en marcha; esperando vinculación."
            else:
                sesion["mensaje"] = f"Puente respondió HTTP {r.status_code}"
        except Exception as e:
            sesion["mensaje"] = f"Puente no responde ({e})"

        if sesion.get("qr_pendiente") or (
            not sesion.get("conectado") and bridge_unit in ("active", "activating")
        ):
            try:
                rq = _whatsapp_bridge_json("get", "/session/qr", timeout=8)
                if rq.status_code == 200:
                    qd = rq.json()
                    raw = qd.get("qrRaw")
                    if raw:
                        sesion["qr_data_url"] = _wa_qr_raw_to_data_url(raw)
                        sesion["qr_pendiente"] = True
                        sesion["qr_generado_en"] = qd.get("qrGeneradoEn")
                    elif qd.get("qrDataUrl"):
                        sesion["qr_data_url"] = qd["qrDataUrl"]
                        sesion["qr_pendiente"] = True
                        sesion["qr_generado_en"] = qd.get("qrGeneradoEn")
            except Exception:
                pass

        return {
            "bridge_unit": unit,
            "bridge_estado": bridge_unit,
            "bridge_activo": bridge_unit == "active",
            "sesion": sesion,
        }

    @app.route("/api/bot/bridge/status", methods=["GET"])
    def api_bot_bridge_status():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        return jsonify(_bot_bridge_status_payload())

    @app.route("/api/bot/bridge/desvincular", methods=["POST"])
    def api_bot_bridge_desvincular():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import shutil
        import subprocess as _sp
        from app.panel_activity import run_logged_job

        auth_dir = os.path.normpath(
            os.path.join(_ROUTES_DIR, "..", "bot-mckenna", ".wwebjs_auth_nueva")
        )
        unit = "mckenna-whatsapp-bridge"
        bridge_ok = False
        err_bridge = None

        try:
            r = _whatsapp_bridge_json("post", "/session/logout", timeout=12)
            if r.status_code in (200, 409):
                bridge_ok = True
            else:
                err_bridge = (r.text or "")[:200] or f"HTTP {r.status_code}"
        except Exception as e:
            err_bridge = str(e)

        def _fallback_cleanup():
            try:
                if os.path.isdir(auth_dir):
                    shutil.rmtree(auth_dir, ignore_errors=True)
                    print("🧹 Sesión WA eliminada en disco (fallback panel).")
            except Exception as ex:
                print(f"⚠️ No se pudo borrar {auth_dir}: {ex}")
            _sp.run(
                ["sudo", "systemctl", "--no-block", "restart", unit],
                capture_output=True,
                text=True,
                timeout=15,
            )

        if not bridge_ok:
            spawn_thread(
                lambda: run_logged_job("wa_bridge_desvincular_fallback", _fallback_cleanup),
                daemon=True,
            )
            return jsonify({
                "status": "iniciado",
                "mensaje": (
                    "El puente no respondió al logout; se borró la sesión local "
                    "y se reinició el servicio. Espera el QR en 1–2 min."
                ),
                "detalle": err_bridge,
            })

        spawn_thread(
            lambda: run_logged_job(
                "wa_bridge_desvincular",
                lambda: _sp.run(
                    ["sudo", "systemctl", "--no-block", "restart", unit],
                    capture_output=True,
                    text=True,
                    timeout=15,
                ),
            ),
            daemon=True,
        )
        return jsonify({
            "status": "iniciado",
            "mensaje": (
                "Sesión desvinculada. systemd reiniciará el puente; "
                "abre esta pestaña para escanear el QR con el nuevo número."
            ),
        })

    # ── Control global del bot WhatsApp ──────────────────────────────────────

    _HORARIO_DEFAULT = {
        "habilitado": False,
        "hora_inicio": "08:00",
        "hora_fin": "18:00",
        "dias": [1, 2, 3, 4, 5],
    }

    @app.route("/api/bot/config", methods=["GET"])
    def api_bot_config_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        modos = cargar_modos_atencion()
        activo_ahora = _bot_debe_responder_global(modos)
        return jsonify({
            "bot_global_activo": modos.get("bot_global_activo", True),
            "horario_bot": modos.get("horario_bot", _HORARIO_DEFAULT),
            "activo_ahora": activo_ahora,
        })

    @app.route("/api/bot/config", methods=["POST"])
    def api_bot_config_post():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        modos = cargar_modos_atencion()
        if "bot_global_activo" in body:
            modos["bot_global_activo"] = bool(body["bot_global_activo"])
        if "horario_bot" in body:
            h = body["horario_bot"]
            modos["horario_bot"] = {
                "habilitado": bool(h.get("habilitado", False)),
                "hora_inicio": str(h.get("hora_inicio", "08:00"))[:5],
                "hora_fin": str(h.get("hora_fin", "18:00"))[:5],
                "dias": [int(d) for d in h.get("dias", [1, 2, 3, 4, 5]) if 1 <= int(d) <= 7],
            }
        guardar_modos_atencion(modos)
        return jsonify({"ok": True, "activo_ahora": _bot_debe_responder_global(modos)})

    # ── Gestión de números WhatsApp ───────────────────────────────────────────

    @app.route("/api/bot/numeros", methods=["GET"])
    def api_bot_numeros_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        modos = cargar_modos_atencion()
        pausados = modos.get("bot_auto_pausados", {})
        ts_map = modos.get("timestamps", {})

        def _enriquecer(jid: str, lista: str) -> dict:
            info = pausados.get(jid, {})
            return {
                "jid": jid,
                "lista": lista,
                "ts": info.get("timestamp") or ts_map.get(jid),
                "razon": info.get("razon", "manual"),
                "ultimo_mensaje": info.get("ultimo_mensaje", ""),
            }

        return jsonify({
            "humano": [_enriquecer(j, "humano") for j in modos.get("numeros_en_humano", [])],
            "silenciados": [
                {"jid": j, "lista": "silenciado", "ts": ts_map.get(j), "razon": "manual", "ultimo_mensaje": ""}
                for j in modos.get("numeros_silenciados", [])
            ],
        })

    @app.route("/api/bot/numeros", methods=["POST"])
    def api_bot_numeros_post():
        """
        Body: { "numero": "3001234567", "accion": "humano_agregar|humano_quitar|silenciar|activar", "razon": "..." }
        """
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        numero_raw = str(body.get("numero", "")).strip()
        accion = str(body.get("accion", "")).strip()
        razon = str(body.get("razon", "operador desde panel"))[:200]

        jid = _normalizar_numero_wa(numero_raw)
        if not jid:
            return jsonify({"error": "Número no reconocido. Usa formato 3XXXXXXXXX o 573XXXXXXXXX"}), 400
        if accion not in ("humano_agregar", "humano_quitar", "silenciar", "activar"):
            return jsonify({"error": "accion inválida"}), 400

        from app.services.wa_jid import aplicar_modo_en_relacionados
        from app.services.wa_logs import registrar as _wa_log

        modos = cargar_modos_atencion()
        ts = time.time()

        if accion == "humano_agregar":
            aplicar_modo_en_relacionados(
                modos, jid, agregar_humano=True, razon=razon, ts=ts
            )
            _wa_log("manual_humano", jid, razon)

        elif accion == "humano_quitar":
            aplicar_modo_en_relacionados(modos, jid, quitar_humano=True, razon=razon, ts=ts)
            _wa_log("handoff_bot", jid, razon)

        elif accion == "silenciar":
            aplicar_modo_en_relacionados(modos, jid, silenciar=True, razon=razon, ts=ts)
            _wa_log("manual_silenciar", jid, razon)

        elif accion == "activar":
            aplicar_modo_en_relacionados(modos, jid, activar=True, razon=razon, ts=ts)
            _wa_log("manual_activar", jid, razon)

        guardar_modos_atencion(modos)
        return jsonify({"ok": True, "jid": jid})

    # ── Log de interacciones WhatsApp ─────────────────────────────────────────

    @app.route("/api/bot/interacciones", methods=["GET"])
    def api_bot_interacciones_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_logs import listar as _wa_listar
        limit = min(int(request.args.get("limit", 100)), 300)
        sender = request.args.get("sender", "").strip() or None
        eventos = _wa_listar(limit=limit, sender=sender)
        return jsonify({"eventos": eventos, "total": len(eventos)})

    # ── Chats WhatsApp (historial de conversaciones) ──────────────────────────

    @app.route("/api/bot/chats", methods=["GET"])
    def api_bot_chats_lista():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_chats import listar_conversaciones as _lc, total_no_leidos as _tnl
        limit = min(int(request.args.get("limit", 60)), 200)
        from app.services.wa_jid import formato_display, modo_para_jid

        conversaciones = _lc(limit=limit)
        modos = cargar_modos_atencion()
        humanos = modos.get("numeros_en_humano", [])
        silenciados = modos.get("numeros_silenciados", [])
        for c in conversaciones:
            jid = c.get("jid", "")
            c["modo"] = modo_para_jid(jid, humanos, silenciados)
            c["display"] = formato_display(jid)
            c["jid_raw"] = jid
        return jsonify({"conversaciones": conversaciones, "no_leidos_total": _tnl()})

    @app.route("/api/bot/chats/<path:jid>", methods=["GET"])
    def api_bot_chats_mensajes(jid: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_chats import listar_mensajes as _lm, marcar_leido as _ml
        limit = min(int(request.args.get("limit", 120)), 300)
        from app.services.wa_jid import formato_display, modo_para_jid

        mensajes = _lm(jid, limit=limit)
        _ml(jid)
        modos = cargar_modos_atencion()
        humanos = modos.get("numeros_en_humano", [])
        silenciados = modos.get("numeros_silenciados", [])
        modo = modo_para_jid(jid, humanos, silenciados)
        return jsonify({
            "mensajes": mensajes,
            "modo": modo,
            "jid": jid,
            "display": formato_display(jid),
        })

    @app.route("/api/bot/chats/<path:jid>/enviar", methods=["POST"])
    def api_bot_chats_enviar(jid: str):
        """El operador humano envía un mensaje a un cliente desde el panel."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        texto = str(body.get("texto", "")).strip()
        if not texto:
            return jsonify({"error": "texto requerido"}), 400
        from app.services.wa_jid import jids_relacionados
        from app.utils import enviar_whatsapp_reporte
        from app.services.wa_chats import guardar as _wag

        destinos = list(jids_relacionados(jid))
        destino_envio = next((d for d in destinos if d.endswith("@lid")), None)
        if not destino_envio:
            destino_envio = next((d for d in destinos if d.endswith("@c.us")), jid)
        ok = enviar_whatsapp_reporte(texto, numero_destino=destino_envio)
        if ok:
            _wag(jid, "salida", texto, False, "", "humano")
            return jsonify({"ok": True})
        return jsonify({"error": "No se pudo enviar. Verifica que el bridge de WhatsApp esté activo."}), 503

    @app.route("/api/bot/chats/<path:jid>/leer", methods=["POST"])
    def api_bot_chats_leer(jid: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_chats import marcar_leido as _ml
        _ml(jid)
        return jsonify({"ok": True})

    @app.route("/api/bot/chats/ingest", methods=["POST"])
    def api_bot_chats_ingest():
        """Lote desde el bridge (mensajes del celular, sync, respuestas del bot con wa_id)."""
        if not chat_api_token_matches_request():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        from app.services.wa_chats import ingestar_desde_whatsapp as _ing

        stats = _ing(body.get("mensajes") or [])
        return jsonify({"ok": True, **stats})

    @app.route("/api/bot/chats/revoke", methods=["POST"])
    def api_bot_chats_revoke():
        """Marca mensajes eliminados en WhatsApp (borrado en el celular)."""
        if not chat_api_token_matches_request():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        from app.services.wa_chats import marcar_eliminado_por_wa_id, marcar_eliminados

        wa_ids = body.get("wa_ids") or []
        wa_id = str(body.get("wa_id") or "").strip()
        if wa_id:
            wa_ids = list(wa_ids) + [wa_id]
        n = marcar_eliminados([str(x).strip() for x in wa_ids if str(x).strip()])
        return jsonify({"ok": True, "marcados": n})

    @app.route("/api/bot/chats/<path:jid>/sincronizar", methods=["POST"])
    def api_bot_chats_sincronizar(jid: str):
        """Trae historial reciente desde WhatsApp Web y reconcilia SQLite."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        limit = min(int(body.get("limit", 60)), 80)
        from app.services.wa_jid import jids_relacionados

        candidatos = sorted(
            list(jids_relacionados(jid)),
            key=lambda j: (0 if j.endswith("@lid") else 1, j),
        )
        if not candidatos:
            candidatos = [jid]
        ultimo_err = "Chat no encontrado en WhatsApp"
        for dest in candidatos:
            try:
                r = _whatsapp_bridge_json(
                    "post",
                    "/chats/sync",
                    timeout=50,
                    json={"jid": dest, "limit": limit},
                )
            except Exception as e:
                ultimo_err = str(e)
                continue
            if r.status_code == 200:
                payload = r.json() if r.content else {}
                payload["jid_panel"] = jid
                payload["jid_sync"] = dest
                return jsonify(payload)
            ultimo_err = (r.text or "")[:300] or f"HTTP {r.status_code}"
        return jsonify({"error": ultimo_err}), 503

    # ── Biblioteca de recursos rápidos ─────────────────────────────────────

    @app.route("/api/bot/biblioteca", methods=["GET"])
    def api_bot_biblioteca_listar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_biblioteca import listar as _blib
        return jsonify({"items": _blib()})

    @app.route("/api/bot/biblioteca", methods=["POST"])
    def api_bot_biblioteca_crear():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_biblioteca import agregar_texto, agregar_link, agregar_archivo
        # Multipart (archivo)
        if request.content_type and "multipart" in request.content_type:
            titulo = request.form.get("titulo", "Archivo").strip()[:120]
            categoria = request.form.get("categoria", "General").strip()
            archivo = request.files.get("archivo")
            if not archivo:
                return jsonify({"error": "archivo requerido"}), 400
            datos = archivo.read()
            if len(datos) > 20 * 1024 * 1024:
                return jsonify({"error": "Archivo demasiado grande (máx 20 MB)"}), 413
            result = agregar_archivo(titulo, archivo.filename or "archivo", datos, archivo.mimetype or "", categoria)
        else:
            body = request.get_json(silent=True) or {}
            tipo = str(body.get("tipo", "")).strip()
            titulo = str(body.get("titulo", "")).strip()[:120]
            categoria = str(body.get("categoria", "General")).strip()
            if not titulo:
                return jsonify({"error": "titulo requerido"}), 400
            if tipo == "link":
                url = str(body.get("url", "")).strip()
                if not url:
                    return jsonify({"error": "url requerida"}), 400
                result = agregar_link(titulo, url, categoria)
            else:
                contenido = str(body.get("contenido", "")).strip()
                if not contenido:
                    return jsonify({"error": "contenido requerido"}), 400
                result = agregar_texto(titulo, contenido, categoria)
        if not result.get("ok"):
            return jsonify({"error": result.get("error", "Error al crear")}), 500
        return jsonify(result), 201

    @app.route("/api/bot/biblioteca/<item_id>", methods=["DELETE"])
    def api_bot_biblioteca_eliminar(item_id: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_biblioteca import eliminar as _belim
        result = _belim(item_id)
        if not result.get("ok"):
            return jsonify({"error": result.get("error", "Error")}), 404
        return jsonify({"ok": True})

    @app.route("/api/bot/biblioteca/<item_id>/archivo", methods=["GET"])
    def api_bot_biblioteca_archivo(item_id: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_biblioteca import ruta_archivo as _barch, obtener as _bget
        ruta = _barch(item_id)
        if not ruta:
            return jsonify({"error": "archivo no encontrado"}), 404
        item = _bget(item_id)
        mime = item["mime_type"] if item else "application/octet-stream"
        nombre = item["nombre_arch"] if item else os.path.basename(ruta)
        from flask import send_file
        return send_file(ruta, mimetype=mime, as_attachment=False,
                         download_name=nombre)

    @app.route("/api/bot/chats/<path:jid>/enviar-biblioteca/<item_id>", methods=["POST"])
    def api_bot_chats_enviar_biblioteca(jid: str, item_id: str):
        """Envía un ítem de la biblioteca directamente a un cliente de WhatsApp."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_biblioteca import obtener as _bget, ruta_archivo as _barch
        from app.utils import enviar_whatsapp_reporte, enviar_whatsapp_archivo
        from app.services.wa_chats import guardar as _wag
        item = _bget(item_id)
        if not item:
            return jsonify({"error": "ítem no encontrado"}), 404
        tipo = item["tipo"]
        try:
            if tipo == "texto":
                ok = enviar_whatsapp_reporte(item["contenido"], numero_destino=jid)
                if ok:
                    _wag(jid, "salida", item["contenido"], False, "", "humano")
            elif tipo == "link":
                msg = f"{item['titulo']}\n{item['url']}" if item["titulo"] else item["url"]
                ok = enviar_whatsapp_reporte(msg, numero_destino=jid)
                if ok:
                    _wag(jid, "salida", msg, False, "", "humano")
            elif tipo == "archivo":
                ruta = _barch(item_id)
                if not ruta:
                    return jsonify({"error": "archivo físico no encontrado"}), 404
                ok = enviar_whatsapp_archivo(ruta, item.get("titulo", ""), item["nombre_arch"], jid)
                if ok:
                    _wag(jid, "salida", f"[Archivo: {item['nombre_arch']}]", True, item["nombre_arch"], "humano")
            else:
                return jsonify({"error": "tipo desconocido"}), 400
            if ok:
                return jsonify({"ok": True})
            return jsonify({"error": "No se pudo enviar. Verifica que el bridge de WhatsApp esté activo."}), 503
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/app/api/5s/workspace", methods=["GET", "PUT"])
    @app.route("/api/5s/workspace", methods=["GET", "PUT"])
    def api_5s_workspace():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        if request.method == "GET":
            return jsonify(_5s.read_workspace())
        try:
            body = request.get_json(silent=True) or {}
            if not isinstance(body, dict):
                body = {}
            saved = _5s.write_workspace(body)
            return jsonify(saved)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/app/api/5s/project", methods=["POST"])
    @app.route("/api/5s/project", methods=["POST"])
    def api_5s_project_create():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        tid = str(body.get("template_id", "")).strip()
        name = str(body.get("name", "")).strip()
        cat = str(body.get("category_id", "")).strip() or None
        if not tid:
            return jsonify({"error": "template_id requerido"}), 400
        ws = _5s.read_workspace()
        proj = _5s.new_project_from_template(tid, name, ws, category_id=cat)
        if not proj:
            return jsonify({"error": "Plantilla no encontrada"}), 404
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"project": proj, "workspace": saved})

    @app.route("/app/api/5s/project/routine", methods=["POST"], strict_slashes=False)
    @app.route("/app/api/5s/routine", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/project/routine", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/routine", methods=["POST"], strict_slashes=False)
    def api_5s_routine_create():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        name = str(body.get("name", "")).strip()
        tags = body.get("tags") if isinstance(body.get("tags"), list) else []
        pre = body.get("preflight") if isinstance(body.get("preflight"), list) else []
        post = body.get("postflight") if isinstance(body.get("postflight"), list) else []
        tasks = body.get("tasks") if isinstance(body.get("tasks"), list) else []
        ritual = str(body.get("ritual_notes", "")).strip()
        cat = str(body.get("category_id", "")).strip() or None
        also_tpl = bool(body.get("also_save_template"))
        raw_sup = body.get("supplies")
        supplies = raw_sup if isinstance(raw_sup, list) else None
        raw_mat = body.get("materials")
        materials = raw_mat if isinstance(raw_mat, list) else None
        recipe_notes = str(body.get("recipe_notes", "")).strip()
        ws = _5s.read_workspace()
        proj, err = _5s.create_routine_project(
            ws,
            name,
            [str(x) for x in tags],
            [str(x) for x in pre],
            [str(x) for x in tasks],
            ritual,
            cat,
            also_tpl,
            supplies,
            materials,
            recipe_notes,
            [str(x) for x in post],
        )
        if err or not proj:
            return jsonify({"error": err or "no se pudo crear"}), 400
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"project": proj, "workspace": saved})

    @app.route("/app/api/5s/suggest-routine", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/suggest-routine", methods=["POST"], strict_slashes=False)
    def api_5s_suggest_routine():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        desc = str(body.get("description", "")).strip()
        hints = body.get("hints")
        if hints is not None and not isinstance(hints, dict):
            hints = None
        sug, err = _5s.suggest_routine_json(desc, hints)
        if err or not sug:
            return jsonify({"ok": False, "suggestion": None, "error": err or "sin sugerencia"}), 200
        return jsonify({"ok": True, "suggestion": sug, "error": ""})

    @app.route("/app/api/5s/assistant", methods=["POST"])
    @app.route("/api/5s/assistant", methods=["POST"])
    def api_5s_assistant():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        msg = str(body.get("message", "")).strip()
        if not msg:
            return jsonify({"ok": False, "reply": "", "error": "Campo 'message' requerido"}), 400
        ctx = body.get("context")
        if ctx is not None and not isinstance(ctx, dict):
            ctx = None
        out = _5s.asistente_5s_detailed(msg, ctx)
        reply = (out.get("reply") or "").strip()
        if not reply:
            err = (out.get("error") or "Sin respuesta").strip()
            return jsonify({
                "ok": False,
                "reply": "",
                "error": err,
                "provider": out.get("provider") or "",
            })
        return jsonify({
            "ok": True,
            "reply": reply,
            "error": "",
            "provider": out.get("provider") or "",
        })

    @app.route("/app/api/5s/audio", methods=["POST"])
    @app.route("/api/5s/audio", methods=["POST"])
    def api_5s_audio_upload():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        f = request.files.get("file")
        if not f or not getattr(f, "filename", None):
            return jsonify({"error": "campo multipart 'file' requerido"}), 400
        if not str(f.filename).lower().endswith(".wav"):
            return jsonify({"error": "solo archivos .wav"}), 400
        try:
            fname = _5s.save_wav_upload(f)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        prefix = "/app/api/5s/audio" if request.path.startswith("/app/api/") else "/api/5s/audio"
        return jsonify({"url": f"{prefix}/{fname}", "filename": fname})

    @app.route("/app/api/5s/audio/<fname>")
    @app.route("/api/5s/audio/<fname>")
    def api_5s_audio_get(fname):
        from app.services.cinco_s import CINCO_S_AUDIO_DIR

        safe = str(fname).strip()
        if not re.match(r"^[a-f0-9]{32}\.wav$", safe, re.I):
            return "", 404
        fp = os.path.join(CINCO_S_AUDIO_DIR, safe)
        if not os.path.isfile(fp):
            return "", 404
        return send_from_directory(CINCO_S_AUDIO_DIR, safe, mimetype="audio/wav")

    def _api_5s_project_delete_response(project_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        ws = _5s.read_workspace()
        if not _5s.remove_project(ws, project_id):
            return jsonify({"error": "tablero no encontrado"}), 404
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"workspace": saved})

    @app.route("/app/api/5s/project/<project_id>/delete", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/project/<project_id>/delete", methods=["POST"], strict_slashes=False)
    def api_5s_project_delete_post(project_id):
        """Alias POST: muchos proxies bloquean DELETE; el panel usa esta ruta."""
        return _api_5s_project_delete_response(project_id)

    @app.route("/app/api/5s/project/<project_id>", methods=["DELETE"])
    @app.route("/api/5s/project/<project_id>", methods=["DELETE"])
    def api_5s_project_delete(project_id):
        return _api_5s_project_delete_response(project_id)

    def _api_5s_template_delete_response(template_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        ws = _5s.read_workspace()
        if not _5s.remove_template(ws, template_id):
            return jsonify({"error": "plantilla no encontrada"}), 404
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"workspace": saved})

    @app.route("/app/api/5s/template/<template_id>/delete", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/template/<template_id>/delete", methods=["POST"], strict_slashes=False)
    def api_5s_template_delete_post(template_id):
        return _api_5s_template_delete_response(template_id)

    @app.route("/app/api/5s/template/<template_id>", methods=["PUT", "DELETE"])
    @app.route("/api/5s/template/<template_id>", methods=["PUT", "DELETE"])
    def api_5s_template_item(template_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        if request.method == "DELETE":
            return _api_5s_template_delete_response(template_id)

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        ws = _5s.read_workspace()
        saved = _5s.replace_template(ws, template_id, body)
        if saved is None:
            return jsonify({"error": "plantilla no encontrada o datos inválidos"}), 400
        return jsonify({"workspace": saved})

    @app.route("/app/api/5s/template", methods=["POST"])
    @app.route("/api/5s/template", methods=["POST"])
    def api_5s_template_create():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        ws = _5s.read_workspace()
        out, err = _5s.append_template(ws, body)
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"workspace": out})

    # ══════════════════════════════════════════════════════════════════════════
    #  SPA — React build served from desktop/dist/
    # ══════════════════════════════════════════════════════════════════════════
    _SPA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "desktop", "dist")

    @app.route("/app/assets/<path:filename>")
    def serve_spa_assets(filename):
        """Serve JS/CSS hashed assets from the Vite build."""
        assets_dir = os.path.join(_SPA_DIR, "assets")
        return send_from_directory(assets_dir, filename)

    @app.route("/app/favicon.svg")
    def serve_spa_favicon():
        return send_from_directory(_SPA_DIR, "favicon.svg")

    @app.route("/app/manifest.json")
    def serve_spa_manifest():
        return send_from_directory(_SPA_DIR, "manifest.json")

    @app.route("/app/icon-<int:size>.png")
    def serve_spa_icon(size):
        return send_from_directory(_SPA_DIR, f"icon-{size}.png")

    @app.route("/app/sw-alarm.js")
    def serve_sw_alarm():
        """Service Worker para notificaciones nativas de alarma de tareas."""
        resp = send_from_directory(_SPA_DIR, "sw-alarm.js")
        resp.headers["Service-Worker-Allowed"] = "/app/"
        resp.headers["Cache-Control"] = "no-cache, no-store"
        resp.headers["Content-Type"] = "application/javascript"
        return resp

    @app.route("/.well-known/assetlinks.json")
    def serve_assetlinks():
        """Digital Asset Links — requerido para TWA Android."""
        sha256 = os.environ.get("TWA_SHA256_CERT_FINGERPRINT", "PLACEHOLDER")
        payload = [
            {
                "relation": ["delegate_permission/common.handle_all_urls"],
                "target": {
                    "namespace": "android_app",
                    "package_name": "co.mckennagroup.panel",
                    "sha256_cert_fingerprints": [sha256],
                },
            }
        ]
        resp = make_response(json.dumps(payload))
        resp.headers["Content-Type"] = "application/json"
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.route("/app", methods=["GET", "HEAD"])
    @app.route("/app/<path:path>", methods=["GET", "HEAD"])
    def serve_spa(path=""):
        if not os.path.isdir(_SPA_DIR):
            return jsonify({"error": "SPA no compilada. Ejecutar: cd desktop && npm run build"}), 404
        return send_from_directory(_SPA_DIR, "index.html")
