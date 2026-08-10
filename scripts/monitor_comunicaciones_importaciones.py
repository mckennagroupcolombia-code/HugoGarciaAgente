#!/usr/bin/env python3
"""
Monitor de comunicaciones de importaciones (Gmail + WhatsApp) — sin IA.

Por cada ticket activo de categoría "importaciones" (Centro de Mando) y por
cada aliado logístico configurado (app/data/aliados_logisticos.json), busca
mensajes NUEVOS desde la última revisión:

  - Gmail: por dominio del remitente típico del aliado (dhl.com,
    chinalatinagent.com, aduamarcol.com, premiumbox.com.co, openits.me,
    open-eb.me...) combinado con números de guía/AWB detectados en el
    título/descripción del ticket.
  - WhatsApp: por el JID de contacto del aliado (wa_chats.db), si tiene
    número configurado.

Los hallazgos nuevos se dejan como comentario interno en el ticket
correspondiente (app.services.tickets_db.agregar_comentario). NO usa ningún
modelo de IA — solo coincidencia de dominio/palabra clave/JID, precisamente
para no disparar la regla de presupuesto LLM de CLAUDE.md (ningún call-site
nuevo de LLM sin pasar por app/services/llm_budget.py).

Uso:
    python3 scripts/monitor_comunicaciones_importaciones.py [--dry-run]

--dry-run: no escribe estado ni comentarios, solo imprime qué haría.

Estado persistido en app/data/importaciones_comunicaciones_estado.json
(último msg_id de Gmail visto por ticket, último ts de WhatsApp visto por
aliado) — así cada corrida solo procesa lo nuevo.

NO instalado en crontab automáticamente. Para activarlo (ver
docs/agentic o CLAUDE.md § Observabilidad/cron para el patrón):
    0 8 * * * cd /home/mckg/mi-agente && ./venv/bin/python scripts/monitor_comunicaciones_importaciones.py >>log_cron.txt 2>&1
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

ESTADO_PATH = REPO / "app" / "data" / "importaciones_comunicaciones_estado.json"

# Dominios de remitente típicos por aliado — mantener en sync manualmente con
# lo que se vaya observando en Gmail (no viene de aliados_logisticos.json
# porque ahí solo está el email de contacto oficial, no todos los dominios
# operativos reales que usan estas empresas).
DOMINIOS_ALIADO = {
    "china-latin-agent": ["chinalatinagent.com", "chinalatinlogistics.com"],
    "aduamarcol": ["aduamarcol.com"],
    # Dominios genéricos de DHL vistos en el histórico (agencia de aduanas,
    # courier, cobranza, openComex) — no ligados a un aliado_id específico
    # del master file, pero relevantes para cualquier ticket con "DHL" en
    # proveedor/descripción.
    "_dhl_generico": ["dhl.com", "openits.me", "open-eb.me"],
}

AWB_RE = re.compile(r"\b(\d{8,12})\b")


def _cargar_estado() -> dict:
    try:
        return json.loads(ESTADO_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"gmail_vistos": {}, "whatsapp_ultimo_ts": {}}


def _guardar_estado(estado: dict, dry_run: bool) -> None:
    if dry_run:
        return
    ESTADO_PATH.parent.mkdir(parents=True, exist_ok=True)
    ESTADO_PATH.write_text(json.dumps(estado, ensure_ascii=False, indent=2), encoding="utf-8")


def _admin_user_id(db_path: str) -> int | None:
    import sqlite3

    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
        if row:
            return int(row["id"])
        row = db.execute("SELECT id FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1").fetchone()
        if row:
            return int(row["id"])
    except Exception:
        return None
    finally:
        try:
            db.close()
        except Exception:
            pass
    return None


def _tickets_activos_importaciones() -> list[dict]:
    from app.services.tickets_db import listar_tickets
    from app.tools.importaciones import CATEGORIA_IMPORTACIONES

    usuario_admin = {"rol": {"nivel": 3}}
    tickets = listar_tickets(usuario_admin, {"categoria": CATEGORIA_IMPORTACIONES})
    return [t for t in tickets if t.get("estado") not in ("resuelto", "rechazado")]


def _dominios_para_ticket(ticket: dict) -> list[str]:
    texto = f"{ticket.get('titulo', '')} {ticket.get('descripcion', '')}".lower()
    dominios: list[str] = []
    for aliado_id, doms in DOMINIOS_ALIADO.items():
        if aliado_id == "_dhl_generico":
            continue
        nombre_aliado = aliado_id.replace("-", " ")
        if nombre_aliado in texto or aliado_id in texto:
            dominios.extend(doms)
    if "dhl" in texto:
        dominios.extend(DOMINIOS_ALIADO["_dhl_generico"])
    return sorted(set(dominios))


def _guias_para_ticket(ticket: dict) -> list[str]:
    texto = f"{ticket.get('titulo', '')} {ticket.get('descripcion', '')}"
    return sorted(set(AWB_RE.findall(texto)))


def _revisar_gmail_ticket(svc, ticket: dict, estado: dict, dry_run: bool) -> list[dict]:
    dominios = _dominios_para_ticket(ticket)
    guias = _guias_para_ticket(ticket)
    if not dominios and not guias:
        return []

    partes = []
    if dominios:
        partes.append("(" + " OR ".join(f"from:{d}" for d in dominios) + ")")
    if guias:
        partes.append("(" + " OR ".join(f'"{g}"' for g in guias) + ")")
    query = " ".join(partes) if len(partes) == 1 else " OR ".join(partes)

    ticket_id = str(ticket["id"])
    vistos = set(estado["gmail_vistos"].get(ticket_id, []))

    try:
        res = svc.users().messages().list(userId="me", q=query, maxResults=25).execute()
    except Exception as e:
        print(f"  ! error buscando Gmail para ticket #{ticket['id']}: {e}")
        return []

    nuevos = []
    ids_actualizados = set(vistos)
    for m in res.get("messages", []):
        mid = m["id"]
        ids_actualizados.add(mid)
        if mid in vistos:
            continue
        try:
            meta = svc.users().messages().get(
                userId="me", id=mid, format="metadata", metadataHeaders=["Subject", "Date", "From"]
            ).execute()
            headers = {h["name"]: h["value"] for h in meta.get("payload", {}).get("headers", [])}
            nuevos.append({
                "id": mid,
                "subject": headers.get("Subject", ""),
                "date": headers.get("Date", ""),
                "from": headers.get("From", ""),
            })
        except Exception:
            continue

    if not dry_run:
        estado["gmail_vistos"][ticket_id] = sorted(ids_actualizados)[-200:]  # cap para no crecer sin límite
    return nuevos


def _revisar_whatsapp_aliados(estado: dict, dry_run: bool) -> dict[str, list[dict]]:
    """Devuelve {aliado_id: [mensajes nuevos]} para aliados con WhatsApp configurado."""
    from app.services.aliados_logisticos import listar_aliados
    from app.services.wa_chats import listar_mensajes

    resultado: dict[str, list[dict]] = {}
    for aliado in listar_aliados():
        numero = (aliado.get("contacto") or {}).get("whatsapp")
        if not numero:
            continue
        digitos = re.sub(r"\D", "", numero)
        jid = f"{digitos}@c.us"
        try:
            mensajes = listar_mensajes(jid, limit=50)
        except Exception as e:
            print(f"  ! error leyendo WhatsApp {jid}: {e}")
            continue
        ultimo_ts_visto = estado["whatsapp_ultimo_ts"].get(aliado["id"], 0)
        nuevos = [m for m in mensajes if m.get("ts", 0) > ultimo_ts_visto]
        if mensajes and not dry_run:
            estado["whatsapp_ultimo_ts"][aliado["id"]] = max(m.get("ts", 0) for m in mensajes)
        if nuevos:
            resultado[aliado["id"]] = nuevos
    return resultado


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion
    from app.services.tickets_db import DB_PATH, agregar_comentario

    if not dry_run and not debe_ejecutar("monitor_importaciones"):
        print("⏭  Monitor importaciones: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return
    if not dry_run:
        registrar_ejecucion("monitor_importaciones")

    print(f"🔎 Monitor comunicaciones importaciones — {'DRY RUN' if dry_run else 'ejecución real'}")

    estado = _cargar_estado()
    estado.setdefault("gmail_vistos", {})
    estado.setdefault("whatsapp_ultimo_ts", {})

    tickets = _tickets_activos_importaciones()
    print(f"Tickets activos de importaciones: {len(tickets)}")

    admin_id = _admin_user_id(DB_PATH)
    if not admin_id:
        print("⚠️ No hay usuario admin/activo en el Centro de Mando — no se pueden dejar comentarios.")
        return

    try:
        from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service
        svc = get_gmail_service()
    except Exception as e:
        print(f"⚠️ Gmail no disponible ({e}) — se omite la revisión de correo.")
        svc = None

    total_hallazgos = 0

    if svc:
        for ticket in tickets:
            nuevos = _revisar_gmail_ticket(svc, ticket, estado, dry_run)
            if not nuevos:
                continue
            total_hallazgos += len(nuevos)
            lineas = [f"📧 {len(nuevos)} correo(s) nuevo(s) relacionados detectados automáticamente:"]
            for n in nuevos[:10]:
                lineas.append(f"- {n['date']} · {n['from']} · {n['subject']}")
            texto = "\n".join(lineas)
            print(f"  Ticket #{ticket['id']} ({ticket['titulo']}): {len(nuevos)} correo(s) nuevo(s)")
            if not dry_run:
                agregar_comentario(ticket["id"], admin_id, texto, es_interno=True)

    whatsapp_nuevos = _revisar_whatsapp_aliados(estado, dry_run)
    for aliado_id, mensajes in whatsapp_nuevos.items():
        total_hallazgos += len(mensajes)
        tickets_del_aliado = [t for t in tickets if aliado_id.replace("-", " ") in f"{t.get('descripcion', '')}".lower()]
        lineas = [f"💬 {len(mensajes)} mensaje(s) nuevo(s) de WhatsApp con {aliado_id}:"]
        for m in mensajes[-10:]:
            texto_msg = (m.get("texto") or "[adjunto]")[:200]
            lineas.append(f"- [{m.get('direccion')}] {texto_msg}")
        texto = "\n".join(lineas)
        if tickets_del_aliado:
            print(f"  WhatsApp {aliado_id}: {len(mensajes)} mensaje(s) nuevo(s) -> {len(tickets_del_aliado)} ticket(s)")
            if not dry_run:
                for t in tickets_del_aliado:
                    agregar_comentario(t["id"], admin_id, texto, es_interno=True)
        else:
            print(f"  WhatsApp {aliado_id}: {len(mensajes)} mensaje(s) nuevo(s), sin ticket activo para adjuntar (solo log).")

    _guardar_estado(estado, dry_run)
    print(f"✅ Total hallazgos nuevos: {total_hallazgos}" + (" (dry-run, nada se guardó)" if dry_run else ""))


if __name__ == "__main__":
    main()
