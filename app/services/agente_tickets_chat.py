"""
Agente conversacional para registro de acciones en móvil.
Usa Ollama/Gemma para NLG (generar texto amigable).
La lógica de estado y ejecución de comandos vive en el cliente y en este módulo.
"""
from __future__ import annotations
import logging, os, re
from datetime import date
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

def _hoy_iso() -> str:
    return date.today().isoformat()


def _labores_tablero_usuario(usuario_id: int) -> list[dict]:
    """Etapas del tablero Kingdom (deprecado). Ya no se exponen al agente ni al saludo."""
    return []


def construir_saludo_operativo(nombre: str, contexto: dict) -> str:
    """Saludo breve con preguntas prácticas sobre el día en Centro de Mando."""
    preguntas: list[str] = []
    hoy = _hoy_iso()

    recs = contexto.get("recordatorios_hoy") or []
    if recs:
        if len(recs) == 1:
            preguntas.append(f"¿Ya atendió el recordatorio «{recs[0]['titulo']}»?")
        else:
            preguntas.append(f"¿Por cuál recordatorio empezamos? ({len(recs)} para hoy)")

    labores = contexto.get("labores_tablero") or []
    if labores and len(preguntas) < 2:
        primera = labores[0]["titulo"]
        preguntas.append(f"¿Avanzó con «{primera}» en el tablero?")

    sol_asig = contexto.get("solicitudes_asignadas") or []
    if sol_asig and len(preguntas) < 2:
        if len(sol_asig) == 1:
            de = sol_asig[0].get("creado_por_nombre") or "el equipo"
            preguntas.append(f"¿Atendió la solicitud «{sol_asig[0]['titulo']}» de {de}?")
        else:
            preguntas.append(f"¿Con cuál solicitud arranca? ({len(sol_asig)} le esperan)")

    acciones = contexto.get("acciones_activas") or []
    if acciones and len(preguntas) < 2:
        if len(acciones) == 1:
            preguntas.append(f"¿Sigue con «{acciones[0]['titulo']}» o registra otra acción?")
        else:
            preguntas.append("¿Retoma alguna acción en curso o empieza una nueva?")

    pendientes = contexto.get("pendientes") or []
    pend_hoy = [
        p for p in pendientes
        if p.get("fecha_recordatorio") and str(p["fecha_recordatorio"])[:10] <= hoy
    ]
    if pend_hoy and len(preguntas) < 2:
        preguntas.append("¿Convierte en acción algún pendiente anotado para hoy?")

    sol_aprobar = contexto.get("solicitudes_por_aprobar") or []
    if sol_aprobar and len(preguntas) < 2:
        n = len(sol_aprobar)
        preguntas.append(
            f"¿Revisamos la{'s' if n > 1 else ''} solicitud"
            f"{'es' if n > 1 else ''} que esperan su confirmación?"
        )

    if preguntas:
        return f"¡Hola {nombre}! " + " ".join(preguntas[:2])

    total = (
        len(acciones) + len(sol_asig) + len(sol_aprobar)
        + len(contexto.get("solicitudes_creadas_activas") or [])
        + len(labores) + len(recs)
    )
    if total == 0:
        return (
            f"¡Hola {nombre}! ¿Qué va a hacer hoy? "
            "Cuénteme la labor y la registramos, o elija una opción abajo."
        )
    return f"¡Hola {nombre}! ¿En qué labor del día le ayudo?"


def obtener_contexto(usuario: dict) -> dict:
    """Devuelve acciones activas y protocolos disponibles del usuario."""
    from app.services.tickets_db import (
        listar_tickets, listar_protocolos, listar_recordatorios, listar_pendientes,
    )
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
        if t.get("asignado_a") == usuario["id"] and t.get("estado") not in ("resuelto", "rechazado", "esperando_aprobacion")
    ][:5]

    # Solicitudes que yo ejecuté y están esperando que el solicitante confirme
    solicitudes_esperando_confirmacion = [
        {
            "id": t["id"],
            "titulo": t["titulo"],
            "numero": t.get("numero") or "",
            "creado_por_nombre": t.get("creado_por_nombre") or "",
        }
        for t in (solic_raw or [])
        if t.get("asignado_a") == usuario["id"] and t.get("estado") == "esperando_aprobacion"
    ][:5]

    # Solicitudes que yo creé y que esperan mi confirmación
    solic_todas_raw = listar_tickets(usuario, {"tipo": "solicitud"}) or []
    solicitudes_por_aprobar = [
        {
            "id": t["id"],
            "titulo": t["titulo"],
            "numero": t.get("numero") or "",
            "asignado_a_nombre": t.get("asignado_a_nombre") or "",
        }
        for t in solic_todas_raw
        if t.get("creado_por") == usuario["id"] and t.get("estado") == "esperando_aprobacion"
    ][:3]

    # Solicitudes que yo creé y están activas (en proceso o pendientes — asignadas a otra persona)
    solicitudes_creadas_activas = [
        {
            "id": t["id"],
            "titulo": t["titulo"],
            "numero": t.get("numero") or "",
            "asignado_a_nombre": t.get("asignado_a_nombre") or "",
            "estado": t.get("estado") or "pendiente",
        }
        for t in solic_todas_raw
        if t.get("creado_por") == usuario["id"]
        and t.get("asignado_a") != usuario["id"]
        and t.get("estado") in ("en_proceso", "pendiente")
    ][:3]

    # Tickets donde el usuario es participante/colaborador (no executor ni solicitante)
    from app.services.tickets_db import _conn
    with _conn() as _db:
        colab_rows = _db.execute("""
            SELECT t.id, t.titulo, t.numero, t.estado,
                   uc.nombre AS creado_por_nombre,
                   ua.nombre AS asignado_a_nombre
            FROM tickets t
            JOIN ticket_participantes tp ON tp.ticket_id = t.id AND tp.usuario_id = ?
            LEFT JOIN usuarios uc ON uc.id = t.creado_por
            LEFT JOIN usuarios ua ON ua.id = t.asignado_a
            WHERE t.asignado_a != ?
              AND t.creado_por != ?
              AND t.estado NOT IN ('resuelto', 'rechazado')
            ORDER BY t.creado_en DESC
            LIMIT 5
        """, [usuario["id"], usuario["id"], usuario["id"]]).fetchall()
    colaboraciones = [
        {
            "id": r["id"],
            "titulo": r["titulo"],
            "numero": r["numero"] or "",
            "creado_por_nombre": r["creado_por_nombre"] or "",
            "asignado_a_nombre": r["asignado_a_nombre"] or "",
        }
        for r in colab_rows
    ]

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

    hoy = _hoy_iso()
    recordatorios_raw = listar_recordatorios(usuario["id"]) or []
    recordatorios_hoy = [
        {"id": r["id"], "titulo": r["titulo"], "proxima_fecha": r.get("proxima_fecha") or ""}
        for r in recordatorios_raw
        if (r.get("proxima_fecha") or "")[:10] <= hoy
    ][:5]

    pendientes_raw = listar_pendientes(usuario["id"]) or []
    pendientes = [
        {
            "id": p["id"],
            "titulo": p["titulo"],
            "fecha_recordatorio": p.get("fecha_recordatorio"),
        }
        for p in pendientes_raw[:5]
    ]

    labores_tablero = _labores_tablero_usuario(usuario["id"])

    return {
        "acciones_activas": acciones,
        "protocolos": protocolos,
        "solicitudes_asignadas": solicitudes_asignadas,
        "solicitudes_por_aprobar": solicitudes_por_aprobar,
        "solicitudes_esperando_confirmacion": solicitudes_esperando_confirmacion,
        "solicitudes_creadas_activas": solicitudes_creadas_activas,
        "colaboraciones": colaboraciones,
        "recordatorios_hoy": recordatorios_hoy,
        "pendientes": pendientes,
        "labores_tablero": labores_tablero,
    }


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
    recs = ", ".join(r["titulo"] for r in contexto.get("recordatorios_hoy", [])) or "ninguno"
    labores = ", ".join(
        f"{l['titulo']} ({l.get('mision_titulo') or 'tablero'})"
        for l in contexto.get("labores_tablero", [])
    ) or "ninguna"
    sol_asig = ", ".join(s["titulo"] for s in contexto.get("solicitudes_asignadas", [])) or "ninguna"
    pend = ", ".join(p["titulo"] for p in contexto.get("pendientes", [])) or "ninguno"

    system = (
        f"Usted es Hugo García, asistente operativo del Centro de Mando de McKenna Group (Bogotá). "
        f"Ayuda a {nombre} con las labores del día: acciones, solicitudes, recordatorios y tablero. "
        f"Sea práctico: haga preguntas concretas sobre lo pendiente antes de sugerir opciones genéricas. "
        f"Responda en español rolo bogotano (use 'usted', 'listo', 'de una', 'pilas'), MUY breve "
        f"(1-2 frases, sin markdown, sin listas). "
        f"Si describe algo que va a hacer, confirme y guíe al procedimiento o registro de acción. "
        f"Recordatorios hoy: {recs}. Labores tablero: {labores}. Solicitudes por atender: {sol_asig}. "
        f"Pendientes anotados: {pend}. Acciones activas: {activas}. Procedimientos: {prots}."
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
