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
  en `sombra`; **WhatsApp `activo` desde 2026-09-29** (web sigue en sombra). Presupuesto autorizado
  por el usuario: `LLM_BUDGET_TOPE_USD=5.0`, `LLM_BUDGET_DIARIO_USD=3.0` en `.env`.
  **Reversión inmediata:** `WA_AGENTE_V2=sombra` + `sudo systemctl restart agente-pro`.

### Por qué se activó (diagnóstico 29-sep-2026)

30 días de `wa_chats.db`: el legacy no ve lo que escribe el asesor (su historial sale de
`conversaciones_whatsapp.sqlite3`, solo cliente↔bot), recuerda 10 turnos (`historial[-10:]`) y no se
calla cuando hay un humano (39 pisadas; 58 % de sus «un asesor le confirma» sin humano en 2 h).
Ningún prompt corrige eso; v2 sí (historial de `wa_chats.db` con asesor, tools, supervisor). Un
prompt externo «Quality & Response Optimizer» se evaluó y **no** se integró: todo lo que pedía ya
está en v2; solo se tomaron sus reglas de formato WhatsApp.

### Turnos con el asesor (`entrada.py`, decisión del usuario 29-sep)

- **En horario** (L-V 8-18): si el asesor escribió en las últimas `WA_V2_PAUSA_HUMANO_HORAS` (12), el
  chat es suyo. El bot programa un reintento a `WA_V2_ESPERA_ASESOR_MIN` (**10**). Al despertar,
  `_debe_responder_este` confirma que nadie respondió y **`_amerita_retomar`** (sin IA) decide si vale la
  pena: no retoma ante cortesía/cierre, solo adjuntos, si el cliente pidió a Jenniffer/una persona, o si
  el último mensaje del asesor dejó algo de su parte («te envío la guía», «valido», «un momento»). En
  esos casos **no habla pero avisa** al asesor por DM (`⏰ cliente esperando`, máx. uno cada 2 h por
  chat, tabla `avisos_espera`). Si pasa la puerta, el turno lleva `INSTRUCCION_RETOMA` (continuar
  desde el último mensaje del asesor, sin re-presentarse ni repetir totales/llave) y la herramienta
  **`omitir_turno`** para que el modelo calle si lo que espera el cliente es del asesor; el revisor IA
  corre siempre en retomas con el criterio «¿continúa el hilo o lo reinicia?».
- **Fuera de horario**: el bot tiene el control; solo espera `WA_V2_ESPERA_ASESOR_FUERA_MIN` (**3**) si
  el asesor acaba de escribir (a veces contesta desde el teléfono a las 19-21 h).
- **Anti-pisada**: tras `ejecutar_turno` se relee el chat; si el asesor escribió mientras el modelo
  pensaba, la respuesta se descarta (`descartado_asesor`).
- El reintento diferido envía por `enviar_whatsapp_reporte` y **antes** registra la salida en
  `wa_chats.guardar(enviado_por="bot")`: el eco `fromMe` del puente llega como «humano» y sin ese
  registro el bot se callaría 12 h en ese chat.
- Bitácora: `turnos.estado` = `respondido | omitido | diferido | descartado_asesor | sin_merito | sombra`
  y `turnos.motivo`. Un reinicio pierde los reintentos programados; lo cubre el auditor
  «clientes sin respuesta» (20 min).

### Lo que escribió el asesor manda

`ejecutar_turno` suma los mensajes del asesor a la evidencia base (`supervisor._montos(evidencia=True)`
acepta montos sin `$`), así el supervisor de reglas no rechaza un precio que dio Jenniffer y el
`PLAYBOOK_ASESOR` del prompt ordena repetirlo tal cual. El historial pasó de 14 a 30 días y el contexto
incluye «Pedidos anteriores de este cliente» (`pedido.ultimos_pedidos`).

### Playbook del equipo (`agente.PLAYBOOK_ASESOR`)

Minado de los chats reales de sep-2026 (lo que el bot falló → cómo lo resolvió Jenniffer): libra =
500 g; precio citado → buscar la presentación; número sin unidad = cantidad; precios web ya incluyen
IVA (checkout: «Exento / Incluido»); comprobante → «recibido, el equipo lo verifica» + plantilla de
datos; Bogotá franja de la tarde 3:30–9 pm, resto Interrapidísimo con guía del asesor; transportadora
externa; contra entrega solo el flete; MeLi/web si desconfía; precio negociado o «el de siempre» →
asesor en horario, precio web fuera; nunca dar el wa.me de McKenna; RUT/proforma los envía el asesor.

### Base de clientes (`app/services/clientes_wa.py` → `app/data/clientes.db`, fuera de git)

Se alimenta sin LLM: `guardar_datos_cliente`/`actualizar_pedido`/`pasar_a_asesor` de v2 (fuente
`bot_v2`); la plantilla de datos que los clientes escriben en cualquier chat, incluidos los que
atiende Jenniffer (`extraer_datos_plantilla`, corrida por el auditor cada 30 min, fuente
`chat_humano`; la primera corrida del 29-sep capturó 62 clientes de 30 días); y cada pago
confirmado por `pagos_clientes.decidir` (tabla `compras`). Nunca pisa con vacío; NIT con DV inválido
se guarda con aviso (`empresa.digito_verificacion`). Cada turno de v2 registra su intención
(`intencion_de_turno`, derivada de las herramientas) en `interacciones`. Lectura:
`GET /api/bot/clientes-wa` (`?q=`, `?formato=csv`) y `/api/bot/clientes-wa/<jid>`.

### Copiloto del asesor (`auditor_canales.revision_asesor`, sin IA)

En la auditoría de las 19:00: precios «nombre: cifra» de los mensajes del asesor contra
`catalogo.buscar` (>10 % de diferencia; «5 kilos proteína: 405.000» se divide por la cantidad),
envío contra `tarifas_envio.cotizar_envio` en 1/2/3/5 kg (ciudad = la que dijo el cliente, vía
`core._destino_envio_mensaje`; «con envío: X» es un total y se ignora) y cifras malformadas
(`50.0000`). Va al grupo de sistemas y, lo de precio/envío, por DM a Jenniffer (tono «para que Hugo y
tú digan lo mismo»; ella decide el precio). Primera corrida real (48 h): envío $18.000 a Bogotá vs
tabla $8.800; $8.800 a Mosquera vs $12.500.

### Verificación del 29-sep (sombra, casos reales)

«una libra de citrato» → «*Citrato de magnesio 500g (libra)*: $26.910» y pedido armado; «¿incluye
IVA?» → «ya incluye IVA»; retoma tras «Okey gracias» del cliente al «correcto» de Jenniffer →
`omitir_turno` («solo agradeció»). Bug previo corregido de paso: `revisar_reglas` concatenaba todos
los dígitos de la respuesta y marcaba «datos de pago» en cualquier lista de precios + «medio de pago».
- **Nunca** cambiar `os.environ` en caliente para elegir la base: `pedido.usando_modo()` (ContextVar)
  — el servidor es multihilo y otro hilo podría leer "activo" y responderle de verdad a un cliente.
- `wa_bot_detect.parece_respuesta_bot` ya no marca como bot los mensajes con "veci": el asesor
  también lo escribe, y ese falso positivo hacía creer que nadie humano atendía el chat.

### Auditoría de respuestas WhatsApp + web (7-oct-2026)

209 turnos de WhatsApp (activo) y 56 de web (sombra), 1–6 oct. Qué se corrigió:

- **Ráfagas (`entrada.py`)**: lo que el cliente escribía mientras el modelo pensaba se perdía
  (quedaba antes de la respuesta y parecía respondido: «¿el pago es contra entrega?») o generaba
  dos turnos en paralelo (respuesta doble, turnos 80/81). Ahora hay **un turno a la vez por chat**
  (lock por jid); `_consumido[jid]` guarda el último mensaje que entró al turno y
  `_reordenar_rezagados` deja pendientes los posteriores si después solo habló el bot (si habló un
  asesor, son suyos). `_esperar_envio_previo` espera a que el puente guarde la respuesta anterior.
  Estado en memoria: un reinicio lo pierde (vuelve al comportamiento previo, sin romper nada).
- **Supervisor**: 13 de 24 rechazos eran precios que Hugo ya había dado → `_precios_vigentes_citados`
  los suma a la evidencia si siguen en el catálogo. El revisor IA ya no marca como error pedir datos
  fuera de horario, omitir un resultado irrelevante ni los hechos del playbook (franja, Interrapidísimo).
- **Respaldo**: ya no dice «no puedo procesar su mensaje» (sonaba a caída ante un «1»).
- **`REGLAS_COMUNES`** (ambos prompts): sin razonamiento en el texto, no nombrar resultados que no
  son lo pedido, cantidad dicha = registrar sin confirmar (sin cantidad → 1), no repetir la pregunta
  de cierre, «bulto» = 25 kg (asesor), nunca «empacada de fábrica» ni «consumo directo» (reenvasado).
  Web: no repetir la oferta ante «Hola»/«Pedido», explicar cómo comprar.
- **Catálogo**: prefijo común proporcional (`max(5, len-5)`): «hidroquinona» ya no trae colágeno
  hidrolizado; probado con 1080 palabras reales (typos como «monohidatada» siguen encontrando).

Pendiente fuera del bot: 6 de 28 derivaciones sin respuesta humana; el catálogo de WhatsApp Business
muestra productos que la web ya no vende (albúmina de huevo); no hay regla de precio por volumen.
