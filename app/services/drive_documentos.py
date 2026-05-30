"""
Búsqueda de PDFs (ficha técnica / COA) en carpetas de Google Drive.
Carpetas por defecto: FT y COA de McKenna Group (service account).
"""

from __future__ import annotations

import os
import re
import time
import unicodedata
from functools import lru_cache
from typing import Any

from app.sync import GOOGLE_CREDS_PATH

DRIVE_FT_FOLDER_ID = os.getenv(
    "DRIVE_FT_FOLDER_ID", "1hHwif79Rf9O6vgAQt5X0CCVML4LeAIz6"
)
DRIVE_COA_FOLDER_ID = os.getenv(
    "COA_DRIVE_FOLDER_ID", "1Pad1fOM9X5IUH0MDLZf5e982SuvCJtZN"
)
DRIVE_SDS_FOLDER_ID = os.getenv(
    "SDS_DRIVE_FOLDER_ID", "1lbnrVKDIH4CPL6SRWQxAx27zMZqma5IU"
)

_IGNORAR = frozenset(
    {
        "ft",
        "ficha",
        "tecnica",
        "coa",
        "de",
        "del",
        "para",
        "producto",
        "certificado",
        "gr",
        "kg",
        "ml",
        "usp",
        "n",
        "a",
        "envio",
        "gratis",
        "puro",
        "anhidrida",
        "anhidro",
    }
)


def normalizar_nombre_producto(texto: str) -> str:
    if not texto:
        return ""
    texto = "".join(
        c
        for c in unicodedata.normalize("NFD", texto)
        if unicodedata.category(c) != "Mn"
    )
    texto = re.sub(r"[^a-zA-Z0-9\s]", " ", texto)
    return re.sub(r"\s+", " ", texto.lower()).strip()


def _palabras_clave(nombre: str) -> list[str]:
    palabras = normalizar_nombre_producto(nombre).split()
    return [p for p in palabras if p not in _IGNORAR and len(p) > 2]


@lru_cache(maxsize=1)
def _drive_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    if not os.path.exists(GOOGLE_CREDS_PATH):
        return None
    creds = service_account.Credentials.from_service_account_file(
        GOOGLE_CREDS_PATH,
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


_INDICE_PDF_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_INDICE_PDF_TTL_SEC = int(os.getenv("DRIVE_PDF_INDEX_TTL_SEC", "600"))


def listar_pdfs_en_carpeta(
    folder_id: str,
    *,
    page_size: int = 200,
    usar_cache: bool = True,
) -> list[dict[str, Any]]:
    """Lista PDFs en una carpeta Drive (paginado). Cache en memoria ~10 min."""
    if usar_cache and folder_id in _INDICE_PDF_CACHE:
        ts, cached = _INDICE_PDF_CACHE[folder_id]
        if time.time() - ts < _INDICE_PDF_TTL_SEC:
            return cached

    service = _drive_service()
    if not service or not folder_id:
        return []
    files: list[dict] = []
    token: str | None = None
    try:
        while True:
            res = (
                service.files()
                .list(
                    q=(
                        f"'{folder_id}' in parents and mimeType = 'application/pdf' "
                        f"and trashed = false"
                    ),
                    fields="nextPageToken, files(id, name, webViewLink)",
                    pageSize=page_size,
                    pageToken=token,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                )
                .execute()
            )
            files.extend(res.get("files") or [])
            token = res.get("nextPageToken")
            if not token:
                break
    except Exception as e:
        print(f"⚠️ [DRIVE-DOC] Error listando carpeta {folder_id}: {e}")
    if usar_cache:
        _INDICE_PDF_CACHE[folder_id] = (time.time(), files)
    return files


def buscar_pdf_en_carpeta_drive(
    nombre_producto: str,
    folder_id: str,
    *,
    prefijo_nombre: str = "",
) -> dict[str, Any] | None:
    """
    Devuelve {name, webViewLink, id} del primer PDF que coincida por palabras clave.
    """
    service = _drive_service()
    if not service or not folder_id:
        return None

    claves = _palabras_clave(nombre_producto)
    if not claves:
        return None

    def _query(termino: str) -> list[dict]:
        t = termino.replace("'", "\\'")
        extra = f" and name contains '{prefijo_nombre}'" if prefijo_nombre else ""
        q = (
            f"'{folder_id}' in parents and name contains '{t}'"
            f" and mimeType = 'application/pdf' and trashed = false{extra}"
        )
        try:
            results = (
                service.files()
                .list(q=q, fields="files(id, name, webViewLink)", pageSize=5)
                .execute()
            )
            return results.get("files") or []
        except Exception as e:
            print(f"⚠️ [DRIVE-DOC] Error listando '{termino}': {e}")
            return []

    for termino in (" ".join(claves[:2]), max(claves, key=len)):
        files = _query(termino)
        if files:
            f = files[0]
            return {
                "id": f.get("id"),
                "name": f.get("name"),
                "webViewLink": f.get("webViewLink"),
            }
    return None


def buscar_ficha_tecnica_pdf(nombre_producto: str) -> str | None:
    hit = buscar_pdf_en_carpeta_drive(
        nombre_producto, DRIVE_FT_FOLDER_ID, prefijo_nombre="FT"
    )
    if not hit:
        hit = buscar_pdf_en_carpeta_drive(nombre_producto, DRIVE_FT_FOLDER_ID)
    return (hit or {}).get("webViewLink")


def buscar_coa_pdf(nombre_producto: str) -> str | None:
    hit = buscar_pdf_en_carpeta_drive(
        nombre_producto, DRIVE_COA_FOLDER_ID, prefijo_nombre="COA"
    )
    if not hit:
        hit = buscar_pdf_en_carpeta_drive(nombre_producto, DRIVE_COA_FOLDER_ID)
    return (hit or {}).get("webViewLink")


def buscar_sds_pdf(nombre_producto: str) -> str | None:
    hit = buscar_pdf_en_carpeta_drive(
        nombre_producto, DRIVE_SDS_FOLDER_ID, prefijo_nombre="SDS"
    )
    if not hit:
        hit = buscar_pdf_en_carpeta_drive(nombre_producto, DRIVE_SDS_FOLDER_ID)
    return (hit or {}).get("webViewLink")

