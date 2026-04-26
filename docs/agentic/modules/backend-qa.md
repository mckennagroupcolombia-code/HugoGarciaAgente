# Module: Backend QA

## Proposito

Detectar regresiones backend sin credenciales reales: sintaxis, contratos puros, guards y rutas Flask de bajo riesgo.

## Archivos Ancla

- `tests/test_smoke.py`
- `tests/conftest.py`
- `app/tools/script_audit.py`
- `.github/workflows/backend-qa.yml`
- `requirements.txt`

## Invariantes

- Tests no deben llamar APIs externas reales.
- `WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1` debe estar activo al importar webhook.
- Auditoria usa `py_compile`; no ejecuta `main`.
- CI debe correr con dependencias declaradas en `requirements.txt`.
- Si se agrega import en smoke, revisar que CI tenga dependencia.

## Riesgos

- Importar `agente_pro.create_app()` arranca monitores/backups; evitar en smoke salvo mocks.
- Importar `app.core` carga muchas herramientas y dependencias.
- Tests que escriben JSON deben usar `tmp_path` o monkeypatch de ruta.

## Validacion

```bash
venv/bin/python -m pytest tests/test_smoke.py
AGENTE_AUDITORIA_SKIP_WA=1 AGENTE_AUDITORIA_CRON_QUIET=1 venv/bin/python scripts/auditar_scripts_cron.py
```
