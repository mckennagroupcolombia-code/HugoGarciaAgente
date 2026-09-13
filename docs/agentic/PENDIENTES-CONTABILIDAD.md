# Pendientes de contabilidad — corte 2026-09-13

Estado al cierre de la sesión que arrancó por el módulo de préstamos y terminó
tocando retenciones, documento soporte, el espejo a Alegra y la conciliación de
compras. Cada punto dice **qué falta, por qué importa y quién puede resolverlo**.

Documentos relacionados:
`modules/prestamos.md` · `modules/relaciones-socios-terceros.md` ·
`modules/contabilidad.md`

Soportes del contador (declaraciones DIAN/SDH bajadas del correo, fuera de git):
`docs/contabilidad/<año>/Soportes_Contador/<AAAA-MM>/<tipo>/` — se regeneran con
`scripts/descargar_soportes_contador.py`; los valores extraídos quedan en
`docs/contabilidad/<año>/declaraciones_contador.json` y el cruce 350 ↔ 2365 en
`docs/contabilidad/comparacion_350_vs_2365.json` (`scripts/extraer_declaraciones_contador.py --comparar`).

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

**Actualización 2026-09-13 — cruce automático de los 350 contra la 2365.** Se bajaron
del Gmail de la empresa los 85 adjuntos que William envió entre ene-2025 y sep-2026
(350 + recibos 490 de cada mes, IVA 300, renta 110 de 2024, ICA anual, RTICA
bimestral y 20 certificados de retención) y se leyeron renglón por renglón. Resultado
para 2026, mes a mes (PJ = renglón 49, PN = renglón 102; «LM» = Libro Mayor por
`tipo_persona` del tercero):

| Mes 2026 | 350 PJ | LM PJ | dif PJ | 350 PN base | 350 PN ret | LM PN | 490 pagado (fecha) | pago en LM |
|---|---|---|---|---|---|---|---|---|
| ene | 326.000 | 339.877 | −13.877 | 4.629.000 | 116.000 | 0 | 442.000 (16-feb) | no |
| feb | 40.000 | 39.916 | +84 | 1.037.000 | 26.000 | 0 | 66.000 (17-mar) | no |
| mar | 318.000 | 339.760 | −21.760 | 1.898.000 | 47.000 | 0 | 365.000 (21-abr) | no |
| abr | 361.000 | 360.579 | +421 | 11.204.000 | 280.000 | 0 | 641.000 (20-may) | no |
| may | 213.000 | 213.077 | −77 | 9.497.000 | 237.000 | 0 | 450.000 (18-jun) | no |
| jun | 410.000 | 415.746 | −5.746 | 3.765.000 | 94.000 | 0 | 504.000 (17-jul) | sí (#1389) |
| jul | 488.000 | 461.199 | +26.801 | 4.409.000 | 110.000 | 0 | 598.000 (20-ago) | sí (#1555) |
| **ene-jul** | **2.156.000** | **2.170.154** | **−14.154** | **36.439.000** | **910.000** | **0** | **3.066.000** | 1.102.000 |
| ago | (sin 350 aún) | 664.887 | | | | 96.251 | vence 16-sep | |

Cuatro conclusiones:

1. **La columna de personas jurídicas cuadra.** Diferencia acumulada de −$14.154 en
   siete meses; las mensuales (±$27k) son redondeo a miles más, en julio, una base de
   ≈$1,07M que William tiene y el Libro Mayor no (o una factura que el LM causó en
   junio y él en julio). No hay $3,1M "no practicados": el 350 los declara y el 490
   los paga cada mes.
2. **La columna de personas naturales ($910.000 ene-jul sobre una base de $36,4M) son
   las compras a los socios y a Alexandra Benavides, no facturas de proveedores
   perdidas.** Lo prueban los certificados de 2024 que envió William: compras al 2,5%
   por $122,5M a Armando (CC 1013630698), $47,7M a Cynthia (CC 1019044839) y $16,7M a
   Alexandra (CC 1026262496). En el Libro Mayor de 2026 solo están las tres facturas
   FE de Alexandra ($153.556, y **marcada como jurídica** — su `tipo_persona` en
   `cc_terceros` id 7 debe pasar a `natural`; por eso la columna «LM PN» sale en 0) y
   las compras a socios **solo desde agosto** ($96.251). `compras_exterior` apenas
   tiene ene $3,2M, feb $159k y jun $792k contra los ≈$30M de base que declaró
   William para los socios entre enero y julio. Corregido el tipo de Alexandra, el
   faltante real de PN es **$756.444** y es todo compras a socios. **TKT-2026-1301
   cambia de sentido:** no pedirle a William «facturas que no llegaron», sino el detalle
   por tercero de los renglones 86/102 (que serán las cuentas de cobro de Cynthia y
   Armando) para cargarlas en Préstamos → Compras de socios y que la 2380 y la 2365
   queden completas hacia atrás.
3. **Faltan los pagos de enero a junio en la 2365.** Los cinco recibos 490 de esos
   meses suman **$1.964.000** con fecha exacta (tabla), pero el Libro Mayor solo tiene
   los débitos de jul-17 y ago-20 que salieron del extracto. Por eso la cuenta muestra
   hoy un saldo de **$1.829.292** cuando lo único pendiente de verdad es agosto. Se
   resuelve al cargar el extracto de ene-jun (punto 1) o registrando los cinco pagos
   con la fecha del 490 (`extracto_clasificado` / egreso contra 2365).
4. **Agosto (periodo 8, vence 16-sep):** el LM lleva $664.887 de proveedores + $96.251
   de socios = **$761.138**, y William aún no ha enviado el 350. La cifra que él
   declare debería salir cerca de eso más las compras a socios que él tenga y el LM no.

**Lo que no llegó por correo (pedir):** 350 de los periodos 3, 5 y 6 de 2025; la
declaración RTICA del bimestre 2 de 2026 (solo llegó el recibo: $403.000 el 22-may);
la renta del año gravable 2025; ninguna exógena (1001 y demás) ni auxiliares /
balance de prueba de ningún periodo — William no los manda por iniciativa propia.

*Otros valores ya extraídos, para referencia rápida:* IVA cuatrimestre 3-2025 con saldo
a favor de $1.817.000 (retenciones de IVA a McKenna $2.962.000); ICA anual 2025 base
$733,9M, impuesto $3.038.000, retenido $642.000, pagados $2.396.000 el 27-feb-2026;
RTICA 2026: B1 $356.000, B2 $403.000, B3 $412.000; Renta 2024: ingresos $827,9M, renta
líquida $23,8M, impuesto $8.323.000, retenciones a favor $7.711.000, pagado $612.000.
Retefuente total 2025: PJ $3.268.000 + PN $1.700.000 = $4.968.000 (faltan 3 periodos).

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
2365  Retención en la fuente          -1.829.292    ← 13-sep: incluye $1.964.000 de pagos ene-jun ya hechos
                                                     (490 en el correo) pero no registrados; real pendiente ≈ agosto
2380  Cuentas por pagar - socios      -8.030.722    (Cynthia 4,3M · Armando 3,7M)
4135  Ingresos por ventas             -32.708.733
5195  Gastos diversos                   3.176.086
```

1.096 movimientos · 29 terceros · balance de comprobación **cuadra**.

**Respaldos de la base** en el scratchpad de la sesión: `contabilidad_antes_reproceso.db`,
`antes_retenciones.db`, `antes_gmail.db`, `antes_2205.db`, `antes_pagos.db`.
