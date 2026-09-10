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
