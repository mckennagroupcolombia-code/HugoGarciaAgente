#!/usr/bin/env python3
"""
CLI: Word FT → formato YAML del panel → PDF HTML (WeasyPrint).

Ejemplos:
  python3 scripts/word_a_ficha_pdf.py --dry-run --todos
  python3 scripts/word_a_ficha_pdf.py --archivo "FT ACIDO CITRICO.docx"
  python3 scripts/word_a_ficha_pdf.py --todos --solo-faltantes
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from app.services.ficha_tecnica import FICHAS_DIR  # noqa: E402
from app.services.ficha_tecnica_word import (  # noqa: E402
    listar_ft_docx,
    procesar_word_a_ficha,
)


def _resolver_archivo(nombre: str) -> Path:
    candidatos = [
        Path(nombre),
        FICHAS_DIR / nombre,
        REPO / nombre,
    ]
    for c in candidatos:
        if c.is_file():
            return c.resolve()
    # Permitir sin extensión o sin prefijo FT
    stem = Path(nombre).stem
    if not stem.upper().startswith("FT "):
        alt = FICHAS_DIR / f"FT {stem}.docx"
        if alt.is_file():
            return alt.resolve()
    raise FileNotFoundError(f"No encontrado: {nombre}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrae FT Word, diligencia formato YAML y genera PDF McKenna"
    )
    parser.add_argument(
        "--archivo",
        action="append",
        default=[],
        help="Nombre o ruta de FT *.docx (repetible)",
    )
    parser.add_argument("--todos", action="store_true", help="Procesar todos los FT *.docx")
    parser.add_argument(
        "--solo-faltantes",
        action="store_true",
        default=True,
        help="Omitir si ya existe PDF (default: activo)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerar aunque exista PDF",
    )
    parser.add_argument(
        "--solo-yaml",
        action="store_true",
        help="Solo extraer y guardar YAML (sin PDF)",
    )
    parser.add_argument("--dry-run", action="store_true", help="No escribe archivos")
    parser.add_argument(
        "--actualizar-json-web",
        action="store_true",
        help="Al final refresca PAGINA_WEB/site/data/fichas_tecnicas.json",
    )
    parser.add_argument("--cabezote-id", default=None, help="ID de cabezote para el PDF")
    args = parser.parse_args()

    if not args.archivo and not args.todos:
        parser.error("Indique --archivo … o --todos")

    if args.force:
        args.solo_faltantes = False

    paths: list[Path] = []
    if args.todos:
        paths = listar_ft_docx(FICHAS_DIR)
    for nom in args.archivo:
        try:
            paths.append(_resolver_archivo(nom))
        except FileNotFoundError as e:
            print(f"❌ {e}", file=sys.stderr)
            return 1

    # Deduplicar preservando orden
    vistos: set[str] = set()
    unicos: list[Path] = []
    for p in paths:
        key = str(p.resolve())
        if key not in vistos:
            vistos.add(key)
            unicos.append(p)
    paths = unicos

    print(f"Archivos a revisar: {len(paths)}")
    ok = 0
    skip = 0
    err = 0
    con_vacios = 0

    for path in paths:
        try:
            res = procesar_word_a_ficha(
                path,
                guardar_yaml=not args.dry_run,
                generar_pdf=not args.solo_yaml,
                force=args.force or not args.solo_faltantes,
                dry_run=args.dry_run,
                cabezote_id=args.cabezote_id,
            )
        except Exception as e:
            err += 1
            print(f"  ERR {path.name}: {e}")
            continue

        if res.get("skipped"):
            skip += 1
            print(f"  --  {path.name}  (PDF ya existe, use --force)")
            continue

        ok += 1
        vacios = res.get("vacios") or []
        if vacios:
            con_vacios += 1
        marca = "DRY" if args.dry_run else "OK"
        extras = f"  vacíos={','.join(vacios)}" if vacios else ""
        yaml_info = Path(res["yaml"]).name if res.get("yaml") else "-"
        pdf_info = Path(res["pdf"]).name if res.get("pdf") and not args.solo_yaml else "-"
        print(
            f"  {marca} {res.get('titulo', path.name)[:40]:<40}  "
            f"yaml={yaml_info}  pdf={pdf_info}{extras}"
        )

    print(
        f"\nResumen: ok={ok}  omitidos={skip}  errores={err}  "
        f"con_campos_vacíos={con_vacios}"
    )

    if args.actualizar_json_web and not args.dry_run:
        import importlib.util
        import json

        print("\nActualizando fichas_tecnicas.json …")
        spec = importlib.util.spec_from_file_location(
            "extraer_fichas", REPO / "scripts" / "extraer_fichas.py"
        )
        if spec is None or spec.loader is None:
            print("⚠ No se pudo cargar scripts/extraer_fichas.py", file=sys.stderr)
            return 1
        ef = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ef)
        resultado, errores = ef.construir_cache_fichas()
        ef.OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        ef.OUTPUT.write_text(
            json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"✓ {ef.OUTPUT} ({len(resultado)} fichas, {len(errores)} errores)")

    return 1 if err else 0


if __name__ == "__main__":
    sys.exit(main())
