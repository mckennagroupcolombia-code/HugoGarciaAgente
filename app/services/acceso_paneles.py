"""Quién puede abrir un panel — la regla del menú, del lado del servidor.

La fuente de verdad de la visibilidad de paneles es el frontend
(`desktop/src/lib/panelAccess.ts` y `contabilidadAccess.ts`). Aquí se replica SOLO para
los paneles a los que apunta alguna urgencia del Mapa (`mapa_app._FUENTES`): el servidor
decide qué urgencias ve cada persona, sin creerle al navegador qué paneles le tocan.

Criterio conservador: si un panel no tiene regla propia, se exige el permiso con su mismo
nombre. Lo peor que pasa es que alguien NO vea una urgencia que el menú sí le mostraría;
nunca lo contrario. `tests/test_acceso_paneles.py` exige una regla (o el permiso directo)
para cada panel al que las fuentes del mapa pueden apuntar.
"""
from __future__ import annotations

from typing import Callable

Permisos = dict

# Las mismas herencias del menú. Varias son estrictas A PROPÓSITO (pagos, conciliación,
# préstamos, socios, libro mayor): datos contables sensibles, no se heredan de facturación.
REGLAS: dict[str, Callable[[Permisos], bool]] = {
    # contabilidadAccess.ts
    "pagos": lambda p: bool(p.get("pagos") or p.get("libro-mayor")),
    "conciliacion-contador": lambda p: bool(p.get("conciliacion-contador") or p.get("libro-mayor")),
    "prestamos": lambda p: bool(p.get("prestamos") or p.get("libro-mayor")),
    "socios": lambda p: bool(p.get("socios") or p.get("libro-mayor") or p.get("prestamos")),
    "libro-mayor": lambda p: bool(p.get("libro-mayor")),
    "anulaciones": lambda p: bool(p.get("libro-mayor")),
    "facturacion": lambda p: bool(p.get("facturacion") or p.get("facturas") or p.get("sync")),
    "stock": lambda p: bool(p.get("stock") or p.get("facturacion") or p.get("facturas") or p.get("sync")
                            or p.get("rentabilidad")),
    "catalogo-alegra": lambda p: bool(p.get("catalogo-alegra") or p.get("productos-siigo") or p.get("costos-productos")
                                      or p.get("facturas") or p.get("sync") or p.get("facturacion")
                                      or p.get("rentabilidad")),
    # panelAccess.ts
    "canales-producto": lambda p: bool(p.get("canales-producto") or p.get("publicaciones") or p.get("mapa-sistema")),
    "postventa": lambda p: bool(p.get("postventa") or p.get("preventa")),
    "ventas-email": lambda p: bool(p.get("ventas-email") or p.get("preventa")),
    "vitrina-web": lambda p: bool(p.get("vitrina-web") or p.get("publicaciones")),
    "producto": lambda p: bool(p.get("producto") or p.get("combos") or p.get("mapa-sistema")),
    "guias-envio": lambda p: bool(p.get("guias-envio") or p.get("pedidos") or p.get("empaque")),
    "entregas-flex": lambda p: bool(p.get("entregas-flex") or p.get("pedidos") or p.get("empaque")
                                    or p.get("guias-envio")),
    "recepcion-mercancia": lambda p: bool(p.get("recepcion-mercancia") or p.get("pedidos") or p.get("empaque")
                                          or p.get("control-inventario") or p.get("stock")),
}


def _es_admin(usuario: dict) -> bool:
    try:
        from app.services.tickets_db import es_admin_efectivo

        return bool(es_admin_efectivo(usuario))
    except Exception:
        return int((usuario.get("rol") or {}).get("nivel") or 0) >= 3


def puede_ver_panel(usuario: dict | None, panel: str) -> bool:
    if not usuario:
        return False
    if _es_admin(usuario):
        return True
    permisos = usuario.get("permisos_secciones") or {}
    # Contador y colaborador externo viven en vistas restringidas: el mapa no es suyo.
    if permisos.get("contador") or permisos.get("colaborador_externo"):
        return False
    regla = REGLAS.get(panel)
    return regla(permisos) if regla else bool(permisos.get(panel))
