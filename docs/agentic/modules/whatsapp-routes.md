# Module: WhatsApp Routes

## Proposito

Procesar mensajes entrantes de WhatsApp en Flask principal puerto 8081: comandos de grupos, comprobantes, preventa, postventa, pedidos web y chat IA.

## Archivos Ancla

- `app/routes.py`
- `app/utils.py`
- `modulo_posventa.py`
- `app/tools/web_pedidos.py`
- `app/core.py`

## Invariantes

- `/whatsapp` no debe bloquear con trabajo pesado.
- Grupos oficiales vienen de env o `app/data/grupos_whatsapp_oficiales.json`.
- Comandos preventa usan `resp ...`; comandos postventa usan `posventa <codigo>: ...`.
- Postventa generada por IA requiere aprobacion si aplica, no envio directo accidental.
- Imagen de comprobante crea pendiente y alerta al grupo.
- Estadísticas de postventa (`app/services/postventa_stats.py`, panel `/app` → Postventa): clasificación por palabras clave (sin LLM). Cierres (responder / omitir / auto / hugo dale ok) deben llamar `marcar_mensaje_cerrado`. Reclamos se registran en `crear_accion_anular_factura_por_reclamo` aunque el ticket ya exista (dedup).

## Riesgos

- `app/routes.py` es monolito; cambios pequenos pueden afectar varios flujos.
- Parsers de comandos dependen de texto normalizado de WhatsApp.
- JSON en `app/data/` puede tener carreras si dos hilos escriben.
- Imports desde raiz (`modulo_posventa.py`) dependen de cwd/PYTHONPATH.

## Validacion

- Tests de helpers puros: normalizacion, deteccion de comandos, sufijos.
- `pytest tests/test_smoke.py`
- `python scripts/auditar_scripts_cron.py`

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "whatsapp routes comandos preventa postventa"
```

---

## Traído de CLAUDE.md (27-sep-2026)

> Texto movido tal cual al comprimir CLAUDE.md; allí queda un resumen con enlace aquí.

### C. Mensaje WhatsApp → IA

```
WhatsApp → POST /whatsapp (puerto 8081)
  ├─ Grupo contabilidad / compras / inventario (según JID y flags): pagos `ok`/`no`, `resp …`, facturas compra `inv …`, etc.
  ├─ Grupo preventa (`GRUPO_PREVENTA_WA`): `resp …` / `resp preventa …` para preguntas MeLi pendientes
  ├─ Grupo postventa (`GRUPO_POSTVENTA_WA`): `posventa <código>: <txt>` → envía respuesta al pack MeLi (cola `app/data/mensajes_posventa_pendientes.json`)
  ├─ Grupos pedidos web: comandos `facturar` / `envio` / `entregado` (ver `web_pedidos.py`)
  ├─ "hugo dale ok <order_id>" → si hay borrador de respuesta IA posventa, envía a MeLi vía `modulo_posventa` (la alerta de aprobación se envía al grupo postventa)
  ├─ Si número en modo humano → reenvía al grupo
  ├─ Si imagen recibida → guarda comprobante → alerta pago al grupo
  └─ Si mensaje normal → obtener_respuesta_ia() → **Claude** (tool loop) → responde (si `es_postventa`, borrador + aprobación en lugar de envío directo)
```

### E. Confirmación de Pago

```
Cuando cliente envía imagen:
  1. Guarda en comprobantes/ con nombre {sender}_{timestamp}.jpeg
  2. Crea entrada en pagos_pendientes_confirmacion[sender_id]
  3. Envía al grupo:
     🔔 ALERTA DE PAGO
     Cliente ...{últimos7dig} envió comprobante.
     ✅ Para CONFIRMAR: ok {últimos3dig}
     ❌ Para RECHAZAR:  no {últimos3dig}

Operador confirma con: "ok 463"
  → Sistema busca pago con esos 3 dígitos
  → Envía al cliente: "Veci, confirmamos su pago ✅..."
  → Elimina de pendientes

Operador rechaza con: "no 463"
  → Sistema avisa al cliente que el pago no fue válido
```

**Registro durable (24-sep-2026, «Del chat al registro»):** cada comprobante y cada ok/no queda en
`app/services/pagos_clientes.py` → `app/data/pagos_clientes.db` (gitignored): cliente, hora, imagen,
monto detectado y QUIÉN decidió (el puente ahora manda `author` en los comandos de grupo). Al arrancar,
`routes.py` reconstruye `pagos_pendientes_confirmacion` desde ahí (un reinicio ya no borra pendientes;
72 h sin decisión → `vencido`). Bandeja: `GET /api/tickets/pagos-clientes` → tarjeta «Pagos de clientes»
en la Agenda (`PagosClientes.tsx`, solo aparece si hay filas).

**Comandos y grupos cuentan y quedan (mismo cambio):**
- Un comando o mensaje del equipo en un grupo oficial se anota como actividad suya
  (`pagos_clientes.registrar_actividad_wa` → `panel_eventos_operativos`, panel `whatsapp`, tipos
  `comando_wa`/`wa_grupo`) y **suma al control de horas**. Solo en tiempo real (±10 min): un sync
  viejo no falsea horas. El mapeo es por `usuarios.telefono`.
- **Espejo de grupos**: `server.js` (`GRUPOS_ESPEJO`, ampliable con `GRUPOS_ESPEJO_WA`) manda cada
  mensaje de los grupos oficiales al ingest del panel → `wa_chats.db` con `enviado_por` = teléfono del
  autor; en Agenda → Mensajes los grupos salen con su nombre (`wa_chats.nombre_grupo`). El «ya» del
  grupo ya no se evapora. ⚠️ `mensajeAPayloadHistorial` sigue rechazando grupos a propósito (clientes);
  el espejo usa su propio payload SIN `sender_phone` (con él, el mensaje caería al 1:1 del autor).
- Al cerrar cualquier tarea el panel pregunta «¿Cuántas quedaron?» (opcional; empaque sigue obligatorio).
- El aviso «ya quedó» al que pidió algo ya existía: `tickets_notificaciones.notificar_ticket_resuelto`.
