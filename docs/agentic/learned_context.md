# Learned Context

Resumen portable para otro dev/agente. Mantener corto; mover detalle a fichas o memoria debug.

## Arquitectura Operativa

- `webhook_meli.py` es dueño productivo de `/notifications` en puerto 8080.
- `agente_pro.py` sirve Flask principal en 8081, WhatsApp, `/chat`, `/api/*` y SPA `/app`.
- `bot-mckenna/` es unico bridge WhatsApp soportado en puerto 3000.
- No mezclar procesos systemd y nohup para mismo puerto.

## Invariantes Negocio

- Stock se sincroniza entre MeLi y pagina web; Siigo solo factura.
- Preventa MeLi con ficha usa Gemini; WhatsApp/chat usa Claude.
- Si Gemini falla en preventa, se delega al grupo; no responder fallback generico al cliente.
- Posventa MeLi usa API messages con `x-version: 2`.

## Validaciones Confiables

- Backend smoke: `venv/bin/python -m pytest tests/test_smoke.py`.
- Auditoria scripts: `AGENTE_AUDITORIA_SKIP_WA=1 AGENTE_AUDITORIA_CRON_QUIET=1 venv/bin/python scripts/auditar_scripts_cron.py`.
- Panel: `cd desktop && npm run qa:full`.

## Aprendizajes Recientes

- **Studio lienzo ≠ CSS del sitio.** `ClasicoLayoutCanvas` es un mock Tailwind (título 42px, `justify-center`, `min-h-[560px]`). El home real vive en `main.css`. Si el sitio usa `min-height:100vh` + `.hero-left { justify-content:flex-end; overflow:hidden }` y un H1 `clamp(..., 80px)`, el copy no cabe y se recorta por arriba («Materias»). Mantener ambas capas con las mismas medidas; el borrador del Studio (`tema_web_preview.json` + `?studio_preview=1`) no publica hasta **Publicar**.
- **Hero Clásico 2 columnas:** el lienzo es papel 1200px. `@media (max-width:1200px) { .hero-right { display:none } }` dejaba el home solo oscuro. Apilar recién a 900px; no `display:none`. `estilo_nodo_layout` no debe emitir `display:inline-block` (rompe `display:grid` del `.hero`).
- **Guías de alineación Studio:** `desktop/src/lib/studioAlignmentGuides.ts` — snap de bordes/centros + papel (`data-studio-paper`). Umbral 6 px de pantalla (`SNAP_SCREEN_PX / zoom`). Alt desactiva. No imantar una sección entera contra sus hijos.
- **Studio web scroll:** Studio web vive bajo el hub `diseno` (pestaña en `DisenoNavTabs`). El panel `sitioweb` debe usar el mismo fill+overflow-hidden que Contabilidad. Si el wrapper es `overflow-y-auto`, el canvas alto se traga Guardar/Publicar. `PanelTransition` fillHeight incluye `sitioweb`. Acciones viven en `#studio-web-chrome` / `#studio-web-chrome-top` (portales del Layout), no duplicadas en la barra del lienzo.
- **Header sitio público:** logo+8 enlaces+buscar+WA no caben en 1280px; con `overflow-x:hidden` en body se corta «Iniciar sesión». Compactar padding y ocultar buscar/WA ≤1200; hamburguesa ≤1100.
- **Studio fondos:** upload `POST /api/web/tema/fondo` → `/static/uploads/fondos/{uuid}.ext`. La carpeta debe ser `mckg:mckg` (setgid 2775): si queda de `cynthia`/`root`, Errno 13 y el adjuntar no pega. Fotos del hero = nodos `hero.foto_izq` / `hero.foto_der` (`<img>`). Preview :8081 `GET /api/web/tema/fondo-archivo/<archivo>`.
- **Studio asas:** no poner handles `absolute` dentro de nodos `inline-flex`/`flex` (posición estática + overflow los descuadra). Portal a `[data-studio-paper]` con `medirCajaEnPapel` (getBoundingClientRect / scale). Papel `overflow-visible`.
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

## Cómo Actualizar

- Agregar solo hechos reutilizables.
- Si el aprendizaje es bug con causa raiz, guardar tambien con `scripts/guardar_memoria_debug.py`.
- Si cambia contrato publico, actualizar `docs/agentic/CONTRACTS.md` y ficha de modulo.
