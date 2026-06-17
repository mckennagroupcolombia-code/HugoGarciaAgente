# Module: MeLi Compliance Monitor

## Proposito

Crear publicaciones MeLi **nuevas** compliant (cuando la anterior está prohibida) y hacer **seguimiento diario** automático con alertas WhatsApp.

## Archivos Ancla

- `app/tools/meli_compliance_monitor.py` — watchlist, crear nueva, revisión diaria
- `app/tools/meli_compliance.py` — `crear_publicacion_meli` (family_name UP)
- `scripts/meli_compliance_monitor_cron.py` — cron 8:30
- `app/data/meli_compliance_watchlist.json` — publicaciones en seguimiento
- `app/data/meli_compliance_monitor_log.jsonl` — log de eventos
- `desktop/src/components/MeliComplianceTab.tsx` — UI crear nueva + watchlist

## Flujo agentico

1. **Detectar** publicación prohibida (`sub_status=forbidden`) en panel Republicar en MeLi.
2. **Generar** contenido compliant (Gemini/Claude) — título, descripción, LINE, MCO8830.
3. **Crear nueva** publicación con `family_name` (modelo User Product, como competidores activos).
4. **Registrar** en watchlist con `item_origen_id` de la publicación vieja.
5. **Revisar diario** (cron): estado, sub_status, diagnóstico de riesgo.
6. **Alertar** WhatsApp (`GRUPO_ALERTAS_SISTEMAS_WA`) si pasa a forbidden/paused o riesgo alto.

## Referencia competidor (citrato magnesio 500g)

- URL: citrato-de-magnesio-puro-500-g (Banquete / similares activos)
- `category_id`: MCO8830 · `domain_id`: MCO-SUPPLEMENTS
- `LINE`: Materias primas alimentarias
- Evitar: Sal de magnesio, suplemento, MCO-SALT

## API

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/api/meli/compliance/crear-nueva` | POST | Crear publicación + seguimiento |
| `/api/meli/compliance/watchlist` | GET | Listar en seguimiento |
| `/api/meli/compliance/watchlist/revisar` | POST | Revisión manual (body: `whatsapp`) |
| `/api/meli/compliance/referencia` | GET | Plantilla competidor |

## Cron

```bash
./scripts/instalar_cron_mcKenna.sh   # añade 8:30 diario
# o manual:
AGENTE_COMPLIANCE_MONITOR_QUIET=1 python scripts/meli_compliance_monitor_cron.py
```

Variables: `AGENTE_COMPLIANCE_MONITOR_SKIP_WA=1` (sin WhatsApp en pruebas).

## Post-creación manual (obligatorio)

1. Subir foto **etiqueta alternativa** (Studio → Alternativa) en MeLi.
2. Verificar que no queden publicaciones activas duplicadas del mismo SKU.
3. Cerrar publicaciones prohibidas viejas cuando MeLi lo permita.

## Validar

```bash
python -c "from app.tools.meli_compliance_monitor import crear_publicacion_nueva_compliance; print(crear_publicacion_nueva_compliance(sku='TEST', nombre='Test', presentacion='500g', precio=1, dry_run=True))"
python scripts/meli_compliance_monitor_cron.py
cd desktop && npm run build
```
