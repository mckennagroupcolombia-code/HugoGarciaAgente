# Endpoints

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

## Endpoints Flask

**Webhooks MeLi:** configurar la aplicación de Mercado Libre para que **`/notifications` apunte solo al proceso del puerto 8080** (`webhook_meli.py`). `routes.py` en 8081 también define `/notifications` por legado; no duplicar el mismo URL en producción (evita doble procesamiento).

**URL pública de callbacks (producción):** `https://bot.mckennagroup.co/notifications` — en el administrador de aplicaciones MeLi, *Notificaciones / Callback URL* debe ser exactamente esa (HTTPS, sin barra final). El hostname **`bot.mckennagroup.co`** (túnel Cloudflare o proxy) debe enrutar el tráfico al servicio que ejecuta **`webhook_meli.py` en el puerto 8080**, no al agente en 8081.

### webhook_meli.py (Puerto 8080)

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/notifications` | POST | Webhook MeLi: preguntas + órdenes |
| `/status` | GET | Estado de servicios |
| `/chat` | POST | Chat IA con Bearer token; body JSON: `mensaje`, `session_id` (o `usuario_id`) |

### agente_pro.py / routes.py (Puerto 8081)

| Endpoint | Método | Auth | Propósito |
|----------|--------|------|-----------|
| `/whatsapp` | POST | — | Webhook principal WhatsApp |
| `/status` | GET | — | Health check |
| `/chat` | POST | Bearer | Chat IA (`mensaje` + `session_id` o `usuario_id` para historial) |
| `/panel` | GET | — | Panel HTML (legacy) |
| `/app` | GET | — | **Panel React SPA** (interfaz principal de operaciones) |
| `/app/assets/*` | GET | — | Assets JS/CSS del build React |
| `/api/status` | GET | — | Health check JSON (usado por SPA) |
| `/api/metricas` | GET | — | Métricas diarias + estado token MeLi |
| `/api/preventa/pendientes` | GET | Bearer | Preguntas MeLi sin responder |
| `/api/preventa/casos` | GET | Bearer | Casos aprendidos (últimos 50) |
| `/api/responder-preventa` | POST | Bearer | Responder pregunta MeLi pendiente |
| `/api/sync/hoy` | POST | Bearer | Sync facturas último día |
| `/api/sync/10dias` | POST | Bearer | Sync facturas 10 días |
| `/api/sync/completo` | POST | Bearer | Full sync + reporte stock |
| `/api/sync/inteligente` | POST | Bearer | Cruce MeLi ↔ Siigo |
| `/api/sync/pack` | POST | Bearer | Sync por Pack ID |
| `/api/sync/fecha` | POST | Bearer | Sync por fecha YYYY-MM-DD |
| `/api/sync/stock` | POST | Bearer | Reporte stock WhatsApp |
| `/api/sync/aprendizaje` | POST | Bearer | Fuerza aprendizaje IA MeLi |
| `/api/sync/gmail` | POST | Bearer | Facturas de compra desde Gmail |
| `/api/stock/resumen` | GET | Bearer | Stock en vivo de MeLi por SKU (panel Stock) |
| `/api/stock/sincronizar` | POST | Bearer | Sincroniza un SKU a los canales; devuelve desglose {meli, web, siigo} |
| `/api/stock/sincronizar-todo` | POST | Bearer | Sincroniza todos los SKUs en segundo plano |
| `/api/consultar/producto` | GET | Bearer | Busca producto en Sheets |
| `/api/panel/logs` | GET | Bearer | Líneas recientes de actividad (sync/stock/consultas) para el visor del panel |
| `/api/panel/logs` | DELETE | Bearer | Vacía el buffer de actividad en memoria |
| `/api/proveedores/*` | GET/POST/PUT | Bearer / permiso `logistica-internacional` | Red de proveedores: directorio, ¿quién vende…?, precios históricos, catálogos Gmail, oferta web, cotizaciones (ver Flujo I) |
| `/api/etiquetas/categorias` | GET/PUT | Bearer / permiso Studio | Categorías de producto de las etiquetas (aceites, frutos secos, conservantes…): primer nivel de Diseño → Studio visual. El PUT reemplaza la lista completa y lo eliminado **no** se resucita — ver `app/tools/etiquetas_categorias.py` |
| `/api/guias/*` | GET/POST | Bearer | Rótulos de envío para impresora térmica: pedidos despachables, remitente, generación del PDF (`/api/guias/rotulos.pdf`), historial y conteo diario — ver `app/tools/guias_envio.py` y Flujo L |
| `/api/entregas-flex/*` | GET/POST | Bearer / permiso `entregas-flex`, `pedidos`, `empaque` o `guias-envio` | Horas de entrega de los envíos Flex de MeLi: `resumen?semanas=N` (serie semanal, patrones, localidades, corte, abiertos), `estado`, `sincronizar` (segundo plano) — ver `app/services/entregas_flex.py` y Flujo T |
| `/api/mensajeria/*` | GET/POST/DELETE | Bearer | Pagos de mensajería: días de envíos, lotes de pago, ticket de aprobación y comprobante — ver `app/services/mensajeria_pagos.py` y Flujo K |
| `/api/precios-trm/*` | GET/PUT/POST | Bearer / nivel administrador | Precios indexados a la TRM: estado y propuesta, config, recalcular, aplicar, descartar — ver `app/services/precios_trm.py` |
| `/api/costos-ia` | GET | — | Costos LLM vía API (hoy/semana/histórico 30d); ver `app/services/llm_budget.py`. Consumido por `bot-mckenna` `/costos-ia` |
| `/api/contabilidad/cc/*` | GET/POST/PATCH/DELETE | Bearer | Libro Mayor propio (partida doble): plan de cuentas, terceros, medios de pago, movimientos, cuentas T, balance de comprobación, plantillas (socios, proveedores, préstamos, ingreso/egreso) — ver `app/services/contabilidad_core.py` y Flujo J |
| `/api/contabilidad/cc/movimientos/<id>/comprobante` | GET/POST/DELETE | Bearer | Ver/adjuntar/quitar el comprobante de sustento de un asiento (clave para compras sin factura fiscal) |
| `/api/contabilidad/cc/arbol` | GET | Bearer | El Libro Mayor como árbol del PUC con saldos por nivel (`solo_movimiento=0` para ver también las cuentas sin usar) — ver `app/services/contabilidad_mayor.py` |
| `/api/contabilidad/cc/extracto/<id>` | GET | Bearer | Extracto de una cuenta: saldo inicial, cada línea con su contrapartida y saldo corrido, resumen por tercero. `subcuentas=1`, `tercero_id`, `desde`/`hasta`. Añadir `.pdf` o `.csv` para el documento |
| `/api/contabilidad/cc/auxiliar-terceros` | GET | Bearer | Auxiliar por tercero: cada tercero con sus cuentas y saldos (`desde`/`hasta`). `cc/arbol?terceros=1` agrega el mismo desglose dentro de cada cuenta |
| `/api/contabilidad/cc/balance.pdf` | GET | Bearer | Balance de comprobación jerárquico en PDF, con la sangría por nivel del PUC |
| `/api/ventas-directas/*` | GET/POST/PUT | Bearer / permiso `cotizar-facturar` | Venta directa WhatsApp: calcular IVA por línea, precio sugerido, borrador, cotizar (PDF + Alegra `/estimates`), facturar (DIAN), anular, pedidos del agente IA — ver `app/services/ventas_directas.py` y Flujo R |
| `/api/pagos/*` | GET/POST | Bearer | Solicitudes de pago: categorías, opciones desde saldos reales, previsualización del asiento, crear/aprobar/rechazar; `proveedores` (libro + Alegra), `proveedores/adoptar`, `productos` (catálogo Alegra), `verificar-factura` (multipart, cotejo sin LLM), `solicitudes/<id>/factura` — ver `app/services/pagos_wizard.py`, `pagos_proveedor.py` y Flujo O |
| `/api/prestamos/*` | GET/POST | Bearer | Préstamos de terceros con cronograma: simular, crear, cuotas, pagar, documento PDF (contrato/certificado), envío al prestamista, contacto Alegra y ticket mensual — ver `app/services/prestamos.py` y Flujo M |
| `/api/conciliacion/*` | GET/POST | Bearer / permiso `libro-mayor` o `conciliacion-contador` | Cruce declaraciones del contador (350/490 bajados de Gmail) ↔ cuenta 2365: hallazgos con clave estable, decisiones del wizard y TKT — ver `app/services/conciliacion_contador.py` y Flujo J |
| `/api/contabilidad/autopost` | POST | Bearer | Postea manualmente al Libro Mayor lo que agrega `armar_libro()` en el rango dado — ver `app/services/contabilidad_autopost.py` |
| `/api/contabilidad/ingresos-egresos/manuales` | GET | Bearer | Asientos manuales del Libro Mayor en formato de fila de libro, para fusionar con `armar_libro()` en Ingresos/Egresos |
| `/api/contabilidad/extractos/pendientes` | GET | Bearer | Líneas de banco (extractos de la empresa) sin ningún vínculo en el rango — bandeja "Pendientes por clasificar". Con `tercero_id` (también en GET/POST `/extractos`) opera sobre los extractos PERSONALES de ese socio |
| `/api/socios/*` | GET/POST/PATCH/DELETE | Bearer / propio socio o admin real | Expediente fiscal de socios (Declarador): perfil, documentos, años gravables, hallazgos, cruces banco socio ↔ empresa, agente con herramientas — ver `app/routes_declarador.py` y Flujo Q |
| `/api/mapa-sistema/*` | GET/POST | Bearer / administrador o permiso `mapa-sistema`, `combos` (escritura: admin o `fichas`) | Mapa vivo de la cadena del producto y del ciclo de pago, anatomía de combos, propuesta de EAN, unión documento↔materia prima por SKU y diagramas de Archify — ver `app/services/mapa_producto.py` y Flujo U |
| `/api/revision-empaque/*` | GET/POST | Bearer + sesión / asignado, creador o admin (aplicar y releer MeLi: creador o admin) | Revisión global de pesos, medidas y empaques: `por-ticket/<id>`, `<rid>`, `<rid>/producto/<sku>`, `<rid>/grupo`, `<rid>/entregar`, `<rid>/meli/refrescar`, `<rid>/meli/aplicar` (máx. 15 SKU, relee cada publicación antes de escribir) — ver `app/services/revision_empaque.py` y Flujo AG |
| `/api/colaboradores/diagramas/<id>/tablero`, `/tablero/visto`, `/tarjetas`, `/tarjetas/<tid>` (PATCH/DELETE), `/tarjetas/<tid>/acuerdo`, `/chat` | GET/POST/PATCH/DELETE | Sesión / anfitrión o el colaborador de ese proyecto | Tablero del proyecto de Colaboradores: tarjetas (meta, roles, resultados, obstáculos, decisiones, turno), «visto» para el ritmo, «de acuerdo» autoritativo del servidor y lectura de un chat de WhatsApp exportado (no se guarda; solo los números del ritmo con `guardar_ritmo`) — ver `app/services/colab_tablero.py` |
| `/api/grabaciones/*` | GET/POST/PATCH/DELETE | Bearer (archivos de video sin Bearer: el id es el token) | Grabaciones de pantalla por trozos, recorte de sección, clips MP4 y envío por el bridge supervisor — ver Flujo S |
| `/confirmar-pago` | POST | — | Confirma/rechaza pago |
| `/training/agregar-caso` | POST | — | Agrega caso de entrenamiento |

**CORS**: habilitado para `localhost:5173` (Vite dev), `tauri://localhost`. Middleware manual en `routes.py`.

**Pedidos tienda web:** lógica en `PAGINA_WEB/site/website.py` y alertas/comandos en grupo `GRUPO_PEDIDOS_WEB_WA` vía `app/tools/web_pedidos.py` (facturación al entregarse, envío y anulación desde WhatsApp — ver Flujo H).

---
