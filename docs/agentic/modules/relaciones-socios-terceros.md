# Esquema de relaciones: socios, familiares y terceros

Quién es quién alrededor de McKenna Group S.A.S. y cómo debe quedar cada operación
en la contabilidad. Escrito el 2026-09-10 a partir de la explicación del usuario,
porque **no se deduce del código** — y porque el código hoy no lo refleja bien
(ver «Brechas» al final).

## Los cuatro tipos de relación

| # | Quién | Qué hace | Naturaleza | Cuenta PUC |
|---|---|---|---|---|
| 1 | **Socios** (Armando García, Cynthia Ruiz) | Compran mercancía en **Amazon u otros comercios de EEUU** con su **tarjeta de crédito personal**. La mercancía **llega a nombre de la persona natural**; el socio se la entrega a la empresa para que la empresa pueda venderla, y la empresa le reintegra | Adquisición de bienes a una persona natural, no compra a proveedor formal | **2380** |
| 2 | **Socios** | Cobran una **cuota de manejo (5%)** por conseguir esa mercancía | Gasto/mayor costo + pasivo con el socio | 2380 contra costo |
| 3 | **Familiares por servicios** | Prestan servicios a la empresa y reciben pago | Gasto por servicios | 5135 / 2335 |
| 4 | **Familiares prestamistas** | Solo **consignaron dinero** a la cuenta de la empresa como préstamo | Pasivo financiero | **2295** |

### Por qué el mecanismo de los socios existe

No es evasión ni informalidad: los productos son pequeños y el volumen es residual
e inicial, así que no justifica una **importación formal** a nombre de la empresa
(agente de aduanas, DIAN, tiempos, costos fijos). El socio compra a título personal
en Amazon u otros comercios de EEUU, **la mercancía llega a su nombre como persona
natural**, y después se la entrega a la empresa para que esta pueda venderla. Es un
mecanismo consciente y temporal.

**Consecuencia fiscal — y hay que separar DOS capas que se confunden fácil:**

**Capa 1 — la compra al socio (operación nacional).** McKenna le compra bienes a una
persona natural no obligada a facturar. Para soportar ese costo se emite **documento
soporte** (Res. DIAN 000167 de 2021). Esta capa es una transacción interna normal y
el documento soporte la cubre bien.

**Capa 2 — el estatus aduanero de la mercancía.** Y acá está el límite duro:

⚠️ **La mercancía NO entró por una modalidad de importación ordinaria.** Llegó a
nombre de una persona natural, por tráfico postal / envíos urgentes / viajeros —
modalidades que son para **uso personal, no para reventa comercial**. De eso se
derivan tres cosas que NO se pueden hacer:

1. **No hay IVA descontable.** El IVA descontable nace de una factura o de una
   **declaración de importación** (Art. 485 ET). McKenna no tiene declaración de
   importación a su nombre, y si algo se pagó a la entrada fue la persona natural
   sobre un envío personal. Tomarlo como descontable sería un descuento sin
   sustento legal.
2. **No se pueden deducir aranceles** que la empresa no pagó ni tiene cómo soportar.
3. **El documento soporte NO sanea el estatus aduanero.** Soporta la compra al socio
   para efectos de renta; no convierte en legalmente importada una mercancía que
   entró por una modalidad personal.

**Riesgo de fondo:** introducir mercancía por modalidad personal para revenderla
comercialmente puede configurar **infracción aduanera con aprehensión y decomiso**
(Decreto 1165 de 2019) y, superados ciertos umbrales de valor, **contrabando o
favorecimiento al contrabando** (Arts. 319 y 320 C.P., Ley 1762 de 2015). La
contabilidad no puede arreglar eso: solo lo refleja con fidelidad.

**Lo único que lo resuelve es formalizar la importación** cuando el volumen lo
justifique — que es exactamente por lo que el mecanismo se planteó como residual y
temporal. Mientras tanto: registrar honestamente, **no tomar IVA ni aranceles
descontables**, y vigilar que el volumen siga siendo marginal.

**Corrección de una recomendación anterior (2026-09-10):** se sugirió que bajo un
contrato de mandato McKenna podría recuperar el IVA pagado a la entrada. **Eso es
incorrecto** y no debe hacerse: el mandato cambia quién figura como adquirente en
una compra nacional, pero no puede generar IVA descontable sobre mercancía que no
entró por importación ordinaria. La figura del mandato sigue teniendo otras ventajas
(el socio no acumula ingresos por reventa), pero **no** la del IVA.

**Implicación contable:** el dinero que sale de la tarjeta del socio **no pasa por
el banco de McKenna**. El banco de McKenna se mueve **después**, cuando le reintegra
al socio. Son dos momentos distintos, y confundirlos rompe la conciliación bancaria.

## Cómo debe quedar cada operación

### 1 y 2 · Compra del socio + cuota de manejo

**Al comprar** (no hay movimiento bancario de McKenna):
```
Débito   1435/1436  Inventarios                    valor mercancía
Débito   6135/5195  Cuota de manejo (5%)           cuota
    Crédito  2380   Cuentas por pagar - socios     valor + cuota   [tercero = el socio]
```

**Al reintegrarle** (aquí SÍ se mueve el banco, y es lo que aparece en el extracto):
```
Débito   2380   Cuentas por pagar - socios         valor + cuota   [tercero = el socio]
    Crédito  1110  Bancos                          valor + cuota
```

Es lo que hacen `contabilidad_core.registrar_compra_socio_amazon()` y
`registrar_pago_socio()` — que existen y están bien, pero **nadie las está usando**.

### 3 · Familiar por prestación de servicios

```
Débito   5135  Gastos - Servicios                  valor
    Crédito  2365  Retención por servicios         retención (tarifa de SERVICIOS)
    Crédito  1110  Bancos                          neto girado
```

⚠️ **La tarifa de retención por servicios NO es la misma que la de rendimientos
financieros (7%).** Si un mismo familiar presta servicios *y* además prestó dinero,
son dos conceptos distintos, con dos tarifas distintas, y deben ir separados aunque
sea la misma persona.

### 4 · Familiar prestamista

Lo cubre el módulo de préstamos (`docs/agentic/modules/prestamos.md`): consignación
a la cuenta de la empresa → 2295, cuotas con capital/interés/retención del 7%.

## El cruce con el extracto bancario

Es el objetivo de todo lo anterior: cada línea del extracto de McKenna debe poder
vincularse a una operación contable. Y solo cuadra si **el banco se acredita cuando
el banco se mueve de verdad**:

| Evento | ¿Se mueve el banco de McKenna? |
|---|---|
| Socio compra en Amazon con su tarjeta | **No** |
| McKenna reintegra al socio | **Sí** ← esta es la línea del extracto |
| Familiar consigna un préstamo | **Sí** (entrada) |
| McKenna paga cuota del préstamo | **Sí** (salida) |
| McKenna paga servicios a un familiar | **Sí** (salida) |

`extracto_bancario.vincular()` es agnóstica al formato de `movimiento_id`, así que
sirve tanto para asientos manuales (`cc:<id>`) como para filas de `armar_libro()`.

## Envío de la cuenta de cobro

La cuenta de cobro la emite el socio/familiar **a** McKenna (él es el acreedor), así
que el destinatario natural es **el propio emisor**: es su documento y necesita
conservarlo. `cuenta_cobro_cuota_manejo.enviar_cuenta_cobro(compra_id, tipo=...)`
resuelve el correo desde el perfil del usuario que figura como `emisor_usuario_id`
—no de una lista fija—, así que sirve igual para Armando, Cynthia, Stella, Victor o
quien se registre después. `dry_run=True` muestra el mapeo completo sin enviar;
conviene usarlo siempre antes de un lote. Endpoint:
`POST /api/rentabilidad/compras-exterior/<id>/cuenta-cobro/enviar`.

**Reexpedición del 2026-09-10:** las 19 cuentas de cobro emitidas hasta esa fecha se
regeneraron con el NIT corregido (901.316.016-3) y se reenviaron a sus emisores
—5 a Cynthia, 14 a Armando— con una nota explicando que solo cambió el NIT del
pagador. Los 21 archivos `preview_*` no se tocaron: son borradores que se regeneran
solos.

## Retención en la fuente sobre estas operaciones

`app/services/retenciones.py` centraliza tarifas, cuantías mínimas y UVT. Lo crítico
es la **cuantía mínima**: retener por debajo del tope es tan incorrecto como no
retener por encima.

| Concepto | Declarante | No declarante | Desde | Norma |
|---|---|---|---|---|
| compras | 2,5% | 3,5% | 27 UVT ($1.414.098 en 2026) | Art. 401 E.T. |
| servicios | 4% | 6% | 4 UVT ($209.496 en 2026) | Art. 392 E.T. |
| honorarios | 10% | 11% | sin mínimo | Art. 392 E.T. |
| rendimientos financieros | 7% | 7% | sin mínimo | Art. 395 E.T. |

**UVT 2026 = $52.374** (Resolución DIAN 000238 del 15-dic-2025, IPC 5,17%). Igual que
el calendario tributario, **la UVT no se extrapola**: para un año sin cargar se
devuelve `None` y el cálculo queda marcado `indeterminado`, nunca adivinado. Un test
valida que la variación año a año esté entre 0% y 15%, para cazar un dedazo al cargar.

**Resultado del cruce (2026-09-10):** de las 17 compras con cuenta de cobro, solo
**2 superan las 27 UVT** — compras 16 ($2.165.994) y 20 ($1.684.039), ambas de
Cynthia, con **$96.251** de retención que no se había practicado. Las otras 15 quedan
por debajo del mínimo y **no llevan retención**; aplicársela habría sido incorrecto.
Las cuotas de manejo ($7.590 a $186.987) también quedan casi todas bajo las 4 UVT de
servicios — pero acá se tratan como mayor valor de la compra, no como servicio
aparte, porque el socio vende la mercancía a costo + cuota en una sola operación.

Ese cruce también destapó que las compras **14, 16 y 20 tenían cuenta de cobro
emitida pero nunca habían llegado al libro**. Se postearon el 2026-09-10.

`retenciones.resumen_periodo(anio, mes)` lee **todos** los conceptos desde los
créditos a la cuenta 2365 del Libro Mayor, no desde cada módulo. Es a propósito: si
cada módulo reportara lo suyo, un concepto nuevo quedaría fuera de la declaración sin
que nadie lo note. El ticket mensual al contador incluye préstamos y el resto juntos,
que es como se declara en el formulario 350.

## Documento soporte y Alegra

`app/services/compras_socios.py` emite el documento soporte por la mercancía que el
socio le vende a McKenna, con la retención incluida cuando aplica. **Modo sombra por
defecto** (`COMPRAS_SOCIOS_DOC_SOPORTE_ACTIVO=0`): `previsualizar_lote()` muestra los
17 documentos que se emitirían ($8.126.972, con $96.251 de retención en 2 de ellos).

**Retenciones en Alegra** (`alegra.RETENCIONES_ALEGRA`, verificado contra
`GET /retentions` el 2026-09-10): se manda el **id** de Alegra, no la tarifa, para que
quede en sus reportes y el contador solo entre a pagar. Mapeo: compras 2,5% → id 3;
compras 3,5% → id 4; servicios 4% → id 9; servicios 6% → id 10; honorarios 10%/11% →
ids 5/6.

⚠️ **Falta crear en Alegra la retención de rendimientos financieros al 7%** (Art. 395
E.T.), la de los intereses de préstamos. Sin ella, ese documento soporte se emitiría
**sin** retención — el código lo avisa en el payload en vez de emitirlo mal.

**Prerequisitos antes de encender cualquiera de los dos modos sombra:**
1. Crear en Alegra los ítems `MERCANCIA-SOCIO` e `INTERES-MUTUO` (tipo servicio/bien,
   sin IVA). Hoy no existen.
2. Crear la retención del 7% de rendimientos financieros.
3. Revisar la plantilla id=16, que se llama "Documento Soporte" pero es `saleTicket`.

**Fecha del documento = fecha del asiento** (la de registro en el panel, no la de
compra). Si usaran fechas distintas, el documento soporte quedaría en un mes distinto
al del asiento y la declaración de retención no cuadraría contra el Libro Mayor.
Verificado: los documentos de 2026-08 suman $96.251, igual que la cuenta 2365 del
mismo período.

## Reintegro al socio — la línea del extracto

`compras_socios.registrar_reintegro()` gira al socio y extingue la deuda de 2380:

```
Débito   2380  Cuentas por pagar - socios   [tercero]
    Crédito  1110  Bancos
```

**Este es el único momento en que el banco de McKenna se acredita**, y por tanto la
única línea que se concilia contra el extracto. La compra no aparece en el banco
porque salió de la tarjeta del socio. El resultado trae
`movimiento_id_conciliacion` (`cc:<id>`), que es el formato que espera
`extracto_bancario.vincular()`.

El saldo se lee del **Libro Mayor** y no de las compras, para que refleje abonos
parciales y cualquier asiento manual. La retención, cuando aplicó, ya se descontó al
registrar la compra: el saldo de 2380 es el **neto a girar**.

**Girar de más exige decisión explícita** (`permitir_exceso`): dejaría 2380 en débito,
o sea que el socio le quedaría debiendo a la empresa. Puede ser legítimo como
anticipo, pero no puede pasar por un dedazo.

Panel: /app → Préstamos → «Cómo funciona» → *McKenna le debe a los socios*, con
botón «Reintegrar» por socio, abonos parciales y aviso cuando el monto excede.
Endpoints: `GET /api/socios/saldos`, `GET /api/socios/<id>/pendiente`,
`POST /api/socios/reintegro`.

## Espejo del Libro Mayor hacia Alegra

**El problema que resuelve:** el contador calcula impuestos y retenciones
**extrayendo de Alegra**. Una retención que solo vive en el Libro Mayor propio no
llega a la declaración. Verificado el 2026-09-10: $96.251 en la cuenta 2365 del
libro y **cero** en Alegra.

`app/services/alegra_espejo.py` postea cada asiento como **comprobante contable**
(`POST /journals`), que es el equivalente exacto: débito/crédito por línea, cuenta
y descripción. Formato verificado a mano contra la API (la documentación pública no
lo detalla):

```json
{"date": "2026-08-06", "type": {"id": "<tipo>"}, "observations": "...",
 "entries": [{"account": {"id": "5120"}, "debit": 0, "credit": 54150,
              "description": "..."}]}
```

### ⛔ Requiere un tipo de comprobante contable

`GET /journals/types` devuelve `[]` y `POST /journals/types` da **403**: el tipo
**solo se crea desde la interfaz** (Contabilidad → Comprobantes contables). Sin él
el módulo devuelve `bloqueado` con la instrucción — no cae a `/payments` en
silencio, porque un fallback mudo haría creer que la retención está en Alegra
cuando no lo está, que es exactamente el problema original.

### Mapeo PUC propio → Alegra

Alegra trae el PUC colombiano completo (298 cuentas cacheadas en
`app/data/alegra_plan_cuentas.json`).

| Propio | Alegra | |
|---|---|---|
| 1110 Bancos | 5297 | Banco 1 |
| 1435 Mercancías | 5047 | Inventario de mercancías |
| 2380 / 2295 por pagar | 5070 | Cuentas por pagar a proveedores nacionales |
| 2365 retención compras | 5120 | Retenciones compra 2,5% por pagar |
| 5305 gastos financieros | 5252 | Gastos por intereses financieros |
| 4135 ingresos | 5150 | Ventas |

Retenciones por tarifa: servicios 4%/6% → 5115/5116; honorarios 10%/11% →
5112/5113; rendimientos financieros 7% → 5123 (genérica, Alegra no trae una
específica).

⚠️ **No adivinar ids.** En la primera versión se pusieron a ojo y «1110 Bancos»
apuntaba a *Cuentas por cobrar empleados* y «1435 Mercancías» a *Retención servicio
6%*. Un espejo con cuentas equivocadas es peor que no tenerlo, porque parece
correcto. Verificar siempre contra el cache y ampliarlo con
`GET /categories/<id>`.

⚠️ **Alegra no tiene cuenta por pagar a SOCIOS** (solo «por cobrar a socios»), así
que 2380 y 2295 comparten 5070. El detalle por tercero se conserva en la
descripción de cada línea y en el Libro Mayor propio.

### Otros caminos, descartados

| Vía | Estado |
|---|---|
| `/bills` (documento soporte) | ❌ Rechaza los ítems, incluso `GENERICO`. **La cuenta no tiene NINGÚN bill**, así que `crear_factura_compra_alegra` (compras por Gmail) probablemente lleva tiempo fallando en silencio — 10 compras en el libro, 0 en Alegra |
| `/payments` contra cuenta contable | ✅ Funciona, admite varias cuentas en un documento. Es el patrón que Alegra documenta para préstamos. Alternativa si el tipo de comprobante se demora |
| `/journals` | ✅ Formato resuelto, bloqueado por el tipo |

`paymentMethod` en `/bills` **solo acepta `"CASH"`** — cualquier otro valor
(`transfer`, `TRANSFER`, `check`…) devuelve 11305.

## Brechas entre este esquema y el código (2026-09-10)

Verificado contra `app/data/contabilidad.db`: 936 movimientos, **todos auto-posteados**,
cero manuales. No existe ningún `compra_socio_amazon`, `pago_socio` ni
`prestamo_recibido`, y 2380/2295/1355/1290 están **en cero**.

1. **La compra del socio se contabiliza contra Bancos, no contra el socio.**
   `contabilidad_autopost.FUENTE_MAPEO["compra_exterior"] = "1436"` genera:
   `Débito 1436 / Crédito 1110`. Eso dice que McKenna pagó desde su cuenta, cuando
   quien pagó fue el socio con su tarjeta. Consecuencias:
   - No queda **quién** puso la plata (`tercero_id = None` en las 14 filas).
   - No hay pasivo con el socio: no se puede saber cuánto se le debe.
   - La fecha es la de **registro en el panel**, no la del reintegro real.
   - Si algún día se registra el reintegro, **el banco quedaría acreditado dos
     veces** por el mismo hecho económico.
2. **La cuota de manejo (5%) no entra a la contabilidad.** Se emite el PDF
   (`cuenta_cobro_cuota_manejo.py`) pero no genera ningún asiento — no aparece ni en
   `contabilidad_ledger` ni en `contabilidad_autopost`.
3. **Los dos socios están como `tipo_persona = 'juridica'`** en `cc_terceros`. Son
   personas naturales; eso afecta retención y documento soporte.
4. **Ningún familiar está registrado**, ni de servicios ni prestamista.
5. **2380 mezcla dos cosas distintas.** `resumen_prestamos()` incluye `pago_socio` en
   `_TIPOS_PRESTAMO_RECIBIDO`, así que si un socio además presta dinero, su cuenta
   por pagar por mercancía Amazon se reportaría como «préstamo». Hoy no estorba
   (ambos en cero) pero sí en cuanto se empiece a usar.

### Estado de las brechas (actualizado 2026-09-10)

| # | Brecha | Estado |
|---|---|---|
| 1 | Compra contra Bancos en vez de contra el socio | ✅ Corregido (`_lineas_compra_socio`), 14 asientos reprocesados |
| 2 | Cuota de manejo sin asiento | ✅ Entra como mayor valor de la mercancía |
| 3 | Inventario en 1436 (cacao) | ✅ Pasa a 1435 Mercancías |
| 4 | Socios como `tipo_persona='juridica'` | ✅ Corregidos a natural, con cédula y `usuario_id` |
| 5 | Retención sobre compras a socios | ✅ Calculada y contabilizada (2365) |
| 6 | Compras con cuenta de cobro sin postear | ✅ 14, 16 y 20 posteadas |
| 7 | Reintegro al socio sin registrar | ✅ `registrar_reintegro()` + panel + conciliación |
| 8 | **2380 mezcla préstamo de socio con cuenta por pagar** | ⛔ Pendiente — no estorba mientras ningún socio preste |

**Saldos tras el reproceso:** McKenna le debe $4.322.355 a Cynthia y $3.708.366 a
Armando; hay $96.251 de retención por declarar del período 2026-08.

---

## Traído de CLAUDE.md (27-sep-2026)

> Texto movido tal cual al comprimir CLAUDE.md; allí queda un resumen con enlace aquí.

### N. Socios, familiares y terceros — quién es quién

Cuatro relaciones distintas alrededor de McKenna, con tratamiento contable distinto:

| Relación | Qué hace | Cuenta |
|---|---|---|
| **Socios** (Armando, Cynthia) | Compran en Amazon con **tarjeta personal**, traen a título personal y le venden a la empresa, que reintegra | **2380** |
| **Socios** | Cuota de manejo 5% por conseguir la mercancía | 2380 contra costo |
| **Familiares por servicios** | Prestación de servicios | 5135 (retención de **servicios**, no el 7% financiero) |
| **Familiares prestamistas** | Solo consignaron dinero a la cuenta de la empresa | **2295** (Flujo M) |

El mecanismo de los socios existe porque los productos son pequeños y el volumen
residual no justifica una importación formal. **Clave para la conciliación:** el
banco de McKenna NO se mueve cuando el socio compra (esa plata sale de su tarjeta);
se mueve **al reintegrarle**. Esa es la línea que aparece en el extracto.

**Asiento (corregido sep-2026, `contabilidad_autopost._lineas_compra_socio`):**
`Débito 1435 (mercancía + flete + cuota) / Crédito 2365 (retención si aplica) /
Crédito 2380 (neto al socio)`. **No toca Bancos** — el banco se mueve al reintegrar.

⚠️ **Límite aduanero:** esa mercancía no entró por importación ordinaria, así que **no
hay IVA descontable ni aranceles deducibles** (Art. 485 E.T.) y el documento soporte
**no sanea** el estatus aduanero. Ver la ficha antes de proponer nada al respecto.

**Reintegro al socio:** `compras_socios.registrar_reintegro()` — `Débito 2380 / Crédito 1110`.
Es **la única línea de esta operación que aparece en el extracto** y la que se concilia; devuelve
`cc:<id>` para `extracto_bancario.vincular()`. Panel: Préstamos → «Cómo funciona».

**Retención:** `app/services/retenciones.py` (tarifas, cuantías mínimas, UVT por año —
UVT 2026 = $52.374, Res. DIAN 000238/2025). Compras: mínimo **10 UVT desde 2026**
(27 UVT hasta 2025; `retenciones.MINIMO_UVT_DESDE`). Explicación viva en /app → Préstamos → «Cómo funciona».
Ficha completa: `docs/agentic/modules/relaciones-socios-terceros.md`.

### Q. Socios dentro de la contabilidad + Declarador (expediente fiscal personal)

```
/app → Contabilidad → Libro Mayor  (LibroMayorPanel.tsx, reorganizado sep-2026; orden cambiado 17-sep)
  ├─ Ámbito EMPRESA — abre en el libro, no en la conciliación:
  │    1 Libro Mayor  PUC con saldos (MayorCuentasPanel: resumen por clase, árbol con terceros
  │                   desplegables, vista «Por tercero», extracto) · balance · asientos · cuentas T · informes
  │    2 Registrar    acciones rápidas (ingreso, egreso, compra/pago socio, proveedor, aporte) + asiento manual
  │    3 Conciliar banco  wizard de 4 pasos (cargar extracto → emparejar → clasificar → verificar)
  │    4 Configurar   plan de cuentas · terceros · créditos adquiridos
  │    (claves localStorage `-v2` para que nadie siga aterrizando en Conciliar)
  └─ Ámbito SOCIOS (= sección Contabilidad → Socios; SociosPanel.tsx) — wizard de 7 pasos por socio:
       1 Empecemos: cuestionario interactivo de 5 preguntas (cripto, declaró antes, desde qué año,
         otras plataformas, préstamos con familia) + cédula. No pide nada más; lo ya cargado se deduce
       2 Plan de carga: qué documentos pide ESE caso, cómo conseguirlos, cuántos tiene vs. el socio de
         referencia («así lo hizo Armando», solo conteos), carga por renglón/año, «no aplica»,
         y botón para crear la carpeta del socio en el Declarador con la estructura de Armando
       3 Extractos personales (tercero_id en extractos_bancarios; cobertura por mes con huecos)
       4 Cuenta con McKenna (CuentaSocioPanel embebido)
       5 Cruces socio ↔ empresa (banco personal vs banco/libro de McKenna, ±1 COP, ±3 días)
       6 Activos digitales — Declarador: años gravables (F210 declarado vs efecto cripto FIFO),
         documentos por categoría, pendientes con clave estable, agente con herramientas
       7 Cierre: resumen copiable para el contador

       7 Cierre: **expediente para el contador** — línea de tiempo año por año (qué se
         declaró · qué pasó · qué cuesta corregir · soportes con su ruta) y **descarga en PDF**
         (`GET /api/socios/<id>/informe.pdf`, `app/tools/declarador_pdf.py`). La carpeta del
         socio se normaliza con `organizar_carpeta()`: subcarpetas numeradas
         (`01_Declaraciones_Renta_F210/`, `05_Certificados_Tributarios_Banco/2024/`…),
         nombres legibles (`F210_2021.pdf`, `Tarjeta_8017_2025-04.xlsx`) y `LEEME.md`;
         nunca toca `Calculos/` ni `Para_Contador/`.

app/services/declarador.py     tablas dl_* en contabilidad.db; importar_carpeta() lee SOLO
                               /home/mckg/Declarador/<Nombre>/ (DECLARADOR_DIR; Calculos/ y
                               Para_Contador/ de Armando están enlazados dentro de Armando/); agente
                               Claude tool-use con llm_budget (contexto «declarador»)
app/routes_declarador.py       /api/socios/* — cada socio ve SOLO su expediente; solo la cuenta
                               `admin` real (o CHAT_API_TOKEN crudo) ve todos
```

**Por qué existe:** la conciliación de criptoactivos de Armando (Binance 2020-2025, F210 2020-2024,
exógena, extractos) se hizo en agosto de 2026 con un agente de terminal en `/home/mckg/Declarador`
y quedó en markdown y CSV. La contabilidad del socio está pegada a la de la empresa (reintegros
de compras con tarjeta personal, préstamos, cuota de manejo), así que ahora vive **dentro** del
Libro Mayor: el socio carga sus extractos aquí (más datos para cruzar) y la declaración se sigue
construyendo en el panel. **El banco personal de un socio nunca entra a la conciliación de la
empresa** (`_filtro_titular` en `extracto_bancario.py`); solo se cruza con ella en el paso 4.
Ficha: `docs/agentic/modules/contabilidad.md` → «Socios dentro de la contabilidad».
