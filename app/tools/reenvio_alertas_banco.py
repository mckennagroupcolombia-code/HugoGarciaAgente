"""
Copia de las alertas de Bancolombia (mckenna.group.colombia@gmail.com) a la asesora comercial.

La asesora no entra al panel ni al banco, pero necesita saber cuándo un cliente
pagó. Bancolombia manda un correo por cada abono ("Recibiste $… por QR de …");
este módulo le reenvía una copia de esos correos.

Qué se reenvía, a propósito:
  - ABONOS ("Recibiste …") — siempre.
  - Pagos salientes, transacciones preparadas/aprobadas — solo con
    REENVIO_BANCO_INCLUIR_SALIDAS=1. Por defecto no: incluyen la quincena de
    quienes prestan servicios y el detalle de pagos a proveedores.
  - Códigos OTP, cambios de clave, inicios de sesión — NUNCA, ni con bandera.
    Al mismo buzón llegan los OTP de Sucursal Negocios; una copia en otro
    correo es una segunda puerta para autorizar transacciones.

Dedupe: la etiqueta de Gmail `ETIQUETA` marca lo ya reenviado. Además solo se
miran correos posteriores a `desde_ms` (app/data/reenvio_alertas_banco.json),
fijado en la primera corrida, para no reenviar el histórico.

Sin LLM. Gmail vía el token OAuth de siempre (app/tools/token_gmail.json,
scope gmail.modify, que incluye enviar).
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
import unicodedata
from email import message_from_bytes, policy
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
ESTADO_PATH = REPO / "app" / "data" / "reenvio_alertas_banco.json"

DESTINO_DEFAULT = "23jenniffergarcia@gmail.com"
ETIQUETA = "Bancolombia/Reenviado asesora"

# Tres variantes de remitente vistas en el buzón (an., ayn. y bancolombia.com.co).
QUERY_REMITENTES = (
    "from:(alertasynotificaciones@an.notificacionesbancolombia.com OR "
    "alertasynotificaciones@ayn.notificacionesbancolombia.com OR "
    "alertasynotificaciones@bancolombia.com.co)"
)

_BLOQUEO = re.compile(
    r"\botp\b|codigo|clave|contrasena|inicio de sesion|ingresaste|"
    r"dispositivo|token|no lo compartas|seguridad hola",
)
_ABONO = re.compile(r"\brecibiste\b|te enviaron|te consignaron|abono")
_SALIDA = re.compile(r"enviaste|preparaste|se aprobo|pendiente de aprobacion|pagaste|compraste|retiraste")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).lower()


def clasificar(texto: str) -> str:
    """'abono' | 'salida' | 'bloqueado' | 'otro'. El bloqueo gana siempre."""
    t = _norm(texto)
    if _BLOQUEO.search(t):
        return "bloqueado"
    if _ABONO.search(t):
        return "abono"
    if _SALIDA.search(t):
        return "salida"
    return "otro"


def activo() -> bool:
    return os.getenv("REENVIO_BANCO_ACTIVO", "1").strip() != "0"


def destino() -> str:
    return os.getenv("REENVIO_BANCO_DESTINO", DESTINO_DEFAULT).strip()


def _tipos_permitidos() -> set[str]:
    tipos = {"abono"}
    if os.getenv("REENVIO_BANCO_INCLUIR_SALIDAS", "0").strip() == "1":
        tipos |= {"salida", "otro"}
    return tipos


def _cargar_estado() -> dict[str, Any]:
    try:
        return json.loads(ESTADO_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _guardar_estado(estado: dict[str, Any]) -> None:
    ESTADO_PATH.write_text(json.dumps(estado, ensure_ascii=False, indent=2), encoding="utf-8")


def _id_etiqueta(service) -> str:
    for lab in service.users().labels().list(userId="me").execute().get("labels", []):
        if lab.get("name") == ETIQUETA:
            return lab["id"]
    creada = service.users().labels().create(
        userId="me",
        body={"name": ETIQUETA, "labelListVisibility": "labelShow", "messageListVisibility": "show"},
    ).execute()
    return creada["id"]


def _cuerpos(msg) -> tuple[str, str]:
    """(texto, html) del correo original."""
    texto = html = ""
    for parte in msg.walk():
        if parte.is_multipart() or parte.get_content_disposition() == "attachment":
            continue
        ctype = parte.get_content_type()
        try:
            contenido = parte.get_content()
        except (LookupError, KeyError):
            contenido = (parte.get_payload(decode=True) or b"").decode("utf-8", "replace")
        if ctype == "text/plain" and not texto:
            texto = contenido
        elif ctype == "text/html" and not html:
            html = contenido
    return texto, html


def _armar_copia(original, para: str) -> MIMEMultipart:
    texto, html = _cuerpos(original)
    asunto = str(original.get("Subject", "Alertas y Notificaciones"))
    cabecera = (
        "---------- Copia automática de alerta Bancolombia ----------\n"
        f"De: {original.get('From', '')}\n"
        f"Fecha: {original.get('Date', '')}\n"
        f"Asunto: {asunto}\n\n"
    )
    salida = MIMEMultipart("alternative")
    salida["To"] = para
    salida["Subject"] = f"Fwd: {asunto}"
    if not texto and html:
        texto = re.sub(r"<[^>]+>", " ", html)
    salida.attach(MIMEText(cabecera + (texto or ""), "plain", "utf-8"))
    if html:
        cab_html = "<div style='color:#555;font-size:12px'>" + escape(cabecera).replace("\n", "<br>") + "</div><hr>"
        salida.attach(MIMEText(cab_html + html, "html", "utf-8"))
    return salida


def reenviar_pendientes(simular: bool = False, max_por_corrida: int = 30) -> dict[str, Any]:
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    res: dict[str, Any] = {"activo": activo(), "destino": destino(), "enviados": 0,
                           "omitidos": 0, "detalle": []}
    if not activo() and not simular:
        return res

    estado = _cargar_estado()
    ahora_ms = int(time.time() * 1000)
    if "desde_ms" not in estado:
        # Primera corrida: arranca desde ya, sin reenviar el histórico.
        estado["desde_ms"] = ahora_ms
        if not simular:
            _guardar_estado(estado)
    desde_ms = int(estado["desde_ms"])

    service = get_gmail_service()
    etiqueta_id = _id_etiqueta(service) if not simular else ""
    permitidos = _tipos_permitidos()

    # Gmail filtra por día (after: en segundos); el corte exacto se hace con internalDate.
    q = f'{QUERY_REMITENTES} after:{desde_ms // 1000 - 60} -label:"{ETIQUETA}"'
    resp = service.users().messages().list(userId="me", q=q, maxResults=100).execute()
    ids = [m["id"] for m in resp.get("messages", [])]

    for mid in reversed(ids):  # del más viejo al más nuevo
        if res["enviados"] >= max_por_corrida:
            break
        raw = service.users().messages().get(userId="me", id=mid, format="raw").execute()
        if int(raw.get("internalDate", 0)) < desde_ms:
            continue
        original = message_from_bytes(base64.urlsafe_b64decode(raw["raw"]), policy=policy.default)
        # Solo el inicio del mensaje (snippet de Gmail): el pie legal de TODAS las
        # alertas menciona "seguridad", "clave", etc. y lo bloquearía todo.
        tipo = clasificar(raw.get("snippet", ""))
        item = {"id": mid, "tipo": tipo, "resumen": _norm(raw.get("snippet", ""))[:110]}

        if tipo not in permitidos:
            res["omitidos"] += 1
            item["accion"] = "omitido"
        elif simular:
            item["accion"] = "enviaria"
        else:
            copia = _armar_copia(original, destino())
            cuerpo = base64.urlsafe_b64encode(copia.as_bytes()).decode()
            service.users().messages().send(userId="me", body={"raw": cuerpo}).execute()
            res["enviados"] += 1
            item["accion"] = "enviado"

        # Se etiqueta también lo omitido para no reclasificarlo en cada corrida.
        if not simular:
            service.users().messages().modify(
                userId="me", id=mid, body={"addLabelIds": [etiqueta_id]}
            ).execute()
        res["detalle"].append(item)

    if not simular and res["enviados"]:
        estado["ultimo_envio"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        estado["total_enviados"] = int(estado.get("total_enviados", 0)) + res["enviados"]
        _guardar_estado(estado)
    return res
