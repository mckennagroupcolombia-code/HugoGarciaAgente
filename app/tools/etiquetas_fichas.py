"""
Fichas de etiqueta guardadas — persistencia del formulario "Ficha de
etiqueta" (Studio Visual → Formularios etiquetados,
desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx).

Antes los datos del formulario (ProductLabelData) solo vivían en un
useState de React: se perdían al recargar la página o cambiar de panel, y
lo único que quedaba era el PNG final exportado. Este módulo permite
guardar cada ficha con un nombre elegido a mano por el operador (no
derivado del nombre del producto) y reabrirla después.
"""
from __future__ import annotations

import contextlib
import copy
import fcntl
import json
import os
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_DATA_PATH = _REPO / "app" / "data" / "etiquetas_fichas.json"
# Cambia todos los días y puede llevar logos como data URL — mismo patrón
# que plantillas_visuales.json: vive en app/data por convención de rutas
# pero fuera de git (ver .gitignore).
_MAX_FICHAS = 500

# Cache en memoria invalidada por mtime — mismo patrón que
# app/tools/plantillas_visuales.py (evita releer/parseo en cada request de
# listado). `_load_all` devuelve copia profunda para que nadie mute el cache.
_cache: dict[str, Any] = {"mtime": None, "items": None}
_LOCK = threading.RLock()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class AlmacenFichasIlegible(RuntimeError):
    """El JSON existe pero no se pudo leer. NUNCA se trata como «vacío»."""


def _leer_disco() -> list[dict]:
    with open(_DATA_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    items = raw.get("fichas") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        raise ValueError("estructura inesperada")
    return items


def _load_all() -> list[dict]:
    """Lee el almacén.

    Incidente 2026-09-19: un error de lectura se tomaba como lista vacía y la
    escritura no era atómica. Con dos guardados a la vez (lote de etiquetas +
    autoguardado del formulario) sobre un archivo de 6 MB, una lectura a mitad de
    escritura devolvió [] y el guardado siguiente dejó 3 fichas de 190: se
    perdieron todas las plantillas. Ahora: reintenta, y si sigue ilegible LANZA
    (así nadie guarda encima), y `_save_all` escribe a un temporal + os.replace
    bajo candado.
    """
    try:
        mtime = _DATA_PATH.stat().st_mtime
    except OSError:
        _cache["mtime"] = None
        _cache["items"] = []
        return []
    if _cache["items"] is None or _cache["mtime"] != mtime:
        ultimo: Exception | None = None
        for _ in range(5):
            try:
                _cache["items"] = _leer_disco()
                _cache["mtime"] = mtime
                break
            except Exception as exc:  # escritura en curso de otro proceso
                ultimo = exc
                time.sleep(0.15)
        else:
            raise AlmacenFichasIlegible(f"{_DATA_PATH.name} ilegible: {ultimo!r}")
    return copy.deepcopy(_cache["items"])


def _save_all(items: list[dict]) -> None:
    _DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    trimmed = items[:_MAX_FICHAS]
    # Copia de la versión anterior: si algo sale mal, hay de dónde volver.
    if _DATA_PATH.is_file():
        try:
            shutil.copy2(_DATA_PATH, _DATA_PATH.with_suffix(".json.bak"))
        except OSError:
            pass
    tmp = _DATA_PATH.with_suffix(f".json.tmp{os.getpid()}")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"fichas": trimmed}, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, _DATA_PATH)  # atómico: nadie ve un archivo a medias
    try:
        _cache["mtime"] = _DATA_PATH.stat().st_mtime
    except OSError:
        _cache["mtime"] = None
    _cache["items"] = copy.deepcopy(trimmed)


@contextlib.contextmanager
def _candado():
    """Un solo lector-modificador-escritor a la vez, entre hilos Y procesos."""
    with _LOCK:
        _DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_DATA_PATH.with_suffix(".lock"), "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)


def listar_fichas(q: str = "") -> list[dict]:
    items = _load_all()
    q = (q or "").strip().lower()
    if q:
        items = [f for f in items if q in (f.get("nombre") or "").lower()]
    items.sort(key=lambda f: f.get("actualizado") or "", reverse=True)
    return items


def obtener_ficha(ficha_id: str) -> dict | None:
    ficha_id = (ficha_id or "").strip()
    if not ficha_id:
        return None
    for f in _load_all():
        if f.get("id") == ficha_id:
            return f
    return None


def guardar_ficha(body: dict) -> dict:
    """Crea o actualiza (si trae 'id' existente) una ficha guardada.

    'nombre' es obligatorio y siempre lo escribe el operador a mano — nunca
    se deriva de data.productName ni de ningún otro campo del formulario.
    """
    if not isinstance(body, dict):
        raise ValueError("Cuerpo inválido")
    ficha_id = (body.get("id") or "").strip() or uuid.uuid4().hex[:12]
    nombre = (body.get("nombre") or "").strip()
    if not nombre:
        raise ValueError("Falta el nombre de la ficha")
    data = body.get("data")
    if not isinstance(data, dict):
        raise ValueError("Falta 'data' de la ficha")

    with _candado():
        return _guardar_ficha_bajo_candado(body, ficha_id, nombre, data)


def _con_recipiente(ficha_id: str, data: dict) -> dict:
    """La CONSERVACIÓN dice «envase» o «empaque» según la receta del combo de la etiqueta
    (frasco → envase, bolsa → empaque; ver `mapa_producto.recipientes`). Si no se puede saber,
    o falla la lectura del catálogo, el texto queda como vino: guardar nunca se bloquea."""
    try:
        from app.services import mapa_producto as M

        r = M.recipiente_etiqueta(ficha_id, str(data.get("barcode") or ""))
        if not r:
            return data
        out = dict(data)
        for k in ("storage", "storageSugerido"):
            if isinstance(out.get(k), str):
                out[k] = M.palabra_recipiente(out[k], r)
        return out
    except Exception:
        return data


def _guardar_ficha_bajo_candado(body: dict, ficha_id: str, nombre: str, data: dict) -> dict:
    todos = _load_all()
    existente = next((f for f in todos if f.get("id") == ficha_id), None)
    # Una plantilla de categoría no es de ningún combo (su código de barras es de muestra).
    if not (body.get("es_plantilla_categoria") or (existente or {}).get("es_plantilla_categoria")):
        data = _con_recipiente(ficha_id, data)
    now = _now()

    entry: dict[str, Any] = {
        "id": ficha_id,
        "nombre": nombre,
        # Copia fiel sin alterar tipos/orden de las claves del formulario.
        "data": json.loads(json.dumps(data, ensure_ascii=False)),
        "creado": (existente or {}).get("creado") or now,
        "actualizado": now,
    }
    tipo_nombre = (body.get("tipo_nombre") or "").strip()
    if tipo_nombre:
        entry["tipo_nombre"] = tipo_nombre
    # Categoría de producto (aceites, frutos secos, conservantes…): decide de
    # qué plantilla parte una ficha nueva. La lista vive en el panel
    # (desktop/src/lib/categoriasEtiqueta.ts); aquí solo se persiste el id.
    categoria = (body.get("categoria") or "").strip()
    if categoria:
        entry["categoria"] = categoria
    # Marca de "esta etiqueta ES la plantilla de su categoría": el formato ya
    # ajustado que se despliega sobre todos los productos de la familia. Se
    # guarda aquí (no en plantillas_visuales) porque es del motor de formulario.
    if body.get("es_plantilla_categoria"):
        entry["es_plantilla_categoria"] = True
    # De qué plantilla salió esta etiqueta. Distingue lo hecho con el flujo nuevo
    # de las fichas sueltas del catálogo viejo, que no tienen plantilla detrás.
    plantilla_id = (body.get("plantilla_id") or "").strip()
    if plantilla_id:
        entry["plantilla_id"] = plantilla_id
    attribute_icons = body.get("attribute_icons")
    if isinstance(attribute_icons, dict) and attribute_icons:
        entry["attribute_icons"] = json.loads(json.dumps(attribute_icons, ensure_ascii=False))
    text_styles = body.get("text_styles")
    if isinstance(text_styles, dict) and text_styles:
        entry["text_styles"] = json.loads(json.dumps(text_styles, ensure_ascii=False))

    items = [f for f in todos if f.get("id") != ficha_id]
    items.insert(0, entry)
    _save_all(items)
    return entry


# Lo que se puede corregir de una etiqueta SIN abrir el Studio (taller de combos de /app):
# textos del formulario, no diseño. Imágenes embebidas, colores y estilos quedan fuera.
CAMPOS_EDITABLES = (
    "productName", "netContent", "barcode", "barcodeTitle", "classification", "gradoInsumo", "grade",
    "composition", "concentration", "appearance", "odor", "origin", "storage", "alergenos", "aplicaciones",
    "descripcionProducto", "cas", "registro", "technicalDocuments", "fichaTecnicaId", "fichaTecnicaTitulo",
)
_PESADOS = ("logoUrl", "ghsIconSvg")


def ficha_ligera(ficha_id: str) -> dict | None:
    """La ficha sin sus imágenes embebidas (el logo son ~184 KB de data-URI por etiqueta)."""
    f = obtener_ficha(ficha_id)
    if not f:
        return None
    f = dict(f)
    f["data"] = {k: v for k, v in (f.get("data") or {}).items() if k not in _PESADOS}
    return f


def opciones_etiqueta() -> dict:
    """Tamaños en uso y plantillas de categoría, para elegir sin teclear."""
    todas = _load_all()
    return {
        "tamanos": sorted({(f.get("tipo_nombre") or "").strip() for f in todas} - {""}),
        "plantillas": sorted(
            ({"id": f["id"], "nombre": f.get("nombre") or "", "categoria": f.get("categoria") or "",
              "tipo_nombre": f.get("tipo_nombre") or ""} for f in todas if f.get("es_plantilla_categoria")),
            key=lambda x: x["nombre"]),
    }


def actualizar_campos_ficha(ficha_id: str, campos: dict | None = None,
                            tipo_nombre: str | None = None, plantilla_id: str | None = None) -> dict:
    """Cambia SOLO lo pedido y conserva el resto de la ficha tal cual.

    `guardar_ficha` reemplaza la ficha entera: quien quiera corregir un texto tendría que
    traer y devolver la ficha completa (logo incluido) y un campo que olvide se pierde. Acá
    se lee, se mezcla y se guarda bajo el mismo candado, por la misma vía de escritura.
    """
    campos = campos or {}
    ajenos = sorted(set(campos) - set(CAMPOS_EDITABLES))
    if ajenos:
        raise ValueError(f"Campos que no se editan desde aquí: {', '.join(ajenos)}")
    if any(not isinstance(v, str) for v in campos.values()):
        raise ValueError("Los campos de la etiqueta son texto")
    if not campos and tipo_nombre is None and plantilla_id is None:
        raise ValueError("Nada que cambiar")
    with _candado():
        actual = next((f for f in _load_all() if f.get("id") == (ficha_id or "").strip()), None)
        if not actual:
            raise ValueError("Esa etiqueta no existe")
        if plantilla_id and not any(f.get("id") == plantilla_id and f.get("es_plantilla_categoria") for f in _load_all()):
            raise ValueError("Esa plantilla no existe")
        if actual.get("es_plantilla_categoria"):
            raise ValueError("Es la plantilla de una categoría: se edita en el Studio, no desde un producto")
        body = dict(actual)
        body["data"] = {**(actual.get("data") or {}), **campos}
        if tipo_nombre is not None:
            body["tipo_nombre"] = tipo_nombre.strip() or actual.get("tipo_nombre") or ""
        if plantilla_id is not None:
            body["plantilla_id"] = plantilla_id.strip() or actual.get("plantilla_id") or ""
        return _guardar_ficha_bajo_candado(body, actual["id"], actual.get("nombre") or "", body["data"])


def eliminar_ficha(ficha_id: str) -> bool:
    ficha_id = (ficha_id or "").strip()
    if not ficha_id:
        return False
    with _candado():
        antes = _load_all()
        items = [f for f in antes if f.get("id") != ficha_id]
        if len(items) == len(antes):
            return False
        _save_all(items)
        return True


# Datos de DISEÑO del formato 30 mL (102 × 38 mm) que una etiqueta toma de su
# plantilla. Espejo de los campos homónimos de `CAMPOS_PLANTILLA`
# (desktop/src/components/etiqueta-ficha/productLabelTypes.ts).
_CAMPOS_DISENO_PROPAGABLES = (
    "ordenCeldas",
    "storageSugerido",
    "sinTimbreCentro",
    "clasificacionTitulo",
)


def propagar_diseno_plantilla(plantilla_id: str, aplicar: bool = False) -> dict:
    """Lleva el diseño de una plantilla de categoría a las etiquetas hechas con ella.

    Una etiqueta es una COPIA de su plantilla: cambiar la plantilla (orden de las
    casillas, íconos, conservación de la familia…) no toca las ya generadas. Esto
    las alcanza por `plantilla_id`. Solo cambia diseño; los datos del producto
    (nombre, composición, CAS, código de barras…) no se tocan, salvo `storage`
    cuando la plantilla fija `storageSugerido`, que es justo lo que ese dato pide.

    No regenera los PNG de impresión: eso lo hace el navegador (html-to-image).
    Con `aplicar=False` solo informa qué cambiaría.
    """
    plantilla_id = (plantilla_id or "").strip()
    with _candado():
        todos = _load_all()
        plantilla = next((f for f in todos if f.get("id") == plantilla_id), None)
        if not plantilla or not plantilla.get("es_plantilla_categoria"):
            raise ValueError(f"{plantilla_id!r} no es una plantilla de categoría")
        pdata = plantilla.get("data") or {}
        iconos_plantilla = plantilla.get("attribute_icons") or {}
        informe: list[dict] = []
        now = _now()
        for f in todos:
            if f.get("es_plantilla_categoria") or f.get("plantilla_id") != plantilla_id:
                continue
            data = f.setdefault("data", {})
            cambios: list[str] = []
            for campo in _CAMPOS_DISENO_PROPAGABLES:
                if campo in pdata and data.get(campo) != pdata[campo]:
                    data[campo] = pdata[campo]
                    cambios.append(campo)
            sugerido = (pdata.get("storageSugerido") or "").strip()
            if sugerido and data.get("storage") != sugerido:
                data["storage"] = sugerido
                cambios.append("storage")
            iconos = dict(f.get("attribute_icons") or {})
            for campo, svg in iconos_plantilla.items():
                if iconos.get(campo) != svg:
                    iconos[campo] = svg
                    cambios.append(f"ícono:{campo}")
            if iconos:
                f["attribute_icons"] = iconos
            if cambios:
                f["actualizado"] = now
            informe.append({"id": f.get("id"), "nombre": f.get("nombre"), "cambios": cambios})
        if aplicar and any(i["cambios"] for i in informe):
            _save_all(todos)
    return {"plantilla": plantilla.get("nombre"), "aplicado": bool(aplicar), "etiquetas": informe}
