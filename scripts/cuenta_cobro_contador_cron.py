#!/usr/bin/env python3
"""
Cron rápido (cada 5 min): apenas William (contador) manda su cuenta de cobro,
se le responde. Ver app/services/cuenta_cobro_contador.py.

  - Chequeo barato: busca en Gmail correos suyos que no se hayan revisado
    (solo encabezados). Si no hay, termina sin hacer nada más.
  - Si hay: relee sus cuentas de cobro y las atiende — pagada → respuesta en el
    hilo con el documento soporte y el comprobante contable; sin pagar → TKT a
    Jenniffer. Un correo suyo que no es cuenta de cobro (una declaración, una
    consulta) se marca como visto y no dispara nada.

El cron diario (recordatorio_pago_contador_cron.py, 9:00) hace lo mismo como
red de seguridad y además retoma los casos que quedaron esperando el pago.

Uso (crontab, desde la raíz del repo):
  */5 * * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/cuenta_cobro_contador_cron.py >>${LOG} 2>&1

Variables: las de cuenta_cobro_contador.py; RECORDATORIO_PAGO_CONTADOR_QUIET=1 no manda WhatsApp.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")


def main() -> int:
    from app.services import cuenta_cobro_contador as ccc

    try:
        nuevos = ccc.correos_nuevos()
    except Exception as e:
        print(f"⚠️ [contador] No se pudo revisar Gmail: {e}")
        return 1
    if not nuevos:
        return 0
    print(f"📨 [contador] {len(nuevos)} correo(s) nuevo(s) de William — atendiendo cuentas de cobro")
    acciones = ccc.procesar()
    if any(a.get("accion") == "ocupado" for a in acciones):
        return 0   # otra corrida lo está atendiendo; la siguiente vuelve a mirar
    ccc.marcar_vistos(nuevos)
    for a in acciones:
        print(f"• {a}")
    if (os.getenv("RECORDATORIO_PAGO_CONTADOR_QUIET") or "0").strip() == "1":
        return 0
    from app.utils import enviar_whatsapp_reporte

    grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
    for a in acciones:
        if a.get("accion") == "soporte_enviado":
            enviar_whatsapp_reporte(
                f"✅ *Contador (William) — {a['periodo']}*\n\nLlegó su cuenta de cobro y se le respondió "
                f"con el documento soporte {a['documento']} y el comprobante contable del pago "
                f"(solicitud #{a['solicitud_id']}).",
                grupo,
            )
        elif a.get("accion") == "ticket_creado":
            enviar_whatsapp_reporte(
                f"🎫 *Cuenta de cobro de William (contador) — {a['periodo']}*\n\n"
                f"Llegó por ${float(a['monto'] or 0):,.0f} COP y aún no se le ha pagado. "
                f"Ticket #{a['ticket_id']} a Jenniffer para solicitar el pago"
                + (f" (borrador #{a['borrador_id']} en Solicitudes de pago)." if a.get("borrador_id") else "."),
                grupo,
            )
        elif a.get("accion") == "esperando_documento":
            enviar_whatsapp_reporte(
                f"⏳ *Contador (William) — {a['periodo']}*\n\nLlegó su cuenta de cobro y ya está pagada "
                f"(solicitud #{a['solicitud_id']}), pero el documento soporte no se ha emitido a la DIAN. "
                "Emitirlo en Libro Mayor → Documentos soporte; en cuanto salga se le responde solo.",
                grupo,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
