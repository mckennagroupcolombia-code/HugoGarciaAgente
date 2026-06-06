"""
Consultas técnicas del chat web sin respuesta automática.

Flujo:
  1. Cliente pregunta algo que no está en ficha/memoria → se crea WCQ-YYYYMMDD-NNNN
  2. Alerta al grupo Guias_Envios pagina web (GRUPO_PEDIDOS_WEB_WA)
  3. Equipo responde: web resp WCQ-20260530-0042: La densidad es …
  4. Se guarda en memoria vectorial (mckenna_brain) para futuras consultas
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime
from typing import Any

from app.observability import log_json, spawn_thread

_DATA_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "web_chat_consultas_pendientes.json"
)
_LOCK = threading.Lock()
_CODIGO_RE = re.compile(r"\bWCQ-\d{8}-\d{4}\b", re.IGNORECASE)
_SUFIJO_RE = re.compile(r"\b(?:consulta|wcq)\s*[-#]?\s*(\d{4})\b", re.IGNORECASE)


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _today_tag() -> str:
    return datetime.now().strftime("%Y%m%d")


def _load() -> dict[str, Any]:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("consultas", [])
    if not isinstance(data["consultas"], list):
        data["consultas"] = []
    return data


def _save(data: dict[str, Any]) -> None:
    data["updated_at"] = _now_iso()
    os.makedirs(os.path.dirname(_DATA_PATH), exist_ok=True)
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _siguiente_numero_dia(data: dict[str, Any]) -> str:
    tag = _today_tag()
    max_n = 0
    for c in data.get("consultas") or []:
        codigo = str(c.get("codigo") or "")
        m = re.search(rf"WCQ-{tag}-(\d{{4}})", codigo, re.I)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"{max_n + 1:04d}"


def extraer_codigo_consulta(texto: str) -> str | None:
    """WCQ-YYYYMMDD-NNNN o 'consulta 0042' / 'wcq 0042'."""
    t = (texto or "").strip()
    m = _CODIGO_RE.search(t)
    if m:
        return m.group(0).upper()
    m2 = _SUFIJO_RE.search(t)
    if m2:
        return f"WCQ-{_today_tag()}-{m2.group(1)}"
    # Sufijo suelto de 4 dígitos si el mensaje menciona consulta/wcq
    if re.search(r"\b(consulta|wcq|seguimiento)\b", t, re.I):
        m3 = re.search(r"\b(\d{4})\b", t)
        if m3:
            return f"WCQ-{_today_tag()}-{m3.group(1)}"
    return None


def _buscar_por_codigo(data: dict, codigo: str) -> dict | None:
    cod = (codigo or "").strip().upper()
    for c in data.get("consultas") or []:
        if str(c.get("codigo", "")).upper() == cod:
            return c
    return None


def buscar_consulta(codigo: str) -> dict | None:
    with _LOCK:
        return _buscar_por_codigo(_load(), codigo)


def buscar_consulta_por_sufijo(sufijo: str, tag_dia: str | None = None) -> dict | None:
    suf = re.sub(r"\D", "", (sufijo or ""))[-4:]
    if len(suf) != 4:
        return None
    tag = tag_dia or _today_tag()
    codigo = f"WCQ-{tag}-{suf}"
    return buscar_consulta(codigo)


def _consulta_reciente_duplicada(
    data: dict, session_id: str, pregunta: str, producto: str
) -> dict | None:
    """Evita spam: misma sesión + pregunta similar en últimos 30 min."""
    sid = (session_id or "").strip()
    plow = re.sub(r"\s+", " ", (pregunta or "").strip().lower())
    prod = (producto or "").strip().lower()
    for c in reversed(data.get("consultas") or []):
        if c.get("session_id") != sid:
            continue
        if c.get("respondida"):
            continue
        if (c.get("producto") or "").strip().lower() != prod:
            continue
        cp = re.sub(r"\s+", " ", (c.get("pregunta") or "").strip().lower())
        if cp == plow:
            return c
    return None


def crear_consulta_pendiente(
    *,
    session_id: str,
    pregunta: str,
    producto: str = "",
    page_url: str = "",
) -> dict:
    """
    Crea consulta WCQ-… y retorna el registro.
    Si ya existe una pendiente idéntica en la sesión, reutiliza el código.
    """
    with _LOCK:
        data = _load()
        dup = _consulta_reciente_duplicada(data, session_id, pregunta, producto)
        if dup:
            return dup

        tag = _today_tag()
        numero = _siguiente_numero_dia(data)
        codigo = f"WCQ-{tag}-{numero}"
        registro = {
            "codigo": codigo,
            "session_id": (session_id or "")[:80],
            "producto": (producto or "")[:200],
            "pregunta": (pregunta or "")[:2000],
            "page_url": (page_url or "")[:2000],
            "creada_at": _now_iso(),
            "respondida": False,
            "respuesta": "",
            "respondida_at": None,
            "respondido_por": "",
        }
        data["consultas"].insert(0, registro)
        # Mantener historial razonable
        if len(data["consultas"]) > 500:
            data["consultas"] = data["consultas"][:500]
        _save(data)
        return registro


def guardar_respuesta_en_memoria_vectorial(
    *,
    producto: str,
    pregunta: str,
    respuesta: str,
    codigo: str,
) -> bool:
    try:
        import chromadb

        path = os.path.normpath(
            os.path.join(os.path.dirname(__file__), "..", "..", "memoria_vectorial")
        )
        client = chromadb.PersistentClient(path=path)
        col = client.get_or_create_collection("mckenna_brain")
        doc_id = f"web_chat_{codigo.lower()}_{uuid.uuid4().hex[:8]}"
        documento = (
            f"Producto: {producto or 'general'}\n"
            f"Pregunta: {pregunta}\n"
            f"Respuesta validada McKenna (chat web {codigo}): {respuesta}"
        )
        col.add(
            documents=[documento],
            ids=[doc_id],
            metadatas=[
                {
                    "origen": "web_chat_consulta",
                    "producto": (producto or "")[:120],
                    "codigo": codigo,
                    "fecha": _now_iso(),
                }
            ],
        )
        log_json("web_chat_consulta_memoria_ok", codigo=codigo)
        return True
    except Exception as e:
        log_json("web_chat_consulta_memoria_error", codigo=codigo, error=str(e)[:200])
        return False


def resolver_consulta(
    codigo: str,
    respuesta: str,
    *,
    respondido_por: str = "equipo",
) -> tuple[bool, str, dict | None]:
    """
    Marca consulta como respondida y guarda en memoria vectorial.
    Retorna (ok, mensaje, registro).
    """
    cod = (codigo or "").strip().upper()
    resp = (respuesta or "").strip()
    if not cod or not resp:
        return False, "Código y respuesta requeridos.", None

    with _LOCK:
        data = _load()
        reg = _buscar_por_codigo(data, cod)
        if not reg:
            return False, f"No encontré la consulta {cod}.", None
        if reg.get("respondida"):
            return False, f"La consulta {cod} ya fue respondida.", reg

        reg["respondida"] = True
        reg["respuesta"] = resp[:4000]
        reg["respondida_at"] = _now_iso()
        reg["respondido_por"] = (respondido_por or "equipo")[:64]
        _save(data)

    guardar_respuesta_en_memoria_vectorial(
        producto=reg.get("producto") or "",
        pregunta=reg.get("pregunta") or "",
        respuesta=resp,
        codigo=cod,
    )
    return True, f"✅ Consulta {cod} registrada en memoria.", reg


def _jid_grupo() -> str:
    from app.services.web_chat_notify import jid_grupo_pedidos_web_wa

    return jid_grupo_pedidos_web_wa()


def formatear_alerta_grupo(registro: dict) -> str:
    codigo = registro.get("codigo") or "—"
    producto = (registro.get("producto") or "—").strip()
    pregunta = (registro.get("pregunta") or "—").strip()
    sid = (registro.get("session_id") or "")[-12:]
    pagina = (registro.get("page_url") or "—")[:120]
    return (
        f"❓ *CONSULTA CHAT WEB — sin respuesta automática*\n\n"
        f"🔖 *N.º consulta:* `{codigo}`\n"
        f"📦 Producto: {producto}\n"
        f"🗣 Cliente preguntó:\n{pregunta[:900]}\n\n"
        f"✍️ Para registrar la respuesta (queda en memoria del agente):\n"
        f"`web resp {codigo}: su respuesta aquí`\n\n"
        f"Ejemplo:\n"
        f"`web resp {codigo}: La densidad aproximada es 1,02 g/mL a 25 °C.`\n\n"
        f"📍 {pagina}\n"
        f"🔗 Sesión: …{sid}\n\n"
        f"_El cliente recibió el número {codigo} para seguimiento en la burbuja._"
    )


def alertar_grupo_consulta(registro: dict, *, async_send: bool = True) -> bool:
    from app.utils import enviar_whatsapp_reporte

    texto = formatear_alerta_grupo(registro)
    destino = _jid_grupo()

    def _enviar():
        ok = enviar_whatsapp_reporte(texto, numero_destino=destino)
        log_json(
            "web_chat_consulta_wa",
            ok=ok,
            codigo=registro.get("codigo", ""),
        )

    if async_send:
        spawn_thread(_enviar, daemon=True)
        return True
    return bool(_enviar())


def mensaje_cliente_consulta_creada(registro: dict) -> str:
    from app.web_chat_mensajes import nota_asesor_whatsapp_chat_web

    codigo = registro.get("codigo") or "WCQ"
    producto = (registro.get("producto") or "").strip()
    prod_txt = f" sobre *{producto}*" if producto else ""
    return (
        f"Veci, registré su consulta{prod_txt} con el número **{codigo}**.\n\n"
        f"La emití al equipo técnico para confirmar el dato con precisión. "
        f"Cuando esté lista, puede mencionar **{codigo}** aquí "
        f"(ej.: «consulta {codigo.split('-')[-1]}»).\n\n"
        f"Mientras tanto, si prefiere no esperar:"
        + nota_asesor_whatsapp_chat_web(motivo="la respuesta detallada de un asesor")
    )


def mensaje_cliente_consulta_resuelta(registro: dict) -> str:
    codigo = registro.get("codigo") or ""
    resp = (registro.get("respuesta") or "").strip()
    producto = (registro.get("producto") or "").strip()
    encab = f"Veci, sobre su consulta **{codigo}**"
    if producto:
        encab += f" ({producto})"
    return f"{encab}:\n\n{resp}"


def mensaje_cliente_consulta_pendiente(registro: dict) -> str:
    codigo = registro.get("codigo") or ""
    return (
        f"Veci, la consulta **{codigo}** sigue en revisión con el equipo técnico. "
        f"En breve le confirmamos el dato 🙏"
    )


def detectar_comando_respuesta_web(texto: str) -> tuple[str | None, str | None]:
    """
    Parsea: web resp WCQ-20260530-0042: respuesta
    o:     resp web WCQ-20260530-0042: respuesta
    Retorna (codigo, respuesta) o (None, None).
    """
    t = (texto or "").strip()
    if not t:
        return None, None
    t = re.sub(r"[*_~`]+", "", t).strip()

    m = re.match(
        r"^(?:web\s+resp|resp\s+web)\s+(WCQ-\d{8}-\d{4})\s*:\s*(.+)$",
        t,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        return m.group(1).upper(), m.group(2).strip()

    # Atajo: web resp 0042: … (mismo día)
    m2 = re.match(
        r"^(?:web\s+resp|resp\s+web)\s+(\d{4})\s*:\s*(.+)$",
        t,
        re.IGNORECASE | re.DOTALL,
    )
    if m2:
        return f"WCQ-{_today_tag()}-{m2.group(1)}", m2.group(2).strip()

    return None, None


def intentar_respuesta_por_codigo_en_mensaje(texto: str) -> str | None:
    """Si el cliente menciona un código WCQ, devuelve respuesta o estado pendiente."""
    codigo = extraer_codigo_consulta(texto)
    if not codigo:
        return None
    reg = buscar_consulta(codigo)
    if not reg:
        # Probar otros días con mismo sufijo si solo vino el número
        m = re.search(r"-(\d{4})$", codigo)
        if m:
            suf = m.group(1)
            with _LOCK:
                data = _load()
                for c in data.get("consultas") or []:
                    if str(c.get("codigo", "")).upper().endswith(f"-{suf}"):
                        reg = c
                        break
    if not reg:
        return (
            f"Veci, no encontré la consulta **{codigo}**. "
            f"Verifique el número o escríbanos por WhatsApp si necesita ayuda."
        )
    if reg.get("respondida"):
        return mensaje_cliente_consulta_resuelta(reg)
    return mensaje_cliente_consulta_pendiente(reg)
