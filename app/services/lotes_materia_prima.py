"""
Historial de lotes de materia prima por producto (SKU/referencia): fabricante,
país de origen, fechas y documentos (FT/COA) asociados a cada lote recibido.

Se apoya en el mismo archivo de mapeo por producto que ya usa
`app.services.documentos_catalogo` (documentos_producto.json), agregando una
lista `lotes` por referencia. No reemplaza ese registro (ft/coa/sds "vigente"
por producto): añade la dimensión temporal/por-lote que faltaba.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any

from app.services.documentos_catalogo import _guardar_mapa, _leer_mapa

ESTADOS_VALIDOS = ("nuevo", "actualizado", "sin_cambios")

# Sin 0/O/1/I ni vocales que formen palabras raras — pensado para imprimir en
# la etiqueta del producto y que el cliente lo transcriba sin ambigüedad.
_ALFABETO_CODIGO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_LARGO_CODIGO = 6


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _ref_key(ref: str) -> str:
    key = (ref or "").strip().upper()
    if not key:
        raise ValueError("Se requiere ref (SKU / referencia interna)")
    return key


def _normalizar_codigo(codigo: str) -> str:
    return re.sub(r"\s+", "", (codigo or "").strip().upper())


def lote_vigente(ref: str) -> dict[str, Any] | None:
    """Último lote marcado vigente=True para esa referencia, o None."""
    prod = _leer_mapa().get("productos", {}).get(_ref_key(ref), {})
    for lote in reversed(prod.get("lotes") or []):
        if lote.get("vigente"):
            return lote
    return None


def listar_lotes(ref: str) -> list[dict[str, Any]]:
    """Historial completo (más reciente primero) para una referencia."""
    prod = _leer_mapa().get("productos", {}).get(_ref_key(ref), {})
    return list(reversed(prod.get("lotes") or []))


def _codigo_en_uso(codigo: str, productos: dict) -> bool:
    codigo_n = _normalizar_codigo(codigo)
    for prod in productos.values():
        for lote in prod.get("lotes") or []:
            if _normalizar_codigo(lote.get("codigo_verificacion") or "") == codigo_n:
                return True
    return False


def _generar_codigo_verificacion(productos: dict) -> str:
    """Código corto listo para imprimir en la etiqueta (ver Studio Etiquetas)."""
    for _ in range(50):
        candidato = "".join(secrets.choice(_ALFABETO_CODIGO) for _ in range(_LARGO_CODIGO))
        if not _codigo_en_uso(candidato, productos):
            return candidato
    raise RuntimeError("No se pudo generar un código de verificación único")


def _inferir_estado(anterior: dict[str, Any] | None, lote_numero: str, fabricante: str) -> str:
    if not anterior:
        return "nuevo"
    if (anterior.get("lote_numero") or "").strip().lower() == (lote_numero or "").strip().lower():
        return "sin_cambios"
    if (anterior.get("fabricante") or "").strip().lower() == (fabricante or "").strip().lower():
        return "actualizado"
    return "nuevo"


def registrar_lote(
    ref: str,
    *,
    lote_numero: str,
    fabricante: str = "",
    pais_origen: str = "",
    fecha_fabricacion: str = "",
    fecha_vencimiento: str = "",
    fecha_recepcion: str = "",
    estado: str | None = None,
    ft_link: str = "",
    coa_link: str = "",
    codigo_verificacion: str = "",
    nombre_producto: str | None = None,
) -> dict[str, Any]:
    """
    Registra un lote nuevo en el historial de la referencia. Si `estado` no se
    indica explícitamente, se infiere comparando contra el último lote vigente
    (mismo número de lote → "sin_cambios"; mismo fabricante pero lote distinto
    → "actualizado"; fabricante distinto (o sin historial previo) → "nuevo").
    Marca el lote anterior como no vigente.

    Si no se indica `codigo_verificacion`, se genera uno corto y único: es el
    único dato que el cliente necesita — pensado para imprimirse en la
    etiqueta del producto (Studio Etiquetas) y consultarse en /verificar.
    """
    ref_key = _ref_key(ref)
    lote_numero = (lote_numero or "").strip()
    if not lote_numero:
        raise ValueError("Se requiere lote_numero")

    data = _leer_mapa()
    productos = data.setdefault("productos", {})
    prod = productos.setdefault(ref_key, {"ref": ref_key})
    if nombre_producto:
        prod["nombre"] = nombre_producto

    lotes = prod.setdefault("lotes", [])
    anterior = lotes[-1] if lotes else None
    if estado not in ESTADOS_VALIDOS:
        estado = _inferir_estado(anterior, lote_numero, fabricante)

    for l in lotes:
        l["vigente"] = False

    codigo_verificacion = (codigo_verificacion or "").strip()
    if not codigo_verificacion:
        codigo_verificacion = _generar_codigo_verificacion(productos)

    entry = {
        "lote_numero": lote_numero,
        "estado": estado,
        "fabricante": (fabricante or "").strip(),
        "pais_origen": (pais_origen or "").strip(),
        "fecha_fabricacion": (fecha_fabricacion or "").strip(),
        "fecha_vencimiento": (fecha_vencimiento or "").strip(),
        "fecha_recepcion": (fecha_recepcion or "").strip() or _ahora_iso()[:10],
        "codigo_verificacion": codigo_verificacion,
        "ft_webViewLink": (ft_link or "").strip(),
        "coa_webViewLink": (coa_link or "").strip(),
        "vigente": True,
        "registrado_en": _ahora_iso(),
    }
    lotes.append(entry)
    prod["updated_at"] = _ahora_iso()
    _guardar_mapa(data)
    return entry


def buscar_lote_publico(codigo_verificacion: str) -> dict[str, Any] | None:
    """
    Búsqueda para la página pública de verificación: un único código, el mismo
    que se imprime en la etiqueta del producto. Retorna {ref, nombre, lote} o None.
    """
    codigo_n = _normalizar_codigo(codigo_verificacion)
    if not codigo_n:
        return None
    productos = _leer_mapa().get("productos", {})
    for ref_key, prod in productos.items():
        for lote in prod.get("lotes") or []:
            if _normalizar_codigo(lote.get("codigo_verificacion") or "") == codigo_n:
                return {"ref": ref_key, "nombre": prod.get("nombre") or "", "lote": lote}
    return None
