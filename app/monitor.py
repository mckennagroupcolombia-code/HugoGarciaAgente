"""
Monitor de alertas proactivas — McKenna Group
Corre como daemon thread dentro de webhook_meli.
"""
import threading
import time
import subprocess
import json
import os
from datetime import datetime, timedelta

# Importación lazy para evitar dependencias circulares al arrancar
_enviar_whatsapp = None

def _get_enviar():
    global _enviar_whatsapp
    if _enviar_whatsapp is None:
        from app.utils import enviar_whatsapp_reporte
        _enviar_whatsapp = enviar_whatsapp_reporte
    return _enviar_whatsapp

GRUPO = os.getenv('GRUPO_CONTABILIDAD_WA', '120363407538342427@g.us')
METRICAS_PATH = os.path.join(os.path.dirname(__file__), 'data', 'metricas_diarias.json')


# ---------------------------------------------------------------------------
# MÉTRICAS DIARIAS
# ---------------------------------------------------------------------------

def leer_metricas():
    hoy = datetime.now().strftime('%Y-%m-%d')
    try:
        with open(METRICAS_PATH, 'r') as f:
            data = json.load(f)
        if data.get('fecha') != hoy:
            raise ValueError('fecha distinta')
        return data
    except Exception:
        return {
            'fecha': hoy,
            'mensajes_whatsapp': 0,
            'preguntas_meli': 0,
            'pagos_confirmados': 0,
            'ordenes_sincronizadas': 0,
        }


def guardar_metricas(data):
    try:
        os.makedirs(os.path.dirname(METRICAS_PATH), exist_ok=True)
        with open(METRICAS_PATH, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"❌ Monitor: error guardando métricas: {e}")


def incrementar_metrica(campo):
    data = leer_metricas()
    data[campo] = data.get(campo, 0) + 1
    guardar_metricas(data)


# ---------------------------------------------------------------------------
# ALERTA 1 — Servicios caídos (cada 5 min)
# ---------------------------------------------------------------------------

def verificar_servicios():
    import requests as req
    servicios = [
        ('webhook-meli',    8080, '/status'),
        ('agente-pro',      8081, '/status'),
        ('whatsapp-bridge', 3000, None),
    ]
    for nombre, puerto, path in servicios:
        url = f'http://localhost:{puerto}{path or ""}'
        try:
            req.get(url, timeout=5)
            print(f"🔍 Monitor: {nombre} OK")
        except Exception:
            print(f"🔴 Monitor: {nombre} NO RESPONDE — reiniciando...")
            _get_enviar()(
                f"🔴 ALERTA SISTEMA\n"
                f"❌ {nombre} (puerto {puerto}) no responde\n"
                f"🔄 Intentando reinicio automático...",
                numero_destino=GRUPO
            )
            try:
                subprocess.run(['sudo', 'systemctl', 'restart', nombre],
                               timeout=30, check=False)
            except Exception as e:
                print(f"❌ Monitor: error reiniciando {nombre}: {e}")


# ---------------------------------------------------------------------------
# ALERTA 2 — Preguntas MeLi sin responder (cada 30 min)
# ---------------------------------------------------------------------------

def verificar_preguntas_meli():
    import requests as req
    try:
        from app.utils import refrescar_token_meli
        token = refrescar_token_meli()
        if not token:
            print("🔍 Monitor: preguntas MeLi — sin token")
            return

        url = "https://api.mercadolibre.com/my/received_questions/search?status=UNANSWERED&limit=50"
        res = req.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if res.status_code != 200:
            print(f"🔍 Monitor: preguntas MeLi — API devolvió {res.status_code}")
            return

        preguntas = res.json().get('questions', [])
        n = len(preguntas)
        print(f"🔍 Monitor: preguntas MeLi sin responder = {n}")

        if n > 3:
            ultima = preguntas[0].get('text', '') if preguntas else ''
            _get_enviar()(
                f"⚠️ PREGUNTAS MELI SIN RESPONDER: {n} preguntas pendientes\n"
                f"Última: '{ultima[:50]}...'",
                numero_destino=GRUPO
            )
    except Exception as e:
        print(f"❌ Monitor: error verificando preguntas MeLi: {e}")


# ---------------------------------------------------------------------------
# ALERTA 3 — Comprobantes sin confirmar (cada 15 min)
# ---------------------------------------------------------------------------

def verificar_comprobantes_pendientes():
    try:
        # Importación lazy para acceder al dict en memoria de routes.py
        from app.routes import pagos_pendientes_confirmacion
        ahora = time.time()
        for numero, info in list(pagos_pendientes_confirmacion.items()):
            if info.get('confirmado'):
                continue
            minutos = int((ahora - info.get('timestamp', ahora)) / 60)
            if minutos >= 30:
                print(f"💰 Monitor: pago pendiente {numero} hace {minutos} min")
                _get_enviar()(
                    f"💰 PAGO PENDIENTE\n"
                    f"Cliente {numero} envió comprobante hace {minutos} minutos sin confirmar.\n"
                    f"Responde: 'ok confirmado {numero}'",
                    numero_destino=GRUPO
                )
    except Exception as e:
        print(f"❌ Monitor: error verificando comprobantes: {e}")


# ---------------------------------------------------------------------------
# ALERTA 4 — Stock crítico (8 AM diario)
# ---------------------------------------------------------------------------

def sync_stock_diario():
    try:
        from app.sync import sincronizar_todo
        print("🔍 Monitor: ejecutando sync de stock diario...")
        resultado = sincronizar_todo()
        if resultado:
            _get_enviar()(
                f"📦 REPORTE STOCK DIARIO\n{str(resultado)[:500]}",
                numero_destino=GRUPO
            )
    except Exception as e:
        print(f"❌ Monitor: error en sync stock diario: {e}")


# ---------------------------------------------------------------------------
# ALERTA 5 — Resumen diario (7 PM)
# ---------------------------------------------------------------------------

def enviar_resumen_diario():
    try:
        metricas = leer_metricas()

        # Servicios activos
        import requests as req
        servicios_activos = 0
        for puerto, path in [(8080, '/status'), (8081, '/status'), (3000, None)]:
            try:
                req.get(f'http://localhost:{puerto}{path or ""}', timeout=3)
                servicios_activos += 1
            except Exception:
                pass

        msg = (
            f"📊 RESUMEN DEL DÍA — McKenna Group\n"
            f"✅ Servicios activos: {servicios_activos}/3\n"
            f"💬 Mensajes WhatsApp atendidos: {metricas.get('mensajes_whatsapp', 0)}\n"
            f"🛒 Preguntas MeLi respondidas: {metricas.get('preguntas_meli', 0)}\n"
            f"💰 Pagos confirmados: {metricas.get('pagos_confirmados', 0)}\n"
            f"📦 Órdenes sincronizadas: {metricas.get('ordenes_sincronizadas', 0)}"
        )
        print(f"🔍 Monitor: enviando resumen diario")
        _get_enviar()(msg, numero_destino=GRUPO)
    except Exception as e:
        print(f"❌ Monitor: error en resumen diario: {e}")


# ---------------------------------------------------------------------------
# ALERTA 6 — Token MeLi por vencer (cada 6 horas)
# ---------------------------------------------------------------------------

def verificar_token_meli():
    try:
        creds_path = os.getenv('MELI_CREDS_PATH', 'credenciales_meli.json')
        with open(creds_path, 'r') as f:
            creds = json.load(f)

        vencimiento = creds.get('token_vencimiento')
        if not vencimiento:
            print("🔍 Monitor: token MeLi — sin campo token_vencimiento, omitiendo")
            return

        vence_en = datetime.fromisoformat(str(vencimiento)) - datetime.now()
        minutos_restantes = vence_en.total_seconds() / 60
        print(f"🔍 Monitor: token MeLi vence en {int(minutos_restantes)} min")

        if minutos_restantes < 60:
            print("🔄 Monitor: refrescando token MeLi...")
            from app.utils import refrescar_token_meli
            refrescar_token_meli()
            print("✅ Monitor: token MeLi refrescado")
    except Exception as e:
        print(f"❌ Monitor: error verificando token MeLi: {e}")


# ---------------------------------------------------------------------------
# LOOP PRINCIPAL
# ---------------------------------------------------------------------------

def monitor_loop():
    contadores = {
        'servicios':    0,
        'preguntas':    0,
        'comprobantes': 0,
        'token_meli':   0,
        'stock_dia':    -1,
        'resumen_dia':  -1,
    }

    # Esperar 60s al arrancar para que los servicios terminen de iniciar
    time.sleep(60)
    print("✅ Monitor de alertas activo")

    while True:
        try:
            ahora = datetime.now()
            contadores['servicios']    += 1
            contadores['preguntas']    += 1
            contadores['comprobantes'] += 1
            contadores['token_meli']   += 1

            # Cada 5 minutos
            if contadores['servicios'] >= 5:
                verificar_servicios()
                contadores['servicios'] = 0

            # Cada 15 minutos
            if contadores['comprobantes'] >= 15:
                verificar_comprobantes_pendientes()
                contadores['comprobantes'] = 0

            # Cada 30 minutos
            if contadores['preguntas'] >= 30:
                threading.Thread(target=verificar_preguntas_meli, daemon=True).start()
                contadores['preguntas'] = 0

            # Cada 6 horas (360 minutos)
            if contadores['token_meli'] >= 360:
                threading.Thread(target=verificar_token_meli, daemon=True).start()
                contadores['token_meli'] = 0

            # A las 8 AM (una vez al día)
            if ahora.hour == 8 and contadores['stock_dia'] != ahora.day:
                threading.Thread(target=sync_stock_diario, daemon=True).start()
                contadores['stock_dia'] = ahora.day

            # A las 7 PM (una vez al día)
            if ahora.hour == 19 and contadores['resumen_dia'] != ahora.day:
                threading.Thread(target=enviar_resumen_diario, daemon=True).start()
                contadores['resumen_dia'] = ahora.day

        except Exception as e:
            print(f"❌ Monitor: error en loop principal: {e}")

        time.sleep(60)  # tick cada minuto


def iniciar_monitor():
    t = threading.Thread(target=monitor_loop, daemon=True, name='monitor-alertas')
    t.start()
    print("✅ Monitor de alertas iniciado")
