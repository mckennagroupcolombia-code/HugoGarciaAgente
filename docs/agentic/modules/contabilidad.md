# Module: Contabilidad Unificada

## Proposito

Libro Mayor propio de partida doble como fuente de verdad contable de McKenna (ventas, compras,
socios, prestamos, conciliacion bancaria), en vez de llevar la contabilidad de facto en Alegra.
Alegra sigue recibiendo lo que ya recibia (facturacion) y queda como herramienta de
consulta/exportacion para el contador — ver Flujo J y Decision de Diseno 8 en `CLAUDE.md`.

Construido en 4 fases (sep-2026): conectar el motor de partida doble ya existente a Flask (estaba
escrito pero sin ninguna ruta), auto-postear el libro operativo, modelar prestamos en ambas
direcciones, y unificar la vista con una bandeja de pendientes por clasificar contra el extracto
bancario.

## Archivos Ancla

- `app/services/contabilidad_core.py` — PUC, terceros, medios de pago, `crear_movimiento`
  (valida debito=credito), `mayor_cuenta`, `balance_comprobacion`, `saldo_tercero`. Plantillas:
  `registrar_compra_socio_amazon`, `registrar_pago_socio` (ahora wrapper de
  `registrar_abono_pasivo_tercero`), `registrar_compra_proveedor`, `registrar_ingreso`,
  `registrar_egreso`, `registrar_prestamo_recibido`/`otorgado` + sus abonos. Comprobantes:
  `guardar_comprobante`/`ruta_comprobante`/`eliminar_comprobante`.
- `app/services/contabilidad_ledger.py` — `armar_libro()` (solo lectura, YA EXISTIA: agrega
  ventas MeLi/web/Siigo, compras, compras exterior, servicios, impuestos, creditos) +
  `movimientos_manuales_como_libro()` (nuevo: los asientos de arriba, mismo formato de fila,
  para fusionar sin tocar `armar_libro()`).
- `app/services/contabilidad_autopost.py` — `auto_postear_periodo()`: traduce cada fila de
  `armar_libro()` a un asiento real via `FUENTE_MAPEO` (fuente -> cuenta PUC), dedupe por
  `referencia="auto:<hash>"` (mismo hash que ya usa `extracto_bancario.id_movimiento_ledger`).
- `app/services/extracto_bancario.py` — conciliacion bancaria (YA EXISTIA con UI funcionando en
  `IngresosEgresosPanel.tsx`, no estaba huerfana). `vincular()`/`candidatos_para_movimiento()`/
  `sugerencias_auto()` son agnosticas al formato de `movimiento_id` (string libre) — un hash de
  `armar_libro()` o `"cc:<id>"` de un asiento manual funcionan igual, sin cambios. Nuevo:
  `pendientes_por_clasificar()`.
- `scripts/contabilidad_autopost_cron.py` + `scripts/backfill_contabilidad_autopost.py` — cron
  (job `contabilidad_autopost` en `app/services/cron_scheduler.py`, cada 6h) y backfill manual
  (`--dry-run` por defecto, requiere `--confirmar` para escribir).
- `desktop/src/components/LibroMayorPanel.tsx` (YA EXISTIA, sin backend hasta esta fase),
  `PrestamosPanel.tsx` (nuevo), `ComprobanteWidget.tsx` (nuevo, compartido), y la fusion
  armar_libro+manuales / bandeja "Pendientes por clasificar" en `IngresosEgresosPanel.tsx`.
- `desktop/src/lib/contabilidadAccess.ts` — permisos `libro-mayor` y `prestamos` son EXPLICITOS,
  no se heredan de facturacion/sync (datos sensibles de socios).

## Invariantes

- `crear_movimiento` siempre valida suma(debitos) == suma(creditos); nunca se persiste un
  asiento descuadrado.
- `armar_libro()` no se modifica para leer `cc_movimientos` — la union es aditiva en el frontend
  (`IngresosEgresosPanel.tsx`) y en `movimientos_manuales_como_libro()`, nunca al reves.
- Los `tipo_origen` que empiezan con `auto_` (creados por `contabilidad_autopost.py`) se EXCLUYEN
  de `movimientos_manuales_como_libro()` — ya estan representados por su fila original en
  `armar_libro()`; incluirlos ahi los duplicaria en la vista.
- Dedupe del auto-posteo es por `referencia`, no por fecha/monto — reprocesar el mismo rango
  (cron o backfill) nunca crea asientos repetidos.
- Cuentas PUC de socios vs terceros no se mezclan: `2380`/`1355` son de socios,
  `2295`/`1290` de terceros — la eleccion depende de `tercero.tipo`.
- Migraciones de esquema (`_migrar_cuentas_v2`, `_migrar_columnas_v3`) deben ser idempotentes
  (`INSERT OR IGNORE` / chequeo de `PRAGMA table_info` antes de `ALTER TABLE`) — se corren en
  cada `init_db()`, tanto en bases nuevas como existentes.
- El comprobante adjunto vive en `comprobantes/contabilidad/` (repo, en `.gitignore`, junto a
  `comprobantes/`) — nunca en `app/data/`.

## Riesgos

- `FUENTE_MAPEO` en `contabilidad_autopost.py` es una lista cerrada de fuentes conocidas; una
  fuente nueva en `armar_libro()` sin mapeo queda en `fuentes_sin_mapeo` (reportado, no
  descartado en silencio) hasta que se agregue su regla contable.
- El backfill (`--confirmar`) escribe cientos de asientos reales de una sola vez — correrlo
  siempre en `--dry-run` primero sobre el rango real antes de confirmar.
- `movimientos_manuales_como_libro()` solo incluye asientos con una "pata" en una cuenta de
  medio de pago (Caja/Bancos); un asiento de pura reclasificacion interna (sin esa pata) no
  aparece en la vista de Ingresos/Egresos — es normal, no un bug.
- El PUC sembrado es simplificado (subset del PUC colombiano real); antes de que el contador lo
  use como referencia final, revisar que los codigos usados no colisionen con su propio plan de
  cuentas en Alegra.

## Validacion

- `pytest tests/test_smoke.py tests/test_extracto_bancario.py` (no rompe nada existente).
- Prueba manual con Flask test client (`app.routes.register_routes`) contra una COPIA de
  `app/data/contabilidad.db` — nunca contra la base real sin `--dry-run` primero.
- `cd desktop && npm run build` (tsc + vite) antes de dar por buena cualquier cambio de panel.
- Verificar `balance_comprobacion()["cuadra"] == True` despues de cualquier cambio que toque
  `crear_movimiento` o el auto-posteo.

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "contabilidad libro mayor partida doble prestamos socios conciliacion bancaria"
```
