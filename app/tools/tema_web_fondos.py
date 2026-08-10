"""Imágenes de fondo del Studio web → sitio público (static/uploads/fondos)."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
FONDOS_DIR = _ROOT / "PAGINA_WEB" / "site" / "static" / "uploads" / "fondos"
FONDOS_URL_PREFIX = "/static/uploads/fondos/"
MAX_BYTES = 4 * 1024 * 1024
_URL_RE = re.compile(r"^/static/uploads/fondos/[A-Za-z0-9._-]+$")
_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def sanitize_fondo_url(raw) -> str:
    if not isinstance(raw, str):
        return ""
    s = raw.strip()
    return s if _URL_RE.match(s) else ""


def _ext_desde_magic(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


def guardar_fondo(archivo) -> dict:
    """Guarda un FileStorage y devuelve {url, filename, bytes}."""
    if archivo is None or not getattr(archivo, "filename", None):
        raise ValueError("Envíe una imagen en el campo multipart «archivo»")
    head = archivo.stream.read(16)
    archivo.stream.seek(0)
    ext = _ext_desde_magic(head)
    if not ext:
        raise ValueError("Formato no permitido. Use JPG, PNG, WEBP o GIF.")
    data = archivo.stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("La imagen supera 4 MB")
    if len(data) < 24:
        raise ValueError("Archivo vacío o corrupto")
    try:
        FONDOS_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}{ext}"
        dest = FONDOS_DIR / name
        dest.write_bytes(data)
    except PermissionError as exc:
        raise ValueError(
            "Sin permiso para guardar la imagen. "
            "La carpeta PAGINA_WEB/site/static/uploads/fondos debe ser del usuario del servicio (mckg)."
        ) from exc
    return {"url": f"{FONDOS_URL_PREFIX}{name}", "filename": name, "bytes": len(data)}


def ruta_fondo_segura(filename: str) -> Path | None:
    """Archivo real bajo FONDOS_DIR, o None si el nombre no es válido."""
    if not isinstance(filename, str) or not _NAME_RE.match(filename):
        return None
    base = FONDOS_DIR.resolve()
    dest = (FONDOS_DIR / filename).resolve()
    try:
        dest.relative_to(base)
    except ValueError:
        return None
    return dest if dest.is_file() else None


def listar_fondos() -> list[dict]:
    if not FONDOS_DIR.is_dir():
        return []
    out = []
    for p in sorted(FONDOS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if not p.is_file() or p.name.startswith("."):
            continue
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            continue
        out.append({"url": f"{FONDOS_URL_PREFIX}{p.name}", "filename": p.name})
    return out[:80]
