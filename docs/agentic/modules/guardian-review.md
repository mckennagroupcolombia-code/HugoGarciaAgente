# Module: Guardian Review

## Proposito

Usar revision AI tipo `gentleman-guardian-angel` como capa opcional antes de commit/PR, encima de tests locales. Objetivo: detectar violaciones de reglas, riesgos de regresion y cambios inseguros.

## Archivos Ancla

- `docs/agentic/CHECKLIST.md`
- `docs/agentic/CONTRACTS.md`
- `CLAUDE.md`
- `.github/workflows/backend-qa.yml`
- `.github/workflows/desktop-qa.yml`

## Invariantes

- La revision AI no reemplaza tests.
- Primera etapa debe ser informativa, no bloqueante.
- Reglas deben salir de `CLAUDE.md`, `docs/agentic/*` y contratos del repo.
- No enviar secretos ni archivos de credenciales a proveedores externos.

## Riesgos

- Falsos positivos bloqueando trabajo urgente.
- Falsos negativos si reglas estan incompletas.
- Costos/tokens si revisa diffs grandes sin cache.
- Exposicion de datos sensibles si no hay filtros.

## Validacion

Antes de activar como hook bloqueante:

```bash
venv/bin/python -m pytest tests/test_smoke.py
AGENTE_AUDITORIA_SKIP_WA=1 AGENTE_AUDITORIA_CRON_QUIET=1 venv/bin/python scripts/auditar_scripts_cron.py
```

Luego correr guardian en modo reporte sobre staged diff/PR y ajustar reglas.
