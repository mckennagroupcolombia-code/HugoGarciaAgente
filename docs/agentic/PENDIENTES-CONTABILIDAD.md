# Pendientes de contabilidad — corte 2026-09-10

Estado al cierre de la sesión que arrancó por el módulo de préstamos y terminó
tocando retenciones, documento soporte, el espejo a Alegra y la conciliación de
compras. Cada punto dice **qué falta, por qué importa y quién puede resolverlo**.

Documentos relacionados:
`modules/prestamos.md` · `modules/relaciones-socios-terceros.md` ·
`modules/contabilidad.md`

---

## 🔴 Bloqueantes — sin esto lo demás queda a medias

### 1. Saldo inicial de la cuenta bancaria

**Bancos está en −$17.130.398.** No es un error de asientos: el Libro Mayor tiene
las salidas (compras, pagos) pero arrancó sin el saldo de apertura y sin el
histórico completo de ingresos.

Mientras no se cargue, **ninguna cifra de caja del panel es utilizable** y la
conciliación bancaria no puede cuadrar.

*Lo resuelve:* quien tenga el extracto o el balance a la fecha de corte.

### 2. Extracto bancario para cerrar el pasivo con proveedores

**$87.880.072 pendientes en 2205**, de los cuales una parte importante son las
**48 facturas de agosto que no están en Siigo** (ver punto 6). Si ya se pagaron y
solo falta el registro, el pasivo está inflado.

`app/services/extracto_bancario.py` ya existe y cruza contra el libro. Con el
extracto de agosto-septiembre se resuelve solo.

*Lo resuelve:* descargar el extracto y cargarlo en Contabilidad → Conciliación.

---

## 🟠 Fiscal — con plazo encima

### 3. Declarar la retención de agosto — VENCE 2026-09-16

**$96.250,81** en la cuenta 2365, de las compras a socios (Cynthia).

- Ticket **TKT-2026-1223**, prioridad urgente, asignado a Jenniffer.
- Ya está espejada en Alegra (comprobantes 1, 2 y 3) en la cuenta
  **5120 Retenciones compra 2,5% por pagar**, así que el contador la ve al extraer.
- Al pagarla: registrar el egreso contra 2365 para que deje de figurar como deuda.

### 4. ~~Retención no practicada en compras a proveedores — $3.109.562~~ → SÍ SE DECLARÓ

**✅ Resuelto el 2026-09-11 con los correos del contador (William Novoa,
williamfer94@hotmail.com).** Él presenta el formulario 350 todos los meses, con
retención por **compras** (renglones 36/49 personas jurídicas y 86/102 personas naturales):

| Periodo 2026 | Base PJ | Ret. PJ | Base PN | Ret. PN | Total pagado |
|---|---|---|---|---|---|
| 1 ene | 13.028.000 | 326.000 | 4.629.000 | 116.000 | 442.000 |
| 2 feb | 1.597.000 | 40.000 | 1.037.000 | 26.000 | 66.000 |
| 3 mar | 12.706.000 | 318.000 | 1.898.000 | 47.000 | 365.000 |
| 4 abr | 14.423.000 | 361.000 | 11.204.000 | 280.000 | 641.000 |
| 5 may | 8.523.000 | 213.000 | 9.497.000 | 237.000 | 450.000 |
| 6 jun | 16.408.000 | 410.000 | 3.765.000 | 94.000 | 504.000 |
| 7 jul | 19.513.000 | 488.000 | 4.409.000 | 110.000 | 598.000 |
| **Total** | | | | | **3.066.000** |

Coincide casi al peso con los $3,1M que aquí se daban por "no practicados". La
retención existe y se paga. Lo que falta es que **el Libro Mayor no la registra**: la
2365 solo recibe el débito del pago PSE, sin la causación en cada compra. Por eso
quedaba en negativo y los pagos de julio y agosto "restaban" (arreglado en
`retenciones.resumen_periodo`).

**Backfill hecho el 11-sep:** 29 asientos `retencion_compra` (referencia `ret:<factura>`),
$2.621.225 de enero a agosto, por tercero, con la base tomada del XML DIAN cuando existe.
Los pagos a proveedores ya salían netos de retención (p. ej. Factores, 20-ago,
$3.220.642 = factura − 2,5%), así que causarla deja la cuenta del proveedor en cero.

Queda pendiente: (a) la diferencia mensual contra el 350 (~$896.000 en total) es la
columna de **personas naturales**: facturas que el contador tiene y que nunca llegaron
por el correo de facturas — pedirle el detalle por tercero (**TKT-2026-1301**); (b) que
el auto-post de `compra_gmail` cause la retención de aquí en adelante; (c) **Motores y
Reductores GM** quedó con 2205 en −$39.916: se declaró su retención pero se le pagó la
factura completa, o sea que McKenna la asumió; (d) estos asientos **no** se espejaron a
Alegra a propósito: allá todavía no están las compras (punto 6), y subir solo la
retención dejaría la cuenta por pagar del proveedor en negativo. Van juntos. Los 350 descargados están en el correo de McKenna, remitente
williamfer94@hotmail.com, asunto «RTF periodo N».

*Texto original (superado), para la historia:*

30 facturas de 2026 superan las 27 UVT y **no se les practicó retefuente**.
Verificado contra los XML DIAN: **ninguno de los 7 proveedores es autorretenedor**
(todos declaran `R-99-PN`, ninguno `O-15`). Y verificado contra Siigo: **ninguna
compra tiene retefuente registrada** — las 6 con retención son ReteICA de 2021.

| Proveedor | Facturas | Retención |
|---|---|---|
| Química Interkrol | 10 | $1.284.166 |
| Factores y Mercadeo | 10 | $816.273 |
| Productos 3A | 3 | $375.238 |
| Alexandra Benavides | 4 | $218.374 |
| Global Trading | 1 | $207.362 |
| Globalquimia | 1 | $160.650 |
| Motores y Reductores GM | 1 | $47.500 |

**⚠️ Actualización 2026-09-11 — el método de arriba no es confiable.** `R-99-PN` en
el XML **no prueba** que un proveedor no sea autorretenedor: muchos facturadores lo
ponen por defecto. Caso real: Duque Saldarriaga trae `R-99-PN` en sus XML y es
autorretenedor por Res. DIAN 012297 de 2022 (TKT-2026-1290). Antes de dar por
buena la cifra de cada proveedor, pedirle el RUT o la resolución.

| Proveedor | Estado de la verificación |
|---|---|
| Productos 3A («Alimentos 3A») | **Confirmado NO autorretenedor** (Armando, 11-sep). Sí se les retiene. Ver nota abajo |
| Duque Saldarriaga | Autorretenedor (Res. 012297/2022) — no se le retiene; no estaba en la tabla |
| Los otros 6 | Sin verificar |

*Productos 3A — corregido el 11-sep:* en julio se giró el total de BO15756
($5.393.528) sin descontar la retención; el 21-ago se pagó BO16917 con $4.550.000,
descontando las dos retenciones (TKT-2026-0899; Armando confirmó que ese débito es de
3A). Libro Mayor: se anuló #1208 (pago de julio duplicado desde Siigo), se crearon las
retenciones #1435 (BO15756, $113.304) y #1436 (BO16917, $100.512, base real $4.020.500
según el XML: tiene ítems al 5%), y el pago #1437, vinculado al extracto 861. Todo se
espejó a Alegra (comprobantes 5-10). Saldo con 3A: McKenna les debe **$8.339,50**.
En el Libro Mayor, la retención de agosto pasa de $96.250,81 a $196.762,81, pero **esa
no es la cifra a declarar**: el 350 lo arma William con todas las compras (estimado
de agosto ≈ $656.000 solo a personas jurídicas). La retención de 3A de julio ya iba en
el periodo 7 ($598.000). Ver la tabla de arriba.

⚠️ **Decisión de negocio, no técnica.** Son 195 facturas ya pagadas sin retener;
corregirlo hacia atrás (asumir la retención, corregir declaraciones, o dejarlo)
tiene implicaciones que exceden lo que el sistema puede decidir.

*Falta también:* implementar el cálculo en el auto-post de `compra_gmail` para que
de aquí en adelante se practique — hoy solo lo hace `compra_exterior`.

### 5. Correo del contador

`retenciones.enviar_correo_contador()` está construido y probado, pero **no hay
dirección**. Configurar `EMAIL_CONTADOR` o pasarla al llamar.

---

## 🟡 Compras sin registrar

### 6. 48 facturas de agosto, $97.797.057, en ningún sistema contable externo

Cronología reconstruida:

```
abr–sep 2026   el flujo de Gmail registra en SIIGO (última corrida: 1-sep)
2026-09-03     se migra el código a Alegra
hoy            no ha vuelto a correr
```

Esas 48 facturas están en el historial del panel y —desde hoy— en el Libro Mayor,
pero **no en Siigo ni en Alegra**. Incluye las más grandes: `FA272306` Interkrol
$5,7M, `FEA18545` Global Trading $8,3M, `BO16906` Productos 3A $4,8M.

Sin registro, el costo no está soportado y el IVA descontable no se tomó.

*Camino:* el espejo a Alegra (`alegra_espejo.py`) ya funciona; se pueden mandar
como comprobantes contables.

### 7. `crear_factura_compra_alegra` está roto y va a fallar en la próxima corrida

`POST /bills` rechaza los ítems con *"Uno de los items especificados es inválido"*
(código 11034) — **incluso con `GENERICO`**, que es el que usa producción. La cuenta
de Alegra no tiene ningún bill creado nunca.

Probado y descartado: cambiar el ítem, la plantilla (10 y 8), los campos del ítem,
la categoría contable. `paymentMethod` **solo acepta `"CASH"`** (cualquier otro da
11305) — eso sí se corrigió.

*Falla ruidosamente* (manda WhatsApp con el error), así que se va a notar.
*Alternativa:* usar el espejo de comprobantes contables en vez de `/bills`.

---

## 🟢 Configuración pendiente en Alegra

| Qué | Por qué | Estado |
|---|---|---|
| Ítem `INTERES-MUTUO` | Documento soporte de intereses de préstamos | No existe |
| Retención **7% rendimientos financieros** | Sin ella el doc. soporte de intereses sale sin retención | No existe (el código lo avisa) |
| Plantilla **id=16** | Se llama "Documento Soporte" pero su tipo real es `saleTicket` — emitiría el documento equivocado | Revisar o borrar |
| Correo de Cynthia en Alegra | Figura `mckenna.group.colombia@gmail.com`, el de la empresa | Corregir |

Flags en sombra, listos para encender cuando lo anterior esté:
`ALEGRA_ESPEJO_ACTIVO`, `COMPRAS_SOCIOS_DOC_SOPORTE_ACTIVO`,
`PRESTAMOS_DOC_SOPORTE_ACTIVO`.

---

## ⚪ Mejoras conocidas

- **2380 mezcla** préstamo de socio con cuenta por pagar por mercancía
  (`resumen_prestamos()` incluye `pago_socio`). No estorba mientras ningún socio
  preste dinero.
- **Certificado anual de retenciones** en formato DIAN — el plazo sí está
  calculado (último día hábil de marzo; para 2026 → 31-mar-2027).
- **Calendario tributario 2027**: cargar la tabla en `calendario_tributario.py`
  cuando salga el decreto. Hasta entonces el sistema dice "fecha no confirmada"
  en vez de adivinar.
- **UVT 2027**: igual, cargar en `retenciones._UVT` o vía `UVT_2027`.
- **Fecha del pago a proveedor es aproximada**: Siigo no expone la fecha real del
  pago (solo valor), así que los 61 pagos registrados usan la fecha del documento.
  La conciliación con el extracto revelará las diferencias.
- **23 tests fallan desde antes de esta sesión** (formulario manteca, precios
  canales, postventa, alegra contabilidad y otros 5 archivos). No los tocó nadie
  acá; conviene mirarlos aparte.

---

## Estado contable al corte

```
1110  Bancos                          -17.130.398   ← falta saldo inicial
1435  Inventarios - Mercancías        142.670.089
2205  Proveedores nacionales          -87.880.072   ← ver puntos 2 y 6
2365  Retención en la fuente             -96.251    ← declarar antes del 16-sep
2380  Cuentas por pagar - socios      -8.030.722    (Cynthia 4,3M · Armando 3,7M)
4135  Ingresos por ventas             -32.708.733
5195  Gastos diversos                   3.176.086
```

1.096 movimientos · 29 terceros · balance de comprobación **cuadra**.

**Respaldos de la base** en el scratchpad de la sesión: `contabilidad_antes_reproceso.db`,
`antes_retenciones.db`, `antes_gmail.db`, `antes_2205.db`, `antes_pagos.db`.
