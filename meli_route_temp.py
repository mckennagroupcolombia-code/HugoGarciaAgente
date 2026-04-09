@app.route('/notifications', methods=['POST'])
def notifications():
    """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
    data = request.get_json()

    topic = data.get('topic') if data else None

    if topic == 'questions':
        resource = data.get('resource')
        if resource:
            question_id = resource.split('/')[-1]

            # Limpiar memoria antigua
            limpiar_preguntas_antiguas()

            # Verificar deduplicación
            if question_id in preguntas_procesadas:
                print(f"Pregunta {question_id} ya procesada. Omitiendo duplicado.")
            else:
                preguntas_procesadas[question_id] = time.time()
                hilo = threading.Thread(target=procesar_nueva_pregunta, args=(question_id,))
                hilo.start()
                try:
                    incrementar_metrica('preguntas_meli')
                except Exception:
                    pass

    elif topic == 'orders_v2':
        resource = data.get('resource', '')
        if resource:
            order_id = resource.split('/')[-1]
            print(f"🛒 [MELI] Nueva notificación de orden: {order_id}")
            hilo = threading.Thread(target=_procesar_orden_meli, args=(order_id,))
            hilo.start()
            try:
                incrementar_metrica('ordenes_meli')
            except Exception:
                pass

    elif topic == 'messages':
        resource = data.get('resource', '')
        if resource:
            # resource puede ser "/messages/packs/{pack_id}" o similar
            hilo = threading.Thread(target=_procesar_mensaje_posventa, args=(resource,), daemon=True)
            hilo.start()

    # Respondemos 200 OK inmediatamente
    return jsonify({"status": "ok"}), 200
