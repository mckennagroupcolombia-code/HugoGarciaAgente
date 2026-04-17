"""
Monitor de alertas proactivas — McKenna Group
Se inicia una sola vez desde agente_pro (puerto 8081) para evitar hilos duplicados.
"""

import threading
import time
import subprocess
import json
import os
import requests
from datetime import datetime, timedelta

from app.utils import (
    jid_grupo_inventario_wa,
    jid_grupo_preventa_wa,
    jid_grupo_postventa_wa,
)

# Importación lazy para evitar dependencias circulares al arrancar
_enviar_whatsapp = None


def _get_enviar():
    global _enviar_whatsapp
    if _enviar_whatsapp is None:
        from app.utils import enviar_whatsapp_reporte

        _enviar_whatsapp = enviar_whatsapp_reporte
    return _enviar_whatsapp


# Grupos por tipo de alerta
GRUPO_SISTEMAS = os.getenv("GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us")
GRUPO_COMPROBANTES = os.getenv(
    "GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us"
)
GRUPO_STOCK = jid_grupo_inventario_wa()
GRUPO_RESUMEN = os.getenv("GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us")

METRICAS_PATH = os.path.join(os.path.dirname(__file__), "data", "metricas_diarias.json")


# ---------------------------------------------------------------------------
# MÉTRICAS DIARIAS
# ---------------------------------------------------------------------------


def leer_metricas():
    hoy = datetime.now().strftime("%Y-%m-%d")
    try:
        with open(METRICAS_PATH, "r") as f:
            data = json.load(f)
        if data.get("fecha") != hoy:
            raise ValueError("fecha distinta")
        return data
    except Exception:
        return {
            "fecha": hoy,
            "mensajes_whatsapp": 0,
            "preguntas_meli": 0,
            "pagos_confirmados": 0,
            "ordenes_sincronizadas": 0,
        }


def guardar_metricas(data):
    try:
        os.makedirs(os.path.dirname(METRICAS_PATH), exist_ok=True)
        with open(METRICAS_PATH, "w") as f:
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
        ("webhook-meli", 8080, "/status"),
        ("agente-pro", 8081, "/status"),
        ("whatsapp-bridge", 3000, None),
    ]
    for nombre, puerto, path in servicios:
        url = f"http://localhost:{puerto}{path or ''}"
        try:
            req.get(url, timeout=5)
            print(f"🔍 Monitor: {nombre} OK")
        except Exception:
            print(f"🔴 Monitor: {nombre} NO RESPONDE — reiniciando...")
            _get_enviar()(
                f"🔴 ALERTA SISTEMA\n"
                f"❌ {nombre} (puerto {puerto}) no responde\n"
                f"🔄 Intentando reinicio automático...",
                numero_destino=GRUPO_SISTEMAS,
            )
            try:
                subprocess.run(
                    ["sudo", "systemctl", "restart", nombre], timeout=30, check=False
                )
            except Exception as e:
                print(f"❌ Monitor: error reiniciando {nombre}: {e}")


# ---------------------------------------------------------------------------
# ALERTA 2 — Comprobantes sin confirmar (cada 15 min)
# ---------------------------------------------------------------------------


def verificar_comprobantes_pendientes():
    try:
        # Importación lazy para acceder al dict en memoria de routes.py
        from app.routes import pagos_pendientes_confirmacion

        ahora = time.time()
        for numero, info in list(pagos_pendientes_confirmacion.items()):
            if info.get("confirmado"):
                continue
            minutos = int((ahora - info.get("timestamp", ahora)) / 60)
            if minutos >= 30:
                print(f"💰 Monitor: pago pendiente {numero} hace {minutos} min")
                _get_enviar()(
                    f"💰 PAGO PENDIENTE\n"
                    f"Cliente {numero} envió comprobante hace {minutos} minutos sin confirmar.\n"
                    f"Responde: 'ok confirmado {numero}'",
                    numero_destino=GRUPO_COMPROBANTES,
                )
    except Exception as e:
        print(f"❌ Monitor: error verificando comprobantes: {e}")


# ---------------------------------------------------------------------------
# ALERTA 4 — Stock crítico (8 AM diario)
# ---------------------------------------------------------------------------


def sync_stock_diario():
    """
    8:00 AM local (servidor): cruza MeLi ↔ columna F del Sheet y envía reporte
    a GRUPO_INVENTARIO_WA vía ejecutar_sincronizacion_y_reporte_stock().
    Nota: antes importaba sincronizar_todo (no existe en app.sync) → fallo silencioso diario.
    """
    try:
        from app.sync import ejecutar_sincronizacion_y_reporte_stock

        print("🔍 Monitor: ejecutando sync de stock diario...")
        resultado = ejecutar_sincronizacion_y_reporte_stock()
        res = str(resultado or "")
        # Éxito: ya envió el detalle al grupo inventario dentro de sync.py
        if "Reporte de stock enviado" not in res:
            _get_enviar()(
                f"📦 *REPORTE STOCK DIARIO* (sin envío automático completo)\n{res[:900]}",
                numero_destino=GRUPO_STOCK,
            )
    except Exception as e:
        print(f"❌ Monitor: error en sync stock diario: {e}")
        try:
            _get_enviar()(
                f"❌ *SYNC STOCK DIARIO FALLÓ*\n{e!s}"[:900],
                numero_destino=GRUPO_STOCK,
            )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# ALERTA 5 — Resumen diario (7 PM)
# ---------------------------------------------------------------------------


def enviar_resumen_diario():
    try:
        metricas = leer_metricas()

        # Servicios activos
        import requests as req

        servicios_activos = 0
        for puerto, path in [(8080, "/status"), (8081, "/status"), (3000, None)]:
            try:
                req.get(f"http://localhost:{puerto}{path or ''}", timeout=3)
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
        _get_enviar()(msg, numero_destino=GRUPO_RESUMEN)
    except Exception as e:
        print(f"❌ Monitor: error en resumen diario: {e}")


# ---------------------------------------------------------------------------
# ALERTA 6 — Token MeLi por vencer (cada 6 horas)
# ---------------------------------------------------------------------------


def verificar_token_meli():
    try:
        creds_path = os.getenv("MELI_CREDS_PATH", "credenciales_meli.json")
        with open(creds_path, "r") as f:
            creds = json.load(f)

        vencimiento = creds.get("token_vencimiento")
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

# ---------------------------------------------------------------------------
# ALERTA 7 — Fichas técnicas faltantes (REC-06, cada lunes 9 AM)
# ---------------------------------------------------------------------------


def verificar_fichas_tecnicas_faltantes():
    """Busca productos sin ficha técnica (columna I vacía) en Google Sheets."""
    try:
        import gspread

        CREDS_PATH = os.getenv(
            "GOOGLE_SERVICE_ACCOUNT_PATH",
            "/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json",
        )
        SPREADSHEET_ID = os.getenv(
            "SPREADSHEET_ID", "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
        )
        gc = gspread.service_account(filename=CREDS_PATH)
        wb = gc.open_by_key(SPREADSHEET_ID)
        try:
            sheet = wb.worksheet("BASE DE DATOS MCKENNA GROUP S.A.S")
        except Exception:
            sheet = wb.sheet1

        rows = sheet.get_all_values()[1:]
        sin_ficha = []
        for row in rows:
            nombre = row[3].strip() if len(row) > 3 else ""
            ficha = row[8].strip() if len(row) > 8 else ""
            if nombre and not ficha:
                sin_ficha.append(nombre)

        if sin_ficha:
            lista = "\n".join(f"  • {n}" for n in sin_ficha[:15])
            extra = f"\n  ...y {len(sin_ficha) - 15} más" if len(sin_ficha) > 15 else ""
            _get_enviar()(
                f"📋 *FICHAS TÉCNICAS FALTANTES* ({len(sin_ficha)} productos)\n\n"
                f"Los siguientes productos no tienen ficha técnica en Google Sheets "
                f"(columna I). Sin ficha, el agente no puede responder preguntas de "
                f"preventa automáticamente:\n\n{lista}{extra}\n\n"
                f"Por favor diligenciar en el catálogo para mejorar la automatización.",
                numero_destino=jid_grupo_preventa_wa(),
            )
            print(
                f"📋 Monitor: {len(sin_ficha)} producto(s) sin ficha técnica notificados"
            )
    except Exception as e:
        print(f"❌ Monitor: error verificando fichas técnicas: {e}")


def monitor_loop():
    contadores = {
        "servicios": 0,
        "comprobantes": 0,
        "token_meli": 0,
        "stock_dia": -1,
        "resumen_dia": -1,
        "fichas_sem": -1,
        "backup_dia": -1,
        "reporte_sem": -1,
        "informe_mes": -1,
    }

    # Esperar 60s al arrancar para que los servicios terminen de iniciar
    time.sleep(60)
    print("✅ Monitor de alertas activo")

    while True:
        try:
            ahora = datetime.now()
            contadores["servicios"] += 1
            contadores["comprobantes"] += 1
            contadores["token_meli"] += 1

            # Cada 5 minutos
            if contadores["servicios"] >= 5:
                verificar_servicios()
                contadores["servicios"] = 0

            # Cada 15 minutos
            if contadores["comprobantes"] >= 15:
                verificar_comprobantes_pendientes()
                contadores["comprobantes"] = 0

            # Cada 6 horas (360 minutos)
            if contadores["token_meli"] >= 360:
                threading.Thread(target=verificar_token_meli, daemon=True).start()
                contadores["token_meli"] = 0

            # A las 8 AM (una vez al día)
            if ahora.hour == 8 and contadores["stock_dia"] != ahora.day:
                threading.Thread(target=sync_stock_diario, daemon=True).start()
                contadores["stock_dia"] = ahora.day

            # A las 7 PM (una vez al día)
            if ahora.hour == 19 and contadores["resumen_dia"] != ahora.day:
                threading.Thread(target=enviar_resumen_diario, daemon=True).start()
                contadores["resumen_dia"] = ahora.day

            # REC-06: Lunes 9 AM — Fichas técnicas faltantes
            if (
                ahora.weekday() == 0
                and ahora.hour == 9
                and contadores["fichas_sem"] != ahora.isocalendar()[1]
            ):
                threading.Thread(
                    target=verificar_fichas_tecnicas_faltantes, daemon=True
                ).start()
                contadores["fichas_sem"] = ahora.isocalendar()[1]

            # REC-07: 2 AM — Backup nocturno en Drive
            if ahora.hour == 2 and contadores["backup_dia"] != ahora.day:

                def _backup():
                    from app.tools.backup_drive import ejecutar_backup

                    ejecutar_backup()

                threading.Thread(target=_backup, daemon=True).start()
                contadores["backup_dia"] = ahora.day

            # REC-08: Lunes 7 AM — Reporte financiero semanal
            if (
                ahora.weekday() == 0
                and ahora.hour == 7
                and contadores["reporte_sem"] != ahora.isocalendar()[1]
            ):

                def _reporte():
                    from app.tools.reporte_financiero import enviar_reporte_semanal

                    enviar_reporte_semanal()

                threading.Thread(target=_reporte, daemon=True).start()
                contadores["reporte_sem"] = ahora.isocalendar()[1]

            # Informe mensual: día 1 de cada mes, 8 AM
            if (
                ahora.day == 1
                and ahora.hour == 8
                and contadores["informe_mes"] != ahora.month
            ):

                def _informe():
                    from app.tools.informe_mensual import enviar_informe_mensual

                    enviar_informe_mensual()

                threading.Thread(target=_informe, daemon=True).start()
                contadores["informe_mes"] = ahora.month

        except Exception as e:
            print(f"❌ Monitor: error en loop principal: {e}")

        time.sleep(60)  # tick cada minuto


def _monitor_preguntas_sin_responder():
    """
    Cada 30 min consulta MeLi (UNANSWERED), sincroniza con preguntas_pendientes_preventa.json
    y reintenta IA o envía un solo recordatorio por ventana.

    KEY FIX: Only sends reminders for questions MeLi confirms are still UNANSWERED.
    Questions answered outside the system are auto-marked and never reminded.
    """
    import json
    from datetime import datetime

    from app.utils import refrescar_token_meli
    from preventa_meli import procesar_nueva_pregunta

    PENDIENTES_PATH = os.path.join(
        os.path.dirname(__file__), "data", "preguntas_pendientes_preventa.json"
    )
    INTERVALO = 1800  # 30 minutos
    enviar = _get_enviar()

    while True:
        time.sleep(INTERVALO)
        try:
            token = refrescar_token_meli()
            if not token:
                continue

            res = requests.get(
                "https://api.mercadolibre.com/my/received_questions/search?status=UNANSWERED&limit=20",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            if res.status_code != 200:
                continue

            preguntas_meli = res.json().get("questions", [])

            try:
                with open(PENDIENTES_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                pendientes = data.get("preguntas", [])
            except Exception:
                pendientes = []

            ids_unanswered_meli = {str(q["id"]) for q in preguntas_meli}
            ids_conocidos = {str(p["question_id"]) for p in pendientes}
            modificado = False
            ahora = datetime.now()
            grupo_prev = jid_grupo_preventa_wa()

            # Step 1: mark as responded any local pending that MeLi no longer lists as UNANSWERED
            for p in pendientes:
                if (
                    not p.get("respondida")
                    and str(p["question_id"]) not in ids_unanswered_meli
                ):
                    p["respondida"] = True
                    p["nota"] = f"Auto-marcada respondida por monitor {ahora.date()}"
                    modificado = True
                    print(f"✅ [MONITOR] Auto-marcada respondida: {p['question_id']}")

            # Step 2: process only questions MeLi confirms are still UNANSWERED
            for q in preguntas_meli:
                qid = str(q["id"])

                if qid not in ids_conocidos:
                    print(f"🔍 [MONITOR] Nueva pregunta detectada: {qid}")
                    threading.Thread(
                        target=procesar_nueva_pregunta, args=(qid,), daemon=True
                    ).start()
                else:
                    p = next(
                        (
                            x
                            for x in pendientes
                            if str(x["question_id"]) == qid and not x.get("respondida")
                        ),
                        None,
                    )
                    if p:
                        raw_ts = str(p.get("timestamp", "")).replace("Z", "")
                        try:
                            ts = datetime.fromisoformat(raw_ts)
                            if ts.tzinfo is not None:
                                ts = ts.replace(tzinfo=None)
                        except ValueError:
                            ts = ahora
                        minutos = max(0, (ahora - ts).total_seconds() / 60)
                        if minutos >= 30:
                            # Double-check: verify this specific question is still UNANSWERED
                            try:
                                r_check = requests.get(
                                    f"https://api.mercadolibre.com/questions/{qid}?api_version=4",
                                    headers={"Authorization": f"Bearer {token}"},
                                    timeout=10,
                                )
                                if r_check.status_code == 200:
                                    q_status = r_check.json().get("status", "").upper()
                                    if q_status != "UNANSWERED":
                                        p["respondida"] = True
                                        p["nota"] = f"Auto-marcada respondida (verificación directa) {ahora.date()}"
                                        modificado = True
                                        print(f"✅ [MONITOR] Pregunta {qid} ya respondida (status={q_status}), no se envía recordatorio")
                                        continue
                            except Exception:
                                pass

                            titulo = p.get("titulo_producto", "")
                            pregunta_txt = p.get("pregunta", "")
                            respondida_ahora = False
                            try:
                                from app.services.google_services import (
                                    buscar_ficha_tecnica_producto,
                                )
                                from app.services.meli_preventa import (
                                    generar_respuesta_con_ficha,
                                    guardar_caso_preventa,
                                )

                                ficha = buscar_ficha_tecnica_producto(titulo)
                                if ficha:
                                    respuesta_ia = generar_respuesta_con_ficha(
                                        titulo, pregunta_txt, ficha
                                    )
                                    if respuesta_ia:
                                        token_r = refrescar_token_meli()
                                        # Verify still unanswered right before posting
                                        r_pre = requests.get(
                                            f"https://api.mercadolibre.com/questions/{qid}?api_version=4",
                                            headers={"Authorization": f"Bearer {token_r}"},
                                            timeout=10,
                                        )
                                        if r_pre.status_code == 200 and r_pre.json().get("status", "").upper() != "UNANSWERED":
                                            p["respondida"] = True
                                            p["nota"] = f"Auto-marcada respondida (pre-answer check) {ahora.date()}"
                                            respondida_ahora = True
                                        else:
                                            r_ans = requests.post(
                                                "https://api.mercadolibre.com/answers",
                                                headers={
                                                    "Authorization": f"Bearer {token_r}",
                                                    "Content-Type": "application/json",
                                                },
                                                json={
                                                    "question_id": int(qid),
                                                    "text": respuesta_ia,
                                                },
                                                timeout=10,
                                            )
                                            if r_ans.status_code == 200:
                                                p["respondida"] = True
                                                p["nota"] = (
                                                    f"Respondida automáticamente por monitor (reintento) {ahora.date()}"
                                                )
                                                guardar_caso_preventa(
                                                    titulo, pregunta_txt, respuesta_ia
                                                )
                                                respondida_ahora = True
                                                print(
                                                    f"✅ [MONITOR] Pregunta {qid} respondida automáticamente en reintento."
                                                )
                                                enviar(
                                                    f"✅ *PREVENTA RESPONDIDA (reintento)*\n"
                                                    f"📦 Producto: {titulo}\n"
                                                    f"🗣 Cliente: {pregunta_txt}\n"
                                                    f"🤖 IA Respondió: {respuesta_ia[:300]}",
                                                    numero_destino=grupo_prev,
                                                )
                                            elif r_ans.status_code == 400 and "not_unanswered" in r_ans.text.lower():
                                                p["respondida"] = True
                                                p["nota"] = f"Auto-marcada respondida (400 not_unanswered) {ahora.date()}"
                                                respondida_ahora = True
                            except Exception as e_retry:
                                print(
                                    f"⚠️ [MONITOR] Reintento IA falló para {qid}: {e_retry}"
                                )

                            if not respondida_ahora:
                                sufijo = qid[-3:]
                                enviar(
                                    f"⏰ *RECORDATORIO PREVENTA PENDIENTE*\n"
                                    f"📦 Producto: {titulo}\n"
                                    f"🗣 Cliente: {pregunta_txt}\n"
                                    f"⌛ Sin responder hace {int(minutos)} min\n\n"
                                    f"✍️ Escribe: resp {sufijo}: tu respuesta",
                                    numero_destino=grupo_prev,
                                )

                            p["timestamp"] = ahora.isoformat()
                            modificado = True

            if modificado:
                _guardar_pendientes_monitor(PENDIENTES_PATH, pendientes)

        except Exception as e:
            print(f"⚠️ [MONITOR] Error en ciclo de revisión: {e}")


def _guardar_pendientes_monitor(path: str, pendientes: list):
    """Merge in-memory pending list with on-disk state (other threads may have written)."""
    import json

    try:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data_actual = json.load(f)
            pendientes_actual = data_actual.get("preguntas", [])
        except Exception:
            pendientes_actual = []

        estado_disco = {str(p["question_id"]): p for p in pendientes_actual}

        for p in pendientes:
            qid = str(p["question_id"])
            p_disco = estado_disco.get(qid)
            if p_disco and p_disco.get("respondida") and not p.get("respondida"):
                continue
            if p_disco:
                if p.get("respondida") and not p_disco.get("respondida"):
                    p_disco["respondida"] = True
                    p_disco["nota"] = p.get("nota", "")
                if p.get("timestamp") != p_disco.get("timestamp"):
                    p_disco["timestamp"] = p["timestamp"]

        ids_disco = set(estado_disco.keys())
        for p in pendientes:
            if str(p["question_id"]) not in ids_disco:
                pendientes_actual.append(p)

        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                {"preguntas": pendientes_actual},
                f,
                indent=2,
                ensure_ascii=False,
            )
    except Exception as e_write:
        print(f"⚠️ [MONITOR] Error escribiendo pendientes: {e_write}")


# ---------------------------------------------------------------------------
# HEALTH-CHECK cada 12 horas → alerta a grupo preventa y postventa
# ---------------------------------------------------------------------------

def _health_check_preventa_postventa():
    """
    Every 12 hours, run a full diagnostic of preventa + postventa pipelines
    and send a status report to both groups. If something fails, include the
    error log so the team knows exactly what's broken.
    """
    from app.utils import (
        refrescar_token_meli,
        jid_grupo_postventa_wa,
        obtener_seller_id_meli,
    )

    INTERVALO = 43200  # 12 hours
    time.sleep(120)  # let services stabilize after boot

    while True:
        try:
            ahora = datetime.now().strftime("%Y-%m-%d %H:%M")
            errores = []
            ok_items = []

            # 1. WhatsApp bridge
            try:
                r_wa = requests.get("http://localhost:3000/monitor/json", timeout=5)
                if r_wa.status_code == 200:
                    wa_data = r_wa.json()
                    if wa_data.get("sistemaListo") and wa_data.get("waSesionOperativa"):
                        ok_items.append("WhatsApp bridge: conectado")
                    else:
                        errores.append(
                            f"WhatsApp bridge: sistemaListo={wa_data.get('sistemaListo')}, "
                            f"sesion={wa_data.get('waSesionOperativa')}"
                        )
                else:
                    errores.append(f"WhatsApp bridge: HTTP {r_wa.status_code}")
            except Exception as e:
                errores.append(f"WhatsApp bridge: no responde ({e})")

            # 2. Webhook MeLi (8080)
            try:
                r_wh = requests.get("http://localhost:8080/status", timeout=5)
                if r_wh.status_code == 200:
                    ok_items.append("Webhook MeLi (8080): activo")
                else:
                    errores.append(f"Webhook MeLi (8080): HTTP {r_wh.status_code}")
            except Exception as e:
                errores.append(f"Webhook MeLi (8080): no responde ({e})")

            # 3. Agente (8081)
            try:
                r_ag = requests.get("http://localhost:8081/status", timeout=5)
                if r_ag.status_code == 200:
                    ok_items.append("Agente Hugo (8081): activo")
                else:
                    errores.append(f"Agente Hugo (8081): HTTP {r_ag.status_code}")
            except Exception as e:
                errores.append(f"Agente Hugo (8081): no responde ({e})")

            # 4. Token MeLi
            try:
                token = refrescar_token_meli()
                if token:
                    ok_items.append("Token MeLi: vigente")
                else:
                    errores.append("Token MeLi: no se pudo refrescar")
            except Exception as e:
                errores.append(f"Token MeLi: {e}")

            # 5. Preventa — check UNANSWERED count
            try:
                token = refrescar_token_meli()
                r_q = requests.get(
                    "https://api.mercadolibre.com/my/received_questions/search?status=UNANSWERED&limit=1",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if r_q.status_code == 200:
                    total = r_q.json().get("total", 0)
                    if total == 0:
                        ok_items.append("Preventa: 0 preguntas sin responder")
                    else:
                        ok_items.append(f"Preventa: {total} pregunta(s) sin responder")
                else:
                    errores.append(f"Preventa API: HTTP {r_q.status_code}")
            except Exception as e:
                errores.append(f"Preventa API: {e}")

            # 6. Postventa — check recent messages accessible
            try:
                token = refrescar_token_meli()
                seller_id = obtener_seller_id_meli()
                r_o = requests.get(
                    f"https://api.mercadolibre.com/orders/search?seller={seller_id}&sort=date_desc&limit=1",
                    headers={"Authorization": f"Bearer {token}", "x-version": "2"},
                    timeout=10,
                )
                if r_o.status_code == 200:
                    ok_items.append("Postventa API órdenes: accesible")
                else:
                    errores.append(f"Postventa API órdenes: HTTP {r_o.status_code}")
            except Exception as e:
                errores.append(f"Postventa API órdenes: {e}")

            # 7. Test WA send capability
            try:
                r_test = requests.post(
                    "http://localhost:3000/enviar",
                    json={"numero": "status@broadcast", "mensaje": "ping"},
                    timeout=5,
                )
                # 503 = not connected, 500 = send error, 200 = ok (broadcast will fail but proves connection)
                if r_test.status_code == 503:
                    errores.append("WhatsApp envío: bridge no listo (503)")
            except Exception as e:
                errores.append(f"WhatsApp envío: {e}")

            # Build report
            if errores:
                estado_emoji = "🔴"
                estado_txt = "CON FALLOS"
            else:
                estado_emoji = "🟢"
                estado_txt = "OPERATIVO"

            reporte = f"{estado_emoji} *STATUS COMUNICACIONES MELI — {estado_txt}*\n📅 {ahora}\n\n"

            if ok_items:
                reporte += "✅ *Operativo:*\n"
                for item in ok_items:
                    reporte += f"  • {item}\n"

            if errores:
                reporte += "\n❌ *Fallos detectados:*\n"
                for err in errores:
                    reporte += f"  • {err}\n"
                reporte += "\n⚠️ Revisar logs: `journalctl -u webhook-meli -n 50` o `journalctl -u mckenna-whatsapp-bridge -n 50`"

            enviar = _get_enviar()
            grupo_prev = jid_grupo_preventa_wa()
            grupo_post = jid_grupo_postventa_wa()

            enviar(reporte, numero_destino=grupo_prev)
            enviar(reporte, numero_destino=grupo_post)
            print(f"📊 [HEALTH-CHECK] Reporte enviado a preventa y postventa ({estado_txt})")

        except Exception as e:
            print(f"❌ [HEALTH-CHECK] Error en ciclo: {e}")

        time.sleep(INTERVALO)


_monitor_iniciado = False
_monitor_inicio_lock = threading.Lock()


def iniciar_monitor():
    global _monitor_iniciado
    with _monitor_inicio_lock:
        if _monitor_iniciado:
            print("ℹ️ Monitor de alertas ya estaba iniciado — omitiendo duplicado")
            return
        _monitor_iniciado = True
    threading.Thread(target=monitor_loop, daemon=True, name="monitor-alertas").start()
    threading.Thread(
        target=_monitor_preguntas_sin_responder,
        daemon=True,
        name="monitor-preventa-meli",
    ).start()
    threading.Thread(
        target=_health_check_preventa_postventa,
        daemon=True,
        name="health-check-meli",
    ).start()
    print("✅ Monitor de alertas iniciado (preventa MeLi + health-check 12h en hilos dedicados)")
