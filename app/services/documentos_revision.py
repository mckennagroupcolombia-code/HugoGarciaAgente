"""Revisión guiada de formato de documentos técnicos (FT/COA/SDS).

`documentos_catalogo.listar_productos_documentacion()` ya mide *presencia*
de archivo (¿existe FT/COA/SDS?) — este módulo agrega la marca de que un
humano ya revisó/corrigió el documento contra el formato vigente (el
problema que describe el usuario: "se han hecho modificaciones al formato
con las que se está de acuerdo, pero falta que alguien revise y corrija
todos los documentos existentes contra ese formato nuevo").

Store simple, mismo patrón que `app/data/cron_frecuencias.json`
(app/services/cron_scheduler.py): un JSON plano, reescritura atómica.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.tools._json_store import atomic_write_json

_STORE_PATH = Path(__file__).resolve().parents[1] / "data" / "documentos_revision_formato.json"
_lock = threading.Lock()


def _leer() -> dict[str, Any]:
    try:
        return json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def obtener_revision(producto_ref: str) -> dict[str, Any] | None:
    return _leer().get(producto_ref)


def marcar_revisado(
    producto_ref: str,
    revisado: bool,
    *,
    revisado_por: str | None = None,
    notas: str = "",
) -> dict[str, Any]:
    ref = (producto_ref or "").strip()
    if not ref:
        raise ValueError("producto_ref es requerido")
    with _lock:
        datos = _leer()
        if revisado:
            from datetime import datetime, timezone

            datos[ref] = {
                "revisado": True,
                "revisado_por": revisado_por or "",
                "revisado_en": datetime.now(timezone.utc).isoformat(),
                "notas": (notas or "").strip(),
            }
        else:
            # "Desmarcar" no borra el histórico de notas, solo el estado.
            existente = datos.get(ref, {})
            datos[ref] = {**existente, "revisado": False, "notas": (notas or existente.get("notas") or "").strip()}
        atomic_write_json(_STORE_PATH, datos)
        return datos[ref]


def resumen_checklist(*, incluir_sheets: bool = True) -> dict[str, Any]:
    """Cola de revisión: primero los productos con documentos incompletos
    (FT/COA/SDS faltante), luego los completos que aún nadie ha marcado como
    revisados contra el formato nuevo. Reusa
    `documentos_catalogo.listar_productos_documentacion()` — no reimplementa
    la detección de completitud."""
    from app.services.documentos_catalogo import listar_productos_documentacion

    catalogo = listar_productos_documentacion(limite=1000, incluir_sheets=incluir_sheets)
    productos = catalogo.get("productos") or []
    revisiones = _leer()

    cola: list[dict[str, Any]] = []
    revisados = 0
    for p in productos:
        ref = p.get("ref") or ""
        rev = revisiones.get(ref) or {}
        ya_revisado = bool(rev.get("revisado"))
        if ya_revisado:
            revisados += 1
        item = {
            "ref": ref,
            "nombre": p.get("nombre") or "",
            "nombre_base": p.get("nombre_base") or "",
            "completo": bool(p.get("completo")),
            "faltantes": p.get("faltantes") or [],
            "revisado": ya_revisado,
            "revisado_por": rev.get("revisado_por") or "",
            "revisado_en": rev.get("revisado_en") or "",
            "notas": rev.get("notas") or "",
        }
        if not ya_revisado:
            cola.append(item)

    # Incompletos primero (más urgente resolver), luego completos sin revisar.
    cola.sort(key=lambda it: (it["completo"], it["nombre"].lower()))

    total = len(productos)
    return {
        "total": total,
        "revisados": revisados,
        "pendientes": total - revisados,
        "completo": total > 0 and revisados == total,
        "cola": cola,
    }
