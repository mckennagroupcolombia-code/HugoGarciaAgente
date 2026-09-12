"""
Calendario tributario colombiano — vencimientos que el agente necesita conocer.

Hoy cubre lo que usa el módulo de préstamos: la **declaración mensual de
retención en la fuente** y el plazo del **certificado anual de retenciones**.

Fuente: DUR 1625 de 2016, Arts. 1.6.1.13.2.33. y 1.2.6.6. — tabla transcrita del
calendario tributario CIJUF para el **año gravable 2026** (marzo/2026).

⚠️ REGLA DURA: este módulo **no extrapola**. El calendario lo fija un decreto
distinto cada año y los días cambian (no son "el 18 de cada mes"): para un año
que no esté cargado devuelve `None`, y quien llame debe decirle al operador que
confirme con el contador. Inventar una fecha de vencimiento tributario es peor
que no dar ninguna — alguien la seguiría a ciegas y llegaría tarde con sanción.
Para cargar un año nuevo: agregar su tabla a `_RETENCION_MENSUAL` y correr los
tests (validan que ninguna fecha caiga en fin de semana).
"""

from __future__ import annotations

import os
import re
from datetime import date, timedelta

# Año gravable -> último dígito del NIT -> día de vencimiento para el período
# enero..diciembre (12 valores). El mes de presentación es el SIGUIENTE al del
# período; el de diciembre se presenta en enero del año siguiente.
_RETENCION_MENSUAL: dict[int, dict[int, tuple[int, ...]]] = {
    2026: {
        1: (10, 10, 13, 12, 10, 9, 12, 9, 9, 11, 10, 13),
        2: (11, 11, 14, 13, 11, 10, 13, 10, 13, 12, 11, 14),
        3: (12, 12, 15, 14, 12, 13, 14, 11, 14, 13, 14, 15),
        4: (13, 13, 16, 15, 16, 14, 18, 14, 15, 17, 15, 18),
        5: (16, 16, 20, 19, 17, 15, 19, 15, 16, 18, 16, 19),
        6: (17, 17, 21, 20, 18, 16, 20, 16, 19, 19, 17, 20),
        7: (18, 18, 22, 21, 19, 17, 21, 17, 20, 20, 18, 21),
        8: (19, 19, 23, 22, 22, 21, 24, 18, 21, 23, 21, 22),
        9: (20, 20, 24, 25, 23, 22, 25, 21, 22, 24, 22, 25),
        0: (23, 24, 27, 26, 24, 23, 26, 22, 23, 25, 23, 26),
    },
}

# NIT de McKenna Group S.A.S. — verificado contra GET /company de Alegra el
# 2026-09-10: identification 901316016, dv 3. El dígito del calendario es el 6.
# ⚠️ NO confundir con el "901.952.087-1" que traen como default
# `cuenta_cobro_cuota_manejo.datos_pagador()` y `CuentaCobroAprobacion.tsx`:
# ese valor es incorrecto y está pendiente de corregir en ese módulo.
from app.services.empresa import NIT_DEFAULT as NIT_MCKENNA_DEFAULT

ANIOS_CARGADOS = tuple(sorted(_RETENCION_MENSUAL))
FUENTE_CALENDARIO = "DUR 1625 de 2016, Arts. 1.6.1.13.2.33. y 1.2.6.6."


def ultimo_digito_nit(nit: str) -> int | None:
    """Último dígito del NIT **sin** el dígito de verificación.

    Es el error clásico: el NIT de McKenna es 901.316.016-3, donde el `3` es el
    DV y el dígito que manda el calendario es el **6**. Si llega con guion o
    con el DV separado por espacio se recorta; si llegan 10 dígitos corridos se
    asume base(9)+DV y también se recorta — mismo criterio que ya usa
    `alegra._resolver_o_crear_contacto_alegra` para no duplicar el DV.
    """
    crudo = str(nit or "").strip()
    if not crudo:
        return None
    # "901.316.016-3" o "901316016 - 3" -> nos quedamos con la base
    base = re.split(r"[-–]", crudo)[0]
    digits = re.sub(r"\D", "", base)
    if not digits:
        return None
    if len(digits) == 10 and base == crudo:
        # Vino corrido y sin separador: los 10 dígitos son base(9)+DV
        digits = digits[:-1]
    return int(digits[-1])


def vencimiento_retencion(anio_periodo: int, mes_periodo: int, nit: str) -> date | None:
    """Fecha límite para declarar y pagar la retención de un mes.

    Devuelve `None` si el año no está cargado o el NIT no es legible — nunca
    una fecha adivinada.
    """
    tabla = _RETENCION_MENSUAL.get(int(anio_periodo))
    if not tabla:
        return None
    if not 1 <= int(mes_periodo) <= 12:
        raise ValueError("mes_periodo debe estar entre 1 y 12")
    digito = ultimo_digito_nit(nit)
    if digito is None or digito not in tabla:
        return None

    dia = tabla[digito][int(mes_periodo) - 1]
    # Se presenta el mes siguiente al del período; diciembre pasa a enero.
    if int(mes_periodo) == 12:
        return date(int(anio_periodo) + 1, 1, dia)
    return date(int(anio_periodo), int(mes_periodo) + 1, dia)


def fecha_limite_certificado_retenciones(anio_gravable: int) -> date:
    """Último día hábil de marzo del año siguiente.

    Certificado de retención por conceptos distintos a relación laboral — que
    es el caso de los rendimientos financieros pagados a un prestamista.
    DUR 1625 de 2016, Art. 1.6.1.13.2.40., modificado por D.R. 2229 de 2023.

    Solo descuenta sábados y domingos: los festivos colombianos no están
    cargados, así que la fecha puede quedar un poco tarde si el 31 de marzo cae
    cerca de uno. Es un límite, no un recordatorio — quien lo use debe dar
    margen.
    """
    d = date(int(anio_gravable) + 1, 3, 31)
    while d.weekday() >= 5:  # 5=sábado, 6=domingo
        d -= timedelta(days=1)
    return d


def nit_empresa() -> str:
    """NIT de McKenna para efectos del calendario. Mismo default que el
    contrato de mutuo (`prestamos_pdf.MCKENNA_NIT`)."""
    from app.services import empresa

    return empresa.nit("PRESTAMOS_MUTUARIO_NIT")


def info_vencimiento_retencion(anio_periodo: int, mes_periodo: int, nit: str | None = None) -> dict:
    """Todo lo que necesita un ticket o el panel para hablar del vencimiento.

    `estado` es 'vencido' | 'hoy' | 'proximo' | 'a_tiempo' | 'desconocido'.
    """
    # `None` = "usa el NIT de la empresa". Una cadena vacía NO es lo mismo: es un
    # NIT que el caller creyó tener y no tiene, y caer al de McKenna daría la
    # fecha de otro contribuyente sin que nadie lo note.
    nit = nit_empresa() if nit is None else str(nit)
    digito = ultimo_digito_nit(nit)
    fecha = vencimiento_retencion(anio_periodo, mes_periodo, nit)
    if not fecha:
        return {
            "conocido": False,
            "nit": nit,
            "ultimo_digito": digito,
            "estado": "desconocido",
            "motivo": (
                f"No hay calendario cargado para el año gravable {anio_periodo}. "
                f"Años disponibles: {', '.join(str(a) for a in ANIOS_CARGADOS)}. "
                "Confirmar la fecha con el contador."
            ),
            "fuente": FUENTE_CALENDARIO,
        }
    dias = (fecha - date.today()).days
    # 10 días y no 5: una declaración de retención necesita margen real para
    # revisar, preparar el formulario y tener la plata disponible. Avisar a 5
    # días es avisar tarde.
    if dias < 0:
        estado = "vencido"
    elif dias == 0:
        estado = "hoy"
    elif dias <= 10:
        estado = "proximo"
    else:
        estado = "a_tiempo"
    return {
        "conocido": True,
        "nit": nit,
        "ultimo_digito": digito,
        "fecha": fecha.isoformat(),
        "dias_restantes": dias,
        "estado": estado,
        "fuente": FUENTE_CALENDARIO,
    }
