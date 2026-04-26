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
