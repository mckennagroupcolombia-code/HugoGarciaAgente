"""
Catálogo de documentación por producto (combos SIIGO + estado FT/COA/SDS + asociaciones Drive).
"""

from __future__ import annotations

import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.drive_documentos import (
    DRIVE_COA_FOLDER_ID,
    DRIVE_FT_FOLDER_ID,
    DRIVE_SDS_FOLDER_ID,
    _palabras_clave,
    listar_pdfs_en_carpeta,
    normalizar_nombre_producto,
)

REPO = Path(__file__).resolve().parents[2]
MAP_PATH = REPO / "app" / "data" / "documentos_producto.json"
DRIVE_INDEX_PATH = REPO / "app" / "data" / "drive_pdf_index.json"
DRIVE_INDEX_TTL_SEC = int(os.getenv("DRIVE_PDF_INDEX_FILE_TTL_SEC", str(7 * 86400)))

TIPOS_DOC = ("ft", "coa", "sds")
CARPETAS = {"ft": DRIVE_FT_FOLDER_ID, "coa": DRIVE_COA_FOLDER_ID, "sds": DRIVE_SDS_FOLDER_ID}

_SHEETS_ROWS_CACHE: dict[str, Any] = {"ts": 0.0, "rows": None}
_SHEETS_ROWS_TTL = int(os.getenv("DOCS_CATALOG_SHEETS_TTL_SEC", "600"))
_YAML_INDEX_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_YAML_INDEX_TTL = 120

_BIBLIOTECA_CACHE: dict[str, Any] = {"ts": 0.0, "archivos": None}
_BIBLIOTECA_TTL = 60


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _leer_mapa() -> dict:
    if not MAP_PATH.is_file():
        return {"productos": {}}
    try:
        return json.loads(MAP_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"productos": {}}


def _guardar_mapa(data: dict) -> None:
    MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    MAP_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def nombre_base_producto(nombre: str) -> str:
    n = (nombre or "").strip()
    n = re.sub(r"\s+\d+[\.,]?\d*\s*(g|kg|ml|l|lb)\b", "", n, flags=re.I)
    return re.sub(r"\s+", " ", n).strip() or nombre


def _normalizar_sheets(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", (s or "").lower())
        if unicodedata.category(c) != "Mn"
    )


def _filas_sheets_catalogo(*, forzar: bool = False) -> list[list[str]] | None:
    """Una sola lectura de Sheets por TTL (evita N× get_all_values)."""
    now = time.time()
    if (
        not forzar
        and _SHEETS_ROWS_CACHE.get("rows") is not None
        and now - float(_SHEETS_ROWS_CACHE.get("ts") or 0) < _SHEETS_ROWS_TTL
    ):
        return _SHEETS_ROWS_CACHE["rows"]

    try:
        import gspread

        spreadsheet_id = os.getenv("SPREADSHEET_ID") or "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
        creds_path = os.getenv(
            "GOOGLE_SERVICE_ACCOUNT_PATH",
            "/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json",
        )
        if not os.path.exists(creds_path):
            return None
        gc = gspread.service_account(filename=creds_path)
        workbook = gc.open_by_key(spreadsheet_id)
        try:
            sheet = workbook.worksheet("BASE DE DATOS MCKENNA GROUP S.A.S")
        except gspread.exceptions.WorksheetNotFound:
            sheet = workbook.sheet1
        all_values = sheet.get_all_values()
        rows = all_values[1:] if all_values else []
        _SHEETS_ROWS_CACHE["ts"] = now
        _SHEETS_ROWS_CACHE["rows"] = rows
        return rows
    except Exception as e:
        print(f"⚠️ [DOCS-CAT] Sheets no disponible: {e}")
        return None


def _tiene_ficha_sheets(nombre_producto: str, rows: list[list[str]] | None) -> bool:
    if not rows or not nombre_producto:
        return False
    idx_nombre, idx_tds = 3, 8
    excluir = {"para", "con", "del", "los", "las", "una", "unos", "unas", "por"}
    nombre_norm = _normalizar_sheets(nombre_producto)
    palabras = [p for p in nombre_norm.split() if len(p) > 4 and p not in excluir]
    if not palabras:
        palabras = nombre_norm.split()

    def coincide_meli_en_fila(fila_norm: str) -> bool:
        return all(p in fila_norm for p in palabras)

    for row in rows:
        if len(row) <= idx_nombre:
            continue
        nombre_fila_norm = _normalizar_sheets(str(row[idx_nombre]))
        if coincide_meli_en_fila(nombre_fila_norm):
            ficha = row[idx_tds].strip() if len(row) > idx_tds else ""
            return bool(ficha)

    candidatos: list[tuple[int, bool]] = []
    for row in rows:
        if len(row) <= idx_nombre:
            continue
        nombre_fila_norm = _normalizar_sheets(str(row[idx_nombre]))
        p_fila = [p for p in nombre_fila_norm.split() if len(p) > 4 and p not in excluir]
        if not p_fila:
            p_fila = nombre_fila_norm.split()
        if all(p in nombre_norm for p in p_fila):
            ficha = row[idx_tds].strip() if len(row) > idx_tds else ""
            if ficha:
                candidatos.append((len(nombre_fila_norm), True))
    return bool(candidatos)


def _indice_yaml_titulos(*, forzar: bool = False) -> dict[str, list[str]]:
    now = time.time()
    if (
        not forzar
        and _YAML_INDEX_CACHE.get("data") is not None
        and now - float(_YAML_INDEX_CACHE.get("ts") or 0) < _YAML_INDEX_TTL
    ):
        return _YAML_INDEX_CACHE["data"]

    from app.services.ficha_tecnica import DATOS_DIR, cargar_datos_desde_archivo

    out: dict[str, list[str]] = {"ft": [], "coa": [], "sds": []}
    if DATOS_DIR.is_dir():
        globs = {"ft": "*.yaml", "coa": "coa_*.yaml", "sds": "sds_*.yaml"}
        for tipo, pattern in globs.items():
            for p in DATOS_DIR.glob(pattern):
                if tipo == "ft" and (p.name.startswith("coa_") or p.name.startswith("sds_")):
                    continue
                if "plantilla" in p.name:
                    continue
                try:
                    d = cargar_datos_desde_archivo(p)
                    t = normalizar_nombre_producto(str(d.get("titulo") or ""))
                    if t:
                        out[tipo].append(t)
                except Exception:
                    continue
    _YAML_INDEX_CACHE["ts"] = now
    _YAML_INDEX_CACHE["data"] = out
    return out


def _titulo_en_yaml(titulo: str, tipo: str, yaml_idx: dict[str, list[str]]) -> bool:
    titulo_n = normalizar_nombre_producto(titulo)
    if not titulo_n:
        return False
    for t in yaml_idx.get(tipo, []):
        if t and (t in titulo_n or titulo_n in t):
            return True
    return False


def _coincide_archivo(nombre_producto: str, ref: str, archivo: str) -> bool:
    ref_u = (ref or "").upper().replace("-", "")
    arch_u = (archivo or "").upper().replace("-", "")
    if ref_u and ref_u in arch_u:
        return True
    claves = _palabras_clave(nombre_producto)
    arch_norm = normalizar_nombre_producto(archivo)
    if len(claves) >= 2 and all(c in arch_norm for c in claves[:2]):
        return True
    if claves:
        principal = max(claves, key=len)
        if len(principal) >= 4 and principal in arch_norm:
            return True
    return False


def _indice_biblioteca(*, forzar: bool = False) -> list[dict]:
    """Documentos FT (simples en pdf/ y completos FT+COA+SDS en completo/)."""
    now = time.time()
    if (
        not forzar
        and _BIBLIOTECA_CACHE.get("archivos") is not None
        and now - float(_BIBLIOTECA_CACHE.get("ts") or 0) < _BIBLIOTECA_TTL
    ):
        return _BIBLIOTECA_CACHE["archivos"]

    from app.services.ficha_tecnica import listar_archivos_generados

    try:
        archivos = [a for a in listar_archivos_generados() if a.get("tipo") == "pdf"]
    except Exception:
        archivos = []
    _BIBLIOTECA_CACHE["ts"] = now
    _BIBLIOTECA_CACHE["archivos"] = archivos
    return archivos


def _buscar_ficha_tecnica_biblioteca(nombre: str, ref: str, biblioteca: list[dict]) -> dict | None:
    """Enlaza con el catálogo según el título de la ficha técnica ya elaborada (biblioteca local)."""
    for archivo in biblioteca:
        nombre_archivo = archivo.get("nombre") or ""
        if _coincide_archivo(nombre, ref, nombre_archivo):
            return {
                "tiene": True,
                "origen": "ficha_tecnica_generada",
                "webViewLink": None,
                "nombre_archivo": nombre_archivo,
            }
    return None


def _buscar_en_indice(
    nombre: str,
    ref: str,
    indice: list[dict],
    *,
    prefijo: str = "",
) -> dict | None:
    for f in indice:
        fname = f.get("name") or ""
        if prefijo and not fname.upper().startswith(prefijo.upper()):
            continue
        if _coincide_archivo(nombre, ref, fname):
            return {
                "drive_id": f.get("id"),
                "webViewLink": f.get("webViewLink"),
                "nombre_archivo": fname,
                "origen": "drive_indice",
            }
    return None


def _doc_asociado(ref: str, tipo: str, productos_map: dict) -> dict | None:
    prod = productos_map.get(ref.upper())
    if not prod:
        return None
    doc = prod.get(tipo)
    return doc if isinstance(doc, dict) and doc.get("webViewLink") else None


def _estado_tipo(
    nombre: str,
    ref: str,
    tipo: str,
    indice: list[dict],
    *,
    prefijo: str = "",
    productos_map: dict | None = None,
    filas_sheets: list[list[str]] | None = None,
    yaml_idx: dict[str, list[str]] | None = None,
    incluir_sheets: bool = True,
) -> dict[str, Any]:
    productos_map = productos_map or {}
    yaml_idx = yaml_idx or {}

    asoc = _doc_asociado(ref, tipo, productos_map)
    if asoc:
        return {"tiene": True, "origen": asoc.get("origen", "manual"), **asoc}

    hit = _buscar_en_indice(nombre, ref, indice, prefijo=prefijo)
    if hit:
        return {"tiene": True, **hit}

    if tipo == "ft" and incluir_sheets and _tiene_ficha_sheets(nombre, filas_sheets):
        return {"tiene": True, "origen": "sheets_texto", "webViewLink": None}
    if _titulo_en_yaml(nombre, tipo, yaml_idx):
        return {"tiene": True, "origen": "yaml_borrador", "webViewLink": None}

    return {"tiene": False, "origen": None, "webViewLink": None}


def _indices_drive_catalogo(*, refrescar: bool = False) -> tuple[dict[str, list[dict]], dict[str, Any]]:
    """
    Índice PDF Drive: archivo JSON persistente + memoria.
    Si hay cache en disco, responde al instante (aunque esté viejo).
    Sin archivo previo no bloquea el catálogo: devuelve vacío hasta reindex explícito.
    """
    meta: dict[str, Any] = {"origen": "vacío", "edad_sec": None, "actualizado_at": None}
    now = time.time()
    vacio = {t: [] for t in TIPOS_DOC}

    if DRIVE_INDEX_PATH.is_file() and not refrescar:
        try:
            data = json.loads(DRIVE_INDEX_PATH.read_text(encoding="utf-8"))
            indices = data.get("indices") or vacio
            updated_at = float(data.get("updated_at") or 0)
            if any(indices.get(t) for t in TIPOS_DOC):
                meta = {
                    "origen": "archivo_stale" if now - updated_at >= DRIVE_INDEX_TTL_SEC else "archivo",
                    "edad_sec": int(now - updated_at) if updated_at else None,
                    "actualizado_at": data.get("actualizado_at"),
                }
                return indices, meta
        except Exception:
            pass

    if not refrescar:
        meta["origen"] = "pendiente"
        meta["mensaje"] = "Índice Drive no generado. Use «Actualizar índice Drive» en el panel."
        return vacio, meta

    indices = {t: listar_pdfs_en_carpeta(CARPETAS[t], usar_cache=True) for t in TIPOS_DOC}
    payload = {
        "updated_at": now,
        "actualizado_at": _ahora_iso(),
        "indices": indices,
    }
    try:
        DRIVE_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
        DRIVE_INDEX_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"⚠️ [DOCS-CAT] No se pudo guardar índice Drive: {e}")
    meta = {"origen": "fresh", "edad_sec": 0, "actualizado_at": payload["actualizado_at"]}
    return indices, meta


def asociar_documento(
    ref: str,
    tipo: str,
    *,
    drive_id: str | None = None,
    web_view_link: str | None = None,
    nombre_archivo: str | None = None,
    nombre_producto: str | None = None,
) -> dict:
    tipo = tipo.lower()
    if tipo not in TIPOS_DOC:
        raise ValueError("tipo debe ser ft, coa o sds")
    ref_key = (ref or "").strip().upper()
    if not ref_key:
        raise ValueError("Se requiere ref (SKU combo SIIGO)")

    link = (web_view_link or "").strip()
    fid = (drive_id or "").strip()
    if not fid and link:
        m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", link)
        if m:
            fid = m.group(1)

    if not link and not fid:
        raise ValueError("Se requiere drive_id o webViewLink")

    entry = {
        "drive_id": fid or None,
        "webViewLink": link or (f"https://drive.google.com/file/d/{fid}/view" if fid else ""),
        "nombre_archivo": nombre_archivo or "",
        "origen": "manual",
        "updated_at": _ahora_iso(),
    }

    data = _leer_mapa()
    productos = data.setdefault("productos", {})
    prod = productos.setdefault(ref_key, {"ref": ref_key})
    if nombre_producto:
        prod["nombre"] = nombre_producto
    prod[tipo] = entry
    prod["updated_at"] = _ahora_iso()
    _guardar_mapa(data)
    return entry


def registrar_documento_generado(
    ref: str | None,
    tipo: str,
    upload: dict,
    nombre_producto: str | None = None,
) -> None:
    if not ref or not upload.get("webViewLink"):
        return
    asociar_documento(
        ref,
        tipo,
        drive_id=upload.get("file_id"),
        web_view_link=upload.get("webViewLink"),
        nombre_archivo=upload.get("nombre"),
        nombre_producto=nombre_producto,
    )
    entry = _leer_mapa().get("productos", {}).get(ref.upper(), {}).get(tipo, {})
    if entry:
        entry["origen"] = "generado"


def listar_productos_documentacion(
    *,
    buscar: str = "",
    solo_faltantes: bool = False,
    tipo_faltante: str | None = None,
    limite: int = 500,
    incluir_sheets: bool = True,
    refrescar_drive: bool = False,
) -> dict[str, Any]:
    from app.services.siigo import _combo_item_desde_raw, listar_productos_combo_siigo

    t0 = time.time()
    raw_list = listar_productos_combo_siigo()
    items = [_combo_item_desde_raw(r) for r in raw_list if r.get("active", True)]

    productos_map = _leer_mapa().get("productos", {})
    filas_sheets = _filas_sheets_catalogo() if incluir_sheets else None
    yaml_idx = _indice_yaml_titulos()
    indices, drive_meta = _indices_drive_catalogo(refrescar=refrescar_drive)
    biblioteca = _indice_biblioteca()
    prefijos = {"ft": "FT", "coa": "COA", "sds": "SDS"}

    buscar_n = normalizar_nombre_producto(buscar)
    out = []
    for it in items:
        ref = it.get("ref") or ""
        nombre = it.get("name") or ""
        if buscar_n:
            combo = f"{ref} {nombre}".lower()
            if buscar_n not in combo and not all(
                p in combo for p in buscar_n.split() if len(p) >= 3
            ):
                continue

        match_ficha = _buscar_ficha_tecnica_biblioteca(nombre, ref, biblioteca)
        if match_ficha:
            docs = {t: dict(match_ficha) for t in TIPOS_DOC}
        else:
            docs = {
                t: _estado_tipo(
                    nombre,
                    ref,
                    t,
                    indices.get(t, []),
                    prefijo=prefijos.get(t, ""),
                    productos_map=productos_map,
                    filas_sheets=filas_sheets,
                    yaml_idx=yaml_idx,
                    incluir_sheets=incluir_sheets,
                )
                for t in TIPOS_DOC
            }
        completo = all(docs[t]["tiene"] for t in TIPOS_DOC)
        faltantes = [t for t in TIPOS_DOC if not docs[t]["tiene"]]

        if solo_faltantes and not faltantes:
            continue
        if tipo_faltante and tipo_faltante in TIPOS_DOC and docs[tipo_faltante]["tiene"]:
            continue

        out.append({
            "ref": ref,
            "nombre": nombre,
            "nombre_base": nombre_base_producto(nombre),
            "precio_web": it.get("precio_web"),
            "activo": it.get("activo", True),
            "documentos": docs,
            "completo": completo,
            "faltantes": faltantes,
        })
        if len(out) >= limite:
            break

    out.sort(key=lambda x: (x["completo"], x["nombre"].lower()))

    return {
        "total": len(out),
        "indices_drive": {t: len(indices.get(t, [])) for t in TIPOS_DOC},
        "drive_index": drive_meta,
        "duracion_ms": int((time.time() - t0) * 1000),
        "productos": out,
    }


def buscar_archivos_drive_para_producto(nombre: str, ref: str = "") -> dict[str, list[dict]]:
    prefijos = {"ft": "FT", "coa": "COA", "sds": "SDS"}
    indices, _ = _indices_drive_catalogo()
    result: dict[str, list[dict]] = {}
    for t in TIPOS_DOC:
        indice = indices.get(t, [])
        hits = []
        for f in indice:
            if _coincide_archivo(nombre, ref, f.get("name") or ""):
                hits.append({
                    "drive_id": f.get("id"),
                    "webViewLink": f.get("webViewLink"),
                    "nombre_archivo": f.get("name"),
                })
        if not hits and prefijos[t]:
            for f in indice:
                if (f.get("name") or "").upper().startswith(prefijos[t]):
                    if _coincide_archivo(nombre, ref, f.get("name") or ""):
                        hits.append({
                            "drive_id": f.get("id"),
                            "webViewLink": f.get("webViewLink"),
                            "nombre_archivo": f.get("name"),
                        })
        result[t] = hits[:8]
    return result
