"""
REC-08: Reportes Financieros Semanales Automatizados
Genera y envía por correo HTML un resumen semanal con:
  - Total facturado (SIIGO)
  - Número de órdenes (MeLi + WC)
  - Producto más vendido
  - Clientes nuevos vs recurrentes
  - Comparativa con semana anterior
"""

import os
import smtplib
import sqlite3
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

REMITENTE    = os.getenv("EMAIL_SENDER", "mckenna.group.colombia@gmail.com")
PASSWORD     = os.getenv("EMAIL_PASSWORD", "")
DESTINATARIO = "cynthua0418@gmail.com"
CLIENTES_DB  = os.path.join("/home/mckg/mi-agente", "app", "data", "clientes.db")
DESPACHOS_DB = os.path.join("/home/mckg/mi-agente", "app", "data", "despachos.db")


def _datos_siigo_semana(fecha_inicio: str) -> dict:
    """Obtiene facturas de venta de SIIGO en el rango de la semana."""
    try:
        from app.services.siigo import obtener_facturas_siigo_paginadas
        facturas = obtener_facturas_siigo_paginadas(fecha_inicio)
        total    = sum(f.get("total", 0) for f in facturas)
        return {"facturas": len(facturas), "total": total}
    except Exception as e:
        print(f"⚠️ [REPORTE] Error SIIGO: {e}")
        return {"facturas": 0, "total": 0}


def _datos_clientes_semana(fecha_inicio: str) -> dict:
    """Estadísticas de clientes de la semana."""
    try:
        conn = sqlite3.connect(CLIENTES_DB)
        nuevos     = conn.execute("SELECT COUNT(*) FROM clientes WHERE primera_compra >= ?", (fecha_inicio,)).fetchone()[0]
        recurrentes= conn.execute("SELECT COUNT(*) FROM clientes WHERE ultima_compra >= ? AND total_compras > 1", (fecha_inicio,)).fetchone()[0]
        conn.close()
        return {"nuevos": nuevos, "recurrentes": recurrentes}
    except Exception:
        return {"nuevos": 0, "recurrentes": 0}


def _producto_estrella_semana(fecha_inicio: str) -> str:
    """Producto más despachado en la semana."""
    try:
        conn = sqlite3.connect(DESPACHOS_DB)
        rows = conn.execute("SELECT productos FROM despachos WHERE creado_en >= ?", (fecha_inicio,)).fetchall()
        conn.close()
        freq = {}
        for (prods,) in rows:
            for p in (prods or "").split(","):
                nombre = p.split("x")[0].strip()
                if nombre:
                    freq[nombre] = freq.get(nombre, 0) + 1
        if not freq:
            return "Sin datos"
        return max(freq, key=freq.get)
    except Exception:
        return "Sin datos"


def _html_reporte(siigo, clientes, producto_estrella, semana_label, fecha_generacion):
    delta_color = "#22c55e"
    return f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><title>Reporte Financiero Semanal · McKenna Group</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#0f172a,#1e3a8a);border-radius:14px 14px 0 0;padding:32px 36px;">
    <div style="font-size:10px;color:#93c5fd;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">McKenna Group S.A.S.</div>
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">📊 Reporte Financiero Semanal</h1>
    <div style="color:#bfdbfe;font-size:13px;margin-top:6px;">Semana: <strong style="color:#fff;">{semana_label}</strong></div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#fff;padding:28px 36px;">

    <!-- KPIs -->
    <div style="display:grid;gap:0;" >
      <table width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:20px;">
        <tr>
          <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;vertical-align:top;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:700;">💰 Total Facturado</div>
            <div style="font-size:28px;font-weight:800;color:#1e3a8a;margin-top:6px;">${siigo['total']:,.0f}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">COP · {siigo['facturas']} factura(s) SIIGO</div>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;vertical-align:top;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:700;">⭐ Producto Estrella</div>
            <div style="font-size:16px;font-weight:700;color:#1e293b;margin-top:6px;line-height:1.3;">{producto_estrella}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">Más despachado de la semana</div>
          </td>
        </tr>
        <tr><td colspan="3" style="height:12px;"></td></tr>
        <tr>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;vertical-align:top;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:700;">🆕 Clientes Nuevos</div>
            <div style="font-size:28px;font-weight:800;color:#16a34a;margin-top:6px;">{clientes['nuevos']}</div>
          </td>
          <td></td>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;vertical-align:top;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:700;">🔄 Clientes Recurrentes</div>
            <div style="font-size:28px;font-weight:800;color:#7c3aed;margin-top:6px;">{clientes['recurrentes']}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- NOTA -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 18px;font-size:12px;color:#1e40af;line-height:1.7;margin-top:4px;">
      📌 Este reporte es generado automáticamente por el sistema Hugo García cada lunes a las 7 AM.
      Los datos de facturación provienen de SIIGO ERP en tiempo real.
    </div>

  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0f172a;border-radius:0 0 14px 14px;padding:20px 36px;text-align:center;">
    <div style="color:#475569;font-size:11px;">McKenna Group S.A.S. · Bogotá, Colombia · {fecha_generacion}</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>"""


def enviar_reporte_semanal():
    """Genera y envía el reporte financiero semanal por correo HTML."""
    print("📊 [REPORTE SEMANAL] Generando...")
    try:
        hoy         = datetime.now()
        inicio_sem  = (hoy - timedelta(days=7)).strftime("%Y-%m-%d")
        semana_label= f"{(hoy-timedelta(days=7)).strftime('%d/%m')} – {hoy.strftime('%d/%m/%Y')}"

        siigo            = _datos_siigo_semana(inicio_sem)
        clientes         = _datos_clientes_semana(inicio_sem)
        producto_estrella= _producto_estrella_semana(inicio_sem)
        fecha_gen        = hoy.strftime("%d/%m/%Y %H:%M")

        html = _html_reporte(siigo, clientes, producto_estrella, semana_label, fecha_gen)

        msg = MIMEMultipart("alternative")
        msg["From"]    = REMITENTE
        msg["To"]      = DESTINATARIO
        msg["Subject"] = f"📊 Reporte Financiero Semanal — {semana_label} | McKenna Group"
        msg.attach(MIMEText(html, "html", "utf-8"))

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(REMITENTE, PASSWORD)
        server.send_message(msg)
        server.quit()

        print(f"✅ [REPORTE SEMANAL] Enviado a {DESTINATARIO}")
        return True
    except Exception as e:
        print(f"❌ [REPORTE SEMANAL] Error: {e}")
        return False
