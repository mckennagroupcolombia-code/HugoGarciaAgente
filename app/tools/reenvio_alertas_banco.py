"""
Aviso por WhatsApp de las alertas de Bancolombia (mckenna.group.colombia@gmail.com) a la asesora comercial.

La asesora no entra al panel ni al banco, pero necesita saber cuándo un cliente
pagó. Bancolombia manda un correo por cada abono ("Recibiste $… por QR de …");
este módulo le avisa por DOS canales (decisión del 22-sep-2026):
  - copia del correo a REENVIO_BANCO_DESTINO (default 23jenniffergarcia@gmail.com);
  - la frase del abono por WhatsApp a REENVIO_BANCO_WA (default +57 318 243 2463),
    desde la cuenta supervisora (:3001) con el puente principal (:3000) de respaldo.

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

Primero sale el correo y se etiqueta; si el WhatsApp falla, el aviso queda en
`wa_pendientes` del estado y se reintenta en las corridas siguientes (hasta
WA_MAX_INTENTOS), sin volver a mandar el correo.

Sin LLM. Gmail vía el token OAuth de siempre (app/tools/token_gmail.json,
scope gmail.modify).
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
from html import escape, unescape
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
ESTADO_PATH = REPO / "app" / "data" / "reenvio_alertas_banco.json"

DESTINO_DEFAULT = "23jenniffergarcia@gmail.com"
WA_DEFAULT = "573182432463"
WA_MAX_INTENTOS = 12  # ~1 h con el cron cada 5 min
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
    """Correo de la asesora (copia del correo original)."""
    return os.getenv("REENVIO_BANCO_DESTINO", "").strip() or DESTINO_DEFAULT


def destino_wa() -> str:
    """Número de WhatsApp de la asesora (solo dígitos, con indicativo)."""
    crudo = os.getenv("REENVIO_BANCO_WA", "").strip() or WA_DEFAULT
    return re.sub(r"\D", "", crudo.split("@")[0])


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


_INICIO_AVISO = re.compile(r"(Recibiste|Te enviaron|Te consignaron|Enviaste|Pagaste|Compraste|Retiraste)\b", re.I)
_FIN_AVISO = re.compile(r"\s*(¿\s*(Dudas|Tienes)|Dudas\?|Llama al|Si tienes (alguna )?(duda|inquietud))", re.I)


def extraer_aviso(texto: str) -> str:
    """La frase del movimiento ("Recibiste $68,000.00 por QR de … a las 12:26."), sin saludo ni pie."""
    t = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", texto or ""))).strip()
    m = _INICIO_AVISO.search(t)
    if not m:
        return ""
    frase = t[m.start():]
    fin = _FIN_AVISO.search(frase)
    if fin:
        frase = frase[: fin.start()]
    return frase[:400].strip()


def _mensaje_whatsapp(original, snippet: str) -> str:
    texto, html = _cuerpos(original)
    aviso = extraer_aviso(texto) or extraer_aviso(html) or extraer_aviso(snippet)
    if not aviso:
        aviso = re.sub(r"\s+", " ", unescape(snippet or "")).strip()
    return f"🏦 *Bancolombia*\n{aviso}"


def _destino_wa(numero: str) -> str:
    """El puente principal prefiere el @lid: WhatsApp Web rechaza a veces @c.us ("No LID for user")."""
    jid = f"{numero}@c.us"
    try:
        from app.services.wa_jid import jids_relacionados

        return next((j for j in jids_relacionados(jid) if j.endswith("@lid")), jid)
    except Exception:
        return jid


def enviar_whatsapp(texto: str, numero: str) -> bool:
    """Por la cuenta supervisora (:3001), como las alertas de ventas; si no, por el puente principal."""
    import requests

    base = os.getenv("WHATSAPP_SUPERVISOR_URL", "http://127.0.0.1:3001").rstrip("/")
    token = os.getenv("WHATSAPP_SUPERVISOR_TOKEN", "").strip()
    try:
        r = requests.post(
            f"{base}/enviar",
            json={"numero": numero, "mensaje": texto},
            headers={"X-Bridge-Token": token} if token else {},
            timeout=60,
        )
        if r.ok and (r.json() or {}).get("status") == "success":
            return True
    except Exception as e:
        print(f"reenvio_alertas_banco: supervisor no envió: {e}")
    from app.utils import enviar_whatsapp_reporte

    return bool(enviar_whatsapp_reporte(texto, numero_destino=_destino_wa(numero)))


def reenviar_pendientes(simular: bool = False, max_por_corrida: int = 30) -> dict[str, Any]:
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    res: dict[str, Any] = {"activo": activo(), "destino": destino(), "destino_wa": destino_wa(),
                           "enviados": 0, "whatsapp": 0, "omitidos": 0, "detalle": []}
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

    # Avisos de WhatsApp que fallaron en corridas anteriores (el correo ya salió).
    pendientes_wa: list[dict[str, Any]] = [] if simular else list(estado.get("wa_pendientes", []))
    estado_wa_cambio = bool(pendientes_wa)
    quedan: list[dict[str, Any]] = []
    for p in pendientes_wa:
        if enviar_whatsapp(p["mensaje"], destino_wa()):
            res["whatsapp"] += 1
        elif int(p.get("intentos", 0)) + 1 < WA_MAX_INTENTOS:
            quedan.append({**p, "intentos": int(p.get("intentos", 0)) + 1})
        else:
            print(f"reenvio_alertas_banco: se descarta el WhatsApp de {p.get('id')} tras {WA_MAX_INTENTOS} intentos")

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
        else:
            mensaje = _mensaje_whatsapp(original, raw.get("snippet", ""))
            item["mensaje"] = mensaje
            if simular:
                item["accion"] = "enviaria"
            else:
                copia = _armar_copia(original, destino())
                cuerpo = base64.urlsafe_b64encode(copia.as_bytes()).decode()
                service.users().messages().send(userId="me", body={"raw": cuerpo}).execute()
                res["enviados"] += 1
                item["accion"] = "enviado"
                if enviar_whatsapp(mensaje, destino_wa()):
                    res["whatsapp"] += 1
                else:
                    item["accion"] = "enviado_sin_whatsapp"
                    res["fallidos"] = res.get("fallidos", 0) + 1
                    quedan.append({"id": mid, "mensaje": mensaje, "intentos": 1})
                    estado_wa_cambio = True

        # Se etiqueta también lo omitido para no reclasificarlo en cada corrida.
        if not simular:
            service.users().messages().modify(
                userId="me", id=mid, body={"addLabelIds": [etiqueta_id]}
            ).execute()
        res["detalle"].append(item)

    if not simular and estado_wa_cambio:
        estado["wa_pendientes"] = quedan
        _guardar_estado(estado)
    if not simular and res["enviados"]:
        estado["ultimo_envio"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        estado["total_enviados"] = int(estado.get("total_enviados", 0)) + res["enviados"]
        _guardar_estado(estado)
    return res
