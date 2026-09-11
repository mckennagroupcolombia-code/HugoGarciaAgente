"""
Logos corporativos para la "Ficha de etiqueta" (panel → Diseño → Ficha de
etiqueta, botón del logo). Lista y sirve las imágenes de la carpeta
`DISENO CORPORATIVO ` del repo (ojo: el nombre real de la carpeta termina
en un espacio) para que el operador elija el logo desde el panel sin
subirlo a mano cada vez.

Las miniaturas (160 px, PNG en data URL) se generan con PIL y se cachean
en memoria por (ruta, mtime) — la carpeta tiene PNG de hasta 2.5 MB que no
tiene sentido mandar completos solo para mostrar una rejilla de opciones.
"""
from __future__ import annotations

import base64
import io
import os
from datetime import datetime
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
# Primero el nombre real (con espacio final); los otros por si algún día
# se renombra la carpeta.
_NOMBRES_CARPETA = ("DISENO CORPORATIVO ", "DISENO CORPORATIVO", "DISEÑO CORPORATIVO")
_EXT_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}
_THUMB_PX = 160
_SVG_THUMB_MAX_BYTES = 300_000
_thumb_cache: dict[tuple[str, float], str | None] = {}


def carpeta_logos() -> Path | None:
    for nombre in _NOMBRES_CARPETA:
        p = _REPO / nombre
        if p.is_dir():
            return p
    return None


def _mime(nombre: str) -> str | None:
    return _EXT_MIME.get(Path(nombre).suffix.lower())


def _thumb_data_url(ruta: Path, mtime: float) -> str | None:
    key = (str(ruta), mtime)
    if key in _thumb_cache:
        return _thumb_cache[key]
    out: str | None = None
    if ruta.suffix.lower() == ".svg":
        try:
            raw = ruta.read_bytes()
            if len(raw) <= _SVG_THUMB_MAX_BYTES:
                out = "data:image/svg+xml;base64," + base64.b64encode(raw).decode("ascii")
        except OSError:
            out = None
    else:
        try:
            from PIL import Image

            with Image.open(ruta) as im:
                im = im.convert("RGBA")
                im.thumbnail((_THUMB_PX, _THUMB_PX))
                buf = io.BytesIO()
                im.save(buf, "PNG", optimize=True)
                out = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
        except Exception:
            out = None
    _thumb_cache[key] = out
    return out


def _orden(nombre: str) -> tuple[int, str]:
    n = nombre.lower()
    if n.startswith("logo"):
        grupo = 0
    elif "isotipo" in n or "logotipo" in n:
        grupo = 1
    else:
        grupo = 2
    return (grupo, n)


def listar_logos() -> list[dict]:
    base = carpeta_logos()
    if base is None:
        return []
    items: list[dict] = []
    try:
        entradas = list(os.scandir(base))
    except OSError:
        return []
    for e in entradas:
        if not e.is_file() or e.name.startswith("."):
            continue
        mime = _mime(e.name)
        if not mime:
            continue
        st = e.stat()
        items.append({
            "nombre": e.name,
            "mime": mime,
            "bytes": st.st_size,
            "modificado": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            "thumb": _thumb_data_url(Path(e.path), st.st_mtime),
        })
    items.sort(key=lambda it: _orden(it["nombre"]))
    return items


_SUBIDA_MAX_BYTES = 8 * 1024 * 1024


def _ext_imagen_raster(raw: bytes) -> str | None:
    """Extensión según los bytes reales. Solo formatos raster: un SVG subido
    desde el panel podría llevar scripts y se sirve desde el mismo dominio."""
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if len(raw) >= 2 and raw[0] == 0xFF and raw[1] == 0xD8:
        return ".jpg"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return ".webp"
    return None


def guardar_logo(nombre_original: str, raw: bytes) -> dict:
    """Guarda una imagen subida desde el panel en la carpeta de logos.
    Si ya existe un archivo con ese nombre, agrega _2, _3… en vez de
    sobrescribirlo. Lanza ValueError con un mensaje para el operador."""
    import re

    base = carpeta_logos()
    if base is None:
        raise ValueError("No se encontró la carpeta DISEÑO CORPORATIVO en el servidor")
    if not raw:
        raise ValueError("Archivo vacío")
    if len(raw) > _SUBIDA_MAX_BYTES:
        raise ValueError(f"La imagen supera el límite de {_SUBIDA_MAX_BYTES // (1024 * 1024)} MB")
    ext = _ext_imagen_raster(raw)
    if ext is None:
        raise ValueError("Solo se permiten imágenes PNG, JPG o WEBP")

    limpio = os.path.basename((nombre_original or "").strip().replace("\\", "/"))
    stem, ext_original = os.path.splitext(limpio)
    if ext == ".jpg" and ext_original.lower() == ".jpeg":
        ext = ".jpeg"
    stem = re.sub(r"[^\w.\- áéíóúÁÉÍÓÚñÑ]", "_", stem).strip(" .") or "logo"
    stem = stem[:150]
    nombre = f"{stem}{ext}"
    n = 2
    while (base / nombre).exists():
        nombre = f"{stem}_{n}{ext}"
        n += 1

    ruta = base / nombre
    ruta.write_bytes(raw)
    st = ruta.stat()
    return {
        "nombre": nombre,
        "mime": _mime(nombre),
        "bytes": st.st_size,
        "modificado": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
        "thumb": _thumb_data_url(ruta, st.st_mtime),
    }


_PAPELERA = ".papelera"


def enviar_a_papelera(nombre: str) -> str:
    """Quita un logo de la galería moviéndolo a `.papelera/` dentro de la
    misma carpeta (listar_logos no la ve), así se puede recuperar a mano.
    Devuelve el nombre con el que quedó en la papelera."""
    ruta, _mime_ = ruta_logo(nombre)
    if ruta is None:
        raise ValueError("Logo no encontrado")
    papelera = ruta.parent / _PAPELERA
    papelera.mkdir(exist_ok=True)
    destino = papelera / ruta.name
    n = 2
    while destino.exists():
        destino = papelera / f"{ruta.stem}_{n}{ruta.suffix}"
        n += 1
    ruta.rename(destino)
    return destino.name


def ruta_logo(nombre: str) -> tuple[Path | None, str | None]:
    """Ruta absoluta + mime de un logo por nombre de archivo; (None, None) si
    no existe o el nombre intenta salirse de la carpeta."""
    base = carpeta_logos()
    nombre = (nombre or "").strip()
    if base is None or not nombre or "/" in nombre or "\\" in nombre or nombre.startswith("."):
        return None, None
    mime = _mime(nombre)
    if not mime:
        return None, None
    ruta = base / nombre
    try:
        if ruta.resolve().parent != base.resolve() or not ruta.is_file():
            return None, None
    except OSError:
        return None, None
    return ruta, mime
