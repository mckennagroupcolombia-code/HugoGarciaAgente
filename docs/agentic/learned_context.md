# Learned Context

Resumen portable para otro dev/agente. Mantener corto; mover detalle a fichas o memoria debug.

## Arquitectura Operativa

- `webhook_meli.py` es dueño productivo de `/notifications` en puerto 8080.
- `agente_pro.py` sirve Flask principal en 8081, WhatsApp, `/chat`, `/api/*` y SPA `/app`.
- `bot-mckenna/` es unico bridge WhatsApp soportado en puerto 3000.
- No mezclar procesos systemd y nohup para mismo puerto.

## Invariantes Negocio

- Stock se sincroniza entre MeLi y pagina web; Alegra solo factura.
- Preventa MeLi con ficha usa Gemini; WhatsApp/chat usa Claude.
- Si Gemini falla en preventa, se delega al grupo; no responder fallback generico al cliente.
- Posventa MeLi usa API messages con `x-version: 2`.

## Validaciones Confiables

- Backend smoke: `venv/bin/python -m pytest tests/test_smoke.py`.
- Auditoria scripts: `AGENTE_AUDITORIA_SKIP_WA=1 AGENTE_AUDITORIA_CRON_QUIET=1 venv/bin/python scripts/auditar_scripts_cron.py`.
- Panel: `cd desktop && npm run qa:full`.

## Aprendizajes Recientes

- **Etiqueta física ≠ ficha SCI:** en Studio, `ficha_mp` reconstruye el layout HTML SCI. Las stickers (MANTECA 76×66) se marcan con `formulario: true` + `campoProducto`/`autofit` en el lienzo; el formulario solo cambia `content`. Nunca poner `ficha_mp` en esas plantillas.
- **Recordatorios (visto / reprogramar):** `_siguiente_tras_hoy` no puede pasar «mañana» como ancla a `_proxima_fecha`. En `bimestral` y `cada_n_dias` eso devolvía mañana (o la misma fecha) en vez del siguiente ciclo. Avanzar desde `proxima_fecha` un periodo completo hasta `> hoy`. En el panel, `fechaHoyLocal()` — no `toISOString().slice(0,10)` (UTC): en Colombia después de las 19:00 el recordatorio diario sigue en «Para hoy».
- **Hero Clásico 2 columnas:** `@media (max-width:1200px) { .hero-right { display:none } }` dejaba el home solo oscuro. Apilar recién a 900px; no `display:none`. `estilo_nodo_layout` no debe emitir `display:inline-block` (rompe `display:grid` del `.hero`).
- **Header sitio público:** logo+8 enlaces+buscar+WA no caben en 1280px; con `overflow-x:hidden` en body se corta «Iniciar sesión». Compactar padding y ocultar buscar/WA ≤1200; hamburguesa ≤1100.
- **Etiquetas circulares (Epson CW-C4000u Diecut_Gap):** el lienzo es cuadrado; el troquel es un círculo. Título en arco al filo se corta (MANTECA KARITÉ 50 mm: tinta a 1,4 mm). Zona segura **3,5 mm simétricos** (`caja_imagen_pdf_etiqueta`); no extra arriba — eso mete LOT/tinta en el gap. **PageSize = solo el diámetro** (50/55/70). Un PNG «Personalizado» 53×53 mm es 50 + gap: si se manda 53 mm la impresora avanza 2 en blanco e imprime 1. Snap: ≤53,5 → 50; ≤62,5 → 55; si no 70. CUPS: `Custom.50x50mm` (enteros, no `50.0`). No tratar 125 g (70×70) como circular: el 125 g es el neto.
- `app/services/cinco_s.py`: `_steps_from_labels` debe ser helper global; `default_postflight_steps()` lo usa fuera de `create_routine_project()`.
- CI backend necesita dependencias de import de `app.core` aunque el test no llame APIs externas.
- `tests/conftest.py` fuerza `WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1` para no chocar con flock.
- Ecosistema Gentleman: `gentle-ai` reemplaza `agent-teams-lite` como instalador/gestor central; ATL queda como referencia archivada.
- Engram es candidato para memoria persistente agent-agnostic; usar primero en dev y filtrar secretos antes de sync.
- Guardian Angel/GGA puede servir como review AI pre-commit/PR, inicialmente solo modo reporte.

### 2026-05-24 — Refactorización AgentRun + Tricap Memory

- **`ANTHROPIC_API_KEY` ausente = "mantenimiento" inmediato.** `core.py` valida antes de instanciar `AgentRun`; si `cliente_ia = None` y el canal necesita Claude, retorna mantenimiento desde la línea de guard. No llega al orquestador.
- **`LLMRouter` fallback automático.** Cadena: primario del canal → Claude → Gemini → Ollama. `GeminiProvider` y `OllamaProvider` lanzan `ProviderError` si se les pasan tools; el router los salta y escala.
- **`_safe_migrate()` es el patrón para migraciones SQLite.** Envuelve cada función de migración en `try/except sqlite3.OperationalError`. Migraciones que asumen tablas existentes fallan en DB fresca; `_safe_migrate` lo silencia sin ocultar errores de lógica real.
- **`monkeypatch.setattr(module, "DB_PATH", str(path))` en lugar de `setenv`.** Las constantes de módulo se fijan al importar; `os.environ` parchado después no las afecta. Usar `setattr` directamente sobre el atributo del módulo.
- **Tests de posventa MeLi deben patchar `app.meli_postventa_notif`, no `webhook_meli`.** Las funciones viven en `meli_postventa_notif`; el webhook solo las llama. Patchar el módulo equivocado no intercepta nada.
- **Respuesta de `/api/tickets/{id}/pasos/{paso_id}` es `{"pasos": [...], "auto_resuelto": bool}`.** No es lista plana. Tests deben hacer `data["pasos"] if isinstance(data, dict) else data`.
- **`obtener_respuesta_ia` acepta `canal=` como kwarg.** Mocks en tests deben usar `lambda _msg, _sender, **_kw: (...)` para no romper con kwargs inesperados.
- **Guard JID vacío en `routes.py`.** `"" == ""` es True, así que todos los grupos vacíos colisionaban con el primer grupo. Siempre envolver comparaciones de JID con `bool(jid) and remote_jid == jid`.

### 2026-09-09 — Facturación MeLi ↔ Alegra: empalme de migración y packs (ficha: `modules/facturacion-meli-alegra.md`)

- **Un fix no existe hasta que el servicio que lo importa se reinicia.** El fix multi-orden del 6-sep estaba en disco; `webhook_meli.py` llevaba desde el 3-sep en memoria y siguió facturando a medias 3 días más. Comparar `ps -o lstart` del proceso con la fecha del commit antes de dar un fix por activo.
- **MeLi: un carrito de N productos = N órdenes con el mismo `pack_id`, un envío y UN solo documento fiscal admitido.** Cruzar orden-contra-factura da falso "coincide"; hay que cruzar el pack completo. Facturar por orden deja al comprador viendo una sola factura.
- **`/orders/search` corta la paginación en silencio** (devuelve lo más reciente y solo imprime el error). Dos corridas iguales dieron 45 y 3 casos. Pedir por ventanas de ≤3 días.
- **Alegra acepta ítems inactivos en facturas nuevas pero no en notas crédito (9053).** `buscar_producto_alegra_por_referencia` debe preferir el ítem activo. "Eliminar" un producto con facturas desde el panel lo inactiva y rompe la anulación de todas ellas.
- **Alegra `identificationObject`: `number` = base del NIT, `dv` lo calcula Alegra.** MeLi manda el NIT con el DV pegado (10 dígitos): recortar antes de enviar, o Alegra calcula un segundo DV encima (el mismo bug que produjo A71352 con DV 5 en Siigo).
- **Alegra `/invoices` ignora `purchase_order`/`query`**: no hay filtro por venta; cachear el listado y sumar solo la primera página para lo recién emitido.
- **La NC "sin referencia" (DIAN tipo 22) no anula facturas de otro sistema.** Siigo en solo lectura + Alegra que no conoce la factura = decisión contable, no técnica.
- **Doble facturación de la migración**: astroselling facturaba en Siigo al comprar; la autofactura de Alegra al entregar. Todo lo comprado 2–3 sep quedó doble (41 packs, $1,45M). Regla: la de Siigo es la válida; la de Alegra se anula, nunca se reemite.
- **Tickets automáticos: dedupe por `titulo` debe buscar `tipo IN ('accion','solicitud')`** — `crear_ticket` guarda como `solicitud` lo que se asigna a otro usuario. Y un ticket cuyos pasos están todos completos debe cerrarse solo, o cuenta como pendiente para siempre.
- **El corte híbrido Siigo/Alegra no es una fecha, son dos.** Alegra empezó el 2-sep, pero astroselling siguió emitiendo en Siigo hasta el 3-sep (90 facturas en esos dos días). `obtener_facturas_hibridas` filtraba Siigo con `fecha < corte` y dejaba esas 90 ventas invisibles para el índice legado y el panel (aparecían "sin facturar"). Siigo se toma hasta `FECHA_ULTIMA_FACTURA_SIIGO` (3-sep) y Alegra desde el corte; los dos días de solape son duplicados reales, no ruido.
- **Alegra `/invoices` paginado también se corta en silencio** (`obtener_facturas_alegra_paginadas` sin `estricto`): una re-verificación basada solo en ese listado saltó 15 casos válidos como "factura ya no vigente". Antes de concluir que una factura desapareció, confirmar con `GET /invoices/{id}` + búsqueda de NC.
- **Un script que emite documentos fiscales no puede marcar `ok` si la emisión falló.** La primera versión de `regularizar_packs_parciales.py` registró `ok: true` con `anuladas: []`; el caso habría quedado "resuelto" sin tocarse.

## Cómo Actualizar

- Agregar solo hechos reutilizables.
- Si el aprendizaje es bug con causa raiz, guardar tambien con `scripts/guardar_memoria_debug.py`.
- Si cambia contrato publico, actualizar `docs/agentic/CONTRACTS.md` y ficha de modulo.
