# Memoria para deduplicación de preguntas
preguntas_procesadas = {}

def limpiar_preguntas_antiguas():
    """Elimina del registro las preguntas procesadas hace más de 5 minutos."""
    ahora = time.time()
    # 300 segundos = 5 minutos
    para_borrar = [q_id for q_id, timestamp in preguntas_procesadas.items() if ahora - timestamp > 300]
    for q_id in para_borrar:
        del preguntas_procesadas[q_id]

def _procesar_orden_meli(order_id: str):
    """
    Obtiene los detalles de una orden de MeLi y descuenta el stock en WooCommerce
    por cada ítem vendido.
    """
    print(f"📦 [MELI-ORDER] Procesando orden {order_id} para sync de stock...")
    try:
        token = refrescar_token_meli()
        if not token:
            print(f"❌ [MELI-ORDER] No se pudo obtener token para orden {order_id}")
            return

        res = requests.get(
            f"https://api.mercadolibre.com/orders/{order_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15
        )
        if res.status_code != 200:
            print(f"⚠️ [MELI-ORDER] Error obteniendo orden {order_id}: {res.status_code}")
            return

        orden = res.json()
        if orden.get('status') not in ['paid', 'partially_paid']:
            print(f"⏭️ [MELI-ORDER] Orden {order_id} con estado '{orden.get('status')}' — ignorada.")
            return

        for item in orden.get('order_items', []):
            item_info = item.get('item', {})
            item_id = item_info.get('id', '')
            cantidad_vendida = item.get('quantity', 0)

            # Obtener SKU y stock post-venta del ítem desde MeLi
            # MeLi ya autodecrementó su available_quantity al procesar la orden.
            try:
                res_item = requests.get(
                    f"https://api.mercadolibre.com/items/{item_id}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10
                )
                if res_item.status_code == 200:
                    item_data = res_item.json()
                    sku = item_data.get('seller_custom_field', '')
                    stock_post_venta = item_data.get('available_quantity')
                else:
                    sku = ''
                    stock_post_venta = None
            except Exception:
                sku = ''
                stock_post_venta = None

            if not sku:
                print(f"⚠️ [MELI-ORDER] Ítem {item_id} sin SKU — no se puede sincronizar stock.")
                continue

            if stock_post_venta is None:
                # Fallback: calcular desde WooCommerce si no se pudo leer MeLi
                from app.services.woocommerce import obtener_stock_woocommerce
                stock_post_venta = max(0, obtener_stock_woocommerce(sku) - cantidad_vendida)
                print(f"⚠️ [MELI-ORDER] Usando fallback WC para SKU {sku}: {stock_post_venta} uds")

            # Sincronizar WooCommerce al nivel actual de MeLi (MeLi ya está actualizado)
            from app.services.woocommerce import actualizar_stock_woocommerce
            resultado_wc = actualizar_stock_woocommerce(sku, stock_post_venta)
            print(f"   └──> SKU {sku} | Stock MeLi post-venta: {stock_post_venta} | WC: {resultado_wc}")

    except Exception as e:
        print(f"❌ [MELI-ORDER] Error procesando orden {order_id}: {e}")


_POSVENTA_STATE_PATH = os.path.join('/home/mckg/mi-agente', 'app', 'data', 'mensajes_posventa_pendientes.json')
_SELLER_ID = 432439187


def _cargar_state_posventa() -> dict:
    try:
        if os.path.exists(_POSVENTA_STATE_PATH):
            with open(_POSVENTA_STATE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {"pendientes": {}, "procesados": []}


def _guardar_state_posventa(data: dict):
    os.makedirs(os.path.dirname(_POSVENTA_STATE_PATH), exist_ok=True)
    with open(_POSVENTA_STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _sufijo_pack(pack_id: str) -> str:
    """Últimos 4 dígitos del pack_id para comando corto."""
    digits = re.sub(r'\D', '', str(pack_id))
    return digits[-4:] if len(digits) >= 4 else digits


def _procesar_mensaje_posventa(resource: str):
    """
    Recibe notificación de mensaje postventa de MeLi.
    Si el mensaje es del comprador (no nuestro), alerta al grupo de WhatsApp
    con el comando de respuesta correcto: posventa <código>: <respuesta>

    Deduplicación por message_id (persistente en JSON), sin filtro por tiempo.
    """
    GRUPO = os.getenv('GRUPO_POSTVENTA_WA', '120363406693905719@g.us')
    try:
        token = refrescar_token_meli()
        if not token:
            return

        headers = {'Authorization': f'Bearer {token}'}

        # MeLi puede enviar el resource de dos formas:
        # 1. Como path: "/messages/packs/{pack_id}/sellers/{seller_id}"
        # 2. Como message_id directo: "019d52f0c31d7eb3b8f6437ac713c247"
        partes = resource.strip('/').split('/')
        pack_id = None
        for i, p in enumerate(partes):
            if p == 'packs' and i + 1 < len(partes):
                pack_id = partes[i + 1]
                break

        if not pack_id:
            # Es un message_id directo — consultar la API para obtener el pack
            msg_id_directo = resource.strip('/')
            print(f"🔍 [POSVENTA] Resource es message_id directo: {msg_id_directo}. Consultando API...")
            res_msg = requests.get(
                f'https://api.mercadolibre.com/messages/{msg_id_directo}',
                headers=headers, timeout=10
            )
            if res_msg.status_code != 200:
                print(f"⚠️ [POSVENTA] No se pudo obtener el mensaje {msg_id_directo}: {res_msg.status_code}")
                return
            msg_data = res_msg.json()
            # Buscar el pack_id en message_resources (puede llamarse "orders" o "packs")
            for mr in msg_data.get('message_resources', []):
                if mr.get('name') in ('orders', 'packs'):
                    pack_id = str(mr.get('id', ''))
                    break
            if not pack_id:
                print(f"⚠️ [POSVENTA] No se encontró pack_id en message_resources de {msg_id_directo}: {msg_data}")
                return
            print(f"✅ [POSVENTA] pack_id resuelto desde message_id: {pack_id}")

        res = requests.get(
            f'https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{_SELLER_ID}?tag=post_sale',
            headers=headers, timeout=10
        )
        if res.status_code != 200:
            print(f"⚠️ [POSVENTA] Error obteniendo mensajes del pack {pack_id}: {res.status_code}")
            return

        state = _cargar_state_posventa()
        procesados = set(state.get('procesados', []))

        mensajes = res.json().get('messages', [])
        nuevos = 0
        for msg in mensajes:
            from_id = str(msg.get('from', {}).get('user_id', ''))
            if from_id == str(_SELLER_ID):
                continue  # Mensaje nuestro, ignorar

            msg_id = str(msg.get('id', ''))
            if not msg_id or msg_id in procesados:
                continue  # Ya notificado

            texto = msg.get('text', '').strip()
            if not texto:
                continue

            nombre_comprador = msg.get('from', {}).get('name', f'Comprador {from_id}')
            sufijo = _sufijo_pack(pack_id)

            print(f"📨 [POSVENTA] Nuevo mensaje de {nombre_comprador} en pack {pack_id}: {texto[:60]}")

            # Obtener productos de la orden para contexto
            productos_str = ''
            try:
                r_ord = requests.get(
                    f'https://api.mercadolibre.com/orders/{pack_id}',
                    headers=headers, timeout=8
                )
                if r_ord.status_code == 200:
                    prods = [
                        i.get('item', {}).get('title', '')
                        for i in r_ord.json().get('order_items', [])
                        if i.get('item', {}).get('title')
                    ]
                    if prods:
                        productos_str = '\n'.join(f'  • {p}' for p in prods)
            except Exception:
                pass

            # Guardar en cola de pendientes
            state['pendientes'][sufijo] = {
                'pack_id':    pack_id,
                'comprador':  nombre_comprador,
                'from_id':    from_id,
                'texto':      texto,
                'msg_id':     msg_id,
                'productos':  productos_str,
                'timestamp':  time.strftime('%Y-%m-%dT%H:%M:%S'),
            }
            procesados.add(msg_id)

            notif = (
                f"💬 *MENSAJE POSTVENTA MELI*\n\n"
                f"📦 *Pack:* `{pack_id}`  _(código: *{sufijo}*)_\n"
                f"👤 *Comprador:* {nombre_comprador}\n"
            )
            if productos_str:
                notif += f"🛍 *Productos:*\n{productos_str}\n"
            notif += (
                f"🗣 *Mensaje:* {texto}\n\n"
                f"Para responder escribe en el grupo:\n"
                f"*posventa {sufijo}: tu respuesta aquí*"
            )
            enviar_whatsapp_reporte(notif, numero_destino=GRUPO)
            try:
                incrementar_metrica('mensajes_posventa')
            except Exception:
                pass
            nuevos += 1

        # Limpiar procesados: guardar solo los últimos 500 para no crecer indefinidamente
        state['procesados'] = list(procesados)[-500:]
        _guardar_state_posventa(state)

        if nuevos:
            print(f"✅ [POSVENTA] {nuevos} mensaje(s) nuevos notificados al grupo.")

    except Exception as e:
        print(f"❌ [POSVENTA] Error procesando mensaje: {e}")


