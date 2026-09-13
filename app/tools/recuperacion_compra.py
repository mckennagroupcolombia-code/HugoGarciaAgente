"""
Recuperación de compras que no se terminaron (sep-2026).

Dos piezas sobre `PAGINA_WEB/site/data/orders.db`:

1. **Correos de recuperación.** Un pedido web nace `pending` al ir a MercadoPago;
   si el pago no llega, a las 24 h pasa a `no_realizado` (o a `declined` si MP lo
   rechazó). A esas personas, que ya dejaron su correo en el checkout, se les
   escribe como máximo dos veces:

     recordatorio   ≥ 1 h después de crear el pedido, con el carrito y un enlace
                    que lo vuelve a armar tal cual (`/checkout/reanudar/<token>`)
     ultimo         ≥ 48 h después, un solo aviso final con ayuda por WhatsApp

   Nunca se escribe si el cliente ya compró después (cualquier pedido `approved`
   de ese correo posterior al abandonado), si pidió no recibir correos
   (`/correos/baja/<token>`), si ya recibió un correo en las últimas 24 h o si
   el pedido tiene más de `VENTANA_DIAS` días. Todo envío queda en
   `recuperacion_envios` y el cron es idempotente.

   Base legal (Ley 1581/2012): el correo se recoge en el checkout para gestionar
   la compra; cada mensaje dice por qué llega y trae enlace de baja de un clic.

2. **Diagnóstico del abandono** (`diagnostico_abandono`): embudo por estado,
   motivo de rechazo real de MercadoPago (`payment_status_detail`, que antes no
   se guardaba), medio de pago, ticket, hora, ciudad, productos más abandonados,
   eventos del navegador (carrito → checkout → clic en pagar → respuesta, con
   dispositivo) y resultado de los correos. Termina en una lista de hipótesis
   con la evidencia que las sostiene, para corregir causas y no síntomas.
"""

from __future__ import annotations

import hashlib
import hmac
import html as _html
import json
import logging
import os
import re
import secrets
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

log = logging.getLogger("recuperacion_compra")

REPO = Path(__file__).resolve().parents[2]
ORDERS_DB = REPO / "PAGINA_WEB" / "site" / "data" / "orders.db"
SITE_URL = (os.getenv("SITE_URL") or "https://mckennagroup.co").rstrip("/")
WA_NUMBER = os.getenv("WA_NUMBER_WEB") or "573195183596"

VENTANA_DIAS = int(os.getenv("RECUPERACION_COMPRA_VENTANA_DIAS", "14"))
MAX_POR_CORRIDA = int(os.getenv("RECUPERACION_COMPRA_MAX_POR_CORRIDA", "20"))
ACTIVO = (os.getenv("RECUPERACION_COMPRA_ACTIVO", "1").strip() or "1") != "0"

ETAPAS = (
    # (nombre, horas mínimas desde el pedido)
    ("recordatorio", 1.0),
    ("ultimo", 48.0),
)

# Motivos de MercadoPago (status_detail) en palabras que el cliente y el equipo entienden.
MOTIVOS_MP = {
    "cc_rejected_insufficient_amount": "fondos insuficientes en la tarjeta",
    "cc_rejected_bad_filled_security_code": "código de seguridad mal digitado",
    "cc_rejected_bad_filled_date": "fecha de vencimiento mal digitada",
    "cc_rejected_bad_filled_card_number": "número de tarjeta mal digitado",
    "cc_rejected_bad_filled_other": "un dato de la tarjeta mal digitado",
    "cc_rejected_call_for_authorize": "el banco pide autorizar el pago por teléfono",
    "cc_rejected_card_disabled": "tarjeta inactiva o bloqueada",
    "cc_rejected_high_risk": "rechazo por prevención de fraude de MercadoPago",
    "cc_rejected_max_attempts": "se superó el número de intentos",
    "cc_rejected_other_reason": "rechazo general del banco",
    "cc_rejected_duplicated_payment": "pago duplicado",
    "cc_rejected_card_error": "error de la tarjeta",
    "cc_rejected_blacklist": "tarjeta en lista de bloqueo de MercadoPago",
    "pending_contingency": "MercadoPago quedó procesando el pago",
    "pending_review_manual": "MercadoPago revisa el pago manualmente",
    "pending_waiting_transfer": "esperando la transferencia (PSE)",
    "pending_waiting_payment": "esperando el pago en efectivo",
    "expired": "el pago venció sin completarse",
}


# ── base de datos ───────────────────────────────────────────────────────────

def _con(path: Path | None = None) -> sqlite3.Connection:
    con = sqlite3.connect(str(path or ORDERS_DB), timeout=30)
    con.row_factory = sqlite3.Row
    return con


def migrar(path: Path | None = None) -> None:
    """Crea lo que este módulo necesita; idempotente y seguro de llamar siempre."""
    con = _con(path)
    try:
        con.execute(
            """CREATE TABLE IF NOT EXISTS recuperacion_envios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reference TEXT NOT NULL,
                email TEXT NOT NULL,
                etapa TEXT NOT NULL,
                token TEXT NOT NULL,
                sent_at TEXT NOT NULL,
                abierto_at TEXT,
                reanudado_at TEXT,
                UNIQUE(reference, etapa)
            )"""
        )
        con.execute(
            """CREATE TABLE IF NOT EXISTS correo_bajas (
                email TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                motivo TEXT
            )"""
        )
        cols = {r[1] for r in con.execute("PRAGMA table_info(orders)")}
        if "payment_status_detail" not in cols:
            con.execute("ALTER TABLE orders ADD COLUMN payment_status_detail TEXT")
        con.commit()
    finally:
        con.close()


def _ahora() -> datetime:
    return datetime.now()


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


# ── tokens ──────────────────────────────────────────────────────────────────

def _secreto() -> bytes:
    return (os.getenv("FLASK_SECRET_KEY") or "mckg-dev-only-unsafe-set-FLASK_SECRET_KEY").encode("utf-8")


def token_baja(email: str) -> str:
    """Token de baja: HMAC del correo, así el enlace no expira ni requiere tabla."""
    e = (email or "").strip().lower().encode("utf-8")
    return hmac.new(_secreto(), b"baja:" + e, hashlib.sha256).hexdigest()[:32]


def baja_valida(email: str, token: str) -> bool:
    return bool(email and token) and hmac.compare_digest(token_baja(email), token)


def dar_de_baja(email: str, motivo: str = "enlace_correo", path: Path | None = None) -> bool:
    e = (email or "").strip().lower()
    if not e:
        return False
    con = _con(path)
    try:
        con.execute("INSERT OR IGNORE INTO correo_bajas (email, created_at, motivo) VALUES (?,?,?)", (e, _iso(_ahora()), motivo))
        con.commit()
        return True
    finally:
        con.close()


def esta_de_baja(email: str, path: Path | None = None) -> bool:
    con = _con(path)
    try:
        return con.execute("SELECT 1 FROM correo_bajas WHERE email = ?", ((email or "").strip().lower(),)).fetchone() is not None
    finally:
        con.close()


# ── candidatos ──────────────────────────────────────────────────────────────

def _items(items_json: str | None) -> list[dict]:
    try:
        data = json.loads(items_json or "{}")
    except Exception:
        return []
    items = data.get("items") if isinstance(data, dict) else data
    return [i for i in (items or []) if isinstance(i, dict)]


def candidatos(path: Path | None = None, ahora: datetime | None = None) -> list[dict]:
    """Pedidos sin pagar a los que corresponde un correo ahora mismo, con la etapa
    que toca. Un pedido aparece a lo sumo una vez por corrida (la etapa más
    avanzada que ya venció y que no se ha enviado)."""
    ahora = ahora or _ahora()
    desde = _iso(ahora - timedelta(days=VENTANA_DIAS))
    con = _con(path)
    try:
        pedidos = con.execute(
            """SELECT reference, buyer_name, buyer_email, items_json, total, status, created_at, payment_status_detail
               FROM orders
               WHERE status IN ('pending', 'no_realizado', 'declined')
                 AND buyer_email != '' AND buyer_email IS NOT NULL
                 AND created_at >= ?
               ORDER BY created_at ASC""",
            (desde,),
        ).fetchall()
        enviados = defaultdict(set)
        ultimo_envio_por_email: dict[str, datetime] = {}
        for r in con.execute("SELECT reference, email, etapa, sent_at FROM recuperacion_envios"):
            enviados[r["reference"]].add(r["etapa"])
            try:
                dt = datetime.fromisoformat(r["sent_at"])
                e = r["email"].lower()
                if e not in ultimo_envio_por_email or dt > ultimo_envio_por_email[e]:
                    ultimo_envio_por_email[e] = dt
            except Exception:
                pass
        bajas = {r["email"] for r in con.execute("SELECT email FROM correo_bajas")}
        compras = con.execute(
            "SELECT lower(buyer_email) AS e, created_at FROM orders WHERE status = 'approved' AND buyer_email != ''"
        ).fetchall()
    finally:
        con.close()
    compro_despues: dict[str, list[str]] = defaultdict(list)
    for r in compras:
        compro_despues[r["e"]].append(r["created_at"])

    out: list[dict] = []
    for p in pedidos:
        email = (p["buyer_email"] or "").strip().lower()
        if not email or "@" not in email or email in bajas:
            continue
        if any(c > p["created_at"] for c in compro_despues.get(email, [])):
            continue  # ya compró después: no molestar
        if not _items(p["items_json"]):
            continue
        try:
            creado = datetime.fromisoformat(p["created_at"])
        except Exception:
            continue
        horas = (ahora - creado).total_seconds() / 3600
        # etapa más avanzada vencida y pendiente
        etapa = None
        for nombre, minimo in ETAPAS:
            if horas >= minimo and nombre not in enviados[p["reference"]]:
                etapa = nombre
        if not etapa:
            continue
        # el recordatorio ya no tiene sentido si nunca se envió y ya tocaría el último
        if etapa == "ultimo" and "recordatorio" not in enviados[p["reference"]] and horas >= ETAPAS[1][1]:
            etapa = "ultimo"
        ultimo = ultimo_envio_por_email.get(email)
        if ultimo and (ahora - ultimo) < timedelta(hours=24):
            continue  # máximo un correo por persona y día, sin importar cuántos pedidos dejó
        if any(o["email"] == email for o in out):
            continue  # y tampoco dos en la misma corrida (dejó varios pedidos seguidos)
        out.append({
            "reference": p["reference"], "email": email, "nombre": (p["buyer_name"] or "").strip(),
            "items": _items(p["items_json"]), "total": float(p["total"] or 0), "status": p["status"],
            "created_at": p["created_at"], "horas": round(horas, 1), "etapa": etapa,
            "status_detail": p["payment_status_detail"] or "",
        })
    return out


# ── correo ──────────────────────────────────────────────────────────────────

def _cop(n: float) -> str:
    return "$" + f"{int(round(n)):,}".replace(",", ".")


def _nombre_corto(nombre: str) -> str:
    return (nombre or "").strip().split(" ")[0].title() if nombre else ""


def render_correo(c: dict, token: str) -> tuple[str, str, str]:
    """(asunto, texto plano, html) para un candidato y su token de reanudación."""
    from app.tools import correo_marca

    nombre = _nombre_corto(c["nombre"])
    saludo = f"Hola {nombre}," if nombre else "Hola,"
    url_reanudar = f"{SITE_URL}/checkout/reanudar/{token}"
    url_baja = f"{SITE_URL}/correos/baja/{token_baja(c['email'])}?e={_html.escape(c['email'])}"
    url_wa = f"https://wa.me/{WA_NUMBER}?text=" + _html.escape(
        f"Hola, intenté comprar en la web (pedido {c['reference']}) y no pude terminar el pago"
    ).replace(" ", "%20")
    rechazado = c["status"] == "declined"
    motivo = MOTIVOS_MP.get(c.get("status_detail") or "", "")

    filas = "".join(
        f'<tr><td style="padding:8px 0;border-bottom:1px solid #e6eef0;font-family:Montserrat,Arial,sans-serif;font-size:14px;color:#022d33;">'
        f'{_html.escape(str(i.get("name") or ""))}<br><span style="color:#6c8e93;font-size:12px;">x{int(i.get("qty") or 1)}</span></td>'
        f'<td align="right" style="padding:8px 0;border-bottom:1px solid #e6eef0;font-family:Montserrat,Arial,sans-serif;font-size:14px;color:#0c6069;font-weight:700;white-space:nowrap;">'
        f'{_cop(float(i.get("price") or 0) * int(i.get("qty") or 1))}</td></tr>'
        for i in c["items"]
    )
    lista_txt = "\n".join(f"  - {i.get('name')} x{int(i.get('qty') or 1)}  {_cop(float(i.get('price') or 0) * int(i.get('qty') or 1))}" for i in c["items"])

    if c["etapa"] == "recordatorio":
        if rechazado:
            asunto = "Tu pago no pasó: así lo puedes completar"
            intro = ("MercadoPago rechazó el pago de tu pedido" + (f" ({motivo})" if motivo else "") +
                     ". Es más común de lo que parece y casi siempre se resuelve intentando con otro medio: "
                     "PSE, Nequi, otra tarjeta o pago en efectivo en Efecty.")
        else:
            asunto = "Dejaste tu pedido a un paso: te lo guardamos"
            intro = ("Empezaste una compra en mckennagroup.co y el pago no llegó a completarse. "
                     "Te guardamos el carrito tal como lo dejaste; con un clic vuelves justo al pago.")
        cta = "Terminar mi compra"
        cierre = "Si algo falló en la página o tienes una duda sobre un producto, respóndenos este correo o escríbenos por WhatsApp: lo resolvemos contigo."
    else:
        asunto = "Último aviso: tu carrito en McKenna sigue disponible"
        intro = ("Hace un par de días dejaste estos productos sin pagar. Es el último correo que te enviamos "
                 "por este pedido: si todavía los necesitas, el carrito sigue armado.")
        cta = "Retomar el pedido"
        cierre = "¿Te frenó el costo del envío, el medio de pago o una duda técnica? Cuéntanos por WhatsApp y buscamos la forma."

    inner = f"""
<p style="font-family:Montserrat,Arial,sans-serif;font-size:16px;color:#022d33;margin:0 0 14px;">{saludo}</p>
<p style="font-family:Montserrat,Arial,sans-serif;font-size:15px;line-height:1.7;color:#2f5f66;margin:0 0 18px;">{_html.escape(intro)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 6px;">{filas}
<tr><td style="padding:12px 0 0;font-family:Montserrat,Arial,sans-serif;font-size:13px;color:#6c8e93;">Total del pedido {_html.escape(c['reference'])}</td>
<td align="right" style="padding:12px 0 0;font-family:Montserrat,Arial,sans-serif;font-size:18px;color:#022d33;font-weight:800;">{_cop(c['total'])}</td></tr></table>
<p style="margin:26px 0 8px;text-align:center;"><a href="{url_reanudar}" style="display:inline-block;background:#0c6069;color:#ffffff;font-family:Montserrat,Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:14px 28px;border-radius:999px;text-decoration:none;">{cta}</a></p>
<p style="text-align:center;margin:0 0 22px;"><a href="{url_wa}" style="font-family:Montserrat,Arial,sans-serif;font-size:13px;color:#0c6069;font-weight:700;text-decoration:none;">Prefiero que me ayuden por WhatsApp</a></p>
<p style="font-family:Montserrat,Arial,sans-serif;font-size:14px;line-height:1.7;color:#2f5f66;margin:0 0 18px;">{_html.escape(cierre)}</p>
<p style="font-family:Montserrat,Arial,sans-serif;font-size:11px;line-height:1.6;color:#8aa4a8;margin:22px 0 0;border-top:1px solid #e6eef0;padding-top:12px;">
Recibes este correo porque iniciaste una compra en mckennagroup.co con esta dirección. Es un recordatorio sobre ese pedido y no volverás a recibirlo una vez lo completes.
<a href="{url_baja}" style="color:#8aa4a8;">No quiero recibir estos correos</a>.</p>
{correo_marca.firma_html()}
"""
    html = correo_marca.marco(preheader=intro[:110], inner_html=inner)
    texto = (
        f"{saludo}\n\n{intro}\n\nTu pedido {c['reference']}:\n{lista_txt}\n  Total: {_cop(c['total'])}\n\n"
        f"{cta}: {url_reanudar}\nAyuda por WhatsApp: https://wa.me/{WA_NUMBER}\n\n{cierre}\n\n"
        f"Recibes este correo porque iniciaste una compra en mckennagroup.co con esta dirección.\n"
        f"Para no recibir más: {url_baja}\n\n{correo_marca.firma_texto()}"
    )
    return asunto, texto, html


def enviar_pendientes(*, simular: bool = False, path: Path | None = None, ahora: datetime | None = None) -> dict:
    """Manda los correos que tocan. Devuelve un resumen para el cron y el panel."""
    migrar(path)
    if not ACTIVO and not simular:
        return {"activo": False, "enviados": 0, "candidatos": 0, "detalle": []}
    lista = candidatos(path, ahora)[:MAX_POR_CORRIDA]
    detalle: list[dict] = []
    enviados = 0
    for c in lista:
        token = secrets.token_urlsafe(24)
        asunto, texto, html = render_correo(c, token)
        ok = True
        if not simular:
            from app.tools.web_pedidos import _send_smtp

            ok = _send_smtp(c["email"], asunto, texto, html)
        # En simulación no se registra nada: si quedara escrito, el envío real
        # creería que esa etapa ya salió y el cliente nunca recibiría el correo.
        if ok and not simular:
            con = _con(path)
            try:
                con.execute(
                    "INSERT OR IGNORE INTO recuperacion_envios (reference, email, etapa, token, sent_at) VALUES (?,?,?,?,?)",
                    (c["reference"], c["email"], c["etapa"], token, _iso(ahora or _ahora())),
                )
                con.commit()
            finally:
                con.close()
        if ok:
            enviados += 1  # en simulación cuenta "lo que saldría"
        detalle.append({"reference": c["reference"], "email": c["email"], "etapa": c["etapa"], "ok": ok, "asunto": asunto})
    return {"activo": ACTIVO, "simulado": simular, "candidatos": len(lista), "enviados": enviados, "detalle": detalle}


# ── reanudar el carrito desde el correo ─────────────────────────────────────

def pedido_por_token(token: str, path: Path | None = None) -> dict | None:
    """Pedido asociado a un enlace de reanudación (marca el clic)."""
    if not token or not re.fullmatch(r"[A-Za-z0-9_\-]{16,64}", token):
        return None
    migrar(path)
    con = _con(path)
    try:
        env = con.execute("SELECT reference, email FROM recuperacion_envios WHERE token = ?", (token,)).fetchone()
        if not env:
            return None
        con.execute("UPDATE recuperacion_envios SET reanudado_at = COALESCE(reanudado_at, ?) WHERE token = ?", (_iso(_ahora()), token))
        con.commit()
        p = con.execute("SELECT reference, buyer_email, buyer_name, items_json, status FROM orders WHERE reference = ?", (env["reference"],)).fetchone()
    finally:
        con.close()
    if not p:
        return None
    return {"reference": p["reference"], "email": p["buyer_email"], "nombre": p["buyer_name"], "items": _items(p["items_json"]), "status": p["status"]}


# ── diagnóstico ─────────────────────────────────────────────────────────────

def _fila_evento(con, sql: str, params: tuple) -> list[sqlite3.Row]:
    try:
        return con.execute(sql, params).fetchall()
    except Exception:
        return []


def diagnostico_abandono(dias: int = 30, path: Path | None = None, metricas_path: Path | None = None) -> dict:
    """Por qué la gente no termina la compra, con datos. Solo lectura."""
    migrar(path)
    dias = max(1, min(int(dias or 30), 365))
    desde = _iso(_ahora() - timedelta(days=dias))
    con = _con(path)
    try:
        pedidos = con.execute(
            """SELECT reference, buyer_email, buyer_city, items_json, total, status, created_at,
                      payment_method, payment_type, payment_status_detail
               FROM orders WHERE created_at >= ?""", (desde,)).fetchall()
        envios = con.execute("SELECT reference, email, etapa, sent_at, reanudado_at FROM recuperacion_envios WHERE sent_at >= ?", (desde,)).fetchall()
        bajas = con.execute("SELECT COUNT(*) FROM correo_bajas").fetchone()[0]
    finally:
        con.close()

    por_estado = Counter(p["status"] for p in pedidos)
    total = len(pedidos)
    aprobados = por_estado.get("approved", 0)
    rechazados = por_estado.get("declined", 0)
    sin_pago = por_estado.get("no_realizado", 0) + por_estado.get("pending", 0)
    abandonados = [p for p in pedidos if p["status"] in ("declined", "no_realizado", "pending")]

    motivos = Counter((p["payment_status_detail"] or "sin_detalle") for p in pedidos if p["status"] == "declined")
    medios_rechazo = Counter(((p["payment_type"] or p["payment_method"] or "desconocido")) for p in pedidos if p["status"] == "declined")
    medios_ok = Counter(((p["payment_type"] or p["payment_method"] or "desconocido")) for p in pedidos if p["status"] == "approved")

    def rango(t: float) -> str:
        if t < 50_000:
            return "< $50.000"
        if t < 100_000:
            return "$50.000 – $100.000"
        if t < 250_000:
            return "$100.000 – $250.000"
        return "> $250.000"

    ticket = defaultdict(lambda: {"total": 0, "abandonados": 0})
    horas = defaultdict(lambda: {"total": 0, "abandonados": 0})
    ciudades = defaultdict(lambda: {"total": 0, "abandonados": 0})
    productos = Counter()
    productos_ok = Counter()
    recurrentes = Counter()
    for p in pedidos:
        ab = p["status"] in ("declined", "no_realizado", "pending")
        r = rango(float(p["total"] or 0)); ticket[r]["total"] += 1; ticket[r]["abandonados"] += ab
        try:
            h = datetime.fromisoformat(p["created_at"]).hour
        except Exception:
            h = -1
        franja = "madrugada (0-6)" if h < 6 else "mañana (6-12)" if h < 12 else "tarde (12-18)" if h < 18 else "noche (18-24)"
        horas[franja]["total"] += 1; horas[franja]["abandonados"] += ab
        c = (p["buyer_city"] or "sin ciudad").strip().title(); ciudades[c]["total"] += 1; ciudades[c]["abandonados"] += ab
        for i in _items(p["items_json"]):
            (productos if ab else productos_ok)[(i.get("name") or "").strip()[:60]] += int(i.get("qty") or 1)
        if ab and p["buyer_email"]:
            recurrentes[p["buyer_email"].lower()] += 1

    # eventos del navegador (app/data/metricas_contenido.db)
    embudo_web: dict[str, Any] = {}
    try:
        from app.services import metricas_contenido as mc

        mpath = metricas_path or mc.DB_PATH
        mcon = sqlite3.connect(str(mpath), timeout=5); mcon.row_factory = sqlite3.Row
        try:
            d = (_ahora() - timedelta(days=dias)).strftime("%Y-%m-%d")
            def ses(ev: str) -> int:
                r = mcon.execute("SELECT COUNT(DISTINCT sesion) FROM eventos WHERE dia >= ? AND evento = ? AND sesion != ''", (d, ev)).fetchone()
                return int(r[0] or 0)
            embudo_web = {
                "carrito": ses("carrito_visto"), "checkout": ses("checkout_visto"),
                "clic_pagar": ses("checkout_pagar_click"), "respuesta": ses("pago_respuesta"),
                "errores_checkout": [dict(r) for r in _fila_evento(mcon,
                    "SELECT detalle, COUNT(*) n FROM eventos WHERE dia >= ? AND evento = 'checkout_error' GROUP BY detalle ORDER BY n DESC LIMIT 8", (d,))],
                "errores_envio": ses("checkout_envio_error"),
                "dispositivo": {r["detalle"]: r["n"] for r in _fila_evento(mcon,
                    "SELECT detalle, COUNT(DISTINCT sesion) n FROM eventos WHERE dia >= ? AND evento = 'checkout_visto' GROUP BY detalle", (d,))},
                "dispositivo_pagar": {r["detalle"]: r["n"] for r in _fila_evento(mcon,
                    "SELECT detalle, COUNT(DISTINCT sesion) n FROM eventos WHERE dia >= ? AND evento = 'checkout_pagar_click' GROUP BY detalle", (d,))},
                "respuestas": {r["detalle"]: r["n"] for r in _fila_evento(mcon,
                    "SELECT detalle, COUNT(*) n FROM eventos WHERE dia >= ? AND evento = 'pago_respuesta' GROUP BY detalle", (d,))},
            }
        finally:
            mcon.close()
    except Exception as e:  # noqa: BLE001
        embudo_web = {"error": str(e)[:120]}

    # correos: enviados, clics y recuperados (pedido approved del mismo correo después del envío)
    recuperados = 0
    con = _con(path)
    try:
        for e in envios:
            r = con.execute("SELECT 1 FROM orders WHERE lower(buyer_email) = ? AND status = 'approved' AND created_at > ? LIMIT 1",
                            (e["email"].lower(), e["sent_at"])).fetchone()
            recuperados += 1 if r else 0
    finally:
        con.close()
    correos = {
        "enviados": len(envios), "por_etapa": dict(Counter(e["etapa"] for e in envios)),
        "clics": sum(1 for e in envios if e["reanudado_at"]), "recuperados": recuperados, "bajas": bajas,
    }

    # hipótesis con evidencia
    hipotesis: list[dict] = []
    def pct(a: int, b: int) -> int:
        return round(100 * a / b) if b else 0
    if total:
        hipotesis.append({"tipo": "embudo", "gravedad": "info",
            "titulo": f"{pct(aprobados, total)} % de los pedidos creados se pagan",
            "evidencia": f"{aprobados} aprobados, {rechazados} rechazados por MercadoPago y {sin_pago} que fueron a pagar y nunca volvieron, sobre {total} en {dias} días."})
    if sin_pago and sin_pago >= rechazados:
        hipotesis.append({"tipo": "no_volvieron", "gravedad": "alta",
            "titulo": "La mayoría del abandono es gente que fue a MercadoPago y no volvió",
            "evidencia": f"{sin_pago} pedidos quedaron en 'pending' hasta expirar: la persona cerró la pestaña, se le venció la sesión o no tenía el medio a la mano. Es justo lo que ataca el correo de recuperación con el enlace que rearma el carrito.",
            "accion": "Revisar los correos de recuperación (abajo) y ofrecer PSE/Nequi/efectivo de forma visible antes de salir a MercadoPago."})
    top_motivo = [(k, v) for k, v in motivos.most_common(3) if k != "sin_detalle"]
    if top_motivo:
        k, v = top_motivo[0]
        hipotesis.append({"tipo": "rechazo", "gravedad": "alta" if v >= 3 else "media",
            "titulo": f"Motivo de rechazo más frecuente: {MOTIVOS_MP.get(k, k)}",
            "evidencia": f"{v} de {rechazados} rechazos. " + ("Un rechazo por fondos o por datos mal digitados se recupera ofreciendo otro medio en la misma pantalla." if k.startswith("cc_rejected") else ""),
            "accion": "La pantalla de pago rechazado ya explica el motivo y sugiere PSE, Nequi o efectivo."})
    elif rechazados and motivos.get("sin_detalle", 0) == rechazados:
        hipotesis.append({"tipo": "rechazo", "gravedad": "media",
            "titulo": "Hubo rechazos pero sin motivo registrado",
            "evidencia": f"{rechazados} rechazos anteriores a que el sistema guardara el detalle de MercadoPago. Desde ahora el motivo (fondos, datos mal digitados, fraude, banco) queda en cada pedido."})
    if medios_rechazo:
        m, n = medios_rechazo.most_common(1)[0]
        if n >= 2 and medios_ok.get(m, 0) < n:
            hipotesis.append({"tipo": "medio", "gravedad": "media",
                "titulo": f"El medio «{m}» falla más de lo que funciona",
                "evidencia": f"{n} rechazos frente a {medios_ok.get(m, 0)} aprobados con ese medio.",
                "accion": "Sugerir PSE o Nequi como primera opción para tickets bajos."})
    peor_ticket = max(ticket.items(), key=lambda kv: (pct(kv[1]["abandonados"], kv[1]["total"]) if kv[1]["total"] >= 3 else -1), default=None)
    if peor_ticket and peor_ticket[1]["total"] >= 3 and pct(peor_ticket[1]["abandonados"], peor_ticket[1]["total"]) >= 50:
        hipotesis.append({"tipo": "ticket", "gravedad": "media",
            "titulo": f"Los pedidos de {peor_ticket[0]} se abandonan más",
            "evidencia": f"{peor_ticket[1]['abandonados']} de {peor_ticket[1]['total']} en ese rango. En tickets pequeños el envío pesa mucho frente al producto; en los grandes suele ser el cupo de la tarjeta.",
            "accion": "Mostrar el costo de envío antes del checkout y ofrecer envío gratis desde un umbral claro." if peor_ticket[0].startswith("<") else "Ofrecer PSE (débito) y pago contra cotización para montos altos."})
    if embudo_web.get("checkout") and embudo_web.get("clic_pagar") is not None:
        ch, cp = embudo_web["checkout"], embudo_web["clic_pagar"]
        if ch >= 5 and pct(cp, ch) < 60:
            hipotesis.append({"tipo": "formulario", "gravedad": "alta",
                "titulo": f"Solo {pct(cp, ch)} % de quienes ven el checkout llegan a pulsar «Pagar»",
                "evidencia": f"{ch} sesiones vieron el checkout y {cp} pulsaron pagar. Errores de formulario registrados: {', '.join(f'{e['detalle']} ({e['n']})' for e in embudo_web.get('errores_checkout', [])[:4]) or 'ninguno'}; fallos al cotizar envío: {embudo_web.get('errores_envio', 0)}.",
                "accion": "Acortar el formulario, precargar ciudad/departamento y mostrar el envío sin obligar a llenar todo."})
        disp = embudo_web.get("dispositivo") or {}
        dpag = embudo_web.get("dispositivo_pagar") or {}
        if disp.get("movil", 0) >= 5 and pct(dpag.get("movil", 0), disp["movil"]) + 20 < pct(dpag.get("escritorio", 0), max(disp.get("escritorio", 0), 1)):
            hipotesis.append({"tipo": "movil", "gravedad": "alta",
                "titulo": "En celular se pierde mucha más gente que en escritorio",
                "evidencia": f"Celular: {dpag.get('movil', 0)} de {disp['movil']} pulsan pagar; escritorio: {dpag.get('escritorio', 0)} de {disp.get('escritorio', 0)}.",
                "accion": "Probar el checkout completo en un teléfono real: teclado numérico en cédula/teléfono, selects de ciudad, botón fijo abajo."})
    if recurrentes:
        e, n = recurrentes.most_common(1)[0]
        if n >= 2:
            hipotesis.append({"tipo": "recurrente", "gravedad": "media",
                "titulo": f"{sum(1 for v in recurrentes.values() if v >= 2)} personas intentaron comprar varias veces sin lograrlo",
                "evidencia": f"La que más, {n} intentos. Son clientes que quieren comprar y algo se lo impide: vale una llamada o un WhatsApp directo.",
                "accion": "Contactar a mano a los recurrentes (lista abajo)."})
    if correos["enviados"]:
        hipotesis.append({"tipo": "correos", "gravedad": "info",
            "titulo": f"Correos de recuperación: {correos['enviados']} enviados, {correos['clics']} clics, {correos['recuperados']} compras después",
            "evidencia": f"Bajas acumuladas: {bajas}."})

    return {
        "dias": dias, "desde": desde[:10], "total": total,
        "por_estado": dict(por_estado), "aprobados": aprobados, "rechazados": rechazados, "sin_pago": sin_pago,
        "tasa_conversion_pct": pct(aprobados, total),
        "motivos_rechazo": [{"motivo": k, "texto": MOTIVOS_MP.get(k, k if k != "sin_detalle" else "sin detalle registrado"), "n": v} for k, v in motivos.most_common(8)],
        "medios": [{"medio": m, "rechazados": medios_rechazo.get(m, 0), "aprobados": medios_ok.get(m, 0)} for m in sorted(set(medios_rechazo) | set(medios_ok), key=lambda x: -(medios_rechazo.get(x, 0) + medios_ok.get(x, 0)))],
        "ticket": [{"rango": k, **v, "pct": pct(v["abandonados"], v["total"])} for k, v in sorted(ticket.items(), key=lambda kv: ["<", "$5", "$1", ">"].index(kv[0][:2]) if kv[0][:2] in ["<", "$5", "$1", ">"] else 9)],
        "horas": [{"franja": k, **v, "pct": pct(v["abandonados"], v["total"])} for k, v in horas.items()],
        "ciudades": [{"ciudad": k, **v, "pct": pct(v["abandonados"], v["total"])} for k, v in sorted(ciudades.items(), key=lambda kv: -kv[1]["total"])[:8]],
        "productos_abandonados": [{"producto": k, "unidades": v, "compradas": productos_ok.get(k, 0)} for k, v in productos.most_common(10)],
        "recurrentes": [{"email": e, "intentos": n} for e, n in recurrentes.most_common(10) if n >= 2],
        "embudo_web": embudo_web,
        "correos": correos,
        "hipotesis": hipotesis,
        "abandonados_recientes": [
            {"reference": p["reference"], "email": p["buyer_email"], "total": float(p["total"] or 0), "status": p["status"],
             "created_at": p["created_at"], "motivo": MOTIVOS_MP.get(p["payment_status_detail"] or "", p["payment_status_detail"] or ""),
             "medio": p["payment_type"] or p["payment_method"] or ""}
            for p in sorted(abandonados, key=lambda x: x["created_at"], reverse=True)[:25]
        ],
    }
