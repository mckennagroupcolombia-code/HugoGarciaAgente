"""
Bandeja ventas@mckennagroup.co vía Gmail API con delegación de dominio
(mismo service account que ya impersona correos @mckennagroup.co para Drive
en app/services/ficha_tecnica.py, con scopes de Gmail añadidos).
"""

from __future__ import annotations

import base64
import os
import re
from email.mime.text import MIMEText
from email.utils import parseaddr
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]

VENTAS_EMAIL = os.getenv("VENTAS_EMAIL_IMPERSONATE", "ventas@mckennagroup.co").strip()

CREDS_PATH = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    str(REPO / "mi-agente-ubuntu-9043f67d9755.json"),
)

_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]


def _mensaje_error_gmail(exc: Exception) -> str:
    txt = str(exc)
    if "unauthorized_client" in txt or "Not Authorized" in txt or "403" in txt:
        return (
            "El service account no está autorizado para impersonar "
            f"{VENTAS_EMAIL} vía Gmail. En admin.google.com → Seguridad → "
            "Controles de API → Delegación en todo el dominio, agregue el "
            "Client ID de la cuenta de servicio con los scopes: "
            "gmail.readonly, gmail.send, gmail.modify."
        )
    if "404" in txt or "not found" in txt.lower():
        return (
            f"No se encontró el buzón {VENTAS_EMAIL} en el Workspace. "
            "Confirme que existe y tiene licencia asignada."
        )
    return f"Error Gmail ventas@: {txt}"


def _gmail_ventas_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    if not os.path.exists(CREDS_PATH):
        raise FileNotFoundError(f"Credenciales no encontradas: {CREDS_PATH}")
    creds = service_account.Credentials.from_service_account_file(
        CREDS_PATH, scopes=_SCOPES
    )
    creds = creds.with_subject(VENTAS_EMAIL)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _header(headers: list[dict[str, str]], nombre: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == nombre.lower():
            return h.get("value", "")
    return ""


def _decodificar_parte(data: str) -> str:
    return base64.urlsafe_b64decode(data.encode("utf-8") + b"===").decode(
        "utf-8", errors="replace"
    )


def _extraer_cuerpo(payload: dict[str, Any]) -> str:
    """Recorre payload.parts recursivamente, prefiere text/plain sobre text/html."""
    if not payload:
        return ""

    def _buscar(parte: dict[str, Any], mime_objetivo: str) -> str | None:
        if parte.get("mimeType") == mime_objetivo:
            data = parte.get("body", {}).get("data")
            if data:
                return _decodificar_parte(data)
        for sub in parte.get("parts", []) or []:
            encontrado = _buscar(sub, mime_objetivo)
            if encontrado:
                return encontrado
        return None

    plano = _buscar(payload, "text/plain")
    if plano:
        return plano
    html = _buscar(payload, "text/html")
    if html:
        return re.sub(r"<[^>]+>", " ", html).strip()
    data = payload.get("body", {}).get("data")
    if data:
        return _decodificar_parte(data)
    return ""


def listar_correos_ventas(
    max_results: int = 25, solo_no_leidos: bool = True
) -> list[dict[str, Any]]:
    svc = _gmail_ventas_service()
    label_ids = ["INBOX"] + (["UNREAD"] if solo_no_leidos else [])
    resp = (
        svc.users()
        .messages()
        .list(userId="me", labelIds=label_ids, maxResults=max_results)
        .execute()
    )
    mensajes = resp.get("messages", [])
    correos: list[dict[str, Any]] = []
    for m in mensajes:
        detalle = (
            svc.users()
            .messages()
            .get(
                userId="me",
                id=m["id"],
                format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            )
            .execute()
        )
        headers = detalle.get("payload", {}).get("headers", [])
        etiquetas = detalle.get("labelIds", [])
        correos.append(
            {
                "id": detalle["id"],
                "threadId": detalle.get("threadId"),
                "de": _header(headers, "From"),
                "asunto": _header(headers, "Subject"),
                "fecha": _header(headers, "Date"),
                "snippet": detalle.get("snippet", ""),
                "no_leido": "UNREAD" in etiquetas,
            }
        )
    return correos


def obtener_correo_ventas(message_id: str) -> dict[str, Any]:
    svc = _gmail_ventas_service()
    detalle = (
        svc.users()
        .messages()
        .get(userId="me", id=message_id, format="full")
        .execute()
    )
    headers = detalle.get("payload", {}).get("headers", [])
    return {
        "id": detalle["id"],
        "threadId": detalle.get("threadId"),
        "de": _header(headers, "From"),
        "asunto": _header(headers, "Subject"),
        "fecha": _header(headers, "Date"),
        "message_id_header": _header(headers, "Message-Id") or _header(headers, "Message-ID"),
        "cuerpo": _extraer_cuerpo(detalle.get("payload", {})),
        "no_leido": "UNREAD" in detalle.get("labelIds", []),
    }


def responder_correo_ventas(message_id: str, texto: str) -> dict[str, Any]:
    svc = _gmail_ventas_service()
    original = obtener_correo_ventas(message_id)

    remitente = parseaddr(original["de"])[1] or original["de"]
    asunto = original["asunto"] or ""
    if not asunto.lower().startswith("re:"):
        asunto = f"Re: {asunto}"

    msg = MIMEText(texto)
    msg["To"] = remitente
    msg["From"] = VENTAS_EMAIL
    msg["Subject"] = asunto
    if original["message_id_header"]:
        msg["In-Reply-To"] = original["message_id_header"]
        msg["References"] = original["message_id_header"]

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    body: dict[str, Any] = {"raw": raw}
    if original.get("threadId"):
        body["threadId"] = original["threadId"]

    enviado = svc.users().messages().send(userId="me", body=body).execute()

    svc.users().messages().modify(
        userId="me", id=message_id, body={"removeLabelIds": ["UNREAD"]}
    ).execute()

    return {"enviado_id": enviado.get("id"), "para": remitente, "asunto": asunto}
