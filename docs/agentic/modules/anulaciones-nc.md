# Module: Resolucion de Anulaciones (RA)

> **Estado: IMPLEMENTADO (2026-09-08), EMISION EN MODO SOMBRA.** El codigo existe y esta
> probado (`pytest tests/test_anulaciones.py`, 26 tests). `RA_EMISION_ACTIVA=0` por defecto:
> el motor detecta, clasifica, decide y abre expedientes, pero NO llama a Alegra hasta que se
> ponga en 1. Antes de encenderlo faltan dos cosas que no dependen del codigo:
> `ALEGRA_NC_SIN_REFERENCIA_TYPE` (descubrir el literal, ver Riesgos) y la decision del
> contador sobre el rezago Siigo y el reembolso a cargo de MeLi. El panel del contador
> (Contabilidad -> Anulaciones) ya esta y compila (`cd desktop && npm run build`).

## Proposito

Modulo unico que resuelve **todo evento que anula o reduce una venta ya facturada** — cancelacion,
devolucion, reclamo, reembolso, cambio — emitiendo la nota credito de forma autonoma y dejando un
**expediente narrado** que sirve por igual al contador, al operador y al proximo agente IA que
toque el caso.

Reemplaza los cuatro caminos que hoy compiten por el mismo trabajo y por eso pierden casos:

| Camino actual | Cubre | Falla |
| --- | --- | --- |
| `scripts/emitir_notas_credito_cron.py` | `order.status == "cancelled"` | Ciego a devoluciones y reclamos |
| `app/meli_reclamos.py` | Reclamos MeLi | Los eventos llegan como `post_purchase` y se descartan; ademas pide anular al ABRIR el reclamo, no al resolverse |
| `app/tools/notas_credito.py` | Anulacion de pedido web | Ticket manual sin vencimiento |
| (ninguno) | Ventas WhatsApp, devolucion parcial | — |

### Las tres decisiones de diseño que lo sostienen

**1. El disparador es el reintegro, no el estado de la orden.**
La pregunta contable no es "¿la orden esta cancelada?" ni "¿se abrio un reclamo?" sino
**"¿al comprador le devolvieron dinero, y cuanto?"**. Eso es observable
(`order.payments[].status == "refunded"` / `refunded_amount`), ocurre igual cuando la orden nunca
cambia a `cancelled` — el caso que dejo el pack `2000014813807951` sin nota credito — y el monto
distingue total de parcial sin logica extra.

**2. Tres ejes independientes, hoy colapsados en uno.**

| Eje | Pregunta | Consecuencia |
| --- | --- | --- |
| Fiscal | ¿hubo reintegro al comprador? | Nota credito por el monto reintegrado |
| Inventario | ¿volvio el producto fisicamente? | Reingreso de stock, o baja por perdida |
| Economico | ¿quien puso la plata? | Perdida propia, o ingreso por compensacion de MeLi |

Un reembolso a cargo de MeLi anula la venta al comprador **igual** (si no, queda una factura
electronica viva contra alguien que ya no pago) y ademas genera un ingreso separado. Son dos
asientos, no uno neteado.

**3. La narrativa es un artefacto de primera clase, no un log.**
Cada expediente produce un relato en prosa que se escribe en DOS lugares: comprimido en las
`observations` del documento electronico (lo unico que el contador ve dentro de Alegra) y completo
en el expediente (lo que consulta el proximo agente). Mismo texto, dos audiencias.

## Matriz de situaciones

| Situacion | Señal | NC | Inventario | Financia |
| --- | --- | --- | --- | --- |
| Cancelacion antes de despacho | `cancelled` + refund total | Total | Reingreso (si se descontó al vender) | Vendedor |
| Devolucion con producto de vuelta | refund total + envio de retorno | Total | Reingreso **al recibir fisicamente**, no al emitir la NC | Vendedor |
| Reembolso sin devolucion | refund total, sin envio de retorno | Total | **Baja por perdida** | Vendedor |
| Reembolso a cargo de MeLi | refund al comprador, sin descuento al vendedor | Total | Segun retorno | MeLi → asiento aparte |
| Devolucion parcial | `refunded_amount` < total | **Por lineas** | Reingreso de los items devueltos | Vendedor |
| Cambio de producto, mismo valor | resolution `change_product` | **Ninguna** | Movimiento interno | — |
| Reclamo cerrado a favor del vendedor | sin refund | **Ninguna** | — | — |

La ultima fila es una trampa activa hoy: `crear_accion_anular_factura_por_reclamo()` crea el ticket
"anular factura" al **abrir** el reclamo. Si alguien lo trabaja obedientemente, anula facturas de
ventas vivas. Que hoy no se ejecute (los eventos `post_purchase` se descartan) es lo unico que lo
ha evitado.

## Esquema

En `app/data/contabilidad.db` (no en un JSON: el estado actual vive en
`app/data/notas_credito_auto_log.json`, que no sabe distinguir "resuelto" de "nunca intentado").

```sql
CREATE TABLE IF NOT EXISTS anulaciones (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo            TEXT NOT NULL UNIQUE,   -- "RA-2026-0142": el identificador publico
    referencia        TEXT NOT NULL UNIQUE,   -- "meli:pack:2000014813807951" — idempotencia
    origen            TEXT NOT NULL,          -- meli_cancelacion|meli_reclamo|web|whatsapp|manual
    order_id          TEXT, pack_id TEXT, claim_id TEXT,
    cliente_nombre    TEXT, cliente_doc TEXT,
    factura_proveedor TEXT,                   -- siigo|alegra
    factura_id        TEXT, factura_numero TEXT, factura_cufe TEXT,
    factura_fecha     TEXT, factura_total REAL,
    motivo            TEXT NOT NULL,          -- ver matriz de situaciones
    monto_reintegrado REAL, alcance TEXT,     -- total|parcial
    producto_retorna  INTEGER,                -- 1|0|NULL (aun no se sabe)
    financia          TEXT,                   -- vendedor|meli|compartido
    estado            TEXT NOT NULL,
    autonomia         TEXT,                   -- automatica|aprobada|manual
    nc_proveedor      TEXT, nc_id TEXT, nc_numero TEXT, nc_cufe TEXT,
    nc_total          REAL, nc_url TEXT,
    movimiento_id     TEXT,                   -- asiento en el libro mayor propio
    inventario_estado TEXT,                   -- pendiente|reingresado|baja|no_aplica
    ticket_id         INTEGER,
    relato            TEXT,                   -- narrativa acumulada, legible
    abierta_en        TEXT NOT NULL, cerrada_en TEXT,
    actualizado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anulacion_eventos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    anulacion_id  INTEGER NOT NULL REFERENCES anulaciones(id),
    ts            TEXT NOT NULL,
    actor         TEXT NOT NULL,   -- cron|webhook|agente:<nombre>|usuario:<id>
    tipo          TEXT NOT NULL,   -- detectado|enriquecido|decidido|emitido|fallo
                                   -- |subido_meli|posteado_libro|inventario|nota
    resumen       TEXT NOT NULL,   -- UNA frase legible, en español
    datos_json    TEXT,            -- payload crudo
    hash          TEXT             -- dedupe de eventos repetidos
);
```

`anulacion_eventos` es **append-only**. Nada se corrige editando: se corrige agregando un evento
que explica la correccion. Es lo que hace que el expediente sirva como precedente y no solo como
estado.

### Maquina de estados

```
detectada ──> en_margen (48h) ──> lista ──> emitiendo ──> emitida ──> subida_meli ──> cerrada
                                    │                        │
                                    │                        └──> posteado_libro
                                    ├──> requiere_decision  (fuera de politica de autonomia)
                                    └──> bloqueada          (motivo guardado, reintentable)
                                    └──> descartada         (reclamo cerrado a favor del vendedor)
```

`bloqueada` guarda el motivo estructurado (`proveedor_read_only`, `item_inactivo`,
`factura_no_encontrada`, `cliente_inexistente`) en vez de perderlo dentro del texto de un ticket
— que es lo que pasa hoy con el `read_only` de Siigo, reintentado a ciegas cada corrida.

## El relato: un texto, dos audiencias

**En `observations` de la nota credito** (lo unico que el contador ve en Alegra). Plantilla fija:

```
NC por devolucion MeLi · pack 2000014813807951 · reclamo 5572649029
Factura FV-2-71288 (Siigo) CUFE 9f3a... del 2026-09-01 por $77.494
Motivo: el comprador devolvio el producto; MeLi reintegro $77.494 el 2026-09-05
Producto recibido en bodega el 2026-09-07 y reingresado a stock
Expediente RA-2026-0142 - emitida automaticamente
```

**En el expediente**: el mismo relato mas la linea de tiempo completa, los enlaces (factura, NC,
asiento, ticket, orden MeLi) y los intentos fallidos.

El relato lo puede redactar el LLM. Los campos duros (montos, ids, CUFE, fechas) **no**: se
llenan desde la API y el LLM solo los narra. Un relato que contradiga los campos duros es un bug.

## Autonomia: politica explicita, no criterio del modelo

La decision de emitir es **determinista**, en codigo. El LLM narra y explica; no autoriza.

**Emite sola** cuando se cumple todo: reintegro confirmado por la API · factura en Alegra ·
motivo en la lista blanca (cancelacion pre-despacho, devolucion total con retorno, reembolso sin
devolucion) · monto ≤ `RA_UMBRAL_AUTONOMIA` · la factura no tiene NC previa (doble chequeo justo
antes del POST) · antiguedad > `NOTAS_CREDITO_MARGEN_HORAS`.

**Requiere aprobacion** (`requiere_decision` + ticket): reembolso a cargo de MeLi · devolucion
parcial · monto > umbral · factura de la era Siigo (NC sin referencia) · cliente con NIT real en
vez de consumidor final.

**Nunca sola**: reclamo abierto sin resolucion · factura que ya tiene NC · monto reintegrado que
no cuadra con la factura.

## Recursividad: como varios agentes comparten el contexto

Un solo identificador — `RA-2026-0142` — aparece en el titulo del ticket, en las `observations`
de la NC, en la `referencia` del asiento contable y en el log. Cualquier agente que lo vea en
cualquier superficie recupera todo lo demas.

Cuatro accesos, de mas curado a mas crudo:

1. **`consultar_expediente_anulacion(referencia_o_codigo)`** — herramienta registrada en
   `app/core.py`. Devuelve relato + linea de tiempo + enlaces en un solo bloque. Es lo que usa un
   agente al que le asignan un TKT: pide una cosa y recibe el caso entero.
2. **`buscar_anulaciones_similares(descripcion)`** — busqueda semantica sobre `memoria_vectorial`.
   Aqui esta la recursividad real: un agente que enfrenta un caso nuevo ve **como se resolvieron
   los casos parecidos y en que terminaron**. El historial deja de ser auditoria y pasa a ser
   corpus de precedentes — el mismo patron de `docs/agentic/MEMORY.md` y
   `app/data/debugging_resuelto.jsonl`, aplicado a contabilidad.
3. **`registrar_nota_expediente(codigo, texto)`** — cierra el ciclo. Cuando un agente o un humano
   resuelve el TKT, su conclusion vuelve al expediente como evento. El siguiente agente hereda el
   aprendizaje en vez de repetir el analisis.
4. **`query_sqlite`** — ya existe. Escape hatch para preguntas que ninguna herramienta anticipo.

Para el contador: panel "Anulaciones" con filtro por estado y motivo, export mensual
(NC ↔ factura ↔ motivo ↔ asiento ↔ expediente), y el relato dentro del propio documento
electronico para cuando revise en Alegra sin abrir el panel.

## Archivos Ancla

- `app/services/anulaciones_db.py` — esquema (`anulaciones` + `anulacion_eventos` en
  `contabilidad.db`), maquina de estados (`transicionar` valida las transiciones y lanza
  ValueError en vez de escribir un estado imposible), `registrar_evento` (append-only, con
  `dedupe` para reintentos del mismo fallo), `resolver` (acepta codigo / referencia / pack /
  numero de factura), `deuda_abierta`, `buscar` (precedentes) y `expediente_completo`.
- `app/services/anulaciones_motor.py` — `reintegro_de_orden` (el disparador),
  `clasificar` (la matriz, PURA: sin red ni DB), `evaluar_autonomia` (la politica, determinista),
  `relato_para_observaciones` / `relato_largo`, `emitir`, `postear_asiento`,
  `registrar_retorno_inventario`, `cerrar_si_completo`.
- `app/services/alegra.py` — `crear_nota_credito_sin_referencia_alegra()` para las facturas de la
  era Siigo (`crear_nota_credito_alegra` no sirve: arma `type: "VOID_ELECTRONIC_INVOICE"` con
  `invoices:[{id}]` y ese id debe ser de una factura de Alegra) +
  `descubrir_tipo_nota_credito_sin_referencia_alegra()` + `MAX_OBSERVACIONES_NC_ALEGRA`.
- `app/tools/anulaciones.py` — las cuatro herramientas de agente, el ticket y
  `procesar_evento_reclamo()` (entrada desde el webhook).
- `scripts/anulaciones_cron.py` — el barrido. Job `anulaciones_ra` en `cron_scheduler.py`.
- `app/meli_webhook_topics.py` — `post_purchase` agregado a `meli_webhook_es_reclamo_devolucion()`.
- `app/meli_reclamos.py` — `crear_accion_anular_factura_por_reclamo()` ahora delega en el
  expediente; el ticket inmediato queda como camino legado tras `RA_RECLAMOS_ACTIVO=0`.
- `app/core.py` — las cuatro herramientas registradas en `todas_las_herramientas`.
- `app/services/contabilidad_core.py` — cuenta PUC `4175` (Devoluciones en ventas) en
  `_migrar_cuentas_v2`.
- `tests/test_anulaciones.py` — 26 tests puros.
- `app/routes_anulaciones.py` — API del panel bajo `/api/anulaciones/*` (+ alias `/app/api/...`).
  Permiso `libro-mayor`, no `facturacion`: un expediente muestra el motivo de la anulacion, el
  monto reintegrado y el asiento contable — es el nivel de sensibilidad del libro mayor.
- `desktop/src/components/AnulacionesPanel.tsx` + `hooks/useAnulaciones.ts` — la vista del
  contador. Lo primero que muestra es la DEUDA, no la actividad del dia. Cada fila abre el
  expediente completo con su linea de tiempo: el mismo contenido que recibe un agente con
  `consultar_expediente_anulacion`, para que persona y agente miren el mismo caso.
- Conexiones del panel: `stores/app.ts` (tipo `Panel`), `lib/contabilidadAccess.ts` (pestana +
  permiso), `lib/panelInfo.ts` (metadata), `components/ContabilidadPanel.tsx` (lazy + case),
  `icons/mck/paths/panels.tsx` (icono).

## Variables de entorno

| Variable | Default | Para qué |
| --- | --- | --- |
| `RA_EMISION_ACTIVA` | `0` | Modo sombra. En `0` clasifica y decide pero no llama a Alegra. |
| `RA_UMBRAL_AUTONOMIA` | `300000` | Monto máximo que se emite sin aprobación humana. |
| `RA_CRON_ACTIVO` | `1` | Apaga el cron sin tocar el crontab. |
| `RA_CRON_QUIET` | `0` | No envía WhatsApp (pruebas). |
| `RA_RECLAMOS_ACTIVO` | `1` | En `0` vuelve al ticket inmediato del flujo viejo. |
| `ALEGRA_NC_SIN_REFERENCIA_TYPE` | — | **Obligatoria** para el rezago Siigo. Sin ella la emisión se bloquea con `falta_tipo_nc_sin_referencia`. |
| `ALEGRA_NC_ITEM_GENERICO_SKU` | — | Ítem servicio (sin inventario) para la NC sin referencia. |
| `ALEGRA_MAX_OBSERVACIONES_NC` | `500` | Tope del relato dentro del documento electrónico. |
| `NOTAS_CREDITO_MARGEN_HORAS` | `48` | Margen tras el reintegro (compartida con el cron viejo). |

## Invariantes

- La decision de emitir es determinista y vive en codigo. El LLM redacta el relato; **no** decide
  si se emite ni con que monto.
- Los campos duros del expediente (montos, ids, CUFE, fechas) se llenan desde la API, nunca desde
  texto generado. Un relato que los contradiga es un bug, no una discrepancia menor.
- `anulacion_eventos` es append-only. Las correcciones se agregan, no se editan.
- Idempotencia por `referencia` (`meli:pack:<id>`), mas un segundo chequeo de NC existente **justo
  antes** del POST — la corrida manual del 10-ago-2026 genero 4 NC duplicadas por no tenerlo.
- Toda NC emitida postea su asiento via `contabilidad_core.crear_movimiento` con
  `referencia = "ra:<codigo>"`. El modulo es parte del libro mayor, no un satelite de Alegra.
- El reingreso de inventario ocurre cuando el producto **llega fisicamente**, no cuando se emite
  la NC. Son dos eventos distintos y pueden estar separados por dias.
- Un expediente nunca se borra. `descartada` es un estado, no una eliminacion.
- El reporte diario informa **deuda, no actividad**: se envia aunque no haya pasado nada. El
  silencio deja de ser un estado valido — es el mecanismo exacto que dejo acumular 44 casos y
  $2,1 M entre el 26-jun y el 10-ago de 2026 sin que nadie lo notara.

## Riesgos

- **`observations` se trunca a 500 caracteres** en `crear_nota_credito_alegra()` (`motivo[:500]`).
  La plantilla del relato debe caber ahi o hay que subir el limite tras verificar el maximo real
  que acepta Alegra. Un relato cortado a la mitad es peor que uno corto.
- **El `type` de la NC sin referencia no esta documentado**, igual que paso con
  `VOID_ELECTRONIC_INVOICE`. Usar el mismo metodo que funciono el 2026-09-03: que el operador cree
  UNA a mano y leerla con `GET /credit-notes` para descubrir el contrato.
- **Inventario en la NC sin referencia**: si se emite con los items reales mapeados por SKU,
  Alegra reingresa stock de un producto que nunca salio de Alegra (la salida quedo en Siigo) y
  descuadra el inventario. Para el rezago historico conviene un item generico por el valor total —
  es un ajuste de cierre de una era contable, no una devolucion operativa.
- **El cliente de las facturas Siigo** es "Consumidor Final" con NIT `222222222222`
  (`SIIGO_MELI_NIT_CONSUMIDOR_FINAL`) y probablemente no existe como contacto en Alegra. Resolverlo
  o crearlo antes del POST, o el 400 llega como error generico.
- **El reembolso a cargo de MeLi necesita criterio del contador**, no del sistema. Automatizar la
  NC de ese caso antes de que el contador defina el tratamiento del ingreso por compensacion es
  crear un problema fiscal con eficiencia.
- **`topic_no_manejado` seguira siendo un punto ciego** mientras no alerte. El bug de
  `post_purchase` era visible en `webhook_meli_incidents.jsonl` desde el 2026-09-04 y nadie tenia
  por que mirarlo. Un topico desconocido repetido > N veces en 24h debe avisar al grupo de sistemas.

## Validacion

- `pytest tests/test_smoke.py tests/test_notas_credito.py tests/test_anulaciones.py` — los 26
  tests nuevos son puros (base temporal, sin red) y cubren la clasificacion por matriz, la
  politica de autonomia, la maquina de estados y el resource real
  `/post-purchase/v1/claims/{id}` del webhook.
- Emision contra una COPIA de `contabilidad.db`, nunca contra la base real sin `--dry-run`.
- `balance_comprobacion()["cuadra"] == True` despues de postear asientos de NC.
- Verificar que un expediente recien creado se recupera completo con
  `consultar_expediente_anulacion()` — si un agente no puede reconstruir el caso desde el codigo,
  el modulo no cumple su proposito.
- `cd desktop && npm run build` (tsc -b + vite build) antes de dar por bueno el panel. El tipo
  `Panel` es una union cerrada y `MCK_PANEL_PATHS` es un `Record<Panel, ReactNode>`: agregar un
  panel sin su icono rompe la compilacion (paso obligatorio, no opcional).
- El permiso del panel (`puedeVerModuloContabilidad(user, "anulaciones")`) y el del backend
  (`routes_anulaciones._usuario_puede`) deben coincidir — si divergen, la pestana se ve pero la
  API responde 403.

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "notas credito anulacion devolucion reclamo meli alegra siigo read only"
```

## Encendido (en orden)

1. `pytest tests/test_anulaciones.py` en la maquina real.
2. Dejar correr el cron en modo sombra unos dias y revisar los expedientes que abre:
   `python3 -c "from app.services import anulaciones_db as a; print(a.listar(abiertos=True))"`.
   Lo que importa es que la CLASIFICACION sea correcta, no que emita.
3. El operador crea UNA nota credito sin referencia a mano en Alegra;
   `descubrir_tipo_nota_credito_sin_referencia_alegra()` da el `type` →
   `ALEGRA_NC_SIN_REFERENCIA_TYPE`.
4. Crear el item generico de servicio en Alegra → `ALEGRA_NC_ITEM_GENERICO_SKU`.
5. Decision del contador sobre el rezago Siigo y el reembolso a cargo de MeLi.
6. `RA_EMISION_ACTIVA=1`, primero con `RA_UMBRAL_AUTONOMIA` bajo (ej. 50000) para que solo se
   emitan solos los casos pequenos mientras se gana confianza.
7. Cuando lleve semanas estable, apagar `notas_credito_auto` (`NOTAS_CREDITO_CRON_ACTIVO=0`).

## Casos abiertos que este modulo NO resuelve todavia

- Si Siigo se reactiva o todo el rezago se emite en Alegra sin referencia. **Decision del contador.**
- Tratamiento contable del ingreso por compensacion de MeLi. **Decision del contador.**
- Ventas web y WhatsApp: el esquema ya las contempla (`origen`, `referencia_web`), pero el
  barrido de hoy solo recorre MeLi.
- Escalamiento por antiguedad (72h sube prioridad, 7 dias avisa a direccion): el dato ya esta
  en `deuda_abierta()['dias_mas_antigua']`, falta la regla que actue sobre el.
- Nota credito por LINEAS para devolucion parcial: hoy esos casos van a `requiere_decision`
  correctamente, pero la emision automatica sigue siendo por el total.
- Alerta cuando un topico desconocido se repite en `webhook_meli_incidents.jsonl` — el punto
  ciego que hizo invisible el bug de `post_purchase` durante 4 dias.
