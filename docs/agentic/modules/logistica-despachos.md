# Logistica despachos

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

### K. Pagos de mensajería (ex Excel «ENVIOS INTERRA»)

Origen: TKT-2026-1219 — despachos (Jenniffer) llevaba en un Excel aparte un renglón por día con
la cantidad de envíos, el enlace a la factura de guías de Interrapidísimo y el valor, y pedía la
aprobación del pago abriendo un ticket a mano. Ahora vive en el panel:

```
/app → Contabilidad → Operativos → Mensajería   (desktop/src/components/MensajeriaPanel.tsx)
  ├─ Un renglón por día: fecha · cantidad de envíos · enlace de guías · valor · nota
  │    (días sin despacho — "domingo", "no salen" — se registran con valor 0)
  ├─ "Importar del Excel": pegar las filas tal cual; las que decían CANCELADO con su fecha de
  │    pago se agrupan como lotes ya pagados y conservan el histórico
  ├─ Seleccionar días pendientes → lote de pago + ticket de aprobación automático
  │    (categoría logistica, asignado al usuario de `MENSAJERIA_APROBADOR`, default `armando`)
  └─ Registrar pago: fecha, banco, referencia, monto y comprobante adjunto

app/services/mensajeria_pagos.py   tablas `mensajeria_envios` / `mensajeria_lotes` en
                                   contabilidad.db; comprobantes en comprobantes/mensajeria/
contabilidad_ledger._egresos_mensajeria   lote pagado SIN solicitud → fuente "mensajeria_pago" en
                                   Ingresos/Egresos → autopost al Libro Mayor (PUC 5135)
```

**Unificado con Solicitudes de pago (15-sep-2026):** en cada lote «solicitado» hay un selector de
tercero (la transportadora en el Libro Mayor, creable ahí mismo) y el botón **«Pasar a Solicitudes
de pago»** → `mensajeria_pagos.solicitar_pago_wizard()` crea la solicitud (`flete_transporte`,
513550, `origen_ref="mensajeria:<lote>"`) y guarda `solicitud_pago_id` en el lote. Desde ahí el pago
sigue el camino único: aprobar (nace el asiento) → montar en el banco → confirmar con el segundo
token y el comprobante. Al confirmarlo, `pagos_wizard._avisar_al_origen()` marca el lote como pagado
y le copia el comprobante (despachos no entra a Contabilidad). **Un lote con `solicitud_pago_id` ya
no se postea por `_egresos_mensajeria`** — el asiento lo hace la solicitud y contarlo dos veces
duplicaría el gasto. El ticket suelto de aprobación sigue disponible como «Solo pedir aprobación»,
sin asiento, para casos que no pasen por contabilidad.

Permiso: `mensajeria`, heredado también de `servicios`, `operativos` o `pedidos` — el registro lo
lleva despachos y la aprobación administración (ver `desktop/src/lib/contabilidadAccess.ts`).

### L. Guías (rótulos) de envío para impresora térmica

Reemplaza el formato en Excel/Word que despachos llenaba a mano para pegar en la caja. La
impresora es una **Vretti térmica, rollo de 10x15 cm** (también hay 10x10 y 5x7,5 en
`guias_envio.TAMANOS`).

```
/app → Atención → Guías de envío   (desktop/src/components/GuiasEnvioPanel.tsx)
  ├─ "Desde pedidos": pedidos de la tienda web (orders.db) y despachos de WhatsApp
  │    (despachos.db) de los últimos 15 días, con dirección ya cargada → marcar → PDF
  ├─ "Envío suelto": formulario en blanco para lo que no viene de un pedido
  ├─ "Remitente": datos de McKenna que salen abajo (app/data/remitente_envios.json)
  └─ Historial con reimpresión (tabla `rotulos_envio` en app/data/despachos.db)

POST /api/guias/rotulos → registra los rótulos y devuelve la URL del PDF
GET  /api/guias/rotulos.pdf?ids=1,2&tamano=10x15 → PDF, una página por paquete
POST /api/guias/previsualizar → PDF de prueba (no registra nada) para la vista previa
GET  /api/guias/conteo?fecha=YYYY-MM-DD → rótulos impresos ese día
```

El PDF lo arma ReportLab (`generar_pdf`) en **bandas de altura fija** (encabezado ·
destinatario · remitente · pie), no en flujo continuo: dos paquetes con datos de distinto largo
salen iguales y la dirección queda siempre a la misma altura. Encabezado con el **logotipo**
(`LOGOTIPO TURQUESA.png` pasado a negro con su canal alfa, cacheado en `_logo_negro()` — si se
convierte por rótulo, un lote de 20 pesa ~16 MB) y el lema **«Proveemos a tus ideas»**;
destinatario; remitente con la identidad fiscal de `app/services/empresa.py`; pie con piezas,
peso, transportadora y código de barras Code128 (guía o referencia del pedido).

**No lleva contenido ni valor declarado** (`normalizar_datos` los descarta a propósito): el
rótulo va pegado por fuera de la caja y detallar qué hay dentro y cuánto vale es justo lo que no
conviene en un paquete que viaja. `POST /api/guias/previsualizar` devuelve el mismo PDF **sin
registrar el rótulo** — es lo que muestra la vista previa del panel, así que no puede divergir de
lo que se imprime.

**MeLi queda fuera a propósito:** esas ventas viajan con la etiqueta que genera Mercado Libre
(Colecta/Flex); un rótulo propio no la reemplaza.

**Enlace con Flujo K:** `GET /api/guias/conteo` alimenta la sugerencia "N rótulos impresos ese
día — usar" de la casilla *envíos* en Operativos → Mensajería, para no contar paquetes a mano.

Permiso del panel: `guias-envio`, heredado de `pedidos` o `empaque` (`App.tsx::puedeVerPanel`).

### T. Entregas Flex de MeLi (horas de reparto, evolución semanal)

```
scripts/entregas_flex_cron.py  (23:15 diario, job "entregas_flex" en Tareas Programadas)
  └─ app/services/entregas_flex.py::sincronizar(dias=10)
       ├─ /orders/search paid (paginador propio con reintentos, ver abajo)
       ├─ GET /shipments/{id} → logistic.type == "self_service" (Flex), localidad, fecha prometida
       ├─ GET /shipments/{id}/history → impreso / salida (date_shipped) / entregado
       └─ app/data/entregas_flex.db (gitignored): solo consulta envíos nuevos o abiertos
/app → Atención → Entregas Flex  (EntregasFlexPanel.tsx) — lee /api/entregas-flex/resumen, sin llamar a MeLi
```

Todas las horas se guardan en hora de Bogotá (MeLi responde en -04:00). Las comparaciones son
últimas 4 semanas vs. las 4 anteriores; «patrones» solo avisa cambios de ≥15 min o ≥5 puntos.
Corte del mismo día: `ENTREGAS_FLEX_CORTE_HORA` (decimal, default 12.33 = 12:20, medido en el
estudio del 17-sep-2026). Backfill: `scripts/entregas_flex_cron.py --dias 90 --forzar`. Sin LLM.
⚠️ No usa `meli.listar_ordenes_meli_por_estado`: esa función corta la paginación en silencio ante
un error de red (18-sep-2026: la misma llamada devolvió 1.797 y luego 700 órdenes de 30 días).
