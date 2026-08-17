"""
Tickets de Control de Inventario en el Centro de Mando: solicitud de compra y
"marcar publicación para eliminar". Generaliza el mismo patrón de
app/tools/notas_credito.py::crear_ticket_nota_credito — crea (o evita
duplicar) un ticket genérico vía app.services.tickets_db.crear_ticket.

Ninguna función de este archivo modifica MeLi ni Siigo directamente: ambas
acciones dejan la ejecución real (comprar, borrar la publicación) en manos de
un colaborador humano vía el ticket.
"""

from __future__ import annotations

import sqlite3

_CATEGORIA_ID = "inventario"
_CATEGORIA_NOMBRE = "Inventario"


def _ticket_ya_existe(db_path: str, referencia: str, titulo_prefijo: str) -> bool:
    ref = (referencia or "").strip()
    if not ref:
        return False
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute(
            """
            SELECT id FROM tickets
            WHERE tipo IN ('accion','solicitud')
              AND estado IN ('pendiente','en_proceso','esperando_aprobacion')
              AND titulo LIKE ?
              AND (titulo LIKE ? OR descripcion LIKE ?)
            ORDER BY id DESC
            LIMIT 1
            """,
            (f"{titulo_prefijo}%", f"%{ref}%", f"%{ref}%"),
        ).fetchone()
        return bool(row)
    except Exception:
        return False
    finally:
        try:
            db.close()
        except Exception:
            pass


def _get_creator_user_id(db_path: str) -> int | None:
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


def _asegurar_categoria_inventario(_tdb) -> None:
    try:
        _tdb.crear_categoria(_CATEGORIA_ID, _CATEGORIA_NOMBRE, "#c2410c", "📦")
    except Exception:
        pass  # ya existe — crear_categoria devuelve (None, error) en ese caso, no lanza


def crear_ticket_solicitud_compra(
    *,
    sku: str,
    nombre: str,
    meli_id: str = "",
    cantidad_sugerida: int | float | None = None,
    proveedor: str = "",
    motivo: str = "",
    prioridad_alta: bool = False,
    asignado_a: int | None = None,
) -> tuple[bool, str]:
    """
    Crea (o evita duplicar) un ticket "Solicitar compra" en el Centro de
    Mando para un SKU de reventa (MeLi/Siigo) — no confundir con
    `ordenes_compra`, que es solo para materiales internos 5S.

    Devuelve (ok, mensaje) listo para mostrar en el panel.
    """
    from app.services import tickets_db as _tdb

    _tdb.init_db()
    _asegurar_categoria_inventario(_tdb)

    ref = (sku or meli_id or "").strip()
    if not ref:
        return False, "Falta el SKU o meli_id del producto."

    titulo = f"Solicitar compra — {nombre or ref}"
    if _ticket_ya_existe(_tdb.DB_PATH, ref, "Solicitar compra"):
        return True, f"Ya hay una solicitud de compra abierta para *{nombre or ref}* — no se duplica."

    creador_id = _get_creator_user_id(_tdb.DB_PATH)
    if not creador_id:
        return False, "No se pudo crear el ticket: no hay usuario admin/activo en el Centro de Mando."

    paso_proveedor = "Solicitar/comprar al proveedor"
    if proveedor:
        paso_proveedor += f" ({proveedor})"

    partes_desc = [f"Solicitud de compra para **{nombre or ref}** (SKU: {ref})."]
    if meli_id:
        partes_desc.append(f"Publicación MeLi: {meli_id}")
    if cantidad_sugerida:
        partes_desc.append(f"Cantidad sugerida: {cantidad_sugerida}")
    if proveedor:
        partes_desc.append(f"Proveedor sugerido: {proveedor}")
    if motivo:
        partes_desc.append(f"Motivo: {motivo}")
    partes_desc.append(
        "Creado desde Control de Inventario (/app). Al recibir la mercancía, usa "
        "el botón «+ Unidades» en Control de Inventario para actualizar el stock."
    )

    data = {
        "tipo": "accion",
        "titulo": titulo,
        "categoria": _CATEGORIA_ID,
        "descripcion": "\n\n".join(partes_desc),
        "prioridad": "alta" if prioridad_alta else "media",
        "asignado_a": asignado_a,
        "pasos": [
            paso_proveedor,
            "Recibir e ingresar stock (botón «+ Unidades» en Control de Inventario)",
        ],
    }

    ticket, err = _tdb.crear_ticket(data, creador_id, None)
    if err:
        return False, f"No se pudo crear el ticket: {err}"

    return True, f"🎫 Ticket #{ticket.get('id')} creado en el Centro de Mando: *{titulo}*."


def crear_ticket_baja_publicacion(
    *,
    sku: str,
    nombre: str,
    meli_id: str = "",
    motivo: str = "",
    asignado_a: int | None = None,
) -> tuple[bool, str]:
    """
    Crea (o evita duplicar) un ticket para que un humano revise y elimine
    manualmente una publicación descontinuada. NUNCA borra nada en MeLi
    automáticamente.
    """
    from app.services import tickets_db as _tdb

    _tdb.init_db()
    _asegurar_categoria_inventario(_tdb)

    ref = (sku or meli_id or "").strip()
    if not ref:
        return False, "Falta el SKU o meli_id del producto."

    titulo = f"Eliminar publicación descontinuada — {nombre or ref}"
    if _ticket_ya_existe(_tdb.DB_PATH, ref, "Eliminar publicación"):
        return True, f"Ya hay un ticket abierto para eliminar *{nombre or ref}* — no se duplica."

    creador_id = _get_creator_user_id(_tdb.DB_PATH)
    if not creador_id:
        return False, "No se pudo crear el ticket: no hay usuario admin/activo en el Centro de Mando."

    partes_desc = [
        f"Se marcó **{nombre or ref}** (SKU: {ref}) para eliminar del catálogo.",
    ]
    if meli_id:
        partes_desc.append(f"Publicación MeLi: {meli_id}")
    if motivo:
        partes_desc.append(f"Motivo: {motivo}")
    partes_desc.append(
        "⚠️ Esta acción NO borra la publicación automáticamente — requiere "
        "confirmación manual en Mercado Libre (y, si aplica, en Siigo/web)."
    )

    data = {
        "tipo": "accion",
        "titulo": titulo,
        "categoria": _CATEGORIA_ID,
        "descripcion": "\n\n".join(partes_desc),
        "prioridad": "media",
        "asignado_a": asignado_a,
    }

    ticket, err = _tdb.crear_ticket(data, creador_id, None)
    if err:
        return False, f"No se pudo crear el ticket: {err}"

    return True, f"🎫 Ticket #{ticket.get('id')} creado en el Centro de Mando: *{titulo}*."
