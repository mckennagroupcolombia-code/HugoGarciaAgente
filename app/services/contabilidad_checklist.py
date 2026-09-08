"""Checklist guiado del hub Contabilidad.

Objetivo: un solo lugar que le diga al usuario "esto es lo que falta por
hacer hoy" en vez de obligarlo a recorrer 6+ pestañas sueltas para
descubrirlo. No inventa detección nueva — compone funciones que ya existen
en `contabilidad_core`, `extracto_bancario` y `revision_facturacion`, igual
que ya hace `contabilidad_core.resumen_informes()` para el subtab Informes
de Libro Mayor (ver docs/agentic/modules/contabilidad.md).

Cada item devuelto es `{id, titulo, detalle, cantidad, severidad, cta}` —
`cta` (call-to-action) es una clave que el frontend traduce a una acción de
navegación concreta (ver ContabilidadInicioPanel.tsx), esta capa no sabe
nada de rutas/paneles del panel React.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

# Si un extracto bancario no se ha cargado en más de esta cantidad de días
# (contra el más reciente que exista), se avisa. 40 días cubre el mes en
# curso más un margen razonable de días hábiles para subirlo.
DIAS_SIN_EXTRACTO_ALERTA = 40


def _item(
    id_: str,
    titulo: str,
    detalle: str,
    cantidad: int,
    severidad: str,
    cta: str,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": id_,
        "titulo": titulo,
        "detalle": detalle,
        "cantidad": cantidad,
        "severidad": severidad,
        "cta": cta,
        **extra,
    }


def _item_extractos_pendientes() -> dict[str, Any] | None:
    try:
        from app.services.extracto_bancario import pendientes_por_clasificar
    except Exception:
        return None
    try:
        hasta = datetime.now().date()
        desde = hasta - timedelta(days=90)
        pendientes = pendientes_por_clasificar(desde.isoformat(), hasta.isoformat(), limit=1000)
    except Exception:
        return None
    n = len(pendientes)
    if n == 0:
        return _item(
            "extractos_pendientes",
            "Movimientos del banco por clasificar",
            "Todo el banco de los últimos 90 días está contabilizado.",
            0,
            "ok",
            "libro_mayor_diario",
        )
    return _item(
        "extractos_pendientes",
        "Movimientos del banco por clasificar",
        f"{n} movimiento{'s' if n != 1 else ''} de extracto bancario sin vincular a un "
        "asiento (últimos 90 días). Clasifícalos como préstamo, ingreso, egreso o pago a "
        "proveedor.",
        n,
        "alta" if n > 0 else "ok",
        "libro_mayor_diario",
    )


def _item_extracto_reciente() -> dict[str, Any] | None:
    try:
        from app.services.extracto_bancario import listar_extractos
    except Exception:
        return None
    try:
        extractos = listar_extractos(limit=50)
    except Exception:
        return None
    if not extractos:
        return _item(
            "extracto_sin_cargar",
            "Extracto bancario del mes",
            "Aún no se ha cargado ningún extracto bancario.",
            1,
            "alta",
            "libro_mayor_diario",
        )
    fechas: list[str] = []
    for e in extractos:
        f = (e.get("periodo_hasta") or e.get("created_at") or "").strip()
        if f:
            fechas.append(f[:10])
    if not fechas:
        return None
    mas_reciente = max(fechas)
    try:
        dt_reciente = datetime.fromisoformat(mas_reciente)
    except Exception:
        return None
    dias = (datetime.now() - dt_reciente).days
    if dias <= DIAS_SIN_EXTRACTO_ALERTA:
        return _item(
            "extracto_sin_cargar",
            "Extracto bancario del mes",
            f"Último extracto cargado hace {dias} día{'s' if dias != 1 else ''}.",
            0,
            "ok",
            "libro_mayor_diario",
        )
    return _item(
        "extracto_sin_cargar",
        "Extracto bancario del mes",
        f"El extracto más reciente es de hace {dias} días — probablemente falta cargar el "
        "del mes en curso.",
        1,
        "media",
        "libro_mayor_diario",
    )


def _item_prestamos_pendientes() -> dict[str, Any] | None:
    try:
        from app.services.contabilidad_core import resumen_prestamos
    except Exception:
        return None
    try:
        r = resumen_prestamos()
    except Exception:
        return None
    n = int(r.get("recibidos", {}).get("cantidad", 0)) + int(r.get("otorgados", {}).get("cantidad", 0))
    if n == 0:
        return _item(
            "prestamos_pendientes",
            "Préstamos con saldo pendiente",
            "No hay préstamos (recibidos u otorgados) con saldo vigente.",
            0,
            "ok",
            "libro_mayor_prestamos",
        )
    return _item(
        "prestamos_pendientes",
        "Préstamos con saldo pendiente",
        f"{n} tercero{'s' if n != 1 else ''} con saldo de préstamo vigente (recibido u "
        "otorgado) — revisa si falta registrar un abono.",
        n,
        "media",
        "libro_mayor_prestamos",
    )


def _item_facturacion_pendiente() -> dict[str, Any] | None:
    try:
        from app.tools.revision_facturacion import pasos_abiertos_facturacion
    except Exception:
        return None
    try:
        pasos = pasos_abiertos_facturacion()
    except Exception:
        return None
    n = len(pasos)
    if n == 0:
        return _item(
            "facturacion_pendiente",
            "Revisión de facturación MeLi",
            "Sin pasos abiertos en el ticket de revisión de facturación.",
            0,
            "ok",
            "ticket_facturacion",
        )
    return _item(
        "facturacion_pendiente",
        "Revisión de facturación MeLi",
        f"{n} caso{'s' if n != 1 else ''} pendiente{'s' if n != 1 else ''} en el ticket de "
        "revisión de facturación (duplicados, pendientes de subir o vencidos sin facturar).",
        n,
        "alta",
        "ticket_facturacion",
    )


def resumen_checklist() -> dict[str, Any]:
    """Lista de pendientes accionables del hub Contabilidad, en un solo lugar.

    No reemplaza ningún panel existente — cada item apunta (vía `cta`) al
    lugar exacto donde ya se resuelve hoy (Libro Mayor → Diario/Préstamos,
    ticket de Facturación), reutilizando la navegación boot-tab que ya existe
    en el store (`libroMayorBootTab`, `libroMayorAbrirPendientes`).
    """
    items = [
        it
        for it in (
            _item_extractos_pendientes(),
            _item_extracto_reciente(),
            _item_prestamos_pendientes(),
            _item_facturacion_pendiente(),
        )
        if it is not None
    ]
    pendientes = [it for it in items if it["severidad"] != "ok"]
    return {
        "items": items,
        "total_pendientes": len(pendientes),
        "completo": len(pendientes) == 0,
    }
