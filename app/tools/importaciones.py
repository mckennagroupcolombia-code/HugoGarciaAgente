"""
Procesos de importación (DDP u ordinaria, cualquier aliado) como tickets del
Centro de Mando.

Reusa el sistema de tickets (app/services/tickets_db.py) en vez de crear una tabla
nueva: categoría "importaciones" + checklist de etapas vía `ticket_pasos` (mismo
patrón que app/tools/notas_credito.py para la categoría "contabilidad"). Las
etapas del checklist se toman del aliado elegido (app/data/aliados_logisticos.json)
cuando existen; si no, se usa un fallback genérico.
"""

from __future__ import annotations

from typing import Any

CATEGORIA_IMPORTACIONES = "importaciones"

PASOS_IMPORTACION_FALLBACK = [
    "Cotización",
    "Compra al proveedor",
    "Envío",
    "Trámite aduanero",
    "Tránsito internacional",
    "Entrega en destino",
]


def _asegurar_categoria_importaciones() -> None:
    from app.services import tickets_db as _tdb

    _tdb.init_db()
    try:
        existentes = {c["slug"] for c in _tdb.listar_categorias()}
    except Exception:
        existentes = set()
    if CATEGORIA_IMPORTACIONES not in existentes:
        _tdb.crear_categoria(CATEGORIA_IMPORTACIONES, "Importaciones", color="#b45309", icono="🚢")


def _get_creator_user_id(db_path: str) -> int | None:
    import sqlite3

    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
        if row:
            return int(row["id"])
        row = db.execute("SELECT id FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1").fetchone()
        if row:
            return int(row["id"])
    except Exception:
        return None
    finally:
        try:
            db.close()
        except Exception:
            pass
    return None


def crear_ticket_importacion(
    *,
    titulo: str,
    proveedor: str = "",
    aliado_id: str = "china-latin-agent",
    modo: str = "",
    kg: float | None = None,
    cbm: float | None = None,
    valor_fob_usd: float | None = None,
    cotizacion: dict[str, Any] | None = None,
    creador_id: int | None = None,
) -> tuple[bool, str, dict | None]:
    """
    Crea un ticket de seguimiento de importación (categoría "importaciones") con
    el checklist de etapas del aliado elegido como `ticket_pasos`. Devuelve
    (ok, mensaje, ticket).
    """
    from app.services import tickets_db as _tdb
    from app.services.aliados_logisticos import obtener_aliado

    _asegurar_categoria_importaciones()

    titulo = (titulo or "").strip()
    if not titulo:
        return False, "Falta el título del proceso de importación.", None

    if creador_id is None:
        creador_id = _get_creator_user_id(_tdb.DB_PATH)
    if not creador_id:
        return False, "No se pudo crear el ticket: no hay usuario admin/activo en el Centro de Mando.", None

    aliado = obtener_aliado(aliado_id) or {}
    aliado_nombre = aliado.get("nombre", aliado_id)
    tipo_modalidad = aliado.get("tipo_modalidad", "")
    modalidad_label = {"ddp": "DDP", "importacion_ordinaria": "Importación Ordinaria"}.get(tipo_modalidad, tipo_modalidad)
    pasos = aliado.get("etapas_proceso") or aliado.get("etapas_proceso_generico") or PASOS_IMPORTACION_FALLBACK

    detalles = []
    if proveedor:
        detalles.append(f"- Proveedor: {proveedor}")
    if modo:
        detalles.append(f"- Modo de transporte: {modo}")
    if kg is not None:
        detalles.append(f"- Peso: {kg} kg")
    if cbm is not None:
        detalles.append(f"- Volumen: {cbm} CBM")
    if valor_fob_usd is not None:
        detalles.append(f"- Valor FOB estimado: USD {valor_fob_usd}")
    if cotizacion:
        if cotizacion.get("costo_transporte_usd") is not None:
            detalles.append(f"- Costo transporte estimado: USD {cotizacion['costo_transporte_usd']}")
        dias_min, dias_max = cotizacion.get("dias_transito_min"), cotizacion.get("dias_transito_max")
        if dias_min:
            detalles.append(f"- Tránsito estimado: {dias_min}-{dias_max} días")
        for adv in cotizacion.get("advertencias") or []:
            detalles.append(f"- ⚠️ {adv}")

    descripcion = (
        f"Proceso de importación — aliado {aliado_nombre}"
        + (f" ({modalidad_label})" if modalidad_label else "")
        + ".\n\n"
        + ("\n".join(detalles) if detalles else "")
    )

    data = {
        "tipo": "accion",
        "titulo": titulo,
        "categoria": CATEGORIA_IMPORTACIONES,
        "descripcion": descripcion,
        "prioridad": "media",
        "pasos": list(pasos),
    }

    ticket, err = _tdb.crear_ticket(data, creador_id, None)
    if err:
        return False, f"No se pudo crear el ticket: {err}", None

    return True, f"🎫 Ticket #{ticket.get('id')} creado: *{titulo}*.", ticket
