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

### 4. Retención no practicada en compras a proveedores — $3.109.562

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
