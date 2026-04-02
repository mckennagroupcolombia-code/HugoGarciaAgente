# CLAUDE.md — McKenna Group Agent

Instrucciones y arquitectura completa para cualquier IA que trabaje en este repositorio.

---

## Visión General

**Hugo García** es el agente de IA de McKenna Group S.A.S. (materias primas farmacéuticas y cosméticas, Bogotá, Colombia). Automatiza ventas por WhatsApp, preguntas de MercadoLibre, sincronización de stock, facturación Siigo y generación de catálogos.

**Stack**: Python 3.12 · Flask · Google GenAI (Gemini 2.5-Pro) · Evolution API (WhatsApp) · MercadoLibre API · WooCommerce REST · Siigo ERP · Google Sheets · ReportLab · ChromaDB · SQLite

---

## Cómo correr el proyecto

```bash
# Producción (con túnel Cloudflare para webhooks)
./start.sh

# Desarrollo (sin túnel, Flask dev en puerto 8081)
source venv/bin/activate && python3 agente_pro.py

# Solo webhook MeLi (puerto 8080)
source venv/bin/activate && python3 webhook_meli.py

# Health check
curl http://localhost:8081/status

# Catálogo PDF
source venv/bin/activate && python3 generar_catalogo.py
```

---

## Estructura de Directorios

```
/home/mckg/mi-agente/
├── agente_pro.py                  Flask app principal (puerto 8081) + CLI thread
├── webhook_meli.py                Flask app notificaciones MeLi (puerto 8080)
├── preventa_meli.py               Orquestador preguntas de preventa MeLi
├── modulo_posventa.py             Gestión post-venta (RUT, devoluciones)
├── generar_catalogo.py            Genera PDF catálogo con fotos de MeLi
│
├── app/
│   ├── core.py                    Gemini AI config, prompt sistema, registro herramientas
│   ├── routes.py                  Endpoints Flask: /whatsapp, /woocommerce, /sync/*, etc.
│   ├── sync.py                    Lógica central sincronización stock + facturas
│   ├── cli.py                     Menú CLI interactivo (13 opciones)
│   ├── monitor.py                 Alertas automáticas y métricas diarias
│   ├── utils.py                   refrescar_token_meli(), enviar_whatsapp_*()
│   │
│   ├── services/
│   │   ├── meli.py                MeLi API: órdenes, stock, facturas, aprendizaje
│   │   ├── meli_preventa.py       Persistencia preguntas pendientes + casos aprendidos
│   │   ├── woocommerce.py         WooCommerce REST: stock, productos, webhooks
│   │   ├── siigo.py               Siigo ERP: facturas paginadas, descarga PDF
│   │   └── google_services.py     Google Sheets: catálogo, fichas técnicas
│   │
│   ├── tools/
│   │   ├── memoria.py             SQLite + ChromaDB vectorial
│   │   ├── system_tools.py        Archivos, backups, scripts, email
│   │   ├── verificacion_sync_skus.py  Auditoría SKUs entre MeLi/SIIGO/WC
│   │   └── sincronizar_facturas_de_compra_siigo.py  Facturas de compra desde Gmail
│   │
│   ├── data/
│   │   ├── preguntas_pendientes_preventa.json  Queue de preguntas sin responder
│   │   ├── modos_atencion.json                 Números en modo humano vs IA
│   │   ├── metricas_diarias.json               Estadísticas del día
│   │   └── tarifas_interrapidisimo.json        Tarifas de envío
│   │
│   └── training/
│       ├── casos_preventa.json    Historial Q&A para few-shot learning
│       └── casos_especiales.json  Reglas custom por trigger
│
├── memoria_vectorial/             ChromaDB persistente (embeddings)
├── comprobantes/                  Imágenes de comprobantes de pago recibidos
├── facturas_descargadas/          PDFs de facturas Siigo
├── cotizaciones_preliminares/     JSON de cotizaciones en progreso
├── DISENO CORPORATIVO/            Logo e isotipo McKenna
│
├── .env                           Credenciales (NO commitear)
├── credenciales_meli.json         OAuth tokens MeLi (NO commitear)
├── credenciales_google.json       OAuth tokens Google (NO commitear)
├── credenciales_SIIGO.json        API key Siigo (NO commitear)
└── mi-agente-ubuntu-*.json        Google Service Account (NO commitear)
```

---

## Variables de Entorno (.env)

```env
# IA
GOOGLE_API_KEY              # Google GenAI (Gemini)
ANTHROPIC_API_KEY           # Claude API (uso secundario)

# MercadoLibre
MELI_CREDS_PATH             # Ruta a credenciales_meli.json

# WhatsApp (Evolution API)
EVOLUTION_API_URL           # Endpoint Evolution API
EVOLUTION_API_KEY           # Clave autenticación
INSTANCE_NAME               # Nombre instancia WA

# Google
SPREADSHEET_ID              # ID Google Sheet (catálogo/inventario)
TDS_FOLDER_ID               # Google Drive folder fichas técnicas

# WooCommerce
WC_URL                      # https://mckennagroup.co
WC_KEY                      # Consumer key
WC_SECRET                   # Consumer secret
WC_WEBHOOK_URL              # URL pública para recibir webhooks WC
WC_WEBHOOK_SECRET           # Secreto validación HMAC-SHA256

# Grupos WhatsApp
GRUPO_CONTABILIDAD_WA       # ID grupo contabilidad (default: 120363407538342427@g.us)
GRUPO_INVENTARIO_WA         # ID grupo inventario
TELEFONO_GRUPO_REPORTE      # Número/grupo para reportes

# API
CHAT_API_TOKEN              # Token para endpoints /chat y /sync/*
ADMIN_TOKEN                 # Token admin

# Infraestructura
CLOUDFLARE_TUNNEL_TOKEN     # Token túnel Cloudflare
```

---

## Arquitectura y Flujos de Datos

### A. Pregunta de cliente en MeLi (Preventa)

```
MeLi → POST /notifications (puerto 8080)
  └─ topic: "questions"
  └─ hilo: procesar_nueva_pregunta(question_id)
       ├─ GET /questions/{id} → texto pregunta + item_id
       ├─ GET /items/{item_id} → nombre del producto
       ├─ manejar_pregunta_preventa()
       │    ├─ buscar_ficha_tecnica_producto(nombre) → Google Sheets col I
       │    ├─ CON ficha → generar_respuesta_con_ficha() con Gemini
       │    │    ├─ Gemini OK → POST /answers → responde en MeLi ✅
       │    │    └─ Gemini falla → delega al grupo ❓
       │    └─ SIN ficha → guardar_pregunta_pendiente() → alerta grupo ❓
       └─ Reporte al grupo WhatsApp con resultado
```

### B. Orden pagada en MeLi (Stock sync)

```
MeLi → POST /notifications (puerto 8080)
  └─ topic: "orders_v2", status: "paid"
  └─ hilo: _procesar_orden_meli(order_id)
       ├─ GET /orders/{id} → lista de items
       └─ Por cada item:
            ├─ GET /items/{item_id} → seller_custom_field (SKU) + available_quantity
            └─ actualizar_stock_woocommerce(sku, stock_post_venta_meli)
                 # MeLi ya autodecrementó su propio stock
                 # WC se actualiza para quedar igual a MeLi
```

### C. Orden en WooCommerce (Stock sync)

```
WC → POST /woocommerce (puerto 8081)
  └─ X-WC-Webhook-Topic: order.created / order.updated
  └─ Valida HMAC-SHA256 con WC_WEBHOOK_SECRET
  └─ status: "processing" | "completed"
  └─ hilo: _procesar_webhook_woocommerce(payload)
       └─ Por cada line_item con SKU:
            ├─ obtener_stock_woocommerce(sku) → stock ya decrementado por WC
            └─ actualizar_stock_meli(sku, stock_post_venta_wc)
                 # WC ya autodecrementó su propio stock
                 # MeLi se actualiza para quedar igual a WC
```

### D. Mensaje WhatsApp → IA

```
WhatsApp → POST /whatsapp (puerto 8081)
  ├─ Si es_grupo_contabilidad:
  │    ├─ "ok <3dig>"         → confirma pago (nuevo formato corto)
  │    ├─ "no <3dig>"         → rechaza pago
  │    ├─ "ok confirmado"     → confirma si hay 1 pago pendiente
  │    ├─ "pausar <num>"      → pone número en modo humano
  │    ├─ "activar <num>"     → reactiva IA para ese número
  │    ├─ "resp <id>: <txt>"  → responde pregunta MeLi pendiente
  │    └─ "hugo dale ok <id>" → aprueba y envía respuesta posventa
  ├─ Si número en modo humano → reenvía al grupo
  ├─ Si imagen recibida → guarda comprobante → alerta pago al grupo
  └─ Si mensaje normal → obtener_respuesta_ia() → Gemini → responde
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

### F. Sincronización de Facturas MeLi ↔ Siigo

```
sincronizar_inteligente():
  ├─ Busca órdenes MeLi pagadas sin documento fiscal
  ├─ Busca facturas Siigo del mismo período
  ├─ Cruza por Pack ID (en observations/purchase_order de Siigo)
  └─ Por cada match:
       ├─ descargar_factura_pdf_siigo(factura_id) → base64
       └─ subir_factura_meli(pack_id, pdf_b64) → POST /packs/{id}/fiscal_documents

sincronizar_facturas_recientes(dias=1):
  ├─ obtener_facturas_siigo_paginadas(fecha_desde)
  └─ Para cada factura con Pack ID → upload a MeLi
```

---

## Endpoints Flask

### webhook_meli.py (Puerto 8080)

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/notifications` | POST | Webhook MeLi: preguntas + órdenes |
| `/status` | GET | Estado de servicios |
| `/chat` | POST | Chat IA con Bearer token |

### agente_pro.py / routes.py (Puerto 8081)

| Endpoint | Método | Auth | Propósito |
|----------|--------|------|-----------|
| `/whatsapp` | POST | — | Webhook principal WhatsApp |
| `/woocommerce` | POST | HMAC | Webhook WooCommerce |
| `/status` | GET | — | Health check |
| `/chat` | POST | Bearer | Chat IA |
| `/panel` | GET | — | Panel HTML |
| `/sync/hoy` | POST | Bearer | Sync facturas último día |
| `/sync/10dias` | POST | Bearer | Sync facturas 10 días |
| `/sync/completo` | POST | Bearer | Full sync + reporte stock |
| `/sync/inteligente` | POST | Bearer | Cruce MeLi ↔ Siigo |
| `/sync/pack` | POST | Bearer | Sync por Pack ID |
| `/sync/fecha` | POST | Bearer | Sync por fecha YYYY-MM-DD |
| `/sync/stock` | POST | Bearer | Reporte stock WhatsApp |
| `/sync/aprendizaje` | POST | Bearer | Fuerza aprendizaje IA MeLi |
| `/sync/gmail` | POST | Bearer | Facturas de compra desde Gmail |
| `/consultar/producto` | GET | Bearer | Busca producto en Sheets |
| `/confirmar-pago` | POST | — | Confirma/rechaza pago |
| `/training/agregar-caso` | POST | — | Agrega caso de entrenamiento |

---

## Sincronización de Stock (Diseño Actual)

**Principio:** cada plataforma maneja su propio stock al vender. La otra se actualiza para quedar igual.

```
MeLi vende → MeLi autodecremente → leemos MeLi post-venta → actualizamos WC
WC vende   → WC autodecremente  → leemos WC post-venta   → actualizamos MeLi
```

**Función central:**
```python
# app/sync.py
sincronizar_stock_todas_las_plataformas(sku: str, nuevo_stock: int)
  # Actualiza WooCommerce Y MeLi al mismo valor
  # Usar para sincronizaciones manuales o masivas
```

**Funciones atómicas:**
```python
# app/services/woocommerce.py
obtener_stock_woocommerce(sku: str) → int
actualizar_stock_woocommerce(sku: str, nuevo_stock: int) → str

# app/services/meli.py
actualizar_stock_meli(sku: str, nuevo_stock: int) → str
  # Busca publicaciones activas por seller_sku
  # Actualiza available_quantity en cada publicación encontrada
```

**IMPORTANTE:** No existe sincronización con SIIGO por ahora. SIIGO solo se usa para facturación.

---

## Sistema de Preventa MeLi

### Archivos de persistencia

```python
# Preguntas sin responder (queue):
app/data/preguntas_pendientes_preventa.json
{
  "preguntas": [{
    "question_id": "13553987497",
    "titulo_producto": "Jabón Potásico...",
    "pregunta": "¿Se puede aplicar a flores?",
    "timestamp": "2026-04-01T00:00:00",
    "respondida": false
  }]
}

# Casos aprendidos (few-shot):
app/training/casos_preventa.json
{
  "casos": [{
    "producto": "Urea Cosmética 250 Gr",
    "pregunta": "¿Viene en polvo o líquida?",
    "respuesta": "Hola veci, viene en estado sólido...",
    "timestamp": "2026-03-31T13:17:48"
  }]
}
```

### Árbol de decisión

```
Nueva pregunta MeLi
  │
  ├─ Ficha técnica en Sheets → SI
  │    └─ Gemini genera respuesta
  │         ├─ Gemini OK → responde automáticamente en MeLi
  │         └─ Gemini falla (503, timeout) → ❓ delega al grupo
  │
  └─ Ficha técnica → NO → ❓ delega al grupo

Comando del grupo:
  "resp <últimos3digID>: <respuesta>"
  → Responde en MeLi
  → Guarda como caso de entrenamiento
```

### Errores comunes en preventa

- **El agente responde genéricamente**: `generar_respuesta_con_ficha()` falló y devolvió el fallback. **Fix aplicado**: ahora devuelve `None` en error y delega al grupo.
- **Pregunta sin ficha**: producto no tiene datos en columna I de Sheets. Solución: llenar la ficha técnica en el Sheet.

---

## Generación de Catálogo PDF

```python
# generar_catalogo.py - flujo:
1. leer_productos_sheets() → lee Sheets, extrae meli_id_to_sku de col A
2. fetch_meli_photos(token, meli_id_to_sku) → descarga 1ª foto por item_id
3. Inyecta photo_path en cada producto
4. draw_cover() → portada con logo + caja info
5. draw_interior_pages() → 2 columnas, tarjetas por categoría
6. draw_closing() → página final
7. enviar_whatsapp_archivo(OUT_PDF) → envía al grupo

# Diseño tarjeta (CARD_H = 82pt):
┌────────────────────────────────────────┐
│ [FOTO 58x58] NOMBRE DEL PRODUCTO       │
│              Ref: SKU                   │
│              MeLi: $XX.XXX ~~tachado~~ │
│              $XX.XXX COP  Ahorras 10%  │
└────────────────────────────────────────┘

# Clave: fotos se obtienen por meli_id (col A de Sheets), NO por seller_custom_field.
# El seller_custom_field de MeLi usa formato "AS-XX" diferente a los SKUs del catálogo.
```

---

## CLI Menu (app/cli.py)

El servidor lanza un hilo con menú interactivo:

```
1  → Chat directo con Hugo García
2  → Sync inteligente (MeLi pendientes → Siigo)
3  → Sync facturas último día
4  → Sync facturas últimos 10 días
5  → Sync completo + reporte stock WhatsApp
6  → Verificar SKUs (MeLi / SIIGO / WC)
7  → Sync manual por Pack ID
8  → Forzar aprendizaje IA desde Q&A MeLi
9  → Sync por fecha específica
10 → Sync facturas de compra desde Gmail
11 → Generar catálogo PDF
12 → Actualizar precios WooCommerce
13 → Salir
```

---

## IA Principal (app/core.py)

- **Modelo**: `gemini-2.5-pro`
- **Persona**: Hugo García, asesor ejecutivo McKenna Group
- **Tono**: Directo, colombiano ("veci"), sin rodeos
- **Herramientas registradas**: ~40 funciones (Sheets, MeLi, Siigo, WC, memoria, sistema)

**Reglas anti-loop del prompt:**
- No ejecutar sync sin la palabra explícita "Sincronizar"/"Sync"
- No ofrecer opciones no solicitadas
- No imprimir listas largas en chat
- Para "¿cómo va conexión?": usar `refrescar_token_meli()`

---

## Almacenamiento

| Store | Tecnología | Propósito |
|-------|-----------|-----------|
| Conversaciones | SQLite (`app/tools/memoria.py`) | Historial chats |
| Embeddings | ChromaDB (`memoria_vectorial/`) | Q&A MeLi aprendidas |
| Catálogo/Inventario | Google Sheets | Fuente de verdad productos |
| Pendientes/Config | JSON files (`app/data/`) | Estado del sistema |
| Facturas/PDFs | Archivos locales | `facturas_descargadas/` |
| Comprobantes | Archivos locales | `comprobantes/` |

---

## Archivos que NO deben estar en git

```gitignore
.env
credenciales_meli.json
credenciales_google.json
credenciales_SIIGO.json
mi-agente-ubuntu-*.json
client_secret_cloud.json
token_gmail.json
venv/
memoria_vectorial/    # puede ser grande
*.log
```

---

## Decisiones de Diseño Importantes

1. **Fuente de verdad de stock**: cada plataforma es fuente de verdad de su propio stock cuando vende. No hay un "master" externo.

2. **Fotos en catálogo**: se obtienen por `meli_id` (columna A del Sheet, formato MCOxxxxxxxx), NO por `seller_custom_field`. El `seller_custom_field` usa formato "AS-XX" que no coincide con los SKUs del catálogo.

3. **Preventa sin respuesta genérica**: si Gemini falla, se delega al grupo. Nunca se envía el fallback `"En breve nuestros asesores..."` al cliente.

4. **Confirmación de pagos corta**: comando `ok <3dígitos>` en lugar de `ok confirmado {número_completo}@c.us`.

5. **Sin sincronización SIIGO-stock**: SIIGO solo para facturación. El stock se maneja entre MeLi y WooCommerce únicamente.

6. **Webhooks asíncronos**: todos los webhooks responden 200 inmediatamente y procesan en hilos daemon.

7. **Deduplicación de preguntas MeLi**: ventana de 5 minutos para evitar procesar la misma pregunta dos veces.
