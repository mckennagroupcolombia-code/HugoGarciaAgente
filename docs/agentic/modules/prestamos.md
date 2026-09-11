# Préstamos recibidos de terceros (captación con particulares)

**Estado:** implementado sep-2026. Panel `/app` → **Contabilidad → Préstamos**
(sección propia, al mismo nivel que Compras exterior desde el 2026-09-10; antes
vivía enterrada como subtab del Libro Mayor, donde nadie la encontraba).

Tres pestañas: **Con cronograma** (el producto), **Saldos por tercero** (registro
simple heredado) y **Cómo funciona** (el esquema de socios y familiares explicado,
con saldos en vivo y el reintegro al socio).

**Permiso:** `prestamos`, o `libro-mayor` — el Diario ya expone esos mismos
movimientos, así que negarlo acá no protegería nada. **No se hereda** de facturación
ni de sync: el módulo muestra cédula, correo, cuenta bancaria y saldos de socios y
familiares.

## Qué es

Producto por el cual un particular le presta dinero a McKenna a una tasa pactada,
con cronograma de cuotas mensuales, documentos al prestamista y contabilidad
automática. Distinto del registro simple que ya existía (pestaña «Saldos por
tercero»), que sigue sirviendo para préstamos informales entre socios sin
cronograma.

## Condiciones vigentes (default, parametrizables por préstamo)

| Parámetro | Valor |
|---|---|
| Tasa pactada | **25% E.A.** = 1,8769% mensual vencido |
| Plazo | 24 cuotas mensuales |
| Amortización | **30% del capital el primer año, 70% el segundo** |
| Retención en la fuente | 7% sobre intereses, **a cargo del prestamista** |
| Día de pago | 5 de cada mes |

Sobre $10.000.000: intereses **$2.796.620 (27,97% bruto)**, retención $195.763,
neto girado **$2.600.857 (26,01%)**, desembolso total de McKenna $12.796.620.

## Las tres cifras que no se deben confundir

Es el error clásico del producto, y por eso las tres van juntas en el panel y en
el PDF:

1. **Tasa pactada** (25% E.A.) — lo único que se acuerda contractualmente.
2. **Rendimiento bruto** (27,97% del capital a 24 meses) — *consecuencia* del
   cronograma, no una promesa. Cambia si cambia el reparto de capital.
3. **Rendimiento neto girado** (26,01%) — después de retención.

**Por qué 25% E.A. no da 50% a dos años:** el interés se liquida sobre el saldo
insoluto, y el capital promedio realmente prestado es $6,2M, no $10M. La E.A.
mide precio por peso-año de capital usado, no porcentaje del monto original.

## La palanca del diseño: cuándo se devuelve el capital

Devolver capital más tarde sube lo que gana el prestamista **sin cambiar la tasa**,
porque hay más capital trabajando más tiempo. Sobre $10M al 25% E.A.:

| Capital año 1 / año 2 | Gana el prestamista | Costo McKenna |
|---|---|---|
| 0% / 100% (gracia total) | 34,72% | 25% E.A. |
| 15% / 85% | 31,34% | 25% E.A. |
| **30% / 70% (default)** | **27,97%** | **25% E.A.** |
| 50% / 50% (amortización recta) | 23,46% | 25% E.A. |

El costo efectivo anual es idéntico en las cuatro: lo que cambia es cuánto
capital tuvo McKenna trabajando. Verificado por TIR en
`tests/test_prestamos.py::test_el_reparto_no_cambia_el_costo_efectivo_anual`.

**Descartado a propósito:** el esquema de "interés fijo sobre capital inicial"
(cuota = capital×1,25% + capital/24). Paga el mismo interés que la amortización
recta usando el mismo capital promedio, pero a ~30% E.A. real — el doble. Un
documento que diga "15% anual" cobrando eso se contradice a sí mismo.

**También descartado:** capital al final (bullet) y capitalización de intereses.
Son más eficientes para ambas partes (el prestamista llegaría a 32,25% y McKenna
seguiría en 25% E.A.), pero concentran un pago enorme al mes 24 que la operación
no quiso asumir. Decisión del usuario, sep-2026.

## Quién paga la retención del 7%

**El prestamista.** McKenna, por ser persona jurídica, es agente retenedor:
descuenta el 7% de cada pago de intereses (rendimientos financieros, Art. 395 ET)
y lo consigna a la DIAN. No es costo adicional para McKenna — es plata del
prestamista que cambia de destinatario. Se le expide certificado anual para que
la impute a su renta (si es declarante la recupera; si no, le queda definitiva y
su rendimiento real baja a 26,01%).

Con `gross_up=True` McKenna asume la retención: gira el bruto y el 7% sale de
más, subiendo el costo real a **26,95% E.A.**

## Asiento de cada cuota

```
Débito   2295/2380  Préstamos por pagar        250.000   ← baja el pasivo
Débito   5305       Gastos financieros         187.693   ← gasto = interés BRUTO
    Crédito  2365   Retención en la fuente      13.138   ← pasivo con la DIAN
    Crédito  1110   Bancos                     424.554   ← lo que recibe el tercero
```

La cuenta **2365** se sembró en `contabilidad_core._migrar_cuentas_v2()` con este
módulo. El desembolso inicial reusa `contabilidad_core.registrar_prestamo_recibido`.

## Documento soporte a la DIAN

**Base legal: DIAN, Concepto 000112 (int 7) del 09-01-2024.** El tratamiento se parte
en dos y NO es el mismo para capital e intereses:

| Concepto | ¿Documento soporte? | Soporte válido |
|---|---|---|
| **Capital** (desembolso y abonos) | **NO** | Contrato de mutuo firmado + comprobante de transferencia |
| **Intereses** a persona natural **no** obligada a facturar | **SÍ**, McKenna lo emite | Documento soporte electrónico transmitido a la DIAN |
| **Intereses** a persona jurídica u obligado a facturar | **NO** | Factura electrónica que expide **el prestamista** |
| **Intereses** a entidad financiera | **NO** | Extracto bancario |

El mutuo no es venta de bienes ni prestación de servicios, por eso el capital no se
factura. Los intereses sí son un gasto financiero que McKenna deduce, y sin el
documento transmitido la deducción no procede.

El documento se emite por el **interés bruto** de cada cuota, nunca por la cuota
completa: el abono a capital no es gasto, es baja de pasivo.
`prestamos.requiere_documento_soporte()` decide con `tipo_persona` +
`obligado_a_facturar` de `cc_terceros` (columna agregada con este módulo), y si el
tipo de persona está sin definir **no emite** y lo avisa en el panel — es preferible
a emitir un documento equivocado.

### Estado: modo sombra

`PRESTAMOS_DOC_SOPORTE_ACTIVO=0` por defecto. No es duda legal (el Concepto la
resolvió), sino que un documento soporte emitido ya viajó a la DIAN y solo se corrige
con nota de ajuste. **Dos prerequisitos antes de encender:**

1. **Crear en Alegra el ítem de intereses** con referencia `INTERES-MUTUO` (tipo
   servicio, sin IVA), o ajustar `PRESTAMOS_ALEGRA_ITEM_REF`. Hoy no existe: la
   cuenta solo tiene `GENERICO` ("COMPRA GENÉRICA"), que sería un soporte equivocado.
2. **Verificar la plantilla de numeración.** Se usa la **id=10** (`supportDocument`).
   ⚠️ En la misma cuenta existe la **id=16**, llamada "Documento Soporte" pero cuyo
   tipo real es `saleTicket` (tiquete POS): usarla emitiría el documento equivocado.
   Vale la pena renombrarla o borrarla.

Mientras esté en sombra, cada cuota pagada guarda `doc_soporte_estado='sombra'` con el
payload que se habría enviado, revisable antes de activar. Un fallo de Alegra **nunca**
tumba el pago ni el asiento: el asiento es la verdad contable y ya quedó; el documento
se reintenta desde el panel.

## Declaración mensual de retención en la fuente

La retención practicada en cada cuota se acredita a **2365** y queda como deuda con
la DIAN hasta que se declara y se paga. El módulo **no declara** — eso lo hace el
contador en el portal — pero evita que nadie se entere tarde:

- `resumen_retenciones_mes(anio, mes)` reúne lo practicado con el detalle por tercero
  (base = intereses brutos, retención) que necesita el **formulario 350**, concepto
  *rendimientos financieros*.
- **Cifra de control:** compara contra el movimiento real de la cuenta 2365 en el
  período. Si no cuadra hay retenciones de otro origen o un asiento manual, y el
  ticket lo dice en rojo — revisar **antes** de declarar.
- **Avisa si hay documentos soporte sin emitir:** declarar la retención mientras el
  soporte sigue en modo sombra deja el gasto por intereses expuesto en una revisión.
- `crear_ticket_retenciones_mes()` abre el ticket (categoría `contabilidad`,
  idempotente por período con la marca `SYS_PRESTAMOS_RETENCIONES_MES: YYYY-MM`),
  asignado a `PRESTAMOS_USUARIO_CONTABILIDAD` o, si no está, a quien tenga la tarea
  `prestamos_declarar_retenciones` en Sistemas → Aliados.

### Calendario de vencimientos

`app/services/calendario_tributario.py` tiene la tabla del **año gravable 2026**
(DUR 1625 de 2016, Arts. 1.6.1.13.2.33. y 1.2.6.6.), transcrita del calendario CIJUF
—`docs/agentic/CALENDARIO-CIJUF-2026.pdf`—. El ticket y el panel muestran la fecha
exacta, los días que faltan, y el ticket sube a prioridad **crítica** si el
vencimiento está a 5 días o menos (o ya pasó).

**El NIT de McKenna es 901.316.016-3 → el dígito que manda es el 6, no el 3.** El
`3` es el dígito de verificación. `ultimo_digito_nit()` lo recorta; es la misma
trampa del DV ya documentada en `alegra.py`. Verificado contra `GET /company` de
Alegra (identification 901316016, dv 3). Vencimientos 2026: 17-feb, 17-mar, 21-abr,
20-may, 18-jun, 16-jul, 20-ago, 16-sep, 19-oct, 19-nov, 17-dic y 20-ene-2027
(período de diciembre).

El NIT ya no se escribe a mano en ningún módulo: sale de
`app/services/empresa.py` (ver «Incidente del NIT» abajo).

⚠️ **El módulo no extrapola.** El calendario lo fija un decreto distinto cada año y
los días no siguen un patrón. Para un año no cargado devuelve `None` y tanto el
ticket como el panel dicen *"fecha no confirmada, consultar al contador"* en vez de
adivinar. **Para 2027 hay que cargar la tabla nueva** en `_RETENCION_MENSUAL` y
correr `tests/test_calendario_tributario.py`, que valida que ninguna fecha caiga en
fin de semana y que el orden por dígito sea creciente — así se cazan los errores de
transcripción.

El **certificado anual de retenciones** vence el último día hábil de marzo del año
siguiente (`fecha_limite_certificado_retenciones()`; DUR 1625 Art. 1.6.1.13.2.40,
mod. D.R. 2229 de 2023). Para el año gravable 2026: **31-mar-2027**. La función solo
descuenta fines de semana, no festivos.

El cron es el **mismo script diario** que el recordatorio de pagos
(`scripts/prestamos_recordatorio_cron.py`), con dos días distintos: pagos el 5,
retenciones el 3 sobre el mes anterior. Las dos tareas son independientes — que una
falle no impide la otra.

Panel: bloque «Retención en la fuente» plegable, con selector de mes, los tres
totales, el detalle por prestamista y botón para adelantar el ticket.

## Alta de prestamistas

Desde el panel, botón **«+ Prestamista»** (o «Registrar un prestamista nuevo» dentro
del formulario de préstamo). Pide de una vez todo lo que el préstamo va a necesitar
después, y lo valida ahí y no al desembolsar — descubrir que falta la cédula con la
plata ya girada es mucho peor:

| Dato | Para qué | ¿Obligatorio? |
|---|---|---|
| Nombre / razón social | Contrato, documento soporte | Sí |
| Cédula / NIT | Contrato, documento soporte, Alegra | Sí |
| Tipo de persona | Decide **quién** emite el documento soporte | Sí |
| Correo | Contrato y reportes mensuales | Sí |
| Cuenta bancaria | Para que despachos pueda girarle | No, pero el ticket avisa si falta |
| Teléfono, notas | Contacto | No |
| Obligado a facturar | Persona natural que igual factura → no lleva doc. soporte | No (default: no) |

`crear_prestamista()` **no duplica**: si ya existe un tercero con esa identificación
(comparando solo dígitos, así "80.123.456" y "80123456" son el mismo) completa los
datos que falten y lo devuelve. Duplicar parte el histórico de saldos por tercero y
descuadra `resumen_prestamos()`.

Además lo **inscribe como contacto en Alegra** (`sincronizar_prestamista_alegra`),
con `kindOfPerson: PERSON_ENTITY` / `SIMPLIFIED_REGIME` — el resolver genérico
`_resolver_o_crear_proveedor_alegra` fija `LEGAL_ENTITY` + `COMMON_REGIME`, correcto
para una empresa pero equivocado para el contraparte típico de un documento soporte.
Si Alegra falla, **el tercero igual queda creado** y el panel muestra «no inscrito —
inscribir» para reintentar.

El formulario avisa en vivo, antes de guardar, si ese prestamista llevará documento
soporte o no — espeja `requiere_documento_soporte()`.

## Reporte mensual al prestamista

`enviar_reporte_mensual(prestamo_id, anio, mes)` manda el movimiento del período:
cuota(s) del mes, abono a capital, intereses brutos, retención practicada, total
consignado y saldo pendiente, con el **certificado de estado adjunto** a la fecha
del último pago. Si no hubo desembolsos ese mes no envía nada.

**Manual a propósito**, como todos los envíos a terceros de este módulo: si saliera
solo con cada pago, un error de registro se convertiría en un correo ya enviado que
no se recoge.

## Piezas

| Archivo | Qué hace |
|---|---|
| `app/services/prestamos.py` | Motor de cálculo, persistencia (`cc_prestamos`, `cc_prestamo_cuotas`), asientos, recordatorio, envío |
| `app/tools/prestamos_pdf.py` | Contrato de mutuo (firmado) + certificado de estado (ReportLab) |
| `app/tools/correo_marca.py` | Marco visual y firma de los correos a terceros (compartido con pedidos web) |
| `tests/test_prestamos_pdf.py` | 3 tests: contrato firmado, retención sin jerga, orden del contenido |
| `tests/test_correo_marca.py` | 4 tests: marca, escape del preheader, firma con persona, plantilla única |
| `scripts/prestamos_recordatorio_cron.py` | Dos tickets mensuales: pagos a despachos (día 5) y declaración de retención (día 3) |
| `desktop/src/components/PrestamosCronogramaPanel.tsx` | Panel con simulador en vivo, cronograma y documentos |
| `app/services/calendario_tributario.py` | Vencimientos DIAN de retención (año gravable 2026) |
| `tests/test_calendario_tributario.py` | 18 tests: DV del NIT, fines de semana, orden por dígito, no extrapolar |
| `tests/test_prestamos.py` | 62 tests: tasa, reparto, retención, orden de pago, balance, documento soporte, declaración |

Endpoints: `/api/prestamos` (GET/POST), `/api/prestamos/<id>`,
`/api/prestamos/simular`, `/api/prestamos/<id>/cuotas/<n>/pagar`,
`/api/prestamos/<id>/documento`, `/api/prestamos/<id>/enviar`,
`/api/prestamos/<id>/alegra`, `/api/prestamos/recordatorio`,
`/api/prestamos/<id>/cuotas/<n>/documento-soporte`, `/api/prestamos/retenciones`,
`/api/prestamos/retenciones/ticket`, `/api/prestamos/prestamistas` (POST/PATCH),
`/api/prestamos/prestamistas/<id>/alegra`, `/api/prestamos/<id>/reporte-mensual`.

## Decisiones deliberadas

- **El contrato sale firmado por McKenna y en lenguaje llano.** Reescrito el
  2026-09-11 tras devolverse la primera versión enviada a un prestamista real:
  era densa (seis cláusulas jurídicas) y sin firmar. Ahora la primera página
  abre con «Usted presta / Usted recibe en total», explica la tasa, la retención
  y el prepago en párrafos cortos, y cierra con la firma del representante legal
  estampada; el cronograma completo va en la página 2. La firma se lee por ruta
  desde `~/Documentos/Documentos Legales MCKENNA GROUP` vía
  `empresa.firma_representante()` — **no se copia al repo**: es un activo que
  puede firmar cualquier cosa y el repo está en git. Si el archivo no está, el
  PDF sale con la línea en blanco y una advertencia visible en vez de hacerse
  pasar por firmado.
- **Los correos a terceros usan la plantilla de marca, no HTML suelto.**
  `app/tools/correo_marca.py` es la única plantilla (la de pedidos web delega en
  ella) y `firma_html()/firma_texto()` cierran con el nombre y cargo del
  representante: el remitente SMTP es una cuenta genérica, así que sin ese
  bloque la correspondencia financiera llegaría sin una persona detrás.
- **El envío de correo al tercero NO es automático.** Se genera el PDF siempre,
  pero mandarlo pide confirmación explícita en el panel: es correspondencia
  financiera y un documento equivocado ya enviado no se recoge.
- **Un solo ticket mensual, no uno por préstamo.** Despachos monta todas las
  transferencias en la misma sesión del banco; N tickets el mismo día es ruido.
  Deduplicado por período con la marca `SYS_PRESTAMOS_PAGOS_MES: YYYY-MM`.
- **Las cuotas se pagan en orden.** Pagar la 7 dejando pendiente la 3
  descuadraría el saldo del cronograma contra el saldo real del pasivo.
- **No se genera pagaré.** Un pagaré es título valor con requisitos propios
  (Art. 621 y 709 C.Co.) y efectos ejecutivos; lo redacta un abogado. Acá se
  emite el contrato de mutuo, que es lo que soporta la operación contablemente.
- **Alegra se consulta, no se escribe.** `consultar_contacto_alegra()` es de solo
  lectura: crear el contacto al abrir una pantalla ensuciaría el directorio con
  terceros que quizá nunca reciban un documento.
- **El tercero debe tener cédula y correo** antes de registrarle un préstamo —
  descubrirlo con la plata ya girada es peor que bloquearlo al crear.

## Pendientes / riesgos abiertos

- ⚠️ **Validar con el contador** la tarifa de retención (7% general) según tipo de
  prestamista (natural declarante / no declarante / jurídica / no residente) y si
  hay cuantía mínima. No verificado contra la norma vigente.
- ⚠️ Falta el **certificado anual de retenciones** al prestamista en formato DIAN
  (el certificado de estado que ya se genera es informativo, no sirve para renta).
- El **pago** de la retención no se registra automáticamente: al pagarla hay que
  hacer el egreso contra 2365 a mano para que deje de figurar como deuda. El ticket
  lo recuerda, pero nadie lo verifica.
- ⚠️ **Tasa de usura.** El contrato afirma que la tasa no excede el límite de la
  Superfinanciera, pero **nadie lo valida en código**. A 25% E.A. probablemente
  hay margen; si alguien sube la tasa en el panel puede pasarse, y superarla es
  delito para quien cobra (el prestamista). Falta traer la certificación vigente
  y bloquear por encima del tope.
- ⚠️ **Captación masiva.** Prometer rendimiento fijo a muchos terceros puede
  configurar captación masiva y habitual de dineros del público (Decreto 1981 de
  1988): >20 personas o >50 obligaciones, entre otros criterios. Con socios y
  allegados no hay problema; antes de escalar, consultar abogado.
- El certificado anual de retenciones (formato DIAN) no está implementado — hoy
  solo el certificado de estado del préstamo.
- No hay anulación de préstamo ni reversión de cuota pagada desde el panel; se
  haría anulando el asiento en Libro Mayor y corrigiendo a mano.
