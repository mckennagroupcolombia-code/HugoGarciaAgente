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
- GET del panel empieza en `/api` y reintenta `/app/api` si llega HTML: el endpoint Flask debe existir en **ambos** prefijos. El catch-all SPA `/app/<path>` no puede servir `index.html` para `/app/api/*`.
- Auth usa Bearer `CHAT_API_TOKEN`.
- Preferencias UI (`preferencias_ui.panel`): `mode`, `fontSans`, `accentRgb`, `radius`, `skin` (variantes visibles `matrix` | `sakura` | `barbie`; `clasica`/`atelier` se mapean a Sakura), `fontScale`, `menuScale`, `colors` (menú/títulos/cajas), `customThemes` (hasta 12 temas del usuario).
- Cambios en endpoint deben reflejarse en hook/tipo UI.
- Panel `empaque` (Atención): ventas MeLi/web/WA + fotos en `/api/empaque/*`; permiso `permisos_secciones.empaque`.
- Publicaciones → pestaña **Competencia**: `GET/POST /api/meli/competencia-precios*`.
- Publicaciones → Catálogo pestaña **Sitios**: `GET /api/publicaciones/<sku>?live_meli=1` (`vista_sitios`); `POST /api/publicaciones/<sku>/estado-meli` (`active`\|`paused`). Lista: query `canal`.
- Inicio (Agenda y Métricas): gadget USD/COP — cifra TRM BanRep (`GET /api/inicio/dolar-hora`) + mini TradingView; clic amplía gráfico horario TV.
- Contabilidad → **Créditos adquiridos**: `GET/POST /api/contabilidad/creditos*`; tasa EA o N.A.M.V., cuota y amortización.

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
