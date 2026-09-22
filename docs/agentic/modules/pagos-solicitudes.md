# Module: Solicitudes de pago (Flujo O) + reglas tributarias del wizard

Texto completo del antiguo «Flujo O» de `CLAUDE.md`, movido aquí el 2026-09-19 porque
`CLAUDE.md` superó el límite de 150k caracteres. `CLAUDE.md` conserva un resumen con las
reglas que no se pueden romper; el detalle, la historia y los casos viven aquí.

## O. Solicitudes de pago con asiento automático

```
/app → Contabilidad → Solicitudes de pago   (PagosWizardPanel.tsx)
  1. Elegir QUÉ se paga (13 categorías: proveedor, flete, servicio público,
     honorarios, prestación de servicios, arriendo, nómina, cuota de préstamo,
     reintegro a socio, impuestos, seguros, mantenimiento, otro)
  2. Las opciones salen de los SALDOS REALES: proveedores con deuda en 2205,
     cuotas del mes, servicios activos, retención pendiente en 2365
  3. Se MUESTRA el asiento antes de aprobar
  4. Al aprobar → asiento en el Libro Mayor + comprobante en Alegra
```

**Por qué existe:** hasta sep-2026 los pagos se aprobaban como tickets de texto
libre ("APROBAR PAGO DE FACTORES") y el asiento dependía de que alguien se
acordara después. No se hacía — el Libro Mayor tenía las compras pero no los
pagos, y Bancos quedaba descuadrado. Es el mismo patrón que ya falló con las
notas crédito (6 semanas) y las compras Gmail (96 sin postear): **lo que se deja
como paso manual posterior, no se hace**.

**Wizard simple (15-sep-2026).** La puerta de entrada es una sola pantalla: proveedor · fecha ·
cuenta de salida (viene puesta en **Bancolombia ahorros 42800000974**) · concepto (**Productos**
1435 / **Servicios** · **Saldo pendiente** · **Impuestos**) · cuenta del PUC · valor solicitado ·
botón **Solicitar**, uno solo: quien solicita no decide si se salta
la aprobación (el registro directo sigue existiendo en el recorrido largo). El asiento se sigue viendo antes de solicitar — eso no se quitó,
es lo que evita firmar a ciegas. El recorrido largo (productos con SKU + factura cotejada) sigue
existiendo y se abre con el enlace «Compra con productos y factura cotejada» o desde el Centro de
Mando; las categorías `productos` y `servicios` llevan retención (compras / servicios) pero **no**
exigen SKU ni cotejo, así que una compra de mercancía con factura debe ir por el recorrido largo.
La bandeja ya no lista los borradores de cuotas de préstamo que monta el cron (son de Préstamos y
solo eran ruido); si una sale a aprobación, ahí sí aparece.

**La cuenta del PUC decide el impuesto, no el botón (17-sep-2026).** Había un botón por concepto
(Productos, Servicios, **Transporte**, **Servicios públicos**) *y* un selector de cuenta: la misma
pregunta hecha dos veces con distinto vocabulario, y podían contradecirse — «Servicios» traía el 4%
aunque el gasto fuera a 513550 Transporte, donde la tarifa es el 1%. El botón fijaba el impuesto y
la cuenta fijaba el balance. Ahora **`app/services/impuestos_por_cuenta.py`** traduce cada cuenta a
su concepto de retención y su tarifa de ICA de Bogotá, `previsualizar()` lo usa cuando la categoría
es `cuenta_libre`, y el panel muestra debajo del selector qué dedujo y qué advertir. Los botones de
Transporte y Servicios públicos se **ocultaron** (`"oculta": True`, igual que `salario_socio`: las
categorías no se borran porque hay solicitudes históricas con ese valor); un servicio público se
paga por **Servicios** eligiendo 513530/513525/513535/513555, y ahí el número de contrato aparece
solo. `cuentas_gasto()` devuelve el perfil de cada cuenta para que el panel deje las casillas
puestas, y `cc_terceros.medio_pago_default` completa la ficha de pago recurrente (cuenta del gasto
+ impuestos + de qué cuenta sale) para no volver a elegir lo mismo cada mes.

**Documento soporte a no obligados a facturar (18-sep-2026).** `app/services/doc_soporte_pagos.py`:
al **aprobar** una solicitud de pago, si el beneficiario no está obligado a facturar se emite el
**documento soporte** (Res. DIAN 000167/2021) contra la plantilla 10 de Alegra —`supportDocument`,
electrónica, resolución **18764115104411**, prefijo **DSMG** 1-1000, vigencia hasta 2027-09-03— con
su CUDS. Va pegado a la aprobación y no como paso aparte, porque un paso aparte es un paso que un día
no se hace y nadie nota.

**Por qué importa:** el Art. 771-2 E.T. solo acepta un costo o deducción con factura o documento
equivalente. La mensajería de Fidel Rocha son **~$1,93M por quincena (~$46,4M/año)** pagados,
conciliados y contabilizados pero **sin soporte fiscal**: a la tarifa de renta del 35% son $16,2M de
mayor impuesto más la sanción por inexactitud.

A quién **no** se le emite: personas jurídicas, quien factura electrónicamente (su factura ya es el
soporte; emitir además duplicaría el gasto ante la DIAN) y los del **Régimen SIMPLE**, que **sí**
están obligados a facturar (Art. 915 E.T.) — de hecho, que alguien cobre con cuenta de cobro
amparado en el 616-2 **es evidencia de que no es del SIMPLE**: las dos cosas son incompatibles.
Se marca por tercero en `cc_terceros.emite_doc_soporte`; el módulo propone pero no decide solo,
porque equivocarse emite un documento fiscal irreversible (solo se corrige con nota de ajuste) a
nombre de alguien real. `PAGOS_DOC_SOPORTE_ACTIVO=0` (sombra) por defecto.

⚠️ **Un PUT a Alegra NO es parcial: reemplaza.** Mandar `{"provider": 313}` a `/bills/1` para
refrescar el proveedor **borró las retenciones** del documento, que después se transmitió así
(DSMG1, 18-sep-2026: aceptado por la DIAN por $2.026.657 **sin** el 1% ni el ReteICA, dejando un
saldo abierto de $28.657 que en realidad es de la DIAN, no del proveedor). Lo mismo aparece al
editar un contacto: pide `name`, luego `kindOfPerson`, luego `nameObject` — **hay que reenviar el
bloque completo**. Y una vez sellado (`STAMPED_AND_ACCEPTED*`) ya no se edita (`11042`): solo nota
de ajuste ADS. Ningún módulo hace PUT a `/bills`; si alguna vez hace falta, reenviar el documento
entero, nunca un campo suelto.

⚠️ **El documento congela una FOTO del proveedor.** Cambiar la ficha del contacto después **no**
actualiza el documento ya creado: su `provider.identificationObject` se queda como estaba. Si hay
que corregir la identificación, se corrige el contacto **y** se rehace el documento (mientras no
esté transmitido).

⚠️ **Las personas naturales van como NIT, no como CC.** En un documento electrónico la DIAN exige
NIT, y para una persona natural el NIT **es** su cédula más el dígito de verificación. Creados como
`CC`, Alegra se niega: «Tu proveedor cuenta con cédula de ciudadanía (CC)».
`_resolver_o_crear_proveedor_persona_natural_alegra` los creaba así y ahora los crea como **NIT con
su DV** (calculado con `empresa.digito_verificacion`). Corregidos a mano el 18-sep-2026: Fidel
(9385573-3) y los cuatro prestamistas — habrían reventado la cuota del 9-oct. **Quedan 23 contactos
con tipo CC** (clientes), pendientes.

**El ciclo completo del documento soporte** (18-sep-2026, aprendido emitiendo el DSMG1 en vivo —
tres cosas que **ningún dry run mostró**):

1. **La cuenta contable se resuelve con `alegra_espejo.cuenta_alegra()`**, no con otra. Resuelve por
   código PUC y solo cae al `MAPA_PUC` viejo si esa id sigue viva. Mandando la id 5214 (catálogo
   NIIF) Alegra respondió `400 · 11060 «No se encontró una de las cuentas contables»`. Sin
   equivalente, `doc_soporte_pagos` **se niega a emitir**: no hay cuenta de respaldo, porque un
   documento contra la cuenta equivocada ya viajó a la DIAN. ⚠️ Lo mismo afectaba a **préstamos**,
   configurado contra la id **5252** — una de solo **8 cuentas (de 997)** que sobrevivieron la
   migración **sin código PUC**; corregida a **5949** (`530520 Intereses`).
2. **El ReteICA va dentro del documento**, o su «total a pagar» no cuadra con lo girado: el DSMG1
   decía $2.006.390 cuando salieron $1.998.000, y la diferencia eran los $8.390,36 de ICA. Y va con
   **su tarifa**: se crearon en Alegra `ReteICA transporte 4,14 ‰` (id 15), `asesoría técnica 8,66 ‰`
   (16) y `servicios 9,66 ‰` (17), porque la genérica id 11 está al 0 % y el documento **oficial**
   imprimía «(0%)». ⚠️ El ICA se habla **por mil** y Alegra recibe **porcentaje**: 4,14 ‰ = **0,414 %**.
   Una tarifa sin cuenta propia cae a la genérica y **avisa**.
3. **El pago se registra al confirmar el giro**, no al aprobar (`doc_soporte_pagos.registrar_pago_en_alegra`
   desde `confirmar_pago`), y por lo **girado**, no por el total — la retención no se le pagó a él.
   Sin esto el documento queda «por pagar» y Alegra muestra un pasivo con el beneficiario que no
   existe. Alegra **no deja editar** un documento ya pagado (`11042`): hay que quitar el pago,
   corregir y volver a aplicarlo — y eso solo mientras no tenga sello de la DIAN; después, nota de
   ajuste ADS.

⚠️ La retención va **dentro** del documento: `("transporte_carga", 1.0) → id 13` ya existía en
Alegra pero no estaba mapeada, y sin eso el documento de un pago a Fidel habría salido sin
retención. Y `crear_solicitud` guardaba el concepto de la **categoría** en vez del que deduce la
**cuenta**: una compra a 523550 quedaba como «servicios», la retención iba a la subcuenta de 2365
equivocada y («servicios», 1%) no existe en Alegra. Corregido, y las 10 solicitudes ya creadas se
reetiquetaron.

**Con documento soporte, el asiento no se espeja (21-sep-2026).** `aprobar()` emitía el documento
soporte **y además** espejaba el asiento a Alegra: el documento ya causa el gasto y las retenciones, y su
pago (al confirmar el giro) la salida de bancos, así que Alegra lo contaba **dos veces** — pasó con Fidel
(DSMG1 + comprobante 134). Ahora el documento se emite primero y, si sale (`success`/`ya_emitido`), el
espejo queda `cubierto_por_doc_soporte`; si falla, el asiento se espeja como siempre para que el pago no
quede invisible. Las **cuotas de préstamo** quedan fuera de `emitir_por_solicitud` (el documento de los
intereses lo emite `prestamos.py`).

**Borrador al aprobar, emisión manual (21-sep-2026).** La API de Alegra **no transmite un documento
soporte ya creado** (solo `POST /invoices/stamp` para facturas): se transmite al crearlo
(`stamp.generateStamp`). Por eso al aprobar el documento queda **BORRADOR** en `cc_doc_soporte`
(`detalle_json` = foto exacta: base, retenciones, pagos, solicitudes que cubre) sin tocar Alegra, y un
operador de Administración pulsa **«Emitir a la DIAN»** (ficha de la solicitud o **Libro Mayor → Documentos
soporte**, patrón AstroKiller) → `doc_soporte_pagos.emitir_a_dian()`, que antes de enviar exige: emisión
activa, todo **al peso** y base − retenciones = girado, contacto **NIT con DV**, cuenta con equivalente, y
una simulación donde **todas** las retenciones existen en Alegra y suman lo esperado (si falta una, NO se
emite: es lo que dejó al DSMG1 sin retenciones y con $28.657 fantasma). Crea+transmite en un paso, registra
los pagos y verifica saldo 0. Nunca PUT a `/bills`. Rutas: `GET /api/pagos/documentos-soporte`,
`GET/POST /api/pagos/solicitudes/<id>/documento-soporte[/emitir]`.

**El 3051 era el país (21-sep-2026).** «Problema de comunicación con DIAN» (Alegra 3051) en el DSMG2 de
William, seis intentos: la DIAN respondía bien a las facturas y la asociación del proveedor tecnológico estaba
activa. La causa: **la dirección del contacto sin país**. `emitir_a_dian` ahora exige país, departamento y ciudad
(formato aceptado: `Bogotá D.C.` / `Bogotá, D.C.` / `Colombia`). Además el **ReteICA ya no va dentro del
documento**: se aplica en el **pago** (`bills[].retentions`) y el documento queda con saldo 0 — verificado con
el DSMG2. **Si Alegra responde 3051, el documento ya quedó creado**: el reintento lo retoma (lo borra sin sello y
lo recrea con el mismo número), nunca crea otro.

**Todo al peso.** `pagos_wizard._pesos()` (mitad hacia arriba): retenciones enteras y, en gross-up, la
base entera cuyo neto es exacto. `monto_es_bruto` evita repetir el gross-up al rearmar una solicitud
guardada (`aprobar`, `previsualizacion_de`) — la #38 de William pasaba de 1.210.483 a 1.221.057.

**1ª quincena de sep (21-sep-2026).** Víctor, Stella y Jenniffer: sin retención en la fuente (anulada el
16-sep, asientos 1878-1882), gasto a **511035 Asesoría técnica** y **ReteICA 9,66‰ asumido por McKenna**
(asientos 5584-5586, base = pagado / 0,99034). Sus 13 comprobantes espejo se anularon en Alegra (el documento soporte los reemplaza); los
documentos quedaron como BORRADORES al peso (bases 1.110.730 / 1.262.193 / 1.614.597), la numeración
volvió a **DSMG2** y solo DSMG1 existe en Alegra. Los complementos #14/#15
quedan en `cc_doc_soporte` como `incluido`. **DSMG2-5** eran de `tests/test_prestamos.py` (Juan Pérez
79123456) escribiendo en la Alegra real: borrados, y `tests/conftest.py` ahora apaga las banderas de
documentos fiscales y bloquea toda escritura HTTP hacia Alegra en la suite. **Fidel (DSMG1 + journal 134)
sigue duplicado a propósito**: su DSMG1 no trae las retenciones y el journal es lo único que las muestra —
lo decide el contador.

⛔ **FECHA DE CORTE CONTABLE: lo anterior al corte es del contador (18-sep-2026).**
`contabilidad_core.fecha_corte()` / `antes_del_corte()` / `motivo_corte()`, configurable con
**`CONTABILIDAD_FECHA_CORTE`** (default **2026-09-01**). Hasta agosto de 2026 la contabilidad la
llevó el contador: discriminaba los impuestos con un mecanismo propio que no conocemos y sobre eso
presentó las declaraciones (el 350 del período 8 se presentó el **16-sep-2026**). **Él va a fijar los
saldos iniciales**, por la migración Siigo→Alegra. El libro propio **no reescribe ese pasado**: se
corrige de las declaraciones siguientes en adelante.

Lo hacen cumplir los dos caminos que salen hacia afuera: `alegra_espejo.espejar_movimiento()`
devuelve `bloqueado_por_corte` (y **`forzar` NO lo salta** — `forzar` autoriza postear con el asiento
a la vista, no reescribir un período cerrado) y `contabilidad_autopost.auto_postear_periodo()`
**recorta** el rango al corte en vez de rechazarlo entero, avisando, para que un backfill que empiece
antes siga sirviendo para lo que sí es nuestro.

Los asientos anteriores **no se borran**: documentan movimientos bancarios reales y varios están
conciliados contra el extracto. Simplemente dejan de propagarse. Casos que lo motivaron: los 4 pagos
a Fidel de julio/agosto (hechos con el tratamiento viejo, contra 513550 y sin retención) y los
asientos de IVA generado de julio y agosto — todos listos para espejarse a un período ya declarado.

**Historial por tercero (18-sep-2026).** `app/services/terceros_historial.py` ·
`GET/POST /api/contabilidad/cc/terceros/<id>/historial` · botón **Historial** en Libro Mayor →
Configurar → Terceros. La ficha guarda el **estado** (exento, SIMPLE, cuenta del gasto); esto
guarda **el porqué y lo que le ha pasado**: decisiones, indicaciones del contador, incidentes,
documentos emitidos y pagos. Es lo que hace falta cuando alguien abre un tercero seis meses después
y tiene que decidir si lo que ve sigue vigente — hasta ahora esa memoria vivía en el campo `notas`,
en las tablas de cada módulo y en la cabeza de quien estuvo.

Es **append-only** (un historial editable no responde «¿qué pasó?»), **idempotente** por
(tercero, fecha, título) para que un reintento no lo llene de duplicados, y **no copia** lo que ya
registran `cc_doc_soporte` y `cc_solicitudes_pago`: los lee, porque una copia se desactualiza y
entonces hay dos versiones de lo ocurrido. `perfil_tributario` traduce las banderas a frases con su
norma — «regimen_simple = 1» no le dice nada a quien abre la ficha.

⚠️ **`emite_doc_soporte` la crea ahora `contabilidad_core`**, dueño de `cc_terceros`, no
`doc_soporte_pagos`. Es la misma lección de `regimen_simple`: creada por el módulo que la usa, el
campo no existía hasta que alguien emitiera el primer documento y cualquier lector veía `None`.

**Libro Diario (18-sep-2026).** `contabilidad_mayor.libro_diario()` + `GET /api/contabilidad/cc/diario`
(`formato=csv` para una fila por línea, que es lo que el contador importa) y la pestaña **Libro
Mayor → Libro Diario**. El Mayor responde «cómo se movió esta cuenta»; el Diario, «qué pasó ese
día»: cada asiento con el **código y el nombre** de cada cuenta, débito, crédito y si cuadra. Va en
orden **ascendente** —como se lleva un diario—, al revés que la lista de movimientos, donde se busca
lo último. Los totales son **del rango completo, no de la página**: si fueran de la página cuadrarían
siempre y no servirían para revisar. Filtra por cuenta incluyendo subcuentas (1110 trae 111005).
`pagos_wizard.obtener()` devuelve además el `asiento` de la solicitud con esas mismas columnas, para
no tener que abrir el Libro Mayor a preguntar dónde quedó un pago.

**El IVA de comprar se aprende del documento, el de vender lo decide Alegra (18-sep-2026).** Son dos
cosas distintas y ahora tienen reglas distintas. **Vender:** `crear_factura_venta_alegra` lee
`tax_ids`/`tax_rate_total` del producto **en vivo** en Alegra y la factura tiene que cuadrar al peso
con lo cotizado — nada de esto lo toca el módulo de compras (`tests/test_compras_no_rompen_ventas.py`
falla si algún módulo de ventas llega a importar `pagos_proveedor`). **Comprar:** cuando una compra
se registra y su total **cuadra contra el documento**, las tarifas de cada línea quedan probadas
(total = base + IVA) y se guardan por SKU en `cc_compras_iva_sku`
(`pagos_proveedor.aprender_iva_compra`). La siguiente compra de ese insumo llega con la tarifa que el
proveedor cobra de verdad y el selector marca el origen (`iva_origen`: `compras` o `catalogo`).

**Cada cuenta lleva su guía, y el wizard ya no pregunta impuestos (18-sep-2026).**
`puc_colombia.DESCRIPCIONES` documenta **las 79 cuentas** del plan: qué operación vive en cada una,
en el lenguaje del negocio y señalando donde McKenna la usa distinto de lo que su nombre del PUC
sugiere (511095 son las **quincenas de prestación de servicios** pese a llamarse «Honorarios —
otros»; 5195 es el **cajón de sastre** que ya acumuló $3,17M mal clasificados; 513550 remite a
523550 para el flete de ventas). `contabilidad_core._con_guia()` la pega a **toda** cuenta que sale
de `listar_plan_cuentas` / `obtener_cuenta`, junto con el efecto tributario de
`impuestos_por_cuenta`, así que viaja sola al **árbol del PUC** (tooltip), al **extracto**
(cabecera), al **PDF** y al **CSV** que se le manda al contador. Van en dos fuentes a propósito: la
descripción dice QUÉ operación es y la nota tributaria QUÉ impuestos acarrea — se corrigen por
razones distintas. `descripcion()` hereda de la cuenta mayor, así que una subcuenta nueva dice algo
útil antes que nada; un test exige que ninguna cuenta de `PUC_MCKENNA` quede sin guía.

**El wizard informa los impuestos en vez de preguntarlos.** Se quitaron «¿quién asume la
retención?», «¿lleva retención de ICA?» y la casilla del 4x1000 del recorrido principal: la
respuesta ya está en los datos —la **cuenta** dice el concepto y la tarifa, la **ficha del tercero**
dice si está exento, si es del SIMPLE y con qué ICA— y contestarlas bien doce veces al año y
olvidarlo una es lo que produjo los $164.542 retenidos de más en septiembre. Ahora el bloque muestra
la cuenta con su descripción y **las cifras reales calculadas por el backend** (retefuente, ReteICA,
GMF) con el motivo de cada una; los ceros también se muestran, porque «$0 porque es autorretenedor»
dice más que una casilla sin marcar. Queda **«Ajustar»**, plegado, para lo único que el PUC no puede
saber: el gross-up («te pago libre de retención» es un acuerdo comercial), la tarifa de ICA de otro
municipio y el GMF. El default de `retencion_modo` pasó de `mckenna` a **`beneficiario`** — lo normal
es descontársela a quien cobra; el gross-up es la excepción y vive en la ficha del tercero.

**Mensajería: 523550 + 1 % + ReteICA 4,14 ‰ (18-sep-2026).** El contador fijó cómo se contabiliza el
servicio de mensajería: gasto **523550 Transporte, fletes y acarreos (ventas)** —el flete de la
mercancía que sale al cliente es gasto de VENTAS; 513550 se queda para el transporte
administrativo—, **retefuente 1 %** y **ReteICA 4,14 por mil** (transporte, Bogotá). Las dos tarifas
reproducen al peso el certificado que él mismo expidió a NEXT ENVIOS por 2024 ($173.775 y $71.943
sobre base $17.377.500), así que no son una lectura nuestra de la norma. El operador solo escribe el
valor: la cuenta y el ICA salen de la ficha del tercero y la retención del perfil de la cuenta.

⚠️ **Fidel Rocha quedó DESMARCADO de Régimen SIMPLE** por esto. Retener es incompatible con el
Art. 911 E.T., así que sostener las dos cosas a la vez era imposible y la bandera habría anulado
justo las retenciones que el contador pidió practicar. **Pendiente: pedirle el RUT** para confirmar
el régimen; si resultara estar en el SIMPLE hay que devolverle lo retenido y volver a marcarlo. Lo
anterior a esta fecha se pagó completo y **se deja como está** (decisión del usuario): los asientos
5396-5399 de jul-ago 2026 van contra 513550 y sin retención.

**Transporte de carga al 1 %** (`retenciones.CONCEPTOS["transporte_carga"]`, 4 UVT). Estuvo fuera
de la tabla a propósito hasta sep-2026 —«inventar la tarifa le sale del bolsillo a alguien»— pero
ya no se está inventando: el propio contador la certificó al **1 %** («SERVICIOS 1.0», base
$17.377.500, retención $173.775) en el certificado año gravable 2024 a NEXT ENVIOS S.A.S. También
se cargaron `transporte_pasajeros` (3,5 %), `comisiones` (10/11 %, sin mínimo),
`arrendamiento_inmueble` (3,5 %, 27 UVT), `arrendamiento_mueble` (4 %, sin mínimo) y
`otros_ingresos` (2,5/3,5 %). ⚠️ **Las transportadoras grandes son autorretenedoras** y no se les
retiene: eso es una propiedad del tercero (`retefuente_exento`), no del concepto, y el wizard lo
advierte. El default retiene a propósito — retenerle a un autorretenedor produce un reclamo
visible, no retenerle a quien sí debía produce una deuda silenciosa del Art. 370 E.T., que es
exactamente lo que pasó con la mensajería de Fidel.

**La retención va a su subcuenta también al aprobar (17-sep-2026).** `previsualizar()` mostraba
236525/236540/236515 y `aprobar()` posteaba contra **2365 plana**: se le enseñaba una cuenta a
quien firma y se contabilizaba otra, y el contador tenía que desglosar el 350 a mano teniendo el
sistema el concepto guardado. `aprobar()` ahora resuelve la subcuenta con
`puc_colombia.cuenta_retencion(s["retencion_concepto"])`.

**Régimen SIMPLE: ni renta ni ICA (17-sep-2026).** `regimen_simple` apagaba solo la retención de
renta y el ICA se seguía calculando, así que a un tercero del SIMPLE con tarifa en su ficha se le
retenía un impuesto que ya paga dentro del SIMPLE. La exención del Art. 911 E.T. es por **quién
recibe**, no por el concepto: da igual si el pago es de honorarios, de servicios o de transporte, y
el ICA va consolidado en el SIMPLE (Art. 907 E.T.). Es la **única** excepción a la regla de que
«apagar la renta no apaga el ICA» — ahí se trata de un tercero exento de retefuente que sigue
siendo sujeto de ICA (Víctor, Stella, Jenniffer); acá el tercero no es sujeto de ninguno de los dos.
Caso que lo destapó: Fidel Rocha Morón (CC 9.385.573), que facturó como NEXT ENVIOS S.A.S hasta la
FV1637 del 2024-05-01 y desde jun-2024 cobra como persona natural del SIMPLE con cuenta de cobro
(Art. 616-2 E.T.) — el contador nunca le practicó retención y **hace bien**.

**Perfil tributario desde las facturas electrónicas (18-sep-2026).**
`app/services/perfil_tributario_dian.py` lee los XML `AttachedDocument` UBL 2.1 que
`sincronizar_facturas_de_compra_siigo.py` ya guarda en `facturas_descargadas/` (2.235 archivos, 113
emisores) y saca de `AccountingSupplierParty/cbc:TaxLevelCode` las **responsabilidades fiscales del
RUT** de cada proveedor: `O-15` autorretenedor y `O-47` Régimen SIMPLE son las que cambian cuánto se
gira. Así se obtiene la información de la DIAN sin acceso privilegiado: (1) el **correo**, que es la
entrega con validez legal (Res. 042/2020) y es lo que ya cosechamos; (2) el portal
`catalogo-vpfe.dian.gov.co` → «Documentos recibidos», descarga en lote, sin API de listado; (3) el
SOAP `vpfe.dian.gov.co/WcfDianCustomerServices.svc`, que emite y consulta UN documento por CUFE pero
**no lista lo recibido**.

⚠️ **Propone, nunca aplica.** `TaxLevelCode` lo escribe el emisor sobre sí mismo y puede estar mal:
**DUQUE SALDARRIAGA (860508007) se declara `O-47` SIMPLE en 10 de sus 64 facturas y es régimen común
autorretenedor.** Por eso cada propuesta muestra «en N de M facturas» — la proporción es la señal (los
falsos salen en minoría: Duque 10/64, Envasar 14/42; los ciertos en bloque: Sodimac 114/114) — y
`aplicar()` exige que alguien decida y deja traza con fecha, quién y por qué. `descartar()` registra
el «no» junto con la evidencia del momento y la propuesta **vuelve si el respaldo se duplica**: una
lista que no converge deja de leerse, y un «no» con 10 facturas no debe silenciar el aviso cuando ya
son 60. El XML **no** trae la retención que McKenna debe practicar (`WithholdingTaxTotal` son las del
emisor) ni a quien no factura electrónicamente — una cuenta de cobro del Art. 616-2 jamás aparece ahí,
que es el caso de la mensajería de Fidel Rocha: cero facturas en 2.235 XML.

⛔ **El registro de facturas de compra quedó APAGADO (18-sep-2026).** Era el paso doble: la compra
se pagaba por Solicitudes de pago y después se volvía a registrar cuando llegaba la factura, con
riesgo de contarla dos veces y en el orden al revés —el documento llega después de que la plata ya
se comprometió—. Se apagaron los **dos** caminos: `sincronizar_facturas_de_compra_siigo()` (por NIT)
y `procesar_facturas_para_importar_productos()` con sus comandos de WhatsApp `inv ok / inventario /
gasto`. **`inv skip` sigue vivo** a propósito: quedaron facturas encoladas de antes y sin él la cola
no se podría vaciar nunca. Bandera: `FACTURAS_COMPRA_REGISTRO_ACTIVO=1` lo reactiva.

⚠️ **Lo que NO se apagó es la descarga de los XML** (`descargar_xml_facturas_compra()`, que corre en
los dos caminos deshabilitados). No es un detalle: esos XML en `facturas_descargadas/` son la fuente
de `perfil_tributario_dian.py`, que saca de `cbc:TaxLevelCode` quién es autorretenedor (O-15) y
quién está en Régimen SIMPLE (O-47) — el dato que decide cuánto se le retiene a cada proveedor.
Apagar el módulo entero habría dejado ese perfil congelado sin que nadie lo notara. El botón del
panel se renombró a «Bajar XML de facturas».

**La compra se contabiliza con la cotización, no con la factura (18-sep-2026).** «Productos» del
wizard simple ya no pide un valor global: se eligen las **materias primas por su referencia** del
catálogo de Alegra con la cantidad y el precio de la cotización del proveedor, y el asiento la
reproduce **renglón por renglón** contra 1435. El objetivo es no registrar la compra dos veces —una
para pagarla y otra para contabilizarla cuando llegue la factura—, que es lo que hoy hace el módulo
de facturas de compra. `productos_opcionales` deja pasar el insumo que no está en el catálogo con
un valor global: bloquearlo empujaría al operador a «Otro», donde se pierden la retención y la
cuenta.

Tres cosas que el picker hacía mal y se corrigieron en `pagos_proveedor.productos()`:
- **Mezclaba combos con materias primas.** En Alegra conviven la materia prima suelta (`CITCALg` =
  citrato de calcio por gramo, lo que el proveedor despacha) y el combo que McKenna arma y vende
  (`C-CITCAL500g`). Una compra entra por la primera; los combos quedan fuera salvo
  `incluir_combos=True`. ⚠️ **Lo que manda es el prefijo `C-`, no el campo `type`**: los 231 `kit`
  lo llevan, pero hay además **14 combos guardados como `product`** —`C-VITCACIASC100g`,
  `C-ARCVRT250g`, `C-KITACIHIA30mL`…— que solo la referencia delata. Comprar contra un combo
  asienta como materia prima algo que se arma: el inventario queda a precio de venta y el IVA sale
  del combo, no de la factura.
- **Daba falsos negativos al buscar**, y eso es peor que resultados de sobra porque lleva a crear
  duplicado en Alegra algo que ya existe: «CLORURO **DE** MAGNESIO» no encontraba «CLORURO MAGNESIO
  HEXAHIDRATADO» (preposiciones) y «GOMA XANT**H**AN» no encontraba «GOMA XANTANA» (la misma
  sustancia con otra grafía). Ahora se ignoran las preposiciones y un término también casa por su
  raíz de 4 letras.
- **El precio salía siempre en 0**: leía `price` y el catálogo lo guarda en `precio_lista`.
- **Suponía IVA 19% a todo.** **254 de los 316 productos están EXCLUIDOS** (Art. 424 E.T.), así que
  el IVA sale de cada ítem del catálogo, no de un default.

⚠️ **El IVA del catálogo de Alegra NO es confiable para comprar.** Probado el 18-sep-2026 con la
cotización real PRE0031580 de Factores y Mercadeo (14 materias primas): la misma sustancia está
marcada **19% como `kit`** (el combo que McKenna vende) y **0% como `product`** (la materia prima)
—alulosa, gelatina e inulina, las tres—, y el reparto es un espejo exacto entre los dos tipos
(80% de los kits en 19, 80% de los productos en 0): ese flag nunca se curó para los insumos.
Armando el asiento con él, esa cotización daba **$0 de IVA contra los $619.115 reales**.

Por eso el IVA del catálogo es **solo un punto de partida** y el control real es
**`total_documento`**: el operador teclea el total de la cotización o factura y el sistema exige
que las líneas lo sumen. Como total = base + IVA, una tarifa mal puesta hace que no dé.
`previsualizar()` devuelve `aviso_documento` y `enviar_a_aprobacion()` **rechaza** el descuadre —
se puede guardar un borrador a medias, pero no se aprueba un asiento que dice algo distinto de la
factura que lo sustenta. El campo es opcional: hay compras sin documento a la mano y bloquearlas
empujaría al operador fuera del wizard.

Con el IVA tomado del documento, esa cotización reproduce **todas** sus cifras al centavo:
mercancía $4.531.500 · IVA $619.115 · retención 2,5% $113.287,50 · **girado $5.037.327,50**, que es
el «Total General» del documento — el proveedor ya descuenta la retención en su cotización.

⚠️ **El IVA ya no se carga a inventario.** Antes el asiento debitaba a 1435 el total **con IVA**:
inflaba el inventario con un impuesto que no es costo de la mercancía —es un crédito contra la
DIAN— y dejaba el formulario 300 imposible de armar leyendo el libro. Ahora va a **240810 IVA
descontable**, que es la mitad que faltaba del 300 (`iva_ventas.py` ya cubría la otra).

Dos defectos de `aprobar()` que esto destapó: reconstruía el asiento con **`lineas[0]`** (con cinco
productos habría contabilizado uno y descuadrado el asiento) y **no le devolvía los `items`** a
`previsualizar`, con lo que el detalle por referencia se perdía justo al contabilizar. La
proyección de líneas conserva ahora `cuenta_codigo` para poder distinguir las líneas del gasto de
las que la reconstrucción rearma con los impuestos aprobados.

**El gross-up se pacta, no se elige (18-sep-2026).** `retencion_modo="mckenna"` significa que
McKenna **asume** la retención del tercero como mayor gasto y le gira el valor completo. Mientras
fue un radio del wizard, cualquiera podía activarlo con un clic: sobre la quincena de mensajería
($1.998.000) son **$28.657 que salen del banco de más**, cada quincena, sin que nadie lo pactara.
Ahora solo se acepta si la ficha del tercero dice que así se acordó
(**`cc_terceros.retencion_asume_mckenna`**, apagado para todos por defecto y editable solo en
Libro Mayor → Configurar → Terceros). `previsualizar()` lo valida en el **backend** —por
`retencion_modo` y por `valor_es_neto`, que era la puerta de atrás— y devuelve `aviso_gross_up`
explicando por qué lo ignoró: esconder un radio no es un control, es una sugerencia.

⚠️ **`retefuente_exento` ya NO se deduce de `retencion_modo`.** Mientras el modo era una respuesta
del operador, «ninguna» quería decir «sé que a este no se le retiene» y aprenderlo servía. Al dejar
de preguntarlo pasó a ser **consecuencia de la cuenta** (513530 manda «ninguna» porque la energía no
retiene; 513550 manda «beneficiario» porque sí), y seguir aprendiendo de ahí habría marcado exento a
cualquiera al que se le pagara un recibo de luz y, peor, **desmarcado a los autorretenedores reales**
—Interrapidísimo, Sodimac— en cuanto se les hiciera un pago con cuenta que retiene, reteniéndoles
indebidamente al siguiente. La exención se cambia en la ficha o desde `perfil_tributario_dian`.

**«Libre de retención» (15-sep-2026).** A un prestador de servicios se le pacta «te pago
$1.100.000 libres de retención»: ese valor es **lo que recibe**, no la base gravable. Con
`valor_es_neto` el wizard hace el camino inverso —base $1.145.833, retención $45.833 a la 2365,
girado $1.100.000 exacto— y la retención la asume McKenna como mayor gasto. Retener sigue siendo
obligatorio; lo que cambia es quién la soporta. Sin la bandera, el valor es el total facturado y la
retención se descuenta (es lo correcto cuando hay factura). Transporte **no** lleva retención en el
wizard a propósito: la tarifa de transporte (carga 1%, pasajeros 3,5%) no está en
`retenciones.CONCEPTOS` y la mayoría de transportadoras son autorretenedoras — inventarla le sale
del bolsillo a alguien.

**Impuestos y retenciones, preguntados antes de solicitar (16-sep-2026).** El wizard simple tiene
un bloque propio con tres cosas que antes se asumían:

- **¿Quién asume la retención?** `retencion_modo` = `mckenna` (libre de retención, gross-up; es el
  default de Productos y Servicios) · `beneficiario` (se le descuenta; lo normal con factura) ·
  `ninguna` (autorretenedor, Régimen SIMPLE o bajo la cuantía). Nació de un error con plata real:
  el 15-sep se le giró a dos personas la quincena **menos** la retención cuando estaba pactada
  libre — Gloria $1.200.000 de $1.250.000 y Jenniffer $1.535.040 de $1.599.000. Corregido el
  16-sep en dos movidas: (a) los asientos 1793 y 1795 se **anularon** y se rehicieron (1872 y 1873)
  con la retención practicada sobre la **base completa** —Gloria base $1.302.083,33 / ret
  $52.083,33; Jenniffer base $1.665.625 / ret $66.625— dejando en cada asiento el crédito a Bancos
  por lo que de verdad salió ese día; (b) las solicitudes complementarias **#14 ($50.000) y #15
  ($63.960)** giran la diferencia, **sin retención** porque ya está practicada completa. Así el
  gasto y la base del 350 suman el total y cada asiento cuadra contra su propio movimiento de
  banco. El espejo viejo en Alegra (comprobante 124) se anuló; los nuevos son el 128 y el 129.
- **Retención de ICA** (`ica_por_mil` → cuenta **2368**): la tarifa la escribe quien solicita; no se
  adivina en código porque depende del municipio y la actividad (Bogotá: 9,66 servicios · 11,04
  comercial · 4,14 industrial). En modo `mckenna` el gross-up considera renta + ICA juntos.
- **GMF 4x1000** (`gmf` → cuenta **530595**, `GMF_TARIFA = 0.004`): no se le descuenta a nadie —
  lo cobra el banco sobre lo que sale y es gasto de McKenna, así que el crédito a 1110 es
  `girado + gmf`.

Las tres quedan guardadas en la solicitud (`retencion_modo`, `retencion_ica`, `ica_por_mil`, `gmf`)
y `aprobar()` rearma el asiento con **lo que se firmó**, no con las tarifas de hoy. `girado` =
monto − retención − ICA (el GMF no, ese no es del beneficiario).

**Aprobar no es girar — el ciclo de los dos tokens (15-sep-2026).** En Bancolombia el giro necesita
dos personas: una monta la transacción en la Sucursal Virtual con su token y otra la aprueba con el
suyo. Antes eso vivía fuera del sistema y una solicitud «aprobada» podía llevar semanas sin girarse
sin que nadie lo viera, con el comprobante en un chat. Ahora el estado lo refleja:

    borrador → pendiente → aprobada → en_banco → pagada

`aprobada` es contable (ya hay asiento), `pagada` es bancario (ya salió la plata **y** está el
soporte). **Cada paso es de una persona distinta y el panel solo muestra el botón que le toca a
quien está mirando** (15-sep-2026): el solicitante pide; el primer administrador que llegue
(Cynthia o Armando) aprueba y contabiliza, y a **ese mismo** le aparece «Ya lo preparé en Sucursal
Negocios»; al **otro** le aparece «La solicitud ha sido aprobada» con la captura del banco, y ahí
cierra el ciclo (el ticket se marca resuelto y el comentario avisa a quien lo pidió). El backend lo
exige, no solo la interfaz: `montar_en_banco()` rechaza a quien no aprobó y `confirmar_pago()`
rechaza a quien ya aprobó o preparó — si una sola persona hiciera los tres pasos, los dos tokens del
banco dejarían de ser dos pares de ojos. La identidad sale de `X-Tickets-Token`
(`_panel_tickets_usuario`); con el token de sistema, sin persona identificada, se deja pasar como
antes. Aprobar es de nivel administrador (`puede_registrar_directo`), validado también en la ruta. `montar_en_banco()` y `confirmar_pago()` en `pagos_wizard.py`; rutas
`POST /api/pagos/solicitudes/<id>/montar`, `POST …/confirmar-pago` (multipart con el comprobante) y
`GET …/comprobante`. El segundo visto bueno **pega la captura con Ctrl+V** (`CapturaComprobante`, también arrastrar o
elegir archivo): quien acaba de hacer la transacción tiene la imagen en el portapapeles, no un
archivo guardado — obligarlo a guardarla y buscarla es el paso donde el comprobante se deja «para
después». **Confirmar exige el comprobante** — un pago marcado como hecho sin soporte es
justo lo que después nadie concilia contra el extracto; el archivo queda en la solicitud y también
pegado al asiento. Los KPIs de la cabecera separan «Aprobadas, falta girar» de «Giradas con
comprobante».

**Pagos de impuestos desde el recibo del contador (17-sep-2026).** Concepto «🏛️ Impuestos» en el
wizard simple (`PagoImpuestos` en `PagosWizardPanel.tsx`, `app/services/pagos_impuestos.py`,
`GET /api/pagos/impuestos/recibos`, `POST /api/pagos/impuestos/solicitar`, `GET …/recibos/<n>/pdf`).
Lista los recibos que `descargar_soportes_contador.py` + `extraer_declaraciones_contador.py` dejaron en
`docs/contabilidad/<año>/declaraciones_contador.json` y pone la cuenta sola: 490 concepto 61 de un 350 →
**2365**, concepto 62 de un 350 → **2367** (reteIVA), 490 de un 300 → 2408, de un 110 → 2404, RTICA de
Hacienda → 2368, ICA anual → 2412. Pagar un impuesto **no es gasto**: baja el pasivo causado. La
solicitud lleva `referencia = dian:490:<n>` (o `sdh:<n>`, la misma de Conciliación contador) y el PDF del
recibo como soporte; un recibo ya asentado —por referencia, solicitud o un débito del mismo valor ±7 días
en esa cuenta (línea PSE del extracto)— no se ofrece otra vez. Avisa cuando el libro tiene causado menos de
lo que se paga (hoy: la 2367 y la 2368 están en cero aunque se declaran cada período) y cuando el 350
descuenta retenciones en exceso (renglón 129). ⚠️ La bitácora vieja `app/services/impuestos.py`
(`impuestos_pagos.json`) postea como gasto **5195** (`FUENTE_MAPEO["operativos_impuestos"]`): no registrar
ahí un pago que ya va por el wizard.

**Pago a proveedor con productos y factura (13-sep-2026).** Las categorías `compra_proveedor` (1435) y
`factura_proveedor` (2205) llevan `con_productos` + `requiere_factura`: el wizard pasa por
**proveedor** (terceros del libro + contactos «provider» de Alegra, `app/services/pagos_proveedor.py`;
un contacto se adopta como tercero al elegirlo), **productos con SKU** del catálogo espejo de Alegra
(precio sin IVA, IVA por línea; el monto es la suma con IVA y la retención va sobre la base), y
**factura o cotización cotejada** (`POST /api/pagos/verificar-factura`: XML DIAN, PDF o ZIP; NIT,
número, total y cada producto; sin LLM) antes de «Enviar a aprobación». Sin productos o sin cotejo
el backend rechaza la solicitud; si el cotejo no es fiel, exige una explicación que viaja al ticket.
El Centro de Mando ofrece «💸 Solicitud de pago a proveedor», que redirige a este wizard, y
`POST /api/tickets` rechaza (400 + `redirigir: "pagos"`) una solicitud de texto libre que parezca
un pago a proveedor (`routes_tickets._parece_solicitud_de_pago`). El aprobador sale del aliado
`pagos_aprobador` (Sistemas → Aliados) o de `PAGOS_APROBADOR`; al aprobar, la factura queda como
soporte del asiento.

**Dos caminos, un solo motor:**
- **Solicitar** (cualquiera con permiso `pagos`): crea la solicitud → ticket al
  aprobador → al aprobar nace el asiento.
- **Registrar directo** (solo nivel administrador — Cynthia y Armando): un paso,
  sin ticket. Ellos montan y aprueban sus propios pagos; auto-aprobarse en dos
  pasos es burocracia sin control real. Queda anotado «Registrado directamente
  por X» y el panel lo marca con un chip: saltarse el control es válido,
  **ocultarlo no**. Un test verifica que el asiento sea idéntico por ambos
  caminos — si divergieran, un mismo pago quedaría contabilizado distinto según
  quién lo registre.

**Tres decisiones:** (a) el asiento se muestra antes de confirmar por los dos
caminos — firmar un monto sin ver la cuenta es firmar a ciegas; (b) el asiento
nace al **aprobar**, no al solicitar, así una solicitud rechazada no deja rastro;
(c) si Alegra falla, el asiento interno igual queda y el espejo se reintenta. `aprobar()` no
contabiliza dos veces: la guarda es **tener `movimiento_id`**, no el estado — una solicitud ya
girada («en_banco», «pagada») pasaba de largo por el control de estado y un segundo clic habría
duplicado gasto y retención (16-sep-2026).

**La cuenta contable la elige el operador (sep-2026).** La categoría propone una cuenta
(`cuenta_debito`) pero ya no la impone: las categorías con `cuenta_libre` muestran el selector
del PUC (`GET /api/pagos/cuentas-gasto`, `pagos_wizard.cuentas_gasto()`), y
`_validar_cuenta_elegida()` solo acepta gasto, costo o inventario — un pago no se carga contra
Bancos ni contra Ventas. Nació de un caso real: la quincena de quien presta servicios va a
**511095** y no al saco de 5135, y antes llevarla ahí obligaba a usar la categoría «Otro», con
lo que se perdía la retención propia de la categoría.

**El perfil tributario vive en el tercero, no en el pago** (`cc_terceros.retefuente_exento`,
`ica_por_mil`, `gmf_por_defecto`, `cuenta_gasto_default` — `_migrar_columnas_v5`). A Armando,
Cynthia, Víctor, Stella y Jenniffer **no se les practica retención de renta pero sí ICA (9,66 por
mil → 2368) y 4x1000**, y su gasto va a **511095**. Guardarlo en la persona y no en cada pago es
lo que evita que se olvide: lo que se olvida una vez se olvida siempre. Al crear una solicitud,
`_recordar_perfil_tributario()` **guarda en la ficha lo que el operador definió** (solo lo que el
pago trae explícito, y nunca sobre un tercero en Régimen SIMPLE), así que a partir del primer
pago las casillas vienen puestas.

⚠️ **ICA y retención de renta son impuestos distintos y se calculan por separado.** Elegir
«Nadie — no se practica retención» —que es lo que el perfil de estas personas selecciona— apagaba
también el ICA, así que justo a quienes el contador mandó practicárselo no se les practicaba
nunca. `aplica_renta` y `aplica_ica` son ahora condiciones independientes; lo único que apaga las
dos es `saldo_por_pagar`, donde los impuestos ya se causaron al reconocer el servicio.

**«Salario de socio» se ocultó** (`"oculta": True`, sep-2026): lo que Armando y Cynthia cobran es
prestación de servicios igual que la de Víctor o Stella, va a la misma cuenta y admite pago
parcial desde **Servicios**. Un botón aparte solo para socios sugería un trato distinto que no
existe. La categoría **no se borra** — hay solicitudes históricas con ese valor y eliminarla las
dejaría sin poder abrirse; `/api/pagos/categorias` filtra las ocultas.

**«Honorarios» y «Prestación de servicios» no son lo mismo** (sep-2026): quien
presta servicios operativos a McKenna sin ser nómina —calidad, empaque, apoyo—
va a **5135 con retención de servicios (4% declarante / 6% no)**, no a 5110 con
la de honorarios (10-11%). Sin esa categoría propia el pago solo podía entrar
como honorario o como «Otro», y una tarifa equivocada sale del bolsillo de una
persona real.

**Plan de cuentas ampliado** para que esto sirva: antes TODO gasto caía en 5135
«Servicios» (luz, contador y fletes juntos). Ahora hay 19 cuentas de gasto con
códigos PUC reales — 513550 Transporte/fletes, 513530 Energía, 5110 Honorarios,
5120 Arrendamientos… — y **las 35 cuentas están mapeadas a Alegra** una a una.
Ver `app/services/pagos_wizard.py` y `alegra_espejo.MAPA_PUC`.

