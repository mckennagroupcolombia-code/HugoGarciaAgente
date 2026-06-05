"""
Agente conversacional para registro de acciones en móvil.
Usa Ollama/Gemma para NLG (generar texto amigable).
La lógica de estado y ejecución de comandos vive en el cliente y en este módulo.
"""
from __future__ import annotations
import logging, os, re
import requests

log = logging.getLogger(__name__)

# Palabras que indican intención de iniciar una acción propia
_INTENT_PALABRAS = re.compile(
    r"\b(voy a|vamos a|quiero|necesito|tengo que|hay que|procedo a|voy|empiezo|arranco|inicio|comenzar?)\b",
    re.IGNORECASE,
)

# Patrones que indican solicitud a otra persona
_INTENT_SOLICITUD = re.compile(
    r"\b(solicitud|hazle|pídele|pedirle|pedirle|dile a|avísale|avisale|necesito que|que haga|que revise|que busque|que traiga|que envíe|que prepare)\b",
    re.IGNORECASE,
)

# Extrae el nombre de persona de frases como "a Cynthia", "para Cynthia", "a Juan"
_PERSONA_EN_MSG = re.compile(
    r"\b(?:a|para|con|de parte de)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)",
    re.UNICODE,
)

# Extrae el título implícito en "para que [verbo]...", "que [verbo]...", "para [verbo]ar..."
_TITULO_IMPLICITO = re.compile(
    r"(?:para que|que|para)\s+(.{5,})",
    re.IGNORECASE,
)

# Stop-words básicas en español para la búsqueda de procedimientos
_STOP = {
    "a","de","el","la","los","las","un","una","en","y","que","es","se","por",
    "para","con","su","del","al","como","pero","más","ya","me","te","le","nos",
    "voy","vamos","quiero","necesito","tengo","hay","esto","eso","ello","lo",
    "hacer","hacer","procedo","ahora","hoy","voy","voy","yo","mi","mis",
}


def _ollama_url() -> str:
    return (os.getenv("AGENTE_OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")


def _ollama_model() -> str:
    return (
        os.getenv("AGENTE_TICKETS_CHAT_MODEL")
        or os.getenv("AGENTE_OLLAMA_MODEL")
        or "gemma3:1b"
    )


# ── Contexto ──────────────────────────────────────────────────────────────────

def obtener_contexto(usuario: dict) -> dict:
    """Devuelve acciones activas y protocolos disponibles del usuario."""
    from app.services.tickets_db import listar_tickets, listar_protocolos
    import json

    acciones_raw = listar_tickets(usuario, {"tipo": "accion", "activas": True})
    acciones = [
        {
            "id": t["id"],
            "titulo": t["titulo"],
            "numero": t.get("numero") or "",
            "estado": t.get("estado") or "pendiente",
            "pasos_total": t.get("pasos_total") or 0,
            "pasos_completados": t.get("pasos_completados") or 0,
        }
        for t in (acciones_raw or [])[:6]
    ]

    solic_raw = listar_tickets(usuario, {"tipo": "solicitud", "activas": True})
    solicitudes_asignadas = [
        {
            "id": t["id"],
            "titulo": t["titulo"],
            "numero": t.get("numero") or "",
            "creado_por_nombre": t.get("creado_por_nombre") or "",
        }
        for t in (solic_raw or [])
        if t.get("asignado_a") == usuario["id"]
    ][:5]

    protos_raw = listar_protocolos(usuario)
    protocolos = []
    for p in (protos_raw or [])[:10]:
        pasos_raw = p.get("pasos") or "[]"
        try:
            pasos = json.loads(pasos_raw) if isinstance(pasos_raw, str) else pasos_raw
        except Exception:
            pasos = []
        compras_raw = p.get("lista_compras") or "[]"
        try:
            compras = json.loads(compras_raw) if isinstance(compras_raw, str) else compras_raw
        except Exception:
            compras = []
        protocolos.append({
            "id": p["id"],
            "titulo": p["titulo"],
            "pasos": pasos,
            "lista_compras": compras,
        })

    return {"acciones_activas": acciones, "protocolos": protocolos, "solicitudes_asignadas": solicitudes_asignadas}


# ── Detección de intención ────────────────────────────────────────────────────

def detectar_procs_relevantes(mensaje: str, protocolos: list[dict]) -> list[dict]:
    """
    Busca procedimientos cuyo título o pasos coincidan con palabras clave del mensaje.
    Retorna lista ordenada por relevancia (máx 4).
    """
    tokens = set(re.findall(r"\w+", mensaje.lower())) - _STOP
    if not tokens:
        return []

    scored: list[tuple[int, dict]] = []
    for p in protocolos:
        titulo_tokens = set(re.findall(r"\w+", p["titulo"].lower())) - _STOP
        # Tokens de las descripciones de pasos
        pasos_texto = " ".join(
            (paso.get("descripcion") or "") for paso in (p.get("pasos") or [])
        ).lower()
        pasos_tokens = set(re.findall(r"\w+", pasos_texto)) - _STOP

        score = len(tokens & titulo_tokens) * 3 + len(tokens & pasos_tokens)
        if score > 0:
            scored.append((score, p))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored[:4]]


def tiene_intent_accion(mensaje: str) -> bool:
    """Detecta si el mensaje expresa intención de iniciar/hacer algo PROPIO."""
    if _INTENT_SOLICITUD.search(mensaje):
        return False  # solicitud tiene prioridad
    return bool(_INTENT_PALABRAS.search(mensaje))


def tiene_intent_solicitud(mensaje: str) -> bool:
    return bool(_INTENT_SOLICITUD.search(mensaje))


def extraer_nombre_persona(texto: str) -> str | None:
    """Extrae el primer nombre propio mencionado después de 'a', 'para', etc."""
    m = _PERSONA_EN_MSG.search(texto)
    return m.group(1).strip() if m else None


def buscar_usuario_por_nombre(nombre: str, excluir_id: int | None = None) -> dict | None:
    """Busca el usuario activo cuyo nombre coincide más con el texto dado."""
    from app.services.tickets_db import _conn
    nombre_l = nombre.lower().strip()
    try:
        with _conn() as db:
            rows = db.execute(
                "SELECT id, nombre FROM usuarios WHERE activo=1"
            ).fetchall()
        # score: cuántas palabras del nombre buscado aparecen en el nombre del usuario
        best_score, best = 0, None
        tokens_buscados = set(nombre_l.split())
        for row in rows:
            if excluir_id and row["id"] == excluir_id:
                continue
            tokens_usuario = set(row["nombre"].lower().split())
            score = len(tokens_buscados & tokens_usuario)
            if score > best_score:
                best_score, best = score, dict(row)
        return best if best_score > 0 else None
    except Exception as exc:
        log.warning("[AgenteChatTickets] buscar_usuario: %s", exc)
        return None


def detectar_solicitud_context(mensaje: str, historial: list[dict]) -> dict:
    """
    Analiza el mensaje actual y el historial reciente para detectar si se está
    construyendo una solicitud, extrayendo persona y título aunque vengan en el
    mismo mensaje o en turnos separados.

    Retorna:
        {
          "es_solicitud": bool,
          "persona_nombre": str | None,
          "usuario": dict | None,
          "titulo_sugerido": str | None,
        }
    """
    msgs_usuario = [m.get("texto", "") for m in historial[-4:] if m.get("rol") == "usuario"]
    msgs_usuario.append(mensaje)

    es_solicitud = any(tiene_intent_solicitud(m) for m in msgs_usuario)
    if not es_solicitud:
        return {"es_solicitud": False, "persona_nombre": None, "usuario": None, "titulo_sugerido": None}

    # ── 1. Buscar persona en todos los mensajes recientes ─────────────────────
    persona_nombre = None
    for m in msgs_usuario:
        persona_nombre = extraer_nombre_persona(m)
        if persona_nombre:
            break

    usuario = buscar_usuario_por_nombre(persona_nombre) if persona_nombre else None

    # ── 2. Extraer título implícito ───────────────────────────────────────────
    titulo_sugerido = None

    # Caso A: todo en un solo mensaje — buscar "para que [acción]"
    # Ej: "solicitud a Cynthia para que revise el aceite esencial que dejó en la cocina"
    m_titulo = _TITULO_IMPLICITO.search(mensaje)
    if m_titulo:
        candidato = m_titulo.group(1).strip()
        # Descartar si el candidato empieza con el nombre de la persona
        if persona_nombre and candidato.lower().startswith(persona_nombre.lower()):
            pass
        elif len(candidato) > 4:
            titulo_sugerido = candidato

    # Caso B: título en mensaje separado (turno posterior al que menciona la persona)
    if not titulo_sugerido and persona_nombre and len(msgs_usuario) >= 2:
        ultimo = msgs_usuario[-1].strip()
        # El título está en el último mensaje si no contiene el nombre de la persona
        if persona_nombre.lower() not in ultimo.lower() and len(ultimo) > 3:
            titulo_sugerido = ultimo

    # Limpiar el título: quitar artículos iniciales sobrantes
    if titulo_sugerido:
        titulo_sugerido = re.sub(r"^(que|la|el|lo|las|los|un|una)\s+", "", titulo_sugerido, flags=re.I).strip()
        # Capitalizar primera letra
        if titulo_sugerido:
            titulo_sugerido = titulo_sugerido[0].upper() + titulo_sugerido[1:]

    return {
        "es_solicitud": True,
        "persona_nombre": persona_nombre,
        "usuario": usuario,
        "titulo_sugerido": titulo_sugerido,
    }


# ── NLG via Ollama ────────────────────────────────────────────────────────────

def generar_respuesta(
    mensaje: str,
    historial: list[dict],
    contexto: dict,
    usuario: dict,
) -> str:
    """Llama a Ollama para producir una respuesta conversacional corta."""
    nombre = (usuario.get("nombre") or "").split()[0]
    prots = ", ".join(p["titulo"] for p in contexto.get("protocolos", [])) or "ninguno"
    activas = ", ".join(
        f"#{a['id']} {a['titulo']}" for a in contexto.get("acciones_activas", [])
    ) or "ninguna"

    system = (
        f"Sos Hugo García, asistente operativo de McKenna Group (Bogotá, Colombia). "
        f"Ayudás a {nombre} a registrar su trabajo. "
        f"Respondé en español colombiano, MUY breve (1 frase, sin markdown, sin listas). "
        f"Si el usuario describe algo que va a hacer, confirmá brevemente y pedile que elija el procedimiento. "
        f"Acciones activas: {activas}. Procedimientos disponibles: {prots}."
    )

    msgs: list[dict] = [{"role": "system", "content": system}]
    for h in historial[-4:]:
        role = "user" if h.get("rol") == "usuario" else "assistant"
        msgs.append({"role": role, "content": h.get("texto") or ""})
    if mensaje:
        msgs.append({"role": "user", "content": mensaje})

    try:
        r = requests.post(
            f"{_ollama_url()}/api/chat",
            json={
                "model": _ollama_model(),
                "messages": msgs,
                "stream": False,
                "options": {"temperature": 0.4, "num_predict": 80},
            },
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        texto = ((data.get("message") or {}).get("content") or "").strip()
        # Limpiar markdown básico
        texto = re.sub(r"\*+", "", texto).strip()
        return texto[:300]
    except Exception as exc:
        log.warning("[AgenteChatTickets] Ollama: %s", exc)
        return ""


# ── Ejecución de comandos ─────────────────────────────────────────────────────

def ejecutar_cmd(cmd: str, datos: dict, usuario: dict) -> dict:
    """Ejecuta un comando en la DB. Retorna dict con resultado o {"error": str}."""
    import json
    from app.services.tickets_db import crear_ticket, get_ticket

    uid = usuario["id"]

    if cmd == "crear_accion":
        titulo = (datos.get("titulo") or "").strip() or "Acción sin título"
        protocolo_id = datos.get("protocolo_id") or None
        data_ticket: dict = {
            "titulo": titulo,
            "descripcion": titulo,
            "categoria": "operaciones",
            "prioridad": "media",
            "asignado_a": uid,
            "tipo": "accion",
        }
        if protocolo_id:
            data_ticket["protocolo_id"] = int(protocolo_id)
        ticket, err = crear_ticket(data_ticket, uid)
        if err:
            return {"error": err}
        # Recargar ticket completo para obtener pasos creados desde el protocolo
        ticket_full = get_ticket(ticket["id"], usuario) or ticket
        pasos_raw = ticket_full.get("pasos") or []
        pasos = _normalizar_pasos(pasos_raw)
        compras_raw = datos.get("lista_compras") or []
        return {
            "ticket_id": ticket_full["id"],
            "numero": ticket_full.get("numero") or "",
            "titulo": ticket_full.get("titulo") or titulo,
            "pasos": pasos,
            "lista_compras": compras_raw,
        }

    if cmd == "completar_accion":
        ticket_id = datos.get("ticket_id")
        if not ticket_id:
            return {"error": "ticket_id requerido"}
        reporte = (datos.get("reporte") or "").strip()
        from app.services.tickets_db import completar_accion_y_reportar_solicitud
        ticket, err = completar_accion_y_reportar_solicitud(
            int(ticket_id), uid, reporte_texto=reporte, marcar_solicitud_resuelta=True
        )
        if err:
            return {"error": err}
        return {"completado": True, "ticket_id": int(ticket_id)}

    if cmd == "marcar_paso":
        paso_id = datos.get("paso_id")
        ticket_id = datos.get("ticket_id")
        if not paso_id or not ticket_id:
            return {"error": "ticket_id y paso_id requeridos"}
        from app.services.tickets_db import completar_paso_ticket
        pasos_raw, err, _ = completar_paso_ticket(int(ticket_id), int(paso_id), usuario)
        if err:
            return {"error": err}
        pasos = _normalizar_pasos(pasos_raw or [])
        completados = sum(1 for p in pasos if p.get("completado"))
        total = len(pasos)
        return {"pasos_completados": completados, "pasos_total": total, "pasos": pasos}

    if cmd == "crear_solicitud":
        titulo = (datos.get("titulo") or "").strip() or "Solicitud sin título"
        asignado_a = datos.get("asignado_a")
        if not asignado_a:
            return {"error": "asignado_a requerido"}
        data_ticket: dict = {
            "titulo": titulo,
            "descripcion": titulo,
            "categoria": "operaciones",
            "prioridad": "media",
            "asignado_a": int(asignado_a),
            "tipo": "solicitud",
        }
        ticket, err = crear_ticket(data_ticket, uid)
        if err:
            return {"error": err}
        return {
            "ticket_id": ticket["id"],
            "numero": ticket.get("numero") or "",
            "titulo": ticket.get("titulo") or titulo,
            "asignado_a_id": int(asignado_a),
        }

    return {"error": f"Comando desconocido: {cmd}"}


def _normalizar_pasos(pasos_raw: list) -> list:
    """Normaliza pasos para que siempre tengan 'descripcion', 'id', 'completado'."""
    result = []
    for p in (pasos_raw or []):
        desc = (p.get("descripcion") or p.get("nombre") or "").strip()
        if not desc:
            continue
        result.append({
            "id": p.get("id"),
            "descripcion": desc,
            "notas": (p.get("notas") or "").strip(),
            "completado": bool(p.get("completado")),
            "orden": p.get("orden"),
        })
    return result
