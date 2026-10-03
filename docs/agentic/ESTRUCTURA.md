# Estructura

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

## Estructura de Directorios

```
/home/mckg/mi-agente/
├── agente_pro.py                  Flask app principal (puerto 8081) + CLI thread
├── webhook_meli.py                Flask app notificaciones MeLi (puerto 8080)
├── preventa_meli.py               Orquestador preguntas de preventa MeLi
├── modulo_posventa.py             Gestión post-venta (RUT, devoluciones)
│   (generar_catalogo.py vive en scripts/ y app/tools/, no en la raíz)
│
├── PAGINA_WEB/site/               Tienda y contenido (Flask `website.py`): pedidos, catálogo, datos JSON
│
├── desktop/                       Panel de Operaciones React (SPA servida por Flask en /app)
│   ├── src/
│   │   ├── components/           Chat, Dashboard, PreventaPanel, SyncPanel, StockPanel, Layout, Sidebar
│   │   ├── stores/               Zustand: auth.ts (Bearer token), app.ts (panel activo)
│   │   ├── hooks/                React Query: useMetricas, useStatus, usePreventa, useChat
│   │   ├── api/client.ts         fetch wrapper con Bearer auth
│   │   ├── App.tsx               Router de paneles
│   │   └── main.tsx              Entry point
│   ├── dist/                     Build de producción (generado por `npm run build`)
│   ├── package.json              React 19, Vite, Tailwind, Zustand, React Query
│   ├── vite.config.ts            base: "/app/", proxy /api → :8081
│   └── tailwind.config.ts        Dark theme McKenna (surface, accent, muted)
│
├── bot-mckenna/                   Puente WhatsApp (Node): server.js :3000, monitor /monitor
│   ├── server.js                 whatsapp-web.js → POST /whatsapp :8081; /enviar para reportes
│   ├── instalar_systemd.sh       Crea mckenna-whatsapp-bridge.service (no usar nombre bot-mckenna si choca con Python)
│   ├── package.json
│   └── README.md                 Operación y troubleshooting del bridge unificado
│
├── app/
│   ├── core.py                    Claude (Anthropic): prompt sistema, registro herramientas, `obtener_respuesta_ia`
│   ├── routes.py                  Endpoints Flask: /whatsapp, /api/*, /app (SPA), CORS
│   ├── sync.py                    Lógica central sincronización stock + facturas
│   ├── cli.py                     Menú CLI interactivo (8 opciones con submenús)
│   ├── monitor.py                 Alertas automáticas y métricas diarias
│   ├── observability.py           request_id, spawn_thread, log_json
│   ├── utils.py                   refrescar_token_meli(), enviar_whatsapp_*(), JIDs preventa/postventa/alertas sistemas, helpers posventa MeLi
│   │
│   ├── services/
│   │   ├── meli.py                MeLi API: órdenes, stock, facturas, aprendizaje
│   │   ├── meli_preventa.py       Persistencia preguntas pendientes + casos aprendidos
│   │   ├── siigo.py               Siigo ERP: facturas paginadas, descarga PDF
│   │   ├── mensajeria_pagos.py   Envíos diarios + lotes de pago a transportadoras (ex Excel «ENVIOS INTERRA»)
│   │   ├── declarador.py          Socios: expediente fiscal + Declarador de activos digitales (Flujo Q)
│   │   └── google_services.py     Google Sheets: catálogo, fichas técnicas
│   │
│   ├── tools/
│   │   ├── memoria.py             SQLite + ChromaDB vectorial
│   │   ├── system_tools.py        Archivos, backups, scripts, email (restricción opcional de rutas)
│   │   ├── script_audit.py        Auditoría py_compile + manifiesto; usado por herramienta auditar_scripts
│   │   ├── backup_drive.py        Backup nocturno Drive/local + git push opcional + WA a GRUPO_ALERTAS_SISTEMAS_WA
│   │   ├── sincronizar_productos_pagina_web.py  Stock/precios hacia API tienda web (WEB_API_*)
│   │   ├── web_pedidos.py         Comandos WhatsApp grupo pedidos web (facturar / envío / entregado)
│   │   ├── guias_envio.py         Rótulos de envío en PDF (10x15 cm) para impresora térmica Vretti
│   │   ├── notas_credito.py       Ticket "anular factura / nota crédito" en Centro de Mando (Web/MeLi)
│   │   ├── verificacion_sync_skus.py  Auditoría SKUs MeLi / SIIGO / web
│   │   └── sincronizar_facturas_de_compra_siigo.py  Facturas de compra desde Gmail
│   │
│   ├── data/
│   │   ├── preguntas_pendientes_preventa.json  Queue de preguntas sin responder
│   │   ├── modos_atencion.json                 Números en modo humano vs IA
│   │   ├── metricas_diarias.json               Estadísticas del día
│   │   ├── grupos_whatsapp_oficiales.json      Nombres y JIDs de grupos operativos
│   │   ├── tarifas_interrapidisimo.json        Tarifas de envío
│   │   └── scripts_manifest.json               Lista de .py para auditoría / cron
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
├── app/tools/pipeline_contenido_facebook.py  Copy→Imagen→Voz→Video→Facebook (consola)
├── generar_infografias_facebook.py Infografías PIL publicadas en Facebook (consola)
├── sincronizar_facebook.py        Limpia y republica la página de Facebook (consola)
│
├── .env                           Credenciales (NO commitear)
├── credenciales_meli.json         OAuth tokens MeLi (NO commitear)
├── credenciales_google.json       OAuth tokens Google (NO commitear)
├── credenciales_SIIGO.json        API key Siigo (NO commitear)
└── mi-agente-ubuntu-*.json        Google Service Account (NO commitear)
```

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

### Convención — dónde debe vivir un archivo nuevo

Tres ubicaciones posibles, en este orden de preferencia. **Antes de crear una carpeta nueva
para archivos generados, ubicarla aquí** (evita el desorden identificado en la auditoría de
sep-2026, ver `docs/agentic/learned_context.md` si existe una entrada relacionada):

1. **`app/data/*.json` — trackeado en git.** Solo config/estado pequeño (KB, no MB). Si un
   archivo va a pesar más que unos pocos KB o va a cambiar todos los días (cache, logs,
   colas), no va aquí sin evaluar antes si necesita estar en git.
2. **Dentro del repo, pero en `.gitignore`** (patrón correcto para binarios runtime que el
   propio código regenera o que no aportan valor en el historial de git): `comprobantes/`,
   `contenido_video/`, `renders_etiquetas/`, `fichas_word/`, `backups_drive/`,
   `memoria_vectorial/`, `facturas_descargadas/`, `uploads/`, `Etiquetas Modelo SVG/`
   (495 masters .ai/.svg de etiquetas — leídos por `app/tools/etiquetas_ai_engine.py` /
   `etiquetas_svg_engine.py`), `IMAGENES_PRODUCTOS_CATALOGO/`. **Regla:** cualquier carpeta
   nueva en la raíz del repo que vaya a acumular binarios (imágenes, PDFs, .ai, video) debe
   agregarse a `.gitignore` en el mismo cambio que la crea — no después.
3. **Fuera del repo, en `~/Documentos/`** — solo para lo que un humano gestiona manualmente
   desde el explorador de archivos y que el código consume vía `Path.home()`. Hoy solo un
   caso: `~/Documentos/Etiquetas McKenna/Recursos PNG/ETIQUETAS STUDIO/` (biblioteca de PNG
   listos para imprimir del panel Diseño → Imprimir, ver
   `app/tools/etiquetas_studio.py::_carpeta_recursos_png()`). **Riesgo conocido:** el
   backend recrea esa carpeta vacía con `mkdir(exist_ok=True)` si no la encuentra, sin dar
   error — un borrado accidental desde el explorador de archivos (pasó el 2026-09-02) se ve
   igual que "no hay nada que mostrar", no como un fallo. Al añadir una carpeta nueva en
   este nivel, considerar que el código avise si aparece vacía inesperadamente en vez de
   fallar en silencio.

No mezclar los niveles 2 y 3 para el mismo tipo de dato: los masters de etiquetas (.ai/.svg)
viven en el repo (nivel 2) mientras que los PNG derivados para imprimir viven fuera (nivel 3)
— es una inconsistencia heredada, no un patrón a repetir para datos nuevos.

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
backups_drive/        # .tar.gz del backup nocturno (local)
*.log
uploads/
Etiquetas Modelo SVG/ # 495 masters .ai/.svg — pesado, cambia seguido
IMAGENES_PRODUCTOS_CATALOGO/
facturas_descargadas/
```

---
