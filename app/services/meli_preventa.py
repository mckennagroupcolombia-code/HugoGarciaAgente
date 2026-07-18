import os
import json
import re
import threading
import unicodedata
from datetime import datetime
from google import genai

from app.utils import jid_grupo_preventa_wa

PENDIENTES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'preguntas_pendientes_preventa.json')
CASOS_PATH = os.path.join(os.path.dirname(__file__), '..', 'training', 'casos_preventa.json')
_CASOS_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Guard INVIMA: responder "no tiene registro porque es materia prima" deja
# términos regulatorios (INVIMA, registro sanitario) en el Q&A público de la
# publicación, y el moderador de MeLi los cruza como señal de producto
# terminado sin registro → baja. La pregunta se elimina sin responder (1ª y 2ª
# vez); si el comprador insiste una 3ª (≥ PREVENTA_INVIMA_BLOQUEO_UMBRAL,
# default 3), se le bloquea en preguntas vía questions_blacklist — el costo
# comercial es aceptado: ese perfil de comprador suele terminar en devolución
# o mala reseña.
# Desactivable con PREVENTA_INVIMA_GUARD=0.
# ---------------------------------------------------------------------------

_RX_INVIMA = re.compile(
    r"\binvima\b|registro\s+sanitario|notificacion\s+sanitaria|permiso\s+sanitario",
)
INFRACTORES_INVIMA_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'data', 'preventa_invima_infractores.json'
)
_INFRACTORES_LOCK = threading.Lock()


def _norm_txt(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def es_pregunta_invima(texto: str) -> bool:
    return bool(_RX_INVIMA.search(_norm_txt(texto)))


def _registrar_infraccion_invima(comprador_id, question_id: str, producto: str) -> int:
    """Suma una infracción al comprador y retorna su total acumulado."""
    with _INFRACTORES_LOCK:
        try:
            with open(INFRACTORES_INVIMA_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = {}
        entrada = data.get(str(comprador_id)) or {"total": 0, "preguntas": [], "bloqueado": False}
        entrada["total"] += 1
        entrada["preguntas"].append({
            "question_id": str(question_id),
            "producto": producto,
            "fecha": datetime.now().isoformat(timespec="seconds"),
        })
        data[str(comprador_id)] = entrada
        try:
            with open(INFRACTORES_INVIMA_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=1, ensure_ascii=False)
        except Exception as e:
            print(f"❌ Preventa: error guardando infractores INVIMA: {e}")
        return entrada["total"]


def _marcar_infractor_bloqueado(comprador_id) -> None:
    with _INFRACTORES_LOCK:
        try:
            with open(INFRACTORES_INVIMA_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if str(comprador_id) in data:
                data[str(comprador_id)]["bloqueado"] = True
                with open(INFRACTORES_INVIMA_PATH, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=1, ensure_ascii=False)
        except Exception:
            pass


def eliminar_pregunta_meli(question_id: str) -> bool:
    """Elimina una pregunta recibida en MeLi (DELETE /questions/{id})."""
    import requests
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        return False
    try:
        r = requests.delete(
            f"https://api.mercadolibre.com/questions/{question_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
        return r.status_code in (200, 204)
    except Exception as e:
        print(f"❌ Preventa: error eliminando pregunta {question_id}: {e}")
        return False


def _comprador_de_pregunta(question_id: str):
    """user_id del comprador que hizo la pregunta (GET /questions/{id})."""
    import requests
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        return None
    try:
        r = requests.get(
            f"https://api.mercadolibre.com/questions/{question_id}?api_version=4",
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
        if r.status_code == 200:
            return (r.json().get("from") or {}).get("id")
    except Exception as e:
        print(f"❌ Preventa: error leyendo comprador de pregunta {question_id}: {e}")
    return None


def bloquear_comprador_meli(comprador_id) -> bool:
    """Bloquea al comprador para que no pueda volver a preguntar
    (POST /users/{seller_id}/questions_blacklist)."""
    import requests
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        return False
    try:
        h = {"Authorization": f"Bearer {token}"}
        me = requests.get("https://api.mercadolibre.com/users/me", headers=h, timeout=20).json()
        seller_id = me.get("id")
        if not seller_id:
            return False
        r = requests.post(
            f"https://api.mercadolibre.com/users/{seller_id}/questions_blacklist",
            headers=h,
            json={"user_id": comprador_id},
            timeout=20,
        )
        if r.status_code in (200, 201, 204):
            return True
        print(f"❌ Preventa: blacklist rechazó a {comprador_id}: {r.status_code} {r.text[:200]}")
        return False
    except Exception as e:
        print(f"❌ Preventa: error bloqueando comprador {comprador_id}: {e}")
        return False


# ---------------------------------------------------------------------------
# Persistencia — preguntas pendientes
# ---------------------------------------------------------------------------

def _leer_pendientes():
    try:
        with open(PENDIENTES_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('preguntas', [])
    except Exception:
        return []


def _guardar_pendientes(lista):
    try:
        with open(PENDIENTES_PATH, 'w', encoding='utf-8') as f:
            json.dump({'preguntas': lista}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"❌ Preventa: error guardando pendientes: {e}")


def guardar_pregunta_pendiente(
    question_id: str,
    titulo_producto: str,
    pregunta: str,
    borrador_ia: str = "",
) -> bool:
    pendientes = _leer_pendientes()
    # Evitar duplicados: si ya existe (pendiente o respondida), no re-notificar
    if any(str(p.get('question_id')) == str(question_id) for p in pendientes):
        print(f"⚠️ Preventa: question_id {question_id} ya registrado, omitiendo duplicado")
        return False
    entrada: dict = {
        'question_id': str(question_id),
        'titulo_producto': titulo_producto,
        'pregunta': pregunta,
        'timestamp': datetime.now().isoformat(),
        'respondida': False,
    }
    if borrador_ia:
        entrada['borrador_ia'] = borrador_ia
    pendientes.append(entrada)
    _guardar_pendientes(pendientes)
    return True


def obtener_preguntas_pendientes():
    """Lista todas las entradas del JSON de cola (panel / diagnóstico)."""
    return _leer_pendientes()


def obtener_pregunta_pendiente(question_id: str):
    """Busca una pregunta por ID. Retorna dict o None (sin mutar estado)."""
    pendientes = _leer_pendientes()
    for p in pendientes:
        if str(p.get('question_id')) == str(question_id):
            return p
    return None


def obtener_borrador_ia(question_id: str) -> str:
    """Retorna el borrador IA guardado para una pregunta pendiente, o '' si no hay."""
    p = obtener_pregunta_pendiente(question_id)
    return (p or {}).get("borrador_ia", "")


def marcar_pregunta_respondida(question_id: str) -> bool:
    """Marca pregunta como respondida solo después de confirmar envío exitoso."""
    pendientes = _leer_pendientes()
    for p in pendientes:
        if str(p.get('question_id')) == str(question_id):
            p['respondida'] = True
            _guardar_pendientes(pendientes)
            return True
    return False


# ---------------------------------------------------------------------------
# Persistencia — casos aprendidos
# ---------------------------------------------------------------------------

def _leer_casos():
    try:
        with open(CASOS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('casos', [])
    except Exception:
        return []


def guardar_caso_preventa(producto: str, pregunta: str, respuesta: str):
    nuevo = {
        'producto': producto,
        'pregunta': pregunta,
        'respuesta': respuesta,
        'timestamp': datetime.now().isoformat(),
    }
    try:
        with _CASOS_LOCK:
            casos = _leer_casos()
            key_nuevo = (
                nuevo.get('producto', ''),
                nuevo.get('pregunta', ''),
                nuevo.get('respuesta', ''),
            )
            existentes = {
                (
                    c.get('producto', ''),
                    c.get('pregunta', ''),
                    c.get('respuesta', ''),
                )
                for c in casos
            }
            if key_nuevo not in existentes:
                casos.append(nuevo)
            with open(CASOS_PATH, 'w', encoding='utf-8') as f:
                json.dump({'casos': casos}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"❌ Preventa: error guardando caso: {e}")


def _ejemplos_fewshot(titulo_producto: str) -> str:
    casos = _leer_casos()
    titulo_norm = titulo_producto.lower()
    similares = [
        c for c in casos
        if titulo_norm in c.get('producto', '').lower()
        or c.get('producto', '').lower() in titulo_norm
    ]
    if not similares:
        return ""
    lineas = ["\nEjemplos de respuestas anteriores validadas para este producto:"]
    for c in similares[-3:]:
        lineas.append(f"P: {c['pregunta']}\nR: {c['respuesta']}\n")
    return "\n".join(lineas)


# ---------------------------------------------------------------------------
# Función principal
# ---------------------------------------------------------------------------

def manejar_pregunta_preventa(
    question_id: str,
    titulo_producto: str,
    pregunta_cliente: str,
    comprador_id=None,
    item_id: str = "",
):
    """
    Flujo completo de preventa:
    - Con ficha técnica → responde automáticamente con IA.
    - Sin ficha técnica → delega al grupo, NO responde al cliente.
    item_id: publicación de la pregunta (para excluirla al ofrecer otras
    presentaciones del mismo producto).
    Retorna (respuesta_texto, fue_respondida):
      - (str, True)  si se generó respuesta para enviar al cliente
      - (None, False) si quedó delegada al grupo
    """
    if os.getenv("PREVENTA_INVIMA_GUARD", "1") != "0" and es_pregunta_invima(pregunta_cliente):
        if comprador_id is None:
            comprador_id = _comprador_de_pregunta(question_id)
        eliminada = eliminar_pregunta_meli(question_id)

        bloqueado = False
        infracciones = 0
        try:
            umbral = int(os.getenv("PREVENTA_INVIMA_BLOQUEO_UMBRAL", "3"))
        except ValueError:
            umbral = 3
        if comprador_id is not None:
            infracciones = _registrar_infraccion_invima(comprador_id, question_id, titulo_producto)
            if infracciones >= umbral:
                bloqueado = bloquear_comprador_meli(comprador_id)
                if bloqueado:
                    _marcar_infractor_bloqueado(comprador_id)

        try:
            from app.observability import log_json

            log_json(
                "preventa_pregunta_invima_omitida",
                question_id=str(question_id),
                producto=titulo_producto,
                comprador_id=comprador_id,
                infracciones=infracciones,
                eliminada=eliminada,
                bloqueado=bloqueado,
            )
        except Exception:
            pass
        try:
            from app.utils import enviar_whatsapp_reporte

            estado = "eliminada de MeLi" if eliminada else "⚠️ NO se pudo eliminar (revisar en MeLi)"
            if bloqueado:
                linea_bloqueo = f"🚫 Comprador {comprador_id} BLOQUEADO en preguntas (insistió {infracciones} veces)."
            elif comprador_id is not None and infracciones == umbral - 1:
                linea_bloqueo = f"⚠️ Comprador {comprador_id}: infracción {infracciones}/{umbral} — a la SIGUIENTE se bloquea."
            elif comprador_id is not None and infracciones:
                linea_bloqueo = f"👤 Comprador {comprador_id}: infracción {infracciones}/{umbral}."
            else:
                linea_bloqueo = "👤 No se pudo identificar al comprador."
            enviar_whatsapp_reporte(
                f"🛡️ PREGUNTA INVIMA OMITIDA\n"
                f"📦 Producto: {titulo_producto}\n"
                f"🗣 Cliente preguntó: {pregunta_cliente}\n"
                f"🗑 Estado: {estado}\n"
                f"{linea_bloqueo}\n\n"
                f"No se responde para no dejar términos regulatorios en el Q&A público "
                f"(riesgo de moderación). Si igual quieren responder, háganlo desde MeLi "
                f"sin mencionar INVIMA ni registro sanitario.",
                numero_destino=jid_grupo_preventa_wa(),
            )
        except Exception as e:
            print(f"❌ Preventa: error avisando pregunta INVIMA omitida: {e}")
        print(
            f"🛡️ Preventa: pregunta INVIMA omitida para '{titulo_producto}' "
            f"(eliminada={eliminada}, comprador={comprador_id}, bloqueado={bloqueado})"
        )
        return None, True

    from app.services.google_services import buscar_ficha_tecnica_producto

    ficha = buscar_ficha_tecnica_producto(titulo_producto)

    if not ficha:
        # Sin ficha → guardar pendiente y alertar al grupo. NO responder al cliente.
        print(f"⚠️ Preventa: sin ficha para '{titulo_producto}' — delegando al grupo")
        creada = guardar_pregunta_pendiente(question_id, titulo_producto, pregunta_cliente)
        if not creada:
            return None, False

        try:
            from app.utils import enviar_whatsapp_reporte

            sufijo = str(question_id)[-3:]
            ok_wa = enviar_whatsapp_reporte(
                f"❓ CONSULTA PREVENTA PENDIENTE\n"
                f"📦 Producto: {titulo_producto}\n"
                f"🗣 Cliente preguntó: {pregunta_cliente}\n\n"
                f"✍️ Para responder escribe:\n"
                f"resp {sufijo}: tu respuesta\n\n"
                f"Ejemplo:\n"
                f"resp {sufijo}: Se aplica 5ml por litro de agua",
                numero_destino=jid_grupo_preventa_wa(),
            )
            if not ok_wa:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente(
                    "preventa_delegacion_whatsapp_fallo",
                    question_id=str(question_id),
                    motivo="sin_ficha",
                )
        except Exception as e:
            print(f"❌ Preventa: error alertando al grupo: {e}")
            try:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente(
                    "preventa_delegacion_excepcion",
                    question_id=str(question_id),
                    error=str(e)[:300],
                    motivo="sin_ficha",
                )
            except Exception:
                pass

        return None, False

    # Con ficha → generar respuesta con IA, con contexto de otras
    # presentaciones del mismo producto y del hilo reciente de la publicación.
    try:
        otras = otras_presentaciones_meli(titulo_producto, item_id_actual=item_id)
    except Exception as e:
        print(f"⚠️ Preventa: fallo otras_presentaciones ({e}) — sigo sin ese contexto")
        otras = ""
    try:
        hilo = contexto_hilo_reciente(titulo_producto, question_id)
    except Exception:
        hilo = ""
    respuesta = generar_respuesta_con_ficha(
        titulo_producto,
        pregunta_cliente,
        ficha,
        otras_presentaciones=otras,
        contexto_hilo=hilo,
    )

    if respuesta is None:
        # IA falló (ej: Gemini 503) → delegar al grupo, NO responder al cliente
        print(f"⚠️ Preventa: IA falló para '{titulo_producto}' — delegando al grupo")
        creada = guardar_pregunta_pendiente(question_id, titulo_producto, pregunta_cliente)
        if not creada:
            return None, False
        try:
            from app.utils import enviar_whatsapp_reporte

            sufijo = str(question_id)[-3:]
            ok_wa = enviar_whatsapp_reporte(
                f"❓ CONSULTA PREVENTA PENDIENTE\n"
                f"📦 Producto: {titulo_producto}\n"
                f"🗣 Cliente preguntó: {pregunta_cliente}\n"
                f"⚠️ (IA no pudo generar respuesta automática)\n\n"
                f"✍️ Para responder escribe:\n"
                f"resp {sufijo}: tu respuesta",
                numero_destino=jid_grupo_preventa_wa(),
            )
            if not ok_wa:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente(
                    "preventa_delegacion_whatsapp_fallo",
                    question_id=str(question_id),
                    motivo="ia_fallo",
                )
        except Exception as e:
            print(f"❌ Preventa: error alertando al grupo por fallo IA: {e}")
            try:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente(
                    "preventa_delegacion_excepcion",
                    question_id=str(question_id),
                    error=str(e)[:300],
                    motivo="ia_fallo",
                )
            except Exception:
                pass
        return None, False

    # Guardar pendiente CON borrador IA — el equipo debe aprobar antes de enviar
    creada = guardar_pregunta_pendiente(
        question_id, titulo_producto, pregunta_cliente, borrador_ia=respuesta
    )
    if not creada:
        return None, False

    try:
        from app.utils import enviar_whatsapp_reporte

        sufijo = str(question_id)[-3:]
        texto_borrador = respuesta[:500] + ("..." if len(respuesta) > 500 else "")
        ok_wa = enviar_whatsapp_reporte(
            f"🤖 *BORRADOR IA — PREVENTA MELI*\n\n"
            f"📦 *Producto:* {titulo_producto}\n"
            f"🗣 *Cliente preguntó:*\n\"{pregunta_cliente}\"\n\n"
            f"💬 *Respuesta IA:*\n_{texto_borrador}_\n\n"
            f"──────────────\n"
            f"✅ Enviar como está: *ok {sufijo}*\n"
            f"✍️ Mejorar respuesta: *resp {sufijo}: tu versión*",
            numero_destino=jid_grupo_preventa_wa(),
        )
        if not ok_wa:
            from app.meli_webhook_incidents import registrar_meli_webhook_incidente
            registrar_meli_webhook_incidente(
                "preventa_borrador_whatsapp_fallo",
                question_id=str(question_id),
            )
    except Exception as e:
        print(f"❌ Preventa: error enviando borrador IA al grupo: {e}")

    return None, False


_GEMINI_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]

# ---------------------------------------------------------------------------
# Otras presentaciones del mismo producto (publicaciones hermanas en MeLi)
# ---------------------------------------------------------------------------

_SELLER_ID_CACHE: dict = {}

_RX_PRESENTACION_TITULO = re.compile(
    r"\b\d+[.,]?\d*\s*(?:gr?s?|gramos?|kg|kilos?|ml|mls|cc|litros?|l|oz|onzas?|"
    r"unid(?:ad(?:es)?)?|und|u)\b\.?",
    re.IGNORECASE,
)


def _titulo_base_producto(titulo: str) -> str:
    """'Manteca Karite 500 Gr + Envío' → 'Manteca Karite' (sin tamaño ni promos)."""
    t = titulo or ""
    t = re.sub(r"[+]\s*env[ií]o\b", " ", t, flags=re.IGNORECASE)
    t = _RX_PRESENTACION_TITULO.sub(" ", t)
    t = re.sub(r"\bx\s*\d+\b", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"\b\d+\b(?!\s*%)", " ", t)
    t = re.sub(r"\bx\b", " ", t, flags=re.IGNORECASE)  # "X" huérfana de "X 2 Unidades"
    t = re.sub(r"[^\w%áéíóúüñÁÉÍÓÚÜÑ\s-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


_CACHE_WEB_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "PAGINA_WEB", "site", "data", "cache.json"
)
_catalogo_meli_cache: dict = {}


def _catalogo_local_meli() -> list[dict]:
    """
    Entradas {name, ref, meli_id} del cache del sitio web (todas las
    presentaciones del catálogo con su publicación MeLi). TTL 10 min.
    """
    import time

    ahora = time.time()
    if _catalogo_meli_cache.get("ts", 0) > ahora - 600:
        return _catalogo_meli_cache.get("items", [])
    items: list[dict] = []
    vistos: set[str] = set()

    def _ingest(obj):
        if isinstance(obj, dict):
            meli_id = (obj.get("meli_id") or "").strip()
            name = (obj.get("name") or "").strip()
            if meli_id.startswith("MCO") and name and meli_id not in vistos:
                vistos.add(meli_id)
                items.append(
                    {
                        "name": name,
                        "ref": (obj.get("ref") or obj.get("rep_sku") or "").strip(),
                        "meli_id": meli_id,
                    }
                )
            for v in obj.values():
                _ingest(v)
        elif isinstance(obj, list):
            for v in obj:
                _ingest(v)

    try:
        with open(os.path.normpath(_CACHE_WEB_PATH), encoding="utf-8") as f:
            _ingest(json.load(f))
    except Exception as e:
        print(f"⚠️ Preventa: no pude leer catálogo local MeLi: {e}")
        return _catalogo_meli_cache.get("items", [])
    _catalogo_meli_cache["items"] = items
    _catalogo_meli_cache["ts"] = ahora
    return items


def otras_presentaciones_meli(titulo_producto: str, item_id_actual: str = "") -> str:
    """
    Publicaciones activas nuestras del mismo producto en otros tamaños.
    Candidatas del catálogo local (cache.json del sitio: name+meli_id) y
    precio/enlace/estado en vivo vía multiget /items (una sola llamada; la
    búsqueda pública /sites/MCO/search devuelve 403 para tokens normales).
    Devuelve bloque de texto para el prompt ('' si no hay o falla algo).
    """
    import requests
    from app.utils import refrescar_token_meli

    base = _titulo_base_producto(titulo_producto)
    nucleo = [w for w in _norm_txt(base).split() if len(w) >= 3][:2]
    if not nucleo:
        return ""

    candidatas = []
    for it in _catalogo_local_meli():
        if item_id_actual and it["meli_id"] == str(item_id_actual).strip():
            continue
        norm_name = _norm_txt(it["name"])
        if all(t in norm_name for t in nucleo):
            candidatas.append(it)
        if len(candidatas) >= 12:
            break
    if not candidatas:
        return ""

    try:
        token = refrescar_token_meli()
        if not token:
            return ""
        ids = ",".join(c["meli_id"] for c in candidatas)
        res = requests.get(
            "https://api.mercadolibre.com/items",
            params={"ids": ids, "attributes": "id,title,price,permalink,status"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if res.status_code != 200:
            print(f"⚠️ Preventa: multiget items {res.status_code} — sin otras presentaciones")
            return ""
        cuerpos = [
            (r.get("body") or {})
            for r in res.json()
            if isinstance(r, dict) and r.get("code") == 200
        ]
    except Exception as e:
        print(f"⚠️ Preventa: error consultando otras presentaciones: {e}")
        return ""

    norm_titulo_actual = _norm_txt(titulo_producto)
    lineas = []
    for b in cuerpos:
        if (b.get("status") or "") != "active":
            continue
        titulo_r = (b.get("title") or "").strip()
        if not titulo_r or _norm_txt(titulo_r) == norm_titulo_actual:
            continue
        if item_id_actual and str(b.get("id")) == str(item_id_actual).strip():
            continue
        precio = b.get("price")
        link = (b.get("permalink") or "").strip()
        precio_txt = f"${precio:,.0f} COP" if precio else "ver publicación"
        lineas.append(f"- {titulo_r} — {precio_txt}" + (f" — {link}" if link else ""))
        if len(lineas) >= 5:
            break
    if not lineas:
        return ""
    return (
        "OTRAS PRESENTACIONES NUESTRAS DEL MISMO PRODUCTO "
        "(publicaciones activas en Mercado Libre):\n" + "\n".join(lineas)
    )


def contexto_hilo_reciente(titulo_producto: str, question_id: str) -> str:
    """
    Preguntas recientes (≤3 días) sobre la misma publicación, con lo respondido
    o el borrador: el comprador suele preguntar en hilo ("¿hay pote más
    pequeño?" → "¿cómo la compro?") y sin esto cada respuesta sale sin memoria.
    """
    try:
        pendientes = _leer_pendientes()
    except Exception:
        return ""
    ahora = datetime.now()
    lineas = []
    for p in pendientes:
        if str(p.get("question_id")) == str(question_id):
            continue
        if (p.get("titulo_producto") or "").strip() != (titulo_producto or "").strip():
            continue
        try:
            ts = datetime.fromisoformat(p.get("timestamp", ""))
        except Exception:
            continue
        if (ahora - ts).days > 3:
            continue
        resp = (p.get("respuesta_final") or p.get("borrador_ia") or "").strip()
        lineas.append(
            f"P: {p.get('pregunta','')}\n"
            + (f"R: {resp[:400]}" if resp else "R: (aún sin responder)")
        )
    if not lineas:
        return ""
    return (
        "PREGUNTAS RECIENTES EN ESTA MISMA PUBLICACIÓN (posible mismo comprador "
        "— tenlas en cuenta como contexto del hilo):\n" + "\n\n".join(lineas[-3:])
    )


def generar_respuesta_con_ficha(
    titulo_producto: str,
    pregunta: str,
    ficha_tecnica: str,
    *,
    otras_presentaciones: str = "",
    contexto_hilo: str = "",
):
    """
    Genera respuesta usando Gemini con la ficha técnica real.
    Tries multiple models: primary (2.5-pro), then flash fallbacks on 503/overload.
    otras_presentaciones / contexto_hilo: bloques opcionales (ver
    otras_presentaciones_meli / contexto_hilo_reciente).
    Retorna el texto de respuesta, o None si todos fallan.
    """
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        print("Preventa: GOOGLE_API_KEY vacío — no se puede llamar a Gemini")
        return None

    gemini_client = genai.Client(api_key=api_key)
    ejemplos = _ejemplos_fewshot(titulo_producto)

    bloques_extra = "\n\n".join(
        b for b in (otras_presentaciones.strip(), contexto_hilo.strip()) if b
    )
    if bloques_extra:
        bloques_extra = f"\n{bloques_extra}\n"

    regla_presentaciones = (
        "7. Si el cliente pregunta por otros tamaños/presentaciones, precios, o cómo "
        "comprar, ofrécele también las OTRAS PRESENTACIONES listadas arriba con su "
        "enlace (son publicaciones nuestras del mismo producto). Usa SOLO esa lista "
        "para precios y enlaces de otras presentaciones — no inventes tamaños que "
        "no estén ahí."
        if otras_presentaciones.strip()
        else "7. Si el cliente pregunta por otros tamaños o presentaciones y no tienes "
        "una lista de otras publicaciones, invítalo a revisar nuestras demás "
        "publicaciones en Mercado Libre, sin inventar tamaños ni precios."
    )

    prompt = f"""Eres Hugo Garcia, asistente virtual de McKenna Group en Mercado Libre.

PRODUCTO: {titulo_producto}
NUNCA menciones un producto diferente al indicado arriba, EXCEPTO las otras
presentaciones nuestras del mismo producto si vienen listadas abajo: esas SÍ
puedes ofrecerlas con su enlace.

FICHA TÉCNICA:
{ficha_tecnica}
{bloques_extra}{ejemplos}

PREGUNTA DEL CLIENTE:
"{pregunta}"

REGLAS:
1. Tono: Rolo, cálido pero formal (ej: "Hola veci", "con gusto le colaboro").
2. Responde EXACTAMENTE lo que pregunta el cliente. Máximo 3 párrafos cortos.
3. SOLO usa información de la ficha técnica y de los bloques de contexto de arriba. No inventes datos.
4. MÁXIMO 2000 caracteres (límite de Mercado Libre).
5. NO menciones que tienes una "ficha técnica" — habla naturalmente.
6. NUNCA menciones INVIMA, registro sanitario, resoluciones ni normativa legal, aunque el cliente pregunte por eso — limítate a describir el producto como materia prima para formulación.
{regla_presentaciones}

Genera únicamente la respuesta para el cliente, sin comillas ni texto introductorio."""

    try:
        from app.services.canales_config import obtener_modelo_canal

        preferido = obtener_modelo_canal("meli_preventa")
        modelos_intento = []
        if preferido and preferido.startswith("gemini-"):
            modelos_intento.append(preferido)
        for m in _GEMINI_MODELS:
            if m not in modelos_intento:
                modelos_intento.append(m)
    except Exception:
        modelos_intento = list(_GEMINI_MODELS)

    for model_name in modelos_intento:
        try:
            resp = gemini_client.models.generate_content(model=model_name, contents=prompt)
            texto = (resp.text or "").strip()
            # Las respuestas de MeLi son texto plano: el markdown (**negrita**)
            # se vería con asteriscos literales.
            texto = texto.replace("**", "").replace("__", "")
            if not texto:
                print(f"Preventa: {model_name} devolvió respuesta vacía, probando siguiente…")
                continue
            if model_name != modelos_intento[0]:
                print(f"ℹ️ Preventa: respuesta generada con fallback {model_name}")
            return texto[:1997] + "..." if len(texto) > 2000 else texto
        except Exception as e:
            err_str = str(e)
            is_overload = "503" in err_str or "UNAVAILABLE" in err_str or "overloaded" in err_str.lower()
            if is_overload and model_name != modelos_intento[-1]:
                print(f"⚠️ Preventa: {model_name} → {err_str[:120]}. Probando siguiente modelo…")
                continue
            print(f"❌ Preventa: error generando respuesta IA ({model_name}): {e}")
            return None

    print("❌ Preventa: todos los modelos Gemini fallaron")
    return None
