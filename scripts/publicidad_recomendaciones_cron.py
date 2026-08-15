#!/usr/bin/env python3
"""
Cron cada 15 días (frecuencia real vía Sistemas → Tareas Programadas, ver
app.services.cron_scheduler): motor de recomendaciones de publicidad MeLi
(app.services.meli_ads_recomendaciones + app.services.meli_ads_campanas).
Cruza ACOS por producto con rotación real de ventas y, si hay candidatos a
pausar/revisar o productos que cambiaron de rotación y ya no están en la
campaña Alta/Media/Baja que les corresponde, crea un ticket en el Centro de
Mando + avisa por WhatsApp con el resumen y los peores casos. No pausa ni
mueve nada en MeLi — no hay endpoint público para eso (confirmado ago-2026:
solo se puede desde el panel web de Mercado Ads). 15 días porque la rotación
se mide sobre una ventana de 30 días — revisarla más seguido no aporta señal
nueva, y evita pedirle al operador que mueva productos cada semana.

Uso típico (crontab dispara semanal, el auto-límite de 15 días decide si
corre de verdad — desde la raíz del repo):
  15 8 * * 1 cd /ruta/mi-agente && ./venv/bin/python scripts/publicidad_recomendaciones_cron.py >>log_cron.txt 2>&1

Variables:
  GRUPO_PUBLICIDAD_WA — destino (default en app.utils.jid_grupo_publicidad_wa)
  AGENTE_PUBLICIDAD_RECOMENDACIONES_SKIP_WA=1 — imprime sin enviar WhatsApp (pruebas)
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

_TITULO_TICKET = "Publicidad MeLi: revisar ACOS"


def _hay_ticket_abierto(db_path: str) -> bool:
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute(
            """
            SELECT id, numero FROM tickets
            WHERE tipo='accion' AND titulo=?
              AND estado IN ('pendiente','en_proceso','esperando_aprobacion')
            ORDER BY id DESC LIMIT 1
            """,
            (_TITULO_TICKET,),
        ).fetchone()
        return bool(row)
    except Exception:
        return False
    finally:
        try:
            db.close()
        except Exception:
            pass


def _crear_ticket(rec: dict, alertas: dict | None = None) -> str | None:
    """Crea el ticket de acción si no hay uno abierto. Devuelve el número o None."""
    from app.services import tickets_db as _tdb

    _tdb.init_db()
    if _hay_ticket_abierto(_tdb.DB_PATH):
        return None

    db = sqlite3.connect(_tdb.DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
        if not row:
            row = db.execute("SELECT id FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1").fetchone()
        creador_id = int(row["id"]) if row else None
    finally:
        db.close()
    if not creador_id:
        return None

    r = rec["resumen"]
    top_pausar = rec["pausar"][:15]
    top_revisar = rec["revisar"][:10]

    bloques = [
        f"Revisión de ACOS en Product Ads MeLi ({rec['dias']} días).\n",
        f"- **{r['pausar']}** productos candidatos a **pausar** (${r['costo_pausar']:,.0f} COP en juego).",
        f"- **{r['revisar']}** productos a **revisar** (${r['costo_revisar']:,.0f} COP en juego).",
        f"- {r['ok']} dentro de objetivo para su rotación.",
        f"- {r['sin_dato_rotacion']} sin dato de rotación (evaluados conservador, como 'baja').\n",
        "MeLi no permite pausar un producto por API — hazlo manualmente desde Mercado Ads con los links de abajo.\n",
        "**Pausar (prioridad):**",
    ]
    for f in top_pausar:
        bloques.append(f"- {f['titulo']} — ${f['costo']:,.0f} COP, ACOS {f['acos']:.1f}%. {f['motivo']} {f.get('permalink') or ''}")
    if top_revisar:
        bloques.append("\n**Revisar:**")
        for f in top_revisar:
            bloques.append(f"- {f['titulo']} — ${f['costo']:,.0f} COP, ACOS {f['acos']:.1f}%. {f['motivo']}")
    if alertas:
        migrar = alertas.get("migrar_a_campana") or []
        pausar_camp = alertas.get("pausar_de_campana") or []
        reasignar = alertas.get("reasignar") or []
        if migrar:
            bloques.append(f"\n**Falta migrar a alguna de las 3 campañas ({len(migrar)}):**")
            for a in migrar[:15]:
                bloques.append(f"- {a['titulo']} — {a['motivo']} {a.get('permalink') or ''}")
        if pausar_camp:
            bloques.append(f"\n**Ya migrados pero sin ninguna venta — pausar, no reasignar ({len(pausar_camp)}):**")
            for a in pausar_camp[:15]:
                bloques.append(f"- {a['titulo']} — {a['motivo']} {a.get('permalink') or ''}")
        if reasignar:
            bloques.append(f"\n**Cambiaron de rotación, mover de campaña ({len(reasignar)}):**")
            for a in reasignar[:15]:
                bloques.append(f"- {a['titulo']} — {a['motivo']}")
    bloques.append("\nDetalle completo en /app → Contabilidad → Publicidad.")
    descripcion = "\n".join(bloques)

    data = {
        "tipo": "accion",
        "titulo": _TITULO_TICKET,
        "categoria": "ventas",
        "descripcion": descripcion,
        "prioridad": "media",
        "asignado_a": None,
    }
    ticket, err = _tdb.crear_ticket(data, creador_id, None)
    if err:
        print(f"⚠️  No se pudo crear el ticket: {err}")
        return None
    return str(ticket.get("numero") or ticket.get("id") or "")


def _mensaje_whatsapp(rec: dict, numero_ticket: str | None, alertas: dict | None = None) -> str:
    r = rec["resumen"]
    lineas = [
        "📢 *Publicidad MeLi — revisión de ACOS*",
        f"Período: últimos {rec['dias']} días",
        f"🔴 Pausar: *{r['pausar']}* productos (${r['costo_pausar']:,.0f} COP)",
        f"🟠 Revisar: *{r['revisar']}* productos (${r['costo_revisar']:,.0f} COP)",
        f"🟢 OK: {r['ok']} dentro de objetivo para su rotación",
    ]
    if r["sin_dato_rotacion"]:
        lineas.append(f"ℹ️ {r['sin_dato_rotacion']} sin dato de rotación (evaluados conservador)")
    top = rec["pausar"][:5]
    if top:
        lineas.append("\nTop candidatos a pausar:")
        for f in top:
            lineas.append(f"• {f['titulo']} — ${f['costo']:,.0f} COP, ACOS {f['acos']:.1f}%")
    if alertas:
        migrar = alertas.get("migrar_a_campana") or []
        pausar_camp = alertas.get("pausar_de_campana") or []
        reasignar = alertas.get("reasignar") or []
        if migrar:
            lineas.append(f"\n📥 *{len(migrar)}* con venta real, falta migrar a una campaña:")
            for a in migrar[:5]:
                lineas.append(f"• {a['titulo']} → {a['grupo_recomendado_nombre']}")
        if pausar_camp:
            lineas.append(f"\n⏸ *{len(pausar_camp)}* ya migrados sin ninguna venta — pausar, no reasignar:")
            for a in pausar_camp[:5]:
                lineas.append(f"• {a['titulo']} ({a['grupo_actual_nombre']})")
        if reasignar:
            lineas.append(f"\n🔀 *{len(reasignar)}* cambiaron de rotación, mover de campaña:")
            for a in reasignar[:5]:
                lineas.append(f"• {a['titulo']} — {a['grupo_actual_nombre']} → {a['grupo_recomendado_nombre']}")
    if numero_ticket:
        lineas.append(f"\n🏢 Centro de Mando: ticket #{numero_ticket}")
    else:
        lineas.append("\n(Ya había un ticket abierto de esta revisión — no se duplica.)")
    lineas.append("Detalle completo: /app → Contabilidad → Publicidad")
    return "\n".join(lineas)


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar("publicidad_recomendaciones"):
        print("⏭  Recomendaciones publicidad MeLi: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    try:
        from app.services.meli_ads_recomendaciones import calcular_recomendaciones_publicidad

        rec = calcular_recomendaciones_publicidad(dias=30, refresh=True)
    except Exception as e:
        print(f"❌ Error calculando recomendaciones de publicidad: {e}")
        return 1

    alertas: dict = {}
    total_alertas = 0
    try:
        from app.services.meli_ads_campanas import calcular_alertas_reasignacion

        alertas = calcular_alertas_reasignacion(dias=30, refresh=False)
        total_alertas = int(alertas.get("count") or 0)
    except Exception as e:
        print(f"⚠️  No se pudieron calcular alertas de campañas (migrar/pausar/reasignar): {e}")

    registrar_ejecucion("publicidad_recomendaciones")

    r = rec["resumen"]
    print(f"[{datetime.now().isoformat(timespec='seconds')}] publicidad_recomendaciones: "
          f"pausar={r['pausar']} revisar={r['revisar']} ok={r['ok']} alertas_campanas={total_alertas}")

    if r["pausar"] == 0 and r["revisar"] == 0 and not total_alertas:
        print("✅ Nada que flaguear — todo dentro de objetivo por rotación y campaña.")
        return 0

    numero_ticket = None
    try:
        numero_ticket = _crear_ticket(rec, alertas)
    except Exception as e:
        print(f"⚠️  No se pudo crear/verificar el ticket: {e}")

    cuerpo = _mensaje_whatsapp(rec, numero_ticket, alertas)
    print(cuerpo)

    if os.getenv("AGENTE_PUBLICIDAD_RECOMENDACIONES_SKIP_WA", "").strip() == "1":
        print("(AGENTE_PUBLICIDAD_RECOMENDACIONES_SKIP_WA=1 — no se envía WhatsApp)")
        return 0

    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_publicidad_wa

        enviar_whatsapp_reporte(cuerpo, jid_grupo_publicidad_wa())
        print("✅ Resumen enviado por WhatsApp")
        return 0
    except Exception as e:
        print(f"❌ No se pudo enviar el resumen por WhatsApp: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
