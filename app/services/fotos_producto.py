"""
Fotos y mockups de producto por canal de venta (Espacio de producto → «Fotos y mockups»).

Las imágenes que el equipo arma por fuera (foto de estudio, mockup del envase con la
etiqueta) se pegan con Ctrl+V en el panel y quedan guardadas como los PNG aprobados de
las etiquetas: en la misma biblioteca `~/Documentos/Etiquetas McKenna/Recursos PNG/`,
en la carpeta hermana `FOTOS PRODUCTO/<canal>/`, con un registro por SKU de venta
(`app/data/fotos_producto.json`) para no depender del nombre del archivo.

Sin LLM y sin tocar MeLi ni la web: guardar una foto aquí no la publica.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import secrets
import shutil
import threading
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_REGISTRO = REPO / "app" / "data" / "fotos_producto.json"
_lock = threading.Lock()

CANALES = {"meli": "MERCADO LIBRE", "web": "PAGINA WEB"}
CARPETA = "FOTOS PRODUCTO"
MAX_BYTES = 15 * 1024 * 1024
_MINIATURA_PX = 360
_miniaturas: dict[tuple[str, float], str] = {}


def _raiz_png() -> Path:
    from app.tools.etiquetas_studio import _carpeta_recursos_png

    return _carpeta_recursos_png()


def _carpeta_canal(canal: str) -> Path:
    d = _raiz_png() / CARPETA / CANALES[canal]
    d.mkdir(parents=True, exist_ok=True)
    return d


def _papelera() -> Path:
    # Fuera de Recursos PNG: la biblioteca de Diseño recorre esa carpeta y mostraría lo retirado.
    d = _raiz_png().parent / ".papelera_fotos_producto"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _leer() -> dict:
    try:
        with open(_REGISTRO, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return (data.get("productos") or {}) if isinstance(data, dict) else {}


def _guardar(reg: dict) -> None:
    tmp = _REGISTRO.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"productos": reg}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _REGISTRO)


def _ref(ref: str) -> str:
    ref = (ref or "").strip()
    if not ref or len(ref) > 60 or not re.fullmatch(r"[A-Za-z0-9 _.\-]+", ref):
        raise ValueError("SKU inválido")
    return ref.upper()


def _canal(canal: str) -> str:
    canal = (canal or "").strip().lower()
    if canal not in CANALES:
        raise ValueError("Canal inválido (meli o web)")
    return canal


def _vivas(fotos: list[dict], canal: str) -> list[dict]:
    base = _raiz_png() / CARPETA / CANALES[canal]
    return [f for f in fotos if (base / f.get("archivo", "")).is_file()]


def resumen() -> dict[str, dict[str, int]]:
    """{SKU: {"meli": n, "web": n}} — para los puntos de la lista (sin leer imágenes)."""
    out: dict[str, dict[str, int]] = {}
    for ref, canales in _leer().items():
        cuenta = {c: len(_vivas(canales.get(c) or [], c)) for c in CANALES}
        if any(cuenta.values()):
            out[ref] = cuenta
    return out


def por_sku() -> dict[str, dict[str, dict]]:
    """{SKU: {"meli": {"n", "ultima"}, "web": {...}}} — cuántas fotos vivas y la fecha de la más
    reciente, para decir si la foto es anterior a la etiqueta aprobada (Árbol del producto)."""
    out: dict[str, dict[str, dict]] = {}
    for ref, canales in _leer().items():
        fila = {}
        for c in CANALES:
            vivas = _vivas(canales.get(c) or [], c)
            fila[c] = {"n": len(vivas), "ultima": max((f.get("subido_at") or "" for f in vivas), default="")}
        if any(v["n"] for v in fila.values()):
            out[ref] = fila
    return out


def _miniatura(ruta: Path) -> str:
    try:
        mt = ruta.stat().st_mtime
    except OSError:
        return ""
    clave = (str(ruta), mt)
    if clave in _miniaturas:
        return _miniaturas[clave]
    from PIL import Image

    try:
        with Image.open(ruta) as im:
            im.thumbnail((_MINIATURA_PX, _MINIATURA_PX))
            if im.mode in ("RGBA", "LA", "P"):
                fondo = Image.new("RGB", im.size, (255, 255, 255))
                im = im.convert("RGBA")
                fondo.paste(im, mask=im.split()[-1])
                im = fondo
            buf = io.BytesIO()
            im.convert("RGB").save(buf, "JPEG", quality=82)
    except Exception:  # noqa: BLE001 - una imagen dañada no tumba la lista
        return ""
    b64 = base64.b64encode(buf.getvalue()).decode()
    if len(_miniaturas) > 600:
        _miniaturas.clear()
    _miniaturas[clave] = b64
    return b64


def _ordenadas(fotos: list[dict]) -> list[dict]:
    """Orden que el equipo fijó arrastrando (`pos`); las que llegan después, sin `pos`, van
    primero y de la más reciente a la más antigua (así se veían antes de poder reordenar)."""
    filas = sorted(fotos, key=lambda f: f.get("subido_at") or "", reverse=True)
    return sorted(filas, key=lambda f: f.get("pos", -1))


def listar(ref: str) -> dict:
    ref = _ref(ref)
    canales = _leer().get(ref) or {}
    out = {}
    for c in CANALES:
        filas = _ordenadas(_vivas(canales.get(c) or [], c))
        base = _raiz_png() / CARPETA / CANALES[c]
        out[c] = [{**f, "miniatura": _miniatura(base / f["archivo"])} for f in filas]
    return {"ref": ref, "canales": out, "carpetas": {c: f"{CARPETA}/{n}" for c, n in CANALES.items()}}


def guardar(ref: str, canal: str, raw: bytes, *, por: str = "") -> dict:
    """Guarda una imagen pegada. PNG y JPG se guardan tal cual; cualquier otro formato que
    el navegador entregue (WebP, GIF, BMP) se convierte a PNG."""
    ref, canal = _ref(ref), _canal(canal)
    if not raw:
        raise ValueError("La imagen llegó vacía")
    if len(raw) > MAX_BYTES:
        raise ValueError(f"La imagen supera {MAX_BYTES // (1024 * 1024)} MB")
    from PIL import Image

    try:
        with Image.open(io.BytesIO(raw)) as im:
            im.load()
            formato = (im.format or "").upper()
            ancho, alto = im.size
            if formato == "PNG":
                ext, datos = "png", raw
            elif formato in ("JPEG", "JPG"):
                ext, datos = "jpg", raw
            else:
                buf = io.BytesIO()
                im.save(buf, "PNG")
                ext, datos = "png", buf.getvalue()
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Lo pegado no es una imagen") from exc

    sello = datetime.now().strftime("%Y%m%d-%H%M%S")
    nombre_ref = re.sub(r"[^A-Za-z0-9_\-]+", "_", ref)
    archivo = f"{nombre_ref}_{sello}_{secrets.token_hex(2)}.{ext}"
    (_carpeta_canal(canal) / archivo).write_bytes(datos)
    fila = {"archivo": archivo, "subido_at": datetime.now().isoformat(timespec="seconds"),
            "por": por, "ancho": ancho, "alto": alto, "bytes": len(datos)}
    with _lock:
        reg = _leer()
        reg.setdefault(ref, {}).setdefault(canal, []).append(fila)
        _guardar(reg)
    return fila


def reordenar(ref: str, canal: str, orden: list[str]) -> None:
    """Fija el orden de las fotos de un canal (la primera es la principal). `orden` trae los
    nombres de archivo; las que no vengan quedan al final en su orden actual."""
    ref, canal = _ref(ref), _canal(canal)
    with _lock:
        reg = _leer()
        fotos = (reg.get(ref) or {}).get(canal) or []
        nombres = {f.get("archivo") for f in fotos}
        if any(a not in nombres for a in orden):
            raise ValueError("Esa foto no es de este producto")
        actual = [f.get("archivo") for f in _ordenadas(fotos)]
        pos = {a: i for i, a in enumerate(dict.fromkeys([*orden, *actual]))}
        for f in fotos:
            f["pos"] = pos[f.get("archivo")]
        reg[ref][canal] = sorted(fotos, key=lambda f: f["pos"])
        _guardar(reg)


def ruta_archivo(ref: str, canal: str, archivo: str) -> Path | None:
    ref, canal = _ref(ref), _canal(canal)
    if not any(f.get("archivo") == archivo for f in (_leer().get(ref) or {}).get(canal) or []):
        return None
    ruta = _carpeta_canal(canal) / archivo
    return ruta if ruta.is_file() else None


def retirar(ref: str, canal: str, archivo: str) -> None:
    """Quita la foto del producto. El archivo va a una papelera, no se borra."""
    ref, canal = _ref(ref), _canal(canal)
    with _lock:
        reg = _leer()
        fotos = (reg.get(ref) or {}).get(canal) or []
        if not any(f.get("archivo") == archivo for f in fotos):
            raise ValueError("Esa foto no es de este producto")
        reg[ref][canal] = [f for f in fotos if f.get("archivo") != archivo]
        _guardar(reg)
    ruta = _carpeta_canal(canal) / archivo
    if ruta.is_file():
        shutil.move(str(ruta), str(_papelera() / f"{datetime.now():%Y%m%d-%H%M%S}_{archivo}"))
