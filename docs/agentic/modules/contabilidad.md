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
- `app/services/contabilidad_mayor.py` (sep-2026) — el libro **por cuenta contable**, solo
  lectura: `arbol_cuentas()` reconstruye la jerarquia del PUC desde el codigo (clase 1 digito →
  grupo 2 → cuenta 4 → subcuenta 6) con saldo inicial/debitos/creditos/saldo final acumulados en
  cada nivel, y `extracto_cuenta()` devuelve el estado de cuenta: saldo corrido, **contrapartida**
  de cada linea (contra que otras cuentas se movio el asiento) y resumen por tercero.
  `extracto_csv()` exporta lo mismo. PDF en `app/tools/extracto_contable_pdf.py`
  (`generar_pdf_extracto`, `generar_pdf_balance`). Endpoints: `/api/contabilidad/cc/arbol`,
  `/api/contabilidad/cc/extracto/<id>` (+ `.pdf`, `.csv`) y `/api/contabilidad/cc/balance.pdf`.
  Panel: `desktop/src/components/MayorCuentasPanel.tsx`, subvista **Libro Mayor** dentro de la
  etapa 3 Consultar.
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

## Socios dentro de la contabilidad (sep-2026)

La contabilidad personal de cada socio vive **dentro** de la de la empresa, en `contabilidad.db`,
como un wizard de seis pasos (`/app` → Contabilidad → Libro Mayor → ámbito **Socios**, o la
sección **Socios** del hub): perfil fiscal → extractos personales → cuenta con McKenna → cruces
socio ↔ empresa → activos digitales (Declarador) → cierre para el contador.

- `app/services/extracto_bancario.py` — `extractos_bancarios.tercero_id` (NULL = empresa; id de
  `cc_terceros` tipo socio = extracto PERSONAL). `_filtro_titular()` se aplica en `listar_extractos`,
  `pendientes_por_clasificar`, `candidatos_para_movimiento` (y por ende `sugerencias_auto`),
  `consultar_por_concepto` y `saldo_bancario_mas_reciente`: **el banco de un socio jamás entra a la
  conciliación de McKenna**. Nuevos: `cobertura_mensual(tercero_id)` (meses con/sin extracto por
  cuenta) y `lineas_por_titular()`.
- `app/services/declarador.py` — tablas `dl_expedientes`, `dl_documentos`, `dl_anios`, `dl_hallazgos`,
  `dl_chat`. `importar_carpeta(tercero_id, carpeta)` trae la carpeta del Declarador original
  (`DECLARADOR_DIR`, default `/home/mckg/Declarador/<PrimerNombre>/`) SIN copiar archivos: registra
  documentos por categoría/año (reglas por nombre en `_REGLAS_CATEGORIA`), lee
  `declarado_f210.json` (años declarados + perfil + pendientes conocidos) y agrega
  `Calculos/eventos_realizados_fifo.csv` por año y cédula (renta ordinaria / ganancia ocasional /
  sin costo base). Idempotente. `cruces_socio_empresa()` empareja banco-socio ↔ banco-empresa por
  monto ±1 y fecha ±3 días y marca si el lado empresa ya tiene asiento. `responder_agente()` es el
  agente de terminal del Declarador llevado al panel: Claude con tool-use (`listar_documentos`,
  `leer_documento` —md/csv/pdf vía pdftotext/xlsx—, `consultar_extracto_personal`,
  `cruces_con_empresa`, `registrar_hallazgo`, `actualizar_anio`), Gemini sin herramientas como red de
  seguridad, todo por `llm_budget` (contexto `declarador`, modelo `DECLARADOR_MODELO`, default
  `claude-sonnet-5`).
- `app/routes_declarador.py` — `/api/socios`, `/api/socios/<id>/{expediente,perfil,pasos/<paso>,
  documentos,importar-carpeta,anios/<ano>,hallazgos,cruces,agente}`. **Privacidad:** cada socio ve
  SOLO su expediente (`cc_terceros.usuario_id`); únicamente la cuenta `admin` real o el
  CHAT_API_TOKEN crudo ven todos — tener nivel 3 no basta (los dos socios lo tienen). Misma regla
  que los gastos personales de Cuenta de Socio. `/api/contabilidad/extractos` (GET/POST) y
  `/extractos/pendientes` aceptan `tercero_id` con esa misma validación.
- `desktop/src/components/SociosPanel.tsx` (wizard) y `LibroMayorPanel.tsx` reorganizado en
  cuatro etapas —Conciliar (wizard de 4 pasos con estado real sobre el Diario), Registrar,
  Consultar, Configurar— más el ámbito Empresa/Socios. `IngresosEgresosPanel` recibe
  `abrirCargaSignal` / `abrirSugerenciasSignal`; `CuentaSocioPanel` acepta `terceroId` fijo.
- Datos personales que NO van al repo: la carpeta del Declarador (fuera del repo) y
  `comprobantes/socios/<tercero_id>/` (documentos subidos, gitignored vía `comprobantes/`).
  `Declarador/Armando/declarado_f210.json` es el seed editable de lo declarado en cada F210.
- **Wizard interactivo (14-sep):** el paso 1 «Empecemos» es un cuestionario de 5 preguntas
  (`CUESTIONARIO`: cripto, declaró antes, desde qué año, otras plataformas, préstamos con familia) +
  cédula; NO se pide teléfono, cuenta bancaria, UID Binance ni carpeta. Las respuestas se guardan en
  `dl_expedientes.cuestionario_json` y se deducen de lo ya cargado (`cuestionario_inferido`) para no
  volver a preguntar. El paso 2 «Plan de carga» (`plan_carga`, `REQUISITOS`) lista por categoría y
  año qué documentos pide ese caso, cómo conseguirlos, cuántos tiene el socio y cuántos tiene el
  **socio de referencia** (`socio_referencia`: el otro con más documentos — solo conteos, nunca
  cifras), con carga directa por renglón/año y «No aplica en mi caso» (`omitidos`).
  `crear_carpeta_socio` crea `DECLARADOR_DIR/<Nombre>/` con la estructura numerada (01_Declaraciones_Renta
  … 06_Soportes), `LEEME.md` y la plantilla `declarado_f210.json`.
- **Layout del Declarador por socio:** `importar_carpeta` solo recorre la carpeta del socio
  (`followlinks=True`). `Calculos/`, `Para_Contador/` y `balance_cripto_dian.md` son de Armando y están
  enlazados dentro de `Armando/`; `Para_Contador/` se salta (son copias) salvo `01_Informe_Principal`.
  La primera importación de Cynthia se trajo los cálculos cripto de Armando por estar en la raíz —
  se limpió y se cambió el importador.
- Estado al 2026-09-14: expediente de Armando importado (123 archivos + 94 capturas, 6 años
  gravables 2020-2025 con efecto cripto, 18 pendientes abiertos, historial bancario 2019-2024 como
  extracto personal #10 con 5.116 líneas). Cynthia: carpeta creada con la estructura de Armando y su
  export de la API de Binance copiado a `Cynthia/04_Binance/api_export/` (10 documentos); le falta todo lo demás.

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
- `extractos_bancarios.tercero_id IS NULL` es la empresa. Toda consulta que agregue líneas de varios
  extractos pasa por `_filtro_titular()`; una función nueva que lea `extracto_movimientos` sin ese
  filtro mezclaría el banco personal de un socio con el de McKenna.
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
- `arbol_cuentas()` **sintetiza** los niveles del PUC que no existen como cuenta en el libro
  (hay `529505` pero no `5295`), y los rotula con `_NOMBRES_CLASE`/`_NOMBRES_GRUPO`/
  `_NOMBRES_CUENTA`. Si el nombre sale como «Cuenta 5295» es que falta ese codigo en el mapa —
  no que el arbol este mal armado.
- Un nodo del arbol distingue `propio` (asentado directo en esa cuenta) de los totales
  (propio + descendientes). En este libro no es teorico: `1110` Bancos y `111010` MercadoPago
  mueven las dos, y confundirlos esconde los traslados. Un hijo de naturaleza contraria a la del
  padre (`4175` Devoluciones, debito, dentro de la clase 4 que es credito) **resta** al acumular.
- El PUC sembrado es simplificado (subset del PUC colombiano real); antes de que el contador lo
  use como referencia final, revisar que los codigos usados no colisionen con su propio plan de
  cuentas en Alegra.

## Validacion

- `pytest tests/test_smoke.py tests/test_extracto_bancario.py tests/test_contabilidad_mayor.py`
  (no rompe nada existente; el ultimo cubre arbol, extracto, contrapartida, CSV y PDF).
- Prueba manual con Flask test client (`app.routes.register_routes`) contra una COPIA de
  `app/data/contabilidad.db` — nunca contra la base real sin `--dry-run` primero.
- `cd desktop && npm run build` (tsc + vite) antes de dar por buena cualquier cambio de panel.
- Verificar `balance_comprobacion()["cuadra"] == True` despues de cualquier cambio que toque
  `crear_movimiento` o el auto-posteo.

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "contabilidad libro mayor partida doble prestamos socios conciliacion bancaria"
```
