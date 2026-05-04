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
    meli_postventa_id_mensaje,
    meli_postventa_remitente_user_id,
)

# Importación lazy para evitar dependencias circulares al arrancar
_enviar_whatsapp = None


def _get_enviar():
    global _enviar_whatsapp
    if _enviar_whatsapp is None:
        from app.utils import enviar_whatsapp_reporte

        _enviar_whatsapp = enviar_whatsapp_reporte
    return _enviar_whatsapp


def _sort_key_meli_msg(m: dict) -> str:
    """Misma heurística de fecha que scripts/postventa_cola_meli (API no garantiza orden)."""
    if not isinstance(m, dict):
        return ""
    msg_date = m.get("message_date")
    if isinstance(msg_date, dict):
        return str(
            msg_date.get("created")
            or msg_date.get("received")
            or msg_date.get("available")
            or msg_date.get("notified")
            or ""
        )
    return str(
        m.get("date")
        or m.get("date_created")
        or m.get("message_date")
        or m.get("timestamp")
        or ""
    )


def _monitor_postventa_meli_polling():
    """
    Fallback para postventa: MeLi no siempre manda topic messages al webhook.
    Revisa órdenes recientes y usa el mismo dedupe de meli_postventa_notif.
    """
    from app.meli_postventa_notif import procesar_postventa_meli_desde_webhook
    from app.utils import obtener_seller_id_meli, refrescar_token_meli

    intervalo = int(os.getenv("POSTVENTA_POLL_INTERVALO_SEG", "300"))
    limite = int(os.getenv("POSTVENTA_POLL_ORDENES_LIMIT", "50"))
    time.sleep(45)
    while True:
        try:
            token = refrescar_token_meli()
            seller_id = obtener_seller_id_meli()
            if token and seller_id:
                r = requests.get(
                    f"https://api.mercadolibre.com/orders/search?seller={seller_id}&sort=date_desc&limit={limite}",
                    headers={"Authorization": f"Bearer {token}", "x-version": "2"},
                    timeout=15,
                )
                if r.status_code == 200:
                    for orden in r.json().get("results", []) or []:
                        oid = str(orden.get("pack_id") or orden.get("id") or "").strip()
                        if oid:
                            procesar_postventa_meli_desde_webhook(
                                f"/messages/packs/{oid}",
                                reconciliar_existentes=True,
                            )
                else:
                    print(f"⚠️ [POSTVENTA-POLL] orders/search HTTP {r.status_code}: {r.text[:200]}")
        except Exception as e:
            print(f"⚠️ [POSTVENTA-POLL] Error: {e}")
            threading.Thread(
                target=_autocorregir_y_reportar,
                args=("Error polling postventa MeLi", str(e), "postventa_polling"),
                daemon=True,
            ).start()
        time.sleep(intervalo)


# Grupos por tipo de alerta
GRUPO_SISTEMAS = os.getenv("GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us")
GRUPO_COMPROBANTES = os.getenv(
    "GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us"
)
GRUPO_STOCK = jid_grupo_inventario_wa()
GRUPO_RESUMEN = os.getenv("GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us")

METRICAS_PATH = os.path.join(os.path.dirname(__file__), "data", "metricas_diarias.json")


def _autocorregir_y_reportar(error: str, contexto: str, origen: str) -> None:
    """
    Usa autocorrector local (Gemma + OpenHands) y manda reporte a alertas sistemas.
    Import lazy para evitar ciclos con monitor/core.
    """
    try:
        from app.services.autocorrector import manejar_incidente_autocorreccion
        from app.utils import jid_grupo_alertas_sistemas_wa

        resultado = manejar_incidente_autocorreccion(
            error=error[:1000],
            contexto=contexto[:6000],
            origen=origen,
        )
        ok = bool(resultado.get("ok"))
        reflexion = str(resultado.get("reflexion", ""))[:700]
        oh = resultado.get("resultado_openhands", {}) or {}
        resumen_oh = str(oh)[:700]
        _get_enviar()(
            (
                f"{'✅' if ok else '⚠️'} *AUTOCORRECCIÓN {'EXITOSA' if ok else 'SIN FIX COMPLETO'}*\n"
                f"Origen: {origen}\n"
                f"Error: {error[:220]}\n"
                f"Reflexión local: {reflexion or 'N/A'}\n"
                f"Resultado OpenHands: {resumen_oh or 'N/A'}"
            ),
            numero_destino=jid_grupo_alertas_sistemas_wa(),
        )
    except Exception as e:
        print(f"❌ Monitor: error autocorrección/reportería: {e}")


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
        except Exception as e_check:
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
                threading.Thread(
                    target=_autocorregir_y_reportar,
                    args=(
                        f"Servicio caído: {nombre} ({puerto})",
                        f"url={url} exception={e_check}",
                        "monitor_servicios",
                    ),
                    daemon=True,
                ).start()
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
                                threading.Thread(
                                    target=_autocorregir_y_reportar,
                                    args=(
                                        f"Fallo reintento preventa qid={qid}",
                                        f"producto={titulo} pregunta={pregunta_txt} error={e_retry}",
                                        "monitor_preventa_retry",
                                    ),
                                    daemon=True,
                                ).start()

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
            threading.Thread(
                target=_autocorregir_y_reportar,
                args=(
                    "Error ciclo monitor preventa",
                    str(e),
                    "monitor_preventa_loop",
                ),
                daemon=True,
            ).start()


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


def _supervisar_colas_meli():
    """
    Supervisor operativo de colas humanas:
    - Preventa pendiente estancada
    - Postventa pendiente estancada
    Envia alertas accionables y resumen a alertas sistemas.
    """
    path_preventa = os.path.join(
        os.path.dirname(__file__), "data", "preguntas_pendientes_preventa.json"
    )
    path_postventa = os.path.join(
        os.path.dirname(__file__), "data", "mensajes_posventa_pendientes.json"
    )
    intervalo = int(os.getenv("SUPERVISOR_COLAS_INTERVALO_SEG", "600"))
    umbral_preventa = int(os.getenv("SUPERVISOR_PREVENTA_UMBRAL_MIN", "35"))
    umbral_postventa = int(os.getenv("SUPERVISOR_POSTVENTA_UMBRAL_MIN", "30"))
    cooldown_preventa_min = int(os.getenv("SUPERVISOR_PREVENTA_COOLDOWN_MIN", "45"))
    cooldown_postventa_min = int(os.getenv("SUPERVISOR_POSTVENTA_COOLDOWN_MIN", "45"))
    cooldown_resumen_min = int(os.getenv("SUPERVISOR_RESUMEN_COOLDOWN_MIN", "45"))
    cooldown_preventa_seg = max(60, cooldown_preventa_min * 60)
    cooldown_postventa_seg = max(60, cooldown_postventa_min * 60)
    cooldown_resumen_seg = max(60, cooldown_resumen_min * 60)
    enviar = _get_enviar()
    ultima_alerta_preventa: dict[str, float] = {}
    ultima_alerta_postventa: dict[str, float] = {}
    ultima_alerta_resumen: float = 0.0

    def _parse_ts(raw: str, ahora: datetime) -> datetime:
        try:
            ts = datetime.fromisoformat(str(raw).replace("Z", ""))
            if ts.tzinfo is not None:
                ts = ts.replace(tzinfo=None)
            return ts
        except Exception:
            return ahora

    while True:
        try:
            ahora = datetime.now()
            ahora_epoch = time.time()
            atascadas_preventa = []
            atascadas_postventa = []
            token_meli = None
            seller_id = None

            def _token() -> str | None:
                nonlocal token_meli
                if token_meli is None:
                    try:
                        from app.utils import refrescar_token_meli

                        token_meli = refrescar_token_meli()
                    except Exception:
                        token_meli = None
                return token_meli

            def _seller() -> str | None:
                nonlocal seller_id
                if seller_id is None:
                    try:
                        from app.utils import obtener_seller_id_meli

                        seller_id = str(obtener_seller_id_meli() or "")
                    except Exception:
                        seller_id = ""
                return seller_id or None

            # Preventa
            try:
                with open(path_preventa, "r", encoding="utf-8") as f:
                    data_prev = json.load(f)
                pendientes_prev = data_prev.get("preguntas", [])
                prev_modificado = False
                tok = _token()
                for p in data_prev.get("preguntas", []):
                    if p.get("respondida"):
                        continue
                    # Reconciliar en vivo contra estado MeLi para evitar falsos positivos.
                    qid = str(p.get("question_id", "")).strip()
                    if tok and qid:
                        try:
                            r_q = requests.get(
                                f"https://api.mercadolibre.com/questions/{qid}?api_version=4",
                                headers={"Authorization": f"Bearer {tok}"},
                                timeout=8,
                            )
                            if r_q.status_code == 200:
                                q_status = str(r_q.json().get("status", "")).upper()
                                if q_status != "UNANSWERED":
                                    p["respondida"] = True
                                    p["nota"] = (
                                        f"Auto-marcada respondida por supervisor {ahora.date()}"
                                    )
                                    prev_modificado = True
                                    continue
                        except Exception:
                            pass
                    ts = _parse_ts(p.get("timestamp", ""), ahora)
                    mins = int(max(0, (ahora - ts).total_seconds() / 60))
                    if mins >= umbral_preventa:
                        atascadas_preventa.append(
                            {
                                "id": str(p.get("question_id", "")),
                                "producto": str(p.get("titulo_producto", "")),
                                "pregunta": str(p.get("pregunta", "")),
                                "mins": mins,
                            }
                        )
                if prev_modificado:
                    _guardar_pendientes_monitor(path_preventa, pendientes_prev)
            except Exception as e_prev:
                print(f"⚠️ [SUPERVISOR] Error leyendo preventa pendientes: {e_prev}")

            # Postventa
            try:
                with open(path_postventa, "r", encoding="utf-8") as f:
                    data_post = json.load(f)
                pendientes_post = (data_post.get("pendientes", {}) or {}).copy()
                post_modificado = False
                tok = _token()
                sid = _seller()
                for codigo, item in list((data_post.get("pendientes", {}) or {}).items()):
                    # Reconciliar estado del pack: si vendedor ya habló después del msg pendiente, cerrar cola.
                    # Ordenar por fecha: sin esto, enumerate(msgs) puede poner "último seller" mal y el supervisor
                    # re-alerta en bucle aunque MeLi ya tenga conversación al día.
                    if tok and sid and item.get("pack_id"):
                        try:
                            pack_id = str(item.get("pack_id"))
                            r_m = requests.get(
                                f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{sid}?tag=post_sale",
                                headers={"Authorization": f"Bearer {tok}", "x-version": "2"},
                                timeout=10,
                            )
                            if r_m.status_code == 200:
                                data_m = r_m.json()
                                conv = data_m.get("conversation_status") or {}
                                if (
                                    conv.get("status") == "blocked"
                                    and conv.get("substatus") == "blocked_by_cancelled_order"
                                ):
                                    pendientes_post.pop(str(codigo), None)
                                    post_modificado = True
                                    print(
                                        f"✅ [SUPERVISOR] Quitado postventa {codigo}: orden cancelada/bloqueada."
                                    )
                                    continue
                                raw = data_m.get("messages", []) or []
                                msgs = sorted(
                                    [m for m in raw if isinstance(m, dict)],
                                    key=_sort_key_meli_msg,
                                )
                                sid_s = str(sid)
                                pending_msg_id = str(item.get("msg_id", "")).strip()

                                if not msgs:
                                    if pending_msg_id:
                                        pendientes_post.pop(str(codigo), None)
                                        post_modificado = True
                                        continue
                                else:
                                    # Misma regla operativa que postventa_cola_meli --limpiar-ya-respondidos
                                    last_u = meli_postventa_remitente_user_id(msgs[-1])
                                    if last_u and str(last_u) == sid_s:
                                        pendientes_post.pop(str(codigo), None)
                                        post_modificado = True
                                        continue

                                    idx_pend = -1
                                    for idx, m in enumerate(msgs):
                                        mid = str(meli_postventa_id_mensaje(m) or "")
                                        if pending_msg_id and mid == pending_msg_id:
                                            idx_pend = idx
                                            break
                                    if idx_pend == -1:
                                        pendientes_post.pop(str(codigo), None)
                                        post_modificado = True
                                        continue

                                    for m2 in msgs[idx_pend + 1 :]:
                                        u = meli_postventa_remitente_user_id(m2)
                                        if u and str(u) == sid_s:
                                            pendientes_post.pop(str(codigo), None)
                                            post_modificado = True
                                            break
                                    if not pendientes_post.get(str(codigo)):
                                        continue
                        except Exception:
                            pass

                    ts = _parse_ts(item.get("timestamp", ""), ahora)
                    mins = int(max(0, (ahora - ts).total_seconds() / 60))
                    if mins >= umbral_postventa:
                        atascadas_postventa.append(
                            {
                                "codigo": str(codigo),
                                "pack_id": str(item.get("pack_id", "")),
                                "comprador": str(item.get("comprador", "")),
                                "texto": str(item.get("texto", "")),
                                "mins": mins,
                            }
                        )
                if post_modificado:
                    data_post["pendientes"] = pendientes_post
                    with open(path_postventa, "w", encoding="utf-8") as f:
                        json.dump(data_post, f, indent=2, ensure_ascii=False)
            except Exception as e_post:
                print(f"⚠️ [SUPERVISOR] Error leyendo postventa pendientes: {e_post}")

            # Alertas operativas
            if atascadas_preventa:
                top = sorted(atascadas_preventa, key=lambda x: x["mins"], reverse=True)[0]
                qid = top["id"]
                sufijo = qid[-3:] if len(qid) >= 3 else qid
                ult = float(ultima_alerta_preventa.get(qid, 0))
                if (ahora_epoch - ult) >= cooldown_preventa_seg:
                    enviar(
                        f"🚨 *SUPERVISOR PREVENTA*\n"
                        f"Hay {len(atascadas_preventa)} pregunta(s) sin respuesta > {umbral_preventa} min.\n"
                        f"📦 Más antigua: {top['producto']}\n"
                        f"🗣 {top['pregunta'][:200]}\n"
                        f"⌛ {top['mins']} min\n\n"
                        f"✍️ Responde con:\n"
                        f"`resp {sufijo}: tu respuesta`\n"
                        f"o mejor:\n"
                        f"`resp preventa {qid}: tu respuesta`",
                        numero_destino=jid_grupo_preventa_wa(),
                    )
                    ultima_alerta_preventa[qid] = ahora_epoch
                # Limpieza de memoria en claves viejas/no presentes
                activos_prev = {x["id"] for x in atascadas_preventa}
                for k in list(ultima_alerta_preventa.keys()):
                    if k not in activos_prev and (ahora_epoch - ultima_alerta_preventa[k]) > (
                        cooldown_preventa_seg * 4
                    ):
                        ultima_alerta_preventa.pop(k, None)

            if atascadas_postventa:
                top = sorted(atascadas_postventa, key=lambda x: x["mins"], reverse=True)[0]
                codigo = top["codigo"]
                ult = float(ultima_alerta_postventa.get(codigo, 0))
                if (ahora_epoch - ult) >= cooldown_postventa_seg:
                    enviar(
                        f"🚨 *SUPERVISOR POSTVENTA*\n"
                        f"Hay {len(atascadas_postventa)} mensaje(s) sin respuesta > {umbral_postventa} min.\n"
                        f"👤 Comprador: {top['comprador'] or 'N/A'}\n"
                        f"📦 Pack: {top['pack_id']} (código {top['codigo']})\n"
                        f"🗣 {top['texto'][:200]}\n"
                        f"⌛ {top['mins']} min\n\n"
                        f"✍️ Responde con:\n"
                        f"`posventa {top['codigo']}: tu respuesta`",
                        numero_destino=jid_grupo_postventa_wa(),
                    )
                    ultima_alerta_postventa[codigo] = ahora_epoch
                activos_post = {x["codigo"] for x in atascadas_postventa}
                for k in list(ultima_alerta_postventa.keys()):
                    if k not in activos_post and (ahora_epoch - ultima_alerta_postventa[k]) > (
                        cooldown_postventa_seg * 4
                    ):
                        ultima_alerta_postventa.pop(k, None)

            if atascadas_preventa or atascadas_postventa:
                if (ahora_epoch - ultima_alerta_resumen) >= cooldown_resumen_seg:
                    from app.utils import jid_grupo_alertas_sistemas_wa

                    enviar(
                        f"🟠 *SUPERVISOR COLAS MELI*\n"
                        f"Preventa atascadas: {len(atascadas_preventa)}\n"
                        f"Postventa atascadas: {len(atascadas_postventa)}\n"
                        f"Umbrales: preventa>{umbral_preventa}m, postventa>{umbral_postventa}m\n"
                        f"Cooldown preventa: {cooldown_preventa_min} min\n"
                        f"Cooldown postventa: {cooldown_postventa_min} min\n"
                        f"Cooldown resumen: {cooldown_resumen_min} min",
                        numero_destino=jid_grupo_alertas_sistemas_wa(),
                    )
                    ultima_alerta_resumen = ahora_epoch

        except Exception as e:
            print(f"❌ [SUPERVISOR] Error ciclo supervisor colas: {e}")
            threading.Thread(
                target=_autocorregir_y_reportar,
                args=(
                    "Error supervisor colas Meli",
                    str(e),
                    "monitor_supervisor_colas",
                ),
                daemon=True,
            ).start()
        time.sleep(intervalo)


# ---------------------------------------------------------------------------
# HEALTH-CHECK cada 24 h → solo GRUPO_ALERTAS_SISTEMAS_WA (Auditoría_Scripts)
# ---------------------------------------------------------------------------

def _health_check_preventa_postventa():
    """
    Una vez al día: diagnóstico preventa + postventa (APIs) y envío del
    resumen solo al grupo de alertas de sistemas / auditoría — no a preventa
    ni postventa operativos.
    """
    from app.utils import (
        refrescar_token_meli,
        jid_grupo_alertas_sistemas_wa,
        obtener_seller_id_meli,
    )

    INTERVALO = 86400  # 24 hours
    time.sleep(120)  # let services stabilize after boot

    while True:
        try:
            ahora = datetime.now().strftime("%Y-%m-%d %H:%M")
            errores = []
            advertencias = []
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

            try:
                from app.meli_webhook_incidents import ultimo_incidente

                last_msg = ultimo_incidente("postventa_webhook_recibido")
                if not last_msg:
                    advertencias.append(
                        "Postventa webhook: no hay eventos `messages` registrados; polling fallback activo"
                    )
                else:
                    mins = int(max(0, (time.time() - float(last_msg.get("ts", 0))) / 60))
                    if mins > 1440:
                        advertencias.append(
                            f"Postventa webhook: último `messages` hace {mins} min; polling fallback activo"
                        )
                    else:
                        ok_items.append(f"Postventa webhook: último `messages` hace {mins} min")
            except Exception as e:
                errores.append(f"Postventa webhook audit: {e}")

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

            if advertencias:
                reporte += "\n⚠️ *Advertencias:*\n"
                for adv in advertencias:
                    reporte += f"  • {adv}\n"

            enviar = _get_enviar()
            grupo_audit = jid_grupo_alertas_sistemas_wa()
            enviar(reporte, numero_destino=grupo_audit)
            print(
                f"📊 [HEALTH-CHECK] Reporte enviado a alertas sistemas ({grupo_audit}) — {estado_txt}"
            )

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
    threading.Thread(
        target=_supervisar_colas_meli,
        daemon=True,
        name="supervisor-colas-meli",
    ).start()
    threading.Thread(
        target=_monitor_postventa_meli_polling,
        daemon=True,
        name="monitor-postventa-polling",
    ).start()
    print(
        "✅ Monitor de alertas iniciado (preventa + postventa polling + supervisor colas + health-check)"
    )
