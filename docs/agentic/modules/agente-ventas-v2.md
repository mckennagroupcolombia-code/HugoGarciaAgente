# Agente ventas v2

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

### P. Agente de ventas v2 (WhatsApp + chat web) con supervisión

Reemplaza, detrás de banderas, la cadena de ~70 interceptores regex + LLM sin herramientas
que atendía WhatsApp y la burbuja web (auditoría 4–11 sep-2026: repreguntas, "lo confirma un
asesor" con precios existentes, respuestas dobles, bot hablando encima del asesor).

```
app/agent/ventas_wa/
  catalogo.py      precios de la PÁGINA WEB (cache.json + stock_web.json) — decisión del negocio
  pedido.py        pedido por cliente en SQLite (ventas_wa.db; sombra → ventas_wa_sombra.db),
                   código WEB-XXXXX para continuar por WhatsApp, historial propio del chat web
  historial.py     WhatsApp lee wa_chats.db (incluye lo que escribe el asesor desde el teléfono);
                   NO usa la memoria legacy conversaciones_whatsapp.sqlite3 (mezcla web + WA)
  herramientas.py  buscar_producto, ficha_producto, actualizar_pedido, guardar_datos_cliente,
                   ver_pedido, consultar_pedido_web, pasar_a_asesor (WA) /
                   llevar_al_carrito + continuar_por_whatsapp (web)
  agente.py        Claude con tool-use; cada llamada pasa por llm_budget
  supervisor.py    nivel 1 reglas (precios respaldados, sin datos de pago, sin repreguntar) +
                   nivel 2 revisor IA (claude-haiku-4-5) solo en respuestas de riesgo;
                   UNA corrección por turno, si falla → respuesta segura + aviso
  entrada.py       /whatsapp (agrupa ráfagas 6 s, se calla 12 h tras mensaje de un asesor,
                   adopta pedidos WEB-XXXXX) y /chat web (atender_web)
app/services/auditor_canales.py + scripts/auditor_canales_cron.py   nivel 3: cada 30 min sin IA
                   (clientes sin respuesta, pedidos listos sin cerrar → re-alerta, puente, presupuesto)
                   y 19:00 auditoría IA de una muestra que PROPONE mejoras
```

- **El bot NO cierra la venta:** arma el pedido y manda la tarjeta por mensaje directo a
  `WA_V2_ALERTA_DESTINO` (default +57 318 243 2463) **desde la cuenta supervisora**
  (bot-supervisor :3001, número 573196529076, `herramientas.enviar_alerta_asesor`) para que
  no se confunda con los chats de clientes; si el supervisor cae, respaldo por el puente
  principal :3000. El asesor confirma
  total, comparte datos de pago y cierra. Pedidos agrupados en /app → Agente WA → **Pedidos IA**.
- **Web:** si todo está disponible, el agente mete los productos en el carrito del visitante
  (lo aplica `website.py::_aplicar_acciones_chat` en la sesión) y la burbuja muestra
  "Ver carrito y pagar"; si no, botón "Continuar por WhatsApp" con el código del pedido.
- **Banderas:** `WA_AGENTE_V2` y `WEB_AGENTE_V2` = `off | sombra | activo`. En sombra el flujo
  legacy responde y v2 solo deja borradores (panel → Pedidos IA → Sombra). Desde 2026-09-11 ambas
  en `sombra`. Presupuesto autorizado por el usuario ese día: `LLM_BUDGET_TOPE_USD=5.0`,
  `LLM_BUDGET_DIARIO_USD=3.0` en `.env`.
- **Nunca** cambiar `os.environ` en caliente para elegir la base: `pedido.usando_modo()` (ContextVar)
  — el servidor es multihilo y otro hilo podría leer "activo" y responderle de verdad a un cliente.
- `wa_bot_detect.parece_respuesta_bot` ya no marca como bot los mensajes con "veci": el asesor
  también lo escribe, y ese falso positivo hacía creer que nadie humano atendía el chat.
