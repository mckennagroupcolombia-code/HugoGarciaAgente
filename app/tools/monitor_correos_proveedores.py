"""
Monitor diario de mckenna.group.colombia@gmail.com: detecta correos de
proveedores solicitando certificados de retención y crea una solicitud
(ticket) para la persona encargada (por defecto Cynthia) en el panel.

La notificación por WhatsApp al asignado ya la dispara automáticamente
`crear_ticket()` (ver app/services/tickets_db.py → notificar_ticket_creado),
así que este módulo solo detecta y crea el ticket.
"""
from __future__ import annotations

import base64
import json
import os
from datetime import datetime
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_PROCESADOS_PATH = _REPO / "app" / "data" / "correos_certificados_retencion_procesados.json"

_ASIGNADO_NOMBRE = os.getenv("MONITOR_CERTIFICADOS_RETENCION_ASIGNADO", "Cynthia")
_CATEGORIA_TICKET = "contabilidad"

# Palabras/frases (con y sin tilde) que identifican una solicitud de
# certificado de retención por parte de un proveedor.
_KEYWORDS = [
    "certificado de retencion",
    "certificado de retención",
    "certificado de retefuente",
    "certificado de autorretenedor",
    "certificado de retencion en la fuente",
    "certificado de retención en la fuente",
    "certificado retencion ica",
    "certificado retención ica",
    "certificado de retencion de iva",
    "certificado de retención de iva",
]

# Se ejecuta 1x/día; ventana de 3 días como margen por si el cron se atrasa
# o falla un día (la deduplicación por message-id evita tickets repetidos).
_GMAIL_QUERY = "newer_than:3d (" + " OR ".join(f'"{kw}"' for kw in _KEYWORDS) + ")"


def _cargar_procesados() -> dict:
    try:
        if _PROCESADOS_PATH.exists():
            data = json.loads(_PROCESADOS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("mensajes", {})
                return data
    except Exception:
        pass
    return {"mensajes": {}}


def _guardar_procesados(data: dict) -> None:
    _PROCESADOS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PROCESADOS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _header(headers: list, nombre: str) -> str:
    return next((h["value"] for h in headers if h.get("name", "").lower() == nombre.lower()), "")


def _resolver_usuario_destino(nombre: str) -> dict | None:
    """
    Busca el usuario destino por nombre o username, priorizando cuentas
    activas. El panel puede tener cuentas duplicadas por el mismo nombre
    (ej. una inactiva de una migración vieja); no basta con la primera
    coincidencia por nombre como hace `buscar_usuario_por_nombre`.
    """
    from app.services.tickets_db import listar_usuarios

    nombre_q = nombre.strip().lower()
    if not nombre_q:
        return None

    candidatos = [
        u for u in listar_usuarios()
        if nombre_q in (u.get("nombre") or "").lower()
        or nombre_q in (u.get("username") or "").lower().lstrip("@")
    ]
    activos = [u for u in candidatos if u.get("activo")]
    if activos:
        return activos[0]
    return candidatos[0] if candidatos else None


def _texto_plano_del_mensaje(payload: dict) -> str:
    """Extrae el primer bloque text/plain del payload de Gmail (recursivo)."""

    def _decodificar(body: dict) -> str:
        try:
            return base64.urlsafe_b64decode(body.get("data", "")).decode("utf-8", errors="ignore")
        except Exception:
            return ""

    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return _decodificar(payload["body"])

    for part in payload.get("parts", []) or []:
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return _decodificar(part["body"])
        if "parts" in part:
            encontrado = _texto_plano_del_mensaje(part)
            if encontrado:
                return encontrado
    return ""


def revisar_correos_certificados_retencion(crear_solicitudes: bool = True) -> dict:
    """
    Busca correos recientes de proveedores solicitando certificados de
    retención y crea un ticket tipo 'solicitud' asignado a la persona
    encargada por cada correo nuevo (no procesado antes).
    """
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service, GmailAuthError
    from app.tools.sede_sur import _bot_usuario_id
    from app.services.tickets_db import crear_ticket

    reporte = {
        "ok": True,
        "revisados": 0,
        "nuevos": 0,
        "tickets_creados": [],
        "error": None,
    }

    try:
        service = get_gmail_service()
    except GmailAuthError as e:
        reporte["ok"] = False
        reporte["error"] = str(e)
        return reporte

    usuario_destino = _resolver_usuario_destino(_ASIGNADO_NOMBRE)
    if not usuario_destino:
        reporte["ok"] = False
        reporte["error"] = f"No encontré al usuario '{_ASIGNADO_NOMBRE}' en el panel de tickets."
        return reporte

    try:
        response = service.users().messages().list(
            userId="me", q=_GMAIL_QUERY, maxResults=50
        ).execute()
    except Exception as e:
        reporte["ok"] = False
        reporte["error"] = f"Error consultando Gmail: {e}"
        return reporte

    mensajes = response.get("messages", [])
    reporte["revisados"] = len(mensajes)
    if not mensajes:
        return reporte

    procesados = _cargar_procesados()
    bot_id = _bot_usuario_id()
    cambio = False

    for m in mensajes:
        msg_id = m["id"]
        if msg_id in procesados["mensajes"]:
            continue

        try:
            msg_data = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
        except Exception:
            continue

        headers = msg_data.get("payload", {}).get("headers", [])
        remitente = _header(headers, "From") or "remitente desconocido"
        asunto = _header(headers, "Subject") or "(sin asunto)"
        cuerpo = _texto_plano_del_mensaje(msg_data.get("payload", {})) or msg_data.get("snippet", "")
        extracto = " ".join(cuerpo.split())[:500]
        link = f"https://mail.google.com/mail/u/0/#inbox/{msg_id}"

        nombre_remitente = remitente.split("<")[0].strip().strip('"') or remitente
        titulo = f"Certificado de retención — {nombre_remitente[:80]}"
        descripcion = (
            f"Proveedor solicitó certificado de retención por correo.\n\n"
            f"De: {remitente}\n"
            f"Asunto: {asunto}\n\n"
            f"Extracto:\n{extracto}\n\n"
            f"Ver correo: {link}"
        )

        ticket_numero = None
        if crear_solicitudes:
            ticket, err = crear_ticket(
                data={
                    "titulo": titulo,
                    "descripcion": descripcion,
                    "categoria": _CATEGORIA_TICKET,
                    "prioridad": "media",
                    "asignado_a": usuario_destino["id"],
                    "tipo": "solicitud",
                },
                usuario_id=bot_id,
            )
            if err:
                continue
            ticket_numero = ticket["numero"]
            reporte["tickets_creados"].append(
                {"numero": ticket_numero, "asunto": asunto, "remitente": remitente}
            )

        procesados["mensajes"][msg_id] = {
            "asunto": asunto,
            "remitente": remitente,
            "timestamp": datetime.now().isoformat(),
            "ticket_numero": ticket_numero,
        }
        cambio = True
        reporte["nuevos"] += 1

    if cambio:
        _guardar_procesados(procesados)

    return reporte
