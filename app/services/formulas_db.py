"""
Fórmulas de producto (Diseño de producto → Fórmulas).

Cada fórmula es la receta de elaboración de un producto propio (una crema, un
bálsamo…): ingredientes en porcentaje —materias primas del catálogo de Alegra o
texto libre—, fase, procedimiento y notas. El panel calcula los gramos de cada
ingrediente para el tamaño de lote que se pida; aquí solo se guarda la fórmula
en porcentajes, que es lo que no cambia con el lote.

Cada fórmula puede ir asociada a su SKU de Alegra (`sku_alegra`): el combo
`C-FOR-…mL` que la representa allá. Un SKU pertenece a una sola fórmula.

Datos: app/data/formulas.json, escrito bajo candado de archivo (fcntl) como las
etiquetas del Studio, porque el panel lo abren varias personas a la vez.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import uuid
from datetime import datetime
from typing import Any

_DATA = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_ARCHIVO = os.path.join(_DATA, "formulas.json")
_CANDADO = _ARCHIVO + ".lock"


@contextlib.contextmanager
def _candado():
    os.makedirs(_DATA, exist_ok=True)
    with open(_CANDADO, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _load() -> list[dict]:
    try:
        with open(_ARCHIVO, encoding="utf-8") as fh:
            datos = json.load(fh)
    except FileNotFoundError:
        return []
    return [f for f in (datos.get("formulas") if isinstance(datos, dict) else datos) or [] if isinstance(f, dict)]


def _save(formulas: list[dict]) -> None:
    tmp = _ARCHIVO + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"formulas": formulas}, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, _ARCHIVO)


def _texto(v: Any, maximo: int = 4000) -> str:
    return str(v or "").strip()[:maximo]


def _numero(v: Any) -> float:
    try:
        n = float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0
    return n if n == n and n >= 0 else 0.0  # fuera NaN y negativos


def _ingrediente(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    nombre = _texto(raw.get("nombre"), 200)
    codigo = _texto(raw.get("codigo"), 80)
    if not nombre and not codigo:
        return None
    return {
        "codigo": codigo,
        "nombre": nombre or codigo,
        "fase": _texto(raw.get("fase"), 20),
        "porcentaje": round(_numero(raw.get("porcentaje")), 4),
        "funcion": _texto(raw.get("funcion"), 120),
    }


def _enlazar_alegra(ingredientes: list[dict]) -> list[dict]:
    """Texto libre que coincide exacto con un código o nombre de Alegra queda enlazado
    (p. ej. escribir «AGUDESmL» o «agua destilada ml» sin elegirlo de la lista)."""
    sueltos = [i for i in ingredientes if not i["codigo"] and i["nombre"]]
    if not sueltos:
        return ingredientes
    try:
        from app.services import contabilidad_db as cdb

        cdb._ensure()
        with cdb._conn() as con:
            for i in sueltos:
                fila = con.execute(
                    """SELECT reference, name FROM alegra_items
                       WHERE status = 'active' AND type != 'kit'
                         AND (reference = ? COLLATE NOCASE OR TRIM(name) = ? COLLATE NOCASE)
                       ORDER BY CASE WHEN reference = ? COLLATE NOCASE THEN 0 ELSE 1 END
                       LIMIT 1""",
                    (i["nombre"], i["nombre"], i["nombre"]),
                ).fetchone()
                if fila:
                    i["codigo"] = str(fila["reference"])
                    i["nombre"] = str(fila["name"] or fila["reference"]).strip()
    except Exception:
        pass  # sin catálogo local se guarda como texto, igual que antes
    return ingredientes


def _sku_alegra(sku: str) -> str:
    """SKU escrito → el `reference` exacto de un ítem activo de Alegra (copia local)."""
    from app.services import alegra_catalogo_db as ac

    item = ac.obtener_item(sku)
    if not item or (item.get("status") or "active") != "active":
        raise ValueError(f"`{sku}` no es un producto ni un combo activo en Alegra")
    return str(item["reference"])


def _con_nombre_alegra(formulas: list[dict]) -> list[dict]:
    """Agrega `sku_alegra_nombre` (solo para mostrar; no se guarda)."""
    try:
        from app.services import alegra_catalogo_db as ac
    except Exception:
        return formulas
    for f in formulas:
        if f.get("sku_alegra"):
            try:
                item = ac.obtener_item(f["sku_alegra"]) or {}
            except Exception:
                item = {}
            f["sku_alegra_nombre"] = str(item.get("name") or "")
    return formulas


def listar() -> list[dict]:
    return _con_nombre_alegra(sorted(_load(), key=lambda f: (f.get("nombre") or "").lower()))


def guardar(body: dict, autor: str = "") -> dict:
    nombre = _texto(body.get("nombre"), 160)
    if not nombre:
        raise ValueError("La fórmula necesita un nombre")
    ingredientes = _enlazar_alegra([i for i in map(_ingrediente, body.get("ingredientes") or []) if i])
    lote = _numero(body.get("lote_g"))
    formula_id = _texto(body.get("id"), 40)
    # Sin la clave en el cuerpo se conserva la que ya tenía; "" la quita.
    sku = _texto(body.get("sku_alegra"), 40) if "sku_alegra" in body else None
    if sku:
        sku = _sku_alegra(sku)
    with _candado():
        todas = _load()
        existente = next((f for f in todas if f.get("id") == formula_id), None) if formula_id else None
        if sku is None:
            sku = str((existente or {}).get("sku_alegra") or "")
        otra = next((f for f in todas if sku and f is not existente
                     and str(f.get("sku_alegra") or "").lower() == sku.lower()), None)
        if otra:
            raise ValueError(f"{sku} ya está asociado a la fórmula «{otra.get('nombre')}»")
        entrada = {
            "id": formula_id if existente else uuid.uuid4().hex[:12],
            "nombre": nombre,
            "categoria": _texto(body.get("categoria"), 120),
            "descripcion": _texto(body.get("descripcion"), 1000),
            "ingredientes": ingredientes,
            "sku_alegra": sku,
            "lote_g": lote,
        # La cantidad a preparar va en gramos o mililitros (el listado sale en la misma unidad).
        "unidad": "mL" if str(body.get("unidad") or "").strip().lower() == "ml" else "g",
            "procedimiento": _texto(body.get("procedimiento"), 8000),
            "notas": _texto(body.get("notas"), 4000),
            "creado": (existente or {}).get("creado") or _now(),
            "creado_por": (existente or {}).get("creado_por") or autor,
            "actualizado": _now(),
            "actualizado_por": autor,
        }
        if existente:
            todas = [entrada if f.get("id") == entrada["id"] else f for f in todas]
        else:
            todas.append(entrada)
        _save(todas)
    return _con_nombre_alegra([dict(entrada)])[0]


def eliminar(formula_id: str) -> bool:
    with _candado():
        todas = _load()
        quedan = [f for f in todas if f.get("id") != formula_id]
        if len(quedan) == len(todas):
            return False
        _save(quedan)
    return True
