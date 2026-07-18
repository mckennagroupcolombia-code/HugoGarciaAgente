"""
Generación de certificados de análisis (COA) McKenna — DOCX + PDF + Google Drive.
"""

from __future__ import annotations

import os
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Any

from docx import Document
from docx.table import Table

from app.services.ficha_tecnica import (
    CREDS_PATH,
    DATOS_DIR,
    TDS_IMPERSONATE,
    cargar_datos_desde_archivo,
    client_email_servicio,
    exportar_pdf,
    guardar_yaml_datos,
    subir_a_drive,
)

REPO = Path(__file__).resolve().parents[2]
COA_DIR = REPO / "fichas_word"
PLANTILLA_DEFAULT = COA_DIR / "plantillas" / "COA PLANTILLA.docx"
PLANTILLA_YAML = DATOS_DIR / "coa_plantilla_ejemplo.yaml"

DOCS_DRIVE_PARENT = os.getenv("DOCS_DRIVE_PARENT_ID", "1fgf9W0ifD5bjN9QSLWZxvtEWby_jT16v")
COA_DRIVE_FOLDER = os.getenv("COA_DRIVE_FOLDER_ID", "1Pad1fOM9X5IUH0MDLZf5e982SuvCJtZN")


def _normalizar(s: str) -> str:
    t = unicodedata.normalize("NFD", (s or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip()


def nombre_archivo_desde_titulo(titulo: str) -> str:
    t = unicodedata.normalize("NFD", titulo.upper())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^A-Z0-9]+", "-", t).strip("-")
    return f"COA-{t}.docx"


def plantilla_datos_ejemplo() -> dict:
    if PLANTILLA_YAML.exists():
        return cargar_datos_desde_archivo(PLANTILLA_YAML)
    return {
        "titulo": "NOMBRE DEL PRODUCTO",
        "identificacion": {
            "nombre_comercial": "NOMBRE COMERCIAL",
            "referencia_interna": "REF-001",
        },
        "lote": {"numero": "I-2026"},
        "parametros": [["Apariencia", "Especificación", "Resultado"]],
    }


def listar_yaml_datos() -> list[dict[str, str]]:
    if not DATOS_DIR.is_dir():
        return []
    items = []
    for p in sorted(DATOS_DIR.glob("coa_*.yaml")) + sorted(DATOS_DIR.glob("coa_*.yml")):
        if "plantilla" in p.name:
            continue
        try:
            d = cargar_datos_desde_archivo(p)
            titulo = (d.get("titulo") or p.stem).strip()
        except Exception:
            titulo = p.stem
        items.append({"id": p.stem, "archivo": p.name, "titulo": titulo})
    return items


def _celda(tabla: Table, fila: int, col: int, valor: str) -> None:
    if fila < len(tabla.rows):
        row = tabla.rows[fila]
        if col < len(row.cells):
            row.cells[col].text = str(valor or "").strip()


def _filas_parametros(data: list) -> list[list[str]]:
    filas = []
    for item in data or []:
        if isinstance(item, (list, tuple)) and len(item) >= 3:
            filas.append([str(item[0]).strip(), str(item[1]).strip(), str(item[2]).strip()])
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            filas.append([str(item[0]).strip(), str(item[1]).strip(), ""])
        elif isinstance(item, dict):
            filas.append([
                str(item.get("parametro", item.get("nombre", ""))).strip(),
                str(item.get("especificacion", item.get("spec", ""))).strip(),
                str(item.get("resultado", item.get("result", ""))).strip(),
            ])
    return filas


def aplicar_datos_a_docx(doc_path: Path, datos: dict) -> None:
    doc = Document(str(doc_path))
    tablas = doc.tables
    if len(tablas) < 10:
        raise ValueError("Plantilla COA inválida: se esperan al menos 10 tablas")

    ident = datos.get("identificacion") or {}
    lote = datos.get("lote") or {}
    emp = datos.get("empaque") or {}

    # Tabla 3 — identificación del producto
    t3 = tablas[3]
    _celda(t3, 0, 1, ident.get("nombre_comercial") or datos.get("titulo", ""))
    _celda(t3, 0, 3, ident.get("referencia_interna", ""))
    _celda(t3, 1, 1, ident.get("nombre_inci", ""))
    _celda(t3, 1, 3, ident.get("cas", ""))
    _celda(t3, 2, 1, ident.get("formula_molecular", ""))
    _celda(t3, 2, 3, ident.get("einces", ""))
    _celda(t3, 3, 1, ident.get("concentracion", ""))
    _celda(t3, 3, 3, ident.get("grado", ""))
    _celda(t3, 4, 1, ident.get("presentacion", ""))
    _celda(t3, 4, 3, ident.get("incluye", ""))

    # Tabla 5 — información del lote
    t5 = tablas[5]
    _celda(t5, 0, 1, lote.get("numero", ""))
    _celda(t5, 0, 3, lote.get("fecha_fabricacion", ""))
    _celda(t5, 1, 1, lote.get("fecha_vencimiento", ""))
    _celda(t5, 1, 3, lote.get("vida_util", ""))
    _celda(t5, 2, 1, lote.get("tamano_lote", ""))
    _celda(t5, 2, 3, lote.get("pais_origen", ""))
    _celda(t5, 3, 1, lote.get("fecha_analisis", ""))
    _celda(t5, 3, 3, lote.get("fecha_emision", ""))

    fabricante = (lote.get("fabricante") or "").strip()
    if fabricante:
        fila_fab = t5.rows[4] if len(t5.rows) > 4 else t5.add_row()
        if len(fila_fab.cells) > 0:
            fila_fab.cells[0].text = "FABRICANTE ORIGINAL"
        if len(fila_fab.cells) > 1:
            fila_fab.cells[1].text = fabricante

    # Tabla 7 — parámetros de análisis
    t7 = tablas[7]
    filas = _filas_parametros(datos.get("parametros"))
    for i, (param, spec, res) in enumerate(filas, start=1):
        if i < len(t7.rows):
            _celda(t7, i, 0, param)
            _celda(t7, i, 1, spec)
            _celda(t7, i, 2, res)
        else:
            row = t7.add_row()
            row.cells[0].text = param
            row.cells[1].text = spec
            row.cells[2].text = res
    for j in range(len(filas) + 1, len(t7.rows)):
        for cell in t7.rows[j].cells:
            cell.text = ""

    # Tabla 9 — empaque y almacenamiento
    t9 = tablas[9]
    _celda(t9, 0, 1, emp.get("empaque_original", ""))
    _celda(t9, 1, 1, emp.get("almacenamiento", ""))
    _celda(t9, 2, 1, emp.get("precauciones", ""))
    _celda(t9, 3, 1, emp.get("observaciones", ""))

    # Tabla 13 — código de verificación
    codigo = (datos.get("codigo_verificacion") or "").strip()
    if codigo and len(tablas) > 13:
        cell = tablas[13].rows[0].cells[1]
        texto = cell.text
        if "MKG-COA-" in texto:
            cell.text = re.sub(
                r"MKG-COA-[A-Z0-9\-]+",
                codigo,
                texto,
                count=1,
            )
        elif codigo:
            cell.text = f"DATOS ADICIONALES\n\nMCKG\n\nCÓDIGO ÚNICO DE VERIFICACIÓN\n{codigo}\nVerificable en:\nwww.mckennagroup.co/verificar"

    doc.save(str(doc_path))


def folder_id_drive() -> str | None:
    if COA_DRIVE_FOLDER:
        return COA_DRIVE_FOLDER
    if not DOCS_DRIVE_PARENT:
        return None
    try:
        from app.services.ficha_tecnica import _drive_service, _resolver_subcarpeta

        service = _drive_service()
        return _resolver_subcarpeta(service, DOCS_DRIVE_PARENT, "COA")
    except Exception:
        return None


def configuracion_drive() -> dict[str, Any]:
    fid = folder_id_drive()
    email = client_email_servicio()
    instrucciones = []
    if email:
        instrucciones.append(f"1) Comparta la carpeta COA con {email} como Editor.")
    if TDS_IMPERSONATE:
        instrucciones.append(f"2) Subida delegada como {TDS_IMPERSONATE}")
    else:
        instrucciones.append(
            "2) Configure TDS_DRIVE_IMPERSONATE en .env para subir a Mi unidad compartida."
        )
    return {
        "client_email": email,
        "creds_ok": bool(email),
        "impersonate_email": TDS_IMPERSONATE or None,
        "delegacion_configurada": bool(TDS_IMPERSONATE),
        "parent_folder_id": DOCS_DRIVE_PARENT,
        "folder_id": fid,
        "folder_url": f"https://drive.google.com/drive/folders/{fid}" if fid else None,
        "parent_folder_url": f"https://drive.google.com/drive/folders/{DOCS_DRIVE_PARENT}",
        "instrucciones": " ".join(instrucciones),
        "creds_path": CREDS_PATH,
    }


def generar_desde_datos(
    datos: dict,
    *,
    plantilla: Path | None = None,
    salida: Path | None = None,
    generar_pdf: bool = True,
    subir_drive: bool = False,
    guardar_yaml: str | None = None,
) -> dict[str, Any]:
    if guardar_yaml is not None:
        slug = guardar_yaml or re.sub(
            r"[^a-z0-9_]+",
            "_",
            _normalizar((datos.get("titulo") or "producto")),
        ).strip("_")
        guardar_yaml_datos(datos, slug=f"coa_{slug}" if not slug.startswith("coa_") else slug)

    titulo = (datos.get("titulo") or "PRODUCTO").strip()
    nombre = nombre_archivo_desde_titulo(titulo)
    destino_docx = salida or (COA_DIR / nombre)

    tpl = plantilla or PLANTILLA_DEFAULT
    if not tpl.exists():
        raise FileNotFoundError(f"Plantilla COA no encontrada: {tpl}")

    destino_docx.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(tpl, destino_docx)
    aplicar_datos_a_docx(destino_docx, datos)

    resultado: dict[str, Any] = {
        "ok": True,
        "titulo": titulo,
        "docx": str(destino_docx),
        "docx_nombre": destino_docx.name,
    }

    pdf_path: Path | None = None
    if generar_pdf:
        pdf_path = exportar_pdf(destino_docx)
        resultado["pdf"] = str(pdf_path)
        resultado["pdf_nombre"] = pdf_path.name

    if subir_drive:
        uploads = []
        folder = folder_id_drive()
        if folder:
            try:
                uploads.append({"tipo": "docx", **subir_a_drive(destino_docx, folder)})
            except Exception as e:
                uploads.append({"tipo": "docx", "error": str(e)})
            if pdf_path:
                try:
                    uploads.append({"tipo": "pdf", **subir_a_drive(pdf_path, folder)})
                except Exception as e:
                    uploads.append({"tipo": "pdf", "error": str(e)})
        else:
            uploads.append({"tipo": "coa", "error": "Carpeta COA no configurada en Drive"})
        resultado["drive_uploads"] = uploads

    return resultado


def ruta_descarga_segura(nombre: str) -> Path | None:
    nombre = os.path.basename(nombre or "")
    if not re.match(r"^COA-.+\.(docx|pdf)$", nombre, re.I):
        return None
    path = (COA_DIR / nombre).resolve()
    try:
        path.relative_to(COA_DIR.resolve())
    except ValueError:
        return None
    if path.is_file():
        return path
    return None
