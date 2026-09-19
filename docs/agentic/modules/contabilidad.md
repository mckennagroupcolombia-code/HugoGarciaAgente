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


---

## Flujo J completo (movido desde CLAUDE.md el 2026-09-19)


Ver ficha completa en `docs/agentic/modules/contabilidad.md`. Resumen:

```
app/services/contabilidad_core.py   Libro de partida doble propio: PUC, terceros, medios de
                                     pago, asientos (débito=crédito validado), cuenta en T,
                                     balance de comprobación. Plantillas: compra_socio_amazon,
                                     pago_socio, compra_proveedor, ingreso, egreso,
                                     prestamo_recibido/otorgado + sus abonos.
app/services/puc_colombia.py        **PUC real (Decreto 2650)**, desde sep-2026. El libro nació con
                                     códigos escritos a ojo y varios significaban otra cosa: `2367` NO es
                                     «costos y gastos por pagar» (es **IVA retenido**; eso es `2335`),
                                     `2380` NO es la cuenta de socios (es «Acreedores varios»; socios es
                                     `2355`), y `236515` NO es rendimientos financieros (es **honorarios**;
                                     rendimientos es `236535`). `ALIAS` mapea cada código viejo al real y
                                     `migrar(dry_run)` mueve los asientos. **`_cuenta_id_por_codigo()` resuelve
                                     por ese alias**, así que los ~60 call-sites que aún dicen `"2380"` siguen
                                     funcionando — la cuenta vieja no se borra, se desactiva. Ojo con el
                                     **código reutilizado**: `529505` dejó de ser publicidad (se fue a `523560`)
                                     y pasó a ser Comisiones (llegó desde `5299`, que en el PUC es
                                     «Provisiones»); `_orden_migracion()` vacía un código antes de rellenarlo,
                                     y si se invierte ese orden $105M de publicidad y $52M de comisiones
                                     terminan revueltos. `cuenta_retencion(concepto)` da la subcuenta de 2365
                                     por concepto (236525 servicios, 236540 compras…), que es como el
                                     contador arma el 350.
                                     ⚠️ **`migrar()` lleva registro** (`cc_puc_alias_aplicados`) de qué alias
                                     ya corrió, y los salta. No es opcional: después de la primera corrida
                                     `529505` ya no es publicidad sino Comisiones, y repetir el alias se
                                     llevaría esos $52M a publicidad. El estado del plan NO permite
                                     deducirlo (la cuenta queda activa, con otro nombre, idéntica a una sin
                                     migrar), por eso el hecho se registra en vez de inferirse.
scripts/reclasificar_gastos_diversos.py  Saca de `5195 Diversos` lo que nunca fue diverso. El
                                     auto-posteo manda ahí toda compra que no sabe clasificar, y el cajón
                                     llegó a $3,17M donde el 47% eran fletes y el 40% el registro mercantil.
                                     Reclasifica **en el sitio** (UPDATE de `cuenta_id`) porque ninguno de
                                     esos asientos estaba espejado; cuando YA lo está, la corrección va por
                                     asiento de ajuste (`corregir_prestacion_servicios_sep2026.py`). Solo
                                     mueve lo que tiene respuesta inequívoca **por tercero** (`REGLAS`) y
                                     deja lo demás listado: adivinar qué fue una compra suelta en D1 es
                                     como se llenó el cajón. Verifica que el total del balance no cambie.
⚠️ **`CONTABILIDAD_LEDGER_BUDGET_S`** (default 28): presupuesto de las APIs remotas en
                                     `armar_libro()`. Los 28 s son para el PANEL, donde vale más una cifra
                                     parcial rápida. **Un backfill necesita subirlo** (p. ej. 900): postear
                                     un período a medias es peor que no postearlo, porque queda cuadrado, se
                                     ve completo y nadie vuelve a mirarlo. `auto_postear_periodo` ahora
                                     propaga `avisos` (lectura truncada) y `montos_por_fuente`, y el script
                                     de backfill los imprime — antes decía «1.300 creados» sin mencionar que
                                     faltaban facturas.
app/services/contabilidad_ledger.py → `factura_ya_contada()` (sep-2026): el libro toma ingresos de TRES
                                     fuentes que se solapan —órdenes de MeLi (`meli_venta`), pedidos de la
                                     tienda (`web_venta`) y **facturas** (`siigo_venta`), que son las
                                     facturas de esas mismas órdenes—. Una venta MeLi facturada se contaba
                                     dos veces, inflando ingreso y Bancos a la vez.
                                     ⚠️ El daño estaba contenido **por accidente**: el listado de facturas
                                     se corta a los 28 s (`_REMOTE_BUDGET_S`) y apenas traía un día. Subir
                                     ese presupuesto habría inflado el ingreso solo, sin tocar nada, y por
                                     un monto distinto cada vez. La marca la pone el facturador en
                                     `observations`, con DOS grafías: Alegra escribe «Venta MercadoLibre —
                                     Pack …» y astroselling, en Siigo, «Venta Mercado Libre #… - Facturado
                                     desde astroselling». Cubrir una sola deja pasar el histórico del otro.
                                     Limpieza de lo ya asentado: `scripts/anular_ventas_duplicadas.py`
                                     (128 asientos, $7.065.505, anulados el 16-sep-2026).
app/services/iva_ventas.py          **Reconocimiento del IVA de las ventas** (sep-2026). Las ventas se
                                     asentaban por su total contra 4135, pero McKenna es responsable de IVA:
                                     parte de ese total no es ingreso suyo. `reconocer(desde, hasta)` lo
                                     reclasifica a **240805 IVA generado** con un asiento de ajuste por
                                     período (las 1.269 ventas ya asentadas no se reescriben), idempotente
                                     por `referencia="iva-ventas:<rango>"`.
                                     ⚠️ La cifra sale de las **facturas emitidas en Alegra**, NO de dividir
                                     el total por 1,19: hay materias primas excluidas (Art. 424 E.T.) — en
                                     300 facturas, 484 ítems al 19% y 12 sin IVA. Aplicar la tarifa a todo
                                     inventa IVA sobre lo excluido y lo declara de más ante la DIAN.
                                     `resumen()` contrasta lo facturado contra el ingreso del libro: si no
                                     cuadran hay ventas sin facturar o facturas sin contabilizar, y el IVA
                                     se estaría calculando sobre una base que no corresponde.
                                     ⚠️ **Resta las notas crédito** (`notas_credito_del_periodo`): sin eso se
                                     declara IVA de ventas anuladas. Agosto-2026 tuvo **712 notas crédito por
                                     $44.441.972** —la campaña de corrección del IVA duplicado de
                                     astroselling, que anuló cada factura mala y reexpidió— con $4.560.640 de
                                     IVA. Es además lo que explicaba un hueco de $46,8M entre lo facturado y
                                     el libro que parecía un error de contabilización y no lo era.
                                     Aplicado el 18-sep-2026: jul $12.066.709 · ago $11.655.994 ·
                                     sep $4.071.769 (**$27.794.472** en 240805).
                                     Falta la otra mitad del formulario 300: el **IVA descontable** de las
                                     compras (240810). Sin ella el saldo de 2408 queda por encima de lo que
                                     realmente se paga. Script: `scripts/reconocer_iva_ventas.py`.
app/services/alegra_puc.py          Puente por CÓDIGO con Alegra, que desde sep-2026 está en el catálogo
                                     **PUC** (antes NIIF). Al cambiar de catálogo Alegra reasignó TODAS sus
                                     ids internas, así que el `MAPA_PUC` a mano de `alegra_espejo` quedó
                                     apuntando a cuentas que ya no existen: `cuenta_alegra()` consulta primero
                                     `construir_mapa()` y solo cae al diccionario viejo como respaldo.
                                     El catálogo de Alegra es **parcial** y sus cuentas de 4 dígitos son
                                     **agrupadoras**: hay que asentar contra la subcuenta, que Alegra a veces
                                     anida hasta 8 dígitos (1435 → 143505 → **14350501**). El emparejador baja
                                     al descendiente movible más alto y, si hay más de uno de verdad distinto
                                     (bajo 4135 cuelgan 413505 y 41350101), **no adivina**: esa elección es
                                     contable y se escribe a mano en `OVERRIDES`. Lo demás queda en
                                     `sin_equivalente`, nunca resuelto a una cuenta «parecida».
                                     ⚠️ **Alegra devuelve 503 en POST que SÍ se ejecutaron** (así se creó 5235
                                     la primera vez) y también usa 503 cuando falta `code` en modo PUC.
                                     Ante un 503, releer el catálogo y comprobar — nunca reintentar a ciegas,
                                     que es como se duplican cuentas del plan. Ver
                                     `scripts/crear_cuentas_ventas_alegra.py`.
                                     ⚠️ `cuenta_alegra()` solo cae al `MAPA_PUC` viejo si esa id **todavía
                                     existe** en Alegra: al cambiar de catálogo las ids se reasignaron, y sin
                                     ese chequeo el espejo creía tener cuenta para 1435 y 4135 y posteaba
                                     contra una id muerta en vez de negarse.
app/services/contabilidad_mayor.py  El libro **discriminado por cuenta contable** (solo lectura).
                                     `arbol_cuentas()`: la jerarquía del PUC reconstruida desde el
                                     código (clase → grupo → cuenta → subcuenta) con saldo inicial,
                                     débitos, créditos y saldo final en CADA nivel; sintetiza los
                                     niveles que no existen como cuenta (hay 529505 pero no 5295) y
                                     separa lo `propio` de un nodo de lo acumulado con sus hijos —
                                     1110 Bancos y 111010 MercadoPago mueven las dos.
                                     `extracto_cuenta()`: el estado de cuenta — saldo corrido, la
                                     **contrapartida** de cada línea (contra qué otras cuentas se
                                     movió ese asiento) y el resumen por tercero, acotable a un
                                     tercero o extensible a las subcuentas. `extracto_csv()` y
                                     `app/tools/extracto_contable_pdf.py` lo sacan en CSV y en PDF
                                     (extracto y balance jerárquico) para el contador.
                                     Panel: Libro Mayor → 3 Consultar → **Libro Mayor**
                                     (`MayorCuentasPanel.tsx`): árbol a la izquierda, extracto a la
                                     derecha, drill-down al asiento completo sin salir de la vista.
                                     Nació porque el libro tenía los datos pero solo se veían por un
                                     desplegable plano de 39 cuentas y un balance de una sola lista
                                     del que no se podía entrar a nada.
app/services/contabilidad_ledger.py armar_libro() (solo lectura: ventas MeLi/web/Siigo, compras,
                                     compras exterior, servicios, impuestos, créditos) +
                                     movimientos_manuales_como_libro() (los asientos manuales de
                                     arriba, en el mismo formato de fila, para fusionar sin tocar
                                     armar_libro()).
app/services/contabilidad_autopost.py  auto_postear_periodo(): traduce cada fila de armar_libro()
                                     a un asiento real (FUENTE_MAPEO fuente→cuenta PUC), dedupe
                                     por referencia="auto:<hash>". Cron cada 6h
                                     (scripts/contabilidad_autopost_cron.py, job
                                     "contabilidad_autopost" en Sistemas → Tareas Programadas) +
                                     backfill manual (scripts/backfill_contabilidad_autopost.py).
app/services/alegra_espejo.py       Espeja un asiento del Libro Mayor como comprobante contable
                                     en Alegra (`espejar_movimiento`) y **lo anula allá**
                                     (`anular_espejo`, `DELETE /api/alegra/espejo/<mov>`, botón en
                                     Libro Mayor → Movimientos al desplegar el asiento). Anular
                                     existe porque el contador declara con lo que ve en Alegra: un
                                     asiento anulado y rehecho dejaba el comprobante viejo allá con
                                     las cifras malas (16-sep-2026). Solo borra comprobantes que
                                     este sistema creó (`cc_alegra_espejo`) y se niega mientras el
                                     asiento siga confirmado, salvo `?forzar=1`.
app/services/meli_facturacion.py    La factura mensual de MeLi, desglosada por concepto y
                                     traducida al PUC. GET /billing/integration/... — **5 peticiones
                                     por minuto**, el módulo pacea solo y cachea los períodos
                                     cerrados. Existe porque ese gasto no se ve por ningún lado:
                                     MeLi cobra $44-47M/mes (de los cuales ~$24M son PUBLICIDAD) y
                                     **nada de eso pasa por el extracto bancario** — la factura se
                                     cobra contra el saldo de MercadoPago (111010), y el banco solo
                                     ve el traslado que fondea esa cuenta.
                                     ⚠️ NO usar `meli_ads.gasto_ads_por_rango()` para contabilizar:
                                     para ago-2026 reportó $654.448 cuando la factura cobró
                                     $23.853.390 (35x). Las métricas sirven para decidir campañas;
                                     la factura es la fuente de verdad.
                                     ⚠️ Los `detail_sub_type` que empiezan por «B» son anulaciones y
                                     RESTAN, aunque la API los manda en positivo y sin marcarlos
                                     CREDIT. Van a la misma cuenta que anulan (BV→CV, BXD→CXD,
                                     BFF→CFF: se cambia la B por C). Sumándolos en positivo, agosto
                                     daba $46.013.088 contra los $44.175.672 reales.
app/services/extracto_clasificador.py  Propone cuenta PUC + tercero para las líneas de banco
                                     que NO tienen contrapartida en el libro (las que
                                     `sugerencias_auto` no puede emparejar porque la operación
                                     nunca se contabilizó: 200 de 358 en jul-ago 2026). Reglas por
                                     descripción del banco; `proponer()` / `resumen()` NO escriben
                                     nada. Endpoint `/api/contabilidad/extractos/clasificacion`.
                                     Tres trampas que las reglas evitan a propósito: (a) los
                                     traslados a MercadoPago son plata propia, no ingreso ni gasto
                                     ($40,7M en ago-2026); (b) el banco rotula «PAGO A PROVE» la
                                     quincena de quien presta servicios — persona natural va a 5135
                                     con retención, no a 2205; (c) una entrada sin identificar no se
                                     marca como venta, que ya entra por el auto-posteo.
app/services/extracto_bancario.py   Conciliación bancaria (ya existente): importar extracto,
                                     vincular/desvincular, sugerencias automáticas,
                                     pendientes_por_clasificar() (líneas de banco sin vínculo).
                                     `vincular()` es agnóstica al formato de movimiento_id — un
                                     hash de armar_libro() o "cc:<id>" de un asiento manual
                                     funcionan igual.
```

**Conciliación con el contador (13-sep-2026):** `scripts/descargar_soportes_contador.py` baja del
Gmail los adjuntos del contador (350, 490, 300, 110, ICA, RTICA, certificados) a
`docs/contabilidad/<año>/Soportes_Contador/` (gitignored) y `scripts/extraer_declaraciones_contador.py`
los lee con pdftotext. `app/services/conciliacion_contador.py` cruza eso contra la 2365 y guarda cada
inconsistencia como **hallazgo** (`cc_conciliacion_hallazgos`, clave determinista, idempotente) que el
usuario recorre en /app → Contabilidad → **Conciliación contador** (wizard: un hallazgo por pantalla,
decidir → TKT del Centro de Mando asignado al aliado `conciliacion_contador`). Lo que deja de detectarse
se cierra solo. Única mutación directa: marcar un tercero como natural / **Régimen SIMPLE**
(`cc_terceros.regimen_simple`, Art. 911 ET: no se le retiene; el XML DIAN dice `R-99-PN` igual, se sabe
por el pie de la factura o el RUT). Nunca crea ni anula asientos — eso va por ticket. Sin LLM.

Panel: Contabilidad → **Libro Mayor** (PUC/terceros/asientos/balance) y **Préstamos**
(`PrestamosPanel.tsx`, permiso propio no heredado — datos sensibles de socios). Contabilidad →
**Ingresos y Egresos** fusiona `armar_libro()` con los asientos manuales y agrega la bandeja
**"Pendientes por clasificar"**: clasificar una línea de banco sin vínculo crea el asiento
correcto (incl. préstamo) y la vincula en un solo paso. Adjuntar comprobante (`ComprobanteWidget.tsx`,
compartido entre paneles) sustenta operaciones sin factura fiscal, p.ej. compras courier de un socio.

