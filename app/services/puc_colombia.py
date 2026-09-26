"""Plan Único de Cuentas colombiano (Decreto 2650 de 1993) para el libro de McKenna.

El libro nació con códigos "estilo PUC" escritos a ojo, y varios no existen en el
decreto o significan otra cosa. El contador arma las declaraciones con el PUC
real, así que un código inventado le obliga a traducir cada cifra a mano — y una
traducción a mano es donde se pierden los $164.542 que nadie vuelve a mirar.

Tres piezas:

* `PUC_MCKENNA` — las cuentas reales que McKenna usa, cada una verificada contra
  el decreto (puc.com.co / Decreto 2650). No es el PUC completo: es el subconjunto
  que este libro necesita, y crece cuando el negocio lo necesita.
* `ALIAS` — código viejo → código PUC real. Existe para que la migración no sea un
  big-bang: `contabilidad_core._cuenta_id_por_codigo()` consulta este mapa cuando
  no encuentra el código exacto, así que los ~60 call-sites que todavía dicen
  `"2380"` siguen resolviendo a la cuenta correcta (2355) mientras se limpian de a
  poco. Un alias NO es deuda escondida: es lo que permite mover los datos hoy sin
  romper préstamos, socios y pagos el mismo día.
* `migrar()` — mueve los asientos existentes de la cuenta vieja a la nueva, en una
  transacción, con `dry_run` por defecto.

**Ojo con tres códigos que parecen obvios y no lo son** (los tres estaban mal en
este libro antes de sep-2026):

* `2367` NO es "costos y gastos por pagar" — es **IVA retenido**. Los costos y
  gastos por pagar son `2335`.
* `2380` NO es la cuenta de socios — es "Acreedores varios". Las deudas con socios
  van a `2355`.
* `236515` NO es rendimientos financieros — es **honorarios**. Los rendimientos
  financieros (el 7% de los préstamos de particulares) son `236535`.
"""

from __future__ import annotations

import sqlite3
from typing import Any

# ─── El PUC que McKenna usa, verificado contra el Decreto 2650 ──────────────
# (codigo, nombre, tipo). La naturaleza se deduce del tipo, igual que en
# contabilidad_core._naturaleza_por_tipo.
PUC_MCKENNA: tuple[tuple[str, str, str], ...] = (
    # ── 1 Activo ──
    ("1105", "Caja", "activo"),
    ("110505", "Caja general", "activo"),
    ("1110", "Bancos", "activo"),
    ("111005", "Moneda nacional", "activo"),
    ("1120", "Cuentas de ahorro", "activo"),
    # MercadoPago no es un banco: es dinero de McKenna en poder de un tercero
    # hasta que se traslada. 1110 lo trataba como cuenta bancaria.
    ("1125", "Fondos", "activo"),
    # El decreto llama 112505 «Rotatorios moneda nacional» (caja menor rotativa
    # en manos de un empleado), que no es lo que pasa con MercadoPago: es plata
    # de McKenna en poder de un tercero hasta el traslado. 112515 «Especiales»
    # —fondos con destinación específica— es el encaje real. Se corrige porque
    # todo este trabajo existe para que un código signifique lo que dice el
    # decreto; dejarlo en 112505 repetiría el error de 2367 y 2380.
    ("112515", "Fondos especiales moneda nacional", "activo"),
    # Saldo de las ventas de MercadoLibre en poder de Mercado Pago (desde el
    # 1-sep-2026, decisión de Armando el 25-sep): una cuenta por cobrar a la
    # plataforma, no un fondo. Ver CUENTA_MERCADOPAGO y su guía en DESCRIPCIONES.
    ("130505", "Clientes nacionales", "activo"),
    ("1325", "Cuentas por cobrar a socios y accionistas", "activo"),
    # Plata girada de más a un proveedor (p. ej. la cotización completa sin
    # descontar la retención), que se descuenta en su próxima factura. La creaba
    # sobre la marcha `pagos_wizard._asegurar_cuenta_anticipos()`, fuera de este
    # plan, y por eso el espejo a Alegra no la emparejaba (24-sep-2026).
    ("1330", "Anticipos y avances", "activo"),
    ("133005", "Anticipos y avances a proveedores", "activo"),
    ("1370", "Préstamos a particulares", "activo"),
    ("1405", "Materias primas", "activo"),
    ("1435", "Mercancías no fabricadas por la empresa", "activo"),
    # ── 2 Pasivo ──
    ("2105", "Bancos nacionales", "pasivo"),
    ("2195", "Otras obligaciones financieras", "pasivo"),
    ("219505", "Particulares", "pasivo"),
    ("2205", "Proveedores nacionales", "pasivo"),
    ("2335", "Costos y gastos por pagar", "pasivo"),
    ("2355", "Deudas con accionistas o socios", "pasivo"),
    ("235510", "Socios", "pasivo"),
    ("2365", "Retención en la fuente", "pasivo"),
    ("236515", "Retención — honorarios", "pasivo"),
    ("236520", "Retención — comisiones", "pasivo"),
    ("236525", "Retención — servicios", "pasivo"),
    ("236530", "Retención — arrendamientos", "pasivo"),
    ("236535", "Retención — rendimientos financieros", "pasivo"),
    ("236540", "Retención — compras", "pasivo"),
    ("236595", "Retención — otras", "pasivo"),
    # ── 24 Impuestos, gravámenes y tasas: lo que McKenna debe como
    # CONTRIBUYENTE, distinto de las 23xx, que es lo que retuvo a terceros y
    # consigna a nombre de ellos. Confundirlos hace que el pago de una
    # declaración baje una deuda que no era.
    ("2404", "De renta y complementarios", "pasivo"),
    ("2408", "Impuesto sobre las ventas por pagar", "pasivo"),
    # Las dos mitades del formulario 300: lo que McKenna cobró en sus ventas y
    # lo que pagó en sus compras. Lo que se declara es la diferencia, así que
    # tenerlas separadas no es un lujo — es lo que hace que el 300 se pueda
    # armar leyendo el libro. Mismos códigos que usa Alegra en sus facturas
    # (`categoryToBePaid` / `categoryFavorable`), para que el espejo case.
    ("240805", "IVA generado", "pasivo"),
    ("240810", "IVA descontable por compras", "pasivo"),
    ("2412", "De industria y comercio", "pasivo"),
    ("2367", "Impuesto a las ventas retenido", "pasivo"),
    ("2368", "Impuesto de industria y comercio retenido", "pasivo"),
    # ── 3 Patrimonio ──
    ("3115", "Aportes sociales", "patrimonio"),
    # ── 4 Ingresos ──
    ("4135", "Comercio al por mayor y al por menor", "ingreso"),
    ("4175", "Devoluciones en ventas", "ingreso"),
    # Ingresos financieros: los intereses que paga el banco por la cuenta de
    # ahorros (hasta el 25-sep-2026 se llevaban a 4295 «Diversos»).
    ("421005", "Intereses", "ingreso"),
    ("4295", "Ingresos diversos", "ingreso"),
    # ── 5 Gastos · 51 Operacionales de administración ──
    ("5105", "Gastos de personal", "gasto"),
    ("510506", "Sueldos", "gasto"),
    ("5110", "Honorarios", "gasto"),
    ("511025", "Asesoría jurídica", "gasto"),
    ("511030", "Asesoría financiera", "gasto"),
    ("511035", "Asesoría técnica", "gasto"),
    ("511095", "Honorarios — otros", "gasto"),
    ("5115", "Impuestos", "gasto"),
    ("5120", "Arrendamientos", "gasto"),
    ("5130", "Seguros", "gasto"),
    ("5135", "Servicios", "gasto"),
    ("513505", "Aseo y vigilancia", "gasto"),
    ("513515", "Asistencia técnica", "gasto"),
    ("513520", "Procesamiento electrónico de datos", "gasto"),
    ("513525", "Acueducto y alcantarillado", "gasto"),
    ("513530", "Energía eléctrica", "gasto"),
    ("513535", "Teléfono", "gasto"),
    ("513550", "Transporte, fletes y acarreos", "gasto"),
    ("513555", "Gas", "gasto"),
    ("513595", "Servicios — otros", "gasto"),
    ("5140", "Gastos legales", "gasto"),
    ("514010", "Registro mercantil", "gasto"),
    ("5145", "Mantenimiento y reparaciones", "gasto"),
    ("514515", "Maquinaria y equipo", "gasto"),
    ("5155", "Gastos de viaje", "gasto"),
    ("5195", "Diversos", "gasto"),
    ("519510", "Libros, suscripciones, periódicos y revistas", "gasto"),
    ("519525", "Elementos de aseo y cafetería", "gasto"),
    ("519595", "Diversos — otros", "gasto"),
    # ── 5 Gastos · 52 Operacionales de ventas ──
    ("5235", "Servicios (ventas)", "gasto"),
    # El flete de la mercancía que sale hacia el cliente es gasto de VENTAS, no
    # de administración: 523550, no 513550. Lo indicó el contador el 18-sep-2026
    # para la mensajería (Fidel Rocha / Interrapidísimo). 513550 se queda para
    # el transporte administrativo.
    ("523550", "Transporte, fletes y acarreos (ventas)", "gasto"),
    ("523560", "Publicidad, propaganda y promoción", "gasto"),
    ("5295", "Diversos (ventas)", "gasto"),
    ("529505", "Comisiones", "gasto"),
    # ── 5 Gastos · 53 No operacionales ──
    ("5305", "Financieros", "gasto"),
    ("530505", "Gastos bancarios", "gasto"),
    ("530515", "Comisiones (financieras)", "gasto"),
    ("530520", "Intereses", "gasto"),
    ("530595", "Financieros — otros", "gasto"),
    # ── 6 Costos de ventas ──
    ("6135", "Comercio al por mayor y al por menor", "costo"),
    ("6205", "De mercancías", "costo"),
)

# ─── Códigos viejos → código PUC real ───────────────────────────────────────
# La clave es el código que el libro usó hasta sep-2026; el valor, el del
# decreto. `migrar()` mueve los asientos y `contabilidad_core` resuelve por acá
# los call-sites que todavía no se han limpiado.
ALIAS: dict[str, str] = {
    # Nombre correcto, código equivocado: 1355 en el PUC es "Anticipo de
    # impuestos", no cuentas por cobrar a socios.
    "1355": "1325",
    "1290": "1370",
    # 1436 no existe en el decreto; las materias primas son 1405.
    "1436": "1405",
    # Un préstamo de un particular es una obligación financiera (2195), no un
    # proveedor. 2295 no existe.
    "2295": "2195",
    # OJO: aquí NO va "2367": "2335". El libro usaba 2367 con el nombre
    # equivocado («costos y gastos por pagar»), y el alias movió esa data a
    # 2335 — ya está hecho y registrado en `cc_puc_alias_aplicados`. Dejarlo
    # puesto secuestraría el código: 2367 es «Impuesto a las ventas retenido»
    # (reteIVA) en el decreto, y McKenna lo necesita para eso. El alias se
    # retira una vez la migración corrió; los call-sites que quedaban apuntando
    # a 2367 como «costos por pagar» ya dicen 2335.
    # 2380 es "Acreedores varios"; las deudas con socios son 2355.
    "2380": "2355",
    # MercadoPago estaba colgado de Bancos con un código inventado.
    "111010": "112515",
    "112505": "112515",
    # SaaS no tiene código propio en el PUC; lo más cercano y defendible es
    # procesamiento electrónico de datos.
    "513560": "513520",
    # Los dos que estaban cruzados: la publicidad de MeLi es 523560 y las
    # comisiones de la plataforma son 529505. 5299 en el PUC es "Provisiones",
    # que no tiene nada que ver.
    "529505": "523560",
    "5299": "529505",
}

# Concepto de retención → subcuenta de 2365. El contador arma el formulario 350
# por concepto; con todo en 2365 plana tiene que desglosarlo a mano.
# ─── Qué operación vive en cada cuenta ─────────────────────────────────────
#
# La guía que el contador —o cualquiera que abra el Libro Mayor dentro de un
# año— necesita para saber qué significa un saldo sin tener que preguntarle a
# quien lo asentó. Va pegada a la cuenta, no en un documento aparte: un manual
# en otra parte es un manual que nadie abre.
#
# Es la NATURALEZA de la operación, no su tratamiento tributario — eso vive en
# `impuestos_por_cuenta.py` y el panel muestra los dos juntos. Donde una cuenta
# de McKenna se usa distinto de lo que su nombre del PUC sugiere, se dice aquí:
# es justo el punto donde alguien se equivoca.
# La cuenta donde queda la plata de una venta de MercadoLibre mientras Mercado Pago
# la retiene y hasta que se retira al banco. Es una cuenta por cobrar a Mercado Pago
# (tercero), no ingreso ni efectivo: el ingreso se causa en 4135 venta por venta y el
# retiro al banco es un traslado Debe 1110 / Haber esta cuenta. Hasta el 25-sep-2026
# se usó 112515 «Fondos especiales» (y antes 111010 colgada de Bancos); se cambió
# porque un fondo con destinación específica no describe un saldo que un tercero debe.
# Todo lo que postea ventas MeLi, retiros o la factura de MeLi usa esta constante —no
# un alias— para no arrastrar con `migrar()` lo anterior al corte, que es del contador.
CUENTA_MERCADOPAGO = "130505"

DESCRIPCIONES: dict[str, str] = {
    # ── 1 Activo ──
    "1105": "Efectivo en poder de la empresa.",
    "110505": "Caja general.",
    "1110": "Saldos en cuentas bancarias. Se mueve cuando la plata sale o entra del banco de verdad, "
             "no cuando se causa la obligación.",
    "111005": "Bancolombia y demás cuentas en pesos.",
    "1120": "Cuentas de ahorro.",
    "1125": "Fondos de inversión.",
    "130505": "Saldo por cobrar a MERCADO PAGO por las ventas de MercadoLibre (desde el 1-sep-2026). Cada venta "
              "MeLi se causa Debe 130505 / Haber 4135 Ventas: el INGRESO va en 4135; aquí solo queda dónde está la "
              "plata, que Mercado Pago retiene hasta liberarla. Se descarga con los retiros al banco («PAGO INTERBANC "
              "MERCADOPAGO SA»: Debe 1110 / Haber 130505, un traslado, no un ingreso) y con la factura mensual de MeLi "
              "que Mercado Pago cobra contra este saldo. Es cuenta por cobrar a un tercero (Mercado Pago), no efectivo "
              "ni un fondo. Decisión de Armando el 25-sep-2026: antes se usaba 112515 «Fondos especiales», que "
              "describe un fondo con destinación específica y no un saldo que un tercero le debe a McKenna.",
    "112515": "Fondos especiales en moneda nacional. Hasta el 25-sep-2026 aquí se llevaba el saldo de "
              "MercadoPago; desde el 1-sep eso vive en 130505 (cuenta por cobrar a Mercado Pago). Lo que queda "
              "aquí es anterior al corte contable (−$198M por ventas posteadas a Bancos y la factura de MeLi "
              "cobrada contra este saldo) y lo concilia el contador con el extracto de MercadoPago al 31-ago.",
    "1325": "Lo que los socios le DEBEN a McKenna. Ojo con el sentido: lo que McKenna les debe a "
            "ellos va en 2355, y confundirlas invierte el signo del patrimonio.",
    "1330": "Anticipos y avances entregados a terceros a cuenta de compras o servicios futuros.",
    "133005": "Plata a favor de McKenna con un proveedor: se le giró más de lo que se le debía (por "
              "ejemplo la cotización completa, sin descontar la retención) y se descuenta en su próxima "
              "factura. Siempre con el tercero.",
    "1370": "Préstamos que McKenna otorgó a particulares. El capital prestado, no los intereses.",
    "1405": "Materias primas en bodega.",
    "1435": "Mercancía para la venta. Entra al comprar y sale al costo cuando se vende (6135).",
    # ── 2 Pasivo ──
    "2105": "Créditos con bancos y entidades financieras.",
    "2195": "Otras obligaciones financieras.",
    "219505": "Préstamos recibidos de PARTICULARES (familiares, terceros que consignaron dinero a la "
              "empresa). No son socios: lo de los socios va en 2355.",
    "2205": "Lo que se le debe a proveedores por facturas ya recibidas y aún no pagadas.",
    "2335": "Costos y gastos ya causados que quedaron por pagar. Es donde queda el saldo cuando un "
            "servicio se causa completo y se gira solo una parte.",
    "2355": "Lo que McKenna le DEBE a los socios: reintegros de compras que hicieron con su tarjeta "
            "personal, cuota de manejo y saldos a su favor. Lo inverso de 1325.",
    "235510": "Saldos a favor de cada socio.",
    "2365": "Retención en la fuente PRACTICADA a terceros, que McKenna consigna a la DIAN a nombre "
            "de ellos. No es un impuesto propio: es plata de otro que está de paso. Se declara en "
            "el formulario 350 y por eso se lleva en subcuentas por concepto.",
    "236515": "Retención practicada por honorarios (10% / 11%).",
    "236520": "Retención practicada por comisiones (10% / 11%).",
    "236525": "Retención practicada por servicios (4% / 6%) y por transporte de carga (1%).",
    "236530": "Retención practicada por arrendamientos (3,5% inmuebles / 4% muebles).",
    "236535": "Retención practicada por rendimientos financieros (7%): los intereses de los "
              "préstamos de particulares.",
    "236540": "Retención practicada por compras de bienes (2,5% / 3,5%).",
    "236595": "Retención practicada por conceptos sin subcuenta propia.",
    "2367": "IVA retenido a terceros (reteIVA). Igual que la 2365: plata de otro que se consigna a "
            "la DIAN, no impuesto propio.",
    "2368": "ICA retenido a terceros (reteICA), que se consigna a la Secretaría de Hacienda de "
            "Bogotá. Es municipal, no va en el 350 sino en la declaración bimestral de RTICA.",
    "2404": "Impuesto de renta que McKenna debe como contribuyente (formulario 110).",
    "2408": "IVA por pagar: el generado en ventas menos el descontable en compras (formulario 300).",
    "240805": "IVA generado en las ventas. No es ingreso de McKenna: se cobra al cliente y se gira "
              "a la DIAN. Ojo: hay materias primas excluidas (Art. 424 E.T.), así que no se calcula "
              "dividiendo el total por 1,19 — sale de las facturas emitidas.",
    "240810": "IVA descontable pagado en las compras, que resta del generado.",
    "2412": "ICA propio de McKenna por su actividad comercial (declaración anual). Distinto de la "
            "2368, que es lo retenido a otros.",
    # ── 3 Patrimonio ──
    "3115": "Capital aportado por los socios.",
    # ── 4 Ingresos ──
    "4135": "Venta de mercancía por todos los canales: MercadoLibre, tienda web y venta directa. "
            "Va SIN el IVA, que se reconoce aparte en 240805.",
    "4175": "Devoluciones y anulaciones de ventas. Resta del ingreso.",
    "421005": "Intereses que paga el banco por el saldo de la cuenta de ahorros («ABONO INTERESES AHORROS»). Es "
              "ingreso financiero, no venta: no lleva IVA ni entra al 4135. Se causa solo al cargar el extracto "
              "(Debe 1110 / Haber 421005). Hasta el 25-sep-2026 iba a 4295 «Diversos».",
    "4295": "Ingresos que no vienen de vender mercancía.",
    # ── 5 Gastos de administración ──
    "5105": "Sueldos de personal con CONTRATO LABORAL. ⚠️ McKenna no tiene trabajadores formales: "
            "lo que se paga cada quincena es prestación de servicios y va en 511095. Usar esta "
            "cuenta afirma una relación laboral que no existe.",
    "510506": "Sueldos.",
    "5110": "Honorarios: contador, abogado, asesorías profesionales.",
    "511025": "Asesoría jurídica.",
    "511030": "Asesoría financiera.",
    "511035": "Asesoría técnica.",
    "511095": "⚠️ Pese al nombre, es donde van las QUINCENAS de quienes prestan servicios a McKenna "
              "sin ser nómina (Víctor, Stella, Jenniffer, y lo que cobran los socios). Llevan "
              "retención de SERVICIOS (4% / 6%), no la de honorarios; a estas personas el contador "
              "pidió no practicarles renta pero sí ICA.",
    "5115": "Impuestos que son gasto de la operación (no los que se retienen a terceros).",
    "5120": "Arriendo de oficina, bodega y equipos.",
    "5130": "Primas de seguros.",
    "5135": "Servicios prestados a McKenna por terceros. Es la cuenta genérica: si existe una "
            "subcuenta que encaje, va ahí — de esas subcuentas salen los renglones del estado de "
            "resultados.",
    "513505": "Aseo y vigilancia.",
    "513515": "Asistencia técnica.",
    "513520": "Software, SaaS y procesamiento de datos.",
    "513525": "Acueducto y alcantarillado.",
    "513530": "Energía eléctrica.",
    "513535": "Teléfono e internet.",
    "513550": "Transporte y fletes del área ADMINISTRATIVA. El flete de la mercancía que sale hacia "
              "el cliente no va aquí: va en 523550, que es gasto de ventas.",
    "513555": "Gas.",
    "513595": "Servicios que no encajan en las subcuentas anteriores.",
    "5140": "Trámites legales: cámara de comercio, notarías, registros.",
    "514010": "Renovación del registro mercantil.",
    "514095": "Otros gastos legales.",
    "5145": "Mantenimiento y reparación de equipos e instalaciones.",
    "514515": "Mantenimiento de maquinaria y equipo.",
    "5155": "Gastos de viaje y desplazamiento.",
    "5195": "⚠️ Cajón de sastre. Si una compra cae aquí suele ser que falta clasificarla: llegó a "
            "acumular $3,17M donde el 47% eran fletes y el 40% el registro mercantil. Antes de "
            "usarla, buscar la cuenta que corresponde.",
    "519510": "Libros, suscripciones y publicaciones.",
    "519525": "Elementos de aseo y cafetería.",
    "519595": "Diversos sin clasificar.",
    # ── 5 Gastos de ventas ──
    "5235": "Servicios contratados para el área comercial.",
    "523550": "Flete de la mercancía que SALE hacia el cliente: mensajería, guías, despachos. Es "
              "gasto de ventas porque es costo de entregar lo vendido. El transporte "
              "administrativo va en 513550.",
    "523560": "Publicidad y promoción. La de MercadoLibre viene en su factura mensual y se cobra "
              "contra el saldo de MercadoPago, no por el banco.",
    "5295": "Gastos diversos del área de ventas.",
    "529505": "Comisiones de venta, incluidas las que cobra MercadoLibre.",
    # ── 5 Gastos no operacionales ──
    "5305": "Gastos financieros.",
    "530505": "Cuotas de manejo, chequeras y demás cobros del banco.",
    "530515": "Comisiones financieras.",
    "530520": "Intereses pagados, incluidos los de los préstamos de particulares.",
    "530595": "GMF 4x1000. Lo cobra el banco sobre lo que sale y es gasto de McKenna: no se le "
              "descuenta a nadie. Bancolombia lo cobra en una línea diaria, no pegado a cada "
              "transferencia.",
    # ── 6 Costos ──
    "6135": "Costo de la mercancía vendida: lo que salió de 1435 al venderse.",
    "6205": "Costo de la materia prima transformada.",
}


def descripcion(codigo: str) -> str:
    """Para qué sirve esa cuenta, o cadena vacía si no está documentada.

    Si el código exacto no está, hereda de su cuenta mayor: una subcuenta nueva
    sin descripción propia dice algo útil antes que nada.
    """
    c = str(codigo or "").strip()
    if c in DESCRIPCIONES:
        return DESCRIPCIONES[c]
    for corte in (6, 4, 2):
        if len(c) > corte and c[:corte] in DESCRIPCIONES:
            return DESCRIPCIONES[c[:corte]]
    return ""


CUENTA_RETENCION: dict[str, str] = {
    "compras": "236540",
    "servicios": "236525",
    "honorarios": "236515",
    "arrendamientos": "236530",
    "rendimientos_financieros": "236535",
    "comisiones": "236520",
    # El 350 pide el transporte dentro de servicios, que es donde el contador
    # lo certificó (concepto «SERVICIOS» al 1%).
    "transporte_carga": "236525",
    "transporte_pasajeros": "236525",
    "arrendamiento_inmueble": "236530",
    "arrendamiento_mueble": "236530",
    "otros_ingresos": "236595",
}


def naturaleza(tipo: str) -> str:
    return "debito" if tipo in ("activo", "gasto", "costo") else "credito"


def resolver(codigo: str) -> str:
    """Código PUC real para un código que puede ser viejo. Idempotente."""
    c = str(codigo or "").strip()
    return ALIAS.get(c, c)


def equivalentes(*codigos: str) -> tuple[str, ...]:
    """Todos los códigos que designan la misma cuenta: el vigente y los viejos.

    Para consultas SQL que filtran por código. Una query con
    `WHERE c.codigo = '2380'` dejó de devolver nada el día de la migración —los
    datos se movieron a 2355— y el panel de saldos con socios mostró CERO donde
    había $3,7M. No falló: devolvió vacío, que es la forma más cara de fallar.

    Se incluyen los dos sentidos (el viejo por si algo quedó sin migrar, el
    nuevo porque es donde vive el dato) para que la consulta sea correcta
    durante y después de una migración.
    """
    out: list[str] = []
    for codigo in codigos:
        c = str(codigo or "").strip()
        if not c:
            continue
        for x in (c, ALIAS.get(c, c), *[v for v, d in ALIAS.items() if d == c]):
            if x not in out:
                out.append(x)
    return tuple(out)


def marcadores_sql(*codigos: str) -> tuple[str, tuple[str, ...]]:
    """`("?,?,?", ("2380", "2355"))` — para meter `equivalentes()` en un IN."""
    eq = equivalentes(*codigos)
    return ",".join("?" for _ in eq), eq


def cuenta_retencion(concepto: str) -> str:
    """Subcuenta de 2365 para ese concepto de retención; 236595 si no se conoce."""
    return CUENTA_RETENCION.get(str(concepto or "").strip(), "236595")


def sembrar(con: sqlite3.Connection) -> int:
    """Crea las cuentas del PUC que falten. Idempotente (`INSERT OR IGNORE`)."""
    n = 0
    for codigo, nombre, tipo in PUC_MCKENNA:
        cur = con.execute(
            """INSERT OR IGNORE INTO cc_plan_cuentas
                 (codigo, nombre, tipo, naturaleza, es_movimiento, activa)
               VALUES (?, ?, ?, ?, 1, 1)""",
            (codigo, nombre, tipo, naturaleza(tipo)),
        )
        n += cur.rowcount or 0
    return n


def _asegurar_registro(con: sqlite3.Connection) -> None:
    """Deja constancia de qué alias ya se aplicaron.

    Sin esto `migrar()` NO es idempotente para un código reutilizado: tras la
    primera corrida, `529505` ya no es publicidad sino Comisiones, y volver a
    aplicar el alias `529505 → 523560` se llevaría los $52M de comisiones a
    publicidad. El estado del plan de cuentas no alcanza para saberlo (la cuenta
    quedó activa y con otro nombre, indistinguible de una que nunca se migró),
    así que se registra el hecho en vez de deducirlo.
    """
    con.execute("""
        CREATE TABLE IF NOT EXISTS cc_puc_alias_aplicados (
            alias TEXT PRIMARY KEY,
            destino TEXT NOT NULL,
            lineas INTEGER NOT NULL DEFAULT 0,
            aplicado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)


def alias_aplicados() -> set[str]:
    from app.services.contabilidad_core import _conn, _ensure

    _ensure()
    with _conn() as con:
        _asegurar_registro(con)
        return {r["alias"] for r in con.execute("SELECT alias FROM cc_puc_alias_aplicados")}


def _cuenta(con: sqlite3.Connection, codigo: str) -> dict | None:
    r = con.execute("SELECT * FROM cc_plan_cuentas WHERE codigo=?", (codigo,)).fetchone()
    return dict(r) if r else None


def _orden_migracion() -> list[tuple[str, str]]:
    """Alias ordenados para que un código se vacíe ANTES de recibir lo ajeno.

    `529505` es a la vez origen (la publicidad de MeLi se va a 523560) y destino
    (las comisiones de la plataforma llegan desde 5299). Si se procesa primero
    `5299 → 529505`, las comisiones aterrizan encima de la publicidad y después
    el paso `529505 → 523560` se lleva las dos a publicidad. Procesar un código
    como origen antes que como destino evita ese pisón.
    """
    pendientes = dict(ALIAS)
    orden: list[tuple[str, str]] = []
    while pendientes:
        # Un alias se puede correr cuando su DESTINO ya no es origen de otro
        # alias pendiente: así `529505 → 523560` (vaciar publicidad) corre antes
        # que `5299 → 529505` (traer comisiones), y no al revés.
        seguros = [o for o, d in pendientes.items() if d not in pendientes]
        if not seguros:  # ciclo: no lo hay hoy, pero no se falla en silencio
            raise ValueError(f"Ciclo de alias PUC sin resolver: {sorted(pendientes)}")
        for origen in sorted(seguros):
            orden.append((origen, pendientes.pop(origen)))
    return orden


def migrar(dry_run: bool = True) -> dict[str, Any]:
    """Mueve todo lo asentado en los códigos viejos a su código PUC real.

    Toca las tres tablas que apuntan a una cuenta: las líneas de los asientos,
    los medios de pago y la cuenta por pagar por defecto de cada tercero.

    Un código que queda vacío se desactiva con una nota que dice a dónde se fue
    — no se borra, porque un código que estuvo en uso es historia del libro. La
    excepción es un código **reutilizado** (`529505` deja de ser publicidad y
    pasa a ser comisiones): ese se queda activo y se le corrige el nombre al del
    decreto, porque sigue en uso, solo que para otra cosa.

    Con `dry_run=True` (el default) no escribe nada y devuelve lo que haría.
    """
    from app.services.contabilidad_core import _conn, _ensure

    _ensure()
    nombres_puc = {c: (n, t) for c, n, t in PUC_MCKENNA}
    reutilizados = set(ALIAS) & set(ALIAS.values())
    plan: list[dict[str, Any]] = []
    creadas = 0
    with _conn() as con:
        con.execute("BEGIN")
        try:
            _asegurar_registro(con)
            creadas = sembrar(con)
            hechos = {r["alias"] for r in con.execute("SELECT alias FROM cc_puc_alias_aplicados")}
            for viejo, nuevo in _orden_migracion():
                if viejo in hechos:
                    continue   # ya se aplicó: repetirlo movería lo que no toca
                origen = _cuenta(con, viejo)
                if not origen:
                    continue
                destino = _cuenta(con, nuevo)
                if not destino:
                    raise ValueError(f"Falta la cuenta destino {nuevo} en el PUC")
                if destino["id"] == origen["id"]:
                    raise ValueError(f"Alias circular en {viejo} → {nuevo}")
                lineas = con.execute(
                    "SELECT COUNT(*) n, COALESCE(SUM(debito),0) d, COALESCE(SUM(credito),0) c"
                    "  FROM cc_movimiento_lineas WHERE cuenta_id=?",
                    (origen["id"],),
                ).fetchone()
                medios = con.execute(
                    "SELECT COUNT(*) n FROM cc_medios_pago WHERE cuenta_id=?", (origen["id"],)
                ).fetchone()["n"]
                terceros = con.execute(
                    "SELECT COUNT(*) n FROM cc_terceros WHERE cuenta_por_pagar_id=?", (origen["id"],)
                ).fetchone()["n"]
                plan.append({
                    "de": viejo, "de_nombre": origen["nombre"],
                    "a": nuevo, "a_nombre": destino["nombre"],
                    "lineas": lineas["n"], "debito": round(lineas["d"], 2),
                    "credito": round(lineas["c"], 2),
                    "medios_pago": medios, "terceros": terceros,
                    "codigo_reutilizado": viejo in reutilizados,
                })
                con.execute(
                    "UPDATE cc_movimiento_lineas SET cuenta_id=? WHERE cuenta_id=?",
                    (destino["id"], origen["id"]),
                )
                con.execute(
                    "UPDATE cc_medios_pago SET cuenta_id=? WHERE cuenta_id=?",
                    (destino["id"], origen["id"]),
                )
                con.execute(
                    "UPDATE cc_terceros SET cuenta_por_pagar_id=? WHERE cuenta_por_pagar_id=?",
                    (destino["id"], origen["id"]),
                )
                if viejo in reutilizados:
                    # Sigue en uso, con otro significado: se le pone el nombre del
                    # decreto en vez de dejarlo diciendo lo que ya no es.
                    nombre_real, tipo_real = nombres_puc.get(viejo, (origen["nombre"], origen["tipo"]))
                    con.execute(
                        """UPDATE cc_plan_cuentas
                              SET nombre=?, tipo=?, naturaleza=?, activa=1,
                                  notas = TRIM(COALESCE(notas,'') || ' · Hasta sep-2026 este código se '
                                          || 'usó para «' || ? || '», que pasó a ' || ?)
                            WHERE id=?""",
                        (nombre_real, tipo_real, naturaleza(tipo_real),
                         origen["nombre"], nuevo, origen["id"]),
                    )
                else:
                    con.execute(
                        """UPDATE cc_plan_cuentas
                              SET activa=0,
                                  notas = TRIM(COALESCE(notas,'') || ' · Migrada al PUC real: ahora es '
                                          || ? || ' ' || ?)
                            WHERE id=?""",
                        (nuevo, destino["nombre"], origen["id"]),
                    )
                con.execute(
                    "INSERT OR REPLACE INTO cc_puc_alias_aplicados (alias, destino, lineas) VALUES (?,?,?)",
                    (viejo, nuevo, lineas["n"]),
                )
            if dry_run:
                con.execute("ROLLBACK")
            else:
                con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise

    return {
        "dry_run": dry_run,
        "cuentas_creadas": creadas,
        "movimientos": plan,
        "lineas_afectadas": sum(p["lineas"] for p in plan),
    }
