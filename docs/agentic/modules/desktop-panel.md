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
- Studio visual (Cynthia): «Diligenciar etiqueta» es formulario HTML (no lienzo). Zoom, sliders de tipo/iconos/cajas y `POST /api/plantillas-visuales` con `ficha_mp` para reabrir el mismo formulario.
- Auth usa Bearer `CHAT_API_TOKEN`.
- Preferencias UI (`preferencias_ui.panel`): `mode`, `fontSans`, `accentRgb`, `radius`, `skin` (variantes visibles `matrix` | `sakura` | `barbie`; `clasica`/`atelier` se mapean a Sakura), `fontScale`, `menuScale`, `colors` (menú/títulos/cajas), `customThemes` (hasta 12 temas del usuario).
- Cambios en endpoint deben reflejarse en hook/tipo UI.
- Panel `empaque` (Atención): ventas MeLi/web/WA + fotos en `/api/empaque/*`; permiso `permisos_secciones.empaque`.
- Docs técnicos → Biblioteca: `POST /api/fichas/biblioteca/cargar-web` publica **solo** FT/COA/SDS completos en las fichas de producto (`documentos_web` exige COA y SDS diligenciados + PDF; `POST :8083/api/documentos/refresh`).
- Docs técnicos → escáner (pantallazo/PDF/URL): si la fuente está en inglés, los valores de texto se traducen y se **registran en español** (`documento_traducir_es.py`). No se traducen CAS, fórmulas, lote, INCI ni fabricante. Varias fotos COA: una transcripción por imagen y fusión de parámetros. `POST /api/fichas/coa/escanear-parametros` y `POST /api/fichas/ft/escanear-imagen` arrancan un job (`202` + `job_id`); el panel hace poll a `GET .../<job_id>` hasta `done` (el proxy corta POSTs ~100s). Fotos grandes se reducen a lado máx. 1800 px antes de Gemini.
- Publicaciones → pestaña **Competencia**: `GET/POST /api/meli/competencia-precios*`; `POST .../reporte-captura` arma el reporte desde un pantallazo (el servidor no visita MeLi).
- Publicaciones → Catálogo pestaña **Sitios**: `GET /api/publicaciones/<sku>?live_meli=1` (`vista_sitios`); `POST /api/publicaciones/<sku>/estado-meli` (`active`\|`paused`). **Agregar fotos** abre la galería (`POST /api/publicaciones/<sku>/imagenes/desde-galeria`). Lista: query `canal`.
- Inicio (Agenda y Métricas): gadget USD/COP — cifra TRM BanRep (`GET /api/inicio/dolar-hora`) + mini TradingView; clic amplía gráfico horario TV.
- Logística Internacional → **Proveedores** (`ProveedoresPanel.tsx`, `useProveedores.ts`): `/api/proveedores/*`; pestañas Directorio / ¿Quién vende…? / Catálogos (Gmail, sin LLM) / Oferta web (publica `oferta_proveedores.json` para `/cotizar`) / Cotizaciones. Permiso `logistica-internacional`.
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
