"""Propone a qué cuenta del PUC va cada línea del extracto que nadie clasificó.

`extracto_bancario.sugerencias_auto()` resuelve el caso fácil: la línea de banco
que YA tiene su asiento en el libro y solo falta emparejarla por monto y fecha.
Este módulo resuelve el otro: las líneas que **no tienen contrapartida**, porque
la operación nunca se contabilizó. En jul-ago 2026 eran 200 de 358 — el 56% del
extracto sin registrar.

Trabaja sobre la descripción que manda el banco, que es pobre pero regular:
Bancolombia siempre antepone el concepto ("PAGO A PROVE", "COBRO IVA PAGOS",
"PAGO LLAVE <nombre>"). Eso alcanza para clasificar con certeza el grueso —
costos bancarios, GMF, intereses de ahorros, pagos a proveedores conocidos — y
para *separar* lo que ningún patrón puede decidir.

**Nada se aplica solo.** `proponer()` no escribe en la contabilidad; devuelve
propuestas con su nivel de confianza. Las de confianza `revisar` son las que un
patrón no puede resolver sin inventar: un pago por QR a "MARIA" puede ser un
flete, una compra o un servicio, y adivinarlo mete basura en el libro que después
cuesta más sacar que registrar bien desde el principio.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.services import extracto_bancario as eb

# Confianza de una propuesta:
#   "alta"    → el patrón identifica la operación sin ambigüedad; se puede aplicar en lote.
#   "revisar" → hace falta una persona. Nunca se aplica automáticamente.
ALTA = "alta"
REVISAR = "revisar"


def _norm(s: str) -> str:
    """Sin tildes, mayúsculas y con espacios colapsados: así compara el banco."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()


# ── Reglas ────────────────────────────────────────────────────────────────
# (patrón, tipo esperado o None, cuenta PUC, concepto, confianza, nota)
# El orden importa: gana la primera que casa. Las más específicas van arriba.
REGLAS: list[tuple[str, str | None, str | None, str, str, str]] = [
    # Cuentas propias. Va primero que nada: si esto se clasifica como ingreso o
    # gasto, se inflan ventas y costos por decenas de millones (jul-ago 2026:
    # $40,7M moviéndose entre Bancolombia y MercadoPago en cuatro líneas).
    (r"MERCA ?O? ?PAGO|MERCADOPAGO", None, None, "Traslado a/desde MercadoPago", REVISAR,
     "Plata propia entre cuentas, NO es ingreso ni gasto. Falta crear la cuenta "
     "de MercadoPago en el plan para poder registrarlo como traslado."),

    # Costos de tener la cuenta. Muchas líneas, montos chicos, cero ambigüedad.
    (r"^COBRO IVA PAGOS|^SERVICIO PAGO A|CUOTA MANEJO|^COMISION|^COBRO COMISION",
     "debito", "5305", "Costo bancario", ALTA, ""),
    (r"IMPTO GOBIERNO 4X1000|IVA CONVENIO 4X1000|GMF", "debito", "5305",
     "Gravamen a los movimientos financieros (4x1000)", ALTA,
     "Solo el 50% del GMF es deducible (Art. 115 E.T.) — el contador hace ese ajuste en la declaración."),
    (r"^REV IVA|^REV CUOTA|^REVERSION", None, "5305", "Reversión de un cobro bancario", ALTA, ""),

    # Rendimiento de la cuenta de ahorros: ingreso, no venta.
    (r"ABONO INTERESES AHORROS|AJUSTE INTERES AHORROS|INTERESES AHORRO", "credito",
     "4295", "Intereses de la cuenta de ahorros", ALTA, ""),

    # Pagos a proveedores: el tercero sale del nombre que trae el banco.
    (r"^PAGO A PROVE|^ABONO A PRYDE|^PAGO DE PROV", "debito", "2205",
     "Pago a proveedor", ALTA, ""),

    # Impuestos a la DIAN.
    (r"PAGO PSE DIAN|^PAGO DIAN|IMPUESTOS DIAN", "debito", "2365",
     "Pago de impuestos / retenciones a la DIAN", ALTA,
     "Confirmar contra qué período se abonó antes de descargar 2365."),

    # Llave y QR van en los DOS sentidos y significan cosas opuestas: un crédito
    # es un cliente pagando (la venta casi siempre ya está en el libro por
    # Alegra/MeLi y solo falta vincular la línea), un débito es plata que sale.
    # Tratarlos igual —como se hizo al principio— hacía aparecer 42 cobros de
    # clientes bajo la etiqueta «Pago a persona natural», o sea del lado
    # contrario del que estaban.
    (r"^PAGO LLAVE |^PAGO QR |^TRANSFERENCIA DESDE NEQUI|^PAGO NEQUI", "credito", None,
     "Cobro de cliente por QR o Llave", REVISAR,
     "Es un cliente pagando, no un egreso. La venta suele estar YA registrada "
     "(Alegra/MeLi): hay que VINCULAR la línea al asiento existente, no crear uno "
     "nuevo — si no, el ingreso se cuenta dos veces."),
    (r"^PAGO LLAVE |^PAGO QR |^PAGO NEQUI", "debito", None,
     "Pago a persona natural", REVISAR,
     "El banco solo trae el nombre de pila. Hay que decir si es servicio (5135, "
     "con retención), flete (513550), compra o reintegro a socio (2380)."),

    # Entradas de plata sin identificar: puede ser venta cobrada, préstamo de un
    # tercero o devolución. Clasificarla como venta duplicaría el ingreso, que ya
    # entra por el auto-posteo de MeLi y web.
    (r"^CONSIG|^DEPOSITO|^ABONO |^TRANSFERENCIA CTA SUC", "credito", None,
     "Entrada de dinero sin identificar", REVISAR,
     "Puede ser venta ya contabilizada, préstamo de un tercero o devolución. "
     "Clasificarla como venta duplicaría el ingreso."),

    (r"^PAGO PSE |^PSE ", "debito", None, "Pago PSE", REVISAR,
     "El beneficiario va en el resto de la descripción; hay que leerlo."),
]


def _terceros_por_nombre() -> list[tuple[str, dict]]:
    """Terceros del libro, normalizados, del nombre más largo al más corto.

    Del más largo primero para que 'FACTORES Y MERCADEO' gane contra un
    hipotético 'FACTORES': el banco trunca el nombre y el prefijo más específico
    que aún case es el correcto.
    """
    import app.services.contabilidad_core as cc

    salida = []
    for t in cc.listar_terceros():
        n = _norm(t.get("nombre"))
        if n:
            salida.append((n, t))
    salida.sort(key=lambda x: -len(x[0]))
    return salida


# Solo conectores. Los sufijos societarios (SAS, LTDA…) se dejan a propósito en
# ambos lados: el banco trunca a media palabra y corta 'SAS' en 'S', así que
# quitarlos de la razón social rompe el prefijo ('PRODUCTOS 3 A S' contra
# 'PRODUCTOS 3A SAS' deja de casar). Mientras se quiten igual en los dos lados,
# no estorban.
_RUIDO = {"Y", "DE", "DEL", "LA", "EL", "LOS", "LAS"}

_PREFIJOS_CONCEPTO = re.compile(
    r"^(PAGO A PROVE(EDOR)?S?|ABONO A PRYDE|PAGO DE PROV(EEDOR)?|PAGO A|ABONO A)\s*"
)


def _clave_comparable(texto: str) -> str:
    """Nombre reducido a letras y dígitos seguidos, sin conectores ni sufijos.

    Bancolombia corta la descripción a ~28 caracteres y además mete espacios
    donde la razón social no los tiene ('PRODUCTOS 3 A S' por 'PRODUCTOS 3A
    SAS'). Comparar palabra por palabra no funciona; colapsar todo a una sola
    cadena sí, porque lo que el banco manda queda como **prefijo** de lo que
    está en el libro.
    """
    tokens = [t for t in _norm(texto).split() if t not in _RUIDO]
    return re.sub(r"[^A-Z0-9]", "", "".join(tokens))


def _buscar_tercero(descripcion: str, terceros: list[tuple[str, dict]]) -> dict | None:
    """Empareja el nombre truncado del banco contra los terceros del libro.

    Regla: lo que manda el banco, ya sin el concepto de la operación, tiene que
    ser prefijo del nombre del tercero. 'FACTORES Y MERC' → 'FACTORESMERC', que
    es prefijo de 'FACTORESMERCADEO'. Se exigen al menos 6 caracteres para que
    un nombre corto no case con medio directorio.
    """
    sin_concepto = _PREFIJOS_CONCEPTO.sub("", _norm(descripcion))
    clave = _clave_comparable(sin_concepto)
    if len(clave) < 6:
        return None
    for _nombre, t in terceros:
        completo = _clave_comparable(t.get("nombre"))
        if completo and completo.startswith(clave):
            return t
    return None


def clasificar(linea: dict[str, Any], terceros: list[tuple[str, dict]] | None = None) -> dict[str, Any]:
    """Propone cuenta y tercero para UNA línea de banco. No escribe nada."""
    terceros = _terceros_por_nombre() if terceros is None else terceros
    desc = _norm(linea.get("descripcion"))
    tipo = (linea.get("tipo") or "").strip().lower()

    for patron, tipo_esperado, cuenta, concepto, confianza, nota in REGLAS:
        if tipo_esperado and tipo_esperado != tipo:
            continue
        if not re.search(patron, desc):
            continue
        prop = {
            "extracto_mov_id": linea.get("id"),
            "fecha": linea.get("fecha"),
            "descripcion": linea.get("descripcion"),
            "monto": float(linea.get("monto") or 0),
            "tipo": tipo,
            "cuenta": cuenta,
            "concepto": concepto,
            "confianza": confianza,
            "nota": nota,
            "tercero": None,
        }
        if cuenta == "2205":
            prop.update(_afinar_pago_a_tercero(linea, terceros))
        return prop

    return {
        "extracto_mov_id": linea.get("id"),
        "fecha": linea.get("fecha"),
        "descripcion": linea.get("descripcion"),
        "monto": float(linea.get("monto") or 0),
        "tipo": tipo,
        "cuenta": None,
        "concepto": "Sin patrón conocido",
        "confianza": REVISAR,
        "nota": "Ninguna regla reconoce esta descripción.",
        "tercero": None,
    }


# `pendientes_por_clasificar` corta en 200 por defecto. Ese límite existe para
# una bandeja que se mira, no para clasificar un período completo: con el tope
# puesto, el resumen mostraba 200 líneas por $94,6M cuando en realidad eran 354
# por $148M, y lo que quedaba afuera eran justamente los montos grandes.
_TOPE_PENDIENTES = 10_000


def proponer(desde: str, hasta: str, *, limite: int = _TOPE_PENDIENTES) -> list[dict[str, Any]]:
    """Propuesta de clasificación para todo lo que quedó sin vincular en el rango."""
    terceros = _terceros_por_nombre()
    return [clasificar(l, terceros) for l in eb.pendientes_por_clasificar(desde, hasta, limit=limite)]


def resumen(desde: str, hasta: str) -> dict[str, Any]:
    """Vista de arriba: cuánto se puede aplicar en lote y cuánto necesita a alguien."""
    props = proponer(desde, hasta)
    grupos: dict[str, dict] = {}
    for p in props:
        # La llave incluye la confianza: dentro de «Pago a proveedor» conviven
        # los que quedaron identificados (aplicables) con los que no, y
        # mezclarlos en una fila esconde exactamente lo que falta trabajar.
        k = (p["concepto"], p["confianza"])
        g = grupos.setdefault(k, {
            "concepto": p["concepto"], "cuenta": p["cuenta"], "confianza": p["confianza"],
            "lineas": 0, "monto": 0.0, "nota": p["nota"],
        })
        g["lineas"] += 1
        g["monto"] += p["monto"]
    autom = [p for p in props if p["confianza"] == ALTA]
    return {
        "total": len(props),
        "automaticas": len(autom),
        "monto_automatico": round(sum(p["monto"] for p in autom), 2),
        "para_revisar": len(props) - len(autom),
        "monto_para_revisar": round(sum(p["monto"] for p in props if p["confianza"] != ALTA), 2),
        "grupos": sorted(grupos.values(), key=lambda g: -g["monto"]),
    }


def _afinar_pago_a_tercero(linea: dict, terceros: list[tuple[str, dict]]) -> dict:
    """«PAGO A PROVE» no siempre es un proveedor.

    El banco usa esa misma etiqueta para la transferencia a una empresa con
    factura y para la quincena de una persona que presta servicios — en el
    extracto de ago-2026 aparecen así los pagos a Stella ($2.500.000) y a Víctor
    ($2.200.000), que no son compras sino servicios. Mandarlos todos a 2205
    inflaría la deuda con proveedores y dejaría sin practicar la retención de
    servicios.

    Quien decide es el tipo de tercero, no la etiqueta del banco:
    persona jurídica → proveedor (2205); persona natural → servicios (5135) o,
    si es socio, reintegro de compras (2380).
    """
    t = _buscar_tercero(linea.get("descripcion") or "", terceros)
    if not t:
        # Un pago sin saber a quién no se puede aplicar: el saldo por tercero es
        # justamente lo que se está tratando de armar.
        return {"confianza": REVISAR,
                "nota": "Tercero no identificado en el libro — hay que crearlo o elegirlo."}

    ficha = {"id": t["id"], "nombre": t["nombre"]}
    if str(t.get("tipo_persona") or "").lower() != "natural":
        return {"tercero": ficha, "confianza": ALTA}

    if str(t.get("tipo") or "").lower() == "socio" or t.get("usuario_id"):
        return {
            "tercero": ficha, "cuenta": "2380", "concepto": "Pago a socio",
            "confianza": REVISAR,
            "nota": ("Un giro a un socio mezcla reintegro de compras (2380) con "
                     "pago de servicios (5135). Hay que partirlo antes de aplicarlo."),
        }

    return {
        "tercero": ficha, "cuenta": "5135", "concepto": "Pago por prestación de servicios",
        "confianza": REVISAR,
        "nota": ("Persona natural: el banco lo rotula «proveedor» pero es prestación "
                 "de servicios. Lleva retención (4% declarante / 6% no) y necesita "
                 "cuenta de cobro."),
    }


# ── Aplicación ────────────────────────────────────────────────────────────

def aplicar(desde: str, hasta: str, *, simular: bool = True,
            created_by: int | None = None) -> dict[str, Any]:
    """Crea el asiento de cada propuesta de confianza ALTA y la vincula al banco.

    Solo toca las de confianza alta: las de `revisar` necesitan que alguien diga
    quién es el tercero o qué operación fue, y aplicarlas «por ahora» llena el
    libro de asientos que después hay que perseguir.

    Cada asiento lleva `referencia = "extracto:<id de línea>"`, que lo hace
    idempotente: correrlo dos veces no duplica. Y se vincula la línea de banco,
    así deja de aparecer en la bandeja de pendientes.

    `simular=True` por defecto — escribir en el Libro Mayor no debe ser el
    comportamiento accidental de una función que también sirve para mirar.
    """
    import sqlite3

    import app.services.contabilidad_core as cc

    props = [p for p in proponer(desde, hasta) if p["confianza"] == ALTA]
    with sqlite3.connect(cc._DB_PATH) as con:
        ids_cuenta = {r[0]: r[1] for r in con.execute("SELECT codigo, id FROM cc_plan_cuentas")}
        medio_banco = con.execute(
            "SELECT id FROM cc_medios_pago WHERE lower(nombre) LIKE '%bancolombia%' AND activo=1"
        ).fetchone()

    hechos, saltados, errores = [], [], []
    for p in props:
        ref = f"extracto:{p['extracto_mov_id']}"
        with sqlite3.connect(cc._DB_PATH) as con:
            if con.execute("SELECT 1 FROM cc_movimientos WHERE referencia=?", (ref,)).fetchone():
                saltados.append({"linea": p["extracto_mov_id"], "motivo": "ya tenía asiento"})
                continue
        cuenta_id = ids_cuenta.get(p["cuenta"])
        banco_id = ids_cuenta.get("1110")
        if not cuenta_id or not banco_id:
            errores.append({"linea": p["extracto_mov_id"], "error": f"cuenta {p['cuenta']} no existe"})
            continue

        monto = round(p["monto"], 2)
        tercero_id = (p.get("tercero") or {}).get("id")
        # Un débito del banco es plata que sale: se carga la cuenta y se acredita
        # Bancos. Un crédito es al revés.
        if p["tipo"] == "debito":
            lineas = [
                {"cuenta_id": cuenta_id, "debito": monto, "credito": 0,
                 "descripcion": p["descripcion"], "tercero_id": tercero_id},
                {"cuenta_id": banco_id, "debito": 0, "credito": monto, "descripcion": "Banco"},
            ]
        else:
            lineas = [
                {"cuenta_id": banco_id, "debito": monto, "credito": 0, "descripcion": "Banco"},
                {"cuenta_id": cuenta_id, "debito": 0, "credito": monto,
                 "descripcion": p["descripcion"], "tercero_id": tercero_id},
            ]

        if simular:
            hechos.append({"linea": p["extracto_mov_id"], "fecha": p["fecha"],
                           "cuenta": p["cuenta"], "monto": monto, "concepto": p["concepto"],
                           "tercero": (p.get("tercero") or {}).get("nombre"), "simulado": True})
            continue

        try:
            mov = cc.crear_movimiento(
                fecha=p["fecha"], concepto=f"{p['concepto']} — {p['descripcion']}",
                lineas=lineas, tercero_id=tercero_id, referencia=ref,
                tipo_origen="extracto_clasificado", created_by=created_by,
            )
            eb.vincular(p["extracto_mov_id"], f"cc:{mov['id']}",
                        notas=f"Clasificado automáticamente: {p['concepto']}")
            hechos.append({"linea": p["extracto_mov_id"], "movimiento": mov["id"],
                           "cuenta": p["cuenta"], "monto": monto, "concepto": p["concepto"]})
        except Exception as e:  # noqa: BLE001 — una línea mala no debe frenar el lote
            errores.append({"linea": p["extracto_mov_id"], "error": str(e)})

    return {
        "simulado": simular,
        "aplicadas": len(hechos), "monto": round(sum(h["monto"] for h in hechos), 2),
        "saltadas": len(saltados), "errores": len(errores),
        "detalle": hechos, "detalle_saltadas": saltados, "detalle_errores": errores,
    }
