"""
Informe Forense Técnico Mensual — McKenna Group S.A.S.
Genera y envía un correo HTML vistoso el día 1 de cada mes.
Se integra al monitor daemon de app/monitor.py.
"""

import os
import json
import smtplib
import requests
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

DESTINATARIO = "cynthua0418@gmail.com"
REMITENTE    = os.getenv("EMAIL_SENDER", "mckenna.group.colombia@gmail.com")
PASSWORD     = os.getenv("EMAIL_PASSWORD", "")
METRICAS_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'metricas_diarias.json')


# ──────────────────────────────────────────────────────────────
#  Recolección de datos en tiempo real
# ──────────────────────────────────────────────────────────────

def _estado_servicios():
    servicios = [
        ("Agente Principal",   8081, "/status"),
        ("Webhook MeLi",       8080, "/status"),
        ("Bot WhatsApp (Node)", 3000, None),
    ]
    resultado = []
    for nombre, puerto, path in servicios:
        url = f"http://localhost:{puerto}{path or ''}"
        try:
            r = requests.get(url, timeout=4)
            activo = r.status_code < 500
        except Exception:
            activo = False
        resultado.append((nombre, puerto, activo))
    return resultado

def _leer_metricas():
    try:
        with open(METRICAS_PATH) as f:
            return json.load(f)
    except Exception:
        return {}

def _token_meli_valido():
    try:
        from app.utils import refrescar_token_meli
        return bool(refrescar_token_meli())
    except Exception:
        return False

def _contar_preguntas_pendientes():
    ruta = os.path.join(os.path.dirname(__file__), '..', 'data', 'preguntas_pendientes_preventa.json')
    try:
        with open(ruta) as f:
            data = json.load(f)
        return sum(1 for p in data.get('preguntas', []) if not p.get('respondida'))
    except Exception:
        return 0

def _contar_casos_entrenamiento():
    ruta = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'training', 'casos_preventa.json')
    try:
        with open(ruta) as f:
            return len(json.load(f).get('casos', []))
    except Exception:
        return 0


# ──────────────────────────────────────────────────────────────
#  Plantilla HTML
# ──────────────────────────────────────────────────────────────

def _generar_html(servicios, metricas, token_meli, preguntas_pend, casos_ia, mes_año):
    def badge(activo):
        if activo:
            return '<span style="background:#22c55e;color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">● ACTIVO</span>'
        return '<span style="background:#ef4444;color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">● CAÍDO</span>'

    filas_servicios = ""
    for nombre, puerto, activo in servicios:
        filas_servicios += f"""
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:12px 16px;font-weight:600;color:#1e293b;">{nombre}</td>
          <td style="padding:12px 16px;color:#64748b;font-family:monospace;">:{puerto}</td>
          <td style="padding:12px 16px;">{badge(activo)}</td>
        </tr>"""

    filas_metricas = ""
    iconos = {"mensajes_whatsapp":"💬","preguntas_meli":"🛒","pagos_confirmados":"💰","ordenes_sincronizadas":"📦"}
    labels = {"mensajes_whatsapp":"Mensajes WA atendidos","preguntas_meli":"Preguntas MeLi respondidas",
              "pagos_confirmados":"Pagos confirmados","ordenes_sincronizadas":"Órdenes sincronizadas"}
    for k, label in labels.items():
        val = metricas.get(k, 0)
        filas_metricas += f"""
        <div style="background:#f8fafc;border-left:4px solid #1e3a8a;border-radius:8px;padding:16px 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;color:#475569;">{iconos[k]} {label}</span>
          <span style="font-size:24px;font-weight:800;color:#1e3a8a;">{val}</span>
        </div>"""

    recomendaciones = [
        ("REC-01","Panel de Control Web","Alta","Dashboard en tiempo real con semáforo de servicios, métricas, cola preventa e historial."),
        ("REC-02","Cotizaciones en PDF","Media-Alta","Generación automática de cotizaciones con membrete corporativo enviadas al cliente."),
        ("REC-03","Seguimiento Post-Venta","Media","Mensaje automático 24h post-venta solicitando confirmación de recepción y calificación."),
        ("REC-04","Base de Datos Clientes","Media","Historial de compras por cliente para personalización de atención futura."),
        ("REC-05","Integración Despacho","Media","Generación automática de guías Interrapidísimo y notificación al cliente."),
        ("REC-06","Fichas Técnicas Google Sheets","Media","Alerta semanal de productos sin ficha técnica para maximizar automatización preventa."),
        ("REC-07","Respaldo en Google Drive","Media","Backup nocturno de SQLite, ChromaDB y JSONs críticos."),
        ("REC-08","Reportes Financieros","Baja-Media","Resumen semanal con facturado, órdenes y producto estrella enviado por correo."),
        ("REC-09","Rate Limiting y JWT","Baja","Seguridad reforzada en endpoints públicos con Flask-Limiter y JWT."),
    ]
    color_prior = {"Alta":"#dc2626","Media-Alta":"#ea580c","Media":"#ca8a04","Baja-Media":"#16a34a","Baja":"#2563eb"}
    filas_rec = ""
    for codigo, titulo, prior, desc in recomendaciones:
        c = color_prior.get(prior, "#64748b")
        filas_rec += f"""
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 16px;font-weight:700;color:#1e3a8a;white-space:nowrap;">{codigo}</td>
          <td style="padding:12px 16px;font-weight:600;color:#1e293b;">{titulo}</td>
          <td style="padding:12px 16px;white-space:nowrap;">
            <span style="background:{c}20;color:{c};padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;">{prior}</span>
          </td>
          <td style="padding:12px 16px;color:#64748b;font-size:13px;">{desc}</td>
        </tr>"""

    meli_badge = badge(token_meli)
    ahora = datetime.now().strftime("%d/%m/%Y %H:%M")

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Informe Forense Técnico — Hugo García | McKenna Group</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">

<!-- WRAPPER -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:30px 0;">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;">

  <!-- HEADER -->
  <tr>
    <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#1d4ed8 100%);border-radius:16px 16px 0 0;padding:40px 40px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:11px;color:#93c5fd;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">McKenna Group S.A.S. · Bogotá, Colombia</div>
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;line-height:1.3;">
              Informe Forense Técnico
            </h1>
            <h2 style="margin:6px 0 0;color:#bfdbfe;font-size:16px;font-weight:400;">
              Sistema de Automatización &ldquo;Hugo García&rdquo; &mdash; v1.0
            </h2>
          </td>
          <td align="right" valign="top">
            <div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:12px 18px;text-align:center;">
              <div style="color:#93c5fd;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Período</div>
              <div style="color:#ffffff;font-size:18px;font-weight:800;margin-top:2px;">{mes_año}</div>
            </div>
          </td>
        </tr>
      </table>
      <!-- Badges row -->
      <table style="margin-top:24px;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:10px;"><span style="background:rgba(34,197,94,0.2);color:#86efac;border:1px solid #86efac40;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;">🟢 Sistema Operativo</span></td>
          <td style="padding-right:10px;"><span style="background:rgba(59,130,246,0.2);color:#93c5fd;border:1px solid #93c5fd40;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;">🤖 IA: Gemini 2.5-Pro</span></td>
          <td><span style="background:rgba(251,191,36,0.2);color:#fde68a;border:1px solid #fde68a40;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;">📅 Generado: {ahora}</span></td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="background:#ffffff;padding:0 40px 40px;">

      <!-- RESUMEN EJECUTIVO -->
      <div style="border-top:4px solid #1e3a8a;padding-top:32px;margin-top:32px;">
        <h3 style="margin:0 0 12px;color:#0f172a;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">01 · Resumen Ejecutivo</h3>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.8;background:#f8fafc;border-radius:10px;padding:18px 20px;">
          El sistema <strong>Hugo García</strong> opera de forma continua (24/7) en un servidor Ubuntu 24.04,
          automatizando la atención al cliente por WhatsApp, la preventa y posventa en MercadoLibre,
          la sincronización de inventario entre MeLi y WooCommerce, la facturación electrónica DIAN vía SIIGO,
          y la importación de productos desde facturas de proveedores. El presente informe refleja el estado
          técnico al cierre del período <strong>{mes_año}</strong>.
        </p>
      </div>

      <!-- ESTADO DE SERVICIOS -->
      <div style="margin-top:32px;">
        <h3 style="margin:0 0 16px;color:#0f172a;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">02 · Estado de Servicios</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:12px 16px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Servicio</th>
              <th style="padding:12px 16px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Puerto</th>
              <th style="padding:12px 16px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Estado</th>
            </tr>
          </thead>
          <tbody>{filas_servicios}
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:12px 16px;font-weight:600;color:#1e293b;">MercadoLibre OAuth</td>
              <td style="padding:12px 16px;color:#64748b;font-family:monospace;">API</td>
              <td style="padding:12px 16px;">{meli_badge}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- MÉTRICAS -->
      <div style="margin-top:32px;">
        <h3 style="margin:0 0 16px;color:#0f172a;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">03 · Métricas de Actividad (Último Día Registrado)</h3>
        {filas_metricas}
        <div style="background:#f8fafc;border-left:4px solid #7c3aed;border-radius:8px;padding:16px 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;display:block;">
          <div style="display:inline-block;width:70%;">
            <span style="font-size:14px;color:#475569;">🧠 Casos de entrenamiento IA (acumulado)</span>
          </div>
          <div style="display:inline-block;text-align:right;width:29%;">
            <span style="font-size:24px;font-weight:800;color:#7c3aed;">{casos_ia}</span>
          </div>
        </div>
        <div style="background:#f8fafc;border-left:4px solid #f59e0b;border-radius:8px;padding:16px 20px;display:block;">
          <div style="display:inline-block;width:70%;">
            <span style="font-size:14px;color:#475569;">⏳ Preguntas MeLi actualmente pendientes</span>
          </div>
          <div style="display:inline-block;text-align:right;width:29%;">
            <span style="font-size:24px;font-weight:800;color:#f59e0b;">{preguntas_pend}</span>
          </div>
        </div>
      </div>

      <!-- INTEGRACIONES -->
      <div style="margin-top:32px;">
        <h3 style="margin:0 0 16px;color:#0f172a;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">04 · Integraciones Activas</h3>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            {''.join(f'<td style="padding:8px;width:25%;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;">{icon}</div><div style="font-size:11px;color:#64748b;margin-top:4px;font-weight:600;">{name}</div></div></td>' for icon, name in [("🤖","Gemini 2.5-Pro"),("🛒","MercadoLibre"),("📊","SIIGO ERP"),("🛍️","WooCommerce")])}
          </tr>
          <tr>
            {''.join(f'<td style="padding:8px;width:25%;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;">{icon}</div><div style="font-size:11px;color:#64748b;margin-top:4px;font-weight:600;">{name}</div></div></td>' for icon, name in [("📋","Google Sheets"),("📧","Gmail API"),("💬","WhatsApp WA"),("☁️","Cloudflare")])}
          </tr>
        </table>
      </div>

      <!-- RECOMENDACIONES -->
      <div style="margin-top:32px;">
        <h3 style="margin:0 0 16px;color:#0f172a;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">05 · Hoja de Ruta — Mejoras Pendientes</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Código</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Mejora</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Prioridad</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Descripción</th>
            </tr>
          </thead>
          <tbody>{filas_rec}</tbody>
        </table>
      </div>

      <!-- HALLAZGOS -->
      <div style="margin-top:32px;">
        <h3 style="margin:0 0 16px;color:#0f172a;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">06 · Hallazgos Técnicos</h3>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin-bottom:10px;">
          <div style="font-weight:700;color:#92400e;font-size:13px;">⚠️ HALL-01 · Fichas técnicas incompletas</div>
          <div style="color:#78350f;font-size:13px;margin-top:4px;line-height:1.6;">Varios productos del catálogo no tienen la columna I (ficha técnica) diligenciada en Google Sheets, lo que obliga a intervención manual en preventa.</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:10px;">
          <div style="font-weight:700;color:#991b1b;font-size:13px;">🔴 HALL-02 · Sin verificación de origen en webhook MeLi</div>
          <div style="color:#7f1d1d;font-size:13px;margin-top:4px;line-height:1.6;">El puerto 8080 no valida User-Agent ni IP de origen de notificaciones MeLi. Se recomienda agregar capa de validación.</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;">
          <div style="font-weight:700;color:#166534;font-size:13px;">✅ HALL-03 · Credenciales SMTP configuradas</div>
          <div style="color:#14532d;font-size:13px;margin-top:4px;line-height:1.6;">Canal de alertas por correo electrónico activo. Credenciales Gmail App Password configuradas correctamente.</div>
        </div>
      </div>

    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:linear-gradient(135deg,#0f172a,#1e3a8a);border-radius:0 0 16px 16px;padding:28px 40px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="color:#bfdbfe;font-size:12px;line-height:1.8;">
              <strong style="color:#ffffff;">McKenna Group S.A.S.</strong><br/>
              Materias Primas Farmacéuticas y Cosméticas · Bogotá, Colombia<br/>
              Sistema Hugo García v1.0 · Ubuntu 24.04 LTS
            </div>
          </td>
          <td align="right">
            <div style="color:#64748b;font-size:11px;text-align:right;">
              Informe generado automáticamente<br/>
              {ahora}<br/>
              <span style="color:#3b82f6;">mckenna.group.colombia@gmail.com</span>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>"""


# ──────────────────────────────────────────────────────────────
#  Función principal de envío
# ──────────────────────────────────────────────────────────────

def enviar_informe_mensual():
    """Genera y envía el informe forense técnico mensual en HTML."""
    print("📧 [INFORME MENSUAL] Generando informe...")
    try:
        servicios   = _estado_servicios()
        metricas    = _leer_metricas()
        token_meli  = _token_meli_valido()
        pend        = _contar_preguntas_pendientes()
        casos_ia    = _contar_casos_entrenamiento()
        mes_año     = datetime.now().strftime("%B %Y").capitalize()

        html = _generar_html(servicios, metricas, token_meli, pend, casos_ia, mes_año)

        msg = MIMEMultipart("alternative")
        msg["From"]    = REMITENTE
        msg["To"]      = DESTINATARIO
        msg["Subject"] = f"📊 Informe Forense Técnico — {mes_año} | Hugo García · McKenna Group"
        msg.attach(MIMEText(html, "html", "utf-8"))

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(REMITENTE, PASSWORD)
        server.send_message(msg)
        server.quit()

        print(f"✅ [INFORME MENSUAL] Enviado a {DESTINATARIO}")
        return True
    except Exception as e:
        print(f"❌ [INFORME MENSUAL] Error: {e}")
        return False


if __name__ == "__main__":
    enviar_informe_mensual()
