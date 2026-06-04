"""
Agente conversacional para registro de acciones en móvil.
Usa Ollama/Gemma para NLG (generar texto amigable).
La lógica de estado y ejecución de comandos vive en el cliente y en este módulo.
"""
from __future__ import annotations
import logging, os
import requests

log = logging.getLogger(__name__)


def _ollama_url() -> str:
    return (
        os.getenv("AGENTE_OLLAMA_URL") or "http://127.0.0.1:11434"
    ).rstrip("/")


def _ollama_model() -> str:
    # gemma3:1b es rápido y suficiente para NLG corto; usar gemma4:e4b si hay GPU libre
    return (
        os.getenv("AGENTE_TICKETS_CHAT_MODEL")
        or os.getenv("AGENTE_OLLAMA_MODEL")
        or "gemma3:1b"
    )


def obtener_contexto(usuario: dict) -> dict:
    """Devuelve acciones activas y protocolos disponibles del usuario."""
    from app.services.tickets_db import listar_tickets, listar_protocolos

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

    protos_raw = listar_protocolos(usuario)
    protocolos = [
        {"id": p["id"], "titulo": p["titulo"]}
        for p in (protos_raw or [])[:8]
    ]

    return {"acciones_activas": acciones, "protocolos": protocolos}


def generar_respuesta(
    mensaje: str,
    historial: list[dict],
    contexto: dict,
    usuario: dict,
) -> str:
    """
    Llama a Ollama para producir una respuesta conversacional corta.
    Retorna texto vacío si Ollama no está disponible.
    """
    nombre = (usuario.get("nombre") or "").split()[0]
    prots = ", ".join(p["titulo"] for p in contexto.get("protocolos", [])) or "ninguno"
    activas = ", ".join(
        f"#{a['id']} {a['titulo']}" for a in contexto.get("acciones_activas", [])
    ) or "ninguna"

    system = (
        f"Sos Hugo García, asistente operativo de McKenna Group (Bogotá, Colombia). "
        f"Ayudás a {nombre} a registrar su trabajo diario. "
        f"Respondé en español colombiano, muy breve (máximo 2 frases, sin markdown). "
        f"Acciones activas del usuario: {activas}. "
        f"Procedimientos disponibles: {prots}."
    )

    msgs: list[dict] = [{"role": "system", "content": system}]
    for h in historial[-6:]:
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
                "options": {"temperature": 0.5, "num_predict": 120},
            },
            timeout=45,
        )
        r.raise_for_status()
        data = r.json()
        texto = ((data.get("message") or {}).get("content") or "").strip()
        return texto[:400]
    except Exception as exc:
        log.warning("[AgenteChatTickets] Ollama: %s", exc)
        return ""


def ejecutar_cmd(cmd: str, datos: dict, usuario: dict) -> dict:
    """
    Ejecuta un comando de acción en la DB.
    Retorna dict con resultado o {"error": str}.
    """
    from app.services.tickets_db import crear_ticket, cambiar_estado, get_ticket

    uid = usuario["id"]

    if cmd == "crear_accion":
        titulo = (datos.get("titulo") or "").strip() or "Acción sin título"
        protocolo_id = datos.get("protocolo_id") or None
        data_ticket = {
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
        return {
            "ticket_id": ticket["id"],
            "numero": ticket.get("numero") or "",
            "titulo": ticket.get("titulo") or titulo,
            "pasos": ticket.get("pasos") or [],
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
        if not paso_id:
            return {"error": "paso_id requerido"}
        from app.services.tickets_db import completar_paso_ticket
        ticket_id = datos.get("ticket_id")
        if not ticket_id:
            return {"error": "ticket_id requerido"}
        pasos, err, _ = completar_paso_ticket(int(ticket_id), int(paso_id), usuario)
        if err:
            return {"error": err}
        completados = sum(1 for p in (pasos or []) if p.get("completado"))
        total = len(pasos or [])
        return {"pasos_completados": completados, "pasos_total": total, "pasos": pasos}

    return {"error": f"Comando desconocido: {cmd}"}
