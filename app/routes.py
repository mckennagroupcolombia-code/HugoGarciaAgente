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


def _intentar_ok_preventa(texto: str) -> bool:
    """
    Procesa 'ok {sufijo}' cuando hay pregunta preventa pendiente con ese sufijo.
    Retorna True si el comando fue reconocido (con o sin borrador IA).
    """
    t = _normalizar_comando_grupo(texto).lower().strip()
    m = re.match(r"^ok\s+(\d{3,})$", t)
    if not m:
        return False
    sufijo = m.group(1)
    qid = encontrar_question_id_por_sufijo(sufijo)
    if not qid:
        return False

    from app.services.meli_preventa import obtener_borrador_ia

    borrador = obtener_borrador_ia(qid)
    if borrador:
        spawn_thread(_procesar_respuesta_preventa, args=(qid, borrador))
        return True

    spawn_thread(
        enviar_whatsapp_reporte,
        args=(
            f"⚠️ No hay borrador IA para el código *{sufijo}*.\n"
            f"Usa: *resp {sufijo}: tu respuesta*",
            jid_grupo_preventa_wa(),
        ),
    )
    return True


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


def _pendientes_postventa_por_sufijo(sufijo: str) -> list[dict]:
    """Pendientes únicos por pack_id cuyo código corto coincide con sufijo (3+ dígitos)."""
    sufijo = re.sub(r"\D", "", (sufijo or "").strip())
    if len(sufijo) < 3:
        return []
    try:
        from app.meli_postventa_notif import sufijo_pack_postventa

        with open(_POSVENTA_STATE_PATH, "r", encoding="utf-8") as _f:
            pendientes = json.load(_f).get("pendientes", {})
    except Exception:
        return []

    vistos: set[str] = set()
    matches: list[dict] = []
    for v in pendientes.values():
        if not isinstance(v, dict):
            continue
        pack_id = str(v.get("pack_id") or "").strip()
        if not pack_id or pack_id in vistos:
            continue
        cod = re.sub(r"\D", "", str(v.get("codigo") or ""))
        pack_digits = re.sub(r"\D", "", pack_id)
        cod_corto = sufijo_pack_postventa(pack_id)
        if (
            sufijo == cod
            or sufijo == cod_corto
            or pack_id.endswith(sufijo)
            or pack_digits.endswith(sufijo)
            or cod.endswith(sufijo)
        ):
            vistos.add(pack_id)
            matches.append(v)
    return matches


def _diagnosticar_sufijo_postventa(sufijo: str) -> dict:
    matches = _pendientes_postventa_por_sufijo(sufijo)
    pack_ids = [str(m.get("pack_id") or "") for m in matches if m.get("pack_id")]
    return {"matches": pack_ids, "count": len(pack_ids)}


def _resolver_pack_por_sufijo_en_meli(codigo: str) -> dict | None:
    """
    Último recurso si la cola JSON quedó vacía: busca pack reciente por sufijo (ej. 2174).
    """
    digits = re.sub(r"\D", "", (codigo or "").strip())
    if len(digits) < 3:
        return None
    try:
        from app.meli_postventa_notif import sufijo_pack_postventa
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
        candidatos: list[dict] = []
        for orden in r.json().get("results", []) or []:
            pack_id = str(orden.get("pack_id") or orden.get("id") or "").strip()
            if not pack_id:
                continue
            pack_digits = re.sub(r"\D", "", pack_id)
            sufijo = sufijo_pack_postventa(pack_id)
            if (
                pack_id == codigo_stripped
                or pack_id.endswith(digits)
                or pack_digits.endswith(digits)
                or sufijo == digits
            ):
                buyer = orden.get("buyer") or {}
                comprador = str(buyer.get("nickname") or buyer.get("first_name") or "")
                candidatos.append(
                    {
                        "pack_id": pack_id,
                        "codigo": sufijo,
                        "comprador": comprador,
                        "from_id": str(buyer.get("id") or "") or None,
                    }
                )
        if len(candidatos) == 1:
            return candidatos[0]
        if len(candidatos) > 1:
            print(
                f"⚠️ [POSVENTA] Sufijo {codigo} ambiguo en MeLi "
                f"({len(candidatos)} packs recientes)"
            )
            return None
    except Exception as _e:
        print(f"⚠️ [POSVENTA] Error buscando pack por sufijo {codigo}: {_e}")
    return None


def _resolver_entrada_postventa(codigo: str):
    """
    Busca entrada pendiente por código corto (3 dígitos), pack_id o clave en JSON.
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

        if not entrada and re.fullmatch(r"\d{3,8}", codigo):
            matches = _pendientes_postventa_por_sufijo(codigo)
            if len(matches) == 1:
                entrada = matches[0]
                clave_pendiente = str(entrada.get("pack_id") or codigo)
            elif len(matches) > 1:
                return None, None

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
            from app.meli_postventa_notif import sufijo_pack_postventa

            codigo = sufijo_pack_postventa(pack_id)
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
        diag = _diagnosticar_sufijo_postventa(codigo)
        if diag["count"] > 1:
            ids = ", ".join(f"…{p[-6:]}" for p in diag["matches"][:5])
            err = (
                f"Código *{codigo}* ambiguo: hay {diag['count']} mensajes pendientes "
                f"({ids}). Usa el pack completo o responde en MeLi."
            )
        elif codigo.isdigit() and len(codigo) > 8:
            pack_id = codigo
            err = None
        else:
            err = f"No hay mensaje postventa pendiente con código {codigo}"
        if err:
            if notificar_grupo:
                enviar_whatsapp_reporte(
                    f"⚠️ {err}",
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
            "Ejemplo: posventa 404: Hola, su pedido ya fue despachado.",
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


def _bot_en_horario_servicio(modos=None) -> bool:
    """True si la hora actual cae dentro de horario_bot (solo informativo en panel)."""
    from datetime import timedelta

    if modos is None:
        modos = cargar_modos_atencion()
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
    if h_ini <= h_fin:
        return h_ini <= hora_actual < h_fin
    # Ventana nocturna (ej. 22:00–07:00)
    return hora_actual >= h_ini or hora_actual < h_fin


def _bot_debe_responder_global(modos=None) -> bool:
    """False solo si el operador pausó el bot global desde el panel."""
    if modos is None:
        modos = cargar_modos_atencion()
    return bool(modos.get("bot_global_activo", True))


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
    if len(digits) == 12 and digits.startswith("57") and digits[2] == "3":
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
            from app.services.wa_jid import (
                jid_canonico,
                normalizar_jid_almacenamiento,
                registrar_alias_lid,
            )

            if sender_lid and sender_phone:
                registrar_alias_lid(sender_lid, sender_phone)
            sender_id = normalizar_jid_almacenamiento(
                sender_raw,
                sender_lid=sender_lid,
                sender_phone=sender_phone,
            )
            if not sender_id:
                sender_id = jid_canonico(sender_raw) if sender_raw else sender_raw
        except Exception:
            sender_id = sender_raw
        reply_to_wa = str(data.get("reply_to") or sender_raw or sender_id).strip()
        message_text = _normalizar_comando_grupo(data.get("mensaje", "").strip())
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

        # ok {sufijo} — aprobar borrador IA preventa (desde cualquier chat/grupo)
        if _intentar_ok_preventa(message_text):
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

            from app.services.web_chat_consultas import detectar_comando_respuesta_web

            cod_wcq, resp_wcq = detectar_comando_respuesta_web(tn)
            if cod_wcq and resp_wcq:

                def _wa_web_consulta_resp(codigo: str, respuesta: str, destino: str):
                    from app.services.web_chat_consultas import resolver_consulta

                    ok, msg, _reg = resolver_consulta(
                        codigo, respuesta, respondido_por="grupo_pedidos_web"
                    )
                    enviar_whatsapp_reporte(msg, numero_destino=destino)

                spawn_thread(
                    _wa_web_consulta_resp,
                    args=(cod_wcq, resp_wcq, destino_grupo),
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
                from app.services.wa_chats import (
                    existe_wa_id,
                    guardar as _wa_chat_guardar,
                    normalizar_media_path_panel,
                )

                _wa_key = str(data.get("wa_id") or "").strip() or None
                if _wa_key and existe_wa_id(_wa_key):
                    pass
                else:
                    _tiene_media = bool(has_media)
                    _wa_ts = data.get("ts")
                    try:
                        _wa_ts = float(_wa_ts) if _wa_ts is not None else None
                    except (TypeError, ValueError):
                        _wa_ts = None
                    _mrel = normalizar_media_path_panel(media_path)
                    _mmime = ""
                    if media_type == "image":
                        _mmime = "image/jpeg"
                    elif media_type == "document":
                        _mmime = "application/pdf"
                    _texto_chat = (message_text or "").strip()
                    if not _texto_chat and _tiene_media:
                        _texto_chat = "[adjunto]"
                    _wa_chat_guardar(
                        sender_id,
                        "entrada",
                        _texto_chat,
                        _tiene_media,
                        os.path.basename(_mrel) if _mrel else "",
                        "cliente",
                        wa_id=_wa_key,
                        ts=_wa_ts,
                        media_path=_mrel,
                        media_mime=_mmime,
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
            # --- CONTROL GLOBAL DEL BOT (pausa manual desde panel) ---
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
            token_ok = message_text.split()[-1].strip()
            target_order_id = None
            message_to_send = None

            if token_ok in borradores_aprobacion:
                target_order_id = token_ok
                message_to_send = borradores_aprobacion.pop(token_ok)
            else:
                from app.meli_postventa_notif import sufijo_pack_postventa

                matches = []
                for pack_key, borrador in list(borradores_aprobacion.items()):
                    digits = re.sub(r"\D", "", str(pack_key))
                    if (
                        pack_key == token_ok
                        or pack_key.endswith(token_ok)
                        or digits.endswith(token_ok)
                        or sufijo_pack_postventa(pack_key) == token_ok
                    ):
                        matches.append((pack_key, borrador))
                if len(matches) == 1:
                    target_order_id, message_to_send = matches[0]
                    borradores_aprobacion.pop(target_order_id, None)

            if target_order_id and message_to_send:
                resultado_envio = responder_mensaje_posventa(
                    target_order_id, message_to_send
                )
                print(f"Resultado del envío a posventa: {resultado_envio}")
                sufijo = sufijo_pack_postventa(target_order_id)
                return jsonify(
                    {
                        "status": "sent",
                        "respuesta": f"¡Listo! Mensaje enviado (código {sufijo}).",
                    }
                )

            return jsonify(
                {
                    "status": "error",
                    "respuesta": (
                        f"No encontré borrador pendiente para el código '{token_ok}'. "
                        "Usa los 3 últimos dígitos del pack."
                    ),
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

            from app.meli_postventa_notif import sufijo_pack_postventa

            codigo_corto = sufijo_pack_postventa(order_id)
            mensaje_aprobacion = (
                f"🔔 *RESPUESTA PENDIENTE DE APROBACIÓN*\n"
                f"🔢 Código: *{codigo_corto}*\n"
                f"🤖 Mensaje propuesto: _{respuesta_ia}_\n\n"
                f"Para enviar: *hugo dale ok {codigo_corto}*"
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
        usuario = _panel_tickets_usuario()
        if usuario:
            from app.services.panel_presencia import log_panel_tarea

            log_panel_tarea(
                usuario,
                "preventa_respondida",
                panel="preventa",
                detalle={"question_id": question_id},
            )
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
        if request.method in ("GET", "HEAD") and request.path.startswith("/api/tickets"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
            response.headers["Pragma"] = "no-cache"
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

    @app.route("/api/sync/schedule")
    def api_sync_schedule():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.sync_scheduler import get_schedule_status

        return jsonify(get_schedule_status())

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
            ref = (
                (datos.get("referencia") or "")
                or body.get("producto_ref")
                or ""
            ).strip()
            if subir_drive and ref:
                from app.services.documentos_catalogo import registrar_documento_generado

                for up in resultado.get("drive_uploads") or []:
                    if up.get("webViewLink") and up.get("tipo") == "pdf":
                        registrar_documento_generado(
                            ref,
                            "ft",
                            up,
                            nombre_producto=titulo,
                        )
            return jsonify(resultado)
        except Exception as e:
            from app.panel_activity import log_line

            log_line(f"✖ fichas/generar: {e!r}")
            return jsonify({"error": str(e)}), 500

    @app.route("/api/fichas/preview", methods=["POST"])
    def api_fichas_preview():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        datos, err = _api_doc_body_datos(body)
        if err:
            return err
        return _api_doc_preview("fichas", datos)

    @app.route("/api/fichas/descargar")
    def api_fichas_descargar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.ficha_tecnica import ruta_descarga_segura

        nombre = request.args.get("archivo", "").strip()
        inline = request.args.get("inline", "").lower() in ("1", "true", "yes")
        path = ruta_descarga_segura(nombre)
        if not path:
            return jsonify({"error": "Archivo no permitido"}), 404

        return _send_archivo_doc(path, inline=inline)

    def _send_archivo_doc(path, inline: bool = False):
        from flask import send_file

        if inline and path.suffix.lower() == ".pdf":
            return send_file(
                path,
                mimetype="application/pdf",
                as_attachment=False,
                download_name=path.name,
            )
        return send_file(path, as_attachment=True, download_name=path.name)

    def _api_doc_preview(modulo: str, datos: dict) -> tuple:
        try:
            from app.panel_activity import log_line

            if modulo == "fichas":
                from app.services.ficha_tecnica import generar_desde_datos as generar
            elif modulo == "coa":
                from app.services.coa import generar_desde_datos as generar
            else:
                from app.services.sds import generar_desde_datos as generar

            titulo = (datos.get("titulo") or "").strip()
            log_line(f"HTTP {modulo}/preview: {titulo[:80]!r}")
            resultado = generar(
                datos,
                generar_pdf=True,
                subir_drive=False,
                guardar_yaml=None,
            )
            pdf = resultado.get("pdf_nombre")
            docx = resultado.get("docx_nombre")
            if pdf:
                resultado["preview_pdf"] = f"/api/{modulo}/descargar?archivo={pdf}&inline=1"
            if docx:
                resultado["preview_docx"] = f"/api/{modulo}/descargar?archivo={docx}"
            return jsonify(resultado), 200
        except Exception as e:
            from app.panel_activity import log_line

            log_line(f"✖ {modulo}/preview: {e!r}")
            return jsonify({"error": str(e)}), 500

    def _api_doc_body_datos(body: dict) -> tuple[dict | None, tuple | None]:
        import yaml as _yaml

        datos = body.get("datos")
        yaml_raw = body.get("yaml")
        if yaml_raw and isinstance(yaml_raw, str):
            try:
                datos = _yaml.safe_load(yaml_raw) or {}
            except Exception as exc:
                return None, (jsonify({"error": f"YAML inválido: {exc}"}), 400)
        if not isinstance(datos, dict) or not (datos.get("titulo") or "").strip():
            return None, (jsonify({"error": "Se requiere 'datos' o 'yaml' con al menos 'titulo'"}), 400)
        return datos, None

    # ── Catálogo documentación por producto (combos SIIGO) ────────────────────

    @app.route("/app/api/documentos/productos", methods=["GET"])
    @app.route("/api/documentos/productos", methods=["GET"])
    def api_documentos_productos():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.documentos_catalogo import listar_productos_documentacion

        buscar = request.args.get("buscar", "").strip()
        solo_faltantes = request.args.get("solo_faltantes", "").lower() in ("1", "true", "yes")
        tipo_faltante = request.args.get("tipo_faltante", "").strip().lower() or None
        limite = request.args.get("limit", default=500, type=int) or 500
        refrescar_drive = request.args.get("refrescar_drive", "").lower() in ("1", "true", "yes")
        incluir_sheets = request.args.get("incluir_sheets", "1").lower() not in ("0", "false", "no")
        try:
            return jsonify(
                listar_productos_documentacion(
                    buscar=buscar,
                    solo_faltantes=solo_faltantes,
                    tipo_faltante=tipo_faltante,
                    limite=min(limite, 1000),
                    incluir_sheets=incluir_sheets,
                    refrescar_drive=refrescar_drive,
                )
            )
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/app/api/documentos/asociar", methods=["POST"])
    @app.route("/api/documentos/asociar", methods=["POST"])
    def api_documentos_asociar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        try:
            from app.services.documentos_catalogo import asociar_documento

            entry = asociar_documento(
                body.get("ref", ""),
                body.get("tipo", ""),
                drive_id=body.get("drive_id"),
                web_view_link=body.get("webViewLink") or body.get("web_view_link"),
                nombre_archivo=body.get("nombre_archivo"),
                nombre_producto=body.get("nombre"),
            )
            return jsonify({"ok": True, "asociacion": entry})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/app/api/documentos/buscar-drive", methods=["GET"])
    @app.route("/api/documentos/buscar-drive", methods=["GET"])
    def api_documentos_buscar_drive():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        nombre = request.args.get("nombre", "").strip()
        ref = request.args.get("ref", "").strip()
        if not nombre:
            return jsonify({"error": "Se requiere nombre"}), 400
        from app.services.documentos_catalogo import buscar_archivos_drive_para_producto

        return jsonify(buscar_archivos_drive_para_producto(nombre, ref))

    def _api_doc_generar(modulo: str, datos: dict, body: dict) -> tuple:
        """Helper COA/SDS: generar DOCX/PDF (+ Drive opcional)."""
        import yaml as _yaml

        generar_pdf = bool(body.get("generar_pdf", True))
        subir_drive = bool(body.get("subir_drive", False))
        guardar_yaml = body.get("guardar_yaml")
        slug_yaml = body.get("slug_yaml")
        try:
            from app.panel_activity import log_line

            if modulo == "coa":
                from app.services.coa import generar_desde_datos as generar
            else:
                from app.services.sds import generar_desde_datos as generar

            titulo = (datos.get("titulo") or "").strip()
            log_line(
                f"HTTP {modulo}/generar: {titulo[:80]!r} pdf={generar_pdf} drive={subir_drive}"
            )
            resultado = generar(
                datos,
                generar_pdf=generar_pdf,
                subir_drive=subir_drive,
                guardar_yaml=slug_yaml if guardar_yaml else None,
            )
            log_line(f"✔ {modulo} generado: {resultado.get('docx_nombre')}")
            ref = (
                (datos.get("referencia") or "")
                or ((datos.get("identificacion") or {}).get("referencia_interna"))
                or body.get("producto_ref")
                or ""
            ).strip()
            tipo_map = {"fichas": "ft", "coa": "coa", "sds": "sds"}
            if subir_drive and ref:
                from app.services.documentos_catalogo import registrar_documento_generado

                for up in resultado.get("drive_uploads") or []:
                    if up.get("webViewLink") and up.get("tipo") == "pdf":
                        registrar_documento_generado(
                            ref,
                            tipo_map.get(modulo, modulo),
                            up,
                            nombre_producto=(datos.get("titulo") or "").strip(),
                        )
            return jsonify(resultado), 200
        except Exception as e:
            from app.panel_activity import log_line

            log_line(f"✖ {modulo}/generar: {e!r}")
            return jsonify({"error": str(e)}), 500

    # ── COA (certificado de análisis) ─────────────────────────────────────────

    @app.route("/api/coa/config", methods=["GET"])
    def api_coa_config():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.coa import PLANTILLA_DEFAULT, configuracion_drive

        cfg = configuracion_drive()
        cfg["plantilla_ok"] = PLANTILLA_DEFAULT.is_file()
        cfg["plantilla"] = str(PLANTILLA_DEFAULT)
        return jsonify(cfg)

    @app.route("/api/coa/datos", methods=["GET"])
    def api_coa_datos_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.coa import listar_yaml_datos

        return jsonify({"items": listar_yaml_datos()})

    @app.route("/api/coa/datos/<slug>", methods=["GET"])
    def api_coa_datos_get(slug: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.coa import DATOS_DIR, cargar_datos_desde_archivo
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

    @app.route("/api/coa/plantilla", methods=["GET"])
    def api_coa_plantilla():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.coa import plantilla_datos_ejemplo
        import yaml

        datos = plantilla_datos_ejemplo()
        return jsonify({
            "datos": datos,
            "yaml": yaml.dump(datos, allow_unicode=True, sort_keys=False),
        })

    @app.route("/api/coa/generar", methods=["POST"])
    def api_coa_generar():
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
        return _api_doc_generar("coa", datos, body)

    @app.route("/api/coa/preview", methods=["POST"])
    def api_coa_preview():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        datos, err = _api_doc_body_datos(body)
        if err:
            return err
        return _api_doc_preview("coa", datos)

    @app.route("/api/coa/descargar")
    def api_coa_descargar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.coa import ruta_descarga_segura

        nombre = request.args.get("archivo", "").strip()
        inline = request.args.get("inline", "").lower() in ("1", "true", "yes")
        path = ruta_descarga_segura(nombre)
        if not path:
            return jsonify({"error": "Archivo no permitido"}), 404

        return _send_archivo_doc(path, inline=inline)

    # ── SDS (hoja de datos de seguridad) ──────────────────────────────────────

    @app.route("/api/sds/config", methods=["GET"])
    def api_sds_config():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.sds import PLANTILLA_DEFAULT, configuracion_drive

        cfg = configuracion_drive()
        cfg["plantilla_ok"] = PLANTILLA_DEFAULT.is_file()
        cfg["plantilla"] = str(PLANTILLA_DEFAULT)
        return jsonify(cfg)

    @app.route("/api/sds/datos", methods=["GET"])
    def api_sds_datos_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.sds import listar_yaml_datos

        return jsonify({"items": listar_yaml_datos()})

    @app.route("/api/sds/datos/<slug>", methods=["GET"])
    def api_sds_datos_get(slug: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.sds import DATOS_DIR, cargar_datos_desde_archivo
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

    @app.route("/api/sds/plantilla", methods=["GET"])
    def api_sds_plantilla():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.sds import plantilla_datos_ejemplo
        import yaml

        datos = plantilla_datos_ejemplo()
        return jsonify({
            "datos": datos,
            "yaml": yaml.dump(datos, allow_unicode=True, sort_keys=False),
        })

    @app.route("/api/sds/generar", methods=["POST"])
    def api_sds_generar():
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
        return _api_doc_generar("sds", datos, body)

    @app.route("/api/sds/preview", methods=["POST"])
    def api_sds_preview():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        datos, err = _api_doc_body_datos(body)
        if err:
            return err
        return _api_doc_preview("sds", datos)

    @app.route("/api/sds/descargar")
    def api_sds_descargar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.sds import ruta_descarga_segura

        nombre = request.args.get("archivo", "").strip()
        inline = request.args.get("inline", "").lower() in ("1", "true", "yes")
        path = ruta_descarga_segura(nombre)
        if not path:
            return jsonify({"error": "Archivo no permitido"}), 404

        return _send_archivo_doc(path, inline=inline)

    @app.route("/api/sds/completar", methods=["POST"])
    def api_sds_completar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        titulo = (body.get("titulo") or (body.get("datos") or {}).get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "Se requiere titulo"}), 400
        try:
            from app.services.documento_cientifico import completar_datos_documento

            return jsonify(completar_datos_documento("sds", titulo, body.get("datos")))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/coa/completar", methods=["POST"])
    def api_coa_completar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        titulo = (body.get("titulo") or (body.get("datos") or {}).get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "Se requiere titulo"}), 400
        try:
            from app.services.documento_cientifico import completar_datos_documento

            return jsonify(completar_datos_documento("coa", titulo, body.get("datos")))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/fichas/completar", methods=["POST"])
    def api_fichas_completar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        titulo = (body.get("titulo") or (body.get("datos") or {}).get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "Se requiere titulo"}), 400
        try:
            from app.services.documento_cientifico import completar_datos_documento

            return jsonify(completar_datos_documento("fichas", titulo, body.get("datos")))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

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

    @app.route("/api/siigo/centros-costo", methods=["GET"])
    def api_siigo_centros_costo():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.siigo import listar_centros_costo_siigo

        centros, err = listar_centros_costo_siigo()
        if err:
            return jsonify({"error": err}), 502
        return jsonify({"centros": centros or [], "total": len(centros or [])})

    # ── Rentabilidad ─────────────────────────────────────────────────────────

    @app.route("/api/rentabilidad/productos", methods=["GET"])
    def api_rentabilidad_productos():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import listar_productos_rentabilidad
        productos, err = listar_productos_rentabilidad()
        if err and not productos:
            return jsonify({"error": err}), 502
        return jsonify({"productos": productos, "total": len(productos)})

    @app.route("/api/rentabilidad/calcular", methods=["POST"])
    def api_rentabilidad_calcular():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(silent=True) or {}
        from app.services.rentabilidad import calcular_rentabilidad
        try:
            resultado = calcular_rentabilidad(
                precio_lista=float(data.get("precio_lista") or 0),
                iva_pct=float(data.get("iva_pct") or 0),
                tax_included=bool(data.get("tax_included", True)),
                costo_materiales=float(data.get("costo_materiales") or 0),
                costo_nomina=float(data.get("costo_nomina") or 0),
                costo_envase=float(data.get("costo_envase") or 0),
                costo_etiqueta=float(data.get("costo_etiqueta") or 0),
                otros_costos=float(data.get("otros_costos") or 0),
                comision_pct=float(data.get("comision_pct") or 0.165),
                margen_objetivo_pct=float(data["margen_objetivo_pct"]) if data.get("margen_objetivo_pct") not in (None, "") else None,
            )
            return jsonify(resultado)
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/rentabilidad/resumen", methods=["GET"])
    def api_rentabilidad_resumen():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        fecha_inicio = request.args.get("fecha_inicio", "")
        fecha_fin = request.args.get("fecha_fin") or None
        if not fecha_inicio:
            return jsonify({"error": "Se requiere fecha_inicio (YYYY-MM-DD)"}), 400
        from app.services.rentabilidad import resumen_periodo
        resultado = resumen_periodo(fecha_inicio, fecha_fin)
        if "error" in resultado:
            return jsonify(resultado), 502
        return jsonify(resultado)

    @app.route("/api/rentabilidad/config/<codigo>", methods=["GET"])
    def api_rentabilidad_config_get(codigo):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import cargar_config_producto
        cfg = cargar_config_producto(codigo)
        if cfg is None:
            return jsonify({"config": None})
        return jsonify({"config": cfg})

    @app.route("/api/rentabilidad/config", methods=["POST"])
    def api_rentabilidad_config_save():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(silent=True) or {}
        codigo = (data.get("codigo") or "").strip()
        if not codigo:
            return jsonify({"error": "Se requiere codigo"}), 400
        from app.services.rentabilidad import guardar_config_producto
        config = {k: v for k, v in data.items() if k != "codigo"}
        guardar_config_producto(codigo, config)
        return jsonify({"ok": True})

    # ── Componente costos ─────────────────────────────────────────────────────

    @app.route("/api/rentabilidad/componentes", methods=["GET"])
    def api_componentes_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import listar_componentes
        return jsonify({"componentes": listar_componentes()})

    @app.route("/api/rentabilidad/componentes", methods=["POST"])
    def api_componentes_save():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(silent=True) or {}
        nombre = (data.get("nombre") or "").strip()
        if not nombre:
            return jsonify({"error": "Se requiere nombre"}), 400
        from app.services.contabilidad_db import upsert_componente
        row = upsert_componente(nombre, float(data.get("costo_unitario") or 0), data.get("categoria", "material"))
        return jsonify(row)

    @app.route("/api/rentabilidad/combo-costos/<code>", methods=["GET"])
    def api_combo_costos(code):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import combo_costos_desglose
        try:
            result = combo_costos_desglose(code)
        except Exception as e:
            return jsonify({"error": str(e)}), 502
        if "error" in result:
            return jsonify(result), 404
        return jsonify(result)

    @app.route("/api/rentabilidad/catalogo-estado", methods=["GET"])
    def api_catalogo_estado():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import estado_catalogo
        return jsonify(estado_catalogo())

    @app.route("/api/rentabilidad/catalogo-rebuild", methods=["POST"])
    def api_catalogo_rebuild():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import construir_catalogo_costos, estado_catalogo
        from app.observability import spawn_thread
        def _rebuild():
            construir_catalogo_costos(forzar=True)
        spawn_thread(_rebuild, "catalogo_rebuild")
        return jsonify({"ok": True, "mensaje": "Reconstruyendo catálogo en segundo plano (~15 s). Refresca en 20 s."})

    @app.route("/api/rentabilidad/componentes-faltantes", methods=["GET"])
    def api_componentes_faltantes():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import escanear_componentes_sin_costo
        try:
            return jsonify(escanear_componentes_sin_costo())
        except Exception as e:
            return jsonify({"error": str(e)}), 502

    @app.route("/api/rentabilidad/componentes-autofill", methods=["POST"])
    def api_componentes_autofill():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import autocompletar_costos_componentes
        data = request.get_json(silent=True) or {}
        dry_run = bool(data.get("dry_run", False))
        try:
            return jsonify(autocompletar_costos_componentes(dry_run=dry_run))
        except Exception as e:
            return jsonify({"error": str(e)}), 502

    # ── Nómina ────────────────────────────────────────────────────────────────

    @app.route("/api/nomina/usuarios-app", methods=["GET"])
    def api_nomina_usuarios_app():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.services.tickets_db import listar_usuarios as _lu
            usuarios = _lu() or []
            resultado = [
                {
                    "id": u["id"],
                    "nombre": u.get("nombre") or u.get("username") or "",
                    "email": u.get("email") or "",
                    "telefono": u.get("telefono") or "",
                    "activo": u.get("activo", True),
                }
                for u in usuarios
                if u and u.get("activo", True)
            ]
            resultado.sort(key=lambda x: x["nombre"].lower())
            return jsonify({"usuarios": resultado})
        except Exception as e:
            return jsonify({"usuarios": [], "warning": str(e)})

    @app.route("/api/nomina/empleados/<int:emp_id>/recordatorio", methods=["POST"])
    def api_nomina_recordatorio_individual(emp_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import listar_empleados
        empleados = listar_empleados()
        emp = next((e for e in empleados if e["id"] == emp_id), None)
        if not emp:
            return jsonify({"error": "Empleado no encontrado"}), 404
        telefono = (emp.get("telefono_wa") or "").strip()
        if not telefono:
            return jsonify({"error": "El empleado no tiene número de WhatsApp configurado"}), 400
        from app.utils import enviar_whatsapp_texto
        nombre = emp.get("nombre", "")
        sueldo = emp.get("sueldo_mensual", 0)
        dia = emp.get("dia_pago")
        msg = (
            f"Hola {nombre}, te informamos que tu pago de nómina "
            f"por ${sueldo:,.0f} COP está programado"
            + (f" para el día {dia} de este mes." if dia else ".")
            + "\n\nCualquier novedad, comunícate con el área administrativa. McKenna Group."
        )
        try:
            enviar_whatsapp_texto(f"{telefono}@c.us", msg)
            return jsonify({"ok": True, "enviado_a": telefono})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/nomina/empleados", methods=["GET"])
    def api_nomina_empleados_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import listar_empleados
        return jsonify({"empleados": listar_empleados()})

    @app.route("/api/nomina/empleados", methods=["POST"])
    def api_nomina_empleados_save():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(silent=True) or {}
        if not (data.get("nombre") or "").strip():
            return jsonify({"error": "Se requiere nombre"}), 400
        from app.services.contabilidad_db import upsert_empleado
        return jsonify(upsert_empleado(data))

    @app.route("/api/nomina/empleados/<int:emp_id>", methods=["DELETE"])
    def api_nomina_empleados_delete(emp_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import eliminar_empleado
        eliminar_empleado(emp_id)
        return jsonify({"ok": True})

    @app.route("/api/nomina/resumen", methods=["GET"])
    def api_nomina_resumen():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import resumen_nomina
        return jsonify(resumen_nomina())

    # ── Servicios públicos ────────────────────────────────────────────────────

    @app.route("/api/servicios", methods=["GET"])
    def api_servicios_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import listar_servicios
        return jsonify({"servicios": listar_servicios()})

    @app.route("/api/servicios", methods=["POST"])
    def api_servicios_save():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(silent=True) or {}
        if not (data.get("empresa") or "").strip():
            return jsonify({"error": "Se requiere empresa"}), 400
        from app.services.contabilidad_db import upsert_servicio
        return jsonify(upsert_servicio(data))

    @app.route("/api/servicios/<int:srv_id>", methods=["DELETE"])
    def api_servicios_delete(srv_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import eliminar_servicio
        eliminar_servicio(srv_id)
        return jsonify({"ok": True})

    @app.route("/api/servicios/<int:srv_id>/pago", methods=["POST"])
    def api_servicios_pago(srv_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(silent=True) or {}
        fecha = (data.get("fecha") or "").strip()
        monto = float(data.get("monto") or 0)
        if not fecha or monto <= 0:
            return jsonify({"error": "Se requieren fecha y monto > 0"}), 400
        from app.services.contabilidad_db import registrar_pago
        return jsonify(registrar_pago(srv_id, fecha, monto, data.get("comprobante", ""), data.get("notas", "")))

    @app.route("/api/servicios/pagos/<int:pago_id>", methods=["DELETE"])
    def api_servicios_pago_delete(pago_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.contabilidad_db import eliminar_pago
        eliminar_pago(pago_id)
        return jsonify({"ok": True})

    @app.route("/api/nomina/recordatorios", methods=["POST"])
    def api_nomina_recordatorios():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.rentabilidad import enviar_recordatorios_pagos
        return jsonify(enviar_recordatorios_pagos())

    @app.route("/api/facturas/escanear", methods=["POST"])
    def api_facturas_escanear():
        """Escanea Gmail y encola facturas para revisión humana en el panel."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.tools.importar_productos_siigo import escanear_facturas_gmail_para_panel
            from app.panel_activity import log_line
            body = request.get_json(silent=True) or {}
            fecha_desde = (body.get("fecha_desde") or "2026/01/01").strip()
            log_line("▶ escanear_facturas_gmail — inicio (panel)")
            resultado = escanear_facturas_gmail_para_panel(fecha_desde=fecha_desde)
            n = len(resultado.get("encoladas") or [])
            log_line(f"✔ escanear_facturas_gmail — {n} encolada(s)")
            return jsonify(resultado)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e), "mensaje": str(e)}), 502

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

        # ── Motor 1: Voicebox (Qwen3-TTS — clonación de voz Hugo) ───────────
        from app.services.tts_voicebox import voicebox_disponible, sintetizar_voicebox
        import time as _time
        if engine == "voicebox":
            # Si el servicio no responde ahora, esperar hasta 30 s antes de rendirse.
            # Voicebox puede estar cargando el modelo en el primer arranque del día.
            if not voicebox_disponible():
                _esperas = [3, 5, 8, 14]   # segundos entre reintentos (total ≤ 30 s)
                for _w in _esperas:
                    _time.sleep(_w)
                    if voicebox_disponible():
                        break
                else:
                    # Agotados los reintentos: solo falla si el motor fue forzado
                    if motor_forzado == "voicebox":
                        return jsonify({"error": "Voicebox no disponible tras reintentos"}), 503
            if voicebox_disponible():
                _ultimo_exc: Exception | None = None
                for _intento in range(3):  # hasta 3 intentos de síntesis
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
                        _ultimo_exc = exc
                        print(f"[Voz] Voicebox intento {_intento+1}/3 falló ({voicebox_profile}): {exc}")
                        if _intento < 2:
                            _time.sleep(3)
                if motor_forzado == "voicebox":
                    return jsonify({"error": f"Voicebox falló tras 3 intentos: {_ultimo_exc}"}), 500

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
        active       = bool(body.get("active", False))
        if not subscription or not subscription.get("endpoint"):
            return jsonify({"error": "subscription requerida"}), 400
        usuario_id = None
        try:
            from app.api_auth import bearer_token_from_request as _btfr
            from app.services.tickets_db import get_usuario_by_token as _gtu
            tok = _btfr()
            usuario = _gtu(tok) if tok else None
            if usuario:
                usuario_id = usuario["id"]
        except Exception:
            pass
        if not usuario_id:
            return jsonify({"error": "sesión de tickets requerida para push"}), 401
        set_schedule(subscription["endpoint"], subscription, minutes, active, usuario_id)
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

    @app.route("/api/voz/enviar-supervisor", methods=["POST"])
    def api_voz_enviar_supervisor():
        """Sintetiza texto y lo envía como nota de voz PTT vía el bridge supervisor (:3001).

        Body JSON: { "texto": "...", "numero": "573001234567" }
        """
        if not _voz_auth_ok():
            return jsonify({"error": "No autorizado"}), 401
        body   = request.get_json(force=True, silent=True) or {}
        texto  = (body.get("texto") or "").strip()[:1200]
        numero = (body.get("numero") or "").strip()
        if not texto:
            return jsonify({"error": "texto requerido"}), 400
        if not numero:
            return jsonify({"error": "numero requerido"}), 400

        # Sintetizar audio reutilizando la lógica de /api/voz/sintetizar
        from app.services.voz_config import leer_config
        cfg    = leer_config()
        engine = cfg.get("engine", "auto")

        audio_bytes = None
        mime_type   = "audio/wav"

        from app.services.tts_voicebox import voicebox_disponible, sintetizar_voicebox
        from app.services.tts_qwen3    import qwen3_disponible, sintetizar_qwen3

        if engine == "voicebox" and voicebox_disponible():
            try:
                from app.services.voz_config import resolver_voicebox_profile, voicebox_language_code
                profile  = resolver_voicebox_profile({}, cfg)
                voz_lang = voicebox_language_code(cfg.get("language"))
                audio_bytes = sintetizar_voicebox(texto, profile_id=profile, language=voz_lang)
            except Exception as exc:
                print(f"[voz-supervisor] Voicebox falló: {exc}")

        if audio_bytes is None and qwen3_disponible():
            try:
                audio_bytes = sintetizar_qwen3(texto,
                                               speaker=cfg.get("speaker"),
                                               language=cfg.get("language"))
            except Exception as exc:
                print(f"[voz-supervisor] Qwen3 falló: {exc}")

        if audio_bytes is None:
            eleven_key   = os.getenv("ELEVENLABS_API_KEY", "").strip()
            eleven_voice = os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9").strip()
            if eleven_key:
                import requests as _req
                try:
                    r = _req.post(
                        f"https://api.elevenlabs.io/v1/text-to-speech/{eleven_voice}",
                        headers={"xi-api-key": eleven_key, "Content-Type": "application/json"},
                        json={"text": texto, "model_id": "eleven_multilingual_v2",
                              "voice_settings": {"stability": 0.45, "similarity_boost": 0.80}},
                        timeout=30,
                    )
                    r.raise_for_status()
                    audio_bytes = r.content
                    mime_type   = "audio/mpeg"
                except Exception as exc:
                    print(f"[voz-supervisor] ElevenLabs falló: {exc}")

        if audio_bytes is None:
            return jsonify({"error": "Sin motor TTS disponible"}), 503

        from app.utils import enviar_voz_supervisor
        ok = enviar_voz_supervisor(numero, audio_bytes, mime_type)
        if ok:
            return jsonify({"status": "enviado", "numero": numero, "bytes": len(audio_bytes)})
        return jsonify({"error": "El bridge supervisor no está disponible (puerto 3001)"}), 503

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

    # ── Bridge supervisor (puerto 3001) ──────────────────────────────────────

    def _supervisor_bridge_url():
        base = os.getenv("SUPERVISOR_BRIDGE_URL", "").strip().rstrip("/")
        return base or f"http://127.0.0.1:{os.getenv('SUPERVISOR_PORT', '3001')}"

    def _supervisor_bridge_headers():
        tok = os.getenv("WHATSAPP_SUPERVISOR_TOKEN", "").strip()
        return {"X-Bridge-Token": tok} if tok else {}

    def _supervisor_bridge_get(path: str, timeout: int = 6):
        import requests as _req
        url = f"{_supervisor_bridge_url()}{path}"
        return _req.get(url, headers=_supervisor_bridge_headers(), timeout=timeout)

    def _supervisor_bridge_post(path: str, json_body=None, timeout: int = 8):
        import requests as _req
        url = f"{_supervisor_bridge_url()}{path}"
        return _req.post(url, headers=_supervisor_bridge_headers(), json=json_body or {}, timeout=timeout)

    def _audio_a_ogg_opus(audio_bytes: bytes) -> bytes:
        """Convierte audio (WAV/MP3/cualquier formato ffmpeg) a OGG Opus para PTT de WhatsApp."""
        import subprocess
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", "pipe:0",
                "-c:a", "libopus",
                "-b:a", "32k",
                "-vbr", "on",
                "-ar", "24000",
                "-ac", "1",
                "-f", "ogg",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0 or not result.stdout:
            raise RuntimeError(
                f"ffmpeg falló al convertir a OGG: {result.stderr.decode(errors='replace')[:300]}"
            )
        return result.stdout

    def _supervisor_status_payload():
        unit = "mckenna-whatsapp-supervisor"
        bridge_unit = _systemctl_is_active(unit)
        result = {
            "bridge_unit": unit,
            "bridge_estado": bridge_unit,
            "bridge_activo": bridge_unit == "active",
            "listo": False,
            "numero": None,
            "pushname": None,
            "qr_data_url": None,
            "qr_pendiente": False,
            "bridge_responde": False,
            "gemma_model": os.getenv("SUPERVISOR_GEMMA_MODEL", "gemma4:27b"),
            "mensaje": "",
        }
        try:
            r = _supervisor_bridge_get("/status", timeout=5)
            if r.status_code == 200:
                d = r.json()
                result["bridge_responde"] = True
                result["listo"]       = bool(d.get("listo"))
                result["numero"]      = d.get("numero")
                result["pushname"]    = d.get("pushname")
                result["gemma_model"] = d.get("gemma_model") or result["gemma_model"]
                qr_raw = d.get("ultimoQr")
                if qr_raw == "pendiente":
                    result["qr_pendiente"] = True
                if result["listo"]:
                    result["mensaje"] = "Supervisor conectado."
                elif result["qr_pendiente"]:
                    result["mensaje"] = "Escanea el QR con tu número personal."
                else:
                    result["mensaje"] = "Puente supervisor en marcha; sin sesión aún."
            else:
                result["mensaje"] = f"Puente respondió HTTP {r.status_code}"
        except Exception as e:
            result["mensaje"] = f"Bridge supervisor no responde ({e})"

        if result.get("qr_pendiente"):
            try:
                rq = _supervisor_bridge_get("/qr", timeout=6)
                if rq.status_code == 200:
                    qd = rq.json()
                    raw = qd.get("qr")
                    if raw:
                        result["qr_data_url"] = _wa_qr_raw_to_data_url(raw)
            except Exception:
                pass

        return result

    @app.route("/api/supervisor/bridge/status", methods=["GET"])
    @app.route("/app/api/supervisor/bridge/status", methods=["GET"])
    def api_supervisor_bridge_status():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        return jsonify(_supervisor_status_payload())

    @app.route("/api/supervisor/bridge/monitor", methods=["GET"])
    @app.route("/app/api/supervisor/bridge/monitor", methods=["GET"])
    def api_supervisor_bridge_monitor():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            r = _supervisor_bridge_get("/monitor", timeout=5)
            return jsonify(r.json() if r.status_code == 200 else {"actividad": []})
        except Exception as e:
            return jsonify({"actividad": [], "error": str(e)})

    @app.route("/api/supervisor/bridge/contactos", methods=["GET"])
    @app.route("/app/api/supervisor/bridge/contactos", methods=["GET"])
    def api_supervisor_contactos_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            r = _supervisor_bridge_get("/contactos", timeout=5)
            return jsonify(r.json() if r.status_code == 200 else {})
        except Exception as e:
            return jsonify({"error": str(e)}), 503

    @app.route("/api/supervisor/bridge/contactos", methods=["POST"])
    @app.route("/app/api/supervisor/bridge/contactos", methods=["POST"])
    def api_supervisor_contactos_post():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        nombre = (body.get("nombre") or "").strip()
        numero = (body.get("numero") or "").strip()
        if not nombre or not numero:
            return jsonify({"error": "nombre y numero requeridos"}), 400
        try:
            r = _supervisor_bridge_post("/contactos", {"nombre": nombre, "numero": numero}, timeout=5)
            if r.status_code == 200:
                return jsonify(r.json())
            return jsonify({"error": r.text[:200]}), r.status_code
        except Exception as e:
            return jsonify({"error": str(e)}), 503

    @app.route("/api/supervisor/bridge/desvincular", methods=["POST"])
    @app.route("/app/api/supervisor/bridge/desvincular", methods=["POST"])
    def api_supervisor_bridge_desvincular():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401

        unit = "mckenna-whatsapp-supervisor"
        import shutil
        import subprocess as _sp2

        # Intenta pedir al bridge que se desconecte limpiamente
        bridge_ok = False
        err_bridge = None
        try:
            r = _supervisor_bridge_post("/session/logout", {}, timeout=15)
            if r.status_code == 200:
                bridge_ok = True
            else:
                err_bridge = (r.text or "")[:200] or f"HTTP {r.status_code}"
        except Exception as e:
            err_bridge = str(e)

        if not bridge_ok:
            # Fallback: borrar sesión en disco + reiniciar servicio systemd
            auth_dir = os.path.normpath(
                os.path.join(_ROUTES_DIR, "..", "bot-supervisor", ".wwebjs_auth_supervisor")
            )
            def _fallback():
                try:
                    if os.path.isdir(auth_dir):
                        shutil.rmtree(auth_dir, ignore_errors=True)
                        print("🧹 [supervisor] Sesión borrada en disco (fallback panel).")
                except Exception as ex:
                    print(f"⚠️ [supervisor] No se pudo borrar {auth_dir}: {ex}")
                _sp2.run(
                    ["sudo", "systemctl", "--no-block", "restart", unit],
                    capture_output=True, text=True, timeout=15,
                )
            spawn_thread(_fallback, daemon=True)
            return jsonify({
                "status": "iniciado",
                "mensaje": (
                    "El bridge no respondió; sesión local borrada y servicio reiniciado. "
                    "El QR aparecerá en ~1 min."
                ),
                "detalle": err_bridge,
            })

        # Bridge respondió OK → solo reiniciar el servicio para que genere nuevo QR
        spawn_thread(
            lambda: _sp2.run(
                ["sudo", "systemctl", "--no-block", "restart", unit],
                capture_output=True, text=True, timeout=15,
            ),
            daemon=True,
        )
        return jsonify({
            "status": "iniciado",
            "mensaje": (
                "Sesión desvinculada. El bridge genera un QR nuevo; "
                "ábrelo en esta pestaña para escanear con tu número personal."
            ),
        })

    @app.route("/api/supervisor/bridge/enviar-voz", methods=["POST"])
    @app.route("/app/api/supervisor/bridge/enviar-voz", methods=["POST"])
    def api_supervisor_enviar_voz():
        """Sintetiza texto con TTS y lo envía como PTT vía el bridge supervisor (:3001)."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body   = request.get_json(force=True, silent=True) or {}
        texto  = (body.get("texto") or "").strip()[:1200]
        numero = (body.get("numero") or "").strip()
        if not texto:
            return jsonify({"error": "texto requerido"}), 400
        if not numero:
            return jsonify({"error": "numero requerido"}), 400

        from app.services.wa_jid import jid_preferido_para_envio
        numero = jid_preferido_para_envio(numero)

        # Sintetizar audio
        from app.services.voz_config import leer_config
        cfg    = leer_config()
        engine = cfg.get("engine", "auto")
        audio_bytes = None
        mime_type   = "audio/wav"

        from app.services.tts_voicebox import voicebox_disponible, sintetizar_voicebox
        from app.services.tts_qwen3    import qwen3_disponible, sintetizar_qwen3

        if engine == "voicebox" and voicebox_disponible():
            try:
                from app.services.voz_config import resolver_voicebox_profile, voicebox_language_code
                profile  = resolver_voicebox_profile({}, cfg)
                voz_lang = voicebox_language_code(cfg.get("language"))
                audio_bytes = sintetizar_voicebox(texto, profile_id=profile, language=voz_lang)
            except Exception as exc:
                print(f"[sup-voz] Voicebox: {exc}")

        if audio_bytes is None and qwen3_disponible():
            try:
                audio_bytes = sintetizar_qwen3(texto, speaker=cfg.get("speaker"), language=cfg.get("language"))
            except Exception as exc:
                print(f"[sup-voz] Qwen3: {exc}")

        if audio_bytes is None:
            eleven_key   = os.getenv("ELEVENLABS_API_KEY", "").strip()
            eleven_voice = os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9").strip()
            if eleven_key:
                import requests as _req
                try:
                    r = _req.post(
                        f"https://api.elevenlabs.io/v1/text-to-speech/{eleven_voice}",
                        headers={"xi-api-key": eleven_key, "Content-Type": "application/json"},
                        json={"text": texto, "model_id": "eleven_multilingual_v2",
                              "voice_settings": {"stability": 0.45, "similarity_boost": 0.80}},
                        timeout=30,
                    )
                    r.raise_for_status()
                    audio_bytes = r.content
                    mime_type   = "audio/mpeg"
                except Exception as exc:
                    print(f"[sup-voz] ElevenLabs: {exc}")

        if audio_bytes is None:
            return jsonify({"error": "Sin motor TTS disponible"}), 503

        # WhatsApp solo acepta OGG Opus para notas de voz.
        # WAV y otros formatos causan el error silencioso "t" en el bridge.
        try:
            audio_bytes = _audio_a_ogg_opus(audio_bytes)
            mime_type   = "audio/ogg; codecs=opus"
        except Exception as exc:
            print(f"[sup-voz] Conversión OGG falló: {exc}")
            return jsonify({"error": f"No se pudo convertir el audio a OGG: {exc}"}), 500

        import base64 as _b64
        payload = {
            "numero":      numero,
            "audioBase64": _b64.b64encode(audio_bytes).decode(),
            "mimeType":    mime_type,
        }
        try:
            r = _supervisor_bridge_post("/enviar-ptt", payload, timeout=30)
            if r.status_code == 200:
                return jsonify({"status": "enviado", "numero": numero, "bytes": len(audio_bytes)})
            try:
                err_msg = r.json().get("error", f"Error HTTP {r.status_code} del bridge")
            except Exception:
                err_msg = f"Error HTTP {r.status_code} del bridge"
            if "no lid" in err_msg.lower():
                err_msg = (
                    "WhatsApp no pudo resolver el contacto (LID). "
                    "Pide al cliente que escriba primero al número supervisor, "
                    "o envía desde el panel Agente WA donde ya está el chat."
                )
            http_code = r.status_code if r.status_code in (400, 401, 422, 503) else 502
            return jsonify({"error": err_msg}), http_code
        except Exception as e:
            return jsonify({"error": f"Bridge supervisor no disponible: {e}"}), 503

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
            "horario_en_servicio": _bot_en_horario_servicio(modos),
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

    @app.route("/api/bot/metricas", methods=["GET"])
    def api_bot_metricas_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_metricas import calcular_metricas

        dias = int(request.args.get("dias", 30))
        return jsonify(calcular_metricas(dias=dias))

    @app.route("/api/filtro-respuesta", methods=["POST"])
    def api_filtro_respuesta():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json(force=True, silent=True) or {}
        texto = (data.get("texto") or "").strip()
        if not texto:
            return jsonify({"error": "Texto vacío"}), 400
        contexto = (data.get("contexto") or "").strip()
        try:
            _prompt_sistema = (
                "Eres el asistente de comunicaciones de McKenna Group S.A.S., empresa de materias "
                "primas farmacéuticas y cosméticas con sede en Bogotá, Colombia. "
                "Tu tarea es reescribir mensajes de WhatsApp de operadores para que suenen "
                "cordiales, profesionales y claros, con el acento y modismos propios del habla rola "
                "(bogotana): usa 'usted' en lugar de 'tú', expresiones naturales como "
                "'con mucho gusto', 'claro que sí', 'no hay problema', 'quedamos pendientes', "
                "'estamos a sus órdenes', 'con toda'; si el cliente tiene nombre úsalo, si no, "
                "usa 'estimado/a cliente'. Evita tutear, evitar groserías o frases secas. "
                "Máximo 1–2 emojis si aportan; resuelve sin rodeos; cierra siempre con "
                "disposición de ayuda. "
                "Devuelve únicamente el texto del mensaje mejorado, sin explicaciones, "
                "sin encabezados, sin comillas. Conserva la misma información esencial."
            )
            _usuario = f"Reescribe este mensaje al cliente con tono profesional y cordial:\n\n{texto}"
            if contexto:
                _usuario = f"Contexto de la conversación: {contexto}\n\n{_usuario}"

            _anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
            _gemini_key = os.getenv("GOOGLE_API_KEY", "").strip()

            if _anthropic_key:
                import anthropic as _anthropic
                _cliente = _anthropic.Anthropic(api_key=_anthropic_key)
                _resp = _cliente.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=800,
                    system=_prompt_sistema,
                    messages=[{"role": "user", "content": _usuario}],
                )
                return jsonify({"texto_mejorado": _resp.content[0].text.strip()})
            elif _gemini_key:
                from google import genai as _genai
                _gc = _genai.Client(api_key=_gemini_key)
                _full = f"{_prompt_sistema}\n\n{_usuario}"
                _resp = _gc.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=_full,
                )
                return jsonify({"texto_mejorado": (_resp.text or "").strip()})
            else:
                return jsonify({"error": "No hay API key de IA configurada (ANTHROPIC_API_KEY o GOOGLE_API_KEY)"}), 500
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/alertas/intencion", methods=["GET"])
    def api_alertas_intencion_get():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_alertas_intencion import listar_pendientes
        return jsonify({"alertas": listar_pendientes()})

    @app.route("/api/alertas/intencion/<path:jid>", methods=["DELETE"])
    def api_alertas_intencion_cancelar(jid: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_alertas_intencion import cancelar
        cancelar(jid, razon="panel")
        return jsonify({"ok": True})

    # ── Chats WhatsApp (historial de conversaciones) ──────────────────────────

    @app.route("/api/bot/chats", methods=["GET"])
    def api_bot_chats_lista():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_chats import listar_conversaciones as _lc, total_no_leidos as _tnl
        limit = min(int(request.args.get("limit", 60)), 200)
        from app.services.wa_jid import info_contacto_jid, limpiar_aliases_falsos, modo_para_jid

        limpiar_aliases_falsos()
        from app.services.wa_chats import reparar_jids_falsos_en_db

        reparar_jids_falsos_en_db()
        conversaciones = _lc(limit=limit)
        modos = cargar_modos_atencion()
        humanos = modos.get("numeros_en_humano", [])
        silenciados = modos.get("numeros_silenciados", [])
        for c in conversaciones:
            jid = c.get("jid", "")
            c["modo"] = modo_para_jid(jid, humanos, silenciados)
            info = info_contacto_jid(jid)
            c["display"] = info.get("display") or jid
            c["telefono"] = info.get("telefono")
            c["es_lid"] = bool(info.get("es_lid"))
            c["jid_raw"] = jid
            if c.get("direccion") == "entrada":
                c["ultimo_remitente"] = "cliente"
            elif c.get("enviado_por") == "humano":
                c["ultimo_remitente"] = "asesor"
            elif c.get("enviado_por") == "bot":
                c["ultimo_remitente"] = "bot"
            else:
                c["ultimo_remitente"] = "salida"
        return jsonify({"conversaciones": conversaciones, "no_leidos_total": _tnl()})

    @app.route("/api/bot/chats/<path:jid>", methods=["GET"])
    def api_bot_chats_mensajes(jid: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_chats import listar_mensajes as _lm, marcar_leido as _ml
        limit = min(int(request.args.get("limit", 200)), 300)
        from app.services.wa_jid import info_contacto_jid, modo_para_jid

        mensajes = _lm(jid, limit=limit)
        _ml(jid)
        modos = cargar_modos_atencion()
        humanos = modos.get("numeros_en_humano", [])
        silenciados = modos.get("numeros_silenciados", [])
        modo = modo_para_jid(jid, humanos, silenciados)
        info = info_contacto_jid(jid)
        return jsonify({
            "mensajes": mensajes,
            "modo": modo,
            "jid": jid,
            "display": info.get("display") or jid,
            "telefono": info.get("telefono"),
            "es_lid": bool(info.get("es_lid")),
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
        alias = body.get("alias") or {}
        lid_a = str(alias.get("lid") or "").strip()
        phone_a = str(alias.get("phone") or "").strip()
        if lid_a and phone_a:
            from app.services.wa_jid import registrar_alias_lid

            registrar_alias_lid(lid_a, phone_a)
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

    @app.route("/api/bot/chats/sincronizar-recientes", methods=["POST"])
    def api_bot_chats_sincronizar_recientes():
        """Reconcilia chats con mensajes no leídos (respuestas desde el celular)."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        max_chats = min(int(body.get("max_chats", 12)), 20)
        per_chat = min(int(body.get("limit", 40)), 60)
        from app.services.wa_chats import listar_conversaciones as _lc

        candidatos = [
            c for c in _lc(limit=80) if int(c.get("no_leidos") or 0) > 0
        ][:max_chats]
        if not candidatos:
            candidatos = _lc(limit=max_chats)
        resultados = []
        errores = []
        for conv in candidatos:
            jid = conv.get("jid") or ""
            if not jid:
                continue
            try:
                r = _whatsapp_bridge_json(
                    "post",
                    "/chats/sync",
                    timeout=50,
                    json={"jid": jid, "limit": per_chat},
                )
                if r.status_code == 200:
                    payload = r.json() if r.content else {}
                    resultados.append(
                        {
                            "jid": jid,
                            "sincronizados": payload.get("sincronizados", 0),
                        }
                    )
                else:
                    errores.append({"jid": jid, "error": (r.text or "")[:120]})
            except Exception as e:
                errores.append({"jid": jid, "error": str(e)[:120]})
        return jsonify(
            {
                "ok": True,
                "chats": len(resultados),
                "resultados": resultados,
                "errores": errores,
            }
        )

    @app.route("/api/bot/media", methods=["GET"])
    def api_bot_media():
        """Sirve adjuntos guardados en comprobantes/ (panel Agente WA)."""
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.wa_chats import resolver_media_absoluto
        from flask import send_file

        rel = (request.args.get("path") or "").strip()
        abs_path = resolver_media_absoluto(rel)
        if not abs_path:
            return jsonify({"error": "Archivo no encontrado"}), 404
        return send_file(abs_path, conditional=True)

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
        from app.services.wa_jid import jids_relacionados

        item = _bget(item_id)
        if not item:
            return jsonify({"error": "ítem no encontrado"}), 404
        destinos = list(jids_relacionados(jid))
        destino_envio = next((d for d in destinos if d.endswith("@lid")), None)
        if not destino_envio:
            destino_envio = next((d for d in destinos if d.endswith("@c.us")), jid)
        tipo = item["tipo"]
        try:
            if tipo == "texto":
                ok = enviar_whatsapp_reporte(item["contenido"], numero_destino=destino_envio)
                if ok:
                    _wag(jid, "salida", item["contenido"], False, "", "humano")
            elif tipo == "link":
                msg = f"{item['titulo']}\n{item['url']}" if item["titulo"] else item["url"]
                ok = enviar_whatsapp_reporte(msg, numero_destino=destino_envio)
                if ok:
                    _wag(jid, "salida", msg, False, "", "humano")
            elif tipo == "archivo":
                ruta = _barch(item_id)
                if not ruta:
                    return jsonify({"error": "archivo físico no encontrado"}), 404
                ok = enviar_whatsapp_archivo(
                    ruta, item.get("titulo", ""), item["nombre_arch"], destino_envio
                )
                if ok:
                    _wag(
                        jid,
                        "salida",
                        f"[Archivo: {item['nombre_arch']}]",
                        True,
                        item["nombre_arch"],
                        "humano",
                    )
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

    # ── Etiquetas Epson CW-C4000u ──────────────────────────────────────────────

    _ELPU_PATH = "/opt/epson/epson-label-printer-utility/elpu"
    _PRINTER_NAME = "CW-C4000u"
    _PDF_DIR = os.path.expanduser("~/Documentos")
    _PDF_ETIQUETAS_SUBDIR = "Etiquetas McKenna"
    _PDF_ETIQUETAS_DIR = os.path.join(_PDF_DIR, _PDF_ETIQUETAS_SUBDIR)
    _ETIQUETAS_PDFS_GUARDADOS_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_pdfs_guardados.json",
    )
    _PDF_ETIQUETAS_MAX_BYTES = 30 * 1024 * 1024
    _REPO_EPSON_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "epson")

    def _carpeta_pdfs_etiquetas():
        os.makedirs(_PDF_ETIQUETAS_DIR, exist_ok=True)
        return _PDF_ETIQUETAS_DIR

    def _nombre_pdf_etiqueta_seguro(nombre: str) -> str:
        import re as _re
        base = os.path.basename((nombre or "").strip()) or "etiqueta.pdf"
        base = _re.sub(r"[^\w.\- áéíóúÁÉÍÓÚñÑ]", "_", base, flags=_re.UNICODE)
        if not base.lower().endswith(".pdf"):
            base = f"{base}.pdf"
        return base[:180]

    def _load_pdfs_guardados_etiquetas() -> list:
        try:
            with open(_ETIQUETAS_PDFS_GUARDADOS_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return []
        items = data.get("archivos") if isinstance(data, dict) else []
        if not isinstance(items, list):
            return []
        out = []
        for it in items:
            if not isinstance(it, dict):
                continue
            ruta = it.get("ruta_completa") or ""
            if ruta and os.path.isfile(ruta):
                out.append(it)
        out.sort(key=lambda x: x.get("subido_at") or "", reverse=True)
        return out

    def _registrar_pdf_guardado_etiqueta(nombre: str, ruta_completa: str, bytes_size: int) -> dict:
        os.makedirs(os.path.dirname(_ETIQUETAS_PDFS_GUARDADOS_PATH), exist_ok=True)
        try:
            with open(_ETIQUETAS_PDFS_GUARDADOS_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            data = {"archivos": []}
        except Exception:
            data = {"archivos": []}
        archivos = [a for a in data.get("archivos", []) if a.get("ruta_completa") != ruta_completa]
        rel = os.path.relpath(ruta_completa, _PDF_DIR) if ruta_completa.startswith(_PDF_DIR) else nombre
        entry = {
            "nombre": nombre,
            "ruta": rel.replace("\\", "/"),
            "ruta_completa": ruta_completa,
            "subido_at": _dt.now().isoformat(timespec="seconds"),
            "bytes": bytes_size,
        }
        archivos.insert(0, entry)
        data["archivos"] = archivos[:200]
        with open(_ETIQUETAS_PDFS_GUARDADOS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return entry

    _ETIQUETAS = {
        "30 mL": (102, 38), "5 mL": (66, 22), "125 g": (70, 70),
        "250 g": (76, 66), "1 Lt": (108, 76),
        "100 g": (69, 51), "Lactato": (38, 140), "Circular": (55, 55),
        "Circular 70": (70, 70), "5 g": (50, 42), "54mm": (54, 58),
    }
    # PDF apaisado → rotación por defecto al imprimir en rollo estrecho
    _ETIQUETAS_ROTACION = {"Lactato": "90"}
    _ETIQUETAS_MAX_MM = (108.0, 406.4)  # CW-C4000u: ancho × avance (PPD)

    _ETIQUETAS_TIPOS_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_tipos.json",
    )

    def _default_etiquetas_tipos():
        return [
            {"nombre": k, "ancho_mm": float(v[0]), "alto_mm": float(v[1])}
            for k, v in _ETIQUETAS.items()
        ]

    def _normalizar_tipos_etiquetas(items, *, fallback_default: bool = True) -> list:
        if not isinstance(items, list):
            return _default_etiquetas_tipos() if fallback_default else []
        max_ancho, max_alto = _ETIQUETAS_MAX_MM
        out = []
        seen = set()
        for it in items:
            if not isinstance(it, dict):
                continue
            nombre = (it.get("nombre") or "").strip()
            if not nombre or nombre in seen:
                continue
            try:
                ancho = float(it.get("ancho_mm") or 0)
                alto = float(it.get("alto_mm") or 0)
            except (TypeError, ValueError):
                continue
            if ancho <= 0 or alto <= 0 or ancho > max_ancho or alto > max_alto:
                continue
            seen.add(nombre)
            out.append({
                "nombre": nombre,
                "ancho_mm": round(ancho, 2),
                "alto_mm": round(alto, 2),
            })
        out.sort(key=lambda x: x["nombre"].lower())
        if out:
            return out
        return _default_etiquetas_tipos() if fallback_default else []

    def _load_etiquetas_tipos() -> list:
        try:
            with open(_ETIQUETAS_TIPOS_PATH, encoding="utf-8") as f:
                data = json.load(f)
            tipos = data.get("tipos") if isinstance(data, dict) else None
            if isinstance(tipos, list) and tipos:
                return _normalizar_tipos_etiquetas(tipos)
        except FileNotFoundError:
            pass
        except Exception:
            pass
        return _default_etiquetas_tipos()

    def _save_etiquetas_tipos(tipos: list) -> tuple[list | None, str | None]:
        if not isinstance(tipos, list) or not tipos:
            return None, "Envía al menos un formato en «tipos»"
        normalizados = _normalizar_tipos_etiquetas(tipos, fallback_default=False)
        if not normalizados:
            max_ancho, max_alto = _ETIQUETAS_MAX_MM
            return None, (
                f"Ningún formato válido. Nombre obligatorio; "
                f"ancho 1–{max_ancho:g} mm y alto 1–{max_alto:g} mm."
            )
        os.makedirs(os.path.dirname(_ETIQUETAS_TIPOS_PATH), exist_ok=True)
        with open(_ETIQUETAS_TIPOS_PATH, "w", encoding="utf-8") as f:
            json.dump({"tipos": normalizados}, f, ensure_ascii=False, indent=2)
        return normalizados, None

    def _etiquetas_tipos_map() -> dict:
        return {t["nombre"]: (t["ancho_mm"], t["alto_mm"]) for t in _load_etiquetas_tipos()}

    def _dimensiones_etiqueta(producto: str, ancho_mm=None, alto_mm=None):
        try:
            if ancho_mm is not None and alto_mm is not None:
                a = float(ancho_mm)
                h = float(alto_mm)
                if a > 0 and h > 0:
                    return a, h
        except (TypeError, ValueError):
            pass
        mp = _etiquetas_tipos_map()
        if producto in mp:
            return mp[producto]
        return _ETIQUETAS.get(producto)

    _MAPEO_FORMA = {
        "Diecut_Gap": "Diecut_Gap",
        "Diecut_Blackmark": "Diecut_Blackmark",
        "Contlabel_no_detection": "Contlabel_no_detection",
    }
    _MAPEO_FORM_DETECTION_ELPU = {
        # Gap se controla solo vía CUPS MediaForm=Diecut_Gap (elpu Gap→N rompe detección).
        "Diecut_Blackmark": "W",
    }
    _MAPEO_CALIDAD_ELPU = {
        "MaxSpeed": "D", "Speed": "S", "Normal": "N", "Quality": "Q", "MaxQuality": "M",
    }
    _MAPEO_ROTACION = {"0": "3", "90": "4"}
    _LOTE_PREFIJO_ETI = "LOT."
    _EXP_PREFIJO_ETI = "EXP."

    def _con_prefijo_lote_etiqueta(val):
        v = (val or "").strip()
        if not v:
            return _LOTE_PREFIJO_ETI
        vu = v.upper()
        if vu.startswith(_LOTE_PREFIJO_ETI.upper()):
            return v
        if vu.startswith("LOT"):
            return _LOTE_PREFIJO_ETI + v[3:].lstrip(". ")
        return _LOTE_PREFIJO_ETI + v

    def _con_prefijo_exp_etiqueta(val):
        v = (val or "").strip()
        if not v:
            return _EXP_PREFIJO_ETI
        vu = v.upper()
        if vu.startswith(_EXP_PREFIJO_ETI.upper()):
            return v
        if vu.startswith("EXP"):
            return _EXP_PREFIJO_ETI + v[3:].lstrip(". ")
        return _EXP_PREFIJO_ETI + v

    def _lote_impresion_etiqueta(val):
        v = (val or "").strip()
        return "" if not v or v == _LOTE_PREFIJO_ETI else v

    def _exp_impresion_etiqueta(val):
        v = (val or "").strip()
        return "" if not v or v == _EXP_PREFIJO_ETI else v

    def _rotacion_etiqueta_valida(val):
        """Solo 0° y 90°; 180/270 legacy se normalizan a 0."""
        return "90" if str(val).strip() == "90" else "0"

    _MAPEO_CALIDAD = {
        "MaxSpeed": "MaxSpeed", "Speed": "Speed", "Normal": "Normal",
        "Quality": "Quality", "MaxQuality": "MaxQuality",
    }

    _PATRONES_ERROR_IMPRESORA_ETI = (
        (
            ("deshabilitad", "disabled", "printer is disabled"),
            "Impresora deshabilitada",
            "Conecta el cable USB de la Epson CW-C4000u y pulsa «Instalar» en el panel de etiquetas.",
            "deshabilitada",
        ),
        (
            ("en pausa", "paused", "printer is paused", "pausad"),
            "Impresora en pausa",
            "En el panel pulsa «Instalar impresora» o ejecuta: sudo cupsenable CW-C4000u && sudo cupsaccept CW-C4000u",
            "pausada",
        ),
        (
            ("no such file", "no existe", "unknown printer", "does not exist", "unable to locate printer", "no destination"),
            "Impresora no registrada en CUPS",
            "Pulsa «Instalar impresora» en el panel para registrar la Epson CW-C4000u con el driver correcto.",
            "no_registrada",
        ),
        (
            ("password is required", "contraseña", "nopasswd", "sudoers"),
            "Sin permisos para configurar la impresora (sudo)",
            "Ejecuta la instalación desde el panel («Instalar impresora») o configura sudoers para elpu sin contraseña.",
            "sudo",
        ),
        (
            ("elpu", "epson-label-printer"),
            "Utilidad ELPU no disponible",
            "Instala elpu desde el asistente «Instalar impresora» o coloca el binario en scripts/epson/elpu.",
            "elpu",
        ),
        (
            ("out of paper", "media tray empty", "sin papel", "sin etiquetas", "load paper", "cargue"),
            "Sin etiquetas o rollo vacío",
            "Carga el rollo de etiquetas en la bandeja y verifica que el sensor de gap/blackmark coincida con el tipo elegido.",
            "sin_papel",
        ),
        (
            ("cover open", "tapa abierta", "door open", "cabezal"),
            "Tapa o cabezal abierto",
            "Cierra la tapa frontal de la impresora y espera a que deje de parpadear el LED de error.",
            "tapa_abierta",
        ),
        (
            ("communication", "comunicación", "device not found", "i/o error",
             "status_commerror", "commerror"),
            "Error de comunicación USB",
            "Enciende la impresora, reconecta el cable USB (sin hub), reiníciala 30 s y pulsa «Instalar impresora». "
            "Si la cola tiene trabajos atascados, el panel los limpia al reintentar.",
            "sin_conexion",
        ),
        (
            ("resources-are-not-ready",),
            "Impresora no lista para imprimir",
            "Espera a que termine de inicializar, cierra la tapa si está abierta y verifica que el rollo de etiquetas esté cargado.",
            "sin_papel",
        ),
        (
            ("backend epsonusb returned status 1", "backend epsonusb returned"),
            "La impresora rechazó el trabajo de impresión",
            "Carga el rollo de etiquetas, alinea las guías y elige el sensor correcto (gap o blackmark). "
            "Si el LCD de la Epson muestra error, reiníciala 30 s.",
            "backend_fallo",
        ),
        (
            ("filter failed", "document-format-not-supported", "unsupported document"),
            "El PDF no es compatible con la impresora",
            "Abre el PDF en la pestaña «Editar PDF», guárdalo de nuevo o exporta como PDF estándar (sin protección).",
            "pdf_invalido",
        ),
        (
            ("service-unavailable", "connection refused", "failed to connect", "cups"),
            "Servicio CUPS no disponible",
            "Activa CUPS: sudo systemctl enable --now cups. Luego pulsa «Instalar impresora» en el panel.",
            "cups_inactivo",
        ),
        (
            ("ink", "tinta", "maintenance", "mantenimiento", "waste"),
            "Mantenimiento o consumible de la impresora",
            "Revisa en el panel de la Epson si pide limpieza del cabezal, cambio de cartucho o vaciado del contenedor de residuos.",
            "mantenimiento",
        ),
        (
            ("jam", "atasc", "stuck"),
            "Atasco de etiquetas",
            "Abre la impresora, retira etiquetas atascadas con cuidado y vuelve a cargar el rollo alineado con las guías.",
            "atasco",
        ),
    )

    def _interpretar_error_impresora_etiquetas(
        texto: str,
        *,
        producto: str = "",
        forma: str = "",
    ) -> tuple:
        """Devuelve (mensaje_corto, solucion, codigo) a partir de salida lp/elpu/CUPS."""
        t = (texto or "").strip()
        tl = t.lower()

        def _fallo_backend_sin_error_lcd(salida_elpu: str) -> tuple:
            """CUPS/epsonUSB falló pero ELPU no reporta Status_ER_* (LCD puede estar en Listo)."""
            tam = _ETIQUETAS.get(producto, (102, 38))
            sensor = {
                "Diecut_Gap": "troquelada con gap (separación entre etiquetas)",
                "Diecut_Blackmark": "troquelada con marca negra",
                "Contlabel_no_detection": "continua sin detección",
            }.get(forma, "troquelada gap o blackmark")
            det_elpu = ""
            if salida_elpu:
                st = _valor_linea_elpu(salida_elpu, "status") or ""
                fd = _valor_linea_elpu(salida_elpu, "formDetectionType") or ""
                if st or fd:
                    det_elpu = f" ELPU: {st}; sensor={fd or '?'}"
            return (
                "CUPS no pudo imprimir (impresora conectada, LCD sin error)",
                (
                    f"El driver rechazó el trabajo — no es un fallo USB. "
                    f"Revisa en el panel: producto {producto or '30 mL'} ({tam[0]}×{tam[1]} mm), "
                    f"sensor {sensor}. Prueba el otro tipo (Gap ↔ Blackmark) si no imprime. "
                    f"Pulsa «Instalar impresora» y reintenta.{det_elpu}"
                ),
                "backend_fallo",
            )

        # Fallo del backend epsonUSB: no usar Status_IL_* (idle) como «sin rollo».
        if "backend epsonusb returned" in tl:
            _asegurar_elioud_etiquetas()
            salida = _salida_elpu_status_etiquetas()
            clave = _clave_status_elpu_etiquetas(_valor_linea_elpu(salida, "status") or "")
            if clave.startswith("Status_IL_") or not clave.startswith("Status_ER_"):
                if salida:
                    alerta = _alerta_impresora_etiquetas(
                        salida_elpu=salida,
                        estado_cups=_estado_cups_etiquetas(),
                    )
                    if alerta and alerta.get("severidad") == "error":
                        return (
                            alerta.get("error", "La impresora rechazó el trabajo"),
                            alerta.get("solucion", "Revisa el panel LCD de la Epson."),
                            alerta.get("codigo", "backend_fallo"),
                        )
                return _fallo_backend_sin_error_lcd(salida)
            if salida:
                alerta = _alerta_impresora_etiquetas(
                    salida_elpu=salida,
                    estado_cups=_estado_cups_etiquetas(),
                )
                if alerta:
                    return (
                        alerta.get("error", "La impresora rechazó el trabajo"),
                        alerta.get("solucion", "Revisa el panel LCD de la Epson."),
                        alerta.get("codigo", "backend_fallo"),
                    )
            if _impresora_conectada_cups_etiquetas():
                return _fallo_backend_sin_error_lcd(salida)
            for patrones, error, solucion, codigo in _PATRONES_ERROR_IMPRESORA_ETI:
                if any(p in tl for p in patrones):
                    return error, solucion, codigo

        for patrones, error, solucion, codigo in _PATRONES_ERROR_IMPRESORA_ETI:
            if any(p in tl for p in patrones):
                return error, solucion, codigo
        if t:
            return (
                t[:200] + ("…" if len(t) > 200 else ""),
                "Revisa el cable USB, que la impresora esté encendida y pulsa «Instalar impresora». Si persiste, abre el log del panel.",
                "desconocido",
            )
        return (
            "La impresora rechazó el trabajo de impresión",
            "Verifica conexión USB, rollo cargado y pulsa «Instalar impresora» en el panel.",
            "desconocido",
        )

    def _verificar_impresora_etiquetas() -> dict | None:
        """Pre-vuelo antes de imprimir. None = OK; dict con error/solucion/codigo si falla."""
        import subprocess as _sp
        import shutil as _shutil

        try:
            r_cups = _sp.run(
                ["systemctl", "is-active", "cups"],
                capture_output=True, text=True, timeout=5,
            )
            if r_cups.stdout.strip() != "active":
                return {
                    "error": "Servicio CUPS inactivo",
                    "solucion": "Ejecuta: sudo systemctl enable --now cups. Luego pulsa «Instalar impresora».",
                    "codigo": "cups_inactivo",
                    "detalle": r_cups.stdout.strip() or r_cups.stderr.strip(),
                }
        except Exception as e:
            return {
                "error": "No se pudo comprobar CUPS",
                "solucion": "Verifica que CUPS esté instalado: sudo apt install cups. Reinicia el servicio agente-pro.",
                "codigo": "cups_inactivo",
                "detalle": str(e),
            }

        try:
            r = _sp.run(
                ["lpstat", "-p", _PRINTER_NAME],
                capture_output=True, text=True, timeout=5,
            )
            estado = (r.stdout + r.stderr).strip()
            el = estado.lower()
            if r.returncode != 0 or "unknown" in el or "does not exist" in el or "no existe" in el:
                return {
                    "error": "Impresora CW-C4000u no registrada",
                    "solucion": "Pulsa «Instalar impresora» en el panel para registrarla con el driver Epson.",
                    "codigo": "no_registrada",
                    "detalle": estado,
                }
            if "disabled" in el or "deshabilitad" in el:
                return {
                    "error": "Impresora deshabilitada",
                    "solucion": "Conecta el cable USB y pulsa «Instalar impresora», o ejecuta: sudo cupsenable CW-C4000u",
                    "codigo": "deshabilitada",
                    "detalle": estado,
                }
            if _cups_en_pausa_etiquetas(estado):
                _despausar_impresora_etiquetas()
                estado = _estado_cups_etiquetas()
                el = estado.lower()
                if _cups_en_pausa_etiquetas(estado):
                    return {
                        "error": "Impresora en pausa",
                        "solucion": "Pulsa «Instalar impresora» o ejecuta: sudo cupsenable CW-C4000u && sudo cupsaccept CW-C4000u",
                        "codigo": "pausada",
                        "detalle": estado,
                    }
            if "printer-state-reasons=" in el:
                import re as _re_pf
                m = _re_pf.search(r"printer-state-reasons=([^\s]+)", estado)
                razones = (m.group(1) if m else "").lower()
                if razones and razones not in ("none", "offline-report"):
                    err, sol, cod = _interpretar_error_impresora_etiquetas(razones)
                    return {
                        "error": err,
                        "solucion": sol,
                        "codigo": cod,
                        "detalle": razones,
                    }
        except Exception as e:
            return {
                "error": "No se pudo consultar el estado de la impresora",
                "solucion": "Reinicia CUPS (sudo systemctl restart cups) y vuelve a intentar.",
                "codigo": "estado",
                "detalle": str(e),
            }

        if not os.path.isfile(_ELPU_PATH) and not _shutil.which("elpu"):
            return {
                "error": "Utilidad ELPU no instalada",
                "solucion": "Pulsa «Instalar impresora» en el panel para instalar elpu (ajuste de posición).",
                "codigo": "elpu",
                "detalle": _ELPU_PATH,
            }

        return None

    def _respuesta_error_impresion_etiquetas(
        log_lines: list,
        texto: str,
        *,
        producto: str = "",
        forma: str = "",
    ) -> dict:
        error, solucion, codigo = _interpretar_error_impresora_etiquetas(
            texto, producto=producto, forma=forma,
        )
        return {
            "ok": False,
            "log": log_lines,
            "error": error,
            "solucion": solucion,
            "codigo": codigo,
        }

    _ELIOUD_PATH = "/opt/epson/epson-printer-io-community/elioud1"

    def _elpu_binario_etiquetas() -> str:
        import shutil as _shutil
        if os.path.isfile(_ELPU_PATH):
            return _ELPU_PATH
        return _shutil.which("elpu") or ""

    def _uri_dispositivo_etiquetas() -> str:
        import subprocess as _sp
        try:
            r = _sp.run(
                ["lpstat", "-v", _PRINTER_NAME],
                capture_output=True, text=True, timeout=5,
            )
            for line in (r.stdout or "").splitlines():
                ll = line.lower()
                if "dispositivo para" in ll or "device for" in ll:
                    partes = line.split(":", 1)
                    if len(partes) > 1:
                        return partes[1].strip()
        except Exception:
            pass
        return ""

    def _uri_usb_cups_desde_uri(uri: str) -> str:
        """Normaliza a usb:// (CUPS imprime bien; epsonUSB:// falla con status 1)."""
        uri = (uri or "").strip()
        if uri.startswith("usb://"):
            return uri
        if uri.startswith("epsonUSB://"):
            return "usb://" + uri[len("epsonUSB://"):]
        return uri

    def _uri_epson_usb_desde_usb(uri: str) -> str:
        uri = (uri or "").strip()
        if uri.startswith("epsonUSB://"):
            return uri
        if uri.startswith("usb://"):
            return "epsonUSB://" + uri[len("usb://"):]
        return uri

    def _asegurar_backend_usb_cups_etiquetas() -> tuple[str, bool]:
        """CUPS debe usar usb://; epsonUSB:// provoca «Backend epsonUSB returned status 1»."""
        import subprocess as _sp

        uri = _uri_dispositivo_etiquetas()
        nueva = _uri_usb_cups_desde_uri(uri)
        if not nueva or nueva == uri:
            return uri or nueva, False
        try:
            for cmd_base in (["sudo", "-n", "lpadmin"], ["sudo", "lpadmin"], ["lpadmin"]):
                r = _sp.run(
                    cmd_base + ["-p", _PRINTER_NAME, "-v", nueva],
                    capture_output=True, text=True, timeout=15,
                )
                if r.returncode == 0:
                    for en in (["sudo", "-n", "cupsenable"], ["cupsenable"]):
                        _sp.run(en + [_PRINTER_NAME], capture_output=True, timeout=10)
                    for ac in (["sudo", "-n", "cupsaccept"], ["cupsaccept"]):
                        _sp.run(ac + [_PRINTER_NAME], capture_output=True, timeout=10)
                    return nueva, True
        except Exception:
            pass
        return uri, False

    def _corregir_backend_epson_usb_etiquetas() -> tuple[str, bool]:
        """Compat: delega en usb:// (epsonUSB ya no se fuerza — rompía la impresión)."""
        return _asegurar_backend_usb_cups_etiquetas()

    def _elioud_estado_etiquetas() -> tuple[int, int]:
        """Devuelve (procesos totales, árboles raíz). Un árbol sano = 1 raíz + workers."""
        import subprocess as _sp
        try:
            r = _sp.run(
                ["pgrep", "-x", "elioud1"],
                capture_output=True, text=True, timeout=3,
            )
            if r.returncode != 0:
                return 0, 0
            pids = {int(x) for x in (r.stdout or "").split() if x.strip().isdigit()}
            if not pids:
                return 0, 0
            raices = 0
            for pid in pids:
                try:
                    with open(f"/proc/{pid}/stat", encoding="utf-8", errors="replace") as f:
                        ppid = int(f.read().split()[3])
                    if ppid not in pids:
                        raices += 1
                except Exception:
                    continue
            return len(pids), raices
        except Exception:
            return 0, 0

    def _reiniciar_elioud_etiquetas() -> bool:
        """Reinicia el daemon Epson I/O (evita DaemonStop con instancias duplicadas)."""
        import subprocess as _sp
        import time as _time
        if not os.path.isfile(_ELIOUD_PATH):
            return False
        try:
            for cmd in (
                ["sudo", "-n", "pkill", "-x", "elioud1"],
                ["sudo", "pkill", "-x", "elioud1"],
                ["pkill", "-x", "elioud1"],
            ):
                _sp.run(cmd, capture_output=True, text=True, timeout=3)
            _time.sleep(0.6)
            for cmd in (
                ["sudo", "-n", _ELIOUD_PATH],
                ["sudo", _ELIOUD_PATH],
                [_ELIOUD_PATH],
            ):
                try:
                    _sp.Popen(
                        cmd,
                        stdout=_sp.DEVNULL,
                        stderr=_sp.DEVNULL,
                        start_new_session=True,
                    )
                    break
                except Exception:
                    continue
            _time.sleep(1.2)
            _, raices = _elioud_estado_etiquetas()
            return raices == 1
        except Exception:
            return False

    def _elioud_corriendo_etiquetas() -> bool:
        """True si hay un solo árbol elioud1 (no cero ni duplicados)."""
        _, raices = _elioud_estado_etiquetas()
        return raices == 1

    def _salida_elpu_fallo(salida: str) -> bool:
        """elpu suele devolver rc=0 aunque falle la comunicación USB."""
        t = (salida or "").lower()
        lineas = [ln.strip() for ln in t.splitlines()]
        return (
            "error" in lineas
            or "status_commerror" in t
            or "commerror" in t
            or "communication error" in t
        )

    def _id_trabajo_desde_lp(salida: str) -> str | None:
        import re as _re
        for pat in (r"request id is\s+(\S+)", r"id solicitada es\s+(\S+)"):
            m = _re.search(pat, salida or "", _re.I)
            if m:
                return m.group(1).rstrip("(")
        return None

    def _bloque_trabajo_cups_etiquetas(job_id: str) -> str:
        """Detalle de un trabajo vía lpstat -l (lpstat -l -o ID falla en CUPS en español)."""
        import subprocess as _sp

        if not job_id:
            return ""
        r = _sp.run(["lpstat", "-l"], capture_output=True, text=True, timeout=8)
        texto = (r.stdout or "").strip()
        if not texto:
            return (r.stderr or "").strip()
        bloque: list[str] = []
        capturando = False
        for linea in texto.splitlines():
            if linea.startswith(job_id):
                capturando = True
                bloque = [linea]
            elif capturando:
                if linea.startswith("\t"):
                    bloque.append(linea)
                elif bloque:
                    break
        return "\n".join(bloque)

    def _fallo_trabajo_cups_en_log(job_num: str) -> str:
        """Busca en error_log de CUPS si un trabajo terminó en failed."""
        if not job_num:
            return ""
        try:
            with open("/var/log/cups/error_log", "r", encoding="utf-8", errors="replace") as f:
                tail = f.read()[-16000:]
            for line in reversed(tail.splitlines()):
                if f"[Job {job_num}]" in line and "failed" in line.lower():
                    return line.strip()
        except Exception:
            pass
        return ""

    def _trabajo_cups_fallo(blob: str) -> bool:
        ol = (blob or "").lower()
        return any(
            x in ol
            for x in (
                "resources-are-not-ready",
                "backend epsonusb returned",
                "aborted",
                "canceled",
                "cancelled",
                "stopped",
                "held",
            )
        )

    def _cancelar_trabajos_atascados_etiquetas() -> list[str]:
        """Quita de la cola trabajos bloqueados (p. ej. resources-are-not-ready)."""
        import subprocess as _sp
        cancelados: list[str] = []
        try:
            r = _sp.run(["lpstat", "-o"], capture_output=True, text=True, timeout=8)
            if r.returncode != 0:
                return cancelados
            for line in (r.stdout or "").splitlines():
                parts = line.split()
                if not parts or not parts[0].startswith(f"{_PRINTER_NAME}-"):
                    continue
                job = parts[0]
                blob = _bloque_trabajo_cups_etiquetas(job).lower()
                if _trabajo_cups_fallo(blob):
                    c = _sp.run(["cancel", job], capture_output=True, text=True, timeout=5)
                    if c.returncode == 0:
                        cancelados.append(job)
        except Exception:
            pass
        return cancelados

    def _esperar_trabajo_cups_etiquetas(job_id: str, timeout: float = 50.0) -> tuple[bool, str]:
        """Espera a que CUPS termine el trabajo; detecta fallos del backend epsonUSB."""
        import re as _re
        import time as _time

        if not job_id:
            return False, "No se obtuvo ID de trabajo CUPS"
        num_m = _re.search(r"-(\d+)$", job_id)
        job_num = num_m.group(1) if num_m else ""
        deadline = _time.time() + timeout
        ultimo = ""
        while _time.time() < deadline:
            bloque = _bloque_trabajo_cups_etiquetas(job_id)
            if not bloque:
                _time.sleep(0.6)
                fallo_log = _fallo_trabajo_cups_en_log(job_num)
                if fallo_log:
                    return False, fallo_log
                return True, "Impresión completada"
            ultimo = bloque
            if _trabajo_cups_fallo(bloque):
                _time.sleep(0.8)
                fallo_log = _fallo_trabajo_cups_en_log(job_num)
                if fallo_log:
                    return False, fallo_log
                if _bloque_trabajo_cups_etiquetas(job_id):
                    return False, bloque
            _time.sleep(0.45)
        fallo_log = _fallo_trabajo_cups_en_log(job_num)
        if fallo_log:
            return False, fallo_log
        return False, ultimo or "Tiempo de espera agotado esperando la impresora"

    def _salida_elpu_status_etiquetas() -> str:
        """Consulta status de la impresora vía elpu (requiere elioud activo)."""
        for usar_sudo in (True, False):
            salida, _ = _ejecutar_elpu_etiquetas(
                ("status", "statusGroup"),
                usar_sudo=usar_sudo,
            )
            if _salida_elpu_lista(salida):
                return salida
        return ""

    _CODIGOS_ELPU_COMUNICACION_TRANSIENTE = frozenset({
        "sin_conexion", "inicializando", "elpu", "backend_incorrecto",
    })

    def _preflight_elpu_impresora_etiquetas(
        *,
        omitir_comunicacion: bool = False,
    ) -> tuple[dict | None, str | None]:
        """Pre-vuelo ELPU. Devuelve (bloqueo, aviso). Bloquea solo errores físicos graves."""
        import time as _time

        _asegurar_backend_usb_cups_etiquetas()

        if not _asegurar_elioud_etiquetas():
            if omitir_comunicacion:
                return None, "elioud inactivo — se intentará imprimir vía CUPS"
            return {
                "error": "Daemon Epson I/O (elioud) inactivo",
                "solucion": "Pulsa «Instalar impresora» en el panel para iniciar elioud y registrar permisos sudo.",
                "codigo": "elpu",
                "detalle": _ELIOUD_PATH,
            }, None

        def _bloqueo_desde_salida(salida: str) -> dict | None:
            alerta = _alerta_impresora_etiquetas(
                salida_elpu=salida,
                estado_cups=_estado_cups_etiquetas(),
            )
            if not alerta or alerta.get("severidad") != "error":
                return None
            codigo = alerta.get("codigo", "preflight")
            if omitir_comunicacion and codigo in _CODIGOS_ELPU_COMUNICACION_TRANSIENTE:
                return None
            return {
                "error": alerta.get("error", "Error de impresora"),
                "solucion": alerta.get("solucion", "Revisa la impresora y pulsa «Instalar impresora»."),
                "codigo": codigo,
                "detalle": alerta.get("detalle", salida),
            }

        salida = _salida_elpu_status_etiquetas()
        bloqueo = _bloqueo_desde_salida(salida)
        aviso = None
        if bloqueo and bloqueo.get("codigo") in _CODIGOS_ELPU_COMUNICACION_TRANSIENTE:
            _reiniciar_elioud_etiquetas()
            _time.sleep(1.0)
            salida = _salida_elpu_status_etiquetas()
            bloqueo = _bloqueo_desde_salida(salida)

        if not bloqueo and omitir_comunicacion:
            tl = (salida or "").lower()
            if any(
                x in tl
                for x in (
                    "status_commerror",
                    "beforecomm",
                    "daemonstop",
                    "communication error",
                )
            ):
                aviso = "ELPU sin respuesta USB — se continúa con CUPS"

        if bloqueo and omitir_comunicacion and bloqueo.get("codigo") in _CODIGOS_ELPU_COMUNICACION_TRANSIENTE:
            aviso = bloqueo.get("error", "Comunicación ELPU inestable") + " — se continúa con CUPS"
            return None, aviso

        return bloqueo, aviso

    def _suspender_elioud_impresion_etiquetas() -> None:
        """Libera USB para el backend epsonUSB de CUPS durante lp."""
        import subprocess as _sp
        import time as _time

        for cmd in (
            ["sudo", "-n", "pkill", "-x", "elioud1"],
            ["sudo", "pkill", "-x", "elioud1"],
            ["pkill", "-x", "elioud1"],
        ):
            _sp.run(cmd, capture_output=True, text=True, timeout=3)
        _time.sleep(0.4)

    def _preparar_medio_elpu_etiquetas(
        forma_val: str,
        calidad_val: str,
        ancho: int,
        alto: int,
        log_lines: list,
    ) -> None:
        """Sincroniza calidad en elpu; Gap va solo por CUPS MediaForm (no tocar formDetectionType)."""
        import subprocess as _sp

        cal_elpu = _MAPEO_CALIDAD_ELPU.get(calidad_val)
        deteccion = _MAPEO_FORM_DETECTION_ELPU.get(forma_val)
        opts: list[str] = []
        if cal_elpu:
            opts.append(f"printQuality={cal_elpu}")
        if deteccion:
            opts.append(f"formDetectionType={deteccion}")
        if opts:
            salida, _ = _ejecutar_elpu_etiquetas(tuple(opts), usar_sudo=True)
            if not salida:
                salida, _ = _ejecutar_elpu_etiquetas(tuple(opts), usar_sudo=False)
            if salida and not _salida_elpu_fallo(salida):
                log_lines.append(f"elpu: {', '.join(opts)}")
        try:
            _sp.run(
                ["lpoptions", "-p", _PRINTER_NAME, "-o", f"MediaForm={forma_val}"],
                capture_output=True, text=True, timeout=8,
            )
            log_lines.append(f"CUPS: MediaForm={forma_val} ({ancho}×{alto} mm)")
        except Exception:
            pass

    def _limpiar_cola_impresora_etiquetas() -> list[str]:
        """Cancela todos los trabajos pendientes de CW-C4000u."""
        import subprocess as _sp

        cancelados: list[str] = []
        try:
            r = _sp.run(["lpstat", "-o"], capture_output=True, text=True, timeout=8)
            if r.returncode != 0:
                return cancelados
            for line in (r.stdout or "").splitlines():
                parts = line.split()
                if not parts or not parts[0].startswith(f"{_PRINTER_NAME}-"):
                    continue
                job = parts[0]
                c = _sp.run(["cancel", job], capture_output=True, text=True, timeout=5)
                if c.returncode == 0:
                    cancelados.append(job)
        except Exception:
            pass
        return cancelados

    def _ejecutar_elpu_offset_etiquetas(offset_v: float, log_lines: list) -> None:
        """Ajusta posición vertical con elpu (mejor esfuerzo; no bloquea la impresión)."""
        import subprocess as _sp
        import shutil as _shutil

        elpu_bin = _ELPU_PATH if os.path.isfile(_ELPU_PATH) else (_shutil.which("elpu") or _ELPU_PATH)
        if not elpu_bin:
            log_lines.append("elpu: aviso — utilidad no instalada (offset vertical omitido)")
            return

        def _intento() -> tuple[str, bool]:
            for cmd in (
                ["sudo", "-n", elpu_bin, "-d", "-p", _PRINTER_NAME, "-o", f"printPositionV={offset_v}"],
                ["sudo", elpu_bin, "-d", "-p", _PRINTER_NAME, "-o", f"printPositionV={offset_v}"],
                ["sudo", "-n", elpu_bin, "-p", _PRINTER_NAME, "-o", f"printPositionV={offset_v}"],
                ["sudo", elpu_bin, "-p", _PRINTER_NAME, "-o", f"printPositionV={offset_v}"],
            ):
                try:
                    r = _sp.run(cmd, capture_output=True, text=True, timeout=15)
                    salida = (r.stdout + r.stderr).strip()
                    fallo = r.returncode != 0 or _salida_elpu_fallo(salida)
                    return salida, fallo
                except Exception:
                    continue
            return "", True

        salida, fallo = _intento()
        if fallo:
            log_lines.append("elpu: reintentando tras reiniciar elioud…")
            _reiniciar_elioud_etiquetas()
            salida, fallo = _intento()
        if fallo:
            log_lines.append(
                f"elpu: aviso — no se ajustó posición vertical ({salida or 'sin respuesta'})"
            )
        else:
            log_lines.append(f"elpu: {salida or 'OK'}")

    def _asegurar_elioud_etiquetas() -> bool:
        """Un solo elioud1; varias instancias provocan kELIO_Err_DaemonStop en elpu."""
        if _elioud_corriendo_etiquetas():
            return True
        return _reiniciar_elioud_etiquetas()

    def _valor_linea_elpu(salida: str, clave: str) -> str | None:
        pref = f"{clave}:"
        for linea in (salida or "").splitlines():
            linea = linea.strip()
            if linea.startswith(pref):
                return linea.split(":", 1)[1].strip()
        return None

    # ~H(QIQ) / ~H(QMN) — misma fuente que las barras del panel LCD (ESC/Label).
    _PCT_QIQ_TINTA = {
        "RH": 100,  # Enough ink
        "RM": 35,   # Moderate
        "RL": 17,   # Small (genérico; ver _PCT_RL_POR_CARTUCHO)
        "RN": 10,   # Low
        "RR": 3,    # Replace soon
    }
    _PCT_RL_POR_CARTUCHO = {"K": 15, "C": 18}
    _PCT_QMN_MANTENIMIENTO = {
        "RH": 100,
        "RM": 50,
        "RL": 25,
        "RN": 15,   # Near full (poco espacio libre)
        "RR": 5,
    }
    _ETIQUETA_CODIGO_QIQ = {
        "RH": "Lleno",
        "RM": "Moderado",
        "RL": "Poco",
        "RN": "Bajo",
        "RR": "Reemplazar",
        "NA": "No instalado",
        "CI": "Instalado",
    }
    _ETIQUETA_CODIGO_QMN = {
        "RH": "Mucho espacio",
        "RM": "Espacio moderado",
        "RL": "Poco espacio",
        "RN": "Casi lleno",
        "RR": "Reemplazar",
        "NA": "No instalado",
        "CI": "Instalado",
    }

    def _extraer_codigos_qiq_qmn(salida: str) -> tuple[list[str] | None, str | None]:
        """Extrae códigos IQ (K,C,M,Y) y MN del bloque status de elpu."""
        import re

        if not salida:
            return None, None
        texto = re.sub(r"\x1b\[[0-9;]*m", "", salida)
        m_iq = re.search(r"IQ,([A-Z]{2}(?:,[A-Z]{2}){3})", texto)
        m_mn = re.search(r"(?<![A-Z])MN,([A-Z]{2})(?![A-Z0-9])", texto)
        codigos_iq = None
        if m_iq:
            codigos_iq = [c.strip().upper() for c in m_iq.group(1).split(",") if c.strip()]
            if len(codigos_iq) != 4:
                codigos_iq = None
        codigo_mn = m_mn.group(1).strip().upper() if m_mn else None
        return codigos_iq, codigo_mn

    def _pct_desde_codigo_qiq(codigo_cartucho: str, cod_estado: str) -> int | None:
        cod = (cod_estado or "").upper()
        if cod in ("NA", "CI", ""):
            return None
        if cod == "RL":
            if codigo_cartucho in _PCT_RL_POR_CARTUCHO:
                return _PCT_RL_POR_CARTUCHO[codigo_cartucho]
            return _PCT_QIQ_TINTA.get("RL")
        return _PCT_QIQ_TINTA.get(cod)

    def _pct_desde_codigo_qmn(cod_estado: str) -> int | None:
        cod = (cod_estado or "").upper()
        if cod in ("NA", "CI", ""):
            return None
        return _PCT_QMN_MANTENIMIENTO.get(cod)

    def _parsear_nivel_tinta_elpu(valor: str | None, *, codigo: str = "") -> int | None:
        """Respaldo numérico inkK/inkMN; suele venir ``0 N`` sin % real (usar ~H(QIQ) antes)."""
        if not valor or valor.upper() in ("N/A", "-", ""):
            return None
        partes = valor.split()
        if not partes:
            return None
        try:
            if len(partes) >= 2:
                a, b = int(partes[0]), int(partes[1])
                if a < 0 or b < 0:
                    return None
                if a == 0:
                    return None
                if b <= 0:
                    return None
                if str(codigo or "").upper() == "MN":
                    return min(100, max(0, round(a * 100 / b)))
                return min(100, max(0, round((b - a) * 100 / b)))
            a = int(partes[0])
            if a < 0:
                return None
            if a <= 100:
                return a
        except (TypeError, ValueError):
            pass
        return None

    _MAPA_ESTADO_ELPU_ETIQUETAS = {
        "BeforeComm": (
            "Sin comunicación con la impresora",
            "Enciende la Epson CW-C4000u, conecta el cable USB directo al PC (sin hub) y espera 30 s. "
            "Si persiste, pulsa «Instalar impresora» en la pestaña Imprimir.",
            "sin_conexion",
            "warning",
        ),
        "Status_Unsettled": (
            "Impresora inicializando",
            "Espera a que termine de cargar tinta y el panel LCD muestre «Listo». No desconectes el USB mientras parpadea.",
            "inicializando",
            "warning",
        ),
        "Status_CommError": (
            "Error de comunicación con la impresora",
            "Enciende la Epson CW-C4000u y espera a que el panel LCD muestre «Listo». "
            "Reconecta el cable USB directo al PC (sin hub), pulsa «Instalar impresora» y luego Actualizar.",
            "sin_conexion",
            "error",
        ),
        "backend_incorrecto": (
            "Backend CUPS incorrecto (epsonUSB)",
            "Pulsa «Instalar impresora»: debe usar usb:// para imprimir. "
            "El backend epsonUSB provoca fallos «status 1» aunque el LCD esté en Listo.",
            "backend_incorrecto",
            "error",
        ),
        "Status_Offline": (
            "Impresora apagada o desconectada",
            "Enciende la impresora y verifica que el LED de encendido esté fijo. Reconecta el cable USB si hace falta.",
            "sin_conexion",
            "error",
        ),
        "Status_BadDevice": (
            "Impresora no reconocida",
            "Reinicia la impresora y el PC. Pulsa «Instalar impresora» para volver a registrar el driver en CUPS.",
            "no_registrada",
            "error",
        ),
        "FatalError": (
            "Error grave de la impresora",
            "Apaga la impresora 30 s, enciéndela de nuevo y revisa el mensaje en el panel LCD. Si persiste, contacta soporte Epson.",
            "fatal",
            "error",
        ),
        "Status_ER_CO": (
            "Tapa o cabezal abierto",
            "Cierra la tapa frontal hasta oír el clic. Espera a que el LED deje de parpadear en rojo.",
            "tapa_abierta",
            "error",
        ),
        "Status_ER_FE": (
            "Sin etiquetas o rollo vacío",
            "Carga un rollo nuevo y alinea las guías con el ancho del material. Verifica gap o blackmark según el tipo de etiqueta.",
            "sin_papel",
            "error",
        ),
        "Status_ER_IC": (
            "Problema con cartucho de tinta",
            "Retira y vuelve a insertar el cartucho indicado en el panel LCD. Usa cartuchos Epson SJIC41P originales.",
            "mantenimiento",
            "error",
        ),
        "Status_ER_MN": (
            "Caja de mantenimiento llena o mal instalada",
            "Reemplaza la caja de mantenimiento SJMB4000 siguiendo el manual. Reinicia la impresora tras el cambio.",
            "mantenimiento",
            "error",
        ),
        "Status_ER_LT": (
            "Tinta baja",
            "Sustituye el cartucho que indica el panel LCD antes de seguir imprimiendo lotes grandes.",
            "tinta_baja",
            "warning",
        ),
        "Status_ER_MF": (
            "Error de alimentación de etiquetas",
            "Revisa que el rollo gire libre y que el sensor (gap/blackmark) coincida con el tipo elegido en el panel.",
            "sin_papel",
            "error",
        ),
        "Status_IL_PAPF": (
            "Atasco o error de papel",
            "Abre la impresora, retira etiquetas atascadas con cuidado y vuelve a cargar el rollo alineado con las guías.",
            "atasco",
            "error",
        ),
        "Status_IL_PAPF_MNF": (
            "Impresora conectada — no detecta el rollo de etiquetas",
            "La Epson responde por USB. Carga el rollo, alinea las guías y elige Diecut_Gap o Diecut_Blackmark "
            "según tu material (p. ej. 30 mL = 102×38 mm). Reinicia la impresora si el LCD muestra error.",
            "sin_papel",
            "warning",
        ),
        "Status_IL_PAPT_ER": (
            "Tipo de etiqueta no reconocido",
            "En el panel de impresión elige el formato correcto (troquelada gap/blackmark o continua) según tu rollo.",
            "sin_papel",
            "warning",
        ),
        "Status_PR": (
            "Problema con el rollo de etiquetas",
            "Verifica que el rollo esté bien colocado, que haya material y que el sensor detecte gap o marca negra.",
            "sin_papel",
            "error",
        ),
        "Status_WT": (
            "Impresora ocupada",
            "Espera a que termine la limpieza o carga de tinta. No apagues ni desconectes el USB.",
            "inicializando",
            "info",
        ),
        "Status_CL": (
            "Limpieza de cabezal en curso",
            "No interrumpas el proceso. Cuando termine, el panel volverá a «Listo».",
            "inicializando",
            "info",
        ),
    }

    _ETIQUETAS_NIVELES_TINTA_CACHE_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_niveles_tinta_cache.json",
    )

    def _clave_status_elpu_etiquetas(valor: str) -> str:
        if not valor:
            return ""
        partes = [p.strip() for p in valor.split(",") if p.strip()]
        for parte in reversed(partes):
            if not parte.isdigit():
                return parte
        return partes[-1] if partes else ""

    def _alerta_impresora_etiquetas(
        *,
        salida_elpu: str = "",
        estado_cups: str = "",
        preflight: dict | None = None,
    ) -> dict | None:
        """Devuelve error/solución/código/severidad si hay problema; None si todo OK."""
        uri_dev = _uri_dispositivo_etiquetas()
        if uri_dev.startswith("epsonUSB://"):
            err, sol, cod, sev = _MAPA_ESTADO_ELPU_ETIQUETAS["backend_incorrecto"]
            return {
                "error": err,
                "solucion": sol,
                "codigo": cod,
                "severidad": sev,
                "detalle": uri_dev,
            }

        if preflight:
            return {
                "error": preflight.get("error", "Error de impresora"),
                "solucion": preflight.get("solucion", "Revisa la conexión USB y pulsa «Instalar impresora»."),
                "codigo": preflight.get("codigo", "preflight"),
                "severidad": "error",
                "detalle": preflight.get("detalle", ""),
            }

        texto_cups = (estado_cups or "").strip()
        tl_cups = texto_cups.lower()
        err_cups, sol_cups, cod_cups = _interpretar_error_impresora_etiquetas(texto_cups)
        if any(
            x in tl_cups
            for x in ("disabled", "deshabilitad", "unknown", "no existe", "does not exist")
        ) or _cups_en_pausa_etiquetas(texto_cups):
            return {
                "error": err_cups,
                "solucion": sol_cups,
                "codigo": cod_cups,
                "severidad": "error",
                "detalle": texto_cups,
            }

        status = _valor_linea_elpu(salida_elpu, "status") or ""
        status_group = _valor_linea_elpu(salida_elpu, "statusGroup") or ""
        clave_status = _clave_status_elpu_etiquetas(status)

        # Status_IL_* = Idle (reposo). El LCD solo muestra fallos reales como Status_ER_*.
        # PAPF_MNF en idle NO significa rollo faltante — es estado interno del driver sin trabajo activo.
        if clave_status.startswith("Status_IL_"):
            return None

        claves = (
            clave_status,
            _clave_status_elpu_etiquetas(status_group),
        )
        texto_elpu = f"{status} {status_group}".lower()

        for clave in claves:
            if clave and clave in _MAPA_ESTADO_ELPU_ETIQUETAS:
                err, sol, cod, sev = _MAPA_ESTADO_ELPU_ETIQUETAS[clave]
                return {
                    "error": err,
                    "solucion": sol,
                    "codigo": cod,
                    "severidad": sev,
                    "detalle": f"{status}; {status_group}".strip("; "),
                }

        for clave, (err, sol, cod, sev) in _MAPA_ESTADO_ELPU_ETIQUETAS.items():
            if clave.startswith("Status_IL_"):
                continue
            if clave.lower() in texto_elpu:
                return {
                    "error": err,
                    "solucion": sol,
                    "codigo": cod,
                    "severidad": sev,
                    "detalle": f"{status}; {status_group}".strip("; "),
                }

        if "error" in texto_elpu or "fatal" in texto_elpu:
            err, sol, cod = _interpretar_error_impresora_etiquetas(texto_elpu)
            return {
                "error": err,
                "solucion": sol,
                "codigo": cod,
                "severidad": "error",
                "detalle": f"{status}; {status_group}".strip("; "),
            }

        return None

    def _estado_cups_etiquetas() -> str:
        import subprocess as _sp
        try:
            r = _sp.run(
                ["lpstat", "-p", _PRINTER_NAME],
                capture_output=True, text=True, timeout=5,
            )
            return (r.stdout or r.stderr or "").strip()
        except Exception as e:
            return f"Error consultando CUPS: {e}"

    def _cups_en_pausa_etiquetas(estado: str = "") -> bool:
        """True solo si CUPS reporta pausa real (no confundir con «inactiva» = idle)."""
        import re as _re_pause

        el = (estado or _estado_cups_etiquetas()).lower()
        if _re_pause.search(r"\b(inactiva|idle)\b", el):
            return False
        if _re_pause.search(r"\b(en pausa|paused|pausada|pausado)\b", el):
            return True
        return "printer-state-reasons=paused" in el.replace(" ", "")

    def _despausar_impresora_etiquetas() -> bool:
        """cupsenable + cupsaccept (mejor esfuerzo)."""
        import subprocess as _sp

        try:
            for cmd in (
                ["sudo", "-n", "cupsenable", _PRINTER_NAME],
                ["cupsenable", _PRINTER_NAME],
            ):
                _sp.run(cmd, capture_output=True, text=True, timeout=8)
            for cmd in (
                ["sudo", "-n", "cupsaccept", _PRINTER_NAME],
                ["cupsaccept", _PRINTER_NAME],
            ):
                _sp.run(cmd, capture_output=True, text=True, timeout=8)
            return not _cups_en_pausa_etiquetas()
        except Exception:
            return False

    def _estado_cups_resumen_etiquetas(estado: str = "") -> dict:
        """Interpreta lpstat en español/inglés para el panel."""
        estado = (estado or _estado_cups_etiquetas()).strip()
        el = estado.lower()
        if not estado or "error consultando cups" in el:
            return {
                "codigo": "error",
                "legible": "No se pudo consultar CUPS",
                "conectada": False,
                "en_pausa": False,
            }
        if any(x in el for x in ("unknown", "does not exist", "no existe")):
            return {
                "codigo": "no_registrada",
                "legible": "No registrada — pulsa Instalar impresora",
                "conectada": False,
                "en_pausa": False,
            }
        if "disabled" in el or "deshabilitad" in el:
            return {
                "codigo": "deshabilitada",
                "legible": "Deshabilitada — reconecta el USB",
                "conectada": False,
                "en_pausa": False,
            }
        if _cups_en_pausa_etiquetas(estado):
            return {
                "codigo": "pausada",
                "legible": "En pausa",
                "conectada": False,
                "en_pausa": True,
            }
        if "imprim" in el or "printing" in el:
            return {
                "codigo": "imprimiendo",
                "legible": "Imprimiendo…",
                "conectada": True,
                "en_pausa": False,
            }
        if "inactiva" in el or "idle" in el:
            return {
                "codigo": "lista",
                "legible": "Lista para imprimir",
                "conectada": True,
                "en_pausa": False,
            }
        return {
            "codigo": "ok",
            "legible": "Conectada",
            "conectada": True,
            "en_pausa": False,
        }

    def _trabajos_cola_etiquetas() -> int:
        import subprocess as _sp

        try:
            r = _sp.run(["lpstat", "-o"], capture_output=True, text=True, timeout=8)
            if r.returncode != 0:
                return 0
            return sum(
                1
                for line in (r.stdout or "").splitlines()
                if line.strip().startswith(f"{_PRINTER_NAME}-")
            )
        except Exception:
            return 0

    def _impresora_conectada_cups_etiquetas() -> bool:
        """True si CUPS tiene la CW-C4000u registrada y habilitada (inactiva = idle, OK)."""
        return bool(_estado_cups_resumen_etiquetas().get("conectada"))

    def _comunicacion_usb_etiquetas() -> bool:
        """True si elpu responde sin CommError (impresora accesible por USB)."""
        if not _elpu_binario_etiquetas():
            return False
        salida = _salida_elpu_status_etiquetas()
        if not _salida_elpu_lista(salida):
            return False
        tl = salida.lower()
        return not any(
            x in tl
            for x in (
                "status_commerror",
                "commerror",
                "communication error",
                "device not found",
                "i/o error",
            )
        )

    _CODIGOS_TINTA_ETIQUETAS = frozenset({"K", "C", "M", "Y", "MN"})

    def _load_datos_niveles_tinta_store() -> dict:
        try:
            with open(_ETIQUETAS_NIVELES_TINTA_CACHE_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return {"niveles_manuales": {}, "cartuchos": []}
        except Exception:
            return {"niveles_manuales": {}, "cartuchos": []}
        if not isinstance(data, dict):
            return {"niveles_manuales": {}, "cartuchos": []}
        manuales = data.get("niveles_manuales")
        if not isinstance(manuales, dict):
            manuales = {}
        return {**data, "niveles_manuales": manuales}

    def _load_cache_niveles_tinta_etiquetas() -> dict | None:
        data = _load_datos_niveles_tinta_store()
        cartuchos = data.get("cartuchos")
        if not isinstance(cartuchos, list) or not cartuchos:
            return None
        return data

    def _save_datos_niveles_tinta_store(payload: dict) -> None:
        os.makedirs(os.path.dirname(_ETIQUETAS_NIVELES_TINTA_CACHE_PATH), exist_ok=True)
        prev = _load_datos_niveles_tinta_store()
        merged = {**prev, **payload}
        with open(_ETIQUETAS_NIVELES_TINTA_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)

    def _save_cache_niveles_tinta_etiquetas(payload: dict) -> None:
        _save_datos_niveles_tinta_store(payload)

    def _normalizar_niveles_manuales_tinta(raw: dict) -> dict:
        out: dict = {}
        for codigo, val in (raw or {}).items():
            c = str(codigo or "").strip().upper()
            if c not in _CODIGOS_TINTA_ETIQUETAS:
                continue
            try:
                out[c] = min(100, max(0, int(val)))
            except (TypeError, ValueError):
                continue
        return out

    def _fusionar_cartuchos_niveles_manuales(cartuchos: list, manuales: dict) -> tuple[list, bool, bool]:
        manuales = _normalizar_niveles_manuales_tinta(manuales)
        tiene_auto = False
        tiene_manual = False
        out = []
        for c in cartuchos:
            item = dict(c)
            codigo = str(item.get("codigo") or "").upper()
            if item.get("nivel") is not None:
                item["origen"] = "impresora"
                tiene_auto = True
            elif codigo in manuales:
                item["nivel"] = manuales[codigo]
                item["origen"] = "manual"
                tiene_manual = True
            else:
                item["origen"] = None
            out.append(item)
        return out, tiene_auto, tiene_manual

    def _enriquecer_respuesta_niveles_tinta(resp: dict) -> dict:
        store = _load_datos_niveles_tinta_store()
        manuales = store.get("niveles_manuales") or {}
        cartuchos, tiene_auto, tiene_manual = _fusionar_cartuchos_niveles_manuales(
            resp.get("cartuchos") or [], manuales,
        )
        resp["cartuchos"] = cartuchos
        resp["niveles_manuales"] = manuales
        if tiene_auto:
            resp["origen_niveles"] = "mixto" if tiene_manual else "impresora"
            if tiene_auto and not resp.get("niveles_legibles"):
                resp["niveles_legibles"] = True
        elif tiene_manual:
            resp["origen_niveles"] = "manual"
            resp["niveles_legibles"] = True
        else:
            resp["origen_niveles"] = "ninguno"
        return resp

    def _ejecutar_elpu_etiquetas(opts: tuple[str, ...], *, usar_sudo: bool) -> tuple[str, int]:
        import subprocess as _sp

        elpu_bin = _elpu_binario_etiquetas()
        if not elpu_bin:
            return "", 127
        # -d: ruta ELIO/elioud; sin esto suele devolver Status_CommError e ink -1 -1
        cmd = ([elpu_bin] if not usar_sudo else ["sudo", "-n", elpu_bin]) + ["-d", "-p", _PRINTER_NAME]
        for opt in opts:
            cmd.extend(["-o", opt])
        try:
            r = _sp.run(cmd, capture_output=True, text=True, timeout=12)
            return (r.stdout + r.stderr).strip(), r.returncode
        except Exception:
            return "", 1

    def _salida_elpu_lista(salida: str) -> bool:
        return bool(salida and "destination:" in salida.lower())

    def _armar_cartuchos_tinta_elpu(salida: str) -> tuple[list, bool]:
        cartuchos_def = (
            ("K", "inkK", "inkNameK", "Negro", "#1a1a1a"),
            ("C", "inkC", "inkNameC", "Cian", "#06b6d4"),
            ("M", "inkM", "inkNameM", "Magenta", "#ec4899"),
            ("Y", "inkY", "inkNameY", "Amarillo", "#eab308"),
            ("MN", "inkMN", "inkNameMN", "Mantenimiento", "#6b7280"),
        )
        codigos_iq, codigo_mn = _extraer_codigos_qiq_qmn(salida)
        cartuchos = []
        alguno_con_nivel = False
        for idx, (codigo, ink_key, name_key, etiqueta, color) in enumerate(cartuchos_def):
            ink_raw = _valor_linea_elpu(salida, ink_key)
            nombre_raw = _valor_linea_elpu(salida, name_key)
            estado_codigo = None
            nivel = None
            if codigo == "MN" and codigo_mn:
                estado_codigo = codigo_mn
                nivel = _pct_desde_codigo_qmn(codigo_mn)
            elif codigos_iq and idx < len(codigos_iq):
                estado_codigo = codigos_iq[idx]
                nivel = _pct_desde_codigo_qiq(codigo, estado_codigo)
            if nivel is None:
                nivel = _parsear_nivel_tinta_elpu(ink_raw, codigo=codigo)
            nombre = None
            if nombre_raw and nombre_raw.upper() not in ("N/A", "-", ""):
                nombre = nombre_raw
            if nivel is not None:
                alguno_con_nivel = True
            cartuchos.append({
                "codigo": codigo,
                "etiqueta": etiqueta,
                "color": color,
                "nombre": nombre,
                "nivel": nivel,
                "estado_codigo": estado_codigo,
                "estado_etiqueta": (
                    _ETIQUETA_CODIGO_QMN if codigo == "MN" else _ETIQUETA_CODIGO_QIQ
                ).get(estado_codigo or "", ""),
                "raw": ink_raw,
            })
        return cartuchos, alguno_con_nivel

    def _resumen_niveles_tinta_etiquetas() -> dict:
        """Respuesta instantánea desde JSON local (sin ELPU)."""
        store = _load_datos_niveles_tinta_store()
        cache_cart = store.get("cartuchos")
        cartuchos = (
            cache_cart
            if isinstance(cache_cart, list) and cache_cart
            else _armar_cartuchos_tinta_elpu("")[0]
        )
        uri = _uri_dispositivo_etiquetas()
        consultado_at = (
            store.get("consultado_at")
            or store.get("niveles_manuales_at")
            or ""
        )
        conectada = _impresora_conectada_cups_etiquetas()
        status_cached = store.get("status", "")
        ultima_alerta = store.get("ultima_alerta")
        if _clave_status_elpu_etiquetas(str(status_cached)).startswith("Status_IL_"):
            ultima_alerta = None
        resp = {
            "impresora": _PRINTER_NAME,
            "disponible": True,
            "rapido": True,
            "desde_cache": True,
            "impresora_conectada": conectada,
            "comunicacion_usb": conectada and _comunicacion_usb_etiquetas(),
            "uri_dispositivo": uri,
            "backend_usb_cups": (uri or "").startswith("usb://"),
            "backend_epson_usb": (uri or "").startswith("epsonUSB://"),
            "estado_cups": _estado_cups_etiquetas(),
            "cartuchos": cartuchos,
            "status": store.get("status", ""),
            "status_group": store.get("status_group", ""),
            "consultado_at": consultado_at,
            "alerta_impresora": ultima_alerta,
        }
        manuales = store.get("niveles_manuales") or {}
        if not manuales and not any(c.get("nivel") is not None for c in cartuchos):
            resp["mensaje"] = (
                "Sin lectura guardada. Pulsa «Leer impresora» o registra los % manualmente."
            )
        return _enriquecer_respuesta_niveles_tinta(resp)

    def _consultar_niveles_tinta_etiquetas() -> dict:
        """Lee niveles CMYK + caja de mantenimiento vía ELPU (Epson Label Printer Utility)."""
        import time as _time

        uri_migrada, migrado = _asegurar_backend_usb_cups_etiquetas()
        elioud_ok = _asegurar_elioud_etiquetas()
        estado_cups = _estado_cups_etiquetas()
        preflight = _verificar_impresora_etiquetas()

        if not _elpu_binario_etiquetas():
            cache = _load_cache_niveles_tinta_etiquetas()
            alerta = _alerta_impresora_etiquetas(
                estado_cups=estado_cups,
                preflight=preflight or {
                    "error": "Utilidad ELPU no instalada",
                    "solucion": "Pulsa «Instalar impresora» en la pestaña Imprimir para instalar elpu.",
                    "codigo": "elpu",
                },
            )
            return _enriquecer_respuesta_niveles_tinta({
                "disponible": False,
                "error": alerta["error"] if alerta else "Utilidad ELPU no instalada",
                "solucion": alerta["solucion"] if alerta else "Pulsa «Instalar impresora» en la pestaña Imprimir.",
                "codigo": (alerta or {}).get("codigo", "elpu"),
                "alerta_impresora": alerta,
                "estado_cups": estado_cups,
                "cartuchos": (cache or {}).get("cartuchos") or _armar_cartuchos_tinta_elpu("")[0],
            })

        opts = (
            "inkK", "inkC", "inkM", "inkY", "inkMN",
            "inkNameK", "inkNameC", "inkNameM", "inkNameY", "inkNameMN",
            "status", "statusGroup",
        )
        def _elpu_necesita_reintento(salida_elpu: str) -> bool:
            if not _salida_elpu_lista(salida_elpu):
                return True
            _, tiene_nivel = _armar_cartuchos_tinta_elpu(salida_elpu)
            if tiene_nivel:
                return False
            status_try = (_valor_linea_elpu(salida_elpu, "status") or "").lower()
            grupo_try = (_valor_linea_elpu(salida_elpu, "statusGroup") or "").lower()
            return "beforecomm" in grupo_try or "unsettled" in status_try

        salida, rc = _ejecutar_elpu_etiquetas(opts, usar_sudo=False)
        if _elpu_necesita_reintento(salida):
            _time.sleep(0.5)
            salida_retry, rc_retry = _ejecutar_elpu_etiquetas(opts, usar_sudo=False)
            if _salida_elpu_lista(salida_retry):
                salida = salida_retry
                rc = rc_retry

        def _payload_niveles_tinta(**extra) -> dict:
            alerta = _alerta_impresora_etiquetas(
                salida_elpu=salida,
                estado_cups=estado_cups,
                preflight=preflight,
            )
            conectada = _impresora_conectada_cups_etiquetas()
            base = {
                "impresora": _PRINTER_NAME,
                "estado_cups": estado_cups,
                "impresora_conectada": conectada,
                "comunicacion_usb": conectada and bool(_salida_elpu_lista(salida)),
                "uri_dispositivo": _uri_dispositivo_etiquetas() or uri_migrada,
                "backend_usb_cups": (_uri_dispositivo_etiquetas() or uri_migrada).startswith("usb://"),
                "backend_epson_usb": (_uri_dispositivo_etiquetas() or uri_migrada).startswith("epsonUSB://"),
                "elioud_activo": elioud_ok,
                "backend_corregido": migrado,
                "alerta_impresora": alerta,
                "estado_ok": alerta is None,
            }
            base.update(extra)
            return base

        if not _salida_elpu_lista(salida):
            cache = _load_cache_niveles_tinta_etiquetas()
            if cache:
                return _enriquecer_respuesta_niveles_tinta(_payload_niveles_tinta(
                    disponible=True,
                    status=cache.get("status", ""),
                    status_group=cache.get("status_group", ""),
                    unsettled=True,
                    niveles_legibles=True,
                    desde_cache=True,
                    mensaje="Impresora sin comunicación; mostrando última lectura guardada.",
                    cartuchos=cache.get("cartuchos") or [],
                    consultado_at=cache.get("consultado_at") or "",
                ))
            alerta = _alerta_impresora_etiquetas(
                estado_cups=estado_cups,
                preflight=preflight or {
                    "error": "ELPU no respondió",
                    "solucion": "Enciende la impresora, reconecta el USB y pulsa Actualizar.",
                    "codigo": "elpu",
                },
            )
            return _enriquecer_respuesta_niveles_tinta({
                "disponible": False,
                "error": alerta["error"] if alerta else "ELPU no respondió",
                "solucion": alerta["solucion"] if alerta else "Enciende la impresora y pulsa Actualizar.",
                "codigo": (alerta or {}).get("codigo", "elpu"),
                "alerta_impresora": alerta,
                "estado_cups": estado_cups,
                "cartuchos": _armar_cartuchos_tinta_elpu("")[0],
            })

        status = _valor_linea_elpu(salida, "status") or ""
        status_group = _valor_linea_elpu(salida, "statusGroup") or ""
        status_lower = status.lower()
        grupo_lower = status_group.lower()
        unsettled = "unsettled" in status_lower or "beforecomm" in grupo_lower

        cartuchos, alguno_con_nivel = _armar_cartuchos_tinta_elpu(salida)
        consultado_at = _dt.now().isoformat(timespec="seconds")

        alerta_final = _alerta_impresora_etiquetas(
            salida_elpu=salida,
            estado_cups=estado_cups,
            preflight=preflight,
        )

        if alguno_con_nivel:
            codigos_estado = {
                c["codigo"]: c.get("estado_codigo")
                for c in cartuchos
                if c.get("estado_codigo")
            }
            _save_cache_niveles_tinta_etiquetas({
                "cartuchos": cartuchos,
                "codigos_estado_tinta": codigos_estado,
                "status": status,
                "status_group": status_group,
                "consultado_at": consultado_at,
                "ultima_alerta": alerta_final,
            })
            return _enriquecer_respuesta_niveles_tinta(_payload_niveles_tinta(
                disponible=True,
                status=status,
                status_group=status_group,
                unsettled=unsettled,
                niveles_legibles=True,
                desde_cache=False,
                cartuchos=cartuchos,
                consultado_at=consultado_at,
            ))

        cache = _load_cache_niveles_tinta_etiquetas()
        if cache:
            return _enriquecer_respuesta_niveles_tinta(_payload_niveles_tinta(
                disponible=True,
                status=status,
                status_group=status_group,
                unsettled=unsettled,
                niveles_legibles=True,
                desde_cache=True,
                mensaje="Mostrando última lectura guardada de tinta.",
                cartuchos=cache.get("cartuchos") or cartuchos,
                consultado_at=cache.get("consultado_at") or consultado_at,
            ))

        _save_datos_niveles_tinta_store({
            "status": status,
            "status_group": status_group,
            "consultado_at": consultado_at,
            "ultima_alerta": alerta_final,
        })
        return _enriquecer_respuesta_niveles_tinta(_payload_niveles_tinta(
            disponible=True,
            status=status,
            status_group=status_group,
            unsettled=unsettled,
            niveles_legibles=False,
            desde_cache=False,
            cartuchos=cartuchos,
            consultado_at=consultado_at,
        ))

    _FILE_BROWSER_BLOQUEADOS = ("/proc", "/sys", "/dev")
    _ROOT_DIRS_UTILES = frozenset({
        "home", "media", "mnt", "opt", "srv", "tmp", "usr", "var", "run",
    })

    def _resolver_ruta_pdf_etiquetas(ruta: str) -> str:
        if not ruta:
            return ""
        if not os.path.isabs(ruta):
            ruta = os.path.join(_PDF_DIR, ruta)
        return os.path.realpath(ruta)

    def _ruta_pdf_etiquetas_ok(ruta: str) -> tuple:
        """Valida lectura de PDF en cualquier disco montado (bloquea /proc, /sys, /dev)."""
        r = _resolver_ruta_pdf_etiquetas(ruta)
        if not r:
            return None, "Falta ruta_pdf"
        if not r.startswith("/"):
            return None, "Ruta inválida"
        for bloq in _FILE_BROWSER_BLOQUEADOS:
            if r == bloq or r.startswith(bloq + "/"):
                return None, "Ruta no permitida"
        if not os.path.isfile(r):
            return None, "Archivo no encontrado"
        if not r.lower().endswith(".pdf"):
            return None, "Debe ser un archivo PDF"
        return r, None

    def _listar_discos_entrada_etiquetas() -> list:
        items: list = []
        vistos: set = set()

        def _agregar(nombre: str, ruta: str, icono: str = "disco") -> None:
            try:
                rr = os.path.realpath(ruta)
            except OSError:
                return
            if rr in vistos or not os.path.isdir(rr):
                return
            vistos.add(rr)
            items.append({"nombre": nombre, "ruta": rr, "icono": icono})

        home = os.path.expanduser("~")
        _agregar(f"Inicio ({os.path.basename(home) or 'home'})", home, "home")

        for base in ("/media", "/mnt", "/run/media"):
            if not os.path.isdir(base):
                continue
            try:
                for nombre in sorted(os.listdir(base), key=str.lower):
                    if nombre.startswith("."):
                        continue
                    full = os.path.join(base, nombre)
                    if not os.path.isdir(full):
                        continue
                    if base in ("/media", "/run/media"):
                        try:
                            hijos = [
                                s for s in os.listdir(full)
                                if not s.startswith(".")
                                and os.path.isdir(os.path.join(full, s))
                            ]
                            if hijos:
                                for sub in sorted(hijos, key=str.lower):
                                    _agregar(sub, os.path.join(full, sub), "usb")
                                continue
                        except PermissionError:
                            pass
                    _agregar(nombre, full, "disco")
            except PermissionError:
                continue

        _agregar("Sistema (/)", "/", "sistema")
        return items

    @app.route("/api/etiquetas/navegar", methods=["GET"])
    def api_etiquetas_navegar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        ruta_param = (request.args.get("ruta") or "").strip()
        if not ruta_param or ruta_param == "__raiz__":
            return jsonify({
                "ruta_actual": "",
                "padre": None,
                "modo_raiz": True,
                "discos": _listar_discos_entrada_etiquetas(),
                "carpetas": [],
                "pdfs": [],
            })

        ruta = os.path.realpath(ruta_param)
        if not ruta.startswith("/"):
            return jsonify({"error": "Ruta inválida"}), 400
        for bloq in _FILE_BROWSER_BLOQUEADOS:
            if ruta == bloq or ruta.startswith(bloq + "/"):
                return jsonify({"error": "Ruta no permitida"}), 403
        if not os.path.isdir(ruta):
            return jsonify({"error": "Directorio no encontrado"}), 404
        try:
            carpetas, pdfs = [], []
            for nombre in sorted(os.listdir(ruta), key=str.lower):
                ruta_item = os.path.join(ruta, nombre)
                if nombre.startswith("."):
                    continue
                if os.path.isdir(ruta_item):
                    if ruta == "/" and nombre not in _ROOT_DIRS_UTILES:
                        continue
                    carpetas.append(nombre)
                elif nombre.lower().endswith(".pdf"):
                    pdfs.append({
                        "nombre": nombre,
                        "ruta_completa": ruta_item,
                        "tamano_kb": round(os.path.getsize(ruta_item) / 1024, 1),
                    })
            if ruta == "/":
                padre = "__raiz__"
            else:
                padre_dir = os.path.dirname(ruta)
                padre = padre_dir if padre_dir and padre_dir != ruta else "__raiz__"
            return jsonify({
                "ruta_actual": ruta,
                "padre": padre,
                "modo_raiz": False,
                "discos": [],
                "carpetas": carpetas,
                "pdfs": pdfs,
            })
        except PermissionError:
            return jsonify({"error": "Sin permiso para leer este directorio"}), 403
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/etiquetas/diagnostico", methods=["GET"])
    def api_etiquetas_diagnostico():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import subprocess as _sp
        import shutil as _shutil

        checks = []

        def chk(nombre, ok, detalle=""):
            checks.append({"nombre": nombre, "ok": ok, "detalle": detalle})

        # 1. CUPS instalado
        cups_bin = _shutil.which("lp") or _shutil.which("lpadmin")
        chk("CUPS instalado", bool(cups_bin), cups_bin or "No encontrado")

        # 2. CUPS activo
        try:
            r = _sp.run(["systemctl", "is-active", "cups"], capture_output=True, text=True, timeout=5)
            cups_activo = r.stdout.strip() == "active"
            chk("Servicio CUPS activo", cups_activo, r.stdout.strip())
        except Exception as e:
            chk("Servicio CUPS activo", False, str(e))

        # 3. Impresora registrada
        try:
            r = _sp.run(["lpstat", "-p", _PRINTER_NAME], capture_output=True, text=True, timeout=5)
            registrada = r.returncode == 0
            estado_imp = r.stdout.strip() or r.stderr.strip()
            chk(f"Impresora {_PRINTER_NAME} registrada", registrada, estado_imp)
        except Exception as e:
            chk(f"Impresora {_PRINTER_NAME} registrada", False, str(e))

        # 4. Impresora habilitada (no disabled)
        try:
            r = _sp.run(["lpstat", "-p", _PRINTER_NAME], capture_output=True, text=True, timeout=5)
            habilitada = r.returncode == 0 and "deshabilitad" not in r.stdout.lower() and "disabled" not in r.stdout.lower()
            chk(f"Impresora habilitada", habilitada, r.stdout.strip()[:120])
        except Exception as e:
            chk("Impresora habilitada", False, str(e))

        # 5. PPD disponible
        ppd_cups = f"/etc/cups/ppd/{_PRINTER_NAME}.ppd"
        ppd_repo = os.path.join(_REPO_EPSON_DIR, "CW-C4000u.ppd")
        ppd_ok = os.path.isfile(ppd_cups)
        ppd_src = ppd_cups if ppd_ok else (ppd_repo if os.path.isfile(ppd_repo) else "No encontrado")
        chk("PPD / driver Epson", ppd_ok or os.path.isfile(ppd_repo), ppd_src)

        # 6. ELPU instalado
        elpu_ok = os.path.isfile(_ELPU_PATH) or bool(_shutil.which("elpu"))
        elpu_path = _ELPU_PATH if os.path.isfile(_ELPU_PATH) else (_shutil.which("elpu") or "No encontrado")
        chk("ELPU (Epson Label Printer Utility)", elpu_ok, elpu_path)

        # 7. Sudoers para elpu — usar sudo -n para verificar sin contraseña
        sudoers_ok = False
        sudoers_detalle = "No configurado"
        try:
            elpu_check = _ELPU_PATH if os.path.isfile(_ELPU_PATH) else (_shutil.which("elpu") or _ELPU_PATH)
            r_sudo = _sp.run(
                ["sudo", "-n", elpu_check, "--help"],
                capture_output=True, text=True, timeout=5,
            )
            # Si no pide contraseña (returncode != 1 por "sudo: a password is required")
            sudoers_ok = "password" not in r_sudo.stderr.lower() and "contraseña" not in r_sudo.stderr.lower()
            if not sudoers_ok:
                # Verificar via sudo -n -l
                r_l = _sp.run(["sudo", "-n", "-l"], capture_output=True, text=True, timeout=5)
                sudoers_ok = ("elpu" in r_l.stdout and "NOPASSWD" in r_l.stdout) or \
                             ("(ALL) NOPASSWD: ALL" in r_l.stdout)
            sudoers_detalle = "Configurado" if sudoers_ok else "Falta regla NOPASSWD para elpu"
        except Exception as e:
            sudoers_detalle = str(e)
        chk("Sudo sin contraseña para elpu", sudoers_ok, sudoers_detalle)

        uri_dev = _uri_dispositivo_etiquetas()
        backend_ok = uri_dev.startswith("usb://")
        chk(
            "Backend usb:// (impresión CUPS)",
            backend_ok,
            uri_dev or "Impresora no registrada",
        )
        if uri_dev.startswith("epsonUSB://"):
            chk(
                "Sin backend epsonUSB (rompe impresión)",
                False,
                "Pulsa Instalar impresora para migrar a usb://",
            )

        try:
            total_el, raices_el = _elioud_estado_etiquetas()
            if raices_el == 1:
                det = f"Activo ({total_el} proc.)" if total_el > 1 else "Activo"
                chk("Daemon elioud1 (Epson I/O)", True, det)
            elif raices_el > 1:
                chk(
                    "Daemon elioud1 (Epson I/O)",
                    False,
                    f"{raices_el} daemons duplicados — pulsa Instalar impresora",
                )
            else:
                chk("Daemon elioud1 (Epson I/O)", False, "Inactivo — pulsa Instalar impresora")
        except Exception as e:
            chk("Daemon elioud1 (Epson I/O)", False, str(e))

        # Detectar USB de la impresora
        try:
            r = _sp.run(["lpinfo", "-v"], capture_output=True, text=True, timeout=10)
            usb_uri = next(
                (line.split()[1] for line in r.stdout.splitlines()
                 if "usb" in line.lower() and ("epson" in line.lower() or "c4000" in line.lower())),
                None,
            )
            if usb_uri:
                usb_uri = _uri_usb_cups_desde_uri(usb_uri)
        except Exception:
            usb_uri = None

        todo_ok = all(c["ok"] for c in checks)
        return jsonify({"checks": checks, "todo_ok": todo_ok, "usb_detectado": usb_uri})

    @app.route("/api/etiquetas/instalar", methods=["POST"])
    def api_etiquetas_instalar():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import subprocess as _sp
        import shutil as _shutil

        log = []
        errores = []

        def run(desc, cmd, **kwargs):
            log.append(f"▶ {desc}")
            try:
                r = _sp.run(cmd, capture_output=True, text=True, timeout=30, **kwargs)
                out = (r.stdout + r.stderr).strip()
                if out:
                    log.append(f"  {out[:300]}")
                if r.returncode != 0:
                    errores.append(f"{desc}: código {r.returncode}")
                    log.append(f"  ⚠ código de salida {r.returncode}")
                    return False
                return True
            except Exception as e:
                errores.append(f"{desc}: {e}")
                log.append(f"  ✗ Error: {e}")
                return False

        # 1. Activar CUPS
        run("Activar CUPS", ["sudo", "systemctl", "enable", "--now", "cups"])

        # 2. Determinar PPD
        ppd_cups = f"/etc/cups/ppd/{_PRINTER_NAME}.ppd"
        ppd_repo = os.path.join(_REPO_EPSON_DIR, "CW-C4000u.ppd")
        if os.path.isfile(ppd_cups):
            ppd_usar = ppd_cups
            log.append(f"▶ PPD existente: {ppd_cups}")
        elif os.path.isfile(ppd_repo):
            ppd_usar = ppd_repo
            log.append(f"▶ Usando PPD del repositorio: {ppd_repo}")
        else:
            ppd_usar = None
            log.append("⚠ PPD no encontrado — instala el driver Epson manualmente")
            errores.append("PPD no disponible")

        # 3. URI USB — usb:// para CUPS (epsonUSB:// falla al imprimir)
        try:
            r = _sp.run(["lpinfo", "-v"], capture_output=True, text=True, timeout=10)
            usb_uri = next(
                (line.split()[1] for line in r.stdout.splitlines()
                 if "usb" in line.lower() and ("epson" in line.lower() or "c4000" in line.lower())),
                "usb://EPSON/CW-C4000u",
            )
        except Exception:
            usb_uri = "usb://EPSON/CW-C4000u"
        usb_uri = _uri_usb_cups_desde_uri(usb_uri)
        log.append(f"▶ URI impresora (usb://): {usb_uri}")

        # 4. Registrar o corregir impresora
        r_check = _sp.run(["lpstat", "-p", _PRINTER_NAME], capture_output=True, text=True, timeout=5)
        uri_actual = _uri_dispositivo_etiquetas()
        if r_check.returncode == 0:
            if uri_actual != usb_uri:
                run(
                    f"Corregir backend usb:// en {_PRINTER_NAME}",
                    ["sudo", "lpadmin", "-p", _PRINTER_NAME, "-v", usb_uri],
                )
            else:
                log.append(f"▶ Impresora {_PRINTER_NAME} ya usa backend usb://")
        elif ppd_usar:
            run(
                f"Registrar impresora {_PRINTER_NAME}",
                ["sudo", "lpadmin", "-p", _PRINTER_NAME, "-E", "-v", usb_uri, "-P", ppd_usar],
            )

        # 5. Habilitar y aceptar impresora
        run(f"Habilitar {_PRINTER_NAME}", ["sudo", "cupsenable", _PRINTER_NAME])
        run(f"Aceptar trabajos {_PRINTER_NAME}", ["sudo", "cupsaccept", _PRINTER_NAME])
        run(
            f"Sensor gap por defecto ({_PRINTER_NAME})",
            ["lpoptions", "-p", _PRINTER_NAME, "-o", "MediaForm=Diecut_Gap"],
        )

        # 5b. Daemon Epson I/O (elioud1) para monitoreo de tinta
        if _asegurar_elioud_etiquetas():
            log.append("▶ Daemon elioud1 activo (monitoreo USB Epson)")
        else:
            log.append("⚠ No se pudo iniciar elioud1 — verifica epson-printer-io-community")
            errores.append("elioud1 no disponible")

        # 6. Instalar ELPU si falta
        elpu_local = os.path.join(_REPO_EPSON_DIR, "elpu")
        if not os.path.isfile(_ELPU_PATH) and not _shutil.which("elpu"):
            if os.path.isfile(elpu_local):
                run("Crear directorio ELPU", ["sudo", "mkdir", "-p", os.path.dirname(_ELPU_PATH)])
                run("Instalar elpu", ["sudo", "install", "-m", "755", elpu_local, _ELPU_PATH])
                run("Enlace simbólico elpu", ["sudo", "ln", "-sf", _ELPU_PATH, "/usr/local/bin/elpu"])
            else:
                log.append("⚠ elpu no está en el repositorio — coloca el binario en scripts/epson/elpu")
                errores.append("elpu no disponible")
        else:
            log.append(f"▶ elpu ya instalado")

        # 7. Sudoers para elpu
        elpu_real = _ELPU_PATH if os.path.isfile(_ELPU_PATH) else (_shutil.which("elpu") or _ELPU_PATH)
        sudoers_file = "/etc/sudoers.d/mckg-elpu"
        sudoers_ok = False
        try:
            txt = open(sudoers_file).read() if os.path.isfile(sudoers_file) else ""
            sudoers_ok = "elpu" in txt and "NOPASSWD" in txt
        except Exception:
            pass
        if not sudoers_ok:
            try:
                import getpass as _gp
                usuario = _gp.getuser()
                elioud_real = _ELIOUD_PATH if os.path.isfile(_ELIOUD_PATH) else ""
                contenido = (
                    f"# MCKG Suite — elpu / elioud sin contraseña\n"
                    f"%lpadmin ALL=(ALL) NOPASSWD: {elpu_real}\n"
                    f"{usuario} ALL=(ALL) NOPASSWD: {elpu_real}\n"
                )
                if elioud_real:
                    contenido += (
                        f"{usuario} ALL=(ALL) NOPASSWD: {elioud_real}\n"
                        f"{usuario} ALL=(ALL) NOPASSWD: /usr/bin/pkill\n"
                    )
                tmp = f"/tmp/mckg-elpu-sudoers"
                with open(tmp, "w") as f:
                    f.write(contenido)
                run("Instalar sudoers para elpu", ["sudo", "install", "-m", "440", "-o", "root", "-g", "root", tmp, sudoers_file])
                os.unlink(tmp)
            except Exception as e:
                log.append(f"  ⚠ Sudoers no configurado: {e}")
                errores.append(f"Sudoers: {e}")
        else:
            log.append("▶ Sudoers para elpu ya configurado")

        ok = len(errores) == 0
        return jsonify({"ok": ok, "log": log, "errores": errores})

    @app.route("/api/etiquetas/pdfs", methods=["GET"])
    def api_etiquetas_pdfs():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            pdfs = []
            if os.path.isdir(_PDF_DIR):
                for dirpath, _, files in os.walk(_PDF_DIR):
                    for f in sorted(files):
                        if f.lower().endswith(".pdf"):
                            full = os.path.join(dirpath, f)
                            rel = os.path.relpath(full, _PDF_DIR)
                            pdfs.append({"nombre": f, "ruta": rel, "ruta_completa": full})
            pdfs.sort(key=lambda x: x["nombre"].lower())
            guardados = []
            vistos = set()
            for g in _load_pdfs_guardados_etiquetas():
                rc = g.get("ruta_completa")
                if not rc or rc in vistos:
                    continue
                vistos.add(rc)
                guardados.append({
                    "nombre": g.get("nombre") or os.path.basename(rc),
                    "ruta": g.get("ruta") or os.path.relpath(rc, _PDF_DIR),
                    "ruta_completa": rc,
                    "subido_at": g.get("subido_at"),
                    "guardado": True,
                })
            return jsonify({
                "pdfs": pdfs,
                "guardados": guardados,
                "total": len(pdfs),
                "carpeta_guardados": _PDF_ETIQUETAS_DIR,
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/etiquetas/subir-pdf", methods=["POST"])
    def api_etiquetas_subir_pdf():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        archivo = request.files.get("archivo") or request.files.get("file")
        if not archivo or not archivo.filename:
            return jsonify({"error": "Envía un PDF en el campo multipart «archivo»"}), 400
        nombre_orig = _nombre_pdf_etiqueta_seguro(archivo.filename)
        if not nombre_orig.lower().endswith(".pdf"):
            return jsonify({"error": "Solo se permiten archivos PDF"}), 400
        try:
            raw = archivo.read()
        except Exception as e:
            return jsonify({"error": f"No se pudo leer el archivo: {e}"}), 400
        if len(raw) > _PDF_ETIQUETAS_MAX_BYTES:
            return jsonify({
                "error": f"El PDF supera el límite de {_PDF_ETIQUETAS_MAX_BYTES // (1024 * 1024)} MB",
            }), 400
        if not raw[:5].startswith(b"%PDF"):
            return jsonify({"error": "El archivo no parece un PDF válido"}), 400
        carpeta = _carpeta_pdfs_etiquetas()
        base, ext = os.path.splitext(nombre_orig)
        dest_name = nombre_orig
        dest_path = os.path.join(carpeta, dest_name)
        if os.path.isfile(dest_path):
            stamp = _dt.now().strftime("%Y%m%d_%H%M%S")
            dest_name = f"{base}_{stamp}{ext}"
            dest_path = os.path.join(carpeta, dest_name)
        try:
            with open(dest_path, "wb") as f:
                f.write(raw)
        except OSError as e:
            return jsonify({"error": f"No se pudo guardar en Documentos: {e}"}), 500
        entry = _registrar_pdf_guardado_etiqueta(dest_name, dest_path, len(raw))
        rel = entry.get("ruta") or os.path.relpath(dest_path, _PDF_DIR)
        return jsonify({
            "ok": True,
            "nombre": dest_name,
            "ruta": rel,
            "ruta_completa": dest_path,
            "guardado": True,
            "subido_at": entry.get("subido_at"),
            "bytes": len(raw),
        })

    @app.route("/api/etiquetas/impresora", methods=["GET"])
    def api_etiquetas_impresora():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import subprocess as _sp
        try:
            r = _sp.run(
                ["lpstat", "-p", _PRINTER_NAME],
                capture_output=True, text=True, timeout=5,
            )
            estado = r.stdout.strip() or r.stderr.strip()
            lista = _sp.run(["lpstat", "-p"], capture_output=True, text=True, timeout=5)
            resumen = _estado_cups_resumen_etiquetas(estado)
            if resumen.get("en_pausa"):
                if _despausar_impresora_etiquetas():
                    estado = _estado_cups_etiquetas()
                    resumen = _estado_cups_resumen_etiquetas(estado)
            cola = _trabajos_cola_etiquetas()
            conectada = bool(resumen.get("conectada"))
            legible = resumen.get("legible", "Conectada")
            if cola > 0 and resumen.get("codigo") == "lista":
                legible = f"{legible} · {cola} trabajo(s) en cola"
            return jsonify({
                "impresora": _PRINTER_NAME,
                "estado": estado,
                "estado_legible": legible,
                "cups_codigo": resumen.get("codigo", "ok"),
                "trabajos_en_cola": cola,
                "impresora_conectada": conectada,
                "comunicacion_usb": conectada and _comunicacion_usb_etiquetas(),
                "impresoras_disponibles": lista.stdout.strip(),
                "niveles_tinta": _resumen_niveles_tinta_etiquetas(),
            })
        except Exception as e:
            return jsonify({
                "impresora": _PRINTER_NAME,
                "estado": f"Error: {e}",
                "impresora_conectada": False,
                "comunicacion_usb": False,
                "niveles_tinta": _resumen_niveles_tinta_etiquetas(),
            }), 200

    @app.route("/api/etiquetas/niveles-tinta", methods=["GET"])
    def api_etiquetas_niveles_tinta():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes", "si")
        if refresh:
            return jsonify(_consultar_niveles_tinta_etiquetas())
        return jsonify(_resumen_niveles_tinta_etiquetas())

    @app.route("/api/etiquetas/niveles-tinta/manual", methods=["PUT", "PATCH"])
    def api_etiquetas_niveles_tinta_manual():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        raw = body.get("niveles") if isinstance(body.get("niveles"), dict) else body
        if not isinstance(raw, dict):
            return jsonify({"error": "Envía niveles como objeto {K,C,M,Y,MN}"}), 400
        niveles = _normalizar_niveles_manuales_tinta(raw)
        if not niveles:
            return jsonify({"error": "Sin niveles válidos (0–100)"}), 400
        store = _load_datos_niveles_tinta_store()
        store["niveles_manuales"] = niveles
        store["niveles_manuales_at"] = _dt.now().isoformat(timespec="seconds")
        _save_datos_niveles_tinta_store(store)
        cartuchos, _, _ = _fusionar_cartuchos_niveles_manuales(
            _armar_cartuchos_tinta_elpu("")[0], niveles,
        )
        return jsonify({
            "ok": True,
            "niveles_manuales": niveles,
            "cartuchos": cartuchos,
            "origen_niveles": "manual",
        })

    def _pdf_a_imagen(ruta_pdf: str, dpi: int = 180) -> str:
        """Convierte la primera página del PDF a PNG (tmp). Retorna ruta al PNG."""
        import subprocess as _sp, tempfile as _tmp
        td = _tmp.mkdtemp(prefix="mckg_prev_")
        out_base = os.path.join(td, "page")
        _sp.run(
            ["pdftoppm", "-r", str(dpi), "-png", "-singlefile", ruta_pdf, out_base],
            check=True, capture_output=True, timeout=15,
        )
        return out_base + ".png"

    _MONTSERRAT_ETIQUETA_ARCHIVOS = {
        "light": "Montserrat-Light",
        "regular": "Montserrat-Regular",
        "medium": "Montserrat-Medium",
        "semibold": "Montserrat-SemiBold",
        "bold": "Montserrat-Bold",
        "extrabold": "Montserrat-ExtraBold",
        "black": "Montserrat-Black",
    }

    def _registrar_fuente_montserrat(nombre_registro: str, archivo_ttf: str) -> str | None:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        if nombre_registro in pdfmetrics.getRegisteredFontNames():
            return nombre_registro
        for base in (
            "/usr/share/fonts/truetype/montserrat",
            "/usr/share/fonts/TTF",
            "/usr/share/fonts/truetype",
        ):
            ruta = os.path.join(base, archivo_ttf)
            if os.path.isfile(ruta):
                try:
                    pdfmetrics.registerFont(TTFont(nombre_registro, ruta))
                    return nombre_registro
                except Exception:
                    pass
        return None

    def _fuente_montserrat_etiqueta(variant: str | None = None, bold: bool = False) -> str:
        """Montserrat por variante para campos de plantilla; fallback Helvetica."""
        v = (variant or "").strip().lower()
        if not v:
            v = "bold" if bold else "light"
        archivo = _MONTSERRAT_ETIQUETA_ARCHIVOS.get(v, "Montserrat-Regular")
        nombre = archivo.replace(".ttf", "")
        registrada = _registrar_fuente_montserrat(nombre, f"{archivo}.ttf")
        if registrada:
            return registrada
        return "Helvetica-Bold" if bold or v in ("bold", "extrabold", "black", "semibold") else "Helvetica"

    def _fuente_lote_etiqueta():
        """Montserrat Light para lote/vencimiento; fallback Helvetica."""
        return _fuente_montserrat_etiqueta("light")

    def _lote_xy_desde_pct(w_pt, h_pt, x_pct, y_pct, font_size, font_name):
        """
        Convierte % (origen arriba-izq, igual que el overlay CSS del panel) a coordenadas PDF.
        y_pct=0 → borde superior; y_pct=100 → borde inferior.
        """
        from reportlab.pdfbase import pdfmetrics

        x_val = max(0.0, min(100.0, float(x_pct)))
        y_val = max(0.0, min(100.0, float(y_pct)))
        try:
            ascent = pdfmetrics.getAscent(font_name) / 1000.0 * font_size
            descent = abs(pdfmetrics.getDescent(font_name) / 1000.0 * font_size)
        except Exception:
            ascent = font_size * 0.72
            descent = font_size * 0.22
        x_pt = w_pt * x_val / 100.0
        top_from_top = h_pt * y_val / 100.0
        y_baseline = h_pt - top_from_top - ascent
        return x_pt, y_baseline, ascent, descent

    def _dibujar_linea_texto_etiqueta(c, linea, font_name, fs, x_pt, y_l, align, box_w_pt=0):
        """Dibuja una línea con alineación; justify reparte espacio en el ancho de caja."""
        align = (align or "left").strip().lower()
        if align == "justify" and box_w_pt > 8:
            palabras = linea.split()
            if len(palabras) >= 2:
                anchos = [c.stringWidth(p, font_name, fs) for p in palabras]
                total = sum(anchos)
                huecos = len(palabras) - 1
                extra = box_w_pt - total
                if extra > 0 and huecos > 0:
                    gap = extra / huecos
                    x = x_pt
                    for i, palabra in enumerate(palabras):
                        c.drawString(x, y_l, palabra)
                        if i < huecos:
                            x += anchos[i] + gap
                    return
        if align == "center":
            tw = c.stringWidth(linea, font_name, fs)
            if box_w_pt > 0:
                c.drawString(x_pt + (box_w_pt - tw) / 2.0, y_l, linea)
            else:
                c.drawString(x_pt - tw / 2.0, y_l, linea)
        elif align == "right":
            if box_w_pt > 0:
                c.drawRightString(x_pt + box_w_pt, y_l, linea)
            else:
                c.drawRightString(x_pt, y_l, linea)
        else:
            c.drawString(x_pt, y_l, linea)

    def _color_etiqueta_sin(color_hex) -> bool:
        if not color_hex:
            return True
        return str(color_hex).strip().lower() in ("transparent", "none", "")

    def _color_etiqueta_rl(color_hex, color_cmyk=None):
        from reportlab.lib.colors import CMYKColor, HexColor, black
        if _color_etiqueta_sin(color_hex):
            return black
        if isinstance(color_cmyk, dict):
            try:
                return CMYKColor(
                    max(0.0, min(1.0, float(color_cmyk.get("c", 0)) / 100.0)),
                    max(0.0, min(1.0, float(color_cmyk.get("m", 0)) / 100.0)),
                    max(0.0, min(1.0, float(color_cmyk.get("y", 0)) / 100.0)),
                    max(0.0, min(1.0, float(color_cmyk.get("k", 0)) / 100.0)),
                )
            except Exception:
                pass
        try:
            return HexColor((color_hex or "#000000").strip())
        except Exception:
            return black

    def _pdf_con_campos_texto(
        ruta_pdf: str,
        campos: list,
        lote: str = "",
        vencimiento: str = "",
        lote_pos: str = "bottom-left",
        lote_font: int = 7,
        lote_x_pct: float | None = None,
        lote_y_pct: float | None = None,
        lineas: list | None = None,
        imagenes: list | None = None,
        rectangulos: list | None = None,
    ) -> str:
        """
        Genera PDF temporal con:
        - lineas: [{x1_pct,y1_pct,x2_pct,y2_pct,grosor,color,color_cmyk}] origen top-left %
        - rectangulos: [{x_pct,y_pct,ancho_pct,alto_pct,relleno,color_relleno,color_trazo,grosor_trazo}]
        - imagenes: [{ruta_completa,x_pct,y_pct,ancho_pct}] PNG sobre el PDF
        - campos: lista de {texto, x_pct, y_pct, font_size, bold, align, fondo_blanco, color, color_cmyk,
          color_trazo, color_trazo_cmyk, grosor_trazo}
          x_pct/y_pct: 0-100 porcentaje del tamaño de página, origen top-left.
          Admite saltos de línea (\n) en texto.
        - lote/vencimiento: Montserrat Light; posición por lote_x_pct/lote_y_pct o esquina (lote_pos).
        """
        import io as _io
        import tempfile as _tmp
        import PyPDF2
        from reportlab.pdfgen import canvas as _rl_canvas
        from reportlab.lib.units import mm as _mm
        from reportlab.lib.colors import HexColor, black, white

        reader = PyPDF2.PdfReader(ruta_pdf)
        writer = PyPDF2.PdfWriter()

        for page in reader.pages:
            mb = page.mediabox
            w_pt = float(mb.width)
            h_pt = float(mb.height)

            buf = _io.BytesIO()
            c = _rl_canvas.Canvas(buf, pagesize=(w_pt, h_pt))

            for ln in (lineas or []):
                if _color_etiqueta_sin(ln.get("color")):
                    continue
                grosor = float(ln.get("grosor", 1))
                if grosor < 0.1:
                    continue
                c.setStrokeColor(_color_etiqueta_rl(ln.get("color"), ln.get("color_cmyk")))
                grosor = max(0.1, min(20.0, grosor))
                c.setLineWidth(grosor)
                x1 = w_pt * float(ln.get("x1_pct", 0)) / 100.0
                y1 = h_pt * (1.0 - float(ln.get("y1_pct", 0)) / 100.0)
                x2 = w_pt * float(ln.get("x2_pct", 0)) / 100.0
                y2 = h_pt * (1.0 - float(ln.get("y2_pct", 0)) / 100.0)
                c.line(x1, y1, x2, y2)

            for rc in (rectangulos or []):
                try:
                    x_pct_r = float(rc.get("x_pct", 0))
                    y_pct_r = float(rc.get("y_pct", 0))
                    w_pct_r = max(0.5, min(100.0, float(rc.get("ancho_pct", 10))))
                    h_pct_r = max(0.5, min(100.0, float(rc.get("alto_pct", 10))))
                    x_r = w_pt * x_pct_r / 100.0
                    rw = w_pt * w_pct_r / 100.0
                    rh = h_pt * h_pct_r / 100.0
                    y_top_r = h_pt * (1.0 - y_pct_r / 100.0)
                    y_r = y_top_r - rh
                    grosor_r = float(rc.get("grosor_trazo", 1))
                    sin_trazo = _color_etiqueta_sin(rc.get("color_trazo")) or grosor_r <= 0
                    con_relleno = bool(rc.get("relleno")) and not _color_etiqueta_sin(rc.get("color_relleno"))
                    if not con_relleno and sin_trazo:
                        continue
                    if not sin_trazo:
                        c.setLineWidth(max(0.25, min(6.0, grosor_r)))
                        c.setStrokeColor(_color_etiqueta_rl(rc.get("color_trazo"), rc.get("color_trazo_cmyk")))
                    if con_relleno:
                        c.setFillColor(_color_etiqueta_rl(rc.get("color_relleno"), rc.get("color_relleno_cmyk")))
                        c.rect(x_r, y_r, rw, rh, fill=1, stroke=0 if sin_trazo else 1)
                    elif not sin_trazo:
                        c.rect(x_r, y_r, rw, rh, fill=0, stroke=1)
                except Exception:
                    pass

            for img in (imagenes or []):
                ruta_img = (img.get("ruta_completa") or "").strip()
                if not ruta_img or not os.path.isfile(ruta_img):
                    continue
                if not ruta_img.lower().endswith((".png", ".jpg", ".jpeg", ".jpe")):
                    continue
                try:
                    x_pct_i = float(img.get("x_pct", 0))
                    y_pct_i = float(img.get("y_pct", 0))
                    w_pct_i = max(1.0, min(100.0, float(img.get("ancho_pct", 20))))
                    img_w = w_pt * w_pct_i / 100.0
                    alto_pct_val = img.get("alto_pct")
                    if alto_pct_val is not None:
                        try:
                            img_h = h_pt * max(1.0, min(100.0, float(alto_pct_val))) / 100.0
                        except (TypeError, ValueError):
                            img_h = img_w
                    else:
                        ar = 1.0
                        try:
                            from PIL import Image as _PILImage
                            with _PILImage.open(ruta_img) as im:
                                ar = im.height / float(im.width or 1)
                        except Exception:
                            pass
                        img_h = img_w * ar
                    x_pt_i = w_pt * x_pct_i / 100.0
                    y_top_i = h_pt * (1.0 - y_pct_i / 100.0)
                    y_pt_i = y_top_i - img_h
                    c.drawImage(ruta_img, x_pt_i, y_pt_i, width=img_w, height=img_h, mask="auto")
                except Exception:
                    pass

            for campo in (campos or []):
                texto = (campo.get("texto") or "").strip()
                if not texto:
                    continue
                fs = max(3, min(40, int(campo.get("font_size", 8))))
                bold = campo.get("bold", False)
                align = campo.get("align", "left")
                fondo = False
                color_hex = (campo.get("color") or "#000000").strip()
                if _color_etiqueta_sin(color_hex):
                    continue
                x_pct = float(campo.get("x_pct", 5))
                y_pct = float(campo.get("y_pct", 5))
                try:
                    ancho_caja_pct = float(campo.get("ancho_caja_pct") or 0)
                except (TypeError, ValueError):
                    ancho_caja_pct = 0.0
                box_w_pt = w_pt * ancho_caja_pct / 100.0 if ancho_caja_pct > 0 else 0.0

                font_name = _fuente_montserrat_etiqueta(
                    campo.get("font_variant"),
                    bold=bool(bold),
                )
                x_pt = w_pt * x_pct / 100.0
                # PDF origen bottom-left; y_pct desde top-left
                y_base_pt = h_pt * (1.0 - y_pct / 100.0) - fs

                lineas = texto.split("\n")
                lh = fs * 1.3

                fill_color = _color_etiqueta_rl(color_hex, campo.get("color_cmyk"))
                stroke_w = max(0.0, float(campo.get("grosor_trazo") or 0))
                stroke_color = _color_etiqueta_rl(
                    campo.get("color_trazo") or "#000000",
                    campo.get("color_trazo_cmyk"),
                )
                if stroke_w > 0 and _color_etiqueta_sin(campo.get("color_trazo")):
                    stroke_w = 0.0
                for i, linea in enumerate(lineas):
                    y_l = y_base_pt - i * lh
                    c.setFont(font_name, fs)
                    c.setFillColor(fill_color)
                    if stroke_w > 0:
                        c.setStrokeColor(stroke_color)
                        c.setLineWidth(stroke_w * 0.35)
                        c.setTextRenderMode(2)
                    else:
                        c.setTextRenderMode(0)
                    if fondo:
                        tw = c.stringWidth(linea, font_name, fs)
                        pad = 1.5
                        c.setFillColor(white)
                        c.rect(x_pt - pad, y_l - pad, tw + pad * 2, fs + pad * 2, fill=1, stroke=0)
                        c.setFillColor(fill_color)
                    _dibujar_linea_texto_etiqueta(
                        c, linea, font_name, fs, x_pt, y_l, align, box_w_pt=box_w_pt,
                    )

            # Lote / vencimiento — Montserrat Light, posición % (igual que overlay del panel)
            if lote or vencimiento:
                fn = _fuente_lote_etiqueta()
                c.setFont(fn, lote_font)
                c.setFillColor(black)
                lh2 = lote_font * 1.35
                lineas2 = []
                if lote:
                    lineas2.append(lote)
                if vencimiento:
                    lineas2.append(vencimiento)
                x_pct_val = max(0.0, min(100.0, 5.0 if lote_x_pct is None else float(lote_x_pct)))
                y_pct_val = max(0.0, min(100.0, 88.0 if lote_y_pct is None else float(lote_y_pct)))
                # Misma convención que campos_texto y el overlay CSS (top % + tamaño pt)
                xp = w_pt * x_pct_val / 100.0
                y_base_pt = h_pt * (1.0 - y_pct_val / 100.0) - lote_font
                for i2, txt2 in enumerate(lineas2):
                    c.drawString(xp, y_base_pt - i2 * lh2, txt2)

            c.save()
            buf.seek(0)
            overlay_page = PyPDF2.PdfReader(buf).pages[0]
            page.merge_page(overlay_page)
            writer.add_page(page)

        tmp_fd, tmp_path = _tmp.mkstemp(suffix=".pdf", prefix="mckg_txt_")
        with os.fdopen(tmp_fd, "wb") as f:
            writer.write(f)
        return tmp_path

    def _pdf_con_overlay(ruta_pdf: str, lote: str, vencimiento: str,
                         pos: str, font_size: int) -> str:
        """Genera un PDF temporal con lote/vencimiento superpuesto. Retorna la ruta al tmp."""
        import io as _io
        import tempfile as _tmp
        import PyPDF2
        from reportlab.pdfgen import canvas as _rl_canvas
        from reportlab.lib.units import mm as _mm

        reader = PyPDF2.PdfReader(ruta_pdf)
        writer = PyPDF2.PdfWriter()

        for page in reader.pages:
            mb = page.mediabox
            w_pt = float(mb.width)
            h_pt = float(mb.height)

            # Crear overlay con las dimensiones exactas de esta página
            buf = _io.BytesIO()
            c = _rl_canvas.Canvas(buf, pagesize=(w_pt, h_pt))
            fn = _fuente_lote_etiqueta()
            c.setFont(fn, font_size)

            margen = 3 * _mm
            linea = font_size * 1.35  # interlineado en pts

            # Texto a imprimir
            lineas = []
            if lote:
                lineas.append(lote)
            if vencimiento:
                lineas.append(vencimiento)

            if pos == "bottom-left":
                x = margen
                y_base = margen + linea * (len(lineas) - 1)
            elif pos == "bottom-right":
                max_w = max((c.stringWidth(l, fn, font_size) for l in lineas), default=0)
                x = w_pt - max_w - margen
                y_base = margen + linea * (len(lineas) - 1)
            elif pos == "top-left":
                x = margen
                y_base = h_pt - margen - font_size
            else:  # top-right
                max_w = max((c.stringWidth(l, fn, font_size) for l in lineas), default=0)
                x = w_pt - max_w - margen
                y_base = h_pt - margen - font_size

            for i, texto in enumerate(lineas):
                c.drawString(x, y_base - i * linea, texto)

            c.save()
            buf.seek(0)

            overlay_page = PyPDF2.PdfReader(buf).pages[0]
            page.merge_page(overlay_page)
            writer.add_page(page)

        tmp_fd, tmp_path = _tmp.mkstemp(suffix=".pdf", prefix="mckg_lote_")
        with os.fdopen(tmp_fd, "wb") as f:
            writer.write(f)
        return tmp_path

    @app.route("/api/etiquetas/preview", methods=["POST"])
    def api_etiquetas_preview():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import base64 as _b64
        data = request.get_json(silent=True) or {}

        ruta_pdf = data.get("ruta_pdf", "")
        campos_texto = data.get("campos_texto") or []
        lineas = data.get("lineas") or []
        imagenes = data.get("imagenes") or []
        rectangulos = data.get("rectangulos") or []

        if not ruta_pdf:
            return jsonify({"error": "Falta ruta_pdf"}), 400

        ruta_pdf, err_pdf = _ruta_pdf_etiquetas_ok(ruta_pdf)
        if err_pdf:
            code = 404 if "no encontrado" in err_pdf.lower() else 400
            return jsonify({"error": err_pdf}), code

        tmp_pdf = None
        tmp_dir = None
        try:
            pdf_para_preview = ruta_pdf
            # Lote/vencimiento: solo overlay arrastrable en el panel (evita texto duplicado en PNG).
            if campos_texto or lineas or imagenes or rectangulos:
                tmp_pdf = _pdf_con_campos_texto(
                    ruta_pdf, campos_texto, lineas=lineas, imagenes=imagenes, rectangulos=rectangulos,
                )
                pdf_para_preview = tmp_pdf

            png_path = _pdf_a_imagen(pdf_para_preview, dpi=180)
            tmp_dir = os.path.dirname(png_path)
            img_bytes = open(png_path, "rb").read()
            return jsonify({
                "imagen": _b64.b64encode(img_bytes).decode(),
                "mime": "image/png",
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        finally:
            if tmp_pdf and os.path.isfile(tmp_pdf):
                try:
                    os.unlink(tmp_pdf)
                except Exception:
                    pass
            if tmp_dir and os.path.isdir(tmp_dir):
                try:
                    import shutil as _sh2
                    _sh2.rmtree(tmp_dir, ignore_errors=True)
                except Exception:
                    pass

    @app.route("/api/etiquetas/imprimir", methods=["POST"])
    def api_etiquetas_imprimir():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import subprocess as _sp
        import shutil as _shutil
        data = request.get_json(silent=True) or {}

        producto = data.get("producto", "")
        forma = data.get("forma", "Diecut_Gap")
        calidad = data.get("calidad", "Normal")
        rotacion = _rotacion_etiqueta_valida(data.get("rotacion", "0"))
        cantidad = data.get("cantidad", 1)
        offset_v = float(data.get("offset_v", 0.0))
        offset_h = float(data.get("offset_h", 0.0))
        ruta_pdf = data.get("ruta_pdf", "")
        lote = _lote_impresion_etiqueta(data.get("lote"))
        vencimiento = _exp_impresion_etiqueta(data.get("vencimiento"))
        lote_font = int(data.get("lote_font", 7))
        try:
            lote_x_pct = max(0.0, min(100.0, float(data.get("lote_x_pct", 5))))
        except (TypeError, ValueError):
            lote_x_pct = 5.0
        try:
            lote_y_pct = max(0.0, min(100.0, float(data.get("lote_y_pct", 88))))
        except (TypeError, ValueError):
            lote_y_pct = 88.0
        campos_texto = data.get("campos_texto") or []
        lineas = data.get("lineas") or []
        imagenes = data.get("imagenes") or []
        rectangulos = data.get("rectangulos") or []

        if forma not in _MAPEO_FORMA:
            return jsonify({"error": f"Forma no válida: {forma}"}), 400
        if calidad not in _MAPEO_CALIDAD:
            return jsonify({"error": f"Calidad no válida: {calidad}"}), 400
        if rotacion not in _MAPEO_ROTACION:
            return jsonify({"error": f"Rotación no válida: {rotacion}"}), 400
        if not isinstance(cantidad, int) or cantidad < 1 or cantidad > 999:
            return jsonify({"error": "Cantidad debe ser un entero entre 1 y 999"}), 400

        studio_datos = data.get("studio_datos")
        usar_studio = isinstance(studio_datos, dict) and bool(
            (studio_datos.get("nombre_producto") or "").strip()
            or (studio_datos.get("sku") or "").strip()
        )
        tmp_studio_dir = None
        if usar_studio:
            from app.tools.etiquetas_studio import generar_pdf_temporal_para_impresion

            sd = dict(studio_datos)
            if lote:
                sd["lote"] = lote
            if vencimiento:
                sd["vencimiento"] = vencimiento
            try:
                ruta_pdf, _meta_studio = generar_pdf_temporal_para_impresion(sd)
                tmp_studio_dir = os.path.dirname(ruta_pdf)
            except Exception as e:
                return jsonify({"error": f"No se pudo generar PDF desde plantilla: {e}"}), 400
            producto = sd.get("tipo_etiqueta") or producto
            dims = _dimensiones_etiqueta(producto, sd.get("ancho_mm"), sd.get("alto_mm"))
            if not dims:
                return jsonify({
                    "error": f"Formato desconocido: {producto}. Indica ancho_mm y alto_mm.",
                }), 400
        elif not ruta_pdf:
            return jsonify({"error": "Debe especificar ruta_pdf o studio_datos"}), 400
        else:
            ruta_pdf, err_pdf = _ruta_pdf_etiquetas_ok(ruta_pdf)
            if err_pdf:
                code = 404 if "no encontrado" in err_pdf.lower() else 400
                return jsonify({"error": err_pdf}), code
            dims = _dimensiones_etiqueta(producto, data.get("ancho_mm"), data.get("alto_mm"))
            if not dims:
                return jsonify({
                    "error": f"Formato desconocido: {producto}. Indica ancho_mm y alto_mm.",
                }), 400

        ancho, alto = dims
        max_ancho, max_alto = _ETIQUETAS_MAX_MM
        if ancho > max_ancho or alto > max_alto:
            return jsonify({
                "error": (
                    f"Tamaño {ancho}×{alto} mm fuera de rango de la impresora "
                    f"(máx. {max_ancho:g}×{max_alto:g} mm)."
                ),
            }), 400
        if producto in _ETIQUETAS_ROTACION and rotacion == "0":
            rotacion = _ETIQUETAS_ROTACION[producto]
        orientacion = _MAPEO_ROTACION[rotacion]
        calidad_val = _MAPEO_CALIDAD[calidad]
        forma_val = _MAPEO_FORMA[forma]
        m_top = round(offset_v * 2.83465, 2)
        m_left = round(offset_h * 2.83465, 2)

        log_lines = []
        tmp_pdf = None
        elioud_suspendido = False
        try:
            atascados = _cancelar_trabajos_atascados_etiquetas()
            if atascados:
                log_lines.append(f"Cola: cancelados {len(atascados)} trabajo(s) atascado(s)")

            preflight = _verificar_impresora_etiquetas()
            if preflight:
                log_lines.append(f"Pre-vuelo: {preflight.get('detalle', preflight['error'])}")
                return jsonify({
                    "ok": False,
                    "log": log_lines,
                    "error": preflight["error"],
                    "solucion": preflight["solucion"],
                    "codigo": preflight.get("codigo", "preflight"),
                })

            _asegurar_backend_usb_cups_etiquetas()
            _reiniciar_elioud_etiquetas()

            preflight_elpu, aviso_elpu = _preflight_elpu_impresora_etiquetas(
                omitir_comunicacion=True,
            )
            if aviso_elpu:
                log_lines.append(f"Pre-vuelo ELPU: aviso — {aviso_elpu}")
            if preflight_elpu:
                log_lines.append(f"Pre-vuelo ELPU: {preflight_elpu.get('detalle', preflight_elpu['error'])}")
                return jsonify({
                    "ok": False,
                    "log": log_lines,
                    "error": preflight_elpu["error"],
                    "solucion": preflight_elpu["solucion"],
                    "codigo": preflight_elpu.get("codigo", "preflight"),
                })

            # Overlay de líneas, imágenes PNG, campos de texto + lote/vencimiento
            pdf_a_imprimir = ruta_pdf
            if usar_studio:
                ai_arch = (studio_datos or {}).get("archivo_ai") or "plantilla SVG"
                log_lines.append(f"Etiqueta desde plantilla: {ai_arch}")
            overlay_lote = not usar_studio and (lote or vencimiento)
            if overlay_lote or campos_texto or lineas or imagenes or rectangulos:
                lote_font_val = max(3, min(40, lote_font))
                tmp_pdf = _pdf_con_campos_texto(
                    ruta_pdf, campos_texto, lote, vencimiento, "custom", lote_font_val,
                    lote_x_pct=lote_x_pct, lote_y_pct=lote_y_pct, lineas=lineas, imagenes=imagenes,
                    rectangulos=rectangulos,
                )
                pdf_a_imprimir = tmp_pdf
                info = []
                if lineas:
                    info.append(f"{len(lineas)} línea(s)")
                if rectangulos:
                    info.append(f"{len(rectangulos)} rectángulo(s)")
                if imagenes:
                    info.append(f"{len(imagenes)} imagen(es)")
                if campos_texto:
                    info.append(f"{len(campos_texto)} campo(s) de texto")
                if overlay_lote:
                    info.append(f"lote/vence ({lote_x_pct:.1f}%, {lote_y_pct:.1f}%)")
                if info:
                    log_lines.append(f"Overlay aplicado: {', '.join(info)}")

            _preparar_medio_elpu_etiquetas(forma_val, calidad_val, ancho, alto, log_lines)
            _ejecutar_elpu_offset_etiquetas(offset_v, log_lines)
            _suspender_elioud_impresion_etiquetas()
            elioud_suspendido = True

            cmd = [
                "lp", "-d", _PRINTER_NAME,
                "-n", str(cantidad),
                "-o", f"PageSize=Custom.{ancho}x{alto}mm",
                "-o", f"MediaForm={forma_val}",
                "-o", f"PrintQuality={calidad_val}",
                "-o", f"page-top={m_top}",
                "-o", f"page-left={m_left}",
                "-o", f"orientation-requested={orientacion}",
                "-o", "fit-to-page",
                pdf_a_imprimir,
            ]
            r_lp = _sp.run(cmd, capture_output=True, text=True, timeout=30)
            salida_lp = (r_lp.stdout + r_lp.stderr).strip()
            log_lines.append(f"lp: {salida_lp or 'OK'}")

            if r_lp.returncode != 0:
                return jsonify(_respuesta_error_impresion_etiquetas(
                    log_lines, salida_lp, producto=producto, forma=forma,
                ))

            job_id = _id_trabajo_desde_lp(salida_lp)
            if job_id:
                log_lines.append(f"CUPS: esperando {job_id}…")
                ok_job, det_job = _esperar_trabajo_cups_etiquetas(job_id)
                if not ok_job:
                    log_lines.append(f"CUPS: falló — {det_job[:240]}")
                    if _trabajo_cups_fallo(det_job.lower()):
                        _sp.run(["cancel", job_id], capture_output=True, text=True, timeout=5)
                    return jsonify(_respuesta_error_impresion_etiquetas(
                        log_lines, det_job, producto=producto, forma=forma,
                    ))

            desc_inv = _descontar_inventario_papel_etiquetas(ancho, alto, cantidad, producto)
            if desc_inv.get("ok"):
                log_lines.append(
                    f"Inventario: −{desc_inv['descontadas']} etiquetas · {desc_inv.get('ref')} · "
                    f"quedan {desc_inv.get('restantes')} ({desc_inv.get('rollos')} rollos + "
                    f"{desc_inv.get('etiquetas_sueltas')} sueltas)"
                )
                if desc_inv.get("agotado"):
                    log_lines.append("Inventario: ⚠️ sin etiquetas de este tamaño")
            else:
                log_lines.append(f"Inventario: {desc_inv.get('mensaje', 'sin descuento')}")

            return jsonify({"ok": True, "log": log_lines, "inventario": desc_inv})
        except Exception as e:
            log_lines.append(f"Excepción: {e}")
            err = _respuesta_error_impresion_etiquetas(
                log_lines, str(e), producto=producto, forma=forma,
            )
            return jsonify(err)
        finally:
            if elioud_suspendido:
                _reiniciar_elioud_etiquetas()
            if tmp_pdf and os.path.isfile(tmp_pdf):
                try:
                    os.unlink(tmp_pdf)
                except Exception:
                    pass
            if tmp_studio_dir and os.path.isdir(tmp_studio_dir):
                try:
                    _shutil.rmtree(tmp_studio_dir, ignore_errors=True)
                except Exception:
                    pass

    # ── Publicaciones (editor de catálogo) ────────────────────────────────────

    @app.route("/api/publicaciones", methods=["GET"])
    def api_publicaciones_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import listar_publicaciones
        buscar = request.args.get("buscar", "").strip()
        categoria = request.args.get("categoria", "").strip()
        try:
            return jsonify(listar_publicaciones(buscar=buscar, categoria=categoria))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>", methods=["GET"])
    def api_publicacion_detalle(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import obtener_publicacion
        live = request.args.get("live_meli", "0") == "1"
        try:
            item = obtener_publicacion(sku, live_meli=live)
            if item is None:
                return jsonify({"error": "Producto no encontrado"}), 404
            return jsonify(item)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>", methods=["PUT"])
    def api_publicacion_update(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import actualizar_publicacion
        body = request.get_json(silent=True) or {}
        try:
            return jsonify(actualizar_publicacion(sku, body))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>/sync-web", methods=["POST"])
    def api_publicacion_sync_web(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import aplicar_overrides_a_cache, refrescar_web
        try:
            r_cache = aplicar_overrides_a_cache()
            r_web = refrescar_web()
            return jsonify({"ok": r_cache["ok"] or r_web["ok"], "cache": r_cache, "web": r_web})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/sync-web-all", methods=["POST"])
    def api_publicaciones_sync_web_all():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import aplicar_overrides_a_cache, refrescar_web
        try:
            r_cache = aplicar_overrides_a_cache()
            r_web = refrescar_web()
            return jsonify({"ok": True, "cache": r_cache, "web": r_web})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>/sync-meli", methods=["POST"])
    def api_publicacion_sync_meli(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import sincronizar_meli_stock
        body = request.get_json(silent=True) or {}
        stock = body.get("stock")
        if stock is None:
            return jsonify({"error": "Campo 'stock' requerido"}), 400
        try:
            return jsonify(sincronizar_meli_stock(sku, int(stock)))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/refresh-web", methods=["POST"])
    def api_publicaciones_refresh_web():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import refrescar_web
        try:
            return jsonify(refrescar_web())
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>/fotos", methods=["GET"])
    def api_publicacion_fotos(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import obtener_fotos_actuales, obtener_publicacion
        meli_item_id = request.args.get("meli_item_id", "").strip()
        if not meli_item_id:
            pub = obtener_publicacion(sku)
            if pub:
                meli_item_id = pub.get("meli_id_efectivo", "")
        try:
            return jsonify(obtener_fotos_actuales(sku, meli_item_id))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>/imagen", methods=["POST"])
    def api_publicacion_imagen(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import (
            subir_imagen_web, subir_imagen_meli,
            aplicar_overrides_a_cache, refrescar_web, obtener_publicacion,
        )

        targets_raw = request.form.get("targets") or request.args.get("targets") or "web"
        targets = {t.strip() for t in targets_raw.split(",")}
        meli_item_id = (request.form.get("meli_item_id") or "").strip()
        if "meli" in targets and not meli_item_id:
            pub = obtener_publicacion(sku)
            if pub:
                meli_item_id = pub.get("meli_id_efectivo", "")

        # Acepta uno o varios archivos (campo "file" o "files[]")
        files = request.files.getlist("files[]") or request.files.getlist("file")
        if not files or not files[0].filename:
            return jsonify({"error": "No se recibió archivo (campo 'file' o 'files[]' en multipart)"}), 400

        all_results = []
        web_updated = False
        for f in files:
            file_bytes = f.read()
            content_type = f.content_type or "image/jpeg"
            filename = f.filename or f"{sku}.jpg"
            res_file: dict = {"filename": filename, "web": None, "meli": None}

            if "web" in targets:
                try:
                    r = subir_imagen_web(sku, file_bytes, filename)
                    res_file["web"] = r
                    if r.get("ok"):
                        web_updated = True
                except Exception as e:
                    res_file["web"] = {"ok": False, "error": str(e)}

            if "meli" in targets:
                if not meli_item_id:
                    res_file["meli"] = {"ok": False, "error": "Sin ID MeLi vinculado"}
                else:
                    try:
                        res_file["meli"] = subir_imagen_meli(
                            meli_item_id, file_bytes, content_type, sku=sku,
                        )
                    except Exception as e:
                        res_file["meli"] = {"ok": False, "error": str(e)}

            all_results.append(res_file)

        if web_updated:
            try:
                aplicar_overrides_a_cache()
                refrescar_web()
            except Exception:
                pass

        ok = any(
            (r.get("web", {}) or {}).get("ok") or (r.get("meli", {}) or {}).get("ok")
            for r in all_results
        )
        return jsonify({"ok": ok, "sku": sku, "archivos": all_results})

    @app.route("/api/publicaciones/<sku>/imagenes/web", methods=["PUT"])
    def api_publicacion_imagenes_web_orden(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import reordenar_imagenes_web, aplicar_overrides_a_cache, refrescar_web
        body = request.get_json(silent=True) or {}
        orden = body.get("orden", [])
        if not isinstance(orden, list):
            return jsonify({"error": "'orden' debe ser lista de filenames"}), 400
        try:
            result = reordenar_imagenes_web(sku, orden)
            if result.get("ok"):
                try:
                    aplicar_overrides_a_cache()
                    refrescar_web()
                except Exception:
                    pass
            return jsonify(result)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>/imagenes/meli", methods=["PUT"])
    def api_publicacion_imagenes_meli_orden(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import reordenar_imagenes_meli, obtener_publicacion
        body = request.get_json(silent=True) or {}
        picture_ids = body.get("picture_ids", [])
        meli_item_id = (body.get("meli_item_id") or "").strip()
        if not meli_item_id:
            pub = obtener_publicacion(sku)
            if pub:
                meli_item_id = pub.get("meli_id_efectivo", "")
        if not meli_item_id:
            return jsonify({"error": "Sin ID de publicación MeLi"}), 400
        try:
            return jsonify(reordenar_imagenes_meli(meli_item_id, picture_ids, sku=sku))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>/imagen/web", methods=["DELETE"])
    def api_publicacion_eliminar_imagen_web(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import eliminar_imagen_web, aplicar_overrides_a_cache, refrescar_web
        body = request.get_json(silent=True) or {}
        filename = (body.get("filename") or "").strip()
        if not filename:
            return jsonify({"error": "Campo 'filename' requerido"}), 400
        try:
            result = eliminar_imagen_web(sku, filename)
            if result.get("ok"):
                try:
                    aplicar_overrides_a_cache()
                    refrescar_web()
                except Exception:
                    pass
            return jsonify(result)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/publicaciones/<sku>/imagen/meli", methods=["DELETE"])
    def api_publicacion_eliminar_imagen_meli(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services.publicaciones import eliminar_imagen_meli, obtener_publicacion
        body = request.get_json(silent=True) or {}
        picture_id = (body.get("picture_id") or "").strip()
        meli_item_id = (body.get("meli_item_id") or "").strip()
        if not picture_id:
            return jsonify({"error": "Campo 'picture_id' requerido"}), 400
        if not meli_item_id:
            pub = obtener_publicacion(sku)
            if pub:
                meli_item_id = pub.get("meli_id_efectivo", "")
        if not meli_item_id:
            return jsonify({"error": "Sin ID de publicación MeLi"}), 400
        try:
            return jsonify(eliminar_imagen_meli(meli_item_id, picture_id, sku=sku))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Etiquetas: edición directa de texto en PDF ───────────────────────────

    def _color_int_to_hex(color_int: int) -> str:
        r = (color_int >> 16) & 0xFF
        g = (color_int >> 8) & 0xFF
        b = color_int & 0xFF
        return f"#{r:02x}{g:02x}{b:02x}"

    def _color_hex_to_rgb(hex_str: str) -> tuple:
        h = (hex_str or "#000000").lstrip("#")
        if len(h) != 6:
            return (0.0, 0.0, 0.0)
        return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)

    # Busca el archivo de fuente en el sistema dado el nombre del font del PDF
    _font_file_cache: dict[str, str | None] = {}

    def _buscar_font_file(font_name: str) -> str | None:
        key = font_name.lower()
        if key in _font_file_cache:
            return _font_file_cache[key]
        import subprocess as _sp2, glob as _gl
        # 1. Búsqueda directa por nombre en directorios de fuentes comunes
        dirs = ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts")]
        safe = font_name.replace("-", "").replace(" ", "")
        for d in dirs:
            for ext in ("otf", "ttf", "OTF", "TTF"):
                pattern = os.path.join(d, "**", f"{font_name}.{ext}")
                matches = _gl.glob(pattern, recursive=True)
                if matches:
                    _font_file_cache[key] = matches[0]
                    return matches[0]
        # 2. fc-match como fallback
        try:
            r2 = _sp2.run(
                ["fc-match", "--format=%{file}", font_name],
                capture_output=True, text=True, timeout=5,
            )
            path = r2.stdout.strip()
            # Solo aceptar si el nombre del archivo es razonablemente similar
            fname_lower = os.path.basename(path).lower().replace("-", "").replace("_", "")
            safe_lower = safe.lower()
            if path and os.path.isfile(path) and (
                safe_lower[:6] in fname_lower or fname_lower[:6] in safe_lower
            ):
                _font_file_cache[key] = path
                return path
        except Exception:
            pass
        _font_file_cache[key] = None
        return None

    @app.route("/api/etiquetas/extraer-texto", methods=["GET"])
    def api_etiquetas_extraer_texto():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        ruta_pdf = request.args.get("ruta_pdf", "").strip()
        if not ruta_pdf:
            return jsonify({"error": "Falta ruta_pdf"}), 400
        ruta_pdf, err_pdf = _ruta_pdf_etiquetas_ok(ruta_pdf)
        if err_pdf:
            code = 404 if "no encontrado" in err_pdf.lower() else 400
            return jsonify({"error": err_pdf}), code
        try:
            import fitz as _fitz
            doc = _fitz.open(ruta_pdf)
            spans = []
            uid = 0
            for pg_num, page in enumerate(doc):
                data = page.get_text("dict", flags=_fitz.TEXT_PRESERVE_WHITESPACE)
                for blk in data.get("blocks", []):
                    if blk.get("type") != 0:
                        continue
                    for ln in blk.get("lines", []):
                        for sp in ln.get("spans", []):
                            txt = sp.get("text", "")
                            if not txt.strip():
                                continue
                            origin = sp.get("origin", (0.0, 0.0))
                            bbox = sp.get("bbox", [0, 0, 0, 0])
                            color_int = sp.get("color", 0)
                            font_name = sp.get("font", "")
                            font_file = _buscar_font_file(font_name)
                            spans.append({
                                "id": f"s{pg_num}_{uid}",
                                "pagina": pg_num,
                                "texto_original": txt,
                                "texto_editado": txt,
                                "origin_x": round(origin[0], 2),
                                "origin_y": round(origin[1], 2),
                                "bbox": [round(x, 2) for x in bbox],
                                "font_name": font_name,
                                "font_file": font_file,
                                "font_size": round(sp.get("size", 10), 2),
                                "color_hex": _color_int_to_hex(color_int),
                                "color_int": color_int,
                                "flags": sp.get("flags", 0),
                            })
                            uid += 1
            doc.close()
            # Ordenar: primero por página, luego por Y, luego por X
            spans.sort(key=lambda s: (s["pagina"], s["origin_y"], s["origin_x"]))
            return jsonify({"spans": spans, "total": len(spans)})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/etiquetas/guardar-pdf-editado", methods=["POST"])
    def api_etiquetas_guardar_pdf_editado():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        body = request.get_json(silent=True) or {}
        ruta_pdf = (body.get("ruta_pdf") or "").strip()
        spans_editados = body.get("spans") or []
        modo = body.get("modo", "nuevo")  # "original" | "nuevo"

        if not ruta_pdf:
            return jsonify({"error": "Falta ruta_pdf"}), 400
        ruta_pdf, err_pdf = _ruta_pdf_etiquetas_ok(ruta_pdf)
        if err_pdf:
            code = 404 if "no encontrado" in err_pdf.lower() else 400
            return jsonify({"error": err_pdf}), code

        # Solo los spans que cambiaron
        cambios = [
            s for s in spans_editados
            if s.get("texto_editado", "") != s.get("texto_original", "")
        ]
        if not cambios:
            return jsonify({"ok": True, "mensaje": "Sin cambios que guardar", "ruta": ruta_pdf})

        try:
            import fitz as _fitz
            import tempfile as _tmp2

            doc = _fitz.open(ruta_pdf)

            # Agrupar cambios por página
            por_pagina: dict[int, list] = {}
            for c in cambios:
                pg = c.get("pagina", 0)
                por_pagina.setdefault(pg, []).append(c)

            for pg_num, lista in por_pagina.items():
                if pg_num >= len(doc):
                    continue
                page = doc[pg_num]

                # Paso 1: añadir todas las redacciones de esta página
                for c in lista:
                    rect = _fitz.Rect(c["bbox"])
                    # expandir 1pt para cubrir bordes del glifo
                    rect = rect + (-1, -1, 1, 1)
                    annot = page.add_redact_annot(rect, fill=(1, 1, 1))

                # Paso 2: aplicar redacciones (elimina texto original)
                page.apply_redactions(images=_fitz.PDF_REDACT_IMAGE_NONE)

                # Paso 3: insertar texto nuevo
                for c in lista:
                    texto_nuevo = c.get("texto_editado", "").strip()
                    if not texto_nuevo:
                        continue
                    font_name = c.get("font_name", "helv")
                    font_file = c.get("font_file") or None
                    font_size = float(c.get("font_size", 10))
                    color_rgb = _color_hex_to_rgb(c.get("color_hex", "#000000"))
                    ox = float(c.get("origin_x", 0))
                    oy = float(c.get("origin_y", 0))

                    insert_kwargs: dict = {
                        "point": _fitz.Point(ox, oy),
                        "text": texto_nuevo,
                        "fontsize": font_size,
                        "color": color_rgb,
                    }
                    if font_file and os.path.isfile(font_file):
                        insert_kwargs["fontname"] = font_name
                        insert_kwargs["fontfile"] = font_file
                    else:
                        # Fallback: Helvetica estándar de PDF
                        flags = c.get("flags", 0)
                        bold = bool(flags & 16)
                        italic = bool(flags & 2)
                        if bold and italic:
                            insert_kwargs["fontname"] = "helv-oi"
                        elif bold:
                            insert_kwargs["fontname"] = "helv-b"
                        elif italic:
                            insert_kwargs["fontname"] = "helv-o"
                        else:
                            insert_kwargs["fontname"] = "helv"

                    page.insert_text(**insert_kwargs)

            # Guardar
            if modo == "original":
                ruta_destino = ruta_pdf
                # Guardar en tmp y reemplazar
                tmp_fd, tmp_path = _tmp2.mkstemp(suffix=".pdf", prefix="mckg_edit_")
                os.close(tmp_fd)
                doc.save(tmp_path, garbage=4, deflate=True, incremental=False)
                doc.close()
                import shutil as _sh3
                _sh3.move(tmp_path, ruta_destino)
            else:
                # Nuevo archivo con sufijo _v2, _v3, etc.
                base, ext = os.path.splitext(ruta_pdf)
                ruta_destino = f"{base}_editado{ext}"
                n = 2
                while os.path.exists(ruta_destino):
                    ruta_destino = f"{base}_editado_{n}{ext}"
                    n += 1
                doc.save(ruta_destino, garbage=4, deflate=True)
                doc.close()

            return jsonify({
                "ok": True,
                "ruta": ruta_destino,
                "nombre": os.path.basename(ruta_destino),
                "cambios": len(cambios),
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Etiquetas: plantillas de dibujo ─────────────────────────────────────

    _ETIQUETAS_PLANTILLAS_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_plantillas.json",
    )

    def _load_etiquetas_plantillas() -> list:
        try:
            with open(_ETIQUETAS_PLANTILLAS_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return []
        items = data.get("plantillas") if isinstance(data, dict) else data
        return items if isinstance(items, list) else []

    def _save_etiquetas_plantillas(items: list) -> None:
        os.makedirs(os.path.dirname(_ETIQUETAS_PLANTILLAS_PATH), exist_ok=True)
        with open(_ETIQUETAS_PLANTILLAS_PATH, "w", encoding="utf-8") as f:
            json.dump({"plantillas": items}, f, ensure_ascii=False, indent=2)

    @app.route("/api/etiquetas/plantillas", methods=["GET", "POST"])
    def api_etiquetas_plantillas():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        if request.method == "GET":
            return jsonify({"plantillas": _load_etiquetas_plantillas()})

        import uuid as _uuid
        body = request.get_json(silent=True) or {}
        nombre = (body.get("nombre") or "").strip() or "Plantilla sin nombre"
        tipo = (body.get("tipo_etiqueta") or "").strip() or next(iter(_ETIQUETAS.keys()))
        pid = (body.get("id") or "").strip() or _uuid.uuid4().hex[:12]
        orientacion = (body.get("orientacion") or "horizontal").strip().lower()
        if orientacion not in ("horizontal", "vertical"):
            orientacion = "horizontal"
        entry = {
            "id": pid,
            "nombre": nombre,
            "tipo_etiqueta": tipo,
            "orientacion": orientacion,
            "campos_texto": body.get("campos_texto") or [],
            "lineas": body.get("lineas") or [],
            "imagenes": body.get("imagenes") or [],
            "rectangulos": body.get("rectangulos") or [],
            "updated_at": _dt.now().isoformat(timespec="seconds"),
        }
        items = [p for p in _load_etiquetas_plantillas() if p.get("id") != pid]
        items.insert(0, entry)
        _save_etiquetas_plantillas(items[:100])
        return jsonify({"ok": True, "plantilla": entry})

    @app.route("/api/etiquetas/plantillas/<plantilla_id>", methods=["DELETE"])
    def api_etiquetas_plantilla_delete(plantilla_id: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        items = [p for p in _load_etiquetas_plantillas() if p.get("id") != plantilla_id]
        _save_etiquetas_plantillas(items)
        return jsonify({"ok": True})

    # ── Etiquetas: biblioteca PNG ────────────────────────────────────────────

    _PNG_RECURSOS_SUBDIR = "Recursos PNG"
    _ETIQUETAS_PNG_INDEX_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_recursos_png.json",
    )
    _PNG_RECURSOS_MAX_BYTES = 8 * 1024 * 1024

    def _carpeta_png_recursos_etiquetas():
        d = os.path.join(_carpeta_pdfs_etiquetas(), _PNG_RECURSOS_SUBDIR)
        os.makedirs(d, exist_ok=True)
        return d

    def _extension_imagen_recurso_ok(nombre: str) -> str | None:
        lower = (nombre or "").strip().lower()
        if lower.endswith(".jpeg"):
            return ".jpeg"
        if lower.endswith(".jpg"):
            return ".jpg"
        if lower.endswith(".jpe"):
            return ".jpe"
        if lower.endswith(".png"):
            return ".png"
        return None

    def _nombre_png_recurso_seguro(nombre: str) -> str:
        import re as _re
        base = os.path.basename((nombre or "").strip()) or "recurso.png"
        ext = _extension_imagen_recurso_ok(base)
        if ext:
            stem = base[: -len(ext)]
        else:
            stem, _ = os.path.splitext(base)
            ext = ".png"
        stem = _re.sub(r"[^\w.\- áéíóúÁÉÍÓÚñÑ]", "_", stem or "recurso", flags=_re.UNICODE) or "recurso"
        return f"{stem}{ext}"[:180]

    def _es_bytes_imagen_png_jpg(raw: bytes) -> bool:
        if not raw:
            return False
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            return True
        # JPEG: SOI FF D8 (JFIF, EXIF, etc. varían el 3er byte)
        return len(raw) >= 2 and raw[0] == 0xFF and raw[1] == 0xD8

    def _load_png_recursos_etiquetas() -> list:
        try:
            with open(_ETIQUETAS_PNG_INDEX_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return []
        items = data.get("recursos") if isinstance(data, dict) else []
        if not isinstance(items, list):
            return []
        out = []
        for it in items:
            if not isinstance(it, dict):
                continue
            ruta = it.get("ruta_completa") or ""
            if ruta and os.path.isfile(ruta):
                out.append(it)
        out.sort(key=lambda x: x.get("subido_at") or "", reverse=True)
        return out

    def _save_png_recursos_etiquetas(items: list) -> None:
        os.makedirs(os.path.dirname(_ETIQUETAS_PNG_INDEX_PATH), exist_ok=True)
        with open(_ETIQUETAS_PNG_INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump({"recursos": items[:300]}, f, ensure_ascii=False, indent=2)

    def _thumb_png_b64(ruta: str, max_px: int = 72) -> str | None:
        import base64 as _b64png
        try:
            from PIL import Image as _PILImg
            with _PILImg.open(ruta) as im:
                im = im.convert("RGBA")
                im.thumbnail((max_px, max_px))
                import io as _iopng
                buf = _iopng.BytesIO()
                im.save(buf, format="PNG")
                return _b64png.b64encode(buf.getvalue()).decode()
        except Exception:
            try:
                if os.path.getsize(ruta) <= 400_000:
                    with open(ruta, "rb") as f:
                        return _b64png.b64encode(f.read()).decode()
            except Exception:
                pass
        return None

    def _registrar_png_recurso(nombre: str, ruta_completa: str, bytes_size: int) -> dict:
        import uuid as _uuid_png
        items = _load_png_recursos_etiquetas()
        items = [a for a in items if a.get("ruta_completa") != ruta_completa]
        rel = os.path.relpath(ruta_completa, _PDF_DIR) if ruta_completa.startswith(_PDF_DIR) else nombre
        entry = {
            "id": _uuid_png.uuid4().hex[:12],
            "nombre": nombre,
            "ruta": rel.replace("\\", "/"),
            "ruta_completa": ruta_completa,
            "subido_at": _dt.now().isoformat(timespec="seconds"),
            "bytes": bytes_size,
            "thumb_b64": _thumb_png_b64(ruta_completa),
        }
        items.insert(0, entry)
        _save_png_recursos_etiquetas(items)
        return entry

    def _ruta_png_recurso_ok(nombre: str) -> tuple:
        nombre = os.path.basename((nombre or "").strip())
        if not nombre or not _extension_imagen_recurso_ok(nombre):
            return None, "Nombre de imagen inválido (PNG o JPG)"
        carpeta = os.path.realpath(_carpeta_png_recursos_etiquetas())
        for it in _load_png_recursos_etiquetas():
            if it.get("nombre") == nombre:
                ruta = os.path.realpath(it.get("ruta_completa") or "")
                if ruta.startswith(carpeta + os.sep) and os.path.isfile(ruta):
                    return ruta, None
        ruta_directa = os.path.realpath(os.path.join(carpeta, nombre))
        if ruta_directa.startswith(carpeta + os.sep) and os.path.isfile(ruta_directa):
            return ruta_directa, None
        return None, "Imagen no encontrada"

    @app.route("/api/etiquetas/recursos-png", methods=["GET", "POST"])
    def api_etiquetas_recursos_png():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        if request.method == "GET":
            recursos = _load_png_recursos_etiquetas()
            return jsonify({
                "recursos": recursos,
                "total": len(recursos),
                "carpeta": _carpeta_png_recursos_etiquetas(),
            })

        archivo = request.files.get("archivo")
        if not archivo or not archivo.filename:
            return jsonify({"error": "Falta archivo de imagen"}), 400
        nombre = _nombre_png_recurso_seguro(archivo.filename)
        raw = archivo.read()
        if not raw:
            return jsonify({"error": "Archivo vacío"}), 400
        if len(raw) > _PNG_RECURSOS_MAX_BYTES:
            return jsonify({
                "error": f"La imagen supera el límite de {_PNG_RECURSOS_MAX_BYTES // (1024 * 1024)} MB",
            }), 400
        if not _es_bytes_imagen_png_jpg(raw):
            return jsonify({"error": "Solo se permiten archivos JPG o PNG"}), 400
        destino = os.path.join(_carpeta_png_recursos_etiquetas(), nombre)
        if os.path.isfile(destino):
            base, ext = os.path.splitext(nombre)
            n = 2
            while os.path.isfile(destino):
                nombre = f"{base}_{n}{ext}"
                destino = os.path.join(_carpeta_png_recursos_etiquetas(), nombre)
                n += 1
        with open(destino, "wb") as f:
            f.write(raw)
        entry = _registrar_png_recurso(nombre, destino, len(raw))
        return jsonify({"ok": True, **entry})

    @app.route("/api/etiquetas/recursos-png/<path:nombre>", methods=["DELETE"])
    def api_etiquetas_recurso_png_delete(nombre: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        ruta, err = _ruta_png_recurso_ok(nombre)
        if err:
            return jsonify({"error": err}), 404
        try:
            os.unlink(ruta)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        items = [r for r in _load_png_recursos_etiquetas() if r.get("ruta_completa") != ruta]
        _save_png_recursos_etiquetas(items)
        return jsonify({"ok": True})

    @app.route("/api/etiquetas/recursos-png/archivo/<path:nombre>", methods=["GET"])
    def api_etiquetas_recurso_png_archivo(nombre: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        ruta, err = _ruta_png_recurso_ok(nombre)
        if err:
            return jsonify({"error": err}), 404
        from flask import send_file
        mime = "image/jpeg" if nombre.lower().endswith((".jpg", ".jpeg", ".jpe")) else "image/png"
        return send_file(ruta, mimetype=mime, conditional=True)

    # ── Etiquetas: catálogo de formatos (nombre + mm) ────────────────────────

    @app.route("/api/etiquetas/tipos", methods=["GET", "PUT"])
    @app.route("/app/api/etiquetas/tipos", methods=["GET", "PUT"])
    def api_etiquetas_tipos():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        if request.method == "GET":
            return jsonify({"tipos": _load_etiquetas_tipos()})
        body = request.get_json(silent=True) or {}
        tipos, err = _save_etiquetas_tipos(body.get("tipos") or [])
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True, "tipos": tipos})

    # ── Etiquetas: colores guardados ─────────────────────────────────────────

    _ETIQUETAS_COLORES_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_colores_guardados.json",
    )
    _ETIQUETAS_COLORES_MAX = 36

    def _normalizar_hex_etiqueta(hex_color: str) -> str | None:
        import re as _re_hex
        h = (hex_color or "").strip().lower()
        if not h:
            return None
        if not h.startswith("#"):
            h = f"#{h}"
        if _re_hex.fullmatch(r"#[0-9a-f]{6}", h):
            return h
        if _re_hex.fullmatch(r"#[0-9a-f]{3}", h):
            return f"#{h[1]}{h[1]}{h[2]}{h[2]}{h[3]}{h[3]}"
        return None

    def _load_colores_etiquetas() -> list:
        try:
            with open(_ETIQUETAS_COLORES_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return []
        items = data.get("colores") if isinstance(data, dict) else []
        if not isinstance(items, list):
            return []
        out = []
        for it in items:
            if not isinstance(it, dict):
                continue
            hex_norm = _normalizar_hex_etiqueta(it.get("hex") or "")
            if not hex_norm:
                continue
            out.append({
                "id": str(it.get("id") or ""),
                "hex": hex_norm,
                "cmyk": it.get("cmyk") if isinstance(it.get("cmyk"), dict) else None,
                "guardado_at": it.get("guardado_at") or "",
            })
        out = [c for c in out if c.get("id")]
        out.sort(key=lambda x: x.get("guardado_at") or "", reverse=True)
        return out[:_ETIQUETAS_COLORES_MAX]

    def _save_colores_etiquetas(items: list) -> None:
        os.makedirs(os.path.dirname(_ETIQUETAS_COLORES_PATH), exist_ok=True)
        with open(_ETIQUETAS_COLORES_PATH, "w", encoding="utf-8") as f:
            json.dump({"colores": items[:_ETIQUETAS_COLORES_MAX]}, f, ensure_ascii=False, indent=2)

    @app.route("/api/etiquetas/colores", methods=["GET", "POST"])
    def api_etiquetas_colores():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        if request.method == "GET":
            colores = _load_colores_etiquetas()
            return jsonify({"colores": colores, "total": len(colores)})

        body = request.get_json(silent=True) or {}
        hex_norm = _normalizar_hex_etiqueta(body.get("hex") or "")
        if not hex_norm:
            return jsonify({"error": "Color hex inválido"}), 400
        if _color_etiqueta_sin(hex_norm):
            return jsonify({"error": "No se puede guardar un color transparente"}), 400

        items = _load_colores_etiquetas()
        for it in items:
            if (it.get("hex") or "").lower() == hex_norm:
                return jsonify({"ok": True, "duplicado": True, **it})

        import uuid as _uuid_color
        cmyk = body.get("cmyk") if isinstance(body.get("cmyk"), dict) else None
        entry = {
            "id": _uuid_color.uuid4().hex[:12],
            "hex": hex_norm,
            "cmyk": cmyk,
            "guardado_at": _dt.now().isoformat(timespec="seconds"),
        }
        items.insert(0, entry)
        _save_colores_etiquetas(items)
        return jsonify({"ok": True, **entry})

    @app.route("/api/etiquetas/colores/<color_id>", methods=["DELETE"])
    def api_etiquetas_color_delete(color_id: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        color_id = (color_id or "").strip()
        if not color_id:
            return jsonify({"error": "ID inválido"}), 400
        items = _load_colores_etiquetas()
        nuevo = [c for c in items if c.get("id") != color_id]
        if len(nuevo) == len(items):
            return jsonify({"error": "Color no encontrado"}), 404
        _save_colores_etiquetas(nuevo)
        return jsonify({"ok": True})

    # ── Etiquetas: inventario papel y tinta ───────────────────────────────────

    _ETIQUETAS_INVENTARIO_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_inventario_consumibles.json",
    )

    def _mm_a_pulgadas_etiquetas(mm) -> float:
        try:
            return round(float(mm) / 25.4, 3)
        except (TypeError, ValueError):
            return 0.0

    def _etiquetas_total_papel_item(it: dict) -> int:
        try:
            rollos = max(0.0, float(it.get("rollos", it.get("cantidad", 0)) or 0))
        except (TypeError, ValueError):
            rollos = 0.0
        try:
            upr = max(0, int(it.get("unidades_por_rollo") or 0))
        except (TypeError, ValueError):
            upr = 0
        try:
            sueltas = max(0, int(it.get("etiquetas_sueltas") or 0))
        except (TypeError, ValueError):
            sueltas = 0
        if upr > 0:
            return int(rollos * upr) + sueltas
        try:
            return max(0, int(float(it.get("cantidad") or 0)))
        except (TypeError, ValueError):
            return 0

    def _nombre_display_papel_inventario(it: dict) -> str:
        ref = (it.get("ref") or "").strip()
        try:
            aw = float(it.get("ancho_mm") or 0)
            ah = float(it.get("alto_mm") or 0)
        except (TypeError, ValueError):
            aw, ah = 0.0, 0.0
        if ref and aw > 0 and ah > 0:
            return f"{ref} · {aw:g}×{ah:g} mm"
        return (it.get("nombre") or ref or "Papel").strip()[:120]

    def _migrar_item_papel_inventario(it: dict) -> dict:
        """Enriquece registros legacy de papel con ref, medidas y stock por rollo."""
        out = dict(it)
        nombre = (out.get("nombre") or "").strip()
        notas = (out.get("notas") or "").strip()
        if not (out.get("ref") or "").strip():
            if " · " in nombre:
                out["ref"] = nombre.split(" · ", 1)[0].strip()[:40]
            else:
                m_ref = re.search(r"\b([A-Z0-9][A-Z0-9\-_/]{1,30})\b", nombre, re.I)
                out["ref"] = (m_ref.group(1) if m_ref else nombre.split()[0] if nombre else "PAPEL")[:40]

        try:
            aw = float(out.get("ancho_mm") or 0)
            ah = float(out.get("alto_mm") or 0)
        except (TypeError, ValueError):
            aw, ah = 0.0, 0.0
        if aw <= 0 or ah <= 0:
            m_mm = re.search(r"(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+(?:[.,]\d+)?)\s*mm", nombre, re.I)
            if m_mm:
                aw = float(m_mm.group(1).replace(",", "."))
                ah = float(m_mm.group(2).replace(",", "."))
            else:
                m_mm2 = re.search(r"(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+(?:[.,]\d+)?)", nombre)
                if m_mm2:
                    aw = float(m_mm2.group(1).replace(",", "."))
                    ah = float(m_mm2.group(2).replace(",", "."))
            out["ancho_mm"] = aw
            out["alto_mm"] = ah

        if not out.get("unidades_por_rollo"):
            m_upr = re.search(r"(\d{2,5})\s*$", notas.replace(" ", ""))
            if m_upr:
                out["unidades_por_rollo"] = int(m_upr.group(1))
            elif re.search(r"\*\s*(\d{2,5})", notas):
                out["unidades_por_rollo"] = int(re.search(r"\*\s*(\d{2,5})", notas).group(1))
            else:
                try:
                    upr_try = int(out.get("unidades_por_rollo") or 0)
                except (TypeError, ValueError):
                    upr_try = 0
                if upr_try <= 0:
                    out["unidades_por_rollo"] = 500

        try:
            aw = float(out.get("ancho_mm") or 0)
            ah = float(out.get("alto_mm") or 0)
        except (TypeError, ValueError):
            aw, ah = 0.0, 0.0
        if aw > 0 and ah > 0:
            if not out.get("ancho_pulg"):
                out["ancho_pulg"] = _mm_a_pulgadas_etiquetas(aw)
            if not out.get("alto_pulg"):
                out["alto_pulg"] = _mm_a_pulgadas_etiquetas(ah)

        upr = int(out.get("unidades_por_rollo") or 500)
        out["unidades_por_rollo"] = max(1, upr)
        if out.get("rollos") is None and out.get("etiquetas_sueltas") is None:
            try:
                legacy = max(0.0, float(out.get("cantidad") or 0))
            except (TypeError, ValueError):
                legacy = 0.0
            unidad = (out.get("unidad") or "").strip().lower()
            if legacy > upr or unidad != "rollos":
                total = int(legacy)
                out["rollos"] = total // upr
                out["etiquetas_sueltas"] = total % upr
            else:
                out["rollos"] = legacy
                out["etiquetas_sueltas"] = 0
        else:
            try:
                out["rollos"] = max(0.0, float(out.get("rollos", out.get("cantidad", 0)) or 0))
            except (TypeError, ValueError):
                out["rollos"] = 0.0
            try:
                out["etiquetas_sueltas"] = max(0, int(out.get("etiquetas_sueltas") or 0))
            except (TypeError, ValueError):
                out["etiquetas_sueltas"] = 0

        try:
            out["minimo_rollos"] = max(0.0, float(out.get("minimo_rollos", out.get("minimo", 0)) or 0))
        except (TypeError, ValueError):
            out["minimo_rollos"] = 0.0

        out["formato_etiqueta"] = (out.get("formato_etiqueta") or "").strip()[:60]
        out["notas"] = (out.get("notas") or "").strip()[:500]
        out["nombre"] = _nombre_display_papel_inventario(out)
        out["cantidad"] = float(out.get("rollos") or 0)
        out["minimo"] = float(out.get("minimo_rollos") or 0)
        out["unidad"] = "rollos"
        out["total_etiquetas"] = _etiquetas_total_papel_item(out)
        return out

    def _serializar_papel_inventario_json(it: dict) -> dict | None:
        item_id = str(it.get("id") or "").strip()
        if not item_id:
            return None
        m = _migrar_item_papel_inventario({**it, "id": item_id, "tipo": "papel"})
        return {
            "id": item_id,
            "tipo": "papel",
            "ref": (m.get("ref") or "").strip()[:40],
            "nombre": (m.get("nombre") or "").strip()[:120],
            "ancho_mm": round(float(m.get("ancho_mm") or 0), 2),
            "alto_mm": round(float(m.get("alto_mm") or 0), 2),
            "ancho_pulg": round(float(m.get("ancho_pulg") or 0), 3),
            "alto_pulg": round(float(m.get("alto_pulg") or 0), 3),
            "unidades_por_rollo": max(1, int(m.get("unidades_por_rollo") or 500)),
            "rollos": max(0.0, float(m.get("rollos") or 0)),
            "etiquetas_sueltas": max(0, int(m.get("etiquetas_sueltas") or 0)),
            "minimo_rollos": max(0.0, float(m.get("minimo_rollos") or 0)),
            "minimo": max(0.0, float(m.get("minimo_rollos") or m.get("minimo") or 0)),
            "formato_etiqueta": (m.get("formato_etiqueta") or "").strip()[:60],
            "notas": (m.get("notas") or "").strip()[:500],
            "cantidad": max(0.0, float(m.get("rollos") or 0)),
            "unidad": "rollos",
            "total_etiquetas": _etiquetas_total_papel_item(m),
            "updated_at": (it.get("updated_at") or _dt.now().isoformat(timespec="seconds")),
        }

    def _papel_inventario_incompleto_en_disco(it: dict) -> bool:
        if (it.get("tipo") or "").strip().lower() != "papel":
            return False
        faltan = (
            "ref", "ancho_mm", "alto_mm", "unidades_por_rollo", "rollos", "etiquetas_sueltas",
        )
        return any(k not in it for k in faltan)

    def _serializar_tinta_inventario_json(it: dict) -> dict | None:
        item_id = str(it.get("id") or "").strip()
        if not item_id:
            return None
        m = _normalizar_item_tinta_inventario(it)
        return {
            "id": item_id,
            "tipo": "tinta",
            "nombre": m.get("nombre") or "",
            "cantidad": m.get("cantidad", 0),
            "unidad": m.get("unidad") or "cartuchos",
            "minimo": m.get("minimo", 0),
            "notas": m.get("notas") or "",
            "updated_at": (it.get("updated_at") or _dt.now().isoformat(timespec="seconds")),
        }

    def _normalizar_item_tinta_inventario(it: dict) -> dict:
        out = dict(it)
        out["nombre"] = (out.get("nombre") or "").strip()[:120]
        try:
            out["cantidad"] = max(0.0, float(out.get("cantidad", 0)))
        except (TypeError, ValueError):
            out["cantidad"] = 0.0
        try:
            out["minimo"] = max(0.0, float(out.get("minimo", 0)))
        except (TypeError, ValueError):
            out["minimo"] = 0.0
        out["unidad"] = (out.get("unidad") or "cartuchos").strip()[:40]
        out["notas"] = (out.get("notas") or "").strip()[:500]
        return out

    def _normalizar_item_inventario_etiquetas(it: dict) -> dict | None:
        if not isinstance(it, dict):
            return None
        tipo = (it.get("tipo") or "").strip().lower()
        if tipo not in ("papel", "tinta"):
            return None
        item_id = str(it.get("id") or "").strip()
        if not item_id:
            return None
        if tipo == "papel":
            out = _migrar_item_papel_inventario(it)
        else:
            out = _normalizar_item_tinta_inventario(it)
        out["id"] = item_id
        out["tipo"] = tipo
        out["updated_at"] = it.get("updated_at") or ""
        return out

    def _load_etiquetas_inventario() -> dict:
        try:
            with open(_ETIQUETAS_INVENTARIO_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return {"items": []}
        except Exception:
            return {"items": []}
        items = data.get("items") if isinstance(data, dict) else []
        if not isinstance(items, list):
            return {"items": []}
        out = []
        reparar_disco = False
        for it in items:
            if _papel_inventario_incompleto_en_disco(it):
                reparar_disco = True
            norm = _normalizar_item_inventario_etiquetas(it)
            if norm:
                out.append(norm)
        if reparar_disco and out:
            _save_etiquetas_inventario(out)
        return {"items": out}

    def _save_etiquetas_inventario(items: list) -> None:
        persistidos = []
        for it in items:
            if not isinstance(it, dict):
                continue
            tipo = (it.get("tipo") or "").strip().lower()
            if tipo == "papel":
                ser = _serializar_papel_inventario_json(it)
            else:
                ser = _serializar_tinta_inventario_json(it)
            if ser:
                persistidos.append(ser)
        os.makedirs(os.path.dirname(_ETIQUETAS_INVENTARIO_PATH), exist_ok=True)
        with open(_ETIQUETAS_INVENTARIO_PATH, "w", encoding="utf-8") as f:
            json.dump({"items": persistidos[:200]}, f, ensure_ascii=False, indent=2)

    def _parse_papel_inventario_body(body: dict, tipo: str) -> tuple[dict | None, str | None]:
        if tipo != "papel":
            return None, None
        ref = (body.get("ref") or body.get("nombre") or "").strip()[:40]
        if not ref:
            return None, "Falta ref del papel"
        try:
            ancho_mm = float(body.get("ancho_mm"))
            alto_mm = float(body.get("alto_mm"))
        except (TypeError, ValueError):
            return None, "Indica ancho_mm y alto_mm válidos"
        if ancho_mm <= 0 or alto_mm <= 0:
            return None, "Las medidas en mm deben ser mayores a 0"
        try:
            unidades_por_rollo = max(1, int(body.get("unidades_por_rollo")))
        except (TypeError, ValueError):
            return None, "unidades_por_rollo debe ser un entero ≥ 1"
        try:
            rollos = max(0.0, float(body.get("rollos", body.get("cantidad", 0))))
        except (TypeError, ValueError):
            rollos = 0.0
        try:
            etiquetas_sueltas = max(0, int(body.get("etiquetas_sueltas", 0)))
        except (TypeError, ValueError):
            etiquetas_sueltas = 0
        if etiquetas_sueltas >= unidades_por_rollo:
            rollos += etiquetas_sueltas // unidades_por_rollo
            etiquetas_sueltas = etiquetas_sueltas % unidades_por_rollo
        try:
            ancho_pulg = float(body.get("ancho_pulg")) if body.get("ancho_pulg") not in (None, "") else _mm_a_pulgadas_etiquetas(ancho_mm)
        except (TypeError, ValueError):
            ancho_pulg = _mm_a_pulgadas_etiquetas(ancho_mm)
        try:
            alto_pulg = float(body.get("alto_pulg")) if body.get("alto_pulg") not in (None, "") else _mm_a_pulgadas_etiquetas(alto_mm)
        except (TypeError, ValueError):
            alto_pulg = _mm_a_pulgadas_etiquetas(alto_mm)
        try:
            minimo_rollos = max(0.0, float(body.get("minimo_rollos", body.get("minimo", 0))))
        except (TypeError, ValueError):
            minimo_rollos = 0.0
        entry = {
            "ref": ref,
            "ancho_mm": round(ancho_mm, 2),
            "alto_mm": round(alto_mm, 2),
            "ancho_pulg": round(ancho_pulg, 3),
            "alto_pulg": round(alto_pulg, 3),
            "unidades_por_rollo": unidades_por_rollo,
            "rollos": rollos,
            "etiquetas_sueltas": etiquetas_sueltas,
            "minimo_rollos": minimo_rollos,
            "formato_etiqueta": (body.get("formato_etiqueta") or "").strip()[:60],
            "notas": (body.get("notas") or "").strip()[:500],
        }
        entry["nombre"] = _nombre_display_papel_inventario(entry)
        entry["cantidad"] = rollos
        entry["minimo"] = minimo_rollos
        entry["unidad"] = "rollos"
        entry["total_etiquetas"] = _etiquetas_total_papel_item(entry)
        return entry, None

    def _descontar_inventario_papel_etiquetas(
        ancho_mm: float,
        alto_mm: float,
        cantidad: int,
        producto: str = "",
    ) -> dict:
        try:
            cant = max(0, int(cantidad))
        except (TypeError, ValueError):
            return {"ok": False, "mensaje": "Cantidad inválida para inventario"}
        if cant <= 0:
            return {"ok": False, "mensaje": "Sin etiquetas que descontar"}
        items = _load_etiquetas_inventario().get("items") or []
        tol = 1.0
        target_a = float(ancho_mm)
        target_b = float(alto_mm)

        def _dims_match(it: dict) -> bool:
            try:
                aw = float(it.get("ancho_mm") or 0)
                ah = float(it.get("alto_mm") or 0)
            except (TypeError, ValueError):
                return False
            if aw <= 0 or ah <= 0:
                return False
            return (
                (abs(aw - target_a) <= tol and abs(ah - target_b) <= tol)
                or (abs(aw - target_b) <= tol and abs(ah - target_a) <= tol)
            )

        candidatos = [it for it in items if it.get("tipo") == "papel" and _dims_match(it)]
        prod = (producto or "").strip().lower()
        if prod:
            por_fmt = [
                it for it in candidatos
                if (it.get("formato_etiqueta") or "").strip().lower() == prod
            ]
            if por_fmt:
                candidatos = por_fmt
        if not candidatos:
            return {
                "ok": False,
                "mensaje": f"No hay rollo registrado para {target_a:g}×{target_b:g} mm",
            }
        idx = next(i for i, it in enumerate(items) if it.get("id") == candidatos[0]["id"])
        it = dict(items[idx])
        total_antes = _etiquetas_total_papel_item(it)
        total_despues = max(0, total_antes - cant)
        upr = max(1, int(it.get("unidades_por_rollo") or 1))
        it["rollos"] = total_despues // upr
        it["etiquetas_sueltas"] = total_despues % upr
        it["cantidad"] = float(it["rollos"])
        it["total_etiquetas"] = total_despues
        it["updated_at"] = _dt.now().isoformat(timespec="seconds")
        items[idx] = _normalizar_item_inventario_etiquetas({**it, "tipo": "papel", "id": it["id"]})
        _save_etiquetas_inventario(items)
        return {
            "ok": True,
            "ref": it.get("ref") or it.get("nombre"),
            "descontadas": cant,
            "restantes": total_despues,
            "rollos": it["rollos"],
            "etiquetas_sueltas": it["etiquetas_sueltas"],
            "agotado": total_despues == 0,
        }

    @app.route("/api/etiquetas/inventario-consumibles", methods=["GET", "POST"])
    @app.route("/app/api/etiquetas/inventario-consumibles", methods=["GET", "POST"])
    def api_etiquetas_inventario_consumibles():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        if request.method == "GET":
            data = _load_etiquetas_inventario()
            return jsonify({**data, "total": len(data.get("items") or [])})

        body = request.get_json(silent=True) or {}
        tipo = (body.get("tipo") or "").strip().lower()
        if tipo not in ("papel", "tinta"):
            if body.get("ref") or (body.get("ancho_mm") and body.get("alto_mm")):
                tipo = "papel"
            else:
                return jsonify({"error": "tipo debe ser papel o tinta"}), 400
        import uuid as _uuid_inv
        items = _load_etiquetas_inventario().get("items") or []
        if tipo == "papel":
            papel, err = _parse_papel_inventario_body(body, tipo)
            if err:
                return jsonify({"error": err}), 400
            entry = {
                "id": _uuid_inv.uuid4().hex[:12],
                "tipo": "papel",
                **papel,
                "updated_at": _dt.now().isoformat(timespec="seconds"),
            }
            entry = _serializar_papel_inventario_json(entry)
            if not entry:
                return jsonify({"error": "No se pudo guardar el papel"}), 500
        else:
            nombre = (body.get("nombre") or "").strip()
            if not nombre:
                return jsonify({"error": "Falta nombre"}), 400
            try:
                cantidad = max(0.0, float(body.get("cantidad", 0)))
            except (TypeError, ValueError):
                cantidad = 0.0
            try:
                minimo = max(0.0, float(body.get("minimo", 0)))
            except (TypeError, ValueError):
                minimo = 0.0
            entry = {
                "id": _uuid_inv.uuid4().hex[:12],
                "tipo": "tinta",
                "nombre": nombre[:120],
                "cantidad": cantidad,
                "unidad": (body.get("unidad") or "cartuchos").strip()[:40],
                "minimo": minimo,
                "notas": (body.get("notas") or "").strip()[:500],
                "updated_at": _dt.now().isoformat(timespec="seconds"),
            }
        items.insert(0, entry)
        _save_etiquetas_inventario(items)
        return jsonify({"ok": True, "item": entry})

    @app.route("/api/etiquetas/inventario-consumibles/<item_id>", methods=["PUT", "PATCH", "DELETE"])
    @app.route("/app/api/etiquetas/inventario-consumibles/<item_id>", methods=["PUT", "PATCH", "DELETE"])
    def api_etiquetas_inventario_item(item_id: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        item_id = (item_id or "").strip()
        items = _load_etiquetas_inventario().get("items") or []
        idx = next((i for i, it in enumerate(items) if it.get("id") == item_id), None)
        if idx is None:
            return jsonify({"error": "Ítem no encontrado"}), 404
        if request.method == "DELETE":
            items.pop(idx)
            _save_etiquetas_inventario(items)
            return jsonify({"ok": True})
        body = request.get_json(silent=True) or {}
        it = dict(items[idx])
        es_papel = (
            it.get("tipo") == "papel"
            or body.get("tipo") == "papel"
            or bool(it.get("ref"))
            or bool(body.get("ref"))
            or (body.get("ancho_mm") and body.get("alto_mm"))
        )
        if es_papel:
            merged = {**it, **body, "tipo": "papel"}
            papel, err = _parse_papel_inventario_body(merged, "papel")
            if err:
                return jsonify({"error": err}), 400
            it = {**it, **papel, "tipo": "papel", "id": item_id}
        else:
            for key in ("nombre", "unidad", "notas"):
                if key in body and body[key] is not None:
                    it[key] = str(body[key]).strip()[:500 if key == "notas" else 120]
            for key in ("cantidad", "minimo"):
                if key in body:
                    try:
                        it[key] = max(0.0, float(body[key]))
                    except (TypeError, ValueError):
                        pass
        it["updated_at"] = _dt.now().isoformat(timespec="seconds")
        if es_papel:
            norm = _serializar_papel_inventario_json({**it, "id": item_id, "tipo": "papel"})
        else:
            norm = _serializar_tinta_inventario_json({**it, "id": item_id, "tipo": "tinta"})
        if not norm:
            return jsonify({"error": "Datos inválidos"}), 400
        items[idx] = _normalizar_item_inventario_etiquetas(norm) or norm
        _save_etiquetas_inventario(items)
        return jsonify({"ok": True, "item": items[idx]})

    # ── Etiquetas: datos de productos ────────────────────────────────────────

    _ETIQUETAS_DATOS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "etiquetas_datos.json")

    def _load_etiquetas_datos() -> dict:
        if os.path.exists(_ETIQUETAS_DATOS_PATH):
            try:
                with open(_ETIQUETAS_DATOS_PATH, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_etiquetas_datos(data: dict) -> None:
        os.makedirs(os.path.dirname(_ETIQUETAS_DATOS_PATH), exist_ok=True)
        with open(_ETIQUETAS_DATOS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @app.route("/api/etiquetas/datos", methods=["GET"])
    def api_etiquetas_datos_list():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        datos = _load_etiquetas_datos()
        return jsonify({"datos": datos, "total": len(datos)})

    @app.route("/api/etiquetas/datos/<path:sku>", methods=["GET", "POST", "DELETE"])
    def api_etiquetas_datos_sku(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        datos = _load_etiquetas_datos()

        if request.method == "GET":
            return jsonify(datos.get(sku, {}))

        if request.method == "DELETE":
            if sku in datos:
                del datos[sku]
                _save_etiquetas_datos(datos)
            return jsonify({"ok": True})

        # POST — guardar/actualizar
        body = request.get_json(silent=True) or {}
        _allowed_etiqueta = {
            "siigo_code", "siigo_name", "nombre_etiqueta", "presentacion",
            "pdf_ruta", "pdf_nombre", "lote_defecto", "vencimiento_defecto",
            "tipo_etiqueta", "forma", "calidad", "rotacion",
            "lote_pos", "lote_font", "lote_x_pct", "lote_y_pct", "campos_texto",
        }
        entry = dict(datos.get(sku, {}))
        for k, v in body.items():
            if k in _allowed_etiqueta:
                entry[k] = v
        if "lote_defecto" in entry:
            entry["lote_defecto"] = _con_prefijo_lote_etiqueta(entry.get("lote_defecto"))
        if "vencimiento_defecto" in entry:
            entry["vencimiento_defecto"] = _con_prefijo_exp_etiqueta(entry.get("vencimiento_defecto"))
        if "rotacion" in entry:
            entry["rotacion"] = _rotacion_etiqueta_valida(entry.get("rotacion"))
        entry["updated_at"] = _dt.now().isoformat()
        datos[sku] = entry
        _save_etiquetas_datos(datos)
        return jsonify({"ok": True, "sku": sku, "datos": entry})

    @app.route("/api/etiquetas/combos-siigo", methods=["GET"])
    def api_etiquetas_combos_siigo():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        buscar = (request.args.get("q") or "").strip().lower()
        try:
            from app.services.siigo import listar_productos_combo_siigo, _precio_lista_siigo_producto
            from app.services.publicaciones import (
                _load_overrides,
                _load_cache,
                _meli_id_efectivo_sku,
            )
            overrides = _load_overrides()
            cache = _load_cache()
            combos = listar_productos_combo_siigo()
            if buscar:
                combos = [
                    c for c in combos
                    if buscar in (c.get("name") or "").lower()
                    or buscar in (c.get("code") or "").lower()
                ]
            resultado = []
            for c in combos[:200]:
                code = c.get("code", "")
                ov = overrides.get(code, {})
                resultado.append({
                    "code": code,
                    "name": c.get("name", ""),
                    "precio_lista": _precio_lista_siigo_producto(c),
                    "meli_id": _meli_id_efectivo_sku(code, overrides=overrides, cache=cache),
                    "estado_meli_config": (ov.get("estado_meli_config") or "").strip().lower(),
                })
            return jsonify({"combos": resultado, "total": len(resultado)})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/etiquetas/studio/catalogo", methods=["GET"])
    @app.route("/app/api/etiquetas/studio/catalogo", methods=["GET"])
    def api_etiquetas_studio_catalogo():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.tools.etiquetas_studio import listar_catalogo_studio

        q = (request.args.get("q") or "").strip()
        solo_sin_ai = request.args.get("solo_sin_ai", "").lower() in ("1", "true", "yes")
        solo_con_meli = request.args.get("solo_con_meli", "").lower() in ("1", "true", "yes")
        limite = min(int(request.args.get("limite") or 500), 1000)
        return jsonify(listar_catalogo_studio(
            q=q,
            solo_sin_ai=solo_sin_ai,
            solo_con_meli=solo_con_meli,
            limite=limite,
        ))

    @app.route("/api/etiquetas/studio/resolver-ai", methods=["GET"])
    @app.route("/app/api/etiquetas/studio/resolver-ai", methods=["GET"])
    def api_etiquetas_studio_resolver_ai():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.tools.etiquetas_ai_engine import resolver_plantilla_ai

        datos = {
            "sku": (request.args.get("sku") or "").strip(),
            "nombre_producto": (request.args.get("nombre_producto") or "").strip(),
            "ingrediente": (request.args.get("ingrediente") or "").strip(),
            "contenido_neto": (request.args.get("contenido_neto") or "").strip(),
            "unidad": (request.args.get("unidad") or "").strip(),
            "tipo_etiqueta": (request.args.get("tipo_etiqueta") or "").strip(),
            "archivo_ai": (request.args.get("archivo_ai") or "").strip(),
        }
        q = (request.args.get("q") or "").strip()
        limite = min(int(request.args.get("limite") or 20), 80)
        return jsonify(resolver_plantilla_ai(datos, q=q, limite=limite))

    @app.route("/api/etiquetas/studio/plantillas", methods=["GET"])
    @app.route("/app/api/etiquetas/studio/plantillas", methods=["GET"])
    def api_etiquetas_studio_plantillas():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.tools.etiquetas_ai_engine import listar_plantillas_ai
        from app.tools.etiquetas_svg_engine import listar_plantillas_svg

        plantillas_ai = listar_plantillas_ai(limite=10_000)
        return jsonify({
            "plantillas": listar_plantillas_svg(),
            "plantillas_ai": plantillas_ai[:400],
            "total_ai": len(plantillas_ai),
        })

    @app.route("/api/etiquetas/studio/preview", methods=["POST"])
    @app.route("/app/api/etiquetas/studio/preview", methods=["POST"])
    def api_etiquetas_studio_preview():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        import base64 as _b64
        import os as _os
        import shutil as _shutil

        from app.tools.etiquetas_svg_engine import exportar_png_temporal, renderizar_svg

        body = request.get_json(silent=True) or {}
        formato = (body.get("formato") or "png").lower()
        try:
            if formato == "svg":
                svg, meta = renderizar_svg(body)
                return jsonify({"svg": svg, "meta": meta})
            png_path, meta = exportar_png_temporal(body, width_px=int(body.get("ancho_px") or 720))
            try:
                img_bytes = open(png_path, "rb").read()
            finally:
                tmp_dir = _os.path.dirname(png_path)
                if tmp_dir and _os.path.isdir(tmp_dir):
                    _shutil.rmtree(tmp_dir, ignore_errors=True)
            return jsonify({
                "imagen": _b64.b64encode(img_bytes).decode(),
                "mime": "image/png",
                "meta": meta,
            })
        except (ValueError, FileNotFoundError) as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/etiquetas/studio/<path:sku>", methods=["GET", "POST"])
    @app.route("/app/api/etiquetas/studio/<path:sku>", methods=["GET", "POST"])
    def api_etiquetas_studio_sku(sku: str):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.tools.etiquetas_studio import guardar_studio_sku, obtener_studio_sku

        if request.method == "GET":
            datos = obtener_studio_sku(sku)
            return jsonify({"datos": datos})

        body = request.get_json(silent=True) or {}
        try:
            entry = guardar_studio_sku(sku, body)
            return jsonify({"ok": True, "datos": entry})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/etiquetas/studio/exportar-pdf", methods=["POST"])
    @app.route("/app/api/etiquetas/studio/exportar-pdf", methods=["POST"])
    def api_etiquetas_studio_exportar_pdf():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.tools.etiquetas_studio import exportar_pdf_studio

        body = request.get_json(silent=True) or {}
        try:
            result = exportar_pdf_studio(body)
            sku = (body.get("sku") or "").strip()
            if sku and result.get("pdf_ruta"):
                try:
                    datos = _load_etiquetas_datos()
                    entry = dict(datos.get(sku, {}))
                    entry["pdf_ruta"] = result["pdf_ruta"]
                    entry["pdf_nombre"] = result.get("pdf_nombre", "")
                    entry["nombre_etiqueta"] = body.get("nombre_producto") or entry.get("nombre_etiqueta", "")
                    entry["tipo_etiqueta"] = body.get("tipo_etiqueta") or entry.get("tipo_etiqueta", "")
                    entry["studio"] = True
                    entry["updated_at"] = _dt.now().isoformat()
                    datos[sku] = entry
                    _save_etiquetas_datos(datos)
                    result["etiquetas_datos_vinculado"] = True
                except Exception:
                    pass
            return jsonify(result)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── SPA React ─────────────────────────────────────────────────────────────

    @app.route("/app", methods=["GET", "HEAD"])
    @app.route("/app/<path:path>", methods=["GET", "HEAD"])
    def serve_spa(path=""):
        if not os.path.isdir(_SPA_DIR):
            return jsonify({"error": "SPA no compilada. Ejecutar: cd desktop && npm run build"}), 404
        resp = send_from_directory(_SPA_DIR, "index.html")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        return resp
