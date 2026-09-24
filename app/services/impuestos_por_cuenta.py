"""Qué impuestos lleva un pago, deducidos de la cuenta del PUC a la que va.

**Por qué existe (sep-2026).** El wizard de pagos preguntaba dos veces lo mismo:
primero una «categoría» (Productos, Servicios, Transporte, Servicios públicos,
Honorarios…) y después, aparte, la cuenta contable del PUC. Son la misma
pregunta hecha con distinto vocabulario, y podían contradecirse: la categoría
«Servicios» traía retención de servicios al 4% aunque el operador llevara el
gasto a 513550 Transporte, donde la tarifa es el 1%. El botón decidía el
impuesto y la cuenta decidía el estado de resultados, cada uno por su lado.

Acá manda **la cuenta**. Es el dato que el contador mira, el que sale en el
balance y el que define de verdad la naturaleza del gasto: si el pago se carga a
513550, es transporte, se haya oprimido el botón que se haya oprimido.

**Lo que este módulo NO decide.** Solo propone. Tres cosas lo sobrescriben,
todas guardadas en la ficha del tercero, porque dependen de a QUIÉN se le paga y
no de qué se paga:

  * `regimen_simple`   — Art. 911 E.T.: no se le practica retención de ninguna
                         clase, tampoco ICA (el ICA va consolidado dentro del
                         SIMPLE, Art. 907 E.T.).
  * `retefuente_exento`— autorretenedores y los casos que el contador marcó.
                         Apaga la renta; el ICA sigue su propio camino.
  * `ica_por_mil`      — la tarifa real del municipio y la actividad.

La tarifa de ICA que se propone acá es **Bogotá** y es un punto de partida para
que la casilla no llegue vacía; la definitiva la fija el contador por actividad
(Acuerdo 65/2002 y sus modificaciones) y queda guardada en el tercero.
"""

from __future__ import annotations

# ICA Bogotá, tarifas por mil más comunes. No son todas las del acuerdo: son las
# tres que el contador ha usado en McKenna.
ICA_SERVICIOS = 9.66
ICA_COMERCIAL = 11.04
ICA_INDUSTRIAL = 4.14
# Consultoría profesional (contabilidad, jurídica, financiera, técnica). NO es
# la de «las demás actividades de servicios»: subió de 6,9 a 8,66 en 2022 y se
# quedó ahí. Verificada contra los documentos del contador — su cuenta de cobro
# de agosto-2026 liquida $5.659 sobre $653.470 y su certificado de 2024 liquida
# $50.310 sobre $5.809.492: 8,66 por mil exacto en ambos. Con 9,66 se le retiene
# de más y la 2368 queda inflada frente a lo que él declara en el RTICA.
ICA_CONSULTORIA = 8.66
# Transporte en Bogotá. Es la que el contador aplica al servicio de mensajería
# (18-sep-2026) y la que usó en el certificado a NEXT ENVIOS por 2024.
ICA_TRANSPORTE = 4.14

# cuenta PUC -> (concepto de retención o None, tarifa ICA sugerida, nota, advertencia)
#
# La nota explica en una línea POR QUÉ, porque quien aprueba el pago ve esa
# frase y es lo único que le permite darse cuenta de que la cuenta está mal
# elegida antes de firmar. `None` en el concepto no significa «no sé»: significa
# «este gasto no lleva retención de renta», y la nota dice por qué.
_PERFILES: dict[str, tuple[str | None, float, str, str]] = {
    # ── Inventario y costo ───────────────────────────────────────────────
    # Compras de bienes: SOLO retención en la fuente por compras (2,5% desde
    # 27 UVT), sin ReteICA. Hasta el 23-sep-2026 estas cuentas proponían ICA
    # comercial 11,04 por mil y el panel lo dejaba marcado al pedir una compra
    # de materia prima (Química Interkrol); así no se liquidan las compras en
    # McKenna. Si un proveedor puntual sí lleva ICA, va en su ficha de tercero.
    "1405": ("compras", 0.0, "Compra de materia prima: retención de compras 2,5%, sin ICA.", ""),
    "1435": ("compras", 0.0, "Compra de mercancía: retención de compras 2,5%, sin ICA.", ""),
    "6135": ("compras", 0.0, "Costo de mercancía: retención de compras 2,5%, sin ICA.", ""),
    "6205": ("compras", 0.0, "Costo de materia prima: retención de compras 2,5%, sin ICA.", ""),

    # ── Personal ─────────────────────────────────────────────────────────
    # Un pago laboral tiene retención por el procedimiento del Art. 383 (tabla,
    # depuración, exentos), que no es una tarifa fija y no se calcula acá.
    "5105": (None, 0.0, "Pago laboral: la retención va por la tabla del Art. 383 E.T., no por tarifa fija.",
             "McKenna no tiene trabajadores con contrato laboral. Si es una quincena de prestación "
             "de servicios, la cuenta es 511095, no 5105."),
    "510506": (None, 0.0, "Pago laboral: retención por la tabla del Art. 383 E.T.",
               "McKenna no tiene trabajadores con contrato laboral."),

    # ── Honorarios y prestación de servicios ─────────────────────────────
    "5110": ("honorarios", ICA_CONSULTORIA, "Honorarios: 10% declarante / 11% no declarante, sin cuantía mínima.", ""),
    "511025": ("honorarios", ICA_CONSULTORIA, "Asesoría jurídica: retención de honorarios.", ""),
    "511030": ("honorarios", ICA_CONSULTORIA, "Asesoría financiera: retención de honorarios.", ""),
    "511035": ("honorarios", ICA_CONSULTORIA, "Asesoría técnica: retención de honorarios.", ""),
    # 511095 es donde viven las quincenas de quienes prestan servicios a McKenna
    # (Víctor, Stella, Jenniffer, y lo que cobran Armando y Cynthia). Pese al
    # nombre de la cuenta, el concepto de retención es **servicios**, no
    # honorarios: así lo corrigió el contador en sep-2026, y aplicarles el 10%
    # de honorarios les recortaría la quincena. A estas personas además el
    # contador pidió NO practicarles renta pero SÍ ICA — eso está en su ficha
    # (`retefuente_exento` + `ica_por_mil`), que es lo que manda sobre esto.
    "511095": ("servicios", ICA_SERVICIOS,
               "Prestación de servicios: retención de SERVICIOS (4% / 6%), no la de honorarios.",
               ""),

    # ── Servicios ────────────────────────────────────────────────────────
    "5135": ("servicios", ICA_SERVICIOS, "Servicios: 4% declarante / 6% no, desde 4 UVT.", ""),
    "513505": ("servicios", ICA_SERVICIOS, "Aseo y vigilancia.", ""),
    "513515": ("servicios", ICA_SERVICIOS, "Asistencia técnica: retención de servicios.", ""),
    "513520": ("servicios", ICA_SERVICIOS, "Software y procesamiento de datos.",
               "Si el proveedor es del exterior (SaaS), la retención es distinta y puede llevar IVA "
               "asumido: consúltalo con el contador antes de aprobar."),
    "513595": ("servicios", ICA_SERVICIOS, "Otros servicios.", ""),

    # ── Servicios públicos domiciliarios ─────────────────────────────────
    # No llevan retención: las empresas de servicios públicos son
    # autorretenedoras. Antes esto era una categoría con botón propio; ahora es
    # una consecuencia de la cuenta, que es donde de verdad estaba escrito.
    "513525": (None, 0.0, "Servicio público (acueducto): las ESP son autorretenedoras, no se les retiene.", ""),
    "513530": (None, 0.0, "Servicio público (energía): las ESP son autorretenedoras, no se les retiene.", ""),
    "513535": (None, 0.0, "Teléfono e internet: el operador es autorretenedor (igual que las ESP), no se le retiene.", ""),
    "513555": (None, 0.0, "Servicio público (gas): las ESP son autorretenedoras, no se les retiene.", ""),

    # ── Transporte ───────────────────────────────────────────────────────
    # Retefuente 1% (Art. 392 E.T.) e **ICA 4,14 por mil**, que es la tarifa de
    # transporte en Bogotá. Las dos las confirmó el contador el 18-sep-2026 para
    # la mensajería, y las dos reproducen al peso el certificado que él mismo
    # expidió a NEXT ENVIOS por 2024: sobre base $17.377.500, $173.775 de renta
    # y $71.943 de ICA. No son una lectura nuestra de la norma.
    #
    # Dos cuentas, no una: el flete de la mercancía que sale hacia el cliente es
    # gasto de VENTAS (523550) y el transporte administrativo se queda en
    # 513550. Mismo tratamiento tributario, distinto renglón del resultado.
    "513550": ("transporte_carga", ICA_TRANSPORTE,
               "Transporte de carga: retefuente 1% desde 4 UVT + ReteICA 4,14 por mil (Bogotá).",
               "Las transportadoras grandes (Interrapidísimo, Servientrega, TCC) son autorretenedoras "
               "y no se les retiene; márcalo en su ficha. A un mensajero persona natural sí se le "
               "retiene. Si el flete es de la mercancía que sale al cliente, la cuenta es 523550."),
    "523550": ("transporte_carga", ICA_TRANSPORTE,
               "Flete de ventas: retefuente 1% desde 4 UVT + ReteICA 4,14 por mil (Bogotá).",
               "Las transportadoras grandes son autorretenedoras y no se les retiene; márcalo en su "
               "ficha. Si el transporte no es para despachar mercancía, la cuenta es 513550."),

    # ── Arrendamientos ───────────────────────────────────────────────────
    "5120": ("arrendamiento_inmueble", ICA_SERVICIOS,
             "Arriendo de inmueble: 3,5% desde 27 UVT.",
             "Si lo que se arrienda es un mueble (equipos, vehículos), la tarifa es 4% sin mínimo: "
             "cámbialo a mano."),

    # ── Gastos legales ───────────────────────────────────────────────────
    "5140": (None, 0.0, "Gastos legales: cámara de comercio y notarías no son sujetos de retención.", ""),
    "514010": (None, 0.0, "Registro mercantil: la cámara de comercio no es sujeto de retención.", ""),
    "514095": (None, 0.0, "Gastos legales: normalmente entidades no sujetas a retención.",
               "Si es un pago a un particular por un trámite, la retención es de servicios: cámbialo."),

    # ── Mantenimiento ────────────────────────────────────────────────────
    "5145": ("servicios", ICA_SERVICIOS, "Mantenimiento: retención de servicios.", ""),
    "514515": ("servicios", ICA_SERVICIOS, "Mantenimiento de maquinaria: retención de servicios.", ""),

    # ── Seguros, viajes, impuestos como gasto ────────────────────────────
    "5130": (None, 0.0, "Seguros: las aseguradoras son autorretenedoras.", ""),
    "5155": (None, 0.0, "Gastos de viaje: un reembolso de gastos no es ingreso del beneficiario.",
             "Si es el pago de un servicio (hotel, tiquetes a una agencia), no es gasto de viaje: "
             "llévalo a la cuenta del servicio."),
    "5115": (None, 0.0, "Impuestos como gasto: no se retiene sobre un impuesto.", ""),

    # ── Diversos ─────────────────────────────────────────────────────────
    # El cajón de sastre del auto-posteo, que ya llegó a $3,17M de cosas que no
    # eran diversas. La advertencia es parte del diseño: si hay que retener por
    # «otros ingresos» es señal de que la cuenta está mal elegida.
    "5195": ("otros_ingresos", ICA_COMERCIAL, "Gasto diverso: retención de «otros ingresos» (2,5% / 3,5%).",
             "«Diversos» casi nunca es la cuenta correcta. Si sabes qué se compró, elige esa cuenta: "
             "de ahí salen los renglones del estado de resultados."),
    "519510": (None, 0.0, "Libros y suscripciones.", ""),
    "519525": ("compras", 0.0, "Elementos de aseo y cafetería: es compra de bienes (sin ICA).", ""),
    "519595": ("otros_ingresos", ICA_COMERCIAL, "Diverso sin clasificar.",
               "Si sabes qué se compró, elige esa cuenta en vez de «diversos»."),

    # ── Ventas ───────────────────────────────────────────────────────────
    "5235": ("servicios", ICA_SERVICIOS, "Servicios del área de ventas.", ""),
    "523560": ("servicios", ICA_SERVICIOS, "Publicidad: retención de servicios.",
               "La publicidad de MercadoLibre y las plataformas se cobra contra el saldo de "
               "MercadoPago, no por el banco: no la pagues por acá."),
    "5295": ("otros_ingresos", ICA_COMERCIAL, "Diverso de ventas.", ""),
    "529505": ("comisiones", ICA_SERVICIOS, "Comisiones: 10% / 11%, sin cuantía mínima.",
               "Las comisiones de MercadoLibre vienen en su factura mensual contra MercadoPago, "
               "no por el banco."),

    # ── Financieros ──────────────────────────────────────────────────────
    "5305": (None, 0.0, "Gasto financiero: a los bancos no se les retiene.", ""),
    "530505": (None, 0.0, "Gastos bancarios: a los bancos no se les retiene.", ""),
    "530515": (None, 0.0, "Comisiones financieras: a los bancos no se les retiene.", ""),
    "530520": ("rendimientos_financieros", 0.0,
               "Intereses: 7% sin cuantía mínima (Art. 395 E.T.).",
               "Las cuotas de préstamos de terceros se pagan desde el módulo de Préstamos, que "
               "separa capital e interés. Acá solo el interés suelto."),
    "530595": (None, 0.0, "GMF 4x1000: es un impuesto, no se le retiene a nadie.", ""),
}

# Cuentas cuyo gasto se le paga SIEMPRE a una empresa autorretenedora (ESP de
# acueducto, energía y gas; operadores de telefonía e internet): no se les
# practica retención de renta NI de ICA, diga lo que diga la ficha del tercero.
# Hace falta decirlo aparte porque el ICA sale de la ficha, no de la cuenta: el
# 21-sep-2026 la ficha de ENEL quedó con 9,66 por mil y un pago de luz salió con
# $6.418 de ReteICA (y $26.576 de retefuente, por ir a 5135 y no a 513530).
CUENTAS_AUTORRETENEDORAS: frozenset[str] = frozenset({"513525", "513530", "513535", "513555"})


def es_autorretenedora(codigo: str) -> bool:
    """True si la cuenta es de servicios públicos / telecomunicaciones: sin retenciones."""
    return str(codigo or "").strip() in CUENTAS_AUTORRETENEDORAS


# Cuando la cuenta exacta no está en la tabla —porque alguien agregó una
# subcuenta nueva al plan—, se hereda del grupo. Es preferible a quedarse sin
# propuesta: una casilla vacía se aprueba igual de rápido que una llena.
_POR_PREFIJO: tuple[tuple[str, str], ...] = (
    ("14", "1435"), ("61", "6135"), ("62", "6135"), ("72", "6205"),
    ("5105", "5105"), ("5110", "5110"), ("5120", "5120"), ("5130", "5130"),
    ("51355", "513550"),
    ("5135", "5135"), ("5140", "5140"), ("5145", "5145"), ("5155", "5155"),
    ("5195", "5195"), ("5235", "5235"), ("5295", "5295"), ("5305", "5305"),
)


def perfil(codigo: str) -> dict:
    """Impuestos que propone la cuenta `codigo`.

    Devuelve siempre un dict con la misma forma, aunque la cuenta no se
    reconozca — quien llama no tiene que distinguir casos.
    """
    c = str(codigo or "").strip()
    fila = _PERFILES.get(c)
    heredado_de = ""
    if fila is None and c:
        # Prefijo más largo primero: 513550 debe ganarle a 5135.
        for pref, base in sorted(_POR_PREFIJO, key=lambda x: -len(x[0])):
            if c.startswith(pref):
                fila = _PERFILES.get(base)
                heredado_de = base
                break
    if fila is None:
        return {
            "cuenta": c,
            "concepto_retencion": None,
            "ica_por_mil": 0.0,
            "nota": "Cuenta sin perfil tributario definido: revisa con el contador qué retención lleva.",
            "advertencia": "",
            "heredado_de": "",
            "conocida": False,
        }
    concepto, ica, nota, adv = fila
    return {
        "cuenta": c,
        "concepto_retencion": concepto,
        "ica_por_mil": float(ica),
        "nota": nota,
        "advertencia": adv,
        "heredado_de": heredado_de,
        "conocida": True,
    }


def describir(codigo: str, *, anio: int, base: float = 0.0, declarante: bool = True) -> dict:
    """El perfil de la cuenta, con la tarifa y el mínimo ya resueltos.

    Es lo que el panel muestra debajo del selector de cuenta: no solo «lleva
    retención de servicios» sino «4% desde $209.496, sobre esta base son $X».
    """
    from app.services.retenciones import CONCEPTOS, calcular

    p = perfil(codigo)
    concepto = p["concepto_retencion"]
    p["tarifa_pct"] = 0.0
    p["minimo_cop"] = None
    p["retencion_estimada"] = 0.0
    p["norma"] = ""
    if not concepto:
        return p
    tarifa_dec, tarifa_no_dec, _min_uvt, norma = CONCEPTOS[concepto]
    p["tarifa_pct"] = tarifa_dec if declarante else tarifa_no_dec
    p["norma"] = norma
    calculo = calcular(concepto, max(float(base or 0), 0.0), anio=anio, declarante=declarante)
    p["minimo_cop"] = calculo.get("minimo_cop")
    p["retencion_estimada"] = float(calculo.get("retencion") or 0)
    p["motivo"] = calculo.get("motivo", "")
    return p
