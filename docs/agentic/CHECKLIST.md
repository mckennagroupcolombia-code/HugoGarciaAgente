# Change Checklist

Usar antes y despues de cambios no triviales.

## Antes

- Objetivo claro en una frase.
- Modulo principal identificado.
- Ficha de modulo leida.
- Memoria consultada si el area tuvo bugs previos.
- Archivos a tocar acotados.
- Invariantes anotados.
- Validacion definida antes de editar.

## Durante

- Cambios pequenos por frontera de modulo.
- No mezclar refactor con bugfix salvo necesario.
- No tocar JSON persistente sin entender lectores/escritores.
- No cambiar puerto/proceso sin revisar systemd y nohup guard.

## Despues

- Ejecutar validacion proporcional.
- Revisar lints de archivos editados.
- Actualizar ficha/contrato si cambio behavior publico.
- Guardar memoria si hubo bug reusable o decision.
- Reportar riesgo residual.

## Validacion Por Riesgo

| Riesgo | Validacion minima |
| --- | --- |
| Sintaxis Python | `python scripts/auditar_scripts_cron.py` |
| Helpers backend | `pytest tests/test_smoke.py` |
| Panel React | `cd desktop && npm run qa:full` |
| Servicio en host | `./scripts/diagnostico_servicios_mcKenna.sh` |
| Webhook MeLi | payload fixture + logs `meli_notification_received` |
| WhatsApp bridge | `/monitor` del bridge y prueba de envio controlada |
