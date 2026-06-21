#!/usr/bin/env python3
"""CLI para generar fichas técnicas (ver app/services/ficha_tecnica.py)."""

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from app.services.ficha_tecnica import (  # noqa: E402
    DATOS_DIR,
    configuracion_drive,
    generar_desde_archivo,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera ficha técnica McKenna (DOCX + PDF)")
    parser.add_argument("--datos", type=Path, help="YAML/JSON con datos del producto")
    parser.add_argument("--plantilla", type=Path, default=None, help="Ruta DOCX plantilla")
    parser.add_argument("--plantilla-id", dest="plantilla_id", default=None, help="ID plantilla (default o nombre en plantillas/)")
    parser.add_argument("--cabezote-id", dest="cabezote_id", default=None, help="ID cabezote (default o nombre en cabezotes/)")
    parser.add_argument("--salida", type=Path, default=None)
    parser.add_argument("--solo-docx", action="store_true")
    parser.add_argument("--subir-drive", action="store_true")
    parser.add_argument("--config-drive", action="store_true", help="Muestra client_email y carpetas")
    args = parser.parse_args()

    if args.config_drive:
        cfg = configuracion_drive()
        print(f"client_email: {cfg.get('client_email')}")
        print(f"WORD: {cfg.get('folder_word_id')}  {cfg.get('folder_word_url')}")
        print(f"PDF:  {cfg.get('folder_pdf_id')}  {cfg.get('folder_pdf_url')}")
        print(cfg.get("instrucciones"))
        return 0

    if not args.datos:
        parser.error("--datos es obligatorio (o use --config-drive)")

    candidatos = [args.datos, DATOS_DIR / args.datos, REPO / args.datos]
    datos_path = args.datos
    for c in candidatos:
        if c.exists():
            datos_path = c
            break
    if not datos_path.exists():
        print(f"❌ No encontrado: {args.datos}", file=sys.stderr)
        return 1

    try:
        kwargs: dict = {
            "salida": args.salida,
            "generar_pdf": not args.solo_docx,
            "subir_drive": args.subir_drive,
            "cabezote_id": args.cabezote_id,
        }
        if args.plantilla:
            kwargs["plantilla"] = args.plantilla
        elif args.plantilla_id:
            kwargs["plantilla_id"] = args.plantilla_id
        res = generar_desde_archivo(datos_path, **kwargs)
    except Exception as e:
        print(f"❌ {e}", file=sys.stderr)
        return 1

    print(f"✓ DOCX: {res['docx']}")
    if res.get("pdf"):
        print(f"✓ PDF:  {res['pdf']}")
    for up in res.get("drive_uploads") or []:
        if up.get("webViewLink"):
            print(f"✓ Drive ({up.get('tipo')}): {up['webViewLink']}")
        elif up.get("error"):
            print(f"⚠ Drive ({up.get('tipo')}): {up['error']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
