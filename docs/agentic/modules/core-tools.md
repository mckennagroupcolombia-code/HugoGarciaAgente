# Module: Core Tools

## Proposito

Configurar IA principal, prompt, herramientas Claude y bucle de tool-use para WhatsApp, `/chat` y CLI.

## Archivos Ancla

- `app/core.py`
- `app/tools/*`
- `app/services/*`
- `app/tools/system_tools.py`

## Invariantes

- Modelo principal WhatsApp/chat usa Anthropic segun env.
- Preventa MeLi con ficha usa Gemini en servicio separado.
- Tool nueva debe estar importada y registrada en lista de herramientas.
- No ejecutar sync sin intencion explicita del usuario.
- File tools se restringen en produccion con `AGENTE_RESTRICT_FILE_TOOLS` o `FLASK_ENV=production`.

## Riesgos

- Import pesado en `app/core.py` puede romper arranque completo.
- Firma de tool cambia y Claude queda con schema desactualizado.
- Tool con efectos laterales expuesta sin guardrails.
- Fallbacks IA pueden esconder error real si no queda log.

## Validacion

- `python scripts/auditar_scripts_cron.py`
- Test de guard de rutas en `app/tools/system_tools.py`.
- Si se agrega tool: test/import y llamada controlada sin credenciales reales.

## Checklist Tool Nueva

- Funcion tiene nombre claro y docstring.
- Import en `app/core.py`.
- Registro en lista de tools.
- Manejo de error devuelve texto util.
- Sin secretos en logs.
- Validacion agregada o documentada.
