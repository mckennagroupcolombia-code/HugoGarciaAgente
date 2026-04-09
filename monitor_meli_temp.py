def _monitor_preguntas_sin_responder():
    """
    Cada 10 minutos consulta MeLi por preguntas sin responder.
    - Si encuentra una nueva → la procesa por el flujo de preventa.
    - Si ya está en cola (pendiente) desde hace más de 10 min → re-notifica al grupo.
    """
    import json
    from datetime import datetime, timedelta

    PENDIENTES_PATH = 'app/data/preguntas_pendientes_preventa.json'
    GRUPO = os.getenv('GRUPO_PREVENTA_WA', '120363393955474672@g.us')
    INTERVALO = 1800  # 30 minutos

    while True:
        time.sleep(INTERVALO)
        try:
            token = refrescar_token_meli()
            if not token:
                continue

            res = requests.get(
                'https://api.mercadolibre.com/my/received_questions/search?status=UNANSWERED&limit=20',
                headers={'Authorization': f'Bearer {token}'},
                timeout=15
            )
            if res.status_code != 200:
                continue

            preguntas_meli = res.json().get('questions', [])

            # Leer cola local
            try:
                with open(PENDIENTES_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                pendientes = data.get('preguntas', [])
            except Exception:
                pendientes = []

            ids_unanswered_meli = {str(q['id']) for q in preguntas_meli}
            ids_conocidos = {str(p['question_id']) for p in pendientes}
            modificado = False
            ahora = datetime.now()

            # Auto-marcar como respondidas las que ya no están en UNANSWERED de MeLi
            for p in pendientes:
                if not p.get('respondida') and str(p['question_id']) not in ids_unanswered_meli:
                    p['respondida'] = True
                    p['nota'] = f'Auto-marcada respondida por monitor {ahora.date()}'
                    modificado = True
                    print(f"✅ [MONITOR] Auto-marcada respondida: {p['question_id']}")

            # Procesar nuevas y enviar recordatorios solo de las realmente pendientes en MeLi
            for q in preguntas_meli:
                qid = str(q['id'])

                if qid not in ids_conocidos:
                    # Nueva — procesar por flujo preventa
                    print(f"🔍 [MONITOR] Nueva pregunta detectada: {qid}")
                    hilo = threading.Thread(target=procesar_nueva_pregunta, args=(qid,), daemon=True)
                    hilo.start()
                else:
                    # Ya en cola y confirmada UNANSWERED en MeLi → reintentar IA, o recordatorio
                    p = next((x for x in pendientes if str(x['question_id']) == qid and not x.get('respondida')), None)
                    if p:
                        ts = datetime.fromisoformat(p['timestamp'])
                        minutos = (ahora - ts).total_seconds() / 60
                        if minutos >= 30:
                            # Intentar responder automáticamente antes de escalar al humano
                            titulo = p.get('titulo_producto', '')
                            pregunta_txt = p.get('pregunta', '')
                            respondida_ahora = False
                            try:
                                from app.services.google_services import buscar_ficha_tecnica_producto
                                from app.services.meli_preventa import (
                                    generar_respuesta_con_ficha, guardar_caso_preventa
                                )
                                ficha = buscar_ficha_tecnica_producto(titulo)
                                if ficha:
                                    respuesta_ia = generar_respuesta_con_ficha(titulo, pregunta_txt, ficha)
                                    if respuesta_ia:
                                        token_r = refrescar_token_meli()
                                        r_ans = requests.post(
                                            'https://api.mercadolibre.com/answers',
                                            headers={'Authorization': f'Bearer {token_r}', 'Content-Type': 'application/json'},
                                            json={'question_id': int(qid), 'text': respuesta_ia},
                                            timeout=10,
                                        )
                                        if r_ans.status_code == 200:
                                            p['respondida'] = True
                                            p['nota'] = f'Respondida automáticamente por monitor (reintento) {ahora.date()}'
                                            guardar_caso_preventa(titulo, pregunta_txt, respuesta_ia)
                                            respondida_ahora = True
                                            print(f"✅ [MONITOR] Pregunta {qid} respondida automáticamente en reintento.")
                                            enviar_whatsapp_reporte(
                                                f"✅ *PREVENTA RESPONDIDA (reintento)*\n"
                                                f"📦 Producto: {titulo}\n"
                                                f"🗣 Cliente: {pregunta_txt}\n"
                                                f"🤖 IA Respondió: {respuesta_ia[:300]}",
                                                numero_destino=GRUPO
                                            )
                            except Exception as e_retry:
                                print(f"⚠️ [MONITOR] Reintento IA falló para {qid}: {e_retry}")

                            if not respondida_ahora:
                                # IA no pudo → recordatorio al humano
                                sufijo = qid[-3:]
                                enviar_whatsapp_reporte(
                                    f"⏰ *RECORDATORIO PREVENTA PENDIENTE*\n"
                                    f"📦 Producto: {titulo}\n"
                                    f"🗣 Cliente: {pregunta_txt}\n"
                                    f"⌛ Sin responder hace {int(minutos)} min\n\n"
                                    f"✍️ Escribe: resp {sufijo}: tu respuesta",
                                    numero_destino=GRUPO
                                )

                            # Actualizar timestamp para no re-ejecutar hasta 30 min después
                            p['timestamp'] = ahora.isoformat()
                            modificado = True

            # Persistir cualquier cambio en pendientes (auto-marcadas + reintentos)
            if modificado:
                try:
                    with open(PENDIENTES_PATH, 'w', encoding='utf-8') as f:
                        json.dump({'preguntas': pendientes}, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass

        except Exception as e:
            print(f"⚠️ [MONITOR] Error en ciclo de revisión: {e}")


threading.Thread(target=_monitor_preguntas_sin_responder, daemon=True).start()
