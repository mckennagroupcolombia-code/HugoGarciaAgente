"""
Generación de fichas técnicas McKenna (DOCX + PDF) y subida a Google Drive.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path
from typing import Any

import yaml
from docx import Document
from docx.table import Table

REPO = Path(__file__).resolve().parents[2]
FICHAS_DIR = REPO / "fichas_word"
DATOS_DIR = FICHAS_DIR / "datos"
PLANTILLA_DEFAULT = FICHAS_DIR / "FT CAOLIN COLOIDAL.docx"
PLANTILLA_YAML = DATOS_DIR / "plantilla_ejemplo.yaml"

TDS_PARENT_DEFAULT = os.getenv("TDS_DRIVE_PARENT_ID", "1BTXM8bKCnWVYWTTEmKYxcpaQv1TOoZVs")
TDS_FOLDER_PDF = os.getenv("TDS_DRIVE_FOLDER_PDF", "").strip()
TDS_FOLDER_WORD = os.getenv("TDS_DRIVE_FOLDER_WORD", "").strip()
# Usuario Workspace a impersonar (delegación dominio). Obligatorio para subir a Mi unidad compartida.
TDS_IMPERSONATE = (
    os.getenv("TDS_DRIVE_IMPERSONATE", "").strip()
    or os.getenv("GOOGLE_DRIVE_IMPERSONATE_USER", "").strip()
)
CREDS_PATH = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    str(REPO / "mi-agente-ubuntu-9043f67d9755.json"),
)

_MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

_folder_cache: dict[str, str] = {}


def client_email_servicio() -> str | None:
    if not os.path.exists(CREDS_PATH):
        return None
    try:
        with open(CREDS_PATH, encoding="utf-8") as f:
            return json.load(f).get("client_email")
    except Exception:
        return None


def _normalizar(s: str) -> str:
    t = unicodedata.normalize("NFD", (s or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip()


def nombre_archivo_desde_titulo(titulo: str) -> str:
    t = unicodedata.normalize("NFD", titulo.upper())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^A-Z0-9]+", " ", t).strip()
    return f"FT {' '.join(t.split())}.docx"


def cargar_datos_desde_archivo(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        return json.loads(raw)
    return yaml.safe_load(raw) or {}


def plantilla_datos_ejemplo() -> dict:
    if PLANTILLA_YAML.exists():
        return cargar_datos_desde_archivo(PLANTILLA_YAML)
    return {
        "titulo": "NOMBRE DEL PRODUCTO",
        "descripcion": "Descripción del ingrediente…",
        "aplicaciones": ["Uso principal…"],
        "identidad": [["NOMBRE DEL PRODUCTO", "Nombre comercial"]],
        "propiedades": [["Apariencia", "Polvo fino"]],
        "microbiologia": [["E. Coli", "Negativo"]],
        "estabilidad": ["Almacenar en lugar seco…"],
    }


def listar_yaml_datos() -> list[dict[str, str]]:
    if not DATOS_DIR.is_dir():
        return []
    items = []
    for p in sorted(DATOS_DIR.glob("*.yaml")) + sorted(DATOS_DIR.glob("*.yml")):
        if p.name.startswith("plantilla"):
            continue
        try:
            d = cargar_datos_desde_archivo(p)
            titulo = (d.get("titulo") or p.stem).strip()
        except Exception:
            titulo = p.stem
        items.append({"id": p.stem, "archivo": p.name, "titulo": titulo})
    return items


def _filas_tabla(data: list) -> list[list[str]]:
    filas = []
    for item in data or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            filas.append([str(item[0]).strip(), str(item[1]).strip()])
        elif isinstance(item, dict):
            for k, v in item.items():
                filas.append([str(k).strip(), str(v).strip()])
    return filas


def _rellenar_tabla(tabla: Table, filas: list[list[str]]) -> None:
    for i, (label, valor) in enumerate(filas):
        if i < len(tabla.rows):
            row = tabla.rows[i]
            row.cells[0].text = label
            if len(row.cells) > 1:
                row.cells[-1].text = valor
        else:
            row = tabla.add_row()
            row.cells[0].text = label
            row.cells[-1].text = valor
    for j in range(len(filas), len(tabla.rows)):
        for cell in tabla.rows[j].cells:
            cell.text = ""


def _buscar_parrafo(doc: Document, texto_buscar: str, estilo: str | None = None) -> int | None:
    objetivo = _normalizar(texto_buscar)
    for i, p in enumerate(doc.paragraphs):
        if estilo and p.style.name != estilo:
            continue
        if _normalizar(p.text) == objetivo:
            return i
    return None


def _insertar_despues(doc: Document, idx: int, textos: list[str], estilo: str = "Normal") -> None:
    if idx is None or idx < 0:
        return
    ref = doc.paragraphs[idx]._element
    parent = ref.getparent()
    pos = parent.index(ref) + 1
    for texto in textos:
        nuevo = doc.add_paragraph(texto, style=estilo)
        parent.insert(pos, nuevo._element)
        pos += 1


def aplicar_datos_a_docx(doc_path: Path, datos: dict) -> None:
    doc = Document(str(doc_path))
    titulo = (datos.get("titulo") or "PRODUCTO").strip().upper()

    for p in doc.paragraphs:
        if p.text.strip() and p.style.name == "Normal":
            p.text = titulo
            break

    idx_desc = _buscar_parrafo(doc, "DESCRIPCIÓN", "Heading 1") or _buscar_parrafo(doc, "DESCRIPCION", "Heading 1")
    if idx_desc is not None:
        for j in range(idx_desc + 1, len(doc.paragraphs)):
            p = doc.paragraphs[j]
            if p.style.name == "Heading 1":
                break
            if p.text.strip() and p.style.name == "Normal":
                p.text = (datos.get("descripcion") or "").strip()
                break

    idx_app = _buscar_parrafo(doc, "APLICACIONES")
    idx_prop = _buscar_parrafo(doc, "PROPIEDADES FÍSICO-QUÍMICAS", "Heading 1") or _buscar_parrafo(
        doc, "PROPIEDADES FISICO-QUIMICAS", "Heading 1"
    )
    if idx_app is not None and idx_prop is not None:
        apps = datos.get("aplicaciones") or []
        if isinstance(apps, str):
            apps = [apps]
        for i in range(idx_prop - 1, idx_app, -1):
            p = doc.paragraphs[i]
            if _normalizar(p.text) not in ("aplicaciones",):
                p._element.getparent().remove(p._element)
        _insertar_despues(doc, idx_app, [str(a).strip() for a in apps if str(a).strip()])

    tablas = doc.tables
    filas_id = _filas_tabla(datos.get("identidad"))
    filas_prop = _filas_tabla(datos.get("propiedades"))
    filas_micro = _filas_tabla(datos.get("microbiologia"))

    if len(tablas) >= 1 and filas_id:
        _rellenar_tabla(tablas[0], filas_id)
    if len(tablas) >= 2 and filas_prop:
        _rellenar_tabla(tablas[1], filas_prop)
    if len(tablas) >= 3 and filas_micro:
        _rellenar_tabla(tablas[2], filas_micro)

    nota = (datos.get("nota_micro") or "").strip()
    idx_micro_h = _buscar_parrafo(doc, "PROPIEDADES MICROBIOLÓGICAS") or _buscar_parrafo(
        doc, "PROPIEDADES MICROBIOLOGICAS"
    )
    if idx_micro_h is not None and nota:
        for j in range(idx_micro_h + 1, len(doc.paragraphs)):
            p = doc.paragraphs[j]
            if p.style.name == "Heading 1":
                break
            if p.style.name == "Normal" and "nota" in _normalizar(p.text):
                p.text = f"Nota: {nota}"
                break
        else:
            _insertar_despues(doc, idx_micro_h, [f"Nota: {nota}"])

    idx_est = _buscar_parrafo(doc, "ESTABILIDAD Y ALMACENAMIENTO", "Heading 1")
    estab = datos.get("estabilidad") or []
    if isinstance(estab, str):
        estab = [estab]
    if idx_est is not None and estab:
        for j in range(idx_est + 1, len(doc.paragraphs)):
            p = doc.paragraphs[j]
            if p.style.name == "Heading 1":
                break
            if p.text.strip() and p.style.name == "Normal":
                p.text = str(estab[0]).strip()
                for extra in estab[1:]:
                    _insertar_despues(doc, j, [str(extra).strip()])
                break

    doc.save(str(doc_path))


def exportar_pdf(docx_path: Path, pdf_dir: Path | None = None) -> Path:
    out_dir = pdf_dir or docx_path.parent
    cmd = [
        "libreoffice",
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        str(out_dir),
        str(docx_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or f"código {proc.returncode}"
        raise RuntimeError(f"LibreOffice no generó PDF: {err}")
    pdf_path = out_dir / (docx_path.stem + ".pdf")
    if not pdf_path.exists():
        raise FileNotFoundError(f"No se generó PDF en {out_dir}")
    return pdf_path


def _drive_scopes() -> list[str]:
    if TDS_IMPERSONATE:
        return ["https://www.googleapis.com/auth/drive"]
    return ["https://www.googleapis.com/auth/drive.file"]


def _drive_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    if not os.path.exists(CREDS_PATH):
        raise FileNotFoundError(f"Credenciales no encontradas: {CREDS_PATH}")
    creds = service_account.Credentials.from_service_account_file(
        CREDS_PATH,
        scopes=_drive_scopes(),
    )
    if TDS_IMPERSONATE:
        creds = creds.with_subject(TDS_IMPERSONATE)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _mensaje_error_drive(exc: Exception) -> str:
    txt = str(exc)
    if "storageQuotaExceeded" in txt or "do not have storage quota" in txt.lower():
        return (
            "La cuenta de servicio no puede guardar en Mi unidad (sin cuota). "
            "Configure TDS_DRIVE_IMPERSONATE con un correo @mckennagroup.co del dueño "
            "de las carpetas y active delegación de dominio en Google Workspace "
            "(ver panel Fichas técnicas → ayuda Drive)."
        )
    if "insufficientParentPermissions" in txt:
        return (
            f"Sin permiso en la carpeta. Comparta WORD y PDF con "
            f"{client_email_servicio()} como Editor."
        )
    return txt


def _resolver_subcarpeta(service, parent_id: str, nombre: str) -> str | None:
    clave = f"{parent_id}:{nombre.upper()}"
    if clave in _folder_cache:
        return _folder_cache[clave]
    q = (
        f"'{parent_id}' in parents and mimeType = 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )
    res = service.files().list(q=q, fields="files(id, name)", pageSize=100).execute()
    objetivo = nombre.strip().upper()
    for f in res.get("files", []):
        if (f.get("name") or "").strip().upper() == objetivo:
            _folder_cache[clave] = f["id"]
            return f["id"]
    return None


def folder_id_por_tipo(tipo: str) -> str | None:
    """tipo: 'pdf' | 'word' | 'docx'"""
    t = tipo.lower()
    if t in ("pdf",):
        explicit = TDS_FOLDER_PDF
        subnombre = "PDF"
    else:
        explicit = TDS_FOLDER_WORD
        subnombre = "WORD"
    if explicit:
        return explicit
    if not TDS_PARENT_DEFAULT:
        return None
    try:
        service = _drive_service()
        return _resolver_subcarpeta(service, TDS_PARENT_DEFAULT, subnombre)
    except Exception:
        return None


def configuracion_drive() -> dict[str, Any]:
    email = client_email_servicio()
    pdf_id = folder_id_por_tipo("pdf")
    word_id = folder_id_por_tipo("word")
    delegacion_ok = bool(TDS_IMPERSONATE)
    instrucciones = []
    if email:
        instrucciones.append(
            f"1) Comparta carpetas WORD y PDF con {email} como Editor."
        )
    if not delegacion_ok:
        instrucciones.append(
            "2) En .env defina TDS_DRIVE_IMPERSONATE=correo@mckennagroup.co "
            "(dueño de las carpetas) y active delegación de dominio en Admin Google."
        )
    else:
        instrucciones.append(f"2) Subida como usuario delegado: {TDS_IMPERSONATE}")
    return {
        "client_email": email,
        "creds_ok": bool(email),
        "impersonate_email": TDS_IMPERSONATE or None,
        "delegacion_configurada": delegacion_ok,
        "parent_folder_id": TDS_PARENT_DEFAULT,
        "folder_pdf_id": pdf_id,
        "folder_word_id": word_id,
        "folder_pdf_url": f"https://drive.google.com/drive/folders/{pdf_id}" if pdf_id else None,
        "folder_word_url": f"https://drive.google.com/drive/folders/{word_id}" if word_id else None,
        "parent_folder_url": f"https://drive.google.com/drive/folders/{TDS_PARENT_DEFAULT}",
        "instrucciones": " ".join(instrucciones) if instrucciones else "Configure credenciales Google.",
        "ayuda_delegacion": (
            "Google Cloud → cuenta de servicio → Delegación en todo el dominio. "
            "Admin Workspace → Controles de API → Delegación: añadir Client ID de la SA "
            "con alcance https://www.googleapis.com/auth/drive"
        ),
    }


def subir_a_drive(archivo: Path, folder_id: str) -> dict[str, str]:
    from googleapiclient.http import MediaFileUpload

    if not folder_id:
        raise ValueError("Carpeta Drive no configurada o sin permisos (WORD/PDF)")
    service = _drive_service()
    ext = archivo.suffix.lower()
    mime = _MIME.get(ext, "application/octet-stream")
    meta = {"name": archivo.name, "parents": [folder_id]}
    media = MediaFileUpload(str(archivo), mimetype=mime, resumable=True)
    try:
        created = (
            service.files()
            .create(
                body=meta,
                media_body=media,
                fields="id, webViewLink",
                supportsAllDrives=True,
            )
            .execute()
        )
    except Exception as exc:
        raise RuntimeError(_mensaje_error_drive(exc)) from exc
    fid = created.get("id", "")
    return {
        "file_id": fid,
        "webViewLink": created.get("webViewLink") or f"https://drive.google.com/file/d/{fid}/view",
        "nombre": archivo.name,
    }


def guardar_yaml_datos(datos: dict, slug: str | None = None) -> Path:
    titulo = (datos.get("titulo") or "producto").strip()
    if slug:
        nombre = re.sub(r"[^a-z0-9_]+", "_", _normalizar(slug))
    else:
        nombre = re.sub(r"[^a-z0-9_]+", "_", _normalizar(titulo))
    nombre = nombre.strip("_") or "producto"
    DATOS_DIR.mkdir(parents=True, exist_ok=True)
    path = DATOS_DIR / f"{nombre}.yaml"
    path.write_text(
        yaml.dump(datos, allow_unicode=True, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    return path


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
        guardar_yaml_datos(datos, slug=guardar_yaml or None)

    titulo = (datos.get("titulo") or "PRODUCTO").strip()
    nombre = nombre_archivo_desde_titulo(titulo)
    destino_docx = salida or (FICHAS_DIR / nombre)

    tpl = plantilla or PLANTILLA_DEFAULT
    if not tpl.exists():
        raise FileNotFoundError(f"Plantilla no encontrada: {tpl}")

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
        word_folder = folder_id_por_tipo("word")
        if word_folder:
            try:
                uploads.append({"tipo": "word", **subir_a_drive(destino_docx, word_folder)})
            except Exception as e:
                uploads.append({"tipo": "word", "error": str(e)})
        else:
            uploads.append({"tipo": "word", "error": "Carpeta WORD no encontrada en Drive"})

        if pdf_path:
            pdf_folder = folder_id_por_tipo("pdf")
            if pdf_folder:
                try:
                    uploads.append({"tipo": "pdf", **subir_a_drive(pdf_path, pdf_folder)})
                except Exception as e:
                    uploads.append({"tipo": "pdf", "error": str(e)})
            else:
                uploads.append({"tipo": "pdf", "error": "Carpeta PDF no encontrada en Drive"})
        resultado["drive_uploads"] = uploads

    return resultado


def generar_desde_archivo(
    datos_path: Path,
    **kwargs: Any,
) -> dict[str, Any]:
    datos = cargar_datos_desde_archivo(datos_path)
    return generar_desde_datos(datos, **kwargs)


def ruta_descarga_segura(nombre: str) -> Path | None:
    """Solo archivos FT *.docx|pdf bajo fichas_word/."""
    nombre = os.path.basename(nombre or "")
    if not re.match(r"^FT .+\.(docx|pdf)$", nombre, re.I):
        return None
    path = (FICHAS_DIR / nombre).resolve()
    try:
        path.relative_to(FICHAS_DIR.resolve())
    except ValueError:
        return None
    if path.is_file():
        return path
    return None
