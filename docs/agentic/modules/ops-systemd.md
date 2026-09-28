# Module: Ops Systemd

## Proposito

Mantener servicios productivos sin procesos duplicados: agente Flask, webhook MeLi, sitio web, bridge WhatsApp y tunel.

## Archivos Ancla

- `scripts/systemd/*`
- `scripts/instalar_servicios_systemd.sh`
- `scripts/diagnostico_servicios_mcKenna.sh`
- `scripts/normalizar_webhook_meli.sh`
- `scripts/lib/mckenna_nohup_guard.sh`
- `start.sh`

## Invariantes

- Un solo dueño por puerto.
- No mezclar systemd system con user services para el mismo proceso.
- `webhook_meli.py` usa flock y puerto 8080.
- `agente_pro.py` sirve puerto 8081.
- Bridge WhatsApp corre desde `bot-mckenna/` en puerto 3000.

## Riesgos

- Unidad `failed` pero enabled no significa proceso sano.
- Nohup + systemd pueden duplicar procesos.
- Reinicios rapidos pueden dejar estado transitorio en puertos.
- Cambiar `WorkingDirectory` rompe rutas relativas de SQLite/Chroma.

## Validacion

En host productivo/staging:

```bash
./scripts/diagnostico_servicios_mcKenna.sh
curl http://localhost:8080/status
curl http://localhost:8081/status
```

No correr normalizacion destructiva sin confirmar dueño actual del puerto.

---

## Traído de CLAUDE.md (27-sep-2026)

> Texto movido tal cual al comprimir CLAUDE.md; allí queda un resumen con enlace aquí.

### Producción: un solo dueño por puerto (systemd vs nohup)

| Puerto | Proceso | Unidad systemd (plantilla en `scripts/systemd/`) |
|--------|---------|---------------------------------------------------|
| 8080 | `webhook_meli.py` | `webhook-meli.service` |
| 8081 | `agente_pro.py` | `agente-pro.service` — **la unidad viva**; `mckenna-agente.service` hace lo mismo y está deshabilitada a propósito (12-sep-2026: tener ambas enabled la dejó en `failed` por `Address already in use` desde el 8-sep, sin que nadie lo notara). Nunca habilitar las dos. |
| 8083 | `PAGINA_WEB/site/website.py` | `mckenna-website.service`. Al detenerse (stop, restart o caída) programa un chequeo 8 s después (`scripts/systemd/mckenna_web_respaldo_check.sh`): si sigue apagada, `mckenna-website-mantenimiento.service` (no habilitada; `scripts/servidor_mantenimiento.py`) sirve `PAGINA_WEB/site/mantenimiento/index.html` con **503 + Retry-After** en el mismo puerto (Cloudflare la deja pasar). Arrancar la web la apaga (`Conflicts=` + `After=`, solo en la unidad de la web). Mantenimiento planeado sin apagar: `touch PAGINA_WEB/site/data/MANTENIMIENTO` / `rm`. |
| túnel | `cloudflared` | `cloudflared.service` u otra unidad que gestione el túnel |

- **`mantener_servicios.sh`** y **`start_services.sh`** cargan `scripts/lib/mckenna_nohup_guard.sh`: si la unidad está **active** o brevemente **activating** (`_mckenna_unit_controls_service`), **no** lanzan ese servicio con `nohup`. **No** basta con `is-enabled`: una unidad **failed** pero enabled dejaba bloqueado el nohup y un `webhook_meli.py` huérfano. Evita un segundo `webhook_meli.py` mientras reinicias con `normalizar_webhook_meli.sh`. **No** mezclar **system** `agente-pro` / `webhook-meli` con **user** `mckenna-agente` / `mckenna-webhook-meli` (doble proceso y reinicios en bucle en el mismo puerto).
- Instalar plantillas: **`./scripts/instalar_servicios_systemd.sh`**, luego `systemctl enable --now` solo lo necesario.
- Diagnóstico: **`./scripts/diagnostico_servicios_mcKenna.sh`** (antes `diagnostico_webhook_8080.sh`).
- Si el diagnóstico muestra **2 procesos** `webhook_meli.py` o el PID del **8080 ≠ MainPID** de systemd: **`./scripts/normalizar_webhook_meli.sh`**.
- `webhook_meli.py` usa **flock** (`.webhook_meli.lock`) para una sola instancia; **no** hace bind de prueba al 8080 antes de cargar Flask (evita `EADDRINUSE` por **TIME_WAIT** tras `restart` y bucle de fallos en systemd).
- Tras muchos fallos en webhook: `sudo systemctl reset-failed webhook-meli` y copiar `StartLimitBurst` actualizado del repo en la unidad instalada.

---
