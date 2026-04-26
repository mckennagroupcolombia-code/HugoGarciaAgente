# Module: Desktop Panel

## Proposito

Panel React de operaciones servido en `/app`, con API Flask en `/api/*` y chat en `/chat`.

## Archivos Ancla

- `desktop/src/api/client.ts`
- `desktop/src/App.tsx`
- `desktop/src/hooks/*`
- `desktop/src/components/*`
- `app/routes.py`

## Invariantes

- Vite usa base `/app/`.
- Produccion sirve `desktop/dist` desde Flask.
- Mutaciones pueden usar `/app/api/...` para evitar proxies que devuelven HTML.
- Auth usa Bearer `CHAT_API_TOKEN`.
- Cambios en endpoint deben reflejarse en hook/tipo UI.

## Riesgos

- Contrato Flask/TypeScript implicito y sin OpenAPI.
- Polling excesivo en panel puede cargar servidor.
- Token en `localStorage` implica riesgo XSS.
- Build no actualizado deja produccion con UI vieja.

## Validacion

```bash
cd desktop && npm run qa:full
```

Si cambia backend del panel:

```bash
pytest tests/test_smoke.py
python scripts/auditar_scripts_cron.py
```

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "desktop panel api app api vite"
```
