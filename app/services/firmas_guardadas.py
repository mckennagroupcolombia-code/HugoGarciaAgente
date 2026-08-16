"""Biblioteca de firmas reutilizables entre los formularios de documentos (FT / COA / SDS).

Las firmas viven en ``fichas_word/firmas`` como PNG con fondo transparente, igual
que las que se adjuntan en el panel. El índice guarda datos del firmante para
poder reutilizarlos sin volver a escribirlos.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
from datetime import datetime
from pathlib import Path

import yaml
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
FICHAS_DIR = REPO / "fichas_word"
DATOS_DIR = FICHAS_DIR / "datos"
FIRMAS_DIR = FICHAS_DIR / "firmas"
INDICE_PATH = FIRMAS_DIR / "indice.json"

MAX_FIRMAS = 24
MAX_BYTES = 4 * 1024 * 1024


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _png_desde_data_url(data_url: str) -> bytes:
    """Valida el data URL recibido y lo normaliza a PNG."""
    texto = (data_url or "").strip()
    if not texto.startswith("data:image/"):
        raise ValueError("La firma debe venir como data URL de imagen")
    try:
        crudo = base64.b64decode(texto.split(",", 1)[1], validate=False)
    except Exception as exc:
        raise ValueError("No se pudo decodificar la imagen de la firma") from exc
    if not crudo:
        raise ValueError("La imagen de la firma está vacía")
    if len(crudo) > MAX_BYTES:
        raise ValueError("La imagen de la firma supera 4 MB")
    try:
        with Image.open(io.BytesIO(crudo)) as img:
            img.load()
            if img.format == "PNG":
                return crudo
            buffer = io.BytesIO()
            img.convert("RGBA").save(buffer, format="PNG", optimize=True)
            return buffer.getvalue()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("El archivo no es una imagen válida") from exc


def _leer_indice() -> list[dict]:
    try:
        items = json.loads(INDICE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("id")]


def _escribir_indice(items: list[dict]) -> None:
    FIRMAS_DIR.mkdir(parents=True, exist_ok=True)
    INDICE_PATH.write_text(
        json.dumps(items[:MAX_FIRMAS], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _ruta_firma(firma_id: str) -> Path:
    return FIRMAS_DIR / f"{firma_id}.png"


def guardar_firma(
    imagen_b64: str,
    *,
    nombre: str = "",
    cargo: str = "",
    organizacion: str = "",
) -> dict:
    """Archiva una firma; si ya existe la misma imagen, actualiza sus datos."""
    png = _png_desde_data_url(imagen_b64)
    firma_id = hashlib.sha256(png).hexdigest()[:16]
    FIRMAS_DIR.mkdir(parents=True, exist_ok=True)
    _ruta_firma(firma_id).write_bytes(png)

    items = _leer_indice()
    previa = next((item for item in items if item.get("id") == firma_id), None)
    item = {
        "id": firma_id,
        # Los datos vacíos no pisan los de una firma ya archivada.
        "nombre": (nombre or (previa or {}).get("nombre") or "").strip(),
        "cargo": (cargo or (previa or {}).get("cargo") or "").strip(),
        "organizacion": (organizacion or (previa or {}).get("organizacion") or "").strip(),
        "guardada_en": (previa or {}).get("guardada_en") or _ahora(),
        "usada_en": _ahora(),
    }
    restantes = [otro for otro in items if otro.get("id") != firma_id]
    sobrantes = [otro for otro in restantes[MAX_FIRMAS - 1:] if otro.get("id")]
    for viejo in sobrantes:
        _ruta_firma(str(viejo["id"])).unlink(missing_ok=True)
    _escribir_indice([item, *restantes[: MAX_FIRMAS - 1]])
    return {**item, "imagen_b64": _data_url(png)}


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def listar_firmas() -> list[dict]:
    """Firmas archivadas, de la más reciente a la más antigua."""
    if not INDICE_PATH.exists() or not _leer_indice():
        importar_firmas_de_borradores()
    salida: list[dict] = []
    for item in _leer_indice():
        ruta = _ruta_firma(str(item["id"]))
        if not ruta.is_file():
            continue
        salida.append({**item, "imagen_b64": _data_url(ruta.read_bytes())})
    return salida


def eliminar_firma(firma_id: str) -> bool:
    fid = (firma_id or "").strip()
    if not fid or not fid.isalnum():
        return False
    items = _leer_indice()
    restantes = [item for item in items if item.get("id") != fid]
    if len(restantes) == len(items):
        return False
    _ruta_firma(fid).unlink(missing_ok=True)
    _escribir_indice(restantes)
    return True


def _firmas_en_borrador(datos) -> list[dict]:
    """Recorre un borrador YAML buscando bloques ``firma`` con imagen."""
    encontradas: list[dict] = []
    if isinstance(datos, dict):
        imagen = datos.get("imagen_b64") or datos.get("imagen_src")
        if isinstance(imagen, str) and imagen.startswith("data:image/"):
            encontradas.append({
                "imagen_b64": imagen,
                "nombre": str(datos.get("nombre") or ""),
                "cargo": str(datos.get("cargo") or ""),
                "organizacion": str(datos.get("organizacion") or ""),
            })
        for valor in datos.values():
            encontradas.extend(_firmas_en_borrador(valor))
    elif isinstance(datos, list):
        for valor in datos:
            encontradas.extend(_firmas_en_borrador(valor))
    return encontradas


def archivar_firma_desde_datos(datos) -> dict | None:
    """Extrae y archiva la primera firma con imagen encontrada en un payload."""
    for firma in _firmas_en_borrador(datos):
        try:
            return guardar_firma(
                firma["imagen_b64"],
                nombre=firma["nombre"],
                cargo=firma["cargo"],
                organizacion=firma["organizacion"],
            )
        except ValueError:
            continue
    return None


def importar_firmas_de_borradores() -> int:
    """Siembra la biblioteca con las firmas ya usadas en documentos anteriores."""
    if not DATOS_DIR.is_dir():
        _escribir_indice(_leer_indice())
        return 0
    importadas = 0
    for ruta in sorted(DATOS_DIR.glob("*.y*ml"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            datos = yaml.safe_load(ruta.read_text(encoding="utf-8"))
        except Exception:
            continue
        for firma in _firmas_en_borrador(datos):
            try:
                guardar_firma(
                    firma["imagen_b64"],
                    nombre=firma["nombre"],
                    cargo=firma["cargo"],
                    organizacion=firma["organizacion"],
                )
                importadas += 1
            except ValueError:
                continue
    if not INDICE_PATH.exists():
        _escribir_indice(_leer_indice())
    return importadas
